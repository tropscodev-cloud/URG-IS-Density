import { useEffect } from 'react';
import { useUiStore } from '@/lib/state/uiStore';

/**
 * Keeps `<html data-theme>` in sync with the persisted theme preference. The initial value is
 * already applied synchronously by an inline script in index.html (to avoid a flash of the wrong
 * theme before React mounts) — this only needs to handle changes after that, i.e. the toggle.
 */
export function useThemeSync(): void {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
