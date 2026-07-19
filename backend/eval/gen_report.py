# backend/eval/gen_report.py
"""
Assemble every results/*.json produced by the eval scripts into one markdown
report with pass/fail against production thresholds.

Thresholds below are starting gates for a crowd-safety product; edit THRESHOLDS
to match your own SLA before you sign off.

Usage:
    python backend/eval/gen_report.py
    -> writes eval/RESULTS_REPORT.md
"""
import glob
import json
import os
from datetime import datetime, timezone

HERE = os.path.dirname(__file__)
RESULTS = os.path.join(HERE, "results")

# Production go/no-go gates. Tune to your SLA.
THRESHOLDS = {
    "map50_min": 0.50,           # detector: mAP@50 >= 0.50
    "count_mae_max": 3.0,        # headcount within ~3 people on medium-density val
    "mota_min": 0.40,            # crowded MOT is hard; 0.40 is a realistic floor for yolov8n+botsort
    "idf1_min": 0.50,            # identity stability for trustworthy flow rate
    "p99_latency_ms_max": 100.0, # per-frame tail under 100ms
}


def load_all():
    out = {}
    for p in sorted(glob.glob(os.path.join(RESULTS, "*.json"))):
        d = json.load(open(p))
        if isinstance(d, dict) and d.get("_placeholder"):
            continue  # skip results/.gitkeep-style placeholder files
        out[os.path.splitext(os.path.basename(p))[0]] = d
    return out


def check(cond):
    return "✅ PASS" if cond else "❌ FAIL"


def main():
    data = load_all()
    lines = []
    w = lines.append

    w("# URG-IS Model Evaluation Results\n")
    w(f"_Generated {datetime.now(timezone.utc).isoformat()}_\n")
    if not data:
        w("\n**No results found.** Run the eval scripts first (see eval/README.md).\n")
        open(os.path.join(HERE, "RESULTS_REPORT.md"), "w").write("\n".join(lines))
        print("no results yet")
        return

    # environment (from any file)
    env = next(iter(data.values())).get("_env", {})
    w("\n## Environment\n")
    for k, v in env.items():
        w(f"- **{k}**: {v}")

    w("\n## Scorecard\n")
    w("| Area | Metric | Value | Gate | Result |")
    w("|---|---|---|---|---|")

    for name, d in data.items():
        if "map" in d:
            m = d["map"]
            w(f"| Detection ({d.get('dataset','')}) | mAP@50 | {m['map50']} | ≥{THRESHOLDS['map50_min']} | {check(m['map50']>=THRESHOLDS['map50_min'])} |")
            w(f"| Detection | mAP@50-95 | {m['map50_95']} | — | — |")
        if "count" in d and isinstance(d["count"], dict):
            c = d["count"]
            w(f"| Counting ({name}) | count MAE | {c['count_mae']} | ≤{THRESHOLDS['count_mae_max']} | {check(c['count_mae']<=THRESHOLDS['count_mae_max'])} |")
        if name.startswith("eval_") and "count_mae" in d:  # standalone counting eval
            w(f"| Counting ({name}) | MAE | {d['count_mae']} | ≤{THRESHOLDS['count_mae_max']} | {check(d['count_mae']<=THRESHOLDS['count_mae_max'])} |")
        if "metrics" in d and "MOTA" in d.get("metrics", {}):
            m = d["metrics"]
            w(f"| Tracking ({d.get('sequence','')}) | MOTA | {m['MOTA']} | ≥{THRESHOLDS['mota_min']} | {check(m['MOTA']>=THRESHOLDS['mota_min'])} |")
            w(f"| Tracking ({d.get('sequence','')}) | IDF1 | {m['IDF1']} | ≥{THRESHOLDS['idf1_min']} | {check(m['IDF1']>=THRESHOLDS['idf1_min'])} |")
            w(f"| Tracking ({d.get('sequence','')}) | ID switches | {m['ID_switches']} | — | — |")
        if "aggregate" in d and d["aggregate"]:
            a = d["aggregate"]
            w(f"| Latency | worst p99 (ms) | {a['worst_p99_ms']} | ≤{THRESHOLDS['p99_latency_ms_max']} | {check(a['worst_p99_ms']<=THRESHOLDS['p99_latency_ms_max'])} |")
            w(f"| Latency | min sustainable cams/host | {a['min_sustainable_cameras_per_host']} | — | — |")

    w("\n## Raw results\n")
    for name, d in data.items():
        w(f"\n### {name}\n")
        w("```json")
        w(json.dumps({k: v for k, v in d.items() if k != "_env"}, indent=2))
        w("```")

    path = os.path.join(HERE, "RESULTS_REPORT.md")
    open(path, "w").write("\n".join(lines))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
