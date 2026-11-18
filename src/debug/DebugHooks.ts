import * as THREE from 'three';
import type { Game } from '../main/Game';
import { CharacterMotor } from '../physics/CharacterMotor';
import { globalUniforms } from '../render/HeightFog';

/**
 * Automation/test hooks, only installed with ?debug in the URL. Used by scripts/playtest.mjs.
 * Never used by gameplay code.
 */
export function installDebugHooks(game: Game): void {
  const api = {
    game,
    state: () => ({
      gameState: game.gameState,
      player: game.player.debugState(),
      checkpoint: game.state.progress.checkpoint,
      chapter: game.state.progress.chapter,
      collectibles: [...game.state.progress.collectibles],
      puzzles: [...game.state.progress.completedPuzzles],
      flags: { ...game.state.progress.storyFlags },
      simTime: game.clock.time,
      paused: game.clock.isPaused,
      cinematic: game.cinematic.current?.id ?? null,
      cinematicActive: game.cinematic.active,
      quality: game.quality.label,
      renderScale: +game.renderer.effectiveScale.toFixed(2),
      fps: game.perfMonitor.fps,
      frameMs: game.perfMonitor.frameMs,
      drawCalls: game.renderer.info.render.calls,
      triangles: game.renderer.info.render.triangles,
      assets: game.assets.stats(),
      gpu: game.gpuProbe.renderer,
      cameraYaw: game.camera.yaw,
      pointerLocked: document.pointerLockElement !== null,
    }),
    snapshot: () => game.state.capture(),
    teleport: (x: number, y: number, z: number, yaw = 0) => {
      game.player.teleport(new THREE.Vector3(x, y, z), yaw);
      game.camera.snap(game.player, yaw);
    },
    key: (code: string, down: boolean) => game.keyboard.simulate(code, down),
    look: (dx: number, dy: number) => game.keyboard.simulateLook(dx, dy),
    setCameraYaw: (yaw: number, pitch?: number) => {
      game.camera.yaw = yaw;
      if (pitch !== undefined) game.camera.pitch = pitch;
    },
    /** Freeze the gameplay camera at an explicit pose (for screenshots). */
    freeCam: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => {
      const cam = game.renderer.camera;
      (game as unknown as { freeCamPose: unknown }).freeCamPose = { p: new THREE.Vector3(x, y, z), l: new THREE.Vector3(lx, ly, lz) };
      cam.position.set(x, y, z);
      cam.lookAt(lx, ly, lz);
    },
    clearFreeCam: () => {
      (game as unknown as { freeCamPose: unknown }).freeCamPose = null;
    },
    /** Height of each foot bone above the ground directly under it (m). */
    footGaps: () => {
      const av = game.player.avatar;
      const out: number[] = [];
      for (const k of ['footL', 'footR']) {
        const b = av.bones[k];
        if (!b) continue;
        const p = b.getWorldPosition(new THREE.Vector3());
        out.push(+(p.y - game.world.groundAt(p.x, p.z, p.y + 0.5).y).toFixed(4));
      }
      return out;
    },
    setFootIK: (on: boolean) => {
      game.player.avatar.footIK.enabled = on;
    },
    /** Find a walkable slope (normal.y in range) near a point, free of colliders. */
    findSlope: (cx: number, cz: number, minNy = 0.88, maxNy = 0.95) => {
      const hf = game.world.heightfield!;
      const n = new THREE.Vector3();
      for (let r = 2; r < 40; r += 1.5)
        for (let a = 0; a < Math.PI * 2; a += 0.3) {
          const x = cx + Math.cos(a) * r;
          const z = cz + Math.sin(a) * r;
          hf.normalAt(x, z, n);
          if (n.y < minNy || n.y > maxNy) continue;
          // (query() always includes dynamic colliders like the gate door: test real distance)
          if (game.world.query(x - 2, z - 2, x + 2, z + 2).some((b) => Math.hypot(b.center.x - x, b.center.z - z) < Math.hypot(b.half.x, b.half.z) + 1.2)) continue;
          // Face across the slope so one foot is uphill and one downhill.
          return { x, z, y: game.world.groundAt(x, z, 1e4).y, ny: +n.y.toFixed(3), yaw: Math.atan2(n.z, -n.x) };
        }
      return null;
    },
    /** Head yaw relative to the body (deg): compare with look-at on/off. */
    headYaw: () => {
      const head = game.player.avatar.bones.head!;
      const q = head.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = game.player.avatar.root.getWorldQuaternion(new THREE.Quaternion());
      const v = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ.invert().multiply(q));
      return +THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)).toFixed(1);
    },
    /** Head world rotation as [x, y, z, w]. */
    headQuat: () => game.player.avatar.bones.head!.getWorldQuaternion(new THREE.Quaternion()).toArray(),
    /**
     * Angle (deg) between where the head points and the target, where "points" = the character's
     * forward rotated by the head's change since the reference rotation `q0` (taken with look off).
     */
    lookError: (x: number, y: number, z: number, q0: number[]) => {
      const head = game.player.avatar.bones.head!;
      const q1 = head.getWorldQuaternion(new THREE.Quaternion());
      const delta = q1.multiply(new THREE.Quaternion().fromArray(q0).invert());
      const fwd = game.player.facing.clone().applyQuaternion(delta);
      const p = head.getWorldPosition(new THREE.Vector3());
      const to = new THREE.Vector3(x, y, z).sub(p);
      fwd.y = 0;
      to.y = 0;
      return +THREE.MathUtils.radToDeg(fwd.angleTo(to)).toFixed(1);
    },
    setLookAt: (on: boolean) => {
      game.interaction.lookDisabled = !on;
    },
    /** Bright neutral light rig for animation review captures. */
    reviewLight: (on: boolean) => {
      const sc = game.renderer.scene;
      const old = sc.getObjectByName('__review');
      if (old) sc.remove(old);
      if (on) {
        const g = new THREE.Group();
        g.name = '__review';
        g.add(new THREE.AmbientLight(0xffffff, 2.2));
        const d = new THREE.DirectionalLight(0xffffff, 2.5);
        d.position.set(3, 8, -6);
        g.add(d);
        sc.add(g);
        sc.traverse((o) => {
          if ((o as THREE.InstancedMesh).isInstancedMesh) o.visible = false;
        });
      }
    },
    /** Live traversal pose, in the character's frame, plus hand/foot error against planted holds. */
    rigProbe: () => {
      const av = game.player.avatar;
      const c = av.climb;
      const toLocal = (o?: THREE.Object3D) => {
        if (!o) return null;
        const v = o.getWorldPosition(new THREE.Vector3());
        av.root.worldToLocal(v);
        return v.toArray().map((n) => +n.toFixed(3));
      };
      const limbs = [0, 1, 2, 3].map((i) => {
        const end = c.rig.limbEnd(i);
        const hold = c.plantedPoint(i);
        return { planted: c.isPlanted(i), err: +end.distanceTo(hold).toFixed(3), world: end.toArray().map((n) => +n.toFixed(3)) };
      });
      return { state: av.driver.state, pelvis: toLocal(av.bones.hips), chest: toLocal(av.bones.chest), head: toLocal(av.bones.head), active: c.active, limbs };
    },
    /** The foliage-interaction uniform as the shaders see it. */
    foliagePlayer: () => globalUniforms.uPlayerPos.value.toArray(),
    /** Camera spring-arm check: is anything solid between the camera pivot and the camera? */
    cameraClear: () => {
      const pivot = game.camera.armOrigin;
      const cam = game.renderer.camera.position;
      const d = cam.clone().sub(pivot);
      const len = d.length();
      const hit = game.world.raycast(pivot, d.normalize(), len, true, true);
      return { len: +len.toFixed(3), hit: hit === null ? null : +hit.toFixed(3) };
    },
    /** Current player overlap with solid geometry in metres (0 = not embedded). */
    penetration: () => game.player.motor.penetrationDepth(),
    /**
     * Collision sweep: drives a test capsule from `n` seeded random spots in random headings for
     * 2 s each (sliding along whatever it hits) and reports the worst overlap seen. Pure
     * simulation, no rendering — independent of GPU speed.
     */
    collisionSweep: (n = 2000, seed = 7) => {
      const m = new CharacterMotor(game.world);
      let s = seed >>> 0;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const b = game.world.bounds;
      let worst = 0;
      let bad = 0;
      let blocked = 0;
      const worstAt: number[][] = [];
      const p = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const x = b.minX + 1 + rnd() * (b.maxX - b.minX - 2);
        const z = b.minZ + 1 + rnd() * (b.maxZ - b.minZ - 2);
        p.set(x, game.world.groundAt(x, z, 1e4).y, z);
        m.teleport(p);
        const a = rnd() * Math.PI * 2;
        let sampleWorst = 0;
        for (let k = 0; k < 120; k++) {
          m.velocity.x = Math.sin(a) * 4.3;
          m.velocity.z = Math.cos(a) * 4.3;
          if (m.update(1 / 60).blocked) blocked++;
          sampleWorst = Math.max(sampleWorst, m.penetrationDepth());
        }
        if (sampleWorst > 0.02) {
          bad++;
          if (worstAt.length < 10) worstAt.push([+x.toFixed(2), +z.toFixed(2), +a.toFixed(2), +sampleWorst.toFixed(3)]);
        }
        worst = Math.max(worst, sampleWorst);
      }
      return { samples: n, worst: +worst.toFixed(4), embeddedSamples: bad, blockedSteps: blocked, worstAt };
    },
    skipCinematic: () => game.cinematic.skip(),
    /** Start a chapter fresh from the main menu (or anywhere: returns to menu state first). */
    startChapter: async (id: number) => {
      const g = game as unknown as { gameState: string; newGame: (id: number) => Promise<void>; showMenu: () => void };
      if (g.gameState !== 'menu') g.gameState = 'menu';
      await g.newGame(id);
    },
    /** Jump to a checkpoint of the loaded chapter (restores chapter state as on respawn). */
    gotoCheckpoint: (id: string) => {
      const ch = game.chapters.current;
      if (!ch?.checkpoints[id]) return false;
      game.state.progress.checkpoint = id;
      game.player.pendingRestore = null;
      ch.onRestored(id, false);
      return true;
    },
    heroFrames: () => ((game.chapters.current as unknown as { heroFrames?: () => { name: string }[] })?.heroFrames?.() ?? []).map((f) => f.name),
    /** Stage hero frame i: checkpoint state, prep, frozen camera, HUD hidden. Returns settle time. */
    heroFrame: (i: number) => {
      const ch = game.chapters.current as unknown as { heroFrames?: () => { cp: string; cam: number[]; look: number[]; prep?: () => void; settle?: number }[]; checkpoints: Record<string, unknown>; onRestored: (c: string, n: boolean) => void };
      const f = ch.heroFrames?.()[i];
      if (!f) return -1;
      game.cinematic.reset();
      game.dialogue.clear();
      (ch as unknown as { heroMode: boolean }).heroMode = true;
      game.state.progress.checkpoint = f.cp;
      game.player.pendingRestore = null;
      ch.onRestored(f.cp, false);
      f.prep?.();
      const cam = game.renderer.camera;
      (game as unknown as { freeCamPose: unknown }).freeCamPose = { p: new THREE.Vector3(...f.cam), l: new THREE.Vector3(...f.look) };
      cam.position.set(f.cam[0], f.cam[1], f.cam[2]);
      cam.lookAt(f.look[0], f.look[1], f.look[2]);
      document.querySelectorAll<HTMLElement>('.hud, .layer.hud, .card').forEach((e) => (e.style.visibility = 'hidden'));
      return f.settle ?? 1.5;
    },
    chapterDebug: () => (game.chapters.current as unknown as { debug?: () => unknown })?.debug?.() ?? null,
    chapterCall: (name: string, ...args: unknown[]) => {
      const ch = game.chapters.current as unknown as Record<string, (...a: unknown[]) => unknown>;
      return ch?.[name]?.(...args);
    },
    pause: () => game.pause(),
    resume: () => game.resume(),
    setQuality: (q: 'low' | 'medium' | 'high' | 'ultra') => game.settings.update({ quality: q }),
    saveManual: () => game.saves.write('manual', game.state.capture(), game.saveLabel()),
    latestSave: () => game.saves.latest(),
    chapter: () => game.chapters.current,
    /** Visible drawables in the camera frustum, grouped by name (approximate main-pass calls). */
    drawStats: () => {
      const cam = game.renderer.camera;
      cam.updateMatrixWorld();
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const counts: Record<string, number> = {};
      const tris: Record<string, number> = {};
      let shadowCasters = 0;
      game.renderer.scene.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!(m.isMesh || (o as THREE.Points).isPoints)) return;
        if (m.castShadow) shadowCasters++;
        if (o.frustumCulled && m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          const s = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).boundingSphere : m.geometry.boundingSphere;
          if (s && !fr.intersectsSphere(s.clone().applyMatrix4(o.matrixWorld))) return;
        }
        let key = o.name || o.parent?.name || o.type;
        if (!o.name && o.parent && o.parent.parent) key = `${o.parent.name || '?'}>${o.type}`;
        counts[key] = (counts[key] ?? 0) + 1;
        const g = m.geometry;
        const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
        tris[key] = (tris[key] ?? 0) + tri * inst;
      });
      return {
        counts: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30),
        tris: Object.entries(tris).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, t]) => [k, Math.round(t / 1000) + 'k']),
        shadowCasters,
      };
    },
  };
  (window as unknown as { __TFE: typeof api }).__TFE = api;
  console.info('[debug] window.__TFE installed');
}
