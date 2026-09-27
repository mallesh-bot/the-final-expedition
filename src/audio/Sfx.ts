import type * as THREE from 'three';
import type { AudioEngine, Bus } from './AudioEngine';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** One-shot synthesized sound effects. */
export class Sfx {
  constructor(private a: AudioEngine) {}

  private get ok(): boolean {
    return this.a.ctx !== null;
  }

  /** Filtered noise burst with an ADSR-ish envelope. */
  private burst(opts: {
    kind?: 'white' | 'pink' | 'brown';
    type?: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
    attack?: number;
    decay: number;
    at?: number;
    dest?: AudioNode;
    bus?: Bus;
    sweepTo?: number;
    reverb?: number;
  }): void {
    const ctx = this.a.ctx!;
    const t = (opts.at ?? ctx.currentTime) + 0.001;
    const src = ctx.createBufferSource();
    src.buffer = this.a.noise[opts.kind ?? 'white'];
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + (opts.attack ?? 0.003) + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack ?? 0.003) + opts.decay);
    src.connect(f).connect(g);
    g.connect(opts.dest ?? this.a.buses[opts.bus ?? 'sfx']);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      g.connect(s).connect(this.a.reverbSend);
    }
    src.start(t, Math.random() * 3);
    src.stop(t + (opts.attack ?? 0.003) + opts.decay + 0.05);
  }

  private tone(opts: {
    type?: OscillatorType;
    freq: number;
    to?: number;
    gain: number;
    attack?: number;
    decay: number;
    at?: number;
    dest?: AudioNode;
    bus?: Bus;
    reverb?: number;
  }): void {
    const ctx = this.a.ctx!;
    const t = (opts.at ?? ctx.currentTime) + 0.001;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.attack ?? 0.005) + opts.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack ?? 0.005) + opts.decay);
    o.connect(g).connect(opts.dest ?? this.a.buses[opts.bus ?? 'sfx']);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      g.connect(s).connect(this.a.reverbSend);
    }
    o.start(t);
    o.stop(t + (opts.attack ?? 0.005) + opts.decay + 0.05);
  }

  footstep(surface: string, intensity: number): void {
    if (!this.ok) return;
    const g = 0.12 + intensity * 0.22;
    switch (surface) {
      case 'stone':
        this.burst({ freq: rnd(1600, 2400), q: 1.8, gain: g * 0.7, decay: 0.05 });
        this.tone({ freq: rnd(110, 140), to: 60, gain: g * 0.4, decay: 0.06 });
        break;
      case 'wood':
        this.tone({ type: 'triangle', freq: rnd(210, 260), to: 120, gain: g * 0.6, decay: 0.09 });
        this.burst({ freq: 900, q: 2, gain: g * 0.3, decay: 0.05 });
        break;
      case 'grass':
      case 'leaves':
        this.burst({ type: 'highpass', freq: rnd(1800, 2600), gain: g * 0.45, attack: 0.01, decay: 0.12 });
        this.tone({ freq: 90, to: 50, gain: g * 0.3, decay: 0.07 });
        break;
      case 'mud':
        this.burst({ kind: 'pink', type: 'lowpass', freq: rnd(500, 700), sweepTo: 250, gain: g * 0.9, attack: 0.01, decay: 0.14 });
        break;
      case 'water':
        this.burst({ freq: rnd(900, 1400), q: 0.8, gain: g * 0.8, attack: 0.01, decay: 0.2, sweepTo: 500 });
        break;
      default:
        this.burst({ kind: 'pink', freq: rnd(380, 520), q: 1.1, gain: g * 0.9, decay: 0.08 });
        this.tone({ freq: rnd(80, 100), to: 45, gain: g * 0.45, decay: 0.07 });
    }
  }

  climbGrab(kind: string): void {
    if (!this.ok) return;
    this.burst({ type: 'highpass', freq: 1400, gain: 0.12, attack: 0.01, decay: 0.09 });
    this.burst({ freq: rnd(2500, 3500), q: 3, gain: 0.08, decay: 0.03, at: this.a.now() + 0.02 });
    if (kind === 'ledge' || kind === 'climb-up' || kind === 'vault') {
      this.tone({ freq: 160, to: 70, gain: 0.25, decay: 0.08 });
      this.burst({ kind: 'pink', freq: 600, gain: 0.18, decay: 0.12 });
    }
    if (Math.random() < 0.25) this.pebbles();
  }

  pebbles(): void {
    if (!this.ok) return;
    const t = this.a.now();
    for (let i = 0; i < 4; i++) this.burst({ freq: rnd(2500, 5000), q: 6, gain: rnd(0.02, 0.05), decay: 0.02, at: t + 0.15 + i * rnd(0.06, 0.14), reverb: 0.3 });
  }

  land(height: number): void {
    if (!this.ok) return;
    const g = Math.min(0.6, 0.15 + height * 0.06);
    this.tone({ freq: 90, to: 38, gain: g, decay: 0.18 });
    this.burst({ kind: 'pink', freq: 450, gain: g * 0.8, decay: 0.16 });
    this.burst({ type: 'highpass', freq: 2000, gain: g * 0.3, attack: 0.01, decay: 0.2 });
  }

  /** Stone-on-stone grinding (drum rotation, doors). Positional if pos given. */
  stoneGrind(duration: number, pos?: THREE.Vector3, gain = 0.5): void {
    if (!this.ok) return;
    const ctx = this.a.ctx!;
    const t = ctx.currentTime;
    const dest = pos ? this.a.panner(pos, 'sfx', 3, 1) : this.a.buses.sfx;
    const src = this.a.noiseSource('brown');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(180, t);
    for (let i = 0; i < 8; i++) bp.frequency.linearRampToValueAtTime(rnd(120, 320), t + (duration * (i + 1)) / 8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.12);
    g.gain.setValueAtTime(gain, t + duration - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(g).connect(dest);
    const s2 = this.a.noiseSource('white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2400;
    hp.Q.value = 0.7;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(gain * 0.12, t + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    s2.connect(hp).connect(g2).connect(dest);
    src.stop(t + duration + 0.1);
    s2.stop(t + duration + 0.1);
    const rv = ctx.createGain();
    rv.gain.value = 0.25;
    g.connect(rv).connect(this.a.reverbSend);
  }

  clunk(pos?: THREE.Vector3, gain = 0.6): void {
    if (!this.ok) return;
    const dest = pos ? this.a.panner(pos, 'sfx', 3, 1) : undefined;
    this.tone({ freq: 70, to: 35, gain, decay: 0.45, dest, reverb: 0.4 });
    this.burst({ kind: 'pink', freq: 800, gain: gain * 0.5, decay: 0.08, dest });
    this.burst({ freq: 3000, q: 4, gain: gain * 0.15, decay: 0.03, dest });
  }

  /** Big mechanism: long rumble, grinding, debris. */
  rumble(duration: number, pos?: THREE.Vector3, gain = 0.8): void {
    if (!this.ok) return;
    const ctx = this.a.ctx!;
    const t = ctx.currentTime;
    const dest = pos ? this.a.panner(pos, 'sfx', 10, 0.6, 400) : this.a.buses.sfx;
    const src = this.a.noiseSource('brown');
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 1.2);
    g.gain.setValueAtTime(gain, t + duration - 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(lp).connect(g).connect(dest);
    src.stop(t + duration + 0.1);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(34, t);
    o.frequency.linearRampToValueAtTime(42, t + duration);
    const olp = ctx.createBiquadFilter();
    olp.type = 'lowpass';
    olp.frequency.value = 90;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(gain * 0.5, t + 1.5);
    og.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(olp).connect(og).connect(dest);
    o.start(t);
    o.stop(t + duration + 0.1);
    this.stoneGrind(duration * 0.9, pos, gain * 0.6);
    for (let i = 0; i < 18; i++) {
      const at = t + rnd(0.3, duration - 0.3);
      this.burst({ kind: 'pink', freq: rnd(300, 1500), q: 2, gain: rnd(0.05, 0.16), decay: rnd(0.04, 0.12), at, dest, reverb: 0.4 });
    }
    const rv = ctx.createGain();
    rv.gain.value = 0.5;
    g.connect(rv).connect(this.a.reverbSend);
  }

  pickup(): void {
    if (!this.ok) return;
    const t = this.a.now();
    this.tone({ freq: 880, gain: 0.12, attack: 0.01, decay: 1.2, bus: 'ui', reverb: 0.5, at: t });
    this.tone({ freq: 1318.5, gain: 0.07, attack: 0.01, decay: 1.4, bus: 'ui', reverb: 0.5, at: t + 0.08 });
    this.tone({ freq: 1760, gain: 0.04, attack: 0.01, decay: 1.6, bus: 'ui', reverb: 0.5, at: t + 0.16 });
  }

  checkpoint(): void {
    if (!this.ok) return;
    const t = this.a.now();
    this.tone({ type: 'triangle', freq: 587.3, gain: 0.05, attack: 0.02, decay: 0.9, bus: 'ui', reverb: 0.6, at: t });
    this.tone({ type: 'triangle', freq: 880, gain: 0.04, attack: 0.02, decay: 1.2, bus: 'ui', reverb: 0.6, at: t + 0.12 });
  }

  radio(): void {
    if (!this.ok) return;
    this.burst({ freq: 2200, q: 1.5, gain: 0.05, decay: 0.12, bus: 'ui' });
    this.tone({ type: 'square', freq: 1150, gain: 0.015, decay: 0.05, bus: 'ui' });
  }

  uiHover(): void {
    if (!this.ok) return;
    this.tone({ freq: 1600, gain: 0.025, decay: 0.035, bus: 'ui' });
  }

  uiClick(): void {
    if (!this.ok) return;
    this.tone({ type: 'triangle', freq: 660, to: 990, gain: 0.07, decay: 0.12, bus: 'ui', reverb: 0.2 });
  }

  whoosh(gain = 0.2): void {
    if (!this.ok) return;
    this.burst({ kind: 'pink', type: 'bandpass', freq: 300, sweepTo: 1800, q: 0.8, gain, attack: 0.25, decay: 0.5 });
  }

  impact(pos?: THREE.Vector3, gain = 0.5): void {
    if (!this.ok) return;
    const dest = pos ? this.a.panner(pos, 'sfx', 5, 1) : undefined;
    this.tone({ freq: 60, to: 30, gain, decay: 0.5, dest, reverb: 0.5 });
    this.burst({ kind: 'pink', freq: 500, gain: gain * 0.7, decay: 0.25, dest, reverb: 0.4 });
  }
}
