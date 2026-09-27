import * as THREE from 'three';
import type { Game } from '../main/Game';

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
    skipCinematic: () => game.cinematic.skip(),
    pause: () => game.pause(),
    resume: () => game.resume(),
    setQuality: (q: 'low' | 'medium' | 'high') => game.settings.update({ quality: q }),
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
