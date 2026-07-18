import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as GLMap, type MapRef, type ViewStateChangeEvent, type ErrorEvent as MapErrorEvent } from 'react-map-gl/maplibre';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { LngLatBounds } from 'maplibre-gl';
import type { PickingInfo } from '@deck.gl/core';
import { IconLayer, TextLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { Satellite, MapIcon, Flame, AlertTriangle, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import 'maplibre-gl/dist/maplibre-gl.css';

import { DeckOverlay } from './DeckOverlay';
import { useClusteredCameras, type OutputFeature, type Viewport } from './useClusteredCameras';
import { HeatmapLegend } from './HeatmapLegend';
import { PerfOverlay, isPerfOverlayEnabled } from './PerfOverlay';
import { fovConePolygon } from './geo';
import { SEVERITY_COLOR, STATUS_COLOR, HEATMAP_COLOR_RANGE, type RGBA } from './colors';
import { STREETS_STYLE_URL, SATELLITE_STYLE } from './mapStyles';
import { useCameras } from '@/features/cameras/api';
import { useAlerts } from '@/features/alerts/api';
import { useUiStore } from '@/lib/state/uiStore';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useTimeStore } from '@/lib/state/timeStore';
import { useHistoricalState } from '@/features/timeline/api';
import { usePulsePhase } from './usePulsePhase';
import type { HistoricalOverride } from './useClusteredCameras';

// Rajamahendravaram (Rajahmundry), Andhra Pradesh — matches server/src/data/seed.ts's CITY_CENTER.
const INITIAL_VIEW = { longitude: 81.7837, latitude: 16.9891, zoom: 13, pitch: 0, bearing: 0 };
const FOV_CONE_MIN_ZOOM = 14;
// See highAlertLoad below — resume sits below pause so the state doesn't flap right at the
// boundary as alerts are acknowledged one at a time near the threshold.
const HEATMAP_AUTO_PAUSE_AT = 20;
const HEATMAP_AUTO_RESUME_AT = 12;

const markerIconAtlas =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="26" fill="white"/></svg>',
  );
// Hoisted to a single stable object — IconLayer's getIcon is called once per marker (up to 300x)
// on every layer update; returning a fresh object literal each call defeats deck.gl's icon-atlas
// cache and forces it to re-decode/re-upload the same icon repeatedly instead of reusing it.
const MARKER_ICON = { url: markerIconAtlas, width: 64, height: 64, anchorY: 32 };

// Hoisted module-level — an inline arrow function passed as a prop gets a new identity every
// render, which DeckOverlay forwards straight into `overlay.setProps()` unconditionally; a stable
// reference here avoids that prop looking "changed" to deck.gl on every unrelated re-render.
function getCursor({ isDragging, isHovering }: { isDragging: boolean; isHovering: boolean }): string {
  return isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab';
}

