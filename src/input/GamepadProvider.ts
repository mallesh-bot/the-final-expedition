import type { ButtonAction } from './Bindings';
import type { InputFrame, InputProvider } from './InputProvider';

/** Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping) → logical actions. */
const BUTTONS: [index: number, action: ButtonAction][] = [
  [0, 'jump'], // A / Cross
  [2, 'interact'], // X / Square
  [1, 'drop'], // B / Circle
  [10, 'sprint'], // L3
  [4, 'sprint'], // LB / L1
  [0, 'confirm'],
  [1, 'back'],
];
const PAUSE_BUTTON = 9; // Start / Options
const JOURNAL_BUTTON = 8; // Back / Share
const DEADZONE = 0.18;
/** Right-stick look speed at full deflection, in "mouse pixels" per second (InputManager scales these). */
const LOOK_SPEED = 1300;

/**
 * Gamepad input (first connected pad with the standard mapping). Left stick moves, right stick
 * looks (squared response for fine aim), face buttons map to jump / interact / drop, Start
 * pauses and Back opens the journal. Gameplay code is unchanged: it only sees actions.
 */
export class GamepadProvider implements InputProvider {
  readonly id = 'gamepad';
  /** Fired once per press for menu-level buttons (handled like keyboard pause/journal keys). */
  onButton: ((b: 'pause' | 'journal') => void) | null = null;
  private prevPause = false;
  private prevJournal = false;
  /** True once any pad input has been seen (UI can switch prompt glyphs). */
  active = false;

  attach(): void {}
  detach(): void {}

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected && p.mapping === 'standard') return p;
    return null;
  }

  poll(frame: InputFrame, dt: number): void {
    const p = this.pad();
    if (!p) return;
    const [mx, my] = radialDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const [lx, ly] = radialDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0);
    frame.moveX += mx;
    frame.moveY += -my;
    frame.lookX += Math.sign(lx) * lx * lx * LOOK_SPEED * dt;
    frame.lookY += Math.sign(ly) * ly * ly * LOOK_SPEED * dt;
    for (const [i, action] of BUTTONS) if (p.buttons[i]?.pressed) frame.held.add(action);
    const pause = !!p.buttons[PAUSE_BUTTON]?.pressed;
    const journal = !!p.buttons[JOURNAL_BUTTON]?.pressed;
    if (pause && !this.prevPause) this.onButton?.('pause');
    if (journal && !this.prevJournal) this.onButton?.('journal');
    this.prevPause = pause;
    this.prevJournal = journal;
    if (mx || my || lx || ly || frame.held.size) this.active = true;
  }

  endFrame(): void {}
}

/** Radial dead zone with rescaling so motion starts smoothly at the edge of the dead zone. */
export function radialDeadzone(x: number, y: number, dz = DEADZONE): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}
