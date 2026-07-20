# URG-IS Crowd Density Intelligence Portal — Production Readiness Report

**Date:** 2026-07-19
**Scope:** Full stack — React frontend (`app/`), FastAPI + YOLOv8/BoTSORT backend (`backend/`)
**Method:** Static code review of the connected repo, live browser testing of the running app, review of the existing self-test output (`data/model_verification_report.json`), and a purpose-built accuracy evaluation harness (`backend/eval/`).

---

## 1. Verdict

**Not yet production-ready. Strong foundation, three deployment blockers.**

The core computer-vision pipeline is genuinely well-engineered — video-time-based velocity (not wall-clock), homography-to-GPS projection, live-adjustable FPS, and a sensible density formula. The frontend is fast and hardened after prior fix rounds. But the app **cannot ship as a crowd-safety product today** because its central safety feature — alerting — is a non-functional stub on the real backend, several endpoints return mock data, and **model accuracy has never been measured against ground truth**. The harness to close that last gap is now in the repo (`backend/eval/`); it must be run before sign-off.

---

## 2. Blockers (must fix before any deployment)

### B1 — Alerting is a stub; the product's core safety function does not work
`api/routes/analytics.py:17` — `GET /alerts` always returns an empty list. `ack`, `bulk-ack`, `resolve`, `escalate` (lines 20–40) echo success without persisting anything. The per-camera `alert: headcount >= threshold` flag *is* computed live in `workers/vision_pipeline.py:325`, but nothing converts a threshold breach into a persisted alert or a WS `alert` event.

**Impact:** Live testing confirmed a camera at 89% density risk (over its 80% threshold) with the header alert count stuck at 0 and an empty tray. Every hardened piece of the alert UI (tray, ack flow, toasts, map-pause) is dead weight against the real backend.
**Fix:** Server-side alert lifecycle: on threshold crossing (with hysteresis to prevent flapping) create an alert record, emit a WS `alert` event, and back `ack`/`resolve`/`escalate` with real state transitions in the DB. Mirror the mock server's contract so the frontend needs zero changes.

### B2 — Model accuracy is unmeasured against ground truth
`backend/verify_accuracy.py` is labeled "accuracy verification" but computes only self-consistency (latency, headcount stats, YOLO confidence, tracker drift) — **there is no ground truth anywhere in it**. You currently cannot state your detector's mAP, your headcount error, or your tracking MOTA/IDF1. For a crowd-*safety* system, shipping without these numbers is the single biggest risk.

**Impact:** No defensible basis for "the numbers on screen are correct." The existing self-test already hints at trouble: tracker drift ratio **2.8–3.3** (≈52 unique track IDs for ~18 real people) means heavy ID switching, which undermines flow rate and moving-vs-static.
**Fix:** Run `backend/eval/` against CrowdHuman (detection + count), ShanghaiTech Part B (counting), and MOT20 (tracking). See §5. Gate deployment on the resulting scorecard.

### B3 — Mock data served as real through production endpoints
`api/routes/analytics.py` returns hardcoded `example.com` URLs for reports (lines 71–111), report detail (122–136), evidence bundles (223), and schedules (229–241). `api/routes/cameras.py:127` returns a hardcoded Unsplash image as a camera "snapshot."

**Impact:** Operators can click "Export evidence bundle" during a real incident and receive a fake `example.com` zip. In a safety/compliance context this is dangerous, not just cosmetic.
**Fix:** Implement real report generation and evidence export, or explicitly disable/hide these controls until backed by real data. Do not ship UI that fabricates evidence artifacts.

---

## 3. High-severity issues

### H1 — Login always returns HTTP 418, never 401
`api/routes/auth.py:58`: `status_code=status.HTTP_418_IM_A_TEAPOT or status.HTTP_401_UNAUTHORIZED`. Python's `or` returns the first truthy operand, so this **always** evaluates to 418 — 401 is unreachable.
**Impact:** Clients, proxies, and monitoring that key off 401 for auth failures break; "I'm a Teapot" surfaces to users on bad credentials.
**Fix:** `status_code=status.HTTP_401_UNAUTHORIZED`.

### H2 — TopBar live headcount drops to 0 while camera/zone counts are correct
Live testing: header showed `0` while the zone read 55 and per-camera counts were 25/16/14 at the same instant. It reads correctly right after login, then drops to 0 permanently — the per-camera WS data keeps flowing but the top-bar aggregate stops updating.
**Fix:** Derive the global headcount client-side by summing the same per-camera store the sidebar uses, rather than a separate summary field/event.

