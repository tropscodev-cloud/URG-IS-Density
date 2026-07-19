// Mirrors API_CONTRACT.md. Kept as plain TS (no zod) here; zod schemas live alongside forms
// that need runtime validation (see features/cameras/schemas.ts).

export type Role = 'VIEWER' | 'OPERATOR' | 'SUPERVISOR' | 'ADMIN';

export type CameraStatus =
  | 'ONLINE'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'OFFLINE'
  | 'MISCONFIGURED'
  | 'DISABLED';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED' | 'ESCALATED';
export type ReportStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export type ThresholdMetric = 'densityRisk' | 'headcount' | 'flowRate';

export interface FloorPlan {
  id: string;
  buildingId: string;
  name: string;
  imageUrl: string;
  corners: [number, number][];
}

export interface Building {
  id: string;
  name: string;
  floorPlans: FloorPlan[];
}

export interface Zone {
  id: string;
  name: string;
  buildingId: string | null;
  parentZoneId: string | null;
}

/** One live person detection from the backend's YOLO+BoTSORT pipeline — present only when
 *  connected to the real inference backend (the mock server never sends this). bbox is
 *  [x, y, width, height] in the pipeline's 640x480 processing-frame pixel space. */
export interface DetectedEntity {
  id: string;
  coordinates: { x: number; y: number };
  bbox: [number, number, number, number];
  confidence: number;
}

export interface CameraMetrics {
  cameraId: string;
  seq: number;
  ts: string;
  headcount: number;
  flowRate: number;
  movementPct: number;
  densityRisk: number;
  inferenceLatencyMs: number;
  entities?: DetectedEntity[];
  /** Position (seconds) within the source video file these detections came from — only present
   *  against the real inference backend. Lets a client seek its own playback to match instead of
   *  free-running independently of when these boxes were actually observed. */
  sourceVideoTimeS?: number;
  /** What the worker is actually sampling at right now (post fps-clamp, post frame-skip rounding)
   *  — may briefly lag a just-requested targetFps until the worker's next raw-frame poll. */
  effectiveFps?: number;
}

export interface Camera {
  id: string;
  name: string;
  zoneId: string;
  buildingId: string | null;
  lat: number | null;
  lng: number | null;
  floorPlan: { floorPlanId: string; x: number; y: number } | null;
  bearing: number;
  fovAngle: number;
  range: number;
  tags: string[];
  status: CameraStatus;
  lastSeenAt: string | null;
  lastMetrics: CameraMetrics | null;
  rtspUrlMasked: string;
  streamKey: string;
  reconnectAttempts: number;
  misconfiguredReason: string | null;
  disabledReason: string | null;
  retired: boolean;
  retiredAt: string | null;
  retiredReason: string | null;
  retiredBy: string | null;
  lastConfigChange: { by: string; at: string } | null;
  uptimePct30d: number;
  /** Configured inference sampling rate (1-30fps) — only meaningful against the real inference
   *  backend; defaults to 20 there, absent/ignored on the mock server. */
  targetFps?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThresholdConfig {
  scopeType: 'camera' | 'zone';
  scopeId: string;
  metric: ThresholdMetric;
  warningAt: number;
  criticalAt: number;
  sustainedSeconds: number;
  cooldownSeconds: number;
  updatedBy: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  cameraId: string;
  zoneId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  metric: ThresholdMetric;
  thresholdValue: number;
  observedValue: number;
  raisedAt: string;
  ackedAt: string | null;
  ackedBy: string | null;
  ackNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  escalatedAt: string | null;
  escalatedBy: string | null;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  zoneScope: string[] | null;
}

export interface AuditEvent {
  id: string;
  ts: string;
  userId: string;
  username: string;
  role: Role;
  action: string;
  target: string | null;
  params: Record<string, unknown>;
  sessionId: string;
  clientInfo: { userAgent: string; ip: string };
}

export interface ReportRequest {
  cameraIds: string[];
  zoneIds: string[];
  from: string;
  to: string;
  metrics: Array<'headcount' | 'densityRisk' | 'flowRate' | 'movementPct'>;
  includeAlertLog: boolean;
  includeUptime: boolean;
}

export interface ReportJob {
  id: string;
  status: ReportStatus;
  progressPct: number;
  requestedBy: string;
  requestedAt: string;
  resultUrl: string | null;
  error: string | null;
  reportId: string;
  request: ReportRequest;
}

export interface ReportSchedule {
  id: string;
  name: string;
  cadence: 'daily' | 'weekly';
  zoneIds: string[];
  recipients: string[];
  createdBy: string;
  createdAt: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// --- WebSocket wire types ---

export type WsClientMessage =
  | { type: 'subscribe'; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] }
  | { type: 'resync'; since: Record<string, number> }
  | { type: 'ping' };

export type WsServerMessage =
  | { type: 'metrics'; topic: string; cameraId: string; seq: number; ts: string; data: CameraMetrics }
  | { type: 'camera_status'; topic: string; cameraId: string; ts: string; status: CameraStatus; reconnectAttempts?: number }
  | { type: 'camera_removed'; topic: string; cameraId: string; ts: string; reason: 'retired' | 'deleted' }
  | { type: 'alert'; topic: 'alerts'; event: 'raised' | 'acked' | 'resolved' | 'escalated'; alert: Alert }
  | { type: 'fleet_snapshot'; topic: 'global'; ts: string; cameras: CameraMetrics[] }
  | { type: 'resync_complete'; topic: string }
  | { type: 'pong'; ts: string }
  | { type: 'server_time'; ts: string };

export type ConnectionState = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'STALE' | 'OFFLINE';
