import { api } from '@/lib/api/client';

export interface QueuedAuditEvent {
  clientEventId: string;
  ts: string;
  action: string;
  target: string | null;
  params: Record<string, unknown>;
}

type Listener = (pendingCount: number, failing: boolean) => void;

// Deliberately in-memory only — audit content (camera names, ack notes) never touches
// localStorage. A hard refresh mid-outage can lose an unflushed queue; a real deployment would
// back this with IndexedDB instead (documented as a mock-scope tradeoff in ARCHITECTURE.md).
const RETRY_DELAY_MS = 5000;
const BATCH_SIZE = 50;

class AuditQueue {
  private queue: QueuedAuditEvent[] = [];
  private flushing = false;
  private failing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  enqueue(action: string, target: string | null, params: Record<string, unknown> = {}): void {
    this.queue.push({
      clientEventId: crypto.randomUUID(),
      ts: new Date().toISOString(),
      action,
      target,
      params,
    });
    this.notify();
    this.scheduleFlush(0);
  }

  flushNow(): void {
    this.scheduleFlush(0);
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.queue.length, this.failing);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this.queue.length, this.failing);
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.slice(0, BATCH_SIZE);
    try {
      const res = await api.post<{ acceptedClientEventIds: string[] }>('/audit/events', { events: batch });
      const accepted = new Set(res.acceptedClientEventIds);
      this.queue = this.queue.filter((e) => !accepted.has(e.clientEventId));
      this.failing = false;
      if (this.queue.length > 0) this.scheduleFlush(0);
    } catch {
      this.failing = true;
      this.scheduleFlush(RETRY_DELAY_MS);
    } finally {
      this.flushing = false;
      this.notify();
    }
  }
}

export const auditQueue = new AuditQueue();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => auditQueue.flushNow());
}
