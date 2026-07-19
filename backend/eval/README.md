# URG-IS Evaluation Harness

Measures your **actual** pipeline (yolov8n, conf 0.25, 640×480, BoTSORT, class 0
— read from `core/config.py`, so it stays in sync with production) against public
ground-truth datasets and emits a pass/fail scorecard.

Why this exists: `backend/verify_accuracy.py` only measures self-consistency
(latency, headcount stats, tracker drift) with **no ground truth** — it cannot
tell you if the numbers are *correct*, only that they are *stable*. This harness
closes that gap with real accuracy metrics (mAP, count MAE, MOTA, IDF1).

> **This cannot be run inside the Cowork sandbox** (no GPU, and PyPI/torch are
> blocked there). Run it on the machine where your backend and model live.

---

## 0. Install (once)

```bash
cd <repo>/backend
pip install -r requirements.txt
pip install -r eval/requirements-eval.txt
```

All scripts read `backend/.env`, so they use the same model/device as production.
For a faster, more accurate run, set `YOLO_DEVICE=cuda` (or `mps`) in `.env`.

---

## 1. Datasets — what to download and where to put it

You do **not** need all of them. Minimum viable production sign-off = one row per
capability: **CrowdHuman** (detection+count), **ShanghaiTech Part B** (counting),
**MOT20** (tracking), plus your own clips (latency, no download needed).

| Dataset | Validates | Get it | Notes |
|---|---|---|---|
| **CrowdHuman** | detection mAP + count MAE | [crowdhuman.org](https://www.crowdhuman.org/) or [Roboflow (YOLO export)](https://universe.roboflow.com/wx/crowdhuman-aclcg/dataset/1) | best match: dense, occluded, person+head boxes. Export **YOLOv8** format from Roboflow → gives `data.yaml`. |
| **VisDrone** | detection mAP (overhead cams) | auto: `data="VisDrone.yaml"` in Ultralytics | use only if cameras are elevated/overhead. |
| **ShanghaiTech** | counting MAE/RMSE | [Kaggle / official](https://www.kaggle.com/datasets/tthien/shanghaitech) | Part **B** ≈ your fixed-cam density; Part A is extreme density (expect big undercount). |
| **NWPU-Crowd** | counting (rigorous) | [gjy3035.github.io/NWPU-Crowd](https://gjy3035.github.io/NWPU-Crowd-Sample-Code/) | biggest count range; cite this for the "official" number. |
| **MOT20** | tracking MOTA/IDF1/IDsw | [motchallenge.net](https://motchallenge.net/data/MOT20/) | crowded fixed-camera CCTV — closest to deployment. |

### Expected layouts

**CrowdHuman / VisDrone (YOLO):**
```
CrowdHuman/
  images/{train,val}/*.jpg
  labels/{train,val}/*.txt      # class 0 = person
  data.yaml
```

**ShanghaiTech:**
```
part_B/test_data/
  images/IMG_1.jpg ...
  ground-truth/GT_IMG_1.mat ...
```

**MOT20:**
```
MOT20/train/MOT20-01/
  img1/000001.jpg ...
  gt/gt.txt
  seqinfo.ini
```

---

## 2. Run the evals

```bash
cd <repo>

# A. Detection: mAP@50 / mAP@50-95 + per-image count MAE
python backend/eval/eval_detection.py --data /data/CrowdHuman/data.yaml --split val --tag crowdhuman

# B. Counting: MAE/RMSE vs head-point ground truth
python backend/eval/eval_counting.py \
    --images /data/ShanghaiTech/part_B/test_data/images \
    --gt     /data/ShanghaiTech/part_B/test_data/ground-truth \
    --gt-format shanghaitech --tag shtech_B

# C. Tracking: MOTA / IDF1 / ID-switches (run a couple of sequences)
python backend/eval/eval_tracking.py --seq /data/MOT20/train/MOT20-01
python backend/eval/eval_tracking.py --seq /data/MOT20/train/MOT20-03 --max-frames 500

# D. Latency / throughput on YOUR clips (no dataset needed)
python backend/eval/eval_latency.py --track --frames 300
```

Each writes a JSON into `backend/eval/results/`.

## 3. Generate the scorecard

```bash
python backend/eval/gen_report.py
# -> backend/eval/RESULTS_REPORT.md  (pass/fail vs thresholds)
```

Edit the `THRESHOLDS` dict at the top of `gen_report.py` to match your SLA before
you treat pass/fail as a go/no-go.

---

## 4. Interpreting results (honest expectations for yolov8n)

- **Detection mAP@50 on CrowdHuman**: nano is small; expect moderate mAP. If it
  fails the gate, the fix is a bigger model (yolov8m/l) or fine-tuning on
  CrowdHuman — not a code change.
- **Counting on ShanghaiTech Part A / UCF-QNRF**: expect large MAE. A
  detect-and-count approach *structurally* undercounts once heads occlude. If
  your real zones ever get that dense, you need a density-map model for those
  cameras. Part B is the fair test for your current use case.
- **Tracking IDF1 / ID-switches**: your self-test already hinted at heavy ID
  churn (drift ratio ~3×). Low IDF1 here directly explains unreliable **flow
  rate** and **moving %**. Mitigation: raise `BOTSORT_BUFFER_FRAMES`, add ReID,
  or increase effective FPS so tracks aren't lost between sampled frames.
- **Latency p99**: the mean looks fine (~30 ms CPU) but check p99 — the tail is
  what users feel as stutter, and it sets `sustainable_cameras_per_host`, which
  you must multiply by your worker fleet to reach the 100+ camera target.
```
