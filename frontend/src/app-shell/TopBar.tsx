import { Users, Video, ShieldAlert, Wifi, WifiOff, LogOut, History } from 'lucide-react';
import clsx from 'clsx';
import { useFleetTotals } from '@/features/cameras/useFleetTotals';
import { useAlerts } from '@/features/alerts/api';
import { useWsStore } from '@/lib/state/wsStore';
import { useSessionStore } from '@/lib/state/sessionStore';
import { useTimeStore } from '@/lib/state/timeStore';
import { authApi } from '@/features/auth/api';
import { useClock } from '@/lib/utils/useClock';
import { formatUtcClock, formatLocalWithZone } from '@/lib/utils/time';

const CONNECTION_COPY: Record<string, { label: string; icon: typeof Wifi; tone: string }> = {
  LIVE: { label: 'Live', icon: Wifi, tone: 'text-status-online' },
  CONNECTING: { label: 'Connecting…', icon: Wifi, tone: 'text-severity-warning' },
  RECONNECTING: { label: 'Reconnecting…', icon: WifiOff, tone: 'text-severity-warning' },
  STALE: { label: 'Stale', icon: WifiOff, tone: 'text-severity-warning' },
  OFFLINE: { label: 'Offline', icon: WifiOff, tone: 'text-severity-critical' },
};
// Deliberately not keyed by connectionState — the WebSocket genuinely can be LIVE while the
// operator is scrubbing time-travel (it's still connected, just not what's on screen). This must
// take priority over the real connection state so nobody mistakes a historical view for a live
// one during an active incident.
const HISTORICAL_COPY = { label: 'Historical', icon: History, tone: 'text-accent' };

/**
 * Glanceable live status only — Theme/Kiosk/Reports/Audit/Event log moved to IconRail (see
 * ShellLayout.tsx). Those are consoles opened deliberately and infrequently; cramming them into
 * this same row alongside live numbers was overflowing/wrapping the bar in practice.
 */
export function TopBar(): React.JSX.Element {
  const totals = useFleetTotals();
  // Same {status:'OPEN'} query AlertTray/Sidebar/KioskMode/MapCanvas already fetch — filtering to
  // CRITICAL client-side (rather than a second `severity=CRITICAL&status=OPEN` query) means
  // TanStack Query shares one cache entry/one network request across every consumer, instead of
  // maintaining two distinct queries that both get invalidated/refetched independently.
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });
  const connectionState = useWsStore((s) => s.connectionState);
  const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
  const clockSkewMs = useWsStore((s) => s.clockSkewMs);
  const isHistorical = useTimeStore((s) => s.isHistorical);
  const user = useSessionStore((s) => s.user);
  const clearSession = useSessionStore((s) => s.clearSession);

  const now = useClock();
  const conn = isHistorical ? HISTORICAL_COPY : (CONNECTION_COPY[connectionState] ?? CONNECTION_COPY.OFFLINE!);
  const ConnIcon = conn.icon;
  const criticalCount = openAlerts?.items.filter((a) => a.severity === 'CRITICAL').length ?? 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center p-2">
      <div className="pointer-events-auto flex w-full max-w-[1400px] items-center gap-4 rounded-lg border border-border bg-bg-surface/95 px-4 py-2 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1.5 text-fg-primary">
          <ShieldAlert className="h-4 w-4 text-accent" aria-hidden="true" />
          <span className="hidden text-xs font-semibold sm:inline">{import.meta.env.VITE_DEPARTMENT_NAME || 'Operator Console'}</span>
        </div>

        <div className="h-5 w-px bg-border" />

        <Metric icon={Users} label="Live headcount" value={totals.totalHeadcount.toLocaleString()} />
        <Metric icon={Video} label="Cameras" value={`${totals.activeCount}/${totals.totalCount}`} />
        {totals.excludedCount > 0 && (
          <span className="text-[11px] text-fg-muted">{totals.excludedCount} excluded from totals</span>
        )}
        <Metric
          icon={ShieldAlert}
          label="Critical alerts"
          value={String(criticalCount)}
          tone={criticalCount > 0 ? 'text-severity-critical' : undefined}
          pulse={criticalCount > 0}
        />

        <div className="h-5 w-px bg-border" />

        <div
          className={clsx('flex items-center gap-1.5 text-xs', conn.tone)}
          title={isHistorical ? 'Viewing a past moment — not the live feed' : `WebSocket: ${conn.label}`}
        >
          <ConnIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{conn.label}</span>
          {!isHistorical && connectionState === 'RECONNECTING' && reconnectAttempt > 0 && (
            <span className="font-mono text-[10px]">#{reconnectAttempt}</span>
          )}
        </div>
        {Math.abs(clockSkewMs) > 30_000 && (
          <span className="rounded bg-severity-warning/10 px-1.5 py-0.5 text-[10px] text-severity-warning">
            Clock skew {Math.round(clockSkewMs / 1000)}s
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden flex-col items-end leading-tight md:flex">
            <span className="font-mono text-[11px] tabular-nums text-fg-secondary">{formatUtcClock(now)}</span>
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">{formatLocalWithZone(now, 'HH:mm:ss')}</span>
          </div>

          {user && (
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <div className="text-right leading-tight">
                <div className="text-xs font-medium text-fg-primary">{user.displayName}</div>
                <div className="text-[10px] uppercase tracking-wide text-fg-muted">{user.role}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void authApi.logout();
                  clearSession();
                }}
                title="Sign out"
                className="rounded-md border border-border p-1.5 text-fg-secondary hover:bg-bg-raised"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
  pulse,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: string;
  pulse?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon className={clsx('h-3.5 w-3.5', tone ?? 'text-fg-muted')} aria-hidden="true" />
      <span key={value} className={clsx('value-crossfade font-mono text-xs tabular-nums', tone ?? 'text-fg-primary')}>
        {value}
      </span>
      {pulse && <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-severity-critical" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </div>
  );
}
