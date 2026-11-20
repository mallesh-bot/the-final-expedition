import * as THREE from 'three';
import type { CheckpointDef } from '../Chapter';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Sequence } from '../../cinematic/Sequence';
import type { NpcActor } from '../../actors/NpcActor';
import type { BurstPool } from '../../world/Particles';
import { ChapterBase, type HeroFrame } from '../common/ChapterBase';
import { standardManifest, v } from '../common/LevelKit';
import { makeClimb, makeLedge, type TraversalSet } from '../../traversal/TraversalTypes';
import { Collapse, type CollapsePiece } from '../../world/Collapse';
import { Rockfall, type RockDrop } from '../../world/Rockfall';
import * as P from '../../world/Props';
import { waterfallMesh } from '../../world/Water';
import { mergeStatic } from '../../world/StaticMerge';
import * as M from '../../world/ModernProps';
import { fbm2 } from '../../systems/noise';
import { characterDef } from '../../animation/CharacterAvatar';
import { CH4 } from '../../story/dialogue/ch4';

/*
 * CHAPTER FOUR — THE EXPEDITION (STORY_BIBLE §14.5). Just before noon, Day 2.
 * Corwin's camp on the near abutment of the great bridge (z 20..50) → the betrayal → Dace walks
 * out to the detonator mid-span → the blast → the bridge breaks span by span behind (and in front
 * of) Ines: sprint, jump the gap, climb the far abutment, outrun the crumbling terrace and the
 * rockfall, shuffle out along the last ledge → she falls, alone, toward the sanctum.
 */
const BRIDGE_Z0 = 50;
const BRIDGE_Z1 = 130;
const PIECE = 4;
const GAP_Z0 = 98;
const FAR_Y = 3.2;
const FAR_Z0 = 130;
const FAR_Z1 = 158;
const SHELF_X = 13.95;
const BLAST_AT = v(0, -14, 96);
const DETONATOR = v(1.1, 0, 92.5);
const N = v(0, 0, -1);
/** Seconds between the blast (collapse start) and the player getting control back. */
const ESCAPE_T0 = 5.9;

const CHECKPOINTS: Record<string, CheckpointDef> = {
  ch4_start: { pos: v(0, 0, -8), yaw: 0, label: 'The central gorge' },
  ch4_camp: { pos: v(0, 0, 28), yaw: 0, label: "Corwin's camp" },
  ch4_bridge: { pos: v(0, 0, 84), yaw: 0, label: 'The great bridge' },
  ch4_far: { pos: v(1.5, FAR_Y, 132.2), yaw: 0.5, label: 'The far abutment' },
  ch4_ledge: { pos: v(SHELF_X, FAR_Y, 158.9), yaw: 0, label: 'The last ledge' },
};

const CLIMB_FAR = makeClimb('c4_far', v(0, 0, FAR_Z0), N, 3, FAR_Y, 'l4_far');
const LEDGE_FAR = makeLedge('l4_far', v(1.5, FAR_Y, FAR_Z0), v(-1.5, FAR_Y, FAR_Z0), N, 'all', 'c4_far');
const TRAVERSAL: TraversalSet = {
  climbs: [CLIMB_FAR],
  ledges: [LEDGE_FAR],
  narrows: [{ id: 'lastLedge', a: v(SHELF_X, FAR_Y, FAR_Z1 + 0.4), b: v(SHELF_X, FAR_Y, 170), normal: v(-1, 0, 0) }],
  vaults: [],
  jumps: [{ id: 'bridgeGap', from: v(0, 0, GAP_Z0 - 0.7), fromRadius: 1.6, to: v(0, 0, GAP_Z0 + PIECE + 1.2) }],
};

/** Toby's route from the gorge path into the camp. */
const ROUTE = [v(0, 0, -12), v(0, 0, 18), v(0, 0, 26)];

interface WorldSave {
  met: boolean;
  blast: boolean;
  toby: number;
  corwin: number;
}

export default class Chapter4 extends ChapterBase {
  readonly id = 4;
  readonly title = 'THE EXPEDITION';
  readonly numberLabel = 'CHAPTER FOUR';
  readonly checkpoints = CHECKPOINTS;
  readonly firstCheckpoint = 'ch4_start';
  protected readonly checkpointOrder = ['ch4_start', 'ch4_camp', 'ch4_bridge', 'ch4_far', 'ch4_ledge'];
  readonly manifest = standardManifest(
    'ch4',
    [
      { key: characterDef('corwin').asset, type: 'gltf', url: characterDef('corwin').url, weight: 2 },
      { key: characterDef('dace').asset, type: 'gltf', url: characterDef('dace').url, weight: 2 },
    ],
    { cliffTint: [150, 120, 100] },
  );
  protected kitOptions = { masonMoss: 0.6, cliffMoss: 0.65 };

  private met = false;
  private blastDone = false;
  private tobyTalk = 0;
  private corwinTalk = 0;
  private toby!: NpcActor;
  private corwin!: NpcActor;
  private dace!: NpcActor;
  private bridge!: Collapse;
  private far!: Collapse;
  private rocksF!: Rockfall;
  private rocksB!: Rockfall;
  private bursts!: BurstPool;
  private smoke!: BurstPool;
  private flash!: THREE.PointLight;
  private flashK = 0;
  private fireball!: THREE.Group;
  private escapeT = -1;
  private farStarted = false;
  private endStarted = false;
  private detonatorObj!: THREE.Object3D;

