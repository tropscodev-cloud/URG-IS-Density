# models/orm.py
from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey, JSON, Float
from sqlalchemy.sql import func
from core.database import Base

class Camera(Base):
    __tablename__ = "cameras"

    id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    rtsp_url = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    bearing = Column(Float, default=0.0)       # 0 = North, 90 = East, etc.
    fov_radius = Column(Float, default=50.0)   # View range in meters
    fov_angle = Column(Float, default=60.0)    # Camera angle field of view
    density_threshold = Column(Integer, default=10) # Warning headcount threshold
    homography_matrix = Column(JSON, nullable=True) # 3x3 array of floats
    is_active = Column(Boolean, default=True)

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

class ZoneHistory(Base):
    __tablename__ = "zone_history"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(String(50), ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), default=func.now(), index=True)
    headcount = Column(Integer, nullable=False)
    density_percentage = Column(Float, nullable=False)
