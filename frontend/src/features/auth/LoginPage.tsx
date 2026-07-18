import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { authApi } from './api';
import { ApiRequestError } from '@/lib/api/client';
import { useSessionStore } from '@/lib/state/sessionStore';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  totp: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const DEPARTMENT_NAME = import.meta.env.VITE_DEPARTMENT_NAME || 'Police Department';

export function LoginPage(): React.JSX.Element {
  const [needsTotp, setNeedsTotp] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const setSession = useSessionStore((s) => s.setSession);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    document.getElementById('username')?.focus();
  }, []);
  useEffect(() => {
    if (needsTotp) document.getElementById('totp')?.focus();
  }, [needsTotp]);

  const onSubmit = async (values: FormValues): Promise<void> => {
    setServerError(null);
    try {
      const res = await authApi.login(values.username, values.password, values.totp || undefined);
      setSession(res.user, res.sessionExpiresAt);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'TOTP_REQUIRED') {
          setNeedsTotp(true);
          setServerError('Enter your authenticator code to continue.');
          return;
        }
        setServerError(err.message);
        return;
      }
      setServerError('Unable to reach the authentication service.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-fg-primary">{DEPARTMENT_NAME}</h1>
          <p className="mt-1 text-sm text-fg-muted">Crowd Density Operator Console</p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          className="rounded-lg border border-border bg-bg-surface p-6 shadow-lg"
          aria-label="Sign in"
        >
          <div className="mb-4">
            <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-fg-secondary">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-accent"
              {...register('username')}
            />
            {errors.username && (
              <p className="mt-1 text-xs text-severity-critical">{errors.username.message}</p>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-fg-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-accent"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-severity-critical">{errors.password.message}</p>
            )}
          </div>

          {needsTotp && (
            <div className="mb-4">
              <label htmlFor="totp" className="mb-1.5 block text-xs font-medium text-fg-secondary">
                Authenticator code
              </label>
              <input
                id="totp"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm tracking-widest text-fg-primary outline-none focus-visible:border-accent"
                {...register('totp')}
              />
            </div>
          )}

          {serverError && (
            <div role="alert" className="mb-4 rounded-md border border-severity-warning/40 bg-severity-warning/10 px-3 py-2 text-xs text-severity-warning">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-fg-muted">
          No self-registration. Contact your system administrator for access.
          <br />
          Access is logged and audited.
        </p>
      </div>
    </div>
  );
}
