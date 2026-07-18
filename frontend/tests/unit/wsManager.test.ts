import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketManager } from '@/lib/ws/WebSocketManager';
import { useWsStore } from '@/lib/state/wsStore';
import type { CameraMetrics } from '@/types';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function metricsFrame(cameraId: string, seq: number, overrides: Partial<CameraMetrics> = {}) {
  return {
    type: 'metrics',
    topic: `camera:${cameraId}`,
    cameraId,
    seq,
    ts: new Date().toISOString(),
    data: {
      cameraId,
      seq,
      ts: new Date().toISOString(),
      headcount: 10,
      flowRate: 1,
      movementPct: 50,
      densityRisk: 0.2,
      inferenceLatencyMs: 100,
      ...overrides,
    },
  };
}

let rafQueue: FrameRequestCallback[] = [];
let nowValue = 0;

function flushRaf(): void {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(nowValue);
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager;

  beforeEach(() => {
    rafQueue = [];
    // Start above 0 — the manager's per-camera rate gate compares against a `lastEmit` map that
    // defaults missing entries to 0, so a real 0 test clock would collide with that default and
    // make the very first emission look "too soon" regardless of the code under test.
    nowValue = 1000;
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
    MockWebSocket.instances = [];
    manager = new WebSocketManager();
    useWsStore.setState({
      connectionState: 'CONNECTING',
      reconnectAttempt: 0,
      reconnectAtMs: null,
      messageRate: 0,
      clockSkewMs: 0,
      diagnostics: { droppedOutOfOrder: 0, clampedCorrupt: 0 },
    });
  });

  afterEach(() => {
    manager.disconnect();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function connectAndOpen(): MockWebSocket {
    manager.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    return ws;
  }

  it('resequencing: drops out-of-order and duplicate frames, accepts strictly increasing seq', () => {
    const ws = connectAndOpen();
    const received: CameraMetrics[] = [];
    manager.subscribeCamera('cam-1', () => {
      const m = manager.getLatest('cam-1');
      if (m) received.push(m);
    });

    ws.receive(metricsFrame('cam-1', 1, { headcount: 5 }));
    flushRaf();
    ws.receive(metricsFrame('cam-1', 1, { headcount: 999 })); // duplicate seq — must be dropped
    ws.receive(metricsFrame('cam-1', 0, { headcount: 999 })); // out of order — must be dropped
    nowValue += 300;
    flushRaf();
    ws.receive(metricsFrame('cam-1', 2, { headcount: 7 }));
    nowValue += 300;
    flushRaf();

    expect(received.map((m) => m.headcount)).toEqual([5, 7]);
    expect(useWsStore.getState().diagnostics.droppedOutOfOrder).toBe(2);
  });

  it('clamps corrupt values (negative headcount, out-of-range probability) instead of rendering them', () => {
    const ws = connectAndOpen();
    manager.subscribeCamera('cam-2', () => {});
    ws.receive(metricsFrame('cam-2', 1, { headcount: -5, densityRisk: 1.7, movementPct: -10 }));
    flushRaf();

    const latest = manager.getLatest('cam-2');
    expect(latest?.headcount).toBe(0);
    expect(latest?.densityRisk).toBe(1);
    expect(latest?.movementPct).toBe(0);
    expect(useWsStore.getState().diagnostics.clampedCorrupt).toBe(1);
  });

  it('backpressure: batches rapid updates and caps emission to the per-camera rate limit', () => {
    connectAndOpen();
    const ws = MockWebSocket.instances[0]!;
    let emitCount = 0;
    manager.subscribeCamera('cam-3', () => {
      emitCount += 1;
    });

    // Five rapid frames arriving within the same instant should collapse into a single emission
    // once flushed, not five.
    for (let seq = 1; seq <= 5; seq++) {
      ws.receive(metricsFrame('cam-3', seq, { headcount: seq }));
    }
    flushRaf();
    expect(emitCount).toBe(1);
    expect(manager.getLatest('cam-3')?.headcount).toBe(5);

    // Immediately flushing again (same instant) must not re-emit — the 250ms (4Hz) gate blocks it.
    ws.receive(metricsFrame('cam-3', 6, { headcount: 6 }));
    flushRaf();
    expect(emitCount).toBe(1);

    // After the per-camera interval elapses, the next flush emits again.
    nowValue += 260;
    flushRaf();
    expect(emitCount).toBe(2);
  });

  it('reconnects with exponential backoff and jitter after the socket closes, and resyncs on reopen', () => {
    vi.useFakeTimers();
    const ws = connectAndOpen();
    manager.subscribeCamera('cam-4', () => {});
    ws.receive(metricsFrame('cam-4', 5));
    flushRaf();

    expect(MockWebSocket.instances).toHaveLength(1);
    ws.close();
    expect(useWsStore.getState().connectionState).toBe('RECONNECTING');
    expect(useWsStore.getState().reconnectAttempt).toBeGreaterThan(0);

    // Advance past the (jittered, capped at 30s) backoff window for attempt 1.
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws2.open();
    const resyncMsg = ws2.sent.find((m) => (m as { type: string }).type === 'resync') as
      | { type: string; since: Record<string, number> }
      | undefined;
    expect(resyncMsg).toBeDefined();
    expect(resyncMsg?.since['cam-4']).toBe(5);
    vi.useRealTimers();
  });

  it('subscribeTopics reference-counts and only unsubscribes when the last consumer releases', () => {
    const ws = connectAndOpen();
    const unsubA = manager.subscribeTopics(['camera:cam-5']);
    const unsubB = manager.subscribeTopics(['camera:cam-5']);
    ws.sent = [];

    unsubA();
    expect(ws.sent.find((m) => (m as { type: string }).type === 'unsubscribe')).toBeUndefined();

    unsubB();
    const unsub = ws.sent.find((m) => (m as { type: string }).type === 'unsubscribe') as
      | { topics: string[] }
      | undefined;
    expect(unsub?.topics).toContain('camera:cam-5');
  });
});
