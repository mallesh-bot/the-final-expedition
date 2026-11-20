import * as THREE from 'three';
import type { ChapterContext } from '../Chapter';
import type { BoxCollider, Surface } from '../../physics/Colliders';
import { Heightfield } from '../../physics/Heightfield';
import { Sky } from '../../render/Sky';
import { fogUniforms, globalUniforms } from '../../render/HeightFog';
import {
  canvasClothTextures,
  foliageAtlas,
  glyphDrumTextures,
  leafSpriteTexture,
  mistTexture,
  muralTextures,
  softDotTexture,
  waterfallTexture,
  waterNormalTexture,
  type PBRSet,
} from '../../render/textures/ProceduralTextures';
import type { AssetManifest } from '../../assets/AssetManager';
import { createFoliageMaterial, createWaterMaterial, createWaterfallMaterial, createWorldMaterial, worldDetail } from '../../render/materials/WorldMaterials';
import { photoEntries } from '../../render/textures/PhotoTextures';
import { flowPlaneGeometry } from '../../world/Water';
import { TerrainTiles } from '../../world/Terrain';
import { addRockCollider, displacedRock, displacedSlab, InstanceBatch } from '../../world/RockKit';
import { ChunkedInstances, broadleafGeometry, farTreeGeometry, fernGeometry, grassGeometry, rainforestTree, treeFernGeometry, vineGeometry } from '../../world/Vegetation';
import { ambientParticles, BurstPool, type ParticleKind } from '../../world/Particles';
import { createShaftMaterial, lightShaft } from '../../world/LightShafts';
import * as P from '../../world/Props';
import { mergeStatic } from '../../world/StaticMerge';
import { fbm2, mulberry32 } from '../../systems/noise';

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Texture entries shared by every Ch2+ level (procedural; generated at load). */
export function standardManifest(id: string, extra: AssetManifest['entries'] = [], opts: { cliffTint?: [number, number, number]; masonTint?: [number, number, number] } = {}): AssetManifest {
  return {
    id,
    entries: [
      ...photoEntries(opts),
      { key: 'tex.canvas', type: 'procedural', factory: () => canvasClothTextures(41, 256), weight: 1 },
      { key: 'tex.waterN', type: 'procedural', factory: () => waterNormalTexture(71, 256), weight: 1 },
      { key: 'tex.foliage', type: 'procedural', factory: () => foliageAtlas(81, 1024), weight: 2 },
      { key: 'tex.glyphs', type: 'procedural', factory: () => glyphDrumTextures(91, 256), weight: 2 },
      { key: 'tex.mural', type: 'procedural', factory: () => muralTextures(101, 1024, 512), weight: 3 },
      { key: 'tex.dot', type: 'procedural', factory: () => softDotTexture(64) },
      { key: 'tex.mist', type: 'procedural', factory: () => mistTexture(128) },
      { key: 'tex.leaf', type: 'procedural', factory: () => leafSpriteTexture(64) },
      { key: 'tex.waterfall', type: 'procedural', factory: () => waterfallTexture(256) },
      ...extra,
    ],
  };
}

export interface AtmosphereOpts {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunHorizon: THREE.Color;
  skySun: THREE.Color;
  ground: THREE.Color;
  cloudCover: number;
  skySunIntensity: number;
  envIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  fogSunColor: THREE.Color;
  fogHeightBase: number;
  fogHeightFalloff: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  wetness: number;
  shadowRange?: number;
  /** Interiors: no visible sky dome (env still baked from it). */
  hideSky?: boolean;
}

/**
 * The shared "toolbox" a level is built with: atmosphere + lights, terrain, the material set,
 * instanced rock/masonry batches with matching colliders, vegetation scatter, particles,
 * props (merged at the end) and disposal. Mirrors how Chapter 1 is built, without the copy.
 */
export class LevelKit {
  readonly root = new THREE.Group();
  readonly props = new THREE.Group();
  readonly rnd: () => number;
  sky!: Sky;
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  env: THREE.Texture | null = null;
  terrain: TerrainTiles | null = null;
  heightfield: Heightfield | null = null;
  readonly vegetation: ChunkedInstances[] = [];
  readonly ambient: THREE.Points[] = [];
  readonly shafts: THREE.Mesh[] = [];
  readonly cliffBatch = new InstanceBatch();
  readonly rockBatch = new InstanceBatch();
  readonly masonBatch = new InstanceBatch();
  readonly flatBatch = new InstanceBatch();
  readonly darkBatch = new InstanceBatch();
  private disposables: { dispose(): void }[] = [];
  private keep: THREE.Object3D[] = [];
  /** Spatial chunk size (m) for instanced batches (culling). */
  chunk = 56;

  // Materials
  readonly rockMat: THREE.MeshStandardMaterial;
  readonly cliffMat: THREE.MeshStandardMaterial;
  readonly masonMat: THREE.MeshStandardMaterial;
  readonly darkMat: THREE.MeshStandardMaterial;
  /** Packed earth / leaf litter for built-up ground that isn't paved. */
  readonly soilMat: THREE.MeshStandardMaterial;
  readonly soilBatch = new InstanceBatch();
  readonly barkMat: THREE.MeshStandardMaterial;
  readonly glyphMat: THREE.MeshStandardMaterial;
  readonly muralMat: THREE.MeshStandardMaterial;
  readonly PM: P.PropMaterials;
  readonly foliage: Record<'grass' | 'fern' | 'leaf' | 'canopy' | 'palm' | 'vine' | 'far', { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }>;
  readonly waterMat: THREE.MeshStandardMaterial;
  readonly fallMat: THREE.ShaderMaterial;
  // Geometry kit
  readonly slabs: THREE.BufferGeometry[];
  /** Low-detail slabs for big/distant walls (~5x fewer triangles). */
  readonly slabsLo: THREE.BufferGeometry[];
  readonly rocks: THREE.BufferGeometry[];
  readonly block: THREE.BufferGeometry;
  readonly flatSlab: THREE.BufferGeometry;
  readonly stepSlab: THREE.BufferGeometry;
  /** Plain unit box (no displacement) for big floors/plates — stretching it leaves no streaks. */
  readonly plate: THREE.BufferGeometry;
  /** Low-poly bevelled ashlar for coursed masonry (48 tris). */
  readonly ashlar: THREE.BufferGeometry;
  readonly reddish = new THREE.Color(1.0, 0.86, 0.78);

