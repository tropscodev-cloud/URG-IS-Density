import { X, Bell } from 'lucide-react';
import { useToastStore } from '@/lib/state/toastStore';
import { formatClock } from '@/lib/utils/time';
import { Portal } from '@/lib/ui/Portal';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function EventLogDrawer({ open, onClose }: Props): React.JSX.Element | null {
  const eventLog = useToastStore((s) => s.eventLog);
  if (!open) return null;

  return (
    <Portal>
      {/* pointer-events-none on the wrapper, re-enabled per child — an empty div still
          intercepts hit-testing across its whole `inset-0` box even with no visible background,
          which would swallow clicks on the icon rail otherwise (same pattern TopBar.tsx uses). */}
      <div className="pointer-events-none fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="event-log-title">
        {/* left-12, not inset-0 — must not cover the icon rail (w-12), or its buttons become
            unclickable while a panel is open, defeating "click a different rail icon to switch
            panels" (mutual exclusivity is otherwise handled in ShellLayout's openPanel state). */}
        <button
          type="button"
          aria-label="Close event log"
          onClick={onClose}
          className="pointer-events-auto absolute inset-y-0 left-12 right-0 bg-black/40"
        />
        <div
          className="pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-border bg-bg-surface shadow-2xl motion-safe:animate-[slide-in-right_var(--motion-slow)_var(--ease-standard)]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="event-log-title" className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
              <Bell className="h-4 w-4" aria-hidden="true" />
              Event log
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:bg-bg-raised">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="card-scroll overflow-hidden rounded-[14px] border border-hairline/[0.07] bg-bg-card">
              {eventLog.length === 0 ? (
                <p className="p-4 text-xs text-fg-muted">No notifications this session.</p>
              ) : (
                <ul>
                  {eventLog.map((t, i) => (
                    <li
                      key={t.id}
                      className={clsx(
                        'px-3 py-2.5',
                        i !== eventLog.length - 1 && 'border-b border-hairline/[0.07]',
                        !t.read && 'bg-scrim/[0.04]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-fg-primary">{t.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-fg-muted">{formatClock(t.createdAt)}</span>
                      </div>
                      {t.message && <p className="mt-0.5 text-xs text-fg-muted">{t.message}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
