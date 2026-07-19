import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WsBridge } from '@/features/realtime/WsBridge';
import { AnalyticsRecorder } from '@/features/analytics/AnalyticsRecorder';
import { IdleSessionManager } from '@/features/auth/IdleSessionManager';
import { IdleWarningModal } from '@/features/auth/IdleWarningModal';
import { StepUpModal } from '@/features/auth/StepUpModal';
import { ToastHost } from './ToastHost';
import { TabNav } from './TabNav';
import { useUiStore } from '@/lib/state/uiStore';

/**
 * Persistent app-root layout for every authenticated route (/, /map, /analytics). Session-wide
 * singletons — the WebSocket bridge chief among them — live here, mounted exactly once, so
 * switching tabs never tears down and reopens the connection (each tab's content is just a
 * different <Outlet /> child, not a different mount of the whole app).
 */
export function AppShell(): React.JSX.Element {
  const kioskMode = useUiStore((s) => s.kioskMode);
  const setLastTab = useUiStore((s) => s.setLastTab);
  const location = useLocation();

  useEffect(() => {
    const top = '/' + (location.pathname.split('/')[1] ?? '');
    setLastTab(top === '/' ? '/' : top);
  }, [location.pathname, setLastTab]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-bg-canvas">
      <WsBridge />
      <AnalyticsRecorder />
      <IdleSessionManager />
      {!kioskMode && <TabNav />}
      <div className="relative min-w-0 flex-1">
        <Outlet />
      </div>
      <ToastHost />
      <IdleWarningModal />
      <StepUpModal />
    </div>
  );
}
