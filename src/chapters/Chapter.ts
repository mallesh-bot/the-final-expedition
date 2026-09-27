import type * as THREE from 'three';
import type { AssetManager, AssetManifest } from '../assets/AssetManager';
import type { Renderer } from '../render/Renderer';
import type { CollisionWorld } from '../physics/Colliders';
import type { TraversalSystem } from '../traversal/TraversalSystem';
import type { InteractionSystem } from '../interaction/InteractionSystem';
import type { Player } from '../player/Player';
import type { CameraRig } from '../camera/CameraRig';
import type { CinematicDirector } from '../cinematic/CinematicDirector';
import type { Dialogue } from '../story/Dialogue';
import type { HUD } from '../ui/HUD';
import type { EventBus } from '../systems/EventBus';
import type { StateRegistry } from '../state/StateRegistry';
import type { QualitySettings } from '../systems/Quality';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Sfx } from '../audio/Sfx';
import type { Ambience } from '../audio/Ambience';
import type { AdaptiveMusic } from '../audio/AdaptiveMusic';
import type { InputManager } from '../input/InputManager';
import type { CharacterAvatar } from '../animation/CharacterAvatar';

export interface CheckpointDef {
  pos: THREE.Vector3;
  yaw: number;
  label: string;
}

/** Everything a chapter may use. Chapters never construct engine systems themselves. */
export interface ChapterContext {
  renderer: Renderer;
  scene: THREE.Scene;
  assets: AssetManager;
  world: CollisionWorld;
  traversal: TraversalSystem;
  interaction: InteractionSystem;
  player: Player;
  camera: CameraRig;
  cinematic: CinematicDirector;
  dialogue: Dialogue;
  hud: HUD;
  events: EventBus;
  state: StateRegistry;
  input: InputManager;
  audio: { engine: AudioEngine; sfx: Sfx; ambience: Ambience; music: AdaptiveMusic };
  quality: () => QualitySettings;
  createAvatar: (id: 'ines' | 'toby') => CharacterAvatar;
  reachCheckpoint: (id: string) => void;
  completeChapter: () => void;
  /** Open the journal on a collectible. */
  openJournal: (focus?: string) => void;
}

export interface Chapter {
  readonly id: number;
  readonly title: string;
  readonly numberLabel: string;
  readonly manifest: AssetManifest;
  readonly checkpoints: Record<string, CheckpointDef>;
  readonly firstCheckpoint: string;
  load(ctx: ChapterContext, onProgress: (f: number, label: string) => void): Promise<void>;
  /** Called after StateRegistry.restore — rebuild world from restored state, place player. */
  onRestored(checkpoint: string, isNewGame: boolean): void;
  /** Begin play (intro cinematic for new games etc.). */
  begin(isNewGame: boolean): void;
  update(dt: number, realDt: number): void;
  /** Main-menu backdrop camera path. */
  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void;
  objective(): string;
  /** Baked top-down map for the minimap (optional). */
  minimap?(): import('../ui/Minimap').MinimapImage;
  /** World position of the current objective (minimap marker), or null. */
  objectiveTarget?(): THREE.Vector3 | null;
  /** Discovered points of interest shown as dots. */
  mapPoints?(): THREE.Vector3[];
  applyQuality(q: QualitySettings): void;
  dispose(): void;
}

export interface ChapterEntry {
  id: number;
  numberLabel: string;
  title: string;
  /** STUB entries are not playable yet (content defined in STORY_BIBLE only). */
  stub: boolean;
  load?: () => Promise<{ default: new () => Chapter }>;
}
