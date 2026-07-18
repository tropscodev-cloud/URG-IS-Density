import { useEffect } from 'react';
import { Sun, Moon, Grid2x2, FileBarChart, ScrollText, Bell } from 'lucide-react';
import clsx from 'clsx';
import { useUiStore } from '@/lib/state/uiStore';
import { useToastStore } from '@/lib/state/toastStore';
import { RoleGate } from '@/features/auth/RoleGate';
import { useHasPermission } from '@/features/auth/RoleGate';
import type { PanelKind } from './ShellLayout';

interface Props {
  openPanel: PanelKind;
  onOpenPanel: (panel: Exclude<PanelKind, null>) => void;
}

/**
 * Far-left vertical rail for consoles (Reports/Audit/Event log/Kiosk/Theme) — these are opened
 * deliberately and infrequently, unlike the top bar's glanceable live status, so they don't
 * belong crammed into the same row (that combination was overflowing/wrapping in practice).
 */
export function IconRail({ openPanel, onOpenPanel }: Props): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const kioskMode = useUiStore((s) => s.kioskMode);
  const setKioskMode = useUiStore((s) => s.setKioskMode);
  const unreadCount = useToastStore((s) => s.eventLog.filter((t) => !t.read).length);
  const markLogRead = useToastStore((s) => s.markLogRead);
  const canKiosk = useHasPermission('kioskMode');
  const canReports = useHasPermission('generateReports');
  const canAudit = useHasPermission('auditConsole');

  // Single-key shortcuts for the rail's own actions — ignored while typing in any editable
  // element so they never fight the search box, note fields, filters, etc.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      switch (e.key.toLowerCase()) {
        case 't':
          setTheme(theme === 'dark' ? 'light' : 'dark');
          break;
        case 'k':
          if (canKiosk) setKioskMode(!kioskMode);
          break;
        case 'r':
          if (canReports) onOpenPanel('reports');
          break;
        case 'a':
          if (canAudit) onOpenPanel('audit');
          break;
        case 'e':
          onOpenPanel('eventlog');
          markLogRead();
          break;
        default:
          return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [theme, setTheme, kioskMode, setKioskMode, canKiosk, canReports, canAudit, onOpenPanel, markLogRead]);

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-surface py-2">
      <RailButton
        icon={theme === 'dark' ? Sun : Moon}
        active={false}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        shortcut="T"
      />
      <RoleGate permission="kioskMode">
        <RailButton
          icon={Grid2x2}
          active={kioskMode}
          onClick={() => setKioskMode(!kioskMode)}
          label="Toggle kiosk / video-wall mode"
          shortcut="K"
        />
      </RoleGate>

      <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />

      <RoleGate permission="generateReports">
        <RailButton icon={FileBarChart} active={openPanel === 'reports'} onClick={() => onOpenPanel('reports')} label="Reports" shortcut="R" />
      </RoleGate>
      <RoleGate permission="auditConsole">
        <RailButton icon={ScrollText} active={openPanel === 'audit'} onClick={() => onOpenPanel('audit')} label="Audit console" shortcut="A" />
      </RoleGate>
      <RailButton
        icon={Bell}
        active={openPanel === 'eventlog'}
        onClick={() => {
          onOpenPanel('eventlog');
          markLogRead();
        }}
        label="Event log"
        shortcut="E"
        badge={unreadCount > 0 ? unreadCount : undefined}
      />
    </div>
  );
}

function RailButton({
  icon: Icon,
  active,
  onClick,
  label,
  shortcut,
  badge,
}: {
  icon: typeof Sun;
  active: boolean;
  onClick: () => void;
  label: string;
  shortcut: string;
  badge?: number;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={`${label} (${shortcut})`}
      className={clsx(
        'relative rounded-md p-2 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        active ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-scrim/[0.06] hover:text-fg-primary',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {badge !== undefined && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-severity-critical px-0.5 text-[9px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
