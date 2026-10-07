import * as THREE from 'three';
import type { Chapter, ChapterContext, CheckpointDef } from '../Chapter';
import type { AssetManifest } from '../../assets/AssetManager';
import type { QualitySettings } from '../../systems/Quality';
import type { Persistable } from '../../state/Persistable';
import type { Mood } from '../../audio/AdaptiveMusic';
import type { AmbienceConfig } from '../../audio/Ambience';
import type { Line } from '../../story/Dialogue';
import type { Sequence } from '../../cinematic/Sequence';
import type { PBRSet } from '../../render/textures/ProceduralTextures';
import type { MinimapImage } from '../../ui/Minimap';
import type { CharacterId } from '../../animation/CharacterAvatar';
import type { AnimState } from '../../animation/AnimationDriver';
import { collectible } from '../../story/Collectibles';
import { NpcActor } from '../../actors/NpcActor';
import { LevelKit, v } from './LevelKit';

export interface HeroFrame {
  name: string;
  cp: string;
  cam: [number, number, number];
  look: [number, number, number];
  prep?: () => void;
  /** Seconds to let animation/particles settle before the capture. */
  settle?: number;
}

interface Timer {
  t: number;
  fn: () => void;
}

export interface PickupSpec {
  id: string;
  object: THREE.Object3D;
  lines?: Line[];
  prompt?: string;
  radius?: number;
}

/**
 * Shared plumbing for Chapters 2+ (Chapter 1 predates it and stays as-is):
 * load/restore/update lifecycle, game-time timers, ordered checkpoints, pickups + glints,
 * NPC actors, sun/shadow following, character key/rim lights, vegetation LOD, quality,
 * chapter world-state persistence, minimap baking and disposal.
 * Subclasses author the level (`build`), its interactions (`setup`) and story (`triggers`).
 */
export abstract class ChapterBase implements Chapter {
  abstract readonly id: number;
  abstract readonly title: string;
  abstract readonly numberLabel: string;
  abstract readonly checkpoints: Record<string, CheckpointDef>;
  abstract readonly firstCheckpoint: string;
  abstract readonly manifest: AssetManifest;
  /** Checkpoints in story order (a checkpoint is only taken if it's further along). */
  protected abstract readonly checkpointOrder: string[];

  protected ctx!: ChapterContext;
  protected kit!: LevelKit;
  protected time = 0;
  private timers: Timer[] = [];
  protected mood: Mood = 'explore';
  protected pickups: PickupSpec[] = [];
  private glintPts: THREE.Points | null = null;
  protected npcs: NpcActor[] = [];
  protected sunDir = v(0.5, 0.6, 0.6).normalize();
  protected shadowRange = 32;
  private shadowSize = 2048;
  protected charLight = new THREE.PointLight(new THREE.Color(1.0, 0.88, 0.74), 1.1, 6, 2);
  protected rimLight = new THREE.PointLight(new THREE.Color(0.75, 0.9, 1.0), 1.4, 5, 2);
  protected charLightScale = 1;
  private persist!: Persistable<Record<string, unknown>>;
  private offDied: (() => void) | null = null;
  protected fellOnce = false;
  private mapImage: MinimapImage | null = null;
  protected disposers: (() => void)[] = [];
  /** Material tuning for this level's kit (moss amounts). */
  /** Hero-frame capture: story triggers are suspended so staging can't start cinematics. */
  heroMode = false;
  protected kitOptions: { cliffMoss?: number; masonMoss?: number } = {};

