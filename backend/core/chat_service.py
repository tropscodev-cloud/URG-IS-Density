# core/chat_service.py
"""
URG-IS Crowd Intelligence Chatbot Engine.

Provides intent-based NL understanding against live pipeline metrics
and historical DB records. Falls back gracefully when live data is
absent (e.g. pipeline not yet initialised).
"""

import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from core.metrics_store import live_metrics
from models.orm import Camera, CameraHistory


# ---------------------------------------------------------------------------
# Intent patterns
# ---------------------------------------------------------------------------

_INTENTS: List[Tuple[str, List[str]]] = [
    ("headcount",      ["how many", "headcount", "people", "count", "total", "occupancy"]),
    ("flow",           ["flow", "passing", "rate", "throughput", "per minute"]),
    ("density_risk",   ["density", "risk", "safe", "danger", "critical", "warning", "threshold", "alert", "overcrowd"]),
    ("status",         ["status", "online", "offline", "down", "active", "inactive"]),
    ("busiest",        ["busiest", "highest", "most crowd", "most people", "peak"]),
    ("quietest",       ["quietest", "least crowd", "fewest", "lowest", "emptiest"]),
    ("history",        ["last hour", "last 24", "average", "trend", "history", "historical", "was there", "peak time"]),
    ("fleet",          ["all camera", "all zone", "whole system", "fleet", "overall", "site"]),
    ("compare",        ["compare", "vs", "versus", "difference"]),
    ("help",           ["help", "what can", "what do", "capabilities", "feature"]),
]


def _detect_intent(message: str) -> str:
    msg = message.lower()
    for intent, keywords in _INTENTS:
        if any(kw in msg for kw in keywords):
            return intent
    return "general"


def _risk_label(risk_fraction: float) -> str:
    pct = risk_fraction * 100
    if pct >= 80:
        return f"🔴 CRITICAL ({pct:.0f}%)"
    if pct >= 50:
        return f"🟡 WARNING ({pct:.0f}%)"
    return f"🟢 NORMAL ({pct:.0f}%)"


# ---------------------------------------------------------------------------
# Live data helpers
# ---------------------------------------------------------------------------

def _live_for(camera_id: str) -> Optional[Dict[str, Any]]:
    """Returns the most recent live metrics dict for a camera, or None."""
    return live_metrics.get(camera_id)


def _db_latest_headcount(db: Session, camera_id: str) -> Optional[int]:
    row = (
        db.query(CameraHistory)
        .filter(CameraHistory.camera_id == camera_id)
        .order_by(CameraHistory.timestamp.desc())
        .first()
    )
    return row.headcount if row else None


def _get_headcount(db: Session, cam: Camera) -> Tuple[int, bool]:
    """Returns (headcount, is_live). is_live=True if from real-time pipeline."""
    live = _live_for(cam.id)
    if live is not None:
        return live.get("headcount", 0), True
    db_count = _db_latest_headcount(db, cam.id)
    if db_count is not None:
        return db_count, False
    return 0, False


def _get_density_risk(db: Session, cam: Camera) -> Tuple[float, bool]:
    """Returns (risk 0-1, is_live)."""
    live = _live_for(cam.id)
    if live is not None:
        return live.get("densityRisk", 0.0), True
    count, _ = _get_headcount(db, cam)
    if cam.density_threshold > 0:
        return min(1.0, count / cam.density_threshold), False
    return 0.0, False


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def _handle_headcount(db: Session, camera: Camera, sources: list) -> str:
    count, is_live = _get_headcount(db, camera)
    data_tag = "🔴 LIVE" if is_live else "📋 last known"
    sources.append({
        "cameraId": camera.id,
        "metric": "headcount",
        "from": datetime.utcnow().isoformat() + "Z",
        "to":   datetime.utcnow().isoformat() + "Z",
        "value": count,
    })
    return (
        f"**{camera.name}** — [{data_tag}] current headcount is **{count} people**.\n"
        f"Density threshold is set to {camera.density_threshold}."
    )


def _handle_flow(db: Session, camera: Camera, sources: list) -> str:
    live = _live_for(camera.id)
    if live:
        flow = live.get("flowRate", 0)
        sources.append({
            "cameraId": camera.id,
            "metric": "flowRate",
            "from": datetime.utcnow().isoformat() + "Z",
            "to":   datetime.utcnow().isoformat() + "Z",
            "value": flow,
        })
        return (
            f"**{camera.name}** — 🔴 LIVE estimated flow rate is **{flow:.0f} people/minute** "
            f"(movement {live.get('movementPct', 0):.0f}% of tracked people)."
        )
    count, _ = _get_headcount(db, camera)
    flow_est = count * 6
    return (
        f"**{camera.name}** — no live pipeline data available. "
        f"Estimated flow based on last headcount: ~{flow_est} people/minute."
    )


