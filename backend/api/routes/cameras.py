# api/routes/cameras.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from models.orm import Camera
from models.domain import CameraResponse, CameraCreate
from typing import List

router = APIRouter()

@router.get("/cameras", response_model=List[CameraResponse])
def get_cameras(db: Session = Depends(get_db)):
    return db.query(Camera).all()

@router.get("/camera/{id}", response_model=CameraResponse)
def get_camera(id: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera

@router.post("/cameras", response_model=CameraResponse)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == payload.id).first()
    if camera:
        raise HTTPException(status_code=400, detail="Camera ID already exists")
    db_camera = Camera(**payload.model_dump())
    db.add(db_camera)
    db.commit()
    db.refresh(db_camera)
    return db_camera

# Backward compatibility / singular routes
@router.post("/camera", response_model=CameraResponse)
def create_camera_singular(payload: CameraCreate, db: Session = Depends(get_db)):
    return create_camera(payload, db)
