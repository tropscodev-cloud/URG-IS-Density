import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Users, Video, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { useFleetTotals } from '@/features/cameras/useFleetTotals';
import { useAlerts } from '@/features/alerts/api';
import { useSessionStore } from '@/lib/state/sessionStore';

const DEPARTMENT_NAME = import.meta.env.VITE_DEPARTMENT_NAME || 'Operator Console';

/**
 * Landing tab (/) — a glanceable system-health summary before diving into the operator console.
 * Deliberately reads through the *same* hooks the console itself uses (useFleetTotals, useAlerts)
 * rather than issuing its own queries — TanStack Query dedupes identical query keys across
 * mounted components, so this adds zero extra network traffic whether or not /map is also mounted
 * (it isn't, while this tab is active, but the point holds regardless).
 */
export function HomePage(): React.JSX.Element {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const totals = useFleetTotals();
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });
  const criticalCount = openAlerts?.items.filter((a) => a.severity === 'CRITICAL').length ?? 0;

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-bg-canvas px-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(circle at 50% 35%, rgb(var(--color-accent) / 0.15), transparent 60%)',
        }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-fg-primary">{DEPARTMENT_NAME}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {user ? `Welcome back, ${user.displayName}.` : 'Crowd Density Command Center'}
        </p>

        <div className="mt-10 grid grid-cols-3 gap-4">
          <StatTile icon={Video} label="Active Cameras" value={`${totals.activeCount}/${totals.totalCount}`} />
          <StatTile icon={Users} label="Global Headcount" value={totals.totalHeadcount.toLocaleString()} />
          <StatTile
            icon={ShieldAlert}
            label="Critical Alerts"
            value={String(criticalCount)}
            tone={criticalCount > 0 ? 'text-severity-critical' : undefined}
          />
        </div>

        <button
          type="button"
          onClick={() => navigate('/map')}
          className="mt-10 flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:brightness-110"
        >
          Enter Operator Console
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Video;
  label: string;
  value: string;
  tone?: string;
}): React.JSX.Element {
  return (
    <div className="flex w-32 flex-col items-center gap-1.5 rounded-xl border border-border bg-bg-card px-4 py-4">
      <Icon className={clsx('h-4 w-4', tone ?? 'text-fg-muted')} aria-hidden="true" />
      <span key={value} className={`value-crossfade font-mono text-xl tabular-nums ${tone ?? 'text-fg-primary'}`}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</span>
    </div>
  );
}