### H3 — Tracking instability (ID switching)
Self-test drift ratio ~3×; needs confirmation against MOT20 (harness ready). Low IDF1 here is the root cause of unreliable flow rate and movement %.
**Fix:** After measuring, mitigate via higher `BOTSORT_BUFFER_FRAMES`, ReID embeddings, or higher effective FPS so tracks survive between sampled frames.

### H4 — Video overlay boxes desynced from playback
The browser plays the transcoded H.264 loop on its own clock while detections stream from backend inference on the original file — so boxes lag/misalign and look frozen between WS ticks. The backend already emits `video_time_s` and `seq` (`vision_pipeline.py:317`) to enable sync; the frontend isn't using them to drive the `<video>` element.
**Fix:** Seek/lock the frontend video element to the detection `video_time_s`; smooth the detection-count badge (rolling median).

---

## 4. Medium / low issues

- **M1 — "0% moving" on visibly walking crowds.** The velocity logic in `vision_pipeline.py` looks correct (video-time based), so this is likely a threshold/tuning issue (`MOVEMENT_VELOCITY_THRESHOLD_PX_S = 30.0` at 640×480) or a frontend wiring gap. Validate against MOT20 track velocities.
- **M2 — Dead code / unused identity data.** `data/embeddings/faiss.index` + `identity_map.json` are present but unwired. If facial recognition is not a feature, delete them — they are a compliance liability to leave lying in a surveillance repo. If it *is* planned, that carries significant legal/privacy obligations (see COMPLIANCE.md).
- **M3 — Zero-count summary toast.** Suppress "0 CRITICAL alerts across 0 zones" toasts.
- **M4 — luma.gl `weightsTexture not set` warning** from the heatmap layer (cosmetic; deck.gl/luma.gl version skew).
- **M5 — Seed camera coordinates** place the zone marker in the middle of the Godavari river — placeholder lat/lng.
- **L1 — SQLite in place of Postgres.** Fine for dev; `DATABASE_URL` already abstracts it. Provision Postgres for production (concurrent writes from multiple camera workers will contend on SQLite).
- **L2 — `JWT_SECRET` hardcoded default** (`core/config.py:22`, `supersecretkeyurgis`). Must be environment-injected and rotated in production; never ship the default.

---

## 5. Accuracy evaluation — how to produce the missing numbers

A ground-truth harness is now in `backend/eval/` (see its README). It runs your **exact** production config and emits a pass/fail scorecard.

| Capability | Dataset | Script | Key metrics |
|---|---|---|---|
| Detection | CrowdHuman | `eval_detection.py` | mAP@50, mAP@50-95, count MAE |
| Counting/density | ShanghaiTech Part B | `eval_counting.py` | count MAE, RMSE |
| Tracking + flow | MOT20 | `eval_tracking.py` | MOTA, IDF1, ID-switches |
| Latency/throughput | your own clips | `eval_latency.py` | p50/p95/p99 ms, sustainable cameras/host |

Run all four, then `python backend/eval/gen_report.py` → `backend/eval/RESULTS_REPORT.md`.

**Default go/no-go gates** (editable in `gen_report.py`): mAP@50 ≥ 0.50 · count MAE ≤ 3 · MOTA ≥ 0.40 · IDF1 ≥ 0.50 · p99 latency ≤ 100 ms.

**Honest expectation:** `yolov8n` is the nano model. It will likely miss the mAP/count gates on dense scenes; the fix is a larger model (yolov8m/l) or fine-tuning on CrowdHuman, and a density-map model for genuinely dense zones. Measuring is step one — you cannot tune what you haven't measured.

---

## 6. Recommended path to deployment (ordered)

1. **Measure accuracy** — run `backend/eval/` (§5). Everything else is guesswork until these numbers exist.
2. **B1 — build real alerting** (persistence + WS + hysteresis). This reactivates the entire hardened alert UI.
3. **H1 — one-line 401 fix.** **H2 — TopBar aggregation.** Cheap, high-value.
4. **B3 — remove or implement mock endpoints** (reports, evidence, snapshots). No fabricated evidence in a safety product.
5. **H3/H4/M1 — tracking + overlay sync + movement**, informed by the MOT20 numbers from step 1.
6. **Harden infra** — Postgres (L1), injected `JWT_SECRET` (L2), resolve the FAISS/identity question (M2), real camera coordinates (M5).
7. **Re-run the full eval + a live browser pass**, confirm the scorecard passes your SLA, then ship.

---

_Findings in §2–§4 are verified against the live app and the actual source (file:line cited). Accuracy metrics in §5 are pending your harness run — no accuracy numbers are asserted in this report because none have been measured against ground truth yet._
