import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getWsManager } from '@/lib/ws/WebSocketManager';
import { useSessionStore } from '@/lib/state/sessionStore';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useUiStore } from '@/lib/state/uiStore';
import { toast, updateToast } from '@/lib/state/toastStore';
import { playCriticalAlertCue } from '@/features/alerts/audio';
import { queryKeys } from '@/lib/api/queryClient';
import type { Camera, Paginated, Zone } from '@/types';

/** A burst of this many-or-more CRITICAL alerts within the window collapses into one summary
 *  toast instead of stacking individual ones — the mock's ambient simulation (and scripted
 *  storm scenarios) can legitimately raise a dozen-plus real alerts within seconds of each
 *  other, and one toast per camera was unusable. */
const BURST_THRESHOLD = 3;
const BURST_WINDOW_MS = 10_000;
const SINGLE_TOAST_DISMISS_MS = 8_000;

interface SummaryToastState {
  toastId: string;
  windowStart: number;
  count: number;
  zoneNames: Set<string>;
}

/**
 * The single bridge between the outside-React WebSocketManager and TanStack Query's cache.
 * Mounted once for the lifetime of an authenticated session. Subscribes to 'global' (all camera
 * status/removal) and 'alerts' — per-camera metric topics are subscribed by whichever component
 * actually needs them (camera detail panel, map), and torn down when that component unmounts.
 */
export function WsBridge(): null {
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const locked = useSessionStore((s) => s.locked);

  // Refs, not state — this is pure bookkeeping for toast presentation, not something that should
  // itself trigger a render (WsBridge renders nothing). Persists for the component's mounted
  // lifetime (the session), reset naturally on remount.
  const toastedAlertIdsRef = useRef<Set<string>>(new Set());
  const summaryRef = useRef<SummaryToastState | null>(null);
  const recentCriticalTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!user || locked) return;
    const manager = getWsManager();
    manager.connect();
    const unsubTopics = manager.subscribeTopics(['global', 'alerts']);

    const unsubStatus = manager.subscribeStatus((evt) => {
      queryClient.setQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((c) =>
            c.id === evt.cameraId ? { ...c, status: evt.status, reconnectAttempts: evt.reconnectAttempts ?? 0 } : c,
          ),
        };
      });
      queryClient.setQueryData<Camera>(queryKeys.camera(evt.cameraId), (old) =>
        old ? { ...old, status: evt.status, reconnectAttempts: evt.reconnectAttempts ?? 0 } : old,
      );
    });

    const unsubRemoved = manager.subscribeRemoved((evt) => {
      queryClient.setQueriesData<Paginated<Camera>>({ queryKey: ['cameras'], exact: false }, (old) =>
        old ? { ...old, items: old.items.filter((c) => c.id !== evt.cameraId) } : old,
      );
      const selection = useSelectionStore.getState();
      if (selection.cameraId === evt.cameraId) {
        selection.clearSelection();
        toast({
          severity: 'warning',
          title: 'Camera removed',
          message: `This camera was ${evt.reason} by another operator. The panel has been closed.`,
        });
      }
    });

    const unsubAlerts = manager.subscribeAlerts((evt) => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      if (evt.event !== 'raised' || evt.alert.severity !== 'CRITICAL') return;

      // Dedup at the source: never toast the same alert.id twice. The engine itself only emits
      // 'raised' once per new alert (see server/src/sim/thresholds.ts), but a resync replay after
      // a reconnect, or any other path that re-delivers an already-seen message, must not produce
      // a second toast for it.
      if (toastedAlertIdsRef.current.has(evt.alert.id)) return;
      toastedAlertIdsRef.current.add(evt.alert.id);
      playCriticalAlertCue();

      const zones = queryClient.getQueryData<Paginated<Zone>>(queryKeys.zones);
      const zoneName = zones?.items.find((z) => z.id === evt.alert.zoneId)?.name ?? evt.alert.zoneId;
      const cameras = queryClient.getQueryData<Paginated<Camera>>(queryKeys.cameras());
      const cameraName = cameras?.items.find((c) => c.id === evt.alert.cameraId)?.name;

      const now = Date.now();
      const summary = summaryRef.current;

      // Already mid-burst: fold this alert into the existing summary toast instead of adding a
      // new one, and extend the window so a sustained storm keeps collapsing rather than spawning
      // a fresh summary every 10s.
      if (summary && now - summary.windowStart < BURST_WINDOW_MS) {
        summary.count += 1;
        summary.zoneNames.add(zoneName);
        summary.windowStart = now;
        updateToast(summary.toastId, {
          title: `${summary.count} CRITICAL alerts across ${summary.zoneNames.size} zone${summary.zoneNames.size === 1 ? '' : 's'}`,
        });
        return;
      }

      // Not currently summarizing — check whether this alert is part of a fresh burst by counting
      // how many CRITICALs have fired in the last BURST_WINDOW_MS, this one included.
      recentCriticalTimestampsRef.current = recentCriticalTimestampsRef.current.filter((t) => now - t < BURST_WINDOW_MS);
      recentCriticalTimestampsRef.current.push(now);

      if (recentCriticalTimestampsRef.current.length >= BURST_THRESHOLD) {
        const toastId = toast({
          severity: 'critical',
          title: `${recentCriticalTimestampsRef.current.length} CRITICAL alerts across 1 zone`,
          message: 'Click to view the alert tray.',
          actionLabel: 'View alert tray',
          onAction: () => useUiStore.getState().setAlertTrayExpanded(true),
          autoDismissMs: null,
        });
        summaryRef.current = {
          toastId,
          windowStart: now,
          count: recentCriticalTimestampsRef.current.length,
          zoneNames: new Set([zoneName]),
        };
        return;
      }

      // Seeded camera names already embed their zone ("Kotilingala Ghat / Saraswati Ghat 22"),
      // so appending "in <zone>" for those reads as an awkward, fully-redundant repeat; only
      // cameras whose name doesn't already carry the zone (e.g. bulk-imported ones) need it
      // spelled out separately.
      const location = cameraName?.startsWith(zoneName) ? cameraName : `${cameraName ?? 'A camera'} in ${zoneName}`;
      toast({
        severity: 'critical',
        title: 'CRITICAL density alert',
        message: `${location} breached threshold (${(evt.alert.observedValue * 100).toFixed(0)}%).`,
        autoDismissMs: SINGLE_TOAST_DISMISS_MS,
      });
    });

    return () => {
      unsubStatus();
      unsubRemoved();
      unsubAlerts();
      unsubTopics();
      manager.disconnect();
    };
  }, [queryClient, user, locked]);

  return null;
}
