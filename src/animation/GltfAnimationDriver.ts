import * as THREE from 'three';
import { LOCOMOTION_STATES, type AnimParams, type AnimState, type AnimationDriver } from './AnimationDriver';

export interface CharacterDef {
  asset: string;
  url: string;
  temporary?: boolean;
  clips: Partial<Record<AnimState, string>>;
  locomotion: {
    walkSpeed: number;
    runSpeed: number;
    sprintSpeed: number;
    walkStride: number;
    runStride: number;
    sprintStride: number;
  };
  bones: Record<string, string>;
}

const ONE_SHOTS: AnimState[] = ['JUMP', 'LAND', 'CLIMB_UP', 'VAULT', 'INTERACT', 'PUSH'];

interface Layer {
  weight: number;
  target: number;
  rate: number;
}

/**
 * AnimationMixer-based driver with:
 *  - speed-driven, phase-synchronised locomotion blend (idle/walk/run/sprint)
 *  - timed crossfades between state groups (no instant pops)
 *  - one-shot states with completion callbacks
 *  - signed playback for directional loops
 */
export class GltfAnimationDriver implements AnimationDriver {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<AnimState, THREE.AnimationAction>();
  private layers = new Map<AnimState | 'LOCO', Layer>();
  private current: AnimState = 'IDLE';
  private group: AnimState | 'LOCO' = 'LOCO';
  private phase = 0;
  private locoWeights: Record<string, number> = { IDLE: 1, WALK: 0, RUN: 0, SPRINT: 0 };
  private onDone: (() => void) | null = null;
  private oneShotTime = 0;
  private oneShotDuration = 0;

  constructor(
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    private def: CharacterDef,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [state, clipName] of Object.entries(def.clips) as [AnimState, string][]) {
      const clip = clips.find((c) => c.name === clipName);
      if (!clip) {
        console.warn(`[Anim] clip "${clipName}" for ${state} missing`);
        continue;
      }
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOTS.includes(state)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.enabled = false;
      a.setEffectiveWeight(0);
      a.play();
      this.actions.set(state, a);
    }
    this.layers.set('LOCO', { weight: 1, target: 1, rate: 8 });
    for (const s of LOCOMOTION_STATES) {
      const a = this.actions.get(s);
      if (a) {
        a.timeScale = 0; // time driven manually for phase sync
        a.enabled = true;
      }
    }
  }

  get state(): AnimState {
    return this.current;
  }

  get gaitPhase(): number {
    return this.phase;
  }

  setState(state: AnimState, opts: { fade?: number; restart?: boolean; onDone?: () => void } = {}): void {
    const group: AnimState | 'LOCO' = LOCOMOTION_STATES.includes(state) ? 'LOCO' : state;
    const fade = Math.max(0.01, opts.fade ?? 0.2);
    const changed = group !== this.group;
    this.current = state;
    if (!changed && !opts.restart) {
      if (opts.onDone) this.onDone = opts.onDone;
      return;
    }
    this.group = group;
    for (const [k, l] of this.layers) {
      l.target = k === group ? 1 : 0;
      l.rate = 1 / fade;
    }
    let layer = this.layers.get(group);
    if (!layer) {
      layer = { weight: 0, target: 1, rate: 1 / fade };
      this.layers.set(group, layer);
    }
    layer.target = 1;
    layer.rate = 1 / fade;
    if (group !== 'LOCO') {
      const a = this.actions.get(state);
      if (a) {
        a.enabled = true;
        if (ONE_SHOTS.includes(state) || opts.restart || layer.weight < 0.05) {
          a.reset();
          a.play();
        }
        if (ONE_SHOTS.includes(state)) {
          this.oneShotTime = 0;
          this.oneShotDuration = a.getClip().duration;
        }
      }
    }
    this.onDone = opts.onDone ?? null;
  }

  update(dt: number, p: AnimParams): void {
    // Crossfade layers
    for (const [k, l] of this.layers) {
      const d = l.target - l.weight;
      const step = l.rate * dt;
      l.weight = Math.abs(d) <= step ? l.target : l.weight + Math.sign(d) * step;
      if (k !== 'LOCO') {
        const a = this.actions.get(k);
        if (a) {
          a.setEffectiveWeight(l.weight);
          a.enabled = l.weight > 0.0001;
          if (!ONE_SHOTS.includes(k)) a.timeScale = k === this.group ? p.rate : a.timeScale;
        }
      }
    }

    // Locomotion blend by speed + phase sync.
    const L = this.def.locomotion;
    const sp = p.speed;
    const w = this.locoWeights;
    const target = { IDLE: 0, WALK: 0, RUN: 0, SPRINT: 0 };
    let stride = L.walkStride;
    if (sp < 0.15) target.IDLE = 1;
    else if (sp < L.walkSpeed) {
      const t = sp / L.walkSpeed;
      target.IDLE = 1 - t;
      target.WALK = t;
    } else if (sp < L.runSpeed) {
      const t = (sp - L.walkSpeed) / (L.runSpeed - L.walkSpeed);
      target.WALK = 1 - t;
      target.RUN = t;
      stride = L.walkStride + (L.runStride - L.walkStride) * t;
    } else {
      const t = Math.min(1, (sp - L.runSpeed) / (L.sprintSpeed - L.runSpeed));
      target.RUN = 1 - t;
      target.SPRINT = t;
      stride = L.runStride + (L.sprintStride - L.runStride) * t;
    }
    const k = 1 - Math.exp(-12 * dt);
    for (const s of LOCOMOTION_STATES) w[s] += (target[s as keyof typeof target] - w[s]) * k;
    if (sp > 0.05) this.phase = (this.phase + (Math.max(sp, 0.6) / stride) * dt) % 1;
    const locoLayer = this.layers.get('LOCO')!.weight;
    for (const s of LOCOMOTION_STATES) {
      const a = this.actions.get(s);
      if (!a) continue;
      const dur = a.getClip().duration;
      a.time = s === 'IDLE' ? (a.time + dt) % dur : this.phase * dur;
      a.setEffectiveWeight(w[s] * locoLayer);
      a.enabled = w[s] * locoLayer > 0.0001;
    }

    this.mixer.update(dt);

    // One-shot completion
    if (ONE_SHOTS.includes(this.current) && this.onDone) {
      this.oneShotTime += dt;
      if (this.oneShotTime >= this.oneShotDuration) {
        const cb = this.onDone;
        this.onDone = null;
        cb();
      }
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
