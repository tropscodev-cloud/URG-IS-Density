import { useState } from 'react';
import { Modal } from '@/lib/ui/Modal';
import { useThresholds, useSetThreshold } from './api';
import { useZones } from '@/features/cameras/api';
import { useStepUpStore } from '@/lib/state/stepUpStore';
import { auditQueue } from '@/lib/audit/auditQueue';
import { toast } from '@/lib/state/toastStore';
import type { ThresholdConfig } from '@/types';

interface Props {
  onClose: () => void;
}

export function ThresholdSettings({ onClose }: Props): React.JSX.Element {
  const { data: configs } = useThresholds();
  const { data: zones } = useZones();
  const setThreshold = useSetThreshold();
  const requestStepUp = useStepUpStore((s) => s.request);
  const [selectedZone, setSelectedZone] = useState<string>('');

  const zoneConfigs = new Map((configs ?? []).filter((c) => c.scopeType === 'zone').map((c) => [c.scopeId, c]));
  const current = selectedZone ? zoneConfigs.get(selectedZone) : undefined;

  const [warningAt, setWarningAt] = useState(55);
  const [criticalAt, setCriticalAt] = useState(80);
  const [sustainedSeconds, setSustainedSeconds] = useState(12);
  const [cooldownSeconds, setCooldownSeconds] = useState(45);

  function selectZone(zoneId: string): void {
    setSelectedZone(zoneId);
    const cfg = zoneConfigs.get(zoneId);
    if (cfg) {
      setWarningAt(Math.round(cfg.warningAt * 100));
      setCriticalAt(Math.round(cfg.criticalAt * 100));
      setSustainedSeconds(cfg.sustainedSeconds);
      setCooldownSeconds(cfg.cooldownSeconds);
    }
  }

  async function handleSave(): Promise<void> {
    if (!selectedZone) return;
    const ok = await requestStepUp('change density thresholds');
    if (!ok) return;
    const config: Omit<ThresholdConfig, 'updatedBy' | 'updatedAt'> = {
      scopeType: 'zone',
      scopeId: selectedZone,
      metric: 'densityRisk',
      warningAt: warningAt / 100,
      criticalAt: criticalAt / 100,
      sustainedSeconds,
      cooldownSeconds,
    };
    await setThreshold.mutateAsync(config);
    auditQueue.enqueue('threshold.update', selectedZone, { ...config });
    toast({ severity: 'success', title: 'Thresholds updated', message: `Density thresholds for the selected zone were saved.` });
  }

  return (
    <Modal title="Alert threshold tuning" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-fg-secondary">Zone</span>
          <select
            value={selectedZone}
            onChange={(e) => selectZone(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent"
          >
            <option value="">Select a zone…</option>
            {(zones?.items ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>

        {selectedZone && (
          <>
            <Slider label={`Warning at ${warningAt}%`} value={warningAt} min={10} max={95} onChange={setWarningAt} />
            <Slider label={`Critical at ${criticalAt}%`} value={criticalAt} min={warningAt + 1} max={99} onChange={setCriticalAt} />
            <Slider label={`Sustained breach required: ${sustainedSeconds}s`} value={sustainedSeconds} min={0} max={120} onChange={setSustainedSeconds} />
            <Slider label={`Cooldown after resolve: ${cooldownSeconds}s`} value={cooldownSeconds} min={0} max={300} onChange={setCooldownSeconds} />
            <p className="text-[11px] text-fg-muted">
              Hysteresis: a value must stay breached for the sustained window before an alert fires, and won't re-fire for the
              cooldown window after resolving — this prevents a value oscillating near the threshold from spamming alerts.
              {current && ` Currently: warning ${(current.warningAt * 100).toFixed(0)}%, critical ${(current.criticalAt * 100).toFixed(0)}%.`}
            </p>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-raised">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={setThreshold.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
              >
                Save (requires step-up)
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-fg-secondary">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}
