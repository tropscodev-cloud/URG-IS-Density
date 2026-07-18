import { useCallback, useEffect, useSyncExternalStore, useState } from 'react';
import { getWsManager } from './WebSocketManager';
import type { CameraMetrics } from '@/types';

/** Fine-grained subscription to a single camera's live metrics — re-renders only this consumer. */
export function useCameraMetrics(cameraId: string | null): CameraMetrics | undefined {
  const manager = getWsManager();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!cameraId) return () => {};
      return manager.subscribeCamera(cameraId, onStoreChange);
    },
    [manager, cameraId],
  );
  const getSnapshot = useCallback(() => (cameraId ? manager.getLatest(cameraId) : undefined), [manager, cameraId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Increments whenever any subscribed camera updates (rAF-batched, ≤4Hz/camera upstream). */
export function useAnyMetricsTick(): number {
  const manager = getWsManager();
  const [tick, setTick] = useState(0);
  useEffect(() => manager.subscribeAny(() => setTick((t) => t + 1)), [manager]);
  return tick;
}

/** Increments at ≤1Hz — the cadence contract for heatmap/cluster aggregation layers. */
export function useHeatmapTick(): number {
  const manager = getWsManager();
  const [tick, setTick] = useState(0);
  useEffect(() => manager.subscribeHeatmap(() => setTick((t) => t + 1)), [manager]);
  return tick;
}
