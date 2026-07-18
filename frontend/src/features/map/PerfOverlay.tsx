import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '@/lib/state/wsStore';

interface PerfSnapshot {
  fps: number;
  heapMb: number | null;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
}

function useFpsAndHeap(): PerfSnapshot {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>({ fps: 0, heapMb: null });
  const frames = useRef(0);
  const lastReport = useRef(performance.now());

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      frames.current += 1;
      const now = performance.now();
      if (now - lastReport.current >= 1000) {
        const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
        setSnapshot({
          fps: Math.round((frames.current * 1000) / (now - lastReport.current)),
          heapMb: memory ? Math.round(memory.usedJSHeapSize / 1_048_576) : null,
        });
        frames.current = 0;
        lastReport.current = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return snapshot;
}

export function isPerfOverlayEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1';
}

export function PerfOverlay(): React.JSX.Element {
  const { fps, heapMb } = useFpsAndHeap();
  const messageRate = useWsStore((s) => s.messageRate);
  const diagnostics = useWsStore((s) => s.diagnostics);

  return (
    <div className="pointer-events-none absolute right-3 top-16 z-40 rounded-md border border-border bg-black/80 px-3 py-2 font-mono text-[11px] text-lime-400 shadow-lg">
      <div>FPS: {fps}</div>
      <div>WS msg/s: {messageRate}</div>
      <div>Heap: {heapMb !== null ? `${heapMb} MB` : 'n/a (non-Chromium)'}</div>
      <div>Dropped OOO: {diagnostics.droppedOutOfOrder}</div>
      <div>Clamped corrupt: {diagnostics.clampedCorrupt}</div>
    </div>
  );
}