  // ---------------------------------------------------------------- authoring hooks
  /** Build geometry, colliders, traversal data. Use `this.kit`. */
  protected abstract build(step: (f: number, label: string) => Promise<void>): Promise<void>;
  /** Interactables, puzzles, camera hints (after build). */
  protected abstract setup(): void;
  /** Chapter state that must survive checkpoints/saves. */
  protected abstract saveWorld(): Record<string, unknown>;
  protected abstract loadWorld(d: Record<string, unknown> | undefined): void;
  /** Rebuild visuals from the (restored) state; player placement is handled by the base. */
  protected abstract applyWorld(checkpoint: string): void;
  protected abstract ambience(): AmbienceConfig;
  protected abstract intro(): void;
  /** Per-frame story checks (skipped during cinematics/scripted moments). */
  protected abstract triggers(dt: number): void;
  /** Per-frame animation (always runs). */
  protected tick(dt: number, realDt: number): void {
    void dt;
    void realDt;
  }
  abstract objective(): string;
  abstract menuCamera(t: number, out: { position: THREE.Vector3; look: THREE.Vector3 }): void;
  /** Minimap: bounds + a colour for each world point. */
  protected mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  protected mapColor(x: number, z: number): [number, number, number] {
    void x;
    void z;
    return [60, 66, 58];
  }
  protected mapHeight(x: number, z: number): number {
    return this.ctx.world.groundAt(x, z, 1e4).y;
  }
  objectiveTarget(): THREE.Vector3 | null {
    return null;
  }
  /**
   * PRD §55 hero frames: fixed no-UI shots reviewed against the AAA fail conditions.
   * `prep` stages the moment (player pose, door states); the camera is then frozen.
   */
  heroFrames(): HeroFrame[] {
    return [];
  }
  mapPoints(): THREE.Vector3[] {
    return [];
  }

  // ---------------------------------------------------------------- lifecycle
  async load(ctx: ChapterContext, onProgress: (f: number, label: string) => void): Promise<void> {
    this.ctx = ctx;
    const tex = (k: string) => ctx.assets.get<PBRSet>(k);
    const texture = (k: string) => {
      const t = ctx.assets.get<THREE.Texture | PBRSet>(k);
      return (t as THREE.Texture).isTexture ? (t as THREE.Texture) : (t as PBRSet).map;
    };
    this.kit = new LevelKit(ctx, `ch${this.id}`, 1958 + this.id * 101, tex, texture, this.kitOptions);
    const step = async (f: number, label: string) => {
      onProgress(f, label);
      await new Promise((r) => setTimeout(r, 0));
    };
    await this.build(step);
    this.kit.root.add(this.charLight, this.rimLight);
    // Pickups registered by build()
    this.glintPts = this.kit.glints(this.pickups.length);
    this.setupPickups();
    this.persist = {
      key: `ch${this.id}.world`,
      version: 1,
      serialize: () => this.saveWorld(),
      restore: (d) => this.loadWorld(d),
    };
    ctx.state.register(this.persist);
    this.setup();
    this.applyQuality(ctx.quality());
    this.offDied = ctx.events.on('player:died', () => (this.fellOnce = true));
    onProgress(1, 'Ready');
  }

  protected npc(id: CharacterId, at: THREE.Vector3, yaw: number, pose: AnimState = 'IDLE'): NpcActor {
    const a = new NpcActor(this.ctx.createAvatar(id), this.ctx.world, this.kit.root);
    a.place(at, yaw, pose);
    this.npcs.push(a);
    return a;
  }

  protected pickup(id: string, object: THREE.Object3D, lines?: Line[], opts: { prompt?: string; radius?: number } = {}): void {
    if (!object.parent) this.kit.root.add(object);
    this.pickups.push({ id, object, lines, prompt: opts.prompt, radius: opts.radius });
  }

  private setupPickups(): void {
    const { interaction, player, dialogue, state, events } = this.ctx;
    for (const pk of this.pickups) {
      const def = collectible(pk.id);
      if (!def) throw new Error(`Unknown collectible ${pk.id}`);
      const pos = pk.object.getWorldPosition(new THREE.Vector3());
      interaction.add({
        id: `pickup:${pk.id}`,
        position: pos,
        radius: pk.radius ?? 1.7,
        prompt: pk.prompt ?? (def.kind === 'relic' ? 'Pick up' : def.kind === 'photo' ? 'Look' : def.kind === 'recording' ? 'Listen' : 'Read'),
        enabled: true,
        facing: 0.1,
        priority: 0.5,
        onInteract: () => {
          const it = interaction.get(`pickup:${pk.id}`)!;
          it.enabled = false;
          player.playAction('INTERACT', it.position, 1.1);
          this.after(0.5, () => {
            pk.object.visible = false;
            state.progress.collectibles.add(pk.id);
            events.emit('collectible:found', { id: pk.id, title: def.title });
            if (pk.lines) dialogue.sayOnce(`pickup:${pk.id}`, pk.lines);
          });
        },
      });
    }
  }

