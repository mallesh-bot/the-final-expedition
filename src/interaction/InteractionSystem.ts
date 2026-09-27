import * as THREE from 'three';

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  /** Minimum dot between player facing and direction to target (default 0.2). */
  facing?: number;
  priority?: number;
  onInteract: () => void;
}

/** Proximity + facing based focus selection for contextual "E" interactions. */
export class InteractionSystem {
  private items = new Map<string, Interactable>();
  focused: Interactable | null = null;
  private tmp = new THREE.Vector3();

  add(i: Interactable): Interactable {
    this.items.set(i.id, i);
    return i;
  }
  remove(id: string): void {
    this.items.delete(id);
    if (this.focused?.id === id) this.focused = null;
  }
  get(id: string): Interactable | undefined {
    return this.items.get(id);
  }
  clear(): void {
    this.items.clear();
    this.focused = null;
  }

  update(pos: THREE.Vector3, facing: THREE.Vector3, allowed: boolean): void {
    this.focused = null;
    if (!allowed) return;
    let best = Infinity;
    for (const it of this.items.values()) {
      if (!it.enabled) continue;
      const d = this.tmp.subVectors(it.position, pos);
      const dy = Math.abs(d.y - 0.9);
      d.y = 0;
      const dist = d.length();
      if (dist > it.radius || dy > 1.6) continue;
      if (dist > 0.3) {
        d.normalize();
        if (d.dot(facing) < (it.facing ?? 0.2)) continue;
      }
      const score = dist - (it.priority ?? 0);
      if (score < best) {
        best = score;
        this.focused = it;
      }
    }
  }

  /** Returns true if an interaction consumed the press. */
  tryInteract(): boolean {
    if (!this.focused) return false;
    this.focused.onInteract();
    return true;
  }
}
