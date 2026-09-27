import * as THREE from 'three';
import type { Chapter, ChapterContext, CheckpointDef } from '../Chapter';
import type { AssetManifest } from '../../assets/AssetManager';
import type { QualitySettings } from '../../systems/Quality';
import type { Persistable } from '../../state/Persistable';
import type { Sequence } from '../../cinematic/Sequence';
import {
  barkTextures,
  canvasClothTextures,
  foliageAtlas,
  glyphDrumTextures,
  grassGroundTexture,
  groundTextures,
  leafSpriteTexture,
  mistTexture,
  mossTextures,
  muralTextures,
  rustTextures,
  softDotTexture,
  stoneTextures,
  waterfallTexture,
  waterNormalTexture,
  woodTextures,
  type PBRSet,
} from '../../render/textures/ProceduralTextures';
import { RotatingDrumsPuzzle } from '../../puzzles/RotatingDrumsPuzzle';
import { collectible } from '../../story/Collectibles';
import { CH1 } from '../../story/dialogue/ch1';
import type { Line } from '../../story/Dialogue';
import { buildCh1World, type Ch1World } from './Ch1World';
import {
  CAMP,
  CHECKPOINTS,
  CLIFF_BASE,
  DRUMS,
  DRUM_Z,
  GATE,
  LANDING,
  LANDING_FIRE,
  MENU_LOOK,
  MENU_PATH,
  PLATEAU_Y,
  POOL,
  SUN_DIR,
  TOBY_SEAT,
  TRAVERSAL,
  riverZ,
  terrainHeight,
  distToPolyline,
  TRAIL,
  PLATEAU_PATH,
  STREAM,
} from './layout';

const TRAIL_PTS = TRAIL;
const PLATEAU_PTS = PLATEAU_PATH;
const STREAM_PTS = STREAM;
import type { Mood } from '../../audio/AdaptiveMusic';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const CHECKPOINT_ORDER = ['ch1_landing', 'ch1_camp', 'ch1_cliff_base', 'ch1_cliff_top', 'ch1_gate_open'];

interface WorldSave {
  gateOpen: boolean;
  toby: number;
}

interface Timer {
  t: number;
  fn: () => void;
}

/**
 * CHAPTER ONE — THE DISCOVERY (STORY_BIBLE §8).
 * River landing → trail → Camp Four → red-rock cliff traversal → Gate of the Watching Sun
 * (rotating drum puzzle) → gate opening cinematic → the Hollow Meridian revealed.
 */
export default class Chapter1 implements Chapter {
  readonly id = 1;
  readonly title = 'THE DISCOVERY';
  readonly numberLabel = 'CHAPTER ONE';
  readonly checkpoints: Record<string, CheckpointDef> = CHECKPOINTS;
  readonly firstCheckpoint = 'ch1_landing';
  readonly manifest: AssetManifest = {
    id: 'ch1',
    entries: [
      { key: 'tex.ground', type: 'procedural', factory: () => groundTextures(11, 512), weight: 3 },
      { key: 'tex.grass', type: 'procedural', factory: () => grassGroundTexture(21, 512), weight: 2 },
      { key: 'tex.stone', type: 'procedural', factory: () => stoneTextures(1, 512, [150, 140, 122]), weight: 4 },
      { key: 'tex.cliff', type: 'procedural', factory: () => stoneTextures(5, 512, [158, 112, 88], 'cliff'), weight: 4 },
      { key: 'tex.mason', type: 'procedural', factory: () => stoneTextures(9, 512, [160, 152, 132], 'masonry'), weight: 4 },
      { key: 'tex.moss', type: 'procedural', factory: () => mossTextures(7, 256), weight: 1 },
      { key: 'tex.bark', type: 'procedural', factory: () => barkTextures(31, 256), weight: 1 },
      { key: 'tex.canvas', type: 'procedural', factory: () => canvasClothTextures(41, 256), weight: 1 },
      { key: 'tex.wood', type: 'procedural', factory: () => woodTextures(51, 256), weight: 1 },
      { key: 'tex.rust', type: 'procedural', factory: () => rustTextures(61, 256), weight: 1 },
      { key: 'tex.waterN', type: 'procedural', factory: () => waterNormalTexture(71, 256), weight: 1 },
      { key: 'tex.foliage', type: 'procedural', factory: () => foliageAtlas(81, 1024), weight: 2 },
      { key: 'tex.glyphs', type: 'procedural', factory: () => glyphDrumTextures(91, 256), weight: 2 },
      { key: 'tex.mural', type: 'procedural', factory: () => muralTextures(101, 1024, 512), weight: 3 },
      { key: 'tex.dot', type: 'procedural', factory: () => softDotTexture(64) },
      { key: 'tex.mist', type: 'procedural', factory: () => mistTexture(128) },
      { key: 'tex.leaf', type: 'procedural', factory: () => leafSpriteTexture(64) },
      { key: 'tex.waterfall', type: 'procedural', factory: () => waterfallTexture(256) },
    ],
  };

