import { useTimeStore } from '@/lib/state/timeStore';
import { useHistoricalState } from '@/features/timeline/api';
import { useCameraMetrics } from '@/lib/ws/hooks';
import type { Camera, CameraMetrics, CameraStatus } from '@/types';

export interface EffectiveCamera {
  status: CameraStatus;
  metrics: CameraMetrics | null;
  /** True when this reflects a scrubbed-to moment rather than the live feed. */
  isHistorical: boolean;
}

/**
 * Resolves a camera's status+metrics from either the live WebSocket feed or a scrubbed-to
 * historical snapshot, depending on time-travel state — the single seam every status-aware
 * component (sidebar rows, map markers, detail panel) reads through so scrubbing the timeline
 * transparently repaints the whole app.
 */
export function useEffectiveCamera(camera: Camera | null | undefined): EffectiveCamera {
  const isHistorical = useTimeStore((s) => s.isHistorical);
  const viewingAtMs = useTimeStore((s) => s.viewingAtMs);
  const live = useCameraMetrics(camera?.id ?? null);
  const { data: historical } = useHistoricalState(viewingAtMs, isHistorical && !!camera);

  if (isHistorical) {
    const entry = historical?.cameras.find((c) => c.cameraId === camera?.id);
    return {
      status: entry?.status ?? camera?.status ?? 'OFFLINE',
      metrics: entry?.metrics ?? null,
      isHistorical: true,
    };
  }

  return {
    status: camera?.status ?? 'OFFLINE',
    metrics: live ?? camera?.lastMetrics ?? null,
    isHistorical: false,
  };
}
