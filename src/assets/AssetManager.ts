import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type AssetType = 'gltf' | 'texture' | 'ktx2' | 'json' | 'procedural';

export interface AssetEntry {
  key: string;
  type: AssetType;
  url?: string;
  /** For procedural assets: generator (may be async / yield to keep the loader responsive). */
  factory?: () => unknown | Promise<unknown>;
  /** Critical assets are loaded before the chapter becomes playable; others stream after. */
  critical?: boolean;
  /** Relative cost estimate used for progress weighting. */
  weight?: number;
  /** Texture options. */
  colorSpace?: 'srgb' | 'linear';
  repeat?: boolean;
}

export interface AssetManifest {
  id: string;
  entries: AssetEntry[];
}

interface CacheRecord {
  entry: AssetEntry;
  value?: unknown;
  promise?: Promise<unknown>;
  refs: number;
  /** Groups (manifests) holding this asset. */
  groups: Set<string>;
}

export type ProgressFn = (loaded: number, total: number, label: string) => void;

/**
 * Loads, caches (ref-counted), and disposes all game assets: GLTF/GLB (with DRACO,
 * Meshopt and KTX2 support), textures, JSON and procedurally generated resources.
 */
export class AssetManager {
  private cache = new Map<string, CacheRecord>();
  private gltfLoader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();
  private ktx2: KTX2Loader;
  private maxAnisotropy = 8;

  constructor(renderer: THREE.WebGLRenderer) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/decoders/draco/');
    this.ktx2 = new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(renderer);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(draco);
    this.gltfLoader.setKTX2Loader(this.ktx2);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  setAnisotropy(n: number): void {
    this.maxAnisotropy = n;
  }

  /** Register an entry without loading (idempotent). */
  define(entry: AssetEntry): void {
    if (!this.cache.has(entry.key)) this.cache.set(entry.key, { entry, refs: 0, groups: new Set() });
  }

  /** Load a whole manifest: critical first (awaited), the rest streamed in the background. */
  async loadManifest(
    manifest: AssetManifest,
    onProgress?: ProgressFn,
  ): Promise<{ streaming: Promise<void> }> {
    for (const e of manifest.entries) {
      this.define(e);
      const rec = this.cache.get(e.key)!;
      if (!rec.groups.has(manifest.id)) {
        rec.groups.add(manifest.id);
        rec.refs++;
      }
    }
    const critical = manifest.entries.filter((e) => e.critical !== false);
    const deferred = manifest.entries.filter((e) => e.critical === false);
    const total = critical.reduce((s, e) => s + (e.weight ?? 1), 0) || 1;
    let loaded = 0;
    for (const e of critical) {
      onProgress?.(loaded, total, e.key);
      await this.ensure(e.key);
      loaded += e.weight ?? 1;
      onProgress?.(loaded, total, e.key);
      // Yield so the loading screen can paint between heavy procedural jobs.
      await new Promise((r) => setTimeout(r, 0));
    }
    const streaming = (async () => {
      for (const e of deferred) {
        await this.ensure(e.key);
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return { streaming };
  }

  /** Release every asset a manifest acquired. Call disposeUnused() afterwards to free GPU memory. */
  releaseManifest(id: string): void {
    for (const rec of this.cache.values()) {
      if (rec.groups.delete(id)) rec.refs = Math.max(0, rec.refs - 1);
    }
  }

  acquire<T = unknown>(key: string): Promise<T> {
    const rec = this.cache.get(key);
    if (!rec) return Promise.reject(new Error(`Unknown asset "${key}"`));
    rec.refs++;
    return this.ensure(key) as Promise<T>;
  }

  release(key: string): void {
    const rec = this.cache.get(key);
    if (rec) rec.refs = Math.max(0, rec.refs - 1);
  }

  /** Synchronous access to an already-loaded asset. */
  get<T = unknown>(key: string): T {
    const rec = this.cache.get(key);
    if (!rec || rec.value === undefined) throw new Error(`Asset "${key}" not loaded`);
    return rec.value as T;
  }

  has(key: string): boolean {
    return this.cache.get(key)?.value !== undefined;
  }

  /** Clone a GLTF scene with independent skeleton (for multiple animated instances). */
  instantiate(key: string): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } {
    const gltf = this.get<GLTF>(key);
    return { scene: skeletonClone(gltf.scene), animations: gltf.animations };
  }

  stats(): { total: number; loaded: number; referenced: number } {
    let loaded = 0;
    let referenced = 0;
    for (const r of this.cache.values()) {
      if (r.value !== undefined) loaded++;
      if (r.refs > 0) referenced++;
    }
    return { total: this.cache.size, loaded, referenced };
  }

  /** Dispose all loaded assets with zero references. Returns number disposed. */
  disposeUnused(): number {
    let n = 0;
    for (const [key, rec] of this.cache) {
      if (rec.refs > 0 || rec.value === undefined) continue;
      disposeValue(rec.value);
      rec.value = undefined;
      rec.promise = undefined;
      this.cache.delete(key);
      n++;
    }
    return n;
  }

  private ensure(key: string): Promise<unknown> {
    const rec = this.cache.get(key);
    if (!rec) return Promise.reject(new Error(`Unknown asset "${key}"`));
    if (rec.value !== undefined) return Promise.resolve(rec.value);
    if (!rec.promise) {
      rec.promise = this.load(rec.entry).then((v) => {
        rec.value = v;
        return v;
      });
    }
    return rec.promise;
  }

  private async load(e: AssetEntry): Promise<unknown> {
    switch (e.type) {
      case 'gltf':
        return this.gltfLoader.loadAsync(e.url!);
      case 'texture': {
        const t = await this.texLoader.loadAsync(e.url!);
        this.configureTexture(t, e);
        return t;
      }
      case 'ktx2': {
        const t = await this.ktx2.loadAsync(e.url!);
        this.configureTexture(t, e);
        return t;
      }
      case 'json': {
        const r = await fetch(e.url!);
        if (!r.ok) throw new Error(`${e.url}: ${r.status}`);
        return r.json();
      }
      case 'procedural':
        return await e.factory!();
    }
  }

  private configureTexture(t: THREE.Texture, e: AssetEntry): void {
    t.colorSpace = e.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (e.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, this.maxAnisotropy);
  }
}

/** Dispose GPU resources held by an arbitrary loaded value. */
export function disposeValue(v: unknown): void {
  if (!v) return;
  if (v instanceof THREE.Texture) return v.dispose();
  if (v instanceof THREE.BufferGeometry) return v.dispose();
  if (v instanceof THREE.Material) return disposeMaterial(v);
  if (v instanceof THREE.Object3D) return disposeObject(v);
  const maybeGltf = v as Partial<GLTF>;
  if (maybeGltf.scene instanceof THREE.Object3D) return disposeObject(maybeGltf.scene);
  if (typeof v === 'object') {
    for (const inner of Object.values(v as Record<string, unknown>)) {
      if (inner instanceof THREE.Texture || inner instanceof THREE.Material || inner instanceof THREE.BufferGeometry)
        disposeValue(inner);
    }
  }
}

export function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
  m.dispose();
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
