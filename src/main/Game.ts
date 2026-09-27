import * as THREE from 'three';
import { Renderer } from '../render/Renderer';
import { globalUniforms } from '../render/HeightFog';
import { GameClock } from './GameClock';
import { EventBus } from '../systems/EventBus';
import { StateRegistry } from '../state/StateRegistry';
import { emptySnapshot } from '../state/Snapshot';
import { SaveManager } from '../save/SaveManager';
import { SettingsStore } from '../save/SettingsStore';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseProvider } from '../input/KeyboardMouseProvider';
import { GamepadProvider } from '../input/GamepadProvider';
import { prettyCode } from '../input/Bindings';
import { AssetManager } from '../assets/AssetManager';
import { CollisionWorld } from '../physics/Colliders';
import { TraversalSystem } from '../traversal/TraversalSystem';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { Player } from '../player/Player';
import { CharacterAvatar, characterDef } from '../animation/CharacterAvatar';
import { CameraRig } from '../camera/CameraRig';
import { CinematicDirector } from '../cinematic/CinematicDirector';
import { Dialogue } from '../story/Dialogue';
import { collectible } from '../story/Collectibles';
import { AudioEngine } from '../audio/AudioEngine';
import { Sfx } from '../audio/Sfx';
import { Ambience } from '../audio/Ambience';
import { AdaptiveMusic } from '../audio/AdaptiveMusic';
import { ChapterManager } from '../chapters/ChapterManager';
import { chapterEntry } from '../chapters/ChapterRegistry';
import type { ChapterContext } from '../chapters/Chapter';
import { LoadingScreen } from '../ui/LoadingScreen';
import { MainMenu } from '../ui/MainMenu';
import { PauseMenu } from '../ui/PauseMenu';
import { SettingsMenu } from '../ui/SettingsMenu';
import { HUD } from '../ui/HUD';
import { JournalView } from '../ui/JournalView';
import { EndCard } from '../ui/EndCard';
import { PerfMonitor } from '../systems/PerfMonitor';
import { probeGpu, resolveQuality, type GpuProbe, type QualitySettings } from '../systems/Quality';
import { damp } from '../systems/noise';
import type { Persistable } from '../state/Persistable';

export type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'journal' | 'transition' | 'ended';

/**
 * Top-level orchestrator: owns every engine system, the frame loop, the game-state machine
 * (menu / playing / paused / journal / transitions), settings application and save I/O.
 */
