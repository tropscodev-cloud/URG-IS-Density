import { create } from 'zustand';

interface AlertDraftState {
  drafts: Record<string, string>;
  setDraft: (alertId: string, text: string) => void;
  clearDraft: (alertId: string) => void;
}

/** In-progress "describe your response" text, keyed by alert ID rather than living in
 *  AlertCard's own component state — so a draft survives that specific card unmounting and
 *  remounting (e.g. if it's briefly re-created by a data refresh), not just re-renders. */
export const useAlertDraftStore = create<AlertDraftState>((set) => ({
  drafts: {},
  setDraft: (alertId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [alertId]: text } })),
  clearDraft: (alertId) =>
    set((s) => {
      if (!(alertId in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[alertId];
      return { drafts };
    }),
}));
