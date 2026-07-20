# Security

This is the authorization map, session model, and privacy posture for the operator console.
The frontend enforces all of this for UX (hiding, not just disabling, actions a role lacks); the
mock backend re-enforces the same rules server-side (see `server/src/rest/middleware.ts`), which
is the model a real backend must also follow — **the client is never the authority.**

## Roles

`VIEWER < OPERATOR < SUPERVISOR < ADMIN` — each role includes everything the ones below it can
do. Defined once in `app/src/lib/rbac/permissions.ts` and mirrored server-side in
`server/src/auth/sessions.ts`'s `roleAtLeast`.

## Role → action map

| Action | Min. role | Notes |
|---|---|---|
| View map, live metrics, alert tray | VIEWER | |
| Acknowledge WARNING alert | OPERATOR | One click |
| Acknowledge CRITICAL alert | OPERATOR | Mandatory note |
| Resolve / escalate alert | OPERATOR | |
| Multi-select (shift-click / lasso) | OPERATOR | |
| Generate report | OPERATOR | |
| Export evidence bundle | OPERATOR | + step-up (see below) |
| Bulk-acknowledge alerts | SUPERVISOR | |
| Add / edit camera | SUPERVISOR | |
| Retire camera | SUPERVISOR | + step-up + typed confirmation |
| Bulk import cameras | SUPERVISOR | |
| Tune alert thresholds | SUPERVISOR | + step-up |
| Toggle kiosk mode | SUPERVISOR | |
| Configure scheduled report digests | SUPERVISOR | |
| View audit console | ADMIN | Read-only, append-only — no edit/delete affordance exists |
| User management view | ADMIN | View only in this build (no create/delete user UI) |
| Retention settings | ADMIN | *Not implemented in this build* — see Known Gaps |

Server-side enforcement mirrors this exactly via `requireRole(minRole)` middleware on every
mutating route (`server/src/rest/*.ts`). A request from a role too low gets `403 FORBIDDEN`
regardless of what the UI shows.

### Zone scoping

