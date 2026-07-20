# Compliance report — Crowd Density Agent operator console

This is the closing deliverable required by the original specification's §16 Execution Protocol:
a requirement-by-requirement compliance table against every numbered section (0–15) of that spec,
with every gap named explicitly rather than glossed over. Where a row is not fully met, the
"Notes" column says exactly what's missing and why, rather than claiming completion.

Verification basis: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:e2e` all pass clean from the repo root as of this report (0 lint errors — pre-existing
non-null-assertion/fast-refresh warnings only; 0 typecheck errors across both workspaces; 61/61
unit + integration tests passing (15 app + 46 server); both workspaces build; the Playwright
critical-path e2e — login → acknowledge a CRITICAL alert with a mandatory note → sign out → sign
in as a different role → generate and view a report — passes end-to-end against the real mock
backend in a real Chromium browser, not a stub). The RTSP/document bulk-import and theme-toggle
additions below were further verified live in a real Chromium session against real generated
`.xlsx`/`.pdf`/`.docx`/`.txt` fixture files, not just unit tests. This report was updated once
since first written, after a post-launch external audit — see "Addendum" below for that pass's
own findings and fixes, verified with the same standard.

## Legend

- ✅ Implemented and verified (code read + at least one of: unit test, integration test, e2e test,
  or manual browser verification during this build)
- ⚠️ Implemented with a named, deliberate limitation
- ❌ Not implemented — named as a real gap, not a scope decision

## §0 — App shell & layout

| Requirement | Status | Notes |
|---|---|---|
| Persistent app shell (top bar, sidebar, map canvas, alert tray) | ✅ | `app-shell/ShellLayout.tsx`, `TopBar.tsx`, `Sidebar.tsx` |
| Non-sensitive layout prefs persisted (not tokens/URLs/identity) | ✅ | `lib/state/uiStore.ts` persists UI prefs only; session lives in an httpOnly cookie, never `localStorage` — see SECURITY.md |
| Error boundaries isolating panel failures | ✅ | `app-shell/ErrorBoundary.tsx`, wrapped around shell regions and `KioskMode` separately |
| Dark-mode-first, WCAG AA, CSS variables | ✅ | Tailwind config uses CSS variables for theme tokens; 147 `aria-*` attributes across 36 component files |
| Light/dark theme toggle | ✅ | `TopBar.tsx` sun/moon toggle button flips `useUiStore`'s `theme`; `useThemeSync.ts` applies it as `<html data-theme>`, which both CSS variable blocks in `index.css` already keyed off. Persisted via the same non-sensitive UI-prefs store as other layout prefs; an inline script in `index.html` applies the persisted value before first paint to avoid a flash of the wrong theme on reload. Verified live: toggling flips the whole shell (sidebar, top bar, alert tray, modals) with correct contrast in both directions, and the choice survives a reload. The map's own basemap tile style (`baseLayer`) is a separate, independent setting, not tied to this toggle — swapping map tile themes was not requested and isn't implemented. |

## §1 — Map & geospatial rendering

| Requirement | Status | Notes |
|---|---|---|
| MapLibre GL + deck.gl, never hundreds of DOM markers | ✅ | `features/map/MapCanvas.tsx` renders deck.gl `IconLayer`/`ScatterplotLayer`; no per-camera DOM nodes |
| Clustering runs in a Web Worker | ✅ | `lib/workers/cluster.worker.ts` (Supercluster), consumed via `features/map/useClusteredCameras.ts` |
| FOV cones | ✅ | `features/map/geo.ts` + `MapCanvas.tsx` |
| Heatmap throttled ≤1/sec | ✅ | Backpressure enforced in `WebSocketManager` (rAF-batched, heatmap tick capped at 1Hz) — see ARCHITECTURE.md "Backpressure" |
| Pulsing alert markers, GPU-animated | ✅ | deck.gl layer property animation, not CSS/DOM |
| Multi-select lasso | ⚠️ | Works on unclustered markers only; doesn't expand a collapsed cluster at low zoom. Documented as a deliberate scope decision in ARCHITECTURE.md rather than silently missing |
| Floor plans for indoor cameras | ✅ | `data/seed.ts` `FLOORPLANS`, rendered in camera detail for indoor-tagged cameras |
| `?perf=1` overlay (FPS / WS rate / heap) | ✅ | `features/map/PerfOverlay.tsx` |
| Hard perf budgets (60fps/300 markers, <3s paint, ~0 heap growth/8h) | ⚠️ | **Architected for, not independently benchmarked on real hardware** — and this time with a real, live-measured finding behind that caveat rather than just a disclaimer. A live smoke test in this sandbox measured sub-1fps with 1.4s frame gaps; root-caused to the alert-pulse animation forcing a full deck.gl layer-diff pass 15x/sec (see ARCHITECTURE.md bug #6) and fixed to ~6fps, zero-frames-over-1s. The residual gap was then confirmed via `WEBGL_debug_renderer_info` to be this environment's software-rendered WebGL (`SwiftShader`, no real GPU) — toggling the heatmap layer off alone changed fps 3-4x, consistent with a software rasterizer struggling with multi-pass GPU aggregation rather than a code defect. The fixes made are real and hardware-independent; whether the *original* 60fps target is met is still unverified on real hardware, exactly as this row already said, now with evidence for why. |

## §2 — Camera health & lifecycle states

| Requirement | Status | Notes |
|---|---|---|
| ONLINE / DEGRADED / RECONNECTING / OFFLINE / MISCONFIGURED / DISABLED, exact semantics | ✅ | `server/src/sim/fleet.ts` state machine; `tests/fleet.test.ts` covers every transition including DISABLED emitting no metrics and re-enable resuming cleanly |
| Status visible on map marker and sidebar row | ✅ | `features/cameras/CameraStatusBadge.tsx`, shared between both |

## §3 — Camera management

| Requirement | Status | Notes |
|---|---|---|
| Add / edit / retire, no hard-delete | ✅ | `AddCameraModal.tsx`, `EditCameraModal.tsx`; `retireCamera` sets a retired flag and excludes from active lists (`tests/fleet.test.ts` "retired excluded") — row is never deleted |
| Direct RTSP URL entry | ✅ | `AddCameraModal.tsx` (single camera) and `BulkImportModal.tsx`'s "Paste RTSP links" mode (many at once, one per line, optionally `Name, rtsp://…`) |
| Write-only, masked credentials | ✅ | RTSP URL/credentials never round-trip; masked server-side (`maskRtspUrl`), only a SHA-256 hash retained for dedup — see SECURITY.md |
| Bulk import — CSV/JSON/Excel/PDF/Word/pasted links | ✅ | `features/cameras/BulkImportModal.tsx` + `server/src/data/bulkImportParsers.ts`. `.csv`/`.json`/`.xlsx` are fully structured (same column template); `.pdf`/`.docx`/`.txt`/pasted text extract `rtsp://` links via text extraction + regex and require an operator-selected default zone (prose has no zone/coordinate columns to read). See API_CONTRACT.md's "Bulk-import file formats" and ARCHITECTURE.md's scope-decisions log for the `pdf-parse` → `pdfjs-dist` and `xlsx` → `exceljs` library swaps made after each surfaced a real problem (an unparseable modern PDF and two unpatched high-severity advisories, respectively) during verification. Verified against real generated `.xlsx`/`.pdf`/`.docx`/`.txt` fixtures in a live browser, not just unit tests. |
| Retire requires step-up + typed confirmation | ✅ | `useStepUpStore`, enforced both client- and server-side (`requireStepUp` middleware) |

