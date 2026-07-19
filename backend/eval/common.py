# backend/eval/common.py
"""
Shared helpers for the URG-IS evaluation harness.

Every eval script loads YOLO exactly the way the production pipeline does
(workers/vision_pipeline.py) so the numbers you get here are the numbers your
software actually ships: same model, same confidence, same input resolution,
same tracker, same class filter. Do not "tune for the benchmark" — if you change
a setting here to make a score look better, change it in core/config.py too, or
the report is lying to you.
"""
import os
import sys
import json
import time
from datetime import datetime, timezone

# Make `core`, `models`, `workers` importable when running from backend/eval/
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.append(BACKEND_ROOT)

from core.config import settings  # noqa: E402

# Production-parity constants (mirrors workers/vision_pipeline.py). If these drift
# from the worker, the eval stops representing production — keep them in sync.
PROC_WIDTH = 640
PROC_HEIGHT = 480
YOLO_CLASSES = [0]            # person only
TRACKER_CFG = "botsort.yaml"  # same tracker as production

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)


def load_model():
    """Load the exact production model/device. Fails loudly if deps are missing."""
    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise SystemExit(
            "ultralytics is not installed. Run:\n"
            "  pip install -r backend/eval/requirements-eval.txt\n"
            f"(original error: {e})"
        )
    model = YOLO(settings.YOLO_MODEL)
    try:
        model.to(settings.YOLO_DEVICE)
    except Exception:
        pass
    return model


def env_banner():
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "yolo_model": settings.YOLO_MODEL,
        "yolo_confidence": settings.YOLO_CONFIDENCE,
        "device": settings.YOLO_DEVICE,
        "frame_skip": settings.FRAME_SKIP,
        "proc_resolution": f"{PROC_WIDTH}x{PROC_HEIGHT}",
        "tracker": TRACKER_CFG,
        "classes": YOLO_CLASSES,
    }


def save_result(name: str, data: dict):
    """Write one eval's JSON under results/ for gen_report.py to pick up."""
    data = {"_env": env_banner(), **data}
    path = os.path.join(RESULTS_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\n[saved] {path}")
    return path


class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = (time.perf_counter() - self.t0) * 1000.0
