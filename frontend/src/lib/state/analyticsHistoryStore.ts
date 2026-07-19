import { create } from 'zustand';

export interface CameraSnapshot {
  id: string;
  zoneId: string;
  headcount: number;
  densityRisk: number;
  movementPct: number;
  flowRate: number;
}

export interface AnalyticsSnapshot {
  ts: number;
  totalHeadcount: number;
  perCamera: CameraSnapshot[];
}

// 1 sample/minute, capped at 12h — matches the Analytics page's "last 12h" headcount trend.
const MAX_SAMPLES = 720;

interface AnalyticsHistoryState {
  samples: AnalyticsSnapshot[];
  addSample: (s: AnalyticsSnapshot) => void;
}

/**
 * Client-derived rolling buffer backing the /analytics charts. The backend's /reports endpoints
 * are canned mock data (not real aggregation) — rather than present fake server-sourced charts as
 * real, this samples the *same* live WS-fed state every existing console view already reads
 * (useFleetTotals, WebSocketManager.getLatest) into an in-memory time series. No new queries or
 * subscriptions are created for this — see AnalyticsRecorder, which only reads existing hooks.
 * Resets on full page reload (in-memory only); this is disclosed on the Analytics page itself.
 */
export const useAnalyticsHistoryStore = create<AnalyticsHistoryState>((set) => ({
  samples: [],
  addSample: (s) => set((state) => ({ samples: [...state.samples, s].slice(-MAX_SAMPLES) })),
}));
