import { useEffect, useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/lib/state/sessionStore';
import { api, ApiRequestError } from '@/lib/api/client';
import { authApi } from './api';
import { markActivity } from './IdleSessionManager';

const REASON_COPY: Record<string, string> = {
  idle: "You've been inactive. Re-enter your password to resume.",
  revoked: 'Your session ended (signed in elsewhere, or it expired). Sign in again.',
  manual: 'The console is locked. Re-enter your password to resume.',
};

export function LockScreen(): React.JSX.Element {
  const user = useSessionStore((s) => s.user);
  const lockReason = useSessionStore((s) => s.lockReason);
  const unlock = useSessionStore((s) => s.unlock);
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);

  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(user?.username ?? '');
  const [needsFullLogin, setNeedsFullLogin] = useState(!user);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.getElementById(needsFullLogin ? 'lock-username' : 'lock-password')?.focus();
  }, [needsFullLogin]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (needsFullLogin) {
        const res = await authApi.login(username, password);
        setSession(res.user, res.sessionExpiresAt);
        markActivity();
        return;
      }
      await api.post('/auth/step-up', { password });
      markActivity();
      unlock();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401 && !needsFullLogin) {
        clearSession();
        setNeedsFullLogin(true);
        setError('Your session fully expired. Please sign in again.');
        return;
      }
      setError(err instanceof ApiRequestError ? err.message : 'Unable to verify. Try again.');
    } finally {
      setSubmitting(false);
      setPassword('');
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2 text-fg-primary">
          <Lock className="h-5 w-5 text-accent" aria-hidden="true" />
          <h1 className="text-sm font-semibold">Console locked</h1>
        </div>
        <p className="mb-4 text-sm text-fg-secondary">
          {REASON_COPY[lockReason ?? 'manual']}
          {!needsFullLogin && user && (
            <>
              {' '}
              Signed in as <span className="font-medium text-fg-primary">{user.displayName}</span>.
            </>
          )}
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          {needsFullLogin && (
            <div className="mb-3">
              <label htmlFor="lock-username" className="mb-1.5 block text-xs font-medium text-fg-secondary">
                Username
              </label>
              <input
                id="lock-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-accent"
              />
            </div>
          )}
          <div className="mb-4">
            <label htmlFor="lock-password" className="mb-1.5 block text-xs font-medium text-fg-secondary">
              Password
            </label>
            <input
              id="lock-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-accent"
            />
          </div>
          {error && (
            <div role="alert" className="mb-4 rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !password}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {needsFullLogin ? 'Sign in' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
