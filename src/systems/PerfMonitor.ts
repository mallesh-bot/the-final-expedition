import { HIGH_LEVEL_COUNT } from './Quality';

/**
 * Watches rolling frame times and steps adaptive-HIGH quality up/down with hysteresis.
 * Upgrades require sustained headroom and back off exponentially for levels that
 * previously failed, so quality doesn't oscillate.
 */
export class PerfMonitor {
  private samples: number[] = [];
  private sinceChange = 0;
  private goodTime = 0;
  private failures = new Map<number, number>();
  fps = 60;
  frameMs = 16.7;
  enabled = true;

  constructor(
    public level: number,
    private readonly apply: (level: number) => void,
    private readonly minLevel = 0,
  ) {}

  reset(level: number): void {
    this.level = level;
    this.samples = [];
    this.sinceChange = 0;
    this.goodTime = 0;
  }

  /** realDt in seconds. Call only while gameplay is rendering (not paused / loading). */
  update(realDt: number): void {
    if (realDt <= 0 || realDt > 0.5) return;
    this.samples.push(realDt * 1000);
    if (this.samples.length > 120) this.samples.shift();
    this.sinceChange += realDt;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.frameMs = avg;
    this.fps = 1000 / avg;
    if (!this.enabled || this.samples.length < 60 || this.sinceChange < 3) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    if (avg > 22 && this.level < HIGH_LEVEL_COUNT - 1) {
      this.failures.set(this.level, (this.failures.get(this.level) ?? 0) + 1);
      this.change(this.level + 1);
      return;
    }
    if (avg < 17.6 && p90 < 20 && this.level > this.minLevel) {
      this.goodTime += realDt;
      const fails = this.failures.get(this.level - 1) ?? 0;
      const needed = 8 * Math.pow(3, fails);
      if (this.goodTime > needed) this.change(this.level - 1);
    } else {
      this.goodTime = 0;
    }
  }

  private change(level: number): void {
    this.level = level;
    this.samples = [];
    this.sinceChange = 0;
    this.goodTime = 0;
    this.apply(level);
  }
}
