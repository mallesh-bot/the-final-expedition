import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChapterContext } from '../Chapter';
import type { BoxCollider } from '../../physics/Colliders';
import { Heightfield } from '../../physics/Heightfield';
import { Sky } from '../../render/Sky';
import { fogUniforms, globalUniforms } from '../../render/HeightFog';
import type { PBRSet } from '../../render/textures/ProceduralTextures';
import {
  createFoliageMaterial,
  createWaterMaterial,
  createWaterfallMaterial,
  createWorldMaterial,
} from '../../render/materials/WorldMaterials';
import { TerrainTiles } from '../../world/Terrain';
import { displacedRock, displacedSlab, InstanceBatch } from '../../world/RockKit';
import {
  ChunkedInstances,
  broadleafGeometry,
  farTreeGeometry,
  fernGeometry,
  grassGeometry,
  rainforestTree,
  treeFernGeometry,
  vineGeometry,
} from '../../world/Vegetation';
import { riverMesh } from '../../world/Water';
import { buildWaterfallFX } from '../../world/WaterfallFX';
import { buildGorge } from './Ch1Gorge';
import { ambientParticles, BurstPool } from '../../world/Particles';
import { createShaftMaterial, lightShaft } from '../../world/LightShafts';
import * as P from '../../world/Props';
import { mergeStatic } from '../../world/StaticMerge';
import { fbm2, mulberry32 } from '../../systems/noise';
import {
  CAMP,
  CLIFF_BOXES,
  CLIMB_A,
  CLIMB_B,
  DRUMS,
  DRUM_Z,
  GATE,
  LANDING_FIRE,
  PLATEAU_PATH,
  PLATEAU_STREAM,
  PLATEAU_Y,
  POOL,
  STREAM,
  SUN_DIR,
  TOBY_SEAT,
  TRAIL,
  TRAVERSAL,
  distToPolyline,
  riverZ,
  terrainHeight,
  terrainSplat,
  vegetationMask,
} from './layout';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface Ch1World {
  root: THREE.Group;
  sky: Sky;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fireLight: THREE.PointLight;
  lanternLight: THREE.PointLight;
  flames: THREE.Object3D | null;
  vegetation: ChunkedInstances[];
  door: THREE.Object3D;
  doorCollider: BoxCollider;
  gateWallColliders: BoxCollider[];
  gorge: THREE.Group;
  drums: THREE.Object3D[];
  drumGlow: THREE.MeshStandardMaterial;
  pickups: Record<string, THREE.Object3D>;
  glints: THREE.Points;
  theodoliteHead: THREE.Object3D;
  theodolitePos: THREE.Vector3;
  bursts: BurstPool;
  ambient: THREE.Points[];
  shafts: THREE.Mesh[];
  shaftMat: THREE.ShaderMaterial;
  toby: THREE.Object3D | null;
  heightfield: Heightfield;
  terrain: TerrainTiles;
  lintel: THREE.Vector3;
  terraceColliders: BoxCollider[];
  gorgeMist: THREE.Points;
  dispose: () => void;
}

type Tex = (k: string) => PBRSet;

