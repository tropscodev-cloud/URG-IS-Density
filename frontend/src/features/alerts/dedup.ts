import type { Alert, AlertSeverity } from '@/types';

export interface StormGroup {
  kind: 'storm';
  zoneId: string;
  alerts: Alert[];
  worstSeverity: AlertSeverity;
}

export interface SingleItem {
  kind: 'single';
  alert: Alert;
}

export type AlertListItem = StormGroup | SingleItem;

/** Cameras alerting simultaneously in one zone at/above this count collapse into one card —
 * a real surge (40 cameras) must never render as 40 separate rows/toasts. */
export const STORM_THRESHOLD = 6;

function severityRank(s: AlertSeverity): number {
  return s === 'CRITICAL' ? 2 : s === 'WARNING' ? 1 : 0;
}

function worstOf(alerts: Alert[]): AlertSeverity {
  return alerts.reduce<AlertSeverity>((worst, a) => (severityRank(a.severity) > severityRank(worst) ? a.severity : worst), 'INFO');
}

export function dedupAlerts(alerts: Alert[]): AlertListItem[] {
  const byZone = new Map<string, Alert[]>();
  for (const a of alerts) {
    const list = byZone.get(a.zoneId) ?? [];
    list.push(a);
    byZone.set(a.zoneId, list);
  }

  const items: AlertListItem[] = [];
  for (const [zoneId, zoneAlerts] of byZone.entries()) {
    if (zoneAlerts.length >= STORM_THRESHOLD) {
      items.push({ kind: 'storm', zoneId, alerts: zoneAlerts, worstSeverity: worstOf(zoneAlerts) });
    } else {
      for (const alert of zoneAlerts) items.push({ kind: 'single', alert });
    }
  }

  return items.sort((a, b) => {
    const rankA = severityRank(a.kind === 'storm' ? a.worstSeverity : a.alert.severity);
    const rankB = severityRank(b.kind === 'storm' ? b.worstSeverity : b.alert.severity);
    if (rankA !== rankB) return rankB - rankA;
    const tA = a.kind === 'storm' ? Math.max(...a.alerts.map((x) => Date.parse(x.raisedAt))) : Date.parse(a.alert.raisedAt);
    const tB = b.kind === 'storm' ? Math.max(...b.alerts.map((x) => Date.parse(x.raisedAt))) : Date.parse(b.alert.raisedAt);
    return tB - tA;
  });
}
