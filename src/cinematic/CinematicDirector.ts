import * as THREE from 'three';
import type { Sequence, Shot, V3Source } from './Sequence';
import type { EventBus } from '../systems/EventBus';
import { clamp, damp } from '../systems/noise';

const resolve = (v: V3Source): THREE.Vector3 => (typeof v === 'function' ? v() : v).clone();

function ease(k: number, e: Shot['ease']): number {
  switch (e) {
    case 'linear':
      return k;
    case 'in':
      return k * k * k;
    case 'out':
      return 1 - Math.pow(1 - k, 3);
    default:
      return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  }
}

interface Resolved {
  shot: Shot;
  curve: THREE.CatmullRomCurve3 | null;
  points: THREE.Vector3[];
  look: THREE.Vector3[];
}

/**
 * Plays authored camera sequences with timed events, then blends seamlessly back into the
 * gameplay camera. Time is game time (pauses with the game).
 */
export class CinematicDirector {
  private seq: Sequence | null = null;
  private t = 0;
  private fired = new Set<number>();
  private resolved: Resolved[] = [];
  private resolve: ((skipped: boolean) => void) | null = null;
  /** 1 = fully cinematic camera, 0 = gameplay. */
  private blend = 0;
  private blending = false;
  private blendDur = 1;
  private blendT = 0;
  private cine = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 50, focus: 10 };
  private m = new THREE.Matrix4();
  letterbox = 0;
  onStart: ((s: Sequence) => void) | null = null;
  onEnd: ((s: Sequence, skipped: boolean) => void) | null = null;
  /** Fired when the camera has fully returned to gameplay. */
  onBlendDone: (() => void) | null = null;

  constructor(private events: EventBus) {}

  get playing(): boolean {
    return this.seq !== null;
  }
  get active(): boolean {
    return this.seq !== null || this.blending;
  }
  get current(): Sequence | null {
    return this.seq;
  }
  get time(): number {
    return this.t;
  }
  get dofFocus(): number {
    return this.cine.focus;
  }

  play(seq: Sequence): Promise<boolean> {
    if (this.seq) this.finish(true);
    this.seq = seq;
    this.t = 0;
    this.fired.clear();
    this.blend = 1;
    this.blending = false;
    this.resolved = seq.shots.map((shot) => {
      const points = shot.path.map(resolve);
      return {
        shot,
        points,
        curve: points.length > 2 ? new THREE.CatmullRomCurve3(points, false, 'centripetal') : null,
        look: shot.look.map(resolve),
      };
    });
    this.events.emit('cinematic:start', { id: seq.id });
    this.onStart?.(seq);
    this.evaluate();
    return new Promise((r) => (this.resolve = r));
  }

  skip(): void {
    if (this.seq?.skippable) this.finish(true);
  }

  update(dt: number): void {
    this.letterbox = damp(this.letterbox, this.seq?.letterbox ? 1 : 0, 3, dt);
    if (this.seq) {
      this.t += dt;
      this.seq.events.forEach((e, i) => {
        if (!this.fired.has(i) && this.t >= e.t) {
          this.fired.add(i);
          e.run(false);
        }
      });
      if (this.t >= this.seq.duration) this.finish(false);
      else this.evaluate();
    } else if (this.blending) {
      this.blendT += dt;
      const k = clamp(this.blendT / this.blendDur, 0, 1);
      this.blend = 1 - (k * k * (3 - 2 * k));
      if (k >= 1) {
        this.blending = false;
        this.blend = 0;
        this.onBlendDone?.();
      }
    }
  }

  private finish(skipped: boolean): void {
    const s = this.seq!;
    if (skipped) {
      // Guarantee world-state events still happen (e.g. a door ends up open).
      s.events.forEach((e, i) => {
        if (!this.fired.has(i) && e.onSkip !== false) {
          this.fired.add(i);
          e.run(true);
        }
      });
      this.t = s.duration;
      this.evaluate();
    }
    this.seq = null;
    this.blending = true;
    this.blendT = 0;
    this.blendDur = skipped ? Math.min(0.6, s.blendOut) : Math.max(0.05, s.blendOut);
    this.events.emit('cinematic:end', { id: s.id, skipped });
    this.onEnd?.(s, skipped);
    const r = this.resolve;
    this.resolve = null;
    r?.(skipped);
  }

  private evaluate(): void {
    if (!this.resolved.length) return;
    let r = this.resolved[0];
    for (const x of this.resolved) if (this.t >= x.shot.t0) r = x;
    const sh = r.shot;
    const k = ease(clamp((this.t - sh.t0) / Math.max(0.001, sh.t1 - sh.t0), 0, 1), sh.ease);
    const pos = r.curve ? r.curve.getPoint(k) : r.points.length > 1 ? r.points[0].clone().lerp(r.points[1], k) : r.points[0].clone();
    let look: THREE.Vector3;
    if (r.look.length === 1) look = r.look[0].clone();
    else {
      const f = k * (r.look.length - 1);
      const i = Math.min(r.look.length - 2, Math.floor(f));
      look = r.look[i].clone().lerp(r.look[i + 1], f - i);
    }
    const sway = sh.sway ?? 0.02;
    if (sway > 0) {
      const t = this.t;
      pos.x += Math.sin(t * 0.7) * sway;
      pos.y += Math.sin(t * 0.9 + 1.2) * sway * 0.7;
      look.x += Math.sin(t * 0.5 + 2) * sway * 2;
    }
    this.cine.position.copy(pos);
    this.m.lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    this.cine.quaternion.setFromRotationMatrix(this.m);
    this.cine.fov = sh.fov ? sh.fov[0] + (sh.fov[1] - sh.fov[0]) * k : 50;
    this.cine.focus = sh.focus ?? pos.distanceTo(look);
  }

  /** Compose the final camera from gameplay output + cinematic state. */
  apply(camera: THREE.PerspectiveCamera, gameplay: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number }): void {
    const b = this.blend;
    if (b <= 0.0001) {
      camera.position.copy(gameplay.position);
      camera.quaternion.copy(gameplay.quaternion);
      camera.fov = gameplay.fov;
    } else if (b >= 0.9999) {
      camera.position.copy(this.cine.position);
      camera.quaternion.copy(this.cine.quaternion);
      camera.fov = this.cine.fov;
    } else {
      camera.position.lerpVectors(gameplay.position, this.cine.position, b);
      camera.quaternion.slerpQuaternions(gameplay.quaternion, this.cine.quaternion, b);
      camera.fov = gameplay.fov + (this.cine.fov - gameplay.fov) * b;
    }
    camera.updateProjectionMatrix();
  }

  get blendAmount(): number {
    return this.blend;
  }
}
