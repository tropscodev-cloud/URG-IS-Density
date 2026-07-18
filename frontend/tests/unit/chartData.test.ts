import { describe, it, expect } from 'vitest';
import { toAlignedData, computeStats } from '@/features/metrics/chartData';
import type { MetricPoint } from '@/features/timeline/api';

function point(tsOffsetMs: number, headcount: number): MetricPoint {
  return { ts: new Date(tsOffsetMs).toISOString(), headcount };
}

describe('toAlignedData', () => {
  it('inserts a null gap break when the interval between points exceeds 3x expected, instead of interpolating', () => {
    const interval = 60_000;
    const points = [point(0, 10), point(interval, 12), point(interval * 10, 15)]; // big gap before the 3rd point
    const [xs, ys] = toAlignedData(points, 'headcount', interval);

    expect(xs).toHaveLength(4); // 3 real points + 1 inserted null gap marker
    expect(ys).toHaveLength(4);
    expect(ys[1]).toBe(12);
    expect(ys[2]).toBeNull(); // the gap marker
    expect(ys[3]).toBe(15);
  });

  it('does not insert a gap when points are within the expected cadence', () => {
    const interval = 60_000;
    const points = [point(0, 10), point(interval, 11), point(interval * 2, 12)];
    const [, ys] = toAlignedData(points, 'headcount', interval);
    expect(ys).toEqual([10, 11, 12]);
  });

  it('sorts out-of-order input points by timestamp', () => {
    const interval = 60_000;
    const points = [point(interval * 2, 30), point(0, 10), point(interval, 20)];
    const [, ys] = toAlignedData(points, 'headcount', interval);
    expect(ys).toEqual([10, 20, 30]);
  });
});

describe('computeStats', () => {
  it('computes min/avg/peak across the series', () => {
    const points = [point(0, 5), point(1, 15), point(2, 10)];
    const stats = computeStats(points, 'headcount');
    expect(stats.min).toBe(5);
    expect(stats.peak).toBe(15);
    expect(stats.avg).toBeCloseTo(10, 5);
  });

  it('returns nulls for an empty series rather than throwing', () => {
    expect(computeStats([], 'headcount')).toEqual({ min: null, avg: null, peak: null });
  });
});
