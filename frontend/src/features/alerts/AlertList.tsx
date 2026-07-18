import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { useAlerts, useAckAlert, useBulkAckAlerts } from './api';
import { useCameras, useZones } from '@/features/cameras/api';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { relativeAge } from '@/lib/utils/time';
import { auditQueue } from '@/lib/audit/auditQueue';
import { useHasPermission } from '@/features/auth/RoleGate';
import { EvidenceBundleButton } from '@/features/reports/EvidenceBundleButton';
import { dedupAlerts } from './dedup';
import type { Alert } from '@/types';

const SEVERITY_CLASS: Record<Alert['severity'], string> = {
  INFO: 'border-severity-info/30 text-severity-info',
  WARNING: 'border-severity-warning/30 text-severity-warning',
  CRITICAL: 'border-severity-critical/30 text-severity-critical',
};

export function AlertList(): React.JSX.Element {
  const { data } = useAlerts({ status: 'OPEN' });
  const items = useMemo(() => dedupAlerts(data?.items ?? []), [data]);

  if (items.length === 0) {
    return <p className="p-4 text-xs text-fg-muted">No open alerts.</p>;
  }

  return (
    <ul>
      {items.map((item) =>
        item.kind === 'storm' ? (
          <StormCard key={`storm-${item.zoneId}`} group={item} />
        ) : (
          <AlertCard key={item.alert.id} alert={item.alert} />
        ),
      )}
    </ul>
  );
}

function useCameraName(): (id: string) => string {
  const { data: cameras } = useCameras();
  return (id: string) => cameras?.items.find((c) => c.id === id)?.name ?? id;
}

function AlertCard({ alert }: { alert: Alert }): React.JSX.Element {
  const ack = useAckAlert();
  const selectCamera = useSelectionStore((s) => s.selectCamera);
  const canAck = useHasPermission('ackAlertWarning');
  const cameraName = useCameraName();
  const [note, setNote] = useState('');

  async function handleAck(): Promise<void> {
    if (alert.severity === 'CRITICAL' && !note.trim()) return;
    await ack.mutateAsync({ id: alert.id, note: note || undefined });
    auditQueue.enqueue('alert.ack', alert.cameraId, { alertId: alert.id, severity: alert.severity, note });
  }

  return (
    <li className={clsx('border-b border-border p-3', alert.severity === 'CRITICAL' && 'bg-severity-critical/5')}>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => selectCamera(alert.cameraId)} className="text-xs font-medium text-fg-primary hover:underline">
          {cameraName(alert.cameraId)}
        </button>
        <span className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-semibold', SEVERITY_CLASS[alert.severity])}>{alert.severity}</span>
      </div>
      <p className="text-[11px] text-fg-muted">
        {alert.metric} {(alert.observedValue * 100).toFixed(0)}% (threshold {(alert.thresholdValue * 100).toFixed(0)}%) · {relativeAge(alert.raisedAt)}
      </p>
      {canAck && (
        <div className="mt-2">
          {alert.severity === 'CRITICAL' && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Required: describe your response…"
              rows={2}
              className="mb-1.5 w-full rounded-md border border-border bg-bg-raised px-2 py-1 text-[11px] text-fg-primary outline-none focus-visible:border-accent"
            />
          )}
          <button
            type="button"
            onClick={() => void handleAck()}
            disabled={ack.isPending || (alert.severity === 'CRITICAL' && !note.trim())}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-fg-secondary hover:bg-bg-raised disabled:opacity-50"
          >
            Acknowledge
          </button>
        </div>
      )}
      {alert.severity === 'CRITICAL' && (
        <div className="mt-2">
          <EvidenceBundleButton cameraId={alert.cameraId} at={alert.raisedAt} alertId={alert.id} />
        </div>
      )}
    </li>
  );
}

function StormCard({ group }: { group: { zoneId: string; alerts: Alert[]; worstSeverity: Alert['severity'] } }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { data: zones } = useZones();
  const bulkAck = useBulkAckAlerts();
  const canBulkAck = useHasPermission('bulkAckAlerts');
  const zoneName = zones?.items.find((z) => z.id === group.zoneId)?.name ?? group.zoneId;

  async function handleBulkAck(): Promise<void> {
    const ids = group.alerts.filter((a) => a.status === 'OPEN' && a.severity !== 'CRITICAL').map((a) => a.id);
    if (ids.length === 0) return;
    await bulkAck.mutateAsync({ alertIds: ids, note: 'Bulk-acknowledged during alert storm' });
    auditQueue.enqueue('alert.bulk_ack', null, { zoneId: group.zoneId, count: ids.length });
  }

  return (
    <li className={clsx('border-b border-border p-3', group.worstSeverity === 'CRITICAL' && 'bg-severity-critical/5')}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <Zap className={clsx('h-4 w-4', SEVERITY_CLASS[group.worstSeverity].split(' ')[1])} aria-hidden="true" />
        <span className="flex-1 text-xs font-semibold text-fg-primary">
          {zoneName} — {group.alerts.length} cameras alerting
        </span>
        <span className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-semibold', SEVERITY_CLASS[group.worstSeverity])}>
          {group.worstSeverity}
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />}
      </button>
      <p className="mt-1 text-[11px] text-fg-muted">Grouped as a storm — collapsed to keep the tray readable during a surge.</p>
      {canBulkAck && (
        <button
          type="button"
          onClick={() => void handleBulkAck()}
          disabled={bulkAck.isPending}
          className="mt-2 rounded-md border border-border px-2.5 py-1 text-[11px] text-fg-secondary hover:bg-bg-raised disabled:opacity-50"
        >
          Bulk-acknowledge non-critical
        </button>
      )}
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {group.alerts.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </li>
  );
}
