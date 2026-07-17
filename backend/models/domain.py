# models/domain.py
from pydantic import BaseModel
from typing import List, Optional

class LoginRequest(BaseModel):
    username: str
    password: str

class CameraResponse(BaseModel):
    id: str
    name: str
    rtsp_url: str
    latitude: float
    longitude: float
    bearing: float
    fov_radius: float
    fov_angle: float
    density_threshold: int
    homography_matrix: Optional[List[List[float]]] = None
    is_active: bool

    class Config:
        from_attributes = True

class CameraCreate(BaseModel):
    id: str
    name: str
    rtsp_url: str
    latitude: float
    longitude: float
    bearing: float = 0.0
    fov_radius: float = 50.0
    fov_angle: float = 60.0
    density_threshold: int = 10
    homography_matrix: Optional[List[List[float]]] = None
    is_active: bool = True

class ZoneResponse(BaseModel):
    id: str
    name: str
    boundary_polygon: List[List[float]]
    capacity: int
    density_threshold: int

    class Config:
        from_attributes = True

class ZoneCreate(BaseModel):
    id: str
    name: str
    boundary_polygon: List[List[float]]
    capacity: int = 100
    density_threshold: int = 80
