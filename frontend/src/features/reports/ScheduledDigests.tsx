import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useReportSchedules, useCreateReportSchedule } from './api';
import { useZones } from '@/features/cameras/api';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import { formatLocalWithZone } from '@/lib/utils/time';

export function ScheduledDigests(): React.JSX.Element {
  const { data: schedules } = useReportSchedules();
  const { data: zones } = useZones();
  const createSchedule = useCreateReportSchedule();

  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [zoneIds, setZoneIds] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState('');

  async function handleCreate(): Promise<void> {
    const recipientList = recipients.split(',').map((r) => r.trim()).filter(Boolean);
    if (!name || recipientList.length === 0) return;
    const schedule = await createSchedule.mutateAsync({ name, cadence, zoneIds: Array.from(zoneIds), recipients: recipientList });
    auditQueue.enqueue('report.schedule_create', null, { name, cadence });
    toast({ severity: 'success', title: 'Digest scheduled', message: `${schedule.name} will run ${schedule.cadence}.` });
    setName('');
    setRecipients('');
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-border p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">New scheduled digest</h3>
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Digest name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
          />
          <select value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')} className="rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div className="my-2 flex flex-wrap gap-1.5">
          {(zones?.items ?? []).map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() =>
                setZoneIds((s) => {
                  const next = new Set(s);
                  if (next.has(z.id)) next.delete(z.id);
                  else next.add(z.id);
                  return next;
                })
              }
              className={`rounded border px-2 py-0.5 text-[11px] ${zoneIds.has(z.id) ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-raised'}`}
            >
              {z.name}
            </button>
          ))}
        </div>
        <input
          placeholder="Recipient emails, comma separated"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          className="mb-2 w-full rounded-md border border-border bg-bg-raised px-2 py-1 text-xs text-fg-primary outline-none focus-visible:border-accent"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={createSchedule.isPending}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
        >
          {createSchedule.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          Schedule digest
        </button>
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Active schedules</h3>
        {(schedules?.items ?? []).length === 0 && <p className="text-xs text-fg-muted">No scheduled digests yet.</p>}
        <ul className="space-y-1.5">
          {(schedules?.items ?? []).map((s) => (
            <li key={s.id} className="rounded-md border border-border p-2 text-xs">
              <span className="font-medium text-fg-primary">{s.name}</span> — {s.cadence} — {s.recipients.join(', ')}
              <p className="text-[10px] text-fg-muted">Created by {s.createdBy} · {formatLocalWithZone(s.createdAt)}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-fg-muted">Delivery is handled by the backend on the configured cadence; this UI only manages configuration.</p>
    </div>
  );
}
