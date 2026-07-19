import { useEffect, useRef, useState } from 'react';
import { Loader2, WifiOff, AlertTriangle, PictureInPicture2, RotateCw, Radio, History } from 'lucide-react';
import clsx from 'clsx';
import { streamGovernor } from '@/lib/video/StreamGovernor';
import { SyntheticFeedRenderer } from './SyntheticFeedRenderer';
import { useUiStore } from '@/lib/state/uiStore';
import { formatLocalWithZone } from '@/lib/utils/time';
import { useClock } from '@/lib/utils/useClock';
import type { Camera, CameraMetrics } from '@/types';

type PlayerState = 'offline' | 'governed' | 'connecting' | 'buffering' | 'live' | 'error' | 'historical';

const OFFLINE_STATUSES = new Set(['OFFLINE', 'DISABLED', 'MISCONFIGURED', 'RECONNECTING']);
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;

/** Seeded cameras on the real inference backend map to actual footage files it serves statically
 *  under /data — every other camera (added later via the UI) has no backing file, so it keeps
 *  using the synthetic canvas renderer below. Detections (metrics.entities) are in the pipeline's
 *  640x480 processing-frame space; the <video> uses object-fit:fill so a plain fractional scale
 *  lines the overlay boxes up with the real detections regardless of the source file's native
 *  resolution or the box's rendered size. */
const REAL_FOOTAGE_BY_CAMERA_ID: Record<string, string> = {
  CAM_001: '/data/cam1_web.mp4',
  CAM_002: '/data/cam2_web.mp4',
  CAM_003: '/data/cam3_web.mp4',
};
const YOLO_FRAME_WIDTH = 640;
const YOLO_FRAME_HEIGHT = 480;

interface Props {
  camera: Camera;
  metrics: CameraMetrics | null;
  /** True while the operator is scrubbing time-travel — must never show a "live"/"buffering" feed. */
  isHistorical?: boolean;
}

