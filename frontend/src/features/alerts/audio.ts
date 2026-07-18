import { useUiStore } from '@/lib/state/uiStore';

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Two-tone alert cue via the Web Audio API — no binary asset files needed. Respects mute. */
export function playCriticalAlertCue(): void {
  if (useUiStore.getState().alertSoundMuted) return;
  try {
    const audioCtx = getContext();
    const now = audioCtx.currentTime;
    for (const [offset, freq] of [
      [0, 880],
      [0.18, 1046.5],
    ] as const) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    }
  } catch {
    // Audio unavailable (autoplay policy, unsupported browser) — visual/toast alerting still
    // fires regardless, so this is a soft failure.
  }
}
