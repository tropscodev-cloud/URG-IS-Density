import clsx from 'clsx';
import { useAlerts } from './api';
import { relativeAge, formatLocalWithZone } from '@/lib/utils/time';
import type { Alert } from '@/types';

const STATUS_TONE: Record<Alert['status'], string> = {
  OPEN: 'text-severity-critical',
  ACKED: 'text-severity-warning',
  RESOLVED: 'text-status-online',
  ESCALATED: 'text-severity-critical',
};

export function CameraAlertHistory({ cameraId }: { cameraId: string }): React.JSX.Element {
  const { data, isLoading } = useAlerts({ cameraId });
  const items = [...(data?.items ?? [])].sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));

  if (isLoading) return <p className="p-3 text-xs text-fg-muted">Loading alert history…</p>;
  if (items.length === 0) return <p className="p-3 text-xs text-fg-muted">No alerts recorded for this camera.</p>;

  return (
    <ul className="divide-y divide-border">
      {items.slice(0, 20).map((a) => (
        <li key={a.id} className="px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-primary">
              {a.severity} · {a.metric}
            </span>
            <span className={clsx('font-medium', STATUS_TONE[a.status])}>{a.status}</span>
          </div>
          <p className="text-[11px] text-fg-muted">
            Raised {relativeAge(a.raisedAt)} ({formatLocalWithZone(a.raisedAt)}) — observed {(a.observedValue * 100).toFixed(0)}%
          </p>
          {a.ackedBy && (
            <p
              className="mt-0.5 truncate text-[11px] text-fg-secondary"
              title={a.ackNote ?? undefined}
            >
              Acked by {a.ackedBy} {a.ackedAt && `at ${formatLocalWithZone(a.ackedAt)}`}
              {a.ackNote && ` — "${a.ackNote}"`}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
