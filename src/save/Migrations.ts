import { SAVE_VERSION } from './SaveSchema';

type AnySave = Record<string, unknown> & { version: number };

/**
 * migrations[n] upgrades a save from version n to n+1.
 * Never edit an existing migration after release — add a new one and bump SAVE_VERSION.
 */
const migrations: Record<number, (s: AnySave) => AnySave> = {
  // Example for the future:
  // 1: (s) => ({ ...s, version: 2, newField: defaultValue }),
};

export function migrate(input: AnySave): AnySave {
  let s = input;
  let guard = 0;
  while (s.version < SAVE_VERSION) {
    const step = migrations[s.version];
    if (!step) throw new Error(`No migration from save version ${s.version}`);
    s = step(s);
    if (++guard > 100) throw new Error('Migration loop');
  }
  if (s.version > SAVE_VERSION) throw new Error(`Save version ${s.version} is newer than game (${SAVE_VERSION})`);
  return s;
}