  private ctx!: ChapterContext;
  private w!: Ch1World;
  private puzzle!: RotatingDrumsPuzzle;
  private gateOpen = false;
  private doorK = 1;
  private doorAnim = false;
  private glow = 0;
  private glowTarget = 0;
  private timers: Timer[] = [];
  private time = 0;
  private tobyTalk = 0;
  private worldPersist!: Persistable<WorldSave>;
  private mood: Mood = 'explore';
  private endStarted = false;
  private burstTimer = 0;
  private hintClock = 0;
  private menuCurve = new THREE.CatmullRomCurve3(MENU_PATH);
  private menuLook = new THREE.CatmullRomCurve3(MENU_LOOK);
  private shadowSize = 2048;
  /** Soft cinematic key/fill that follows the camera so the character never vanishes into foliage. */
  private charLight = new THREE.PointLight(new THREE.Color(1.0, 0.86, 0.7), 3.2, 7, 2);
  private rimLight = new THREE.PointLight(new THREE.Color(0.75, 0.9, 1.0), 2.2, 5, 2);

  // ================================================================ load
  async load(ctx: ChapterContext, onProgress: (f: number, label: string) => void): Promise<void> {
    this.ctx = ctx;
    const tex = (k: string) => ctx.assets.get<PBRSet>(k);
    const texture = (k: string) => {
      const t = ctx.assets.get<THREE.Texture | PBRSet>(k);
      return (t as THREE.Texture).isTexture ? (t as THREE.Texture) : (t as PBRSet).map;
    };
    const step = async (f: number, label: string) => {
      onProgress(f, label);
      await new Promise((r) => setTimeout(r, 0));
    };
    this.w = await buildCh1World(ctx, tex, texture, step);
    ctx.traversal.load(TRAVERSAL);
    this.w.root.add(this.charLight, this.rimLight);

    // Puzzle
    this.puzzle = new RotatingDrumsPuzzle(
      'ch1_sun_gate',
      DRUMS.map((d, i) => ({ object: this.w.drums[i], initial: d.initial, solution: d.solution })),
    );
    this.puzzle.onRotateStart = (i) => ctx.audio.sfx.stoneGrind(this.puzzle.rotateTime, this.w.drums[i].position, 0.45);
    this.puzzle.onRotateEnd = (i) => {
      ctx.audio.sfx.clunk(this.w.drums[i].position, 0.5);
      ctx.camera.addTrauma(0.12);
      this.puzzleHints();
    };
    this.puzzle.onSolved = () => this.onPuzzleSolved();
    ctx.state.register(this.puzzle);

    this.worldPersist = {
      key: 'ch1.world',
      version: 1,
      serialize: () => ({ gateOpen: this.gateOpen, toby: this.tobyTalk }),
      restore: (d) => {
        this.gateOpen = d?.gateOpen ?? false;
        this.tobyTalk = d?.toby ?? 0;
      },
    };
    ctx.state.register(this.worldPersist);

    this.setupInteractables();
    this.setupCameraHints();
    this.applyQuality(ctx.quality());
  }

