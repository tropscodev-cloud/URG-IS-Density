import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useZones, useCameras } from '@/features/cameras/api';
import { useGenerateReport } from './api';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import type { ReportRequest } from '@/types';

const METRIC_OPTIONS: Array<{ key: ReportRequest['metrics'][number]; label: string }> = [
  { key: 'headcount', label: 'Headcount' },
  { key: 'densityRisk', label: 'Density risk' },
  { key: 'flowRate', label: 'Flow rate' },
  { key: 'movementPct', label: 'Movement %' },
];

interface Props {
  onGenerated: (jobId: string) => void;
}

export function NewReportForm({ onGenerated }: Props): React.JSX.Element {
  const { data: zones } = useZones();
  const { data: cameras } = useCameras();
  const generate = useGenerateReport();

  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set());
  const [selectedCameras, setSelectedCameras] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<Set<ReportRequest['metrics'][number]>>(new Set(['headcount', 'densityRisk']));
  const [hours, setHours] = useState(24);
  const [includeAlertLog, setIncludeAlertLog] = useState(true);
  const [includeUptime, setIncludeUptime] = useState(true);

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void): void {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  // `disabled={generate.isPending}` doesn't take effect until React commits the next render, so a
  // synchronous double-click (both events processed before that repaint) can invoke this handler
  // twice — each call would submit its own report and its own audit.report_generate event. This
  // ref flips synchronously on the very first call, closing that window regardless of render timing.
  const submittingRef = useRef(false);

  async function handleGenerate(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await doGenerate();
    } finally {
      submittingRef.current = false;
    }
  }

  async function doGenerate(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 60 * 60_000);
    const req: ReportRequest = {
      cameraIds: Array.from(selectedCameras),
      zoneIds: Array.from(selectedZones),
      from: from.toISOString(),
      to: to.toISOString(),
      metrics: Array.from(metrics),
      includeAlertLog,
      includeUptime,
    };
    const job = await generate.mutateAsync(req);
    auditQueue.enqueue('report.generate', null, { reportId: job.reportId, request: req });
    toast({ severity: 'info', title: 'Report queued', message: `Generating report ${job.reportId}…` });
    onGenerated(job.id);
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Zones</h3>
        <div className="flex flex-wrap gap-1.5">
          {(zones?.items ?? []).map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => toggle(selectedZones, z.id, setSelectedZones)}
              className={`rounded border px-2 py-1 text-xs ${selectedZones.has(z.id) ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-raised'}`}
            >
              {z.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Cameras (optional — leave empty to include all in selected zones)
        </h3>
        <div className="max-h-32 overflow-y-auto rounded-md border border-border p-2">
          <div className="flex flex-wrap gap-1.5">
            {(cameras?.items ?? []).slice(0, 100).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(selectedCameras, c.id, setSelectedCameras)}
                className={`rounded border px-2 py-0.5 text-[11px] ${selectedCameras.has(c.id) ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-raised'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Metrics</h3>
        <div className="flex gap-3">
          {METRIC_OPTIONS.map((m) => (
            <label key={m.key} className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <input type="checkbox" checked={metrics.has(m.key)} onChange={() => toggle(metrics, m.key, setMetrics)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-xs text-fg-secondary">
          Time range:{' '}
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="rounded border border-border bg-bg-raised px-1.5 py-0.5">
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
            <option value={720}>Last 30d</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <input type="checkbox" checked={includeAlertLog} onChange={(e) => setIncludeAlertLog(e.target.checked)} />
          Alert log
        </label>
        <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <input type="checkbox" checked={includeUptime} onChange={(e) => setIncludeUptime(e.target.checked)} />
          Uptime
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={generate.isPending || metrics.size === 0}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
      >
        {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        Generate report
      </button>
    </div>
  );
}
