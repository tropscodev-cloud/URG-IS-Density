import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Modal } from '@/lib/ui/Modal';
import { cameraFormSchema, type CameraFormValues } from './schemas';
import { useCreateCamera, useTestConnection, useCheckDuplicate, useZones } from './api';
import { ApiRequestError } from '@/lib/api/client';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';

interface Props {
  onClose: () => void;
  /** Optional map click can pre-fill coordinates — wired once the map feature is mounted. */
  initialLatLng?: { lat: number; lng: number };
}

export function AddCameraModal({ onClose, initialLatLng }: Props): React.JSX.Element {
  const { data: zones } = useZones();
  const createCamera = useCreateCamera();
  const testConnection = useTestConnection();
  const checkDuplicate = useCheckDuplicate();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; snapshotUrl?: string } | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CameraFormValues>({
    resolver: zodResolver(cameraFormSchema),
    defaultValues: {
      bearing: 0,
      fovAngle: 90,
      range: 50,
      lat: initialLatLng?.lat ?? null,
      lng: initialLatLng?.lng ?? null,
    },
  });

  const rtspUrl = watch('rtspUrl');

  useEffect(() => {
    setFocus('name');
  }, [setFocus]);

  async function handleTestConnection(): Promise<void> {
    if (!rtspUrl) return;
    setTestResult(null);
    const [dup, test] = await Promise.all([
      checkDuplicate.mutateAsync(rtspUrl).catch(() => ({ duplicate: false, cameraId: undefined })),
      testConnection.mutateAsync({ rtspUrl }),
    ]);
    setDuplicateOf(dup.duplicate ? (dup.cameraId ?? 'existing camera') : null);
    setTestResult(
      test.ok
        ? { ok: true, message: 'Connection succeeded.', snapshotUrl: test.snapshotUrl }
        : { ok: false, message: test.error ?? 'Connection failed.' },
    );
  }

  async function onSubmit(values: CameraFormValues): Promise<void> {
    setFormError(null);
    try {
      const camera = await createCamera.mutateAsync({
        name: values.name,
        zoneId: values.zoneId,
        lat: values.lat,
        lng: values.lng,
        rtspUrl: values.rtspUrl,
        rtspUsername: values.rtspUsername,
        rtspPassword: values.rtspPassword,
        bearing: values.bearing,
        fovAngle: values.fovAngle,
        range: values.range,
        tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      });
      auditQueue.enqueue('camera.create', camera.id, { name: camera.name, zoneId: camera.zoneId });
      toast({ severity: 'success', title: 'Camera added', message: `${camera.name} was created.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFormError(err.code === 'DUPLICATE_CAMERA' ? 'A camera with this RTSP URL already exists.' : err.message);
      } else {
        setFormError('Failed to create camera.');
      }
    }
  }

  return (
    <Modal title="Add camera" onClose={onClose} widthClassName="max-w-xl">
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <Field label="Name" error={errors.name?.message}>
          <input {...register('name')} className={inputCls} />
        </Field>

        <Field label="Zone" error={errors.zoneId?.message}>
          <select {...register('zoneId')} className={inputCls} defaultValue="">
            <option value="" disabled>
              Select a zone…
            </option>
            {(zones?.items ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={errors.lat?.message} hint="Map click-to-place lands here once placed on the map">
            <input type="number" step="any" {...register('lat')} className={inputCls} />
          </Field>
          <Field label="Longitude" error={errors.lng?.message}>
            <input type="number" step="any" {...register('lng')} className={inputCls} />
          </Field>
        </div>

        <Field label="RTSP URL" error={errors.rtspUrl?.message} hint="Credentials are write-only — never displayed once saved">
          <input {...register('rtspUrl')} placeholder="rtsp://camera-host/stream1" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="RTSP username (optional)">
            <input {...register('rtspUsername')} className={inputCls} autoComplete="off" />
          </Field>
          <Field label="RTSP password (optional)">
            <input type="password" {...register('rtspPassword')} className={inputCls} autoComplete="new-password" />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={!rtspUrl || testConnection.isPending || checkDuplicate.isPending}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised disabled:opacity-50"
          >
            {(testConnection.isPending || checkDuplicate.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Test connection
          </button>
          {testResult && (
            <span className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-status-online' : 'text-severity-critical'}`}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {testResult.message}
            </span>
          )}
        </div>
        {testResult?.ok && testResult.snapshotUrl && (
          <img src={testResult.snapshotUrl} alt="Test connection snapshot preview" className="h-32 w-full rounded-md border border-border object-cover" />
        )}
        {duplicateOf && (
          <p className="text-xs text-severity-warning">This RTSP URL matches an existing camera ({duplicateOf}).</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Bearing (°)" error={errors.bearing?.message}>
            <input type="number" {...register('bearing')} className={inputCls} />
          </Field>
          <Field label="FOV angle (°)" error={errors.fovAngle?.message}>
            <input type="number" {...register('fovAngle')} className={inputCls} />
          </Field>
          <Field label="Range (m)" error={errors.range?.message}>
            <input type="number" {...register('range')} className={inputCls} />
          </Field>
        </div>

        <Field label="Tags (comma separated)">
          <input {...register('tags')} placeholder="entrance, plaza" className={inputCls} />
        </Field>

        {formError && (
          <div role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical">
            {formError}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Save camera
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  'w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-fg-secondary">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[10px] text-fg-muted">{hint}</span>}
      {error && <span className="mt-1 block text-[10px] text-severity-critical">{error}</span>}
    </label>
  );
}
