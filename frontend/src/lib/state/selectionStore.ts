import { create } from 'zustand';

export type SelectionKind = 'none' | 'camera' | 'group';

interface SelectionState {
  kind: SelectionKind;
  cameraId: string | null;
  groupCameraIds: string[];
  hoveredCameraId: string | null;

  selectCamera: (id: string) => void;
  selectGroup: (ids: string[]) => void;
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
  clearSelection: () => set({ kind: 'none', cameraId: null, groupCameraIds: [] }),
  setHovered: (id) => set({ hoveredCameraId: id }),
}));
