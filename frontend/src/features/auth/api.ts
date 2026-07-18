import { api } from '@/lib/api/client';
import type { User } from '@/types';

export const authApi = {
  login: (username: string, password: string, totp?: string) =>
    api.post<{ user: User; sessionExpiresAt: string }>(
      '/auth/login',
      { username, password, totp },
      { skipAuthRedirect: true },
    ),
  logout: () => api.post<void>('/auth/logout'),
  session: () => api.get<{ user: User; sessionId: string }>('/auth/session', { skipAuthRedirect: true }),
  refresh: () => api.post<void>('/auth/refresh'),
};