def _handle_density_risk(db: Session, camera: Camera, sources: list) -> str:
    risk, is_live = _get_density_risk(db, camera)
    data_tag = "🔴 LIVE" if is_live else "📋 estimated"
    count, _ = _get_headcount(db, camera)
    label = _risk_label(risk)
    sources.append({
        "cameraId": camera.id,
        "metric": "densityRisk",
        "from": datetime.utcnow().isoformat() + "Z",
        "to":   datetime.utcnow().isoformat() + "Z",
        "value": round(risk * 100, 1),
    })
    return (
        f"**{camera.name}** — [{data_tag}] density status: {label}.\n"
        f"Current headcount: {count}, capacity threshold: {camera.density_threshold}."
    )


def _handle_status(camera: Camera) -> str:
    status_icons = {"ONLINE": "🟢", "DEGRADED": "🟡", "OFFLINE": "🔴", "MISCONFIGURED": "⚠️"}
    icon = status_icons.get(camera.status, "❓")
    live = _live_for(camera.id)
    streaming = "and streaming live data" if live else "but no live frame data received yet"
    return f"**{camera.name}** is {icon} **{camera.status}** {streaming}."


def _handle_fleet(db: Session, cameras: List[Camera], sources: list) -> str:
    active = [c for c in cameras if not c.retired]
    total_headcount = 0
    live_count = 0
    critical = []
    warning_list = []

    for cam in active:
        count, is_live = _get_headcount(db, cam)
        if is_live:
            live_count += 1
        total_headcount += count
        risk, _ = _get_density_risk(db, cam)
        if risk >= 0.8:
            critical.append(cam.name)
        elif risk >= 0.5:
            warning_list.append(cam.name)

    lines = [
        f"📊 **Fleet Overview** — {len(active)} active cameras, {live_count} with live pipeline data.",
        f"👥 Total current headcount across all cameras: **{total_headcount} people**.",
    ]
    if critical:
        lines.append(f"🔴 **Critical density**: {', '.join(critical)}")
    if warning_list:
        lines.append(f"🟡 **Warning density**: {', '.join(warning_list)}")
    if not critical and not warning_list:
        lines.append("🟢 All cameras operating within normal density levels.")

    return "\n".join(lines)


def _handle_busiest(db: Session, cameras: List[Camera]) -> str:
    active = [c for c in cameras if not c.retired]
    if not active:
        return "No active cameras found."
    best = max(active, key=lambda c: _get_headcount(db, c)[0])
    count, is_live = _get_headcount(db, best)
    tag = "🔴 LIVE" if is_live else "📋 last known"
    return f"The busiest camera right now is **{best.name}** with **{count} people** [{tag}]."


def _handle_quietest(db: Session, cameras: List[Camera]) -> str:
    active = [c for c in cameras if not c.retired]
    if not active:
        return "No active cameras found."
    quietest = min(active, key=lambda c: _get_headcount(db, c)[0])
    count, is_live = _get_headcount(db, quietest)
    tag = "🔴 LIVE" if is_live else "📋 last known"
    return f"The quietest camera right now is **{quietest.name}** with **{count} people** [{tag}]."


def _handle_history(db: Session, camera: Camera, sources: list) -> str:
    since = datetime.utcnow() - timedelta(hours=1)
    rows = (
        db.query(CameraHistory)
        .filter(
            CameraHistory.camera_id == camera.id,
            CameraHistory.timestamp >= since,
        )
        .order_by(CameraHistory.timestamp.asc())
        .all()
    )
    if not rows:
        return (
            f"**{camera.name}** — no historical data in the last hour found in the database. "
            f"The pipeline writes history every 5 minutes when running."
        )
    counts = [r.headcount for r in rows]
    avg = sum(counts) / len(counts)
    peak = max(counts)
    low = min(counts)
    sources.append({
        "cameraId": camera.id,
        "metric": "headcount_avg_1h",
        "from": since.isoformat() + "Z",
        "to":   datetime.utcnow().isoformat() + "Z",
        "value": round(avg, 1),
    })
    return (
        f"**{camera.name}** — last-hour summary ({len(rows)} samples):\n"
        f"• Average headcount: {avg:.1f}\n"
        f"• Peak: {peak} people\n"
        f"• Low: {low} people"
    )


