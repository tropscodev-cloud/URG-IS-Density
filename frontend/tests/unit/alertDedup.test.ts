import { describe, it, expect } from 'vitest';
import { dedupAlerts, STORM_THRESHOLD } from '@/features/alerts/dedup';
import type { Alert } from '@/types';

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: overrides.id ?? Math.random().toString(36),
    cameraId: overrides.cameraId ?? 'cam-1',
    zoneId: overrides.zoneId ?? 'zone-1',
    severity: overrides.severity ?? 'WARNING',
    status: overrides.status ?? 'OPEN',
    metric: 'densityRisk',
    thresholdValue: 0.55,
    observedValue: 0.6,
    raisedAt: overrides.raisedAt ?? new Date().toISOString(),
    ackedAt: null,
    ackedBy: null,
    ackNote: null,
    resolvedAt: null,
    resolvedBy: null,
    escalatedAt: null,
    escalatedBy: null,
    ...overrides,
  };
}

describe('dedupAlerts', () => {
  it('leaves alerts below the storm threshold as individual items', () => {
    const alerts = [
      makeAlert({ id: 'a', zoneId: 'zone-1', severity: 'WARNING' }),
      makeAlert({ id: 'b', zoneId: 'zone-2', severity: 'CRITICAL' }),
    ];
    const items = dedupAlerts(alerts);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === 'single')).toBe(true);
  });

  it('collapses a zone with STORM_THRESHOLD+ simultaneous alerts into one storm card', () => {
    const alerts = Array.from({ length: STORM_THRESHOLD + 4 }, (_, i) =>
      makeAlert({ id: `s${i}`, cameraId: `cam-${i}`, zoneId: 'zone-storm', severity: 'WARNING' }),
    );
    const items = dedupAlerts(alerts);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('storm');
    if (items[0]!.kind === 'storm') {
      expect(items[0]!.alerts).toHaveLength(STORM_THRESHOLD + 4);
    }
  });

  it('a real surge (40 cameras) does not render as 40 separate items', () => {
    const alerts = Array.from({ length: 40 }, (_, i) =>
      makeAlert({ id: `surge${i}`, cameraId: `cam-${i}`, zoneId: 'zone-surge', severity: 'CRITICAL' }),
    );
    const items = dedupAlerts(alerts);
    expect(items.length).toBeLessThan(5);
  });

  it('storm severity reflects the worst alert in the group', () => {
    const alerts = [
      ...Array.from({ length: STORM_THRESHOLD - 1 }, (_, i) => makeAlert({ id: `w${i}`, zoneId: 'zone-x', severity: 'WARNING' })),
      makeAlert({ id: 'critical-one', zoneId: 'zone-x', severity: 'CRITICAL' }),
    ];
    const items = dedupAlerts(alerts);
    expect(items[0]!.kind).toBe('storm');
    if (items[0]!.kind === 'storm') {
      expect(items[0]!.worstSeverity).toBe('CRITICAL');
    }
  });

  it('sorts CRITICAL items/groups ahead of WARNING ones', () => {
    const alerts = [
      makeAlert({ id: 'w1', zoneId: 'zone-a', severity: 'WARNING', raisedAt: '2026-01-01T00:00:00Z' }),
      makeAlert({ id: 'c1', zoneId: 'zone-b', severity: 'CRITICAL', raisedAt: '2026-01-01T00:00:01Z' }),
    ];
    const items = dedupAlerts(alerts);
    expect(items[0]!.kind).toBe('single');
    if (items[0]!.kind === 'single') {
      expect(items[0]!.alert.severity).toBe('CRITICAL');
    }
  });
});