  onRestored(checkpoint: string, isNewGame: boolean): void {
    const { player, camera, dialogue, state } = this.ctx;
    this.timers = [];
    this.move = null;
    dialogue.clear();
    for (const pk of this.pickups) {
      const found = state.progress.collectibles.has(pk.id);
      pk.object.visible = !found;
      const it = this.ctx.interaction.get(`pickup:${pk.id}`);
      if (it) it.enabled = !found;
    }
    const pr = player.pendingRestore;
    player.pendingRestore = null;
    const cp = this.checkpoints[checkpoint] ?? this.checkpoints[this.firstCheckpoint];
    if (!isNewGame && pr) player.teleport(pr.pos, pr.yaw);
    else player.teleport(cp.pos, cp.yaw);
    player.setScripted(false);
    player.avatar.setVisible(true);
    this.applyWorld(checkpoint);
    camera.snap(player, player.yaw, 0.2);
    this.ctx.audio.ambience.start(this.ambience());
    this.mood = 'explore';
    if (!isNewGame) this.ctx.audio.music.setMood(this.restoreMood(), 2);
    if (this.fellOnce) {
      this.fellOnce = false;
      this.onRespawned();
    }
  }

  protected restoreMood(): Mood {
    return 'explore';
  }

  /** After a death + respawn (once per death). */
  protected onRespawned(): void {}

  begin(isNewGame: boolean): void {
    const p = this.ctx.state.progress;
    if (isNewGame || !p.flag(`ch${this.id}_intro_seen`)) this.intro();
    else this.ctx.hud.chapterCard(this.numberLabel, this.title, 3.2);
  }

  update(dt: number, realDt: number): void {
    const { player } = this.ctx;
    this.time += dt;
    if (this.timers.length) {
      for (const t of [...this.timers]) {
        t.t -= dt;
        if (t.t <= 0) {
          const i = this.timers.indexOf(t);
          if (i >= 0) this.timers.splice(i, 1);
          t.fn();
        }
      }
    }
    // Sun + shadow camera follow the player (snapped to texels).
    const cam = this.ctx.renderer.camera.position;
    const focus = this.ctx.cinematic.playing ? cam : player.position;
    const texel = (this.shadowRange * 2) / this.shadowSize;
    const tx = Math.round(focus.x / texel) * texel;
    const tz = Math.round(focus.z / texel) * texel;
    if (this.kit.sun) {
      this.kit.sun.target.position.set(tx, focus.y, tz);
      this.kit.sun.position.set(tx, focus.y, tz).addScaledVector(this.sunDir, 120);
    }
    this.kit.sky?.follow(this.ctx.renderer.camera);
    for (const veg of this.kit.vegetation) veg.update(realDt, cam);
    this.kit.terrain?.update(realDt, cam);
    {
      const pp = player.position;
      this.charLight.position.set(pp.x + (cam.x - pp.x) * 0.45, pp.y + 2.1, pp.z + (cam.z - pp.z) * 0.45);
      this.rimLight.position.set(pp.x - (cam.x - pp.x) * 0.35, pp.y + 2.0, pp.z - (cam.z - pp.z) * 0.35);
      const cine = this.ctx.cinematic.playing ? 0.6 : 1;
      this.charLight.intensity = 1.1 * cine * this.charLightScale;
      this.rimLight.intensity = 1.4 * cine * this.charLightScale;
    }
    NpcActor.camera = this.ctx.cinematic.active ? null : cam;
    for (const n of this.npcs) n.update(dt);
    this.updateMove(dt);
    this.updateGlints();
    this.tick(dt, realDt);
    if (this.ctx.cinematic.playing || player.mode.kind === 'scripted' || player.isDead || this.heroMode) return;
    this.triggers(dt);
  }

  private updateGlints(): void {
    const g = this.glintPts;
    if (!g) return;
    const attr = g.geometry.attributes.position as THREE.BufferAttribute;
    const tmp = new THREE.Vector3();
    this.pickups.forEach((pk, i) => {
      if (!pk.object.visible) return attr.setXYZ(i, 0, -999, 0);
      pk.object.getWorldPosition(tmp);
      attr.setXYZ(i, tmp.x, tmp.y + 0.12, tmp.z);
    });
    attr.needsUpdate = true;
    (g.material as THREE.PointsMaterial).size = 0.22 + Math.max(0, Math.sin(this.time * 2.4)) * 0.28;
  }

