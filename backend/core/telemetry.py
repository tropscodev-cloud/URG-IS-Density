# core/telemetry.py
"""
Operational (not case/PII) metrics for the support/telemetry surface: recent error counts, worker
health, queue depth, WS connection count. Registers one loguru sink at import time so every
existing `logger.error(...)` call anywhere in the app — no call sites need to change — feeds a
rolling in-memory counter here, the same "one central hook" approach the rest of this codebase
uses for cross-cutting concerns (e.g. the alert_engine singleton).
"""
import time
from collections import deque
from threading import Lock
from typing import Deque

from loguru import logger

_WINDOW_SECONDS = 3600  # keep an hour of error timestamps; callers can window down from that
_lock = Lock()
_error_timestamps: Deque[float] = deque()


def _record_error(message) -> None:
    with _lock:
        _error_timestamps.append(time.time())
        cutoff = time.time() - _WINDOW_SECONDS
        while _error_timestamps and _error_timestamps[0] < cutoff:
            _error_timestamps.popleft()


logger.add(_record_error, level="ERROR", format="{message}")


def recent_error_count(window_seconds: int = 300) -> int:
    cutoff = time.time() - window_seconds
    with _lock:
        return sum(1 for t in _error_timestamps if t >= cutoff)
