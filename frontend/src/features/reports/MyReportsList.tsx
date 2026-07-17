import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useMyReports } from './api';
import { relativeAge } from '@/lib/utils/time';

interface Props {
  onView: (jobId: string) => void;
}

export function MyReportsList({ onView }: Props): React.JSX.Element {
  const { data, isLoading } = useMyReports();

  if (isLoading) return <p className="p-4 text-xs text-fg-muted">Loading…</p>;
  const items = data?.items ?? [];
  if (items.length === 0) return <p className="p-4 text-xs text-fg-muted">No reports yet.</p>;

  return (
    <ul className="divide-y divide-border">
      {items.map((job) => (
        <li key={job.id} className="flex items-center justify-between px-4 py-2.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-fg-primary">{job.reportId}</span>
              <StatusPill status={job.status} progressPct={job.progressPct} />
            </div>
            <p className="text-[11px] text-fg-muted">Requested {relativeAge(job.requestedAt)}</p>
            {job.error && <p className="text-[11px] text-severity-critical">{job.error}</p>}
          </div>
          {job.status === 'DONE' && (
            <button type="button" onClick={() => onView(job.id)} className="rounded-md border border-border px-2.5 py-1 text-xs text-fg-secondary hover:bg-bg-raised">
              View
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status, progressPct }: { status: string; progressPct: number }): React.JSX.Element {
  if (status === 'DONE') return <span className="flex items-center gap-1 text-[10px] text-status-online"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Done</span>;
  if (status === 'FAILED') return <span className="flex items-center gap-1 text-[10px] text-severity-critical"><XCircle className="h-3 w-3" aria-hidden="true" />Failed</span>;
  if (status === 'RUNNING') return <span className={clsx('flex items-center gap-1 text-[10px] text-severity-warning')}><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Running {progressPct}%</span>;
  return <span className="flex items-center gap-1 text-[10px] text-fg-muted"><Clock className="h-3 w-3" aria-hidden="true" />Queued</span>;
}