  // ================================================================ interactables
  private setupInteractables(): void {
    const { interaction, player, dialogue, state, events } = this.ctx;
    const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

    for (const [id, obj] of Object.entries(this.w.pickups)) {
      const def = collectible(id)!;
      interaction.add({
        id: `pickup:${id}`,
        position: pos(obj),
        radius: 1.7,
        prompt: def.kind === 'journal' ? 'Read' : 'Pick up',
        enabled: true,
        facing: 0.1,
        priority: 0.5,
        onInteract: () => {
          const it = interaction.get(`pickup:${id}`)!;
          it.enabled = false;
          player.playAction('INTERACT', it.position, 1.1);
          this.after(0.5, () => {
            obj.visible = false;
            state.progress.collectibles.add(id);
            events.emit('collectible:found', { id, title: def.title });
            const lines: Record<string, Line[]> = {
              ch1_journal_1: CH1.journal1,
              ch1_journal_2: CH1.journal2,
              ch1_journal_3: CH1.journal3,
              ch1_relic_token: CH1.relic,
            };
            dialogue.sayOnce(`pickup:${id}`, lines[id] ?? []);
          });
        },
      });
    }

    DRUMS.forEach((d, i) => {
      interaction.add({
        id: `drum:${i}`,
        position: v(d.x, PLATEAU_Y + 1.1, DRUM_Z - 0.1),
        radius: 1.55,
        prompt: 'Turn drum',
        enabled: true,
        facing: 0.35,
        onInteract: () => {
          if (this.puzzle.solved || this.puzzle.busy) return;
          player.playAction('PUSH', v(d.x, PLATEAU_Y, DRUM_Z), 1.2);
          this.after(0.3, () => this.puzzle.rotate(i));
        },
      });
    });

    interaction.add({
      id: 'theodolite',
      position: this.w.theodolitePos.clone().setY(this.w.theodolitePos.y + 1.2),
      radius: 1.8,
      prompt: 'Look through',
      enabled: true,
      onInteract: () => this.playTheodolite(),
    });
    interaction.add({
      id: 'crates',
      position: v(7.8, 0.6, -12.4),
      radius: 2.0,
      prompt: 'Examine',
      enabled: true,
      onInteract: () => {
        player.playAction('INTERACT', v(7.8, 0, -12.4), 1.0);
        dialogue.say(CH1.crates, true);
      },
    });
    interaction.add({
      id: 'mural',
      position: v(-8.8, terrainHeight(-9, 1) + 1.2, 0.1),
      radius: 2.4,
      prompt: 'Examine carving',
      enabled: true,
      facing: 0,
      onInteract: () => dialogue.say(CH1.mural, true),
    });
    interaction.add({
      id: 'gate-mural',
      position: v(-1.6, PLATEAU_Y + 1.2, GATE.z - 1.2),
      radius: 2.2,
      prompt: 'Examine carving',
      enabled: true,
      facing: 0,
      onInteract: () => dialogue.say(CH1.mural, true),
    });
    interaction.add({
      id: 'gate-mural-2',
      position: v(9.6, PLATEAU_Y + 1.2, GATE.z - 1.2),
      radius: 2.2,
      prompt: 'Examine carving',
      enabled: true,
      facing: 0,
      onInteract: () => dialogue.say(CH1.mural, true),
    });
    interaction.add({
      id: 'initials',
      position: v(1.35, PLATEAU_Y + 0.6, GATE.z - 1.2),
      radius: 1.3,
      prompt: 'Examine',
      enabled: true,
      priority: 0.3,
      onInteract: () => {
        player.playAction('INTERACT', v(1.35, PLATEAU_Y, GATE.z - 1), 1.0);
        dialogue.say(CH1.initials, true);
      },
    });
    interaction.add({
      id: 'toby',
      position: TOBY_SEAT.clone().setY(1),
      radius: 2.2,
      prompt: 'Talk to Toby',
      enabled: true,
      facing: 0,
      onInteract: () => {
        const lines = CH1.tobyTalk[this.tobyTalk % CH1.tobyTalk.length];
        this.tobyTalk++;
        dialogue.say(lines, true);
        const t = this.w.toby?.userData.avatar as { driver: { setState: (s: string, o: object) => void } } | undefined;
        t?.driver.setState('SIT', { fade: 0.3 });
      },
    });
  }

  private setupCameraHints(): void {
    this.ctx.camera.hints = [
      { id: 'landing', center: LANDING.clone(), radius: 7, distance: 3.9 },
      { id: 'camp', center: CAMP.clone(), radius: 13, distance: 3.4, fovAdd: -2 },
      { id: 'cliffBase', center: v(10, 0, 15.5), radius: 7, distance: 4.3, pitch: -0.12 },
      { id: 'ridge', center: v(24, PLATEAU_Y, 28.5), radius: 6, distance: 4.4, pitch: 0.12 },
      { id: 'plaza', center: v(GATE.x, PLATEAU_Y, 45), radius: 9, distance: 4.3, heightAdd: 0.15, fovAdd: 3 },
      { id: 'terrace', center: v(4, PLATEAU_Y, 57), radius: 5, distance: 4.6, fovAdd: 6 },
    ];
  }

  // ================================================================ restore / begin
  onRestored(checkpoint: string, isNewGame: boolean): void {
    const { player, camera, dialogue, state } = this.ctx;
    this.timers = [];
    this.endStarted = false;
    dialogue.clear();
    // World state
    this.setGate(this.gateOpen || this.puzzle.solved ? 1 : 0);
    this.glow = this.glowTarget = this.puzzle.solved ? 1 : 0;
    this.w.drumGlow.emissiveIntensity = this.glow * 2.6;
    for (const [id, obj] of Object.entries(this.w.pickups)) {
      const found = state.progress.collectibles.has(id);
      obj.visible = !found;
      const it = this.ctx.interaction.get(`pickup:${id}`);
      if (it) it.enabled = !found;
    }
    // Player placement: exact saved spot (manual/auto save) or the checkpoint.
    const pr = player.pendingRestore;
    player.pendingRestore = null;
    const cp = this.checkpoints[checkpoint] ?? this.checkpoints[this.firstCheckpoint];
    if (!isNewGame && pr) player.teleport(pr.pos, pr.yaw);
    else player.teleport(cp.pos, cp.yaw);
    player.setScripted(false);
    player.avatar.setVisible(true);
    camera.snap(player, player.yaw, 0.2);
    // Audio
    this.ctx.audio.ambience.start({
      wind: 0.8,
      insects: 1,
      birds: 1,
      frogs: 1,
      drips: 1,
      water: [
        { pos: v(-4, 0, riverZ(-4)), gain: 0.28, kind: 'river' },
        { pos: v(18, 0, riverZ(18)), gain: 0.22, kind: 'river' },
        { pos: v(-30, 0, riverZ(-30)), gain: 0.2, kind: 'river' },
        { pos: POOL.clone().setY(3), gain: 0.5, kind: 'falls' },
        { pos: v(-13, 0, -24), gain: 0.07, kind: 'river' },
      ],
    });
    this.mood = 'explore';
    if (!isNewGame) this.ctx.audio.music.setMood(this.gateOpen ? 'wonder' : 'explore', 2);
  }

