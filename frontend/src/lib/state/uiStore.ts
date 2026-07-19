import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BaseLayer = 'streets' | 'satellite';
export type ThemeMode = 'dark' | 'light';
export type SidebarSectionKey = 'filters' | 'cameras' | 'legend';

interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  baseLayer: BaseLayer;
  heatmapEnabled: boolean;
  fovConesEnabled: boolean;
  boundingBoxOverlayEnabled: boolean;
  confidenceOverlayEnabled: boolean;
  alertSoundMuted: boolean;
  kioskMode: boolean;
  /** Zone accordion sections the operator has manually expanded — persisted per-user, distinct
   *  from the auto-expand-on-critical-alert behavior layered on top in the sidebar itself. */
  expandedZoneIds: string[];
  /** Lifted out of AlertTray's local state so other UI (e.g. a grouped "N CRITICAL alerts"
   *  toast's click action) can open the tray without prop-drilling or a DOM click simulation. */
  alertTrayExpanded: boolean;
  /** Sidebar's top-level accordion (Search & Filters / Cameras / Legend) — distinct from
   *  expandedZoneIds, which is the *camera list's own* nested per-zone accordion. */
  sidebarSectionsOpen: Record<SidebarSectionKey, boolean>;
  /** Last top-level tab visited (/, /map, /analytics) — landed on after login instead of always
   *  forcing Home, so returning operators pick up where they left off. */
  lastTab: string;

  setTheme: (t: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBaseLayer: (l: BaseLayer) => void;
  toggleHeatmap: () => void;
  toggleFovCones: () => void;
  toggleBoundingBoxOverlay: () => void;
  toggleConfidenceOverlay: () => void;
  toggleAlertSoundMuted: () => void;
  setKioskMode: (v: boolean) => void;
  toggleZoneExpanded: (zoneId: string) => void;
  setAlertTrayExpanded: (v: boolean) => void;
  toggleSidebarSection: (key: SidebarSectionKey) => void;
  setLastTab: (path: string) => void;
}

// Non-sensitive UI prefs only — no tokens, identities, or camera data ever live here.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      sidebarWidth: 340,
      rightPanelWidth: 420,
      baseLayer: 'streets',
      heatmapEnabled: true,
      fovConesEnabled: true,
      boundingBoxOverlayEnabled: false,
      confidenceOverlayEnabled: false,
      alertSoundMuted: false,
      kioskMode: false,
      expandedZoneIds: [],
      alertTrayExpanded: false,
      sidebarSectionsOpen: { filters: false, cameras: true, legend: false },
      lastTab: '/',

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
      setBaseLayer: (baseLayer) => set({ baseLayer }),
      toggleHeatmap: () => set((s) => ({ heatmapEnabled: !s.heatmapEnabled })),
      toggleFovCones: () => set((s) => ({ fovConesEnabled: !s.fovConesEnabled })),
      toggleBoundingBoxOverlay: () => set((s) => ({ boundingBoxOverlayEnabled: !s.boundingBoxOverlayEnabled })),
      toggleConfidenceOverlay: () => set((s) => ({ confidenceOverlayEnabled: !s.confidenceOverlayEnabled })),
      toggleAlertSoundMuted: () => set((s) => ({ alertSoundMuted: !s.alertSoundMuted })),
      setKioskMode: (kioskMode) => set({ kioskMode }),
      toggleZoneExpanded: (zoneId) =>
        set((s) => ({
          expandedZoneIds: s.expandedZoneIds.includes(zoneId)
            ? s.expandedZoneIds.filter((id) => id !== zoneId)
            : [...s.expandedZoneIds, zoneId],
        })),
      setAlertTrayExpanded: (alertTrayExpanded) => set({ alertTrayExpanded }),
      toggleSidebarSection: (key) =>
        set((s) => ({ sidebarSectionsOpen: { ...s.sidebarSectionsOpen, [key]: !s.sidebarSectionsOpen[key] } })),
      setLastTab: (lastTab) => set({ lastTab }),
    }),
    { name: 'cdc-ui-prefs' },
  ),
);
