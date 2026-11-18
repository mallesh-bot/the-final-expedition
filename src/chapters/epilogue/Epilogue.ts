import * as THREE from 'three';
import type { CheckpointDef } from '../Chapter';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Sequence } from '../../cinematic/Sequence';
import type { NpcActor } from '../../actors/NpcActor';
import { ChapterBase, type HeroFrame } from '../common/ChapterBase';
import { standardManifest, v } from '../common/LevelKit';
import * as P from '../../world/Props';
import { fbm2, smoothstep } from '../../systems/noise';
import { characterDef } from '../../animation/CharacterAvatar';
import { EP } from '../../story/dialogue/epilogue';

/*
 * EPILOGUE — TAMSA ALTA (STORY_BIBLE §14.8–14.9, SB-10 order). Five weeks later, late afternoon.
 * Up through the highland village to Doña Ayme's house → the photograph → the montage → the grave
 * (Marta's letter, read over black) → the foot of the red-rock trail, where Ines ties a new ribbon.
 */
const CLIFF_X = 300;
const AYME_AT = v(0, 0, 31.6);
const STAKE = v(CLIFF_X + 1.2, 0, 7.4);

function hillHeight(x: number, z: number): number {
  if (x > 200) {
    // The foot of the red-rock trail (a separate little set, far from the village).
    return fbm2(x * 0.05, z * 0.05, 3) * 0.4 + Math.max(0, z - 10) * 0.05;
  }
  const t = (z + 60) / 7;
  const step = Math.floor(t) + smoothstep(0.72, 1, t - Math.floor(t));
  let h = step * 7 * 0.16 + fbm2(x * 0.04, z * 0.04, 3) * 0.5;
  const out = Math.max(0, Math.abs(x) - 26);
  h += Math.pow(out / 10, 1.5) * 6;
  // The valley sides break into spurs and gullies the further up they go.
  if (out > 0) h += (fbm2(x * 0.013, z * 0.013, 3) - 0.5) * Math.min(out, 90) * 0.8 + (fbm2(x * 0.045, z * 0.045, 2) - 0.5) * Math.min(out, 60) * 0.12;
  return h;
}

const CHECKPOINTS: Record<string, CheckpointDef> = {
  ep_start: { pos: v(0, hillHeight(0, -42), -42), yaw: 0, label: 'Tamsa Alta' },
  ep_cliff: { pos: v(CLIFF_X, hillHeight(CLIFF_X, -3), -3), yaw: 0.1, label: 'The red-rock trail' },
};

interface WorldSave {
  met: boolean;
  tied: boolean;
  toby: number;
}

export default class Epilogue extends ChapterBase {
  readonly id = 6;
  readonly title = 'TAMSA ALTA';
  readonly numberLabel = 'EPILOGUE';
  readonly checkpoints = CHECKPOINTS;
  readonly firstCheckpoint = 'ep_start';
  protected readonly checkpointOrder = ['ep_start', 'ep_cliff'];
  readonly manifest = standardManifest('epilogue', [{ key: characterDef('elder').asset, type: 'gltf', url: characterDef('elder').url, weight: 2 }], { masonTint: [176, 150, 120] });
  protected kitOptions = { masonMoss: 0.35, cliffMoss: 0.6 };

  private met = false;
  private tied = false;
  private tobyTalk = 0;
  private ayme!: NpcActor;
  private toby!: NpcActor;
  private ribbon!: THREE.Object3D;
  private endStarted = false;
  private photo!: THREE.Object3D;

