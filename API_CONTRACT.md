# API Contract — Crowd Density Operator Console

This contract is authored by the frontend team because the production backend's exact wire
format was not yet pinned down. It is implemented 1:1 by `server/` (the mock backend) and is the
only thing the frontend codes against. Swapping the mock for the real FastAPI backend means
pointing `VITE_API_BASE_URL` / `VITE_WS_URL` at it and satisfying this document — no UI changes.

All timestamps are ISO-8601 UTC strings (`2026-07-17T14:32:05.123Z`). The client converts to the
department's local timezone for display only; all comparisons/storage stay in UTC.

## Conventions

- Base REST path: `/api/v1`
- Auth: httpOnly session cookie (`cdc_session`), set by `/auth/login`. No tokens in JS-readable
  storage. CSRF header `X-CDC-CSRF` (double-submit cookie) required on all mutating requests.
- Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`, HTTP status
  matches semantics (400 validation, 401 unauth, 403 forbidden, 404, 409 conflict, 422, 429, 500).
- Pagination: `?cursor=<opaque>&limit=<n>` → `{ items: T[], nextCursor: string | null }`.
- Every list endpoint that can be zone-scoped is filtered server-side by the caller's zone scope
  (§7 of the product spec) — the frontend never filters for privacy, only for UX convenience.

## Enums

```ts
type Role = 'VIEWER' | 'OPERATOR' | 'SUPERVISOR' | 'ADMIN';
type CameraStatus = 'ONLINE' | 'DEGRADED' | 'RECONNECTING' | 'OFFLINE' | 'MISCONFIGURED' | 'DISABLED';
type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
type AlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED' | 'ESCALATED';
type ReportStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
```

## Core entities

```ts
interface Camera {
  id: string;
  name: string;
  zoneId: string;
  buildingId: string | null;
  lat: number | null;           // null for indoor/floor-plan-only cameras
  lng: number | null;
  floorPlan: { floorPlanId: string; x: number; y: number } | null; // normalized 0-1 coords
  bearing: number;               // degrees, 0 = north, clockwise
  fovAngle: number;               // degrees
  range: number;                  // meters
  tags: string[];
  status: CameraStatus;
  lastSeenAt: string | null;      // last metrics frame received by backend
  lastMetrics: CameraMetrics | null; // last-known snapshot, present even when OFFLINE
  rtspUrlMasked: string;           // e.g. "rtsp://***:***@10.0.4.12/stream1" — never the real secret
  streamKey: string;               // opaque id the media gateway resolves to a WebRTC/HLS stream
  reconnectAttempts: number;       // > 0 only while RECONNECTING
  misconfiguredReason: string | null;
  disabledReason: string | null;
  retired: boolean;
  retiredAt: string | null;
  retiredReason: string | null;
  retiredBy: string | null;
  lastConfigChange: { by: string; at: string } | null;
  uptimePct30d: number;
  createdAt: string;
  updatedAt: string;
}

interface CameraMetrics {
  cameraId: string;
  seq: number;              // monotonic per camera, used for WS ordering/dedup
  ts: string;                // server-authoritative capture time (UTC)
  headcount: number;
  flowRate: number;          // people/min, signed (+in / -out) when direction known
  movementPct: number;       // 0-100, % of detections classified "moving"
  densityRisk: number;       // 0-1 probability
  inferenceLatencyMs: number;
}

interface Zone { id: string; name: string; buildingId: string | null; parentZoneId: string | null; }
interface Building { id: string; name: string; floorPlans: FloorPlan[]; }
interface FloorPlan { id: string; buildingId: string; name: string; imageUrl: string; corners: [number, number][]; } // georeferencing corners, lat/lng, TL/TR/BR/BL

interface ThresholdConfig {
  scopeType: 'camera' | 'zone';
  scopeId: string;
  metric: 'densityRisk' | 'headcount' | 'flowRate';
  warningAt: number;
  criticalAt: number;
  sustainedSeconds: number;   // hysteresis: breach must hold this long before firing
  cooldownSeconds: number;    // suppression window after a resolve before re-firing
  updatedBy: string;
  updatedAt: string;
}

interface Alert {
  id: string;
  cameraId: string;
  zoneId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  metric: ThresholdConfig['metric'];
  thresholdValue: number;
  observedValue: number;
  raisedAt: string;
  ackedAt: string | null;
  ackedBy: string | null;
  ackNote: string | null;      // mandatory for CRITICAL acks
  resolvedAt: string | null;
  resolvedBy: string | null;
  escalatedAt: string | null;
  escalatedBy: string | null;
}

interface User {
  id: string; username: string; displayName: string; role: Role;
  zoneScope: string[] | null;   // null = unrestricted
}

interface AuditEvent {
  id: string; ts: string; userId: string; username: string; role: Role;
  action: string;               // e.g. "camera.retire", "feed.view", "chatbot.query"
  target: string | null;         // e.g. camera id
  params: Record<string, unknown>;
  sessionId: string;
  clientInfo: { userAgent: string; ip: string };
}

