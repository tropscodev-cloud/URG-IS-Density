import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { AuditEvent, Paginated } from '@/types';

export type AuditFilters = {
  user?: string;
  action?: string;
  cameraId?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

function toQueryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useAuditEvents(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: queryKeys.auditEvents(filters),
    queryFn: () => api.get<Paginated<AuditEvent>>(`/audit/events${toQueryString(filters)}`),
  });
}

export function auditCsvExportUrl(filters: AuditFilters): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  return `${base}/audit/events.csv${toQueryString(filters)}`;
}
