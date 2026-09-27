import type { BindingMap, ButtonAction } from './Bindings';
import type { InputFrame, InputProvider } from './InputProvider';

export class KeyboardMouseProvider implements InputProvider {
  readonly id = 'keyboard-mouse';
  private down = new Set<string>();
  /** Codes pressed since the last frame (so taps shorter than a frame are never lost). */
  private tapped = new Set<string>();
  private dx = 0;
  private dy = 0;
  /** Fired immediately on keydown (for UI navigation and pause even while the sim is frozen). */
  onCodeDown: ((code: string) => void) | null = null;

  constructor(
    private readonly target: HTMLElement,
    private readonly bindings: () => BindingMap,
  ) {}

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    }
    if (!e.repeat) {
      this.onCodeDown?.(e.code);
      this.tapped.add(e.code);
    }
    this.down.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.target !== this.target) return;
    this.down.add(`Mouse${e.button}`);
    this.tapped.add(`Mouse${e.button}`);
    this.onCodeDown?.(`Mouse${e.button}`);
  };
  private onMouseUp = (e: MouseEvent) => {
    this.down.delete(`Mouse${e.button}`);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.target) {
      this.dx += e.movementX;
      this.dy += e.movementY;
    }
  };
  private onBlur = () => {
    this.down.clear();
    this.tapped.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
  }

  poll(frame: InputFrame): void {
    const b = this.bindings();
    for (const action of Object.keys(b) as ButtonAction[]) {
      if (b[action].some((c) => this.down.has(c) || this.tapped.has(c))) frame.held.add(action);
    }
    const h = frame.held;
    frame.moveX += (h.has('moveRight') ? 1 : 0) - (h.has('moveLeft') ? 1 : 0);
    frame.moveY += (h.has('moveForward') ? 1 : 0) - (h.has('moveBack') ? 1 : 0);
    frame.lookX += this.dx;
    frame.lookY += this.dy;
  }

  endFrame(): void {
    this.dx = 0;
    this.dy = 0;
    this.tapped.clear();
  }

  /** Test/automation hook: simulate a held code. */
  simulate(code: string, down: boolean): void {
    if (down) {
      if (!this.down.has(code)) this.onCodeDown?.(code);
      this.down.add(code);
    } else this.down.delete(code);
  }
  simulateLook(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
  }
}