interface ReportRequest {
  cameraIds: string[]; zoneIds: string[];
  from: string; to: string;
  metrics: Array<'headcount' | 'densityRisk' | 'flowRate' | 'movementPct'>;
  includeAlertLog: boolean; includeUptime: boolean;
}

interface ReportJob {
  id: string; status: ReportStatus; progressPct: number;
  requestedBy: string; requestedAt: string;
  resultUrl: string | null; error: string | null; reportId: string; // human-facing traceability id
}
```

## REST endpoints

### Auth & session
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{username,password,totp?}` → `{user, sessionExpiresAt}`, sets cookie. Mock stands in for OIDC redirect. |
| POST | `/auth/logout` | Clears session. Audit-logged. |
| POST | `/auth/step-up` | `{password}` → short-lived step-up grant (5 min) required before retire/threshold/export-evidence endpoints. |
| GET | `/auth/session` | Current user + expiry, used on load and idle-warning countdown. |
| POST | `/auth/refresh` | Sliding session refresh on activity. |

### Cameras
| Method | Path | Notes |
|---|---|---|
| GET | `/cameras` | List, filterable `?zoneId=&status=&tag=&q=`. Zone-scoped server-side. |
| GET | `/cameras/:id` | Single camera incl. `lastMetrics`. |
| POST | `/cameras` | Create (SUPERVISOR+). Body includes write-only `rtspUrl`, `rtspUsername`, `rtspPassword` — never echoed back. |
| PATCH | `/cameras/:id` | Edit geo/FOV/meta (SUPERVISOR+). Diffed server-side for audit `before/after`. |
| POST | `/cameras/:id/test-connection` | Returns `{ok, snapshotUrl?, error?}` — used pre-save and for MISCONFIGURED retry. |
| POST | `/cameras/:id/retire` | `{reason}`, requires step-up. Soft-delete only — no hard-delete endpoint exists. |
| POST | `/cameras/check-duplicate` | `{rtspUrl}` → `{duplicate: boolean, cameraId?}`. |
| POST | `/cameras/bulk-import` | multipart `file` (`.csv`/`.json`/`.xlsx`/`.xls`/`.pdf`/`.docx`/`.txt`) + optional `defaultZoneId` field → `{results: Array<{row, accepted, reason?, camera?}>}`, dry-run via `?commit=false`. Idempotent on `(rtspUrl)` uniqueness. See "Bulk-import file formats" below. |
| GET | `/zones` , `/buildings` , `/buildings/:id/floorplans/:fid` | Reference data. |

#### Bulk-import file formats

Dispatched by the uploaded file's extension — `POST /cameras/bulk-import` accepts exactly one of:

| Extension | Parser | Row shape |
|---|---|---|
| `.csv` | `papaparse`, header row required | Full structured columns: `name, zoneId, lat, lng, rtspUrl, rtspUsername, rtspPassword, bearing, fovAngle, range, tags` (`tags` is `\|`-separated). Same template for all three structured formats. |
| `.json` | `JSON.parse`, top-level array | Same columns as CSV, as an array of objects. |
| `.xlsx` / `.xls` | `exceljs`, first worksheet, row 1 = headers | Same columns as CSV. |
| `.pdf` | `pdfjs-dist` (text extraction, no rendering/canvas involved) + `rtsp://` regex scan | Free text has no columns — every `rtsp://…` match found in the document becomes one row, auto-named `Imported Camera N`. |
| `.docx` | `mammoth` (raw text extraction) + the same regex scan | Same as PDF. Legacy binary `.doc` is not supported — re-save as `.docx`. |
| `.txt` | Plain text, one camera per line | Each line is either a bare `rtsp://…` URL (auto-named) or `Name, rtsp://…` (paired). The frontend's "paste RTSP links" textarea is sent as a virtual `.txt` upload through this same path — there is no separate paste endpoint. |

The three prose/plain-text formats (`.pdf`, `.docx`, `.txt`) can never supply a `zoneId`, `lat`, or
`lng` — the request must include a `defaultZoneId` form field, applied to every row that doesn't
already have one. The endpoint returns `400 VALIDATION_ERROR` up front if that field is missing
and the source requires it, rather than rejecting every row individually with the same reason.
Structured sources (`.csv`/`.json`/`.xlsx`) may also omit `zoneId` per row and rely on
`defaultZoneId` as a fallback, but are expected to carry their own zone column normally.

### History & time-travel
| Method | Path | Notes |
|---|---|---|
| GET | `/history/metrics?cameraId=&from=&to=&resolution=` | Paginated snapshots; `resolution` = raw\|1m\|5m for chart downsampling. Gaps (offline periods) are simply absent — client renders as gaps, never interpolates. |
| GET | `/history/state?at=` | Reconstructed fleet state (camera statuses, last metrics, active alerts) at a single instant, for scrub-bar rendering. Returns `410 { code: 'RETENTION_EXPIRED' }` for purged ranges. |
| GET | `/history/alert-events?from=&to=&cameraId=` | For "step to next/previous alert event" playback control. |

