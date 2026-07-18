import { useEffect, useRef, useState } from 'react';
import { X, Download, Shield } from 'lucide-react';
import { useAuditEvents, auditCsvExportUrl, type AuditFilters } from './api';
import { useSessionStore } from '@/lib/state/sessionStore';
import { formatLocalWithZone } from '@/lib/utils/time';
import { auditQueue } from '@/lib/audit/auditQueue';
import { Portal } from '@/lib/ui/Portal';

interface Props {
  onClose: () => void;
}

export function AuditConsole({ onClose }: Props): React.JSX.Element {
  const user = useSessionStore((s) => s.user);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursorStack[cursorStack.length - 1];
  const { data, isLoading, isError } = useAuditEvents({ ...filters, cursor });

  // Guards against React 18 StrictMode's dev-only mount→cleanup→remount double-invocation of
  // effects: without this, opening the console once recorded two identical audit.console_view
  // events (each with its own clientEventId, so the queue's own retry-idempotency doesn't dedupe
  // them). The ref survives the synthetic unmount/remount StrictMode simulates, so only a real
  // second mount of this component logs a second view.
  const hasLoggedView = useRef(false);
  useEffect(() => {
    if (hasLoggedView.current) return;
    hasLoggedView.current = true;
    auditQueue.enqueue('audit.console_view', null, {});
  }, []);

  function updateFilter(patch: Partial<AuditFilters>): void {
    setFilters((f) => ({ ...f, ...patch }));
    setCursorStack([undefined]);
  }

  const now = new Date();

  return (
    <Portal>
      {/* pointer-events-none on the wrapper, re-enabled per child — an empty div still
          intercepts hit-testing across its whole `inset-0` box even with no visible background,
          which would swallow clicks on the icon rail otherwise (same pattern TopBar.tsx uses). */}
      <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Audit console">
        {/* Backdrop — dims but never hides the map/shell behind it, unlike the previous
            full-screen takeover. Click to close, matching EventLogDrawer's existing pattern.
            left-12, not inset-0 — must not cover the icon rail (w-12), or its buttons become
            unclickable while a panel is open, defeating "click a different rail icon to switch
            panels" (mutual exclusivity is otherwise handled in ShellLayout's openPanel state). */}
        <button
          type="button"
          aria-label="Close audit console"
          onClick={onClose}
          className="pointer-events-auto absolute inset-y-0 left-12 right-0 bg-black/40"
        />
        <div
          className="pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-border bg-bg-surface shadow-2xl motion-safe:animate-[slide-in-right_var(--motion-slow)_var(--ease-standard)]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" aria-hidden="true" />
              <h1 className="text-sm font-semibold text-fg-primary">Audit Console</h1>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted">read-only · append-only</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={auditCsvExportUrl(filters)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-secondary hover:bg-bg-raised"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export CSV
              </a>
              <button type="button" onClick={onClose} aria-label="Close audit console" className="rounded p-1.5 text-fg-muted hover:bg-bg-raised">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* One stacked card containing the filterable table — see Sidebar.tsx for the same
                rounded-card / hairline-border language applied to the zone accordion. */}
            <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-hairline/[0.07] bg-bg-card">
              <div className="flex flex-wrap gap-2 border-b border-hairline/[0.07] p-3">
                <input
                  placeholder="Username…"
                  value={filters.user ?? ''}
                  onChange={(e) => updateFilter({ user: e.target.value || undefined })}
                  className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
                />
                <input
                  placeholder="Action contains…"
                  value={filters.action ?? ''}
                  onChange={(e) => updateFilter({ action: e.target.value || undefined })}
                  className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
                />
                <input
                  placeholder="Camera ID…"
                  value={filters.cameraId ?? ''}
                  onChange={(e) => updateFilter({ cameraId: e.target.value || undefined })}
                  className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
                />
                <input
                  type="datetime-local"
                  value={filters.from?.slice(0, 16) ?? ''}
                  onChange={(e) => updateFilter({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                  className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
                />
                <input
                  type="datetime-local"
                  value={filters.to?.slice(0, 16) ?? ''}
                  onChange={(e) => updateFilter({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                  className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
                />
              </div>

              <div className="card-scroll min-h-0 flex-1 overflow-y-auto">
                {isLoading && <p className="p-4 text-xs text-fg-muted">Loading…</p>}
                {isError && <p className="p-4 text-xs text-severity-critical">Failed to load audit events.</p>}
                {data && data.items.length === 0 && <p className="p-4 text-xs text-fg-muted">No matching events.</p>}
                {data && data.items.length > 0 && (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-bg-card text-[10px] uppercase text-fg-muted">
                      <tr>
                        <th className="px-3 py-2">Time (local)</th>
                        <th className="px-3 py-2">User</th>
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Params</th>
                        <th className="px-3 py-2">Session</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((e) => (
                        <tr key={e.id} className="border-t border-hairline/[0.07] align-top">
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono">{formatLocalWithZone(e.ts)}</td>
                          <td className="px-3 py-1.5">{e.username}</td>
                          <td className="px-3 py-1.5 text-fg-muted">{e.role}</td>
                          <td className="px-3 py-1.5 font-mono text-accent">{e.action}</td>
                          <td className="px-3 py-1.5 font-mono text-fg-muted">{e.target ?? '—'}</td>
                          <td className="max-w-xs truncate px-3 py-1.5 text-fg-muted" title={JSON.stringify(e.params)}>
                            {JSON.stringify(e.params)}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-fg-muted">{e.sessionId.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-hairline/[0.07] px-3 py-2 text-[11px] text-fg-muted">
                <span>
                  Viewed by {user?.username} · {formatLocalWithZone(now.getTime())} — this view is itself audit-logged.
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={cursorStack.length <= 1}
                    onClick={() => setCursorStack((s) => s.slice(0, -1))}
                    className="rounded border border-border px-2 py-1 text-fg-secondary hover:bg-bg-raised disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!data?.nextCursor}
                    onClick={() => setCursorStack((s) => [...s, data?.nextCursor ?? undefined])}
                    className="rounded border border-border px-2 py-1 text-fg-secondary hover:bg-bg-raised disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
