# backend/eval/eval_counting.py
"""
Crowd-counting accuracy on point-annotated datasets (ShanghaiTech, UCF-QNRF,
NWPU-Crowd). These datasets label a dot per head instead of boxes, which is the
correct supervision for validating a *headcount/density* product like yours.

Metric: MAE and RMSE of (predicted person count) vs (ground-truth head count),
the field standard for crowd counting. Note honestly: yolov8n is a detector, not
a density-regression model, so on very dense scenes (ShanghaiTech Part A,
UCF-QNRF) it will undercount badly once heads occlude — that is expected and is
itself a finding for the report (it tells you the ceiling of a detect-and-count
approach and whether you need a density-map model for high-density zones).

Supports ShanghaiTech .mat GT out of the box. For NWPU/QNRF, point them at the
provided .mat/.json head annotations (see --gt-format).

Usage:
    python backend/eval/eval_counting.py \
        --images /data/ShanghaiTech/part_B/test_data/images \
        --gt     /data/ShanghaiTech/part_B/test_data/ground-truth \
        --gt-format shanghaitech --tag shtech_B
"""
import argparse
import glob
import os

import cv2

from common import load_model, save_result, settings, PROC_WIDTH, PROC_HEIGHT, YOLO_CLASSES


def gt_count_shanghaitech(gt_dir: str, img_stem: str) -> int | None:
    """ShanghaiTech: GT_<stem>.mat -> image_info[0][0][0][0][0] is Nx2 points."""
    try:
        from scipy.io import loadmat
    except ImportError:
        raise SystemExit("scipy required for shanghaitech GT. pip install scipy")
    mat_path = os.path.join(gt_dir, f"GT_{img_stem}.mat")
    if not os.path.exists(mat_path):
        return None
    m = loadmat(mat_path)
    return int(m["image_info"][0][0][0][0][0].shape[0])


def gt_count_json(gt_dir: str, img_stem: str) -> int | None:
    """Generic: <stem>.json with {'points': [[x,y],...]} or {'count': N} (NWPU-style)."""
    import json
    p = os.path.join(gt_dir, img_stem + ".json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    if "count" in d:
        return int(d["count"])
    if "points" in d:
        return len(d["points"])
    return None


GT_LOADERS = {"shanghaitech": gt_count_shanghaitech, "json": gt_count_json}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--gt", required=True)
    ap.add_argument("--gt-format", choices=list(GT_LOADERS), default="shanghaitech")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--tag", default="counting")
    args = ap.parse_args()

    loader = GT_LOADERS[args.gt_format]
    model = load_model()

    imgs = sorted(
        p for ext in ("*.jpg", "*.jpeg", "*.png")
        for p in glob.glob(os.path.join(args.images, ext))
    )
    if args.limit:
        imgs = imgs[: args.limit]
    if not imgs:
        raise SystemExit(f"no images under {args.images}")

    abs_err = sq_err = 0.0
    n = 0
    rows = []
    for p in imgs:
        stem = os.path.splitext(os.path.basename(p))[0]
        gt = loader(args.gt, stem)
        if gt is None:
            continue
        frame = cv2.imread(p)
        if frame is None:
            continue
        frame = cv2.resize(frame, (PROC_WIDTH, PROC_HEIGHT))
        res = model.predict(
            frame, conf=settings.YOLO_CONFIDENCE, classes=YOLO_CLASSES,
            imgsz=PROC_WIDTH, verbose=False,
        )
        pred = int(len(res[0].boxes)) if res and res[0].boxes is not None else 0
        e = abs(pred - gt)
        abs_err += e
        sq_err += e * e
        n += 1
        rows.append((e, stem, pred, gt))

    if n == 0:
        raise SystemExit("no image/GT pairs matched — check --gt-format and paths")

    rows.sort(reverse=True)
    out = {
        "dataset_images": args.images,
        "images_scored": n,
        "count_mae": round(abs_err / n, 3),
        "count_rmse": round((sq_err / n) ** 0.5, 3),
        "mean_gt": round(sum(r[3] for r in rows) / n, 2),
        "mean_pred": round(sum(r[2] for r in rows) / n, 2),
        "note": "yolov8n undercounts dense/occluded scenes by design; compare MAE against scene density.",
        "worst_10": [{"image": r[1], "pred": r[2], "gt": r[3], "abs_err": r[0]} for r in rows[:10]],
    }
    save_result(f"eval_{args.tag}", out)
    print(f"\nCOUNTING SUMMARY  MAE={out['count_mae']}  RMSE={out['count_rmse']}  "
          f"(mean gt={out['mean_gt']}, mean pred={out['mean_pred']})")


if __name__ == "__main__":
    main()
