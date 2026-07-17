import type { ReactNode } from 'react';
import { useSessionStore } from '@/lib/state/sessionStore';
import { hasPermission, type Permission } from '@/lib/rbac/permissions';

export function useHasPermission(permission: Permission): boolean {
  const role = useSessionStore((s) => s.user?.role);
  return hasPermission(role, permission);
}

interface RoleGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Hides (never merely disables) actions the current role lacks — see SECURITY.md. */
export function RoleGate({ permission, children, fallback = null }: RoleGateProps): React.JSX.Element {
  const allowed = useHasPermission(permission);
  return <>{allowed ? children : fallback}</>;
}
