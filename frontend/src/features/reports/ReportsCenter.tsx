import { useState } from 'react';
import { X, FileBarChart } from 'lucide-react';
import clsx from 'clsx';
import { NewReportForm } from './NewReportForm';
import { MyReportsList } from './MyReportsList';
import { ReportViewer } from './ReportViewer';
import { ScheduledDigests } from './ScheduledDigests';
import { RoleGate } from '@/features/auth/RoleGate';
import { Portal } from '@/lib/ui/Portal';

interface Props {
  onClose: () => void;
}

type Tab = 'new' | 'mine' | 'schedules';

export function ReportsCenter({ onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('new');
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);

  return (
    <Portal>
      {/* pointer-events-none on the wrapper, re-enabled per child — an empty div still
          intercepts hit-testing across its whole `inset-0` box even with no visible background,
          which would swallow clicks on the icon rail otherwise (same pattern TopBar.tsx uses). */}
      <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Reports">
        {/* Backdrop — dims but never hides the map/shell behind it, unlike the previous
            full-screen takeover. Click to close, matching EventLogDrawer's existing pattern.
            left-12, not inset-0 — must not cover the icon rail (w-12), or its buttons become
            unclickable while a panel is open, defeating "click a different rail icon to switch
            panels" (mutual exclusivity is otherwise handled in ShellLayout's openPanel state). */}
        <button
          type="button"
          aria-label="Close reports"
          onClick={onClose}
          className="pointer-events-auto absolute inset-y-0 left-12 right-0 bg-black/40"
        />
        <div
          className="pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-border bg-bg-surface shadow-2xl motion-safe:animate-[slide-in-right_var(--motion-slow)_var(--ease-standard)]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <FileBarChart className="h-4 w-4 text-accent" aria-hidden="true" />
              <h1 className="text-sm font-semibold text-fg-primary">Reports</h1>
            </div>
            <button type="button" onClick={onClose} aria-label="Close reports" className="rounded p-1.5 text-fg-muted hover:bg-bg-raised">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* One stacked card per the sidebar's own rounded-card / hairline-border language. */}
            <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-hairline/[0.07] bg-bg-card">
              <div className="flex gap-1 border-b border-hairline/[0.07] px-3 pt-2">
                <TabButton active={tab === 'new'} onClick={() => setTab('new')}>
                  New report
                </TabButton>
                <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
                  My reports
                </TabButton>
                <RoleGate permission="scheduleReports">
                  <TabButton active={tab === 'schedules'} onClick={() => setTab('schedules')}>
                    Scheduled digests
                  </TabButton>
                </RoleGate>
              </div>

              <div className="card-scroll min-h-0 flex-1 overflow-y-auto">
                {tab === 'new' && (
                  <NewReportForm
                    onGenerated={(jobId) => {
                      setViewingJobId(jobId);
                      setTab('mine');
                    }}
                  />
                )}
                {tab === 'mine' && (
                  <div className="flex h-full">
                    <div className="w-64 shrink-0 border-r border-hairline/[0.07]">
                      <MyReportsList onView={setViewingJobId} />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {viewingJobId ? (
                        <ReportViewer jobId={viewingJobId} />
                      ) : (
                        <p className="p-4 text-xs text-fg-muted">Select a completed report to view it.</p>
                      )}
                    </div>
                  </div>
                )}
                {tab === 'schedules' && <ScheduledDigests />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-t-md border-x border-t px-3 py-1.5 text-xs transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        active ? 'border-hairline/[0.07] bg-bg-surface text-fg-primary' : 'border-transparent text-fg-muted hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  );
}
