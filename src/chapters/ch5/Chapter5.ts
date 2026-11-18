import * as THREE from 'three';
import type { CheckpointDef } from '../Chapter';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Sequence } from '../../cinematic/Sequence';
import type { NpcActor } from '../../actors/NpcActor';
import type { BurstPool } from '../../world/Particles';
import { ChapterBase, type HeroFrame } from '../common/ChapterBase';
import { standardManifest, v } from '../common/LevelKit';
import { BeamPuzzle, type BeamTrace } from '../../puzzles/BeamPuzzle';
import * as P from '../../world/Props';
import { characterDef } from '../../animation/CharacterAvatar';
import { drawGlyph, type GlyphId } from '../../render/textures/ProceduralTextures';
import { CH5 } from '../../story/dialogue/ch5';
import { photoDataURL } from '../../story/PhotoArt';

/*
 * CHAPTER FIVE — THE FINAL EXPEDITION (STORY_BIBLE §14.6–14.7). Noon, Day 2.
 * Flooded entry passage → Marta's antechamber (the 1979 recording; Corwin breaks) → the Sanctum
 * of the Sunlock: Dace lifts the Lens, the sluices start failing, Corwin stops him, Dace is swept
 * away (alive). Ines re-seats the Lens; the noon beam splits three ways and each mirror must send
 * its beam to its house before the water wins — Toby, roped above, works the high mirror on her
 * call. The Sunlock settles; the three leave through the flooded lower passage into daylight.
 */
const BEAM_Y = 1.6;
const SANCTUM = { x0: -16, x1: 16, z0: 32, z1: 64, ceil: 18 };
const DAIS = v(0, 0, 48);
const LENS_FLOOR = v(5.2, 0, 41.5);
const TOBY_HANG = v(0.9, 6.5, 56.6);
const ROPE_NORMAL = v(0, 0, 1);
const TIME_LIMIT = 240;
const EXIT_X1 = -46;

const CHECKPOINTS: Record<string, CheckpointDef> = {
  ch5_start: { pos: v(0, 0, 0.5), yaw: 0, label: 'The lower passage' },
  ch5_antechamber: { pos: v(0, 0, 15.5), yaw: 0, label: "Marta's antechamber" },
  ch5_sanctum: { pos: v(0, 0, 35), yaw: 0, label: 'The Sanctum of the Sunlock' },
  ch5_exit: { pos: v(-14.5, 0, 41.5), yaw: -Math.PI / 2, label: 'The flooded passage' },
};

interface WorldSave {
  recording: boolean;
  dace: boolean;
  lens: 'stand' | 'floor' | 'carried' | 'seated';
  done: boolean;
}

export default class Chapter5 extends ChapterBase {
  readonly id = 5;
  readonly title = 'THE FINAL EXPEDITION';
  readonly numberLabel = 'CHAPTER FIVE';
  readonly checkpoints = CHECKPOINTS;
  readonly firstCheckpoint = 'ch5_start';
  protected readonly checkpointOrder = ['ch5_start', 'ch5_antechamber', 'ch5_sanctum', 'ch5_exit'];
  readonly manifest = standardManifest(
    'ch5',
    [
      { key: characterDef('corwin').asset, type: 'gltf', url: characterDef('corwin').url, weight: 2 },
      { key: characterDef('dace').asset, type: 'gltf', url: characterDef('dace').url, weight: 2 },
    ],
    { masonTint: [150, 140, 122] },
  );
  protected kitOptions = { masonMoss: 0.45, cliffMoss: 0.5 };

  private recordingPlayed = false;
  private daceDone = false;
  private lensState: WorldSave['lens'] = 'stand';
  private done = false;
  private puzzle!: BeamPuzzle;
  private lens!: THREE.Group;
  private lensStand = v(0, 1.25, 48);
  private plateMats = new Map<string, THREE.MeshStandardMaterial>();
  private water!: THREE.Mesh;
  private waterY = -0.3;
  private timer = -1;
  private warned = 0;
  private tobyTurns = 0;
  private corwin!: NpcActor;
  private dace!: NpcActor;
  private toby!: NpcActor;
  private tobyRope!: THREE.Mesh;
  private tobyOnRope = (dt: number): void => this.toby.avatar.climb.ropeHang(dt, this.toby.avatar.root, ROPE_NORMAL);
  private zenith!: THREE.Mesh;
  private zenithMat!: THREE.MeshBasicMaterial;
  private bursts!: BurstPool;
  private endStarted = false;
  private litCount = 0;

  // ================================================================ build
  protected async build(step: (f: number, label: string) => Promise<void>): Promise<void> {
    const k = this.kit;
    const { world } = this.ctx;
    this.sunDir = v(0.04, 1, 0.06).normalize();
    this.shadowRange = 34;
    this.charLightScale = 0.8;
    await step(0.05, 'The gorge floor');
    k.atmosphere({
      sunDir: this.sunDir,
      sunColor: new THREE.Color(1.0, 0.95, 0.85),
      sunIntensity: 7,
      zenith: new THREE.Color(0.25, 0.4, 0.62),
      horizon: new THREE.Color(0.62, 0.64, 0.62),
      sunHorizon: new THREE.Color(1.0, 0.92, 0.8),
      skySun: new THREE.Color(1.8, 1.6, 1.3),
      ground: new THREE.Color(0.15, 0.14, 0.12),
      cloudCover: 0.3,
      skySunIntensity: 20,
      envIntensity: 0.38,
      fogColor: new THREE.Color(0.1, 0.1, 0.095),
      fogDensity: 0.016,
      fogSunColor: new THREE.Color(0.45, 0.42, 0.36),
      fogHeightBase: -2,
      fogHeightFalloff: 0.02,
      hemiSky: new THREE.Color(0.5, 0.55, 0.58),
      hemiGround: new THREE.Color(0.15, 0.14, 0.12),
      hemiIntensity: 0.42,
      wetness: 0.6,
      shadowRange: this.shadowRange,
      hideSky: true,
    });
    k.flatFloor(0, [-70, -40], 160);
    world.bounds = { minX: -48, maxX: 17, minZ: -3, maxZ: 65 };
    world.terrainSurface = (x, z) => (z < 13.5 || (x < -16 && z > 38 && z < 45) ? 'water' : 'stone');

    await step(0.15, 'The flooded passage');
    this.buildPassage();
    await step(0.3, "Marta's antechamber");
    this.buildAntechamber();
    await step(0.5, 'The Sunlock');
    this.buildSanctum();
    await step(0.75, 'The way out');
    this.buildExit();
    await step(0.88, 'Spray and dust');
    k.particles('dust', 420, v(0, 0, 48), v(30, 16, 30), new THREE.Color(1, 0.92, 0.75), 0.08, 0.55, 51);
    k.particles('mist', 30, v(0, 0, 6), v(5, 3, 14), new THREE.Color(0.6, 0.62, 0.6), 18, 0.22, 52, 'tex.mist');
    this.bursts = k.bursts(500, new THREE.Color(0.5, 0.52, 0.55));
    k.finish();
    this.ctx.traversal.load({ climbs: [], ledges: [], narrows: [], vaults: [], jumps: [] });

    this.corwin = this.npc('corwin', v(9, 0, 20), -Math.PI / 2);
    this.dace = this.npc('dace', v(2.5, 0.4, 47), -1.2);
    this.toby = this.npc('toby', TOBY_HANG.clone(), Math.PI, 'HANG');
    this.toby.groundSnap = false;
    this.toby.rig = this.tobyOnRope;
  }

