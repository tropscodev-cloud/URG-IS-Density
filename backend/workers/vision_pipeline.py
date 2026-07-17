# workers/vision_pipeline.py
import os
import sys
import time
import math
import numpy as np
import cv2
from loguru import logger
from typing import Optional, List, Dict, Tuple

# Add backend root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.config import settings
from core.database import SessionLocal
from models.orm import CameraHistory
from ultralytics import YOLO

def project_to_gps(
    cx: float, cy: float, 
    H_matrix: Optional[np.ndarray], 
    cam_lat: float, cam_lng: float, 
    cam_bearing: float, 
    camera_id: str
) -> Dict[str, float]:
    """
    Projects pixel bottom-center to Ground Plane offset meters, 
    rotates by camera bearing, and translates to GPS coordinates.
    """
    if H_matrix is not None:
        try:
            p = np.array([[[cx, cy]]], dtype=np.float32)
            warped = cv2.perspectiveTransform(p, H_matrix)[0][0]
            x_m, y_m = float(warped[0]), float(warped[1])
        except Exception as e:
            logger.error(f"[{camera_id}] Error in perspective transform: {e}")
            x_m, y_m = 0.0, 0.0
    else:
        # Fallback to auto-calibrated scale or default
        pixels_per_m = float(os.getenv(f"PIXELS_PER_METRE_{camera_id.upper()}", "100.0"))
        # Assume camera is at bottom center (320, 480) looking forward
        x_m = (cx - 320.0) / pixels_per_m
        y_m = (480.0 - cy) / pixels_per_m

    # Earth Radius in meters
    R = 6378137.0
    bearing_rad = math.radians(cam_bearing)
    
    # Rotate offset based on camera orientation
    # Local x_m is horizontal deviation, y_m is depth forward
    world_x = x_m * math.cos(bearing_rad) + y_m * math.sin(bearing_rad)
    world_y = -x_m * math.sin(bearing_rad) + y_m * math.cos(bearing_rad)
    
    d_lat = world_y / R
    d_lng = world_x / (R * math.cos(math.radians(cam_lat)))
    
    lat = cam_lat + math.degrees(d_lat)
    lng = cam_lng + math.degrees(d_lng)
    
    return {"x": round(lng, 6), "y": round(lat, 6)}

