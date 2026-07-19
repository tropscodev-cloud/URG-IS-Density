# backend/eval/eval_tracking.py
"""
Multi-object tracking accuracy on MOT-format sequences (MOT20 recommended — it's
crowded, fixed-camera CCTV, the closest public match to your deployment).

Runs YOLO + BoTSORT exactly as production does (model.track, persist=True,
botsort.yaml, class 0), writes results in MOTChallenge format, and scores them
against gt/gt.txt with the `motmetrics` library.

Metrics that matter for your product:
  - MOTA      overall accuracy (FP + misses + ID switches)
  - IDF1      identity preservation — directly drives whether your FLOW RATE and
              "moving vs static" numbers are trustworthy, since both depend on
              stable track IDs. Your self-test showed a drift ratio of ~3x
              (52 IDs for ~18 people); IDF1/IDsw quantify that against truth.
  - IDsw      raw count of identity switches
  - MOTP      localization precision of matched boxes

Expected MOT20 layout:
    MOT20/train/MOT20-01/
        img1/000001.jpg ...
        gt/gt.txt              # frame,id,x,y,w,h,conf,class,vis
        seqinfo.ini

Usage:
    python backend/eval/eval_tracking.py --seq /data/MOT20/train/MOT20-01
    python backend/eval/eval_tracking.py --seq /data/MOT20/train/MOT20-03 --max-frames 300
"""
import argparse
import configparser
import glob
import os

import cv2

from common import (
    load_model, save_result, settings,
    PROC_WIDTH, PROC_HEIGHT, YOLO_CLASSES, TRACKER_CFG,
)


def read_seqinfo(seq_dir: str):
    ini = os.path.join(seq_dir, "seqinfo.ini")
    w = h = None
    if os.path.exists(ini):
        cfg = configparser.ConfigParser()
        cfg.read(ini)
        if cfg.has_section("Sequence"):
            w = cfg["Sequence"].getint("imWidth", fallback=None)
            h = cfg["Sequence"].getint("imHeight", fallback=None)
    return w, h


def run_tracker(seq_dir: str, max_frames: int | None):
    """Produce MOT-format predictions, rescaled back to original image coords."""
    model = load_model()
    img_dir = os.path.join(seq_dir, "img1")
    frames = sorted(glob.glob(os.path.join(img_dir, "*.jpg")))
    if max_frames:
        frames = frames[:max_frames]
    if not frames:
        raise SystemExit(f"no frames in {img_dir}")

    orig = cv2.imread(frames[0])
    oh, ow = orig.shape[:2]
    sx, sy = ow / PROC_WIDTH, oh / PROC_HEIGHT  # rescale proc-space boxes to GT space

    lines = []
    for idx, fp in enumerate(frames, start=1):
        frame = cv2.imread(fp)
        if frame is None:
            continue
        frame = cv2.resize(frame, (PROC_WIDTH, PROC_HEIGHT))
        res = model.track(
            frame, conf=settings.YOLO_CONFIDENCE, classes=YOLO_CLASSES,
            tracker=TRACKER_CFG, persist=True, device=settings.YOLO_DEVICE,
            verbose=False,
        )
        b = res[0].boxes if res else None
        if b is None or b.id is None:
            continue
        xyxy = b.xyxy.cpu().numpy()
        ids = b.id.cpu().numpy().astype(int)
        for (x1, y1, x2, y2), tid in zip(xyxy, ids):
            X, Y, W, H = x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy
            lines.append(f"{idx},{tid},{X:.2f},{Y:.2f},{W:.2f},{H:.2f},1,-1,-1,-1")

    pred_path = os.path.join(seq_dir, "urgis_pred.txt")
    with open(pred_path, "w") as f:
        f.write("\n".join(lines))
    return pred_path, len(frames)


def score(seq_dir: str, pred_path: str):
    try:
        import motmetrics as mm
        import numpy as np
    except ImportError:
        raise SystemExit("pip install motmetrics numpy")

    gt_path = os.path.join(seq_dir, "gt", "gt.txt")
    if not os.path.exists(gt_path):
        raise SystemExit(f"gt not found: {gt_path}")

    def load(path, is_gt):
        d = {}
        for line in open(path):
            p = line.strip().split(",")
            if len(p) < 6:
                continue
            fr, tid = int(p[0]), int(p[1])
            x, y, w, h = map(float, p[2:6])
            if is_gt and len(p) >= 9:
                # MOT20 gt: col7 conf(0/1 consider), col8 class(1=pedestrian), col9 vis
                if int(float(p[6])) == 0 or int(float(p[7])) != 1:
                    continue
            d.setdefault(fr, []).append((tid, x, y, w, h))
        return d

    gt, pr = load(gt_path, True), load(pred_path, False)
    acc = mm.MOTAccumulator(auto_id=True)
    for fr in sorted(set(gt) | set(pr)):
        g = gt.get(fr, [])
        p = pr.get(fr, [])
        gids = [r[0] for r in g]
        pids = [r[0] for r in p]
        gb = np.array([r[1:] for r in g], dtype=float).reshape(-1, 4)
        pb = np.array([r[1:] for r in p], dtype=float).reshape(-1, 4)
        dist = mm.distances.iou_matrix(gb, pb, max_iou=0.5) if len(gb) and len(pb) else \
            np.empty((len(gb), len(pb)))
        acc.update(gids, pids, dist)

    mh = mm.metrics.create()
    summary = mh.compute(
        acc,
        metrics=["mota", "motp", "idf1", "num_switches", "num_false_positives",
                 "num_misses", "mostly_tracked", "mostly_lost"],
        name="seq",
    )
    r = summary.loc["seq"]
    return {
        "MOTA": round(float(r["mota"]), 4),
        "MOTP": round(float(r["motp"]), 4),
        "IDF1": round(float(r["idf1"]), 4),
        "ID_switches": int(r["num_switches"]),
        "false_positives": int(r["num_false_positives"]),
        "misses": int(r["num_misses"]),
        "mostly_tracked": int(r["mostly_tracked"]),
        "mostly_lost": int(r["mostly_lost"]),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seq", required=True, help="path to a MOT sequence dir")
    ap.add_argument("--max-frames", type=int, default=None)
    ap.add_argument("--tag", default=None)
    args = ap.parse_args()

    name = os.path.basename(os.path.normpath(args.seq))
    print(f"== tracking {name}: running BoTSORT ==")
    pred_path, nframes = run_tracker(args.seq, args.max_frames)
    print(f"== scoring vs gt.txt ==")
    metrics = score(args.seq, pred_path)
    out = {"sequence": name, "frames": nframes, "metrics": metrics}
    save_result(f"eval_tracking_{args.tag or name}", out)
    print(f"\nTRACKING SUMMARY {name}  MOTA={metrics['MOTA']}  IDF1={metrics['IDF1']}  "
          f"IDsw={metrics['ID_switches']}")


if __name__ == "__main__":
    main()
