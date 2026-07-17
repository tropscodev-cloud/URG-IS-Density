import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthBootstrap } from '@/features/auth/useAuthBootstrap';
import { useSessionStore } from '@/lib/state/sessionStore';
import { useThemeSync } from '@/lib/ui/useThemeSync';
import { LoginRoute } from '@/routes/LoginRoute';
import { ShellRoute } from '@/routes/ShellRoute';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ErrorBoundary } from '@/app-shell/ErrorBoundary';

export function App(): React.JSX.Element {
  useAuthBootstrap();
  useThemeSync();
  const hydrated = useSessionStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
      </div>
    );
  }

  return (
    <ErrorBoundary name="Application">
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/app/*"
          element={
            <ProtectedRoute>
              <ShellRoute />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
