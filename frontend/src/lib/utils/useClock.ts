import { useEffect, useState } from 'react';

/** Ticks once a second. Used sparingly (top bar clocks, staleness chips) — not per-row. */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
