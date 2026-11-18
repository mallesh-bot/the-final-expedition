import * as THREE from 'three';
import { waterfallMesh } from '../../world/Water';
import { buildWaterfallFX } from '../../world/WaterfallFX';
import type { CheckpointDef } from '../Chapter';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Sequence } from '../../cinematic/Sequence';
import type { BoxCollider } from '../../physics/Colliders';
import type { NpcActor } from '../../actors/NpcActor';
import { ChapterBase, type HeroFrame } from '../common/ChapterBase';
import { standardManifest, v } from '../common/LevelKit';
import { BeamPuzzle, type BeamBlocker, type BeamTrace, type MirrorDef, type ReceptorDef } from '../../puzzles/BeamPuzzle';
import * as P from '../../world/Props';
import { CH3 } from '../../story/dialogue/ch3';
import { drawGlyph, innerWallTextures, type GlyphId } from '../../render/textures/ProceduralTextures';

/*
 * CHAPTER THREE — THE HIDDEN PATH (STORY_BIBLE §14.4). Late morning, Day 2.
 * Inside the mountain: the sun-shaft corridor (A) → Hall of the Rising House (one mirror) →
 * passage with fresh boot prints and a drilled charge-hole (B) → Hall of the Three Houses
 * (three mirrors; wake the houses right to left) → the inner wall opens → a balcony above the
 * central gorge, where someone's generators are running.
 * Interiors are lit only by real sunlight through apertures (ceilings cast shadows).
 */
const FLOOR = -2;
const BEAM_Y = FLOOR + 1.2;
const H1 = { x0: -8, x1: 8, z0: 16, z1: 32, ceil: 5 };
const H2 = { x0: -12, x1: 12, z0: 44, z1: 68, ceil: 7 };
const PASS = { x0: 3.6, x1: 6.8, z0: 32, z1: 44 };
const INNER_DOOR = { x0: -2, x1: 2 };

const CHECKPOINTS: Record<string, CheckpointDef> = {
  ch3_start: { pos: v(0, 0, 2), yaw: 0, label: 'The sun-shafts' },
  ch3_hall1: { pos: v(0, FLOOR, 17.5), yaw: 0, label: 'The Rising House' },
  ch3_passage: { pos: v(5.2, FLOOR, 33.5), yaw: 0, label: 'The passage' },
  ch3_hall2: { pos: v(5.2, FLOOR, 46.2), yaw: -0.6, label: 'The Hall of the Three Houses' },
  ch3_exit: { pos: v(0, FLOOR, 70), yaw: 0, label: 'The inner wall' },
};

/** Companion route (corridor centrelines) Toby follows Ines along. */
const ROUTE = [v(0, 0, 1), v(0, 0, 9.5), v(0, FLOOR, 14.5), v(0, FLOOR, 22), v(5.2, FLOOR, 30), v(5.2, FLOOR, 44.5), v(3, FLOOR, 52), v(0, FLOOR, 62), v(0, FLOOR, 70), v(0, FLOOR, 81)];

interface WorldSave {
  toby: boolean;
  exitOpen: boolean;
}

export default class Chapter3 extends ChapterBase {
  readonly id = 3;
  readonly title = 'THE HIDDEN PATH';
  readonly numberLabel = 'CHAPTER THREE';
  readonly checkpoints = CHECKPOINTS;
  readonly firstCheckpoint = 'ch3_start';
  protected readonly checkpointOrder = ['ch3_start', 'ch3_hall1', 'ch3_passage', 'ch3_hall2', 'ch3_exit'];
  readonly manifest = standardManifest('ch3', [], { masonTint: [168, 150, 120] });
  protected kitOptions = { masonMoss: 0.35, cliffMoss: 0.4 };

  private hall1!: BeamPuzzle;
  private hall2!: BeamPuzzle;
  private door1!: THREE.Object3D;
  private door1Col!: BoxCollider;
  private door1K = 0;
  private inner!: THREE.Object3D;
  private innerCol!: BoxCollider;
  private innerK = 0;
  private exitOpen = false;
  private tobyHere = false;
  private toby!: NpcActor;
  private receptorMats = new Map<string, THREE.MeshStandardMaterial>();
  private wallGlow!: THREE.MeshStandardMaterial;
  private wallGlowK = 0;
  private hall2Lit: string[] = [];
  private endStarted = false;
  private hintTimer = 0;

  // ================================================================ build
  protected async build(step: (f: number, label: string) => Promise<void>): Promise<void> {
    const k = this.kit;
    const { world } = this.ctx;
    this.sunDir = v(0.32, 0.9, 0.28).normalize();
    this.shadowRange = 30;
    this.charLightScale = 0.75;
    await step(0.05, 'Into the mountain');
    k.atmosphere({
      sunDir: this.sunDir,
      sunColor: new THREE.Color(1.0, 0.86, 0.66),
      sunIntensity: 6.5,
      zenith: new THREE.Color(0.25, 0.36, 0.55),
      horizon: new THREE.Color(0.6, 0.58, 0.55),
      sunHorizon: new THREE.Color(1.1, 0.8, 0.55),
      skySun: new THREE.Color(1.6, 1.2, 0.9),
      ground: new THREE.Color(0.18, 0.15, 0.12),
      cloudCover: 0.3,
      skySunIntensity: 18,
      envIntensity: 0.22,
      fogColor: new THREE.Color(0.075, 0.065, 0.055),
      fogDensity: 0.022,
      fogSunColor: new THREE.Color(0.5, 0.38, 0.22),
      fogHeightBase: -4,
      fogHeightFalloff: 0.02,
      hemiSky: new THREE.Color(0.55, 0.48, 0.4),
      hemiGround: new THREE.Color(0.2, 0.15, 0.1),
      hemiIntensity: 0.22,
      wetness: 0.1,
      shadowRange: this.shadowRange,
      hideSky: true,
    });
    k.flatFloor(FLOOR, [-60, -40], 200);
    world.bounds = { minX: -14, maxX: 14, minZ: -1, maxZ: 86 };

    await step(0.15, 'Cutting the halls');
    this.buildShell();
    await step(0.45, 'Hanging the mirrors');
    this.buildHall1();
    this.buildHall2();
    await step(0.7, 'Footprints in the dust');
    this.buildPassageStory();
    this.buildExit();
    await step(0.85, 'Dust in the light');
    k.particles('dust', 360, v(0, FLOOR, 24), v(16, 7, 16), new THREE.Color(1, 0.88, 0.66), 0.08, 0.6, 31);
    k.particles('dust', 520, v(0, FLOOR, 56), v(24, 9, 24), new THREE.Color(1, 0.88, 0.66), 0.08, 0.6, 32);
    k.particles('dust', 200, v(0, 0, 7), v(4, 5, 14), new THREE.Color(1, 0.88, 0.66), 0.07, 0.5, 33);
    this.buildRunningWater();
    k.finish();
    this.ctx.traversal.load({ climbs: [], ledges: [], narrows: [], vaults: [], jumps: [] });
    this.toby = this.npc('toby', v(0, 0, -6), 0);
    this.toby.visible = false;
  }

