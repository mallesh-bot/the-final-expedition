import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { GltfAnimationDriver, type CharacterDef } from './GltfAnimationDriver';
import { AdditiveLayers } from './AdditiveLayers';
import { FootIK } from './FootIK';
import { ClimbController } from './ClimbController';
import type { AnimationDriver } from './AnimationDriver';
import characters from '../assets/characters.json';

export type CharacterId = keyof typeof characters;

export function characterDef(id: CharacterId): CharacterDef {
  return characters[id] as unknown as CharacterDef;
}

/**
 * A visual character instance: model + animation driver + additive layers.
 * Gameplay moves `root`; it never touches bones or clips directly.
 */
export class CharacterAvatar {
  readonly root = new THREE.Group();
  readonly driver: AnimationDriver;
  readonly layers: AdditiveLayers;
  readonly bones: Record<string, THREE.Object3D | undefined> = {};
  private model: THREE.Object3D;

  constructor(assets: AssetManager, readonly id: CharacterId) {
    const def = characterDef(id);
    const { scene, animations } = assets.instantiate(def.asset);
    this.model = scene;
    this.root.add(scene);
    this.root.name = `avatar:${id}`;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        // Materials come from the character pipeline (per-material roughness, sheen, alpha-test
        // hair). Only the environment response is tuned for the scene's IBL here.
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          mat.envMapIntensity = 0.85;
          // Hair cards: alpha-to-coverage gives soft edges under MSAA without sorting problems.
          if (mat.alphaTest > 0) mat.alphaToCoverage = true;
        }
      }
    });
    for (const [logical, boneName] of Object.entries(def.bones)) this.bones[logical] = scene.getObjectByName(boneName);
    this.driver = new GltfAnimationDriver(scene, animations, def);
    this.layers = new AdditiveLayers({
      hips: this.bones.hips,
      spine: this.bones.spine,
      chest: this.bones.chest,
      neck: this.bones.neck,
      head: this.bones.head,
      upperArmL: scene.getObjectByName('upperarm_l'),
      upperArmR: scene.getObjectByName('upperarm_r'),
      lowerArmL: scene.getObjectByName('lowerarm_l'),
      lowerArmR: scene.getObjectByName('lowerarm_r'),
      thighL: this.bones.thighL,
      thighR: this.bones.thighR,
    });
    this.climb = new ClimbController(scene);
    this.footIK = new FootIK(this.bones.hips, [
      { thigh: this.bones.thighL, calf: this.bones.calfL, foot: this.bones.footL },
      { thigh: this.bones.thighR, calf: this.bones.calfR, foot: this.bones.footR },
    ]);
  }

  /** Full-body climbing / mantling / vaulting IK. */
  readonly climb: ClimbController;
  /** Terrain-adaptive feet (player only; NPCs leave weight at 0). */
  readonly footIK: FootIK;

  handWorld(side: 'L' | 'R', out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones[side === 'L' ? 'handL' : 'handR'];
    return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out);
  }

  private wantVisible = true;
  private occluded = false;

  setVisible(v: boolean): void {
    this.wantVisible = v;
    this.model.visible = v && !this.occluded;
  }

  /** Camera is inside/at the character (tight spaces): hide without changing story visibility. */
  setCameraOccluded(o: boolean): void {
    if (o === this.occluded) return;
    this.occluded = o;
    this.model.visible = this.wantVisible && !o;
  }

  dispose(): void {
    this.driver.dispose();
    this.root.removeFromParent();
  }
}
