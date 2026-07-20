# Architecture

This document explains how the Crowd Density Operator Console is put together, why the state is
split the way it is, and what the performance budgets are and how they're actually enforced.

## Layers

```
routes/            → route-level composition (Login, Shell, guards)
app-shell/          → chrome: TopBar, Sidebar, RightPanel, ErrorBoundary, toasts
features/*/         → one folder per product area, each owning its own api.ts (TanStack Query
                       hooks), UI components, and any feature-local state
lib/
  api/               → low-level fetch wrapper + shared QueryClient + query key factory
  ws/                → WebSocketManager (see below) + React bridge hooks
  state/             → cross-feature Zustand stores (session, ui, selection, ws, time, toasts,
                       step-up)
  workers/           → Web Worker sources (clustering)
  video/             → StreamGovernor singleton
  audit/             → client-side audit event queue
  ui/                → tiny shared primitives (Modal, Portal, UPlotChart)
  utils/             → time/formatting helpers
```

**Feature folders own their data fetching.** There's no central "store" of cameras/alerts —
each feature calls its own `useQuery`/`useMutation` hooks against the REST API, and TanStack
Query's cache is the de-facto shared source of truth (keyed via `lib/api/queryClient.ts`'s
`queryKeys` factory, which is the single place key shapes are defined — see the note below on
why `camera` and `cameras` are deliberately different top-level keys).

## Three state layers, on purpose

1. **Server state (TanStack Query)** — anything that comes from a REST call: camera list,
   alerts, audit events, reports. Caching, retries, and staleness are TanStack's job.
2. **Live state (WebSocketManager, outside React)** — per-camera metrics arriving multiple
   times a second. This is deliberately *not* routed through TanStack Query or a Zustand store
   that all components subscribe to — see "Why the WS manager lives outside React" below.
3. **Client/UI state (Zustand)** — session, current selection, sidebar width, kiosk mode,
   time-travel scrub position. Small, synchronous, no server round-trip.

Mixing these up is the most common source of the two real bugs found during manual verification
of this build (see "Bugs found and fixed" below) — both were about state living in the wrong
layer or a query key changing when it shouldn't have.

## Why the WebSocket manager lives outside React

`lib/ws/WebSocketManager.ts` is a plain class, instantiated once as a module-level singleton
(`getWsManager()`), not a hook and not a Zustand store holding per-camera data. Reasons:

- **Fan-out without re-rendering everything.** At 300 cameras with live updates, a single
  Zustand store holding `Record<cameraId, CameraMetrics>` would re-render *every* subscriber on
  *every* message. Instead, components subscribe per-camera via `useSyncExternalStore`
  (`lib/ws/hooks.ts` → `useCameraMetrics(id)`), so only the component showing that one camera
  re-renders when its data changes.
- **Backpressure needs to live below the component tree.** The manager batches inbound frames
  via `requestAnimationFrame` and caps emission to ≤4 Hz per camera (matching the product
  requirement) and a separate ≤1 Hz tick for heatmap/cluster aggregation — this only works
  cleanly as an imperative scheduler, not as a chain of React re-renders.
- **Reconnect/resync state (backoff, sequence numbers) is inherently imperative** — it's a state
  machine reacting to socket events, not a render output.

The manager writes connection-state into a small Zustand store (`lib/state/wsStore.ts`) purely
for the handful of UI indicators that need it (top bar LIVE/RECONNECTING pill, perf overlay) —
that store holds *status*, never the per-camera payloads.

## Rendering strategy: WebGL for anything that scales with camera count

The map (`features/map/MapCanvas.tsx`) renders through deck.gl layers over a MapLibre base map,
never DOM markers:

- **Clustering** runs in a Web Worker (`lib/workers/cluster.worker.ts`, Supercluster) — the main
  thread never touches the clustering algorithm. The worker is re-run (a fresh `refresh` message,
  not appended state) whenever the camera list, viewport, or the 1 Hz heatmap tick changes; this
  is cheap because Supercluster indexing 300 points takes low single-digit milliseconds, so
  rebuilding on every trigger is simpler and still well inside budget.
- **Markers, FOV cones, heatmap, and the alert pulse** are each a deck.gl layer
  (`IconLayer`/`PolygonLayer`/`HeatmapLayer`/`ScatterplotLayer`). The alert pulse's animation
  clock (`features/map/usePulsePhase.ts`) is a free-running `requestAnimationFrame` loop
  *decoupled from data updates* — it only changes a `getRadius` accessor, so pulsing costs
  nothing extra in JS beyond one small state update ~15 times/sec, regardless of how often real
  data arrives.
