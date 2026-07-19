import { NavLink } from 'react-router-dom';
import { Home, Map, BarChart3 } from 'lucide-react';
import clsx from 'clsx';

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/map', label: 'Operator Console', icon: Map, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
] as const;

/** Far-left top-level tab rail (Home / Operator Console / Analytics) — persists across the app,
 *  distinct from IconRail (which is /map-console-specific: Reports/Audit/Event log/Kiosk). Hidden
 *  entirely in kiosk mode by the AppShell that renders this, for a true chromeless takeover. */
export function TabNav(): React.JSX.Element {
  return (
    <nav
      aria-label="Main sections"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-surface py-3"
    >
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          title={label}
          className={({ isActive }) =>
            clsx(
              'flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[9px] font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
              isActive ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-scrim/[0.06] hover:text-fg-primary',
            )
          }
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label === 'Operator Console' ? 'Console' : label}
        </NavLink>
      ))}
    </nav>
  );
}
