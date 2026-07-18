import { CheckCircle2, Info, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { useToastStore, type ToastSeverity } from '@/lib/state/toastStore';
import clsx from 'clsx';

const ICONS: Record<ToastSeverity, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const COLORS: Record<ToastSeverity, string> = {
  info: 'border-severity-info/40 text-severity-info',
  success: 'border-status-online/40 text-status-online',
  warning: 'border-severity-warning/40 text-severity-warning',
  critical: 'border-severity-critical/40 text-severity-critical',
};

const MAX_VISIBLE = 3;

export function ToastHost(): React.JSX.Element {
  const allToasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  // Burst grouping (see WsBridge.tsx) keeps the underlying count low in practice, but this cap is
  // the last line of defense against ever stacking more than a few toasts on screen at once.
  const toasts = allToasts.slice(-MAX_VISIBLE);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-3 top-16 z-[80] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.severity];
        return (
          <div
            key={t.id}
            role={t.severity === 'critical' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-bg-surface p-3 shadow-lg',
              COLORS[t.severity],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-fg-primary">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs text-fg-secondary">{t.message}</p>}
              {t.actionLabel && t.onAction && (
                <button
                  type="button"
                  onClick={t.onAction}
                  className="mt-1.5 text-xs font-medium text-accent hover:underline"
                >
                  {t.actionLabel}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
