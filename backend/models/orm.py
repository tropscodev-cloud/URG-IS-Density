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
