import type { Alert, CameraMetrics, CameraStatus, WsServerMessage } from '@/types';
import { useWsStore } from '@/lib/state/wsStore';

const WS_URL = import.meta.env.VITE_WS_URL ?? '/ws';
const PER_CAMERA_MAX_HZ = 4;
const PER_CAMERA_MIN_INTERVAL_MS = 1000 / PER_CAMERA_MAX_HZ;
const HEATMAP_INTERVAL_MS = 1000;
const PING_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const CLOCK_SKEW_WARN_MS = 30_000;

type StatusEvent = { cameraId: string; status: CameraStatus; ts: string; reconnectAttempts?: number };
type RemovedEvent = { cameraId: string; ts: string; reason: 'retired' | 'deleted' };
type AlertEvent = { event: 'raised' | 'acked' | 'resolved' | 'escalated'; alert: Alert };

function clampMetrics(data: CameraMetrics): { data: CameraMetrics; corrupted: boolean } {
  let corrupted = false;
  const clamped = { ...data };
  if (clamped.headcount < 0) {
    clamped.headcount = 0;
    corrupted = true;
  }
  if (clamped.densityRisk < 0 || clamped.densityRisk > 1) {
    clamped.densityRisk = Math.min(1, Math.max(0, clamped.densityRisk));
    corrupted = true;
  }
  if (clamped.movementPct < 0 || clamped.movementPct > 100) {
    clamped.movementPct = Math.min(100, Math.max(0, clamped.movementPct));
    corrupted = true;
  }
  return { data: clamped, corrupted };
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private wantConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private heatmapTimer: ReturnType<typeof setInterval> | null = null;
  private rafHandle: number | null = null;

  private latestMetrics = new Map<string, CameraMetrics>();
  private lastSeq = new Map<string, number>();
  private lastEmit = new Map<string, number>();
  private dirty = new Set<string>();

  private topicRefs = new Map<string, number>();
  private cameraListeners = new Map<string, Set<() => void>>();
  private anyListeners = new Set<(changedIds: string[]) => void>();
  private heatmapListeners = new Set<(all: ReadonlyMap<string, CameraMetrics>) => void>();
  private statusListeners = new Set<(evt: StatusEvent) => void>();
  private removedListeners = new Set<(evt: RemovedEvent) => void>();
  private alertListeners = new Set<(evt: AlertEvent) => void>();

  private messageCountWindow = 0;
  private messageRateTimer: ReturnType<typeof setInterval> | null = null;

  connect(): void {
    if (this.wantConnected) return;
    this.wantConnected = true;
    this.reconnectAttempt = 0;
    this.open();
    this.startTimers();
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.heatmapTimer) clearInterval(this.heatmapTimer);
    if (this.messageRateTimer) clearInterval(this.messageRateTimer);
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.ws?.close();
    this.ws = null;
    useWsStore.getState().setConnectionState('OFFLINE');
  }

  private startTimers(): void {
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
    this.heatmapTimer = setInterval(() => {
      for (const cb of this.heatmapListeners) cb(this.latestMetrics);
    }, HEATMAP_INTERVAL_MS);
    this.messageRateTimer = setInterval(() => {
      useWsStore.getState().setMessageRate(this.messageCountWindow);
      this.messageCountWindow = 0;
    }, 1000);
    this.tickRaf();
  }

  private tickRaf = (): void => {
    if (this.dirty.size > 0) {
      const now = performance.now();
      const changed: string[] = [];
      for (const id of Array.from(this.dirty)) {
        const last = this.lastEmit.get(id) ?? 0;
        if (now - last >= PER_CAMERA_MIN_INTERVAL_MS) {
          this.lastEmit.set(id, now);
          this.dirty.delete(id);
          changed.push(id);
          const listeners = this.cameraListeners.get(id);
          if (listeners) for (const cb of listeners) cb();
        }
      }
      if (changed.length > 0) {
        for (const cb of this.anyListeners) cb(changed);
      }
    }
    this.rafHandle = requestAnimationFrame(this.tickRaf);
  };

  private open(): void {
    const store = useWsStore.getState();
    store.setConnectionState(this.reconnectAttempt === 0 ? 'CONNECTING' : 'RECONNECTING');

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = WS_URL.startsWith('ws') ? WS_URL : `${proto}//${window.location.host}${WS_URL}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      useWsStore.getState().setReconnectInfo(0, null);
      useWsStore.getState().setConnectionState('LIVE');
      const topics = Array.from(this.topicRefs.keys());
      if (topics.length > 0) this.send({ type: 'subscribe', topics });
      // Only resync cameras we're actually subscribed to right now (an active `camera:<id>`
      // topic ref) — `lastSeq` also carries entries backfilled from `fleet_snapshot` for cameras
      // nobody has an individual subscription to, and requesting a full missed-history replay for
      // all of those on every reconnect would recreate the exact flood this file's `fleet_snapshot`
      // handling exists to avoid.
      const since: Record<string, number> = {};
      for (const [cameraId, seq] of this.lastSeq.entries()) {
        if (this.topicRefs.has(`camera:${cameraId}`)) since[cameraId] = seq;
      }
      if (Object.keys(since).length > 0) this.send({ type: 'resync', since });
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      this.messageCountWindow += 1;
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(evt.data) as WsServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      if (!this.wantConnected) return;
      useWsStore.getState().setConnectionState('RECONNECTING');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.reconnectAttempt);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt += 1;
    const at = Date.now() + jitter;
    useWsStore.getState().setReconnectInfo(this.reconnectAttempt, at);
    this.reconnectTimer = setTimeout(() => {
      if (this.wantConnected) this.open();
    }, jitter);
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: WsServerMessage): void {
    switch (msg.type) {
      case 'metrics': {
        const prevSeq = this.lastSeq.get(msg.cameraId) ?? -1;
        if (msg.seq <= prevSeq) {
          useWsStore.getState().incrementDroppedOutOfOrder();
          return;
        }
        this.lastSeq.set(msg.cameraId, msg.seq);
        const { data, corrupted } = clampMetrics(msg.data);
        if (corrupted) useWsStore.getState().incrementClampedCorrupt();
        this.latestMetrics.set(msg.cameraId, data);
        this.dirty.add(msg.cameraId);
        return;
      }
      case 'fleet_snapshot': {
        // Fleet-wide, ≤1Hz batched view for the map/heatmap (see hub.ts) — cameras with an active
        // per-camera subscription already get real-time pushes on their own `camera:<id>` topic,
        // so this only needs to backfill `latestMetrics` (what MapCanvas's clustering reads via
        // getLatest()), guarded by the same seq check so a snapshot can never clobber a newer
        // per-camera push with stale data. Deliberately doesn't touch `dirty` — the map's refresh
        // cadence is already driven by the separate heatmap tick, not per-camera listeners.
        for (const data of msg.cameras) {
          const prevSeq = this.lastSeq.get(data.cameraId) ?? -1;
          if (data.seq <= prevSeq) continue;
          this.lastSeq.set(data.cameraId, data.seq);
          const { data: clamped, corrupted } = clampMetrics(data);
          if (corrupted) useWsStore.getState().incrementClampedCorrupt();
          this.latestMetrics.set(data.cameraId, clamped);
        }
        return;
      }
      case 'camera_status':
        for (const cb of this.statusListeners) {
          cb({ cameraId: msg.cameraId, status: msg.status, ts: msg.ts, reconnectAttempts: msg.reconnectAttempts });
        }
        return;
      case 'camera_removed':
        for (const cb of this.removedListeners) cb({ cameraId: msg.cameraId, ts: msg.ts, reason: msg.reason });
        return;
      case 'alert':
        for (const cb of this.alertListeners) cb({ event: msg.event, alert: msg.alert });
        return;
      case 'server_time': {
        const skew = Date.now() - Date.parse(msg.ts);
        useWsStore.getState().setClockSkew(skew);
        if (Math.abs(skew) > CLOCK_SKEW_WARN_MS) {
          // Store already exposes clockSkewMs; UI (top bar) renders the warning when it exceeds
          // the threshold, so no separate flag is needed here.
        }
        return;
      }
      case 'resync_complete':
      case 'pong':
        return;
    }
  }

  // --- Subscriptions ---

  subscribeTopics(topics: string[]): () => void {
    const newlyAdded: string[] = [];
    for (const t of topics) {
      const count = this.topicRefs.get(t) ?? 0;
      this.topicRefs.set(t, count + 1);
      if (count === 0) newlyAdded.push(t);
    }
    if (newlyAdded.length > 0) this.send({ type: 'subscribe', topics: newlyAdded });

    return () => {
      const toRemove: string[] = [];
      for (const t of topics) {
        const count = this.topicRefs.get(t) ?? 0;
        if (count <= 1) {
          this.topicRefs.delete(t);
          toRemove.push(t);
        } else {
          this.topicRefs.set(t, count - 1);
        }
      }
      if (toRemove.length > 0) this.send({ type: 'unsubscribe', topics: toRemove });
    };
  }

  subscribeCamera(cameraId: string, onChange: () => void): () => void {
    let set = this.cameraListeners.get(cameraId);
    if (!set) {
      set = new Set();
      this.cameraListeners.set(cameraId, set);
    }
    set.add(onChange);
    const unsubTopic = this.subscribeTopics([`camera:${cameraId}`]);
    return () => {
      set.delete(onChange);
      if (set.size === 0) this.cameraListeners.delete(cameraId);
      unsubTopic();
    };
  }

  subscribeAny(cb: (changedIds: string[]) => void): () => void {
    this.anyListeners.add(cb);
    return () => this.anyListeners.delete(cb);
  }

  subscribeHeatmap(cb: (all: ReadonlyMap<string, CameraMetrics>) => void): () => void {
    this.heatmapListeners.add(cb);
    return () => this.heatmapListeners.delete(cb);
  }

  subscribeStatus(cb: (evt: StatusEvent) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  subscribeRemoved(cb: (evt: RemovedEvent) => void): () => void {
    this.removedListeners.add(cb);
    return () => this.removedListeners.delete(cb);
  }

  subscribeAlerts(cb: (evt: AlertEvent) => void): () => void {
    this.alertListeners.add(cb);
    return () => this.alertListeners.delete(cb);
  }

  getLatest(cameraId: string): CameraMetrics | undefined {
    return this.latestMetrics.get(cameraId);
  }

  getAllLatest(): ReadonlyMap<string, CameraMetrics> {
    return this.latestMetrics;
  }
}

let instance: WebSocketManager | null = null;

export function getWsManager(): WebSocketManager {
  if (!instance) instance = new WebSocketManager();
  return instance;
}

export type { StatusEvent, RemovedEvent, AlertEvent };
