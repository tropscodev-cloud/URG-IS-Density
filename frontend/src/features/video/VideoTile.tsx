import { X } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { useCameraMetrics } from '@/lib/ws/hooks';
import { useSelectionStore } from '@/lib/state/selectionStore';
import type { Camera } from '@/types';

/**
 * One cell of the split-screen video grid. A thin wrapper around VideoPlayer (which already owns
 * the connect/buffer/live state machine, real-footage playback, and its own live headcount badge)
 * — kept as its own component specifically so a future WebRTC/HLS feed source is a change to
 * VideoPlayer alone, not to every call site that places a camera feed in a grid.
 */
export function VideoTile({ camera }: { camera: Camera }): React.JSX.Element {
  const metrics = useCameraMetrics(camera.id) ?? null;
  const toggleGroupCamera = useSelectionStore((s) => s.toggleGroupCamera);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between px-2 py-1">
        <span className="truncate text-xs font-medium text-fg-primary">{camera.name}</span>
        <button
          type="button"
          onClick={() => toggleGroupCamera(camera.id)}
          aria-label={`Remove ${camera.name} from the video grid`}
          title="Remove from grid"
          className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-1">
        <VideoPlayer camera={camera} metrics={metrics} />
      </div>
    </div>
  );
}
