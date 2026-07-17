const MAX_CONCURRENT = Number(import.meta.env.VITE_MAX_CONCURRENT_STREAMS ?? 6);

type Listener = () => void;

/**
 * App-wide cap on simultaneous live video decoders. Mirrors the real constraint of decoding
 * WebRTC/LL-HLS streams — a command-center wall or an operator with many panels open must not
 * silently degrade the browser by decoding unlimited concurrent video.
 */
class StreamGovernor {
  private active = new Set<string>();
  private listeners = new Set<Listener>();

  requestSlot(cameraId: string): boolean {
    if (this.active.has(cameraId)) return true;
    if (this.active.size >= MAX_CONCURRENT) return false;
    this.active.add(cameraId);
    this.notify();
    return true;
  }

  releaseSlot(cameraId: string): void {
    if (this.active.delete(cameraId)) this.notify();
  }

  isActive(cameraId: string): boolean {
    return this.active.has(cameraId);
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getMax(): number {
    return MAX_CONCURRENT;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

export const streamGovernor = new StreamGovernor();
