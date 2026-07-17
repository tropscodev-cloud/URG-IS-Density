import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface ChatSource {
  cameraId: string;
  metric: string;
  from: string;
  to: string;
  value: number;
}

export interface ChatQueryContext {
  cameraIds?: string[];
  zoneIds?: string[];
  from?: string;
  to?: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  grounded: boolean;
}

export function useChatQuery() {
  return useMutation({
    mutationFn: (payload: { message: string; context?: ChatQueryContext }) => api.post<ChatResponse>('/chat/query', payload),
  });
}
