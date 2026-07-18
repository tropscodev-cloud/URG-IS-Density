import { AlertTriangle } from 'lucide-react';
import { useAuditQueueStatus } from '@/lib/audit/useAuditQueueStatus';

/** Client-side audit events must never silently drop — this surfaces when the queue can't flush. */
export function AuditQueueBanner(): React.JSX.Element | null {
  const { pendingCount, failing } = useAuditQueueStatus();
  if (!failing || pendingCount === 0) return null;

  return (
    <div
      role="alert"
      className="pointer-events-none absolute inset-x-0 top-14 z-40 flex justify-center bg-severity-warning py-1 text-center text-xs font-semibold text-black"
    >
      <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
      {pendingCount} audit event{pendingCount === 1 ? '' : 's'} queued and retrying — connectivity issue detected. Nothing
      is being dropped.
    </div>
  );
}
