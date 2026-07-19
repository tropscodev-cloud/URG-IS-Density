# api/routes/cameras.py
import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from models.orm import Camera, Zone
from models.domain import (
    CameraResponse, CameraCreate,
    ZoneResponse, BuildingResponse,
    PaginatedResponse, BulkCameraFpsUpdate
)
from typing import List
from workers.manager import process_manager
from api.routes.auth import get_current_user

# Router-level dependency — every route on this router requires a valid session by construction,
# so a route added later can't accidentally ship unauthenticated.
router = APIRouter(dependencies=[Depends(get_current_user)])

MIN_TARGET_FPS = 1
MAX_TARGET_FPS = 30

# --- Cameras ---
@router.get("/cameras", response_model=PaginatedResponse)
def get_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    # Serialize camera models manually or via Pydantic model
    items = []
    for c in cameras:
        # Convert timestamp to ISO string manually if needed
        items.append(CameraResponse.model_validate(c))
        
    return PaginatedResponse(items=items, next_cursor=None)

@router.get("/cameras/{id}", response_model=CameraResponse)
def get_camera(id: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return CameraResponse.model_validate(camera)

@router.post("/cameras", response_model=CameraResponse)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == payload.id).first()
    if camera:
        raise HTTPException(status_code=400, detail="Camera ID already exists")
        
    cam_id = payload.id or f"CAM_{random.randint(100, 999)}"
    db_camera = Camera(
        id=cam_id,
        name=payload.name,
        rtsp_url=payload.rtsp_url,
        latitude=payload.lat,
        longitude=payload.lng,
        bearing=payload.bearing,
        fov_angle=payload.fov_angle,
        fov_radius=payload.range,
        zone_id=payload.zone_id,
        building_id=payload.building_id,
        status="ONLINE",
        is_active=True
    )
    db.add(db_camera)
    db.commit()
    db.refresh(db_camera)
    return CameraResponse.model_validate(db_camera)

@router.patch("/cameras/{id}", response_model=CameraResponse)
def patch_camera(id: str, payload: dict, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    # Standard patch mapping
    if "name" in payload: camera.name = payload["name"]
    if "rtspUrl" in payload: camera.rtsp_url = payload["rtspUrl"]
    if "lat" in payload: camera.latitude = payload["lat"]
    if "lng" in payload: camera.longitude = payload["lng"]
    if "bearing" in payload: camera.bearing = payload["bearing"]
    if "fovAngle" in payload: camera.fov_angle = payload["fovAngle"]
    if "range" in payload: camera.fov_radius = payload["range"]
    if "zoneId" in payload: camera.zone_id = payload["zoneId"]
    if "buildingId" in payload: camera.building_id = payload["buildingId"]
    if "disabled" in payload: camera.is_active = not payload["disabled"]
    if "targetFps" in payload:
        fps = max(MIN_TARGET_FPS, min(MAX_TARGET_FPS, int(payload["targetFps"])))
        camera.target_fps = fps
        process_manager.set_fps(camera.id, fps)

    db.commit()
    db.refresh(camera)
    return CameraResponse.model_validate(camera)

@router.patch("/cameras", response_model=PaginatedResponse)
def bulk_patch_camera_fps(payload: BulkCameraFpsUpdate, db: Session = Depends(get_db)):
    """Bulk fps update — cameraIds is either an explicit list or the literal "all"."""
    fps = max(MIN_TARGET_FPS, min(MAX_TARGET_FPS, payload.target_fps))

    query = db.query(Camera)
    if payload.camera_ids != "all":
        query = query.filter(Camera.id.in_(payload.camera_ids))
    cameras = query.all()

    for camera in cameras:
        camera.target_fps = fps
        process_manager.set_fps(camera.id, fps)

    db.commit()
    items = [CameraResponse.model_validate(c) for c in cameras]
    return PaginatedResponse(items=items, next_cursor=None)

@router.post("/cameras/{id}/retire", response_model=CameraResponse)
def retire_camera(id: str, payload: dict, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    camera.retired = True
    camera.retired_reason = payload.get("reason", "Retired by user request")
    camera.status = "DISABLED"
    camera.is_active = False
    
    db.commit()
    db.refresh(camera)
    return CameraResponse.model_validate(camera)

@router.post("/cameras/{id}/test-connection")
def test_connection(id: str, payload: dict):
    # Simulated connection test
    return {"ok": True, "snapshotUrl": "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?q=80&w=640"}

@router.post("/cameras/check-duplicate")
def check_duplicate(payload: dict, db: Session = Depends(get_db)):
    rtsp_url = payload.get("rtspUrl")
    dup = db.query(Camera).filter(Camera.rtsp_url == rtsp_url).first()
    if dup:
        return {"duplicate": True, "cameraId": dup.id}
    return {"duplicate": False}

# --- Zones ---
@router.get("/zones", response_model=PaginatedResponse)
def get_zones(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    items = [ZoneResponse.model_validate(z) for z in zones]
    return PaginatedResponse(items=items, next_cursor=None)

# --- Buildings ---
@router.get("/buildings", response_model=PaginatedResponse)
def get_buildings(db: Session = Depends(get_db)):
    # Standard dummy or database buildings mapping
    return PaginatedResponse(items=[], next_cursor=None)
