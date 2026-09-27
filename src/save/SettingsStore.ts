import type { BindingMap } from '../input/Bindings';
import { defaultBindings } from '../input/Bindings';

export type QualityPreset = 'low' | 'medium' | 'high';

export interface Settings {
  version: number;
  quality: QualityPreset;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  subtitles: boolean;
  minimap: boolean;
  cameraShake: number;
  bindings: BindingMap;
}

const KEY = 'tfe.settings.v1';
const VERSION = 1;

export function defaultSettings(): Settings {
  return {
    version: VERSION,
    quality: 'high',
    masterVolume: 0.85,
    musicVolume: 0.6,
    sfxVolume: 0.9,
    ambienceVolume: 0.8,
    mouseSensitivity: 1,
    invertY: false,
    fov: 60,
    subtitles: true,
    minimap: true,
    cameraShake: 1,
    bindings: defaultBindings(),
  };
}

/** Settings persistence, independent of game saves (settings survive "New Expedition"). */
export class SettingsStore {
  readonly value: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    this.value = this.load();
  }

  private load(): Settings {
    const def = defaultSettings();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return def;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Merge so newly-added settings get defaults; bindings merged per-action.
      return {
        ...def,
        ...parsed,
        version: VERSION,
        bindings: { ...def.bindings, ...(parsed.bindings ?? {}) },
      };
    } catch {
      return def;
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage unavailable */
    }
    for (const l of this.listeners) l(this.value);
  }

  update(patch: Partial<Settings>): void {
    Object.assign(this.value, patch);
    this.save();
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
