import { useEffect } from 'react';
import { authApi } from './api';
import { useSessionStore } from '@/lib/state/sessionStore';
import { SESSION_REVOKED_EVENT } from '@/lib/api/client';

/** Hydrates session from the httpOnly cookie on load, and wires the global 401 → lock bridge. */
export function useAuthBootstrap(): void {
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);
  const setHydrated = useSessionStore((s) => s.setHydrated);
  const lock = useSessionStore((s) => s.lock);

  useEffect(() => {
    let cancelled = false;
    authApi
      .session()
      .then((res) => {
        if (!cancelled) setSession(res.user, new Date(Date.now() + 12 * 60 * 60_000).toISOString());
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (): void => {
      if (useSessionStore.getState().user) lock('revoked');
    };
    window.addEventListener(SESSION_REVOKED_EVENT, handler);
    return () => window.removeEventListener(SESSION_REVOKED_EVENT, handler);
  }, [lock]);
}
