import clsx from 'clsx';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { MapCanvas } from './MapCanvas';
import { VideoGrid } from '@/features/video/VideoGrid';

/**
 * /map's viewport: the interactive map alone, or split 50/50 with a live video grid once 1-4
 * cameras are checkbox-selected in the sidebar. MapCanvas fills its parent via `absolute inset-0`
 * unchanged — it doesn't know or care whether that parent is the full viewport or a half-width
 * column, so its own high-alert-load pause behavior only ever affects this left half, never the
 * video grid (they're independent sibling trees, not coupled state).
 */
export function MapSplitView(): React.JSX.Element {
  const groupCameraIds = useSelectionStore((s) => s.groupCameraIds);
  const splitActive = groupCameraIds.length > 0;

  return (
    <div className="flex h-full w-full">
      <div className={clsx('relative h-full', splitActive ? 'w-1/2' : 'w-full')}>
        <MapCanvas />
      </div>
      {splitActive && (
        <div className="h-full w-1/2 border-l border-border">
          <VideoGrid cameraIds={groupCameraIds} />
        </div>
      )}
    </div>
  );
}
