# api/routes/history.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from core.database import get_db
from models.orm import CameraHistory, Camera
from datetime import datetime

router = APIRouter()

@router.get("/camera/{id}/history")
def get_camera_history(id: str, limit: int = 100, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    records = db.query(CameraHistory)\
        .filter(CameraHistory.camera_id == id)\
        .order_by(CameraHistory.timestamp.asc())\
        .limit(limit)\
        .all()
        
    return [
        {
            "timestamp": int(r.timestamp.timestamp() * 1000),  # epoch ms for sparklines
            "headcount": r.headcount
        } for r in records
    ]

@router.get("/history/state")
def get_history_state(at: float = Query(..., description="Timestamp in epoch seconds or ms"), db: Session = Depends(get_db)):
    # Convert milliseconds to seconds if needed
    if at > 1e11:
        at = at / 1000.0
    dt = datetime.fromtimestamp(at)
    
    # Subquery to retrieve latest timestamp per camera on or before dt
    subq = db.query(
        CameraHistory.camera_id,
        func.max(CameraHistory.timestamp).label("max_ts")
    ).filter(CameraHistory.timestamp <= dt)\
     .group_by(CameraHistory.camera_id).subquery()
     
    records = db.query(CameraHistory)\
        .join(subq, (CameraHistory.camera_id == subq.c.camera_id) & (CameraHistory.timestamp == subq.c.max_ts))\
        .all()
        
    return {
        r.camera_id: {
            "timestamp": int(r.timestamp.timestamp() * 1000),
            "headcount": r.headcount
        } for r in records
    }
