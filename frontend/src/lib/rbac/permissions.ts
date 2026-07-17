import type { Role } from '@/types';

const ROLE_ORDER: Role[] = ['VIEWER', 'OPERATOR', 'SUPERVISOR', 'ADMIN'];

/**
 * Single source of truth for role gating. Mirrored server-side (the real backend is assumed to
 * re-enforce every one of these) — this map only controls what the UI shows. See SECURITY.md.
 */
export const PERMISSIONS = {
  viewMap: 'VIEWER',
  ackAlertWarning: 'OPERATOR',
  ackAlertCritical: 'OPERATOR',
  bulkAckAlerts: 'SUPERVISOR',
  resolveEscalateAlert: 'OPERATOR',
  multiSelect: 'OPERATOR',
  generateReports: 'OPERATOR',
  exportEvidenceBundle: 'OPERATOR',
  manageCameras: 'SUPERVISOR',
  tuneThresholds: 'SUPERVISOR',
  kioskMode: 'SUPERVISOR',
  scheduleReports: 'SUPERVISOR',
  userManagementView: 'ADMIN',
  auditConsole: 'ADMIN',
  retentionSettings: 'ADMIN',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(PERMISSIONS[permission]);
}

export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min);
}

export { ROLE_ORDER };