def run_pipeline(
    camera_id: str, 
    rtsp_url: str, 
    latitude: float, 
    longitude: float, 
    bearing: float, 
    density_threshold: int, 
    homography_matrix: Optional[list], 
    output_queue
):
    logger.info(f"[{camera_id}] Spawned worker process. Source: {rtsp_url}")
    
    # Session for 5-minute headcount writes
    db = SessionLocal()
    
    # Parse homography matrix
    H = None
    if homography_matrix:
        try:
            H = np.array(homography_matrix, dtype=np.float32)
            if H.shape != (3, 3):
                H = None
        except Exception as e:
            logger.error(f"[{camera_id}] Error loading homography matrix: {e}")

    # Load YOLO Model
    try:
        model = YOLO(settings.YOLO_MODEL)
        model.to(settings.YOLO_DEVICE)
        logger.success(f"[{camera_id}] Loaded model {settings.YOLO_MODEL} on {settings.YOLO_DEVICE}")
    except Exception as e:
        logger.critical(f"[{camera_id}] Failed to load model: {e}")
        db.close()
        return

    # Open Video Source
    try:
        source = int(rtsp_url)
    except ValueError:
        source = rtsp_url

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        logger.critical(f"[{camera_id}] Video source read failure: {rtsp_url}")
        db.close()
        return

    frame_count = 0
    seq = 0
    last_db_write = time.time()
    
    # State tracking variables for advanced metrics (Flow Rate & Movement Rate)
    # track_history: track_id -> list of (timestamp, coords)
    track_history: Dict[int, List[Tuple[float, Tuple[int, int]]]] = {}
    new_tracks_last_minute: Dict[int, float] = {}  # track_id -> timestamp

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # If local file, loop it for demo purposes
                if isinstance(source, str) and source.endswith(".mp4"):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                else:
                    logger.warning(f"[{camera_id}] Stream disconnected. Reconnecting in 3s...")
                    time.sleep(3)
                    cap = cv2.VideoCapture(source)
                    continue
            
            frame_count += 1
            if frame_count % (settings.FRAME_SKIP + 1) != 0:
                continue
                
            frame_resized = cv2.resize(frame, (640, 480))
            
            # YOLO tracking
            results = model.track(
                frame_resized,
                conf=settings.YOLO_CONFIDENCE,
                classes=[0],
                tracker="botsort.yaml",
                persist=True,
                device=settings.YOLO_DEVICE,
                verbose=False
            )
            
            headcount = 0
            entities = []
            now_ts = time.time()
            
            moving_count = 0
            static_count = 0
            
            if results and len(results) > 0:
                boxes_objs = results[0].boxes
                if boxes_objs is not None and boxes_objs.id is not None:
                    boxes = boxes_objs.xyxy.cpu().numpy()
                    track_ids = boxes_objs.id.cpu().numpy().astype(int)
                    confs = boxes_objs.conf.cpu().numpy()
                    
                    headcount = len(track_ids)
                    
                    for box, track_id, conf in zip(boxes, track_ids, confs):
                        x1, y1, x2, y2 = map(int, box)
                        w = x2 - x1
                        h = y2 - y1
                        
                        # Project bottom center (cx, cy)
                        cx = x1 + w // 2
                        cy = y2
                        
                        # Compute real-world GPS coordinate
                        coord = project_to_gps(
                            cx, cy, H, 
                            latitude, longitude, bearing, 
                            camera_id
                        )
                        
                        entities.append({
                            "id": f"TRACK_{track_id}",
                            "coordinates": coord,
                            "bbox": [x1, y1, w, h]
                        })
                        
                        # Track movement rate logic
                        center = (cx, cy)
                        if track_id not in track_history:
                            track_history[track_id] = []
                            new_tracks_last_minute[track_id] = now_ts
                            
                        track_history[track_id].append((now_ts, center))
                        
                        # Prune older history
                        track_history[track_id] = [pt for pt in track_history[track_id] if now_ts - pt[0] <= 3.0]
                        
                        # Calculate movement velocity in pixels
                        if len(track_history[track_id]) > 1:
                            start_pt = track_history[track_id][0][1]
                            end_pt = track_history[track_id][-1][1]
                            dist = math.sqrt((end_pt[0] - start_pt[0])**2 + (end_pt[1] - start_pt[1])**2)
                            
                            # Threshold of 15px travel over 3s defines movement
                            if dist > 15:
                                moving_count += 1
                            else:
                                static_count += 1
                        else:
                            static_count += 1
            
            # Prune stale tracks from history
            stale_ids = [tid for tid in track_history if now_ts - track_history[tid][-1][0] > 5.0]
            for tid in stale_ids:
                track_history.pop(tid, None)
                
            # Prune flow rate counter (keeps tracks seen in the last 60 seconds)
            new_tracks_last_minute = {tid: t for tid, t in new_tracks_last_minute.items() if now_ts - t <= 60.0}
            flow_rate = len(new_tracks_last_minute)  # people passing per minute
            
            # Movement percentages
            total_calc = moving_count + static_count
            moving_pct = round((moving_count / total_calc) * 100.0, 1) if total_calc > 0 else 0.0
            static_pct = round(100.0 - moving_pct, 1) if total_calc > 0 else 100.0
            
            # Density risk calculation
            # Risk is a combination of headcount vs threshold (0% to 100% risk rating)
            risk_pct = round(min(100.0, (headcount / max(1, density_threshold)) * 100.0), 1)
            
            seq += 1
            payload = {
                "camera_id": camera_id,
                "seq": seq,
                "server_time": int(now_ts * 1000),
                "metrics": {
                    "headcount": headcount,
                    "flow_rate": flow_rate,
                    "moving_percentage": moving_pct,
                    "static_percentage": static_pct,
                    "risk_percentage": risk_pct,
                    "alert": headcount >= density_threshold
                },
                "entities": entities
            }
            
            # Push payload to manager queue (non-blocking)
            try:
                output_queue.put_nowait(payload)
            except Exception:
                pass
                
            # Write 5-minute headcount logs
            if now_ts - last_db_write >= 300:
                try:
                    history = CameraHistory(
                        camera_id=camera_id,
                        headcount=headcount
                    )
                    db.add(history)
                    db.commit()
                    last_db_write = now_ts
                    logger.info(f"[{camera_id}] Recorded 5-min headcount history: {headcount}")
                except Exception as e:
                    db.rollback()
                    logger.error(f"[{camera_id}] Failed to write history record: {e}")
                    
    except KeyboardInterrupt:
        logger.info(f"[{camera_id}] Process interrupted.")
    except Exception as e:
        logger.error(f"[{camera_id}] Process crash: {e}")
    finally:
        cap.release()
        db.close()
        logger.info(f"[{camera_id}] Process resource cleanup finished.")