  // ================================================================ build
  protected async build(step: (f: number, label: string) => Promise<void>): Promise<void> {
    const k = this.kit;
    const { world } = this.ctx;
    this.sunDir = v(-0.62, 0.3, 0.72).normalize();
    this.shadowRange = 36;
    await step(0.05, 'Late afternoon in the highlands');
    k.atmosphere({
      sunDir: this.sunDir,
      sunColor: new THREE.Color(1.0, 0.78, 0.55),
      sunIntensity: 3.4,
      zenith: new THREE.Color(0.22, 0.34, 0.55),
      horizon: new THREE.Color(0.8, 0.7, 0.6),
      sunHorizon: new THREE.Color(1.4, 0.82, 0.5),
      skySun: new THREE.Color(1.8, 1.2, 0.8),
      ground: new THREE.Color(0.24, 0.22, 0.18),
      cloudCover: 0.4,
      skySunIntensity: 20,
      envIntensity: 0.7,
      fogColor: new THREE.Color(0.68, 0.64, 0.6),
      fogDensity: 0.003,
      fogSunColor: new THREE.Color(1.0, 0.7, 0.45),
      fogHeightBase: -5,
      fogHeightFalloff: 0.02,
      hemiSky: new THREE.Color(0.7, 0.72, 0.8),
      hemiGround: new THREE.Color(0.3, 0.25, 0.18),
      hemiIntensity: 0.75,
      wetness: 0.05,
      shadowRange: this.shadowRange,
    });
    world.bounds = { minX: -30, maxX: CLIFF_X + 14, minZ: -46, maxZ: 40 };
    await step(0.12, 'The hillside');
    const pathX = (z: number) => Math.sin(z * 0.08) * 2.2;
    k.terrainFrom(hillHeight, {
      origin: [-160, -120],
      size: 520,
      res: 261,
      splat: (x, z, _h, ny) => {
        const onPath = x < 200 ? 1 - smoothstep(0.9, 2.2, Math.abs(x - pathX(z))) : 1 - smoothstep(1, 3, Math.hypot(x - CLIFF_X, z));
        const court = 1 - smoothstep(4, 6, Math.hypot(x - AYME_AT.x, z - 30.5));
        return [Math.max(onPath, court), 1 - Math.max(onPath, court), ny < 0.8 ? 1 : 0];
      },
      surface: (x, z) => (Math.abs(x - pathX(z)) < 1.6 ? 'dirt' : 'grass'),
    });
    await step(0.25, 'Raising the houses');
    this.buildVillage(pathX);
    await step(0.55, 'The red-rock trail');
    this.buildCliff();
    await step(0.7, 'Fields and trees');
    this.dress(pathX);
    await step(0.88, 'Evening air');
    k.particles('pollen', 260, v(0, hillHeight(0, 0) + 1, 0), v(50, 8, 80), new THREE.Color(1, 0.88, 0.62), 0.1, 0.5, 61);
    k.particles('dust', 140, v(CLIFF_X, 0.5, 4), v(20, 6, 20), new THREE.Color(1, 0.86, 0.6), 0.1, 0.5, 62);
    k.particles('fireflies', 80, v(CLIFF_X, 0.4, 2), v(24, 3, 24), new THREE.Color(0.8, 1.0, 0.45), 0.07, 0.9, 63);
    k.ridges(v(0, 0, 60), [
      [360, 160, new THREE.Color(0.42, 0.42, 0.5)],
      [560, 300, new THREE.Color(0.62, 0.6, 0.68)],
      [900, 520, new THREE.Color(0.8, 0.78, 0.84)],
    ]);
    k.finish();
    this.ctx.traversal.load({ climbs: [], ledges: [], narrows: [], vaults: [], jumps: [] });
    this.ayme = this.npc('elder', AYME_AT.clone().setY(hillHeight(0, 31.6)), Math.PI);
    this.toby = this.npc('toby', v(4.35, 0, 6.2), -Math.PI / 2, 'SIT');
    this.toby.groundSnap = false;
    this.toby.place(v(4.35, hillHeight(4.1, 6.2) + 0.1, 6.2), -Math.PI / 2, 'SIT');
  }

