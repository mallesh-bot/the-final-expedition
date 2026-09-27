import type { Snapshot } from '../state/Snapshot';

export const SAVE_VERSION = 1;
export const SAVE_KEY_AUTO = 'tfe.save.auto';
export const SAVE_KEY_MANUAL = 'tfe.save.manual';
export const SAVE_KEY_BACKUP_PREFIX = 'tfe.save.corrupt.';

/** On-disk save format. Plain JSON; versioned; migrated forward on load. */
export interface SaveData extends Snapshot {
  version: number;
  savedAt: string;
  /** Human-readable label for the continue screen. */
  label: string;
}

export function isSaveLike(v: unknown): v is { version: number } {
  return typeof v === 'object' && v !== null && typeof (v as { version?: unknown }).version === 'number';
}

/** Structural validation of a (migrated) save. Returns list of problems; empty = valid. */
export function validateSave(s: SaveData): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(s.chapter) || s.chapter < 1 || s.chapter > 5) errs.push('chapter out of range');
  if (typeof s.checkpoint !== 'string') errs.push('checkpoint not a string');
  if (!Array.isArray(s.completedPuzzles)) errs.push('completedPuzzles not array');
  if (!Array.isArray(s.collectibles)) errs.push('collectibles not array');
  if (typeof s.storyFlags !== 'object' || s.storyFlags === null) errs.push('storyFlags not object');
  if (typeof s.systems !== 'object' || s.systems === null) errs.push('systems not object');
  return errs;
}
