import { useSyncExternalStore } from 'react';
import { auditQueue } from './auditQueue';

interface AuditQueueStatus {
  pendingCount: number;
  failing: boolean;
}

let cached: AuditQueueStatus = { pendingCount: 0, failing: false };

function isEqual(a: AuditQueueStatus, b: AuditQueueStatus): boolean {
  return a.pendingCount === b.pendingCount && a.failing === b.failing;
}

export function useAuditQueueStatus(): AuditQueueStatus {
  return useSyncExternalStore(
    (onChange) =>
      auditQueue.subscribe((pendingCount, failing) => {
        const next = { pendingCount, failing };
        // auditQueue.subscribe invokes this synchronously with the current state right away —
        // only treat that as a "change" (and call onChange, which schedules a re-render) if the
        // value actually differs, otherwise useSyncExternalStore's getSnapshot/onChange cycle
        // never settles and React throws "Maximum update depth exceeded".
        if (!isEqual(cached, next)) {
          cached = next;
          onChange();
        }
      }),
    () => cached,
  );
}
