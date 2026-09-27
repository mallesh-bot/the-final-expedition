import * as THREE from 'three';

export type Bus = 'music' | 'sfx' | 'ambience' | 'ui';

/**
 * WebAudio core: context lifecycle, mixing buses, pause ducking, shared noise buffers,
 * a generated reverb impulse, and 3D listener sync. All sound in the game is synthesized.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  buses!: Record<Bus, GainNode>;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  noise!: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
  private volumes = { master: 0.85, music: 0.6, sfx: 0.9, ambience: 0.8, ui: 0.7 };
  private duck = 1;
  private listeners: (() => void)[] = [];
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (menu click). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch (e) {
        console.warn('[Audio] unavailable', e);
        return;
      }
      this.build();
      for (const l of this.listeners) l();
      this.listeners = [];
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Run fn once the context exists (immediately if already unlocked). */
  whenReady(fn: () => void): void {
    if (this.ctx) fn();
    else this.listeners.push(fn);
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    const mk = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { music: mk(), sfx: mk(), ambience: mk(), ui: mk() };
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.noise = { white: this.makeNoise('white'), pink: this.makeNoise('pink'), brown: this.makeNoise('brown') };
    ctx.listener.positionX && (ctx.listener.positionX.value = 0);
    this.applyVolumes();
  }

  setVolumes(v: Partial<typeof this.volumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.08);
    set(this.master, this.volumes.master);
    set(this.buses.music, this.volumes.music * (this.duck < 1 ? 0.45 : 1));
    set(this.buses.sfx, this.volumes.sfx * this.duck);
    set(this.buses.ambience, this.volumes.ambience * this.duck);
    set(this.buses.ui, this.volumes.ui);
  }

  /** Pause ducking: world audio fades down, UI stays audible. */
  setPaused(p: boolean): void {
    this.duck = p ? 0.12 : 1;
    this.applyVolumes();
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  updateListener(cam: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = cam.position;
    cam.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(this.fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(this.fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(this.fwd.z, t, 0.02);
      l.upX.setTargetAtTime(this.up.x, t, 0.02);
      l.upY.setTargetAtTime(this.up.y, t, 0.02);
      l.upZ.setTargetAtTime(this.up.z, t, 0.02);
    } else {
      // Firefox/Safari legacy API
      (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(p.x, p.y, p.z);
      (l as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }

  /** Create a positional panner at a world point, connected to a bus. */
  panner(pos: THREE.Vector3, bus: Bus, refDistance = 4, rolloff = 1.2, maxDistance = 120): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = maxDistance;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
    p.connect(this.buses[bus]);
    return p;
  }

  noiseSource(kind: 'white' | 'pink' | 'brown', loop = true, offset = Math.random() * 3): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise[kind];
    s.loop = loop;
    s.start(this.ctx!.currentTime, offset);
    return s;
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade loop seam
    const f = 2048;
    for (let i = 0; i < f; i++) {
      const k = i / f;
      d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }
}
