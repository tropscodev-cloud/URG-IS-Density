import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/lib/ui/Modal';
import { usePatchCamera, useZones } from './api';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import { ApiRequestError } from '@/lib/api/client';
import type { Camera } from '@/types';

const editSchema = z.object({
  name: z.string().min(2).max(80),
  zoneId: z.string().min(1),
  lat: z.coerce.number().min(-90).max(90).nullable(),
  lng: z.coerce.number().min(-180).max(180).nullable(),
  bearing: z.coerce.number().min(0).max(360),
  fovAngle: z.coerce.number().min(1).max(360),
  range: z.coerce.number().min(1).max(1000),
  tags: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

interface Props {
  camera: Camera;
  onClose: () => void;
}

export function EditCameraModal({ camera, onClose }: Props): React.JSX.Element {
  const { data: zones } = useZones();
  const patchCamera = usePatchCamera();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: camera.name,
      zoneId: camera.zoneId,
      lat: camera.lat,
      lng: camera.lng,
      bearing: camera.bearing,
      fovAngle: camera.fovAngle,
      range: camera.range,
      tags: camera.tags.join(', '),
    },
  });

  async function onSubmit(values: EditValues): Promise<void> {
    try {
      await patchCamera.mutateAsync({
        id: camera.id,
        patch: {
          name: values.name,
          zoneId: values.zoneId,
          lat: values.lat,
          lng: values.lng,
          bearing: values.bearing,
          fovAngle: values.fovAngle,
          range: values.range,
          tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        },
      });
      auditQueue.enqueue('camera.update', camera.id, { name: values.name });
      toast({ severity: 'success', title: 'Camera updated', message: `${values.name} saved — map and FOV cone update live.` });
      onClose();
    } catch (err) {
      toast({ severity: 'critical', title: 'Update failed', message: err instanceof ApiRequestError ? err.message : 'Try again.' });
    }
  }

  return (
    <Modal title={`Edit ${camera.name}`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-3">
        <Field label="Name" error={errors.name?.message}>
          <input {...register('name')} className={inputCls} />
        </Field>
        <Field label="Zone" error={errors.zoneId?.message}>
          <select {...register('zoneId')} className={inputCls}>
            {(zones?.items ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={errors.lat?.message}>
            <input type="number" step="any" {...register('lat')} className={inputCls} />
          </Field>
          <Field label="Longitude" error={errors.lng?.message}>
            <input type="number" step="any" {...register('lng')} className={inputCls} />
          </Field>
        </div>
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
          <input {...register('tags')} className={inputCls} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  'w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-fg-secondary">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[10px] text-severity-critical">{error}</span>}
    </label>
  );
}
