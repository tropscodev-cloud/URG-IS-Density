# api/routes/telemetry.py
"""
Read-only operational surface for troubleshooting — process/worker health, per-camera online
status, inference queue depth, WS connection count, recent error counts. Deliberately returns
none of: case data, video/RTSP details, alert content, or any other PII. Any endpoint that would
need to expose more than that must sit behind require_support_mode() (a department-enabled,
time-boxed, audit-logged flag, off by default) — none exists yet; this module only provides that
gate as reusable infrastructure for whatever gets built on top of it later.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.audit import write_audit, client_ip
from core.telemetry import recent_error_count
from api.routes.auth import get_current_user, require_role
from api.ws.connection import manager as ws_manager
from models.orm import AuditLog
from workers.manager import process_manager

# Any authenticated role can view telemetry — operational health (not case/alert/PII data) is
# useful to everyone on shift, not just admins. Toggling support mode is separately ADMIN-gated.
router = APIRouter(dependencies=[Depends(get_current_user)])

SUPPORT_MODE_ACTION = "support_mode_toggle"


def _support_mode_status(db: Session) -> dict:
    row = db.query(AuditLog).filter(AuditLog.action == SUPPORT_MODE_ACTION).order_by(AuditLog.timestamp.desc()).first()
    if not row or not row.detail or not row.detail.get("enabled"):
        return {"enabled": False, "expiresAt": None}
    expires_at = datetime.fromisoformat(row.detail["expiresAt"])
    if datetime.utcnow() >= expires_at:
        return {"enabled": False, "expiresAt": None}
    return {"enabled": True, "expiresAt": row.detail["expiresAt"], "enabledBy": row.actor_user_id}


def require_support_mode(db: Session = Depends(get_db)) -> dict:
    """Reusable gate for any future endpoint that needs to expose more than baseline ops
    telemetry — not used by any route in this file yet (nothing here needs more than the
    read-only metrics below), but wired up so the next thing built on top of this surface has
    somewhere correct to attach rather than inventing its own ad hoc check."""
    status = _support_mode_status(db)
    if not status["enabled"]:
        raise HTTPException(status_code=403, detail="Support mode is not active")
    return status


@router.get("/telemetry/workers")
def get_worker_health():
    workers = []
    for camera_id, proc in process_manager.processes.items():
        workers.append({
            "cameraId": camera_id,
            "alive": proc.is_alive(),
            "targetFps": (process_manager.fps_config or {}).get(camera_id),
        })
    return {"workers": workers}


@router.get("/telemetry/queue")
def get_queue_depth():
    depth: Optional[int] = None
    try:
        if process_manager.queue is not None:
            depth = process_manager.queue.qsize()
    except NotImplementedError:
        # multiprocessing.Queue.qsize() isn't implemented on every platform (notably macOS) —
        # report "unknown" rather than letting that crash the endpoint.
        depth = None
    return {"depth": depth}


@router.get("/telemetry/ws")
def get_ws_connections():
    return {"activeConnections": len(ws_manager.active_connections)}


@router.get("/telemetry/errors")
def get_error_counts():
    return {
        "last5Min": recent_error_count(300),
        "last1Hour": recent_error_count(3600),
    }


@router.get("/telemetry/support-mode")
def get_support_mode(db: Session = Depends(get_db)):
    return _support_mode_status(db)


@router.post("/telemetry/support-mode")
def set_support_mode(payload: dict, request: Request, db: Session = Depends(get_db), admin: dict = Depends(require_role("ADMIN"))):
    enabled = bool(payload.get("enabled", False))
    duration_minutes = max(1, min(240, int(payload.get("durationMinutes", 30))))
    expires_at = (datetime.utcnow() + timedelta(minutes=duration_minutes)).isoformat() if enabled else None

    write_audit(db, admin["id"], SUPPORT_MODE_ACTION, target_type="system", target_id="support_mode",
                detail={"enabled": enabled, "expiresAt": expires_at, "durationMinutes": duration_minutes if enabled else None},
                source_ip=client_ip(request))
    db.commit()
    return {"enabled": enabled, "expiresAt": expires_at}
