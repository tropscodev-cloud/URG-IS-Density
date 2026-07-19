import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { ErrorBoundary } from './ErrorBoundary';
import { EventLogDrawer } from './EventLogDrawer';
import { MapSplitView } from '@/features/map/MapSplitView';
import { AddCameraModal } from '@/features/cameras/AddCameraModal';
import { AlertTray } from '@/features/alerts/AlertTray';
import { Timeline } from '@/features/timeline/Timeline';
import { ChatWidget } from '@/features/chatbot/ChatWidget';
import { AuditQueueBanner } from '@/features/audit/AuditQueueBanner';
import { AuditConsole } from '@/features/audit/AuditConsole';
import { ReportsCenter } from '@/features/reports/ReportsCenter';
import { KioskMode } from '@/features/kiosk/KioskMode';
import { useUiStore } from '@/lib/state/uiStore';

export type PanelKind = 'audit' | 'reports' | 'eventlog' | null;

/** The /map tab's content. WsBridge/ToastHost/idle-session chrome now live in AppShell (the
 *  app-root layout, mounted once for every tab) — this component owns only what's specific to
 *  the operator console itself. */
export function ShellLayout(): React.JSX.Element {
  const [addCameraOpen, setAddCameraOpen] = useState(false);
  // Audit/Reports/Event log are mutually exclusive right-docked slide-overs — one state, not
  // three independent booleans, so opening one always closes another rather than letting them
  // stack on top of each other (a real, observed overlap bug in the previous full-screen-takeover
  // design, which also hid the map entirely while any of them was open).
  const [openPanel, setOpenPanel] = useState<PanelKind>(null);
  const kioskMode = useUiStore((s) => s.kioskMode);
  const setKioskMode = useUiStore((s) => s.setKioskMode);

  if (kioskMode) {
    return (
      <ErrorBoundary name="Kiosk mode" autoRecoverMs={5000}>
        <KioskMode onExit={() => setKioskMode(false)} />
      </ErrorBoundary>
    );
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-bg-canvas">
      <ErrorBoundary name="Icon rail" compact>
        <IconRail openPanel={openPanel} onOpenPanel={(panel) => setOpenPanel((cur) => (cur === panel ? null : panel))} />
      </ErrorBoundary>

      <ErrorBoundary name="Camera list">
        <Sidebar onAddCamera={() => setAddCameraOpen(true)} />
      </ErrorBoundary>

      <div className="relative min-w-0 flex-1">
        <ErrorBoundary name="Map">
          <MapSplitView />
        </ErrorBoundary>
        <TopBar />
        <AuditQueueBanner />
        <AlertTray />
        <Timeline />
        <ChatWidget />
      </div>

      <ErrorBoundary name="Detail panel">
        <RightPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Audit console" compact>
        {openPanel === 'audit' && <AuditConsole onClose={() => setOpenPanel(null)} />}
      </ErrorBoundary>
      <ErrorBoundary name="Reports" compact>
        {openPanel === 'reports' && <ReportsCenter onClose={() => setOpenPanel(null)} />}
      </ErrorBoundary>
      <EventLogDrawer open={openPanel === 'eventlog'} onClose={() => setOpenPanel(null)} />

      {addCameraOpen && <AddCameraModal onClose={() => setAddCameraOpen(false)} />}
    </div>
  );
}
