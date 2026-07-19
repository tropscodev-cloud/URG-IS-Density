import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  /** Small inline element between the title and the chevron — e.g. an alert-count badge. */
  badge?: React.ReactNode;
  /** Rendered as a sibling of the toggle button, not inside it — e.g. a settings icon-button that
   *  opens its own popover. Kept out of the toggle button because buttons can't nest buttons. */
  headerExtra?: React.ReactNode;
  /** True for the section that should absorb remaining vertical space when expanded (the camera
   *  list) — false/omitted sections size to their own natural content height only. */
  grow?: boolean;
  children: React.ReactNode;
}

/**
 * One rounded card in the sidebar's top-level accordion (Search & Filters / Cameras / Legend).
 * `children` is always mounted — collapsing animates a CSS grid row to zero height rather than
 * conditionally rendering, so a virtualized list inside stays mounted (scroll position, internal
 * state) even while a *different* section is toggled or this one is collapsed and re-expanded.
 */
export function AccordionSection({ title, expanded, onToggle, badge, headerExtra, grow, children }: Props): React.JSX.Element {
  return (
    <div
      className={clsx(
        'flex flex-col overflow-hidden rounded-xl bg-bg-card',
        grow && (expanded ? 'min-h-0 flex-1' : 'flex-none'),
      )}
    >
      <div className="flex h-11 shrink-0 items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 px-4 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-scrim/[0.04]"
        >
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg-primary">{title}</span>
          {badge}
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)]"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          />
        </button>
        {headerExtra && <div className="shrink-0 pr-2">{headerExtra}</div>}
      </div>
      <div className={clsx('accordion-grid', expanded && 'is-expanded', grow && expanded && 'min-h-0 flex-1')}>
        <div className={clsx(grow && 'flex h-full flex-col')}>{children}</div>
      </div>
    </div>
  );
}
