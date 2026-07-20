# core/alert_engine.py
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Optional

from loguru import logger

from core.database import SessionLocal
from models.orm import Alert, Camera, ThresholdConfig

# Matches ThresholdSettings.tsx's own defaults exactly, so a camera/zone with no explicit
# ThresholdConfig row behaves identically to what an operator would see pre-filled in that UI.
DEFAULT_WARNING_AT = 0.55
DEFAULT_CRITICAL_AT = 0.80
DEFAULT_SUSTAINED_SECONDS = 12
DEFAULT_COOLDOWN_SECONDS = 45

# The only metric actually driven by live vision-pipeline output today — ThresholdConfig rows for
# other metrics can be stored but the evaluator only ever reads this one.
METRIC = "densityRisk"

_SEVERITY_RANK = {"WARNING": 1, "CRITICAL": 2}


@dataclass
class _CameraAlertState:
    breach_started_at: Optional[float] = None   # wall time the current continuous breach began
    pending_severity: Optional[str] = None        # highest severity seen while still sustaining
    active_alert_id: Optional[str] = None          # currently OPEN/ACKED/ESCALATED alert, if any
    active_severity: Optional[str] = None
    last_resolved_at: Optional[float] = None       # wall time of last resolve, for cooldown


class AlertEngine:
    """
    Turns continuous per-camera densityRisk readings into persisted Alert rows using a hysteresis
    state machine: a reading must stay above a warning/critical threshold continuously for
    `sustainedSeconds` before an alert actually raises (debounces a momentary spike), and once an
    alert resolves the same camera won't re-raise for `cooldownSeconds` (stops a value oscillating
    right at the line from spamming the tray). See ThresholdSettings.tsx for the operator-facing
    explanation of the same behavior.

    evaluate() is pure in-memory (safe to call every frame directly from the event loop);
    apply_action() does the actual DB write and must be run off the event loop by the caller —
    same discipline main.py already applies to the zone-history write.
    """

    def __init__(self):
        self._state: Dict[str, _CameraAlertState] = {}
        self._configs: Dict[tuple, dict] = {}
        self._camera_zone: Dict[str, Optional[str]] = {}
        self.load_configs()
        self.load_camera_zones()

    def load_configs(self) -> None:
        db = SessionLocal()
        try:
            rows = db.query(ThresholdConfig).all()
            self._configs = {
                (r.scope_type, r.scope_id, r.metric): {
                    "warningAt": r.warning_at,
                    "criticalAt": r.critical_at,
                    "sustainedSeconds": r.sustained_seconds,
                    "cooldownSeconds": r.cooldown_seconds,
                }
                for r in rows
            }
            logger.info(f"AlertEngine loaded {len(self._configs)} threshold config(s).")
        except Exception as e:
            logger.error(f"AlertEngine failed to load threshold configs: {e}")
        finally:
            db.close()

    def load_camera_zones(self) -> None:
        db = SessionLocal()
        try:
            rows = db.query(Camera.id, Camera.zone_id).all()
            self._camera_zone = {cid: zid for cid, zid in rows}
        except Exception as e:
            logger.error(f"AlertEngine failed to load camera zone map: {e}")
        finally:
            db.close()

    def _resolve_thresholds(self, camera_id: str) -> dict:
        zone_id = self._camera_zone.get(camera_id)
        cfg = self._configs.get(("camera", camera_id, METRIC))
        if cfg is None and zone_id:
            cfg = self._configs.get(("zone", zone_id, METRIC))
        if cfg is not None:
            return cfg
        return {
            "warningAt": DEFAULT_WARNING_AT,
            "criticalAt": DEFAULT_CRITICAL_AT,
            "sustainedSeconds": DEFAULT_SUSTAINED_SECONDS,
            "cooldownSeconds": DEFAULT_COOLDOWN_SECONDS,
        }

    def evaluate(self, camera_id: str, observed: float) -> Optional[dict]:
        """Pure in-memory hysteresis step. Returns an action dict for apply_action(), or None."""
        cfg = self._resolve_thresholds(camera_id)
        state = self._state.setdefault(camera_id, _CameraAlertState())
        now = time.time()

        severity = None
        if observed >= cfg["criticalAt"]:
            severity = "CRITICAL"
        elif observed >= cfg["warningAt"]:
            severity = "WARNING"

        if severity is None:
            if state.active_alert_id:
                action = {
                    "type": "resolve",
                    "alert_id": state.active_alert_id,
                    "resolved_by": "system:auto",
                }
                state.active_alert_id = None
                state.active_severity = None
                state.breach_started_at = None
                state.pending_severity = None
                state.last_resolved_at = now
                return action
            state.breach_started_at = None
            state.pending_severity = None
            return None

        # Already-active alert on this camera: only an escalation to a strictly higher severity
        # is worth a fresh DB write + WS push. Peak severity is kept until resolved rather than
        # downgraded on a momentary dip — a critical incident doesn't stop being one because the
        # reading ticked down for a frame.
        if state.active_alert_id:
            if _SEVERITY_RANK[severity] > _SEVERITY_RANK.get(state.active_severity or "WARNING", 1):
                state.active_severity = severity
                return {
                    "type": "upgrade",
                    "alert_id": state.active_alert_id,
                    "severity": severity,
                    "observed_value": observed,
                    "threshold_value": cfg["criticalAt"] if severity == "CRITICAL" else cfg["warningAt"],
                }
            return None

        if state.breach_started_at is None:
            state.breach_started_at = now
            state.pending_severity = severity
            return None

        if _SEVERITY_RANK[severity] > _SEVERITY_RANK.get(state.pending_severity or "WARNING", 1):
            state.pending_severity = severity

        if now - state.breach_started_at < cfg["sustainedSeconds"]:
            return None

        if state.last_resolved_at is not None and now - state.last_resolved_at < cfg["cooldownSeconds"]:
            return None

        alert_id = f"ALT_{uuid.uuid4().hex[:12]}"
        raised_severity = state.pending_severity
        state.active_alert_id = alert_id
        state.active_severity = raised_severity
        return {
            "type": "raise",
            "alert_id": alert_id,
            "camera_id": camera_id,
            "zone_id": self._camera_zone.get(camera_id),
            "severity": raised_severity,
            "metric": METRIC,
            "observed_value": observed,
            "threshold_value": cfg["criticalAt"] if raised_severity == "CRITICAL" else cfg["warningAt"],
        }

    def apply_action(self, action: dict) -> Optional[Alert]:
        """Applies a decision from evaluate() to the database. Must run off the event loop."""
        db = SessionLocal()
        try:
            if action["type"] == "raise":
                row = Alert(
                    id=action["alert_id"],
                    camera_id=action["camera_id"],
                    zone_id=action["zone_id"],
                    severity=action["severity"],
                    status="OPEN",
                    metric=action["metric"],
                    threshold_value=action["threshold_value"],
                    observed_value=action["observed_value"],
                )
                db.add(row)
                db.commit()
                db.refresh(row)
                logger.warning(
                    f"[{action['camera_id']}] Alert raised: {action['severity']} "
                    f"{METRIC}={action['observed_value']:.2f}"
                )
                return row

            row = db.query(Alert).filter(Alert.id == action["alert_id"]).first()
            if not row:
                return None

            if action["type"] == "resolve":
                row.status = "RESOLVED"
                row.resolved_at = datetime.utcnow()
                row.resolved_by = action["resolved_by"]
                logger.info(f"[{row.camera_id}] Alert auto-resolved: {row.id}")
            elif action["type"] == "upgrade":
                row.severity = action["severity"]
                row.observed_value = action["observed_value"]
                row.threshold_value = action["threshold_value"]
                logger.warning(f"[{row.camera_id}] Alert escalated in place: {row.id} -> {action['severity']}")

            db.commit()
            db.refresh(row)
            return row
        except Exception as e:
            db.rollback()
            logger.error(f"AlertEngine failed to apply action {action.get('type')}: {e}")
            return None
        finally:
            db.close()

    def mark_resolved_externally(self, camera_id: str, resolved_epoch: float) -> None:
        """Frees the hysteresis slot after a manual (operator-triggered) resolve, so a fresh
        breach can raise a new alert again once the cooldown window passes."""
        state = self._state.setdefault(camera_id, _CameraAlertState())
        state.active_alert_id = None
        state.active_severity = None
        state.breach_started_at = None
        state.pending_severity = None
        state.last_resolved_at = resolved_epoch


# Singleton — main.py's queue reader and api/routes/analytics.py's threshold/resolve endpoints
# both need the same in-memory hysteresis state and config cache.
alert_engine = AlertEngine()
