import * as THREE from 'three';
import type { AudioEngine } from './AudioEngine';

export interface AmbienceConfig {
  wind: number;
  insects: number;
  birds: number;
  frogs: number;
  drips: number;
  /** Positional water emitters: river points & waterfalls. */
  water: { pos: THREE.Vector3; gain: number; kind: 'river' | 'falls' }[];
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Layered procedural environment: wind bed with gusts, insect shimmer, dusk crickets,
 * scheduled bird calls around the listener, frogs, rain drips, and positional water.
 */
export class Ambience {
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private cfg: AmbienceConfig | null = null;
  private nextBird = 0;
  private nextDrip = 0;
  private nextCricket = 0;
  private nextFrog = 0;
  private windGain: GainNode | null = null;
  private listenerPos = new THREE.Vector3();
  /** 0..1 extra wind (e.g. on the ridge). */
  exposure = 0;

  constructor(private a: AudioEngine) {}

  start(cfg: AmbienceConfig): void {
    this.stop();
    this.cfg = cfg;
    this.a.whenReady(() => this.build());
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.sources = [];
    this.windGain = null;
  }

  private build(): void {
    const ctx = this.a.ctx!;
    const cfg = this.cfg!;
    const bus = this.a.buses.ambience;
    const t = ctx.currentTime;

    // Wind bed: brown noise through a slowly wandering lowpass, plus gust LFO.
    {
      const src = this.a.noiseSource('brown');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 220;
      lfo.connect(lfoG).connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.32 * cfg.wind;
      const gust = ctx.createOscillator();
      gust.frequency.value = 0.043;
      const gustG = ctx.createGain();
      gustG.gain.value = 0.12 * cfg.wind;
      gust.connect(gustG).connect(g.gain);
      src.connect(lp).connect(g).connect(bus);
      lfo.start(t);
      gust.start(t);
      this.windGain = g;
      this.sources.push(src, lfo, gust);
      this.nodes.push(lp, lfoG, g, gustG);
      // Leaves rustle (high band) modulated by the same gusts.
      const hs = this.a.noiseSource('pink');
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const hg = ctx.createGain();
      hg.gain.value = 0.05 * cfg.wind;
      gustG.connect(hg.gain);
      hs.connect(hp).connect(hg).connect(bus);
      this.sources.push(hs);
      this.nodes.push(hp, hg);
    }

    // Insect shimmer: two narrow bands with fast amplitude modulation.
    for (const [freq, rate, amp] of [
      [4600, 13, 0.03],
      [7200, 21, 0.018],
    ] as const) {
      const src = this.a.noiseSource('pink');
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 8;
      const g = ctx.createGain();
      g.gain.value = amp * cfg.insects;
      const am = ctx.createOscillator();
      am.frequency.value = rate;
      const amG = ctx.createGain();
      amG.gain.value = amp * cfg.insects * 0.8;
      am.connect(amG).connect(g.gain);
      src.connect(bp).connect(g).connect(bus);
      am.start(t);
      this.sources.push(src, am);
      this.nodes.push(bp, g, amG);
    }

    // Water emitters
    for (const w of cfg.water) {
      const pan = this.a.panner(w.pos, 'ambience', w.kind === 'falls' ? 8 : 4, w.kind === 'falls' ? 0.9 : 1.3, 300);
      const src = this.a.noiseSource(w.kind === 'falls' ? 'white' : 'pink');
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = w.kind === 'falls' ? 2600 : 1100;
      const g = ctx.createGain();
      g.gain.value = w.gain;
      src.connect(f).connect(g).connect(pan);
      this.sources.push(src);
      this.nodes.push(f, g, pan);
      if (w.kind === 'falls') {
        const r = this.a.noiseSource('brown');
        const rl = ctx.createBiquadFilter();
        rl.type = 'lowpass';
        rl.frequency.value = 200;
        const rg = ctx.createGain();
        rg.gain.value = w.gain * 1.2;
        r.connect(rl).connect(rg).connect(pan);
        this.sources.push(r);
        this.nodes.push(rl, rg);
      } else {
        // Babble: bandpass sweeping.
        const b = this.a.noiseSource('white');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1400;
        bp.Q.value = 3;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.9 + Math.random();
        const lg = ctx.createGain();
        lg.gain.value = 500;
        lfo.connect(lg).connect(bp.frequency);
        const bg = ctx.createGain();
        bg.gain.value = w.gain * 0.25;
        b.connect(bp).connect(bg).connect(pan);
        lfo.start();
        this.sources.push(b, lfo);
        this.nodes.push(bp, lg, bg);
      }
    }
    this.nextBird = t + 1;
    this.nextDrip = t + 0.5;
    this.nextCricket = t + 2;
    this.nextFrog = t + 3;
  }