A user can additionally be restricted to specific zones (`User.zoneScope: string[] | null`).
When set, it's enforced **server-side** on every list/detail endpoint (`zoneScoped()` helper) and
on the WebSocket hub (a scoped connection never receives `metrics`/`alert` frames for a camera
outside its zones — see `server/src/ws/hub.ts`'s `allowed()` check). The frontend's own filtering
(sidebar, chatbot context) is a UX convenience layered on top of already-scoped data, not the
enforcement point.

## Session model

- Session identity lives in an **httpOnly cookie** (`cdc_session`) — never readable by JS, never
  in `localStorage`. A separate, non-httpOnly `cdc_csrf` cookie pairs with an `X-CDC-CSRF` header
  on every mutating request (double-submit CSRF pattern); `GET`/`HEAD`/`OPTIONS` are exempt, and
  `/auth/login` itself is exempt (nothing to double-submit yet — see `server/src/rest/middleware.ts`).
- **Idle timeout**: 15 minutes of no mouse/keyboard/scroll/click activity
  (`features/auth/IdleSessionManager.tsx`) shows a 60-second warning, then locks the UI —
  `LockScreen` blurs the map behind a password re-entry prompt so a command-center screen never
  displays live crowd data to an unattended passerby. **Absolute session cap**: 12 hours
  server-side regardless of activity (`server/src/auth/sessions.ts`).
- **Step-up (re-authentication)**: retiring a camera, changing thresholds, and exporting an
  evidence bundle all call `useStepUpStore.request(reason)` first, which blocks on a password
  re-entry modal unless a step-up grant from the last 5 minutes is still valid. The grant is
  tracked both client-side (for UX) and server-side (`hasStepUp()` middleware) — a client that
  skips the modal (e.g., a modified frontend) still gets `401 STEP_UP_REQUIRED` from the API.
- **Forced logout / concurrent session revocation**: any `401` response from any API call fires a
  global `cdc:session-revoked` event; the session store locks the UI immediately
  (`LockScreen` with `lockReason: 'revoked'`), rather than failing that one request silently.

## Credentials and RTSP URLs

- The Add/Edit Camera forms accept an RTSP URL and optional username/password as **write-only**
  fields. The mock server never stores the raw URL: it's masked immediately
  (`server/src/data/cameraOps.ts`'s `maskRtspUrl`) into the shape persisted on the `Camera`
  object (`rtsp://***:***@host/path`), and the *only* thing retained for duplicate-URL detection
  is a SHA-256 hash of the original — never the URL itself. No API response, ever, includes a
  real RTSP credential.
- No credential, token, or PII appears in any URL (path or query string) anywhere in the app —
  deep links reference camera IDs and timestamps only.

## Audit trail

Every consequential action is queued client-side (`lib/audit/auditQueue.ts`) and flushed to
`POST /audit/events`, with retry-with-backoff through connectivity loss (never silently dropped —
a warning banner surfaces if the queue can't flush). The backend additionally records
sign-in/out, config diffs (before/after), and chatbot queries directly server-side, so audit
coverage doesn't depend solely on the client successfully phoning home. The **audit console is
read-only**: no edit or delete affordance exists anywhere in the UI, matching the append-only
guarantee expected of an audit trail in this context.

## Privacy / CJIS-adjacent posture

- The product counts and measures crowds; there is **no face-zoom or identification affordance**
  anywhere in the UI. Bounding-box overlays (real or the mock's synthetic stand-in) are
  deliberately anonymous — dots/boxes, never a magnified face crop.
- Exports (reports, evidence bundles, screenshots) are watermarked with the generating user,
  timestamp, and a report ID; evidence bundles additionally carry a SHA-256 checksum displayed in
  the UI for chain-of-custody verification. Evidence bundle export requires step-up
  re-authentication and is audit-logged.
- Retention is department-policy-driven and surfaced honestly: a historical query into a purged
  range returns `410 RETENTION_EXPIRED` and the UI shows "data purged per retention policy" rather
  than a misleading empty chart.

## Known gaps in this build

- **Retention settings UI** (ADMIN-configurable retention window) is not implemented — the
  retention window is a server env var (`RETENTION_DAYS`) in this mock. A real deployment would
  need an admin-facing settings screen backed by a real policy-configuration endpoint.
- **User management** is view-only conceptually; there's no user-creation/role-assignment UI in
  this build (the spec scopes ADMIN to "user management **view**," which is what's implemented —
  flagging here in case a full CRUD user-admin screen was intended).
- **OIDC/SSO** is mocked username/password + fixed-code TOTP, not a real identity provider — see
  ARCHITECTURE.md's "Deliberate scope decisions."
- `npm audit` reports several advisories in Vite/Vitest's own toolchain (esbuild dev-server
  request/response exposure, a Vite path-traversal issue in optimized-deps handling, and a
  Vitest-UI arbitrary-file-read issue) — all of these require either `vite dev` or `vitest --ui`
  to be running and reachable, i.e. a development-time-only exposure. None of them ship in the
  production build (`vite build` output has no dev server, no Vitest UI) and none are applicable
  to a real backend. Fixing them requires a major-version bump of Vite/Vitest that this build
  intentionally didn't take mid-project to avoid destabilizing an already-verified toolchain.
- `npm audit` also reports a moderate advisory in `uuid` (missing bounds check when a caller
  explicitly supplies a buffer to `uuid.v3/v5/v6`), pulled in transitively by `exceljs` (used to
  parse `.xlsx` bulk-import uploads). The app never calls `uuid` directly, and `exceljs`'s own
  usage doesn't pass an attacker-influenced buffer, so this is a low-practical-risk transitive
  dependency, not a directly exploitable path — flagged here rather than silently accepted. No
  fix is available without downgrading `exceljs` to a much older major version.
