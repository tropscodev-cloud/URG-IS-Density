import { useRef, useState } from 'react';
import { Loader2, Upload, CheckCircle2, XCircle, Link2, FileUp } from 'lucide-react';
import clsx from 'clsx';
import { Modal } from '@/lib/ui/Modal';
import { useBulkImport, useZones, type BulkImportRowResult } from './api';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import { ApiRequestError } from '@/lib/api/client';

interface Props {
  onClose: () => void;
}

type Mode = 'file' | 'paste';

export function BulkImportModal({ onClose }: Props): React.JSX.Element {
  const { data: zones } = useZones();
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [defaultZoneId, setDefaultZoneId] = useState('');
  const [preview, setPreview] = useState<BulkImportRowResult[] | null>(null);
  const [committed, setCommitted] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const bulkImport = useBulkImport();

  async function runPreview(f: File): Promise<void> {
    setFile(f);
    setCommitted(false);
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await bulkImport.mutateAsync({ file: f, commit: false, defaultZoneId: defaultZoneId || undefined });
      setPreview(res.results);
    } catch (err) {
      setPreviewError(err instanceof ApiRequestError ? err.message : 'Could not read that file.');
    }
  }

  function handlePreviewPastedLinks(): void {
    const blob = new Blob([pasteText], { type: 'text/plain' });
    void runPreview(new File([blob], 'pasted-rtsp-links.txt', { type: 'text/plain' }));
  }

  // Same synchronous-double-click guard as NewReportForm's handleGenerate — `disabled` only takes
  // effect on the next render, which isn't fast enough to block two clicks in the same task.
  const committingRef = useRef(false);

  async function handleCommit(): Promise<void> {
    if (!file || committingRef.current) return;
    committingRef.current = true;
    try {
      const res = await bulkImport.mutateAsync({ file, commit: true, defaultZoneId: defaultZoneId || undefined });
      setPreview(res.results);
      setCommitted(true);
      const accepted = res.results.filter((r) => r.accepted).length;
      auditQueue.enqueue('camera.bulk_import', null, { total: res.results.length, accepted });
      toast({ severity: 'success', title: 'Bulk import complete', message: `${accepted} of ${res.results.length} cameras created.` });
    } finally {
      committingRef.current = false;
    }
  }

  function switchMode(next: Mode): void {
    setMode(next);
    setFile(null);
    setPreview(null);
    setPreviewError(null);
    setCommitted(false);
  }

  const acceptedCount = preview?.filter((r) => r.accepted).length ?? 0;
  const rejectedCount = preview ? preview.length - acceptedCount : 0;

  return (
    <Modal title="Bulk import cameras" onClose={onClose} widthClassName="max-w-2xl">
      <div className="space-y-3">
        <div className="flex gap-1 rounded-md border border-border bg-bg-raised p-1 text-xs">
          <button
            type="button"
            onClick={() => switchMode('file')}
            className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5', mode === 'file' ? 'bg-accent text-accent-fg' : 'text-fg-secondary hover:bg-bg-overlay')}
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload a file
          </button>
          <button
            type="button"
            onClick={() => switchMode('paste')}
            className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5', mode === 'paste' ? 'bg-accent text-accent-fg' : 'text-fg-secondary hover:bg-bg-overlay')}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Paste RTSP links
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-fg-secondary">
            Default zone <span className="text-fg-muted">(used for cameras with no zone of their own)</span>
          </span>
          <select
            value={defaultZoneId}
            onChange={(e) => {
              setDefaultZoneId(e.target.value);
              // The preview reflects the zone in effect when it ran — invalidate it rather than
              // let a stale preview be committed under a different default zone.
              setPreview(null);
              setCommitted(false);
            }}
            className="w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent"
          >
            <option value="">None selected</option>
            {(zones?.items ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-fg-muted">
            Required for PDF, Word, .txt, and pasted links — those sources list RTSP links, not zones or coordinates.
          </span>
        </label>

        {mode === 'file' ? (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-border p-6 text-xs text-fg-secondary hover:border-accent">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {file ? file.name : 'Choose a file — .csv, .json, .xlsx, .pdf, .docx, or .txt'}
            <input
              type="file"
              accept=".csv,.json,.xlsx,.xls,.pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runPreview(f);
              }}
            />
          </label>
        ) : (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'One camera per line, e.g.:\nLobby entrance, rtsp://192.168.1.10:554/stream1\nrtsp://192.168.1.11:554/stream1'}
              rows={6}
              className="w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 font-mono text-xs text-fg-primary outline-none focus-visible:border-accent"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handlePreviewPastedLinks}
                disabled={!pasteText.trim() || bulkImport.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised disabled:opacity-50"
              >
                Preview links
              </button>
            </div>
          </div>
        )}

        {bulkImport.isPending && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Processing…
          </div>
        )}

        {previewError && (
          <div role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical">
            {previewError}
          </div>
        )}

        {preview && (
          <>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-status-online">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {acceptedCount} accepted
              </span>
              <span className="flex items-center gap-1 text-severity-critical">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> {rejectedCount} rejected
              </span>
              {committed && <span className="text-fg-muted">— committed</span>}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-raised text-[10px] uppercase text-fg-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Row</th>
                    <th className="px-2 py-1 text-left">Result</th>
                    <th className="px-2 py-1 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.row} className={clsx('border-t border-border', !r.accepted && 'bg-severity-critical/5')}>
                      <td className="px-2 py-1 font-mono">{r.row}</td>
                      <td className={clsx('px-2 py-1', r.accepted ? 'text-status-online' : 'text-severity-critical')}>
                        {r.accepted ? 'Accepted' : 'Rejected'}
                      </td>
                      <td className="px-2 py-1 text-fg-muted">{r.reason ?? (r.camera ? r.camera.name : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised">
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={!preview || acceptedCount === 0 || committed || bulkImport.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
          >
            Commit {acceptedCount > 0 ? `${acceptedCount} cameras` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
