/**
 * Pausable game time. Everything that belongs to the simulation (physics, timers,
 * animation, cinematics, particles) reads time from here — never from performance.now().
 */
export class GameClock {
  /** Simulation seconds elapsed while unpaused. */
  time = 0;
  /** Last frame's simulation delta (0 while paused). */
  delta = 0;
  /** Real (wall) delta, used by UI/menu animation that should keep running while paused. */
  realDelta = 0;
  timeScale = 1;
  private paused = false;
  private last = performance.now();
  private readonly maxDelta = 1 / 20;

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  tick(): void {
    const now = performance.now();
    this.realDelta = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.delta = this.paused ? 0 : Math.min(this.realDelta, this.maxDelta) * this.timeScale;
    this.time += this.delta;
  }

  /** Reset the wall reference (after tab visibility changes) to avoid a huge first delta. */
  resync(): void {
    this.last = performance.now();
  }
}

/** A timer that only advances with game time. */
export class GameTimer {
  private remaining: number;
  constructor(seconds: number, private readonly onDone?: () => void) {
    this.remaining = seconds;
  }
  update(dt: number): boolean {
    if (this.remaining <= 0) return true;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.onDone?.();
      return true;
    }
    return false;
  }
  get done(): boolean {
    return this.remaining <= 0;
  }
}
