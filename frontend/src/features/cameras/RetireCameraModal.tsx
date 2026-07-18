import { useState } from 'react';
import { Modal } from '@/lib/ui/Modal';
import { useRetireCamera } from './api';
import { useStepUpStore } from '@/lib/state/stepUpStore';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import { ApiRequestError } from '@/lib/api/client';
import type { Camera } from '@/types';

interface Props {
  camera: Camera;
  onClose: () => void;
}

export function RetireCameraModal({ camera, onClose }: Props): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const retire = useRetireCamera();
  const requestStepUp = useStepUpStore((s) => s.request);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  const canSubmit = reason.trim().length >= 5 && confirmText === camera.name;

  async function handleSubmit(): Promise<void> {
    setError(null);
    const ok = await requestStepUp(`retire ${camera.name}`);
    if (!ok) return;
    try {
      await retire.mutateAsync({ id: camera.id, reason: reason.trim() });
      auditQueue.enqueue('camera.retire', camera.id, { reason: reason.trim() });
      toast({ severity: 'success', title: 'Camera retired', message: `${camera.name} was retired. History is preserved.` });
      clearSelection();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to retire camera.');
    }
  }

  return (
    <Modal title="Retire camera" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">
          Retiring <span className="font-medium text-fg-primary">{camera.name}</span> removes it from the active fleet and
          map. Its history and audit trail are preserved — this cannot be undone from the UI, and there is no hard-delete.
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-fg-secondary">Reason (required)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent"
            placeholder="e.g. Camera hardware decommissioned during festival teardown"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-fg-secondary">
            Type the camera name (<span className="font-mono">{camera.name}</span>) to confirm
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent"
          />
        </label>
        {error && (
          <div role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || retire.isPending}
            className="rounded-md bg-severity-critical px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            Retire camera (requires step-up)
          </button>
        </div>
      </div>
    </Modal>
  );
}
