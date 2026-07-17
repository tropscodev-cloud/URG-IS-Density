import { useEffect, useRef, useState } from 'react';

// ~15Hz was "cheap on React" in isolation, but each tick forces a fresh `pulseLayer` object,
// which forces the combined `layers` array to change identity, which forces deck.gl's
// `overlay.setProps()` to walk and diff the *entire* layers list — including the heatmap
// aggregation layer — 15x/sec. Measured live: this alone was enough to hold the map under 4fps
// even with WS traffic light and the per-second cluster refresh otherwise idle. A ~3Hz "breathing"
// pulse is still a clearly visible attention cue and cuts that diff frequency 5x.
const UPDATE_INTERVAL_MS = 330; // ~3Hz

/**
 * Drives the GPU-rendered alert pulse (deck.gl ScatterplotLayer radius), decoupled from the
 * WebSocket data cadence entirely — this is a pure decorative animation clock.
 */
export function usePulsePhase(enabled: boolean): number {
  const [phase, setPhase] = useState(0);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const loop = (t: number): void => {
      if (t - last.current >= UPDATE_INTERVAL_MS) {
        last.current = t;
        setPhase((t / 1000) * Math.PI);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [enabled]);

  return phase;
}