  begin(isNewGame: boolean): void {
    const p = this.ctx.state.progress;
    if (isNewGame || !p.flag('ch1_intro_seen')) this.playIntro();
    else this.ctx.hud.chapterCard(this.numberLabel, this.title, 3.2);
  }

  // ================================================================ update
  update(dt: number, realDt: number): void {
    const { player, camera } = this.ctx;
    this.time += dt;
    // Timers (game time — they pause with the game)
    if (this.timers.length) {
      for (const t of [...this.timers]) {
        t.t -= dt;
        if (t.t <= 0) {
          this.timers.splice(this.timers.indexOf(t), 1);
          t.fn();
        }
      }
    }
    this.puzzle.update(dt);

    // Sun + shadow camera follow the player (snapped to texels to avoid shimmer).
    const focus = this.ctx.cinematic.playing ? this.ctx.renderer.camera.position : player.position;
    const texel = 64 / this.shadowSize;
    const tx = Math.round(focus.x / texel) * texel;
    const tz = Math.round(focus.z / texel) * texel;
    this.w.sun.target.position.set(tx, focus.y, tz);
    this.w.sun.position.set(tx, focus.y, tz).addScaledVector(SUN_DIR, 110);
    this.w.sky.follow(this.ctx.renderer.camera);

    // Vegetation LOD / distance culling
    const cam = this.ctx.renderer.camera.position;
    for (const veg of this.w.vegetation) veg.update(realDt, cam);
    this.w.terrain.update(realDt, cam);

    // Character lighting: warm fill from the camera side, cool rim from behind.
    {
      const cp = this.ctx.renderer.camera.position;
      const pp = player.position;
      this.charLight.position.set(pp.x + (cp.x - pp.x) * 0.45, pp.y + 2.1, pp.z + (cp.z - pp.z) * 0.45);
      this.rimLight.position.set(pp.x - (cp.x - pp.x) * 0.35, pp.y + 2.0, pp.z - (cp.z - pp.z) * 0.35);
      const cine = this.ctx.cinematic.playing ? 0.6 : 1;
      this.charLight.intensity = 3.2 * cine;
      this.rimLight.intensity = 2.2 * cine;
    }
    // Fire flicker
    const ft = this.time;
    this.w.fireLight.intensity = 12 + Math.sin(ft * 13) * 1.6 + Math.sin(ft * 7.3) * 1.2 + Math.sin(ft * 23) * 0.8;
    if (this.w.flames) {
      this.w.flames.children.forEach((f, i) => {
        const s = 0.85 + Math.sin(ft * (9 + i) + f.userData.phase) * 0.18;
        f.scale.set(s, 0.8 + Math.sin(ft * (11 + i * 2) + f.userData.phase) * 0.25, s);
      });
    }
    // Toby
    const toby = this.w.toby?.userData.avatar as { driver: { update: (dt: number, p: { speed: number; rate: number }) => void } } | undefined;
    toby?.driver.update(dt, { speed: 0, rate: 1 });

    // Drum glow + gate door animation
    this.glow += (this.glowTarget - this.glow) * Math.min(1, dt * 1.5);
    this.w.drumGlow.emissiveIntensity = this.glow * 2.6 * (0.85 + Math.sin(ft * 2) * 0.15);
    if (this.doorAnim) {
      this.doorK = Math.min(1, this.doorK + dt / 7);
      this.setGate(this.doorK);
      this.burstTimer -= dt;
      if (this.burstTimer <= 0 && this.doorK < 0.95) {
        this.burstTimer = 0.25;
        this.w.bursts.emit(this.w.lintel, 14, v(7, 0.4, 1), v(0, -0.5, -0.6), 1.2, 3.2);
        this.w.bursts.emit(v(GATE.x, PLATEAU_Y + 0.2, GATE.z - 0.5), 8, v(4, 0.2, 0.6), v(0, 1.2, -1.4), 1.4, 2.2);
      }
      if (this.doorK >= 1) this.doorAnim = false;
    }
    this.w.bursts.update(dt);

    // Collectible glints
    this.updateGlints();

    // Thinner air over the gorge vista so the city reads through the haze.
    const fog = this.ctx.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      const camZ = this.ctx.renderer.camera.position.z;
      const target = camZ > 53 ? 0.0042 : 0.0078;
      fog.density += (target - fog.density) * Math.min(1, dt * 1.5);
    }
    // Environment audio exposure
    this.ctx.audio.ambience.exposure = player.position.y > 9 ? 0.9 : 0;