- **Sidebar list virtualization** (`react-window` + `react-virtualized-auto-sizer`) renders only
  visible rows for up to 500+ cameras. Row height is looked up per-index from a precomputed
  `rows` array; `resetAfterIndex` is only called when the *shape* of that array changes (zone
  grouping/filter results), not on every live metrics tick — see the bug note below for why that
  distinction matters.

## Video: governed synthetic feeds, real governor logic

There is no real camera hardware or media gateway in this repo. `features/video/VideoPlayer.tsx`
implements the *real* state machine the product spec asks for (offline → governed →
connecting → buffering → live → error → auto-reconnect with jittered backoff), and
`lib/video/StreamGovernor.ts` is a real app-wide concurrency cap (`VITE_MAX_CONCURRENT_STREAMS`,
default 6) — acquiring/releasing a slot, denying extra concurrent viewers with a "Go live"
snapshot fallback exactly as a real WebRTC/LL-HLS integration would need to.

What's synthetic is *only* the pixels: `features/video/SyntheticFeedRenderer.ts` draws an
anonymous moving-dot scene onto a `<canvas>` at ~display refresh rate, standing in for a decoded
video frame. **Swapping in the real media gateway (MediaMTX/go2rtc) is a single-seam change**:
replace the canvas-draw loop in the `'live'` branch of `VideoPlayer` with a WebRTC
`RTCPeerConnection` (or `hls.js` `MediaSource` attach) targeting `camera.streamKey`, keeping the
governor/state-machine/PiP code as-is — Picture-in-Picture already works for real, via
`canvas.captureStream()` piped into a hidden `<video>`.

## Time-travel: one seam, not a parallel app

Rather than forking every component into "live" and "historical" variants,
`features/cameras/useEffectiveCamera.ts` is the single seam: it returns `{status, metrics,
isHistorical}` from either the live WebSocket path or a fetched historical snapshot
(`GET /history/state?at=`), depending on `timeStore.isHistorical`. The sidebar, map clustering
input, and detail panel all read through this hook (or the map-specific
`useClusteredCameras(..., historicalByCamera)` variant), so scrubbing the timeline transparently
repaints the whole app without every component needing its own live/historical branch.

## Performance budgets — what's implemented vs. what's actually measured

The architecture is built to the stated budgets (60 fps with 300 markers + heatmap + pulsing
alerts; steady-state heap growth ≈ 0 over a shift; initial paint < 3 s):

- Implemented: WebGL rendering for all per-frame drawing, worker-based clustering, rAF-batched
  and rate-capped WS delivery, virtualized lists, a hard concurrent-video-stream cap, and
  teardown paths (WS unsubscribe ref-counting, `StreamGovernor.releaseSlot`, `cancelAnimationFrame`
  in every effect cleanup) aimed specifically at preventing the growth patterns (orphaned
  listeners, undisposed video elements, growing WS buffers) the budget calls out.
  A `?perf=1` overlay (`features/map/PerfOverlay.tsx`) exposes live FPS, WS message rate, and
  JS heap (Chromium only, via `performance.memory`).
- **Not independently benchmarked by this build**: there is no GPU-accelerated browser available
  in the environment this was built in, so the 60 fps/300-marker figure and the 8-hour heap-growth
  claim are architected-for and instrumented-for, not measured. Anyone deploying this should run
  the perf overlay over a real shift on real hardware before trusting the budget is actually met.
  This is called out explicitly rather than silently assumed — see the compliance report.
- **Confirmed, with hard numbers, during a later live verification pass**: this environment's
  Chromium reports `ANGLE ... SwiftShader ... software rendering` as its WebGL renderer (checked
  via `WEBGL_debug_renderer_info`) — there is no real GPU behind it. Real `requestAnimationFrame`
  timing measured under a live 300-camera simulation showed sub-1fps with gaps up to 1.4s before a
  fix, ~6fps after (see the bug entry below) — and toggling deck.gl's `HeatmapLayer` off alone
  changed the measured fps by 3–4x, which is consistent with SwiftShader's software rasterizer
  being disproportionately slow at a multi-pass GPU aggregation layer, not with the layer being
  unreasonably expensive for 300 points on real hardware. This doesn't retroactively prove the
  60fps budget is met on real hardware, but it does explain *why* this sandbox can't verify it, with
  evidence rather than assumption.

## Real-time data layer edge cases (as implemented)

- **Ordering**: per-camera monotonic `seq` numbers; `WebSocketManager` drops any frame with
  `seq` ≤ the last-seen `seq` for that camera and counts it in `wsStore.diagnostics`.
- **Corrupt values**: negative headcount and out-of-range probabilities/percentages are clamped
  client-side and counted, never rendered as-is (`clampMetrics` in `WebSocketManager.ts`).
