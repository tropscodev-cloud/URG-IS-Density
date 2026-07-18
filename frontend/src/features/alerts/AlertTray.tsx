import { useState } from 'react';
import { ShieldAlert, ChevronUp, ChevronDown, Volume2, VolumeX, Sliders } from 'lucide-react';
import clsx from 'clsx';
import { useAlerts } from './api';
import { AlertList } from './AlertList';
import { ThresholdSettings } from './ThresholdSettings';
import { useUiStore } from '@/lib/state/uiStore';
import { auditQueue } from '@/lib/audit/auditQueue';
import { RoleGate } from '@/features/auth/RoleGate';

export function AlertTray(): React.JSX.Element {
  const expanded = useUiStore((s) => s.alertTrayExpanded);
  const setExpanded = useUiStore((s) => s.setAlertTrayExpanded);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const { data: openAlerts } = useAlerts({ status: 'OPEN' });
  const criticalCount = (openAlerts?.items ?? []).filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = (openAlerts?.items ?? []).filter((a) => a.severity === 'WARNING').length;
  const total = openAlerts?.items.length ?? 0;

  const muted = useUiStore((s) => s.alertSoundMuted);
  const toggleMuted = useUiStore((s) => s.toggleAlertSoundMuted);

  function handleToggleMute(e: React.MouseEvent): void {
    e.stopPropagation();
    toggleMuted();
    auditQueue.enqueue('alerts.mute_toggle', null, { muted: !muted });
  }

  return (
    <div className="absolute left-3 top-16 z-30 w-80 max-w-[calc(100vw-2rem)]">
      <div
        className={clsx(
          'flex w-full items-center gap-2 rounded-t-lg border border-border bg-bg-surface/95 px-3 py-2 shadow-lg backdrop-blur',
          !expanded && 'rounded-b-lg',
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ShieldAlert className={clsx('h-4 w-4 shrink-0', criticalCount > 0 ? 'text-severity-critical' : 'text-fg-muted')} aria-hidden="true" />
          <span className="text-xs font-semibold text-fg-primary">Alert tray</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            {criticalCount > 0 && <span className="rounded bg-severity-critical/15 px-1.5 py-0.5 font-mono text-severity-critical">{criticalCount} CRIT</span>}
            {warningCount > 0 && <span className="rounded bg-severity-warning/15 px-1.5 py-0.5 font-mono text-severity-warning">{warningCount} WARN</span>}
            {total === 0 && <span className="text-fg-muted">clear</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={handleToggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute alert sound' : 'Mute alert sound'}
          title={muted ? 'Alert sound muted' : 'Alert sound on'}
          className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        <RoleGate permission="tuneThresholds">
          <button
            type="button"
            onClick={() => setThresholdsOpen(true)}
            aria-label="Tune alert thresholds"
            title="Tune alert thresholds"
            className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
          >
            <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </RoleGate>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse alert tray' : 'Expand alert tray'}
          className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-raised hover:text-fg-primary"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
      {expanded && (
        <div
          role="region"
          aria-label="Open alerts"
          className="max-h-[60vh] overflow-y-auto rounded-b-lg border border-t-0 border-border bg-bg-surface/95 shadow-lg backdrop-blur"
        >
          <AlertList />
        </div>
      )}
      {thresholdsOpen && <ThresholdSettings onClose={() => setThresholdsOpen(false)} />}
    </div>
  );
}
