import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSessionStore } from '@/lib/state/sessionStore';
import { LockScreen } from '@/features/auth/LockScreen';
import { hasPermission, type Permission } from '@/lib/rbac/permissions';

interface Props {
  children: ReactNode;
  permission?: Permission;
}

export function ProtectedRoute({ children, permission }: Props): React.JSX.Element {
  const user = useSessionStore((s) => s.user);
  const locked = useSessionStore((s) => s.locked);

  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(user.role, permission)) return <Navigate to="/" replace />;

  return (
    <>
      {children}
      {locked && <LockScreen />}
    </>
  );
}
