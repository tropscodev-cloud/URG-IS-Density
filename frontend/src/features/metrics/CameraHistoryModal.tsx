import { useMemo, useState } from 'react';
import { Modal } from '@/lib/ui/Modal';
import { UPlotChart } from '@/lib/ui/UPlotChart';
import { useCameraHistory, useAlertEvents } from '@/features/timeline/api';
import { toAlignedData, computeStats, type ChartMetric } from './chartData';
import { ApiRequestError } from '@/lib/api/client';
import { AlertTriangle } from 'lucide-react';

interface Props {
  cameraId: string;
  cameraName: string;
  metric: ChartMetric;
  label: string;
  onClose: () => void;
}

const RANGES: Array<{ label: string; ms: number }> = [
  { label: '24h', ms: 24 * 60 * 60_000 },
  { label: '7d', ms: 7 * 24 * 60 * 60_000 },
];

export function CameraHistoryModal({ cameraId, cameraName, metric, label, onClose }: Props): React.JSX.Element {
  const [rangeMs, setRangeMs] = useState(RANGES[0]!.ms);
  // Frozen at open time — recomputing from Date.now() on every re-render would change the query
  // key each time and the fetch would never get a chance to complete (see CameraSparkline).
  const [now] = useState(() => Date.now());
  const { data, error, isLoading } = useCameraHistory(cameraId, now - rangeMs, now, '5m');
  const { data: alertEvents } = useAlertEvents(now - rangeMs, now, cameraId);

  const purged = error instanceof ApiRequestError && error.status === 410;
  const points = data?.items ?? [];
  const aligned = useMemo(() => toAlignedData(points, metric, 5 * 60_000), [points, metric]);
  const stats = useMemo(() => computeStats(points, metric), [points, metric]);

  const breachMarks = (alertEvents?.items ?? []).map((a) => Math.floor(Date.parse(a.raisedAt) / 1000));

  return (
    <Modal title={`${cameraName} — ${label} history`} onClose={onClose} widthClassName="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRangeMs(r.ms)}
              className={`rounded border px-2 py-0.5 text-xs ${rangeMs === r.ms ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-secondary hover:bg-bg-raised'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {stats.min !== null && (
          <div className="flex gap-3 text-xs text-fg-secondary">
            <span>
              Min <span className="font-mono text-fg-primary">{stats.min.toFixed(1)}</span>
            </span>
            <span>
              Avg <span className="font-mono text-fg-primary">{stats.avg!.toFixed(1)}</span>
            </span>
            <span>
              Peak <span className="font-mono text-fg-primary">{stats.peak!.toFixed(1)}</span>
            </span>
          </div>
        )}
      </div>

      {purged ? (
        <div className="flex items-center gap-2 rounded-md border border-severity-warning/30 bg-severity-warning/10 p-4 text-sm text-severity-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Data for part or all of this range has been purged per the department retention policy.
        </div>
      ) : isLoading ? (
        <div className="h-64" />
      ) : (
        <>
          <UPlotChart
            data={aligned}
            options={{
              height: 260,
              series: [{}, { stroke: '#38bdf8', width: 1.5, points: { show: false }, spanGaps: false }],
              axes: [{ stroke: '#6c7486' }, { stroke: '#6c7486' }],
              scales: { x: { time: true } },
              cursor: { points: { show: false } },
              legend: { show: false },
              hooks: {
                draw: [
                  (u) => {
                    const ctx = u.ctx;
                    ctx.save();
                    ctx.strokeStyle = 'rgba(244,63,94,0.6)';
                    ctx.lineWidth = 1;
                    for (const ts of breachMarks) {
                      const x = u.valToPos(ts, 'x', true);
                      if (x >= u.bbox.left && x <= u.bbox.left + u.bbox.width) {
                        ctx.beginPath();
                        ctx.moveTo(x, u.bbox.top);
                        ctx.lineTo(x, u.bbox.top + u.bbox.height);
                        ctx.stroke();
                      }
                    }
                    ctx.restore();
                  },
                ],
              },
            }}
          />
          <p className="mt-2 text-[11px] text-fg-muted">
            Red vertical lines mark threshold-breach events. Gaps in the line reflect periods the camera was offline — never
            interpolated.
          </p>
        </>
      )}
    </Modal>
  );
}
