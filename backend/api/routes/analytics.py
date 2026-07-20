# api/routes/analytics.py
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from models.orm import Camera, CameraHistory
from models.domain import PaginatedResponse
from api.routes.auth import get_current_user

# Router-level dependency — see cameras.py for why this is enforced here rather than per-route.
router = APIRouter(dependencies=[Depends(get_current_user)])

# --- Alerts ---
@router.get("/alerts", response_model=PaginatedResponse)
def get_alerts():
    # Return empty list of active alerts to satisfy query
    return PaginatedResponse(items=[], next_cursor=None)

@router.post("/alerts/{id}/ack")
def ack_alert(id: str, payload: dict):
    return {"id": id, "status": "ACKED", "ackedAt": datetime.utcnow().isoformat() + "Z"}

@router.post("/alerts/bulk-ack")
def bulk_ack_alerts(payload: dict):
    ids = payload.get("alertIds", [])
    results = [{"id": aid, "ok": True} for aid in ids]
    return {"results": results}

@router.post("/alerts/{id}/resolve")
def resolve_alert(id: str):
    return {"id": id, "status": "RESOLVED", "resolvedAt": datetime.utcnow().isoformat() + "Z"}

@router.post("/alerts/{id}/escalate")
def escalate_alert(id: str):
    return {"id": id, "status": "ESCALATED", "escalatedAt": datetime.utcnow().isoformat() + "Z"}

# --- Thresholds ---
@router.get("/thresholds", response_model=PaginatedResponse)
def get_thresholds():
    return PaginatedResponse(items=[], next_cursor=None)

@router.put("/thresholds")
def set_threshold(payload: dict):
    return {
        "scopeType": payload.get("scopeType", "camera"),
        "scopeId": payload.get("scopeId", ""),
        "metric": payload.get("metric", "headcount"),
        "warningAt": payload.get("warningAt", 10),
        "criticalAt": payload.get("criticalAt", 20),
        "sustainedSeconds": payload.get("sustainedSeconds", 5),
        "cooldownSeconds": payload.get("cooldownSeconds", 60),
        "updatedBy": "admin",
        "updatedAt": datetime.utcnow().isoformat() + "Z"
    }

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

