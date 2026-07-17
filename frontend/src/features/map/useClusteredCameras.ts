import { useEffect, useRef, useState } from 'react';
import ClusterWorker from '@/lib/workers/cluster.worker.ts?worker';
import type { OutputFeature } from '@/lib/workers/cluster.worker';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { useHeatmapTick } from '@/lib/ws/hooks';
import type { Camera, CameraMetrics, CameraStatus } from '@/types';

export type { OutputFeature };

export interface Viewport {
  bbox: [number, number, number, number];
  zoom: number;
}

function severityOf(densityRisk: number | undefined): number {
  if (densityRisk === undefined) return 0;
  if (densityRisk >= 0.8) return 2;
  if (densityRisk >= 0.55) return 1;
  return 0;
}

export interface HistoricalOverride {
  cameraId: string;
  status: CameraStatus;
  metrics: CameraMetrics | null;
}

export function useClusteredCameras(
  cameras: Camera[],
  viewport: Viewport,
  historicalByCamera?: Map<string, HistoricalOverride> | null,
): OutputFeature[] {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [features, setFeatures] = useState<OutputFeature[]>([]);
  const heatmapTick = useHeatmapTick();

  useEffect(() => {
    const worker = new ClusterWorker();
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ type: string; requestId: number; features: OutputFeature[] }>) => {
      if (e.data.type === 'result' && e.data.requestId === requestIdRef.current) {
        setFeatures(e.data.features);
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const manager = getWsManager();
    const points = cameras
      .filter((c) => c.lat !== null && c.lng !== null && !c.retired)
      .map((c) => {
        const override = historicalByCamera?.get(c.id);
        const status = override?.status ?? c.status;
        const live = override ? override.metrics ?? undefined : (manager.getLatest(c.id) ?? c.lastMetrics ?? undefined);
        const isUp = status === 'ONLINE' || status === 'DEGRADED';
        return {
          id: c.id,
          lat: c.lat!,
          lng: c.lng!,
          headcount: isUp ? (live?.headcount ?? 0) : 0,
          severity: isUp ? severityOf(live?.densityRisk) : 0,
          status,
        };
      });
    requestIdRef.current += 1;
    worker.postMessage({
      type: 'refresh',
      requestId: requestIdRef.current,
      points,
      bbox: viewport.bbox,
      zoom: viewport.zoom,
    });
    // Data freshness is capped at 1Hz (heatmapTick) by design — see WebSocketManager's heatmap
    // ticker, which also anchors this worker refresh to the same contractual cadence. When
    // scrubbing historical time, historicalByCamera changing (new scrub position) also refreshes.
  }, [cameras, viewport.bbox, viewport.zoom, heatmapTick, historicalByCamera]);

  return features;
}
