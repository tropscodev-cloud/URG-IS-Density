import { create } from 'zustand';

export type PlaybackSpeed = 1 | 4 | 16;

interface TimeState {
  isHistorical: boolean;
  viewingAtMs: number;
  rangeFromMs: number;
  rangeToMs: number;
  playing: boolean;
  speed: PlaybackSpeed;

  enterHistorical: (atMs: number, fromMs: number, toMs: number) => void;
  returnToLive: () => void;
  seek: (atMs: number) => void;
  setRange: (fromMs: number, toMs: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export const useTimeStore = create<TimeState>((set) => ({
  isHistorical: false,
  viewingAtMs: Date.now(),
  rangeFromMs: Date.now() - 24 * 60 * 60_000,
  rangeToMs: Date.now(),
  playing: false,
  speed: 1,

  enterHistorical: (atMs, fromMs, toMs) =>
    set({ isHistorical: true, viewingAtMs: atMs, rangeFromMs: fromMs, rangeToMs: toMs, playing: false }),
  returnToLive: () => set({ isHistorical: false, playing: false, viewingAtMs: Date.now() }),
  seek: (atMs) => set({ viewingAtMs: atMs }),
  setRange: (rangeFromMs, rangeToMs) => set({ rangeFromMs, rangeToMs }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  setSpeed: (speed) => set({ speed }),
}));
