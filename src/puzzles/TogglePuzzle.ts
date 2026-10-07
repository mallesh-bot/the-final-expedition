import * as THREE from 'three';
import { Puzzle } from './Puzzle';

export interface ToggleDef {
  /** Moving part (e.g. a sluice gate slab). Animates between its closed pose and closed + offset. */
  object: THREE.Object3D;
  initial: boolean;
  solution: boolean;
  /** Local offset applied when "on" (open). */
  offset: THREE.Vector3;
}

/**
 * N two-state switches (sluice gates, levers). Solved when every switch matches the solution.
 * Each switch animates on its own; callers get onToggle for sounds and water visuals.
 */
export class TogglePuzzle extends Puzzle<boolean[]> {
  states: boolean[];
  private k: number[];
  private base: THREE.Vector3[];
  readonly moveTime = 1.1;
  onToggle: ((i: number, on: boolean) => void) | null = null;
  onSettled: ((i: number, on: boolean) => void) | null = null;
  toggles = 0;

  constructor(
    id: string,
    private defs: ToggleDef[],
  ) {
    super(id);
    this.states = defs.map((d) => d.initial);
    this.k = defs.map((d) => (d.initial ? 1 : 0));
    this.base = defs.map((d) => d.object.position.clone());
    this.apply();
  }

  get busy(): boolean {
    return this.k.some((k, i) => k !== (this.states[i] ? 1 : 0));
  }

  toggle(i: number): void {
    if (this.solved || this.k[i] !== (this.states[i] ? 1 : 0)) return;
    this.states[i] = !this.states[i];
    this.toggles++;
    this.onToggle?.(i, this.states[i]);
  }

  isOn(i: number): boolean {
    return this.states[i];
  }

  /** 0..1 openness (animated). */
  amount(i: number): number {
    return this.k[i];
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.k.length; i++) {
      const target = this.states[i] ? 1 : 0;
      if (this.k[i] === target) continue;
      const step = dt / this.moveTime;
      this.k[i] = target > this.k[i] ? Math.min(target, this.k[i] + step) : Math.max(target, this.k[i] - step);
      changed = true;
      if (this.k[i] === target) {
        this.onSettled?.(i, this.states[i]);
        if (!this.solved && this.states.every((s, j) => s === this.defs[j].solution) && !this.busy) {
          this.solved = true;
          this.onSolved?.();
        }
      }
    }
    if (changed) this.apply();
  }

  private apply(): void {
    this.defs.forEach((d, i) => {
      const e = this.k[i] * this.k[i] * (3 - 2 * this.k[i]);
      d.object.position.copy(this.base[i]).addScaledVector(d.offset, e);
    });
  }

  protected getState(): boolean[] {
    return [...this.states];
  }

  protected setState(s: boolean[] | undefined): void {
    this.states = s && s.length === this.defs.length ? [...s] : this.defs.map((d) => d.initial);
    this.k = this.states.map((on) => (on ? 1 : 0));
    this.apply();
  }

  protected applySolvedInstant(): void {
    this.states = this.defs.map((d) => d.solution);
    this.k = this.states.map((on) => (on ? 1 : 0));
    this.apply();
  }
}
