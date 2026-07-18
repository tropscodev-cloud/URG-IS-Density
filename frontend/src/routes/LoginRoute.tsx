import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@/lib/state/sessionStore';
import { LoginPage } from '@/features/auth/LoginPage';

export function LoginRoute(): React.JSX.Element {
  const user = useSessionStore((s) => s.user);
  if (user) return <Navigate to="/app" replace />;
  return <LoginPage />;
}
