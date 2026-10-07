import * as THREE from 'three';
import type { BoxCollider } from '../physics/Colliders';

export interface CollapsePiece {
  object: THREE.Object3D;
  colliders: BoxCollider[];
  /** Seconds after start() when the piece lets go. */
  delay: number;
  /** Seconds of warning shudder before it drops. */
  shudder?: number;
  /** Spin while falling (rad/s around a random horizontal axis). */
  spin?: number;
}

/**
 * Keyframed destruction: pieces shudder, let go (colliders off), fall and tumble out of sight.
 * Deterministic and resettable, so a checkpoint retry restores the structure exactly.
 */
export class Collapse {
  private t = -1;
  private state: { base: THREE.Vector3; baseQ: THREE.Quaternion; vy: number; axis: THREE.Vector3; gone: boolean; dropped: boolean }[];
  onDrop: ((i: number, piece: CollapsePiece) => void) | null = null;
  onShudder: ((i: number, piece: CollapsePiece) => void) | null = null;
  private shuddered = new Set<number>();
  /** One merged stand-in drawn while the structure is intact (one draw call instead of N). */
  private proxy: THREE.Object3D | null = null;

  setProxy(p: THREE.Object3D): void {
    this.proxy = p;
    this.syncProxy();
  }

  private syncProxy(): void {
    const intact = this.t < 0;
    if (this.proxy) this.proxy.visible = intact;
    for (const p of this.pieces) p.object.visible = !intact && p.object.visible;
    if (intact && !this.proxy) for (const p of this.pieces) p.object.visible = true;
  }

  constructor(readonly pieces: CollapsePiece[]) {
    this.state = pieces.map((p, i) => ({
      base: p.object.position.clone(),
      baseQ: p.object.quaternion.clone(),
      vy: 0,
      axis: new THREE.Vector3(Math.sin(i * 2.3), 0, Math.cos(i * 1.7)).normalize(),
      gone: false,
      dropped: false,
    }));
  }

  get started(): boolean {
    return this.t >= 0;
  }

  get elapsed(): number {
    return this.t;
  }

  start(at = 0): void {
    if (this.t >= 0) return;
    this.t = at;
    if (this.proxy) {
      this.proxy.visible = false;
      for (const p of this.pieces) p.object.visible = true;
    }
  }

  /** Put everything back (checkpoint retry). */
  reset(): void {
    this.t = -1;
    this.shuddered.clear();
    this.pieces.forEach((p, i) => {
      const s = this.state[i];
      p.object.position.copy(s.base);
      p.object.quaternion.copy(s.baseQ);
      p.object.visible = true;
      s.vy = 0;
      s.gone = false;
      s.dropped = false;
      for (const c of p.colliders) c.enabled = true;
    });
    if (this.proxy) {
      this.proxy.visible = true;
      for (const p of this.pieces) p.object.visible = false;
    }
  }

  /** Jump straight to the collapsed end state (restore after the event). */
  finish(): void {
    this.t = 1e6;
    if (this.proxy) this.proxy.visible = false;
    this.pieces.forEach((p, i) => {
      const s = this.state[i];
      s.dropped = s.gone = true;
      p.object.visible = false;
      for (const c of p.colliders) c.enabled = false;
    });
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    this.pieces.forEach((p, i) => {
      const s = this.state[i];
      if (s.gone) return;
      const sh = p.shudder ?? 0.8;
      if (!s.dropped && this.t > p.delay - sh) {
        if (!this.shuddered.has(i)) {
          this.shuddered.add(i);
          this.onShudder?.(i, p);
        }
        const a = 0.025 * Math.min(1, (this.t - (p.delay - sh)) / sh);
        p.object.position.set(s.base.x + Math.sin(this.t * 61 + i) * a, s.base.y + Math.sin(this.t * 47) * a * 0.5, s.base.z + Math.cos(this.t * 53 + i) * a);
      }
      if (!s.dropped && this.t >= p.delay) {
        s.dropped = true;
        for (const c of p.colliders) c.enabled = false;
        this.onDrop?.(i, p);
      }
      if (s.dropped) {
        s.vy -= 16 * dt;
        p.object.position.y += s.vy * dt;
        p.object.rotateOnWorldAxis(s.axis, (p.spin ?? 0.6) * dt);
        if (p.object.position.y < s.base.y - 120) {
          s.gone = true;
          p.object.visible = false;
        }
      }
    });
  }
}
