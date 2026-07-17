import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useCameras } from '@/features/cameras/api';
import { useAlerts } from '@/features/alerts/api';
import { MapCanvas } from '@/features/map/MapCanvas';
import { VideoPlayer } from '@/features/video/VideoPlayer';
import { CameraStatusBadge } from '@/features/cameras/CameraStatusBadge';
import { ErrorBoundary } from '@/app-shell/ErrorBoundary';
import { useClock } from '@/lib/utils/useClock';
import { formatLocalWithZone, formatUtcClock } from '@/lib/utils/time';
import { useFleetTotals } from '@/features/cameras/useFleetTotals';
import { useEffectiveCamera } from '@/features/cameras/useEffectiveCamera';
import type { Camera } from '@/types';

const GRID_SIZE = 6;
const ROTATE_INTERVAL_MS = 15_000;

interface Props {
  onExit: () => void;
}

export function KioskMode({ onExit }: Props): React.JSX.Element {
  const { data: cameras } = useCameras();
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });
  const totals = useFleetTotals();
  const now = useClock();
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const ranked = useMemo(() => {
    const byCamera = new Map<string, Camera>();
    for (const c of cameras?.items ?? []) byCamera.set(c.id, c);
    const severityRank = (s: string): number => (s === 'CRITICAL' ? 2 : s === 'WARNING' ? 1 : 0);
    const alertingCameraIds = new Map<string, number>();
    for (const a of openAlerts?.items ?? []) {
      const prev = alertingCameraIds.get(a.cameraId) ?? -1;
      const rank = severityRank(a.severity);
      if (rank > prev) alertingCameraIds.set(a.cameraId, rank);
    }
    return Array.from(alertingCameraIds.entries())
      .map(([id, rank]) => ({ camera: byCamera.get(id), rank }))
      .filter((x): x is { camera: Camera; rank: number } => !!x.camera)
      .sort((a, b) => b.rank - a.rank)
      .map((x) => x.camera);
  }, [cameras, openAlerts]);

  const totalPages = Math.max(1, Math.ceil(ranked.length / GRID_SIZE));
  useEffect(() => {
    if (ranked.length <= GRID_SIZE) return;
    const id = setInterval(() => setPage((p) => (p + 1) % totalPages), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ranked.length, totalPages]);

  const visible = ranked.slice(page * GRID_SIZE, page * GRID_SIZE + GRID_SIZE);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-bg-canvas">
      <div className="flex items-center justify-between bg-bg-surface px-4 py-2 text-xs text-fg-secondary">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-fg-primary">Command Center Wall Display</span>
          <span>Live headcount: {totals.totalHeadcount.toLocaleString()}</span>
          <span>Cameras: {totals.activeCount}/{totals.totalCount}</span>
          <span className="text-severity-critical">{ranked.filter((c) => c).length} alerting</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono">{formatUtcClock(now)}</span>
          <span className="font-mono">{formatLocalWithZone(now, 'HH:mm:ss')}</span>
          <button type="button" onClick={onExit} aria-label="Exit kiosk mode" className="rounded p-1 text-fg-muted hover:bg-bg-raised hover:text-fg-primary">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <ErrorBoundary name="Kiosk map" autoRecoverMs={4000}>
          <MapCanvas />
        </ErrorBoundary>
      </div>

      {visible.length > 0 && (
        <div className="grid shrink-0 grid-cols-3 gap-1 bg-black p-1" style={{ height: '32vh' }}>
          {visible.map((camera) => (
            <ErrorBoundary key={camera.id} name={`Kiosk tile ${camera.name}`} compact autoRecoverMs={4000}>
              <KioskTile camera={camera} />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  );
}

function KioskTile({ camera }: { camera: Camera }): React.JSX.Element {
  const effective = useEffectiveCamera(camera);
  return (
    <div className="relative h-full w-full overflow-hidden rounded">
      <VideoPlayer camera={camera} metrics={effective.metrics} />
      <div className="absolute left-1 top-1 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5">
        <span className="text-[10px] font-medium text-white">{camera.name}</span>
        <CameraStatusBadge status={effective.status} variant="dot" />
      </div>
    </div>
  );
}
