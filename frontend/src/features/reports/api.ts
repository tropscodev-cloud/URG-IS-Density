import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { ReportJob, ReportRequest, ReportSchedule } from '@/types';

export function useGenerateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: ReportRequest) => api.post<ReportJob>('/reports', req),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.reports }),
  });
}

export function useReportJob(id: string | null) {
  return useQuery({
    queryKey: queryKeys.reportJob(id ?? ''),
    queryFn: () => api.get<ReportJob>(`/reports/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'DONE' || status === 'FAILED' ? false : 1000;
    },
  });
}

export function useReportData<T = unknown>(job: ReportJob | undefined) {
  return useQuery({
    queryKey: ['report-data', job?.id],
    queryFn: () => api.get<T>(`/reports/${job!.id}/data`),
    enabled: job?.status === 'DONE',
  });
}

export function useMyReports() {
  return useQuery({
    queryKey: queryKeys.reports,
    queryFn: () => api.get<{ items: ReportJob[] }>('/reports'),
    refetchInterval: 5000,
  });
}

export interface EvidenceBundleRequest {
  alertId?: string;
  cameraId: string;
  at: string;
}

export function useGenerateEvidenceBundle() {
  return useMutation({
    mutationFn: (req: EvidenceBundleRequest) => api.post<ReportJob>('/reports/evidence-bundle', req),
  });
}

export function useReportSchedules() {
  return useQuery({
    queryKey: queryKeys.reportSchedules,
    queryFn: () => api.get<{ items: ReportSchedule[] }>('/reports/schedules'),
  });
}

export function useCreateReportSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<ReportSchedule, 'id' | 'createdBy' | 'createdAt'>) =>
      api.put<ReportSchedule>('/reports/schedules', req),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.reportSchedules }),
  });
}
