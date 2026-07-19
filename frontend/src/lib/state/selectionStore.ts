import { create } from 'zustand';

export type SelectionKind = 'none' | 'camera' | 'group';

/** Shared cap across every "selected cameras" surface: the sidebar checkboxes, the split-screen
 *  video grid, and the bulk fps popover's "Selected" scope — one number, one place. */
export const MAX_GROUP_SELECTION = 4;

interface SelectionState {
  kind: SelectionKind;
  cameraId: string | null;
  groupCameraIds: string[];
  hoveredCameraId: string | null;

  selectCamera: (id: string) => void;
  selectGroup: (ids: string[]) => void;
  /** Sidebar checkbox multi-select — adds/removes one id, capped at MAX_GROUP_SELECTION. Silently
   *  no-ops past the cap rather than erroring, since a disabled checkbox already prevents this in
   *  the UI; this is the belt-and-suspenders guard for any other caller. */
  toggleGroupCamera: (id: string) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  kind: 'none',
  cameraId: null,
  groupCameraIds: [],
  hoveredCameraId: null,

  selectCamera: (id) => set({ kind: 'camera', cameraId: id, groupCameraIds: [] }),
  selectGroup: (ids) => set({ kind: 'group', cameraId: null, groupCameraIds: ids }),
  toggleGroupCamera: (id) =>
    set((s) => {
      const isSelected = s.groupCameraIds.includes(id);
      const next = isSelected
        ? s.groupCameraIds.filter((c) => c !== id)
        : s.groupCameraIds.length < MAX_GROUP_SELECTION
          ? [...s.groupCameraIds, id]
          : s.groupCameraIds;
      return { kind: next.length > 0 ? 'group' : 'none', cameraId: null, groupCameraIds: next };
    }),
  clearSelection: () => set({ kind: 'none', cameraId: null, groupCameraIds: [] }),
  setHovered: (id) => set({ hoveredCameraId: id }),
}));
