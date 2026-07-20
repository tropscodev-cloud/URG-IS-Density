# api/routes/analytics.py
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.orm import Session
from core.database import get_db
from core.alert_engine import alert_engine
from core.audit import write_audit, client_ip
from models.orm import Camera, CameraHistory, Alert, ThresholdConfig
from models.domain import PaginatedResponse, AckAlertRequest, BulkAckRequest, SetThresholdRequest
from api.routes.auth import get_current_user
from api.ws.connection import manager as ws_manager

# Router-level dependency — see cameras.py for why this is enforced here rather than per-route.
router = APIRouter(dependencies=[Depends(get_current_user)])


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def serialize_alert(a: Alert) -> dict:
    return {
        "id": a.id,
        "cameraId": a.camera_id,
        "zoneId": a.zone_id,
        "severity": a.severity,
        "status": a.status,
        "metric": a.metric,
        "thresholdValue": a.threshold_value,
        "observedValue": a.observed_value,
        "raisedAt": _iso(a.raised_at),
        "ackedAt": _iso(a.acked_at),
        "ackedBy": a.acked_by,
        "ackNote": a.ack_note,
        "resolvedAt": _iso(a.resolved_at),
        "resolvedBy": a.resolved_by,
        "escalatedAt": _iso(a.escalated_at),
        "escalatedBy": a.escalated_by,
    }


def serialize_threshold(t: ThresholdConfig) -> dict:
    return {
        "scopeType": t.scope_type,
        "scopeId": t.scope_id,
        "metric": t.metric,
        "warningAt": t.warning_at,
        "criticalAt": t.critical_at,
        "sustainedSeconds": t.sustained_seconds,
        "cooldownSeconds": t.cooldown_seconds,
        "updatedBy": t.updated_by,
        "updatedAt": _iso(t.updated_at),
    }


async def _broadcast_alert_event(event: str, alert_data: dict) -> None:
    await ws_manager.broadcast_alerts({
        "type": "alert",
        "topic": "alerts",
        "event": event,
        "alert": alert_data,
    })


# --- Alerts ---
@router.get("/alerts", response_model=PaginatedResponse)
def get_alerts(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    zoneId: Optional[str] = Query(None),
    cameraId: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Alert)
    if status:
        q = q.filter(Alert.status == status)
    if severity:
        q = q.filter(Alert.severity == severity)
    if zoneId:
        q = q.filter(Alert.zone_id == zoneId)
    if cameraId:
        q = q.filter(Alert.camera_id == cameraId)
    rows = q.order_by(Alert.raised_at.desc()).limit(limit).all()
    return PaginatedResponse(items=[serialize_alert(r) for r in rows], next_cursor=None)

