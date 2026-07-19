import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { ChevronsLeft, ChevronsRight, ChevronRight, Search, Plus, UploadCloud, X, Users } from 'lucide-react';
import clsx from 'clsx';
import { useCameras, useZones } from '@/features/cameras/api';
import { useAlerts } from '@/features/alerts/api';
import { CameraListRow } from '@/features/cameras/CameraListRow';
import { BulkImportModal } from '@/features/cameras/BulkImportModal';
import { CameraFpsScopePopover } from '@/features/cameras/CameraFpsScopePopover';
import { useUiStore } from '@/lib/state/uiStore';
import { RoleGate } from '@/features/auth/RoleGate';
import { ErrorBoundary } from './ErrorBoundary';
import { AccordionSection } from './AccordionSection';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { useHeatmapTick } from '@/lib/ws/hooks';
import { HEATMAP_THRESHOLDS } from '@/features/map/colors';
import type { Camera, CameraStatus } from '@/types';

// Card header row is 52px (spec) + 8px top margin between stacked zone cards; camera rows are
// flush 44px list items within an expanded card, no gap between them.
const HEADER_HEIGHT = 60;
const ROW_HEIGHT = 44;
const MIN_WIDTH = 260;
const MAX_WIDTH = 560;

type ZoneSeverity = 'none' | 'warning' | 'critical';

type ListRow =
  | {
      type: 'header';
      zoneId: string;
      zoneName: string;
      count: number;
      liveHeadcount: number;
      severity: ZoneSeverity;
      isExpanded: boolean;
    }
  | { type: 'camera'; camera: Camera; hasOpenAlert: boolean; isLastInZone: boolean };

interface SidebarProps {
  onAddCamera: () => void;
}

