import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { GltfAnimationDriver, type CharacterDef } from './GltfAnimationDriver';
import { AdditiveLayers } from './AdditiveLayers';
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
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.78;
        mat.envMapIntensity = 0.7;
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
    });
  }

  handWorld(side: 'L' | 'R', out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones[side === 'L' ? 'handL' : 'handR'];
    return b ? b.getWorldPosition(out) : this.root.getWorldPosition(out);
  }

  setVisible(v: boolean): void {
    this.model.visible = v;
  }

  dispose(): void {
    this.driver.dispose();
    this.root.removeFromParent();
  }
}