  constructor(
    readonly ctx: ChapterContext,
    readonly name: string,
    seed: number,
    readonly tex: (k: string) => PBRSet,
    readonly texture: (k: string) => THREE.Texture,
    opts: { cliffMoss?: number; masonMoss?: number } = {},
  ) {
    this.root.name = name;
    this.props.name = 'props';
    ctx.scene.add(this.root);
    this.rnd = mulberry32(seed);
    worldDetail.level = ctx.quality().preset === 'low' ? 0 : ctx.quality().preset === 'medium' ? 1 : 2;
    const stone = tex('tex.stone');
    const moss = tex('tex.moss');
    const track = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x);
    this.rockMat = track(createWorldMaterial({ set: stone, moss: { set: moss, amount: 0.95, min: 0.3 }, triScale: 0.3, vertexColors: true, roughness: 0.92 }));
    this.cliffMat = track(createWorldMaterial({ set: tex('tex.cliff'), moss: { set: moss, amount: opts.cliffMoss ?? 0.8, min: 0.5 }, triScale: 0.2, vertexColors: true, roughness: 0.95, normalScale: 1.25 }));
    this.masonMat = track(createWorldMaterial({ set: tex('tex.mason'), moss: { set: moss, amount: opts.masonMoss ?? 0.85, min: 0.42 }, triScale: 0.3, vertexColors: true, roughness: 0.9, normalScale: 0.7 }));
    this.soilMat = track(createWorldMaterial({ set: tex('tex.ground'), triScale: 0.3, vertexColors: true, roughness: 0.96, normalScale: 1.1 }));
    this.darkMat = track(createWorldMaterial({ set: tex('tex.mason'), moss: { set: moss, amount: 0.25, min: 0.7 }, triScale: 0.3, vertexColors: true, roughness: 0.94, normalScale: 0.7 }));
    const bark = tex('tex.bark');
    this.barkMat = track(new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.92, color: 0xb8b0a0 }));
    const glyphs = tex('tex.glyphs');
    this.glyphMat = track(new THREE.MeshStandardMaterial({ map: glyphs.map, normalMap: glyphs.normalMap, roughness: 0.9, color: 0xd8d0c0 }));
    const mural = tex('tex.mural');
    this.muralMat = track(new THREE.MeshStandardMaterial({ map: mural.map, normalMap: mural.normalMap, roughness: 0.92, color: 0xe0d8c8 }));
    this.PM = P.createPropMaterials({ wood: tex('tex.wood'), canvas: tex('tex.canvas'), rust: tex('tex.rust') });
    const atlas = texture('tex.foliage');
    const a2c = ctx.quality().antialias === 'msaa';
    const fol = (o: Parameters<typeof createFoliageMaterial>[0]) => {
      const f = createFoliageMaterial(o);
      track(f.material);
      return f;
    };
    this.foliage = {
      grass: fol({ map: atlas, swayHeight: 0.7, swayAmount: 0.18, color: 0xb8c290, translucency: 0.3, alphaTest: 0.45, alphaToCoverage: a2c, push: 0.55 }),
      fern: fol({ map: atlas, swayHeight: 0.9, swayAmount: 0.12, color: 0xb0c098, translucency: 0.3, alphaToCoverage: a2c, push: 0.75 }),
      leaf: fol({ map: atlas, swayHeight: 1.3, swayAmount: 0.14, color: 0xa8bc90, translucency: 0.32, alphaToCoverage: a2c, push: 0.95 }),
      canopy: fol({ map: atlas, swayHeight: 24, swayAmount: 0.45, color: 0x8ea070, translucency: 0.28, alphaToCoverage: a2c }),
      palm: fol({ map: atlas, swayHeight: 5, swayAmount: 0.25, color: 0xb0c096, translucency: 0.3, alphaToCoverage: a2c }),
      vine: fol({ map: atlas, swayHeight: 8, swayAmount: 0.1, color: 0xa8b890, translucency: 0.4, alphaToCoverage: a2c }),
      far: fol({ map: atlas, swayHeight: 30, swayAmount: 0.2, color: 0x7f9266, translucency: 0.2 }),
    };
    this.waterMat = track(createWaterMaterial(texture('tex.waterN'), null));
    this.fallMat = track(createWaterfallMaterial(texture('tex.waterfall')));
    this.fallMat.uniforms.uTime = globalUniforms.uTime;
    Object.assign(this.fallMat.uniforms, fogUniforms);
    this.slabs = [0, 1, 2, 3].map((i) => track(displacedSlab(100 + i, 4, 4, 2, 0.32, 9, 0.35)));
    this.slabsLo = [0, 1].map((i) => track(displacedSlab(100 + i, 4, 4, 2, 0.32, 4, 0.35)));
    this.rocks = [0, 1, 2, 3, 4].map((i) => track(displacedRock(10 + i, i < 2 ? 3 : 2, 0.32 + i * 0.03, 0.72)));
    this.block = track(displacedSlab(400, 1, 1, 1, 0.04, 3, 0.07));
    this.flatSlab = track(displacedSlab(200, 3, 3, 1, 0.07, 10, 0.12));
    this.stepSlab = track(displacedSlab(300, 1, 1, 1, 0.025, 6, 0.06));
    this.ashlar = track(displacedSlab(500, 1, 1, 1, 0.025, 2, 0.07));
    this.plate = track(new THREE.BoxGeometry(1, 1, 1));
    this.plate.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.plate.attributes.position.count * 3).fill(0.9), 3));
    this.root.add(this.props);
  }

  track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** Keep an object out of the static merge (animated / toggled by the chapter). */
  dynamic<T extends THREE.Object3D>(o: T): T {
    this.keep.push(o);
    return o;
  }

  // ------------------------------------------------------------------ atmosphere
  atmosphere(o: AtmosphereOpts): void {
    const { ctx } = this;
    const scene = ctx.scene;
    this.sky = new Sky({ sunDir: o.sunDir, zenith: o.zenith, horizon: o.horizon, sunHorizon: o.sunHorizon, sunColor: o.skySun, ground: o.ground, cloudCover: o.cloudCover, sunIntensity: o.skySunIntensity });
    if (!o.hideSky) this.root.add(this.sky.mesh);
    this.env = this.sky.bakeEnvironment(ctx.renderer.renderer);
    this.waterMat.envMap = this.env;
    // (a material's own envMap ignores scene.environmentIntensity: dark rooms must not reflect daylight)
    // Indoors the baked sky is not overhead at all, so it barely shows in the water.
    this.waterMat.envMapIntensity = o.envIntensity * (o.hideSky ? 0.3 : 0.85);
    if (o.hideSky) this.waterMat.color.multiplyScalar(0.45);
    scene.environment = this.env;
    (scene as unknown as { environmentIntensity: number }).environmentIntensity = o.envIntensity;
    scene.background = o.hideSky ? o.fogColor.clone() : null;
    scene.fog = new THREE.FogExp2(o.fogColor, o.fogDensity);
    fogUniforms.fogSunDir.value.copy(o.sunDir);
    fogUniforms.fogSunColor.value.copy(o.fogSunColor);
    fogUniforms.fogSunPower.value = 10;
    fogUniforms.fogHeightBase.value = o.fogHeightBase;
    fogUniforms.fogHeightFalloff.value = o.fogHeightFalloff;
    globalUniforms.uSunDirWorld.value.copy(o.sunDir);
    globalUniforms.uSunColor.value.copy(o.sunColor);
    globalUniforms.uWetness.value = o.wetness;
    const sun = new THREE.DirectionalLight(o.sunColor, o.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const r = o.shadowRange ?? 32;
    const sc = sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 1;
    sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    this.root.add(sun, sun.target);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(o.hemiSky, o.hemiGround, o.hemiIntensity);
    this.root.add(this.hemi);
  }

  // ------------------------------------------------------------------ terrain
  terrainFrom(fn: (x: number, z: number) => number, opts: { origin: [number, number]; size: number; res: number; splat: (x: number, z: number, h: number, ny: number) => [number, number, number]; surface?: (x: number, z: number) => Surface }): Heightfield {
    const hf = new Heightfield(opts.origin[0], opts.origin[1], opts.size, opts.res, fn);
    this.ctx.world.heightfield = hf;
    if (opts.surface) this.ctx.world.terrainSurface = opts.surface;
    const terrainMat = this.track(
      createWorldMaterial({
        set: this.tex('tex.ground'),
        splat: { grass: this.texture('tex.grass'), rock: this.tex('tex.stone'), rockScale: 0.2 },
        triScale: 0.3,
        vertexColors: true,
        roughness: 0.95,
        normalScale: 1.1,
      }),
    );
    this.terrain = new TerrainTiles(hf, opts.splat, terrainMat, 40);
    this.track(this.terrain);
    this.root.add(this.terrain.group);
    this.heightfield = hf;
    return hf;
  }

  /** Flat invisible floor heightfield for interiors (collision only; visuals are authored). */
  flatFloor(y: number, origin: [number, number], size: number): Heightfield {
    const hf = new Heightfield(origin[0], origin[1], size, 33, () => y);
    this.ctx.world.heightfield = hf;
    this.heightfield = hf;
    return hf;
  }

  // ------------------------------------------------------------------ masonry & rock
  /** Ysharu masonry block (visual + optional collider). */
  blockAt(p: THREE.Vector3, s: THREE.Vector3, yaw = 0, collide = true, tint = 1, opts: { surface?: Surface; dark?: boolean; blocksCamera?: boolean } = {}): BoxCollider | null {
    (opts.dark ? this.darkBatch : this.masonBatch).add(this.block, p, s, yaw, tint);
    if (!collide) return null;
    return this.ctx.world.addBox(p, s.clone().multiplyScalar(0.5), yaw, { surface: opts.surface ?? 'stone', blocksCamera: opts.blocksCamera });
  }

  /** A walkable slab whose top is at `topY`. */
  floorSlab(cx: number, cz: number, w: number, d: number, topY: number, thick = 0.6, yaw = 0, tint = 0.95): BoxCollider {
    this.masonBatch.add(this.plate, v(cx, topY - thick / 2, cz), v(w, thick, d), yaw, tint);
    return this.ctx.world.addBox(v(cx, topY - thick / 2, cz), v(w / 2, thick / 2, d / 2), yaw, { surface: 'stone' });
  }

  /** Stair of `n` steps from a to b (centers on the walking line), width w. */
  stair(a: THREE.Vector3, b: THREE.Vector3, n: number, w: number, tint = 0.95): void {
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const run = Math.hypot(b.x - a.x, b.z - a.z) / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const top = a.y + (b.y - a.y) * ((i + 1) / n);
      const p = v(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
      const h = Math.max(0.3, top - Math.min(a.y, b.y) + 0.3);
      this.masonBatch.add(this.stepSlab, v(p.x, top - h / 2, p.z), v(w, h, run + 0.02), yaw, tint);
      this.ctx.world.addBox(v(p.x, top - h / 2, p.z), v(w / 2, h / 2, run / 2 + 0.01), yaw, { surface: 'stone' });
    }
  }

  /**
   * Cliff box: collider + cliff-slab dressing on the faces listed. `skip(x,y,z)` keeps authored
   * climb surfaces clean.
   */
  cliffBox(c: THREE.Vector3, h: THREE.Vector3, faces: ('+x' | '-x' | '+z' | '-z' | 'top')[], opts: { tint?: number; skip?: (x: number, y: number, z: number) => boolean; hue?: THREE.Color; collide?: boolean; inset?: number; scale?: number; minY?: number; maxY?: number } = {}): BoxCollider | null {
    const col = opts.collide === false ? null : this.ctx.world.addBox(c, h, 0, { surface: 'stone' });
    const rnd = this.rnd;
    const hue = opts.hue ?? this.reddish;
    const S = opts.scale ?? 1;
    const inset = (opts.inset ?? 1.1) * S;
    for (const f of faces) {
      if (f === 'top') {
        for (let x = c.x - h.x + 1.5; x < c.x + h.x; x += 3 + rnd())
          for (let z = c.z - h.z + 1.5; z < c.z + h.z; z += 3 + rnd()) {
            if (opts.skip?.(x, c.y + h.y, z)) continue;
            this.cliffBatch.add(this.slabs[Math.floor(rnd() * this.slabs.length)], v(x, c.y + h.y - inset * 0.6, z), v(0.9 + rnd() * 0.4, 0.5, 0.9 + rnd() * 0.4), new THREE.Euler(Math.PI / 2, rnd() * 6, 0), (opts.tint ?? 0.9) * (0.85 + rnd() * 0.3), hue);
          }
        continue;
      }
      const alongX = f === '+z' || f === '-z';
      const sgn = f[0] === '+' ? 1 : -1;
      {
        // Solid rock behind the dressing so gaps between slabs never show the sky.
        const yb0 = Math.max(c.y - h.y, opts.minY ?? -Infinity);
        const yb1 = c.y + h.y - 0.3;
        if (yb1 > yb0) {
          const depth = inset + 0.55 * S;
          const pc = alongX ? v(c.x, (yb0 + yb1) / 2, c.z + sgn * h.z - sgn * depth) : v(c.x + sgn * h.x - sgn * depth, (yb0 + yb1) / 2, c.z);
          this.cliffBatch.add(this.plate, pc, alongX ? v(h.x * 2, yb1 - yb0, 0.4) : v(0.4, yb1 - yb0, h.z * 2), 0, (opts.tint ?? 1) * 0.55, hue);
        }
      }
      const a0 = alongX ? c.x - h.x : c.z - h.z;
      const a1 = alongX ? c.x + h.x : c.z + h.z;
      const y0 = Math.max(c.y - h.y, opts.minY ?? -Infinity);
      const y1 = Math.min(c.y + h.y, opts.maxY ?? Infinity);
      for (let a = a0 + 1.4 * S; a < a1 + 1.0 * S; a += (2.8 + rnd() * 1.2) * S)
        for (let y = y0 + 1.5 * S; y < y1 + 0.5 * S; y += (3.2 + rnd() * 0.8) * S) {
          const ca = Math.min(a, a1 - 0.8 * S);
          const cy = Math.min(y, y1 - 1.2 * S);
          const face = (alongX ? c.z + sgn * h.z : c.x + sgn * h.x) - sgn * inset;
          const p = alongX ? v(ca, cy, face) : v(face, cy, ca);
          if (opts.skip?.(p.x, p.y, p.z)) continue;
          const yaw = alongX ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
          // Strata: tint bands by height so cliffs read as layered rock, not a tiled texture.
          const band = 0.86 + 0.14 * Math.sin(cy * 0.55 + Math.sin(ca * 0.07) * 1.5) + (rnd() - 0.5) * 0.1;
          const strata = hue.clone().multiplyScalar(band);
          if (rnd() < 0.07) {
            // Weathered boulders set into the face break up the slab rhythm.
            const r = (1.2 + rnd() * 0.8) * S;
            this.rockBatch.add(this.rocks[Math.floor(rnd() * 3)], p.clone().addScaledVector(alongX ? v(0, 0, sgn) : v(sgn, 0, 0), 0.25 * S), v(r, r * (0.8 + rnd() * 0.4), r * 0.8), rnd() * 6, (opts.tint ?? 1) * (0.7 + rnd() * 0.25), strata);
            continue;
          }
          const set = S >= 1.3 ? this.slabsLo : this.slabs;
          const tall = rnd() < 0.5;
          this.cliffBatch.add(set[Math.floor(rnd() * set.length)], p, v((tall ? 0.75 + rnd() * 0.3 : 1.05 + rnd() * 0.5) * S, (tall ? 1.15 + rnd() * 0.4 : 0.75 + rnd() * 0.3) * S, S * (0.9 + rnd() * 0.3)), new THREE.Euler((rnd() - 0.5) * 0.16, yaw + (rnd() - 0.5) * 0.24, Math.floor(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.35), (opts.tint ?? 1) * (0.8 + rnd() * 0.3), strata);
        }
    }
    return col;
  }

  // ------------------------------------------------------------------ interiors
  /** Axis-aligned masonry wall from (x0,z0) to (x1,z1), y0..y1, with door gaps [s0,s1] along it. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, gaps: [number, number][] = [], tint = 0.8, T = 0.8): void {
    const rnd = this.rnd;
    const alongX = z0 === z1;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const cuts = [a0, ...gaps.flat(), a1];
    for (let i = 0; i < cuts.length; i += 2) {
      const s0 = cuts[i];
      const s1 = cuts[i + 1];
      if (s1 - s0 < 0.05) continue;
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      const c = alongX ? v(mid, (y0 + y1) / 2, z0) : v(x0, (y0 + y1) / 2, mid);
      const sz = alongX ? v(len, y1 - y0, T) : v(T, y1 - y0, len);
      this.blockAt(c, sz, 0, true, tint, { dark: true });
      for (let n = 0; n < len / 2.2; n++) {
        const along = s0 + rnd() * len;
        const hy = y0 + 0.4 + rnd() * (y1 - y0 - 0.8);
        const p = alongX ? v(along, hy, z0) : v(x0, hy, along);
        this.masonBatch.add(this.block, p, alongX ? v(1.1 + rnd(), 0.5, T + 0.08) : v(T + 0.08, 0.5, 1.1 + rnd()), 0, 0.7 + rnd() * 0.2);
      }
    }
  }

  /**
   * Coursed Ysharu masonry (PRD §55: no generic boxes as hero architecture): staggered courses
   * of bevelled ashlar with per-stone size, set-back and tint variation, plus a cornice. One box
   * collider per solid run; door gaps get trapezoid jambs + lintel.
   */
  coursedWall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, opts: { gaps?: [number, number][]; thick?: number; tint?: number; dark?: boolean; collide?: boolean; cornice?: boolean; hue?: THREE.Color; doorH?: number } = {}): void {
    const rnd = this.rnd;
    const T = opts.thick ?? 0.8;
    const alongX = z0 === z1;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const gaps = opts.gaps ?? [];
    const tint = opts.tint ?? 0.85;
    const batch = opts.dark ? this.darkBatch : this.masonBatch;
    const doorH = opts.doorH ?? Math.min(y1 - y0 - 0.6, 2.9);
    const P = (along: number, y: number, out = 0) => (alongX ? v(along, y, z0 + out) : v(x0 + out, y, along));
    const inGap = (a: number, y: number) => gaps.some(([g0, g1]) => a > g0 - 0.02 && a < g1 + 0.02 && y < y0 + doorH);
    let row = 0;
    for (let y = y0; y < y1 - 0.05; row++) {
      const rh = Math.min(y1 - y, row === 0 ? 0.75 : 0.5 + rnd() * 0.2);
      let a = a0 - (row % 2 ? 0.45 : 0);
      while (a < a1) {
        const len = Math.min(a1 - a, 0.8 + rnd() * 0.75);
        const s0 = Math.max(a, a0);
        const s1 = Math.min(a + len, a1);
        a += len;
        if (s1 - s0 < 0.12) continue;
        const mid = (s0 + s1) / 2;
        if (inGap(mid, y + rh / 2)) continue;
        const out = (rnd() - 0.5) * 0.05;
        const sz = alongX ? v(s1 - s0 - 0.03, rh - 0.03, T + out) : v(T + out, rh - 0.03, s1 - s0 - 0.03);
        batch.add(this.ashlar, P(mid, y + rh / 2), sz, 0, tint * (0.82 + rnd() * 0.3), opts.hue);
      }
      y += rh;
    }
    if (opts.cornice !== false)
      for (let a = a0; a < a1; a += 1.6) {
        const l = Math.min(1.6, a1 - a);
        batch.add(this.ashlar, P(a + l / 2, y1 + 0.12), alongX ? v(l, 0.24, T + 0.3) : v(T + 0.3, 0.24, l), 0, tint * 1.05, opts.hue);
      }
    // Door frames: trapezoid jambs (narrower at the top) + a heavy lintel.
    for (const [g0, g1] of gaps) {
      const w = g1 - g0;
      for (const [edge, sgn] of [[g0, 1], [g1, -1]] as const) {
        const jamb = alongX ? new THREE.Euler(0, 0, -0.06 * sgn) : new THREE.Euler(0.06 * sgn, 0, 0);
        batch.add(this.ashlar, P(edge + sgn * 0.12, y0 + doorH / 2, 0), alongX ? v(0.3, doorH, T + 0.12) : v(T + 0.12, doorH, 0.3), jamb, tint * 1.08, opts.hue);
      }
      batch.add(this.ashlar, P((g0 + g1) / 2, y0 + doorH + 0.25), alongX ? v(w + 0.9, 0.5, T + 0.16) : v(T + 0.16, 0.5, w + 0.9), 0, tint * 1.1, opts.hue);
    }
    // Colliders: solid runs between gaps (+ the wall above each gap).
    if (opts.collide !== false) {
      const cuts = [a0, ...gaps.flat(), a1];
      for (let i = 0; i < cuts.length; i += 2) {
        const s0 = cuts[i];
        const s1 = cuts[i + 1];
        if (s1 - s0 < 0.05) continue;
        const c = P((s0 + s1) / 2, (y0 + y1) / 2);
        this.ctx.world.addBox(c, alongX ? v((s1 - s0) / 2, (y1 - y0) / 2, T / 2) : v(T / 2, (y1 - y0) / 2, (s1 - s0) / 2), 0, { surface: 'stone' });
      }
      for (const [g0, g1] of gaps)
        if (y1 > y0 + doorH) this.ctx.world.addBox(P((g0 + g1) / 2, (y0 + doorH + y1) / 2), alongX ? v((g1 - g0) / 2, (y1 - y0 - doorH) / 2, T / 2) : v(T / 2, (y1 - y0 - doorH) / 2, (g1 - g0) / 2), 0);
    }
  }

  /**
   * Spandrel for one arched bay of a bridge/aqueduct running along Z: `len` long, `width` thick
   * (X), deck underside at y=-deck, round arch of radius r springing at y=-spring.
   */
  arch(len: number, width: number, deck: number, spring: number, r: number, offset = 0): THREE.BufferGeometry {
    const sh = new THREE.Shape();
    const h = len / 2;
    sh.moveTo(-h, -deck);
    sh.lineTo(h, -deck);
    sh.lineTo(h, -spring);
    sh.lineTo(offset + r, -spring);
    sh.absarc(offset, -spring, r, 0, Math.PI, false);
    sh.lineTo(-h, -spring);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1, curveSegments: 12 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.9), 3));
    return this.track(g);
  }

  /** Merged copy of several objects (for collapse stand-ins): geometry is cloned, sources untouched. */
  mergedCopy(objs: THREE.Object3D[], name: string): THREE.Group {
    const tmp = new THREE.Group();
    for (const o of objs) {
      o.updateWorldMatrix(true, true);
      const c = o.clone(true);
      c.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) m.geometry = m.geometry.clone();
      });
      o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      tmp.add(c);
    }
    const merged = mergeStatic(tmp, name);
    this.root.add(merged);
    return merged;
  }

  /** A row of dark trapezoid niches on a wall face (Ysharu "windows of the houses"). */
  niches(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3, y: number, count: number, size = 0.7): void {
    const mat = this.nicheMat ?? (this.nicheMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0b0907, roughness: 1 })));
    const sh = new THREE.Shape();
    sh.moveTo(-size * 0.4, 0);
    sh.lineTo(size * 0.4, 0);
    sh.lineTo(size * 0.28, size);
    sh.lineTo(-size * 0.28, size);
    sh.closePath();
    const g = this.nicheGeo ?? (this.nicheGeo = this.track(new THREE.ShapeGeometry(sh)));
    const yaw = Math.atan2(normal.x, normal.z);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const m = new THREE.Mesh(g, mat);
      m.position.copy(a).lerp(b, t).setY(y).addScaledVector(normal, 0.02);
      m.rotation.y = yaw;
      this.props.add(m);
    }
  }
  private nicheMat: THREE.MeshStandardMaterial | null = null;
  private nicheGeo: THREE.BufferGeometry | null = null;

  /** Ceiling slab cells over a rectangle at height y, skipping aperture rectangles [x0,x1,z0,z1]. */
  ceiling(x0: number, x1: number, z0: number, z1: number, y: number, holes: [number, number, number, number][] = [], cell = 2): void {
    for (let x = x0 - 0.6; x < x1 + 0.6; x += cell)
      for (let z = z0 - 0.6; z < z1 + 0.6; z += cell) {
        const cx = x + cell / 2;
        const cz = z + cell / 2;
        if (holes.some(([hx0, hx1, hz0, hz1]) => cx > hx0 && cx < hx1 && cz > hz0 && cz < hz1)) continue;
        this.darkBatch.add(this.block, v(cx, y + 0.5, cz), v(cell + 0.05, 1.0, cell + 0.05), 0, 0.6);
      }
    if (!holes.length) this.darkBatch.add(this.block, v((x0 + x1) / 2, y + 1.4, (z0 + z1) / 2), v(x1 - x0 + 1.6, 0.8, z1 - z0 + 1.6), 0, 0.5);
  }

  /** Paved floor (visual) — collision comes from the level's floor heightfield/boxes. */
  pavedFloor(x0: number, x1: number, z0: number, z1: number, y: number, tint = 0.7): void {
    const rnd = this.rnd;
    this.masonBatch.add(this.plate, v((x0 + x1) / 2, y - 0.3, (z0 + z1) / 2), v(x1 - x0, 0.6, z1 - z0), 0, tint * 0.55);
    for (let x = x0 + 0.7; x < x1; x += 1.35)
      for (let z = z0 + 0.7; z < z1; z += 1.35)
        if (rnd() < 0.7) this.masonBatch.add(this.block, v(x, y - 0.07, z), v(1.25, 0.16, 1.25), (rnd() - 0.5) * 0.05, tint * (0.88 + rnd() * 0.26));
  }

  /** Worn pale stone over an authored climb surface (flush with its wall). */
  climbFace(origin: THREE.Vector3, right: THREE.Vector3, normal: THREE.Vector3, width: number, height: number): void {
    const rnd = this.rnd;
    const yaw = Math.atan2(normal.x, normal.z);
    // Small worn plates, nearly flush with the wall: reads as handholds, not as loose slabs.
    for (let u = 0.35; u < width; u += 0.75 + rnd() * 0.15)
      for (let h = 0.4; h < height; h += 0.75 + rnd() * 0.15) {
        const p = origin.clone().addScaledVector(right, u).setY(origin.y + h).addScaledVector(normal, -0.36);
        this.flatBatch.add(this.flatSlab, p, v(0.27, 0.27, 0.8), new THREE.Euler(0, yaw, rnd() * 0.5), 1.2 + rnd() * 0.12, new THREE.Color(1.05, 0.95, 0.85));
      }
  }

  boulder(p: THREE.Vector3, s: number | THREE.Vector3, groundY = p.y, collide = true): void {
    const rnd = this.rnd;
    const geo = this.rocks[Math.floor(rnd() * this.rocks.length)];
    const yaw = rnd() * 6;
    this.rockBatch.add(geo, p, s, yaw, 0.75 + rnd() * 0.3);
    if (collide) addRockCollider(this.ctx.world, geo, p, typeof s === 'number' ? v(s, s, s) : s, yaw, groundY);
  }

  /** Glyph stela (4 glyph faces in the atlas). */
  stela(p: THREE.Vector3, yaw: number, glyph: number, lean = 0, size = 1): void {
    const g = new THREE.BoxGeometry(0.7 * size, 1.6 * size, 0.35 * size);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (glyph + uv.getX(i)) / 4);
    const m = new THREE.Mesh(g, this.glyphMat);
    m.position.copy(p).setY(p.y + 0.7 * size);
    m.rotation.set(lean, yaw, lean * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    this.props.add(m);
    this.ctx.world.addBox(m.position, v(0.35 * size, 0.8 * size, 0.2 * size), yaw);
  }

  muralPanel(p: THREE.Vector3, yaw: number, w: number, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), this.muralMat);
    m.position.copy(p);
    m.rotation.y = yaw;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Place a prop on the given ground height; adds to the merged static props. */
  place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, yaw = 0, parent: THREE.Object3D = this.props): T {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    parent.add(o);
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.receiveShadow = true;
    });
    return o;
  }

  // ------------------------------------------------------------------ vegetation
  private makeMatrix(x: number, y: number, z: number, s: number, yaw: number, tilt = 0): THREE.Matrix4 {
    const rnd = this.rnd;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (rnd() - 0.5), yaw, tilt * (rnd() - 0.5)));
    return new THREE.Matrix4().compose(v(x, y, z), q, v(s, s * (0.85 + rnd() * 0.3), s));
  }

  /** Scatter instances in an XZ area where `accept` passes; y from `ground`. */
  scatter(n: number, area: [number, number, number, number], ground: (x: number, z: number) => number, accept: (x: number, z: number) => boolean, size: [number, number], opts: { tilt?: number; sink?: number } = {}): THREE.Matrix4[] {
    const out: THREE.Matrix4[] = [];
    const rnd = this.rnd;
    let tries = 0;
    while (out.length < n && tries < n * 14) {
      tries++;
      const x = area[0] + rnd() * (area[2] - area[0]);
      const z = area[1] + rnd() * (area[3] - area[1]);
      if (!accept(x, z)) continue;
      out.push(this.makeMatrix(x, ground(x, z) - (opts.sink ?? 0.05), z, size[0] + rnd() * (size[1] - size[0]), rnd() * 6, opts.tilt ?? 0));
    }
    return out;
  }

  private tints(n: number, j: number): THREE.Color[] {
    const rnd = this.rnd;
    return Array.from({ length: n }, () => new THREE.Color(1 - j / 2 + rnd() * j, 1 - j / 2 + rnd() * j, 1 - j / 2 + rnd() * j));
  }

  addVeg(ci: ChunkedInstances, mats: THREE.Matrix4[], jitter = 0.3): ChunkedInstances {
    ci.build(mats, this.tints(mats.length, jitter));
    this.root.add(ci.group);
    this.vegetation.push(ci);
    return ci;
  }

  grass(mats: THREE.Matrix4[]): void {
    const geo = this.track(grassGeometry(0.62, 0.8));
    const ci = new ChunkedInstances(geo, this.foliage.grass.material, { chunkSize: 34, name: 'grass' });
    ci.maxDistance = this.ctx.quality().grassDistance;
    this.addVeg(ci, mats, 0.35);
  }

  ferns(mats: THREE.Matrix4[], variant = 1): void {
    const geo = this.track(variant === 1 ? fernGeometry(1) : fernGeometry(2, 11, 1.3));
    const ci = new ChunkedInstances(geo, this.foliage.fern.material, { chunkSize: 44, castShadow: true, depthMaterial: this.foliage.fern.depth, name: 'ferns' });
    ci.maxDistance = this.ctx.quality().vegetationDistance * 0.55;
    this.addVeg(ci, mats);
  }

  broadleaf(mats: THREE.Matrix4[], variant = 1): void {
    const geo = this.track(variant === 1 ? broadleafGeometry(4) : broadleafGeometry(5, 8, 1.5));
    const ci = new ChunkedInstances(geo, this.foliage.leaf.material, { chunkSize: 44, castShadow: true, depthMaterial: this.foliage.leaf.depth, name: 'broadleaf' });
    ci.maxDistance = this.ctx.quality().vegetationDistance * 0.6;
    this.addVeg(ci, mats);
  }

  /** Trees at explicit matrices; returns trunk positions for colliders. */
  trees(mats: THREE.Matrix4[], kind: 'giant' | 'slender', seed: number, collide = true): void {
    const t = rainforestTree(seed * 17, kind);
    this.track(t.bark);
    this.track(t.leaves);
    this.track(t.leavesLod);
    const q = this.ctx.quality();
    const barkCI = new ChunkedInstances(t.bark, this.barkMat, { chunkSize: 64, castShadow: true, name: 'trunks' });
    barkCI.maxDistance = q.vegetationDistance;
    this.addVeg(barkCI, mats, 0);
    const leafCI = new ChunkedInstances(t.leaves, this.foliage.canopy.material, { chunkSize: 64, castShadow: true, depthMaterial: this.foliage.canopy.depth, lodGeometry: t.leavesLod, name: 'canopy' });
    leafCI.maxDistance = q.vegetationDistance;
    leafCI.lodDistance = q.vegetationDistance * 0.45;
    this.addVeg(leafCI, mats, 0.25);
    if (collide)
      for (const m of mats) {
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        this.ctx.world.addCylinder(p.clone().setY(p.y + 2.3), t.trunkRadius * 1.25, 2.6, { surface: 'wood' });
      }
  }

  treeFerns(mats: THREE.Matrix4[]): void {
    const t = treeFernGeometry(9);
    this.track(t.bark);
    this.track(t.leaves);
    for (const mm of mats) {
      const tp = new THREE.Vector3().setFromMatrixPosition(mm);
      this.ctx.world.addCylinder(tp.clone().setY(tp.y + 1.5), 0.24, 1.6, { surface: 'wood', blocksCamera: false });
    }
    const q = this.ctx.quality();
    const b = new ChunkedInstances(t.bark, this.barkMat, { chunkSize: 40, castShadow: true, name: 'treefern-trunk' });
    b.maxDistance = q.vegetationDistance;
    this.addVeg(b, mats, 0);
    const l = new ChunkedInstances(t.leaves, this.foliage.palm.material, { chunkSize: 40, castShadow: true, depthMaterial: this.foliage.palm.depth, name: 'treefern' });
    l.maxDistance = q.vegetationDistance;
    this.addVeg(l, mats, 0.2);
  }

  farTrees(mats: THREE.Matrix4[]): void {
    const geo = this.track(farTreeGeometry(5));
    const ci = new ChunkedInstances(geo, this.foliage.far.material, { chunkSize: 70, castShadow: false, name: 'far-forest' });
    ci.maxDistance = 700;
    this.addVeg(ci, mats, 0.35);
  }

  vines(mats: THREE.Matrix4[], len: number, seed: number): void {
    const g = this.track(vineGeometry(seed, len));
    const ci = new ChunkedInstances(g, this.foliage.vine.material, { chunkSize: 90, name: 'vines' });
    ci.maxDistance = this.ctx.quality().vegetationDistance;
    this.addVeg(ci, mats, 0.2);
  }

  vineMatrix(x: number, topY: number, z: number, len: number, yaw: number): THREE.Matrix4 {
    return this.makeMatrix(x, topY - len + 0.1, z, 1, yaw);
  }

  // ------------------------------------------------------------------ water
  waterfall(top: THREE.Vector3, bottom: THREE.Vector3, width: number, outward: THREE.Vector3, poolY: number, buildFX: typeof import('../../world/WaterfallFX').buildWaterfallFX, extra: { throwDist?: number; rippleRadius?: number } = {}): THREE.Object3D {
    const fx = buildFX({ ...extra, top, bottom, width, outward, material: this.fallMat, poolY, dot: this.texture('tex.dot'), mist: this.texture('tex.mist'), particleScale: this.ctx.quality().particleScale });
    this.root.add(fx);
    return fx;
  }

  waterPlane(cx: number, y: number, cz: number, w: number, d: number, yaw = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(flowPlaneGeometry(w, d), this.waterMat);
    m.position.set(cx, y, cz);
    m.rotation.y = yaw;
    m.renderOrder = 2;
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------------ distant ridges
  ridges(center: THREE.Vector3, rings: [number, number, THREE.Color][]): void {
    rings.forEach(([radius, height, color], ri) => {
      const segs = 180;
      const posA: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const n = fbm2(Math.cos(a) * 2.2 + ri + 1, Math.sin(a) * 2.2 - ri - 1, 5);
        const hgt = height * (0.55 + n * 0.8) + (Math.abs(Math.sin(a * 0.5)) < 0.2 ? height * 0.3 : 0);
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        posA.push(x, -160, z, x, hgt, z);
        if (i < segs) {
          const k = i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const g = this.track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.track(new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide })));
      m.position.copy(center);
      m.name = 'ridge';
      this.root.add(m);
    });
  }

  /**
   * Distant carved city on a gorge wall: terraces stepping down with dark doorways, stairs and
   * a few hanging gardens. Vista only (no colliders). `facing` is the wall's outward normal.
   */
  cityBackdrop(origin: THREE.Vector3, along: THREE.Vector3, facing: THREE.Vector3, length: number, levels: number, levelHeight: number): void {
    const rnd = this.rnd;
    const hole = this.track(new THREE.BoxGeometry(1, 1, 1));
    const holes = new InstanceBatch();
    const a = along.clone().normalize();
    const f = facing.clone().setY(0).normalize();
    const yaw = Math.atan2(a.x, a.z);
    for (let lv = 0; lv < levels; lv++) {
      const y = origin.y - lv * levelHeight;
      const depth = 3 + rnd() * 2;
      // Terrace platform along the wall
      for (let s = 0; s < length; s += 6 + rnd() * 3) {
        const w = 5 + rnd() * 4;
        const p = origin.clone().addScaledVector(a, s + w / 2).addScaledVector(f, depth / 2 + lv * 0.6).setY(y);
        this.darkBatch.add(this.block, p, v(depth, 1.2, w), yaw, 0.8 + rnd() * 0.2);
        // Houses with doorways
        if (rnd() < 0.7) {
          const hh = 2.4 + rnd() * 1.8;
          const hp = p.clone().addScaledVector(f, -depth * 0.25).setY(y + 0.6 + hh / 2);
          this.masonBatch.add(this.block, hp, v(depth * 0.5, hh, w * 0.7), yaw, 0.85 + rnd() * 0.2);
          const dp = hp.clone().addScaledVector(f, depth * 0.26).setY(y + 0.6 + 0.9);
          holes.add(hole, dp, v(0.12, 1.6, 0.9), yaw, 1);
          if (rnd() < 0.5) holes.add(hole, dp.clone().addScaledVector(a, w * 0.22).setY(dp.y + 0.8), v(0.12, 0.6, 0.6), yaw, 1);
        }
      }
    }
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x070605, roughness: 1 }));
    const hb = holes.build(dark, { castShadow: false, name: 'city-holes' });
    if (hb.length) this.root.add(...hb);
  }

  // ------------------------------------------------------------------ particles & light
  particles(kind: ParticleKind, count: number, center: THREE.Vector3, size: THREE.Vector3, color: THREE.Color, pointSize: number, opacity: number, seed: number, tex: 'tex.dot' | 'tex.mist' | 'tex.leaf' = 'tex.dot'): THREE.Points {
    const p = ambientParticles({ kind, count: Math.max(4, Math.round(count * this.ctx.quality().particleScale)), center, size, texture: this.texture(tex), color, pointSize, opacity, seed });
    this.root.add(p);
    this.ambient.push(p);
    return p;
  }

  bursts(n = 700, color = new THREE.Color(0.42, 0.38, 0.32)): BurstPool {
    const b = new BurstPool(n, this.texture('tex.mist'), color, 0.55, 3);
    this.root.add(b.points);
    return b;
  }

  shaft(top: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, color: THREE.Color, intensity: number): THREE.Mesh {
    const mat = this.track(createShaftMaterial(color, intensity));
    const s = lightShaft(top, dir.clone().normalize(), len, r0, r1, mat);
    this.root.add(s);
    this.shafts.push(s);
    return s;
  }

  /** Glints over collectibles (diegetic "something catches the light"). */
  glints(n: number): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
    const m = this.track(new THREE.PointsMaterial({ map: this.texture('tex.dot'), size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.3, 0.9) }));
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.root.add(pts);
    return pts;
  }

  // ------------------------------------------------------------------ finish
  /** Build instance batches and merge the static props (call once at the end of the build). */
  finish(): void {
    for (const k of this.keep) {
      if (!k.parent || k.parent === this.root) continue;
      k.updateWorldMatrix(true, true);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      const ws = new THREE.Vector3();
      k.matrixWorld.decompose(wp, wq, ws);
      this.root.add(k);
      k.position.copy(wp);
      k.quaternion.copy(wq);
      k.scale.copy(ws);
    }
    this.props.removeFromParent();
    this.root.add(mergeStatic(this.props, 'props'));
    const addAll = (list: THREE.Object3D[]) => list.length && this.root.add(...list);
    addAll(this.cliffBatch.build(this.cliffMat, { name: 'cliff', chunk: this.chunk }));
    addAll(this.flatBatch.build(this.cliffMat, { name: 'climb-faces', chunk: this.chunk }));
    addAll(this.masonBatch.build(this.masonMat, { name: 'masonry', chunk: this.chunk }));
    addAll(this.darkBatch.build(this.darkMat, { name: 'masonry-dark', chunk: this.chunk }));
    addAll(this.rockBatch.build(this.rockMat, { name: 'rocks', chunk: this.chunk }));
    addAll(this.soilBatch.build(this.soilMat, { name: 'soil', castShadow: false }));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const vv of this.vegetation) vv.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.env?.dispose();
    const scene = this.ctx.scene;
    scene.remove(this.root);
    scene.environment = null;
    scene.background = null;
    scene.fog = null;
  }
}

export function texelSnap(focus: THREE.Vector3, size: number, range: number): THREE.Vector3 {
  const texel = (range * 2) / size;
  return v(Math.round(focus.x / texel) * texel, focus.y, Math.round(focus.z / texel) * texel);
}
