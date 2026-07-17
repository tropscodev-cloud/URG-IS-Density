import { useQuery } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { Alert, CameraMetrics, CameraStatus } from '@/types';

export interface HistoricalCameraState {
  cameraId: string;
  status: CameraStatus;
  metrics: CameraMetrics | null;
}

export interface HistoricalStateResponse {
  at: string;
  cameras: HistoricalCameraState[];
}

export function fetchHistoricalState(atMs: number): Promise<HistoricalStateResponse> {
  const atIso = new Date(atMs).toISOString();
  return api.get<HistoricalStateResponse>(`/history/state?at=${encodeURIComponent(atIso)}`);
}

export function useHistoricalState(atMs: number, enabled: boolean) {
  const atIso = new Date(atMs).toISOString();
  return useQuery({
    queryKey: queryKeys.historyState(atIso),
    queryFn: () => fetchHistoricalState(atMs),
    enabled,
    staleTime: 60_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 410) && failureCount < 1,
  });
}

export interface MetricPoint {
  cameraId?: string;
  ts?: string;
  headcount?: number;
  headcountAvg?: number;
  headcountPeak?: number;
  densityRisk?: number;
  densityRiskAvg?: number;
  densityRiskPeak?: number;
  flowRate?: number;
  flowRateAvg?: number;
  movementPct?: number;
  movementPctAvg?: number;
  seq?: number;
}

export interface HistoryMetricsResponse {
  items: MetricPoint[];
  resolution: 'raw' | '5m';
}

export function useCameraHistory(cameraId: string | null, fromMs: number, toMs: number, resolution?: 'raw' | '5m') {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  return useQuery({
    queryKey: queryKeys.history(cameraId ?? '', from, to, resolution),
    queryFn: () =>
      api.get<HistoryMetricsResponse>(
        `/history/metrics?cameraId=${cameraId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${resolution ? `&resolution=${resolution}` : ''}`,
      ),
    enabled: !!cameraId,
    staleTime: 30_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 410) && failureCount < 1,
  });
}

export function useAlertEvents(fromMs?: number, toMs?: number, cameraId?: string) {
  const params = new URLSearchParams();
  if (fromMs) params.set('from', new Date(fromMs).toISOString());
  if (toMs) params.set('to', new Date(toMs).toISOString());
  if (cameraId) params.set('cameraId', cameraId);
  return useQuery({
    queryKey: queryKeys.alertEvents(fromMs ? String(fromMs) : undefined, toMs ? String(toMs) : undefined, cameraId),
    queryFn: () => api.get<{ items: Alert[] }>(`/history/alert-events?${params.toString()}`),
    staleTime: 15_000,
  });
}
