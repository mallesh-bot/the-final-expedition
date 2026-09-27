import * as THREE from 'three';
import { Puzzle } from './Puzzle';
import { smoothstep } from '../systems/noise';

export interface DrumDef {
  object: THREE.Object3D;
  /** Glyph index currently facing the player at rest (0..3). */
  initial: number;
  solution: number;
}

interface Drum extends DrumDef {
  index: number;
  angle: number;
  from: number;
  to: number;
  k: number;
  moving: boolean;
}

/**
 * Gate of the Watching Sun: N stone drums, each rotating in 90° steps. Solved when every
 * drum shows its target glyph. No per-drum "correct" feedback — the solution comes from
 * observing Marta's sketch, the murals and the sun (see STORY_BIBLE §8).
 */
export class RotatingDrumsPuzzle extends Puzzle<number[]> {
  private drums: Drum[];
  rotations = 0;
  onRotateStart: ((i: number) => void) | null = null;
  onRotateEnd: ((i: number) => void) | null = null;
  readonly rotateTime = 0.95;

  constructor(id: string, defs: DrumDef[]) {
    super(id);
    this.drums = defs.map((d) => ({ ...d, index: d.initial, angle: d.initial * (Math.PI / 2), from: 0, to: 0, k: 1, moving: false }));
    for (const d of this.drums) d.object.rotation.y = d.angle;
  }

  get busy(): boolean {
    return this.drums.some((d) => d.moving);
  }

  get indices(): number[] {
    return this.drums.map((d) => d.index);
  }

  drumObject(i: number): THREE.Object3D {
    return this.drums[i].object;
  }

  rotate(i: number): boolean {
    const d = this.drums[i];
    if (this.solved || d.moving) return false;
    d.moving = true;
    d.from = d.angle;
    d.to = d.angle + Math.PI / 2;
    d.k = 0;
    this.rotations++;
    this.onRotateStart?.(i);
    return true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.drums.length; i++) {
      const d = this.drums[i];
      if (!d.moving) continue;
      d.k = Math.min(1, d.k + dt / this.rotateTime);
      // Heavy stone: slow start, slight overshoot settle.
      const e = smoothstep(0, 1, d.k);
      const settle = Math.sin(d.k * Math.PI) * 0.02 * (d.k > 0.8 ? 1 : 0);
      d.angle = d.from + (d.to - d.from) * e + settle;
      d.object.rotation.y = d.angle;
      if (d.k >= 1) {
        d.moving = false;
        d.angle = d.to;
        d.object.rotation.y = d.angle;
        d.index = (d.index + 1) % 4;
        this.onRotateEnd?.(i);
        this.check();
      }
    }
  }

  private check(): void {
    if (this.solved) return;
    if (this.drums.every((d) => d.index === d.solution)) {
      this.solved = true;
      this.onSolved?.();
    }
  }

  /** Debug/test: jump to solution (triggers normal solve flow). */
  debugSolve(): void {
    for (const d of this.drums) {
      d.index = d.solution;
      d.angle = d.solution * (Math.PI / 2);
      d.object.rotation.y = d.angle;
    }
    this.check();
  }

  protected getState(): number[] {
    return this.indices;
  }

  protected setState(s: number[] | undefined): void {
    this.drums.forEach((d, i) => {
      d.index = s?.[i] ?? d.initial;
      d.angle = d.index * (Math.PI / 2);
      d.moving = false;
      d.object.rotation.y = d.angle;
    });
  }

  protected applySolvedInstant(): void {
    this.drums.forEach((d) => {
      d.index = d.solution;
      d.angle = d.solution * (Math.PI / 2);
      d.object.rotation.y = d.angle;
    });
  }
}
