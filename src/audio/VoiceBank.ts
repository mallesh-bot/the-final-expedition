import type { AudioEngine } from './AudioEngine';
import type { Line } from '../story/Dialogue';
import manifest from '../assets/voice.json';

/** Must match tools/voice/generate.mjs voiceKey(). */
export function voiceKey(speaker: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${speaker}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

type Entry = { d: number; c: number; s: string };
const MANIFEST = manifest as Record<string, Entry>;

/**
 * Voice acting: plays the pre-generated clip for a subtitle line (tools/voice/generate.mjs).
 * Clips for the current chapter are preloaded; radio lines go through a band-pass "handset"
 * filter; music and ambience duck under speech; pausing the game pauses the voice mid-line.
 */
export class VoiceBank {
  private cache = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private source: AudioBufferSourceNode | null = null;
  private playing: { key: string; startedAt: number; offset: number; radio: boolean } | null = null;
  private pausedAt: { key: string; offset: number; radio: boolean } | null = null;
  private chain: { dry: GainNode; radioIn: BiquadFilterNode } | null = null;

  constructor(private a: AudioEngine) {}

  /** Clip length in seconds (null when the line has no voice). */
  duration(l: Line): number | null {
    return MANIFEST[voiceKey(l.speaker, l.text)]?.d ?? null;
  }

  /** Decode every clip of a chapter ahead of time (call when it loads). */
  preload(chapter: number): void {
    this.a.whenReady(() => {
      for (const k of [...this.cache.keys()]) if (MANIFEST[k]?.c !== chapter) this.cache.delete(k);
      for (const [k, e] of Object.entries(MANIFEST)) if (e.c === chapter || e.c === 0) void this.load(k);
    });
  }

  private load(key: string): Promise<AudioBuffer | null> {
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const p = this.pending.get(key);
    if (p) return p;
    const ctx = this.a.ctx;
    if (!ctx) return Promise.resolve(null);
    const job = fetch(`/assets/voice/${key}.ogg`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        this.cache.set(key, buf);
        return buf;
      })
      .catch(() => null)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private ensureChain(): { dry: GainNode; radioIn: BiquadFilterNode } | null {
    const ctx = this.a.ctx;
    if (!ctx || !this.a.buses) return null;
    if (this.chain) return this.chain;
    const dry = ctx.createGain();
    dry.connect(this.a.buses.voice);
    // Radio: band-pass + soft clip + a touch of the room reverb removed.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 420;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) * 0.85;
    }
    shaper.curve = curve;
    const g = ctx.createGain();
    g.gain.value = 1.15;
    hp.connect(lp).connect(shaper).connect(g).connect(this.a.buses.voice);
    this.chain = { dry, radioIn: hp };
    return this.chain;
  }

  /** Start the clip for a line (stops whatever was speaking). */
  play(l: Line | null): void {
    this.stop();
    this.pausedAt = null;
    if (!l) return;
    const key = voiceKey(l.speaker, l.text);
    if (!MANIFEST[key]) return;
    const radio = !!l.radio;
    void this.load(key).then((buf) => {
      // Only start if this line is still the one on screen.
      if (!buf || this.wanted !== key) return;
      this.start(key, buf, 0, radio);
    });
    this.wanted = key;
  }

  private wanted: string | null = null;

  private start(key: string, buf: AudioBuffer, offset: number, radio: boolean): void {
    const ctx = this.a.ctx;
    const chain = this.ensureChain();
    if (!ctx || !chain) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(radio ? chain.radioIn : chain.dry);
    s.start(ctx.currentTime, Math.min(offset, Math.max(0, buf.duration - 0.05)));
    s.onended = () => {
      if (this.source === s) {
        this.source = null;
        this.playing = null;
        this.a.setSpeaking(false);
      }
    };
    this.source = s;
    this.playing = { key, startedAt: ctx.currentTime - offset, offset, radio };
    this.a.setSpeaking(true);
  }

  stop(): void {
    this.wanted = null;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    this.playing = null;
    this.a.setSpeaking(false);
  }

  pause(): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.playing) return;
    const p = this.playing;
    const key = p.key;
    this.stop();
    this.wanted = key;
    this.pausedAt = { key, offset: ctx.currentTime - p.startedAt, radio: p.radio };
  }

  resume(): void {
    const p = this.pausedAt;
    this.pausedAt = null;
    if (!p) return;
    const buf = this.cache.get(p.key);
    if (buf && this.wanted === p.key) this.start(p.key, buf, p.offset, p.radio);
  }
}
