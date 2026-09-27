import type { Persistable } from '../state/Persistable';

/** Base for all puzzles: identity, solved flag and state persistence. */
export abstract class Puzzle<S = unknown> implements Persistable<{ solved: boolean; state: S }> {
  readonly key: string;
  readonly version = 1;
  solved = false;
  onSolved: (() => void) | null = null;

  constructor(readonly id: string) {
    this.key = `puzzle:${id}`;
  }

  protected abstract getState(): S;
  protected abstract setState(s: S | undefined): void;
  /** Apply the solved end-state visuals instantly (used on restore). */
  protected abstract applySolvedInstant(): void;

  serialize() {
    return { solved: this.solved, state: this.getState() };
  }

  restore(data: { solved: boolean; state: S } | undefined): void {
    this.setState(data?.state);
    this.solved = !!data?.solved;
    if (this.solved) this.applySolvedInstant();
  }

  abstract update(dt: number): void;
}
