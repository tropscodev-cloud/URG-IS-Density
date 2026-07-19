import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useCameras, useZones, useBulkSetCameraFps } from './api';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { FpsSegmentedToggle, type FpsOption } from './FpsSegmentedToggle';

type Scope = 'all' | 'zone' | 'selected';

/** Settings-gear popover in the sidebar Cameras section header — bulk inference-rate change
 *  across all cameras, one zone, or the current multi-selection (shared with the map's lasso
 *  select and the split-screen video grid's checkboxes — one "selected cameras" concept). */
export function CameraFpsScopePopover(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [zoneId, setZoneId] = useState('');
  const [fps, setFps] = useState<FpsOption>(15);

  const { data: camerasData } = useCameras();
  const { data: zonesData } = useZones();
  const groupCameraIds = useSelectionStore((s) => s.groupCameraIds);
  const bulkSetFps = useBulkSetCameraFps();

  const zoneCameraCount = zoneId ? (camerasData?.items ?? []).filter((c) => c.zoneId === zoneId).length : 0;
  const canApply =
    scope === 'all' ? true : scope === 'zone' ? zoneId !== '' && zoneCameraCount > 0 : groupCameraIds.length > 0;

  function handleApply(): void {
    if (!canApply) return;
    const cameraIds =
      scope === 'all'
        ? ('all' as const)
        : scope === 'zone'
          ? (camerasData?.items ?? []).filter((c) => c.zoneId === zoneId).map((c) => c.id)
          : groupCameraIds;
    bulkSetFps.mutate({ cameraIds, targetFps: fps });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Bulk inference rate settings"
        title="Bulk inference rate settings"
        className="rounded p-1.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
      >
        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <>
          {/* Click-outside backdrop — plain overlay, not focus-trapping (popover has no destructive action). */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Bulk inference rate"
            className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-bg-surface p-3 shadow-lg"
          >
            <div className="mb-2 text-xs font-semibold text-fg-primary">Bulk inference rate</div>
            <div className="mb-2 flex flex-col gap-1.5 text-xs text-fg-secondary">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="fps-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                All cameras
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="fps-scope" checked={scope === 'zone'} onChange={() => setScope('zone')} />
                This zone
              </label>
              {scope === 'zone' && (
                <select
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  aria-label="Zone"
                  className="ml-5 rounded-md border border-border bg-bg-raised px-1.5 py-1 text-[11px] text-fg-secondary"
                >
                  <option value="">Select a zone…</option>
                  {(zonesData?.items ?? []).map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="fps-scope"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                  disabled={groupCameraIds.length === 0}
                />
                Selected ({groupCameraIds.length})
              </label>
            </div>
            <FpsSegmentedToggle value={fps} onChange={setFps} size="xs" />
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply || bulkSetFps.isPending}
              className="mt-2 w-full rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg disabled:opacity-50"
            >
              {bulkSetFps.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
