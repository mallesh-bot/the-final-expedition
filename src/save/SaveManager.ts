import type { Snapshot } from '../state/Snapshot';
import {
  SAVE_KEY_AUTO,
  SAVE_KEY_BACKUP_PREFIX,
  SAVE_KEY_MANUAL,
  SAVE_VERSION,
  isSaveLike,
  validateSave,
  type SaveData,
} from './SaveSchema';
import { migrate } from './Migrations';

export type SaveSlot = 'auto' | 'manual';

/**
 * Serialization boundary between game state (Snapshots) and browser storage.
 * Gameplay code never touches localStorage directly.
 */
export class SaveManager {
  private storage: Storage | null;

  constructor() {
    this.storage = SaveManager.detectStorage();
  }

  private static detectStorage(): Storage | null {
    try {
      const k = '__tfe_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return localStorage;
    } catch {
      console.warn('[SaveManager] localStorage unavailable — progress will not persist.');
      return null;
    }
  }

  get available(): boolean {
    return this.storage !== null;
  }

  private keyFor(slot: SaveSlot): string {
    return slot === 'auto' ? SAVE_KEY_AUTO : SAVE_KEY_MANUAL;
  }

  write(slot: SaveSlot, snap: Snapshot, label: string): boolean {
    if (!this.storage) return false;
    const data: SaveData = { ...snap, version: SAVE_VERSION, savedAt: new Date().toISOString(), label };
    try {
      this.storage.setItem(this.keyFor(slot), JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[SaveManager] write failed', err);
      return false;
    }
  }

  read(slot: SaveSlot): SaveData | null {
    if (!this.storage) return null;
    const key = this.keyFor(slot);
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isSaveLike(parsed)) throw new Error('not a save');
      const migrated = migrate(parsed as Record<string, unknown> & { version: number }) as unknown as SaveData;
      const errs = validateSave(migrated);
      if (errs.length) throw new Error(errs.join(', '));
      return migrated;
    } catch (err) {
      // Never silently destroy player data: back it up, then clear the slot.
      console.error(`[SaveManager] save "${slot}" unreadable — backed up`, err);
      try {
        this.storage.setItem(SAVE_KEY_BACKUP_PREFIX + Date.now(), raw);
        this.storage.removeItem(key);
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  /** The most recent valid save across slots — what CONTINUE loads. */
  latest(): SaveData | null {
    const a = this.read('auto');
    const m = this.read('manual');
    if (a && m) return Date.parse(a.savedAt) >= Date.parse(m.savedAt) ? a : m;
    return a ?? m;
  }

  hasSave(): boolean {
    return this.latest() !== null;
  }

  clear(): void {
    if (!this.storage) return;
    this.storage.removeItem(SAVE_KEY_AUTO);
    this.storage.removeItem(SAVE_KEY_MANUAL);
  }
}