    if (this.ctx.cinematic.playing || player.mode.kind === 'scripted') return;
    this.triggers();
    // Puzzle idle hint
    if (!this.puzzle.solved && player.position.distanceTo(v(GATE.x, PLATEAU_Y, 45)) < 8) {
      this.hintClock += dt;
      if (this.hintClock > 75) this.ctx.dialogue.sayOnce('hint:idle', CH1.hintSoft);
    }
    void camera;
  }

  private triggers(): void {
    const { player, dialogue, state } = this.ctx;
    const p = player.position;
    const say = (id: string, lines: Line[]) => dialogue.sayOnce(id, lines);
    if (p.z > -52 && p.z < -30) say('trail', CH1.trail);
    if (Math.hypot(p.x - CAMP.x, p.z - CAMP.z) < 15) {
      this.checkpoint('ch1_camp');
      say('campReveal', CH1.campReveal);
    }
    if (Math.hypot(p.x - 2.8, p.z + 1.8) < 3) say('theodoliteHint', [{ speaker: 'INES', text: "Anselm Roy's theodolite. Still set up." }]);
    if (p.distanceTo(CLIFF_BASE) < 5 && p.y < 2) {
      this.checkpoint('ch1_cliff_base');
      say('cliffBase', CH1.cliffBase);
    }
    if (player.mode.kind === 'ledge') {
      say('narrow', CH1.narrow);
      this.setMood('tension');
    } else if (this.mood === 'tension' && player.grounded && p.y > 11) this.setMood('explore');
    if (p.y > PLATEAU_Y - 0.6 && p.z > 23.5 && p.z < 34 && player.grounded) {
      this.checkpoint('ch1_cliff_top');
      say('cliffTop', CH1.cliffTop);
    }
    if (p.y > PLATEAU_Y - 0.6 && p.z > 37) {
      if (say('gateReveal', CH1.gateReveal)) this.setMood('wonder');
    }
    if (p.y > PLATEAU_Y - 0.6 && p.z > 43 && dialogue.hasPlayed('gateReveal') && !dialogue.busy) say('drumsHint', CH1.drumsHint);
    // End of chapter: onto the overlook terrace.
    if (this.gateOpen && p.z > 55 && !this.endStarted && !state.progress.flag('ch1_complete')) {
      this.endStarted = true;
      this.playCityReveal();
    }
  }

  private checkpoint(id: string): void {
    const cur = CHECKPOINT_ORDER.indexOf(this.ctx.state.progress.checkpoint);
    if (CHECKPOINT_ORDER.indexOf(id) > cur) this.ctx.reachCheckpoint(id);
  }

  private setMood(m: Mood): void {
    if (this.mood === m) return;
    this.mood = m;
    this.ctx.audio.music.setMood(m, m === 'tension' ? 2 : 4);
  }

  private puzzleHints(): void {
    const n = this.puzzle.rotations;
    if (this.puzzle.solved) return;
    if (n >= 10) this.ctx.dialogue.sayOnce('hint:soft', CH1.hintSoft);
    if (n >= 20) this.ctx.dialogue.sayOnce('hint:strong', CH1.hintStrong);
  }

  private after(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }

  private updateGlints(): void {
    const g = this.w.glints;
    const attr = g.geometry.attributes.position as THREE.BufferAttribute;
    let i = 0;
    const tmp = new THREE.Vector3();
    for (const obj of Object.values(this.w.pickups)) {
      if (!obj.visible) {
        attr.setXYZ(i++, 0, -999, 0);
        continue;
      }
      obj.getWorldPosition(tmp);
      attr.setXYZ(i++, tmp.x, tmp.y + 0.12, tmp.z);
    }
    attr.needsUpdate = true;
    (g.material as THREE.PointsMaterial).size = 0.22 + Math.max(0, Math.sin(this.time * 2.4)) * 0.28;
  }

  // ================================================================ gate
  private setGate(k: number): void {
    this.doorK = k;
    const Y = PLATEAU_Y;
    this.w.door.position.y = Y + 3.4 - k * 6.95;
    this.w.door.visible = k < 0.999;
    this.w.doorCollider.enabled = k < 0.6;
    this.w.gorge.visible = k > 0.02;
    for (const c of this.w.terraceColliders) c.enabled = k > 0.5;
  }

  private onPuzzleSolved(): void {
    const { state } = this.ctx;
    state.progress.completedPuzzles.add('ch1_sun_gate');
    this.ctx.events.emit('puzzle:solved', { id: 'ch1_sun_gate' });
    this.glowTarget = 1;
    this.ctx.dialogue.clear();
    this.after(0.9, () => this.playGateOpening());
  }

  // ================================================================ cinematics
  private scripted(on: boolean, anim: 'CINEMATIC' | 'IDLE' = 'CINEMATIC'): void {
    const p = this.ctx.player;
    p.setScripted(on);
    if (on) p.avatar.driver.setState(anim, { fade: 0.4 });
    else p.avatar.driver.setState('IDLE', { fade: 0.4 });
  }

  private playIntro(): void {
    const { cinematic, dialogue, hud, audio, state, player, camera } = this.ctx;
    const cp = this.checkpoints.ch1_landing;
    player.teleport(cp.pos, cp.yaw);
    this.scripted(true, 'IDLE');
    audio.music.setMood('explore', 5);
    const seq: Sequence = {
      id: 'ch1_intro',
      duration: 16.5,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.8,
      shots: [
        {
          t0: 0,
          t1: 6.8,
          path: [v(-62, 30, -75), v(-34, 19, -73.5), v(-13, 9, -69.5), v(-1, 4.5, -65)],
          look: [v(4, 18, 34), v(2, 8, -18), v(0.5, 1.6, -58)],
          fov: [42, 46],
          ease: 'inOut',
          sway: 0.05,
        },
        {
          t0: 6.8,
          t1: 11.6,
          path: [v(5.6, 1.5, -54.6), v(4.6, 1.35, -55.4)],
          look: [v(0.4, 1.1, -58.4), v(0.8, 1.15, -58.2)],
          fov: [38, 36],
          ease: 'linear',
          sway: 0.02,
        },
        {
          t0: 11.6,
          t1: 16.5,
          path: [v(-3.4, 2.5, -61.2), v(-2.6, 2.15, -60.2)],
          look: [v(0.5, 3.5, -30), v(0, 3.2, -28)],
          fov: [50, 58],
          ease: 'inOut',
          sway: 0.02,
        },
      ],
      events: [
        { t: 0.8, run: (skip) => !skip && hud.chapterCard('A CINEMATIC ADVENTURE', 'THE FINAL EXPEDITION', 5), onSkip: false },
        { t: 7.0, run: (skip) => dialogue.sayOnce('intro', CH1.intro, skip) },
        { t: 15.2, run: () => hud.chapterCard(this.numberLabel, this.title, 4.2) },
        {
          t: 16.4,
          run: () => {
            state.progress.setFlag('ch1_intro_seen');
            this.scripted(false);
            camera.snap(player, cp.yaw, 0.2);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playTheodolite(): void {
    const { cinematic, dialogue, player, camera } = this.ctx;
    const head = new THREE.Vector3();
    this.w.theodoliteHead.getWorldPosition(head);
    const aim = GATE.clone().add(v(0, 3, 0));
    const dir = aim.clone().sub(head).normalize();
    const eye = head.clone().addScaledVector(dir, -0.25).add(v(0, 0.12, 0));
    player.playAction('INTERACT', head, 1.0);
    const yaw0 = camera.yaw;
    const seq: Sequence = {
      id: 'ch1_theodolite',
      duration: 6.5,
      skippable: true,
      letterbox: true,
      dof: false,
      blendOut: 1.2,
      shots: [
        { t0: 0, t1: 1.2, path: [camera.output.position.clone(), eye.clone().addScaledVector(dir, -0.6).add(v(0.3, 0.2, 0))], look: [head.clone(), aim.clone()], fov: [camera.output.fov, 45], ease: 'inOut', sway: 0 },
        { t0: 1.2, t1: 6.5, path: [eye.clone(), eye.clone().addScaledVector(dir, 0.1)], look: [aim.clone(), aim.clone().add(v(0, -1.5, 0))], fov: [40, 14], ease: 'inOut', sway: 0.005 },
      ],
      events: [
        { t: 0.1, run: () => this.scripted(true) },
        { t: 1.6, run: (s) => dialogue.sayOnce('theodolite', CH1.theodolite, s) },
        {
          t: 6.4,
          run: () => {
            this.scripted(false);
            camera.yaw = yaw0;
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playGateOpening(): void {
    const { cinematic, dialogue, player, camera, audio, reachCheckpoint } = this.ctx;
    const stand = v(GATE.x, PLATEAU_Y, 44.2);
    const Y = PLATEAU_Y;
    const gz = GATE.z;
    const seq: Sequence = {
      id: 'ch1_gate_open',
      duration: 14,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 2.2,
      shots: [
        { t0: 0, t1: 3, path: [v(6.8, Y + 1.6, 44.2), v(6.2, Y + 1.5, 44.6)], look: [v(4, Y + 1.2, DRUM_Z), v(3.6, Y + 1.3, DRUM_Z)], fov: [40, 38], ease: 'linear', sway: 0.01 },
        { t0: 3, t1: 8.5, path: [v(-1.5, Y + 1.2, 41), v(-3.5, Y + 3.2, 37), v(-4.5, Y + 5.5, 34)], look: [v(4, Y + 4.5, gz), v(4, Y + 4, gz)], fov: [42, 50], ease: 'inOut', sway: 0.03 },
        { t0: 8.5, t1: 14, path: [v(5.2, Y + 1.9, 42.4), v(4.5, Y + 2.0, 45.2)], look: [v(4, Y + 2.8, gz + 10), v(4, Y + 1.5, gz + 30)], fov: [48, 54], ease: 'inOut', sway: 0.02 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(stand, 0);
            this.scripted(true);
          },
        },
        { t: 0.3, run: (s) => !s && audio.sfx.clunk(this.w.drums[2].position, 0.7), onSkip: false },
        { t: 0.7, run: (s) => !s && audio.sfx.clunk(this.w.drums[1].position, 0.7), onSkip: false },
        { t: 1.1, run: (s) => !s && audio.sfx.clunk(this.w.drums[0].position, 0.7), onSkip: false },
        {
          t: 1.8,
          run: (s) => {
            if (s) return;
            audio.sfx.rumble(9, v(GATE.x, Y + 3, gz), 0.9);
            audio.music.setMood('tension', 1.5);
            camera.addTrauma(0.5);
          },
          onSkip: false,
        },
        {
          t: 2.2,
          run: (s) => {
            if (s) this.setGate(1);
            else {
              this.doorK = 0;
              this.doorAnim = true;
            }
          },
        },
        { t: 3.5, run: (s) => !s && camera.addTrauma(0.45), onSkip: false },
        { t: 4.2, run: () => dialogue.sayOnce('gateOpen', CH1.gateOpen, true) },
        { t: 6.0, run: (s) => !s && camera.addTrauma(0.35), onSkip: false },
        { t: 9.2, run: () => audio.music.setMood('wonder', 3) },
        {
          t: 13.9,
          run: () => {
            this.setGate(1);
            this.doorAnim = false;
            this.gateOpen = true;
            this.scripted(false);
            reachCheckpoint('ch1_gate_open');
            camera.snap(player, 0, 0.15);
          },
        },
      ],
    };
    void cinematic.play(seq);
  }

  private playCityReveal(): void {
    const { cinematic, dialogue, player, audio, completeChapter } = this.ctx;
    const Y = PLATEAU_Y;
    const stand = v(4, Y, 58.6);
    const seq: Sequence = {
      id: 'ch1_city_reveal',
      duration: 60,
      skippable: true,
      letterbox: true,
      dof: true,
      blendOut: 1.5,
      shots: [
        // Over-the-shoulder: Ines steps to the parapet; the camera rises past her.
        { t0: 0, t1: 5, path: [v(5.4, Y + 1.7, 55.2), v(5.9, Y + 1.9, 56.4)], look: [v(4.2, Y + 1.5, 60), v(6, Y - 4, 96)], fov: [48, 50], ease: 'inOut', sway: 0.02, focus: 70 },
        // Pull up and out over the gorge: the city, the tower, the falls.
        { t0: 5, t1: 15, path: [v(5.9, Y + 1.9, 56.4), v(7.5, Y + 4.5, 57.2), v(9, Y + 7.5, 59.5)], look: [v(6, Y - 4, 96), v(11, -12, 124), v(14, -6, 138)], fov: [50, 46], ease: 'inOut', sway: 0.03, focus: 95 },
        // Hold on the vista with Ines in silhouette at the parapet.
        { t0: 15, t1: 60, path: [v(9, Y + 7.5, 59.5), v(8.4, Y + 7.8, 60.4)], look: [v(14, -6, 138), v(13, -4, 140)], fov: [46, 44], ease: 'linear', sway: 0.03, focus: 110 },
      ],
      events: [
        {
          t: 0.05,
          run: () => {
            player.teleport(stand, 0);
            this.scripted(true);
          },
        },
        { t: 0.2, run: () => audio.music.setMood('wonder', 2) },
        { t: 3.5, run: () => dialogue.sayOnce('cityReveal', CH1.cityReveal, true) },
        { t: 12, run: () => completeChapter() },
      ],
    };
    void cinematic.play(seq);
  }

  // ================================================================ menu / misc
  menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void {
    const k = (Math.sin((t / 80) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    out.position.copy(this.menuCurve.getPoint(0.05 + k * 0.9));
    out.look.copy(this.menuLook.getPoint(0.05 + k * 0.9));
    out.position.y += Math.sin(t * 0.3) * 0.3;
  }

  private mapImage: import('../../ui/Minimap').MinimapImage | null = null;

  /** Stylised top-down map baked once from the layout (north-up, +X/west to the left). */
  minimap(): import('../../ui/Minimap').MinimapImage {
    if (this.mapImage) return this.mapImage;
    const minX = -42, maxX = 46, minZ = -68, maxZ = 62;
    const ppm = 2; // pixels per metre
    const w = Math.round((maxX - minX) * ppm);
    const h = Math.round((maxZ - minZ) * ppm);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(w, h);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const x = maxX - px / ppm;
        const z = maxZ - py / ppm;
        const hgt = terrainHeight(x, z);
        const hx = terrainHeight(x - 0.7, z) - terrainHeight(x + 0.7, z);
        const hz = terrainHeight(x, z + 0.7) - terrainHeight(x, z - 0.7);
        const shade = Math.max(0.55, Math.min(1.25, 1 + (hx * 0.35 - hz * 0.35)));
        let r = 44, g = 62, b = 44; // forest floor
        if (hgt > PLATEAU_Y - 1 && z > 26) [r, g, b] = [72, 82, 56]; // plateau
        if (hgt > 16 || (z > 22.4 && z < 27.3 && x > -31 && x < 35)) [r, g, b] = [96, 64, 48]; // rock / cliff
        const dTrail = distToPolyline(x, z, TRAIL_PTS);
        const dPlat = z > 26 ? distToPolyline(x, z, PLATEAU_PTS) : 99;
        if (Math.min(dTrail, dPlat) < 1.6) [r, g, b] = [150, 120, 82];
        if (Math.hypot(x - CAMP.x, z - CAMP.z) < 10) [r, g, b] = [118, 96, 66];
        if (Math.abs(z - riverZ(x)) < 7.2 || distToPolyline(x, z, STREAM_PTS) < 1.3 || Math.hypot(x - POOL.x, z - POOL.z) < 5) [r, g, b] = [52, 96, 108];
        if (z > 49.4 && z < 51.8 && x > -30 && x < 36 && !(x > 1.9 && x < 6.1)) [r, g, b] = [150, 142, 120]; // gate wall
        if (z > 52.6 && x > -0.5 && x < 8.5 && z < 61) [r, g, b] = [150, 142, 120]; // terrace
        const i = (py * w + px) * 4;
        img.data[i] = r * shade;
        img.data[i + 1] = g * shade;
        img.data[i + 2] = b * shade;
        img.data[i + 3] = 255;
      }
    c.putImageData(img, 0, 0);
    this.mapImage = { image: cv, minX, maxX, minZ, maxZ };
    return this.mapImage;
  }

  objectiveTarget(): THREE.Vector3 | null {
    const p = this.ctx.state.progress;
    const cp = CHECKPOINT_ORDER.indexOf(p.checkpoint);
    if (p.flag('ch1_complete')) return null;
    if (this.gateOpen) return v(4, PLATEAU_Y, 56.5);
    if (cp >= 3) return v(GATE.x, PLATEAU_Y, DRUM_Z);
    if (cp >= 2) return v(28.8, 12, 25); // the ridge top above the climb
    if (cp >= 1) return CLIFF_BASE.clone();
    return CAMP.clone();
  }

  mapPoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [TOBY_SEAT.clone()];
    const cp = CHECKPOINT_ORDER.indexOf(this.ctx.state.progress.checkpoint);
    if (cp >= 1) pts.push(CAMP.clone());
    if (cp >= 3) pts.push(v(GATE.x, PLATEAU_Y, GATE.z));
    return pts;
  }

  objective(): string {
    const p = this.ctx.state.progress;
    const cp = CHECKPOINT_ORDER.indexOf(p.checkpoint);
    if (this.gateOpen) return 'Step through the Gate of the Watching Sun.';
    if (this.ctx.dialogue.hasPlayed('gateReveal')) return 'Open the Gate of the Watching Sun. Marta was here — her notes may help.';
    if (cp >= 3) return 'Find what the 1958 expedition was sighting on the ridge.';
    if (cp >= 2) return 'Follow the red ribbons up the cliff to the ridge.';
    if (cp >= 1) return 'Search Camp Four, then follow the trail north toward the cliff.';
    return 'Follow the old trail upriver to the expedition\'s abandoned Camp Four.';
  }

  applyQuality(q: QualitySettings): void {
    if (!this.w) return;
    const s = q.shadows ? q.shadowMapSize : 512;
    if (s !== this.shadowSize) {
      this.shadowSize = s;
      this.w.sun.shadow.mapSize.set(s, s);
      this.w.sun.shadow.map?.dispose();
      this.w.sun.shadow.map = null;
    }
    this.w.sun.castShadow = q.shadows;
    for (const veg of this.w.vegetation) {
      const n = veg.group.name;
      if (n === 'grass') {
        veg.applyDensity(q.vegetationDensity);
        veg.maxDistance = q.grassDistance;
      } else if (n === 'far-forest') {
        veg.maxDistance = q.preset === 'low' ? 260 : q.preset === 'medium' ? 450 : 700;
      } else if (n === 'ferns' || n === 'broadleaf') {
        veg.applyDensity(q.preset === 'low' ? 0.45 : Math.min(1, q.vegetationDensity + 0.2));
        veg.maxDistance = q.vegetationDistance * 0.6;
        // Understory shadows are a HIGH-only luxury (large draw-call cost in the shadow pass).
        veg.setCastShadow(q.preset === 'high');
      } else if (n === 'canopy' || n === 'trunks' || n.startsWith('treefern')) {
        veg.maxDistance = q.vegetationDistance;
        veg.lodDistance = q.vegetationDistance * 0.45;
      }
      veg.update(0, this.ctx.renderer.camera.position, true);
    }
    for (const s2 of this.w.shafts) s2.visible = q.lightShafts;
    this.w.terrain.lodDistance = q.preset === 'low' ? 60 : q.preset === 'medium' ? 90 : 120;
    this.w.terrain.update(0, this.ctx.renderer.camera.position, true);
  }

  dispose(): void {
    this.ctx.state.unregister(this.puzzle.key);
    this.ctx.state.unregister(this.worldPersist.key);
    this.ctx.camera.hints = [];
    this.w.dispose();
  }
}

// Keep layout constants referenced for tree-shaking clarity.
void LANDING_FIRE;
