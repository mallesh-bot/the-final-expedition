/**
 * Dynamic resolution: scales the render resolution between the preset's floor and 1.0 to hold
 * the preset's target frame time. Profiling showed the game is fill-rate bound on integrated
 * GPUs, so this is the most effective single lever. Steps are small and rate-limited (each
 * change reallocates render targets), and upgrades back off after a failed attempt so the scale
 * doesn't oscillate.
 */
export class DynamicResolution {
  scale = 1;
  private samples: number[] = [];
  private sinceChange = 0;
  private goodTime = 0;
  private failedAt = new Map<number, number>();
  private target = 1000 / 60;
  private floor = 1;
  enabled = true;

  constructor(private readonly apply: (scale: number) => void) {}

  configure(targetMs: number, floor: number): void {
    this.target = targetMs;
    this.floor = floor;
    this.samples = [];
    this.goodTime = 0;
    this.failedAt.clear();
    this.set(Math.max(floor, Math.min(1, this.scale)));
  }

  /** Call with the real frame delta (s) only while gameplay is rendering. */
  update(realDt: number): void {
    if (!this.enabled || realDt <= 0 || realDt > 0.5) return;
    this.samples.push(realDt * 1000);
    if (this.samples.length > 45) this.samples.shift();
    this.sinceChange += realDt;
    if (this.samples.length < 30 || this.sinceChange < 1) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg > this.target * 1.12 && this.scale > this.floor) {
      // Over budget: step down proportionally to how far over we are (fill cost ~ scale^2).
      const want = this.scale * Math.sqrt(this.target / avg);
      this.failedAt.set(this.key(this.scale), (this.failedAt.get(this.key(this.scale)) ?? 0) + 1);
      this.set(Math.max(this.floor, Math.min(this.scale - 0.05, want)));
    } else if (avg < this.target * 1.02 && this.scale < 1) {
      // On budget: try a little more resolution after sustained headroom (longer if it failed before).
      this.goodTime += realDt;
      const fails = this.failedAt.get(this.key(Math.min(1, this.scale + 0.05))) ?? 0;
      if (this.goodTime > 3 * Math.pow(2, fails)) this.set(Math.min(1, this.scale + 0.05));
    } else {
      this.goodTime = 0;
    }
  }

  private key(s: number): number {
    return Math.round(s * 20);
  }

  private set(s: number): void {
    s = Math.round(s * 100) / 100;
    this.sinceChange = 0;
    this.goodTime = 0;
    this.samples = [];
    if (s === this.scale) return;
    this.scale = s;
    this.apply(s);
  }
}
