# backend/eval/eval_latency.py
"""
Latency / throughput — the real production gate.

Your dashboard is only "live" if inference keeps up with the cameras. This runs
the exact production inference path over any video source and reports the
distribution of per-frame latency (p50/p95/p99, not just the mean your existing
verify_accuracy.py prints — means hide the tail that causes visible stutter),
plus how many concurrent cameras one worker host can sustain.

Runs on your own camera clips by default (data/cam1.mp4 ...), so it needs no
external dataset — but you can point it at any MOT sequence video or RTSP url.

Usage:
    python backend/eval/eval_latency.py                       # uses data/cam*.mp4
    python backend/eval/eval_latency.py --source data/cam1.mp4 --frames 300
    python backend/eval/eval_latency.py --source rtsp://... --frames 500 --track
"""
import argparse
import glob
import os
import statistics as st

import cv2

from common import (
    load_model, save_result, settings,
    PROC_WIDTH, PROC_HEIGHT, YOLO_CLASSES, TRACKER_CFG, Timer, BACKEND_ROOT,
)


def bench_source(model, source: str, frames: int, use_track: bool):
    cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not cap.isOpened():
        return {"source": source, "error": "could not open source"}
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    lat = []
    heads = []
    processed = 0
    frame_i = 0
    while processed < frames:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop short clips
            ret, frame = cap.read()
            if not ret:
                break
        frame_i += 1
        if frame_i % (settings.FRAME_SKIP + 1) != 0:  # production sampling
            continue
        frame = cv2.resize(frame, (PROC_WIDTH, PROC_HEIGHT))
        with Timer() as t:
            if use_track:
                res = model.track(frame, conf=settings.YOLO_CONFIDENCE, classes=YOLO_CLASSES,
                                  tracker=TRACKER_CFG, persist=True,
                                  device=settings.YOLO_DEVICE, verbose=False)
            else:
                res = model.predict(frame, conf=settings.YOLO_CONFIDENCE, classes=YOLO_CLASSES,
                                    imgsz=PROC_WIDTH, device=settings.YOLO_DEVICE, verbose=False)
        lat.append(t.ms)
        heads.append(int(len(res[0].boxes)) if res and res[0].boxes is not None else 0)
        processed += 1
    cap.release()

    if not lat:
        return {"source": source, "error": "no frames processed"}

    lat.sort()
    p = lambda q: round(lat[min(len(lat) - 1, int(q * len(lat)))], 2)
    mean_ms = st.mean(lat)
    proc_fps = 1000.0 / mean_ms
    # how many cameras one host sustains: each camera needs src_fps/(FRAME_SKIP+1) infers/sec
    per_cam_load = src_fps / (settings.FRAME_SKIP + 1)
    sustainable = proc_fps / per_cam_load if per_cam_load else 0
    return {
        "source": os.path.basename(source),
        "frames_processed": processed,
        "latency_ms": {"mean": round(mean_ms, 2), "p50": p(0.50), "p95": p(0.95),
                       "p99": p(0.99), "max": round(lat[-1], 2)},
        "throughput_fps": round(proc_fps, 2),
        "source_fps": round(src_fps, 2),
        "required_infer_per_cam": round(per_cam_load, 2),
        "sustainable_cameras_per_host": round(sustainable, 2),
        "mean_headcount": round(st.mean(heads), 2),
        "mode": "track" if use_track else "detect",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=None, help="video/rtsp; default = all data/cam*.mp4")
    ap.add_argument("--frames", type=int, default=200)
    ap.add_argument("--track", action="store_true", help="benchmark full track() path (slower, realistic)")
    args = ap.parse_args()

    model = load_model()
    sources = ([args.source] if args.source
               else sorted(glob.glob(os.path.join(BACKEND_ROOT, "data", "cam[0-9].mp4"))))
    if not sources:
        raise SystemExit("no sources; pass --source")

    results = [bench_source(model, s, args.frames, args.track) for s in sources]
    good = [r for r in results if "throughput_fps" in r]
    agg = {}
    if good:
        agg = {
            "worst_p99_ms": max(r["latency_ms"]["p99"] for r in good),
            "min_throughput_fps": min(r["throughput_fps"] for r in good),
            "min_sustainable_cameras_per_host": round(min(r["sustainable_cameras_per_host"] for r in good), 2),
            "note": "sustainable_cameras assumes one shared host; production target is 100+ cameras "
                    "-> compare against your planned worker/GPU fleet size.",
        }
    save_result("eval_latency", {"per_source": results, "aggregate": agg})
    print("\nLATENCY SUMMARY:", agg or "no successful runs")


if __name__ == "__main__":
    main()
