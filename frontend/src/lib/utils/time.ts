import { formatInTimeZone } from 'date-fns-tz';

export const DEPARTMENT_TZ = import.meta.env.VITE_DEPARTMENT_TZ || 'UTC';

/** Short zone label for display, e.g. "EST" / "EDT" — always shown alongside local times. */
export function departmentZoneLabel(atMs: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: DEPARTMENT_TZ, timeZoneName: 'short' }).formatToParts(
      new Date(atMs),
    );
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? DEPARTMENT_TZ;
  } catch {
    return DEPARTMENT_TZ;
  }
}

export function formatLocal(iso: string | number, pattern = 'MMM d, yyyy HH:mm:ss'): string {
  const date = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  return formatInTimeZone(date, DEPARTMENT_TZ, pattern);
}

export function formatLocalWithZone(iso: string | number, pattern = 'MMM d, yyyy HH:mm:ss'): string {
  return `${formatLocal(iso, pattern)} ${departmentZoneLabel(typeof iso === 'number' ? iso : Date.parse(iso))}`;
}

export function formatClock(iso: string | number): string {
  return formatLocal(iso, 'HH:mm:ss');
}

export function formatUtcClock(iso: string | number = Date.now()): string {
  const date = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  return `${date.toISOString().slice(11, 19)} UTC`;
}

export function secondsAgo(iso: string | null, nowMs: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
}

export function relativeAge(iso: string | null, nowMs: number = Date.now()): string {
  const s = secondsAgo(iso, nowMs);
  if (s === null) return 'never';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
