import type uPlot from 'uplot';
import type { MetricPoint } from '@/features/timeline/api';

export type ChartMetric = 'headcount' | 'densityRisk' | 'flowRate' | 'movementPct';

function valueFor(p: MetricPoint, metric: ChartMetric): number | null {
  switch (metric) {
    case 'headcount':
      return p.headcount ?? p.headcountAvg ?? null;
    case 'densityRisk':
      return p.densityRisk ?? p.densityRiskAvg ?? null;
    case 'flowRate':
      return p.flowRate ?? p.flowRateAvg ?? null;
    case 'movementPct':
      return p.movementPct ?? p.movementPctAvg ?? null;
  }
}

/**
 * Builds uPlot-aligned data with explicit gap breaks for offline periods — a missing interval
 * renders as a visible break in the line, never an interpolated connection across the outage.
 */
export function toAlignedData(points: MetricPoint[], metric: ChartMetric, expectedIntervalMs: number): uPlot.AlignedData {
  const sorted = points
    .filter((p): p is MetricPoint & { ts: string } => !!p.ts)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const xs: number[] = [];
  const ys: (number | null)[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const tMs = Date.parse(p.ts);
    if (i > 0) {
      const prevMs = Date.parse(sorted[i - 1]!.ts);
      if (tMs - prevMs > expectedIntervalMs * 3) {
        xs.push(Math.floor((prevMs + tMs) / 2 / 1000));
        ys.push(null);
      }
    }
    xs.push(Math.floor(tMs / 1000));
    ys.push(valueFor(p, metric));
  }

  return [xs, ys];
}

export interface Stats {
  min: number | null;
  avg: number | null;
  peak: number | null;
}

export function computeStats(points: MetricPoint[], metric: ChartMetric): Stats {
  const values = points.map((p) => valueFor(p, metric)).filter((v): v is number => v !== null);
  if (values.length === 0) return { min: null, avg: null, peak: null };
  return {
    min: Math.min(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    peak: Math.max(...values),
  };
}
