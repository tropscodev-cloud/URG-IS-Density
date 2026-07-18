import { create } from 'zustand';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface Toast {
  id: string;
  severity: ToastSeverity;
  title: string;
  message?: string;
  createdAt: number;
  actionLabel?: string;
  onAction?: () => void;
  /** null = sticky until dismissed (used for CRITICAL / failed-mutation toasts). */
  autoDismissMs?: number | null;
  read: boolean;
}

interface ToastState {
  toasts: Toast[];
  eventLog: Toast[];
  push: (t: Omit<Toast, 'id' | 'createdAt' | 'read'>) => string;
  /** Patches an existing toast in place (e.g. bumping a grouped summary toast's count) rather
   *  than pushing a new one — used to fold a burst of alerts into one live-updating toast. */
  update: (id: string, patch: Partial<Pick<Toast, 'title' | 'message'>>) => void;
  dismiss: (id: string) => void;
  markLogRead: () => void;
}

const MAX_LOG = 200;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  eventLog: [],

  push: (t) => {
    const id = crypto.randomUUID();
    const toast: Toast = { ...t, id, createdAt: Date.now(), read: false };
    set((s) => ({
      toasts: [...s.toasts, toast],
      eventLog: [toast, ...s.eventLog].slice(0, MAX_LOG),
    }));
    const dismissMs = t.autoDismissMs === undefined ? 6000 : t.autoDismissMs;
    if (dismissMs !== null) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }, dismissMs);
    }
    return id;
  },

  update: (id, patch) =>
    set((s) => {
      const idx = s.toasts.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const toasts = [...s.toasts];
      toasts[idx] = { ...toasts[idx]!, ...patch };
      const logIdx = s.eventLog.findIndex((t) => t.id === id);
      const eventLog = logIdx === -1 ? s.eventLog : [...s.eventLog];
      if (logIdx !== -1) eventLog[logIdx] = { ...eventLog[logIdx]!, ...patch };
      return { toasts, eventLog };
    }),

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  markLogRead: () => set((s) => ({ eventLog: s.eventLog.map((t) => ({ ...t, read: true })) })),
}));

export function toast(t: Omit<Toast, 'id' | 'createdAt' | 'read'>): string {
  return useToastStore.getState().push(t);
}

export function updateToast(id: string, patch: Partial<Pick<Toast, 'title' | 'message'>>): void {
  useToastStore.getState().update(id, patch);
}