export class Game {
  readonly clock = new GameClock();
  readonly events = new EventBus();
  readonly state = new StateRegistry();
  readonly saves = new SaveManager();
  readonly settings = new SettingsStore();
  readonly input = new InputManager();
  readonly renderer: Renderer;
  readonly assets: AssetManager;
  readonly world = new CollisionWorld();
  readonly traversal = new TraversalSystem();
  readonly interaction = new InteractionSystem();
  readonly cinematic: CinematicDirector;
  readonly dialogue = new Dialogue();
  readonly audio = new AudioEngine();
  readonly sfx: Sfx;
  readonly ambience: Ambience;
  readonly music: AdaptiveMusic;
  camera!: CameraRig;
  player!: Player;
  chapters!: ChapterManager;
  private kbm: KeyboardMouseProvider;
  private ui: {
    loading: LoadingScreen;
    menu: MainMenu;
    pause: PauseMenu;
    settings: SettingsMenu;
    hud: HUD;
    journal: JournalView;
    end: EndCard;
  };
  gameState: GameState = 'boot';
  private settingsReturn: GameState = 'menu';
  private probe!: GpuProbe;
  private perf!: PerfMonitor;
  quality!: QualitySettings;
  private pauseBlur = 0;
  private skipHold = 0;
  private hadLock = false;
  private lastPauseToggle = 0;
  private menuT = 0;
  private menuCam = { position: new THREE.Vector3(), look: new THREE.Vector3() };
  private debug = new URLSearchParams(location.search).has('debug');
  private devTimer = 0;
  private dofAmount = 0;
  /** Whether the 'ended' card is shown over the menu backdrop (vs. over the gameplay view). */
  private endBackdrop = false;
  /** Debug-only fixed camera (screenshots). */
  freeCamPose: { p: THREE.Vector3; l: THREE.Vector3 } | null = null;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.assets = new AssetManager(this.renderer.renderer);
    this.cinematic = new CinematicDirector(this.events);
    this.sfx = new Sfx(this.audio);
    this.ambience = new Ambience(this.audio);
    this.music = new AdaptiveMusic(this.audio);
    this.kbm = new KeyboardMouseProvider(canvas, () => this.settings.value.bindings);
    this.input.add(this.kbm);
    this.input.add(new GamepadProvider()); // STUB provider (no-op), proves the extension point.
    const hover = () => this.sfx.uiHover();
    this.ui = {
      loading: new LoadingScreen(uiRoot),
      menu: new MainMenu(uiRoot, {
        onContinue: () => void this.continueGame(),
        onNew: () => void this.newGame(),
        onSettings: () => this.openSettings('menu'),
        hover,
      }),
      pause: new PauseMenu(uiRoot, {
        onResume: () => this.resume(),
        onSave: () => this.manualSave(),
        onSettings: () => this.openSettings('paused'),
        onMainMenu: () => void this.toMainMenu(),
        onJournal: () => this.openJournal(),
        hover,
      }),
      settings: new SettingsMenu(uiRoot, this.settings),
      hud: new HUD(uiRoot),
      journal: new JournalView(uiRoot),
      end: new EndCard(uiRoot),
    };
    this.ui.settings.onClose = () => this.closeSettings();
    this.ui.settings.effectiveLabel = () => this.quality?.label ?? '';
    this.ui.hud.setVisible(false);
    // First user gesture anywhere unlocks audio.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.sfx.uiClick();
    });
  }

  // =================================================================== boot
  async boot(): Promise<void> {
    const L = this.ui.loading;
    L.progress(0.02, 'Probing graphics');
    this.probe = probeGpu(this.renderer.renderer);
    // First run: pick a sensible default preset from the probe (user can change it).
    if (!localStorage.getItem('tfe.settings.v1')) this.settings.update({ quality: this.probe.suggestedPreset });
    this.perf = new PerfMonitor(this.probe.suggestedHighLevel, (lvl) => this.onAdaptiveLevel(lvl), 0);
    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    // Core assets: characters (temporary GLBs — replaceable via characters.json).
    L.progress(0.05, 'Loading characters');
    await this.assets.loadManifest(
      {
        id: 'core',
        entries: [
          { key: characterDef('ines').asset, type: 'gltf', url: characterDef('ines').url, weight: 2 },
          { key: characterDef('toby').asset, type: 'gltf', url: characterDef('toby').url, weight: 2 },
        ],
      },
      (l, t) => L.progress(0.05 + 0.1 * (l / t), 'Loading characters'),
    );

    const avatar = new CharacterAvatar(this.assets, 'ines');
    this.player = new Player(this.world, this.traversal, this.input, this.events, avatar);
    this.renderer.scene.add(avatar.root);
    this.camera = new CameraRig(this.world);
    this.state.register(this.player as unknown as Persistable);
    this.state.register(this.dialoguePersist());
    this.applySettings();

    this.player.onInteract = () => this.interaction.tryInteract();
    this.player.onDeath = () => {
      this.camera.addTrauma(0.6);
      setTimeout(() => void this.chapters.respawn(), 500);
    };
    this.wireEvents();

    const ctx: ChapterContext = {
      renderer: this.renderer,
      scene: this.renderer.scene,
      assets: this.assets,
      world: this.world,
      traversal: this.traversal,
      interaction: this.interaction,
      player: this.player,
      camera: this.camera,
      cinematic: this.cinematic,
      dialogue: this.dialogue,
      hud: this.ui.hud,
      events: this.events,
      state: this.state,
      input: this.input,
      audio: { engine: this.audio, sfx: this.sfx, ambience: this.ambience, music: this.music },
      quality: () => this.quality,
      createAvatar: (id) => new CharacterAvatar(this.assets, id),
      reachCheckpoint: (id) => this.chapters.reachCheckpoint(id),
      completeChapter: () => this.chapters.completeChapter(),
      openJournal: (focus) => this.openJournal(focus),
    };
    this.chapters = new ChapterManager(ctx, this.saves, () => this.saveLabel());
    this.chapters.onProgress = (f, label) => L.progress(0.15 + 0.85 * f, label);
    this.chapters.onChapterComplete = (id) => this.onChapterComplete(id);

    // Chapter 1 doubles as the living main-menu backdrop.
    await this.chapters.ensureLoaded(1);
    this.chapters.current!.applyQuality(this.quality);
    this.resetBackdrop();
    L.progress(1, 'Ready');

    // Warm up shaders before revealing the menu (avoids first-frame hitches).
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    this.kbm.onCodeDown = (code) => this.onKey(code);
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    canvasClickToLock(this.canvas, () => this.gameState === 'playing' && !this.cinematicLock(), () => this.requestLock());
    window.addEventListener('beforeunload', () => this.autosaveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.autosaveNow();
        if (this.gameState === 'playing') this.pause();
      } else this.clock.resync();
    });

    if (this.debug) (await import('../debug/DebugHooks')).installDebugHooks(this);
    this.loop();
    await new Promise((r) => setTimeout(r, 300));
    this.showMenu();
    L.setVisible(false);
  }

  private dialoguePersist(): Persistable<{ played: string[] }> {
    return {
      key: 'dialogue',
      version: 1,
      serialize: () => ({ played: this.dialogue.playedIds }),
      restore: (d) => {
        this.dialogue.clear();
        this.dialogue.playedIds = d?.played ?? [];
      },
    };
  }

  private wireEvents(): void {
    const E = this.events;
    E.on('player:footstep', (e) => this.sfx.footstep(e.surface, e.intensity));
    E.on('player:landed', (e) => {
      if (e.fallHeight > 1.2) this.sfx.land(e.fallHeight);
      if (e.fallHeight > 4) this.camera.addTrauma(Math.min(0.6, e.fallHeight * 0.06));
    });
    E.on('traversal:grab', (e) => this.sfx.climbGrab(e.kind));
    E.on('checkpoint:reached', (e) => {
      this.sfx.checkpoint();
      this.ui.hud.toast('Checkpoint', e.label ?? '', 3);
    });
    E.on('collectible:found', (e) => {
      this.sfx.pickup();
      const c = collectible(e.id);
      this.ui.hud.toast(c?.kind === 'relic' ? 'Relic found' : 'Journal page found', `${e.title} — press ${prettyCode(this.settings.value.bindings.journal[0])} to read`, 5);
    });
    this.dialogue.onLine = (l) => {
      this.ui.hud.setLine(l);
      if (l?.radio) this.sfx.radio();
    };
  }

  // =================================================================== settings / quality
  private applySettings(): void {
    const s = this.settings.value;
    this.quality = resolveQuality(s.quality, this.perf?.level ?? 1);
    this.perf && (this.perf.enabled = s.quality === 'high');
    this.renderer.applyQuality(this.quality);
    this.chapters?.current?.applyQuality(this.quality);
    this.audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, ambience: s.ambienceVolume });
    this.input.sensitivity = s.mouseSensitivity;
    this.input.invertY = s.invertY;
    if (this.camera) {
      this.camera.baseFov = s.fov;
      this.camera.shakeScale = s.cameraShake;
    }
    this.ui.hud.subtitlesEnabled = s.subtitles;
    this.events.emit('quality:changed', { tier: this.quality.label });
  }

  private onAdaptiveLevel(level: number): void {
    if (this.settings.value.quality !== 'high') return;
    this.quality = resolveQuality('high', level);
    this.renderer.applyQuality(this.quality);
    this.chapters?.current?.applyQuality(this.quality);
    if (this.debug) console.info(`[Quality] adaptive HIGH → ${this.quality.label}`);
  }

  // =================================================================== flow
  private resetBackdrop(): void {
    const ch = this.chapters.current!;
    this.state.restore(emptySnapshot(ch.id, ch.firstCheckpoint));
    ch.onRestored(ch.firstCheckpoint, true);
    this.music.setMood('title', 2);
  }

  private showMenu(): void {
    this.gameState = 'menu';
    this.input.gameplayEnabled = false;
    this.ui.hud.setVisible(false);
    this.ui.pause.setVisible(false);
    this.ui.end.close();
    const save = this.saves.latest();
    this.ui.menu.setSave(save ? save.label : null);
    this.ui.menu.setVisible(true);
    this.clock.setPaused(false);
    this.audio.setPaused(false);
    this.menuT = 0;
  }

  private async newGame(): Promise<void> {
    if (this.gameState !== 'menu') return;
    this.gameState = 'transition';
    this.audio.unlock();
    this.ui.menu.setVisible(false);
    await this.ui.hud.fade(true, 0.8);
    this.ui.hud.setVisible(true);
    await this.chapters.ensureLoaded(1);
    this.chapters.startNew();
    this.enterPlaying();
    await this.ui.hud.fade(false, 1.2);
  }

  private async continueGame(): Promise<void> {
    if (this.gameState !== 'menu') return;
    const save = this.saves.latest();
    if (!save) return;
    this.audio.unlock();
    const entry = chapterEntry(save.chapter);
    if (!entry || entry.stub) {
      this.showStubChapter(save.chapter);
      return;
    }
    this.gameState = 'transition';
    this.ui.menu.setVisible(false);
    await this.ui.hud.fade(true, 0.8);
    this.ui.hud.setVisible(true);
    await this.chapters.ensureLoaded(save.chapter);
    this.chapters.continueFrom(save);
    this.enterPlaying();
    await this.ui.hud.fade(false, 1.0);
  }

  /** STUB: chapters 2–5 are not playable yet; show an honest card instead of a broken level. */
  private showStubChapter(id: number): void {
    const e = chapterEntry(id)!;
    this.ui.menu.setVisible(false);
    this.gameState = 'ended';
    this.endBackdrop = true;
    this.ui.end.open({
      kicker: e.numberLabel,
      title: e.title,
      text: 'This chapter is in development. Its story is written; its levels are not built yet. Your progress is saved and will continue here once it is available.',
      stats: 'Vertical slice · Chapter 1 complete',
      buttons: [
        ['Replay Chapter 1', () => {
          this.ui.end.close();
          this.gameState = 'menu';
          void this.newGame();
        }],
        ['Main Menu', () => {
          this.ui.end.close();
          this.showMenu();
        }],
      ],
    });
  }

  private enterPlaying(): void {
    this.gameState = 'playing';
    this.clock.setPaused(false);
    this.clock.resync();
    this.audio.setPaused(false);
    this.requestLock();
  }

  private onChapterComplete(id: number): void {
    const p = this.state.progress;
    const found = [...p.collectibles].filter((c) => collectible(c)?.chapter === id).length;
    this.gameState = 'ended';
    this.endBackdrop = false;
    this.input.gameplayEnabled = false;
    this.exitLock();
    const next = chapterEntry(id + 1);
    setTimeout(() => {
      this.ui.end.open({
        kicker: 'CHAPTER ONE COMPLETE',
        title: 'THE DISCOVERY',
        text: 'The gate of the Watching Sun stands open. Below, in the mist, the Hollow Meridian waits — and someone has been keeping the path to it for sixty years.',
        stats: `Collectibles ${found}/4 · Time ${Math.round(p.playtimeSec / 60)} min · Next: ${next ? `${next.numberLabel} — ${next.title} (in development)` : '—'}`,
        buttons: [
          ['Main Menu', () => void this.toMainMenu(false)],
        ],
      });
    }, 1500);
  }

  pause(): void {
    if (this.gameState !== 'playing') return;
    this.gameState = 'paused';
    this.lastPauseToggle = performance.now();
    this.clock.setPaused(true);
    this.audio.setPaused(true);
    this.input.gameplayEnabled = false;
    this.exitLock();
    const ch = this.chapters.current;
    const p = this.state.progress;
    this.ui.pause.setInfo(ch?.objective() ?? '', `${chapterEntry(p.chapter)?.numberLabel ?? ''} · ${p.collectibles.size} collectibles · ${Math.round(p.playtimeSec / 60)} min`);
    this.ui.pause.setVisible(true);
    this.events.emit('game:paused', { paused: true });
  }

  resume(): void {
    if (this.gameState !== 'paused') return;
    this.lastPauseToggle = performance.now();
    this.ui.pause.setVisible(false);
    this.gameState = 'playing';
    this.clock.setPaused(false);
    this.clock.resync();
    this.audio.setPaused(false);
    this.requestLock();
    this.events.emit('game:paused', { paused: false });
  }

  openJournal(focus?: string): void {
    if (this.gameState !== 'playing' && this.gameState !== 'paused') return;
    if (this.gameState === 'playing') this.pause();
    this.ui.pause.setVisible(false);
    this.gameState = 'journal';
    this.ui.journal.open(this.state.progress.collectibles, focus);
  }

  private closeJournal(): void {
    this.ui.journal.close();
    this.gameState = 'paused';
    this.resume();
  }

  private openSettings(from: GameState): void {
    this.settingsReturn = from;
    if (from === 'menu') this.ui.menu.setVisible(false);
    else this.ui.pause.setVisible(false);
    this.ui.settings.setVisible(true);
  }

  private closeSettings(): void {
    this.ui.settings.setVisible(false);
    if (this.settingsReturn === 'menu') this.ui.menu.setVisible(true);
    else this.ui.pause.setVisible(true);
  }

  private manualSave(): void {
    const ok = this.saves.write('manual', this.state.capture(), this.saveLabel());
    this.ui.pause.flashSaved(ok);
  }

  private autosaveNow(): void {
    if (this.gameState === 'playing' || this.gameState === 'paused' || this.gameState === 'journal') {
      this.saves.write('auto', this.state.capture(), this.saveLabel());
    }
  }

  private async toMainMenu(save = true): Promise<void> {
    if (save) this.autosaveNow();
    this.gameState = 'transition';
    this.ui.pause.setVisible(false);
    this.ui.end.close();
    await this.ui.hud.fade(true, 0.7);
    this.cinematic.skip();
    this.dialogue.clear();
    this.ui.hud.setVisible(false);
    this.resetBackdrop();
    this.showMenu();
    await this.ui.hud.fade(false, 0.9);
  }

  saveLabel(): string {
    const p = this.state.progress;
    const ch = this.chapters?.current;
    const cp = ch?.checkpoints[p.checkpoint]?.label ?? p.checkpoint;
    const e = chapterEntry(p.chapter);
    const mins = Math.max(1, Math.round(p.playtimeSec / 60));
    return `${e ? e.numberLabel.replace('CHAPTER ', 'Ch. ') : `Ch. ${p.chapter}`} · ${cp || 'Start'} · ${mins} min`;
  }

  // =================================================================== input / pointer lock
  private cinematicLock(): boolean {
    return this.cinematic.playing;
  }

  private requestLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* not allowed without gesture — click hint will show */
    }
  }

  private exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onPointerLockChange(): void {
    const locked = document.pointerLockElement === this.canvas;
    if (locked) this.hadLock = true;
    else if (this.hadLock && this.gameState === 'playing' && performance.now() - this.lastPauseToggle > 250) {
      // ESC in pointer lock releases the lock without delivering the key: treat as pause.
      this.pause();
    }
  }

  private onKey(code: string): void {
    if (this.ui.settings.capturingKey) return;
    const b = this.settings.value.bindings;
    const isPause = b.pause.includes(code);
    const isJournal = b.journal.includes(code);
    const now = performance.now();
    if (this.ui.settings.isOpen) {
      if (code === 'Escape') this.closeSettings();
      return;
    }
    if (this.gameState === 'journal') {
      if (isPause || isJournal) this.closeJournal();
      return;
    }
    if (isPause && now - this.lastPauseToggle > 200) {
      if (this.gameState === 'playing') this.pause();
      else if (this.gameState === 'paused') this.resume();
      return;
    }
    if (isJournal && this.gameState === 'playing' && !this.cinematic.playing) this.openJournal();
  }

  // =================================================================== frame loop
  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.clock.tick();
    const dt = this.clock.delta;
    const realDt = this.clock.realDelta;
    this.input.update(realDt);
    const ch = this.chapters?.current;
    const playing = this.gameState === 'playing';
    const cam = this.renderer.camera;

    if (ch && this.player) {
      if (this.gameState === 'menu' || this.gameState === 'ended' || (this.gameState === 'transition' && !this.cinematic.active)) {
        this.input.gameplayEnabled = false;
        this.ui.hud.minimap.setVisible(false);
        if (this.gameState === 'menu' || (this.gameState === 'ended' && this.endBackdrop)) {
          this.menuT += realDt;
          ch.menuCamera(this.menuT, this.menuCam);
          cam.position.copy(this.menuCam.position);
          cam.lookAt(this.menuCam.look);
          cam.fov = 50;
          cam.updateProjectionMatrix();
        }
        this.player.update(dt, this.camera.yaw);
        ch.update(dt, realDt);
        this.dialogue.update(dt);
      } else {
        const cineLock = this.cinematic.playing || (this.cinematic.active && this.cinematic.current?.lockDuringBlend !== false && this.cinematic.blendAmount > 0.35);
        this.input.gameplayEnabled = playing && !cineLock;
        this.input.lookEnabled = playing && !this.cinematic.playing;
        if (dt > 0) {
          this.state.progress.playtimeSec += dt;
          this.cinematic.update(dt);
          this.player.update(dt, this.camera.yaw);
          const canInteract = playing && !cineLock && this.player.mode.kind === 'ground' && this.player.grounded;
          this.interaction.update(this.player.position, this.player.facing, canInteract);
          ch.update(dt, realDt);
          this.dialogue.update(dt);
        }
        this.camera.update(dt, realDt, this.player, this.input.look());
        this.cinematic.apply(cam, this.camera.output);
        this.updateSkip(realDt);
        this.updatePrompt(cineLock);
        if (playing) this.perf.update(realDt);
        this.ui.hud.setClickHint(playing && !cineLock && !document.pointerLockElement && this.hadLock);
        this.updateMinimap(realDt, playing && !this.cinematic.active);
      }
    }

    if (this.freeCamPose) {
      cam.position.copy(this.freeCamPose.p);
      cam.lookAt(this.freeCamPose.l);
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    globalUniforms.uTime.value = this.clock.time;
    if (this.player) {
      // Foliage interaction: current position + a lagging trail (spring-back).
      const pp = this.player.position;
      globalUniforms.uPlayerPos.value.set(pp.x, pp.y, pp.z);
      const tr = globalUniforms.uPlayerTrail.value;
      if (tr.y < -500) tr.copy(pp);
      tr.lerp(pp, 1 - Math.exp(-2.4 * dt));
    }
    const g = this.renderer.post.gradeUniforms;
    const paused = this.gameState === 'paused' || this.gameState === 'journal' || this.ui.settings.isOpen && this.settingsReturn === 'paused';
    this.pauseBlur = damp(this.pauseBlur, paused ? 1 : 0, 8, realDt);
    g.uPause.value = this.pauseBlur;
    g.uLetterbox.value = this.cinematic.letterbox;
    const wantDof = this.cinematic.playing && this.cinematic.current?.dof !== false ? 1 : 0;
    this.dofAmount = damp(this.dofAmount, wantDof, 3, realDt);
    this.renderer.post.dofAmount = this.dofAmount;
    this.renderer.post.dofFocus = this.cinematic.dofFocus;

    this.audio.updateListener(cam);
    if (this.player) this.ambience.update(this.player.position);
    this.music.update();
    this.renderer.render(realDt, this.clock.time);
    if (this.debug) this.updateDev(realDt);
  };

  private minimapChapter: unknown = null;
  private updateMinimap(realDt: number, show: boolean): void {
    const mm = this.ui.hud.minimap;
    const ch = this.chapters.current;
    if (ch && this.minimapChapter !== ch) {
      this.minimapChapter = ch;
      mm.setMap(ch.minimap?.() ?? null);
    }
    mm.setVisible(show && this.settings.value.minimap && !!ch?.minimap);
    if (!mm.isVisible || !ch) return;
    const markers = (ch.mapPoints?.() ?? []).map((pos) => ({ pos, kind: 'poi' as const }));
    const obj = ch.objectiveTarget?.();
    if (obj) markers.push({ pos: obj, kind: 'objective' as const } as never);
    mm.draw(realDt, this.player.position, this.player.yaw, this.camera.yaw, markers);
  }

  private updateSkip(realDt: number): void {
    const seq = this.cinematic.current;
    if (seq?.skippable && this.gameState === 'playing') {
      if (this.input.rawHeld('jump')) this.skipHold += realDt;
      else this.skipHold = Math.max(0, this.skipHold - realDt * 2);
      this.ui.hud.setSkip(true, Math.min(1, this.skipHold / 0.8));
      if (this.skipHold >= 0.8) {
        this.skipHold = 0;
        this.cinematic.skip();
      }
    } else {
      this.skipHold = 0;
      this.ui.hud.setSkip(false, 0);
    }
  }

  private updatePrompt(cineLock: boolean): void {
    const hud = this.ui.hud;
    if (cineLock || this.gameState !== 'playing') return hud.setPrompt(null);
    const b = this.settings.value.bindings;
    const f = this.interaction.focused;
    if (f) return hud.setPrompt(f.prompt, prettyCode(b.interact[0]));
    const p = this.player.prompt;
    if (p === 'Climb') return hud.setPrompt('Climb', prettyCode(b.interact[0]));
    if (p === 'Climb up') return hud.setPrompt('Climb up', prettyCode(b.moveForward[0]));
    hud.setPrompt(null);
  }

  private updateDev(realDt: number): void {
    this.devTimer -= realDt;
    if (this.devTimer > 0) return;
    this.devTimer = 0.25;
    const info = this.renderer.info;
    const ps = this.player?.debugState();
    this.ui.hud.dev.textContent = [
      `${this.perf?.fps.toFixed(0)} fps · ${this.perf?.frameMs.toFixed(1)} ms`,
      `${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris`,
      `${this.quality?.label} · ${this.probe?.renderer.slice(0, 48)}`,
      ps ? `${ps.mode} / ${ps.anim} · v ${ps.speed}` : '',
      ps ? `pos ${(ps.pos as number[]).join(', ')}` : '',
      `state ${this.gameState} · cp ${this.state.progress.checkpoint}`,
    ].join('\n');
  }

  // Debug accessors
  get uiRefs() {
    return this.ui;
  }
  get perfMonitor() {
    return this.perf;
  }
  get gpuProbe() {
    return this.probe;
  }
  get keyboard() {
    return this.kbm;
  }
}

function canvasClickToLock(canvas: HTMLCanvasElement, allowed: () => boolean, lock: () => void): void {
  canvas.addEventListener('click', () => {
    if (allowed()) lock();
  });
}