  // ================================================================ build
  protected async build(step: (f: number, label: string) => Promise<void>): Promise<void> {
    const k = this.kit;
    const { world } = this.ctx;
    const rnd = k.rnd;
    this.sunDir = v(0.28, 0.9, 0.34).normalize();
    this.shadowRange = 36;
    await step(0.05, 'Noon in the central gorge');
    k.atmosphere({
      sunDir: this.sunDir,
      sunColor: new THREE.Color(1.0, 0.93, 0.82),
      sunIntensity: 3.6,
      zenith: new THREE.Color(0.22, 0.38, 0.62),
      horizon: new THREE.Color(0.66, 0.72, 0.76),
      sunHorizon: new THREE.Color(1.1, 0.95, 0.8),
      skySun: new THREE.Color(1.8, 1.6, 1.3),
      ground: new THREE.Color(0.2, 0.2, 0.19),
      cloudCover: 0.45,
      skySunIntensity: 22,
      envIntensity: 0.7,
      fogColor: new THREE.Color(0.52, 0.57, 0.6),
      fogDensity: 0.0042,
      fogSunColor: new THREE.Color(0.9, 0.82, 0.66),
      fogHeightBase: -30,
      fogHeightFalloff: 0.03,
      hemiSky: new THREE.Color(0.66, 0.74, 0.84),
      hemiGround: new THREE.Color(0.28, 0.24, 0.2),
      hemiIntensity: 0.75,
      wetness: 0.15,
      shadowRange: this.shadowRange,
    });
    world.bounds = { minX: -17, maxX: 15, minZ: -14, maxZ: 171 };
    this.ctx.player.killY = -40;
    k.terrainFrom((x, z) => -120 + fbm2(x * 0.03, z * 0.03, 3) * 5 + Math.max(0, Math.abs(x) - 30) * 3, {
      origin: [-150, -100],
      size: 400,
      res: 101,
      splat: (_x, _z, _h, ny) => [0.4, 0.15, ny < 0.85 ? 1 : 0.4],
    });
    k.waterPlane(0, -117, 80, 40, 300);

    await step(0.15, 'The gorge walls');
    const hue = new THREE.Color(1.0, 0.9, 0.82);
    // Near walls (around the camp) and far walls (the gorge opens out under the bridge).
    k.cliffBox(v(23, 15, 19), v(7, 135 / 2 + 7, 33), ['-x'], { hue, minY: -24, maxY: 34, scale: 1.4 });
    k.cliffBox(v(-23, 15, 19), v(7, 135 / 2 + 7, 33), ['+x'], { hue, minY: -24, maxY: 34, scale: 1.4 });
    k.cliffBox(v(36, 10, 95), v(12, 120 / 2 + 20, 45), ['-x'], { hue, minY: -50, maxY: 40, scale: 2.4, collide: false });
    k.cliffBox(v(-36, 10, 95), v(12, 120 / 2 + 20, 45), ['+x'], { hue, minY: -50, maxY: 40, scale: 2.4, collide: false });
    k.cliffBox(v(22, 20, 152), v(8, 70, 22), ['-x'], { hue, minY: -46, maxY: 34, scale: 1.4 });
    k.cliffBox(v(-26, 20, 152), v(10, 70, 22), ['+x'], { hue, minY: -16, maxY: 34, scale: 1.8 });
    k.cliffBox(v(0, 20, 180), v(32, 70, 8), ['-z'], { hue, minY: -46, maxY: 36, scale: 1.6 });
    k.cliffBox(v(0, 25, -22), v(30, 60, 8), ['+z'], { hue, maxY: 36, scale: 1.8 });
    // The way down from the balcony (Ch3) — a carved stair on the east wall, out of reach above.
    for (let i = 0; i < 18; i++) k.blockAt(v(-14.4, 3 + i * 0.9, -6 + i * 1.1), v(2.6, 0.5, 1.2), 0, false, 0.85);

    await step(0.25, 'Pitching the camp');
    // Approach path + camp plateau (one walkable slab, dressed).
    world.addBox(v(0, -30, 18), v(16, 30, 32));
    // Bridgehead plaza: a paved processional avenue to the bridge, packed earth where the camp
    // has spread, kerbs, and the ruins the crew has been picking through.
    k.masonBatch.add(k.plate, v(0, -0.35, 18), v(6.6, 0.7, 64), 0, 0.8);
    k.soilBatch.add(k.plate, v(-9.6, -0.33, 18), v(12.8, 0.7, 64), 0, 0.95);
    k.soilBatch.add(k.plate, v(9.6, -0.33, 18), v(12.8, 0.7, 64), 0, 0.95);
    for (let z = -12 + 0.6; z < 50; z += 1.2)
      for (let x = -2.9; x < 3; x += 1.2) if (rnd() < 0.85) k.masonBatch.add(k.ashlar, v(x + (rnd() - 0.5) * 0.06, -0.06, z), v(1.12, 0.14, 1.12), (rnd() - 0.5) * 0.04, 0.72 + rnd() * 0.2);
    for (const sx of [-3.35, 3.35]) for (let z = -12 + 0.5; z < 50; z += 1.0) k.masonBatch.add(k.ashlar, v(sx, 0.05, z), v(0.34, 0.28, 0.96), 0, 0.85 + rnd() * 0.1);
    // Fallen column drums, a toppled sun disc and a stela by the avenue.
    for (const [x, z, yaw] of [[-5.6, 12, 0.3], [-6.8, 13.4, 1.1], [5.4, 20, 2.0], [6.4, 21.2, 0.6]] as const) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.57, 1.0, 14).rotateZ(Math.PI / 2), k.masonMat);
      d.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(d.geometry.attributes.position.count * 3).fill(0.85), 3));
      d.position.set(x, 0.5, z);
      d.rotation.y = yaw;
      d.castShadow = true;
      k.props.add(d);
      world.addBox(v(x, 0.5, z), v(0.5, 0.5, 0.55), yaw);
    }
    k.stela(v(-4.6, 0, 4), 0.2, 1, 0.06, 1.1);
    k.stela(v(4.8, 0, 8), -0.3, 2, -0.08, 1.0);
    {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 28).rotateX(Math.PI / 2), k.muralMat);
      disc.position.set(-7.5, 1.3, 46.6);
      disc.rotation.set(-0.25, 0.4, 0.05);
      disc.castShadow = true;
      k.props.add(disc);
      world.addBox(v(-7.5, 1.1, 46.6), v(1.3, 1.1, 0.45), 0.4);
    }
    // Abutment parapets (except the bridge mouth)
    const guard = (x0: number, x1: number, z0: number, z1: number, y = 0) => world.addBox(v((x0 + x1) / 2, y + 0.6, (z0 + z1) / 2), v(Math.max(0.1, (x1 - x0) / 2), 0.6, Math.max(0.1, (z1 - z0) / 2)), 0, { blocksCamera: false });
    guard(-16, -2.6, 49.8, 50.2);
    guard(2.6, 16, 49.8, 50.2);
    for (let x = -15.6; x < 15.6; x += 0.8) if (Math.abs(x) > 2.8) k.masonBatch.add(k.block, v(x, 0.45, 50), v(0.45, 0.9, 0.7), 0, 0.85);
    // Ruined Ysharu gatehouse at the bridgehead
    // Bridgehead gate: coursed piers carrying a stepped lintel.
    for (const sx of [-3.6, 3.6]) {
      k.coursedWall(sx - 0.7, 49.2, sx + 0.7, 49.2, 0, 5.2, { thick: 1.4, tint: 0.95, cornice: false });
      k.blockAt(v(sx, 5.5, 49.2), v(1.9, 0.6, 1.9), 0, false, 1.05);
    }
    k.coursedWall(-4.6, 49.2, 4.6, 49.2, 5.8, 6.7, { thick: 1.6, tint: 1.0, collide: false });
    k.niches(v(-2.6, 0, 48.38), v(2.6, 0, 48.38), v(0, 0, -1), 5.95, 4, 0.55);
    this.buildCamp();

    await step(0.45, 'Spanning the gorge');
    this.buildBridge();
    await step(0.6, 'The far abutment');
    this.buildFar();
    await step(0.75, 'Dressing the gorge');
    this.dress();
    await step(0.88, 'Haze');
    k.particles('mist', 70, v(0, -70, 100), v(70, 30, 180), new THREE.Color(0.42, 0.46, 0.5), 120, 0.2, 41, 'tex.mist');
    k.particles('dust', 260, v(0, 0, 30), v(32, 8, 50), new THREE.Color(1, 0.92, 0.75), 0.09, 0.45, 42);
    k.particles('leaves', 50, v(0, 4, 60), v(40, 20, 100), new THREE.Color(1, 1, 1), 0.16, 0.9, 43, 'tex.leaf');
    this.bursts = k.bursts(1400);
    this.smoke = k.bursts(900, new THREE.Color(0.3, 0.29, 0.28));
    this.flash = new THREE.PointLight(new THREE.Color(1.0, 0.7, 0.4), 0, 80, 1.5);
    this.flash.position.copy(BLAST_AT);
    k.root.add(this.flash);
    // Fireball: soft additive glow sprites (core, flame, outer haze) — no hard edges.
    this.fireball = new THREE.Group();
    for (const [col, size, tex] of [[new THREE.Color(3, 2.4, 1.6), 0.45, 'tex.dot'], [new THREE.Color(2.4, 1.1, 0.35), 0.8, 'tex.mist'], [new THREE.Color(0.9, 0.5, 0.25), 1.3, 'tex.mist']] as const) {
      const sp = new THREE.Sprite(k.track(new THREE.SpriteMaterial({ map: k.texture(tex), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
      sp.userData.size = size;
      this.fireball.add(sp);
    }
    this.fireball.position.copy(BLAST_AT);
    k.root.add(this.fireball);
    k.ridges(v(0, 0, 80), [
      [380, 140, new THREE.Color(0.42, 0.48, 0.52)],
      [600, 240, new THREE.Color(0.55, 0.6, 0.64)],
    ]);
    k.finish();
    this.ctx.traversal.load(TRAVERSAL);

    // Cast
    this.toby = this.npc('toby', v(-1.2, 0, -10), 0);
    this.corwin = this.npc('corwin', v(-6, 0, 34.6), Math.PI);
    this.dace = this.npc('dace', v(6.2, 0, 42.2), -2.4);
  }

  private buildCamp(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const MM = M.createModernMaterials();
    for (const m of MM.all) k.track(m);
    const box = (x: number, z: number, hx: number, hy: number, hz: number, yaw = 0, surface: 'wood' | 'metal' | 'stone' = 'metal') => world.addBox(v(x, hy, z), v(hx, hy, hz), yaw, { surface, blocksCamera: false });
    // Tents
    for (const [x, z, c, yaw] of [[-11.5, 25, 'orange', 0.6], [-12, 31.5, 'blue', 1.2], [11.2, 26.5, 'orange', -0.7], [12, 33, 'blue', -1.4]] as const) {
      k.place(M.domeTent(MM, c), x, 0, z, yaw);
      world.addCylinder(v(x, 0.6, z), 1.45, 0.6, { surface: 'wood', blocksCamera: false });
    }
    // Generator, floodlights, cables
    k.place(M.generator(MM), 9.2, 0, 37, -0.3);
    box(9.2, 37, 0.7, 0.55, 0.45, -0.3);
    const lights: [number, number, number][] = [[-4.5, 46, 0.4], [5.5, 46.8, -0.5], [-13.5, 38.5, 1.3], [13.4, 41, -1.4]];
    for (const [x, z, yaw] of lights) {
      const f = M.floodlight(MM);
      k.place(f.group, x, 0, z, yaw);
      world.addCylinder(v(x, 1, z), 0.25, 1, { blocksCamera: false });
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.92, 0.8), 6, 16, 2);
      l.position.set(x + Math.sin(yaw) * 0.5, 4, z + Math.cos(yaw) * 0.5);
      k.root.add(l);
      k.props.add(M.cable(MM, [v(9.2, 0.03, 37), v((9.2 + x) / 2 + 1.5, 0.03, (37 + z) / 2 - 1), v(x, 0.03, z)]));
    }
    // Drill rig at the bridgehead (they've been drilling the bridge piers)
    k.place(M.drillRig(MM), 7.6, 0, 44.2, 0.4);
    box(7.6, 44.2, 1.2, 1.0, 1.2);
    // Survey crates
    const crates: [number, number, number, number][] = [[9.8, 30.5, 0, 0.1], [11, 30.8, 0, -0.1], [10.4, 30.7, 0.55, 0.05], [-8.5, 44.8, 0, 0.3], [-9.6, 45.3, 0, -0.2], [-9, 45, 0.55, 0.1], [4.2, 38.6, 0, 1.2]];
    for (const [x, z, y, yaw] of crates) {
      k.place(M.surveyCrate(MM), x, y, z, yaw);
      if (y === 0) box(x, z, 0.5, 0.28, 0.32, yaw);
    }
    // Corwin's field table: Edmund's diary, the payment advice
    k.place(P.table(k.PM), -6, 0, 36.2, 0);
    world.addBox(v(-5.7, 0.38, 36.2), v(0.95, 0.38, 0.45), 0, { surface: 'wood' });
    const diary = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.7 }));
    diary.position.set(-6.3, 0.8, 36.25);
    diary.rotation.y = 0.3;
    this.pickup('ch4_edmund_diary', diary, CH4.diary, { prompt: 'Read the diary' });
    const pay = P.paperPage(k.PM);
    pay.position.set(-5.3, 0.78, 36.1);
    pay.rotation.y = -0.2;
    this.pickup('ch4_payment', pay, CH4.payment);
    k.place(P.lantern(k.PM, true), -6.6, 0.76, 36.0);
    k.place(P.rucksack(k.PM), -7.6, 0, 37.2, 1.2);
    // A recovered 1958 crate (Varne's charge schedule inside)
    k.place(P.crate(k.PM, 0.9, 0.6, 0.6, 'both', true), -10.6, 0, 41.6, 0.4);
    box(-10.6, 41.6, 0.45, 0.3, 0.3, 0.4, 'wood');
    const sched = P.paperPage(k.PM);
    sched.position.set(-10.6, 0.48, 41.6);
    sched.rotation.set(-0.4, 0.4, 0);
    this.pickup('ch4_varne_charges', sched, CH4.charges);
    // Anselm Roy's datum disc on the abutment parapet
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 16), k.PM.bronze);
    disc.position.set(3.3, 0.92, 49.75);
    disc.rotation.x = Math.PI / 2 - 0.2;
    this.pickup('ch4_relic_datum', disc, CH4.datum, { prompt: 'Examine the disc', radius: 1.6 });
    // The crew's work: drill-core trays, a survey tripod, spray-painted marks on the old stone,
    // Corwin's laptop and satellite phone on the field table.
    for (const [x, z, yaw] of [[3.4, 41.6, 0.2], [4.6, 41.2, 0.15]] as const) {
      const tray = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.5), MM.case);
      base.position.y = 0.05;
      tray.add(base);
      for (let r = 0; r < 4; r++) {
        const cg = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8).rotateZ(Math.PI / 2);
        // (the rock material reads vertex colours: without them the cores drew black)
        const tone = 0.7 + r * 0.06;
        cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count * 3).map((_, j) => tone * [1, 0.94, 0.86][j % 3]), 3));
        const core = new THREE.Mesh(cg, k.rockMat);
        core.position.set(0, 0.12, -0.18 + r * 0.12);
        tray.add(core);
      }
      k.place(tray, x, 0, z, yaw);
    }
    {
      const tri = new THREE.Group();
      for (const a2 of [0, 2.1, 4.2]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), MM.yellow);
        leg.position.set(Math.sin(a2) * 0.3, 0.7, Math.cos(a2) * 0.3);
        leg.rotation.set(Math.cos(a2) * 0.4, 0, -Math.sin(a2) * 0.4);
        tri.add(leg);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.16), MM.black);
      head.position.y = 1.5;
      tri.add(head);
      k.place(tri, 1.6, 0, 45.4, 0.6);
    }
    {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      x.strokeStyle = 'rgba(255,110,20,0.9)';
      x.lineWidth = 14;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(24, 24);
      x.lineTo(104, 104);
      x.moveTo(104, 24);
      x.lineTo(24, 104);
      x.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      k.track(t);
      const mark = k.track(new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 }));
      for (const [x2, z2] of [[0.4, 46.2], [-1.4, 49.0], [1.8, 30.2]] as const) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2), mark);
        m.position.set(x2, 0.02, z2);
        k.props.add(m);
      }
    }
    {
      const laptop = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), MM.black);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), MM.black);
      lid.position.set(0, 0.11, -0.12);
      lid.rotation.x = -0.25;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.65, 0.8) }));
      screen.position.set(0, 0.11, -0.112);
      screen.rotation.x = -0.25;
      laptop.add(base, lid, screen);
      k.place(laptop, -5.6, 0.77, 36.0, 0.2);
      const phone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.17), MM.yellow);
      k.place(phone, -6.9, 0.78, 36.3, 0.9);
    }
    // Detonator (moved to the bridge after the confrontation)
    this.detonatorObj = M.detonator(MM);
    this.detonatorObj.position.set(6.8, 0, 43);
    k.root.add(this.detonatorObj);
    // Wire running from the bridge rail down toward the seal
    k.props.add(M.cable(MM, [v(2.3, 0.6, 90), v(2.6, -2, 94), v(1.5, -9, 96), BLAST_AT.clone().add(v(0, 2, 0))]));
  }

  private buildBridge(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const pieces: CollapsePiece[] = [];
    const n = (BRIDGE_Z1 - BRIDGE_Z0) / PIECE;
    // The great bridge: arched bays on tall piers, a coursed parapet, worn deck slabs.
    const arch = k.arch(PIECE, 4.4, 0.95, 4.6, 1.45, -0.3);
    for (let i = 0; i < n; i++) {
      const z0 = BRIDGE_Z0 + i * PIECE;
      const zc = z0 + PIECE / 2;
      const g = new THREE.Group();
      const parts = new THREE.Group();
      g.position.set(0, 0, zc);
      const add = (geo: THREE.BufferGeometry, p: THREE.Vector3, s: THREE.Vector3, rot = 0) => {
        const m = new THREE.Mesh(geo.clone(), k.masonMat);
        m.position.copy(p);
        m.scale.copy(s);
        m.rotation.y = rot;
        m.castShadow = true;
        m.receiveShadow = true;
        parts.add(m);
      };
      add(k.plate, v(0, -0.48, 0), v(5.2, 0.95, PIECE - 0.03));
      for (let zz = -PIECE / 2 + 0.6; zz < PIECE / 2; zz += 1.2) add(k.ashlar, v((i * 7 + zz) % 2 > 1 ? 0.6 : -0.7, 0.01, zz), v(1.7, 0.06, 1.15));
      add(arch, v(0, 0, 0), v(1, 1, 1));
      add(k.ashlar, v(0, -4.6 - 14, PIECE / 2 - 0.65), v(3.6, 28, 1.3)); // pier (into the mist)
      add(k.ashlar, v(0, -4.75, PIECE / 2 - 0.65), v(4.6, 0.4, 1.7)); // impost
      for (const sx of [-2.35, 2.35]) for (let zz = -PIECE / 2 + 0.5; zz < PIECE / 2; zz += 1.0) add(k.ashlar, v(sx, 0.42, zz), v(0.5, 0.84, 0.96));
      g.add(mergeStatic(parts, 'bridge-bay'));
      k.root.add(g);
      const cols = [
        world.addBox(v(0, -0.5, zc), v(2.6, 0.5, PIECE / 2), 0, { dynamic: true }),
        world.addBox(v(-2.35, 0.6, zc), v(0.25, 0.6, PIECE / 2), 0, { dynamic: true, blocksCamera: false }),
        world.addBox(v(2.35, 0.6, zc), v(0.25, 0.6, PIECE / 2), 0, { dynamic: true, blocksCamera: false }),
      ];
      // Timing (seconds after the blast). The camp end goes at once (seen in the cutscene); control
      // returns at ESCAPE_T0, then a gap opens ahead of her and the break chases her north at ~5.8 m/s.
      let delay: number;
      if (z0 < 74) delay = 0.3 + (74 - z0) * 0.02;
      else if (z0 === GAP_Z0) delay = ESCAPE_T0 + 0.8;
      else delay = ESCAPE_T0 + 1.3 + (z0 - 74) / 5.8;
      pieces.push({ object: g, colliders: cols, delay, shudder: z0 === GAP_Z0 ? 0.5 : 0.9, spin: 0.3 + (i % 4) * 0.15 });
    }
    this.bridge = new Collapse(pieces);
    this.bridge.setProxy(k.mergedCopy(pieces.map((p) => p.object), 'bridge-intact'));
    this.bridge.onDrop = (i) => {
      const p = v(0, 0, BRIDGE_Z0 + i * PIECE + 2);
      if (Math.abs(p.z - this.ctx.player.position.z) < 30) {
        this.ctx.audio.sfx.impact(p, 0.7);
        this.ctx.camera.addTrauma(0.25);
      }
      this.bursts.emit(p, 18, v(3, 0.5, 2), v(0, -1, 0), 1.6, 3);
    };
    this.bridge.onShudder = (i) => {
      const p = v(0, 0, BRIDGE_Z0 + i * PIECE + 2);
      if (Math.abs(p.z - this.ctx.player.position.z) < 20) this.ctx.audio.sfx.stoneGrind(0.8, p, 0.35);
    };
    // Rocks raining onto the deck during the run.
    const drops: RockDrop[] = [
      { x: -1.6, z: 106, groundY: 0, t: 3.6, size: 0.8, radius: 1.0 },
      { x: 1.6, z: 113, groundY: 0, t: 4.6, size: 0.75, radius: 1.0 },
      { x: -1.6, z: 121, groundY: 0, t: 5.7, size: 0.85, radius: 1.0 },
      { x: 9, z: 88, groundY: -40, t: 2.2, size: 2.2 },
      { x: -10, z: 100, groundY: -40, t: 3.0, size: 2.5 },
    ];
    this.rocksB = new Rockfall(drops, k.rocks, k.rockMat);
    k.root.add(this.rocksB.group);
    this.rocksB.onImpact = (d) => this.rockImpact(d);
  }

  private buildFar(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const pieces: CollapsePiece[] = [];
    // Climb face below the far abutment (worn stone) and the abutment itself in strips.
    k.climbFace(CLIMB_FAR.origin, CLIMB_FAR.right, CLIMB_FAR.normal, CLIMB_FAR.width, CLIMB_FAR.height);
    world.addBox(v(0, (FAR_Y - 40) / 2, FAR_Z0 + 0.5), v(14, (FAR_Y + 40) / 2 - 0.01, 0.5));
    k.cliffBox(v(0, -18, FAR_Z0 + 0.5), v(14, 18, 0.5), ['-z'], { collide: false, skip: (x, y) => Math.abs(x) < 2.2 && y > -4, minY: -30 });
    const strips = (FAR_Z1 - FAR_Z0) / 4;
    for (let i = 0; i < strips; i++) {
      const z0 = FAR_Z0 + i * 4;
      const zc = z0 + 2;
      const g = new THREE.Group();
      g.position.set(0, FAR_Y, zc);
      const parts = new THREE.Group();
      const slab = new THREE.Mesh(k.plate.clone(), k.masonMat);
      slab.scale.set(28, 1.2, 4.02);
      slab.position.y = -0.62;
      slab.castShadow = slab.receiveShadow = true;
      parts.add(slab);
      // Worn paving with gaps, a kerb of fallen blocks: a terrace, not a table top.
      for (let x = -13.4; x < 14; x += 1.25)
        for (let zz = -1.4; zz < 2; zz += 1.4) {
          if (k.rnd() < 0.18) continue;
          const t = new THREE.Mesh(k.ashlar.clone(), k.masonMat);
          t.scale.set(1.16, 0.16, 1.3);
          t.position.set(x + (k.rnd() - 0.5) * 0.08, -0.02, zz);
          t.rotation.y = (k.rnd() - 0.5) * 0.05;
          t.receiveShadow = true;
          parts.add(t);
        }
      for (let r = 0; r < 3; r++) {
        const rock = new THREE.Mesh(k.rocks[(i + r) % 5].clone(), k.rockMat);
        const sc = 0.35 + k.rnd() * 0.4;
        rock.scale.setScalar(sc);
        rock.position.set(-12 + k.rnd() * 24, sc * 0.2, (k.rnd() - 0.5) * 3);
        rock.castShadow = true;
        parts.add(rock);
      }
      g.add(mergeStatic(parts, 'far-strip'));
      const under = new THREE.Mesh(k.slabs[i % k.slabs.length], k.cliffMat);
      under.scale.set(6.5, 1.6, 1.2);
      under.position.y = -4;
      g.add(under);
      k.root.add(g);
      const cols = [world.addBox(v(0, FAR_Y - 0.6, zc), v(14, 0.6, 2), 0, { dynamic: true })];
      // Pillar stubs stand on their strip of terrace and go down with it.
      for (const [px, pz] of [[-8, 138], [-4, 146], [6, 142], [-10, 152]] as const) {
        if (pz < z0 || pz >= z0 + 4) continue;
        const pillar = new THREE.Mesh(k.ashlar.clone(), k.masonMat);
        pillar.scale.set(1.2, 2.8, 1.2);
        pillar.position.set(px, 1.4, pz - zc);
        pillar.castShadow = pillar.receiveShadow = true;
        g.add(pillar);
        cols.push(world.addBox(v(px, FAR_Y + 1.4, pz), v(0.6, 1.4, 0.6), 0, { dynamic: true }));
      }
      pieces.push({ object: g, colliders: cols, delay: 3.0 + i * 1.1, shudder: 1.0, spin: 0.25 });
    }
    // The shelf along the west wall
    world.addBox(v(SHELF_X, FAR_Y - 2, 164.2), v(0.225, 2, 6.2), 0, { surface: 'stone' });
    k.masonBatch.add(k.stepSlab, v(SHELF_X, FAR_Y - 0.15, 164.2), v(0.45, 0.3, 12.4), 0, 1.2);
    world.addBox(v(16, 10, 164), v(1.8, 20, 7));
    {
      const hue = new THREE.Color(1.0, 0.9, 0.8);
      // The face she ends up hanging on (the real wall, right behind her hands).
      k.cliffBatch.add(k.plate, v(14.22, -11.5, 168.2), v(0.64, 17, 5.2), 0, 0.82, hue);
      // The lower passage: a cut doorway in the rock, eight metres down, marked the way the cliff route was.
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), new THREE.MeshBasicMaterial({ color: 0x040403 }));
      mouth.position.set(13.885, -12.15, 168.2);
      mouth.rotation.y = -Math.PI / 2;
      k.root.add(mouth);
      for (const dz of [-0.92, 0.92]) k.blockAt(v(13.8, -12.15, 168.2 + dz), v(0.4, 2.5, 0.38), 0, false, 0.95);
      k.blockAt(v(13.8, -10.78, 168.2), v(0.44, 0.38, 2.5), 0, false, 1.0);
      k.blockAt(v(13.55, -13.42, 168.2), v(1.0, 0.24, 2.5), 0, false, 0.9);
      const tag = P.pitonRibbon(k.PM, 91);
      tag.position.set(13.72, -10.4, 169.25);
      tag.rotation.y = -Math.PI / 2;
      tag.scale.setScalar(1.5);
      k.props.add(tag);
      const tag2 = P.pitonRibbon(k.PM, 92);
      tag2.position.set(13.8, -7.9, 167.6);
      tag2.rotation.y = -Math.PI / 2;
      tag2.scale.setScalar(1.3);
      k.props.add(tag2);
      // Water runs out over the sill: the passage behind it is flooded.
      k.root.add(waterfallMesh(v(13.1, -13.3, 168.2), v(13.1, -44, 168.2), 0.9, v(-1, 0, 0), k.fallMat, 0.7));
      const glint = new THREE.PointLight(new THREE.Color(0.7, 0.85, 1.0), 2.5, 6, 2);
      glint.position.set(13.2, -12.2, 168.2);
      k.root.add(glint);
    }
    this.far = new Collapse(pieces);
    this.far.setProxy(k.mergedCopy(pieces.map((p) => p.object), 'far-intact'));
    this.far.onDrop = (i) => {
      const p = v(0, FAR_Y, FAR_Z0 + i * 4 + 2);
      this.ctx.audio.sfx.impact(p, 0.7);
      this.ctx.camera.addTrauma(0.3);
      this.bursts.emit(p, 26, v(12, 0.5, 2), v(0, -1, 0), 1.8, 3);
      // Fallen rocks lying on that strip go with it.
      this.rocksF.hideWhere((d) => d.z >= FAR_Z0 + i * 4 && d.z < FAR_Z0 + i * 4 + 4);
    };
    const drops: RockDrop[] = [
      { x: -3, z: 138, groundY: FAR_Y, t: 2.2, size: 1.0, radius: 1.3 },
      { x: 9, z: 140, groundY: FAR_Y, t: 3.0, size: 1.1, radius: 1.3 },
      { x: -1, z: 147, groundY: FAR_Y, t: 4.0, size: 0.9, radius: 1.2 },
      { x: 5, z: 152, groundY: FAR_Y, t: 5.0, size: 1.0, radius: 1.2 },
      { x: 8, z: 156, groundY: FAR_Y, t: 6.2, size: 0.8, radius: 1.1 },
    ];
    this.rocksF = new Rockfall(drops, k.rocks, k.rockMat);
    k.root.add(this.rocksF.group);
    this.rocksF.onImpact = (d) => this.rockImpact(d);
  }

  private rockImpact(d: RockDrop): void {
    const p = v(d.x, d.groundY, d.z);
    const pp = this.ctx.player.position;
    this.bursts.emit(p, 20, v(1.5, 0.3, 1.5), v(0, 2, 0), 1.2, 2);
    if (pp.distanceTo(this.ctx.renderer.camera.position) < 60) this.ctx.audio.sfx.impact(p, 0.8);
    if (d.radius && Math.hypot(pp.x - d.x, pp.z - d.z) < d.radius && Math.abs(pp.y - d.groundY) < 2) {
      this.ctx.camera.addTrauma(0.7);
      this.ctx.player.kill('rockfall');
    }
  }

  private dress(): void {
    const k = this.kit;
    const rnd = k.rnd;
    const groundCamp = () => 0;
    const inCamp = (x: number, z: number) => Math.abs(x) < 15.5 && z > -12 && z < 49.5;
    const clearOf = (x: number, z: number) => {
      const busy: [number, number, number][] = [[0, 30, 4], [-6, 36, 2.4], [9.2, 37, 2], [7.6, 44.2, 2.4], [-10.6, 41.6, 1.8], [0, -8, 2.2]];
      return busy.every(([bx, bz, r]) => Math.hypot(x - bx, z - bz) > r) && Math.abs(x) > 2.4;
    };
    const tents: [number, number][] = [[-11.5, 25], [-12, 31.5], [11.2, 26.5], [12, 33]];
    const ok = (x: number, z: number) => inCamp(x, z) && clearOf(x, z) && tents.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 2);
    k.grass(k.scatter(2600, [-16, -12, 16, 50], groundCamp, (x, z) => ok(x, z) && (fbm2(x * 0.1, z * 0.1, 3) > 0 || rnd() < 0.2), [0.5, 1.0]));
    k.ferns(k.scatter(160, [-16, -12, 16, 50], groundCamp, (x, z) => ok(x, z) && Math.abs(x) > 12, [0.6, 1.2], { tilt: 0.2 }));
    k.broadleaf(k.scatter(50, [-16, -12, 16, 50], groundCamp, (x, z) => ok(x, z) && Math.abs(x) > 13.5, [0.7, 1.2]));
    // (No loose grass on the far terrace: it collapses, and plants scattered there were left hanging in the air.)
    // Trees clinging to the walls high up, vines, far forest on the rims
    const far: THREE.Matrix4[] = [];
    for (let i = 0; i < 700; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (34 + rnd() * 40);
      const z = -20 + rnd() * 220;
      far.push(new THREE.Matrix4().compose(v(x, 78, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), v(0.9 + rnd() * 0.5, 0.9 + rnd() * 0.5, 0.9 + rnd() * 0.5)));
    }
    k.farTrees(far);
    const vines: THREE.Matrix4[] = [];
    for (let i = 0; i < 46; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      vines.push(k.vineMatrix(side * 15.9, 6 + rnd() * 30, -10 + rnd() * 60, 6.5, side > 0 ? -Math.PI / 2 : Math.PI / 2));
    }
    k.vines(vines, 6.5, 3);
    const mats = [[-14, 3], [14, 8], [-14.5, 20], [14.6, 47]].map(([x, z]) => new THREE.Matrix4().compose(v(x, -0.3, z), new THREE.Quaternion(), v(0.8, 0.8, 0.8)));
    k.trees(mats, 'slender', 5);
  }

  // ================================================================ setup
  protected setup(): void {
    const { interaction, dialogue } = this.ctx;
    interaction.add({
      id: 'toby',
      position: v(0, 1, 0),
      radius: 2.2,
      prompt: 'Talk to Toby',
      enabled: false,
      facing: 0,
      onInteract: () => {
        dialogue.say(CH4.tobyTalk[Math.min(this.tobyTalk, CH4.tobyTalk.length - 1)], true);
        this.tobyTalk++;
        this.toby.lookAt(this.ctx.player.position);
      },
    });
    interaction.add({
      id: 'corwin',
      position: v(0, 1, 0),
      radius: 2.2,
      prompt: 'Talk to Corwin',
      enabled: false,
      facing: 0,
      onInteract: () => {
        dialogue.say(CH4.corwinTalk[Math.min(this.corwinTalk, CH4.corwinTalk.length - 1)], true);
        this.corwinTalk++;
        this.corwin.lookAt(this.ctx.player.position);
      },
    });
    this.ctx.camera.hints = [
      { id: 'camp', center: v(0, 0, 32), radius: 14, distance: 4.3, fovAdd: 3 },
      { id: 'bridge', center: v(0, 0, 100), radius: 32, distance: 5.2, heightAdd: 0.35, fovAdd: 8 },
      { id: 'far', center: v(0, FAR_Y, 145), radius: 16, distance: 5.0, heightAdd: 0.3, fovAdd: 6 },
    ];
  }

  // ================================================================ world state
  protected saveWorld(): Record<string, unknown> {
    const d: WorldSave = { met: this.met, blast: this.blastDone, toby: this.tobyTalk, corwin: this.corwinTalk };
    return d as unknown as Record<string, unknown>;
  }

  protected loadWorld(d: Record<string, unknown> | undefined): void {
    const w = d as unknown as WorldSave | undefined;
    this.met = w?.met ?? false;
    this.blastDone = w?.blast ?? false;
    this.tobyTalk = w?.toby ?? 0;
    this.corwinTalk = w?.corwin ?? 0;
  }

  protected applyWorld(checkpoint: string): void {
    const cp = this.checkpointOrder.indexOf(checkpoint);
    this.endStarted = false;
    this.escapeT = -1;
    this.farStarted = false;
    this.flashK = 0;
    this.rocksB.reset();
    this.rocksF.reset();
    // Bridge + far abutment state by progress.
    if (this.blastDone && cp >= 3) this.bridge.finish();
    else this.bridge.reset();
    if (cp >= 4) this.far.finish();
    else this.far.reset();
    // A respawn on the bridge restarts the escape from the blast.
    if (this.blastDone && cp === 2) {
      this.bridge.start(ESCAPE_T0);
      this.rocksB.start();
      this.escapeT = 0;
      this.setMood('tension', 0.5);
    }
    // Cast
    const it = this.ctx.interaction;
    if (!this.met) {
      this.toby.place(v(-1.2, 0, -10), 0);
      this.toby.followRoute(ROUTE, () => this.ctx.player.position, 2.4);
      this.corwin.place(v(-6, 0, 34.6), Math.PI);
      this.dace.place(v(6.2, 0, 42.2), -2.4);
      this.dace.visible = true;
      this.detonatorObj.position.set(6.8, 0, 43);
    } else {
      this.toby.place(v(-10.2, 0, 29), -1.9);
      this.corwin.place(v(-4.6, 0, 37.4), Math.PI);
      if (this.blastDone) {
        this.dace.place(v(5, 0, 40), Math.PI);
        this.detonatorObj.position.set(DETONATOR.x, 0, DETONATOR.z);
      } else {
        this.dace.place(v(0.4, 0, 91.4), Math.PI);
        this.detonatorObj.position.copy(DETONATOR);
      }
      this.dace.visible = true;
    }
    it.get('toby')!.enabled = this.met;
    it.get('corwin')!.enabled = this.met;
  }

  protected ambience(): AmbienceConfig {
    return {
      wind: 0.9,
      insects: 0.3,
      birds: 0.6,
      frogs: 0,
      drips: 0.2,
      water: [
        { pos: v(0, -110, 90), gain: 0.35, kind: 'river' },
        { pos: v(10, 0, 37), gain: 0.06, kind: 'river' },
      ],
    };
  }

  protected restoreMood() {
    return this.blastDone ? ('tension' as const) : ('explore' as const);
  }

  protected onRespawned(): void {
    this.after(1.2, () => this.ctx.dialogue.say(CH4.fallRespawn, true));
  }

  // ================================================================ update
  protected tick(dt: number): void {
    this.bridge.update(dt);
    this.far.update(dt);
    this.rocksB.update(dt);
    this.rocksF.update(dt);
    this.bursts.update(dt);
    this.smoke.update(dt);
    if (this.escapeT >= 0) this.escapeT += dt;
    this.flashK = Math.max(0, this.flashK - dt * 1.4);
    this.flash.intensity = this.flashK * 400;
    for (const sp of this.fireball.children as THREE.Sprite[]) {
      (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, this.flashK * 1.5);
      sp.scale.setScalar((6 + (1 - this.flashK) * 22) * sp.userData.size);
    }
    this.fireball.visible = this.flashK > 0.01;
    // Interaction anchors follow the NPCs.
    const it = this.ctx.interaction;
    it.get('toby')!.position.copy(this.toby.position).setY(this.toby.position.y + 1);
    it.get('corwin')!.position.copy(this.corwin.position).setY(this.corwin.position.y + 1);
  }

  protected triggers(): void {
    const { player } = this.ctx;
    const p = player.position;
    if (p.z > -4) this.say('intro', CH4.intro);
    if (!this.met && p.z > 22) {
      this.met = true;
      this.playConfrontation();
      return;
    }
    if (this.met && !this.blastDone && p.z > 78 && p.y > -1) {
      this.playBlast();
      return;
    }
    if (this.met && !this.blastDone && p.z > 52) this.say('stopDace', CH4.stopDace);
    if (this.blastDone && this.escapeT >= 0 && p.z > GAP_Z0 - 6 && p.z < GAP_Z0) this.say('gap', CH4.gapAhead);
    if (this.blastDone && p.z > FAR_Z0 - 3 && p.z < FAR_Z0 && p.y < 1) this.say('climb', CH4.climb);
    if (this.blastDone && !this.farStarted && p.y > FAR_Y - 0.4 && p.z > FAR_Z0 + 0.4 && player.grounded) {
      this.farStarted = true;
      this.checkpoint('ch4_far');
      if (!this.bridge.started) this.bridge.finish();
      this.far.start();
      this.rocksF.start();
      this.say('rockfall', CH4.rockfall);
    }
    if (this.blastDone && p.z > FAR_Z1 - 1 && p.x > 12) {
      this.checkpoint('ch4_ledge');
      this.say('ledge', CH4.ledge);
    }
    if (this.blastDone && !this.endStarted && p.z > 165.5 && p.x > 13) {
      this.endStarted = true;
      this.playEnd();
    }
  }

  // ================================================================ cinematics
  protected intro(): void {
    const { cinematic, hud, state, player, camera, audio } = this.ctx;
    const cp = this.checkpoints.ch4_start;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('tension', 4);
    const seq: Sequence = {
      id: 'ch4_intro',
      duration: 13,
      skippable: true,
      letterbox: true,
      blendIn: 0,
      dof: true,
      blendOut: 1.5,
      shots: [
        { t0: 0, t1: 6.5, path: [v(0, 26, 110), v(0, 16, 80), v(0, 10, 60)], look: [v(0, -10, 60), v(0, 0, 40), v(0, 1, 30)], fov: [50, 46], ease: 'inOut', sway: 0.03, focus: 40 },
        { t0: 6.5, t1: 13, path: [v(2.4, 1.7, -4.5), v(1.8, 1.6, -5.4)], look: [v(-0.5, 1.4, -8.5), v(-0.4, 1.5, -8.2)], fov: [38, 36], ease: 'linear', sway: 0.015 },
      ],
      events: [
        { t: 0.6, run: (skip) => !skip && hud.chapterCard(this.numberLabel, this.title, 5), onSkip: false },
        {
          t: 12.9,
          run: () => {
            state.progress.setFlag('ch4_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.2);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playConfrontation(): void {
    const { cinematic, dialogue, player, camera, audio } = this.ctx;
    const ines = v(0, 0, 27.6);
    const corwinAt = v(-0.5, 0, 31.4);
    const tobyAt = v(1.7, 0, 26.6);
    const daceAt = v(4.4, 0, 33.6);
    const head = (a: NpcActor) => () => a.head(new THREE.Vector3());
    const seq: Sequence = {
      id: 'ch4_confrontation',
      duration: 68,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.4,
      shots: [
        // Corwin walks up from his table.
        { t0: 0, t1: 6, path: [v(-1.8, 1.6, 24.6), v(-1.4, 1.6, 25.2)], look: [head(this.corwin)], fov: [40, 38], ease: 'linear', sway: 0.015 },
        // Two-shot: Ines and Toby (the reveal).
        { t0: 6, t1: 20, path: [v(1.2, 1.65, 30.2), v(1.0, 1.6, 29.9)], look: [v(0.8, 1.5, 27.1)], fov: [36, 34], ease: 'linear', sway: 0.015 },
        // Corwin's argument (over Ines's shoulder).
        { t0: 20, t1: 44, path: [v(0.7, 1.75, 25.9), v(0.5, 1.75, 26.2)], look: [head(this.corwin)], fov: [34, 32], ease: 'linear', sway: 0.012 },
        // Ines answers (over Corwin's shoulder).
        { t0: 44, t1: 56, path: [v(-1.0, 1.75, 32.6), v(-0.9, 1.75, 32.3)], look: [v(0, 1.55, 27.6)], fov: [34, 33], ease: 'linear', sway: 0.012 },
        // Dace, then the bridge he'll walk out on.
        { t0: 56, t1: 68, path: [v(1.5, 1.8, 30), v(-1.5, 3.2, 38)], look: [head(this.dace), v(0, 0, 92)], fov: [40, 52], ease: 'inOut', sway: 0.02 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(ines, 0);
            this.scripted(true, 'IDLE');
            this.toby.followRoute(null);
            this.toby.place(tobyAt, -0.15);
            this.dace.place(daceAt, -2.6);
            this.corwin.walkTo([corwinAt], { speed: 1.3, onArrive: () => this.corwin.lookAt(ines) });
            this.dace.lookAt(corwinAt);
            audio.music.setMood('tension', 2);
          },
        },
        { t: 2.5, run: () => dialogue.sayOnce('ch4:confrontation', CH4.confrontation, true) },
        { t: 9, run: () => this.toby.lookAt(ines) },
        { t: 14, run: () => this.toby.setPose('TALK') },
        { t: 22, run: () => this.toby.setPose('IDLE') },
        { t: 24, run: () => this.corwin.setPose('TALK') },
        { t: 56, run: () => this.corwin.setPose('IDLE') },
        { t: 57, run: () => this.dace.setPose('TALK') },
        {
          t: 67.9,
          run: () => {
            this.scripted(false);
            this.dace.setPose('IDLE');
            // Toby steps away; Corwin goes back to his table; Dace heads out onto the bridge.
            this.toby.walkTo([v(-6, 0, 27.5), v(-10.2, 0, 29)], { speed: 1.2, onArrive: () => this.toby.lookAt(v(-16, 1, 29)) });
            this.corwin.walkTo([v(-4.6, 0, 37.4)], { speed: 1.3, onArrive: () => this.corwin.lookAt(v(0, 0, 90)) });
            this.dace.walkTo([v(4, 0, 40), v(6.8, 0, 43)], {
              speed: 1.6,
              onArrive: () => {
                this.detonatorObj.position.set(0, -100, 0);
                this.dace.walkTo([v(0.6, 0, 50), v(0.4, 0, 91.4)], { speed: 1.9, onArrive: () => this.detonatorObj.position.copy(DETONATOR) });
              },
            });
            this.ctx.interaction.get('toby')!.enabled = true;
            this.ctx.interaction.get('corwin')!.enabled = true;
            dialogue.sayOnce('ch4:daceLeaves', CH4.daceLeaves);
            this.after(4, () => dialogue.sayOnce('ch4:afterConfrontation', CH4.afterConfrontation));
            this.checkpoint('ch4_camp');
            camera.snap(player, 0, 0.18);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 2.5, CH4.confrontation));
  }

  private playBlast(): void {
    const { cinematic, dialogue, player, camera, audio } = this.ctx;
    this.blastDone = true;
    const ines = v(0, 0, 84);
    const seq: Sequence = {
      id: 'ch4_blast',
      duration: 10,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 0.6,
      exitYaw: () => 0,
      shots: [
        { t0: 0, t1: 3.6, path: [v(-1.6, 1.8, 89.4), v(-1.4, 1.8, 89.8)], look: [() => this.dace.head(new THREE.Vector3())], fov: [38, 36], ease: 'linear', sway: 0.02 },
        { t0: 3.6, t1: 6.6, path: [v(12, 6, 78), v(14, 10, 74)], look: [v(0, -6, 96), v(0, -2, 96)], fov: [50, 56], ease: 'out', sway: 0.06 },
        { t0: 6.6, t1: 10, path: [v(1.2, 2.2, 79.5), v(0.8, 2.4, 80.4)], look: [v(0, 1.2, 84.2), v(0, 1.0, 92)], fov: [48, 52], ease: 'inOut', sway: 0.05 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(ines, 0);
            this.scripted(true);
            this.dace.place(v(0.4, 0, 91.4), Math.PI);
            this.dace.lookAt(ines);
            this.detonatorObj.position.copy(DETONATOR);
          },
        },
        { t: 0.2, run: () => dialogue.sayOnce('ch4:blast', CH4.blast, true) },
        {
          t: 3.6,
          run: (s) => {
            this.flashK = 1;
            if (!s) {
              audio.sfx.rumble(8, BLAST_AT, 1);
              audio.sfx.impact(BLAST_AT, 1);
              camera.addTrauma(1);
              this.bursts.emit(BLAST_AT, 320, v(8, 4, 8), v(0, 16, 0), 3.2, 6);
              this.smoke.emit(BLAST_AT, 260, v(6, 3, 6), v(0, 8, 0), 4.5, 9);
            }
          },
        },
        {
          t: 4.0,
          run: () => {
            this.bridge.start();
            this.dace.walkTo([v(0.4, 0, 60), v(4, 0, 46), v(5, 0, 40)], { speed: 6 });
            audio.music.setMood('tension', 0.5);
          },
        },
        { t: 7.5, run: () => dialogue.say(CH4.run, true) },
        {
          t: 9.9,
          run: () => {
            this.scripted(false);
            this.ctx.reachCheckpoint('ch4_bridge');
            this.rocksB.start();
            this.escapeT = 0;
            this.dace.place(v(5, 0, 40), Math.PI);
            camera.snap(player, 0, 0.12);
          },
        },
      ],
    };
    void cinematic.play(seq); // fixed length: the escape timing (ESCAPE_T0) depends on it
  }

  private playEnd(): void {
    const { cinematic, dialogue, player, audio, camera, completeChapter } = this.ctx;
    const seq: Sequence = {
      id: 'ch4_end',
      duration: 21,
      skippable: true,
      letterbox: true,
      dof: false,
      blendOut: 1,
      shots: [
        { t0: 0, t1: 4, path: [v(8.5, FAR_Y + 2.2, 163), v(8, FAR_Y + 2.6, 163.5)], look: [v(SHELF_X, FAR_Y + 1, 167), v(SHELF_X, FAR_Y - 2, 168)], fov: [44, 50], ease: 'inOut', sway: 0.05 },
        // Close on her, hanging on the face.
        { t0: 4, t1: 10, path: [v(10.4, -5.2, 165.2), v(10.0, -6.0, 165.8)], look: [v(13.8, -5.5, 168.2), v(13.8, -6.0, 168.2)], fov: [40, 37], ease: 'linear', sway: 0.03 },
        // The ribbon, the doorway below it, and her going down to it.
        { t0: 10, t1: 21, path: [v(9.6, -8.6, 163.8), v(10.4, -12.3, 165.2)], look: [v(13.9, -9.6, 168.2), v(13.9, -12.2, 168.2)], fov: [44, 36], ease: 'inOut', sway: 0.02 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            this.scripted(true);
            audio.sfx.stoneGrind(1.5, player.position, 0.7);
          },
        },
        {
          t: 1.0,
          run: (s) => {
            if (!s) {
              audio.sfx.rumble(3, player.position, 0.8);
              camera.addTrauma(0.6);
              this.bursts.emit(player.position.clone(), 40, v(1, 0.3, 2), v(0, -2, 0), 1.6, 3);
            }
            // The shelf goes: she drops and catches the face below, out of everyone's reach.
            player.teleport(v(13.55, -6.4, 168.2), Math.PI / 2);
            this.scripted(true, 'HANG');
            player.scriptRig = { kind: 'hang', normal: v(-1, 0, 0), ledgeY: -6.4 + 2.02 };
          },
        },
        { t: 4.4, run: () => dialogue.sayOnce('ch4:ending', CH4.ending, true) },
        {
          t: 10.5,
          run: () => {
            // Down, hold by hold, to the ribboned doorway: Marta's lower passage.
            player.scriptRig = { kind: 'climb', normal: v(-1, 0, 0) };
            const from = player.position.clone();
            this.scriptedMove([from, from.clone().setY(-12.75)], 6.6, 'CLIMB', Math.PI / 2, undefined, false);
          },
        },
        { t: 12, run: () => audio.music.setMood('wonder', 4) },
        {
          t: 17.3,
          run: () => {
            // She swings in onto the sill and walks into the dark.
            player.scriptRig = null;
            const from = player.position.clone();
            this.scriptedMove([from, v(13.5, -13.3, 168.2), v(15.2, -13.3, 168.2)], 2.2, 'WALK', Math.PI / 2, undefined, false);
          },
        },
        { t: 19.6, run: () => completeChapter() },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 4.4, CH4.ending));
  }

  // ================================================================ misc
  objective(): string {
    const cp = this.cpIndex();
    if (cp >= 4) return 'Edge out along the last ledge.';
    if (cp >= 3) return 'Get off the crumbling terrace — make for the ledge on the west wall.';
    if (this.blastDone) return 'RUN. Cross the bridge before it falls.';
    if (this.met) return 'Stop Dace before he fires the charges on the bridge.';
    return 'Find out who is camped on the great bridge.';
  }

  objectiveTarget(): THREE.Vector3 | null {
    const cp = this.cpIndex();
    if (cp >= 3) return v(SHELF_X, FAR_Y, 166);
    if (this.blastDone) return v(0, FAR_Y, FAR_Z0 + 1);
    if (this.met) return DETONATOR.clone();
    return v(0, 0, 30);
  }

  mapPoints(): THREE.Vector3[] {
    return this.met ? [this.corwin.position.clone(), this.toby.position.clone()] : [];
  }

  protected mapBounds = { minX: -20, maxX: 18, minZ: -14, maxZ: 172 };

  protected mapHeight(x: number, z: number): number {
    return Math.max(-20, this.ctx.world.groundAt(x, z, 30).y);
  }

  protected mapColor(x: number, z: number): [number, number, number] {
    const y = this.ctx.world.groundAt(x, z, 30).y;
    if (y < -20) return [26, 32, 38];
    if (z > BRIDGE_Z0 && z < BRIDGE_Z1 && Math.abs(x) < 2.6) return [150, 140, 120];
    if (y > 2) return [118, 108, 92];
    return [110, 116, 96];
  }

  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    out.position.set(Math.sin(t * 0.05) * 8, 10, 60);
    out.look.set(0, 0, 110);
  }

  heroFrames(): HeroFrame[] {
    const p = this.ctx.player;
    const stand = (x: number, y: number, z: number, yaw: number, anim?: 'CLIMB' | 'LEDGE_IDLE' | 'RUN' | 'SPRINT') => {
      p.teleport(v(x, y, z), yaw);
      if (anim) {
        p.setScripted(true);
        p.avatar.driver.setState(anim, { fade: 0.01 });
        const wallN = v(-Math.sin(yaw), 0, -Math.cos(yaw));
        if (anim === 'CLIMB') p.scriptRig = { kind: 'climb', normal: wallN };
        else if (anim === 'LEDGE_IDLE') p.scriptRig = { kind: 'sidle', normal: wallN };
      }
    };
    const camp = () => {
      this.met = true;
      this.toby.followRoute(null);
      this.toby.place(v(-10.2, 0, 29), -1.9);
      this.corwin.place(v(-4.6, 0, 37.4), Math.PI);
      this.dace.place(v(0.4, 0, 91.4), Math.PI);
      this.detonatorObj.position.copy(DETONATOR);
    };
    return [
      { name: 'approach', cp: 'ch4_start', cam: [2.6, 1.9, -13.5], look: [0, 2.5, 34], prep: () => { stand(-0.4, 0, -6.5, 0); this.toby.place(v(1.3, 0, -8.6), 0.1); } },
      { name: 'camp-wide', cp: 'ch4_camp', cam: [-14, 4.5, 20], look: [4, 0, 42], prep: () => { camp(); stand(0.6, 0, 30, 0.4); } },
      {
        name: 'confrontation',
        cp: 'ch4_start',
        cam: [3.6, 1.7, 29.4],
        look: [-0.6, 1.45, 30.2],
        prep: () => {
          this.met = true;
          stand(0, 0, 27.6, 0);
          this.toby.followRoute(null);
          this.toby.place(v(1.7, 0, 26.6), -0.15, 'TALK');
          this.corwin.place(v(-0.5, 0, 31.4), Math.PI - 0.1, 'TALK');
          this.dace.place(v(4.4, 0, 33.6), -2.6);
        },
        settle: 2,
      },
      { name: 'corwin-table', cp: 'ch4_camp', cam: [-3.6, 1.55, 34.0], look: [-6.2, 0.8, 36.3], prep: () => { camp(); stand(-2, 0, 33, -0.8); } },
      { name: 'bridgehead', cp: 'ch4_camp', cam: [0.6, 1.8, 43], look: [0, 0.5, 100], prep: () => { camp(); stand(0.4, 0, 47.4, 0); } },
      { name: 'bridge-side', cp: 'ch4_camp', cam: [26, -4, 86], look: [0, -7, 94], prep: () => { camp(); stand(0, 0, 80, 0); } },
      {
        name: 'blast',
        cp: 'ch4_camp',
        cam: [14, 10, 74],
        look: [0, -4, 96],
        prep: () => {
          camp();
          stand(0, 0, 84, 0);
          this.flashK = 1;
          this.bursts.emit(BLAST_AT, 320, v(8, 4, 8), v(0, 16, 0), 3.2, 6);
          this.smoke.emit(BLAST_AT, 260, v(6, 3, 6), v(0, 8, 0), 4.5, 9);
        },
        settle: 0.3,
      },
      { name: 'run', cp: 'ch4_camp', cam: [-3.6, 2.6, 96], look: [0, 0.8, 106], prep: () => { camp(); stand(0, 0, 104, 0, 'SPRINT'); } },
      { name: 'far-climb', cp: 'ch4_camp', cam: [3.6, 2.4, 124.5], look: [0, 1.8, 130], prep: () => { camp(); stand(0, 0.8, 129.6, 0, 'CLIMB'); } },
      { name: 'far-terrace', cp: 'ch4_far', cam: [-9, 7, 131.5], look: [6, 3, 147], prep: () => { this.blastDone = true; stand(4, FAR_Y, 140, 0.5, 'RUN'); } },
      { name: 'last-ledge', cp: 'ch4_ledge', cam: [7.6, 5, 159.6], look: [SHELF_X, 4.2, 164.6], prep: () => { this.blastDone = true; stand(SHELF_X, FAR_Y, 164, Math.PI / 2, 'LEDGE_IDLE'); } },
    ];
  }

  debug() {
    return {
      met: this.met,
      blast: this.blastDone,
      bridgeStarted: this.bridge.started,
      escapeT: +this.escapeT.toFixed(1),
      farStarted: this.farStarted,
      dace: this.dace.position.toArray().map((n) => +n.toFixed(1)),
    };
  }
}
