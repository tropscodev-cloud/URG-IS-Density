import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { Alert, Paginated, ThresholdConfig } from '@/types';

function alertMatchesFilters(alert: Alert, filters: Record<string, string | undefined>): boolean {
  if (filters.status && alert.status !== filters.status) return false;
  if (filters.severity && alert.severity !== filters.severity) return false;
  if (filters.zoneId && alert.zoneId !== filters.zoneId) return false;
  if (filters.cameraId && alert.cameraId !== filters.cameraId) return false;
  return true;
}

/**
 * Writes the mutation's own response directly into every cached alerts query, instead of relying
 * solely on invalidateQueries' background refetch. This matters for acking a CRITICAL alert
 * specifically: with the ambient simulation realistically raising alerts continuously (by
 * design — see ARCHITECTURE.md), WS 'alert' events fire invalidateQueries very frequently too,
 * and an out-of-order refetch response can occasionally clobber a just-invalidated cache with a
 * stale one, leaving an already-acked alert visibly "still open" for as long as several seconds.
 * A direct, synchronous patch from the authoritative response can't lose that race.
 */
function patchAlertInCache(queryClient: QueryClient, updated: Alert): void {
  // Iterate matching queries manually (rather than setQueriesData's single-arg updater) — each
  // alerts query's own filter object lives in its queryKey, and only "does this alert still
  // belong under *this specific* query's filters" tells us whether to update-in-place or remove.
  const queries = queryClient.getQueryCache().findAll({ queryKey: ['alerts'], exact: false });
  for (const query of queries) {
    const filters = (query.queryKey[1] ?? {}) as Record<string, string | undefined>;
    const matches = alertMatchesFilters(updated, filters);
    queryClient.setQueryData<Paginated<Alert>>(query.queryKey, (old) => {
      if (!old) return old;
      const exists = old.items.some((a) => a.id === updated.id);
      if (matches) {
        return { ...old, items: exists ? old.items.map((a) => (a.id === updated.id ? updated : a)) : [updated, ...old.items] };
      }
      return exists ? { ...old, items: old.items.filter((a) => a.id !== updated.id) } : old;
    });
  }
}

export type AlertFilters = {
  status?: string;
  severity?: string;
  zoneId?: string;
  cameraId?: string;
};

function toQueryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useAlerts(filters: AlertFilters = {}) {
  return useQuery({
    queryKey: queryKeys.alerts(filters),
    queryFn: () => api.get<Paginated<Alert>>(`/alerts${toQueryString(filters)}`),
    refetchInterval: 15_000,
  });
}

export function useThresholds() {
  return useQuery({
    queryKey: queryKeys.thresholds,
    queryFn: () => api.get<Paginated<ThresholdConfig>>('/thresholds').then((r) => r.items),
  });
}

export function useAckAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => api.post<Alert>(`/alerts/${id}/ack`, { note }),
    onSuccess: (updated) => {
      patchAlertInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useBulkAckAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ alertIds, note }: { alertIds: string[]; note?: string }) =>
      api.post<{ results: Array<{ id: string; ok: boolean; error?: string }> }>('/alerts/bulk-ack', {
        alertIds,
        note,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useResolveAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Alert>(`/alerts/${id}/resolve`),
    onSuccess: (updated) => {
      patchAlertInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useEscalateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Alert>(`/alerts/${id}/escalate`),
    onSuccess: (updated) => {
      patchAlertInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useSetThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Omit<ThresholdConfig, 'updatedBy' | 'updatedAt'>) =>
      api.put<ThresholdConfig>('/thresholds', config),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.thresholds }),
  });
}
