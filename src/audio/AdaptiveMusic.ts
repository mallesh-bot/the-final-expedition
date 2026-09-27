import type { AudioEngine } from './AudioEngine';

export type Mood = 'silent' | 'title' | 'explore' | 'tension' | 'wonder';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Original generative score: modal progression around D dorian.
const CHORDS: number[][] = [
  [50, 57, 60, 64, 69], // Dm9-ish (D A C E A)
  [46, 53, 57, 62, 65], // Bbmaj7 (Bb F A D F)
  [41, 48, 55, 60, 64], // Fmaj9 (F C G C E)
  [48, 55, 57, 62, 67], // C6/9 (C G A D G)
];
const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];
// Title motif (original).
const MOTIF = [74, 69, 72, 76, 74, 69, 67, 69];

/**
 * Layered generative music: pad bed (chord cycle), bell arpeggio "wonder" layer, and a
 * low pulse "tension" layer. Moods crossfade layer gains.
 */
export class AdaptiveMusic {
  private started = false;
  private padGain!: GainNode;
  private bellGain!: GainNode;
  private tensionGain!: GainNode;
  private titleGain!: GainNode;
  private filter!: BiquadFilterNode;
  private chord = 0;
  private nextChord = 0;
  private nextBell = 0;
  private nextMotif = 0;
  private motifIdx = 0;
  private mood: Mood = 'silent';
  private voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private pulse: OscillatorNode | null = null;

  constructor(private a: AudioEngine) {}

  private build(): void {
    const ctx = this.a.ctx!;
    const bus = this.a.buses.music;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 0.4;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.filter).connect(bus);
    const padRev = ctx.createGain();
    padRev.gain.value = 0.6;
    this.filter.connect(padRev).connect(this.a.reverbSend);
    this.bellGain = ctx.createGain();
    this.bellGain.gain.value = 0;
    this.bellGain.connect(bus);
    const bellRev = ctx.createGain();
    bellRev.gain.value = 1.2;
    this.bellGain.connect(bellRev).connect(this.a.reverbSend);
    this.titleGain = ctx.createGain();
    this.titleGain.gain.value = 0;
    this.titleGain.connect(bus);
    const titleRev = ctx.createGain();
    titleRev.gain.value = 1.4;
    this.titleGain.connect(titleRev).connect(this.a.reverbSend);
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(bus);
    // Tension: low sine with slow pulsing + dissonant high partial.
    const p = ctx.createOscillator();
    p.frequency.value = midi(38);
    const pg = ctx.createGain();
    pg.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.35;
    const lg = ctx.createGain();
    lg.gain.value = 0.3;
    lfo.connect(lg).connect(pg.gain);
    p.connect(pg).connect(this.tensionGain);
    const d = ctx.createOscillator();
    d.type = 'triangle';
    d.frequency.value = midi(75);
    const dg = ctx.createGain();
    dg.gain.value = 0.02;
    d.connect(dg).connect(this.tensionGain);
    p.start();
    lfo.start();
    d.start();
    this.pulse = p;
    this.started = true;
    this.nextChord = ctx.currentTime;
  }

  setMood(m: Mood, fade = 3): void {
    this.mood = m;
    this.a.whenReady(() => {
      if (!this.started) this.build();
      const t = this.a.ctx!.currentTime;
      const tc = fade / 3;
      const pad = m === 'silent' ? 0 : m === 'tension' ? 0.08 : m === 'title' ? 0.11 : 0.1;
      const bell = m === 'wonder' ? 0.12 : m === 'explore' ? 0.035 : m === 'title' ? 0.02 : 0;
      const ten = m === 'tension' ? 0.28 : 0;
      const title = m === 'title' ? 0.1 : 0;
      this.padGain.gain.setTargetAtTime(pad, t, tc);
      this.bellGain.gain.setTargetAtTime(bell, t, tc);
      this.tensionGain.gain.setTargetAtTime(ten, t, tc);
      this.titleGain.gain.setTargetAtTime(title, t, tc);
      this.filter.frequency.setTargetAtTime(m === 'wonder' ? 1800 : m === 'tension' ? 600 : 1000, t, tc);
    });
  }

  get currentMood(): Mood {
    return this.mood;
  }

  update(): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.started || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t >= this.nextChord - 0.05) {
      this.playChord(CHORDS[this.chord % CHORDS.length], t, 9.5);
      this.chord++;
      this.nextChord = t + 8;
    }
    if (t >= this.nextBell && (this.mood === 'wonder' || this.mood === 'explore' || this.mood === 'title')) {
      const n = SCALE[Math.floor(Math.random() * SCALE.length)];
      this.bell(midi(n), t, this.bellGain, 0.5);
      if (Math.random() < 0.4) this.bell(midi(n + 7), t + 0.35, this.bellGain, 0.3);
      this.nextBell = t + (this.mood === 'wonder' ? 0.9 + Math.random() * 1.4 : 2.5 + Math.random() * 4);
    }
    if (this.mood === 'title' && t >= this.nextMotif) {
      const n = MOTIF[this.motifIdx % MOTIF.length];
      this.bell(midi(n), t, this.titleGain, 0.9);
      this.motifIdx++;
      this.nextMotif = t + (this.motifIdx % MOTIF.length === 0 ? 5 : this.motifIdx % 2 ? 0.9 : 1.3);
    }
  }

  private playChord(notes: number[], t: number, dur: number): void {
    const ctx = this.a.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 2.8);
    g.gain.setValueAtTime(0.14, t + dur - 3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.padGain);
    const osc: OscillatorNode[] = [];
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
        osc.push(o);
      }
    }
    this.voices.push({ osc, gain: g });
    if (this.voices.length > 4) this.voices.shift();
  }

  private bell(freq: number, t: number, dest: GainNode, amp: number): void {
    const ctx = this.a.ctx!;
    for (const [ratio, a, d] of [
      [1, 1, 2.8],
      [2.76, 0.35, 1.2],
      [5.4, 0.12, 0.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 * a * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  dispose(): void {
    this.pulse?.stop();
  }
}