  // ---------------------------------------------------------------- helpers
  private move: { pts: THREE.Vector3[]; t: number; dur: number; yaw: number; done?: () => void; curve: THREE.CatmullRomCurve3 | null } | null = null;

  /**
   * Move the (scripted) player along a path over `dur` seconds — rappels, ladders, being pulled
   * up. The player stays scripted afterwards unless `release` is set.
   */
  protected scriptedMove(pts: THREE.Vector3[], dur: number, anim: AnimState, yaw: number, done?: () => void, release = true): void {
    const p = this.ctx.player;
    p.setScripted(true);
    p.yaw = yaw;
    p.avatar.driver.setState(anim, { fade: 0.25 });
    this.move = {
      pts: pts.map((x) => x.clone()),
      t: 0,
      dur,
      yaw,
      curve: pts.length > 2 ? new THREE.CatmullRomCurve3(pts.map((x) => x.clone())) : null,
      done: () => {
        if (release) {
          p.setScripted(false);
          p.avatar.driver.setState('IDLE', { fade: 0.3 });
        }
        done?.();
      },
    };
  }

  private updateMove(dt: number): void {
    const m = this.move;
    if (!m) return;
    m.t = Math.min(m.dur, m.t + dt);
    const k = m.t / m.dur;
    const e = k * k * (3 - 2 * k);
    const pos = this.ctx.player.position;
    if (m.curve) m.curve.getPoint(e, pos);
    else pos.lerpVectors(m.pts[0], m.pts[m.pts.length - 1], e);
    this.ctx.player.yaw = m.yaw;
    if (m.t >= m.dur) {
      this.move = null;
      m.done?.();
    }
  }

  /**
   * Stretch a cinematic so the voiced lines that start at `at` finish before it ends: the last
   * shot is held longer and the closing events move with it.
   */
  protected fitToLines(seq: Sequence, at: number, lines: Line[], tail = 1.2): Sequence {
    const need = at + this.ctx.dialogue.totalDuration(lines) + tail;
    const extra = need - seq.duration;
    if (extra <= 0) return seq;
    const old = seq.duration;
    seq.duration = need;
    const last = seq.shots[seq.shots.length - 1];
    if (last && last.t1 >= old - 0.01) last.t1 = need;
    for (const e of seq.events) if (e.t >= old - 2.5) e.t += extra;
    return seq;
  }

  protected after(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }

  protected clearTimers(): void {
    this.timers = [];
  }

  protected checkpoint(id: string): void {
    const cur = this.checkpointOrder.indexOf(this.ctx.state.progress.checkpoint);
    if (this.checkpointOrder.indexOf(id) > cur) this.ctx.reachCheckpoint(id);
  }

  protected cpIndex(): number {
    return this.checkpointOrder.indexOf(this.ctx.state.progress.checkpoint);
  }

  protected setMood(m: Mood, fade?: number): void {
    if (this.mood === m) return;
    this.mood = m;
    this.ctx.audio.music.setMood(m, fade ?? (m === 'tension' ? 2 : 4));
  }

  protected say(id: string, lines: Line[], interrupt = false): boolean {
    return this.ctx.dialogue.sayOnce(`ch${this.id}:${id}`, lines, interrupt);
  }

  protected played(id: string): boolean {
    return this.ctx.dialogue.hasPlayed(`ch${this.id}:${id}`);
  }

  protected flag(name: string): boolean {
    return this.ctx.state.progress.flag(`ch${this.id}_${name}`);
  }

  protected setFlag(name: string): void {
    this.ctx.state.progress.setFlag(`ch${this.id}_${name}`);
  }

  protected scripted(on: boolean, anim: AnimState = 'CINEMATIC'): void {
    const p = this.ctx.player;
    p.setScripted(on);
    p.avatar.driver.setState(on ? anim : 'IDLE', { fade: 0.4 });
  }

