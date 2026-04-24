// Lightweight WebAudio singleton wrapper.
//
// Why a wrapper at all: the AudioContext can't legally be constructed before
// the first user gesture (browser autoplay policy), but the rest of the engine
// instantiates audio-using objects (Horn) at startup. This class lets those
// objects hold a stable reference and check `isReady()` per frame without
// juggling null contexts everywhere.
//
// Mute is a soft 50ms gain ramp on the master gain rather than `ctx.suspend()`
// so we keep oscillators alive (no rescheduling churn) and avoid the click
// that an instantaneous gain step would produce.

const DEFAULT_MASTER_GAIN = 0.7;
const MUTE_RAMP_SECONDS = 0.05;

export class AudioSystem {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;
  enabled = false;
  muted = false;

  private enablePromise: Promise<void> | null = null;

  /**
   * Create the AudioContext on first call. Idempotent: subsequent calls
   * return the same in-flight (or completed) promise. Must be invoked from a
   * user-gesture handler; if the context starts in `suspended` state we
   * resume it here.
   */
  enable(): Promise<void> {
    if (this.enablePromise) return this.enablePromise;

    this.enablePromise = (async () => {
      // Safari still needs the prefixed constructor as a fallback.
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        // No WebAudio at all — leave enabled=false; consumers will skip.
        return;
      }
      const ctx = new Ctor();
      const masterGain = ctx.createGain();
      masterGain.gain.value = this.muted ? 0 : DEFAULT_MASTER_GAIN;
      masterGain.connect(ctx.destination);

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // resume() can reject if the gesture was lost; we'll still mark
          // enabled and let isReady() reflect the actual ctx.state.
        }
      }

      this.ctx = ctx;
      this.masterGain = masterGain;
      this.enabled = true;
    })();

    return this.enablePromise;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx || !this.masterGain) return;
    const target = m ? 0 : DEFAULT_MASTER_GAIN;
    const now = this.ctx.currentTime;
    // cancelScheduledValues + linearRampToValueAtTime is the reliable
    // click-free way to interrupt a previous ramp mid-flight.
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS);
  }

  isReady(): boolean {
    return (
      this.enabled &&
      !this.muted &&
      this.ctx !== null &&
      this.ctx.state === 'running' &&
      this.masterGain !== null
    );
  }
}

export const audio = new AudioSystem();
