import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { Building, Camera, Paginated, Zone } from '@/types';

export type CameraFilters = {
  zoneId?: string;
  status?: string;
  tag?: string;
  q?: string;
};

function toQueryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useCameras(filters: CameraFilters = {}) {
  return useQuery({
    queryKey: queryKeys.cameras(filters),
    queryFn: () => api.get<Paginated<Camera>>(`/cameras${toQueryString(filters)}`),
    refetchInterval: 30_000,
  });
}

export function useCamera(id: string | null) {
  return useQuery({
    queryKey: queryKeys.camera(id ?? ''),
    queryFn: () => api.get<Camera>(`/cameras/${id}`),
    enabled: !!id,
  });
}

export function useZones() {
  return useQuery({
    queryKey: queryKeys.zones,
    queryFn: () => api.get<Paginated<Zone>>('/zones'),
    staleTime: Infinity,
  });
}

export function useBuildings() {
  return useQuery({
    queryKey: queryKeys.buildings,
    queryFn: () => api.get<Paginated<Building>>('/buildings'),
    staleTime: Infinity,
  });
}

export interface CameraFormInput {
  name: string;
  zoneId: string;
  buildingId?: string | null;
  lat: number | null;
  lng: number | null;
  floorPlan?: { floorPlanId: string; x: number; y: number } | null;
  rtspUrl: string;
  rtspUsername?: string;
  rtspPassword?: string;
  bearing: number;
  fovAngle: number;
  range: number;
  tags: string[];
}

export function useCreateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CameraFormInput) => api.post<Camera>('/cameras', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
}

export function usePatchCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CameraFormInput> & { disabled?: boolean } }) =>
      api.patch<Camera>(`/cameras/${id}`, patch),
    onSuccess: (camera) => {
      queryClient.setQueryData(queryKeys.camera(camera.id), camera);
      void queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
}

/** Single-camera inference-rate change — optimistic, rolled back on error (see camera detail
 *  panel's segmented fps control). */
export function useSetCameraFps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetFps }: { id: string; targetFps: number }) =>
      api.patch<Camera>(`/cameras/${id}`, { targetFps }),
    onMutate: async ({ id, targetFps }) => {
      await queryClient.cancelQueries({ queryKey: ['cameras'] });
      await queryClient.cancelQueries({ queryKey: queryKeys.camera(id) });
      const prevLists = queryClient.getQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false });
      const prevSingle = queryClient.getQueryData<Camera>(queryKeys.camera(id));
      queryClient.setQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false }, (old) =>
        old ? { ...old, items: old.items.map((c) => (c.id === id ? { ...c, targetFps } : c)) } : old,
      );
      queryClient.setQueryData<Camera>(queryKeys.camera(id), (old) => (old ? { ...old, targetFps } : old));
      return { prevLists, prevSingle, id };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.prevLists) queryClient.setQueryData(key, data);
      queryClient.setQueryData(queryKeys.camera(ctx.id), ctx.prevSingle);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
}

/** Bulk inference-rate change across an explicit id list or every camera ("all") — see the
 *  sidebar Cameras-section settings popover. */
export function useBulkSetCameraFps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cameraIds, targetFps }: { cameraIds: string[] | 'all'; targetFps: number }) =>
      api.patch<Paginated<Camera>>('/cameras', { cameraIds, targetFps }),
    onMutate: async ({ cameraIds, targetFps }) => {
      await queryClient.cancelQueries({ queryKey: ['cameras'] });
      const prevLists = queryClient.getQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false });
      queryClient.setQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false }, (old) =>
        old
          ? { ...old, items: old.items.map((c) => (cameraIds === 'all' || cameraIds.includes(c.id) ? { ...c, targetFps } : c)) }
          : old,
      );
      return { prevLists };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.prevLists) queryClient.setQueryData(key, data);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
}

export function useRetireCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<Camera>(`/cameras/${id}/retire`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: ({ id, rtspUrl }: { id?: string; rtspUrl: string }) =>
      api.post<{ ok: boolean; snapshotUrl?: string; error?: string }>(`/cameras/${id ?? 'draft'}/test-connection`, {
        rtspUrl,
      }),
  });
}

export function useCheckDuplicate() {
  return useMutation({
    mutationFn: (rtspUrl: string) =>
      api.post<{ duplicate: boolean; cameraId?: string }>('/cameras/check-duplicate', { rtspUrl }),
  });
}

export interface BulkImportRowResult {
  row: number;
  accepted: boolean;
  reason?: string;
  camera?: Camera;
}

export function useBulkImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      commit,
      defaultZoneId,
    }: {
      file: File;
      commit: boolean;
      /** Applied to any row that doesn't specify its own zone — required for PDF/Word/pasted-text sources. */
      defaultZoneId?: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (defaultZoneId) formData.append('defaultZoneId', defaultZoneId);
      return api.upload<{ results: BulkImportRowResult[]; committed: boolean }>(
        `/cameras/bulk-import?commit=${commit}`,
        formData,
      );
    },
    onSuccess: (res) => {
      if (res.committed) void queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
}
