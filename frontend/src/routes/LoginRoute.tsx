import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@/lib/state/sessionStore';
import { useUiStore } from '@/lib/state/uiStore';
import { LoginPage } from '@/features/auth/LoginPage';

export function LoginRoute(): React.JSX.Element {
  const user = useSessionStore((s) => s.user);
  const lastTab = useUiStore((s) => s.lastTab);
  if (user) return <Navigate to={lastTab || '/'} replace />;
  return <LoginPage />;
}
