// Procedural train-horn synthesizer.
//
// Two-note minor-third chord (~D3 + F3) with sawtooth oscillators run through
// a lowpass to round off the buzz — a serviceable diesel-locomotive horn
// without sample assets. Real horns add a third pitch and slight detune
// chorusing; this is a deliberately simple approximation.
//
// Envelope: 120ms attack, ~1.2s sustain, 500ms release. The full honk lasts
// roughly 1.8s, long enough to read as a horn rather than a beep.
//
// honk() is idempotent within HONK_LENGTH_S — a second call while a honk is
// still ringing is dropped. updateAuto(proximity) fires on the rising edge of
// `proximity >= AUTO_THRESHOLD` (with cooldown), so the horn sounds *once* as
// the train enters a tunnel approach zone, not continuously.

import { AudioSystem } from './audioSystem';

// Pitches: D3 (146.83Hz) + F3 (174.61Hz) — minor third, classic diesel horn.
const PITCH_LOW_HZ = 146.83;
const PITCH_HIGH_HZ = 174.61;

const HONK_LENGTH_S = 1.8;
const ATTACK_S = 0.12;
const RELEASE_S = 0.5;
// Sustain gain per oscillator. Two oscs sum, so total ≈ 0.30 at master.
const OSC_SUSTAIN_GAIN = 0.15;

const AUTO_THRESHOLD = 0.15;       // proximity at which approach honk fires
const AUTO_COOLDOWN_S = 8;         // min seconds between auto honks
const MANUAL_COOLDOWN_S = 0.5;     // brief debounce only — user-initiated

export class Horn {
  private lastHonkTime = -Infinity;
  private prevProximity = 0;

  constructor(private readonly audio: AudioSystem) {}

  /**
   * Manually trigger a honk (e.g., H key). Debounced by MANUAL_COOLDOWN_S
   * so a held key doesn't stack honks on top of each other.
   */
  honk(): void {
    if (!this.audio.isReady()) return;
    const ctx = this.audio.ctx;
    if (!ctx) return;
    if (ctx.currentTime - this.lastHonkTime < MANUAL_COOLDOWN_S) return;
    this.fire();
  }

  /**
   * Per-frame call. Pass smoothed approach proximity (0..1). Fires once on
   * rising edge across AUTO_THRESHOLD, then waits AUTO_COOLDOWN_S before it
   * can re-trigger — this prevents repeated honks in/near a tunnel where
   * proximity hovers around the threshold.
   */
  updateAuto(proximity: number): void {
    const wasBelow = this.prevProximity < AUTO_THRESHOLD;
    const nowAbove = proximity >= AUTO_THRESHOLD;
    this.prevProximity = proximity;

    if (!wasBelow || !nowAbove) return;
    if (!this.audio.isReady()) return;
    const ctx = this.audio.ctx;
    if (!ctx) return;
    if (ctx.currentTime - this.lastHonkTime < AUTO_COOLDOWN_S) return;
    this.fire();
  }

  private fire(): void {
    const ctx = this.audio.ctx;
    const dest = this.audio.masterGain;
    if (!ctx || !dest) return;

    const when = ctx.currentTime;
    this.lastHonkTime = when;

    // Lowpass smooths the sawtooth's buzz into a brass-like tone.
    // 1.5kHz cutoff keeps presence without harshness.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.7;

    // Master envelope on a single bus — both oscillators ride the same
    // attack/release shape, simpler than per-osc envelopes.
    const busGain = ctx.createGain();
    busGain.gain.setValueAtTime(0, when);
    busGain.gain.linearRampToValueAtTime(1, when + ATTACK_S);
    busGain.gain.setValueAtTime(1, when + HONK_LENGTH_S - RELEASE_S);
    busGain.gain.linearRampToValueAtTime(0, when + HONK_LENGTH_S);

    filter.connect(busGain).connect(dest);

    const startOsc = (freq: number, detuneCents: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;
      const g = ctx.createGain();
      g.gain.value = OSC_SUSTAIN_GAIN;
      osc.connect(g).connect(filter);
      osc.start(when);
      osc.stop(when + HONK_LENGTH_S + 0.05);
      osc.onended = (): void => {
        osc.disconnect();
        g.disconnect();
      };
      return osc;
    };

    // Slight detune (±5 cents) gives a gentle chorus, more lifelike than
    // two perfectly-tuned sawtooths beating against each other.
    startOsc(PITCH_LOW_HZ, -5);
    startOsc(PITCH_HIGH_HZ, +5);

    // Tear down the shared filter+busGain after release.
    setTimeout(() => {
      filter.disconnect();
      busGain.disconnect();
    }, (HONK_LENGTH_S + 0.1) * 1000);
  }
}
