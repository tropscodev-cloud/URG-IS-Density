import { memo } from 'react';
import { Layers, Users } from 'lucide-react';
import clsx from 'clsx';
import type { Camera } from '@/types';
import { CameraStatusBadge } from './CameraStatusBadge';
import { useEffectiveCamera } from './useEffectiveCamera';
import { useSelectionStore } from '@/lib/state/selectionStore';

interface Props {
  camera: Camera;
  hasOpenAlert: boolean;
  style: React.CSSProperties;
  /** Closes the zone's card with a rounded bottom edge + border, matching the card language's
   *  "stacked rounded card, not a continuous list" structure — see Sidebar.tsx's rows builder. */
  isLastInZone: boolean;
}

export const CameraListRow = memo(function CameraListRow({ camera, hasOpenAlert, style, isLastInZone }: Props) {
  const effective = useEffectiveCamera(camera);
  const selected = useSelectionStore((s) => s.cameraId === camera.id);
  const selectCamera = useSelectionStore((s) => s.selectCamera);

  return (
    <div
      style={style}
      className={clsx(
        'mx-3 border-x border-hairline/[0.07] bg-bg-card px-1.5',
        isLastInZone && 'rounded-b-[14px] border-b',
      )}
    >
      <button
        type="button"
        onClick={() => selectCamera(camera.id)}
        aria-pressed={selected}
        aria-label={`${camera.name}, ${effective.status.toLowerCase()}${hasOpenAlert ? ', has active alert' : ''}`}
        className={clsx(
          'flex h-11 w-full items-center gap-2 rounded-[10px] px-2.5 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
          selected ? 'bg-scrim/[0.08]' : 'hover:bg-scrim/[0.04]',
        )}
      >
        <CameraStatusBadge status={effective.status} variant="dot" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium leading-tight text-fg-primary">{camera.name}</span>
            {camera.floorPlan && (
              <span
                className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wide text-fg-muted"
                title="Indoor camera — shown on floor plan, not the map"
              >
                <Layers className="inline h-2.5 w-2.5" aria-hidden="true" /> floor plan
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="truncate">{camera.tags.slice(0, 2).join(', ') || 'no tags'}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasOpenAlert && !effective.isHistorical && (
            <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-severity-critical" aria-hidden="true" />
          )}
          {(effective.status === 'ONLINE' || effective.status === 'DEGRADED') && effective.metrics && (
            <span
              key={effective.metrics.headcount}
              className="value-crossfade flex items-center gap-1 font-mono text-[11px] tabular-nums text-fg-secondary"
            >
              <Users className="h-3 w-3" aria-hidden="true" />
              {effective.metrics.headcount}
            </span>
          )}
        </div>
      </button>
    </div>
  );
});
