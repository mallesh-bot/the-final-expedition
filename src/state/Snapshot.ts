import type { SystemRecord } from './Persistable';

/** A complete, JSON-safe capture of game progress + every registered system. */
export interface Snapshot {
  chapter: number;
  checkpoint: string;
  completedPuzzles: string[];
  collectibles: string[];
  storyFlags: Record<string, boolean>;
  playtimeSec: number;
  systems: Record<string, SystemRecord>;
}

export function emptySnapshot(chapter = 1, checkpoint = ''): Snapshot {
  return {
    chapter,
    checkpoint,
    completedPuzzles: [],
    collectibles: [],
    storyFlags: {},
    playtimeSec: 0,
    systems: {},
  };
}

export function cloneSnapshot(s: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(s)) as Snapshot;
}
