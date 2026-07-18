import { create } from 'zustand';
import type { User } from '@/types';

export type LockReason = 'idle' | 'revoked' | 'manual' | null;

interface SessionState {
  user: User | null;
  sessionExpiresAt: string | null;
  locked: boolean;
  lockReason: LockReason;
  idleWarningVisible: boolean;
  stepUpGrantedUntil: number | null;
  hydrated: boolean;

  setSession: (user: User, sessionExpiresAt: string) => void;
  clearSession: () => void;
  lock: (reason: Exclude<LockReason, null>) => void;
  unlock: () => void;
  setIdleWarning: (visible: boolean) => void;
  grantStepUp: (untilMs: number) => void;
  hasStepUp: () => boolean;
  setHydrated: (v: boolean) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  user: null,
  sessionExpiresAt: null,
  locked: false,
  lockReason: null,
  idleWarningVisible: false,
  stepUpGrantedUntil: null,
  hydrated: false,

  setSession: (user, sessionExpiresAt) =>
    set({ user, sessionExpiresAt, locked: false, lockReason: null, idleWarningVisible: false }),
  clearSession: () =>
    set({ user: null, sessionExpiresAt: null, locked: false, lockReason: null, stepUpGrantedUntil: null }),
  lock: (reason) => set({ locked: true, lockReason: reason, idleWarningVisible: false }),
  unlock: () => set({ locked: false, lockReason: null }),
  setIdleWarning: (visible) => set({ idleWarningVisible: visible }),
  grantStepUp: (untilMs) => set({ stepUpGrantedUntil: untilMs }),
  hasStepUp: () => {
    const until = get().stepUpGrantedUntil;
    return !!until && until > Date.now();
  },
  setHydrated: (v) => set({ hydrated: v }),
}));
