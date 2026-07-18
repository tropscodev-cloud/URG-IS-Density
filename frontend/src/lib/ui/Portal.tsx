import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders children into document.body, escaping any ancestor's positioned/z-indexed stacking
 * context. Full-screen overlays (modals, consoles) nested inside other positioned components
 * (e.g. the floating TopBar) would otherwise be capped by that ancestor's stacking context
 * regardless of their own z-index — this is the general fix, not a one-off z-index bump.
 */
export function Portal({ children }: { children: ReactNode }): React.JSX.Element {
  return createPortal(children, document.body);
}
