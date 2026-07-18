import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  session: ['session'] as const,
  // 'camera' (singular) is a deliberately distinct top-level key from 'cameras' (plural, list
  // queries) — WsBridge patches list queries and the single-camera query separately by key
  // prefix, and a shared prefix would make one `setQueriesData` call misfire on the other shape.
  cameras: (filters?: Record<string, string | undefined>) => ['cameras', filters ?? {}] as const,
  camera: (id: string) => ['camera', id] as const,
  zones: ['zones'] as const,
  buildings: ['buildings'] as const,
  alerts: (filters?: Record<string, string | undefined>) => ['alerts', filters ?? {}] as const,
  thresholds: ['thresholds'] as const,
  history: (cameraId: string, from: string, to: string, resolution?: string) =>
    ['history', cameraId, from, to, resolution ?? 'auto'] as const,
  historyState: (atIso: string) => ['history-state', atIso] as const,
  alertEvents: (from?: string, to?: string, cameraId?: string) => ['alert-events', from, to, cameraId] as const,
  auditEvents: (filters: Record<string, string | undefined>) => ['audit-events', filters] as const,
  reports: ['reports'] as const,
  reportJob: (id: string) => ['report-job', id] as const,
  reportSchedules: ['report-schedules'] as const,
};
