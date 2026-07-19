import clsx from 'clsx';
import { useCameras } from '@/features/cameras/api';
import { VideoTile } from './VideoTile';

// 1 -> 1x1, 2 -> 1x2 (stacked), 3/4 -> 2x2.
const GRID_LAYOUT: Record<number, string> = {
  1: 'grid-cols-1 grid-rows-1',
  2: 'grid-cols-1 grid-rows-2',
  3: 'grid-cols-2 grid-rows-2',
  4: 'grid-cols-2 grid-rows-2',
};

interface Props {
  cameraIds: string[];
}

/** Responsive live-feed grid for /map's split view — see MapSplitView. Always live regardless of
 *  the map half's own high-alert-load pause state (independent component tree, see MapSplitView's
 *  own docstring for why that's not something this component needs to guard against itself). */
export function VideoGrid({ cameraIds }: Props): React.JSX.Element {
  const { data } = useCameras();
  const cameras = cameraIds.map((id) => data?.items.find((c) => c.id === id)).filter((c) => c !== undefined);

  return (
    <div className={clsx('grid h-full w-full gap-1 bg-bg-canvas p-1', GRID_LAYOUT[cameras.length] ?? 'grid-cols-1 grid-rows-1')}>
      {cameras.map((camera) => (
        <VideoTile key={camera.id} camera={camera} />
      ))}
    </div>
  );
}
