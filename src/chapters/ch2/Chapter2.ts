import * as THREE from 'three';
import type { CheckpointDef } from '../Chapter';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Sequence } from '../../cinematic/Sequence';
import type { BoxCollider } from '../../physics/Colliders';
import { ChapterBase, type HeroFrame } from '../common/ChapterBase';
import { standardManifest, v } from '../common/LevelKit';
import { makeClimb, makeLedge, type TraversalSet } from '../../traversal/TraversalTypes';
import { TogglePuzzle } from '../../puzzles/TogglePuzzle';
import { Collapse, type CollapsePiece } from '../../world/Collapse';
import type { BurstPool } from '../../world/Particles';
import { buildWaterfallFX } from '../../world/WaterfallFX';
import { flowPlaneGeometry, riverMesh, waterfallMesh } from '../../world/Water';
import { fbm2 } from '../../systems/noise';
import * as P from '../../world/Props';
import { mergeStatic } from '../../world/StaticMerge';
import { CH2 } from '../../story/dialogue/ch2';

/*
 * CHAPTER TWO — INTO THE UNKNOWN (STORY_BIBLE §14.3). Dawn, Day 2.
 * The route descends the upper terraces of the Hollow Meridian, northward (+Z):
 *   T0 overlook (y 0) —rappel→ T1 kitchens (y −10) —wall climb→ T1b (y −6) → T2 terrace house
 *   (Marta's cache) —rope bridge→ T3 —aqueduct ledge→ T4 cistern (sluice puzzle) —water-stair→
 *   T5 (y −20) —aqueduct span (collapse)→ T6 and the mouth of the sun-shafts.
 * −X is the open chasm side (the sun rises over the low eastern rim); +X is the west wall.
 */
const Y0 = 0;
const Y1 = -10;
const Y1B = -6;
const Y5 = -20;
const N = v(0, 0, -1);

const ANCHOR = v(2.5, Y0, 4.3);
const RAPPEL_TOP = v(2.5, Y0, 5.45);
const RAPPEL_BOTTOM = v(2.5, Y1, 6.7);
const CISTERN = v(-31, Y1, 70);
const STAIR_TOP_Z = 80;
const STAIR_BOTTOM_Z = 93.5;
const SPAN_X = -30;
const SPAN_Z0 = 100;
const SPAN_PIECE = 4;
const SPAN_PIECES = 6; // z 100..124
const GAP_END = 126.5;
const SHAFT = v(-30, Y5, 146);

const CHECKPOINTS: Record<string, CheckpointDef> = {
  ch2_start: { pos: v(0.5, Y0, -1.5), yaw: 0.1, label: 'The overlook' },
  ch2_terraces: { pos: v(2.6, Y1, 12), yaw: 0, label: 'The upper terraces' },
  ch2_bridge: { pos: v(-4.5, Y1, 41.5), yaw: -Math.PI / 2, label: 'The rope bridge' },
  ch2_cistern: { pos: v(-27.4, Y1, 64.6), yaw: -0.55, label: 'The cistern' },
  ch2_span: { pos: v(-30.6, Y5, 96.6), yaw: 0, label: 'The aqueduct' },
  ch2_shaft: { pos: v(-30, Y5, 135), yaw: 0, label: 'The sun-shafts' },
};

const CLIMB_WALL = makeClimb('c2_wall', v(1.5, Y1, 22), N, 3, 4, 'l2_wall');
const LEDGE_WALL = makeLedge('l2_wall', v(3, Y1B, 22), v(0, Y1B, 22), N, 'all', 'c2_wall');
const TRAVERSAL: TraversalSet = {
  climbs: [CLIMB_WALL],
  ledges: [LEDGE_WALL],
  narrows: [{ id: 'aqueductLedge', a: v(-28.7, Y1, 50.3), b: v(-28.7, Y1, 61.7), normal: v(1, 0, 0) }],
  vaults: [],
  jumps: [{ id: 'spanGap', from: v(SPAN_X, Y5, 123.4), fromRadius: 1.1, to: v(SPAN_X, Y5, 127.4) }],
};

interface WorldSave {
  rope: boolean;
  spanDone: boolean;
}

export default class Chapter2 extends ChapterBase {
  readonly id = 2;
  readonly title = 'INTO THE UNKNOWN';
  readonly numberLabel = 'CHAPTER TWO';
  readonly checkpoints = CHECKPOINTS;
  readonly firstCheckpoint = 'ch2_start';
  protected readonly checkpointOrder = ['ch2_start', 'ch2_terraces', 'ch2_bridge', 'ch2_cistern', 'ch2_span', 'ch2_shaft'];
  readonly manifest = standardManifest('ch2', [], { cliffTint: [150, 118, 96] });

  protected kitOptions = { masonMoss: 0.55, cliffMoss: 0.7 };
  private ropeFixed = false;
  private spanDone = false;
  private rope!: THREE.Object3D;
  private sluice!: TogglePuzzle;
  private sluiceFX: { stair: THREE.Object3D; spill: THREE.Object3D; basin: THREE.Object3D; channels: THREE.Mesh[] } = null!;
  private torrent!: BoxCollider;
  private door!: THREE.Object3D;
  private doorCollider!: BoxCollider;
  private doorK = 0;
  private fill = 0;
  private basinWater!: THREE.Mesh;
  private weight!: THREE.Object3D;
  private weightY0 = 0;
  private weightSling!: THREE.Mesh;
  private ropeLine!: THREE.Mesh;
  private ropeLen = 1;
  private ropePay = 1;
  private gapFall!: THREE.Object3D;
  private span!: Collapse;
  private bursts!: BurstPool;
  private endStarted = false;