### Alerts & thresholds
| Method | Path | Notes |
|---|---|---|
| GET | `/alerts?status=&severity=&zoneId=&cameraId=` | Live + recent alert list. |
| POST | `/alerts/:id/ack` | `{note?}` — note mandatory when severity=CRITICAL (validated both client and server). |
| POST | `/alerts/bulk-ack` | SUPERVISOR+, `{alertIds, note?}`. |
| POST | `/alerts/:id/resolve` , `/alerts/:id/escalate` | |
| GET/PUT | `/thresholds` | SUPERVISOR+ to PUT. |

### Audit
| Method | Path | Notes |
|---|---|---|
| POST | `/audit/events` | Client submits queued audit events (batched array), server assigns id/ts-received; returns accepted ids so client can drain its retry queue. |
| GET | `/audit/events?user=&action=&cameraId=&from=&to=` | ADMIN only, paginated. |
| GET | `/audit/events.csv?...` | Same filters, CSV stream. |

### Reports
| Method | Path | Notes |
|---|---|---|
| POST | `/reports` | Body = `ReportRequest` → `ReportJob` (QUEUED), async. |
| GET | `/reports/:id` | Poll status/progress. |
| GET | `/reports` | "My reports" list. |
| POST | `/reports/evidence-bundle` | Requires step-up. `{alertId?, cameraId, at}` → job producing zip w/ snapshots, metrics window, alert timeline, audit slice, SHA-256 manifest. |
| GET/PUT | `/reports/schedules` | SUPERVISOR+, daily/weekly digest configs. |

### Chatbot
| Method | Path | Notes |
|---|---|---|
| POST | `/chat/query` | `{message, context: {cameraIds?, zoneIds?, from?, to?}}` → `{answer, sources: Array<{cameraId, metric, from, to, value}>, grounded: boolean}`. `grounded:false` + no numeric claims when the backend can't answer from data. Every call is audit-logged server-side too (belt & suspenders). |

## WebSocket

`GET /ws` (upgrades from the same origin/session cookie). Single multiplexed connection per
client.

### Client → server
```ts
{ type: 'subscribe',   topics: string[] }        // 'camera:<id>' | 'zone:<id>' | 'global' | 'alerts'
{ type: 'unsubscribe', topics: string[] }
{ type: 'resync',      since: Record<string, number> } // per-topic last-seen seq, on reconnect
{ type: 'ping' }
```

### Server → client
```ts
{ type: 'metrics',        topic: string, cameraId: string, seq: number, ts: string, data: CameraMetrics }
{ type: 'camera_status',  topic: string, cameraId: string, ts: string, status: CameraStatus, reconnectAttempts?: number }
{ type: 'camera_removed', topic: string, cameraId: string, ts: string, reason: 'retired' | 'deleted' }
{ type: 'alert',          topic: 'alerts', event: 'raised'|'acked'|'resolved'|'escalated', alert: Alert }
{ type: 'resync_complete', topic: string }
{ type: 'pong', ts: string }
{ type: 'server_time',    ts: string }             // sent every 5s for clock-skew detection
```

Rules the client enforces (see `lib/ws/WebSocketManager.ts`):
- Drop any frame with `seq` ≤ last-seen `seq` for that `cameraId` (out-of-order/duplicate).
- Clamp obviously corrupt values (`headcount < 0`, probabilities outside `[0,1]`) and increment a
  diagnostics counter instead of rendering them.
- Batch frame application via `requestAnimationFrame`, capped at 4 UI updates/sec/camera and
  1/sec for heatmap aggregation.
- Reconnect with exponential backoff + jitter (base 500ms, cap 30s), then send `resync` with the
  last seq per currently-subscribed topic.
- If `|serverTime - localTime| > 30s`, surface a clock-skew warning.

## Camera status semantics (server-computed, client only renders)

- `ONLINE`: metrics age < 10s and stream reachable.
- `DEGRADED`: metrics age 10–60s, OR stream up but inference latency above configured degraded
  threshold. Carries the age so the client can show "last updated Xs ago".
- `RECONNECTING`: backend mid RTSP-reconnect; `reconnectAttempts` increments.
- `OFFLINE`: metrics age > 60s. Excluded from global totals (client trusts server's
  `status`, never infers offline from silence alone — a `camera_status` push always announces it).
- `MISCONFIGURED`: backend rejected the RTSP URL/credentials; `misconfiguredReason` set.
- `DISABLED`: administratively paused via retire flow's sibling "disable" action... *(mock ships
  DISABLED as config-only state settable via PATCH `{disabled:true}`, distinct from retire, so
  history/config are both preserved and the camera can be re-enabled)*.

## Security notes mirrored from SECURITY.md

- `rtspUrl`/credentials are write-only: accepted on POST/PATCH, never present in any GET
  response body, ever — the mock server enforces this at the serializer, not just by convention.
- No PII/credential values ever appear in a URL (path or query) at any endpoint.