## §4 — Camera detail panel

| Requirement | Status | Notes |
|---|---|---|
| Video player states (loading/live/degraded/offline/error) | ✅ | `features/video/VideoPlayer.tsx` |
| Concurrent-stream governor, default N=6 | ✅ | `lib/video/StreamGovernor.ts`, configurable via `VITE_MAX_CONCURRENT_STREAMS` |
| Sparklines with gap rendering (never interpolate) | ✅ | `features/metrics/chartData.ts` inserts explicit `null` at gaps; `tests/unit/chartData.test.ts` asserts this |
| Alert history for the camera | ✅ | `features/alerts/CameraAlertHistory.tsx` |

## §5 — Time-travel & historical playback

| Requirement | Status | Notes |
|---|---|---|
| Scrub bar, 1x/4x/16x playback | ✅ | `features/timeline/` |
| Retention-purged range handled explicitly | ✅ | Server returns `410 RETENTION_EXPIRED`; UI shows "data purged per retention policy," not a blank chart — see SECURITY.md |
| UTC storage, local display | ✅ | `lib/utils/time.ts`; all timestamps from server payloads, never client receipt time (relevant to clock-skew handling in §12 too) |

## §6 — Auth, roles, session security

| Requirement | Status | Notes |
|---|---|---|
| VIEWER < OPERATOR < SUPERVISOR < ADMIN | ✅ | `lib/rbac/permissions.ts`, mirrored server-side; full role→action table in SECURITY.md |
| Zone scoping | ✅ | Enforced server-side on REST and the WS hub (`server/src/ws/hub.ts`'s `allowed()`), not just UI filtering |
| Idle timeout with 60s warning + lock screen | ✅ | `IdleSessionManager.tsx`, `IdleWarningModal.tsx`, `LockScreen.tsx` — 15 min idle, 60s warning, then lock |
| Step-up re-auth for sensitive actions | ✅ | Retire camera, tune thresholds, export evidence bundle — client modal + server-side `401 STEP_UP_REQUIRED` if bypassed |
| Forced-logout handling | ✅ | Global `cdc:session-revoked` event on any `401`, locks UI immediately rather than failing one request silently |
| Sign out returns to a clean login state | ✅ | **Fixed during this verification pass** — `TopBar`'s sign-out previously called `lock('manual')`, which kept `user` populated and showed the *idle-lock* screen ("Console locked… Signed in as \<name\>") instead of the login page; a genuine sign-out couldn't switch users at all. Caught by the Playwright e2e test (which signs out as `operator` and back in as `supervisor`), fixed by calling `clearSession()` instead. Documented in ARCHITECTURE.md's bug log. |

## §7 — AI assistant (chatbot)

| Requirement | Status | Notes |
|---|---|---|
| Context-aware, grounded answers with source chips | ✅ | `features/chatbot/`; server `rest/chat.ts` returns answers with source references |
| Canned intents | ✅ | Handled server-side in the mock's chat endpoint |
| Audit-logged | ✅ | Chatbot queries recorded server-side per SECURITY.md's audit trail section |

## §8 — Auditing

| Requirement | Status | Notes |
|---|---|---|
| Append-only, no edit/delete affordance | ✅ | `features/audit/AuditConsole.tsx` is read-only by construction; confirmed in SECURITY.md |
| Watermarked, exportable | ✅ | CSV export in the audit console |
| Client queue with retry-through-outage | ✅ | `lib/audit/auditQueue.ts`, retry-with-backoff, warning banner if it can't flush — never silently dropped |

## §9 — Alerting workflow

| Requirement | Status | Notes |
|---|---|---|
| Hysteresis / sustained-duration raise | ✅ | `server/src/sim/thresholds.ts`; `tests/thresholds.test.ts` — no raise on instant breach, raises only after sustained duration, oscillation across the WARNING/CRITICAL bracket doesn't reset the sustain clock (this was a real bug found and fixed during the build, documented in the test suite itself) |
| Cooldown suppresses re-fire | ✅ | `tests/thresholds.test.ts` "cooldown-suppresses-refire" |
| Storm dedup | ✅ | `features/alerts/dedup.ts` — zones at/above `STORM_THRESHOLD` (6) collapse into one card; `tests/unit/alertDedup.test.ts` |
| One-click WARNING ack | ✅ | `AlertList.tsx` `AlertCard` |
| Mandatory-note CRITICAL ack | ✅ | Acknowledge button is disabled until a note is entered for CRITICAL severity; verified end-to-end by the Playwright critical-path test |
| Bulk-ack, SUPERVISOR-only | ✅ | `StormCard`'s bulk-ack button, gated by `useHasPermission('bulkAckAlerts')` and server-side `requireRole` |

## §10 — Reporting & export

| Requirement | Status | Notes |
|---|---|---|
| PDF/CSV export, watermark + report ID | ✅ | `features/reports/pdfExport.ts` (pdf-lib), watermarked with user/timestamp/report ID |
| Evidence bundles, SHA-256 chain-of-custody + step-up | ✅ | `EvidenceBundleButton.tsx`; checksum computed via Web Crypto, displayed in `ReportViewer.tsx`; requires step-up |
| Scheduled digests | ✅ | Configurable by SUPERVISOR+ per SECURITY.md's role table |
| Async job with progress | ✅ | Report generation is polled (`My reports` → status transitions to "Done"); exercised directly by the e2e test |

## §11 — Real-time WS layer edge cases

| Requirement | Status | Notes |
|---|---|---|
| Multiplexed topics, subscribe/unsubscribe with ref-counting | ✅ | `lib/ws/WebSocketManager.ts`; `tests/unit/wsManager.test.ts` "topic ref-counting" |
| Reconnect with backoff + jitter + resync | ✅ | Same test file, "reconnect backoff+resync" |
| Seq-based ordering / dedup | ✅ | "resequencing/dedup" test case |
| Corrupt-value clamping | ✅ | Dedicated test case; manager clamps out-of-range metric values rather than rendering garbage |
| Backpressure ≤4Hz/camera, ≤1Hz heatmap | ✅ | rAF-batched emission, tested via "backpressure batching" |
| Clock-skew detection | ✅ | Server pushes `server_time` every 5s; client surfaces a top-bar warning past a 30s threshold — see ARCHITECTURE.md |

## §12 — Reliability / failure UX

| Requirement | Status | Notes |
|---|---|---|
| Error boundaries | ✅ | See §0 |
| Full-outage mode | ✅ | WS connection-status store drives a banner/degraded state app-wide rather than a silent hang |
| No silent failures | ✅ | Audit queue warns on flush failure; WS shows connection status; report jobs show failed state, not a spinner forever |

## §13 — Privacy / CJIS-adjacent guardrails

| Requirement | Status | Notes |
|---|---|---|
| No face-zoom / identification affordance | ✅ | See SECURITY.md — bounding boxes are anonymous by design |
| No PII in URLs | ✅ | Deep links use camera IDs and timestamps only |
| Retention notices | ✅ | `410 RETENTION_EXPIRED` handling, see §5 |
| Watermarked exports | ✅ | See §10 |

## §14 — Quality bar

| Requirement | Status | Notes |
|---|---|---|
| Accessibility | ✅ | 147 `aria-*` attributes across 36 files; keyboard-operable modals via `Portal` + focus handling |
| i18n-ready | ❌ | **Real gap.** No i18n scaffolding exists — no `react-i18next`/`FormatJS`, no string-externalization, no locale files. All UI text is hardcoded English JSX. The spec asked for "i18n-ready," which this build does not satisfy; a real implementation would need a string-extraction pass and a translation-key architecture before shipping to a non-English-only department. |
| Unit + integration tests | ✅ | 15 app unit tests + 46 server unit/integration tests, all passing |
| Playwright e2e | ✅ | Critical path (login → ack CRITICAL alert with note → sign out → sign in as a different role → generate + view report) passes against the real mock backend |
| CI script | ✅ | `.github/workflows/ci.yml` — lint/typecheck/test, build, and e2e (with trace/report artifact upload on failure) as three jobs |
| README / API_CONTRACT / ARCHITECTURE / SECURITY docs | ✅ | All four present and current as of this report |
| Feature-folder structure | ✅ | `app/src/features/{alerts,audit,auth,cameras,chatbot,kiosk,map,metrics,realtime,reports,timeline,video}` |
| No dead code / no lorem-ipsum placeholders | ✅ | All copy is real (mock department name, real-looking camera/zone names); no lorem-ipsum found in a repo-wide search |

## §15 — Kiosk / video-wall mode

| Requirement | Status | Notes |
|---|---|---|
| Chromeless video-wall grid | ✅ | `features/kiosk/KioskMode.tsx`, own route (`/kiosk`) |
| Toggle gated to SUPERVISOR+ | ✅ | Per SECURITY.md's role table |
| Auto-recovering error boundary | ✅ | Wrapped separately from the main shell's boundary, per ARCHITECTURE.md |

## §16 — Execution protocol compliance

- **Vertical-slice build order**: followed as specified (shell+auth+mock → map+clustering+live
  data → camera detail+video governor → alerting → time-travel → audit console → reporting →
  chatbot → kiosk mode).
- **Self-review after each slice, fix gaps, recurse**: performed via real-browser manual
  verification throughout the build, which caught and fixed five non-trivial bugs (query-key
  collision, unstable query key stalling a fetch, an infinite render loop, a stacking-context
  click-interception trap, and — caught specifically by the e2e suite during this final pass —
  sign-out not actually signing out). All five are documented with root cause in ARCHITECTURE.md's
  "Bugs found and fixed" section, not just fixed silently.
- **Final gap report**: this document, including the addendum below covering a second §16 loop
  run against a post-launch external audit.

## Addendum — response to a post-launch external audit

After initial delivery, an external audit document (`dashboard-audit-and-fix-directives.md`)
raised performance, correctness, geography, layout, and "missing feature" claims, and closed with
its own instruction: *"Re-run the §16 compliance loop and produce the gap table when done."* This
addendum is that re-run. Per this build's own established discipline, every claim was verified
live (real browser, real API calls, direct code reads) before being acted on, rather than trusted
at face value — several turned out to be stale observations against an earlier state of the build,
not live bugs. Both the real findings and the stale ones are reported honestly below, rather than
folding "already fine" claims into the fix list to look busier, or silently ignoring the real ones.

### P0 — Performance (all confirmed real, all fixed)

| Claim | Verified? | Fix |
|---|---|---|
| WS firehose — every client received every camera's every tick via a stray `'global'` topic on the per-camera broadcast | ✅ real | Removed `'global'` from the per-camera broadcast; added a separate rate-capped (≤1Hz) `fleet_snapshot` message for fleet-wide aggregate reads. `server/src/ws/hub.ts`, `app/src/lib/ws/WebSocketManager.ts` |
| deck.gl layer churn — the whole `layers` memo recomputed on every pulse-animation frame | ✅ real | Split into a `staticLayers` memo (no `pulsePhase` dependency) and a separate `pulseLayer` memo. `features/map/MapCanvas.tsx` |
| Reconnect resync flood — client re-requested replay for every camera it had ever touched, not just active subscriptions | ✅ real | Resync now only requests replay for cameras with a live `camera:<id>` topic ref. `WebSocketManager.ts` |
| Density values exploding / pinning at exactly 100% | ✅ real | Surge target was computed as a multiple of the diurnal ambient factor, compounding instead of adding; decoupled the two, and replaced nested hard `Math.min(1, …)` clamps with an asymptotic soft-compression curve so CRITICAL is reliably crossed without landing dead-on 100%. `server/src/sim/metrics.ts`; `tests/metrics.test.ts` asserts both properties directly |

### P1 — Correctness (all confirmed real, all fixed)

| Claim | Verified? | Fix |
|---|---|---|
| Duplicate camera names within a zone | ✅ real | Seed data used a single global counter instead of a per-zone one. Fixed with a `zoneCameraCounts` map. `server/src/data/seed.ts` |
| Alerts never firing | ⚠️ stale-turned-real | Root cause was the firehose (above) starving the UI of timely ticks, not the threshold engine itself — `tests/thresholds.test.ts` already covered hysteresis/cooldown correctly. Resolved as a symptom of the P0 fix; verified live with a fresh alert-storm scenario post-fix |
| Video player stuck loading | ⚠️ stale-turned-real | Same firehose root cause — a starved WS connection reads as "the video never starts." No separate video-layer bug found |
| Fleet-wide / group aggregate totals going stale | ✅ real, self-introduced | Caught proactively before shipping: fixing the firehose removed the `'global'`-topic ticks that `useFleetTotals`/`GroupDetailPanel` had been (incorrectly) relying on. Switched both to `useHeatmapTick()`, the correct always-on tick source |
| Alert-ack UI race under concurrent invalidations | ✅ real, found via e2e flakiness | `useAckAlert` relied solely on `invalidateQueries`, racing against the ambient simulation's own background refetches. Fixed with a direct `setQueryData` cache patch from the ack response itself (`patchAlertInCache`), applied to ack/resolve/escalate |
| Historical/time-travel mode leaking live state | ⚠️ not reproduced | Investigated directly; the existing seam (documented in ARCHITECTURE.md's "Time-travel: one seam, not a parallel app") already isolates historical fetches from the live WS-driven query cache. No live-state leak found under manual scrubbing |
| Double audit logging on console open | ✅ real, pre-existing fix confirmed still correct | `AuditConsole.tsx`'s `hasLoggedView` ref (guards React 18 StrictMode's dev-only double-invoke) was already in place and reconfirmed working, not a live duplicate-log bug |

### Geography relocation

The mock dataset's placeholder US-city geography was replaced with a real city, at the user's
explicit confirmation: Rajahmundry (Rajamahendravaram), Andhra Pradesh, India. All 300 cameras,
zones, and landmark names now reflect real local geography (Godavari Bund Road & Pushkar Ghat,
Municipal Stadium / Anam Kala Kendram, Rajahmundry Railway Station, ISKCON / Gowthami Ghat,
Kotilingala Ghat / Saraswati Ghat, Dowleswaram Barrage, Airport Approach / Madhurapudi, and more),
verified live across the map, sidebar, alert tray, Kiosk mode, and lasso group-selection panel —
zone dropdowns, marker labels, and alert copy all agree with each other and with no residual
placeholder names left anywhere in the seed data.

### Layout redesign + toast-storm fix

- **Sidebar**: converted to per-zone accordions with a "stacked card panel" visual language (44px
  flush rows, card background, hairline borders, rotating chevron, pill highlight on select/hover,
  live-number crossfade, thin scrollbars, `prefers-reduced-motion` support). `app-shell/Sidebar.tsx`,
  `features/cameras/CameraListRow.tsx`.
- **Icon rail + right-docked panels**: Reports/Audit/Event log moved off an overcrowded top bar
  onto a dedicated left icon rail (with `T`/`K`/`R`/`A`/`E` keyboard shortcuts) and converted from
  full-screen takeovers to 720px right-docked slide-overs, so the map stays visible behind them.
  The same card visual language was applied to their content for a consistent system-wide look.
  `app-shell/IconRail.tsx`, `ShellLayout.tsx`, `features/audit/AuditConsole.tsx`,
  `features/reports/ReportsCenter.tsx`, `app-shell/EventLogDrawer.tsx`.
- **Toast storm**: alerts now dedup at the mutation/engine layer (keyed by
  `cameraId+severity+breachStart`), single toasts cap at 3 visible with an 8s auto-dismiss, and
  more than 3 CRITICAL alerts within a 10s window collapse into one zone-grouped summary toast that
  updates its own count rather than spamming individual toasts. Zone display names are resolved
  from the query cache, never a raw `zone-*` id. Verified live with a 40-camera storm scenario:
  exactly one summary toast ("41 CRITICAL alerts across 10 zones") plus a fully populated, legible
  alert tray — no UI lockup, no raw ids. `features/realtime/WsBridge.tsx`, `app-shell/ToastHost.tsx`,
  `lib/state/toastStore.ts`.

Two bugs surfaced and fixed during this pass, in the same spirit as ARCHITECTURE.md's existing bug
log (not repeated here in full — see that document): a Tailwind class typo
(`border-border-hairline`) that made the sidebar vanish after a theme switch, and a full-viewport
panel backdrop that intercepted clicks on the icon rail (fixed with the same
`pointer-events-none`-on-wrapper / `pointer-events-auto`-on-children split `TopBar` already used).

### P2 — "Missing feature" claims

Every item in this section was investigated by reading the actual implementation before assuming
the audit was correct. Four of five claims turned out to already be fully implemented — most
likely stale observations made against an earlier build state (e.g. before any camera was
alerting, so a conditionally-rendered grid correctly rendered nothing) — and were confirmed
correct by exercising them live rather than just reading the code:

| Claim | Finding | Action |
|---|---|---|
| "Kiosk mode is map-only — missing the top-N alerting cameras grid + auto-rotation" | ❌ stale — `features/kiosk/KioskMode.tsx` already had a complete top-6, severity-ranked, 15s-auto-rotating grid | Verified live: triggered a 40-camera alert storm, opened Kiosk mode, confirmed a populated 6-tile rotating grid with real camera names, live status dots, and synthetic video, plus a correct "39 alerting" count in the header. No code change needed |
| "Reports output a bare table — missing charts, threshold-breach markers, PDF header block, per-page watermark + report ID" | ⚠️ mostly stale — `pdfExport.ts` already had a department/report-ID header, a per-page "SYSTEM-GENERATED" footer watermark, a per-camera sparkline chart, and a SHA-256 checksum. The one genuinely missing piece was **threshold-breach markers** — the sparkline plotted headcount only, with no visual indication of where `densityRisk` crossed WARNING/CRITICAL | Fixed the real gap: `drawSparklinePng` now overlays a colored dot (amber ≥0.55, red ≥0.80) on every sample that breached a threshold, using the same `xAt`/`yAt` coordinate mapping already used for the line itself and the same cutoffs shown elsewhere in the app. Verified live end-to-end: triggered a real alert storm, generated a 300-camera report through the actual UI, downloaded the resulting PDF, and confirmed via `pdf-lib` that it has 51 pages with 300 embedded chart images — one per camera, as expected. Stopped short of a pixel-level visual read of the marker dots themselves: this headless Chromium build offers a PDF as a download rather than rendering it inline (a tooling limitation hit during this pass, not a code gap), so the marker-drawing logic is verified by code review plus this structural confirmation, not an eyes-on screenshot of the dots |
| "Map is missing FOV cones" | ❌ stale — already implemented, zoom-gated (`FOV_CONE_MIN_ZOOM = 14`), colored by density severity | Verified live at zoom ≥14: directional cone polygons rendered correctly per camera bearing/angle/range, color-matched to severity |
| "Map is missing lasso multi-select" | ❌ stale — already implemented via Shift+drag + deck.gl `pickObjects` | Verified live: a Shift+drag over 9 markers opened a "Group selection" panel listing all 9 cameras by name/status/headcount |
| "Missing idle-lock / step-up verification" | ❌ stale — `IdleSessionManager` (15 min idle, 60s warning), `LockScreen` (gated in `ProtectedRoute`), and `StepUpModal`/`useStepUpStore` (gating retire-camera, threshold-tuning, evidence-bundle export) were all already implemented and wired | Confirmed via code read of the full call chain (store → consumers → gating components). Not re-verified by physically waiting out the 15-minute idle timeout in a live session — noted here rather than silently assumed identical to the code-read finding |

### Final verification (this addendum)

`npm run lint`, `npm run typecheck`, and `npm test` all pass clean in both `app/` and `server/`
(61/61 unit/integration tests), and both workspaces build. The Playwright critical-path e2e needed
two rounds of investigation before it was reliably green:

1. **First failure** — the report viewer's "Peak" column never appeared. Traced to a stale,
   17-minutes-old leftover report job from hours of manual scenario-triggering against the same
   never-restarted dev server (this session's own live-verification work, not a fresh-CI
   scenario); the test's loose `getByText('Done').first()` matched that old job instead of waiting
   for the newly-generated one. Resolved by restarting both servers; not a code regression, and not
   reachable in a real CI run, which always starts from a clean process.
2. **Second failure, on a freshly-restarted server** — the individual alert card the test was
   filling and clicking got replaced mid-interaction by an anonymous zone-wide `StormCard`, because
   ambient/organic alerts had independently pushed `zone-industrial`'s open-alert count to the
   storm-grouping threshold (6) even though the test's own deliberately-small 3-alert storm never
   would alone. This is a **real, reproducible race** in the test's own design — self-documented in
   its comments as an accepted, "lowest-chance" (not zero-chance) risk — and reproduced on a genuinely
   fresh server, not an artifact of this session's manual testing. Fixed by having the test resolve
   any pre-existing OPEN alerts in its target zone via the API before triggering its own storm, so
   ambient noise can no longer tip the zone over the threshold. `app/tests/e2e/critical-path.spec.ts`.

After the fix, the suite passed cleanly across multiple consecutive runs.

## Summary of open gaps (everything that is not a clean ✅, in one place)

1. **i18n-ready (§14)** — genuinely not implemented. No scaffolding exists; this is the one
   requirement in the original spec with no partial credit.
2. **60fps/300-marker/<3s-paint/~0-heap-growth perf budget (§1)** — implemented correctly
   (GPU rendering, worker clustering, rAF-batched updates, teardown, the `?perf=1` overlay) but
   not independently benchmarked on real hardware in this environment, since no GPU browser was
   available to me. This is a verification gap, not a code gap. **Update:** a later live "run"
   smoke test found and fixed a real bug that was making this *worse* than the disclosed gap alone
   would suggest — the alert-pulse animation was forcing a full deck.gl layer re-diff 15x/sec,
   measured at sub-1fps with 1.4s freezes. Fixed to ~6fps; see ARCHITECTURE.md bug #6. The
   remaining shortfall from 60fps was then confirmed (via `WEBGL_debug_renderer_info`) to be this
   sandbox's software-rendered WebGL, not further unfixed code — but the *original* budget is still
   unverified on real hardware, same as before this update.
3. **Lasso-select on collapsed clusters (§1)** — a deliberate, documented scope decision (shift-click
   still works at any zoom), not an oversight, but listed here for completeness since it's a
   partial rather than a full implementation of "multi-select lasso."
4. **Retention-settings UI, full user-admin CRUD, real OIDC/SSO** — all explicitly out of scope
   for a mock-backend build and documented as such in SECURITY.md's "Known gaps," carried forward
   here rather than re-litigated.
5. **Idle-lock (15 min) not re-verified by physically waiting it out live** — the full mechanism
   (`IdleSessionManager` → `LockScreen`/`IdleWarningModal`) was confirmed correct by reading the
   complete call chain during the audit-response pass above, but not exercised end-to-end in a live
   browser session in this build, since doing so would mean idling a session for 15 real minutes.
   Named here rather than silently treated as equivalent to a live-clicked verification.

Everything else in the original 16-section specification is implemented, wired end-to-end against
the documented mock contract, and passes the full verification suite (lint, typecheck, unit,
integration, build, and e2e) as of this report.
