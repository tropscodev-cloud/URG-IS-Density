import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useSessionStore } from '@/lib/state/sessionStore';
import { resetIdleAndStaySignedIn, WARNING_BEFORE_MS } from './IdleSessionManager';

export function IdleWarningModal(): React.JSX.Element | null {
  const visible = useSessionStore((s) => s.idleWarningVisible);
  const [remainingS, setRemainingS] = useState(Math.floor(WARNING_BEFORE_MS / 1000));
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (visible) stayButtonRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setRemainingS(Math.floor(WARNING_BEFORE_MS / 1000));
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      const left = Math.max(0, Math.floor(WARNING_BEFORE_MS / 1000) - Math.floor((Date.now() - start) / 1000));
      setRemainingS(left);
    }, 250);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-lg border border-severity-warning/40 bg-bg-surface p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-severity-warning">
          <Clock className="h-5 w-5" aria-hidden="true" />
          <h2 id="idle-warning-title" className="text-sm font-semibold">
            Session about to lock
          </h2>
        </div>
        <p className="mb-4 text-sm text-fg-secondary">
          You've been inactive. The console will lock in{' '}
          <span className="font-mono tabular-nums text-fg-primary">{remainingS}s</span> to protect
          crowd data from unattended viewing.
        </p>
        <button
          ref={stayButtonRef}
          type="button"
          onClick={resetIdleAndStaySignedIn}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:brightness-110"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
