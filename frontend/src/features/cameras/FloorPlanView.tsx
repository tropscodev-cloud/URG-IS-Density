import { useMemo } from 'react';
import { Modal } from '@/lib/ui/Modal';
import { useCameras } from './api';
import { useBuildings } from './api';
import { CameraStatusBadge } from './CameraStatusBadge';
import { useCameraLiveMetrics } from './useCameraLiveMetrics';
import { useSelectionStore } from '@/lib/state/selectionStore';
import clsx from 'clsx';
import type { Camera } from '@/types';

interface Props {
  floorPlanId: string;
  onClose: () => void;
}

export function FloorPlanView({ floorPlanId, onClose }: Props): React.JSX.Element {
  const { data: cameras } = useCameras();
  const { data: buildings } = useBuildings();

  const floorPlan = useMemo(() => {
    for (const b of buildings?.items ?? []) {
      const fp = b.floorPlans.find((f) => f.id === floorPlanId);
      if (fp) return fp;
    }
    return null;
  }, [buildings, floorPlanId]);

  const camerasOnPlan = useMemo(
    () => (cameras?.items ?? []).filter((c) => c.floorPlan?.floorPlanId === floorPlanId),
    [cameras, floorPlanId],
  );

  return (
    <Modal title={floorPlan?.name ?? 'Floor plan'} onClose={onClose} widthClassName="max-w-3xl">
      <div className="relative overflow-hidden rounded-md border border-border bg-bg-canvas">
        {floorPlan ? (
          <img src={floorPlan.imageUrl} alt={floorPlan.name} className="block w-full" />
        ) : (
          <div className="p-8 text-center text-xs text-fg-muted">Floor plan image unavailable.</div>
        )}
        {camerasOnPlan.map((c) => (
          <FloorPlanMarker key={c.id} camera={c} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-fg-muted">
        Indoor cameras without GPS coordinates are placed here using their configured relative position rather than on the map.
      </p>
    </Modal>
  );
}

function FloorPlanMarker({ camera }: { camera: Camera }): React.JSX.Element | null {
  const metrics = useCameraLiveMetrics(camera);
  const selectCamera = useSelectionStore((s) => s.selectCamera);
  if (!camera.floorPlan) return null;

  return (
    <button
      type="button"
      onClick={() => selectCamera(camera.id)}
      className="group absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${camera.floorPlan.x * 100}%`, top: `${camera.floorPlan.y * 100}%` }}
      title={camera.name}
    >
      <span
        className={clsx(
          'block h-3 w-3 rounded-full border-2 border-white/80 shadow',
          camera.status === 'ONLINE' && 'bg-status-online',
          camera.status === 'DEGRADED' && 'bg-status-degraded',
          camera.status === 'OFFLINE' && 'bg-status-offline',
          camera.status === 'RECONNECTING' && 'bg-status-reconnecting',
          camera.status === 'MISCONFIGURED' && 'bg-status-misconfigured',
          camera.status === 'DISABLED' && 'bg-status-disabled',
        )}
      />
      <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-bg-surface px-1.5 py-1 text-[10px] text-fg-primary shadow-lg group-hover:block">
        {camera.name} · {metrics ? `${metrics.headcount} people` : <CameraStatusBadge status={camera.status} />}
      </span>
    </button>
  );
}