function boundsToBbox(bounds: LngLatBounds): [number, number, number, number] {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

export function MapCanvas(): React.JSX.Element {
  const mapRef = useRef<MapRef | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const { data: camerasData } = useCameras();
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });
  const baseLayer = useUiStore((s) => s.baseLayer);
  const setBaseLayer = useUiStore((s) => s.setBaseLayer);
  const heatmapEnabled = useUiStore((s) => s.heatmapEnabled);
  const toggleHeatmap = useUiStore((s) => s.toggleHeatmap);
  const fovConesEnabled = useUiStore((s) => s.fovConesEnabled);
  const selectCamera = useSelectionStore((s) => s.selectCamera);
  const selectGroup = useSelectionStore((s) => s.selectGroup);

  const cameras = useMemo(() => camerasData?.items ?? [], [camerasData]);
  const cameraById = useMemo(() => new Map(cameras.map((c) => [c.id, c] as const)), [cameras]);
  const alertingCameraIds = useMemo(() => new Set((openAlerts?.items ?? []).map((a) => a.cameraId)), [openAlerts]);

  // The heatmap's GPU aggregation pass is the single biggest cost in the map's render loop —
  // measured live, toggling it off alone changes frame rate 3-4x in isolation — but profiling
  // under a genuine mass-alert event (30+ open alerts) showed GPUTask still saturating the frame
  // budget even with the heatmap's own aggregation pass confirmed skipped. deck.gl runs here in
  // *interleaved* mode (@deck.gl/mapbox's MapboxOverlay draws inside MapLibre's own WebGL
  // context, not a separate canvas), so every overlay prop change — including the pulse ring's
  // radius, ticking on its own timer independent of alert volume — can force a full repaint of
  // the composited scene (basemap tiles *and* every overlay layer together), not just the one
  // layer that changed. At extreme alert volume that per-tick repaint cost compounds regardless
  // of which individual layers are simplified. So both the heatmap *and* the pulse animation
  // pause together above the same threshold — freezing the map to only redraw on genuine
  // interaction (pan/zoom) or real data changes, not a continuous decorative timer, during
  // exactly the moments an operator most needs clicks (Acknowledge, camera selection) to keep
  // responding. The gap between pause/resume thresholds (hysteresis) stops it flapping right at
  // the boundary. Never overrides the operator's own heatmap toggle preference — turning it back
  // on manually always re-enables it next time alert volume drops.
  const openAlertCount = openAlerts?.items.length ?? 0;
  const criticalOpenCount = useMemo(
    () => (openAlerts?.items ?? []).filter((a) => a.severity === 'CRITICAL').length,
    [openAlerts],
  );
  const [highAlertLoad, setHighAlertLoad] = useState(false);
  useEffect(() => {
    if (!highAlertLoad && openAlertCount >= HEATMAP_AUTO_PAUSE_AT) setHighAlertLoad(true);
    else if (highAlertLoad && openAlertCount <= HEATMAP_AUTO_RESUME_AT) setHighAlertLoad(false);
  }, [openAlertCount, highAlertLoad]);
  const heatmapEffectivelyEnabled = heatmapEnabled && !highAlertLoad;

  const [viewport, setViewport] = useState<Viewport>({ bbox: [-180, -85, 180, 85], zoom: 12 });
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);

  // The map style/tiles load from an external server (VITE_MAP_STYLE_URL) with no built-in retry
  // — a transient network hiccup during that fetch previously left a permanently black canvas
  // until the operator manually refreshed the whole page. `mapKey` forces a clean remount (a
  // fresh maplibre-gl instance, re-fetching the style from scratch) rather than trying to coax a
  // half-failed instance back to life; capped so a genuinely-down tile server surfaces a manual
  // retry instead of hammering it forever.
  const [mapKey, setMapKey] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const MAX_AUTO_RETRIES = 3;

  const onMapError = useCallback((e: MapErrorEvent) => {
    setMapError(e.error.message || 'Failed to load the map.');
  }, []);

  useEffect(() => {
    if (!mapError) return;
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
    const delay = 1500 * 2 ** retryCountRef.current;
    const t = setTimeout(() => {
      retryCountRef.current += 1;
      setMapError(null);
      setMapKey((k) => k + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [mapError]);

  const retryNow = useCallback(() => {
    retryCountRef.current = 0;
    setMapError(null);
    setMapKey((k) => k + 1);
  }, []);

  const isHistorical = useTimeStore((s) => s.isHistorical);
  const viewingAtMs = useTimeStore((s) => s.viewingAtMs);
  const { data: historicalState } = useHistoricalState(viewingAtMs, isHistorical);
  const historicalByCamera = useMemo<Map<string, HistoricalOverride> | null>(() => {
    if (!isHistorical || !historicalState) return null;
    return new Map(historicalState.cameras.map((c) => [c.cameraId, c] as const));
  }, [isHistorical, historicalState]);

  const features = useClusteredCameras(cameras, viewport, historicalByCamera);
  const pulsePhase = usePulsePhase(alertingCameraIds.size > 0 && !highAlertLoad);
  const onOverlayReady = useCallback((o: MapboxOverlay) => {
    overlayRef.current = o;
  }, []);

  const onMoveEnd = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setViewport({ bbox: boundsToBbox(map.getBounds()), zoom: map.getZoom() });
  }, []);

  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const onMove = useCallback((e: ViewStateChangeEvent) => setViewState(e.viewState), []);

  const applyMultiSelect = useCallback(
    (ids: Set<string>) => {
      setMultiSelectIds(ids);
      if (ids.size === 0) return;
      selectGroup(Array.from(ids));
    },
    [selectGroup],
  );

  const handleClick = useCallback(
    (info: PickingInfo<OutputFeature>, event: { srcEvent: MouseEvent }) => {
      const obj = info.object;
      if (!obj) return;
      if (obj.isCluster) {
        const map = mapRef.current?.getMap();
        if (map) map.flyTo({ center: [obj.lng, obj.lat], zoom: Math.min(20, viewState.zoom + 3) });
        return;
      }
      if (event.srcEvent.shiftKey) {
        const next = new Set(multiSelectIds);
        if (next.has(obj.cameraId!)) next.delete(obj.cameraId!);
        else next.add(obj.cameraId!);
        applyMultiSelect(next);
        return;
      }
      setMultiSelectIds(new Set());
      selectCamera(obj.cameraId!);
    },
    [multiSelectIds, applyMultiSelect, selectCamera, viewState.zoom],
  );

  const onContainerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.shiftKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    lassoStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setLasso({ x: lassoStart.current.x, y: lassoStart.current.y, w: 0, h: 0 });
  }, []);

  const onContainerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!lassoStart.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const start = lassoStart.current;
    setLasso({ x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) });
  }, []);

  const onContainerPointerUp = useCallback(() => {
    if (!lasso || !overlayRef.current) {
      lassoStart.current = null;
      setLasso(null);
      return;
    }
    if (lasso.w > 4 && lasso.h > 4) {
      const picked = overlayRef.current.pickObjects({ x: lasso.x, y: lasso.y, width: lasso.w, height: lasso.h });
      const ids = new Set(
        picked
          .map((p) => p.object as OutputFeature | undefined)
          .filter((o): o is OutputFeature => !!o && !o.isCluster && !!o.cameraId)
          .map((o) => o.cameraId!),
      );
      if (ids.size > 0) applyMultiSelect(ids);
    }
    lassoStart.current = null;
    setLasso(null);
  }, [lasso, applyMultiSelect]);

  // Split from the pulse layer deliberately: pulsePhase ticks at ~15Hz, and putting it in this
  // memo's deps used to force *all five* layers (including the heatmap aggregation layer and the
  // full marker set) to be reconstructed 15x/sec even though only the pulse ring's radius ever
  // changed — real, measured GPU/main-thread churn that showed up as a single-digit FPS floor.
  // deck.gl diffs layers by `id`, not by array identity, so recombining stable layer instances
  // from two independently-memoized groups below is the normal, cheap way to use it.
  const staticLayers = useMemo(() => {
    const unclustered = features.filter((f) => !f.isCluster);

    const heatmapLayer = new HeatmapLayer<OutputFeature>({
      id: 'density-heatmap',
      // Empty data (not just `visible: false`) so the aggregation pass itself is skipped, not
      // just the draw call — the aggregation is the expensive part.
      data: heatmapEffectivelyEnabled ? unclustered : [],
      visible: heatmapEffectivelyEnabled,
      getPosition: (f) => [f.lng, f.lat],
      getWeight: (f) => f.severity + 0.2,
      radiusPixels: 70,
      colorRange: HEATMAP_COLOR_RANGE,
      aggregation: 'SUM',
    });

    const fovLayer = new PolygonLayer<OutputFeature>({
      id: 'fov-cones',
      data: viewState.zoom >= FOV_CONE_MIN_ZOOM && fovConesEnabled ? unclustered : [],
      getPolygon: (f) => {
        const cam = cameraById.get(f.cameraId!);
        if (!cam) return [];
        return fovConePolygon(f.lng, f.lat, cam.bearing, cam.fovAngle, cam.range);
      },
      getFillColor: (f): RGBA => {
        const c = SEVERITY_COLOR[f.severity as 0 | 1 | 2];
        return [c[0], c[1], c[2], 60];
      },
      getLineColor: (f): RGBA => SEVERITY_COLOR[f.severity as 0 | 1 | 2],
      lineWidthMinPixels: 1,
      pickable: false,
      updateTriggers: { getPolygon: [cameraById] },
    });

    const markerLayer = new IconLayer<OutputFeature>({
      id: 'markers',
      data: features,
      pickable: true,
      getPosition: (f) => [f.lng, f.lat],
      getIcon: () => MARKER_ICON,
      getSize: (f) => (f.isCluster ? 16 + Math.min(14, Math.log2(f.count + 1) * 4) : 10),
      sizeUnits: 'pixels',
      getColor: (f): RGBA =>
        f.isCluster ? SEVERITY_COLOR[f.severity as 0 | 1 | 2] : (STATUS_COLOR[f.status ?? 'ONLINE'] ?? STATUS_COLOR.ONLINE!),
    });

    const labelLayer = new TextLayer<OutputFeature>({
      id: 'cluster-labels',
      data: features.filter((f) => f.isCluster),
      getPosition: (f) => [f.lng, f.lat],
      getText: (f) => String(f.headcount),
      getSize: 11,
      getColor: [8, 10, 15, 255],
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 700,
    });

    return [heatmapLayer, fovLayer, markerLayer, labelLayer];
  }, [features, heatmapEffectivelyEnabled, fovConesEnabled, viewState.zoom, cameraById]);

  const pulseLayer = useMemo(() => {
    const alerting = features.filter((f) => !f.isCluster && f.cameraId && alertingCameraIds.has(f.cameraId));
    return new ScatterplotLayer<OutputFeature>({
      id: 'alert-pulse',
      data: alerting,
      getPosition: (f) => [f.lng, f.lat],
      getRadius: () => 14 + 10 * Math.abs(Math.sin(pulsePhase)),
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: [244, 63, 94, 200] as RGBA,
      lineWidthMinPixels: 2,
      pickable: false,
      updateTriggers: { getRadius: [pulsePhase] },
    });
  }, [features, alertingCameraIds, pulsePhase]);

  const layers = useMemo(() => [...staticLayers, pulseLayer], [staticLayers, pulseLayer]);

  const mapStyle = baseLayer === 'satellite' ? SATELLITE_STYLE : STREETS_STYLE_URL;

  return (
    <div
      className="absolute inset-0"
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
    >
      {highAlertLoad ? (
        // Fully unmounted, not just visually hidden — measured live, hiding the canvas with CSS
        // alone (leaving MapLibre's internal render loop running underneath) still left frame
        // rate at ~1.3fps; unmounting it outright measured 35+ fps. The interactive map itself,
        // not any single deck.gl overlay layer, is the dominant cost in this environment (no
        // hardware GPU acceleration — MapLibre's own vector-tile basemap rendering, confirmed via
        // profiling, not the heatmap/pulse layers already gated above). During exactly the
        // moments an operator most needs the sidebar/alert tray to keep responding — a genuine
        // mass-alert event — the map trades its own interactivity for that responsiveness, and
        // remounts fresh automatically once alert volume drops back down.
        <MapPausedView openAlertCount={openAlertCount} criticalCount={criticalOpenCount} />
      ) : (
        <>
          <GLMap
            key={mapKey}
            ref={mapRef}
            initialViewState={INITIAL_VIEW}
            mapStyle={mapStyle}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
            onLoad={onMoveEnd}
            onError={onMapError}
            style={{ width: '100%', height: '100%' }}
          >
            <DeckOverlay
              layers={layers}
              onClick={handleClick}
              getCursor={getCursor}
              onReady={onOverlayReady}
            />
          </GLMap>

          {lasso && (
            <div
              className="pointer-events-none absolute border border-accent bg-accent/10"
              style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }}
            />
          )}

          <div className="absolute right-3 top-32 z-20 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setBaseLayer(baseLayer === 'streets' ? 'satellite' : 'streets')}
              className={clsx('rounded-md border border-border bg-bg-surface/90 p-2 text-fg-secondary shadow backdrop-blur hover:bg-bg-raised')}
              title={baseLayer === 'streets' ? 'Switch to satellite' : 'Switch to streets'}
            >
              {baseLayer === 'streets' ? <Satellite className="h-4 w-4" aria-hidden="true" /> : <MapIcon className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={toggleHeatmap}
              className={clsx(
                'relative rounded-md border p-2 shadow backdrop-blur',
                heatmapEnabled ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-bg-surface/90 text-fg-secondary hover:bg-bg-raised',
              )}
              title="Toggle density heatmap"
              aria-pressed={heatmapEnabled}
            >
              <Flame className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {heatmapEnabled && <HeatmapLegend />}
          {isPerfOverlayEnabled() && <PerfOverlay />}

          {mapError && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg-canvas/80 backdrop-blur-sm">
              <div className="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-border bg-bg-surface p-4 text-center shadow-lg">
                <AlertTriangle className="h-5 w-5 text-severity-warning" aria-hidden="true" />
                <p className="text-sm font-medium text-fg-primary">Map failed to load</p>
                <p className="text-xs text-fg-muted">
                  {retryCountRef.current < MAX_AUTO_RETRIES ? 'Retrying automatically…' : 'The map tile server may be unreachable.'}
                </p>
                <button
                  type="button"
                  onClick={retryNow}
                  className="mt-1 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-bg-raised"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry now
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MapPausedView({ openAlertCount, criticalCount }: { openAlertCount: number; criticalCount: number }): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg-canvas text-center">
      <MapIcon className="h-8 w-8 text-fg-muted" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-fg-primary">Map paused — {openAlertCount} active alerts</p>
        <p className="mt-1 max-w-sm text-xs text-fg-muted">
          {criticalCount > 0 && <>{criticalCount} CRITICAL. </>}
          The map temporarily steps aside during a high-volume alert event so the sidebar and alert tray stay responsive. It
          resumes automatically once alert volume drops — use the sidebar or alert tray to locate and acknowledge cameras
          in the meantime.
        </p>
      </div>
    </div>
  );
}