- **Reconnect**: exponential backoff with jitter (base 500 ms, cap 30 s), then a `resync` message
  carrying `{cameraId: lastSeq}` for every camera with a live subscription, so the server can
  replay only what was missed.
- **Clock skew**: the server pushes `server_time` every 5 s; the client compares against
  `Date.now()` and surfaces a top-bar warning past a 30 s threshold. All displayed timestamps
  come from the server payload, never client receipt time.
- **Backpressure**: see "Why the WebSocket manager lives outside React" above.

## Bugs found and fixed during manual browser verification

Documented here because they're instructive about the state-layering rules above, not because a
changelog belongs in an architecture doc:

1. **Query-key collision**: `queryKeys.camera(id)` originally returned `['cameras', id]`, the
   same top-level key as the camera *list* query `['cameras', filters]`. `WsBridge`'s
   `setQueriesData({queryKey: ['cameras']})` partial-matcher patched *both* shapes, and the
   list-shaped updater (`old.items.map(...)`) crashed when it ran against the single-camera
   object (no `.items`). Fixed by giving the single-camera query its own top-level key
   (`['camera', id]`).
2. **Unstable query key stalling a fetch indefinitely**: `CameraSparkline` computed
   `const now = Date.now()` directly in the component body, feeding a `useCameraHistory` query
   key. Because the panel re-renders live (WS-driven metrics ticks elsewhere on the same panel),
   a new `now` — and therefore a new query key — was created on nearly every render, so the
   in-flight fetch was superseded before it ever resolved (`isLoading` stayed `true`
   indefinitely). Fixed by freezing `now` in `useState(() => Date.now())`, refreshed only every
   30 s. The same 2-hour sparkline request was also switched from raw per-second resolution to
   5-minute buckets (24 points instead of up to 7200) — unrelated to the hang, but a real
   over-fetch found during the same investigation.
3. **Infinite render loop** in `useAuditQueueStatus`: the underlying `auditQueue.subscribe()`
   invokes its callback synchronously with the current state immediately upon subscribing (by
   design, so new subscribers get the current value right away). Combined with an inline
   `subscribe` function passed to `useSyncExternalStore` (recreated every render), this caused
   `onChange()` to fire on every subscribe, triggering a re-render, triggering a re-subscribe —
   "Maximum update depth exceeded." Fixed by only calling `onChange()` when the snapshot value
   actually changed.
4. **Stacking-context trap**: `AuditConsole`/`ReportsCenter`/`EventLogDrawer` were rendered as
   JSX children of `TopBar`, whose root element is `position: absolute` with an explicit
   `z-index`. That makes `TopBar` its own stacking context, so descendants' `z-index` (even
   `fixed`, even a much higher number) is capped within it — a sibling button in `TopBar` (with
   *no* explicit z-index) still painted on top of the "modal," intercepting clicks. Fixed with a
   `Portal` component (`lib/ui/Portal.tsx`) that renders these overlays into `document.body`,
   applied to the shared `Modal` too so every dialog in the app gets the fix, not just the two
   that happened to be caught manually.
5. **"Sign out" didn't sign out**: `TopBar`'s sign-out button called the server-side
   `authApi.logout()` (which destroys the session cookie) followed by the client-side
   `lock('manual')` — but `lock()` deliberately *keeps* `user` populated in `sessionStore` (that's
   what lets the idle-timeout lock screen show "Signed in as \<name\>, re-enter your password" for
   a fast resume). `ProtectedRoute` only redirects to `/login` when `user` is `null`, so the result
   was a same-user "Console locked" overlay instead of the login page, and the first re-auth
   attempt would 401 (the server session was already gone) before finally falling back to a real
   login form. Caught by the Playwright critical-path e2e test, which needs to sign out as
   `operator` and back in as `supervisor` — a different user, which the lock screen can't do at
   all. Fixed by calling `clearSession()` (not `lock()`) on sign-out, so it goes straight to a
   clean `/login`.
6. **The alert pulse animation was quietly starving the map**, caught during a live "run" smoke
   test that noticed the sidebar had become nearly unclickable under a real 300-camera load. Root
   cause, confirmed via `requestAnimationFrame` timing + a Chrome CPU profile: `usePulsePhase`
   ticked at ~15Hz, and each tick produced a new `pulseLayer` object, which forced a new `layers`
   array, which `DeckOverlay` forwarded straight into `overlay.setProps()` — deck.gl has to walk
   and diff the *entire* layers list on every `setProps` call, including the heatmap aggregation
   layer, 15 times a second, even though only the pulse ring's radius needed to change. Measured
   live: sub-1fps with gaps up to 1.4s before the fix. Fixed four things together: (1) dropped the
   pulse rate to ~3Hz — still a clear "breathing" cue, 5x fewer diff passes; (2) hoisted
   `IconLayer`'s `getIcon` return value to a module-level constant (it was returning a fresh object
   per marker per call, defeating deck.gl's icon-atlas cache); (3) memoized the combined `layers`
   array itself; (4) hoisted `DeckOverlay`'s inline `getCursor`/`onReady` props to stable
   references, since an unmemoized prop looks "changed" to `setProps` on every unrelated render.
   Result: ~6fps, zero frames over 1000ms (down from 6 of 7 sampled). The residual gap traces to
   this sandbox's software-rendered WebGL (see the perf-budget section above), not further
   unaddressed code — toggling the heatmap layer off alone changed measured fps 3–4x, consistent
   with a software rasterizer being disproportionately slow at multi-pass GPU aggregation.
   `features/map/MapCanvas.tsx`, `features/map/usePulsePhase.ts`.

