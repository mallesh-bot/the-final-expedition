import type { InputFrame, InputProvider } from './InputProvider';

/**
 * STUB: Gamepad support is not implemented yet.
 *
 * This class exists so the architecture (InputManager -> providers -> actions) is proven
 * and a future implementation only needs to fill in poll(): read navigator.getGamepads(),
 * apply dead-zones, write left stick to moveX/moveY, right stick * sensitivity * dt to
 * lookX/lookY, and map buttons (A=jump, X=interact, B=drop, Start=pause, LS=sprint).
 * No gameplay code needs to change.
 */
export class GamepadProvider implements InputProvider {
  readonly id = 'gamepad (stub)';
  attach(): void {
    /* STUB */
  }
  detach(): void {
    /* STUB */
  }
  poll(_frame: InputFrame, _dt: number): void {
    /* STUB: intentionally no-op */
  }
  endFrame(): void {
    /* STUB */
  }
}
