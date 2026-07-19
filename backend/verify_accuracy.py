# verify_accuracy.py
import os
import sys
import time
import math
import json
import torch
import cv2
from datetime import datetime
from loguru import logger
from ultralytics import YOLO

# Add parent directory to path so we can import from core/models
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.config import settings
from core.database import SessionLocal
from models.orm import Camera

def get_density_risk_label(risk_pct: float) -> str:
    if risk_pct >= 80.0:
        return "\033[91mCRITICAL\033[0m"
    elif risk_pct >= 55.0:
        return "\033[93mWARNING\033[0m"
    return "\033[92mNORMAL\033[0m"

def verify_camera_pipeline():
    logger.info("Initializing universal relationship graph intelligence system model accuracy & verification suite...")
    
    # 1. Load the model
    logger.info(f"Loading YOLO model {settings.YOLO_MODEL} on device '{settings.YOLO_DEVICE}'...")
    try:
        model = YOLO(settings.YOLO_MODEL)
    except Exception as e:
        logger.error(f"Failed to load YOLO model: {e}")
        return

    # 2. Get cameras from DB
    db = SessionLocal()
    cameras = db.query(Camera).filter(Camera.retired == False).all()
    if not cameras:
        logger.warning("No cameras found in the database. Run 'init_db' first to seed default cameras.")
        db.close()
        return

    logger.info(f"Found {len(cameras)} active cameras in database. Initiating performance and accuracy benchmarking...")

    report_data = {
        "benchmark_timestamp": datetime.utcnow().isoformat() + "Z",
        "device": settings.YOLO_DEVICE,
        "yolo_model": settings.YOLO_MODEL,
        "confidence_threshold": settings.YOLO_CONFIDENCE,
        "cameras": {}
    }

    print("\n" + "="*80)
    print("                      URG-IS MODEL ACCURACY VERIFICATION REPORT")
    print("="*80)
    print(f"Device: {settings.YOLO_DEVICE.upper()}  |  Model: {settings.YOLO_MODEL}  |  Confidence Threshold: {settings.YOLO_CONFIDENCE}")
    print("-"*80)

    for cam in cameras:
        # Check if local video file exists
        source_path = cam.rtsp_url
        if not os.path.exists(source_path):
            print(f"\nCamera '{cam.name}' ({cam.id}): Video asset not found at '{source_path}'. Skipping.")
            continue

        print(f"\nAnalyzing '{cam.name}' ({cam.id}) from source '{source_path}'...")
        print(f"  - Configured Density Threshold: {cam.density_threshold} people")
        
        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            print(f"  - \033[91mError: Cannot open video reader for {source_path}\033[0m")
            continue

        frame_count = 0
        processed_frames = 0
        total_inference_time = 0.0
        
        # Benchmarking lists
        headcounts = []
        confs = []
        track_ids_seen = set()
        risk_pcts = []
        
        # Max out benchmark at 150 frames to be fast but accurate
        max_benchmark_frames = 150
        
        start_time = time.time()
        
        while processed_frames < max_benchmark_frames:
            ret, frame = cap.read()
            if not ret:
                break
                
            frame_count += 1
            if frame_count % (settings.FRAME_SKIP + 1) != 0:
                continue
                
            # Resize frame to match production pipeline resolution (640x480)
            frame_resized = cv2.resize(frame, (640, 480))
            
            # Run YOLO Tracking
            t0 = time.time()
            results = model.track(
                frame_resized,
                conf=settings.YOLO_CONFIDENCE,
                classes=[0],
                tracker="botsort.yaml",
                persist=True,
                device=settings.YOLO_DEVICE,
                verbose=False
            )
            t_inf = (time.time() - t0) * 1000.0  # ms
            
            total_inference_time += t_inf
            processed_frames += 1
            
            # Extract statistics
            current_headcount = 0
            frame_bboxes = []
            if results and len(results) > 0:
                boxes_objs = results[0].boxes
                if boxes_objs is not None:
                    # Confidence scores
                    if boxes_objs.conf is not None:
                        frame_confs = boxes_objs.conf.cpu().numpy()
                        confs.extend([float(c) for c in frame_confs])
                    
                    # Track IDs
                    if boxes_objs.id is not None:
                        frame_track_ids = boxes_objs.id.cpu().numpy().astype(int)
                        current_headcount = len(frame_track_ids)
                        for tid in frame_track_ids:
                            track_ids_seen.add(int(tid))

                    # Bounding boxes for proximity check
                    if boxes_objs.xyxy is not None:
                        xyxy = boxes_objs.xyxy.cpu().numpy()
                        for box in xyxy:
                            x1, y1, x2, y2 = map(int, box)
                            frame_bboxes.append((x1, y1, x2 - x1, y2 - y1))
            
            headcounts.append(current_headcount)
            
            # Density Risk logic (matching production spatial proximity clustering)
            clustered_count = 0
            if current_headcount > 1 and len(frame_bboxes) == current_headcount:
                centers = []
                for bbox in frame_bboxes:
                    cx = bbox[0] + bbox[2] // 2
                    cy = bbox[1] + bbox[3]
                    centers.append((cx, cy))
                
                prox_threshold = 60.0
                has_close_neighbor = [False] * current_headcount
                for i in range(current_headcount):
                    for j in range(i + 1, current_headcount):
                        dist = math.sqrt((centers[i][0] - centers[j][0])**2 + (centers[i][1] - centers[j][1])**2)
                        if dist < prox_threshold:
                            has_close_neighbor[i] = True
                            has_close_neighbor[j] = True
                clustered_count = sum(1 for x in has_close_neighbor if x)
            
            clustering_ratio = (clustered_count / current_headcount) if current_headcount > 0 else 0.0
            volume_ratio = min(1.0, current_headcount / max(1, cam.density_threshold))
            
            risk_pct = round((0.4 * clustering_ratio + 0.6 * volume_ratio) * 100.0, 1)
            risk_pcts.append(risk_pct)
            
            if processed_frames % 30 == 0:
                print(f"    Processed {processed_frames}/{max_benchmark_frames} frames...")

        cap.release()
        total_time = time.time() - start_time
        
        if processed_frames == 0:
            print("  - No frames processed.")
            continue
            
        # 3. Calculate Performance Metrics
        avg_latency = total_inference_time / processed_frames
        fps = processed_frames / total_time
        
        # 4. Calculate Accuracy & Occupancy Metrics
        avg_headcount = sum(headcounts) / len(headcounts)
        max_headcount = max(headcounts)
        min_headcount = min(headcounts)
        
        # Headcount Variance (Crowd Volatility)
        variance = sum((x - avg_headcount) ** 2 for x in headcounts) / len(headcounts)
        std_dev = math.sqrt(variance)
        
        # YOLO Confidence Quality
        avg_conf = sum(confs) / len(confs) if confs else 0.0
        
        # Tracker Stability Metric (Unique Track IDs vs Average Headcount)
        # Ratio of unique track IDs to avg headcount. Higher ratio = more ID switches/drift (worse tracking).
        # A ratio close to 1 indicates a highly stable track history.
        tracker_stability_ratio = len(track_ids_seen) / max(1.0, avg_headcount)
        
        # Density Risk Distribution
        normal_frames = sum(1 for r in risk_pcts if r < 55.0)
        warning_frames = sum(1 for r in risk_pcts if 55.0 <= r < 80.0)
        critical_frames = sum(1 for r in risk_pcts if r >= 80.0)
        
        normal_pct = (normal_frames / processed_frames) * 100.0
        warning_pct = (warning_frames / processed_frames) * 100.0
        critical_pct = (critical_frames / processed_frames) * 100.0
        
        avg_risk = sum(risk_pcts) / len(risk_pcts)

        # Print detailed report for this camera
        print(f"\n  [ BENCHMARK RESULTS FOR {cam.name.upper()} ]")
        print(f"  +-----------------------------------+-----------------------------------+")
        print(f"  | PERFORMANCE METRICS               | OCCUPANCY & TRACKING ACCURACY     |")
        print(f"  +-----------------------------------+-----------------------------------+")
        print(f"  | Average Inference Latency: {avg_latency:6.1f} ms | Avg/Min/Max Headcount: {avg_headcount:4.1f}/{min_headcount:2d}/{max_headcount:2d} |")
        print(f"  | Overall processing speed: {fps:6.1f} FPS| Volatility (StdDev):    {std_dev:6.2f}    |")
        print(f"  | Total frames processed:   {processed_frames:6d}  | Average YOLO Confidence: {avg_conf * 100.0:4.1f}%   |")
        print(f"  | Total unique tracks seen: {len(track_ids_seen):6d}  | Tracker Drift Ratio:    {tracker_stability_ratio:6.2f}    |")
        print(f"  +-----------------------------------+-----------------------------------+")
        print(f"  | DENSITY RISK ANALYSIS             | CROWD DISTRIBUTION RATIOS         |")
        print(f"  +-----------------------------------+-----------------------------------+")
        print(f"  | Average Density Risk:     {avg_risk:5.1f}%   | Normal Density (<55%):  {normal_pct:5.1f}%   |")
        print(f"  | Average Risk Level:      {get_density_risk_label(avg_risk):16s} | Warning Density (55-80%): {warning_pct:4.1f}%   |")
        print(f"  | Alert threshold breaches: {critical_frames:5d}  | Critical Density (>=80%): {critical_pct:4.1f}%  |")
        print(f"  +-----------------------------------+-----------------------------------+")

        # Save stats
        report_data["cameras"][cam.id] = {
            "camera_name": cam.name,
            "density_threshold": cam.density_threshold,
            "processed_frames": processed_frames,
            "performance": {
                "avg_inference_latency_ms": round(avg_latency, 2),
                "avg_processing_fps": round(fps, 2)
            },
            "occupancy": {
                "avg_headcount": round(avg_headcount, 2),
                "min_headcount": min_headcount,
                "max_headcount": max_headcount,
                "std_dev_headcount": round(std_dev, 2)
            },
            "accuracy": {
                "avg_yolo_confidence": round(avg_conf, 4),
                "total_unique_track_ids": len(track_ids_seen),
                "tracker_drift_ratio": round(tracker_stability_ratio, 2)
            },
            "density": {
                "avg_risk_pct": round(avg_risk, 2),
                "normal_ratio": round(normal_pct / 100.0, 4),
                "warning_ratio": round(warning_pct / 100.0, 4),
                "critical_ratio": round(critical_pct / 100.0, 4)
            }
        }

    # Save to file
    report_path = "data/model_verification_report.json"
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report_data, f, indent=4)
        
    print("\n" + "="*80)
    print(f"Detailed verification report saved successfully to '{report_path}'.")
    print("="*80 + "\n")
    
    db.close()

if __name__ == "__main__":
    verify_camera_pipeline()