## Deliberate scope decisions (not gaps, but worth being explicit about)

- **Multi-select lasso** only picks up *unclustered* individual camera markers; a lasso drawn
  over a collapsed cluster at low zoom won't expand and select its members (shift-click still
  works at any zoom once you're zoomed in enough to see individual markers). Expanding this would
  need one more worker round-trip (`supercluster.getLeaves(clusterId)`); documented here instead
  of implemented, to keep the worker protocol simple.
- **OIDC/SSO** is mocked (username/password + a fixed TOTP code `000000` for accounts with
  `totpEnabled`) — see `server/src/auth/sessions.ts`. Swapping in a real IdP means replacing
  `POST /auth/login` with a redirect-based flow; the session-cookie/CSRF contract downstream is
  unchanged.
- **Mock server retention** defaults to 3 days (`RETENTION_DAYS` env var) rather than a
  production-realistic 90, specifically so the "data purged per retention policy" UI path (time
  travel, sparkline history) is reachable during normal use of the mock rather than only after
  running it for months.
- **`exceljs` instead of `xlsx`/SheetJS for the `.xlsx` bulk-import parser**: the npm-registry
  `xlsx` package is stuck on a version with two unpatched high-severity advisories (prototype
  pollution and a ReDoS, both triggerable by a crafted spreadsheet — exactly the threat model for
  a file-upload endpoint) that SheetJS only fixed in versions distributed off their own CDN, not
  npm. `exceljs` has no such advisory against parsing untrusted input, so it was used instead —
  see SECURITY.md's known-gaps for the one much-lower-severity transitive advisory it does bring
  in (`uuid`, not reachable through our usage).
- **PDF/Word bulk-import extracts `rtsp://` links via text extraction + regex, not full structured
  parsing.** Free-text documents have no columns, so a name and an RTSP URL are the only fields
  that can ever come out reliably; zone and coordinates are supplied once per import via a
  "default zone" picker in the dialog rather than guessed at.
- **`pdfjs-dist` directly, not the `pdf-parse` npm wrapper, for PDF text extraction.** `pdf-parse`
  (the popular wrapper) comes in two flavors, both wrong for this use case: v1.x bundles pdf.js
  **v1.9–1.10 (2017-era)**, which failed outright on a real pdf-lib-generated test PDF
  (`FormatError: Unknown compression method in flate stream` — it doesn't understand the
  compressed cross-reference/object streams that essentially all modern PDF writers use by
  default: Acrobat, Chrome print-to-PDF, Word export, pdf-lib); v2.x fixes that by bundling a
  current pdf.js, but wraps it in a much heavier canvas/worker-oriented API not needed for plain
  text extraction. Depending on `pdfjs-dist` (Mozilla's own library, current release, actively
  maintained, no open advisories) directly — `getDocument({data}).promise` then
  `page.getTextContent()` per page, via its Node-targeted `legacy/build/pdf.mjs` entry point —
  gets a modern, correct parser without the wrapper's extra surface. This was caught by generating
  a real PDF fixture with pdf-lib (already a project dependency, used for report export) and
  running it through the parser during manual verification, not by unit tests alone — worth noting
  since it's exactly the kind of gap that only shows up against real-shaped input.
- **PDF/DOCX import verification uses generated real fixture files, not hand-rolled binary
  test data.** The DOCX path is unit-testable with a genuinely minimal but valid `.docx` (a zip of
  three small XML parts, built with `jszip` — already a transitive dependency); the PDF path was
  verified the same way using a real PDF built with `pdf-lib`. Both fixtures are generation
  scripts, not committed binaries, run ad hoc during verification rather than wired into the
  Vitest suite as fixture files — kept out of the automated suite to avoid tying a fast unit-test
  run to two extra parsing libraries' full behavior; the regex-extraction logic they both feed
  into (`extractRtspUrls`, `parsePlainTextRows`) is what's covered by the committed unit tests.
