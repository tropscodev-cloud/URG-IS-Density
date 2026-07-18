import { useState } from 'react';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useCamera } from './api';
import { useEffectiveCamera } from './useEffectiveCamera';
import { CameraStatusBadge } from './CameraStatusBadge';
import { FloorPlanView } from './FloorPlanView';
import { EditCameraModal } from './EditCameraModal';
import { RetireCameraModal } from './RetireCameraModal';
import { VideoPlayer } from '@/features/video/VideoPlayer';
import { CameraSparkline } from '@/features/metrics/CameraSparkline';
import { CameraAlertHistory } from '@/features/alerts/CameraAlertHistory';
import { EvidenceBundleButton } from '@/features/reports/EvidenceBundleButton';
import { RoleGate } from '@/features/auth/RoleGate';
import { ErrorBoundary } from '@/app-shell/ErrorBoundary';
import { relativeAge, formatLocalWithZone } from '@/lib/utils/time';
import { MapPin, Layers, Clock, Activity, Pencil, Trash2 } from 'lucide-react';

export function CameraDetailPanel(): React.JSX.Element {
  const cameraId = useSelectionStore((s) => s.cameraId);
  const { data: camera, isLoading, isError } = useCamera(cameraId);
  const effective = useEffectiveCamera(camera);
  const metrics = effective.metrics;
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);

  if (isLoading) return <div className="p-4 text-xs text-fg-muted">Loading camera…</div>;
  if (isError || !camera) return <div className="p-4 text-xs text-severity-critical">Camera not found.</div>;

  const isLive = !effective.isHistorical && (effective.status === 'ONLINE' || effective.status === 'DEGRADED');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border p-4 pr-10">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold text-fg-primary">{camera.name}</h2>
          <RoleGate permission="manageCameras">
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => setEditOpen(true)} title="Edit camera" className="rounded p-1 text-fg-muted hover:bg-bg-raised hover:text-fg-primary">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setRetireOpen(true)} title="Retire camera" className="rounded p-1 text-fg-muted hover:bg-bg-raised hover:text-severity-critical">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </RoleGate>
        </div>
        <CameraStatusBadge status={effective.status} />
        {effective.status === 'MISCONFIGURED' && camera.misconfiguredReason && (
          <p className="mt-2 rounded-md border border-severity-critical/30 bg-severity-critical/10 p-2 text-xs text-severity-critical">
            {camera.misconfiguredReason}
          </p>
        )}
        {effective.status === 'OFFLINE' && (
          <p className="mt-2 text-xs text-fg-muted">Last seen {camera.lastSeenAt ? formatLocalWithZone(camera.lastSeenAt) : 'never'}.</p>
        )}
        {effective.status === 'RECONNECTING' && (
          <p className="mt-2 text-xs text-status-reconnecting">Reconnect attempt #{camera.reconnectAttempts}</p>
        )}
      </div>

      <div className="border-b border-border p-4">
        <ErrorBoundary name="Live feed" compact>
          <VideoPlayer camera={camera} metrics={metrics} isHistorical={effective.isHistorical} />
        </ErrorBoundary>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border p-4">
        <MetricTile label="Headcount" value={metrics ? String(metrics.headcount) : '—'} live={isLive} />
        <MetricTile label="Flow rate" value={metrics ? `${metrics.flowRate >= 0 ? '+' : ''}${metrics.flowRate}/min` : '—'} live={isLive} />
        <MetricTile label="Movement" value={metrics ? `${metrics.movementPct.toFixed(0)}% moving` : '—'} live={isLive} />
        <MetricTile
          label="Density risk"
          value={metrics ? `${(metrics.densityRisk * 100).toFixed(0)}%` : '—'}
          live={isLive}
          tone={metrics && metrics.densityRisk >= 0.8 ? 'text-severity-critical' : metrics && metrics.densityRisk >= 0.55 ? 'text-severity-warning' : undefined}
        />
        {metrics && (
          <p className="col-span-2 text-[10px] text-fg-muted">
            Data as of {effective.isHistorical ? formatLocalWithZone(metrics.ts) : relativeAge(metrics.ts)} ({formatLocalWithZone(metrics.ts)})
          </p>
        )}
        <div className="col-span-2">
          <EvidenceBundleButton cameraId={camera.id} at={metrics?.ts ?? new Date().toISOString()} />
        </div>
      </div>

      <div className="space-y-2 border-b border-border p-4">
        <ErrorBoundary name="History charts" compact>
          <CameraSparkline cameraId={camera.id} cameraName={camera.name} metric="headcount" label="Headcount" color="#38bdf8" />
          <CameraSparkline cameraId={camera.id} cameraName={camera.name} metric="densityRisk" label="Density risk" color="#f43f5e" />
        </ErrorBoundary>
      </div>

      <div className="border-b border-border">
        <h3 className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Alert history</h3>
        <ErrorBoundary name="Alert history" compact>
          <CameraAlertHistory cameraId={camera.id} />
        </ErrorBoundary>
      </div>

      <div className="space-y-2 p-4 text-xs text-fg-secondary">
        <div className="flex items-center gap-2">
          {camera.floorPlan ? <Layers className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />}
          <span>{camera.floorPlan ? 'Indoor — floor plan placement' : `${camera.lat?.toFixed(5)}, ${camera.lng?.toFixed(5)}`}</span>
          {camera.floorPlan && (
            <button type="button" onClick={() => setFloorPlanOpen(true)} className="text-accent hover:underline">
              View floor plan
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
          <span>Uptime (30d): {camera.uptimePct30d.toFixed(1)}%</span>
        </div>
        {camera.lastConfigChange && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
            <span>
              Last configured by {camera.lastConfigChange.by} · {formatLocalWithZone(camera.lastConfigChange.at)}
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          {camera.tags.map((t) => (
            <span key={t} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted">
              {t}
            </span>
          ))}
        </div>
      </div>
      {floorPlanOpen && camera.floorPlan && (
        <FloorPlanView floorPlanId={camera.floorPlan.floorPlanId} onClose={() => setFloorPlanOpen(false)} />
      )}
      {editOpen && <EditCameraModal camera={camera} onClose={() => setEditOpen(false)} />}
      {retireOpen && <RetireCameraModal camera={camera} onClose={() => setRetireOpen(false)} />}
    </div>
  );
}

function MetricTile({ label, value, live, tone }: { label: string; value: string; live: boolean; tone?: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-bg-raised p-2.5">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-fg-muted">
        {label}
        {!live && <span className="rounded bg-fg-muted/20 px-1 text-[9px] normal-case">stale</span>}
      </div>
      <div className={`font-mono text-base tabular-nums ${tone ?? 'text-fg-primary'} ${!live ? 'opacity-50' : ''}`}>{value}</div>
    </div>
  );
}