export async function buildCh1World(ctx: ChapterContext, tex: Tex, texture: (k: string) => THREE.Texture, step: (f: number, label: string) => Promise<void>): Promise<Ch1World> {
  const scene = ctx.scene;
  const world = ctx.world;
  const root = new THREE.Group();
  root.name = 'ch1';
  scene.add(root);
  const rnd = mulberry32(1958);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ================================================================== atmosphere
  await step(0.02, 'Lighting the valley');
  const sunCol = new THREE.Color(1.0, 0.7, 0.46);
  const sky = new Sky({
    sunDir: SUN_DIR,
    zenith: new THREE.Color(0.1, 0.19, 0.27),
    horizon: new THREE.Color(0.48, 0.56, 0.56),
    sunHorizon: new THREE.Color(1.25, 0.74, 0.44),
    sunColor: new THREE.Color(1.6, 0.95, 0.6),
    ground: new THREE.Color(0.2, 0.24, 0.23),
    cloudCover: 0.5,
    sunIntensity: 22,
  });
  root.add(sky.mesh);
  const env = sky.bakeEnvironment(ctx.renderer.renderer);
  scene.environment = env;
  (scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.55;
  scene.background = null;
  scene.fog = new THREE.FogExp2(new THREE.Color(0.34, 0.42, 0.42), 0.0078);
  fogUniforms.fogSunDir.value.copy(SUN_DIR);
  fogUniforms.fogSunColor.value.setRGB(0.82, 0.54, 0.32);
  fogUniforms.fogSunPower.value = 10;
  fogUniforms.fogHeightBase.value = 0;
  fogUniforms.fogHeightFalloff.value = 0.055;
  globalUniforms.uSunDirWorld.value.copy(SUN_DIR);
  globalUniforms.uSunColor.value.copy(sunCol);
  globalUniforms.uWetness.value = 0.38;

  const sun = new THREE.DirectionalLight(sunCol, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -32;
  sc.right = 32;
  sc.top = 32;
  sc.bottom = -32;
  sc.near = 1;
  sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.66, 0.72), new THREE.Color(0.22, 0.19, 0.13), 0.62);
  root.add(hemi);

  // ================================================================== terrain
  await step(0.08, 'Shaping the terrain');
  const hf = new Heightfield(-170, -170, 400, 321, terrainHeight);
  world.heightfield = hf;
  world.terrainSurface = (x, z) => {
    const d = distToPolyline(x, z, TRAIL);
    if (d < 2.2 || Math.hypot(x - CAMP.x, z - CAMP.z) < 10) return 'mud';
    if (Math.abs(z - riverZ(x)) < 4.5) return 'water';
    if (z > 26 && distToPolyline(x, z, PLATEAU_PATH) > 3) return 'grass';
    return z > 26 ? 'stone' : 'leaves';
  };
  world.bounds = { minX: -40, maxX: 44, minZ: -65.5, maxZ: 62 };
  const ground = tex('tex.ground');
  const stone = tex('tex.stone');
  const moss = tex('tex.moss');
  const terrainMat = createWorldMaterial({
    set: ground,
    splat: { grass: texture('tex.grass'), rock: stone, rockScale: 0.14 },
    triScale: 0.3,
    vertexColors: true,
    roughness: 0.95,
    normalScale: 1.1,
  });
  const terrain = new TerrainTiles(hf, terrainSplat, terrainMat, 40);
  root.add(terrain.group);
  track(terrain);
  track(terrainMat);

  // ================================================================== materials
  const rockMat = createWorldMaterial({ set: stone, moss: { set: moss, amount: 0.95, min: 0.3 }, triScale: 0.22, vertexColors: true, roughness: 0.92 });
  const cliffSet = tex('tex.cliff');
  const cliffMat = createWorldMaterial({ set: cliffSet, moss: { set: moss, amount: 0.8, min: 0.5 }, triScale: 0.12, vertexColors: true, roughness: 0.95, normalScale: 1.2 });
  const masonSet = tex('tex.mason');
  const masonMat = createWorldMaterial({ set: masonSet, moss: { set: moss, amount: 0.85, min: 0.42 }, triScale: 0.32, vertexColors: true, roughness: 0.9 });
  const bark = tex('tex.bark');
  const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.92, color: 0xb8b0a0 });
  const atlas = texture('tex.foliage');
  const a2c = ctx.quality().antialias === 'msaa';
  const grassF = createFoliageMaterial({ map: atlas, swayHeight: 0.7, swayAmount: 0.18, color: 0xb8c290, translucency: 0.3, alphaTest: 0.45, alphaToCoverage: a2c, push: 0.55 });
  const fernF = createFoliageMaterial({ map: atlas, swayHeight: 0.9, swayAmount: 0.12, color: 0xb0c098, translucency: 0.3, alphaToCoverage: a2c, push: 0.75 });
  const leafF = createFoliageMaterial({ map: atlas, swayHeight: 1.3, swayAmount: 0.14, color: 0xa8bc90, translucency: 0.32, alphaToCoverage: a2c, push: 0.95 });
  const canopyF = createFoliageMaterial({ map: atlas, swayHeight: 24, swayAmount: 0.45, color: 0x8ea070, translucency: 0.28, alphaToCoverage: a2c });
  const palmF = createFoliageMaterial({ map: atlas, swayHeight: 5, swayAmount: 0.25, color: 0xb0c096, translucency: 0.3, alphaToCoverage: a2c });
  const vineF = createFoliageMaterial({ map: atlas, swayHeight: 8, swayAmount: 0.1, color: 0xa8b890, translucency: 0.4, alphaToCoverage: a2c });
  const blobMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false });
  for (const m of [rockMat, cliffMat, masonMat, barkMat, blobMat, grassF.material, fernF.material, leafF.material, canopyF.material, palmF.material, vineF.material]) track(m);
  const PM = P.createPropMaterials({ wood: tex('tex.wood'), canvas: tex('tex.canvas'), rust: tex('tex.rust') });

  // ================================================================== water
  await step(0.18, 'Filling the river');
  const waterMat = createWaterMaterial(texture('tex.waterN'), env);
  track(waterMat);
  const riverPts: THREE.Vector3[] = [];
  for (let x = -170; x <= 170; x += 10) riverPts.push(v(x, -0.62, riverZ(x)));
  root.add(riverMesh(riverPts, (t) => 15 + Math.sin(t * 17) * 2, waterMat, 160));
  const streamPts = STREAM.map(([x, z]) => v(x, Math.min(terrainHeight(x, z) + 0.45, -0.35), z));
  streamPts[0].y = -0.55;
  root.add(riverMesh(streamPts, 2.4, waterMat, 80));
  const pool = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32).rotateX(-Math.PI / 2), waterMat);
  pool.position.set(POOL.x, -0.5, POOL.z);
  pool.renderOrder = 2;
  root.add(pool);
  const plateauStream = PLATEAU_STREAM.map(([x, z]) => v(x, PLATEAU_Y - 0.28, z));
  root.add(riverMesh(plateauStream, 1.4, waterMat, 30));
  const fallMat = createWaterfallMaterial(texture('tex.waterfall'));
  track(fallMat);
  fallMat.uniforms.uTime = globalUniforms.uTime;
  Object.assign(fallMat.uniforms, fogUniforms);
  root.add(buildWaterfallFX({ top: v(-16.2, PLATEAU_Y - 0.1, 23.2), bottom: v(-16.2, -0.4, 21.0), width: 2.6, outward: v(0, 0, -1), material: fallMat, poolY: -0.5, dot: texture('tex.dot'), mist: texture('tex.mist'), particleScale: ctx.quality().particleScale }));

  // ================================================================== cliff + rocks
  await step(0.26, 'Raising the red-rock cliff');
  const slabs = [0, 1, 2, 3, 4, 5].map((i) => displacedSlab(100 + i, 4, 4, 2, 0.32, 9, 0.35));
  const flatSlab = displacedSlab(200, 3, 3, 1, 0.07, 10, 0.12);
  const stepSlab = displacedSlab(300, 1, 1, 1, 0.025, 6, 0.06);
  const rocks = [0, 1, 2, 3, 4].map((i) => displacedRock(10 + i, i < 2 ? 3 : 2, 0.32 + i * 0.03, 0.72));
  const cliffBatch = new InstanceBatch();
  const flatBatch = new InstanceBatch();
  const masonBatch = new InstanceBatch();
  const rockBatch = new InstanceBatch();
  const reddish = new THREE.Color(1.0, 0.86, 0.78);

  const inClimb = (x: number, y: number) =>
    (x > 8.2 && x < 11.8 && y < 4.7) || (x > 27.4 && x < 30.1 && y > 8.3 && y < 12.1);

  for (const b of CLIFF_BOXES) {
    const wc = world.addBox(b.c, b.h, 0, { surface: 'stone' });
    if (b.kind === 'step' || b.kind === 'shelf') {
      // Carved Ysharu masonry: visuals match the collider exactly.
      masonBatch.add(stepSlab, b.c.clone(), v(b.h.x * 2, b.h.y * 2, b.h.z * 2), 0, 0.95 + rnd() * 0.1);
      continue;
    }
    void wc;
    const front = b.c.z - b.h.z;
    const x0 = b.c.x - b.h.x;
    const x1 = b.c.x + b.h.x;
    const y1 = b.c.y + b.h.y;
    const y0 = b.c.y - b.h.y;
    for (let x = x0 + 1.6; x < x1 + 1.0; x += 2.8 + rnd() * 1.2) {
      for (let y = y0 + 1.5; y < y1 + 0.5; y += 3.2 + rnd() * 0.8) {
        const cx = Math.min(x, x1 - 0.8);
        const cy = Math.min(y, y1 - 1.2);
        if (inClimb(cx, cy)) continue;
        const s = v(0.95 + rnd() * 0.5, 0.95 + rnd() * 0.4, 1);
        // Faces behind walkable routes (shelf / narrow ledge / stair) sit further back so the
        // dressing never intrudes into the path.
        const behindRoute = b.c.z - b.h.z > 23.7 && cy < 10.5 && cx > 6 && cx < 31.5;
        cliffBatch.add(slabs[Math.floor(rnd() * slabs.length)], v(cx, cy, front + (behindRoute ? 1.35 : 1.1) + rnd() * 0.15), s, new THREE.Euler((rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.3), 0.8 + rnd() * 0.3, reddish);
      }
    }
    // Rim boulders along the top edge for a broken silhouette.
    if (y1 > 11) {
      for (let x = x0 + 1; x < x1; x += 2.2 + rnd() * 2) {
        if (x > 21 && x < 32) continue; // keep the ridge-top route and climb-up clear
        rockBatch.add(rocks[Math.floor(rnd() * rocks.length)], v(x, y1 - 0.1, front + 0.3 + rnd() * 0.3), v(0.8 + rnd() * 0.6, 0.5 + rnd() * 0.4, 0.6 + rnd() * 0.3), rnd() * 6, 0.85 + rnd() * 0.25);
      }
    }
  }
  // Climb surfaces: flatter pale "worn" stone, flush with the collider faces.
  for (const c of [CLIMB_A, CLIMB_B]) {
    for (let u = 0.6; u < c.width; u += 1.3)
      for (let h = 0.9; h < c.height; h += 1.4) {
        const p = c.origin.clone().addScaledVector(c.right, u).setY(c.origin.y + h);
        p.z += 0.42;
        flatBatch.add(flatSlab, p, v(0.55, 0.55, 0.9), new THREE.Euler(0, 0, rnd() * 0.4), 1.25 + rnd() * 0.1, new THREE.Color(1.05, 0.95, 0.85));
      }
  }
  // Shelf cap rocks, ledge lips (pale), and the blocking boulders above ledge B
  masonBatch.add(stepSlab, v(10, 4.45, 23.2), v(6, 0.3, 1.25), 0, 1.15);
  masonBatch.add(stepSlab, v(27.3, 11.85, 23.95), v(6.5, 0.3, 0.45), 0, 1.25);
  masonBatch.add(stepSlab, v(10, 4.5, 22.75), v(3.2, 0.2, 0.35), 0, 1.3);
  for (const x of [27.2, 28.9, 30.4]) rockBatch.add(rocks[2], v(x, 12.8, 24.8), v(1.3, 1.1, 1.1), rnd() * 6, 0.9);

  // Scatter boulders across the valley and plateau.
  for (let i = 0; i < 190; i++) {
    const x = -38 + rnd() * 80;
    const z = -62 + rnd() * 112;
    if (z > 20 && z < 28) continue;
    const m = vegetationMask(x, z);
    if (m < 0.6) continue;
    const y = terrainHeight(x, z);
    const s = 0.3 + Math.pow(rnd(), 2.5) * 2.4;
    rockBatch.add(rocks[i % rocks.length], v(x, y - s * 0.25, z), v(s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.4), s * (0.8 + rnd() * 0.5)), rnd() * 6, 0.75 + rnd() * 0.35);
    if (s > 0.5) world.addCylinder(v(x, y + (s * 0.55 - 0.5) / 2, z), s * 0.82, (s * 0.55 + 0.5) / 2, { surface: 'stone' });
  }
  // Boulders around the pool and stream + stepping stones.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 5 + rnd() * 1.4;
    const x = POOL.x + Math.cos(a) * r;
    const z = POOL.z + Math.sin(a) * r * 0.8;
    const s = 0.6 + rnd() * 1.1;
    rockBatch.add(rocks[i % rocks.length], v(x, terrainHeight(x, z) - 0.1, z), s, rnd() * 6, 0.7 + rnd() * 0.2);
    world.addCylinder(v(x, terrainHeight(x, z) + s * 0.3, z), s * 0.85, s * 0.45 + 0.3, { surface: 'stone' });
  }
  // Cliff-base rubble
  for (let i = 0; i < 40; i++) {
    const x = -28 + rnd() * 60;
    const z = 20.2 + rnd() * 2.2;
    if (x > 7.5 && x < 12.5) continue;
    const s = 0.4 + rnd() * 1.2;
    rockBatch.add(rocks[i % rocks.length], v(x, terrainHeight(x, z) - 0.15, z), v(s * 1.2, s * 0.8, s), rnd() * 6, 0.75 + rnd() * 0.2);
    if (s > 0.55) world.addCylinder(v(x, terrainHeight(x, z) + s * 0.25, z), s * 1.0, s * 0.45 + 0.3, { surface: 'stone' });
  }
  // Vault column side-blockers on the plateau (so the fallen column must be vaulted).
  const vb = TRAVERSAL.vaults[0];
  const vAxis = v(Math.cos(vb.yaw), 0, -Math.sin(vb.yaw));
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const p = vb.center.clone().addScaledVector(vAxis, sgn * (vb.half.x + 0.8 + k * 1.6));
      p.y = PLATEAU_Y;
      const s = 1.3 + rnd() * 0.6;
      rockBatch.add(rocks[k], p.clone().setY(PLATEAU_Y + s * 0.3), v(s, s * 1.1, s), rnd() * 6, 0.8);
      world.addBox(p.clone().setY(PLATEAU_Y + s * 0.6), v(s * 0.9, s * 0.8, s * 0.9), vb.yaw, { surface: 'stone' });
    }
  }
  // Fallen column (vault) — carved drum segments.
  {
    const colGeo = new THREE.CylinderGeometry(0.48, 0.5, 1.5, 16, 3);
    colGeo.rotateZ(Math.PI / 2);
    colGeo.deleteAttribute('uv');
    const cg = colGeo.toNonIndexed();
    const cc = new Float32Array(cg.attributes.position.count * 3).fill(0.95);
    cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    cg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count * 2), 2));
    for (let k = -1; k <= 1; k++) {
      const p = vb.center.clone().addScaledVector(vAxis, k * 1.6);
      masonBatch.add(cg, p, 1, new THREE.Euler(0, vb.yaw, (rnd() - 0.5) * 0.08), 0.95);
    }
    world.addBox(vb.center, vb.half, vb.yaw, { surface: 'stone' });
  }

  // Static props/dressing are collected here and merged into a few draw calls at the end.
  const props = new THREE.Group();
  props.name = 'props';
  root.add(props);
  await step(0.36, 'Carving the ruins');
  // ================================================================== Ysharu ruins (valley watchpost)
  const block = displacedSlab(400, 1, 1, 1, 0.04, 3, 0.07);
  const addBlock = (p: THREE.Vector3, s: THREE.Vector3, yaw = 0, collide = true, tint = 1) => {
    masonBatch.add(block, p, s, yaw, tint);
    if (collide) world.addBox(p, s.clone().multiplyScalar(0.5), yaw, { surface: 'stone' });
  };
  {
    const base = v(-9, terrainHeight(-9, 1), 1);
    // L-shaped broken wall
    for (let i = 0; i < 6; i++) {
      const h = 3 - Math.abs(i - 2) * 0.55 - rnd() * 0.4;
      for (let k = 0; k < Math.max(1, Math.round(h / 0.6)); k++) addBlock(base.clone().add(v(i * 1.05 - 2.5, 0.3 + k * 0.6, 0)), v(1, 0.58, 0.9), 0, true, 0.9 + rnd() * 0.15);
    }
    for (let i = 1; i < 4; i++) {
      const h = 2.2 - i * 0.4;
      for (let k = 0; k < Math.round(h / 0.6); k++) addBlock(base.clone().add(v(-2.95, 0.3 + k * 0.6, -i * 1.05)), v(0.9, 0.58, 1), 0, true, 0.9);
    }
    // Tumbled blocks
    for (let i = 0; i < 7; i++) addBlock(base.clone().add(v(-1 + rnd() * 5, 0.25, 1 + rnd() * 3)), v(0.9, 0.55, 0.8), rnd() * 3, true, 0.85);
  }
  // Carved stelae along the trail (glyph faces)
  const glyphs = tex('tex.glyphs');
  const glyphMat = new THREE.MeshStandardMaterial({ map: glyphs.map, normalMap: glyphs.normalMap, roughness: 0.9, color: 0xd8d0c0 });
  track(glyphMat);
  const stela = (x: number, z: number, yaw: number, glyphIndex: number, lean = 0) => {
    const g = new THREE.BoxGeometry(0.7, 1.6, 0.35);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (glyphIndex + uv.getX(i)) / 4);
    const m = new THREE.Mesh(g, glyphMat);
    m.position.set(x, terrainHeight(x, z) + 0.7, z);
    m.rotation.set(lean, yaw, lean * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    props.add(m);
    world.addBox(m.position, v(0.35, 0.8, 0.2), yaw);
  };
  stela(5.2, -33, -0.4, 0, 0.08);
  stela(-3.5, -44, 0.5, 1, -0.12);
  stela(9, 9, -0.3, 2, 0.05);

  // ================================================================== mural (sun path) panels
  const mural = tex('tex.mural');
  const muralMat = new THREE.MeshStandardMaterial({ map: mural.map, normalMap: mural.normalMap, roughness: 0.92, color: 0xe0d8c8 });
  track(muralMat);
  const muralPanel = (p: THREE.Vector3, yaw: number, w: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), muralMat);
    m.position.copy(p);
    m.rotation.y = yaw;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  // Watchpost mural faces the trail (south-east)
  {
    const base = v(-9, terrainHeight(-9, 1), 1);
    addBlock(base.clone().add(v(0.2, 1.1, -0.62)), v(3.2, 2.2, 0.3), 0, false, 1.0);
    muralPanel(base.clone().add(v(0.2, 1.25, -0.8)), Math.PI, 2.8);
  }

  await step(0.44, 'Pitching Camp Four');
  // ================================================================== Camp Four
  const place = (o: THREE.Object3D, x: number, z: number, yaw = 0, yOff = 0) => {
    o.position.set(x, terrainHeight(x, z) + yOff, z);
    o.rotation.y = yaw;
    props.add(o);
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = c.castShadow || false;
        c.receiveShadow = true;
      }
    });
    return o;
  };
  place(P.tent(PM, 1, 0.65, true), -3.2, -6.2, 0.42);
  world.addBox(v(-3.2, 0.6, -6.2), v(1.3, 0.6, 0.9), 0.42, { surface: 'wood', blocksCamera: false });
  place(P.tent(PM, 2, 0.0, false), 6.4, -5.2, -0.34);
  world.addBox(v(6.4, 0.75, -5.2), v(1.3, 0.75, 1.0), -0.34, { surface: 'wood', blocksCamera: false });
  place(P.tent(PM, 3, 0.95, false), -1.5, -15.5, 1.2);
  place(P.cot(PM, true), 4.4, -3.4, 0.9);
  place(P.cot(PM, false), -5.2, -9.6, -0.3);
  place(P.table(PM), 0.6, -10.8, 0.15);
  world.addBox(v(0.9, 0.38, -10.8), v(0.95, 0.38, 0.45), 0.15, { surface: 'wood' });
  place(P.stove(PM), 3.4, -8.0, -0.6);
  place(P.campfire(PM, rockMat, false), 4.2, -10.6, 0);
  // Crate stacks — stencilled ALDERCOTT 1958, chalked DO NOT SHIP.
  const crates: [number, number, number, number, 'aldercott' | 'dns' | 'both' | 'none', boolean][] = [
    [7.4, -12.2, 0, 0.1, 'both', false],
    [8.4, -12.4, 0, -0.05, 'dns', false],
    [7.9, -12.3, 0.6, 0.2, 'both', false],
    [7.2, -13.6, 0, 0.5, 'dns', true],
    [9.3, -11.2, 0, -0.4, 'aldercott', false],
  ];
  for (const [x, z, y, yaw, st, open] of crates) {
    const c = place(P.crate(PM, 0.9, 0.6, 0.6, st, open), x, z, yaw, y);
    if (y === 0) world.addBox(v(x, c.position.y + 0.3, z), v(0.45, 0.3, 0.3), yaw, { surface: 'wood' });
  }
  world.addBox(v(7.9, 0.9, -12.3), v(0.45, 0.3, 0.3), 0.2, { surface: 'wood' });
  const mast = place(P.radioMast(PM, 7.5), -6, -12.5, 0.4);
  world.addBox(v(-6, 1, -12.5), v(0.3, 1, 0.3), 0, { surface: 'metal', blocksCamera: false });
  void mast;
  const theo = place(P.theodolite(PM), 2.8, -1.8, 0);
  const theoHead = theo.getObjectByName('head')!;
  // Aim the theodolite up at the gate (Anselm Roy's last sighting).
  {
    const hw = new THREE.Vector3();
    theoHead.getWorldPosition(hw);
    const aim = GATE.clone().add(v(0, 3, 0));
    const d = aim.clone().sub(hw);
    theoHead.rotation.set(-Math.atan2(d.y, Math.hypot(d.x, d.z)), Math.atan2(d.x, d.z), 0);
  }
  world.addBox(v(2.8, 0.7, -1.8), v(0.35, 0.7, 0.35), 0, { surface: 'wood', blocksCamera: false });
  place(P.signBoard(PM), 0.6, -21.8, 0.1);
  world.addBox(v(0.6, 0.75, -21.8), v(0.1, 0.75, 0.1));
  place(P.rucksack(PM), -0.2, -14.2, 0.7);
  place(P.lantern(PM, false), 6.9, -4.2, 0, 1.1);
  place(P.lantern(PM, false), 0.9, -10.6, 0, 0.76);

  // ================================================================== landing (Toby, fire, boat)
  const fire = place(P.campfire(PM, rockMat, true), LANDING_FIRE.x, LANDING_FIRE.z, 0);
  const flames = fire.getObjectByName('flames') ?? null;
  const fireLight = new THREE.PointLight(new THREE.Color(1.0, 0.6, 0.3), 14, 16, 2);
  fireLight.position.copy(LANDING_FIRE).add(v(0, 0.8, 0));
  fireLight.castShadow = false;
  root.add(fireLight);
  place(P.canoe(PM), -6, -65.6, 0.25, -0.45);
  const seat = place(P.crate(PM, 0.7, 0.45, 0.5, 'aldercott'), TOBY_SEAT.x, TOBY_SEAT.z, -0.9);
  void seat;
  place(P.crate(PM, 0.8, 0.5, 0.6, 'none'), 4, -60.2, 0.4);
  const lantern = place(P.lantern(PM, true), 4, -60.2, 0, 0.5);
  const lanternLight = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.4), 4, 9, 2);
  lanternLight.position.copy(lantern.position).add(v(0, 0.25, 0));
  root.add(lanternLight);
  place(P.rucksack(PM), 0.5, -61, 2.2);
  world.addBox(v(4, 0.25, -60.2), v(0.4, 0.25, 0.3), 0.4, { surface: 'wood' });
  world.addBox(v(-6, 0, -65.6), v(0.5, 0.5, 2.3), 0.25, { surface: 'wood' });

  // Toby (second lead) — temporary GLB, sitting by the fire.
  let toby: THREE.Object3D | null = null;
  {
    const t = ctx.createAvatar('toby');
    t.root.position.copy(TOBY_SEAT).setY(terrainHeight(TOBY_SEAT.x, TOBY_SEAT.z) + 0.02);
    t.root.rotation.y = Math.atan2(LANDING_FIRE.x - TOBY_SEAT.x, LANDING_FIRE.z - TOBY_SEAT.z);
    t.driver.setState('SIT', { fade: 0.01 });
    root.add(t.root);
    toby = t.root;
    toby.userData.avatar = t;
  }

  await step(0.52, 'Raising the Gate of the Watching Sun');
  // ================================================================== Gate of the Watching Sun
  const gz = GATE.z;
  const Y = PLATEAU_Y;
  // Pillars and lintel
  for (const x of [1.0, 7.0]) addBlock(v(x, Y + 3.6, gz), v(1.7, 7.2, 1.9), 0, true, 1.0);
  addBlock(v(4, Y + 7.9, gz), v(8.6, 1.5, 2.2), 0, false, 1.05);
  addBlock(v(4, Y + 8.9, gz + 0.2), v(6.2, 0.6, 1.6), 0, false, 0.95);
  // Stepped threshold
  addBlock(v(4, Y + 0.12, gz - 1.6), v(5.8, 0.24, 1.2), 0, false, 1.0);
  // Flanking masonry walls into the ridge
  const gateWallColliders: BoxCollider[] = [];
  for (const [x0, x1] of [
    [-30, 0.2],
    [7.8, 36],
  ] as const) {
    for (let x = x0; x < x1; x += 1.6) {
      const h = 3.6 + fbm2(x * 0.3, 1) * 1.5 + (Math.abs(x - 4) < 10 ? 1.4 : 0);
      for (let k = 0; k * 0.8 < h; k++) masonBatch.add(block, v(x + 0.8, Y + 0.4 + k * 0.8, gz + 0.3 + (k % 2) * 0.05), v(1.58, 0.78, 1.6), 0, 0.85 + rnd() * 0.2);
    }
    gateWallColliders.push(world.addBox(v((x0 + x1) / 2, Y + 4, gz + 0.3), v((x1 - x0) / 2, 4, 0.8)));
  }
  // Rock ridge behind the wall (hides the gorge until the gate opens)
  for (let x = -30; x < 36; x += 3.6) {
    if (x > -0.5 && x < 8.5) continue;
    cliffBatch.add(slabs[Math.floor(rnd() * slabs.length)], v(x, Y + 7 + rnd() * 3, gz + 3.2 + rnd()), v(1.2, 2.4 + rnd(), 1.4), rnd() * 0.3, 0.8 + rnd() * 0.2, reddish);
  }
  // Ridge behind the gate wall: two halves, leaving the passage through the gate.
  world.addBox(v(-15.75, Y + 8, gz + 3.5), v(15.25, 8, 2.2));
  world.addBox(v(22.75, Y + 8, gz + 3.5), v(14.25, 8, 2.2));
  // Murals flanking the gate
  muralPanel(v(-1.6, Y + 2.4, gz - 0.55), 0, 3.2);
  muralPanel(v(9.6, Y + 2.4, gz - 0.55), 0, 3.2);
  // "M.K." scratched into the right pillar base
  {
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: P_stencilMK(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 }));
    mk.position.set(1.35, Y + 0.55, gz - 0.96);
    root.add(mk);
  }
  // The door slab (sinks into the ground when the gate opens)
  const doorGeo = displacedSlab(501, 4.3, 6.8, 0.7, 0.03, 10, 0.05);
  const door = new THREE.Mesh(doorGeo, masonMat);
  door.position.set(4, Y + 3.4, gz + 0.1);
  door.castShadow = true;
  door.receiveShadow = true;
  root.add(door);
  // Sun disc carving on the door
  {
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), muralMat);
    disc.position.set(0, 0.8, -0.37);
    disc.rotation.y = Math.PI;
    disc.scale.x = -1;
    door.add(disc);
  }
  const doorCollider = world.addBox(door.position, v(2.15, 3.4, 0.4), 0, { dynamic: true });

  // Drums on pedestals
  const drumGlow = new THREE.MeshStandardMaterial({ map: glyphs.map, normalMap: glyphs.normalMap, roughness: 0.85, color: 0xe0d4bc, emissive: new THREE.Color(1.0, 0.5, 0.16), emissiveIntensity: 0, emissiveMap: glyphs.mask ?? null });
  track(drumGlow);
  const drumGeo = (() => {
    const g = new THREE.BoxGeometry(0.95, 1.05, 0.95);
    const uv = g.attributes.uv;
    // Box face order: +x, -x, +y, -y, +z, -z (4 verts each).  -z face = glyph 0, +x = 1, +z = 2, -x = 3
    const cellFor = [1, 3, -1, -1, 2, 0];
    for (let f = 0; f < 6; f++)
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const c = cellFor[f];
        if (c < 0) uv.setXY(i, 0.02 + uv.getX(i) * 0.04, 0.02 + uv.getY(i) * 0.04);
        else uv.setX(i, (c + uv.getX(i)) / 4);
      }
    return g;
  })();
  const drums: THREE.Object3D[] = [];
  for (const d of DRUMS) {
    addBlock(v(d.x, Y + 0.32, DRUM_Z), v(1.25, 0.64, 1.25), 0, true, 0.9);
    addBlock(v(d.x, Y + 1.78, DRUM_Z), v(1.2, 0.22, 1.2), 0, false, 1.0);
    const m = new THREE.Mesh(drumGeo, drumGlow);
    m.position.set(d.x, Y + 1.17, DRUM_Z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    drums.push(m);
  }
  // Plaza paving
  for (let i = 0; i < 26; i++) {
    const x = GATE.x - 6 + rnd() * 12;
    const z = 41.5 + rnd() * 7.5;
    masonBatch.add(block, v(x, Y - 0.08, z), v(1.1 + rnd() * 0.6, 0.2, 0.9 + rnd() * 0.5), rnd() * 0.3, 0.75 + rnd() * 0.2);
  }
  // Fallen Watcher sun-disc leaning on rocks — the recurring motif.
  {
    const geo = new THREE.CylinderGeometry(1.7, 1.7, 0.35, 32);
    geo.deleteAttribute('uv');
    const gg = geo.toNonIndexed();
    gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 3).fill(0.9), 3));
    gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
    const disc = new THREE.Mesh(gg, masonMat);
    disc.position.set(-6.5, Y + 1.5, 44.5);
    disc.rotation.set(Math.PI / 2 - 0.35, 0.6, 0.1);
    disc.castShadow = true;
    root.add(disc);
    world.addBox(v(-6.5, Y + 1.2, 44.5), v(1.4, 1.2, 0.6), 0.6);
  }

  await step(0.6, 'Seeding the forest');
  // ================================================================== vegetation
  const q = ctx.quality();
  const vegetation: ChunkedInstances[] = [];
  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const makeMatrix = (x: number, y: number, z: number, s: number, yaw: number, tilt = 0) => {
    quat.setFromEuler(new THREE.Euler(tilt * (rnd() - 0.5), yaw, tilt * (rnd() - 0.5)));
    return mtx.compose(pos.set(x, y, z), quat, scl.set(s, s * (0.85 + rnd() * 0.3), s)).clone();
  };
  const scatter = (
    n: number,
    area: [number, number, number, number],
    accept: (x: number, z: number, m: number) => boolean,
    make: (x: number, y: number, z: number) => THREE.Matrix4,
  ) => {
    const out: THREE.Matrix4[] = [];
    let tries = 0;
    while (out.length < n && tries < n * 12) {
      tries++;
      const x = area[0] + rnd() * (area[2] - area[0]);
      const z = area[1] + rnd() * (area[3] - area[1]);
      const m = vegetationMask(x, z);
      if (!accept(x, z, m)) continue;
      out.push(make(x, terrainHeight(x, z), z));
    }
    return out;
  };
  const clump = (x: number, z: number, freq: number, thr: number) => fbm2(x * freq + 11, z * freq - 7, 3) > thr;
  const tint = (base: THREE.Color, j: number) => new THREE.Color(base.r * (1 - j / 2 + rnd() * j), base.g * (1 - j / 2 + rnd() * j), base.b * (1 - j / 2 + rnd() * j));
  const addVeg = (ci: ChunkedInstances, mats: THREE.Matrix4[], colors?: THREE.Color[]) => {
    ci.build(mats, colors);
    root.add(ci.group);
    vegetation.push(ci);
    return ci;
  };

  // Grass
  {
    const geo = grassGeometry(0.62, 0.8);
    track(geo);
    const mats = scatter(18000, [-40, -64, 44, 50], (x, z, m) => m > 0.3 && (clump(x, z, 0.08, -0.15) || rnd() < 0.2) && (z < 20 || z > 27.5), (x, y, z) => makeMatrix(x, y - 0.03, z, 0.7 + rnd() * 0.7, rnd() * 6));
    const cols = mats.map(() => tint(new THREE.Color(1, 1, 1), 0.35));
    const ci = new ChunkedInstances(geo, grassF.material, { chunkSize: 34, name: 'grass' });
    ci.maxDistance = q.grassDistance;
    addVeg(ci, mats, cols);
  }
  // Ferns
  {
    const variants = [fernGeometry(1), fernGeometry(2, 11, 1.3)];
    variants.forEach((geo, vi) => {
      track(geo);
      const mats = scatter(1500, [-40, -64, 44, 50], (x, z, m) => m > 0.35 && clump(x + vi * 40, z, 0.06, -0.05) && (z < 20.5 || z > 28), (x, y, z) => makeMatrix(x, y - 0.05, z, 0.8 + rnd() * 0.9, rnd() * 6, 0.2));
      const ci = new ChunkedInstances(geo, fernF.material, { chunkSize: 44, castShadow: true, depthMaterial: fernF.depth, name: 'ferns' });
      ci.maxDistance = q.vegetationDistance * 0.55;
      addVeg(ci, mats, mats.map(() => tint(new THREE.Color(1, 1, 1), 0.3)));
    });
  }
  // Broadleaf understory (dense near cliff base, stream and trail edges)
  {
    const variants = [broadleafGeometry(4), broadleafGeometry(5, 8, 1.5)];
    variants.forEach((geo, vi) => {
      track(geo);
      const mats = scatter(700, [-40, -64, 44, 48], (x, z, m) => m > 0.4 && (clump(x - vi * 30, z, 0.05, 0.05) || distToPolyline(x, z, STREAM) < 5) && (z < 20.5 || z > 28), (x, y, z) => makeMatrix(x, y - 0.05, z, 0.8 + rnd() * 1.0, rnd() * 6, 0.15));
      const ci = new ChunkedInstances(geo, leafF.material, { chunkSize: 44, castShadow: true, depthMaterial: leafF.depth, name: 'broadleaf' });
      ci.maxDistance = q.vegetationDistance * 0.6;
      addVeg(ci, mats, mats.map(() => tint(new THREE.Color(1, 1, 1), 0.3)));
    });
  }
  // Trees
  const trunkBoxes: [number, number, number][] = [];
  {
    const kinds: ['giant' | 'slender', number][] = [
      ['giant', 1],
      ['giant', 2],
      ['slender', 3],
      ['slender', 4],
    ];
    const spots: [number, number][] = [];
    const farEnough = (x: number, z: number, d: number) => spots.every(([a, b]) => Math.hypot(a - x, b - z) > d);
    kinds.forEach(([kind, seed], ki) => {
      const t = rainforestTree(seed * 17, kind);
      track(t.bark);
      track(t.leaves);
      track(t.leavesLod);
      const mats: THREE.Matrix4[] = [];
      const want = kind === 'giant' ? 34 : 40;
      let tries = 0;
      while (mats.length < want && tries < 4000) {
        tries++;
        const plateau = ki >= 2 && rnd() < 0.3;
        const x = -62 + rnd() * 130;
        const z = plateau ? 34 + rnd() * 12 : -100 + rnd() * 118;
        const m = vegetationMask(x, z);
        if (m < 0.85) continue;
        if (plateau && Math.abs(x - 2) > 30) continue;
        if (terrainHeight(x, z) > (plateau ? 14 : 18)) continue;
        if (!farEnough(x, z, kind === 'giant' ? 9 : 6)) continue;
        // Keep sightlines to the gate & cliff open from the trail
        if (distToPolyline(x, z, TRAIL) < (kind === 'giant' ? 7 : 5)) continue;
        spots.push([x, z]);
        const y = terrainHeight(x, z);
        mats.push(makeMatrix(x, y - 0.3, z, 0.85 + rnd() * 0.35, rnd() * 6));
        trunkBoxes.push([x, z, t.trunkRadius]);
      }
      const barkCI = new ChunkedInstances(t.bark, barkMat, { chunkSize: 64, castShadow: true, name: 'trunks' });
      barkCI.maxDistance = q.vegetationDistance;
      addVeg(barkCI, mats);
      const leafCI = new ChunkedInstances(t.leaves, canopyF.material, { chunkSize: 64, castShadow: true, depthMaterial: canopyF.depth, lodGeometry: t.leavesLod, name: 'canopy' });
      leafCI.maxDistance = q.vegetationDistance;
      leafCI.lodDistance = q.vegetationDistance * 0.45;
      addVeg(leafCI, mats, mats.map(() => tint(new THREE.Color(1, 1, 1), 0.25)));
    });
    for (const [x, z, r] of trunkBoxes) world.addCylinder(v(x, terrainHeight(x, z) + 2, z), r * 1.25, 2.6, { surface: 'wood' });
  }
  // Tree ferns along the stream and cliff base
  {
    const t = treeFernGeometry(9);
    track(t.bark);
    track(t.leaves);
    const mats = scatter(55, [-36, -60, 40, 21], (x, z, m) => m > 0.7 && (distToPolyline(x, z, STREAM) < 9 || z > 12) && distToPolyline(x, z, TRAIL) > 4, (x, y, z) => makeMatrix(x, y - 0.1, z, 0.8 + rnd() * 0.5, rnd() * 6));
    for (const mm of mats) {
      const tp = new THREE.Vector3().setFromMatrixPosition(mm);
      world.addCylinder(tp.clone().setY(tp.y + 1.5), 0.24, 1.6, { surface: 'wood', blocksCamera: false });
    }
    const b = new ChunkedInstances(t.bark, barkMat, { chunkSize: 40, castShadow: true, name: 'treefern-trunk' });
    b.maxDistance = q.vegetationDistance;
    addVeg(b, mats);
    const l = new ChunkedInstances(t.leaves, palmF.material, { chunkSize: 40, castShadow: true, depthMaterial: palmF.depth, name: 'treefern' });
    l.maxDistance = q.vegetationDistance;
    addVeg(l, mats, mats.map(() => tint(new THREE.Color(1, 1, 1), 0.2)));
  }
  // Distant forest on the valley walls (cheap far trees through the fog)
  {
    const geo = farTreeGeometry(5);
    track(geo);
    const farF = createFoliageMaterial({ map: atlas, swayHeight: 30, swayAmount: 0.2, color: 0x7f9266, translucency: 0.2 });
    track(farF.material);
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    for (let i = 0; i < 2600; i++) {
      const x = -170 + rnd() * 350;
      const z = -170 + rnd() * 225;
      const wall = Math.abs(x - 2) - 44;
      const south = -92 - z;
      if (wall < 0 && south < 0) continue;
      const y = terrainHeight(x, z);
      if (y > 110) continue;
      mats.push(makeMatrix(x, y - 1, z, 0.8 + rnd() * 0.6, rnd() * 6));
      cols.push(tint(new THREE.Color(1, 1, 1), 0.35));
    }
    const ci = new ChunkedInstances(geo, farF.material, { chunkSize: 70, castShadow: false, name: 'far-forest' });
    ci.maxDistance = 700;
    addVeg(ci, mats, cols);
  }
  // Hanging vines from the cliff top (kept off the climb routes)
  {
    const geos = [vineGeometry(1, 4), vineGeometry(2, 6.5), vineGeometry(3, 3)];
    geos.forEach((g, gi) => {
      track(g);
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < 26; i++) {
        const x = -29 + rnd() * 62;
        if ((x > 7.5 && x < 12.5) || (x > 23.5 && x < 31)) continue;
        const len = [4, 6.5, 3][gi];
        const z = x > 2 && x < 31 ? 23.65 : 22.45;
        mats.push(makeMatrix(x, PLATEAU_Y - len + 0.1, z, 1, rnd() * 0.4 - 0.2));
      }
      const ci = new ChunkedInstances(g, vineF.material, { chunkSize: 90, name: 'vines' });
      ci.maxDistance = q.vegetationDistance;
      addVeg(ci, mats);
    });
  }
  // Fallen logs
  for (let i = 0; i < 9; i++) {
    const x = -30 + rnd() * 66;
    const z = -58 + rnd() * 74;
    if (vegetationMask(x, z) < 0.9) continue;
    const len = 4 + rnd() * 5;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, len, 10, 4), barkMat);
    log.rotation.set(Math.PI / 2, 0, rnd() * Math.PI);
    log.position.set(x, terrainHeight(x, z) + 0.3, z);
    log.castShadow = true;
    log.receiveShadow = true;
    props.add(log);
    world.addBox(log.position, v(0.4, 0.4, len / 2), -log.rotation.z + Math.PI / 2, { surface: 'wood' });
  }

  // Ribbons + pitons marking the 1958 route (maintained by someone since).
  const ribbonSpots: [THREE.Vector3, number][] = [
    [v(9.3, 1.6, 22.55), 0],
    [v(10.8, 3.2, 22.55), 0],
    [v(9.8, 4.4, 22.55), 0],
    [v(14.5, 5.5, 23.78), 0],
    [v(18.5, 5.6, 23.78), 0],
    [v(21.2, 6.6, 23.78), 0],
    [v(25.4, 7.4, 23.78), 0],
    [v(28.4, 9.8, 23.78), 0],
    [v(29.3, 11.2, 23.78), 0],
    [v(25.4, 12.2, 23.78), 0],
    [v(10.2, 0.8, 20.9), 0],
  ];
  ribbonSpots.forEach(([p], i) => {
    const r = P.pitonRibbon(PM, i + 3);
    r.position.copy(p);
    r.rotation.y = Math.PI;
    props.add(r);
  });
  // A ribbon tied to a stake at the trail start into the cliff approach
  {
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.1, 5), PM.wood);
    stake.position.set(8.4, terrainHeight(8.4, 17) + 0.55, 17);
    props.add(stake);
    const r = P.pitonRibbon(PM, 99);
    r.position.set(8.4, terrainHeight(8.4, 17) + 1.0, 17);
    props.add(r);
  }

  await step(0.76, 'Carving the Hollow Meridian');
  // ================================================================== gorge vista (hidden until the gate opens)
  const gorge = new THREE.Group();
  gorge.name = 'gorge';
  gorge.visible = false;
  root.add(gorge);
  const terraceColliders: BoxCollider[] = [];
  {
    const tb = new InstanceBatch();
    // Overlook terrace beyond the gate
    tb.add(block, v(4, Y - 0.5, 56.8), v(9, 1, 8.4), 0, 0.95);
    terraceColliders.push(world.addBox(v(4, Y - 0.5, 56.8), v(4.5, 0.5, 4.2)));
    for (let x = 0; x <= 8; x += 1.6) tb.add(block, v(x, Y + 0.45, 60.6), v(1.4, 0.9, 0.6), 0, 0.85);
    terraceColliders.push(world.addBox(v(4, Y + 0.45, 60.6), v(4.6, 0.45, 0.3)));
    terraceColliders.push(world.addBox(v(-0.8, Y + 1, 56.8), v(0.3, 1, 4.2)));
    terraceColliders.push(world.addBox(v(8.8, Y + 1, 56.8), v(0.3, 1, 4.2)));
    gorge.add(...tb.build(masonMat, { castShadow: true, name: 'terrace' }));
  }
  {
    const farF = createFoliageMaterial({ map: atlas, swayHeight: 30, swayAmount: 0.2, color: 0x7a8c62, translucency: 0.2 });
    track(farF.material);
    gorge.add(buildGorge({ mason: masonMat, fall: fallMat, water: waterMat, foliage: farF.material, bronze: PM.bronze }));
  }
  const gorgeMist = ambientParticles({ kind: 'mist', count: Math.round(60 * q.particleScale) + 24, center: v(4, -72, 105), size: v(95, 34, 85), texture: texture('tex.mist'), color: new THREE.Color(0.8, 0.78, 0.72), pointSize: 140, opacity: 0.32, seed: 5 });
  gorge.add(gorgeMist);

  // ================================================================== distant mountains (layered depth)
  {
    const ring = (radius: number, height: number, seed: number, color: THREE.Color) => {
      const segs = 180;
      const posA: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const n = fbm2(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 - seed, 5);
        const hgt = height * (0.55 + n * 0.8) + (Math.abs(Math.sin(a * 0.5)) < 0.2 ? height * 0.3 : 0);
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        posA.push(x, -60, z, x, hgt, z);
        if (i < segs) {
          const k = i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
      m.position.set(4, 0, 0);
      m.name = 'ridge';
      root.add(m);
      track(g);
      track(m.material as THREE.Material);
    };
    ring(330, 150, 1, new THREE.Color(0.16, 0.22, 0.18));
    ring(520, 260, 2, new THREE.Color(0.2, 0.26, 0.26));
    ring(820, 420, 3, new THREE.Color(0.28, 0.33, 0.35));
  }

  await step(0.86, 'Stirring the mist');
  // ================================================================== particles
  const ps = q.particleScale;
  const ambient: THREE.Points[] = [];
  const addP = (p: THREE.Points) => {
    root.add(p);
    ambient.push(p);
    return p;
  };
  const dot = texture('tex.dot');
  addP(ambientParticles({ kind: 'dust', count: Math.round(420 * ps), center: v(3, 0, -14), size: v(44, 9, 50), texture: dot, color: new THREE.Color(1, 0.85, 0.6), pointSize: 0.12, opacity: 0.55, seed: 1 }));
  addP(ambientParticles({ kind: 'dust', count: Math.round(260 * ps), center: v(10, 0, 14), size: v(40, 12, 20), texture: dot, color: new THREE.Color(1, 0.85, 0.6), pointSize: 0.12, opacity: 0.5, seed: 2 }));
  addP(ambientParticles({ kind: 'fireflies', count: Math.round(160 * ps), center: v(-6, 0.2, -30), size: v(60, 3, 70), texture: dot, color: new THREE.Color(0.8, 1.0, 0.45), pointSize: 0.07, opacity: 0.9, seed: 3 }));
  addP(ambientParticles({ kind: 'mist', count: Math.round(70 * ps) + 10, center: v(0, -2, -20), size: v(150, 7, 120), texture: texture('tex.mist'), color: new THREE.Color(0.78, 0.8, 0.76), pointSize: 45, opacity: 0.22, seed: 4 }));
  addP(ambientParticles({ kind: 'leaves', count: Math.round(110 * ps), center: v(2, 0, -18), size: v(60, 18, 70), texture: texture('tex.leaf'), color: new THREE.Color(1, 1, 1), pointSize: 0.18, opacity: 0.95, seed: 6 }));
  // Waterfall splash + mist now live in buildWaterfallFX.
  addP(ambientParticles({ kind: 'pollen', count: Math.round(200 * ps), center: v(10, PLATEAU_Y, 38), size: v(40, 6, 26), texture: dot, color: new THREE.Color(1, 0.9, 0.7), pointSize: 0.1, opacity: 0.5, seed: 9 }));
  const bursts = new BurstPool(700, texture('tex.mist'), new THREE.Color(0.42, 0.38, 0.32), 0.55, 3);
  root.add(bursts.points);

  // Glints on collectibles (subtle, diegetic "something catches the light")
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  const glintMat = new THREE.PointsMaterial({ map: dot, size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.3, 0.9) });
  const glints = new THREE.Points(glintGeo, glintMat);
  glints.frustumCulled = false;
  root.add(glints);

  // ================================================================== light shafts
  const shaftMat = createShaftMaterial(new THREE.Color(1.0, 0.72, 0.45), 0.045);
  const shafts: THREE.Mesh[] = [];
  const sd = SUN_DIR.clone().negate();
  for (const [x, z, len] of [
    [0, -6, 24],
    [6, -16, 22],
    [-8, -2, 26],
    [9, 10, 22],
    [-4, -32, 26],
    [12, 2, 20],
    [3, -44, 24],
  ] as const) {
    const top = v(x, terrainHeight(x, z), z).addScaledVector(sd, -len);
    const s = lightShaft(top, sd, len + 2, 1.4 + rnd(), 3 + rnd() * 1.5, shaftMat);
    root.add(s);
    shafts.push(s);
  }

  // ================================================================== build instance batches
  // The theodolite head was aimed above; the lit landing campfire flames animate — keep
  // those out of the merge.
  const keep = [theoHead, flames].filter(Boolean) as THREE.Object3D[];
  for (const k of keep) {
    k.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    k.matrixWorld.decompose(wp, wq, ws);
    root.add(k);
    k.position.copy(wp);
    k.quaternion.copy(wq);
    k.scale.copy(ws);
  }
  root.add(mergeStatic(props, 'props'));
  root.add(...cliffBatch.build(cliffMat, { name: 'cliff' }));
  root.add(...flatBatch.build(cliffMat, { name: 'climb-faces' }));
  root.add(...masonBatch.build(masonMat, { name: 'masonry' }));
  root.add(...rockBatch.build(rockMat, { name: 'rocks' }));

  // Pickups (positions; visibility managed by the chapter from saved state)
  const pickups: Record<string, THREE.Object3D> = {};
  {
    const p1 = P.paperPage(PM);
    p1.rotation.y = 0.3;
    const stoneW = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05, 0), rockMat);
    stoneW.position.set(0.05, 0.03, 0.05);
    const g1 = new THREE.Group();
    g1.position.set(0.55, terrainHeight(0.6, -10.8) + 0.78, -10.75);
    g1.add(p1, stoneW);
    root.add(g1);
    pickups.ch1_journal_1 = g1;

    const tin = P.tinBox(PM);
    tin.position.set(10.9, terrainHeight(10.9, 20.4), 20.4);
    const page2 = P.paperPage(PM);
    page2.position.set(0, 0.08, 0.02);
    page2.scale.setScalar(0.8);
    tin.add(page2);
    root.add(tin);
    pickups.ch1_journal_2 = tin;

    const p3 = P.paperPage(PM);
    p3.position.set(7.2, terrainHeight(7.2, -13.6) + 0.4, -13.6);
    p3.rotation.set(0.2, 0.5, 0);
    root.add(p3);
    pickups.ch1_journal_3 = p3;

    const tok = P.sunToken(PM);
    tok.position.set(-2.3, terrainHeight(-2.3, -5.2) + 0.02, -5.2);
    root.add(tok);
    pickups.ch1_relic_token = tok;
  }

  await step(1, 'Ready');

  return {
    root,
    sky,
    sun,
    hemi,
    fireLight,
    lanternLight,
    flames,
    vegetation,
    door,
    doorCollider,
    gateWallColliders,
    gorge,
    drums,
    drumGlow,
    pickups,
    glints,
    theodoliteHead: theoHead,
    theodolitePos: theo.position.clone(),
    bursts,
    ambient,
    shafts,
    shaftMat,
    toby,
    heightfield: hf,
    terrain,
    lintel: v(4, Y + 7.2, gz - 1.2),
    terraceColliders,
    gorgeMist,
    dispose: () => {
      for (const d of disposables) d.dispose();
      for (const vv of vegetation) vv.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      (toby?.userData.avatar as { dispose(): void } | undefined)?.dispose();
      env.dispose();
      scene.remove(root);
      scene.environment = null;
      scene.fog = null;
    },
  };

  function P_stencilMK(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.strokeStyle = 'rgba(40,34,28,0.85)';
    x.lineWidth = 5;
    x.font = '84px Georgia, serif';
    x.fillStyle = 'rgba(40,34,28,0.8)';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('M.K.', 128, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

/** Utility for the chapter: merge helper re-export to keep imports tidy. */
export const _merge = mergeGeometries;
