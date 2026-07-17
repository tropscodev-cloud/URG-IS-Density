import { useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useUiStore } from '@/lib/state/uiStore';
import { ErrorBoundary } from './ErrorBoundary';
import { CameraDetailPanel } from '@/features/cameras/CameraDetailPanel';
import { GroupDetailPanel } from '@/features/cameras/GroupDetailPanel';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

export function RightPanel(): React.JSX.Element | null {
  const kind = useSelectionStore((s) => s.kind);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const width = useUiStore((s) => s.rightPanelWidth);
  const setWidth = useUiStore((s) => s.setRightPanelWidth);
  const resizing = useRef(false);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent): void => {
        if (!resizing.current) return;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (ev.clientX - startX)));
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

  if (kind === 'none') return null;

  return (
    <div
      className="relative flex h-full flex-col border-l border-border bg-bg-surface shadow-xl"
      style={{ width }}
      role="complementary"
      aria-label="Camera details"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize detail panel"
        onPointerDown={onResizeStart}
        className="absolute -left-1 top-0 h-full w-2 cursor-col-resize"
      />
      <button
        type="button"
        onClick={clearSelection}
        aria-label="Close panel"
        className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <ErrorBoundary name="Detail panel">
        {kind === 'camera' && <CameraDetailPanel />}
        {kind === 'group' && <GroupDetailPanel />}
      </ErrorBoundary>
    </div>
  );
}
