import { useCallback, useMemo, useRef, useState } from 'react';
import { Map as GLMap, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { LngLatBounds } from 'maplibre-gl';
import type { PickingInfo } from '@deck.gl/core';
import { IconLayer, TextLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { Satellite, MapIcon, Flame } from 'lucide-react';
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

  const [viewport, setViewport] = useState<Viewport>({ bbox: [-180, -85, 180, 85], zoom: 12 });
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);

  const isHistorical = useTimeStore((s) => s.isHistorical);
  const viewingAtMs = useTimeStore((s) => s.viewingAtMs);
  const { data: historicalState } = useHistoricalState(viewingAtMs, isHistorical);
  const historicalByCamera = useMemo<Map<string, HistoricalOverride> | null>(() => {
    if (!isHistorical || !historicalState) return null;
    return new Map(historicalState.cameras.map((c) => [c.cameraId, c] as const));
  }, [isHistorical, historicalState]);

  const features = useClusteredCameras(cameras, viewport, historicalByCamera);
  const pulsePhase = usePulsePhase(alertingCameraIds.size > 0);
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
      data: unclustered,
      visible: heatmapEnabled,
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
  }, [features, heatmapEnabled, fovConesEnabled, viewState.zoom, cameraById]);

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
      <GLMap
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={mapStyle}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onLoad={onMoveEnd}
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
            'rounded-md border p-2 shadow backdrop-blur',
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
    </div>
  );
}
