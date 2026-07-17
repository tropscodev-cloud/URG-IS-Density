import { create } from 'zustand';
import type { ConnectionState } from '@/types';

interface WsState {
  connectionState: ConnectionState;
  reconnectAttempt: number;
  reconnectAtMs: number | null;
  messageRate: number;
  clockSkewMs: number;
  diagnostics: {
    droppedOutOfOrder: number;
    clampedCorrupt: number;
  };

  setConnectionState: (s: ConnectionState) => void;
  setReconnectInfo: (attempt: number, atMs: number | null) => void;
  setMessageRate: (rate: number) => void;
  setClockSkew: (ms: number) => void;
  incrementDroppedOutOfOrder: () => void;
  incrementClampedCorrupt: () => void;
}

export const useWsStore = create<WsState>((set) => ({
  connectionState: 'CONNECTING',
  reconnectAttempt: 0,
  reconnectAtMs: null,
  messageRate: 0,
  clockSkewMs: 0,
  diagnostics: { droppedOutOfOrder: 0, clampedCorrupt: 0 },

  setConnectionState: (connectionState) => set({ connectionState }),
  setReconnectInfo: (reconnectAttempt, reconnectAtMs) => set({ reconnectAttempt, reconnectAtMs }),
  setMessageRate: (messageRate) => set({ messageRate }),
  setClockSkew: (clockSkewMs) => set({ clockSkewMs }),
  incrementDroppedOutOfOrder: () =>
    set((s) => ({ diagnostics: { ...s.diagnostics, droppedOutOfOrder: s.diagnostics.droppedOutOfOrder + 1 } })),
  incrementClampedCorrupt: () =>
    set((s) => ({ diagnostics: { ...s.diagnostics, clampedCorrupt: s.diagnostics.clampedCorrupt + 1 } })),
}));