export function Sidebar({ onAddCamera }: SidebarProps): React.JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const width = useUiStore((s) => s.sidebarWidth);
  const setWidth = useUiStore((s) => s.setSidebarWidth);
  const sectionsOpen = useUiStore((s) => s.sidebarSectionsOpen);
  const toggleSection = useUiStore((s) => s.toggleSidebarSection);

  const { data: camerasData, isLoading, isError, refetch } = useCameras();
  const { data: zonesData } = useZones();
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CameraStatus | 'ALL'>('ALL');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');
  const [alertingOnly, setAlertingOnly] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const expandedZoneIds = useUiStore((s) => s.expandedZoneIds);
  const toggleZoneExpanded = useUiStore((s) => s.toggleZoneExpanded);
  const manager = getWsManager();
  // Per-zone live headcount is read via manager.getLatest() (no per-camera subscription), so it
  // must be driven by the ≤1Hz fleet snapshot tick — see useFleetTotals.ts for why
  // useAnyMetricsTick would leave this stale for the bulk of the fleet.
  const heatmapTick = useHeatmapTick();

  const alertingCameraIds = useMemo(() => new Set((openAlerts?.items ?? []).map((a) => a.cameraId)), [openAlerts]);

  // Worst open-alert severity per zone — drives the accordion header's severity dot and the
  // auto-expand-on-critical behavior (spec: "Collapsed by default except zones with active
  // alerts (auto-expand on CRITICAL)").
  const zoneSeverity = useMemo(() => {
    const map = new Map<string, ZoneSeverity>();
    for (const a of openAlerts?.items ?? []) {
      if (a.severity === 'CRITICAL') map.set(a.zoneId, 'critical');
      else if (a.severity === 'WARNING' && map.get(a.zoneId) !== 'critical') map.set(a.zoneId, 'warning');
    }
    return map;
  }, [openAlerts]);

  const zoneNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const z of zonesData?.items ?? []) map.set(z.id, z.name);
    return map;
  }, [zonesData]);

  const hasActiveFilter = !!search.trim() || statusFilter !== 'ALL' || zoneFilter !== 'ALL' || alertingOnly;
  const openAlertCount = openAlerts?.items.length ?? 0;

  // Auto-expand is a one-time, *persisted* state change (added to expandedZoneIds), not a live
  // "expanded while severity === critical" condition — with the ambient simulation realistically
  // raising and resolving alerts across many zones continuously (by design), a purely reactive
  // check would make zones repeatedly pop open and collapse as criticals come and go elsewhere in
  // the fleet, which is both jarring for an operator and was observed to destabilize the
  // virtualized list's layout under load. Once opened by a critical alert, a zone stays open
  // until the operator explicitly collapses it.
  const criticalZoneIds = useMemo(
    () =>
      Array.from(zoneSeverity.entries())
        .filter(([, s]) => s === 'critical')
        .map(([id]) => id),
    [zoneSeverity],
  );
  useEffect(() => {
    const current = useUiStore.getState().expandedZoneIds;
    const missing = criticalZoneIds.filter((id) => !current.includes(id));
    for (const zoneId of missing) useUiStore.getState().toggleZoneExpanded(zoneId);
  }, [criticalZoneIds]);

  const rows = useMemo<ListRow[]>(() => {
    const all = camerasData?.items ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = all.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (zoneFilter !== 'ALL' && c.zoneId !== zoneFilter) return false;
      if (alertingOnly && !alertingCameraIds.has(c.id)) return false;
      if (needle && !c.name.toLowerCase().includes(needle) && !c.tags.some((t) => t.includes(needle))) return false;
      return true;
    });

    const byZone = new Map<string, Camera[]>();
    for (const c of filtered) {
      const list = byZone.get(c.zoneId) ?? [];
      list.push(c);
      byZone.set(c.zoneId, list);
    }

    const out: ListRow[] = [];
    const zoneIds = Array.from(byZone.keys()).sort((a, b) =>
      (zoneNameById.get(a) ?? a).localeCompare(zoneNameById.get(b) ?? b),
    );
    for (const zoneId of zoneIds) {
      const cams = byZone.get(zoneId)!;
      const severity = zoneSeverity.get(zoneId) ?? 'none';
      // expandedZoneIds already covers "auto-expanded because of a critical alert" — see the
      // sticky-expand effect above — so this only needs the active-filter override and the
      // persisted set itself.
      const isExpanded = hasActiveFilter || expandedZoneIds.includes(zoneId);
      let liveHeadcount = 0;
      for (const c of cams) {
        if (c.status === 'ONLINE' || c.status === 'DEGRADED') {
          liveHeadcount += manager.getLatest(c.id)?.headcount ?? c.lastMetrics?.headcount ?? 0;
        }
      }
      out.push({
        type: 'header',
        zoneId,
        zoneName: zoneNameById.get(zoneId) ?? zoneId,
        count: cams.length,
        liveHeadcount,
        severity,
        isExpanded,
      });
      if (isExpanded) {
        const sorted = cams.sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach((camera, i) => {
          out.push({
            type: 'camera',
            camera,
            hasOpenAlert: alertingCameraIds.has(camera.id),
            isLastInZone: i === sorted.length - 1,
          });
        });
      }
    }
    return out;
    // heatmapTick is a deliberate ≤1Hz refresh trigger for liveHeadcount, not a value read
    // directly in the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    camerasData,
    search,
    statusFilter,
    zoneFilter,
    alertingOnly,
    alertingCameraIds,
    zoneNameById,
    zoneSeverity,
    expandedZoneIds,
    hasActiveFilter,
    manager,
    heatmapTick,
  ]);

  const listRef = useRef<VariableSizeList>(null);
  // Row height only depends on row *type* (header vs camera), and each row's identity/position
  // is stable across live metrics ticks — only the filtered/grouped shape changes it. Comparing
  // a cheap shape signature avoids calling resetAfterIndex (and the layout churn it causes) on
  // every WS-driven status update, which was making the list visibly unstable under load.
  const shapeSignature = rows.map((r) => (r.type === 'header' ? `H:${r.zoneId}:${r.isExpanded}` : r.camera.id)).join('|');
  const prevShapeRef = useRef(shapeSignature);
  useEffect(() => {
    if (prevShapeRef.current !== shapeSignature) {
      prevShapeRef.current = shapeSignature;
      listRef.current?.resetAfterIndex(0);
    }
  }, [shapeSignature]);

  const getItemSize = useCallback((index: number) => (rows[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT), [rows]);

  const resizing = useRef(false);
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent): void => {
        if (!resizing.current) return;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
        setWidth(next);
      };
      const onUp = (): void => {
        resizing.current = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, setWidth],
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r border-border bg-bg-surface py-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Expand camera list"
          className="rounded-md p-1.5 text-fg-secondary hover:bg-bg-raised"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col border-r border-border bg-bg-surface"
      style={{ width }}
      aria-label="Control Center camera list"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">Control Center</h2>
        <div className="flex items-center gap-1">
          <RoleGate permission="manageCameras">
            <button
              type="button"
              onClick={onAddCamera}
              aria-label="Add camera"
              className="rounded-md p-1.5 text-fg-secondary hover:bg-bg-raised"
              title="Add camera"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setBulkImportOpen(true)}
              aria-label="Bulk import cameras"
              className="rounded-md p-1.5 text-fg-secondary hover:bg-bg-raised"
              title="Bulk import cameras"
            >
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
            </button>
          </RoleGate>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse camera list"
            className="rounded-md p-1.5 text-fg-secondary hover:bg-bg-raised"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <AccordionSection
          title="Search & Filters"
          expanded={sectionsOpen.filters}
          onToggle={() => toggleSection('filters')}
          badge={
            hasActiveFilter ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            ) : undefined
          }
        >
          <div className="p-3 pt-0">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cameras or tags…"
                aria-label="Search cameras"
                className="w-full rounded-md border border-border bg-bg-raised py-1.5 pl-7 pr-7 text-xs text-fg-primary outline-none focus-visible:border-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-primary"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CameraStatus | 'ALL')}
                aria-label="Filter by status"
                className="rounded-md border border-border bg-bg-raised px-1.5 py-1 text-[11px] text-fg-secondary"
              >
                <option value="ALL">All statuses</option>
                <option value="ONLINE">Online</option>
                <option value="DEGRADED">Degraded</option>
                <option value="RECONNECTING">Reconnecting</option>
                <option value="OFFLINE">Offline</option>
                <option value="MISCONFIGURED">Misconfigured</option>
                <option value="DISABLED">Disabled</option>
              </select>
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                aria-label="Filter by zone"
                className="rounded-md border border-border bg-bg-raised px-1.5 py-1 text-[11px] text-fg-secondary"
              >
                <option value="ALL">All zones</option>
                {(zonesData?.items ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 rounded-md border border-border bg-bg-raised px-1.5 py-1 text-[11px] text-fg-secondary">
                <input type="checkbox" checked={alertingOnly} onChange={(e) => setAlertingOnly(e.target.checked)} />
                Alerting only
              </label>
            </div>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Cameras"
          expanded={sectionsOpen.cameras}
          onToggle={() => toggleSection('cameras')}
          grow
          badge={
            openAlertCount > 0 ? (
              <span className="rounded-full bg-severity-critical px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {openAlertCount}
              </span>
            ) : undefined
          }
          headerExtra={
            <RoleGate permission="tuneCameraFps">
              <CameraFpsScopePopover />
            </RoleGate>
          }
        >
        <div className="min-h-0 flex-1">
          <ErrorBoundary name="Camera list" compact>
          {isLoading && <p className="p-3 text-xs text-fg-muted">Loading cameras…</p>}
          {isError && (
            <div className="p-3 text-xs text-severity-critical">
              Failed to load cameras.{' '}
              <button type="button" onClick={() => void refetch()} className="underline">
                Retry
              </button>
            </div>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <p className="p-3 text-xs text-fg-muted">No cameras match the current filters.</p>
          )}
          {!isLoading && !isError && rows.length > 0 && (
            <AutoSizer>
              {({ height, width }) => (
                <VariableSizeList
                  ref={listRef}
                  height={height}
                  width={width}
                  itemCount={rows.length}
                  itemSize={getItemSize}
                  itemKey={(index) => {
                    const row = rows[index];
                    return row?.type === 'header' ? `h-${row.zoneId}` : `c-${row!.camera.id}`;
                  }}
                >
                  {({ index, style }: ListChildComponentProps) => {
                    const row = rows[index];
                    if (!row) return null;
                    if (row.type === 'header') {
                      return (
                        <div style={{ ...style, paddingTop: 8 }} className="mx-3">
                          <button
                            type="button"
                            onClick={() => toggleZoneExpanded(row.zoneId)}
                            aria-expanded={row.isExpanded}
                            className={clsx(
                              'flex h-[52px] w-full items-center gap-2 rounded-t-[14px] border-x border-t border-hairline/[0.07] bg-bg-card px-3 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-scrim/[0.04]',
                              !row.isExpanded && 'rounded-b-[14px] border-b',
                            )}
                          >
                            <ChevronRight
                              className="h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform duration-[var(--motion-med)] ease-[var(--ease-standard)]"
                              style={{ transform: row.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                              aria-hidden="true"
                            />
                            {row.severity !== 'none' && (
                              <span
                                className={clsx(
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  row.severity === 'critical' ? 'animate-pulse-ring bg-severity-critical' : 'bg-severity-warning',
                                )}
                                aria-hidden="true"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-primary">{row.zoneName}</span>
                            <span className="shrink-0 text-xs text-fg-muted">({row.count})</span>
                            {row.liveHeadcount > 0 && (
                              <span
                                key={row.liveHeadcount}
                                className="value-crossfade flex shrink-0 items-center gap-0.5 font-mono text-[11px] tabular-nums text-fg-secondary"
                              >
                                <Users className="h-3 w-3" aria-hidden="true" />
                                {row.liveHeadcount}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    }
                    return (
                      <CameraListRow
                        camera={row.camera}
                        hasOpenAlert={row.hasOpenAlert}
                        style={style}
                        isLastInZone={row.isLastInZone}
                      />
                    );
                  }}
                </VariableSizeList>
              )}
            </AutoSizer>
          )}
          </ErrorBoundary>
        </div>
        </AccordionSection>

        <AccordionSection title="Legend" expanded={sectionsOpen.legend} onToggle={() => toggleSection('legend')}>
          <div className="flex flex-col gap-1.5 p-3 pt-0">
            {HEATMAP_THRESHOLDS.map((t) => (
              <div key={t.label} className="flex items-center gap-2 text-xs text-fg-secondary">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                  aria-hidden="true"
                />
                {t.label}
              </div>
            ))}
          </div>
        </AccordionSection>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize camera list"
        onPointerDown={onResizeStart}
        className={clsx('absolute -right-1 top-0 h-full w-2 cursor-col-resize')}
      />
      {bulkImportOpen && <BulkImportModal onClose={() => setBulkImportOpen(false)} />}
    </div>
  );
}
