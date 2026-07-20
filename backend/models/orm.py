# models/orm.py
import json
from typing import Optional
from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey, JSON, Float
from sqlalchemy.sql import func
from core.database import Base

class Camera(Base):
    __tablename__ = "cameras"

    id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    rtsp_url = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    bearing = Column(Float, default=0.0)
    fov_angle = Column(Float, default=60.0)
    fov_radius = Column(Float, default=50.0)  # maps to range
    density_threshold = Column(Integer, default=10)
    homography_matrix = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True)
    # Frames sampled per second for YOLO inference. Default of 20 matches this codebase's
    # pre-existing FRAME_SKIP=2 behavior against ~60fps source footage (60 / (2+1) = 20).
    target_fps = Column(Integer, default=20, nullable=False)
    
    # Advanced fields mapping to the React frontend
    zone_id = Column(String(50), nullable=True, default="ZONE_001")
    building_id = Column(String(50), nullable=True)
    status = Column(String(50), default="ONLINE")
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    stream_key = Column(String(100), nullable=True)
    reconnect_attempts = Column(Integer, default=0)
    misconfigured_reason = Column(String(255), nullable=True)
    disabled_reason = Column(String(255), nullable=True)
    retired = Column(Boolean, default=False)
    retired_at = Column(DateTime(timezone=True), nullable=True)
    retired_reason = Column(String(255), nullable=True)
    retired_by = Column(String(100), nullable=True)
    uptime_pct_30d = Column(Float, default=100.0)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Map database-specific attributes to Pydantic expected names
    @property
    def lat(self) -> Optional[float]:
        return self.latitude

    @property
    def lng(self) -> Optional[float]:
        return self.longitude

    @property
    def range(self) -> float:
        return self.fov_radius

    @property
    def rtsp_url_masked(self) -> str:
        # Simple mask for safety
        if "://" in self.rtsp_url:
            parts = self.rtsp_url.split("://", 1)
            return f"{parts[0]}://***"
        return self.rtsp_url

class CameraHistory(Base):
    __tablename__ = "camera_history"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String(50), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), default=func.now(), index=True)
    headcount = Column(Integer, nullable=False)

class Zone(Base):
    __tablename__ = "zones"

    id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    boundary_polygon = Column(JSON, nullable=False)  # List of [lat, lng] coordinates
    capacity = Column(Integer, default=100)
    density_threshold = Column(Integer, default=80)  # percentage capacity trigger for alert
    building_id = Column(String(50), nullable=True)
    parent_zone_id = Column(String(50), nullable=True)

class ZoneHistory(Base):
    __tablename__ = "zone_history"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(String(50), ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), default=func.now(), index=True)
    headcount = Column(Integer, nullable=False)
    density_percentage = Column(Float, nullable=False)

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String(50), primary_key=True, index=True)
    camera_id = Column(String(50), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    zone_id = Column(String(50), nullable=True, index=True)
    severity = Column(String(20), nullable=False)  # INFO | WARNING | CRITICAL
    status = Column(String(20), nullable=False, default="OPEN", index=True)  # OPEN | ACKED | RESOLVED | ESCALATED
    metric = Column(String(20), nullable=False)  # densityRisk | headcount | flowRate
    threshold_value = Column(Float, nullable=False)
    observed_value = Column(Float, nullable=False)
    raised_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    acked_at = Column(DateTime(timezone=True), nullable=True)
    acked_by = Column(String(100), nullable=True)
    ack_note = Column(String(500), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String(100), nullable=True)
    escalated_at = Column(DateTime(timezone=True), nullable=True)
    escalated_by = Column(String(100), nullable=True)

class User(Base):
    __tablename__ = "users"

    id = Column(String(50), primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    display_name = Column(String(150), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # OPERATOR | SUPERVISOR | ADMIN
    is_active = Column(Boolean, nullable=False, default=True)
    # True until the user has set their own password — a temp/admin-issued password can never be
    # used to establish a real session, only to reach the reset-password flow.
    must_reset_password = Column(Boolean, nullable=False, default=True)
    # Fernet-encrypted TOTP secret; NULL means "not yet enrolled". Never stored or returned in
    # plaintext once enrollment completes.
    mfa_secret_encrypted = Column(String(255), nullable=True)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)

class AuditLog(Base):
    """Append-only — no route ever updates or deletes a row here, only inserts."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    # Nullable: a failed login against an unknown/not-yet-resolved username has no real actor id
    # to attach — the attempted username is captured in `detail` instead.
    actor_user_id = Column(String(50), nullable=True, index=True)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(String(100), nullable=True)
    detail = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    source_ip = Column(String(64), nullable=True)

class ThresholdConfig(Base):
    __tablename__ = "threshold_configs"

    # Natural composite key — one row per (scope, metric) pair matches the PUT /thresholds
    # upsert semantics exactly: setting a zone's densityRisk threshold again just replaces it.
    scope_type = Column(String(10), primary_key=True)  # camera | zone
    scope_id = Column(String(50), primary_key=True)
    metric = Column(String(20), primary_key=True)
    warning_at = Column(Float, nullable=False)
    critical_at = Column(Float, nullable=False)
    sustained_seconds = Column(Integer, nullable=False, default=12)
    cooldown_seconds = Column(Integer, nullable=False, default=45)
    updated_by = Column(String(100), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