export function VideoPlayer({ camera, metrics, isHistorical = false }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const rendererRef = useRef<SyntheticFeedRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [state, setState] = useState<PlayerState>('connecting');
  const [reconnectInS, setReconnectInS] = useState(0);
  const [videoErrored, setVideoErrored] = useState(false);

  const showBoxes = useUiStore((s) => s.boundingBoxOverlayEnabled);
  const showConfidence = useUiStore((s) => s.confidenceOverlayEnabled);
  const toggleBoxes = useUiStore((s) => s.toggleBoundingBoxOverlay);
  const toggleConfidence = useUiStore((s) => s.toggleConfidenceOverlay);

  const isOfflineStatus = OFFLINE_STATUSES.has(camera.status);
  const realFootageSrc = REAL_FOOTAGE_BY_CAMERA_ID[camera.id];
  const hasRealFootage = !!realFootageSrc;
  const clockNow = useClock();

  const drawFrame = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!rendererRef.current) rendererRef.current = new SyntheticFeedRenderer(camera.id.charCodeAt(4) || 1);
    rendererRef.current.render(ctx, canvas.width, canvas.height, {
      cameraName: camera.name,
      headcount: metrics?.headcount ?? 0,
      showBoxes,
      showConfidence,
      nowIso: formatLocalWithZone(Date.now(), 'HH:mm:ss'),
    });
  };

  /** Draws real YOLO detection boxes (metrics.entities) over the real <video>, scaled from the
   *  pipeline's 640x480 processing frame to the canvas's actual rendered size. */
  const drawOverlay = (): void => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!showBoxes) return;
    for (const ent of metrics?.entities ?? []) {
      const [ex, ey, ew, eh] = ent.bbox;
      const x = (ex / YOLO_FRAME_WIDTH) * w;
      const y = (ey / YOLO_FRAME_HEIGHT) * h;
      const bw = (ew / YOLO_FRAME_WIDTH) * w;
      const bh = (eh / YOLO_FRAME_HEIGHT) * h;
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, bw, bh);
      if (showConfidence) {
        ctx.fillStyle = 'rgba(56,189,248,0.9)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(ent.confidence.toFixed(2), x, y - 3);
      }
    }
  };

  const renderFrame = hasRealFootage ? drawOverlay : drawFrame;

  // The backend's own CPU YOLO inference runs far slower than the source video's real framerate
  // (see vision_pipeline.py) — a freely-playing <video> would drift well ahead of whatever frame
  // the current boxes were actually detected on. Each detection instead carries the exact source
  // position it came from (sourceVideoTimeS); rather than let the video free-run, drive it to that
  // position directly so what's on screen always matches what the boxes were computed from.
  useEffect(() => {
    if (!hasRealFootage) return;
    const video = videoRef.current;
    const target = metrics?.sourceVideoTimeS;
    if (!video || target === undefined) return;
    const seek = (): void => {
      const dur = video.duration;
      const clamped = Number.isFinite(dur) && dur > 0 ? Math.min(target, Math.max(0, dur - 0.05)) : target;
      if (Math.abs(video.currentTime - clamped) > 0.02) video.currentTime = clamped;
      video.pause();
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }, [hasRealFootage, metrics?.sourceVideoTimeS]);

  // Rolling-median smoothing for the quick-glance headcount badge only (the HEADCOUNT metric tile
  // elsewhere shows the raw instantaneous reading) — a couple of frames with an occluded/missed
  // detection can make the raw count swing sharply between otherwise-similar scenes.
  const headcountBufferRef = useRef<number[]>([]);
  const [smoothedHeadcount, setSmoothedHeadcount] = useState<number | null>(null);
  useEffect(() => {
    headcountBufferRef.current = [];
    setSmoothedHeadcount(null);
  }, [camera.id]);
  useEffect(() => {
    if (metrics?.headcount === undefined) return;
    const buf = headcountBufferRef.current;
    buf.push(metrics.headcount);
    if (buf.length > 5) buf.shift();
    const sorted = [...buf].sort((a, b) => a - b);
    setSmoothedHeadcount(sorted[Math.floor(sorted.length / 2)] ?? null);
  }, [metrics?.headcount]);

  // Time-travel: freeze on a single snapshot frame at the scrubbed-to metrics — must never enter
  // the live connect/buffer/live loop below, which would show a "Buffering…"/"live" feed for a
  // moment the operator is deliberately looking at in the past.
  useEffect(() => {
    if (!isHistorical) return;
    setState('historical');
    const t = setTimeout(renderFrame, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHistorical, camera.id, metrics?.ts]);

  // Offline: draw one static "last snapshot" frame, no live loop.
  useEffect(() => {
    if (isHistorical || !isOfflineStatus) return;
    setState('offline');
    const t = setTimeout(renderFrame, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHistorical, isOfflineStatus, camera.id]);

  // Online: acquire a governor slot, run the connect → buffer → live lifecycle.
  useEffect(() => {
    if (isHistorical || isOfflineStatus) return;

    let cancelled = false;
    const connect = (): void => {
      if (cancelled) return;
      const granted = streamGovernor.requestSlot(camera.id);
      if (!granted) {
        setState('governed');
        return;
      }
      setState('connecting');
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        setState('buffering');
        timerRef.current = setTimeout(() => {
          if (cancelled) return;
          reconnectAttemptRef.current = 0;
          setState('live');
        }, 250 + Math.random() * 450);
      }, 400 + Math.random() * 800);
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      streamGovernor.releaseSlot(camera.id);
    };
  }, [isOfflineStatus, camera.id]);

  // Live: rAF render loop + small chance of a simulated transient stream error.
  useEffect(() => {
    if (state !== 'live') return;
    let mounted = true;
    let lastErrorCheck = performance.now();

    const loop = (): void => {
      if (!mounted) return;
      renderFrame();
      const now = performance.now();
      if (now - lastErrorCheck > 1000) {
        lastErrorCheck = now;
        if (Math.random() < 0.01) {
          setState('error');
          return;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      mounted = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, showBoxes, showConfidence, metrics?.headcount, metrics?.entities]);

  // Error: auto-reconnect with exponential backoff + jitter.
  useEffect(() => {
    if (state !== 'error') return;
    streamGovernor.releaseSlot(camera.id);
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** reconnectAttemptRef.current);
    const jittered = delay * (0.5 + Math.random() * 0.5);
    reconnectAttemptRef.current += 1;
    let remaining = Math.ceil(jittered / 1000);
    setReconnectInS(remaining);
    const interval = setInterval(() => {
      remaining -= 1;
      setReconnectInS(Math.max(0, remaining));
    }, 1000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setState('connecting');
      const granted = streamGovernor.requestSlot(camera.id);
      if (granted) {
        timerRef.current = setTimeout(() => setState('buffering'), 300);
      } else {
        setState('governed');
      }
    }, jittered);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, camera.id]);

  async function handlePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (hasRealFootage) {
        await videoRef.current?.requestPictureInPicture();
        return;
      }
      const canvas = canvasRef.current;
      const hiddenVideo = hiddenVideoRef.current;
      if (!canvas || !hiddenVideo) return;
      const captureStream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(15);
      hiddenVideo.srcObject = captureStream;
      await hiddenVideo.play();
      await hiddenVideo.requestPictureInPicture();
    } catch {
      // PiP unsupported in this browser — non-fatal, the inline player still works.
    }
  }

  function manualRetry(): void {
    reconnectAttemptRef.current = 0;
    setState('connecting');
    const granted = streamGovernor.requestSlot(camera.id);
    if (granted) timerRef.current = setTimeout(() => setState('buffering'), 300);
    else setState('governed');
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-black">
      {hasRealFootage ? (
        <>
          {!videoErrored && (
            <video
              ref={videoRef}
              src={realFootageSrc}
              muted
              playsInline
              preload="auto"
              onError={() => setVideoErrored(true)}
              className="block aspect-video w-full object-fill"
            />
          )}
          <canvas
            ref={overlayCanvasRef}
            className={clsx('absolute inset-0 h-full w-full', videoErrored && 'relative aspect-video')}
          />
          {videoErrored && (
            <p className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/60">
              Raw feed codec unsupported by this browser — showing live detections only
            </p>
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-2 py-1 font-mono text-[11px] text-white/75">
            <span>{camera.name}</span>
            <span>{formatLocalWithZone(clockNow, 'HH:mm:ss')}</span>
          </div>
        </>
      ) : (
        <canvas ref={canvasRef} width={480} height={270} className="block w-full" />
      )}
      <video ref={hiddenVideoRef} muted playsInline className="hidden" />

      {state === 'historical' && (
        <Overlay icon={History} tone="text-accent">
          <p className="text-sm font-medium">Historical snapshot</p>
          <p className="text-xs text-white/60">
            {metrics ? `As of ${formatLocalWithZone(metrics.ts)} — not a live feed` : 'No data at this point in time'}
          </p>
        </Overlay>
      )}
      {state === 'offline' && (
        <Overlay icon={WifiOff} tone="text-status-offline">
          <p className="text-sm font-medium">Camera offline</p>
          <p className="text-xs text-white/60">
            {camera.status === 'RECONNECTING'
              ? `Backend reconnect attempt #${camera.reconnectAttempts}`
              : `Last snapshot — ${camera.lastSeenAt ? formatLocalWithZone(camera.lastSeenAt) : 'never'}`}
          </p>
        </Overlay>
      )}
      {state === 'governed' && (
        <Overlay icon={Radio} tone="text-severity-warning">
          <p className="text-sm font-medium">Live view limit reached</p>
          <p className="mb-2 text-xs text-white/60">
            {streamGovernor.getActiveCount()}/{streamGovernor.getMax()} concurrent live streams in use. Showing a snapshot
            (refreshes every 5s).
          </p>
          <button
            type="button"
            onClick={manualRetry}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:brightness-110"
          >
            Go live
          </button>
        </Overlay>
      )}
      {(state === 'connecting' || state === 'buffering') && (
        <Overlay icon={Loader2} tone="text-accent" spin>
          <p className="text-sm font-medium">{state === 'connecting' ? 'Connecting…' : 'Buffering…'}</p>
        </Overlay>
      )}
      {state === 'error' && (
        <Overlay icon={AlertTriangle} tone="text-severity-critical">
          <p className="text-sm font-medium">Stream error</p>
          <p className="mb-2 text-xs text-white/60">Reconnecting in {reconnectInS}s…</p>
          <button
            type="button"
            onClick={manualRetry}
            className="flex items-center gap-1.5 rounded-md border border-white/30 px-2.5 py-1 text-xs text-white hover:bg-white/10"
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            Retry now
          </button>
        </Overlay>
      )}

      <div className="absolute bottom-1.5 right-1.5 flex gap-1">
        <button
          type="button"
          onClick={toggleBoxes}
          aria-pressed={showBoxes}
          className={clsx('rounded px-1.5 py-0.5 text-[10px]', showBoxes ? 'bg-accent text-accent-fg' : 'bg-black/60 text-white/70 hover:bg-black/80')}
        >
          Boxes
        </button>
        <button
          type="button"
          onClick={toggleConfidence}
          aria-pressed={showConfidence}
          className={clsx('rounded px-1.5 py-0.5 text-[10px]', showConfidence ? 'bg-accent text-accent-fg' : 'bg-black/60 text-white/70 hover:bg-black/80')}
        >
          Confidence
        </button>
        <span
          className="flex items-center rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/70"
          title="Live headcount (5-frame rolling median)"
        >
          {(smoothedHeadcount ?? metrics?.headcount ?? 0).toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => void handlePip()}
          title="Pop out (Picture-in-Picture)"
          className="rounded bg-black/60 p-1 text-white/70 hover:bg-black/80"
        >
          <PictureInPicture2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function Overlay({
  icon: Icon,
  tone,
  spin,
  children,
}: {
  icon: typeof Loader2;
  tone: string;
  spin?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 p-4 text-center text-white">
      <Icon className={clsx('mb-1 h-6 w-6', tone, spin && 'animate-spin')} aria-hidden="true" />
      {children}
    </div>
  );
}
