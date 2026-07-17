import { useMemo } from 'react';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useCameras } from './api';
import { useHeatmapTick } from '@/lib/ws/hooks';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { CameraStatusBadge } from './CameraStatusBadge';

export function GroupDetailPanel(): React.JSX.Element {
  const groupCameraIds = useSelectionStore((s) => s.groupCameraIds);
  const { data } = useCameras();
  // Group members read via manager.getLatest() directly (no per-camera subscription), so this
  // must re-render on the ≤1Hz fleet snapshot tick, not useAnyMetricsTick — see useFleetTotals.ts
  // for the full explanation of why the latter would leave this stale.
  useHeatmapTick();
  const manager = getWsManager();

  const cameras = useMemo(
    () => (data?.items ?? []).filter((c) => groupCameraIds.includes(c.id)),
    [data, groupCameraIds],
  );

  const totalHeadcount = cameras.reduce((sum, c) => {
    const live = manager.getLatest(c.id) ?? c.lastMetrics;
    return sum + (live?.headcount ?? 0);
  }, 0);

  const worstSeverity = cameras.reduce<'none' | 'warning' | 'critical'>((worst, c) => {
    const live = manager.getLatest(c.id) ?? c.lastMetrics;
    if (!live) return worst;
    if (live.densityRisk >= 0.8) return 'critical';
    if (live.densityRisk >= 0.55 && worst !== 'critical') return 'warning';
    return worst;
  }, 'none');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border p-4 pr-10">
        <h2 className="text-sm font-semibold text-fg-primary">Group selection</h2>
        <p className="text-xs text-fg-muted">{cameras.length} cameras selected</p>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4">
        <div className="rounded-md border border-border bg-bg-raised p-2.5">
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-muted">Combined headcount</div>
          <div className="font-mono text-base tabular-nums text-fg-primary">{totalHeadcount}</div>
        </div>
        <div className="rounded-md border border-border bg-bg-raised p-2.5">
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-muted">Worst severity</div>
          <div
            className={`font-mono text-base tabular-nums ${worstSeverity === 'critical' ? 'text-severity-critical' : worstSeverity === 'warning' ? 'text-severity-warning' : 'text-fg-primary'}`}
          >
            {worstSeverity === 'none' ? 'Normal' : worstSeverity.toUpperCase()}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-surface text-[10px] uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Camera</th>
              <th className="px-3 py-1.5 text-left font-medium">Status</th>
              <th className="px-3 py-1.5 text-right font-medium">Headcount</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => {
              const live = manager.getLatest(c.id) ?? c.lastMetrics;
              return (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-fg-primary">{c.name}</td>
                  <td className="px-3 py-1.5">
                    <CameraStatusBadge status={c.status} variant="icon-label" />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-secondary">{live?.headcount ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
