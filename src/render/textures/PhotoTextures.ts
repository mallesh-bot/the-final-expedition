import * as THREE from 'three';
import type { PBRSet } from './ProceduralTextures';

/**
 * Photo-scanned surfaces (CC0, ambientCG; see ASSET_LICENSES.md and tools/textures). The rock sets
 * are stored neutral grey so one file can serve every chapter's colour: `tint` is the average colour
 * the surface should have, and createWorldMaterial multiplies it back in.
 */
export type TintedSet = PBRSet & { tint?: THREE.Color };

const loader = new THREE.TextureLoader();
const url = (file: string) => `${import.meta.env.BASE_URL}assets/textures/${file}`;

async function load(file: string, srgb: boolean): Promise<THREE.Texture> {
  const t = await loader.loadAsync(url(file));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

export async function photoSet(name: string, tint?: [number, number, number]): Promise<TintedSet> {
  const [map, normalMap, roughnessMap] = await Promise.all([load(`${name}_color.jpg`, true), load(`${name}_normal.jpg`, false), load(`${name}_rough.jpg`, false)]);
  const set: TintedSet = { map, normalMap, roughnessMap };
  if (tint) {
    // The file averages mid grey (sRGB 0.5), so this makes its average land on `tint`.
    const grey = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);
    const c = new THREE.Color().setRGB(tint[0] / 255, tint[1] / 255, tint[2] / 255, THREE.SRGBColorSpace);
    set.tint = new THREE.Color(c.r / grey.r, c.g / grey.g, c.b / grey.b);
  }
  return set;
}

export const photoMap = (name: string): Promise<THREE.Texture> => load(`${name}_color.jpg`, true);

/** The shared photo surfaces for a chapter's manifest. */
export function photoEntries(opts: { cliffTint?: [number, number, number]; masonTint?: [number, number, number] } = {}) {
  const e = (key: string, factory: () => Promise<unknown>, weight: number) => ({ key, type: 'procedural' as const, factory, weight });
  return [
    e('tex.ground', () => photoSet('ground'), 3),
    e('tex.grass', () => photoMap('grass'), 1),
    e('tex.stone', () => photoSet('stone', [150, 140, 122]), 3),
    e('tex.cliff', () => photoSet('cliff', opts.cliffTint ?? [158, 118, 94]), 3),
    e('tex.mason', () => photoSet('mason', opts.masonTint ?? [168, 158, 136]), 3),
    e('tex.moss', () => photoSet('moss'), 1),
    e('tex.bark', () => photoSet('bark'), 1),
    e('tex.wood', () => photoSet('wood'), 1),
    e('tex.rust', () => photoSet('rust'), 1),
  ];
}
