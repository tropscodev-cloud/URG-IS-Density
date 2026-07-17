import { create } from 'zustand';
import { api, ApiRequestError } from '@/lib/api/client';
import { useSessionStore } from './sessionStore';

interface StepUpState {
  open: boolean;
  reason: string | null;
  submitting: boolean;
  error: string | null;
  resolver: ((ok: boolean) => void) | null;

  /** Imperative gate: `if (!(await requestStepUp('retire this camera'))) return;` */
  request: (reason: string) => Promise<boolean>;
  submit: (password: string) => Promise<void>;
  cancel: () => void;
}

export const useStepUpStore = create<StepUpState>((set, get) => ({
  open: false,
  reason: null,
  submitting: false,
  error: null,
  resolver: null,

  request: (reason) => {
    if (useSessionStore.getState().hasStepUp()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      set({ open: true, reason, resolver: resolve, error: null });
    });
  },

  submit: async (password) => {
    set({ submitting: true, error: null });
    try {
      const res = await api.post<{ grantedUntil: string }>('/auth/step-up', { password });
      useSessionStore.getState().grantStepUp(Date.parse(res.grantedUntil));
      get().resolver?.(true);
      set({ open: false, resolver: null, submitting: false, reason: null });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Step-up verification failed.';
      set({ submitting: false, error: message });
    }
  },

  cancel: () => {
    get().resolver?.(false);
    set({ open: false, resolver: null, error: null, reason: null });
  },
}));