@router.post("/alerts/{id}/ack")
async def ack_alert(id: str, payload: AckAlertRequest, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = db.query(Alert).filter(Alert.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = "ACKED"
    row.acked_at = datetime.utcnow()
    row.acked_by = user["username"]
    row.ack_note = payload.note
    write_audit(db, user["id"], "alert_ack", target_type="alert", target_id=id,
                detail={"note": payload.note}, source_ip=client_ip(request))
    db.commit()
    db.refresh(row)
    data = serialize_alert(row)
    await _broadcast_alert_event("acked", data)
    return data

@router.post("/alerts/bulk-ack")
async def bulk_ack_alerts(payload: BulkAckRequest, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    results = []
    acked_ids = []
    for aid in payload.alert_ids:
        row = db.query(Alert).filter(Alert.id == aid).first()
        if not row:
            results.append({"id": aid, "ok": False, "error": "not_found"})
            continue
        if row.status != "OPEN":
            results.append({"id": aid, "ok": False, "error": "not_open"})
            continue
        row.status = "ACKED"
        row.acked_at = datetime.utcnow()
        row.acked_by = user["username"]
        row.ack_note = payload.note
        db.commit()
        db.refresh(row)
        await _broadcast_alert_event("acked", serialize_alert(row))
        results.append({"id": aid, "ok": True})
        acked_ids.append(aid)

    if acked_ids:
        write_audit(db, user["id"], "alert_bulk_ack", target_type="alert",
                    detail={"alertIds": acked_ids, "note": payload.note}, source_ip=client_ip(request))
        db.commit()
    return {"results": results}

@router.post("/alerts/{id}/resolve")
async def resolve_alert(id: str, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = db.query(Alert).filter(Alert.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = "RESOLVED"
    row.resolved_at = datetime.utcnow()
    row.resolved_by = user["username"]
    write_audit(db, user["id"], "alert_resolve", target_type="alert", target_id=id, source_ip=client_ip(request))
    db.commit()
    db.refresh(row)
    alert_engine.mark_resolved_externally(row.camera_id, row.resolved_at.timestamp())
    data = serialize_alert(row)
    await _broadcast_alert_event("resolved", data)
    return data

@router.post("/alerts/{id}/escalate")
async def escalate_alert(id: str, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = db.query(Alert).filter(Alert.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = "ESCALATED"
    row.escalated_at = datetime.utcnow()
    row.escalated_by = user["username"]
    write_audit(db, user["id"], "alert_escalate", target_type="alert", target_id=id, source_ip=client_ip(request))
    db.commit()
    db.refresh(row)
    data = serialize_alert(row)
    await _broadcast_alert_event("escalated", data)
    return data

# --- Thresholds ---
@router.get("/thresholds", response_model=PaginatedResponse)
def get_thresholds(db: Session = Depends(get_db)):
    rows = db.query(ThresholdConfig).all()
    return PaginatedResponse(items=[serialize_threshold(r) for r in rows], next_cursor=None)

@router.put("/thresholds")
def set_threshold(payload: SetThresholdRequest, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = (
        db.query(ThresholdConfig)
        .filter(
            ThresholdConfig.scope_type == payload.scope_type,
            ThresholdConfig.scope_id == payload.scope_id,
            ThresholdConfig.metric == payload.metric,
        )
        .first()
    )
    if row is None:
        row = ThresholdConfig(scope_type=payload.scope_type, scope_id=payload.scope_id, metric=payload.metric)
        db.add(row)

    row.warning_at = payload.warning_at
    row.critical_at = payload.critical_at
    row.sustained_seconds = payload.sustained_seconds
    row.cooldown_seconds = payload.cooldown_seconds
    row.updated_by = user["username"]
    row.updated_at = datetime.utcnow()
    write_audit(db, user["id"], "threshold_update", target_type="threshold",
                target_id=f"{payload.scope_type}:{payload.scope_id}:{payload.metric}",
                detail={"warningAt": payload.warning_at, "criticalAt": payload.critical_at,
                        "sustainedSeconds": payload.sustained_seconds, "cooldownSeconds": payload.cooldown_seconds},
                source_ip=client_ip(request))
    db.commit()
    db.refresh(row)

    # Threshold changes must take effect on the very next frame the engine evaluates, not after a
    # restart — it caches configs in memory for the same reason CrowdAnalyticsService caches
    # zones (avoiding a DB round-trip on every frame).
    alert_engine.load_configs()

    return serialize_threshold(row)

# --- Audit Logs ---
@router.get("/audit/events", response_model=PaginatedResponse)
def get_audit_events():
    return PaginatedResponse(items=[], next_cursor=None)

@router.post("/audit/events")
def post_audit_events(payload: dict):
    events = payload.get("events", [])
    accepted_ids = [e.get("id", str(uuid.uuid4())) for e in events]
    return {"acceptedClientEventIds": accepted_ids}

# --- Reports ---
@router.get("/reports", response_model=PaginatedResponse)
def get_reports():
    mock_reports = [
        {
            "id": "job_001",
            "status": "DONE",
            "progressPct": 100,
            "requestedBy": "admin",
            "requestedAt": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z",
            "resultUrl": "https://example.com/mock-report-1.pdf",
            "error": None,
            "reportId": "REP_FOYER_01",
            "request": {
                "cameraIds": ["CAM_001"],
                "zoneIds": ["ZONE_001"],
                "from": (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z",
                "to": datetime.utcnow().isoformat() + "Z",
                "metrics": ["headcount"],
                "includeAlertLog": True,
                "includeUptime": True
            }
        },
        {
            "id": "job_002",
            "status": "DONE",
            "progressPct": 100,
            "requestedBy": "admin",
            "requestedAt": (datetime.utcnow() - timedelta(hours=5)).isoformat() + "Z",
            "resultUrl": "https://example.com/mock-report-2.pdf",
            "error": None,
            "reportId": "REP_PRODUCE_02",
            "request": {
                "cameraIds": ["CAM_002"],
                "zoneIds": ["ZONE_001"],
                "from": (datetime.utcnow() - timedelta(days=2)).isoformat() + "Z",
                "to": (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z",
                "metrics": ["headcount", "densityRisk"],
                "includeAlertLog": True,
                "includeUptime": True
            }
        }
    ]
    return PaginatedResponse(items=mock_reports, next_cursor=None)

@router.post("/reports")
def create_report(payload: dict):
    report_id = f"REP_{str(uuid.uuid4())[:8].upper()}"
    return {
        "id": str(uuid.uuid4()),
        "status": "DONE",
        "progressPct": 100,
        "requestedBy": "admin",
        "requestedAt": datetime.utcnow().isoformat() + "Z",
        "resultUrl": "https://example.com/mock-report.pdf",
        "error": None,
        "reportId": report_id,
        "request": payload
    }

@router.get("/reports/{id}")
def get_report_job(id: str):
    return {
        "id": id,
        "status": "DONE",
        "progressPct": 100,
        "requestedBy": "admin",
        "requestedAt": datetime.utcnow().isoformat() + "Z",
        "resultUrl": "https://example.com/mock-report.pdf",
        "error": None,
        "reportId": f"REP_{id[:8].upper()}",
        "request": {
            "cameraIds": ["CAM_001"],
            "zoneIds": ["ZONE_001"],
            "from": (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z",
            "to": datetime.utcnow().isoformat() + "Z",
            "metrics": ["headcount"],
            "includeAlertLog": True,
            "includeUptime": True
        }
    }

@router.get("/reports/{id}/data")
def get_report_job_data(id: str):
    # Returns complete structure satisfying frontend's ReportPdfData TS interface
    return {
        "reportId": f"REP_{id[:8].upper()}",
        "generatedBy": "Admin User",
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "request": {
            "from": (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z",
            "to": datetime.utcnow().isoformat() + "Z"
        },
        "cameras": [
            {
                "cameraId": "CAM_001",
                "name": "Entrance & Foyer",
                "zoneId": "ZONE_001",
                "uptimePct": 99.4,
                "peakHeadcount": 28,
                "avgHeadcount": 14.2,
                "series": [
                    {"ts": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z", "headcount": 10, "densityRisk": 0.3},
                    {"ts": (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z", "headcount": 20, "densityRisk": 0.6}
                ]
            },
            {
                "cameraId": "CAM_002",
                "name": "Fresh Produce Aisle",
                "zoneId": "ZONE_001",
                "uptimePct": 100.0,
                "peakHeadcount": 18,
                "avgHeadcount": 8.5,
                "series": [
                    {"ts": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z", "headcount": 5, "densityRisk": 0.1},
                    {"ts": (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z", "headcount": 15, "densityRisk": 0.4}
                ]
            },
            {
                "cameraId": "CAM_003",
                "name": "Bakery & Dairy Section",
                "zoneId": "ZONE_001",
                "uptimePct": 98.7,
                "peakHeadcount": 22,
                "avgHeadcount": 11.8,
                "series": [
                    {"ts": (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z", "headcount": 8, "densityRisk": 0.2},
                    {"ts": (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z", "headcount": 18, "densityRisk": 0.5}
                ]
            }
        ],
        "alertLog": [
            {
                "cameraId": "CAM_001",
                "severity": "WARNING",
                "raisedAt": (datetime.utcnow() - timedelta(minutes=45)).isoformat() + "Z",
                "observedValue": 22
            },
            {
                "cameraId": "CAM_003",
                "severity": "CRITICAL",
                "raisedAt": (datetime.utcnow() - timedelta(minutes=15)).isoformat() + "Z",
                "observedValue": 28
            }
        ]
    }

@router.post("/reports/evidence-bundle")
def generate_evidence_bundle(payload: dict):
    return {
        "id": str(uuid.uuid4()),
        "status": "DONE",
        "progressPct": 100,
        "requestedBy": "admin",
        "requestedAt": datetime.utcnow().isoformat() + "Z",
        "resultUrl": "https://example.com/mock-evidence-bundle.zip",
        "error": None
    }

@router.get("/reports/schedules", response_model=PaginatedResponse)
def get_report_schedules():
    # Return a list of mock active schedules so the UI shows them by default
    mock_schedules = [
        {
            "id": "sched_001",
            "name": "Foyer Queue Daily Summary",
            "cadence": "daily",
            "zoneIds": ["ZONE_001"],
            "recipients": ["security@example.com", "ops@example.com"],
            "createdBy": "admin",
            "createdAt": (datetime.utcnow() - timedelta(days=5)).isoformat() + "Z"
        }
    ]
    return PaginatedResponse(items=mock_schedules, next_cursor=None)

@router.put("/reports/schedules")
def create_report_schedule(payload: dict):
    return {
        "id": str(uuid.uuid4()),
        "name": payload.get("name", "New Report Schedule"),
        "cadence": payload.get("cadence", "daily"),
        "zoneIds": payload.get("zoneIds", []),
        "recipients": payload.get("recipients", []),
        "createdBy": "admin",
        "createdAt": datetime.utcnow().isoformat() + "Z"
    }

# --- Chatbot Query ---
from core.chat_service import process_chat_query

@router.post("/chat/query")
def chat_query(payload: dict, db: Session = Depends(get_db)):
    """
    Intent-aware NL chatbot endpoint.
    Reads live metrics from the running pipeline via the shared metrics_store singleton,
    falls back to CameraHistory DB records when the pipeline is not yet initialised.
    """
    message = payload.get("message", "")
    context = payload.get("context") or {}
    camera_ids = context.get("cameraIds") or []
    from_ts = context.get("from")
    to_ts = context.get("to")

    return process_chat_query(
        db=db,
        message=message,
        camera_ids=camera_ids if camera_ids else None,
        from_ts=from_ts,
        to_ts=to_ts,
    )

