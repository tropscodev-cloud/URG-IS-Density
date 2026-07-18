import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useStepUpStore } from '@/lib/state/stepUpStore';

export function StepUpModal(): React.JSX.Element | null {
  const open = useStepUpStore((s) => s.open);
  const reason = useStepUpStore((s) => s.reason);
  const submitting = useStepUpStore((s) => s.submitting);
  const error = useStepUpStore((s) => s.error);
  const submit = useStepUpStore((s) => s.submit);
  const cancel = useStepUpStore((s) => s.cancel);
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) passwordRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="stepup-title" className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-fg-primary">
          <KeyRound className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 id="stepup-title" className="text-sm font-semibold">
            Confirm your password
          </h2>
        </div>
        <p className="mb-4 text-sm text-fg-secondary">
          This action{reason ? ` (${reason})` : ''} is sensitive and requires re-entering your password.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(password).then(() => setPassword(''));
          }}
        >
          <input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-3 w-full rounded-md border border-border bg-bg-raised px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-accent"
            aria-label="Password"
          />
          {error && (
            <div role="alert" className="mb-3 rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-fg-secondary hover:bg-bg-raised"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !password}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
