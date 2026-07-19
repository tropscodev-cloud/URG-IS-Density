# backend/eval/eval_detection.py
"""
Detection accuracy vs ground truth.

Two things are measured, because your product cares about both:

  1. mAP@50 and mAP@50-95  — standard box-level detection quality, computed by
     Ultralytics' own validator against a dataset YAML (CrowdHuman / VisDrone /
     MOT20-as-detection). This tells you how good the *detector* is.

  2. Count MAE / RMSE      — per-image |predicted_persons - gt_persons|. This is
     the number your dashboard actually shows (headcount), so it is the metric
     that matters most for "is the number on screen trustworthy".

Ground truth must be in Ultralytics YOLO layout with a data.yaml:
    <dataset>/
      images/{train,val}/*.jpg
      labels/{train,val}/*.txt      # class cx cy w h (normalized), class 0 = person
      data.yaml                     # names, paths

CrowdHuman / VisDrone: export in YOLO format from Roboflow, or use
Ultralytics' VisDrone.yaml (auto-downloads). See eval/README.md for exact steps.

Usage:
    python backend/eval/eval_detection.py --data /path/to/CrowdHuman/data.yaml --split val
    python backend/eval/eval_detection.py --data VisDrone.yaml --split val --count-only
"""
import argparse
import glob
import os

import cv2

from common import (
    load_model, save_result, settings,
    PROC_WIDTH, PROC_HEIGHT, YOLO_CLASSES,
)


def run_map(data_yaml: str, split: str):
    """Box-level mAP via Ultralytics validator (matches production conf/classes)."""
    model = load_model()
    metrics = model.val(
        data=data_yaml,
        split=split,
        conf=settings.YOLO_CONFIDENCE,
        classes=YOLO_CLASSES,
        imgsz=PROC_WIDTH,          # eval at production input width
        verbose=True,
    )
    box = metrics.box
    return {
        "map50_95": round(float(box.map), 4),
        "map50": round(float(box.map50), 4),
        "mean_precision": round(float(box.mp), 4),
        "mean_recall": round(float(box.mr), 4),
    }


def _load_gt_count(label_path: str) -> int:
    if not os.path.exists(label_path):
        return 0
    with open(label_path) as f:
        return sum(1 for line in f if line.strip() and line.split()[0] == "0")


def run_count(data_root: str, split: str, limit: int | None):
    """Per-image headcount error against YOLO label files."""
    model = load_model()
    img_dir = os.path.join(data_root, "images", split)
    lbl_dir = os.path.join(data_root, "labels", split)
    if not os.path.isdir(img_dir):
        raise SystemExit(f"images dir not found: {img_dir}")

    imgs = sorted(
        p for ext in ("*.jpg", "*.jpeg", "*.png")
        for p in glob.glob(os.path.join(img_dir, ext))
    )
    if limit:
        imgs = imgs[:limit]
    if not imgs:
        raise SystemExit(f"no images under {img_dir}")

    abs_err = sq_err = 0.0
    n = 0
    worst = []
    for p in imgs:
        frame = cv2.imread(p)
        if frame is None:
            continue
        frame = cv2.resize(frame, (PROC_WIDTH, PROC_HEIGHT))
        res = model.predict(
            frame, conf=settings.YOLO_CONFIDENCE, classes=YOLO_CLASSES,
            imgsz=PROC_WIDTH, verbose=False,
        )
        pred = int(len(res[0].boxes)) if res and res[0].boxes is not None else 0
        stem = os.path.splitext(os.path.basename(p))[0]
        gt = _load_gt_count(os.path.join(lbl_dir, stem + ".txt"))
        e = abs(pred - gt)
        abs_err += e
        sq_err += e * e
        n += 1
        worst.append((e, stem, pred, gt))

    worst.sort(reverse=True)
    mae = abs_err / n if n else 0.0
    rmse = (sq_err / n) ** 0.5 if n else 0.0
    return {
        "images_scored": n,
        "count_mae": round(mae, 3),
        "count_rmse": round(rmse, 3),
        "worst_10": [
            {"image": w[1], "pred": w[2], "gt": w[3], "abs_err": w[0]}
            for w in worst[:10]
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="path to data.yaml (mAP) or dataset root (count)")
    ap.add_argument("--split", default="val")
    ap.add_argument("--limit", type=int, default=None, help="cap images for count pass")
    ap.add_argument("--count-only", action="store_true")
    ap.add_argument("--map-only", action="store_true")
    ap.add_argument("--tag", default="detection", help="output filename tag")
    args = ap.parse_args()

    out = {"dataset": args.data, "split": args.split}
    if not args.count_only:
        print("== mAP pass (Ultralytics validator) ==")
        out["map"] = run_map(args.data, args.split)
    if not args.map_only:
        print("== count-MAE pass ==")
        root = os.path.dirname(args.data) if args.data.endswith((".yaml", ".yml")) else args.data
        out["count"] = run_count(root, args.split, args.limit)

    save_result(f"eval_{args.tag}", out)
    print("\nDETECTION SUMMARY:", out.get("map"), out.get("count", {}).get("count_mae"))


if __name__ == "__main__":
    main()
