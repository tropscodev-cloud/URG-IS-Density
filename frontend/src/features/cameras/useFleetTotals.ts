import { useMemo } from 'react';
import { useCameras } from './api';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { useHeatmapTick } from '@/lib/ws/hooks';
import { useTimeStore } from '@/lib/state/timeStore';
import { useHistoricalState } from '@/features/timeline/api';

export interface FleetTotals {
  totalHeadcount: number;
  activeCount: number;
  totalCount: number;
  excludedCount: number;
}

const COUNTABLE_STATUSES = new Set(['ONLINE', 'DEGRADED']);

export function useFleetTotals(): FleetTotals {
  const { data } = useCameras();
  // A fleet-wide aggregate must be driven by the same ≤1Hz fleet_snapshot cadence the map uses
  // (useHeatmapTick), not useAnyMetricsTick — that only fires for cameras with an active
  // individual subscription (a handful: the visible sidebar rows + selected camera). Almost the
  // entire fleet's data now arrives via the batched snapshot instead of per-camera pushes (see
  // WebSocketManager's 'fleet_snapshot' handling), which deliberately doesn't touch the
  // dirty/anyListeners machinery useAnyMetricsTick relies on — so this total would have gone
  // stale, refreshing only on the 30s REST poll instead of near-real-time.
  const heatmapTick = useHeatmapTick();
  const manager = getWsManager();
  const isHistorical = useTimeStore((s) => s.isHistorical);
  const viewingAtMs = useTimeStore((s) => s.viewingAtMs);
  // Scrubbing time-travel must freeze this at the scrubbed-to moment — reading live WS data here
  // regardless of isHistorical was a real bug: the top bar's headcount/online-count kept ticking
  // in real time while the operator believed they were looking at a past moment.
  const { data: historical } = useHistoricalState(viewingAtMs, isHistorical);

  return useMemo(() => {
    const items = data?.items ?? [];
    const historicalByCamera = isHistorical ? new Map(historical?.cameras.map((c) => [c.cameraId, c] as const)) : null;
    let totalHeadcount = 0;
    let activeCount = 0;
    let excludedCount = 0;
    for (const c of items) {
      const status = historicalByCamera?.get(c.id)?.status ?? c.status;
      if (COUNTABLE_STATUSES.has(status)) {
        activeCount += 1;
        if (historicalByCamera) {
          totalHeadcount += historicalByCamera.get(c.id)?.metrics?.headcount ?? 0;
        } else {
          const live = manager.getLatest(c.id);
          totalHeadcount += live?.headcount ?? c.lastMetrics?.headcount ?? 0;
        }
      } else {
        excludedCount += 1;
      }
    }
    return { totalHeadcount, activeCount, totalCount: items.length, excludedCount };
    // heatmapTick is intentionally in this array with no other reference: it's the ≤1Hz pulse that
    // makes this recompute from manager.getLatest() at all. Without it, this memo only re-runs when
    // `data`/`historical` change reference, which can go long stretches without happening — the
    // aggregate then freezes at whatever it computed on the first render forever after (this was
    // the TopBar headcount=0 bug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, manager, isHistorical, historical, heatmapTick]);
}