  /** Walls, floors, ceilings (with apertures) for every space. */
  private buildShell(): void {
    const k = this.kit;
    const { world } = this.ctx;
    const wall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, gaps: [number, number][] = [], doorH?: number) =>
      k.coursedWall(x0, z0, x1, z1, y0, y1, { gaps, doorH, tint: 0.72, hue: new THREE.Color(1.0, 0.94, 0.86) });
    const ceiling = k.ceiling.bind(k);
    const floor = (x0: number, x1: number, z0: number, z1: number, y: number) => k.pavedFloor(x0, x1, z0, z1, y);
    // A — the sun-shaft corridor (floor 0) and the stair down to the halls.
    floor(-2, 2, -1, 10, 0);
    world.addBox(v(0, -0.5, 4.5), v(2, 0.5, 5.5));
    k.stair(v(0, 0, 10), v(0, FLOOR, 14), 12, 4, 0.75);
    floor(-2, 2, 14, 16, FLOOR);
    wall(-2.4, -1, -2.4, 16, FLOOR, 4);
    wall(2.4, -1, 2.4, 16, FLOOR, 4);
    ceiling(-2.4, 2.4, -1, 16, 3.6, [[-2, 2, 4.5, 7.5]]);
    // Daylight at the mouth (behind the player at the start)
    {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.1, 0.9), fog: false }));
      glow.position.set(0, 1.9, -1.6);
      k.root.add(glow);
      world.addBox(v(0, 1.5, -1.4), v(2.4, 2.5, 0.3));
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.86, 0.66), 7, 12, 2);
      l.position.set(0, 2.2, 0.2);
      k.root.add(l);
      k.shaft(v(-1.5, 5.5, 4.5), v(0.3, -0.9, 0.3), 7, 0.8, 1.6, new THREE.Color(1.0, 0.82, 0.55), 0.06);
    }

    // Hall 1 — the Rising House
    floor(H1.x0, H1.x1, H1.z0, H1.z1, FLOOR);
    wall(H1.x0, H1.z0, H1.x1, H1.z0, FLOOR, H1.ceil, [[-2.4, 2.4]], 3.4);
    wall(H1.x0, H1.z1, H1.x1, H1.z1, FLOOR, H1.ceil, [[PASS.x0, PASS.x1]], 3.0);
    wall(H1.x0, H1.z0, H1.x0, H1.z1, FLOOR, H1.ceil);
    wall(H1.x1, H1.z0, H1.x1, H1.z1, FLOOR, H1.ceil);
    ceiling(H1.x0, H1.x1, H1.z0, H1.z1, H1.ceil, [[-2, 2, 22, 26]]);
    k.shaft(v(-1.2, H1.ceil + 4, 22.5), v(0.3, -0.9, 0.3), 10, 1.2, 2.2, new THREE.Color(1.0, 0.82, 0.55), 0.05);

    // Passage B
    floor(PASS.x0, PASS.x1, PASS.z0, PASS.z1, FLOOR);
    wall(PASS.x0, PASS.z0, PASS.x0, PASS.z1, FLOOR, 2.6);
    wall(PASS.x1, PASS.z0, PASS.x1, PASS.z1, FLOOR, 2.6);
    ceiling(PASS.x0, PASS.x1, PASS.z0, PASS.z1, 2.6, [[PASS.x0, PASS.x1, 37, 38.6]]);

    // Hall 2 — the Hall of the Three Houses (north wall = the inner wall)
    floor(H2.x0, H2.x1, H2.z0, H2.z1, FLOOR);
    wall(H2.x0, H2.z0, H2.x1, H2.z0, FLOOR, H2.ceil, [[PASS.x0, PASS.x1]], 2.6);
    wall(H2.x0, H2.z1, H2.x1, H2.z1, FLOOR, H2.ceil, [[INNER_DOOR.x0, INNER_DOOR.x1]], 4.2);
    wall(H2.x0, H2.z0, H2.x0, H2.z1, FLOOR, H2.ceil);
    wall(H2.x1, H2.z0, H2.x1, H2.z1, FLOOR, H2.ceil);
    ceiling(H2.x0, H2.x1, H2.z0, H2.z1, H2.ceil, [[-10, -6, 46, 50], [-2, 2, 62, 66], [6, 10, 56, 60]]);
    for (const [x, z] of [[-8, 48], [0, 64], [8, 58]] as const) k.shaft(v(x - 1.4, H2.ceil + 5, z - 1.2), v(0.3, -0.9, 0.28), 12, 1.2, 2.3, new THREE.Color(1.0, 0.82, 0.55), 0.045);
    // Columns: stacked drums with a square abacus and base (drum joints read at a glance).
    for (const [x, z] of [[-7, 54], [7, 52], [-7, 62], [7, 64]] as const) this.column(x, z, H2.ceil);
    // Inner wall: two carved reliefs flank the door — the warning (left) and the sun's path
    // (right). Only the cut grooves glow when the three houses are awake.
    {
      const iw = innerWallTextures();
      for (const t of [iw.map, iw.normalMap, iw.mask]) this.kit.track(t);
      this.wallGlow = this.kit.track(new THREE.MeshStandardMaterial({ map: iw.map, normalMap: iw.normalMap, roughness: 0.92, color: 0xd8ccb4, emissive: new THREE.Color(1.0, 0.6, 0.26), emissiveMap: iw.mask, emissiveIntensity: 0 }));
      const left = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 6.2), this.wallGlow);
      left.position.set(6.7, FLOOR + 3.5, H2.z1 - 0.43);
      left.rotation.y = Math.PI;
      left.receiveShadow = true;
      k.root.add(left);
      const mural = this.kit.muralMat.clone();
      mural.emissive = new THREE.Color(1.0, 0.6, 0.26);
      mural.emissiveMap = iw.mask;
      this.kit.track(mural);
      this.muralGlow = mural;
      const right = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 4.3), mural);
      right.position.set(-6.7, FLOOR + 3.2, H2.z1 - 0.43);
      right.rotation.y = Math.PI;
      right.receiveShadow = true;
      k.root.add(right);
      // Hollis's ladder still leans on the wall (Marta's plate 43), with his lamp and a chalk tally.
      const ladder = new THREE.Group();
      for (const sx of [-0.25, 0.25]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.2, 0.06), k.PM.wood);
        rail.position.set(sx, 2.1, 0);
        ladder.add(rail);
      }
      for (let r = 0.3; r < 4.1; r += 0.32) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), k.PM.wood);
        rung.position.set(0, r, 0);
        ladder.add(rung);
      }
      // Foot out from the wall, top resting on the carved face.
      ladder.position.set(5.2, FLOOR, H2.z1 - 1.36);
      ladder.rotation.x = 0.21;
      k.props.add(ladder);
      k.place(P.lantern(k.PM, false), 4.6, FLOOR, H2.z1 - 1.0);
      k.place(P.crate(k.PM, 0.7, 0.45, 0.5, 'aldercott'), 8.8, FLOOR, H2.z1 - 1.2, 0.2);
      this.ctx.world.addBox(v(8.8, FLOOR + 0.23, H2.z1 - 1.2), v(0.35, 0.23, 0.25), 0.2, { surface: 'wood' });
    }
  }

  private muralGlow: THREE.MeshStandardMaterial | null = null;

  private column(x: number, z: number, height: number): void {
    const k = this.kit;
    const drum = this.drumGeo ?? (this.drumGeo = k.track(this.makeDrum()));
    k.blockAt(v(x, FLOOR + 0.3, z), v(1.6, 0.6, 1.6), 0, false, 0.9);
    let y = FLOOR + 0.6;
    while (y < FLOOR + height - 0.6) {
      const hh = Math.min(0.9 + k.rnd() * 0.3, FLOOR + height - 0.6 - y);
      k.masonBatch.add(drum, v(x, y + hh / 2, z), v(1, hh, 1), k.rnd() * 6, 0.86 + k.rnd() * 0.12);
      y += hh;
    }
    k.masonBatch.add(k.ashlar, v(x, FLOOR + height - 0.3, z), v(1.5, 0.6, 1.5), 0, 0.95);
    this.ctx.world.addCylinder(v(x, FLOOR + height / 2, z), 0.55, height / 2);
  }
  private drumGeo: THREE.BufferGeometry | null = null;

  private makeDrum(): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(0.5, 0.52, 1, 14, 1).toNonIndexed();
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.92), 3));
    g.computeVertexNormals();
    return g;
  }

  private receptor(id: string, glyph: GlyphId, pos: THREE.Vector3, yaw: number): ReceptorDef {
    const k = this.kit;
    const tex = glyphDiscTexture(glyph);
    k.track(tex);
    const mat = k.track(new THREE.MeshStandardMaterial({ map: tex, color: 0xb08a50, metalness: 0.7, roughness: 0.4, emissive: new THREE.Color(1.0, 0.7, 0.3), emissiveMap: tex, emissiveIntensity: 0 }));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 28).rotateX(Math.PI / 2), mat);
    disc.position.copy(pos);
    disc.rotation.y = yaw;
    k.root.add(disc);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 28), k.PM.bronze);
    frame.position.copy(pos);
    frame.rotation.y = yaw;
    k.root.add(frame);
    {
      const nx = Math.sin(yaw);
      const nz = Math.cos(yaw);
      k.blockAt(v(pos.x - nx * 0.21, pos.y, pos.z - nz * 0.21), v(1.7, 1.7, 0.34), yaw, false, 0.8);
    }
    this.receptorMats.set(id, mat);
    return { id, pos: pos.clone(), radius: 0.5 };
  }

  private mirror(id: string, pos: THREE.Vector3, initial: number): MirrorDef {
    const k = this.kit;
    k.blockAt(v(pos.x, FLOOR + 0.35, pos.z), v(0.9, 0.7, 0.9), 0, true, 0.95);
    const pivot = new THREE.Group();
    pivot.position.copy(pos);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8b070, metalness: 1, roughness: 0.12, envMapIntensity: 1.5 }));
    disc.castShadow = true;
    pivot.add(disc);
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 6, 24, Math.PI), k.PM.bronze);
    yoke.rotation.z = Math.PI;
    pivot.add(yoke);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 8), k.PM.bronze);
    post.position.y = -0.55;
    pivot.add(post);
    k.root.add(pivot);
    return { id, pos: pos.clone(), initial, object: pivot, halfWidth: 0.6 };
  }

  /** The beam stops at the hall's walls. */
  private hallBlockers(h: { x0: number; x1: number; z0: number; z1: number }): BeamBlocker[] {
    const t = 0.35;
    return [
      { minX: h.x0 - 5, maxX: h.x0 + t, minZ: h.z0 - 5, maxZ: h.z1 + 5 },
      { minX: h.x1 - t, maxX: h.x1 + 5, minZ: h.z0 - 5, maxZ: h.z1 + 5 },
      { minX: h.x0 - 5, maxX: h.x1 + 5, minZ: h.z0 - 5, maxZ: h.z0 + t },
      { minX: h.x0 - 5, maxX: h.x1 + 5, minZ: h.z1 - t, maxZ: h.z1 + 5 },
    ];
  }

  private sunSlit(x: number, z: number, dirX: number): void {
    const k = this.kit;
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.5, 1.8), fog: false }));
    slit.position.set(x - dirX * 0.05, BEAM_Y, z);
    slit.rotation.y = dirX < 0 ? -Math.PI / 2 : Math.PI / 2;
    k.root.add(slit);
    // The sun-slit: a framed opening through the wall with daylight pouring out of it.
    const fx = x - dirX * 0.02;
    k.blockAt(v(fx, BEAM_Y + 0.5, z), v(0.3, 0.3, 1.5), 0, false, 1.0);
    k.blockAt(v(fx, BEAM_Y - 0.5, z), v(0.3, 0.3, 1.5), 0, false, 1.0);
    for (const dz of [-0.6, 0.6]) k.blockAt(v(fx, BEAM_Y, z + dz), v(0.3, 0.7, 0.3), 0, false, 1.0);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: this.kit.texture('tex.mist'), color: new THREE.Color(1.6, 1.25, 0.8), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.set(x - dirX * 0.22, BEAM_Y, z);
    halo.rotation.y = slit.rotation.y;
    k.root.add(halo);
    const glow = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.6), 5, 7, 2);
    glow.position.set(x - dirX * 0.7, BEAM_Y, z);
    k.root.add(glow);
  }

  private buildHall1(): void {
    const k = this.kit;
    const m1 = this.mirror('h1m1', v(0, BEAM_Y, 20), 3);
    const r = this.receptor('rising1', 'rising', v(0, BEAM_Y, H1.z1 - 0.48), Math.PI);
    this.sunSlit(H1.x1 - 0.35, 20, -1);
    this.hall1 = new BeamPuzzle('ch3_hall1', [m1], [r], [{ pos: v(H1.x1 - 0.4, BEAM_Y, 20), dir: v(-1, 0, 0), enabled: true }], this.hallBlockers(H1));
    k.root.add(this.hall1.group);
    // The door into the passage (slides down into the floor once the house wakes).
    const door = new THREE.Mesh(k.block, k.masonMat);
    door.scale.set(PASS.x1 - PASS.x0, 3.0, 0.5);
    door.position.set((PASS.x0 + PASS.x1) / 2, FLOOR + 1.5, H1.z1);
    door.castShadow = true;
    k.root.add(door);
    this.door1 = door;
    this.door1Col = this.ctx.world.addBox(door.position, v((PASS.x1 - PASS.x0) / 2, 1.5, 0.3), 0, { dynamic: true });
    // Bench with Varne's notebook
    k.blockAt(v(-6.2, FLOOR + 0.25, 28.5), v(1.6, 0.5, 0.7), 0, true, 0.9);
    const nb = P.paperPage(k.PM);
    nb.scale.set(1.2, 1, 0.8);
    nb.position.set(-6.2, FLOOR + 0.52, 28.5);
    nb.rotation.y = 0.3;
    this.pickup('ch3_varne_notebook', nb, CH3.notebook);
  }

  private buildHall2(): void {
    const k = this.kit;
    const mirrors = [this.mirror('h2m1', v(0, BEAM_Y, 48), 3), this.mirror('h2m2', v(0, BEAM_Y, 58), 1), this.mirror('h2m3', v(-6, BEAM_Y, 58), 3)];
    const receptors = [
      this.receptor('rising', 'rising', v(H2.x0 + 0.48, BEAM_Y, 48), Math.PI / 2),
      this.receptor('eye', 'eye', v(0, BEAM_Y, H2.z1 - 0.2), Math.PI),
      this.receptor('setting', 'setting', v(H2.x1 - 0.48, BEAM_Y, 58), -Math.PI / 2),
      this.receptor('serpent', 'serpent', v(-6, BEAM_Y, H2.z0 + 0.48), 0),
    ];
    this.sunSlit(H2.x1 - 0.35, 48, -1);
    this.hall2 = new BeamPuzzle('ch3_hall2', mirrors, receptors, [{ pos: v(H2.x1 - 0.4, BEAM_Y, 48), dir: v(-1, 0, 0), enabled: true }], this.hallBlockers(H2));
    k.root.add(this.hall2.group);
    // The inner-wall door (the Open Eye disc is set into it).
    const inner = new THREE.Group();
    const slab = new THREE.Mesh(k.block, k.masonMat);
    slab.scale.set(INNER_DOOR.x1 - INNER_DOOR.x0 + 0.2, 4.2, 0.6);
    slab.castShadow = true;
    inner.add(slab);
    inner.position.set(0, FLOOR + 2.1, H2.z1 + 0.15);
    k.root.add(inner);
    this.inner = inner;
    this.innerCol = this.ctx.world.addBox(inner.position, v((INNER_DOOR.x1 - INNER_DOOR.x0) / 2 + 0.1, 2.1, 0.35), 0, { dynamic: true });
    // Broken mirror in the corner + the light-glass relic
    k.blockAt(v(-10.4, FLOOR + 0.35, 66), v(0.9, 0.7, 0.9), 0, true, 0.8);
    const shard = new THREE.Mesh(new THREE.CircleGeometry(0.35, 5), new THREE.MeshStandardMaterial({ color: 0xc8a060, metalness: 1, roughness: 0.2 }));
    shard.position.set(-10.0, FLOOR + 0.03, 64.8);
    shard.rotation.set(-Math.PI / 2, 0, 0.6);
    k.props.add(shard);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.6 }));
    glass.position.set(-10.4, FLOOR + 0.76, 66);
    glass.scale.y = 0.55;
    this.pickup('ch3_relic_lightglass', glass, CH3.lightglass, { prompt: 'Pick up' });
  }

  private buildPassageStory(): void {
    const k = this.kit;
    // Boot prints in the dust (two people, heading north), from Hall 1's door to Hall 2.
    const prints = bootPrintTexture();
    k.track(prints);
    const mat = k.track(new THREE.MeshStandardMaterial({ map: prints, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1, color: 0x2a221a }));
    for (let i = 0; i < 26; i++) {
      for (const [lane, phase] of [[4.6, 0], [5.8, 0.4]] as const) {
        const z = PASS.z0 - 4 + i * 0.75 + phase;
        if (z > PASS.z1 + 6) continue;
        const left = i % 2 === 0;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.3), mat);
        m.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.15);
        m.position.set(lane + (left ? -0.13 : 0.13), FLOOR + 0.012, z);
        k.props.add(m);
      }
    }
    // Drill hole + survey tag on the east wall
    {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: 0x050403 }));
      hole.position.set(PASS.x0 + 0.42, FLOOR + 1.0, 38.2);
      hole.rotation.y = Math.PI / 2;
      k.root.add(hole);
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), k.PM.darkMetal);
      stake.rotation.z = Math.PI / 2;
      stake.position.set(PASS.x0 + 0.55, FLOOR + 0.82, 38.2);
      k.root.add(stake);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x401400 }));
      tag.position.set(PASS.x0 + 0.62, FLOOR + 0.78, 38.2);
      tag.rotation.set(0, Math.PI / 2, 0.3);
      this.pickup('ch3_survey_tag', tag, undefined, { prompt: 'Examine the tag' });
      // Dust fan under the hole
      const dust = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshStandardMaterial({ color: 0x9a8a74, alphaMap: k.texture('tex.dot'), transparent: true, opacity: 0.55, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
      dust.rotation.x = -Math.PI / 2;
      dust.position.set(PASS.x0 + 0.6, FLOOR + 0.01, 38.2);
      k.root.add(dust);
    }
    // Marta's page tucked in a wall niche on the west side
    k.blockAt(v(PASS.x1 - 0.2, FLOOR + 1.0, 41.2), v(0.5, 0.12, 0.8), 0, false, 1.0);
    const page = P.paperPage(k.PM);
    page.position.set(PASS.x1 - 0.32, FLOOR + 1.08, 41.2);
    page.rotation.y = -Math.PI / 2 + 0.2;
    this.pickup('ch3_journal_mirrors', page, CH3.journal);
    // A modern carabiner and torn tape left on the floor
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.05), new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.6, side: THREE.DoubleSide }));
    tape.rotation.set(-Math.PI / 2, 0, 0.7);
    tape.position.set(5.9, FLOOR + 0.02, 42.6);
    k.props.add(tape);
  }

  /** Old drainage still working: a spout in the wall feeding a stone gutter along each hall. */
  private buildRunningWater(): void {
    const k = this.kit;
    const gutter = (x: number, z0: number, z1: number, wallSide: number) => {
      const len = z1 - z0;
      const zc = (z0 + z1) / 2;
      k.darkBatch.add(k.block, v(x, FLOOR + 0.005, zc), v(0.72, 0.03, len), 0, 0.35);
      for (const e of [-0.42, 0.42]) k.masonBatch.add(k.block, v(x + e, FLOOR + 0.03, zc), v(0.12, 0.08, len), 0, 0.75);
      k.waterPlane(x, FLOOR + 0.05, zc, 0.72, len);
      const spoutY = FLOOR + 1.5;
      k.blockAt(v(x + wallSide * 0.36, spoutY + 0.08, z0 + 0.3), v(0.5, 0.16, 0.34), 0, false, 0.8);
      // The water leaves the spout lip and drops straight into the gutter below it.
      k.root.add(waterfallMesh(v(x + wallSide * 0.2, spoutY + 0.02, z0 + 0.3), v(x + wallSide * 0.2, FLOOR + 0.06, z0 + 0.3), 0.16, v(-wallSide, 0, 0), k.waterMat, 0.12));
      k.particles('spray', 14, v(x, FLOOR + 0.12, z0 + 0.3), v(0.45, 0.25, 0.45), new THREE.Color(0.95, 0.97, 1), 0.07, 0.5, 71 + Math.round(x), 'tex.mist');
    };
    gutter(H1.x1 - 0.55, H1.z0 + 0.6, H1.z1 - 0.6, 1);
    gutter(H2.x0 + 0.55, H2.z0 + 0.8, H2.z1 - 1.2, -1);
  }

  private buildExit(): void {
    const k = this.kit;
    const { world } = this.ctx;
    // Corridor beyond the inner wall to a balcony above the central gorge.
    k.masonBatch.add(k.plate, v(0, FLOOR - 0.3, 75), v(4, 0.6, 14), 0, 0.7);
    for (const x of [-2.4, 2.4]) k.blockAt(v(x, FLOOR + 1.6, 74.5), v(0.8, 3.2, 13), 0, true, 0.75, { dark: true });
    k.darkBatch.add(k.block, v(0, FLOOR + 3.6, 74.5), v(5.6, 0.8, 13), 0, 0.55);
    // Balcony (open air), parapet, the gorge beyond.
    world.addBox(v(0, FLOOR - 0.5, 83), v(4, 0.5, 2.5));
    k.masonBatch.add(k.plate, v(0, FLOOR - 0.3, 83), v(8, 0.6, 5), 0, 0.8);
    for (let x = -3.6; x <= 3.6; x += 0.8) k.blockAt(v(x, FLOOR + 0.45, 85.3), v(0.45, 0.9, 0.5), 0, false, 0.85);
    world.addBox(v(0, FLOOR + 0.6, 85.3), v(4, 0.6, 0.3), 0, { blocksCamera: false });
    // Stone balustrade down both sides (the balcony's collision edge, now visible).
    for (const sx of [-3.75, 3.75]) {
      for (let z = 80.9; z <= 85; z += 0.8) k.blockAt(v(sx, FLOOR + 0.45, z), v(0.5, 0.9, 0.45), 0, false, 0.85);
      world.addBox(v(sx, FLOOR + 0.6, 83), v(0.3, 0.6, 2.5), 0, { blocksCamera: false });
    }
    // The gorge's water: two falls off the far walls feeding the river under the great bridge.
    k.waterfall(v(-13, 6, 199.4), v(-13, -70, 196), 11, v(0, 0, -1), -72, buildWaterfallFX);
    k.waterfall(v(11.8, 10, 142), v(9, -70, 142), 6, v(-1, 0, 0), -72, buildWaterfallFX);
    k.waterPlane(0, -72, 150, 34, 110);
    // Vista: the central gorge in afternoon haze, the great bridge, floodlit camp below.
    k.cliffBox(v(-40, -40, 150), v(28, 60, 50), ['+x'], { scale: 2.2, collide: false });
    k.cliffBox(v(40, -40, 150), v(28, 60, 50), ['-x'], { scale: 2.2, collide: false });
    k.cliffBox(v(0, -30, 210), v(60, 70, 10), ['-z'], { scale: 2.6, collide: false });
    k.cliffBox(v(-26, -15, 96), v(22, 30, 10), ['+z', '+x'], { scale: 1.8, collide: false });
    k.cliffBox(v(26, -15, 96), v(22, 30, 10), ['+z', '-x'], { scale: 1.8, collide: false });
    const bridge = new THREE.Group();
    for (let z = 118; z < 190; z += 6) {
      const pier = new THREE.Mesh(k.block, k.masonMat);
      pier.scale.set(4, 1.2, 6.05);
      pier.position.set(0, -42, z);
      bridge.add(pier);
      if ((z - 118) % 12 === 0) {
        const arch = new THREE.Mesh(k.block, k.masonMat);
        arch.scale.set(3, 30, 2.4);
        arch.position.set(0, -58, z);
        bridge.add(arch);
      }
    }
    k.root.add(bridge);
    for (const [x, y, z] of [[-3, -40, 120], [3, -40, 126], [-2, -39.5, 134], [8, -46, 116]] as const) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.6), 30, 30, 2);
      l.position.set(x, y + 2, z);
      k.root.add(l);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.4) }));
      bulb.position.set(x, y + 2, z);
      k.root.add(bulb);
    }
    k.particles('mist', 40, v(0, -60, 150), v(70, 30, 90), new THREE.Color(0.8, 0.76, 0.7), 90, 0.25, 34, 'tex.mist');
    const sunOut = new THREE.DirectionalLight(new THREE.Color(1.0, 0.84, 0.64), 1.2);
    sunOut.position.set(30, 40, 140);
    sunOut.target.position.set(0, -40, 150);
    k.root.add(sunOut, sunOut.target);
  }

  // ================================================================ setup
  protected setup(): void {
    const { interaction, player, state, audio } = this.ctx;
    for (const pz of [this.hall1, this.hall2]) {
      state.register(pz);
      this.disposers.push(() => state.unregister(pz.key));
      pz.onTurnStart = (i) => audio.sfx.stoneGrind(pz.turnTime, pz.mirrors[i].pos, 0.35);
      pz.onTurnEnd = (i) => audio.sfx.clunk(pz.mirrors[i].pos, 0.35);
    }
    this.disposers.push(() => {
      this.hall1.dispose();
      this.hall2.dispose();
    });
    this.hall1.onTraced = (tr) => this.onHall1(tr);
    this.hall2.onTraced = (tr) => this.onHall2(tr);
    this.hall2.restoreExtra = (x) => {
      this.hall2Lit = Array.isArray(x) ? [...(x as string[])] : [];
    };
    for (const [pz, prefix] of [[this.hall1, 'h1'], [this.hall2, 'h2']] as const) {
      pz.mirrors.forEach((m, i) => {
        interaction.add({
          id: `${prefix}:mirror:${i}`,
          position: m.pos.clone(),
          radius: 1.7,
          prompt: 'Turn the mirror',
          enabled: true,
          facing: 0.2,
          onInteract: () => {
            if (pz.solved || pz.busy) return;
            player.playAction('PUSH', m.pos, 0.9);
            this.after(0.3, () => pz.turn(i, 1));
          },
        });
      });
    }
    this.examine('drill', v(PASS.x0 + 0.5, FLOOR + 1, 38.2), CH3.drillSolo, { prompt: 'Examine the hole', radius: 1.6, once: true });
    this.ctx.camera.hints = [
      { id: 'corridor', center: v(0, 0, 6), radius: 6, distance: 3.2, fovAdd: -2 },
      { id: 'hall1', center: v(0, FLOOR, 24), radius: 9, distance: 4.0, heightAdd: 0.3, fovAdd: 4 },
      { id: 'passage', center: v(5.2, FLOOR, 38), radius: 6, distance: 3.0, fovAdd: -2 },
      { id: 'hall2', center: v(0, FLOOR, 56), radius: 13, distance: 4.5, heightAdd: 0.4, fovAdd: 6 },
      { id: 'balcony', center: v(0, FLOOR, 83), radius: 4, distance: 4.0, fovAdd: 6 },
    ];
  }

  private onHall1(tr: BeamTrace[]): void {
    const lit = tr.some((t) => t.hit === 'rising1');
    this.receptorMats.get('rising1')!.emissiveIntensity = lit ? 2.2 : 0;
    if (lit && !this.hall1.solved) {
      this.hall1.markSolved();
      this.ctx.state.progress.completedPuzzles.add('ch3_hall1');
      this.ctx.events.emit('puzzle:solved', { id: 'ch3_hall1' });
      this.ctx.audio.sfx.rumble(2.5, this.door1.position, 0.6);
      this.say('hall1Solved', CH3.hall1Solved);
      this.setMood('wonder');
      this.after(4, () => this.tobyEnters());
    }
  }

  private onHall2(tr: BeamTrace[]): void {
    const hit = tr[0]?.hit ?? null;
    const order = ['rising', 'eye', 'setting'];
    if (!this.hall2.solved && hit) {
      if (hit === 'serpent') {
        if (this.hall2Lit.length) this.ctx.audio.sfx.rumble(1.2, v(-6, FLOOR, 45), 0.5);
        this.hall2Lit = [];
        this.ctx.dialogue.say(this.tobyHere ? CH3.serpent : [{ speaker: 'INES', text: 'The water-sign. Everything went dark.' }], true);
      } else if (!this.hall2Lit.includes(hit)) {
        if (hit === order[this.hall2Lit.length]) {
          this.hall2Lit.push(hit);
          this.ctx.audio.sfx.checkpoint();
          if (this.tobyHere) this.ctx.dialogue.say(CH3.lit[this.hall2Lit.length - 1], true);
        } else {
          if (this.hall2Lit.length) this.ctx.audio.sfx.rumble(1.2, v(0, FLOOR, 60), 0.4);
          this.hall2Lit = [];
          this.ctx.dialogue.say(this.tobyHere ? CH3.wrongOrder : [{ speaker: 'INES', text: 'Wrong house. It went dark. Right hand first.' }], true);
        }
      }
      this.hall2.extra = [...this.hall2Lit];
      if (this.hall2Lit.length === 3) {
        this.hall2.markSolved();
        this.ctx.state.progress.completedPuzzles.add('ch3_hall2');
        this.ctx.events.emit('puzzle:solved', { id: 'ch3_hall2' });
        this.after(1.5, () => this.playInnerWall());
      }
    }
    this.applyReceptors(hit);
  }

  private applyReceptors(current: string | null): void {
    for (const [id, m] of this.receptorMats) {
      if (id === 'rising1') continue;
      const lit = this.hall2.solved || this.hall2Lit.includes(id);
      m.emissiveIntensity = lit ? 2.2 : id === current ? 1.2 : 0;
      if (id === 'serpent') m.emissive.setRGB(0.4, 0.7, 1.0);
    }
  }

  private tobyEnters(): void {
    if (this.tobyHere) return;
    this.tobyHere = true;
    const t = this.toby;
    t.visible = true;
    t.place(v(0, 0, 2), 0);
    t.walkTo([v(0, 0, 9.5), v(0, FLOOR, 14.5), v(-0.8, FLOOR, 19)], {
      speed: 1.8,
      onArrive: () => {
        t.lookAt(this.ctx.player.position);
        this.ctx.dialogue.sayOnce('ch3:tobyArrives', CH3.tobyArrives, true);
        this.after(2.5, () => t.followRoute(ROUTE, () => this.ctx.player.position, 2.6));
      },
    });
  }

  // ================================================================ world state
  protected saveWorld(): Record<string, unknown> {
    const d: WorldSave = { toby: this.tobyHere, exitOpen: this.exitOpen };
    return d as unknown as Record<string, unknown>;
  }

  protected loadWorld(d: Record<string, unknown> | undefined): void {
    const w = d as unknown as WorldSave | undefined;
    this.tobyHere = w?.toby ?? false;
    this.exitOpen = w?.exitOpen ?? false;
  }

  protected applyWorld(): void {
    this.endStarted = false;
    this.hintTimer = 0;
    this.door1K = this.hall1.solved ? 1 : 0;
    this.innerK = this.hall2.solved || this.exitOpen ? 1 : 0;
    this.wallGlowK = this.hall2.solved ? 1 : 0;
    this.applyDoors();
    this.hall1.retrace();
    this.hall2.retrace();
    this.applyReceptors(null);
    const t = this.toby;
    if (this.tobyHere) {
      t.visible = true;
      const pp = this.ctx.player.position;
      t.place(v(pp.x - 1.2, pp.y, pp.z - 1.6), this.ctx.player.yaw);
      t.followRoute(ROUTE, () => this.ctx.player.position, 2.6);
    } else {
      t.visible = false;
      t.place(v(0, 0, -6), 0);
    }
  }

  private applyDoors(): void {
    const e1 = this.door1K * this.door1K * (3 - 2 * this.door1K);
    this.door1.position.y = FLOOR + 1.5 - e1 * 3.1;
    this.door1Col.enabled = this.door1K < 0.6;
    const e2 = this.innerK * this.innerK * (3 - 2 * this.innerK);
    this.inner.position.y = FLOOR + 2.1 - e2 * 4.3;
    this.innerCol.enabled = this.innerK < 0.6;
    this.wallGlow.emissiveIntensity = this.wallGlowK * (1.6 + Math.sin(this.time * 1.7) * 0.25);
    if (this.muralGlow) this.muralGlow.emissiveIntensity = this.wallGlowK * 0.5;
  }

  protected ambience(): AmbienceConfig {
    return { wind: 0.25, insects: 0, birds: 0, frogs: 0, drips: 1, water: [{ pos: v(0, -40, 150), gain: 0.25, kind: 'falls' }, { pos: v(H1.x1 - 0.55, FLOOR, 24), gain: 0.16, kind: 'river' }, { pos: v(H2.x0 + 0.55, FLOOR, 56), gain: 0.16, kind: 'river' }] };
  }

  protected onRespawned(): void {
    this.after(1.4, () => this.ctx.dialogue.sayOnce('ch3:fallRespawn', CH3.fallRespawn));
  }

  // ================================================================ update
  protected tick(dt: number): void {
    this.hall1.update(dt);
    this.hall2.update(dt);
    if (this.hall1.solved && this.door1K < 1) this.door1K = Math.min(1, this.door1K + dt / 2.6);
    if ((this.hall2.solved && this.played('innerWall')) || this.exitOpen) this.innerK = Math.min(1, this.innerK + dt / 4);
    if (this.hall2.solved) this.wallGlowK = Math.min(1, this.wallGlowK + dt / 2);
    this.applyDoors();
  }

  protected triggers(dt: number): void {
    const p = this.ctx.player.position;
    if (p.z > 4) this.say('intro', CH3.intro);
    if (p.z > H1.z0 + 1 && p.z < H1.z1) {
      this.checkpoint('ch3_hall1');
      this.say('hall1', CH3.hall1);
    }
    if (p.z > PASS.z0 + 0.5 && p.z < PASS.z1 && p.x > PASS.x0) {
      this.checkpoint('ch3_passage');
      if (p.z > 35) this.say('bootprints', this.tobyHere ? CH3.bootprints : CH3.bootprintsSolo);
    }
    if (this.tobyHere && p.z > 37 && p.z < 40 && this.ctx.state.progress.collectibles.has('ch3_survey_tag')) this.say('drillToby', CH3.drill);
    if (p.z > H2.z0 + 0.8 && p.z < H2.z1) {
      this.checkpoint('ch3_hall2');
      this.say('hall2', this.tobyHere ? CH3.hall2 : CH3.hall2Solo);
      if (!this.hall2.solved) {
        this.hintTimer += dt;
        if (this.hintTimer > 90 || this.hall2.turns > 14) this.say('hintSoft', CH3.hintSoft);
        if (this.hintTimer > 180 || this.hall2.turns > 28) this.say('hintStrong', CH3.hintStrong);
      }
    }
    if (this.innerK >= 1 && p.z > H2.z1 + 1) this.checkpoint('ch3_exit');
    if (this.innerK >= 1 && p.z > 74) this.say('exitHum', CH3.exitHum);
    if (this.innerK >= 1 && !this.endStarted && p.z > 80.5) {
      this.endStarted = true;
      this.playEnd();
    }
  }

  // ================================================================ cinematics
  protected intro(): void {
    const { cinematic, hud, state, player, camera, audio } = this.ctx;
    const cp = this.checkpoints.ch3_start;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('explore', 4);
    const seq: Sequence = {
      id: 'ch3_intro',
      duration: 9,
      skippable: true,
      letterbox: true,
      blendIn: 0,
      dof: true,
      blendOut: 1.4,
      shots: [
        { t0: 0, t1: 9, path: [v(0.8, 1.2, 9), v(0.4, 1.5, 6.5)], look: [v(0, 1.4, 1.5), v(0, 1.5, 1.8)], fov: [40, 38], ease: 'inOut', sway: 0.015 },
      ],
      events: [
        { t: 0.6, run: (skip) => !skip && hud.chapterCard(this.numberLabel, this.title, 5), onSkip: false },
        {
          t: 8.9,
          run: () => {
            state.progress.setFlag('ch3_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.15);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playInnerWall(): void {
    const { cinematic, dialogue, player, camera, audio } = this.ctx;
    const t = this.toby;
    const seq: Sequence = {
      id: 'ch3_inner_wall',
      duration: 30,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.6,
      shots: [
        { t0: 0, t1: 8, path: [v(-5, FLOOR + 2.4, 58), v(-3.5, FLOOR + 2.8, 60)], look: [v(0, FLOOR + 3.2, H2.z1), v(0, FLOOR + 3.6, H2.z1)], fov: [50, 46], ease: 'inOut', sway: 0.02 },
        { t0: 8, t1: 18, path: [v(1.8, FLOOR + 1.7, 63.6), v(1.4, FLOOR + 1.7, 64.4)], look: [() => t.head(new THREE.Vector3())], fov: [34, 32], ease: 'linear', sway: 0.015 },
        { t0: 18, t1: 30, path: [v(-2.2, FLOOR + 1.6, 63.4), v(-1.8, FLOOR + 1.7, 64.0)], look: [v(1.2, FLOOR + 1.55, 64.2), v(1.0, FLOOR + 1.6, 64.6)], fov: [36, 34], ease: 'linear', sway: 0.015 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(1.3, FLOOR, 63.4), -0.4);
            this.scripted(true);
            if (!this.tobyHere) {
              this.tobyHere = true;
              t.visible = true;
            }
            t.followRoute(null);
            t.place(v(-0.6, FLOOR, 65.6), 0, 'TALK');
          },
        },
        { t: 0.4, run: () => audio.music.setMood('wonder', 2) },
        { t: 2.0, run: () => dialogue.sayOnce('ch3:innerWall', CH3.innerWall, true) },
        { t: 9, run: () => t.lookAt(player.position) },
        { t: 26, run: (s) => !s && audio.sfx.rumble(4, v(0, FLOOR, H2.z1), 0.7), onSkip: false },
        {
          t: 29.9,
          run: () => {
            this.exitOpen = true;
            this.scripted(false);
            t.setPose('IDLE');
            t.followRoute(ROUTE, () => this.ctx.player.position, 2.6);
            camera.snap(player, 0, 0.15);
          },
        },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 2.0, CH3.innerWall));
  }

  private playEnd(): void {
    const { cinematic, dialogue, player, audio, completeChapter } = this.ctx;
    const t = this.toby;
    const seq: Sequence = {
      id: 'ch3_end',
      duration: 18,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.2,
      shots: [
        { t0: 0, t1: 7, path: [v(1.8, FLOOR + 1.7, 81.2), v(1.2, FLOOR + 1.8, 82.4)], look: [v(-0.4, FLOOR + 1.5, 84.2), v(0, -36, 125)], fov: [42, 44], ease: 'inOut', sway: 0.02 },
        { t0: 7, t1: 18, path: [v(0, FLOOR + 2.8, 81.5), v(0, FLOOR + 3.3, 82.2)], look: [v(0, -40, 125), v(0, -42, 135)], fov: [44, 38], ease: 'inOut', sway: 0.02, focus: 50 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(v(-0.6, FLOOR, 84.2), 0);
            this.scripted(true);
            t.followRoute(null);
            t.visible = true;
            t.place(v(1.0, FLOOR, 83.6), 0.2);
          },
        },
        { t: 0.3, run: () => audio.music.setMood('tension', 3) },
        { t: 1.2, run: () => dialogue.sayOnce('ch3:ending', CH3.ending, true) },
        { t: 16, run: () => completeChapter() },
      ],
    };
    void cinematic.play(this.fitToLines(seq, 1.2, CH3.ending));
  }

  // ================================================================ misc
  objective(): string {
    if (this.innerK >= 1) return 'Follow the passage beyond the inner wall.';
    if (this.cpIndex() >= 3) return 'Wake the three houses in the Watcher\'s order — right hand first.';
    if (this.hall1.solved) return 'Follow the passage north.';
    if (this.cpIndex() >= 1) return 'Turn the bronze mirror to send the sunlight to the carved sun.';
    return 'Follow the light into the mountain.';
  }

  objectiveTarget(): THREE.Vector3 | null {
    if (this.innerK >= 1) return v(0, FLOOR, 83);
    if (this.cpIndex() >= 3) return v(0, FLOOR, 56);
    if (this.hall1.solved) return v(5.2, FLOOR, 44);
    return v(0, FLOOR, 22);
  }

  protected mapBounds = { minX: -14, maxX: 14, minZ: -2, maxZ: 87 };

  protected mapHeight(): number {
    return 0;
  }

  protected mapColor(x: number, z: number): [number, number, number] {
    const inside = (r: { x0: number; x1: number; z0: number; z1: number }) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
    if ((x > -2 && x < 2 && z > -1 && z < 16) || inside(H1) || inside(PASS) || inside(H2) || (x > -2 && x < 2 && z > 68 && z < 81) || (x > -4 && x < 4 && z > 80.5 && z < 85.5)) return [120, 108, 88];
    return [22, 20, 18];
  }

  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    out.position.set(Math.sin(t * 0.1) * 4, FLOOR + 2, 50);
    out.look.set(0, FLOOR + 2, 66);
  }

  heroFrames(): HeroFrame[] {
    const p = this.ctx.player;
    const stand = (x: number, y: number, z: number, yaw: number) => p.teleport(v(x, y, z), yaw);
    return [
      { name: 'shaft-entry', cp: 'ch3_start', cam: [0.9, 1.5, 9.5], look: [0, 1.0, 1.5], prep: () => stand(0, 0, 2.6, Math.PI) },
      { name: 'hall1-wide', cp: 'ch3_hall1', cam: [-6.6, 0.6, 17.4], look: [1.5, -1, 27], prep: () => stand(-1.6, FLOOR, 21.4, 0.9) },
      { name: 'hall1-mirror', cp: 'ch3_hall1', cam: [1.7, -0.5, 18.4], look: [0, BEAM_Y, 20], prep: () => stand(-1.2, FLOOR, 19.0, 0.8) },
      { name: 'passage-prints', cp: 'ch3_passage', cam: [5.2, -0.7, 33.0], look: [5.2, -2, 40], prep: () => stand(5.4, FLOOR, 38.4, 0) },
      { name: 'drill-hole', cp: 'ch3_passage', cam: [5.3, -0.9, 37.0], look: [PASS.x0 + 0.4, -1.0, 38.2], prep: () => stand(4.9, FLOOR, 39.4, -2.2) },
      { name: 'hall2-wide', cp: 'ch3_hall2', cam: [9.5, 1.8, 45.4], look: [-3, -0.6, 60], prep: () => stand(4.6, FLOOR, 50, -0.5) },
      {
        name: 'hall2-awake',
        cp: 'ch3_hall2',
        cam: [-9.6, 2.4, 46.4],
        look: [2, 0, 64],
        prep: () => {
          this.hall2Lit = ['rising', 'eye', 'setting'];
          this.wallGlowK = 1;
          this.applyReceptors(null);
          stand(-2, FLOOR, 58, 0.4);
        },
      },
      {
        name: 'inner-wall-toby',
        cp: 'ch3_hall2',
        cam: [3.2, -0.2, 61.2],
        look: [-0.9, -0.4, 66.2],
        prep: () => {
          this.wallGlowK = 1;
          this.toby.visible = true;
          this.toby.followRoute(null);
          this.toby.place(v(-1.4, FLOOR, 65.4), -0.4, 'TALK');
          stand(1.6, FLOOR, 63.9, -1.2);
        },
        settle: 2.5,
      },
      {
        name: 'balcony-vista',
        cp: 'ch3_exit',
        cam: [1.6, 0.4, 82.6],
        look: [-1, -36, 134],
        prep: () => {
          this.innerK = 1;
          this.exitOpen = true;
          stand(-0.9, FLOOR, 84.6, 0.1);
        },
      },
    ];
  }

  debug() {
    return {
      h1: { angles: [...this.hall1.angles], solved: this.hall1.solved, hit: this.hall1.traces[0]?.hit ?? null },
      h2: { angles: [...this.hall2.angles], solved: this.hall2.solved, hit: this.hall2.traces[0]?.hit ?? null, lit: [...this.hall2Lit] },
      door1: +this.door1K.toFixed(2),
      inner: +this.innerK.toFixed(2),
      toby: this.tobyHere ? this.toby.position.toArray().map((n) => +n.toFixed(2)) : null,
    };
  }
}

// ------------------------------------------------------------------ textures
function glyphDiscTexture(g: GlyphId): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6a5030';
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#f0d8a0';
  x.fillStyle = '#f0d8a0';
  x.lineWidth = 10;
  drawGlyph(x, g, 128, 128, 150);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bootPrintTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,0.85)';
  x.beginPath();
  x.ellipse(32, 40, 22, 34, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.ellipse(32, 100, 17, 22, 0, 0, Math.PI * 2);
  x.fill();
  // lug pattern
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) x.fillRect(14 + (i % 3) * 13, 14 + Math.floor(i / 3) * 18, 8, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
