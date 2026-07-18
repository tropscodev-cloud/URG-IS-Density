# core/metrics_store.py
"""
Shared in-process metrics store.

main.py writes to `live_metrics` every time a new frame is processed.
analytics.py (and any other module) imports `live_metrics` read-only.

Using a plain dict as a singleton is fine here: we're in a single
FastAPI process (multiprocessing workers write to a queue; main.py
aggregates that queue and updates this dict on the main event-loop thread).
"""

from typing import Dict, Any

# camera_id -> latest metrics payload (same shape as the WS metrics_data dict)
live_metrics: Dict[str, Any] = {}