  private buildPassage(): void {
    const k = this.kit;
    const { world } = this.ctx;
    // A natural cave: rough rock walls, knee-deep water, light from the sanctum ahead.
    for (const sx of [-1, 1]) world.addBox(v(sx * 3.2, 2, 6.5), v(1.2, 3, 8.5));
    k.cliffBox(v(-3.2, 2, 6.5), v(1.2, 3, 8.5), ['+x'], { collide: false, hue: new THREE.Color(0.75, 0.72, 0.7), inset: 0.6 });
    k.cliffBox(v(3.2, 2, 6.5), v(1.2, 3, 8.5), ['-x'], { collide: false, hue: new THREE.Color(0.75, 0.72, 0.7), inset: 0.6 });
    world.addBox(v(0, 1.5, -2), v(3, 2.5, 0.6));
    k.ceiling(-2.4, 2.4, -2, 14, 3.4);
    k.masonBatch.add(k.plate, v(0, -0.3, 6), v(5, 0.6, 16), 0, 0.45);
    for (let i = 0; i < 18; i++) k.boulder(v((k.rnd() - 0.5) * 4, -0.1, k.rnd() * 13), 0.18 + k.rnd() * 0.3, 0, false);
    k.waterPlane(0, 0.32, 5.8, 4.8, 15.6);
    // A raised threshold holds the water in the passage: it no longer ends in mid-air at the doorway.
    k.blockAt(v(0, 0.19, 13.9), v(4.8, 0.38, 0.6), 0, true, 0.6);
    k.blockAt(v(0, 0.09, 14.45), v(4.8, 0.18, 0.5), 0, true, 0.6);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), new THREE.MeshBasicMaterial({ color: 0x050605 }));
    back.position.set(0, 1.6, -1.35);
    k.root.add(back);
  }

  private buildAntechamber(): void {
    const k = this.kit;
    const { world } = this.ctx;
    k.pavedFloor(-6, 6, 14, 26, 0.0, 0.62);
    world.addBox(v(0, 0.05, 20), v(6, 0.05, 6));
    k.coursedWall(-6, 14, 6, 14, 0, 4.5, { gaps: [[-2.4, 2.4]], doorH: 3.2, tint: 0.7 });
    k.coursedWall(-6, 26, 6, 26, 0, 4.5, { gaps: [[-1.6, 1.6]], doorH: 3.2, tint: 0.7 });
    k.coursedWall(-6, 14, -6, 26, 0, 4.5, { tint: 0.7 });
    k.coursedWall(6, 14, 6, 26, 0, 4.5, { gaps: [[19, 21.4]], doorH: 2.6, tint: 0.7 });
    k.ceiling(-6, 6, 14, 26, 4.5, [[-1, 1, 19, 21]]);
    // Side door (Corwin's way in): blocked by rubble for the player.
    world.addBox(v(6.6, 1.2, 20.2), v(0.4, 1.2, 1.2), 0, { blocksCamera: false });
    for (let i = 0; i < 6; i++) k.boulder(v(7.2 + k.rnd(), 0.2, 19.2 + k.rnd() * 2), 0.3 + k.rnd() * 0.3, 0, false);
    // Marta's niche: a stone shelf, the recorder, the film tin, the knotted cord, a bedroll.
    k.blockAt(v(-4.8, 0.45, 24.4), v(2.0, 0.9, 1.6), 0, true, 0.9);
    const rec = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.55, metalness: 0.2 }));
    body.position.y = 0.08;
    rec.add(body);
    for (const sx of [-0.12, 0.12]) {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x8a8a84, metalness: 0.7, roughness: 0.35 }));
      reel.position.set(sx, 0.175, -0.02);
      rec.add(reel);
    }
    rec.position.set(-4.6, 0.9, 24.4);
    rec.rotation.y = 0.25;
    k.root.add(rec);
    const tin = P.tinBox(k.PM);
    tin.position.set(-5.3, 0.9, 24.6);
    this.pickup('ch5_film_tin', tin, CH5.filmTin, { prompt: 'Pick up the film tin', radius: 1.6 });
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), k.PM.bronze);
    cord.position.set(-4.0, 0.93, 24.2);
    cord.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.3), k.PM.ribbon);
    tail.position.set(0.02, -0.15, 0);
    cord.add(tail);
    this.pickup('ch5_relic_cord', cord, CH5.cord, { prompt: 'Pick up', radius: 1.5 });
    k.place(P.cot(k.PM, false), 3.6, 0, 23.6, Math.PI / 2);
    world.addBox(v(3.6, 0.25, 23.6), v(0.36, 0.25, 0.95), 0, { surface: 'wood' });
    k.place(P.lantern(k.PM, false), 2.6, 0, 24.8);
    k.place(P.crate(k.PM, 0.8, 0.5, 0.55, 'aldercott'), -4.4, 0, 16, 0.3);
    // Marta's corner (1979): a table and chair, a candle stub, tins of film, books, a blanket
    // hung against the damp, and a photograph pinned to the stone.
    k.place(P.table(k.PM), 3.9, 0, 17.4, Math.PI / 2);
    world.addBox(v(3.9, 0.38, 17.4), v(0.45, 0.38, 0.95), 0, { surface: 'wood' });
    {
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), k.PM.wood);
      seat.position.y = 0.45;
      chair.add(seat);
      for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), k.PM.wood);
        leg.position.set(lx, 0.225, lz);
        chair.add(leg);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.04), k.PM.wood);
      back.position.set(0, 0.72, -0.21);
      chair.add(back);
      k.place(chair, 3.0, 0, 17.2, 1.3);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 }));
      k.place(candle, 3.9, 0.8, 17.0);
      for (let t = 0; t < 3; t++) k.place(P.tinBox(k.PM), 3.95 + t * 0.05, 0.77 + t * 0.06, 17.7, t * 0.4);
      for (let b = 0; b < 3; b++) {
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.22), new THREE.MeshStandardMaterial({ color: [0x5a3a2a, 0x3a4a3a, 0x6a5a3a][b], roughness: 0.85 }));
        k.place(book, 3.8, 0.77 + b * 0.036, 18.1, b * 0.3);
      }
      const blanket = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3, 6, 6), k.PM.canvas);
      const bp = blanket.geometry.attributes.position;
      for (let i = 0; i < bp.count; i++) bp.setZ(i, Math.sin(bp.getX(i) * 4) * 0.04);
      blanket.geometry.computeVertexNormals();
      blanket.position.set(5.55, 1.7, 23.4);
      blanket.rotation.y = -Math.PI / 2;
      k.props.add(blanket);
      const tex = new THREE.TextureLoader().load(photoDataURL('kitchens'));
      tex.colorSpace = THREE.SRGBColorSpace;
      k.track(tex);
      const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.25), k.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })));
      photo.position.set(5.58, 1.55, 17.6);
      photo.rotation.set(0, -Math.PI / 2, 0.04);
      k.props.add(photo);
    }
    world.addBox(v(-4.4, 0.25, 16), v(0.4, 0.25, 0.28), 0.3, { surface: 'wood' });
    // Corridor to the sanctum
    k.pavedFloor(-1.6, 1.6, 26, 32, 0, 0.62);
    k.coursedWall(-1.6, 26, -1.6, 32, 0, 3.4, { tint: 0.7 });
    k.coursedWall(1.6, 26, 1.6, 32, 0, 3.4, { tint: 0.7 });
    k.ceiling(-1.6, 1.6, 26, 32, 3.4);
    // Light from the shaft above the antechamber
    k.shaft(v(-0.6, 9, 19.4), v(0.05, -1, 0.06), 9, 0.5, 1.0, new THREE.Color(1, 0.9, 0.7), 0.05);
  }

  private buildSanctum(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const S = SANCTUM;
    k.pavedFloor(S.x0, S.x1, S.z0, S.z1, 0, 0.62);
    k.coursedWall(S.x0, S.z0, S.x1, S.z0, 0, S.ceil, { gaps: [[-1.6, 1.6]], doorH: 3.2, tint: 0.72 });
    k.coursedWall(S.x0, S.z1, S.x1, S.z1, 0, S.ceil, { tint: 0.72 });
    k.coursedWall(S.x0, S.z0, S.x0, S.z1, 0, S.ceil, { gaps: [[40, 43]], doorH: 2.9, tint: 0.72 });
    k.coursedWall(S.x1, S.z0, S.x1, S.z1, 0, S.ceil, { tint: 0.72 });
    k.ceiling(S.x0, S.x1, S.z0, S.z1, S.ceil, [[-2.2, 2.2, 45.8, 50.2]], 3);
    // Galleries ringing the hall (the counterweight works), stepping up the walls.
    for (let lv = 0; lv < 3; lv++) {
      const y = 5 + lv * 4;
      for (const [x0, x1, z0, z1] of [[S.x0, S.x0 + 2.5, S.z0, S.z1], [S.x1 - 2.5, S.x1, S.z0, S.z1], [S.x0, S.x1, S.z1 - 2.5, S.z1]] as const) k.darkBatch.add(k.block, v((x0 + x1) / 2, y, (z0 + z1) / 2), v(x1 - x0, 0.6, z1 - z0), 0, 0.65);
      for (let i = 0; i < 8; i++) k.darkBatch.add(k.block, v(-14 + i * 4, y + 1.6, S.z1 - 1.2), v(0.8, 2.6, 0.8), 0, 0.7);
    }
    // A ring of drum columns around the dais, and the carved oculus ring under the shaft.
    const drum = k.track((() => {
      const g = new THREE.CylinderGeometry(0.55, 0.58, 1, 16, 1).toNonIndexed();
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.9), 3));
      g.computeVertexNormals();
      return g;
    })());
    for (let c = 0; c < 8; c++) {
      const a = (c / 8) * Math.PI * 2 + Math.PI / 8;
      const cx = Math.cos(a) * 10.5;
      const cz = 48 + Math.sin(a) * 10.5;
      if (Math.abs(cx) < 2.5 && cz > 55) continue; // keep the line to the Eye house clear
      k.blockAt(v(cx, 0.3, cz), v(1.7, 0.6, 1.7), 0, false, 0.9);
      for (let y = 0.6; y < 9.4; ) {
        const hh = Math.min(0.9 + k.rnd() * 0.35, 9.4 - y);
        k.masonBatch.add(drum, v(cx, y + hh / 2, cz), v(1, hh, 1), k.rnd() * 6, 0.82 + k.rnd() * 0.14);
        y += hh;
      }
      k.masonBatch.add(k.ashlar, v(cx, 9.7, cz), v(1.6, 0.6, 1.6), 0, 0.95);
      world.addCylinder(v(cx, 5, cz), 0.6, 5);
    }
    {
      const oculus = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.35, 10, 48), k.PM.bronze);
      oculus.rotation.x = Math.PI / 2;
      oculus.position.set(0, S.ceil - 0.1, 48);
      k.root.add(oculus);
      // Bronze gear wheels of the Sunlock, set into the north wall behind the houses.
      for (const [gx, gy, r] of [[-11, 9, 2.4], [11, 9, 2.4], [0, 12.5, 3.2], [-5.5, 14.5, 1.6], [5.5, 14.5, 1.6]] as const) {
        const gear = new THREE.Group();
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.09, 8, 40), k.PM.bronze);
        gear.add(rim);
        const teeth = Math.round(r * 9);
        for (let t = 0; t < teeth; t++) {
          const a = (t / teeth) * Math.PI * 2;
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 0.16, r * 0.14), k.PM.bronze);
          tooth.position.set(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08, 0);
          tooth.rotation.z = a;
          gear.add(tooth);
        }
        for (let sp = 0; sp < 6; sp++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r * 0.07, r * 0.07), k.PM.bronze);
          spoke.rotation.z = (sp / 6) * Math.PI;
          gear.add(spoke);
        }
        gear.position.set(gx, gy, S.z1 - 0.65);
        k.props.add(gear);
      }
    }

    // The dais + the Lens on its stand under the zenith shaft
    k.masonBatch.add(k.plate, v(DAIS.x, 0.2, DAIS.z), v(8, 0.4, 8), Math.PI / 4, 0.85);
    for (let e = 0; e < 4; e++) {
      // Carved kerb along each edge of the diamond dais.
      const a = Math.PI / 4 + (e * Math.PI) / 2;
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      for (let t = -2.6; t <= 2.6; t += 0.95) k.masonBatch.add(k.ashlar, v(DAIS.x + nx * 2.85 + nz * t, 0.42, DAIS.z + nz * 2.85 - nx * t), v(0.9, 0.12, 0.35), new THREE.Euler(0, a, 0), 1.05);
    }
    k.masonBatch.add(k.plate, v(DAIS.x, 0.47, DAIS.z), v(3, 0.14, 3), Math.PI / 4, 0.95);
    world.addBox(v(DAIS.x, 0.2, DAIS.z), v(4, 0.2, 4), Math.PI / 4);
    world.addCylinder(v(0, 0.9, 48), 0.45, 0.7);
    k.blockAt(v(0, 0.85, 48), v(0.7, 0.9, 0.7), Math.PI / 4, false, 1.0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 40), k.PM.bronze);
    ring.position.set(0, 1.62, 48);
    k.root.add(ring);
    this.lens = new THREE.Group();
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 9).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xeaf4ff, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.75, emissive: new THREE.Color(0.6, 0.55, 0.4), emissiveIntensity: 0.6 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 6, 9), k.PM.bronze);
    this.lens.add(crystal, band);
    this.lens.position.copy(this.lensStand);
    this.lens.position.y = 1.62;
    k.root.add(this.lens);
    // Zenith beam: the noon sun straight down the shaft onto the Lens.
    this.zenithMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.15, 0.9), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    k.track(this.zenithMat);
    this.zenith = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, S.ceil + 6, 16, 1, true), this.zenithMat);
    this.zenith.position.set(0, (S.ceil + 6) / 2 + 1.6, 48);
    k.root.add(this.zenith);
    // The visible noon shaft: soft volumetric cone onto the Lens (the thin core above is the hot centre).
    k.shaft(v(0, S.ceil + 2, 48), v(0, -1, 0), S.ceil + 1.5, 1.9, 2.6, new THREE.Color(1.0, 0.9, 0.7), 0.06);
    // Light bouncing off the sunlit floor fills the hall warmly.
    const bounce = new THREE.PointLight(new THREE.Color(1.0, 0.82, 0.58), 9, 24, 1.6);
    bounce.position.set(0, 1.2, 48);
    k.root.add(bounce);
    const zl = new THREE.PointLight(new THREE.Color(1.0, 0.9, 0.7), 26, 14, 2);
    zl.position.set(0, 3, 48);
    k.root.add(zl);
    // Channels: water running in stone troughs around the dais (and the spill channel Dace goes into).
    for (const [cx, cz, w, d] of [[-9.5, 48, 1.2, 20], [9.5, 48, 1.2, 20], [0, 39.2, 18, 1.2], [13.5, 37.5, 3, 4]] as const) {
      k.waterPlane(cx, -0.08, cz, w, d);
      k.darkBatch.add(k.block, v(cx, -0.25, cz), v(w + 0.3, 0.3, d + 0.3), 0, 0.4);
    }
    // Rising flood water (the Sunlock failing) — a hall-wide plane that climbs with the timer.
    this.water = k.waterPlane(0, -0.3, 48, 31.6, 31.6);
    this.water.visible = false;

    // Mirrors + plates
    const mirror = (id: string, x: number, z: number, initial: number, pedestal = true) => {
      if (pedestal) k.blockAt(v(x, 0.4, z), v(0.9, 0.8, 0.9), 0, true, 0.95);
      const pivot = new THREE.Group();
      pivot.position.set(x, BEAM_Y, z);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8b070, metalness: 1, roughness: 0.12, envMapIntensity: 1.5 }));
      disc.castShadow = true;
      pivot.add(disc);
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 6, 24, Math.PI), k.PM.bronze);
      yoke.rotation.z = Math.PI;
      pivot.add(yoke);
      k.root.add(pivot);
      return { id, pos: v(x, BEAM_Y, z), initial, object: pivot, halfWidth: 0.65 };
    };
    const mR = mirror('mR', -7, 48, 3);
    const mS = mirror('mS', 7, 48, 1);
    const mE = mirror('mE', 0, 56, 0, false);
    // Toby's mirror stands in a sluice pit (out of Ines's reach), on a tall bronze post.
    k.darkBatch.add(k.block, v(0, -0.2, 56), v(4.4, 0.3, 4.4), 0, 0.35);
    k.waterPlane(0, -0.12, 56, 4.2, 4.2);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, BEAM_Y, 8), k.PM.bronze);
    post.position.set(0, BEAM_Y / 2 - 0.1, 56);
    k.root.add(post);
    for (const [x0, x1, z0, z1] of [[-2.3, 2.3, 53.6, 53.9], [-2.3, 2.3, 58.1, 58.4], [-2.3, -2.0, 53.6, 58.4], [2.0, 2.3, 53.6, 58.4]] as const) world.addBox(v((x0 + x1) / 2, 0.6, (z0 + z1) / 2), v((x1 - x0) / 2, 0.6, (z1 - z0) / 2), 0, { blocksCamera: false });
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      k.masonBatch.add(k.block, v(Math.cos(ang) * 2.15, 0.2, 56 + Math.sin(ang) * 2.15), v(0.8, 0.4, 0.3), -ang, 0.85);
    }
    const plates = [
      this.plate('rising', 'rising', v(-7, BEAM_Y, S.z1 - 0.48), Math.PI),
      this.plate('eye', 'eye', v(0, BEAM_Y, S.z1 - 0.48), Math.PI),
      this.plate('setting', 'setting', v(7, BEAM_Y, S.z1 - 0.48), Math.PI),
      this.plate('serpentA', 'serpent', v(-7, BEAM_Y, S.z0 + 0.48), 0),
      this.plate('serpentB', 'serpent', v(7, BEAM_Y, S.z0 + 0.48), 0),
    ];
    const t = 0.35;
    const blockers = [
      { minX: S.x0 - 5, maxX: S.x0 + t, minZ: S.z0 - 5, maxZ: S.z1 + 5 },
      { minX: S.x1 - t, maxX: S.x1 + 5, minZ: S.z0 - 5, maxZ: S.z1 + 5 },
      { minX: S.x0 - 5, maxX: S.x1 + 5, minZ: S.z0 - 5, maxZ: S.z0 + t },
      { minX: S.x0 - 5, maxX: S.x1 + 5, minZ: S.z1 - t, maxZ: S.z1 + 5 },
    ];
    const lp = v(0, BEAM_Y, 48);
    this.puzzle = new BeamPuzzle(
      'ch5_sunlock',
      [mR, mS, mE],
      plates,
      [
        { pos: lp.clone().add(v(-0.3, 0, 0)), dir: v(-1, 0, 0), enabled: false },
        { pos: lp.clone().add(v(0.3, 0, 0)), dir: v(1, 0, 0), enabled: false },
        { pos: lp.clone().add(v(0, 0, 0.3)), dir: v(0, 0, 1), enabled: false },
      ],
      blockers,
      new THREE.Color(1.0, 0.9, 0.65),
    );
    k.root.add(this.puzzle.group);
    // Counterweight lever (Corwin's post) + the great counterweights hanging in the galleries.
    k.blockAt(v(-12, 0.6, 52), v(0.6, 1.2, 0.6), 0, true, 0.9);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), k.PM.bronze);
    lever.position.set(-12, 1.6, 52.2);
    lever.rotation.x = 0.5;
    k.root.add(lever);
    for (const [x, z] of [[-13.6, 40], [13.6, 40], [-13.6, 58], [13.6, 58]] as const) {
      // Carved counterweights hanging on bronze chains from the gallery beams.
      const wgt = new THREE.Mesh(k.ashlar, k.darkMat);
      wgt.scale.set(1.4, 1.8, 1.4);
      wgt.position.set(x, 8.6, z);
      wgt.castShadow = true;
      k.props.add(wgt);
      for (const dx of [-0.4, 0.4]) {
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8.4, 6), k.PM.darkMetal);
        chain.position.set(x + dx, 13.7, z);
        k.props.add(chain);
      }
    }
    // Toby's rope from the shaft
    this.tobyRope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), k.PM.rope);
    // (runs past him: the tail hangs below his feet)
    this.tobyRope.scale.y = S.ceil + 2 - (TOBY_HANG.y - 1.1);
    this.tobyRope.position.set(TOBY_HANG.x, (S.ceil + 2 + TOBY_HANG.y - 1.1) / 2, TOBY_HANG.z);
    k.root.add(this.tobyRope);
    // Lens interaction marker positions
    void LENS_FLOOR;
  }

  private plate(id: string, glyph: GlyphId, pos: THREE.Vector3, yaw: number) {
    const k = this.kit;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#5a4428';
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#f0d8a0';
    x.fillStyle = '#f0d8a0';
    drawGlyph(x, glyph, 128, 128, 150);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    k.track(tex);
    const mat = k.track(new THREE.MeshStandardMaterial({ map: tex, color: 0xb08a50, metalness: 0.7, roughness: 0.4, emissive: new THREE.Color(1.0, 0.72, 0.32), emissiveMap: tex, emissiveIntensity: 0 }));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 28).rotateX(Math.PI / 2), mat);
    disc.position.copy(pos);
    disc.rotation.y = yaw;
    k.root.add(disc);
    this.plateMats.set(id, mat);
    return { id, pos: pos.clone(), radius: 0.55 };
  }

  private buildExit(): void {
    const k = this.kit;
    const { world } = this.ctx;
    // The flooded lower passage (waist-deep), from the sanctum's east door toward daylight.
    k.masonBatch.add(k.plate, v((SANCTUM.x0 + EXIT_X1) / 2, -0.6, 41.5), v(SANCTUM.x0 - EXIT_X1, 0.6, 3.2), 0, 0.45);
    world.addBox(v((SANCTUM.x0 + EXIT_X1) / 2, 1.5, 39.4), v((SANCTUM.x0 - EXIT_X1) / 2, 3, 0.5));
    world.addBox(v((SANCTUM.x0 + EXIT_X1) / 2, 1.5, 43.6), v((SANCTUM.x0 - EXIT_X1) / 2, 3, 0.5));
    k.cliffBox(v((SANCTUM.x0 + EXIT_X1) / 2, 1.5, 38.4), v((SANCTUM.x0 - EXIT_X1) / 2, 3, 1.4), ['+z'], { collide: false, inset: 0.7, hue: new THREE.Color(0.7, 0.72, 0.7) });
    k.cliffBox(v((SANCTUM.x0 + EXIT_X1) / 2, 1.5, 44.6), v((SANCTUM.x0 - EXIT_X1) / 2, 3, 1.4), ['-z'], { collide: false, inset: 0.7, hue: new THREE.Color(0.7, 0.72, 0.7) });
    k.ceiling(EXIT_X1, SANCTUM.x0, 39.5, 43.5, 3.2);
    k.waterPlane((SANCTUM.x0 + EXIT_X1) / 2, 0.85, 41.5, SANCTUM.x0 - EXIT_X1, 3.4);
    // Daylight at the far end
    const day = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9), fog: false }));
    day.position.set(EXIT_X1 + 0.2, 1.6, 41.5);
    day.rotation.y = Math.PI / 2;
    k.root.add(day);
    world.addBox(v(EXIT_X1 - 0.3, 1.5, 41.5), v(0.3, 3, 2.2));
    const l = new THREE.PointLight(new THREE.Color(1, 0.95, 0.85), 16, 14, 2);
    l.position.set(EXIT_X1 + 2, 2, 41.5);
    k.root.add(l);
  }

  // ================================================================ setup
  protected setup(): void {
    const { interaction, player, state, audio } = this.ctx;
    state.register(this.puzzle);
    this.disposers.push(() => {
      state.unregister(this.puzzle.key);
      this.puzzle.dispose();
    });
    this.puzzle.onTurnStart = (i) => audio.sfx.stoneGrind(this.puzzle.turnTime, this.puzzle.mirrors[i].pos, 0.4);
    this.puzzle.onTurnEnd = (i) => audio.sfx.clunk(this.puzzle.mirrors[i].pos, 0.4);
    this.puzzle.onTraced = (tr) => this.onTraced(tr);
    interaction.add({
      id: 'recorder',
      position: v(-4.6, 1.0, 24.4),
      radius: 1.8,
      prompt: 'Play the tape',
      enabled: true,
      facing: 0,
      onInteract: () => this.playRecording(),
    });
    interaction.add({
      id: 'lens',
      position: LENS_FLOOR.clone().setY(0.3),
      radius: 1.6,
      prompt: 'Pick up the Lens',
      enabled: false,
      facing: 0,
      onInteract: () => {
        interaction.get('lens')!.enabled = false;
        player.playAction('INTERACT', LENS_FLOOR, 1.0);
        this.after(0.5, () => {
          this.lensState = 'carried';
          this.applyLens();
          this.ctx.dialogue.sayOnce('ch5:pickLens', CH5.pickLens);
        });
      },
    });
    interaction.add({
      id: 'seat',
      position: v(0, 1.4, 48),
      radius: 2.4,
      prompt: 'Seat the Lens',
      enabled: false,
      facing: 0,
      onInteract: () => {
        interaction.get('seat')!.enabled = false;
        player.playAction('INTERACT', v(0, 1.4, 48), 1.2);
        this.after(0.7, () => {
          this.lensState = 'seated';
          this.applyLens();
          audio.sfx.clunk(v(0, 1.6, 48), 0.8);
          this.ctx.camera.addTrauma(0.2);
          this.ctx.dialogue.sayOnce('ch5:seated', CH5.seated, true);
        });
      },
    });
    this.puzzle.mirrors.forEach((m, i) => {
      if (m.id === 'mE') return;
      interaction.add({
        id: `mirror:${i}`,
        position: m.pos.clone(),
        radius: 1.7,
        prompt: 'Turn the mirror',
        enabled: true,
        facing: 0.2,
        onInteract: () => {
          if (this.puzzle.solved || this.puzzle.busy || this.lensState !== 'seated') return;
          player.playAction('PUSH', m.pos, 0.9);
          this.after(0.3, () => this.puzzle.turn(i, 1));
        },
      });
    });
    interaction.add({
      id: 'callToby',
      position: v(0, 1.2, 52.8),
      radius: 1.8,
      prompt: 'Call to Toby',
      enabled: true,
      facing: 0,
      onInteract: () => {
        if (this.puzzle.solved || this.puzzle.busy || this.lensState !== 'seated') return;
        this.ctx.dialogue.say(CH5.callToby[this.tobyTurns % CH5.callToby.length], true);
        this.tobyTurns++;
        this.after(1.6, () => this.puzzle.turn(2, 1));
      },
    });
    this.ctx.camera.hints = [
      { id: 'passage', center: v(0, 0, 6), radius: 6, distance: 3.2, fovAdd: -2 },
      { id: 'ante', center: v(0, 0, 20), radius: 6, distance: 3.6 },
      { id: 'sanctum', center: v(0, 0, 48), radius: 18, distance: 5.2, heightAdd: 0.5, fovAdd: 8 },
      { id: 'exit', center: v(-31, 0, 41.5), radius: 16, distance: 3.2, fovAdd: -2 },
    ];
  }

  private onTraced(tr: BeamTrace[]): void {
    const hits = new Set(tr.map((t) => t.hit).filter(Boolean) as string[]);
    for (const [id, m] of this.plateMats) {
      const lit = hits.has(id) || (this.done && !id.startsWith('serpent'));
      m.emissiveIntensity = lit ? 2.4 : 0;
      if (id.startsWith('serpent')) m.emissive.setRGB(0.3, 0.6, 1.0);
    }
    const n = ['rising', 'eye', 'setting'].filter((h) => hits.has(h)).length;
    if (n > this.litCount && !this.done) this.ctx.audio.sfx.checkpoint();
    if (n > this.litCount && n < 3 && !this.done) this.ctx.dialogue.say(CH5.plateLit);
    this.litCount = n;
    if (n === 3 && !this.puzzle.solved && this.lensState === 'seated') {
      this.puzzle.markSolved();
      this.done = true;
      this.timer = -1;
      this.ctx.state.progress.completedPuzzles.add('ch5_sunlock');
      this.ctx.events.emit('puzzle:solved', { id: 'ch5_sunlock' });
      this.after(1.2, () => this.playSettled());
    }
  }

  private applyLens(): void {
    const it = this.ctx.interaction;
    const hand = this.ctx.player.avatar.bones.handR;
    this.lens.removeFromParent();
    this.lens.rotation.set(0, 0, 0);
    this.lens.scale.setScalar(1);
    if (this.lensState === 'stand' || this.lensState === 'seated') {
      this.kit.root.add(this.lens);
      this.lens.position.set(0, 1.62, 48);
    } else if (this.lensState === 'floor') {
      this.kit.root.add(this.lens);
      this.lens.position.copy(LENS_FLOOR).setY(0.08);
      this.lens.rotation.x = Math.PI / 2;
    } else if (hand) {
      hand.add(this.lens);
      const s = 1 / Math.max(1e-3, hand.getWorldScale(new THREE.Vector3()).x);
      this.lens.scale.setScalar(s);
      this.lens.position.set(0, 0.1 * s, 0.05 * s);
    }
    it.get('lens')!.enabled = this.lensState === 'floor';
    it.get('seat')!.enabled = this.lensState === 'carried';
    const on = this.lensState === 'seated';
    this.puzzle.sources.forEach((_, i) => this.puzzle.setSourceEnabled(i, on));
    this.puzzle.retrace();
  }

  // ================================================================ world state
  protected saveWorld(): Record<string, unknown> {
    const d: WorldSave = { recording: this.recordingPlayed, dace: this.daceDone, lens: this.lensState === 'carried' ? 'floor' : this.lensState, done: this.done };
    return d as unknown as Record<string, unknown>;
  }

  protected loadWorld(d: Record<string, unknown> | undefined): void {
    const w = d as unknown as WorldSave | undefined;
    this.recordingPlayed = w?.recording ?? false;
    this.daceDone = w?.dace ?? false;
    this.lensState = w?.lens ?? 'stand';
    this.done = w?.done ?? false;
  }

  protected applyWorld(): void {
    this.endStarted = false;
    this.warned = 0;
    this.litCount = 0;
    const it = this.ctx.interaction;
    it.get('recorder')!.enabled = !this.recordingPlayed;
    // Corwin
    if (!this.recordingPlayed) {
      this.corwin.visible = false;
      this.corwin.place(v(9, 0, 20), -Math.PI / 2);
    } else {
      this.corwin.visible = true;
      this.corwin.place(this.daceDone ? v(-12, 0, 51.2) : v(1.4, 0, 20.5), this.daceDone ? Math.PI * 0.85 : -0.2);
      if (!this.daceDone) this.corwin.followRoute([v(0, 0, 14), v(0, 0, 26), v(0, 0, 33)], () => this.ctx.player.position, 2.5);
    }
    // Dace (gone after the sanctum scene)
    this.dace.visible = !this.daceDone;
    this.dace.place(v(2.5, 0.4, 47), -1.2);
    // Toby on his rope (after the sanctum scene)
    this.toby.visible = this.daceDone;
    this.tobyRope.visible = this.daceDone;
    this.toby.groundSnap = false;
    this.toby.rig = this.tobyOnRope;
    this.toby.place(TOBY_HANG.clone(), Math.PI, 'HANG');
    // Lens + puzzle; a retry resets mirrors (checkpoint = puzzle start).
    if (this.lensState === 'carried') this.lensState = 'floor';
    if (this.done) this.puzzle.markSolved();
    this.applyLens();
    // Water + timer
    this.timer = this.daceDone && !this.done ? TIME_LIMIT : -1;
    this.waterY = this.done ? -0.3 : this.daceDone ? -0.2 : -0.3;
    this.water.visible = this.daceDone && !this.done;
    this.ctx.player.speedCap = Infinity;
    if (this.done) this.corwin.place(v(-11.4, 0, 46), -0.6);
  }

  protected ambience(): AmbienceConfig {
    return {
      wind: 0.15,
      insects: 0,
      birds: 0,
      frogs: 0,
      drips: 1,
      water: [
        { pos: v(0, 0, 6), gain: 0.18, kind: 'river' },
        { pos: v(9.5, 0, 48), gain: 0.15, kind: 'river' },
        { pos: v(-9.5, 0, 48), gain: 0.15, kind: 'river' },
        { pos: v(-30, 0, 41.5), gain: 0.3, kind: 'river' },
      ],
    };
  }

  protected restoreMood() {
    return this.done ? ('wonder' as const) : this.daceDone ? ('tension' as const) : ('explore' as const);
  }

  protected onRespawned(): void {
    this.after(1.2, () => this.ctx.dialogue.say(CH5.drowned, true));
  }

  // ================================================================ update
  protected tick(dt: number): void {
    this.puzzle.update(dt);
    this.bursts.update(dt);
    const p = this.ctx.player.position;
    // Wading (knee-deep entry passage, waist-deep exit passage, the flood).
    let cap = Infinity;
    if (p.z < 13.5) cap = 2.6;
    if (p.x < SANCTUM.x0 + 0.5) cap = 1.9;
    if (this.water.visible && this.waterY > 0.6) cap = Math.min(cap, 3.2);
    this.ctx.player.speedCap = cap;
    // The Sunlock failing: water rises with the timer; out of time = the sanctum floods.
    if (this.timer > 0 && !this.ctx.cinematic.playing) {
      this.timer -= dt;
      const k = 1 - this.timer / TIME_LIMIT;
      this.waterY = -0.2 + k * 1.9;
      const warnAt = [TIME_LIMIT * 0.5, TIME_LIMIT * 0.25, 30];
      if (this.warned < 3 && this.timer < warnAt[this.warned]) {
        this.ctx.dialogue.say(CH5.warn[this.warned], true);
        this.warned++;
      }
      if (Math.random() < dt * 0.6) {
        this.ctx.camera.addTrauma(0.08);
        this.bursts.emit(v((Math.random() - 0.5) * 28, 12 + Math.random() * 4, 34 + Math.random() * 28), 6, v(0.5, 0.2, 0.5), v(0, -3, 0), 1, 2);
      }
      if (this.timer <= 0) {
        this.timer = -1;
        this.ctx.camera.addTrauma(0.8);
        this.ctx.player.kill('drowned');
      }
    }
    if (this.done) this.waterY = Math.max(-0.4, this.waterY - dt * 0.4);
    this.water.position.y = this.waterY;
    if (this.done && this.waterY <= -0.39) this.water.visible = false;
    this.zenithMat.opacity = 0.35 + Math.sin(this.time * 1.3) * 0.05 + (this.done ? 0.15 : 0);
    // Toby sways on his rope
    if (this.toby.visible) {
      this.toby.position.x = TOBY_HANG.x + Math.sin(this.time * 0.9) * 0.08;
      this.toby.position.y = TOBY_HANG.y;
    }
  }

  protected triggers(): void {
    const { player } = this.ctx;
    const p = player.position;
    if (p.z > 2) this.say('intro', CH5.intro);
    if (p.z > 14.5) {
      this.checkpoint('ch5_antechamber');
      this.say('antechamber', CH5.antechamber);
    }
    if (!this.recordingPlayed && p.distanceTo(v(-4.6, 0, 24.4)) < 3.4) this.say('recorder', CH5.recorder);
    // Heading for the sanctum without having found the recorder: she notices it on the way past
    // (the rest of the chapter hangs on that scene).
    if (!this.recordingPlayed && this.cpIndex() < 2 && p.z > 30.5) {
      this.playRecording();
      return;
    }
    if (this.recordingPlayed && !this.daceDone && p.z > 33.5) {
      this.playDace();
      return;
    }
    if (this.done && p.x < SANCTUM.x0 - 0.5) {
      this.checkpoint('ch5_exit');
      this.say('leave', CH5.leave);
    }
    if (this.done && !this.endStarted && p.x < EXIT_X1 + 4) {
      this.endStarted = true;
      this.playEnd();
    }
  }

  // ================================================================ cinematics
  protected intro(): void {
    const { cinematic, hud, state, player, camera, audio } = this.ctx;
    const cp = this.checkpoints.ch5_start;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('explore', 4);
    const seq: Sequence = {
      id: 'ch5_intro',
      duration: 9,
      skippable: true,
      letterbox: true,
      blendIn: 0,
      dof: true,
      blendOut: 1.4,
      shots: [{ t0: 0, t1: 9, path: [v(0.6, 0.9, 6.5), v(0.3, 1.2, 4.6)], look: [v(0, 1.0, 0.5), v(0, 1.3, 0.6)], fov: [42, 38], ease: 'inOut', sway: 0.02 }],
      events: [
        { t: 0.6, run: (skip) => !skip && hud.chapterCard(this.numberLabel, this.title, 5), onSkip: false },
        {
          t: 8.9,
          run: () => {
            state.progress.setFlag('ch5_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.15);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playRecording(): void {
    const { cinematic, dialogue, player, camera, audio, state, events, interaction } = this.ctx;
    interaction.get('recorder')!.enabled = false;
    const total = this.ctx.dialogue.totalDuration(CH5.recording) + 2;
    const breakT = total + 1;
    const seq: Sequence = {
      id: 'ch5_recording',
      duration: breakT + 26,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.4,
      shots: [
        { t0: 0, t1: 14, path: [v(-3.2, 1.25, 23.2), v(-3.3, 1.2, 23.5)], look: [v(-4.6, 1.05, 24.4)], fov: [34, 30], ease: 'linear', sway: 0.01 },
        { t0: 14, t1: total * 0.55, path: [v(-1.2, 1.7, 21.6), v(-1.6, 1.65, 22.2)], look: [() => player.avatar.bones.head!.getWorldPosition(new THREE.Vector3())], fov: [30, 28], ease: 'linear', sway: 0.01 },
        { t0: total * 0.55, t1: breakT, path: [v(2.2, 1.6, 16.5), v(1.8, 1.6, 17.2)], look: [v(-4, 1.2, 24), v(-4, 1.3, 24)], fov: [40, 36], ease: 'linear', sway: 0.01 },
        { t0: breakT, t1: breakT + 26, path: [v(-2.6, 1.7, 18.2), v(-2.4, 1.7, 18.6)], look: [() => this.corwin.head(new THREE.Vector3())], fov: [34, 32], ease: 'linear', sway: 0.012 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(-3.9, 0, 23.1), -0.9);
            this.scripted(true, 'IDLE');
            audio.music.setMood('silent', 2);
            this.recordingPlayed = true;
            state.progress.collectibles.add('ch5_recording');
            events.emit('collectible:found', { id: 'ch5_recording', title: "Marta's Recording — 1979" });
          },
        },
        { t: 1.5, run: () => dialogue.sayOnce('ch5:recording', CH5.recording, true) },
        {
          t: total * 0.6,
          run: () => {
            this.corwin.visible = true;
            this.corwin.place(v(6.4, 0, 20.2), -Math.PI / 2);
            this.corwin.walkTo([v(2.2, 0, 19.6)], { speed: 1.0, onArrive: () => this.corwin.lookAt(v(-4.6, 1, 24.4)) });
          },
        },
        { t: total * 0.8, run: () => audio.music.setMood('wonder', 6) },
        {
          t: breakT,
          run: () => {
            player.yaw = Math.PI * 0.6;
            this.corwin.lookAt(player.position);
            dialogue.sayOnce('ch5:corwinBreaks', CH5.corwinBreaks, true);
          },
        },
        {
          t: breakT + 25.9,
          run: () => {
            this.scripted(false);
            this.corwin.followRoute([v(0, 0, 14), v(0, 0, 26), v(0, 0, 33)], () => this.ctx.player.position, 2.5);
            camera.snap(player, Math.PI * 0.95, 0.15);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 1.5, [...CH5.recording, ...CH5.corwinBreaks]));
  }

  private playDace(): void {
    const { cinematic, dialogue, player, camera, audio } = this.ctx;
    this.daceDone = true;
    const seq: Sequence = {
      id: 'ch5_dace',
      duration: 46,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.4,
      shots: [
        // The hall revealed: noon light down the shaft onto the Lens; Dace at the dais.
        { t0: 0, t1: 8, path: [v(-5, 2.2, 35), v(-3, 3.4, 38)], look: [v(0, 2.5, 48), v(0, 1.8, 48)], fov: [50, 44], ease: 'inOut', sway: 0.02, focus: 13 },
        { t0: 8, t1: 17, path: [v(2.9, 1.8, 45.0), v(2.6, 1.75, 45.4)], look: [() => this.dace.head(new THREE.Vector3())], fov: [36, 34], ease: 'linear', sway: 0.015 },
        // Corwin goes for him; the Lens skids away; Dace into the spill channel.
        { t0: 17, t1: 27, path: [v(-4, 2.4, 40), v(-2, 2.6, 41)], look: [v(3, 1, 46), v(8, 0.5, 40)], fov: [46, 50], ease: 'inOut', sway: 0.05 },
        // Toby on his rope.
        { t0: 27, t1: 46, path: [v(-1.8, 3.2, 51), v(-1.4, 3.6, 51.6)], look: [() => this.toby.head(new THREE.Vector3())], fov: [40, 38], ease: 'linear', sway: 0.02 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(-1.2, 0, 37), 0.2);
            this.scripted(true, 'IDLE');
            this.corwin.followRoute(null);
            this.corwin.place(v(-2.6, 0, 36.2), 0.2);
            this.dace.visible = true;
            this.dace.place(v(1.2, 0.4, 47.2), 2.54);
            audio.music.setMood('tension', 2);
          },
        },
        { t: 2.0, run: () => dialogue.sayOnce('ch5:dace', CH5.dace, true) },
        {
          t: 9.5,
          run: () => {
            this.dace.setPose('INTERACT');
            this.lensState = 'floor';
          },
        },
        {
          t: 10.5,
          run: (s) => {
            // He lifts it: the Lens in his hand, the mountain lurches.
            this.lens.removeFromParent();
            const hand = this.dace.avatar.bones.handR;
            if (hand) {
              hand.add(this.lens);
              const sc = 1 / Math.max(1e-3, hand.getWorldScale(new THREE.Vector3()).x);
              this.lens.scale.setScalar(sc);
              this.lens.position.set(0, 0.1 * sc, 0);
            }
            if (!s) {
              audio.sfx.rumble(6, v(0, 4, 48), 1);
              camera.addTrauma(0.6);
            }
            this.water.visible = true;
            this.timer = -1;
          },
        },
        { t: 17.5, run: () => this.corwin.walkTo([v(1.0, 0.4, 46)], { speed: 5 }) },
        {
          t: 19.0,
          run: (s) => {
            // The tackle: the Lens skids across the floor; Dace staggers into the spill channel.
            this.lensState = 'floor';
            this.applyLens();
            if (!s) {
              audio.sfx.impact(v(1, 0.5, 46), 0.9);
              camera.addTrauma(0.4);
            }
            this.dace.walkTo([v(8, 0, 42), v(13.5, -0.4, 37.5)], { speed: 4.2 });
          },
        },
        {
          t: 22.5,
          run: (s) => {
            if (!s) this.bursts.emit(v(13.5, 0, 37.5), 40, v(1, 0.2, 1), v(0, 3, 0), 1.2, 2.5);
            this.dace.visible = false;
          },
        },
        {
          t: 24,
          run: () => {
            this.toby.visible = true;
            this.tobyRope.visible = true;
            this.corwin.walkTo([v(-12, 0, 51.2)], { speed: 3.5, onArrive: () => this.corwin.lookAt(v(0, 1, 48)) });
          },
        },
        {
          t: 45.9,
          run: () => {
            this.scripted(false);
            this.ctx.reachCheckpoint('ch5_sanctum');
            this.timer = TIME_LIMIT;
            this.waterY = -0.2;
            this.ctx.hud.toast('The Sunlock is failing', 'Re-seat the Lens before the sanctum floods', 5);
            camera.snap(player, 0.6, 0.18);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 2.0, CH5.dace));
  }

  private playSettled(): void {
    const { cinematic, dialogue, player, camera, audio } = this.ctx;
    const seq: Sequence = {
      id: 'ch5_settled',
      duration: 24,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.5,
      shots: [
        { t0: 0, t1: 10, path: [v(0, 1.0, 40.5), v(0, 3.0, 42)], look: [v(0, 2, 48), v(0, 9, 48)], fov: [46, 52], ease: 'inOut', sway: 0.015, focus: 7 },
        { t0: 10, t1: 24, path: [v(-3.5, 2.0, 44), v(-3.0, 2.2, 44.6)], look: [() => this.toby.head(new THREE.Vector3())], fov: [40, 38], ease: 'linear', sway: 0.015 },
      ],
      events: [
        { t: 0.1, run: () => this.scripted(true) },
        { t: 0.3, run: () => audio.music.setMood('wonder', 2) },
        { t: 0.6, run: (s) => !s && audio.sfx.rumble(3, v(0, 6, 48), 0.6), onSkip: false },
        { t: 2, run: () => dialogue.sayOnce('ch5:solved', CH5.solved, true) },
        {
          t: 23.9,
          run: () => {
            this.scripted(false);
            this.toby.visible = false;
            this.tobyRope.visible = false;
            // Toby is lowered off-screen and joins Corwin by the east door.
            this.corwin.place(v(-14.2, 0, 42.6), -Math.PI / 2);
            this.toby.groundSnap = true;
            this.toby.rig = null;
            this.toby.visible = true;
            this.toby.place(v(-14.2, 0, 40.4), -Math.PI / 2);
            camera.snap(player, -Math.PI / 2, 0.15);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 2.0, CH5.solved));
  }

  private playEnd(): void {
    const { cinematic, dialogue, player, audio, completeChapter } = this.ctx;
    const seq: Sequence = {
      id: 'ch5_end',
      duration: 16,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1,
      shots: [{ t0: 0, t1: 16, path: [v(EXIT_X1 + 6, 1.4, 41.5), v(EXIT_X1 + 4, 1.5, 41.5)], look: [v(EXIT_X1, 1.5, 41.5)], fov: [46, 40], ease: 'inOut', sway: 0.02, focus: 4 }],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(EXIT_X1 + 2.2, 0, 41.2), -Math.PI / 2);
            this.scripted(true);
            this.toby.followRoute(null);
            this.corwin.followRoute(null);
            this.toby.place(v(EXIT_X1 + 3.4, 0, 42.2), -Math.PI / 2);
            this.corwin.place(v(EXIT_X1 + 4.4, 0, 40.8), -Math.PI / 2);
            audio.music.setMood('wonder', 3);
          },
        },
        { t: 1.2, run: () => dialogue.sayOnce('ch5:ending', CH5.ending, true) },
        { t: 14, run: () => completeChapter() },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 1.2, CH5.ending));
  }

  // ================================================================ misc
  objective(): string {
    if (this.done) return 'Leave through the flooded lower passage.';
    if (this.daceDone) {
      const t = Math.max(0, Math.ceil(this.timer));
      const left = this.timer > 0 ? ` (${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')})` : '';
      if (this.lensState === 'floor') return `Recover the Lens${left}.`;
      if (this.lensState === 'carried') return `Seat the Lens in the Sunlock${left}.`;
      return `Turn the mirrors — send each beam to its house. Call to Toby for the high mirror${left}.`;
    }
    if (this.recordingPlayed) return 'Go into the sanctum.';
    if (this.cpIndex() >= 1) return "Search the antechamber for Marta's recorder.";
    return 'Follow the flooded passage.';
  }

  objectiveTarget(): THREE.Vector3 | null {
    if (this.done) return v(EXIT_X1 + 2, 0, 41.5);
    if (this.daceDone) return this.lensState === 'floor' ? LENS_FLOOR.clone() : v(0, 0, 48);
    if (this.recordingPlayed) return v(0, 0, 34);
    return v(-4.6, 0, 24.4);
  }

  protected mapBounds = { minX: -48, maxX: 18, minZ: -3, maxZ: 66 };

  protected mapHeight(): number {
    return 0;
  }

  protected mapColor(x: number, z: number): [number, number, number] {
    const S = SANCTUM;
    if ((Math.abs(x) < 2 && z > -1 && z < 14) || (x < S.x0 && x > EXIT_X1 && z > 39.6 && z < 43.4)) return [60, 86, 96];
    if ((Math.abs(x) < 6 && z > 14 && z < 26) || (Math.abs(x) < 1.6 && z > 26 && z < 32) || (x > S.x0 && x < S.x1 && z > S.z0 && z < S.z1)) return [120, 110, 92];
    return [20, 20, 20];
  }

  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    out.position.set(Math.sin(t * 0.1) * 6, 3, 38);
    out.look.set(0, 3, 48);
  }

  heroFrames(): HeroFrame[] {
    const p = this.ctx.player;
    const stand = (x: number, y: number, z: number, yaw: number) => p.teleport(v(x, y, z), yaw);
    const sanctum = (seated: boolean) => {
      this.recordingPlayed = true;
      this.daceDone = true;
      this.dace.visible = false;
      this.toby.visible = true;
      this.tobyRope.visible = true;
      this.corwin.visible = true;
      this.corwin.followRoute(null);
      this.corwin.place(v(-12, 0, 51.2), Math.PI * 0.85);
      this.lensState = seated ? 'seated' : 'floor';
      this.applyLens();
      this.water.visible = true;
      this.waterY = 0.1;
    };
    return [
      { name: 'flooded-passage', cp: 'ch5_start', cam: [0.7, 1.3, 9.5], look: [0, 1.1, 2], prep: () => stand(0, 0, 4.2, Math.PI) },
      { name: 'antechamber', cp: 'ch5_antechamber', cam: [3.6, 1.8, 15.6], look: [-4.6, 1.0, 24.4], prep: () => stand(-3.4, 0.1, 22.6, -0.7) },
      { name: 'recorder', cp: 'ch5_antechamber', cam: [-3.2, 1.3, 23.1], look: [-4.6, 1.0, 24.4], prep: () => stand(-3.9, 0.1, 23.1, -0.9) },
      { name: 'sanctum-reveal', cp: 'ch5_sanctum', cam: [-7.4, 2.4, 35.8], look: [0, 3.2, 48], prep: () => { stand(-1.2, 0, 37, 0.2); this.dace.visible = true; } },
      { name: 'dace-lens', cp: 'ch5_sanctum', cam: [2.9, 1.8, 45.0], look: [1.2, 1.4, 47.2], prep: () => { stand(-1.2, 0, 37, 0.2); this.dace.visible = true; this.dace.place(v(1.2, 0.4, 47.2), 2.54, 'INTERACT'); }, settle: 2 },
      { name: 'beams-three', cp: 'ch5_sanctum', cam: [-13, 6, 37], look: [0, 1, 54], prep: () => { sanctum(true); stand(-6.4, 0, 46.2, 0.6); } },
      { name: 'toby-rope', cp: 'ch5_sanctum', cam: [-2.4, 4.4, 51.6], look: [0.9, 6.8, 56.6], prep: () => { sanctum(true); stand(0, 0, 52.4, 0); } },
      { name: 'flood-rising', cp: 'ch5_sanctum', cam: [12, 2.2, 36], look: [0, 0.6, 50], prep: () => { sanctum(false); this.waterY = 0.7; stand(4.6, 0.4, 41, -0.6); } },
      { name: 'exit-wade', cp: 'ch5_exit', cam: [-19, 1.6, 41.5], look: [-30, 1, 41.5], prep: () => { this.done = true; stand(-23, 0, 41.3, -Math.PI / 2); } },
    ];
  }

  debug() {
    return {
      recording: this.recordingPlayed,
      dace: this.daceDone,
      lens: this.lensState,
      angles: [...this.puzzle.angles],
      hits: this.puzzle.traces.map((t) => t.hit),
      done: this.done,
      timer: +this.timer.toFixed(1),
      water: +this.waterY.toFixed(2),
    };
  }
}
