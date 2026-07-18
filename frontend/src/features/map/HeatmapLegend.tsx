import { HEATMAP_THRESHOLDS } from './colors';

export function HeatmapLegend(): React.JSX.Element {
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
