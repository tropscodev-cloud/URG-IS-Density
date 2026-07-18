import { HEATMAP_THRESHOLDS } from './colors';

interface Props {
  /** True when the heatmap is temporarily suppressed by MapCanvas's own alert-volume safeguard,
   *  distinct from the operator's own on/off toggle — see MapCanvas.tsx's heatmapAutoPaused. */
  autoPaused?: boolean;
  openAlertCount?: number;
}

export function HeatmapLegend({ autoPaused, openAlertCount }: Props): React.JSX.Element {
  if (autoPaused) {
    return (
      <div className="absolute bottom-3 left-3 z-20 max-w-[220px] rounded-lg border border-severity-warning/40 bg-bg-surface/90 px-3 py-2 text-[10px] shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold uppercase tracking-wide text-severity-warning">Density risk — paused</div>
        <p className="text-fg-secondary">
          Paused during {openAlertCount} active alerts to keep the map responsive. Resumes automatically once alerts drop.
        </p>
      </div>
    );
  }

  return (
    <div className="absolute bottom-3 left-3 z-20 rounded-lg border border-border bg-bg-surface/90 px-3 py-2 text-[10px] shadow-lg backdrop-blur">
      <div className="mb-1 font-semibold uppercase tracking-wide text-fg-muted">Density risk</div>
      <div className="flex items-center gap-2">
        {HEATMAP_THRESHOLDS.map((t) => (
          <div key={t.label} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: t.color }} aria-hidden="true" />
            <span className="text-fg-secondary">{t.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 text-fg-muted">Low &lt;55% · Moderate 55–80% · High/Critical ≥80%</div>
    </div>
  );
}
