import { useCameraMetrics } from '@/lib/ws/hooks';
import type { Camera, CameraMetrics } from '@/types';

/**
 * Live-first, REST-fallback metrics for one camera. Row-level UI should prefer `camera.status`
 * (server-authoritative, patched live by WsBridge) over deriving staleness client-side — this
 * hook only resolves *which numbers* to show, not the health state.
 */
export function useCameraLiveMetrics(camera: Camera | null | undefined): CameraMetrics | null {
  const live = useCameraMetrics(camera?.id ?? null);
  return live ?? camera?.lastMetrics ?? null;
}
