import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Play, Pause, SkipBack, SkipForward, PlayCircle, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useTimeStore, type PlaybackSpeed } from '@/lib/state/timeStore';
import { useHistoricalState, useAlertEvents, fetchHistoricalState } from './api';
import { queryKeys, queryClient } from '@/lib/api/queryClient';
import { formatLocalWithZone, formatLocal } from '@/lib/utils/time';
import { ApiRequestError } from '@/lib/api/client';

const RANGE_PRESETS: Array<{ label: string; ms: number }> = [
  { label: '1h', ms: 60 * 60_000 },
  { label: '6h', ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
  { label: '7d', ms: 7 * 24 * 60 * 60_000 },
];

const SPEEDS: PlaybackSpeed[] = [1, 4, 16];

export function Timeline(): React.JSX.Element {
  const isHistorical = useTimeStore((s) => s.isHistorical);
  const viewingAtMs = useTimeStore((s) => s.viewingAtMs);
  const rangeFromMs = useTimeStore((s) => s.rangeFromMs);
  const rangeToMs = useTimeStore((s) => s.rangeToMs);
  const playing = useTimeStore((s) => s.playing);
  const speed = useTimeStore((s) => s.speed);
  const enterHistorical = useTimeStore((s) => s.enterHistorical);
  const returnToLive = useTimeStore((s) => s.returnToLive);
  const seek = useTimeStore((s) => s.seek);
  const setRange = useTimeStore((s) => s.setRange);
  const play = useTimeStore((s) => s.play);
  const pause = useTimeStore((s) => s.pause);
  const setSpeed = useTimeStore((s) => s.setSpeed);

  const [dragValue, setDragValue] = useState<number | null>(null);
  const displayedAt = dragValue ?? viewingAtMs;

  const { error: stateError } = useHistoricalState(displayedAt, isHistorical);
  const purged = stateError instanceof ApiRequestError && stateError.status === 410;

  const { data: alertEvents } = useAlertEvents(rangeFromMs, rangeToMs);
  const alertTimes = useMemo(
    () => (alertEvents?.items ?? []).map((a) => Date.parse(a.raisedAt)).sort((a, b) => a - b),
    [alertEvents],
  );

  // Playback loop
  useEffect(() => {
    if (!playing || !isHistorical) return;
    const tickMs = 250;
    const id = setInterval(() => {
      const next = useTimeStore.getState().viewingAtMs + tickMs * speed;
      if (next >= rangeToMs) {
        pause();
        seek(rangeToMs);
      } else {
        seek(next);
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [playing, isHistorical, speed, rangeToMs, pause, seek]);

  // Debounced commit of drag position + prefetch adjacent windows
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onScrub(ms: number): void {
    setDragValue(ms);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      seek(ms);
      setDragValue(null);
      const bucket = 5 * 60_000;
      for (const offset of [-bucket, bucket]) {
        const atMs = ms + offset;
        void queryClient.prefetchQuery({
          queryKey: queryKeys.historyState(new Date(atMs).toISOString()),
          queryFn: () => fetchHistoricalState(atMs),
        });
      }
    }, 150);
  }

  function stepAlert(direction: 1 | -1): void {
    if (direction === 1) {
      const next = alertTimes.find((t) => t > displayedAt);
      if (next !== undefined) seek(next);
    } else {
      const prev = [...alertTimes].reverse().find((t) => t < displayedAt);
      if (prev !== undefined) seek(prev);
    }
  }

  if (!isHistorical) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => enterHistorical(Date.now(), Date.now() - 24 * 60 * 60_000, Date.now())}
            className="flex items-center gap-1.5 text-xs text-fg-secondary hover:text-fg-primary"
          >
            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Time-travel
          </button>
        </div>
      </div>
    );
  }

  const pct = ((displayedAt - rangeFromMs) / Math.max(1, rangeToMs - rangeFromMs)) * 100;

  return (
    <>
      <div
        role="status"
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center bg-severity-warning/90 py-1 text-center text-xs font-semibold text-black"
      >
        <History className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
        HISTORICAL — {formatLocalWithZone(displayedAt)} — not live
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
        <div className="pointer-events-auto w-full max-w-2xl rounded-lg border border-severity-warning/40 bg-bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur">
          {purged ? (
            <div className="flex items-center gap-2 text-xs text-severity-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Data for this moment has been purged per the department retention policy.
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <button type="button" onClick={() => stepAlert(-1)} title="Previous alert event" className="rounded p-1 text-fg-secondary hover:bg-bg-raised">
                  <SkipBack className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => (playing ? pause() : play())}
                  title={playing ? 'Pause' : 'Play'}
                  className="rounded-full bg-accent p-1.5 text-accent-fg hover:brightness-110"
                >
                  {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => stepAlert(1)} title="Next alert event" className="rounded p-1 text-fg-secondary hover:bg-bg-raised">
                  <SkipForward className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-1">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSpeed(s)}
                      className={clsx('rounded px-1.5 py-0.5 text-[10px] font-mono', speed === s ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-raised')}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-fg-secondary">{formatLocal(displayedAt, 'MMM d HH:mm:ss')}</span>
              </div>

              <div className="relative">
                <input
                  type="range"
                  min={rangeFromMs}
                  max={rangeToMs}
                  value={displayedAt}
                  onChange={(e) => onScrub(Number(e.target.value))}
                  aria-label="Scrub timeline"
                  className="w-full"
                />
                {alertTimes.map((t) => (
                  <span
                    key={t}
                    className="pointer-events-none absolute top-1/2 h-1.5 w-0.5 -translate-y-1/2 bg-severity-critical"
                    style={{ left: `${((t - rangeFromMs) / Math.max(1, rangeToMs - rangeFromMs)) * 100}%` }}
                    title="Alert event"
                  />
                ))}
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-fg-muted">
                <span>{formatLocal(rangeFromMs, 'MMM d HH:mm')}</span>
                <span>{pct.toFixed(0)}%</span>
                <span>{formatLocal(rangeToMs, 'MMM d HH:mm')}</span>
              </div>
            </>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <div className="flex gap-1">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setRange(Date.now() - preset.ms, Date.now())}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-secondary hover:bg-bg-raised"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={returnToLive}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:brightness-110"
            >
              Return to live
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
