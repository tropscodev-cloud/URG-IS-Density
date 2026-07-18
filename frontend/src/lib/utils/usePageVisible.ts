import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function getSnapshot(): boolean {
  return document.visibilityState !== 'hidden';
}

/** Tracks `document.visibilityState` so polling/interval-driven queries can pause in background
 *  tabs and resume immediately (not just on their next scheduled tick) when the tab is shown. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
