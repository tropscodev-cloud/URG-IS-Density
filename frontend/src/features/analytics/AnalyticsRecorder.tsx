import { useEffect, useRef } from 'react';
import { useCameras } from '@/features/cameras/api';
import { useFleetTotals } from '@/features/cameras/useFleetTotals';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { useHeatmapTick } from '@/lib/ws/hooks';
import { useAnalyticsHistoryStore } from '@/lib/state/analyticsHistoryStore';

const SAMPLE_INTERVAL_MS = 60_000;

/**
 * Mounted once in AppShell (every tab, not just /analytics) so the rolling buffer keeps
 * accumulating in the background regardless of which tab is active — matches "single connection
 * at app root" for the underlying data too, not just the WS socket itself. Reads only hooks the
 * rest of the app already subscribes to; this component fetches nothing of its own.
 */
export function AnalyticsRecorder(): null {
  const totals = useFleetTotals();
  const { data: camerasData } = useCameras();
  const manager = getWsManager();
  const heatmapTick = useHeatmapTick();
  const addSample = useAnalyticsHistoryStore((s) => s.addSample);
  const lastSampleAtRef = useRef(0);

  useEffect(() => {
    // Cameras haven't loaded yet (e.g. the very first tick right after mount, before the REST
    // query resolves) — skip rather than record a misleadingly-empty snapshot that would then sit
    // as `latest` for a full SAMPLE_INTERVAL_MS before a real one replaces it.
    if (!camerasData || camerasData.items.length === 0) return;

    const now = Date.now();
    if (now - lastSampleAtRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleAtRef.current = now;

    const perCamera = camerasData.items.map((c) => {
      const live = manager.getLatest(c.id);
      return {
        id: c.id,
        zoneId: c.zoneId,
        headcount: live?.headcount ?? c.lastMetrics?.headcount ?? 0,
        densityRisk: live?.densityRisk ?? c.lastMetrics?.densityRisk ?? 0,
        movementPct: live?.movementPct ?? c.lastMetrics?.movementPct ?? 0,
        flowRate: live?.flowRate ?? c.lastMetrics?.flowRate ?? 0,
      };
    });
    addSample({ ts: now, totalHeadcount: totals.totalHeadcount, perCamera });
    // heatmapTick is the ≤1Hz poll that lets this effect re-check "has a minute passed" at all —
    // see useFleetTotals.ts for the same pattern and why omitting it here would mean this only
    // re-checks when camerasData changes.
  }, [heatmapTick, totals.totalHeadcount, camerasData, manager, addSample]);

  return null;
}