  update(listener: THREE.Vector3): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.cfg || ctx.state !== 'running') return;
    this.listenerPos.copy(listener);
    const t = ctx.currentTime;
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.32 * this.cfg.wind * (1 + this.exposure * 1.2), t, 1.5);
    if (t > this.nextBird && this.cfg.birds > 0) {
      this.bird();
      this.nextBird = t + rnd(2.5, 7) / this.cfg.birds;
    }
    if (t > this.nextDrip && this.cfg.drips > 0) {
      this.drip();
      this.nextDrip = t + rnd(0.15, 1.2) / this.cfg.drips;
    }
    if (t > this.nextCricket && this.cfg.insects > 0) {
      this.cricket();
      this.nextCricket = t + rnd(0.8, 2.5);
    }
    if (t > this.nextFrog && this.cfg.frogs > 0) {
      this.frog();
      this.nextFrog = t + rnd(1.5, 5) / this.cfg.frogs;
    }
  }

  private around(minR: number, maxR: number, yMin = 2, yMax = 12): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(minR, maxR);
    return new THREE.Vector3(this.listenerPos.x + Math.cos(a) * r, this.listenerPos.y + rnd(yMin, yMax), this.listenerPos.z + Math.sin(a) * r);
  }

  private bird(): void {
    const ctx = this.a.ctx!;
    const pan = this.a.panner(this.around(12, 45), 'ambience', 6, 1.1);
    const species = Math.floor(Math.random() * 3);
    const t0 = ctx.currentTime + 0.02;
    const notes = species === 0 ? 3 + Math.floor(Math.random() * 3) : species === 1 ? 2 : 1;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t0 + i * (species === 0 ? 0.14 : 0.42);
      if (species === 0) {
        // Bright whistled trill
        o.frequency.setValueAtTime(rnd(2600, 3200), at);
        o.frequency.exponentialRampToValueAtTime(rnd(3400, 4200), at + 0.09);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.05, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      } else if (species === 1) {
        // Dusk dove-like low call
        o.frequency.setValueAtTime(rnd(560, 640), at);
        o.frequency.linearRampToValueAtTime(rnd(480, 520), at + 0.35);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.06, at + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
      } else {
        // Long descending whistle
        o.frequency.setValueAtTime(rnd(3000, 3600), at);
        o.frequency.exponentialRampToValueAtTime(rnd(1400, 1800), at + 0.7);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.035, at + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
      }
      o.connect(g).connect(pan);
      const rv = ctx.createGain();
      rv.gain.value = 0.35;
      g.connect(rv).connect(this.a.reverbSend);
      o.start(at);
      o.stop(at + 0.8);
    }
  }

  private drip(): void {
    const ctx = this.a.ctx!;
    const pan = this.a.panner(this.around(1.5, 8, 0, 3), 'ambience', 2, 1.5);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime + 0.01;
    const f = rnd(1100, 2300);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03 * (this.cfg?.drips ?? 1), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.08);
  }

  private cricket(): void {
    const ctx = this.a.ctx!;
    const pan = this.a.panner(this.around(4, 18, -1, 1), 'ambience', 3, 1.2);
    const t0 = ctx.currentTime + 0.01;
    const f = rnd(4200, 5200);
    const chirps = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < chirps; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t0 + i * 0.065;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.012 * (this.cfg?.insects ?? 1), at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + 0.05);
    }
  }

  private frog(): void {
    const ctx = this.a.ctx!;
    const pan = this.a.panner(this.around(8, 30, -1, 0.5), 'ambience', 4, 1.2);
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rnd(500, 900);
    f.Q.value = 4;
    const g = ctx.createGain();
    o.frequency.setValueAtTime(rnd(90, 140), t);
    const pulses = 2 + Math.floor(Math.random() * 3);
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < pulses; i++) {
      g.gain.exponentialRampToValueAtTime(0.03, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.09);
    }
    o.connect(f).connect(g).connect(pan);
    o.start(t);
    o.stop(t + pulses * 0.12 + 0.1);
  }
}
