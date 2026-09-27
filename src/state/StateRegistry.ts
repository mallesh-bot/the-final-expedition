import type { Persistable, SystemRecord } from './Persistable';
import type { Snapshot } from './Snapshot';
import { Progress } from './Progress';

/**
 * Central registry of everything that must survive a checkpoint/save.
 * Systems register on creation; chapter-scoped systems unregister on chapter unload.
 */
export class StateRegistry {
  readonly progress = new Progress();
  private systems = new Map<string, Persistable>();
  /** Data for systems that were not registered at restore time (e.g. chapter not loaded yet). */
  private pending = new Map<string, SystemRecord>();

  register(p: Persistable): void {
    if (this.systems.has(p.key)) console.warn(`[StateRegistry] replacing system "${p.key}"`);
    this.systems.set(p.key, p);
    const pend = this.pending.get(p.key);
    if (pend) {
      this.pending.delete(p.key);
      p.restore(pend.data, pend.v);
    }
  }

  unregister(key: string): void {
    this.systems.delete(key);
  }

  keys(): string[] {
    return [...this.systems.keys()];
  }

  capture(): Snapshot {
    const systems: Record<string, SystemRecord> = {};
    // Keep pending (not-yet-loaded) data so it isn't lost by a save before the system exists.
    for (const [k, rec] of this.pending) systems[k] = rec;
    for (const [k, sys] of this.systems) {
      try {
        systems[k] = { v: sys.version, data: JSON.parse(JSON.stringify(sys.serialize() ?? null)) };
      } catch (err) {
        console.error(`[StateRegistry] failed to serialize "${k}"`, err);
      }
    }
    const p = this.progress;
    return {
      chapter: p.chapter,
      checkpoint: p.checkpoint,
      completedPuzzles: [...p.completedPuzzles],
      collectibles: [...p.collectibles],
      storyFlags: { ...p.storyFlags },
      playtimeSec: Math.round(p.playtimeSec),
      systems,
    };
  }

  /** Restore progress + all registered systems. Unknown systems are held until they register. */
  restore(s: Snapshot): void {
    const p = this.progress;
    p.chapter = s.chapter;
    p.checkpoint = s.checkpoint;
    p.completedPuzzles = new Set(s.completedPuzzles ?? []);
    p.collectibles = new Set(s.collectibles ?? []);
    p.storyFlags = { ...(s.storyFlags ?? {}) };
    p.playtimeSec = s.playtimeSec ?? 0;
    this.pending.clear();
    for (const [k, rec] of Object.entries(s.systems ?? {})) {
      const sys = this.systems.get(k);
      if (sys) {
        try {
          sys.restore(rec.data, rec.v);
        } catch (err) {
          console.error(`[StateRegistry] failed to restore "${k}"`, err);
        }
      } else {
        this.pending.set(k, rec);
      }
    }
    // Systems with no saved data get a restore(undefined) so they reset to defaults.
    for (const [k, sys] of this.systems) {
      if (!(k in (s.systems ?? {}))) sys.restore(undefined, sys.version);
    }
  }

  clearPending(): void {
    this.pending.clear();
  }
}
