import type { ButtonAction } from './Bindings';

/** Per-frame input written by device providers and read by InputManager. */
export interface InputFrame {
  /** Analog movement (-1..1). Providers add; InputManager clamps. */
  moveX: number;
  moveY: number;
  /** Look delta in "mouse pixels"-equivalent units for this frame. */
  lookX: number;
  lookY: number;
  held: Set<ButtonAction>;
}

/**
 * A device (keyboard+mouse, gamepad, touch...). Adding a device = adding a provider;
 * gameplay systems are untouched.
 */
export interface InputProvider {
  readonly id: string;
  attach(): void;
  detach(): void;
  /** Contribute this frame's state. Called once per frame before gameplay reads input. */
  poll(frame: InputFrame, dt: number): void;
  /** Consume any buffered per-frame deltas after polling. */
  endFrame(): void;
}
