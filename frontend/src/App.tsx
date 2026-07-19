import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthBootstrap } from '@/features/auth/useAuthBootstrap';
import { useSessionStore } from '@/lib/state/sessionStore';
import { useThemeSync } from '@/lib/ui/useThemeSync';
import { LoginRoute } from '@/routes/LoginRoute';
import { ShellRoute } from '@/routes/ShellRoute';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/app-shell/AppShell';
import { HomePage } from '@/features/home/HomePage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
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
        {/* Legacy path from before the /, /map, /analytics tab split — kept as a redirect so any
            bookmarked or externally-linked /app URL still lands somewhere valid. */}
        <Route path="/app/*" element={<Navigate to="/map" replace />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/map/*" element={<ShellRoute />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
