import type { ButtonAction } from './Bindings';
import type { InputFrame, InputProvider } from './InputProvider';

/**
 * Aggregates providers into a single action state per frame.
 * Gameplay reads: move(), look(), held(a), pressed(a), released(a).
 */
export class InputManager {
  private providers: InputProvider[] = [];
  private frame: InputFrame = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: new Set() };
  private prevHeld = new Set<ButtonAction>();
  private pressedSet = new Set<ButtonAction>();
  private releasedSet = new Set<ButtonAction>();
  /** When false, gameplay-facing queries return neutral values (menus, cinematics). */
  gameplayEnabled = true;
  /** Look is additionally gated (e.g. allow look but not movement). */
  lookEnabled = true;
  sensitivity = 1;
  invertY = false;

  add(p: InputProvider): void {
    this.providers.push(p);
    p.attach();
  }

  dispose(): void {
    for (const p of this.providers) p.detach();
    this.providers = [];
  }

  /** Call once per rendered frame before any gameplay update. */
  update(dt: number): void {
    this.prevHeld = this.frame.held;
    this.frame = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: new Set() };
    for (const p of this.providers) p.poll(this.frame, dt);
    for (const p of this.providers) p.endFrame();
    this.pressedSet.clear();
    this.releasedSet.clear();
    for (const a of this.frame.held) if (!this.prevHeld.has(a)) this.pressedSet.add(a);
    for (const a of this.prevHeld) if (!this.frame.held.has(a)) this.releasedSet.add(a);
  }

  move(): { x: number; y: number } {
    if (!this.gameplayEnabled) return { x: 0, y: 0 };
    let { moveX: x, moveY: y } = this.frame;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  look(): { x: number; y: number } {
    if (!this.lookEnabled) return { x: 0, y: 0 };
    const s = this.sensitivity * 0.0022;
    return { x: this.frame.lookX * s, y: this.frame.lookY * s * (this.invertY ? -1 : 1) };
  }

  held(a: ButtonAction): boolean {
    return this.gameplayEnabled && this.frame.held.has(a);
  }
  pressed(a: ButtonAction): boolean {
    return this.gameplayEnabled && this.pressedSet.has(a);
  }
  released(a: ButtonAction): boolean {
    return this.gameplayEnabled && this.releasedSet.has(a);
  }
  /** Raw action state regardless of gameplay gating (UI, skip prompts). */
  rawHeld(a: ButtonAction): boolean {
    return this.frame.held.has(a);
  }
  rawPressed(a: ButtonAction): boolean {
    return this.pressedSet.has(a);
  }
}
