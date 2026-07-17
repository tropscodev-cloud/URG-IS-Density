import { useEffect, useMemo, useState } from 'react';
import { Expand } from 'lucide-react';
import { useCameraHistory } from '@/features/timeline/api';
import { toAlignedData, type ChartMetric } from './chartData';
import { UPlotChart } from '@/lib/ui/UPlotChart';
import { CameraHistoryModal } from './CameraHistoryModal';

interface Props {
  cameraId: string;
  cameraName: string;
  metric: ChartMetric;
  label: string;
  color: string;
}

const TWO_HOURS_MS = 2 * 60 * 60_000;

export function CameraSparkline({ cameraId, cameraName, metric, label, color }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // Frozen except for a slow periodic refresh — recomputing from Date.now() on every render
  // (which happens up to 4x/sec from live WS updates elsewhere on the panel) would change the
  // query key every time and starve the fetch before it ever completes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // 5-minute buckets, not raw per-second points — a 40px sparkline can't show more resolution
  // than that anyway, and it's a fraction of the payload (24 points vs. up to 7200 for 2h raw).
  const { data, isLoading } = useCameraHistory(cameraId, now - TWO_HOURS_MS, now, '5m');

  const aligned = useMemo(() => toAlignedData(data?.items ?? [], metric, 5 * 60_000), [data, metric]);

  return (
    <div className="rounded-md border border-border bg-bg-raised p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-fg-muted">{label} · 2h</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Expand ${label} history`}
          className="rounded p-0.5 text-fg-muted hover:bg-bg-surface hover:text-fg-primary"
        >
          <Expand className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {isLoading ? (
        <div className="h-10" />
      ) : (
        <UPlotChart
          data={aligned}
          options={{
            height: 40,
            series: [{}, { stroke: color, width: 1.5, points: { show: false }, spanGaps: false }],
            axes: [{ show: false }, { show: false }],
            scales: { x: { time: true } },
            cursor: { show: false },
            legend: { show: false },
          }}
        />
      )}
      {expanded && (
        <CameraHistoryModal cameraId={cameraId} cameraName={cameraName} metric={metric} label={label} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}