  /** Standard "interactable thing with lines" (examine). */
  protected examine(id: string, pos: THREE.Vector3, lines: Line[], opts: { prompt?: string; radius?: number; once?: boolean; facing?: number; action?: boolean } = {}): void {
    const { interaction, dialogue, player } = this.ctx;
    interaction.add({
      id,
      position: pos.clone(),
      radius: opts.radius ?? 2,
      prompt: opts.prompt ?? 'Examine',
      enabled: true,
      facing: opts.facing ?? 0,
      onInteract: () => {
        if (opts.action !== false) player.playAction('INTERACT', pos, 0.9);
        if (opts.once) {
          interaction.get(id)!.enabled = false;
          dialogue.sayOnce(`ch${this.id}:${id}`, lines, true);
        } else dialogue.say(lines, true);
      },
    });
  }

  // ---------------------------------------------------------------- minimap
  minimap(): MinimapImage {
    if (this.mapImage) return this.mapImage;
    const b = this.mapBounds ?? { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
    const ppm = 2;
    const w = Math.round((b.maxX - b.minX) * ppm);
    const h = Math.round((b.maxZ - b.minZ) * ppm);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(w, h);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const x = b.maxX - px / ppm;
        const z = b.maxZ - py / ppm;
        const hx = this.mapHeight(x - 0.7, z) - this.mapHeight(x + 0.7, z);
        const hz = this.mapHeight(x, z + 0.7) - this.mapHeight(x, z - 0.7);
        const shade = Math.max(0.55, Math.min(1.25, 1 + (hx * 0.35 - hz * 0.35)));
        const [r, g, bb] = this.mapColor(x, z);
        const i = (py * w + px) * 4;
        img.data[i] = r * shade;
        img.data[i + 1] = g * shade;
        img.data[i + 2] = bb * shade;
        img.data[i + 3] = 255;
      }
    c.putImageData(img, 0, 0);
    this.mapImage = { image: cv, ...b };
    return this.mapImage;
  }

  // ---------------------------------------------------------------- quality / dispose
  applyQuality(q: QualitySettings): void {
    NpcActor.cullDistance = q.preset === 'low' ? 35 : Infinity;
    if (!this.kit) return;
    const sun = this.kit.sun;
    if (sun) {
      const s = q.shadows ? q.shadowMapSize : 512;
      if (s !== this.shadowSize) {
        this.shadowSize = s;
        sun.shadow.mapSize.set(s, s);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      sun.castShadow = q.shadows;
    }
    for (const veg of this.kit.vegetation) {
      const n = veg.group.name;
      if (n === 'grass') {
        veg.applyDensity(q.vegetationDensity);
        veg.maxDistance = q.grassDistance;
      } else if (n === 'far-forest') {
        veg.maxDistance = q.preset === 'low' ? 0 : q.preset === 'medium' ? 450 : 700; // LOW: the ridgelines carry the depth
      } else if (n === 'ferns' || n === 'broadleaf') {
        veg.applyDensity(q.preset === 'low' ? 0.3 : Math.min(1, q.vegetationDensity + 0.2));
        veg.maxDistance = q.vegetationDistance * 0.6;
        veg.setCastShadow(q.preset === 'high' || q.preset === 'ultra');
      } else if (n === 'canopy' || n === 'trunks' || n.startsWith('treefern')) {
        veg.maxDistance = q.vegetationDistance;
        veg.lodDistance = q.vegetationDistance * 0.45;
        veg.setCastShadow(q.vegetationShadows);
      }
      veg.update(0, this.ctx.renderer.camera.position, true);
    }
    for (const s2 of this.kit.shafts) s2.visible = q.lightShafts;
    if (this.kit.terrain) {
      this.kit.terrain.lodDistance = q.preset === 'low' ? 60 : q.preset === 'medium' ? 90 : 120;
      this.kit.terrain.update(0, this.ctx.renderer.camera.position, true);
    }
  }

  dispose(): void {
    this.ctx.state.unregister(this.persist.key);
    this.ctx.camera.hints = [];
    this.offDied?.();
    for (const d of this.disposers) d();
    for (const n of this.npcs) n.dispose();
    this.npcs = [];
    this.kit.dispose();
  }
}