def _handle_help() -> str:
    return (
        "I'm your **URG-IS Crowd Intelligence Assistant**. I can answer questions about:\n\n"
        "• **Headcount** — How many people are at a camera or site-wide\n"
        "• **Flow rate** — How fast people are moving through an area\n"
        "• **Density risk** — Whether a location is safe, in warning, or critical\n"
        "• **Camera status** — Whether a camera is online, degraded, or offline\n"
        "• **Busiest / quietest** locations\n"
        "• **Historical data** — Trends from the last hour\n"
        "• **Fleet overview** — Full site summary\n\n"
        "💡 Tip: Select a camera on the map first for context-aware answers.\n"
        "All queries are advisory and audit-logged."
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def process_chat_query(
    db: Session,
    message: str,
    camera_ids: Optional[List[str]] = None,
    from_ts: Optional[str] = None,
    to_ts: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main dispatch function.  Returns {"answer": str, "sources": list, "grounded": bool}.
    """
    sources: List[Dict] = []
    intent = _detect_intent(message)

    # Load all active cameras once
    all_cameras = db.query(Camera).filter(Camera.is_active == True).all()
    cam_map: Dict[str, Camera] = {c.id: c for c in all_cameras}

    # Resolve context cameras from the request
    context_cameras: List[Camera] = []
    if camera_ids:
        for cid in camera_ids:
            cam = cam_map.get(cid)
            if cam:
                context_cameras.append(cam)

    # Fleet-level intents always apply to all cameras
    if intent in ("fleet", "busiest", "quietest") or not context_cameras:
        if intent == "help":
            return {"answer": _handle_help(), "sources": [], "grounded": True}
        if intent == "busiest":
            return {"answer": _handle_busiest(db, all_cameras), "sources": sources, "grounded": True}
        if intent == "quietest":
            return {"answer": _handle_quietest(db, all_cameras), "sources": sources, "grounded": True}
        if intent in ("fleet", "status", "headcount", "density_risk", "flow", "history", "compare") and not context_cameras:
            # No camera selected — give fleet overview
            return {
                "answer": _handle_fleet(db, all_cameras, sources),
                "sources": sources,
                "grounded": len(sources) > 0 or bool(live_metrics),
            }

    # Camera-specific intents
    if context_cameras:
        cam = context_cameras[0]  # primary context camera

        if intent == "headcount":
            answer = _handle_headcount(db, cam, sources)
        elif intent == "flow":
            answer = _handle_flow(db, cam, sources)
        elif intent == "density_risk":
            answer = _handle_density_risk(db, cam, sources)
        elif intent == "status":
            answer = _handle_status(cam)
        elif intent == "history":
            answer = _handle_history(db, cam, sources)
        elif intent == "busiest":
            answer = _handle_busiest(db, all_cameras)
        elif intent == "quietest":
            answer = _handle_quietest(db, all_cameras)
        elif intent == "fleet":
            answer = _handle_fleet(db, all_cameras, sources)
        elif intent == "help":
            answer = _handle_help()
        else:
            # General / unknown — give a rich camera summary
            count, is_live = _get_headcount(db, cam)
            risk, _ = _get_density_risk(db, cam)
            live = _live_for(cam.id)
            tag = "🔴 LIVE" if is_live else "📋 last known"
            answer = (
                f"**{cam.name}** ({cam.id}) — [{tag}]\n"
                f"• Headcount: **{count} people**\n"
                f"• Density status: {_risk_label(risk)}\n"
                f"• Flow rate: {live.get('flowRate', 'N/A') if live else 'N/A'} people/min\n"
                f"• Camera status: {cam.status}\n\n"
                f"Ask me about headcount, flow rate, density risk, history, or fleet overview!"
            )
            sources.append({
                "cameraId": cam.id,
                "metric": "summary",
                "from": datetime.utcnow().isoformat() + "Z",
                "to":   datetime.utcnow().isoformat() + "Z",
                "value": count,
            })
    else:
        # Fully general query with no camera context
        if intent == "help":
            return {"answer": _handle_help(), "sources": [], "grounded": True}
        answer = _handle_fleet(db, all_cameras, sources)

    return {
        "answer": answer,
        "sources": sources,
        "grounded": len(sources) > 0 or bool(live_metrics),
    }
