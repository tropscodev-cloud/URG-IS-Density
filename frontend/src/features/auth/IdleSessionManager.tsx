import { useEffect } from 'react';
import { useSessionStore } from '@/lib/state/sessionStore';
import { authApi } from './api';

export const IDLE_TIMEOUT_MS = 15 * 60_000;
export const WARNING_BEFORE_MS = 60_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

// Module-level (outside React) so both the passive activity listeners and the imperative
// "stay signed in" action can touch the same clock without prop-drilling a ref through the tree.
let lastActivityAt = Date.now();

export function markActivity(): void {
  lastActivityAt = Date.now();
}

/** Headless: tracks activity, drives the idle-warning → auto-lock lifecycle. Mount once, inside
 * the authenticated shell only. */
export function IdleSessionManager(): null {
  const locked = useSessionStore((s) => s.locked);
  const idleWarningVisible = useSessionStore((s) => s.idleWarningVisible);
  const setIdleWarning = useSessionStore((s) => s.setIdleWarning);
  const lock = useSessionStore((s) => s.lock);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, markActivity, { passive: true });
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActivity);
    };
  }, []);

  useEffect(() => {
    if (locked) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityAt;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        lock('idle');
      } else if (elapsed >= IDLE_TIMEOUT_MS - WARNING_BEFORE_MS) {
        if (!idleWarningVisible) setIdleWarning(true);
      } else if (idleWarningVisible) {
        setIdleWarning(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [locked, idleWarningVisible, setIdleWarning, lock]);

  return null;
}

export function resetIdleAndStaySignedIn(): void {
  markActivity();
  useSessionStore.getState().setIdleWarning(false);
  void authApi.refresh().catch(() => {
    // If refresh fails the session is likely already gone server-side; the next authenticated
    // request will surface the 401 and the global session-revoked bridge will lock the UI.
  });
}