  // ================================================================ build
  protected async build(step: (f: number, label: string) => Promise<void>): Promise<void> {
    const k = this.kit;
    const { world } = this.ctx;
    const rnd = k.rnd;
    this.sunDir = v(-0.85, 0.36, 0.38).normalize();
    this.shadowRange = 34;
    await step(0.05, 'Dawn over the gorge');
    k.atmosphere({
      sunDir: this.sunDir,
      sunColor: new THREE.Color(1.0, 0.76, 0.58),
      sunIntensity: 5.2,
      zenith: new THREE.Color(0.17, 0.25, 0.4),
      horizon: new THREE.Color(0.74, 0.62, 0.62),
      sunHorizon: new THREE.Color(1.35, 0.72, 0.46),
      skySun: new THREE.Color(1.7, 1.05, 0.72),
      ground: new THREE.Color(0.2, 0.22, 0.24),
      cloudCover: 0.35,
      skySunIntensity: 20,
      envIntensity: 0.62,
      fogColor: new THREE.Color(0.35, 0.39, 0.46),
      fogDensity: 0.0024,
      fogSunColor: new THREE.Color(0.95, 0.62, 0.44),
      fogHeightBase: -25,
      fogHeightFalloff: 0.035,
      hemiSky: new THREE.Color(0.62, 0.68, 0.82),
      hemiGround: new THREE.Color(0.26, 0.21, 0.17),
      hemiIntensity: 0.6,
      wetness: 0.3,
      shadowRange: this.shadowRange,
    });
    world.bounds = { minX: -66, maxX: 14, minZ: -6, maxZ: 147 };
    this.ctx.player.killY = -42;

    await step(0.12, 'Carving the gorge');
    // Abyss floor far below (fog hides it); the river glints at the bottom.
    k.terrainFrom((x, z) => -82 + fbm2(x * 0.03, z * 0.03, 3) * 4 + Math.max(0, x - 16) * 1.6 + Math.max(0, -60 - x) * 1.6, {
      origin: [-130, -70],
      size: 300,
      res: 121,
      splat: (_x, _z, _h, ny) => [0.3, 0.2, ny < 0.8 ? 1 : 0.5],
    });
    k.waterPlane(-25, -79, 70, 40, 260);

    // ---------------------------------------------------------------- gorge walls
    const ribbon = new THREE.Color(1.0, 0.9, 0.8);
    // West wall (lit by the dawn sun): big slabs far from the route, finer near it.
    k.cliffBox(v(28, 2, 70), v(14, 42, 82), ['-x'], { hue: ribbon, scale: 1.9, minY: -45 });
    // South wall behind the overlook (the gate ridge)
    k.cliffBox(v(-20, 14, -9), v(34, 30, 3.5), ['+z'], { hue: ribbon, scale: 1.8, minY: -30 });
    // North wall (the sun-shaft mouth is carved into it)
    const inPortal = (x: number, y: number) => x > -36 && x < -24 && y < Y5 + 9;
    k.cliffBox(v(-14, 2, 158), v(30, 42, 12), ['-z'], { hue: ribbon, skip: (x, y) => inPortal(x, y), scale: 1.6, minY: -45 });
    // Low eastern rim far across the chasm (the sun clears it)
    k.cliffBox(v(-92, -40, 70), v(22, 34, 110), ['+x'], { hue: ribbon, tint: 0.85, scale: 3 });
    // Rock beside the overlook (west)
    k.cliffBox(v(11, (Y0 + 8 - 60) / 2, -0.5), v(3, (Y0 + 8 + 60) / 2, 5.5), ['+z'], { hue: ribbon, minY: Y1 - 4 });

    await step(0.22, 'Laying the terraces');
    // Everything stands on rock that runs down into the mist: big, cheap slabs below the detailed band.
    const roots = (c: THREE.Vector3, h: THREE.Vector3, faces: ('+x' | '-x' | '+z' | '-z')[], fromY: number) =>
      k.cliffBox(v(c.x, (fromY - 74) / 2, c.z), v(h.x, (fromY + 74) / 2, h.z), faces, { hue: ribbon, scale: 3, tint: 0.8, collide: false });
    // ---------------------------------------------------------------- terraces
    const terrace = (x0: number, x1: number, z0: number, z1: number, top: number, faces: ('+x' | '-x' | '+z' | '-z')[], bottom = -60) => {
      const c = v((x0 + x1) / 2, (top + bottom) / 2, (z0 + z1) / 2);
      const h = v((x1 - x0) / 2, (top - bottom) / 2, (z1 - z0) / 2);
      k.cliffBox(c, h, faces, { hue: ribbon, skip: (_x, y) => y > top - 4.4, minY: top - 18, scale: 1.3 });
      roots(c, h, faces, top - 17);
      // Built Ysharu retaining wall over the raw rock: the top 4 m of every terrace face.
      const warm = new THREE.Color(1.04, 0.96, 0.86);
      for (const f of faces) {
        if (f === '+x' || f === '-x') {
          const x = f === '+x' ? x1 : x0;
          k.coursedWall(x, z0, x, z1, top - 4.2, top - 0.02, { thick: 1.0, collide: false, cornice: false, hue: warm, tint: 0.8 });
        } else {
          const z = f === '+z' ? z1 : z0;
          k.coursedWall(x0, z, x1, z, top - 4.2, top - 0.02, { thick: 1.0, collide: false, cornice: false, hue: warm, tint: 0.8 });
        }
      }
      // Paving + worn stone lip
      for (let x = x0 + 0.9; x < x1; x += 1.7 + rnd() * 0.5)
        for (let z = z0 + 0.9; z < z1; z += 1.7 + rnd() * 0.5)
          if (rnd() < 0.55) k.masonBatch.add(k.block, v(x, top - 0.08, z), v(1.2 + rnd() * 0.5, 0.2, 1.0 + rnd() * 0.5), rnd() * 0.25, 0.75 + rnd() * 0.2);
      k.masonBatch.add(k.plate, v(c.x, top - 0.35, c.z), v(x1 - x0, 0.7, z1 - z0), 0, 0.85);
    };
    // A wall only where a wall can be seen: the overlook's parapet. Every other edge is a real edge.
    const guard = (x0: number, x1: number, z0: number, z1: number, y: number) =>
      world.addBox(v((x0 + x1) / 2, y + 0.6, (z0 + z1) / 2), v(Math.max(0.1, (x1 - x0) / 2), 0.6, Math.max(0.1, (z1 - z0) / 2)), 0, { blocksCamera: false });
    // Parapet (visible) along an edge
    // Coursed parapet (axis-aligned), gaps measured along it from `a`.
    const parapet = (a: THREE.Vector3, b: THREE.Vector3, h = 0.9, gaps: [number, number][] = []) => {
      const alongX = Math.abs(b.z - a.z) < 1e-3;
      const base = alongX ? Math.min(a.x, b.x) : Math.min(a.z, b.z);
      k.coursedWall(a.x, a.z, b.x, b.z, a.y, a.y + h, { thick: 0.55, collide: false, gaps: gaps.map(([g0, g1]) => [base + g0, base + g1] as [number, number]), doorH: h + 1, tint: 0.88 });
    };

    // T0 overlook
    terrace(-6, 8, -6, 5, Y0, ['+z']);
    parapet(v(-6, Y0, 4.8), v(8, Y0, 4.8), 0.9, [[7.4, 10.6]]);
    guard(-6, 1.4, 4.6, 5.0, Y0);
    guard(4.6, 8, 4.6, 5.0, Y0);
    // Overlook side rock
    k.cliffBox(v(-10, Y0 + 6, -0.5), v(4, 12, 6), ['+x', '+z'], { hue: ribbon, scale: 1.3 });
    // The blown stair: scorched rubble fan below the overlook.
    for (let i = 0; i < 26; i++) k.boulder(v(-2 + rnd() * 9, Y1 + 0.1 + rnd() * 1.5, 6 + rnd() * 3.5), 0.4 + rnd() * 0.9, Y1, true);
    for (let i = 0; i < 6; i++) k.darkBatch.add(k.block, v(-1 + i * 1.3, Y0 - 0.9 - i * 0.6, 5.6 + i * 0.25), v(1.1, 0.5, 1.3), rnd() * 0.4, 0.45);
    // Gate passage (the way the player came in last night) — sealed by the ridge here.
    k.blockAt(v(1, Y0 + 3.4, -5.9), v(1.6, 6.8, 1.6), 0, true, 1.0);
    k.blockAt(v(5.5, Y0 + 3.4, -5.9), v(1.6, 6.8, 1.6), 0, true, 1.0);
    k.blockAt(v(3.25, Y0 + 7.4, -5.9), v(6.4, 1.3, 1.9), 0, false, 1.05);
    {
      const darkDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 6.6), new THREE.MeshBasicMaterial({ color: 0x0a0907 }));
      darkDoor.position.set(3.25, Y0 + 3.3, -5.2);
      k.root.add(darkDoor);
      world.addBox(v(3.25, Y0 + 3.3, -5.4), v(1.5, 3.3, 0.3));
    }
    // Anchor column for the rope
    k.blockAt(v(ANCHOR.x, Y0 + 0.6, ANCHOR.z - 0.4), v(0.55, 1.2, 0.55), 0, true, 1.0);
    this.rope = new THREE.Group();
    {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5), k.PM.rope);
      const len = Y0 + 1.1 - (Y1 + 0.1);
      r.scale.y = len;
      r.position.set(RAPPEL_TOP.x, (Y0 + 1.1 + Y1 + 0.1) / 2, RAPPEL_TOP.z + 0.25);
      r.rotation.x = 0.07;
      this.rope.add(r);
      this.ropeLine = r;
      this.ropeLen = Y0 + 0.05 - (Y1 + 0.1);
      // From the knot on the column, over the lip, to the top of the hanging line.
      const lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(ANCHOR.x, Y0 + 1.0, ANCHOR.z - 0.1), v(ANCHOR.x, Y0 + 0.5, ANCHOR.z + 0.5), v(RAPPEL_TOP.x, Y0 + 0.12, RAPPEL_TOP.z - 0.1), v(RAPPEL_TOP.x, Y0 + 0.02, RAPPEL_TOP.z + 0.2)]), 16, 0.018, 5), k.PM.rope);
      this.rope.add(lead);
      const knot = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 6, 14), k.PM.rope);
      knot.position.set(ANCHOR.x, Y0 + 1.0, ANCHOR.z - 0.4);
      knot.rotation.x = Math.PI / 2;
      this.rope.add(knot);
      const tag = P.pitonRibbon(k.PM, 77);
      tag.position.set(ANCHOR.x + 0.3, Y0 + 1.05, ANCHOR.z - 0.1);
      this.rope.add(tag);
      k.root.add(this.rope);
    }

    // T1 kitchens (and T1b slumped wall)
    terrace(-8, 14, 5, 22, Y1, ['-x']);
    k.cliffBox(v(3, (Y1B - 60) / 2, 26), v(11, (Y1B + 60) / 2, 4), ['-x', '-z'], {
      minY: Y1 - 14,
      hue: ribbon,
      skip: (x, y, z) => (z < 23 && x > -0.4 && x < 3.4) || y > Y1B - 1,
    });
    roots(v(3, 0, 26), v(11, 0, 4), ['-x'], Y1 - 13);
    k.masonBatch.add(k.plate, v(3, Y1B - 0.3, 26), v(22, 0.6, 8), 0, 0.9);
    // The slumped wall is built up to its top: the paving no longer hangs out over the rock face.
    k.coursedWall(-8, 22, 14, 22, Y1, Y1B - 0.02, { thick: 1.0, collide: false, cornice: false, hue: new THREE.Color(1.04, 0.96, 0.86), tint: 0.8, gaps: [[-0.4, 3.4]], doorH: 5 });
    k.coursedWall(-8, 22, -8, 30, Y1B - 4.2, Y1B - 0.02, { thick: 1.0, collide: false, cornice: false, hue: new THREE.Color(1.04, 0.96, 0.86), tint: 0.8 });
    k.climbFace(CLIMB_WALL.origin, CLIMB_WALL.right, CLIMB_WALL.normal, CLIMB_WALL.width, CLIMB_WALL.height);
    // Hearths & grinding stones
    for (const [hx, hz] of [[-3, 11], [-0.5, 14.5], [-4.6, 16]] as const) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.rockBatch.add(k.rocks[i % 5], v(hx + Math.cos(a) * 0.55, Y1 + 0.08, hz + Math.sin(a) * 0.55), 0.22, rnd() * 6, 0.55);
      }
      k.darkBatch.add(k.block, v(hx, Y1 + 0.02, hz), v(0.8, 0.06, 0.8), 0, 0.35);
      world.addCylinder(v(hx, Y1 + 0.25, hz), 0.7, 0.25, { blocksCamera: false });
    }
    for (const [gx, gz] of [[5, 9], [6.2, 10.4], [9, 13]] as const) k.blockAt(v(gx, Y1 + 0.3, gz), v(0.9, 0.6, 0.6), rnd() * 3, true, 0.8);
    // Kitchen rooms: low coursed walls, clay pots and jars, and the 1958 team's tin mugs left by
    // the hearths (they cooked here, five days after the "avalanche").
    k.coursedWall(-7.2, 7, -7.2, 13, Y1, Y1 + 0.9, { thick: 0.5, tint: 0.85 });
    k.coursedWall(-7.2, 13, -2.8, 13, Y1, Y1 + 0.7, { thick: 0.45, tint: 0.85, gaps: [[-5.6, -4.4]], doorH: 2 });
    const clay = k.track(new THREE.MeshStandardMaterial({ color: 0x6e4630, roughness: 0.92, side: THREE.DoubleSide }));
    const tin = k.track(new THREE.MeshStandardMaterial({ color: 0x8a8f8c, metalness: 0.7, roughness: 0.45 }));
    for (const [px, pz, r, sq] of [[-6.4, 8.2, 0.32, 1.3], [-6.6, 9.1, 0.24, 1.1], [-5.8, 8.0, 0.2, 1.4], [-2.2, 10.2, 0.28, 0.9], [-0.2, 15.6, 0.22, 1.2]] as const) {
      const prof = [[0.0, 0], [0.55, 0.02], [0.85, 0.25], [1.0, 0.55], [0.85, 0.85], [0.5, 1.0], [0.42, 1.12], [0.5, 1.2]].map(([a, b]) => new THREE.Vector2(a * r, b * r * 1.6 * sq));
      const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), clay);
      pot.position.set(px, Y1 - 0.04, pz);
      pot.rotation.z = (pz % 1) * 0.15;
      pot.castShadow = true;
      k.props.add(pot);
      world.addCylinder(v(px, Y1 + r, pz), r, r, { blocksCamera: false });
    }
    const broken = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 1.2, 0, Math.PI * 0.7), clay);
    broken.position.set(-4.1, Y1 + 0.05, 12.2);
    broken.rotation.set(1.7, 0.4, 0);
    k.props.add(broken);
    for (const [mx, mz] of [[-2.6, 11.5], [-3.3, 10.4], [-0.9, 14.0]] as const) {
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.09, 10, 1, true), tin);
      mug.position.set(mx, Y1 + 0.045, mz);
      k.props.add(mug);
    }
    k.place(P.rucksack(k.PM), -4.4, Y1, 15.6, 2.1);
    k.place(P.lantern(k.PM, false), -3.6, Y1, 11.6);

    // T2 terrace house + bridge head
    terrace(-8, 14, 30, 46, Y1, ['-x']);
    k.cliffBox(v(3, Y1 + 12, 49), v(11, 22, 3), ['-z', '-x'], { hue: ribbon, scale: 1.3 });
    {
      // The house: walls of masonry with a doorway on the south side, roof slab.
      const hx0 = 5;
      const hx1 = 11;
      const hz0 = 34;
      const hz1 = 40;
      const H = 2.9;
      k.coursedWall(hx0, hz0 + 0.3, hx1, hz0 + 0.3, Y1, Y1 + H, { gaps: [[7.1, 8.9]], doorH: 2.3, thick: 0.6, tint: 0.88 });
      k.coursedWall(hx0, hz1 - 0.3, hx1, hz1 - 0.3, Y1, Y1 + H, { thick: 0.6, tint: 0.85 });
      k.coursedWall(hx0 + 0.3, hz0 + 0.6, hx0 + 0.3, hz1 - 0.6, Y1, Y1 + H, { thick: 0.6, tint: 0.86 });
      k.coursedWall(hx1 - 0.3, hz0 + 0.6, hx1 - 0.3, hz1 - 0.6, Y1, Y1 + H, { thick: 0.6, tint: 0.86 });
      k.blockAt(v((hx0 + hx1) / 2, Y1 + H + 0.25, (hz0 + hz1) / 2), v(hx1 - hx0 + 0.6, 0.5, hz1 - hz0 + 0.6), 0, true, 0.8);
      k.niches(v(hx0 + 0.6, 0, hz0 - 0.01), v(hx0 + 1.9, 0, hz0 - 0.01), v(0, 0, -1), Y1 + 1.2, 1, 0.8);
      k.niches(v(hx1 - 1.9, 0, hz0 - 0.01), v(hx1 - 0.6, 0, hz0 - 0.01), v(0, 0, -1), Y1 + 1.2, 1, 0.8);
      // Old tarp half pulled from the doorway
      const tarp = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2, 6, 6), k.PM.canvas);
      const tp = tarp.geometry.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, Math.sin(tp.getX(i) * 3 + tp.getY(i)) * 0.06 - (tp.getX(i) > 0 ? 0.3 : 0));
      tarp.geometry.computeVertexNormals();
      tarp.position.set(7.6, Y1 + 1.2, hz0 + 0.02);
      tarp.rotation.y = Math.PI + 0.3;
      k.props.add(tarp);
      // Darkroom: trays, a crate, the tin cache
      k.place(P.crate(k.PM, 0.9, 0.6, 0.6, 'aldercott'), 9.6, Y1, 38.8, 0.1);
      world.addBox(v(9.6, Y1 + 0.3, 38.8), v(0.45, 0.3, 0.3), 0.1, { surface: 'wood' });
      k.place(P.table(k.PM), 6.6, Y1, 38.4, Math.PI / 2);
      world.addBox(v(6.6, Y1 + 0.38, 38.4), v(0.45, 0.38, 0.95), 0, { surface: 'wood' });
      k.place(P.lantern(k.PM, false), 6.6, Y1 + 0.76, 37.6);
      const tin = P.tinBox(k.PM);
      tin.position.set(9.6, Y1 + 0.62, 38.7);
      this.pickup('ch2_plate_41', tin, CH2.plate41, { prompt: 'Open the tin' });
      const note = P.paperPage(k.PM);
      note.position.set(6.6, Y1 + 0.79, 38.9);
      note.rotation.set(0, 0.4, 0);
      this.pickup('ch2_cache_note', note, CH2.note);
      const houseLight = new THREE.PointLight(new THREE.Color(1.0, 0.82, 0.6), 2.2, 7, 2);
      houseLight.position.set(8, Y1 + 2.2, 36.5);
      k.root.add(houseLight);
    }

    await step(0.36, 'Restringing the bridge');
    // ---------------------------------------------------------------- rope bridge (1958)
    {
      const x0 = -8;
      const x1 = -26;
      const z = 42;
      const n = 30;
      const sag = (t: number) => -Math.sin(t * Math.PI) * 0.55;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * t;
        const y = Y1 + sag(t);
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.25), k.PM.wood);
        plank.position.set(x, y - 0.03, z + (rnd() - 0.5) * 0.04);
        plank.rotation.set(0, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.04);
        plank.castShadow = true;
        if (rnd() > 0.06) k.props.add(plank);
        world.addBox(v(x, y - 0.15, z), v(0.32, 0.15, 0.62), 0, { surface: 'wood', blocksCamera: false });
      }
      for (const side of [-0.7, 0.7]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          pts.push(v(x0 + (x1 - x0) * t, Y1 + 1.05 + sag(t) * 0.8, z + side));
        }
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.025, 5), k.PM.rope);
        k.props.add(rail);
        // Hangers
        for (let i = 1; i < 20; i += 2) {
          const t = i / 20;
          const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 4), k.PM.rope);
          const yTop = Y1 + 1.05 + sag(t) * 0.8;
          const yBot = Y1 + sag(t);
          hang.scale.y = yTop - yBot;
          hang.position.set(x0 + (x1 - x0) * t, (yTop + yBot) / 2, z + side);
          k.props.add(hang);
        }
      }
      for (const [px, side] of [[x0 + 0.3, -0.75], [x0 + 0.3, 0.75], [x1 - 0.3, -0.75], [x1 - 0.3, 0.75]] as const) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 7), k.PM.wood);
        post.position.set(px, Y1 + 0.8, z + side);
        k.props.add(post);
      }
      const p44 = P.paperPage(k.PM);
      p44.position.set(-6.9, Y1 + 0.95, 43.6);
      p44.rotation.set(-0.3, 1.2, 0);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 6), k.PM.wood);
      pin.position.set(-6.9, Y1 + 0.5, 43.75);
      k.props.add(pin);
      this.pickup('ch2_plate_44', p44, CH2.plate44, { prompt: 'Look' });
    }

    // T3 east terrace + plate 43 shrine
    terrace(-37, -26, 30, 50, Y1, ['+x', '-z']);
    k.cliffBox(v(-44, Y1 + 15, 40), v(7, 25, 12), ['+x'], { hue: ribbon, minY: Y1 - 6, scale: 1.3 });
    {
      k.blockAt(v(-36, Y1 + 1.4, 36), v(1.2, 2.8, 2.6), 0, true, 0.9);
      k.blockAt(v(-35, Y1 + 2.9, 36), v(2.4, 0.4, 3.2), 0, false, 1.0);
      k.muralPanel(v(-35.35, Y1 + 1.5, 36), Math.PI / 2, 2.2);
      const p43 = P.paperPage(k.PM);
      p43.position.set(-34.9, Y1 + 0.6, 36.3);
      p43.rotation.set(-Math.PI / 2 + 0.2, 0, 0.5);
      this.pickup('ch2_plate_43', p43, CH2.plate43, { prompt: 'Look' });
      for (let i = 0; i < 4; i++) k.stela(v(-30 - i * 1.6, Y1, 31 + (i % 2) * 0.4), 0.2 * (i - 1.5), i % 4, (rnd() - 0.5) * 0.1, 0.8);
    }

    // Spur + aqueduct ledge
    k.cliffBox(v(-35, (Y0 + 6 - 60) / 2, 56), v(6, (Y0 + 6 + 60) / 2, 6), ['+x'], { hue: ribbon, skip: (_x, y) => Math.abs(y - (Y1 + 0.7)) < 1.2, minY: Y1 - 16, scale: 1.3 });
    roots(v(-35, 0, 56), v(6, 0, 6), ['+x'], Y1 - 15);
    // The rock she sidles along: a face right behind the ledge, so her hands are on stone.
    k.cliffBatch.add(k.plate, v(-29.22, Y1 + 0.9, 56), v(0.44, 3.4, 12), 0, 0.82, ribbon);
    world.addBox(v(-28.775, (Y1 - 60) / 2, 56), v(0.225, (Y1 + 60) / 2, 6), 0, { surface: 'stone' });
    k.masonBatch.add(k.stepSlab, v(-28.775, Y1 - 0.15, 56), v(0.45, 0.3, 12), 0, 1.2);
    // Aqueduct channel on top of the spur (water running north)
    {
      for (let z = 50.5; z < 62; z += 1.5) {
        k.blockAt(v(-29.6, Y0 + 6.4, z), v(0.4, 0.8, 1.45), 0, false, 0.9);
        k.blockAt(v(-31.4, Y0 + 6.4, z), v(0.4, 0.8, 1.45), 0, false, 0.9);
      }
      k.waterPlane(-30.5, Y0 + 6.6, 56, 1.4, 12);
      // A stone spout carries the channel clear of the rock; the water arcs out and lands in the cistern.
      k.blockAt(v(-30.5, Y0 + 6.2, 62.6), v(2.2, 0.45, 1.6), 0, false, 0.9);
      for (const sx of [-31.4, -29.6]) k.blockAt(v(sx, Y0 + 6.6, 62.6), v(0.4, 0.5, 1.6), 0, false, 0.9);
      k.waterPlane(-30.5, Y0 + 6.6, 62.7, 1.4, 1.5);
      k.waterfall(v(-30.5, Y0 + 6.6, 63.3), v(-30.5, Y1 + 0.9, 63.3), 1.3, v(0, 0, 1), Y1 + 0.86, buildWaterfallFX, { throwDist: 6.6, rippleRadius: 2.2 });
    }

    await step(0.48, 'Filling the cistern');
    // T4 cistern terrace
    terrace(-41, -20, 62, 80, Y1, ['+x', '-z']);
    k.cliffBox(v(-49, Y1 + 18, 72), v(8, 28, 10), ['+x'], { hue: ribbon, minY: Y1 - 6, scale: 1.3 });
    this.buildCistern();

    // Water-stair (30 steps, −10 → −20)
    k.stair(v(-31, Y1, STAIR_TOP_Z), v(-31, Y5, STAIR_BOTTOM_Z), 30, 3, 0.9);
    for (const sx of [-33.1, -28.9]) {
      k.cliffBox(v(sx + (sx < -31 ? -0.6 : 0.6), (Y1 + 2 - 60) / 2, (STAIR_TOP_Z + STAIR_BOTTOM_Z) / 2), v(1.2, (Y1 + 2 + 60) / 2, (STAIR_BOTTOM_Z - STAIR_TOP_Z) / 2 + 0.4), [sx < -31 ? '+x' : '-x'], {
        hue: ribbon,
        skip: (_x, y) => y > Y1,
        minY: Y5 - 8,
      });
      roots(v(sx + (sx < -31 ? -0.6 : 0.6), 0, (STAIR_TOP_Z + STAIR_BOTTOM_Z) / 2), v(1.2, 0, (STAIR_BOTTOM_Z - STAIR_TOP_Z) / 2 + 0.4), [sx < -31 ? '+x' : '-x'], Y5 - 7);
    }

    // T5 landing + door
    terrace(-36, -25, STAIR_BOTTOM_Z, SPAN_Z0, Y5, ['+x', '-x']);
    k.blockAt(v(-33.4, Y5 + 2.2, STAIR_BOTTOM_Z + 0.3), v(1.2, 4.4, 1.0), 0, true, 1.0);
    k.blockAt(v(-28.6, Y5 + 2.2, STAIR_BOTTOM_Z + 0.3), v(1.2, 4.4, 1.0), 0, true, 1.0);
    k.blockAt(v(-31, Y5 + 4.7, STAIR_BOTTOM_Z + 0.3), v(6, 0.9, 1.3), 0, false, 1.05);
    {
      const door = new THREE.Mesh(k.slabs[0], k.masonMat);
      door.scale.set(0.95, 1.0, 0.25);
      door.position.set(-31, Y5 + 2, STAIR_BOTTOM_Z + 0.3);
      door.castShadow = true;
      k.root.add(door);
      this.door = door;
      this.doorCollider = world.addBox(v(-31, Y5 + 2, STAIR_BOTTOM_Z + 0.3), v(1.9, 2.2, 0.4), 0, { dynamic: true });
      // Chain from the counterweight down the stair wall to the door
      const pts = [v(-24.6, Y1 + 4.5, 74.1), v(-26.2, Y1 + 3.4, 77), v(-27.6, Y1 + 2.4, 79.8), v(-28.5, Y5 + 6.5, 87), v(-28.7, Y5 + 4.3, STAIR_BOTTOM_Z - 0.2), v(-29.6, Y5 + 4.15, STAIR_BOTTOM_Z + 0.4)];
      const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.04, 5), k.PM.darkMetal);
      k.props.add(chain);
    }

    await step(0.6, 'Raising the aqueduct');
    this.buildSpan();
    // T6 far abutment + the sun-shaft mouth
    terrace(-38, -22, GAP_END, 146, Y5, ['+x', '-x']);
    {
      for (const sx of [-34.2, -25.8]) k.blockAt(v(sx, Y5 + 3.2, 146.2), v(1.6, 6.4, 1.6), 0, true, 1.0);
      k.blockAt(v(-30, Y5 + 6.9, 146.2), v(10, 1.2, 2), 0, false, 1.05);
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.3), new THREE.MeshBasicMaterial({ color: 0x050403 }));
      mouth.position.set(-30, Y5 + 3.15, 146.4);
      mouth.rotation.y = Math.PI;
      k.root.add(mouth);
      world.addBox(v(-30, Y5 + 3, 147), v(3.4, 3, 0.5));
      k.muralPanel(v(-30, Y5 + 8.5, 145.9), Math.PI, 5);
      // Morning light pouring into the shaft
      k.shaft(v(-36, Y5 + 22, 128), v(0.22, -0.55, 0.8), 32, 1.2, 3.2, new THREE.Color(1.0, 0.75, 0.5), 0.05);
    }
    // Stelae on the far abutment
    k.stela(v(-35.5, Y5, 138), 0.3, 0, 0.05, 0.9);
    k.stela(v(-24.5, Y5, 140), -0.3, 2, -0.06, 0.9);

    await step(0.72, 'Hanging gardens');
    this.dress();

    await step(0.86, 'Mist in the gorge');
    const sd = this.sunDir.clone().negate();
    for (const [x, y, z] of [[-14, 6, 20], [-18, 4, 46], [-20, 2, 78], [-22, -4, 110]] as const) k.shaft(v(x, y, z).addScaledVector(sd, -30), sd, 46, 2.2, 5.5, new THREE.Color(1.0, 0.74, 0.52), 0.035);
    k.particles('mist', 70, v(-30, -55, 70), v(60, 30, 160), new THREE.Color(0.4, 0.43, 0.48), 110, 0.2, 4, 'tex.mist');
    k.particles('mist', 30, v(-10, -18, 40), v(50, 10, 90), new THREE.Color(0.9, 0.85, 0.8), 40, 0.16, 5, 'tex.mist');
    k.particles('dust', 300, v(-12, Y1, 50), v(50, 14, 110), new THREE.Color(1, 0.86, 0.66), 0.1, 0.5, 6);
    k.particles('pollen', 160, v(0, Y1, 20), v(30, 8, 40), new THREE.Color(1, 0.92, 0.75), 0.09, 0.5, 7);
    k.particles('leaves', 50, v(-18, Y1 + 4, 70), v(40, 16, 60), new THREE.Color(1, 1, 1), 0.18, 0.95, 8, 'tex.leaf');
    this.bursts = k.bursts();
    // Distant city further down the gorge, catching the dawn.
    k.cityBackdrop(v(-60, -30, 170), v(0, 0, 1), v(1, 0, 0), 70, 5, 8);
    k.cityBackdrop(v(10, -36, 190), v(0, 0, 1), v(-1, 0, 0), 60, 5, 8);
    k.ridges(v(-20, 0, 80), [
      [360, 120, new THREE.Color(0.32, 0.3, 0.36)],
      [560, 220, new THREE.Color(0.42, 0.4, 0.46)],
    ]);
    k.finish();
    this.ctx.traversal.load(TRAVERSAL);
  }

  private buildCistern(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const c = CISTERN;
    // Basin walls (1.1 m) with three sluice openings
    const wallH = 1.1;
    const seg = (x: number, z: number, sx: number, sz: number) =>
      sx > sz
        ? k.coursedWall(x - sx / 2, z, x + sx / 2, z, c.y, c.y + wallH, { thick: sz, tint: 0.92 })
        : k.coursedWall(x, z - sz / 2, x, z + sz / 2, c.y, c.y + wallH, { thick: sx, tint: 0.92 });
    seg(c.x - 2, c.z + 3, 2.4, 0.5); // north wall left of gate A
    seg(c.x + 2, c.z + 3, 2.4, 0.5); // right
    seg(c.x, c.z - 3, 6.5, 0.5); // south
    seg(c.x - 3, c.z - 1.8, 0.5, 2.4); // east (gate C at z=c.z+0.6)
    seg(c.x - 3, c.z + 2.1, 0.5, 1.4);
    seg(c.x + 3, c.z - 1.8, 0.5, 2.4); // west (gate B)
    seg(c.x + 3, c.z + 2.1, 0.5, 1.4);
    const water = k.waterPlane(c.x, c.y + 0.85, c.z, 5.6, 5.6);
    water.renderOrder = 2;
    // Channels
    const chA = k.waterPlane(c.x, c.y + 0.05, (c.z + 3 + STAIR_TOP_Z) / 2, 1.2, STAIR_TOP_Z - c.z - 3);
    const chB = k.waterPlane((c.x + 3 + -23) / 2 + 0.6, c.y + 0.05, c.z + 0.6, -23 - (c.x + 3) - 1.2, 1.0);
    const chC = k.waterPlane((c.x - 3 + -41) / 2, c.y + 0.05, c.z + 0.6, c.x - 3 - -41, 1.0);
    for (const ch of [chA, chB, chC]) ch.visible = false;
    // Channel kerbs
    for (let z = c.z + 3.6; z < STAIR_TOP_Z; z += 1) {
      k.blockAt(v(c.x - 0.8, c.y + 0.15, z), v(0.3, 0.3, 1), 0, false, 0.85);
      k.blockAt(v(c.x + 0.8, c.y + 0.15, z), v(0.3, 0.3, 1), 0, false, 0.85);
    }
    // Sluice gates (stone slabs that slide up = open)
    const gate = (x: number, z: number, yaw: number) => {
      const g = new THREE.Mesh(k.block, k.masonMat);
      g.scale.set(1.4, 1.2, 0.3);
      g.position.set(x, c.y + 0.6, z);
      g.rotation.y = yaw;
      g.castShadow = true;
      k.root.add(g);
      return g;
    };
    const gA = gate(c.x, c.z + 3, 0);
    const gB = gate(c.x + 3, c.z + 0.6, Math.PI / 2);
    const gC = gate(c.x - 3, c.z + 0.6, Math.PI / 2);
    // Gate frames + glyph tablets
    for (const [gx, gz, yaw] of [[c.x, c.z + 3, 0], [c.x + 3, c.z + 0.6, Math.PI / 2], [c.x - 3, c.z + 0.6, Math.PI / 2]] as const) {
      const ax = Math.cos(yaw);
      const az = -Math.sin(yaw);
      k.blockAt(v(gx + ax * 0.85, c.y + 1.3, gz + az * 0.85), v(0.3, 2.6, 0.5), yaw, false, 1.0);
      k.blockAt(v(gx - ax * 0.85, c.y + 1.3, gz - az * 0.85), v(0.3, 2.6, 0.5), yaw, false, 1.0);
      k.blockAt(v(gx, c.y + 2.7, gz), v(2.1, 0.3, 0.55), yaw, false, 1.0);
    }
    // Spill (C) over the east edge: waterfall into the abyss.
    const spill = new THREE.Group();
    spill.add(waterfallMesh(v(-41.2, c.y + 0.05, c.z + 0.6), v(-42, c.y - 40, c.z + 0.6), 1.0, v(-1, 0, 0), k.fallMat));
    k.root.add(spill);
    // Counterweight basin (B) + hanging weight above the stair
    k.blockAt(v(-23, c.y + 0.5, c.z + 0.6), v(2.6, 1.0, 2.6), 0, true, 0.9);
    this.basinWater = k.waterPlane(-23, c.y + 0.2, c.z + 0.6, 2.0, 2.0);
    const basinFall = new THREE.Group();
    basinFall.add(k.particles('spray', 30, v(-23.6, c.y + 0.3, c.z + 0.6), v(0.8, 0.6, 0.8), new THREE.Color(0.95, 0.97, 1), 0.18, 0.5, 22, 'tex.mist'));
    k.root.add(basinFall);
    // Weight: a carved stone hanging from a timber gantry over the stair head
    {
      for (const gx of [-25.2, -20.8]) k.blockAt(v(gx, c.y + 2.2, 74), v(0.5, 4.4, 0.5), 0, true, 1.0);
      k.blockAt(v(-23, c.y + 4.5, 74), v(5, 0.45, 0.6), 0, false, 1.0);
      const w = new THREE.Mesh(k.rocks[1], k.masonMat);
      w.scale.set(0.8, 0.95, 0.8);
      w.position.set(-23, c.y + 3.2, 74);
      w.castShadow = true;
      k.root.add(w);
      this.weight = w;
      this.weightY0 = w.position.y;
      const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), k.PM.rope);
      k.root.add(sling);
      this.weightSling = sling;
    }
    // Stair cascade (when gate A is open) + torrent blocker at the stair head
    // Stair cascade: a sheet of water running down the steps, white where it breaks, spray below.
    const stairFall = new THREE.Group();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(v(c.x, c.y + 0.12 + (Y5 - c.y) * t, STAIR_TOP_Z + (STAIR_BOTTOM_Z - 0.5 - STAIR_TOP_Z) * t));
    }
    stairFall.add(riverMesh(pts, 2.7, k.waterMat, 60));
    const spray = k.particles('spray', 90, v(c.x, Y5, STAIR_BOTTOM_Z - 1.2), v(3, 2.5, 2), new THREE.Color(0.95, 0.97, 1), 0.35, 0.55, 21, 'tex.mist');
    stairFall.add(spray);
    k.root.add(stairFall);
    this.torrent = world.addBox(v(c.x, c.y + 1, STAIR_TOP_Z + 0.6), v(1.6, 1, 0.6), 0, { dynamic: true, blocksCamera: false });
    this.sluiceFX = { stair: stairFall, spill, basin: basinFall, channels: [chA, chB, chC] };

    this.sluice = new TogglePuzzle('ch2_sluices', [
      { object: gA, initial: true, solution: false, offset: v(0, 1.25, 0) },
      { object: gB, initial: false, solution: true, offset: v(0, 1.25, 0) },
      { object: gC, initial: true, solution: false, offset: v(0, 1.25, 0) },
    ]);
  }

  private buildSpan(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const pieces: CollapsePiece[] = [];
    const mat = k.masonMat;
    // One arched bay of the aqueduct: spandrel with a round arch, a pier, coursed kerbs and the
    // water channel on top. Each collapsing piece is one bay.
    const spandrel = (() => {
      const sh = new THREE.Shape();
      sh.moveTo(-2, -0.4);
      sh.lineTo(2, -0.4);
      sh.lineTo(2, -3.6);
      sh.lineTo(0.7, -3.6);
      sh.absarc(-0.5, -3.6, 1.2, 0, Math.PI, false);
      sh.lineTo(-2, -3.6);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 2.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1, curveSegments: 10 });
      g.translate(0, 0, -1.15);
      g.rotateY(-Math.PI / 2);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.9), 3));
      return k.track(g);
    })();
    const build = (z0: number, z1: number, collapses: boolean, wet = true) => {
      const g = new THREE.Group();
      const parts = new THREE.Group();
      const zc = (z0 + z1) / 2;
      const len = z1 - z0;
      g.position.set(SPAN_X, Y5, zc);
      const add = (geo: THREE.BufferGeometry, p: THREE.Vector3, s: THREE.Vector3, tint = 0.9) => {
        const m = new THREE.Mesh(geo.clone(), mat);
        m.position.copy(p);
        m.scale.copy(s);
        m.castShadow = true;
        m.receiveShadow = true;
        parts.add(m);
        void tint;
        return m;
      };
      add(k.plate, v(0, -0.25, 0), v(2.7, 0.5, len - 0.03));
      const bays = Math.max(1, Math.round(len / 4));
      for (let b = 0; b < bays; b++) {
        const bz = -len / 2 + (b + 0.5) * (len / bays);
        add(spandrel, v(0, 0, bz), v(1, 1, len / bays / 4));
        add(k.ashlar, v(0, -3.6 - 8, bz + len / bays / 2 - 0.55), v(2.3, 16, 1.1)); // pier
        add(k.ashlar, v(0, -3.75, bz + len / bays / 2 - 0.55), v(2.6, 0.35, 1.4)); // impost
      }
      for (const sx of [-1.2, 1.2])
        for (let zz = -len / 2 + 0.4; zz < len / 2; zz += 0.8) add(k.ashlar, v(sx, 0.24, zz), v(0.32, 0.48, 0.78));
      const water = new THREE.Mesh(flowPlaneGeometry(2.05, len - 0.05), k.waterMat);
      water.position.y = 0.06;
      water.renderOrder = 2;
      water.visible = wet;
      g.add(mergeStatic(parts, 'aqueduct-bay'), water);
      k.root.add(g);
      const cols = [
        world.addBox(v(SPAN_X, Y5 - 0.4, zc), v(1.3, 0.4, len / 2), 0, { dynamic: collapses }),
        world.addBox(v(SPAN_X - 1.2, Y5 + 0.6, zc), v(0.15, 0.6, len / 2), 0, { dynamic: collapses, blocksCamera: false }),
        world.addBox(v(SPAN_X + 1.2, Y5 + 0.6, zc), v(0.15, 0.6, len / 2), 0, { dynamic: collapses, blocksCamera: false }),
      ];
      return { g, cols };
    };
    for (let i = 0; i < SPAN_PIECES; i++) {
      const z0 = SPAN_Z0 + i * SPAN_PIECE;
      const { g, cols } = build(z0, z0 + SPAN_PIECE, true);
      // Wave: first two pieces go together behind her, then one every 0.75 s.
      pieces.push({ object: g, colliders: cols, delay: i < 2 ? 0.7 : 0.7 + (i - 1) * 0.72, shudder: 0.7, spin: 0.4 + (i % 3) * 0.2 });
    }
    // The far end already broke long ago: a gap (jump) then the last arch on the abutment.
    // (that last arch has been dry since the span broke: its channel is empty)
    build(GAP_END, GAP_END + 5.5, false, false);
    // The channel pours off the broken end of the span into the gorge (and goes with it when it falls).
    const endZ = SPAN_Z0 + SPAN_PIECES * SPAN_PIECE;
    this.gapFall = waterfallMesh(v(SPAN_X, Y5 + 0.06, endZ - 0.1), v(SPAN_X, Y5 - 34, endZ - 0.1), 1.9, v(0, 0, 1), k.fallMat, 1.7);
    k.root.add(this.gapFall);
    this.span = new Collapse(pieces);
    this.span.setProxy(k.mergedCopy(pieces.map((p) => p.object), 'span-intact'));
    this.span.onShudder = (i) => this.ctx.audio.sfx.stoneGrind(0.9, v(SPAN_X, Y5, SPAN_Z0 + i * SPAN_PIECE + 2), 0.5);
    this.span.onDrop = (i) => {
      const p = v(SPAN_X, Y5, SPAN_Z0 + i * SPAN_PIECE + 2);
      this.ctx.audio.sfx.impact(p, 0.8);
      this.ctx.camera.addTrauma(0.35);
      this.bursts.emit(p, 22, v(2.5, 0.5, 2), v(0, -1, 0), 1.6, 3);
    };
    // The waterfall hammering the span from the cliff above (west side)
    k.waterfall(v(-24, Y0 + 12, 112), v(-29, -70, 112), 3.4, v(-1, 0, 0), -70, buildWaterfallFX);
  }

  /** Vegetation & small dressing on terrace tops and cliff faces. */
  private dress(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const rnd = k.rnd;
    const areas: [number, number, number, number, number][] = [
      [-6, 8, -4, 4.5, Y0],
      [-7.5, 12.5, 5.5, 21.5, Y1],
      [-7.5, 12.5, 22.5, 29.5, Y1B],
      [-7.5, 12.5, 30.5, 45.5, Y1],
      [-36.5, -26.5, 30.5, 49.5, Y1],
      [-40.5, -20.5, 62.5, 79.5, Y1],
      [-37.5, -22.5, GAP_END + 0.5, 145.5, Y5],
    ];
    const inArea = (x: number, z: number) => areas.find(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    const ground = (x: number, z: number) => inArea(x, z)?.[4] ?? -100;
    const clear = (x: number, z: number) => {
      const a = inArea(x, z);
      if (!a) return false;
      const g = world.groundAt(x, z, a[4] + 0.6);
      return Math.abs(g.y - a[4]) < 0.05;
    };
    const awayFrom = (x: number, z: number, pts: [number, number, number][]) => pts.every(([px, pz, r]) => Math.hypot(x - px, z - pz) > r);
    const keepClear: [number, number, number][] = [
      [2.5, 6.5, 2.4],
      [1.5, 21, 2.5],
      [8, 33, 2.2],
      [-7, 42, 2.4],
      [-27, 42, 2.4],
      [-28.7, 50, 2],
      [-28.7, 62, 2],
      [-31, 70, 4.8],
      [-23, 70, 2.5],
      [-31, 79.5, 2.2],
      [0.5, -1.5, 3],
      [2.6, 9, 3],
      [-4.5, 41.5, 3],
      [-31, 63.5, 3.5],
      [-30.6, 96.6, 3],
      [-30, 135, 3],
      [8, 35, 3],
    ];
    const path = (x: number, z: number) => {
      // Worn walking line through each terrace: keep it to grass only.
      const lines: [number, number, number, number][] = [[2.5, 6, 1.5, 22], [1.5, 30, -6, 42], [-27, 42, -28.7, 50], [-28.7, 62, -31, 80], [-30, 126, -30, 146]];
      return lines.some(([ax, az, bx, bz]) => {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 1.6;
      });
    };
    const ok = (x: number, z: number) => clear(x, z) && awayFrom(x, z, keepClear);
    const edge = (x: number, z: number) => {
      const a = inArea(x, z);
      if (!a) return 99;
      return Math.min(x - a[0], a[1] - x, z - a[2], a[3] - z);
    };
    const bounds: [number, number, number, number] = [-42, -6, 14, 147];
    k.grass(k.scatter(3400, bounds, ground, (x, z) => ok(x, z) && (fbm2(x * 0.09, z * 0.09, 3) > 0.05 || (path(x, z) ? rnd() < 0.08 : rnd() < 0.2)), [0.5, 1.0], { sink: 0.03 }));
    // Ferns and leaves crowd the walls and terrace edges, not the walking lines.
    k.ferns(k.scatter(220, bounds, ground, (x, z) => ok(x, z) && !path(x, z) && (edge(x, z) < 2.2 || fbm2(x * 0.06 + 5, z * 0.06, 3) > 0.25), [0.6, 1.2], { tilt: 0.2 }), 1);
    k.ferns(k.scatter(110, bounds, ground, (x, z) => ok(x, z) && !path(x, z) && edge(x, z) < 1.8, [0.7, 1.3], { tilt: 0.2 }), 2);
    k.broadleaf(k.scatter(60, bounds, ground, (x, z) => ok(x, z) && !path(x, z) && edge(x, z) < 1.5, [0.7, 1.2], { tilt: 0.15 }), 1);
    // A few slender trees rooted in the terraces (away from the route)
    const treeSpots: [number, number, number][] = [[11, 7, Y1], [-6, 18, Y1], [11.5, 44, Y1], [-35.5, 47, Y1], [-39, 64, Y1], [-21.5, 78.5, Y1], [-36.5, 144, Y5], [-23, 143, Y5]];
    const mats = treeSpots.map(([x, z, y]) => new THREE.Matrix4().compose(v(x, y - 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), v(0.7, 0.7, 0.7)));
    k.trees(mats, 'slender', 3);
    k.treeFerns(k.scatter(14, bounds, ground, (x, z) => ok(x, z) && rnd() < 0.3, [0.7, 1.0]));
    // Far forest on the eastern rim and the west rim top
    const far: THREE.Matrix4[] = [];
    for (let i = 0; i < 900; i++) {
      const east = true;
      const x = -115 + rnd() * 45;
      const z = -40 + rnd() * 230;
      const y = east ? -6 : 44;
      far.push(new THREE.Matrix4().compose(v(x, y - 1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), v(0.8 + rnd() * 0.6, 0.8 + rnd() * 0.6, 0.8 + rnd() * 0.6)));
    }
    k.farTrees(far);
    // Vines down the west wall and the terrace faces
    const vinesA: THREE.Matrix4[] = [];
    for (let i = 0; i < 40; i++) vinesA.push(k.vineMatrix(13.8, 10 + rnd() * 25, -4 + rnd() * 150, 6.5, Math.PI / 2 + (rnd() - 0.5) * 0.4));
    k.vines(vinesA, 6.5, 2);
    const vinesB: THREE.Matrix4[] = [];
    for (let i = 0; i < 26; i++) {
      const pick = rnd();
      if (pick < 0.5) vinesB.push(k.vineMatrix(-8.15, Y1, 6 + rnd() * 40, 4, -Math.PI / 2));
      else vinesB.push(k.vineMatrix(-25.85, Y1, 31 + rnd() * 18, 4, Math.PI / 2));
    }
    k.vines(vinesB, 4, 1);
    // Ribbons marking the route (someone maintains them here too)
    const ribbons: [number, number, number][] = [[3.4, Y0 + 1.0, 4.2], [1.0, Y1B + 0.4, 22.1], [-7.6, Y1 + 0.9, 41.2], [-26.4, Y1 + 0.9, 41.2], [-28.9, Y1 + 1.2, 50.1], [-31, Y5 + 2.8, STAIR_BOTTOM_Z + 0.9], [-30, Y5 + 1.0, GAP_END + 0.3]];
    ribbons.forEach(([x, y, z], i) => {
      const r = P.pitonRibbon(k.PM, 40 + i);
      r.position.set(x, y, z);
      k.props.add(r);
    });
  }

  // ================================================================ setup
  protected setup(): void {
    const { interaction, player, dialogue, state, audio } = this.ctx;
    state.register(this.sluice);
    this.disposers.push(() => state.unregister(this.sluice.key));
    this.sluice.onToggle = (i) => {
      const pos = this.sluiceWheel(i);
      audio.sfx.stoneGrind(this.sluice.moveTime, pos, 0.45);
    };
    this.sluice.onSettled = (i) => {
      audio.sfx.clunk(this.sluiceWheel(i), 0.45);
      this.updateWater();
      if (this.sluice.solved) return;
      const s = this.sluice.states;
      if (s[1] && s[2] && !s[0]) dialogue.say(CH2.basinTrickle, true);
      else if (s[1] && !s[2] && s[0]) dialogue.say(CH2.stairStillFlooded, true);
      if (this.sluice.toggles >= 6) this.say('cisternHint', CH2.cisternHint);
    };
    this.sluice.onSolved = () => {
      state.progress.completedPuzzles.add('ch2_sluices');
      this.ctx.events.emit('puzzle:solved', { id: 'ch2_sluices' });
      this.after(1.6, () => this.playDoorOpen());
    };
    ['Stair sluice', 'Basin sluice', 'Spill sluice'].forEach((label, i) => {
      interaction.add({
        id: `sluice:${i}`,
        position: this.sluiceWheel(i),
        radius: 1.7,
        prompt: `Turn the ${label.toLowerCase()}`,
        enabled: true,
        facing: 0.2,
        onInteract: () => {
          if (this.sluice.solved || this.sluice.busy) return;
          player.playAction('PUSH', this.sluiceWheel(i), 1.1);
          this.after(0.35, () => this.sluice.toggle(i));
        },
      });
    });
    interaction.add({
      id: 'rope',
      position: ANCHOR.clone().setY(Y0 + 1),
      radius: 2,
      prompt: 'Fix the rope',
      enabled: true,
      facing: 0,
      onInteract: () => this.useRope(),
    });
    this.examine('stairGone', v(0.5, Y0 + 0.6, 4.5), CH2.stairGone, { radius: 2.4, action: false });
    this.examine('cisternLook', CISTERN.clone().setY(Y1 + 1), CH2.cistern, { prompt: 'Study the sluices', radius: 3.6, once: true });
    this.ctx.camera.hints = [
      { id: 'overlook', center: v(1, Y0, 0), radius: 6, distance: 4.4, fovAdd: 4 },
      { id: 'bridge', center: v(-17, Y1, 42), radius: 9, distance: 4.6, heightAdd: 0.2, fovAdd: 4 },
      { id: 'cistern', center: CISTERN.clone(), radius: 9, distance: 4.8, pitch: 0.1, fovAdd: 4 },
      { id: 'span', center: v(SPAN_X, Y5, 114), radius: 16, distance: 4.9, fovAdd: 6 },
      { id: 'shaft', center: v(-30, Y5, 140), radius: 7, distance: 4.3, fovAdd: 3 },
    ];
  }

  private sluiceWheel(i: number): THREE.Vector3 {
    const c = CISTERN;
    if (i === 0) return v(c.x + 1.6, c.y + 0.9, c.z + 3.8);
    if (i === 1) return v(c.x + 3.8, c.y + 0.9, c.z - 0.6);
    return v(c.x - 3.8, c.y + 0.9, c.z - 0.6);
  }

  // (hero frames hold the same pose as the real rappel)
  private useRope(): void {
    const { interaction, player, dialogue } = this.ctx;
    const it = interaction.get('rope')!;
    if (!this.ropeFixed) {
      player.playAction('INTERACT', ANCHOR, 2.4);
      // She ties it round the column first; then the coil goes over the edge and runs out.
      this.after(0.7, () => {
        this.ropePay = 0;
        this.applyRope();
        this.rope.visible = true;
        this.ctx.audio.sfx.climbGrab('ledge');
      });
      this.after(2.0, () => {
        this.ropeFixed = true;
        it.prompt = 'Rappel down';
        this.ctx.audio.sfx.climbGrab('ledge');
        dialogue.sayOnce('ch2:ropeFixed', CH2.ropeFixed);
      });
      return;
    }
    // Rappel: face the wall (south), walk backwards over the lip, lower down the face.
    it.enabled = false;
    const top = RAPPEL_TOP.clone();
    const mid = v(RAPPEL_TOP.x, Y0 - 4.5, RAPPEL_TOP.z + 0.55);
    this.ctx.audio.sfx.climbGrab('climb');
    // She lowers herself backwards, feet walking down the wall, hands on the rope.
    player.scriptRig = { kind: 'rappel', normal: v(0, 0, 1), wall: v(RAPPEL_TOP.x, Y0, RAPPEL_TOP.z - 0.25), topY: Y0 };
    this.scriptedMove([player.position.clone(), top, mid, RAPPEL_BOTTOM.clone()], 5.4, 'CLIMB', Math.PI, () => {
      it.enabled = true;
      this.ctx.audio.sfx.land(1.2);
      this.checkpoint('ch2_terraces');
      this.say('kitchens', CH2.kitchens);
    });
  }

  private updateWater(): void {
    const s = this.sluice.states;
    const fx = this.sluiceFX;
    const solved = this.sluice.solved;
    fx.stair.visible = s[0];
    fx.channels[0].visible = s[0];
    fx.channels[1].visible = s[1];
    fx.basin.visible = s[1];
    fx.channels[2].visible = s[2];
    fx.spill.visible = s[2];
    this.torrent.enabled = s[0] && !solved;
    void solved;
  }

  // ================================================================ world state
  protected saveWorld(): Record<string, unknown> {
    const d: WorldSave = { rope: this.ropeFixed, spanDone: this.spanDone };
    return d as unknown as Record<string, unknown>;
  }

  protected loadWorld(d: Record<string, unknown> | undefined): void {
    const w = d as unknown as WorldSave | undefined;
    this.ropeFixed = w?.rope ?? false;
    this.spanDone = w?.spanDone ?? false;
  }

  protected applyWorld(checkpoint: string): void {
    this.endStarted = false;
    this.rope.visible = this.ropeFixed;
    this.ropePay = 1;
    this.applyRope();
    const rope = this.ctx.interaction.get('rope');
    if (rope) {
      rope.prompt = this.ropeFixed ? 'Rappel down' : 'Fix the rope';
      rope.enabled = true;
    }
    this.fill = this.sluice.solved ? 1 : 0;
    this.doorK = this.sluice.solved ? 1 : 0;
    this.applyDoor();
    this.updateWater();
    // The span is reset for every retry until she has crossed it.
    const crossed = this.spanDone || this.checkpointOrder.indexOf(checkpoint) >= this.checkpointOrder.indexOf('ch2_shaft');
    if (crossed) this.span.finish();
    else this.span.reset();
    this.ctx.player.speedCap = Infinity;
  }

  /** Hanging line length for how much rope has run out (falling: slow, then fast). */
  private applyRope(): void {
    const k = Math.max(0.02, this.ropePay * this.ropePay);
    this.ropeLine.scale.y = this.ropeLen * k;
    this.ropeLine.position.y = Y0 + 0.05 - (this.ropeLen * k) / 2;
  }

  private applyDoor(): void {
    const e = this.doorK * this.doorK * (3 - 2 * this.doorK);
    this.door.position.y = Y5 + 2 + e * 4.3;
    this.doorCollider.enabled = this.doorK < 0.7;
    this.weight.position.y = this.weightY0 - e * 2.3;
    // (the sling runs from the gantry beam down to the top of the stone, whatever its height)
    const beamY = Y1 + 4.3;
    const stoneTop = this.weight.position.y + 0.55;
    this.weightSling.scale.y = Math.max(0.05, beamY - stoneTop);
    this.weightSling.position.set(-23, (beamY + stoneTop) / 2, 74);
    this.basinWater.position.y = Y1 + 0.2 + this.fill * 0.75;
  }

  protected ambience(): AmbienceConfig {
    return {
      wind: 1.0,
      insects: 0.4,
      birds: 1,
      frogs: 0,
      drips: 0.6,
      water: [
        { pos: v(-27, Y5, 112), gain: 0.6, kind: 'falls' },
        { pos: v(-30.5, Y1 + 2, 63), gain: 0.18, kind: 'falls' },
        { pos: CISTERN.clone(), gain: 0.14, kind: 'river' },
        { pos: v(-30, -78, 70), gain: 0.25, kind: 'river' },
      ],
    };
  }

  protected restoreMood() {
    return this.cpIndex() >= 5 ? ('wonder' as const) : ('explore' as const);
  }

  protected onRespawned(): void {
    this.after(1.4, () => this.ctx.dialogue.sayOnce('ch2:fallRespawn', CH2.fallRespawn));
  }

  // ================================================================ update
  protected tick(dt: number): void {
    this.sluice.update(dt);
    this.span.update(dt);
    this.gapFall.visible = !this.span.started && !this.spanDone && this.cpIndex() < 5;
    // The rope pays out from the anchor after she ties it off.
    if (this.ropePay < 1) {
      this.ropePay = Math.min(1, this.ropePay + dt / 1.25);
      this.applyRope();
    }
    this.bursts.update(dt);
    // Counterweight basin fills only when all of the flow goes into it.
    const s = this.sluice.states;
    const filling = this.sluice.solved || (s[1] && !s[0] && !s[2]);
    this.fill = Math.max(0, Math.min(1, this.fill + (filling ? dt / 2.5 : -dt / 6)));
    if (this.sluice.solved && this.doorK < 1 && this.played('doorOpen')) this.doorK = Math.min(1, this.doorK + dt / 3.2);
    this.applyDoor();
    // Lethal: still on a piece when it fell → the fall kills; nothing extra needed.
    // The overlook's stair is gone: the only way down alive is the rope.
    const pl = this.ctx.player;
    if (this.cpIndex() === 0 && pl.grounded && pl.position.y < Y0 - 3 && pl.position.z > 5 && pl.position.z < 12 && pl.mode.kind === 'ground') pl.kill('fell');
  }

  protected triggers(): void {
    const { player } = this.ctx;
    const p = player.position;
    if (!this.ropeFixed && p.distanceTo(ANCHOR) < 4) this.say('stairGone', CH2.stairGone);
    if (p.y < Y1B + 0.5 && p.z > 19 && p.z < 22.5 && p.x > -1 && p.x < 4) this.say('wallClimb', CH2.wallClimb);
    if (p.z > 31 && p.z < 35 && p.x > 5 && p.x < 11) this.say('house', CH2.house);
    if (this.ctx.state.progress.collectibles.has('ch2_plate_41') && this.ctx.state.progress.collectibles.has('ch2_cache_note')) this.say('cacheFound', CH2.cacheFound);
    if (p.z > 38 && p.x < -3 && p.y > Y1 - 1) {
      this.checkpoint('ch2_bridge');
      this.say('bridge', CH2.bridge);
    }
    if (p.x < -14 && p.x > -20 && Math.abs(p.z - 42) < 1.5) this.say('bridgeHalf', CH2.bridgeHalf);
    if (player.mode.kind === 'ledge') {
      this.say('ledge', CH2.ledge);
      this.setMood('tension');
    } else if (this.mood === 'tension' && p.z > 62 && p.z < 90) this.setMood('explore');
    if (p.z > 62.5 && p.z < 80 && p.x < -20 && p.y > Y1 - 1) this.checkpoint('ch2_cistern');
    if (p.z > STAIR_BOTTOM_Z + 1 && p.y < Y5 + 1) {
      this.checkpoint('ch2_span');
      this.say('span', CH2.span);
    }
    // Aqueduct collapse: starts once she's committed to the span.
    if (!this.span.started && !this.spanDone && p.z > SPAN_Z0 + 6 && p.z < 124 && p.y > Y5 - 1) {
      this.span.start();
      this.setMood('tension', 0.8);
      this.ctx.audio.sfx.rumble(6, v(SPAN_X, Y5, 110), 0.9);
      this.ctx.camera.addTrauma(0.5);
      this.ctx.dialogue.say(CH2.collapse, true);
    }
    if (!this.spanDone && p.z > GAP_END + 0.5 && p.y > Y5 - 0.5 && player.grounded) {
      this.spanDone = true;
      this.checkpoint('ch2_shaft');
      this.after(1.2, () => this.say('spanSafe', CH2.spanSafe));
      this.after(4, () => this.setMood('explore'));
    }
    if (this.spanDone && !this.endStarted && p.z > 141) {
      this.endStarted = true;
      this.playEnd();
    }
  }

  // ================================================================ cinematics
  protected intro(): void {
    const { cinematic, dialogue, hud, state, player, camera, audio } = this.ctx;
    const cp = this.checkpoints.ch2_start;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('wonder', 4);
    const seq: Sequence = {
      id: 'ch2_intro',
      duration: 17,
      skippable: true,
      letterbox: true,
      blendIn: 0,
      dof: true,
      blendOut: 1.6,
      shots: [
        // Dawn: the gorge from out over the abyss, drifting toward the overlook.
        { t0: 0, t1: 7, path: [v(-15, 8, 60), v(-15, 5, 36), v(-11, 3, 16)], look: [v(-28, -16, 130), v(-14, -10, 80), v(1, Y0 + 1, 0)], fov: [48, 44], ease: 'inOut', sway: 0.04, focus: 60 },
        // Ines at the parapet, the radio at her shoulder.
        { t0: 7, t1: 12.5, path: [v(4.2, Y0 + 1.7, 2.6), v(3.4, Y0 + 1.6, 1.8)], look: [v(0.6, Y0 + 1.5, -1.3), v(0.6, Y0 + 1.5, -1.3)], fov: [36, 34], ease: 'linear', sway: 0.015 },
        // Over her shoulder: the drop where the stair used to be.
        { t0: 12.5, t1: 17, path: [v(-1.2, Y0 + 2.8, -4.4), v(-0.4, Y0 + 3.3, -3.4)], look: [v(2.5, Y1 + 2, 14), v(2.5, Y1 + 1, 18)], fov: [50, 54], ease: 'inOut', sway: 0.02 },
      ],
      events: [
        { t: 0.6, run: (skip) => !skip && hud.chapterCard(this.numberLabel, this.title, 5), onSkip: false },
        { t: 6.2, run: (skip) => dialogue.sayOnce('ch2:intro', CH2.intro, skip) },
        {
          t: 16.9,
          run: () => {
            state.progress.setFlag('ch2_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.2);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 6.2, CH2.intro));
  }

  private playDoorOpen(): void {
    const { cinematic, dialogue, audio, camera, player } = this.ctx;
    const seq: Sequence = {
      id: 'ch2_door',
      duration: 7,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.4,
      shots: [
        { t0: 0, t1: 2.6, path: [v(-21, Y1 + 2.5, 66), v(-20.5, Y1 + 2.8, 67.5)], look: [v(-23, Y1 + 3, 74), v(-23, Y1 + 2, 74)], fov: [44, 42], ease: 'inOut', sway: 0.02 },
        { t0: 2.6, t1: 7, path: [v(-31, Y1 + 1.5, 79.5), v(-31, Y1 - 1.5, 83)], look: [v(-31, Y5 + 2.5, STAIR_BOTTOM_Z), v(-31, Y5 + 3.5, STAIR_BOTTOM_Z)], fov: [46, 40], ease: 'inOut', sway: 0.02 },
      ],
      events: [
        { t: 0.1, run: () => this.scripted(true, 'IDLE') },
        { t: 0.4, run: () => dialogue.sayOnce('ch2:doorOpen', CH2.doorOpen, true) },
        { t: 1.0, run: (s) => !s && audio.sfx.rumble(4, v(-31, Y5, STAIR_BOTTOM_Z), 0.7), onSkip: false },
        { t: 1.6, run: (s) => !s && camera.addTrauma(0.25), onSkip: false },
        {
          t: 6.9,
          run: () => {
            this.doorK = 1;
            this.scripted(false);
            camera.snap(player, player.yaw, 0.2);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 0.4, CH2.doorOpen));
  }

  private playEnd(): void {
    const { cinematic, dialogue, player, audio, completeChapter } = this.ctx;
    const seq: Sequence = {
      id: 'ch2_end',
      duration: 16,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.2,
      shots: [
        { t0: 0, t1: 6, path: [v(-26, Y5 + 1.6, 139), v(-27.5, Y5 + 1.8, 141.5)], look: [v(-30, Y5 + 3, 147), v(-30, Y5 + 3.4, 150)], fov: [44, 40], ease: 'inOut', sway: 0.02 },
        { t0: 6, t1: 16, path: [v(-30, Y5 + 2.2, 137), v(-30, Y5 + 1.9, 142.5)], look: [v(-30, Y5 + 2.6, 150), v(-30, Y5 + 2.2, 160)], fov: [52, 46], ease: 'inOut', sway: 0.02, focus: 12 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(-30, Y5, 143.2), 0);
            this.scripted(true);
          },
        },
        { t: 0.3, run: () => audio.music.setMood('wonder', 3) },
        { t: 1.5, run: () => dialogue.sayOnce('ch2:shaftMouth', CH2.shaftMouth, true) },
        { t: 14, run: () => completeChapter() },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 1.5, CH2.shaftMouth));
  }

  // ================================================================ misc
  objective(): string {
    const cp = this.cpIndex();
    if (this.spanDone) return 'Enter the sun-shafts.';
    if (cp >= 4) return 'Cross the great aqueduct.';
    if (this.sluice?.solved) return 'Take the water-stair down through the open door.';
    if (cp >= 3) return 'The cistern floods the stair. Redirect the water to open the way down.';
    if (cp >= 2) return 'Cross the rope bridge and follow the gorge wall north.';
    if (cp >= 1) return 'Descend the terraces. Marta was here — look for her traces.';
    if (this.ropeFixed) return 'Rappel down from the overlook.';
    return 'Fix a rope at the overlook so Toby can follow.';
  }

  objectiveTarget(): THREE.Vector3 | null {
    const cp = this.cpIndex();
    if (this.spanDone) return SHAFT.clone();
    if (cp >= 4) return v(SPAN_X, Y5, GAP_END + 2);
    if (this.sluice?.solved) return v(-31, Y5, STAIR_BOTTOM_Z + 1);
    if (cp >= 3) return CISTERN.clone();
    if (cp >= 2) return v(-28.7, Y1, 56);
    if (cp >= 1) return v(-7, Y1, 42);
    return ANCHOR.clone();
  }

  mapPoints(): THREE.Vector3[] {
    return [v(8, Y1, 37), CISTERN.clone()];
  }

  protected mapBounds = { minX: -46, maxX: 16, minZ: -8, maxZ: 150 };

  protected mapHeight(x: number, z: number): number {
    return this.ctx.world.groundAt(x, z, 60).y;
  }

  protected mapColor(x: number, z: number): [number, number, number] {
    const y = this.ctx.world.groundAt(x, z, 60).y;
    if (y < -40) return [24, 30, 36];
    if (Math.abs(z - 42) < 0.8 && x < -8 && x > -26) return [140, 110, 70];
    if (y > 2) return [96, 72, 58];
    return [126, 116, 96];
  }

  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    out.position.set(-20 + Math.sin(t * 0.05) * 6, 4, 40);
    out.look.set(-20, -10, 110);
  }

  heroFrames(): HeroFrame[] {
    const p = this.ctx.player;
    const stand = (x: number, y: number, z: number, yaw: number, anim?: 'CLIMB' | 'LEDGE_IDLE' | 'IDLE') => {
      p.teleport(v(x, y, z), yaw);
      if (anim && anim !== 'IDLE') {
        p.setScripted(true);
        p.avatar.driver.setState(anim, { fade: 0.01 });
        const wallN = v(-Math.sin(yaw), 0, -Math.cos(yaw));
        if (anim === 'CLIMB') p.scriptRig = { kind: 'climb', normal: wallN };
        else if (anim === 'LEDGE_IDLE') p.scriptRig = { kind: 'sidle', normal: wallN };
      }
    };
    return [
      { name: 'dawn-overlook', cp: 'ch2_start', cam: [-14, 5, 22], look: [2, -1, -1], prep: () => stand(1.5, Y0, 3.6, Math.PI * 0.9) },
      { name: 'rappel', cp: 'ch2_start', cam: [7.5, -5.5, 11.5], look: [2.5, -4.5, 5.6], prep: () => { this.ropeFixed = true; this.rope.visible = true; stand(2.5, -4.6, 6.0, Math.PI, 'CLIMB'); p.scriptRig = { kind: 'rappel', normal: v(0, 0, 1), wall: v(RAPPEL_TOP.x, Y0, RAPPEL_TOP.z - 0.25), topY: Y0 }; } },
      { name: 'kitchens', cp: 'ch2_terraces', cam: [-6.4, -7.9, 6.2], look: [3, -9.6, 18], prep: () => stand(-1.5, Y1, 13.5, 2.4) },
      { name: 'wall-climb', cp: 'ch2_terraces', cam: [5.2, -7.6, 16.2], look: [1.5, -7.6, 22], prep: () => stand(1.5, -8.2, 21.6, 0, 'CLIMB') },
      { name: 'terrace-house', cp: 'ch2_bridge', cam: [2.2, -8.2, 28.6], look: [8, -8.6, 36], prep: () => stand(6.8, Y1, 32.4, 2.6) },
      { name: 'darkroom', cp: 'ch2_bridge', cam: [6.2, -8.5, 35.4], look: [9.6, -9.3, 38.8], prep: () => stand(7.6, Y1, 37.3, 1.1) },
      { name: 'rope-bridge', cp: 'ch2_bridge', cam: [-12, -7.4, 35.5], look: [-18, -10, 42], prep: () => stand(-17.5, Y1 - 0.5, 42, -Math.PI / 2) },
      { name: 'aqueduct-ledge', cp: 'ch2_bridge', cam: [-22.5, -8.2, 52], look: [-28.7, -9, 56.5], prep: () => stand(-28.7, Y1, 56.5, -Math.PI / 2, 'LEDGE_IDLE') },
      { name: 'cistern', cp: 'ch2_cistern', cam: [-21.5, -6.2, 62.5], look: [-31, -9.4, 71.5], prep: () => stand(-27.2, Y1, 68.6, -2.2) },
      { name: 'water-stair', cp: 'ch2_cistern', cam: [-31, -11.4, 83.5], look: [-31, -19, 94], prep: () => stand(-31, -14.6, 87, 0) },
      { name: 'aqueduct-span', cp: 'ch2_span', cam: [-39, -15.5, 103], look: [-30, -20, 113], prep: () => stand(-30, Y5, 110, 0) },
      { name: 'shaft-mouth', cp: 'ch2_shaft', cam: [-26.6, -18.3, 134.4], look: [-30, -17.2, 146], prep: () => stand(-30.4, Y5, 140.5, 0) },
    ];
  }

  /** Test hook (window.__TFE.chapterDebug). */
  debug() {
    return { rope: this.ropeFixed, sluice: [...this.sluice.states], solved: this.sluice.solved, doorK: +this.doorK.toFixed(2), fill: +this.fill.toFixed(2), spanStarted: this.span.started, spanDone: this.spanDone };
  }
}
