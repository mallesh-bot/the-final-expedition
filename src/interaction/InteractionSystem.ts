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
  /** Test/accessibility switch for head look-at. */
  lookDisabled = false;
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

  /**
   * Something worth glancing at: the focused interactable, else the nearest enabled one within
   * `maxDist` that's roughly in front (head look-at; looser than the interaction cone).
   */
  lookCandidate(pos: THREE.Vector3, facing: THREE.Vector3, maxDist = 4.5): THREE.Vector3 | null {
    if (this.lookDisabled) return null;
    if (this.focused) return this.focused.position;
    let best = maxDist;
    let found: Interactable | null = null;
    for (const it of this.items.values()) {
      if (!it.enabled) continue;
      const d = this.tmp.subVectors(it.position, pos);
      if (Math.abs(d.y) > 2.5) continue;
      d.y = 0;
      const dist = d.length();
      if (dist > best || dist < 0.4) continue;
      if (d.normalize().dot(facing) < 0.1) continue;
      best = dist;
      found = it;
    }
    return found ? found.position : null;
  }

  /** Returns true if an interaction consumed the press. */
  tryInteract(): boolean {
    if (!this.focused) return false;
    this.focused.onInteract();
    return true;
  }
}
