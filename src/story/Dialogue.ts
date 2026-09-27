export type Speaker = 'INES' | 'TOBY' | 'MARTA' | 'CORWIN' | 'NARRATION';

export interface Line {
  speaker: Speaker;
  text: string;
  /** Seconds on screen (default derived from length). */
  duration?: number;
  /** Radio line: plays a squelch and styles the subtitle. */
  radio?: boolean;
}

/**
 * Subtitle-driven dialogue queue (no voice acting in this build). Advances with game time
 * so it pauses with the game. Lines are data (see story/dialogue/*.ts) and follow the
 * STORY_BIBLE.
 */
export class Dialogue {
  private queue: Line[] = [];
  current: Line | null = null;
  private remaining = 0;
  private gap = 0;
  onLine: ((l: Line | null) => void) | null = null;
  private played = new Set<string>();

  static durationFor(l: Line): number {
    return l.duration ?? Math.min(7, 1.6 + l.text.length * 0.055);
  }

  say(lines: Line[] | Line, interrupt = false): void {
    const arr = Array.isArray(lines) ? lines : [lines];
    if (interrupt) {
      this.queue = [...arr];
      this.current = null;
      this.remaining = 0;
      this.gap = 0;
    } else this.queue.push(...arr);
  }

  /** Play a named conversation at most once (tracked for save via playedIds). */
  sayOnce(id: string, lines: Line[], interrupt = false): boolean {
    if (this.played.has(id)) return false;
    this.played.add(id);
    this.say(lines, interrupt);
    return true;
  }

  hasPlayed(id: string): boolean {
    return this.played.has(id);
  }

  get playedIds(): string[] {
    return [...this.played];
  }
  set playedIds(ids: string[]) {
    this.played = new Set(ids);
  }

  clear(): void {
    this.queue = [];
    this.current = null;
    this.remaining = 0;
    this.onLine?.(null);
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  update(dt: number): void {
    if (this.current) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.current = null;
        this.gap = 0.35;
        this.onLine?.(null);
      }
      return;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      return;
    }
    const next = this.queue.shift();
    if (next) {
      this.current = next;
      this.remaining = Dialogue.durationFor(next);
      this.onLine?.(next);
    }
  }
}
