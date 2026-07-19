# models/domain.py
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from typing import List, Optional, Any, Union, Literal

class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True
    )

class LoginRequest(BaseModel):
    username: str
    password: str

class CameraMetricsResponse(CamelModel):
    camera_id: str
    seq: int
    ts: str
    headcount: int
    flow_rate: int
    moving_percentage: float  # Maps to movementPct (alias helper or manual)
    risk_percentage: float    # Maps to densityRisk
    inference_latency_ms: int = 15

    # Manual mapping properties to ensure exact frontend contract matches
    @property
    def movement_pct(self) -> float:
        return self.moving_percentage
        
    @property
    def density_risk(self) -> float:
        # Convert 0-100 scale to 0.0-1.0 scale expected by frontend
        return self.risk_percentage / 100.0
class CameraResponse(CamelModel):
    id: str
    name: str
    zone_id: Optional[str] = "ZONE_001"
    building_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    bearing: Optional[float] = 0.0
    fov_angle: Optional[float] = 60.0
    range: Optional[float] = 50.0
    tags: Optional[List[str]] = []
    status: Optional[str] = "ONLINE"
    last_seen_at: Optional[str] = None
    last_metrics: Optional[CameraMetricsResponse] = None
    rtsp_url_masked: Optional[str] = ""
    stream_key: Optional[str] = None
    reconnect_attempts: Optional[int] = 0
    misconfigured_reason: Optional[str] = None
    disabled_reason: Optional[str] = None
    retired: Optional[bool] = False
    retired_at: Optional[str] = None
    retired_reason: Optional[str] = None
    retired_by: Optional[str] = None
    uptime_pct_30d: Optional[float] = Field(default=100.0, serialization_alias="uptimePct30d")
    target_fps: Optional[int] = 20
    created_at: Any = None
    updated_at: Any = None

    # Custom serialization wrapper to convert ISO datetime formats nicely
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        json_encoders={
            # convert datetimes to string on dump
            Any: lambda v: v.isoformat() if hasattr(v, 'isoformat') else str(v)
        }
    )

class CameraCreate(CamelModel):
    id: Optional[str] = None
    name: str
    zone_id: str
    building_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    rtsp_url: str
    bearing: float = 0.0
    fov_angle: float = 60.0
    range: float = 50.0
    tags: List[str] = []

class CameraFpsUpdate(CamelModel):
    target_fps: int

class BulkCameraFpsUpdate(CamelModel):
    # Either explicit camera ids or the literal string "all".
    camera_ids: Union[List[str], Literal["all"]]
    target_fps: int

class ZoneResponse(CamelModel):
    id: str
    name: str
    boundary_polygon: List[List[float]]
    capacity: int
    density_threshold: int
    building_id: Optional[str] = None
    parent_zone_id: Optional[str] = None

class ZoneCreate(CamelModel):
    id: str
    name: str
    boundary_polygon: List[List[float]]
    capacity: int = 100
    density_threshold: int = 80
    building_id: Optional[str] = None
    parent_zone_id: Optional[str] = None

class BuildingResponse(CamelModel):
    id: str
    name: str
    floor_plans: List[Any] = []

class PaginatedResponse(CamelModel):
    items: List[Any]
    next_cursor: Optional[str] = None
