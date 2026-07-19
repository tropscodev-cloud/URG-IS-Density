# utils/auto_calib.py
import os
import sys
import json
import glob
from pathlib import Path
import cv2
import numpy as np
from ultralytics import YOLO

os.makedirs("data/calib", exist_ok=True)

AVERAGE_PERSON_HEIGHT_M = 1.70
MIN_PERSON_HEIGHT_PX = 40
MAX_PERSON_HEIGHT_PX = 1200
FALLBACK_PIXELS_PER_M = 100.0

def estimate_pixels_per_metre(video_path: str, camera_id: str,
                              n_frames: int = 150,
                              min_detections: int = 8,
                              verbose: bool = True) -> float:
    """Estimates pixel scale by measuring median height of human bounding boxes."""
    if verbose:
        print(f"  [{camera_id}] Auto-calibrating pixel scale from {video_path}...")

    # Dynamic model path load from env
    model_path = os.getenv("YOLO_MODEL", "yolov8s.pt")
    yolo_conf = float(os.getenv("YOLO_CONFIDENCE", "0.25"))

    try:
        model = YOLO(model_path)
    except Exception as e:
        print(f"  [{camera_id}] Error loading YOLO model: {e}")
        return FALLBACK_PIXELS_PER_M

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  [{camera_id}] ERROR: Cannot open video file {video_path}")
        return FALLBACK_PIXELS_PER_M

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    skip = max(1, total // n_frames)
    heights: list[float] = []
    frame_idx = 0

    while frame_idx < n_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx * skip)
        ret, frame = cap.read()
        if not ret:
            break
        results = model(frame, classes=[0], conf=yolo_conf, verbose=False)
        for box in results[0].boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            h = y2 - y1
            if MIN_PERSON_HEIGHT_PX <= h <= MAX_PERSON_HEIGHT_PX:
                heights.append(h)
        frame_idx += 1

    cap.release()

    if len(heights) < min_detections:
        if verbose:
            print(f"  [{camera_id}] Only {len(heights)} detections — using fallback {FALLBACK_PIXELS_PER_M}")
        return FALLBACK_PIXELS_PER_M

    median_h = float(np.median(heights))
    pixels_per_m = round(median_h / AVERAGE_PERSON_HEIGHT_M, 1)

    if verbose:
        print(f"  [{camera_id}] {len(heights)} detections | "
              f"median height = {median_h:.1f}px | "
              f"PIXELS_PER_METRE = {pixels_per_m}")

    # Save scale data JSON
    with open(f"data/calib/{camera_id}_auto.json", "w") as f:
        json.dump({
            "camera_id": camera_id,
            "detections": len(heights),
            "median_height_px": median_h,
            "pixels_per_metre": pixels_per_m
        }, f, indent=2)
        
    return pixels_per_m

def write_to_env(results: dict):
    """Writes auto-calibrated values back to .env file."""
    env_path = ".env"
    existing = open(env_path).readlines() if os.path.exists(env_path) else []
    new_keys = {f"PIXELS_PER_METRE_{c.upper()}": v for c, v in results.items()}
    kept = [l for l in existing if not any(l.startswith(k) for k in new_keys)]
    
    with open(env_path, "w") as f:
        f.writelines(kept)
        if kept and not kept[-1].endswith("\n"):
            f.write("\n")
        f.write("\n# Auto-calibrated pixel scales (written by auto_calib.py)\n")
        for k, v in sorted(new_keys.items()):
            f.write(f"{k}={v}\n")

def calibrate_all(source: str = "data/", verbose: bool = True) -> dict:
    if os.path.isfile(source):
        videos = [(source, Path(source).stem)]
    elif os.path.isdir(source):
        videos = [(f, Path(f).stem) for f in sorted(glob.glob(os.path.join(source, "*.mp4")))]
    else:
        return {}

    if not videos:
        print(f"  No .mp4 files found in {source}")
        return {}

    results = {}
    for path, cam_id in videos:
        val = estimate_pixels_per_metre(
            path, cam_id,
            n_frames=80,
            min_detections=5,
            verbose=verbose
        )
        results[cam_id] = val

    write_to_env(results)
    return results

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "data/"
    results = calibrate_all(src, verbose=True)
    if results:
        print(f"\nDone. {len(results)} camera(s) calibrated.")
    else:
        print("Calibration failed — check your video files.")