  private buildVillage(pathX: (z: number) => number): void {
    const k = this.kit;
    const { world } = this.ctx;
    const rnd = k.rnd;
    const adobe = new THREE.Color(1.2, 0.98, 0.78);
    const roofMat = k.track(new THREE.MeshStandardMaterial({ color: 0x5a4226, roughness: 0.95 }));
    const doorMat = k.track(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 }));
    const roofs: THREE.Mesh[] = [];
    const thatch = k.track(new THREE.MeshStandardMaterial({ color: 0x9a8150, roughness: 1, map: k.tex('tex.canvas').map, side: THREE.DoubleSide }));
    const house = (x: number, z: number, w: number, d: number, yawIn: number, opts: { door?: boolean; tall?: number } = {}) => {
      // Axis-aligned so the walls can be coursed adobe; the door faces local +z.
      const yaw = Math.round(yawIn / (Math.PI / 2)) * (Math.PI / 2);
      const y = hillHeight(x, z) - 0.15;
      const H = opts.tall ?? 2.6;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const r6 = (n: number) => Math.round(n * 1e4) / 1e4;
      const at = (lx: number, ly: number, lz: number) => v(r6(x + c * lx + sn * lz), y + ly, r6(z - sn * lx + c * lz));
      const dw = 1.0;
      const wall = (a: THREE.Vector3, b: THREE.Vector3, gap?: THREE.Vector3) => {
        const alongX = Math.abs(a.z - b.z) < 1e-3;
        const g: [number, number][] = gap ? [alongX ? [gap.x - dw / 2, gap.x + dw / 2] : [gap.z - dw / 2, gap.z + dw / 2]] : [];
        k.coursedWall(a.x, alongX ? a.z : a.z, b.x, alongX ? a.z : b.z, y, y + H, { thick: 0.42, hue: adobe, tint: 0.95, gaps: g, doorH: 2.0 });
      };
      const fl = at(-w / 2, 0, d / 2);
      const fr = at(w / 2, 0, d / 2);
      const bl = at(-w / 2, 0, -d / 2);
      const br = at(w / 2, 0, -d / 2);
      wall(fl, fr, opts.door !== false ? at(0, 0, d / 2) : undefined);
      wall(bl, br);
      wall(at(-w / 2, 0, -d / 2 + 0.21), at(-w / 2, 0, d / 2 - 0.21));
      wall(at(w / 2, 0, -d / 2 + 0.21), at(w / 2, 0, d / 2 - 0.21));
      // Stone plinth hides the slope under the adobe.
      const pc = at(0, -0.25, 0);
      k.masonBatch.add(k.ashlar, pc, Math.abs(sn) > 0.5 ? v(d + 0.5, 0.9, w + 0.5) : v(w + 0.5, 0.9, d + 0.5), 0, 0.8);
      if (opts.door !== false) {
        const door = new THREE.Mesh(new THREE.PlaneGeometry(dw * 0.92, 1.95), doorMat);
        door.position.copy(at(0, 0.98, d / 2 - 0.12));
        door.rotation.y = yaw;
        k.props.add(door);
        world.addBox(at(0, 1, d / 2 - 0.16), v(dw / 2, 1, 0.06), yaw);
      }
      k.niches(at(-w / 2 + 0.5, 0, d / 2 + 0.22), at(-w / 2 + 1.4, 0, d / 2 + 0.22), v(sn, 0, c), y + 1.0, 1, 0.75);
      k.niches(at(w / 2 - 1.4, 0, d / 2 + 0.22), at(w / 2 - 0.5, 0, d / 2 + 0.22), v(sn, 0, c), y + 1.0, 1, 0.75);
      // Steep thatched gable roof with deep eaves and a ridge roll.
      const sh = new THREE.Shape();
      sh.moveTo(-w / 2 - 0.7, -0.15);
      sh.lineTo(w / 2 + 0.7, -0.15);
      sh.lineTo(0, 1.9);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: d + 1.2, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
      g.translate(0, 0, -(d + 1.2) / 2);
      const roof = new THREE.Mesh(g, thatch);
      roof.position.copy(at(0, H, 0));
      roof.rotation.y = yaw;
      roof.castShadow = true;
      roof.receiveShadow = true;
      k.props.add(roof);
      roofs.push(roof);
      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, d + 1.3, 8).rotateX(Math.PI / 2), roofMat);
      ridge.position.copy(at(0, H + 1.9, 0));
      ridge.rotation.y = yaw;
      k.props.add(ridge);
      // Firewood by the door on some houses; smoke from some roofs.
      if (rnd() < 0.5) {
        for (let l = 0; l < 6; l++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6).rotateZ(Math.PI / 2), k.barkMat);
          log.position.copy(at(w / 2 - 0.6, 0.1 + Math.floor(l / 3) * 0.13, d / 2 + 0.55 + (l % 3) * 0.15));
          log.rotation.y = yaw;
          k.props.add(log);
        }
      }
      if (rnd() < 0.4) k.particles('mist', 6, at(w * 0.25, H + 2.2, -d * 0.2), v(1.2, 6, 1.2), new THREE.Color(0.8, 0.78, 0.76), 3, 0.18, Math.floor(rnd() * 1000), 'tex.mist');
    };
    // Houses stepping up the hill on both sides of the path.
    const spots: [number, number, number, number, number][] = [
      [-8, -34, 4.5, 4, 0.3], [8.5, -30, 5, 4, -0.3], [-9, -20, 5, 4.5, 0.2], [9, -16, 4.5, 4, -0.2],
      [-8.5, -6, 5.5, 4.5, 0.15], [10, -2, 4.5, 4, -0.25], [-9.5, 8, 5, 4, 0.1], [11, 14, 5, 4.5, -0.15],
      [-10, 20, 4.5, 4, 0.2], [-16, -12, 4.5, 4, 0.5], [17, 4, 4.5, 4, -0.5], [-17, 12, 5, 4, 0.4],
    ];
    for (const [x, z, w, d, yaw] of spots) house(x + pathX(z) * 0.5, z, w, d, yaw + (x > 0 ? -Math.PI / 2 : Math.PI / 2));
    // Doña Ayme's house at the top, facing down the path, with a courtyard wall.
    house(0, 36.5, 6, 5, Math.PI, { tall: 2.8 });
    for (let x = -5.5; x <= 5.5; x += 0.9) {
      if (Math.abs(x) < 1.3) continue;
      k.blockAt(v(x, hillHeight(x, 27.4) + 0.4, 27.4), v(0.85, 0.8, 0.5), 0, true, 0.95);
    }
    for (const sx of [-5.8, 5.8]) for (let z = 28; z < 34; z += 0.9) k.blockAt(v(sx, hillHeight(sx, z) + 0.4, z), v(0.5, 0.8, 0.85), 0, true, 0.95);
    // Courtyard: bench, pots, a loom frame
    k.blockAt(v(-3.4, hillHeight(-3.4, 33) + 0.22, 33.2), v(1.8, 0.44, 0.5), 0, true, 0.85);
    for (const [px, pz] of [[3.6, 32.8], [4.2, 31.6], [3.2, 30.4]] as const) {
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xa0583a, roughness: 0.85 }));
      pot.scale.y = 1.2;
      pot.position.set(px, hillHeight(px, pz) + 0.3, pz);
      pot.castShadow = true;
      k.props.add(pot);
      world.addCylinder(v(px, hillHeight(px, pz) + 0.35, pz), 0.3, 0.35, { blocksCamera: false });
    }
    // The photograph (handed over in the cinematic; a pickup so it lands in the journal).
    this.photo = P.paperPage(k.PM);
    this.photo.position.set(0, -50, 0);
    k.root.add(this.photo);
    // Low stone field walls along the terraces
    for (let z = -50; z < 26; z += 7) {
      const zz = z + 6.6;
      for (const side of [-1, 1])
        for (let x = 2.6; x < 24; x += 1.0) {
          if (rnd() < 0.15) continue;
          const xx = side * x + pathX(zz);
          k.masonBatch.add(k.block, v(xx, hillHeight(xx, zz) + 0.25, zz), v(1.0, 0.5 + rnd() * 0.2, 0.5), rnd() * 0.1, 0.8 + rnd() * 0.15, adobe);
        }
    }
    // Toby's seat: a low wall by the path
    k.blockAt(v(4.2, hillHeight(4.2, 6.2) + 0.25, 6.2), v(0.6, 0.5, 1.6), 0, true, 0.9);
  }

  private buildCliff(): void {
    const k = this.kit;
    const red = new THREE.Color(1.0, 0.84, 0.74);
    // The red-rock cliff above the trail start, ribboned pitons, jungle edge.
    k.cliffBox(v(CLIFF_X, 8, 16), v(22, 14, 4), ['-z'], { hue: red });
    k.cliffBox(v(CLIFF_X - 24, 8, 4), v(4, 14, 16), ['+x'], { hue: red, scale: 1.4 });
    k.cliffBox(v(CLIFF_X + 24, 8, 4), v(4, 14, 16), ['-x'], { hue: red, scale: 1.4 });
    for (let i = 0; i < 6; i++) {
      const r = P.pitonRibbon(k.PM, 200 + i);
      r.position.set(CLIFF_X - 2 + i * 0.9, 1.2 + i * 1.4, 11.6);
      r.rotation.y = Math.PI;
      k.props.add(r);
    }
    // The stake where she ties the new ribbon.
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 6), k.PM.wood);
    stake.position.set(STAKE.x, hillHeight(STAKE.x, STAKE.z) + 0.6, STAKE.z);
    k.props.add(stake);
    this.ribbon = P.pitonRibbon(k.PM, 999);
    this.ribbon.position.set(STAKE.x, hillHeight(STAKE.x, STAKE.z) + 1.05, STAKE.z);
    this.ribbon.visible = false;
    k.root.add(this.ribbon);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI - Math.PI;
      const r = 9 + k.rnd() * 6;
      k.boulder(v(CLIFF_X + Math.cos(a) * r, -0.2, 6 + Math.sin(a) * r * 0.6), 0.4 + k.rnd() * 0.8, 0, true);
    }
  }

  private dress(pathX: (z: number) => number): void {
    const k = this.kit;
    const rnd = k.rnd;
    const village = (x: number, z: number) => x < 200 && Math.abs(x - pathX(z)) > 2 && Math.hypot(x, z - 32) > 6.5;
    k.grass(k.scatter(5200, [-30, -50, 30, 40], hillHeight, (x, z) => village(x, z) && (fbm2(x * 0.08, z * 0.08, 3) > -0.05 || rnd() < 0.3), [0.55, 1.05]));
    k.ferns(k.scatter(180, [-30, -50, 30, 40], hillHeight, (x, z) => village(x, z) && Math.abs(x) > 14, [0.6, 1.2], { tilt: 0.2 }));
    // Jungle at the cliff foot
    const nearCliff = (x: number, z: number) => x > 200 && Math.hypot(x - CLIFF_X, z) > 3.2 && z < 11;
    k.grass(k.scatter(1800, [CLIFF_X - 20, -14, CLIFF_X + 20, 11], hillHeight, nearCliff, [0.55, 1.1]));
    k.ferns(k.scatter(300, [CLIFF_X - 20, -14, CLIFF_X + 20, 11], hillHeight, (x, z) => nearCliff(x, z) && Math.hypot(x - CLIFF_X, z) > 5, [0.7, 1.4], { tilt: 0.2 }), 2);
    k.broadleaf(k.scatter(120, [CLIFF_X - 20, -14, CLIFF_X + 20, 11], hillHeight, (x, z) => nearCliff(x, z) && Math.hypot(x - CLIFF_X, z) > 6, [0.8, 1.5], { tilt: 0.15 }));
    const trees: THREE.Matrix4[] = [];
    for (const [x, z] of [[-20, -26], [21, -20], [-22, 2], [23, 22], [-14, 30], [16, 34], [CLIFF_X - 14, -6], [CLIFF_X + 13, -8], [CLIFF_X - 9, 4], [CLIFF_X + 10, 2]] as const) trees.push(new THREE.Matrix4().compose(v(x, hillHeight(x, z) - 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), v(0.8, 0.8, 0.8)));
    k.trees(trees.slice(0, 6), 'slender', 6);
    k.trees(trees.slice(6), 'giant', 2);
    // (No far-forest band here: at this altitude the slopes above the village are open grassland.)
  }

  // ================================================================ setup
  protected setup(): void {
    const { interaction, dialogue } = this.ctx;
    interaction.add({
      id: 'toby',
      position: v(4.35, hillHeight(4.35, 6.2) + 1, 6.2),
      radius: 2.2,
      prompt: 'Talk to Toby',
      enabled: true,
      facing: 0,
      onInteract: () => {
        dialogue.say(EP.toby[Math.min(this.tobyTalk, EP.toby.length - 1)], true);
        this.tobyTalk++;
      },
    });
    interaction.add({
      id: 'ayme',
      position: AYME_AT.clone().setY(hillHeight(0, 31.6) + 1),
      radius: 2.4,
      prompt: 'Talk to Doña Ayme',
      enabled: true,
      facing: 0,
      onInteract: () => this.playAyme(),
    });
    interaction.add({
      id: 'ribbon',
      position: STAKE.clone().setY(hillHeight(STAKE.x, STAKE.z) + 1),
      radius: 1.8,
      prompt: 'Tie the ribbon',
      enabled: true,
      facing: 0,
      onInteract: () => this.playRibbon(),
    });
    this.ctx.camera.hints = [
      { id: 'court', center: v(0, 0, 31), radius: 7, distance: 4.0, fovAdd: 2 },
      { id: 'cliff', center: v(CLIFF_X, 0, 4), radius: 10, distance: 4.4, fovAdd: 4 },
    ];
  }

  // ================================================================ world state
  protected saveWorld(): Record<string, unknown> {
    const d: WorldSave = { met: this.met, tied: this.tied, toby: this.tobyTalk };
    return d as unknown as Record<string, unknown>;
  }

  protected loadWorld(d: Record<string, unknown> | undefined): void {
    const w = d as unknown as WorldSave | undefined;
    this.met = w?.met ?? false;
    this.tied = w?.tied ?? false;
    this.tobyTalk = w?.toby ?? 0;
  }

  protected applyWorld(checkpoint: string): void {
    this.endStarted = false;
    // Saved during the montage: resume at the trail (the village part is done).
    if (this.met && checkpoint !== 'ep_cliff') {
      const cp = this.checkpoints.ep_cliff;
      this.ctx.player.teleport(cp.pos, cp.yaw);
      this.ctx.state.progress.checkpoint = 'ep_cliff';
    }
    const it = this.ctx.interaction;
    it.get('ayme')!.enabled = !this.met;
    it.get('ribbon')!.enabled = this.met && !this.tied;
    this.ribbon.visible = this.tied;
    this.ayme.place(AYME_AT.clone(), Math.PI);
    this.toby.place(v(4.35, hillHeight(4.1, 6.2) + 0.1, 6.2), -Math.PI / 2, 'SIT');
  }

  protected ambience(): AmbienceConfig {
    return { wind: 0.7, insects: 0.8, birds: 1, frogs: 0.2, drips: 0, water: [] };
  }

  protected tick(): void {
    this.ayme.lookAt(this.ctx.player.position);
  }

  protected triggers(): void {
    const p = this.ctx.player.position;
    if (p.z > -36 && p.x < 200) this.say('arrive', EP.arrive);
    if (p.x > 200 && p.z > -1) this.say('cliff', EP.cliff);
  }

  // ================================================================ cinematics
  protected intro(): void {
    const { cinematic, hud, state, player, camera, audio } = this.ctx;
    const cp = this.checkpoints.ep_start;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('wonder', 4);
    const seq: Sequence = {
      id: 'ep_intro',
      duration: 12,
      skippable: true,
      letterbox: true,
      blendIn: 0,
      dof: true,
      blendOut: 1.6,
      shots: [
        { t0: 0, t1: 12, path: [v(-14, hillHeight(0, -50) + 9, -58), v(-6, hillHeight(0, -50) + 5, -50), v(-2, cp.pos.y + 2.2, -46.5)], look: [v(0, hillHeight(0, 20) + 4, 20), v(0, cp.pos.y + 1.4, -42)], fov: [44, 40], ease: 'inOut', sway: 0.02, focus: 30 },
      ],
      events: [
        { t: 0.8, run: (skip) => !skip && hud.chapterCard(this.numberLabel, this.title, 5), onSkip: false },
        {
          t: 11.9,
          run: () => {
            state.progress.setFlag('ch6_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.15);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playAyme(): void {
    const { cinematic, dialogue, player, camera, audio, hud, state, events, interaction } = this.ctx;
    interaction.get('ayme')!.enabled = false;
    this.met = true;
    const ines = v(0.2, hillHeight(0, 29.6), 29.6);
    const ayHead = () => this.ayme.head(new THREE.Vector3());
    const lines = this.ctx.dialogue.totalDuration(EP.ayme);
    const seq: Sequence = {
      id: 'ep_ayme',
      duration: lines + 4,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 0.1,
      shots: [
        { t0: 0, t1: 16, path: [v(1.3, ines.y + 1.65, 28.6), v(1.1, ines.y + 1.62, 28.9)], look: [ayHead], fov: [34, 32], ease: 'linear', sway: 0.012 },
        { t0: 16, t1: lines + 4, path: [v(-1.0, ines.y + 1.65, 32.6), v(-0.9, ines.y + 1.65, 32.4)], look: [() => player.avatar.bones.head!.getWorldPosition(new THREE.Vector3())], fov: [34, 32], ease: 'linear', sway: 0.012 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(ines, 0);
            this.scripted(true, 'IDLE');
            this.ayme.setPose('TALK');
          },
        },
        { t: 0.6, run: () => dialogue.sayOnce('ep:ayme', EP.ayme, true) },
        {
          t: 15,
          run: () => {
            this.ayme.setPose('INTERACT');
            state.progress.collectibles.add('ep_photo_gate');
            events.emit('collectible:found', { id: 'ep_photo_gate', title: 'The Sealed Gate, 1979' });
          },
        },
        { t: 18, run: () => this.ayme.setPose('IDLE') },
        {
          t: lines + 3.9,
          run: () => {
            camera.snap(player, 0, 0.15);
            void this.montage();
          },
        },
      ],
    };
    void audio;
    void hud;
    void cinematic.play(seq);
  }

  /** Montage cards and the grave (Marta's letter), read over black; then the cliff trail. */
  private async montage(): Promise<void> {
    const { hud, dialogue, player, camera, audio } = this.ctx;
    this.scripted(true, 'IDLE');
    await hud.fade(true, 1.6);
    audio.music.setMood('wonder', 3);
    const dur = (ls: typeof EP.letter) => dialogue.totalDuration(ls);
    dialogue.say(EP.montage, true);
    this.after(dur(EP.montage) + 1.5, () => {
      hud.chapterCard('LONDON · SIX WEEKS LATER', "LENA KOVAČ, 1955–2024", 4);
      this.after(4.5, () => dialogue.say(EP.letter, true));
      this.after(4.5 + dur(EP.letter) + 1.5, () => {
        const cp = this.checkpoints.ep_cliff;
        player.teleport(cp.pos, cp.yaw);
        camera.snap(player, cp.yaw, 0.18);
        this.ctx.reachCheckpoint('ep_cliff');
        this.ctx.interaction.get('ribbon')!.enabled = true;
        hud.chapterCard('THE SAEL VALLEY', 'THE FOOT OF THE RED-ROCK TRAIL', 4);
        void hud.fade(false, 2.2).then(() => this.scripted(false));
      });
    });
  }

  private playRibbon(): void {
    const { cinematic, player, audio, hud, completeChapter, interaction } = this.ctx;
    if (this.endStarted) return;
    this.endStarted = true;
    interaction.get('ribbon')!.enabled = false;
    const s = STAKE.clone().setY(hillHeight(STAKE.x, STAKE.z));
    const stand = s.clone().add(v(-0.9, 0, -0.5));
    const seq: Sequence = {
      id: 'ep_ribbon',
      duration: 22,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1,
      shots: [
        { t0: 0, t1: 6, path: [v(stand.x - 0.9, s.y + 1.25, stand.z + 1.4), v(stand.x - 0.7, s.y + 1.2, stand.z + 1.2)], look: [s.clone().setY(s.y + 1.0)], fov: [30, 26], ease: 'linear', sway: 0.01, focus: 1.6 },
        { t0: 6, t1: 22, path: [v(s.x - 1.2, s.y + 1.0, s.z - 2), v(s.x - 3, s.y + 3.5, s.z - 14), v(s.x - 2, s.y + 9, s.z - 30)], look: [s.clone().setY(s.y + 1.0), s.clone().setY(s.y + 3), v(CLIFF_X, 12, 14)], fov: [36, 50], ease: 'inOut', sway: 0.02, focus: 12 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(stand, Math.atan2(s.x - stand.x, s.z - stand.z));
            this.scripted(true, 'INTERACT');
          },
        },
        {
          t: 2.6,
          run: () => {
            this.tied = true;
            this.ribbon.visible = true;
            audio.sfx.climbGrab('ledge');
          },
        },
        { t: 4, run: () => this.scripted(true, 'IDLE') },
        { t: 7, run: () => audio.music.setMood('title', 4) },
        { t: 13, run: () => hud.chapterCard('A CINEMATIC ADVENTURE', 'THE FINAL EXPEDITION', 7) },
        { t: 21, run: () => completeChapter() },
      ],
    };
    void cinematic.play(seq);
  }

  // ================================================================ misc
  objective(): string {
    if (this.tied) return '';
    if (this.met) return 'Tie a new ribbon at the foot of the trail.';
    return "Walk up through the village to Doña Ayme's house.";
  }

  objectiveTarget(): THREE.Vector3 | null {
    if (this.tied) return null;
    if (this.met) return STAKE.clone();
    return AYME_AT.clone();
  }

  mapPoints(): THREE.Vector3[] {
    return [v(4.35, 0, 6.2)];
  }

  protected mapBounds = { minX: -32, maxX: 32, minZ: -48, maxZ: 42 };

  protected mapHeight(x: number, z: number): number {
    return hillHeight(x, z);
  }

  protected mapColor(x: number, z: number): [number, number, number] {
    if (Math.abs(x - Math.sin(z * 0.08) * 2.2) < 1.5) return [150, 122, 86];
    if (Math.hypot(x, z - 31) < 6) return [140, 116, 86];
    return [92, 110, 70];
  }

  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    out.position.set(Math.sin(t * 0.05) * 10, 14, -50);
    out.look.set(0, 8, 20);
  }

  heroFrames(): HeroFrame[] {
    const p = this.ctx.player;
    const stand = (x: number, z: number, yaw: number) => p.teleport(v(x, hillHeight(x, z), z), yaw);
    return [
      { name: 'village-approach', cp: 'ep_start', cam: [-3, hillHeight(0, -50) + 3.2, -50], look: [0, hillHeight(0, 0) + 3, 0], prep: () => stand(0.4, -41, 0) },
      { name: 'village-street', cp: 'ep_start', cam: [-2.6, hillHeight(0, -14) + 1.9, -14], look: [1, hillHeight(0, 6) + 1.4, 6], prep: () => stand(0.2, -8, 0.1) },
      { name: 'toby-wall', cp: 'ep_start', cam: [1.6, hillHeight(1, 3.6) + 1.6, 3.6], look: [4.35, hillHeight(4, 6) + 1.1, 6.2], prep: () => stand(2.2, 5.2, 1.2) },
      { name: 'ayme-courtyard', cp: 'ep_start', cam: [2.6, hillHeight(2, 27.6) + 1.7, 27.6], look: [0, hillHeight(0, 31.6) + 1.3, 31.6], prep: () => stand(0.4, 29.4, 0) },
      { name: 'photo-handover', cp: 'ep_start', cam: [1.3, hillHeight(0, 28.6) + 1.65, 28.6], look: [0, hillHeight(0, 31.6) + 1.45, 31.6], prep: () => { stand(0.2, 29.6, 0); this.ayme.setPose('INTERACT'); }, settle: 1.2 },
      { name: 'cliff-foot', cp: 'ep_cliff', cam: [CLIFF_X - 6, 2.2, -6], look: [CLIFF_X + 1, 4, 10], prep: () => stand(CLIFF_X + 0.3, 5.6, 0.5) },
      { name: 'ribbon', cp: 'ep_cliff', cam: [CLIFF_X + 0.1, 1.15, 6.4], look: [STAKE.x, 1.0, STAKE.z], prep: () => { this.tied = true; this.ribbon.visible = true; stand(CLIFF_X + 0.3, 6.9, 0.9); } },
      { name: 'final-pullback', cp: 'ep_cliff', cam: [CLIFF_X - 1.4, 1.5, 3.2], look: [CLIFF_X + 2.4, 3.2, 16], prep: () => { this.tied = true; this.ribbon.visible = true; stand(CLIFF_X + 0.3, 6.9, 0.9); } },
    ];
  }

  debug() {
    return { met: this.met, tied: this.tied, cp: this.ctx.state.progress.checkpoint };
  }
}
