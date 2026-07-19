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

# Px/video-second of bbox-center travel above which a tracked person counts as "moving" rather
# than "static". Tuned loosely against 640x480 processing frames — well above typical detection
# jitter for a standing person, well below normal walking pace crossing the frame.
MOVEMENT_VELOCITY_THRESHOLD_PX_S = 30.0

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

DEFAULT_TARGET_FPS = 20
MIN_TARGET_FPS = 1
MAX_TARGET_FPS = 30

def run_pipeline(
    camera_id: str,
    rtsp_url: str,
    latitude: float,
    longitude: float,
    bearing: float,
    density_threshold: int,
    homography_matrix: Optional[list],
    output_queue,
    fps_config=None,
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

    # Source fps — needed to convert a frame position into a video-content timestamp. CPU YOLO
    # inference is far slower than the source framerate, so consecutive *processed* frames can be
    # seconds apart in wall-clock time while representing only a few frames' worth of new video
    # content; movement/velocity below is computed against this video-time basis, not time.time(),
    # or a slow-motion clip would read as "nobody is moving" even when everyone visibly is.
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    if not source_fps or source_fps <= 0:
        source_fps = 30.0

    frame_count = 0
    seq = 0
    last_db_write = time.time()
    last_video_time_s = 0.0

    # State tracking variables for advanced metrics (Flow Rate & Movement Rate)
    # track_history: track_id -> list of (video_time_s, coords) — video_time_s, not wall-clock, see
    # source_fps comment above.
    track_history: Dict[int, List[Tuple[float, Tuple[int, int]]]] = {}
    new_tracks_last_minute: Dict[int, float] = {}  # track_id -> wall-clock timestamp (flow rate is
    # deliberately a real-time "people seen in the last real minute" rate, not video-time based)

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

            # Re-read every raw frame (cheap dict lookup vs. the inference below) so a live fps
            # change — see workers/manager.py's set_fps() — takes effect on the very next frame
            # instead of requiring a worker restart.
            if fps_config is not None:
                target_fps = fps_config.get(camera_id, DEFAULT_TARGET_FPS)
            else:
                target_fps = DEFAULT_TARGET_FPS
            target_fps = max(MIN_TARGET_FPS, min(MAX_TARGET_FPS, target_fps))
            frame_skip = max(0, round(source_fps / target_fps) - 1)
            # What sampling rate frame_skip actually realizes, given integer rounding — this, not
            # the requested target_fps, is what gets reported back to the client as "effective".
            effective_fps = round(source_fps / (frame_skip + 1), 2)

            if frame_count % (frame_skip + 1) != 0:
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

            # Actual position within the source file (cv2.CAP_PROP_POS_FRAMES), not our own
            # frame_count — that one never resets on the demo-loop seek back to frame 0, this one
            # does, which is exactly what a frontend needs to seek its own <video> element to match.
            video_pos_frames = cap.get(cv2.CAP_PROP_POS_FRAMES)
            video_time_s = (video_pos_frames / source_fps) if source_fps > 0 else 0.0
            if video_time_s < last_video_time_s:
                # The demo loop just seeked back to frame 0 — track associations spanning that
                # boundary are meaningless (and would otherwise produce a huge negative dt).
                track_history.clear()
            last_video_time_s = video_time_s

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
                            "bbox": [x1, y1, w, h],
                            "confidence": float(conf)
                        })
                        
                        # Track movement rate logic — keyed on video_time_s (see source_fps comment
                        # above), not wall-clock time, so inference latency doesn't distort velocity.
                        center = (cx, cy)
                        if track_id not in track_history:
                            track_history[track_id] = []
                            new_tracks_last_minute[track_id] = now_ts

                        track_history[track_id].append((video_time_s, center))

                        # Prune older history — 1.5s of *video* content is enough real-world motion
                        # to judge walking vs. standing without going so wide that a track ramps up
                        # its classification too slowly after first appearing.
                        track_history[track_id] = [pt for pt in track_history[track_id] if video_time_s - pt[0] <= 1.5]

                        # Classify by velocity (px per video-second), not a fixed distance over a
                        # fixed window: since consecutive *processed* frames can be as little as one
                        # FRAME_SKIP+1 apart in video time, a fixed-distance/fixed-window check
                        # under-detects movement whenever inference is slow relative to source fps.
                        start_ts, start_pt = track_history[track_id][0]
                        end_ts, end_pt = track_history[track_id][-1]
                        dt = end_ts - start_ts
                        # Require a minimum video-time span before classifying — at very small dt,
                        # ordinary detection-box jitter (a few px) translates into a huge apparent
                        # velocity and would otherwise flag stationary people as moving.
                        if dt >= 0.15:
                            dist = math.sqrt((end_pt[0] - start_pt[0]) ** 2 + (end_pt[1] - start_pt[1]) ** 2)
                            velocity_px_per_s = dist / dt
                            if velocity_px_per_s > MOVEMENT_VELOCITY_THRESHOLD_PX_S:
                                moving_count += 1
                            else:
                                static_count += 1
                        else:
                            static_count += 1
            
            # Prune stale tracks from history (video_time_s basis — see above; a wall-clock
            # comparison against a video-time value would prune everything on the very first frame).
            stale_ids = [tid for tid in track_history if video_time_s - track_history[tid][-1][0] > 2.5]
            for tid in stale_ids:
                track_history.pop(tid, None)
                
            # Prune flow rate counter (keeps tracks seen in the last 60 seconds)
            new_tracks_last_minute = {tid: t for tid, t in new_tracks_last_minute.items() if now_ts - t <= 60.0}
            flow_rate = len(new_tracks_last_minute)  # people passing per minute
            
            # Movement percentages
            total_calc = moving_count + static_count
            moving_pct = round((moving_count / total_calc) * 100.0, 1) if total_calc > 0 else 0.0
            static_pct = round(100.0 - moving_pct, 1) if total_calc > 0 else 100.0
            
            # Advanced Proximity Clustering Calculation (DBSCAN-style density index)
            clustered_count = 0
            if headcount > 1:
                centers = []
                for ent in entities:
                    bx = ent["bbox"]
                    cx = bx[0] + bx[2] // 2
                    cy = bx[1] + bx[3]
                    centers.append((cx, cy))
                
                # Proximity distance threshold: 60 pixels (approx. 1.2 meters in scaled frame)
                prox_threshold = 60.0
                has_close_neighbor = [False] * headcount
                for i in range(headcount):
                    for j in range(i + 1, headcount):
                        dist = math.sqrt((centers[i][0] - centers[j][0])**2 + (centers[i][1] - centers[j][1])**2)
                        if dist < prox_threshold:
                            has_close_neighbor[i] = True
                            has_close_neighbor[j] = True
                
                clustered_count = sum(1 for x in has_close_neighbor if x)
            
            clustering_ratio = (clustered_count / headcount) if headcount > 0 else 0.0
            volume_ratio = min(1.0, headcount / max(1, density_threshold))
            
            # Combined Density Risk: 40% spatial proximity clustering + 60% headcount capacity ratio
            risk_pct = round((0.4 * clustering_ratio + 0.6 * volume_ratio) * 100.0, 1)
            
            seq += 1
            payload = {
                "camera_id": camera_id,
                "seq": seq,
                "server_time": int(now_ts * 1000),
                "video_time_s": round(video_time_s, 3),
                "effective_fps": effective_fps,
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
