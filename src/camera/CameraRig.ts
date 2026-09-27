import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Colliders';
import type { Player } from '../player/Player';
import { SPEED } from '../player/Player';
import { angleDelta, clamp, damp, dampAngle } from '../systems/noise';

/** Level-authored camera hint: while the player is inside, framing blends toward these values. */
export interface CameraHint {
  id: string;
  center: THREE.Vector3;
  radius: number;
  distance?: number;
  pitch?: number;
  /** Preferred yaw (world). Gently steers unless the player is actively looking. */
  yaw?: number;
  fovAdd?: number;
  heightAdd?: number;
  strength?: number;
}

interface Framing {
  distance: number;
  shoulder: number;
  height: number;
  fovAdd: number;
}

const FRAMES: Record<string, Framing> = {
  explore: { distance: 3.7, shoulder: 0.45, height: 1.55, fovAdd: 0 },
  climb: { distance: 4.5, shoulder: 0.25, height: 1.3, fovAdd: 4 },
  hang: { distance: 4.2, shoulder: 0.2, height: 1.1, fovAdd: 4 },
  narrow: { distance: 3.3, shoulder: 0.1, height: 1.45, fovAdd: 2 },
  locked: { distance: 3.2, shoulder: 0.4, height: 1.45, fovAdd: -2 },
};

/**
 * Third-person gameplay camera: lagged pivot, spring arm with collision pull-in, shoulder
 * framing, contextual framing per traversal mode, hint volumes, sprint FOV, auto recenter
 * and trauma-based shake. Cinematics override its output via CinematicDirector.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.18;
  sensitivity = 1;
  baseFov = 60;
  shakeScale = 1;
  hints: CameraHint[] = [];
  readonly pivot = new THREE.Vector3();
  private dist = 3.7;
  private arm = 3.7;
  private shoulder = 0.45;
  private height = 1.55;
  private fovAdd = 0;
  private idleLook = 0;
  private trauma = 0;
  private shakeT = 0;
  private hintPitch = 0;
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private initialized = false;
  readonly output = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 60 };
  private lookMat = new THREE.Matrix4();

  constructor(private world: CollisionWorld) {}

  /** Snap behind the player (after teleports / cinematics). */
  snap(player: Player, yaw = player.yaw, pitch = 0.18): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.pivot.copy(player.position).setY(player.position.y + this.height);
    this.initialized = true;
  }

  addTrauma(t: number): void {
    this.trauma = clamp(this.trauma + t, 0, 1);
  }

  update(dt: number, realDt: number, player: Player, look: { x: number; y: number }): void {
    // Look input uses real dt semantics (mouse deltas are already per-frame).
    const lookActive = Math.abs(look.x) + Math.abs(look.y) > 0.0001;
    this.yaw -= look.x * this.sensitivity;
    this.pitch = clamp(this.pitch + look.y * this.sensitivity, -0.75, 1.15);
    this.idleLook = lookActive ? 0 : this.idleLook + realDt;
    if (dt <= 0) {
      this.compose(0);
      return;
    }

    const ctx = player.cameraContext;
    const f = FRAMES[ctx] ?? FRAMES.explore;
    let targetDist = f.distance;
    let targetFov = f.fovAdd + (player.sprinting ? 7 * clamp(player.speed / SPEED.sprint, 0, 1) : 0);
    let targetHeight = f.height;
    let hintPitch = 0;

    // Level hint volumes
    for (const h of this.hints) {
      const d = player.position.distanceTo(h.center);
      if (d > h.radius) continue;
      const w = clamp(1 - d / h.radius, 0, 1) * 1.6;
      const k = clamp(w, 0, 1) * (h.strength ?? 1);
      if (h.distance !== undefined) targetDist += (h.distance - targetDist) * k;
      if (h.fovAdd !== undefined) targetFov += h.fovAdd * k;
      if (h.heightAdd !== undefined) targetHeight += h.heightAdd * k;
      if (h.pitch !== undefined) hintPitch += (h.pitch - this.pitch) * k;
      if (h.yaw !== undefined && this.idleLook > 0.8) this.yaw = dampAngle(this.yaw, h.yaw, 0.9 * k, dt);
    }
    this.hintPitch = damp(this.hintPitch, hintPitch, 2, dt);

    // Context steering
    if (ctx === 'narrow' && player.narrowNormal && this.idleLook > 0.3) {
      const n = player.narrowNormal;
      const wallYaw = Math.atan2(-n.x, -n.z);
      // Side-on framing: look along the wall from outside so the drop is visible.
      const off = angleDelta(wallYaw, this.yaw) >= 0 ? 0.7 : -0.7;
      this.yaw = dampAngle(this.yaw, wallYaw + off, 2.2, dt);
      this.pitch = damp(this.pitch, 0.22, 2, dt);
    } else if ((ctx === 'climb' || ctx === 'hang') && this.idleLook > 0.6) {
      this.yaw = dampAngle(this.yaw, player.yaw + (ctx === 'hang' ? 0.35 : 0.25), 1.6, dt);
      this.pitch = damp(this.pitch, ctx === 'hang' ? -0.05 : 0.05, 1.5, dt);
    } else if (ctx === 'explore' && this.idleLook > 1.4 && player.speed > 1.5) {
      // Gentle auto-recenter behind the direction of travel — only when travelling roughly
      // forward relative to the camera (never while strafing, or A/D would spiral).
      const moveYaw = Math.atan2(player.motor.velocity.x, player.motor.velocity.z);
      if (Math.abs(angleDelta(this.yaw, moveYaw)) < 0.8) this.yaw = dampAngle(this.yaw, moveYaw, 0.9 * (player.speed / SPEED.run), dt);
      this.pitch = damp(this.pitch, 0.16, 0.7, dt);
    }

    this.dist = damp(this.dist, targetDist, 3, dt);
    this.shoulder = damp(this.shoulder, f.shoulder, 3, dt);
    this.height = damp(this.height, targetHeight, 4, dt);
    this.fovAdd = damp(this.fovAdd, targetFov, 4, dt);

    // Lagged pivot: tight horizontally, softer vertically (smooths jumps/landings).
    const target = this.tmp.copy(player.position);
    target.y += this.height;
    if (!this.initialized) {
      this.pivot.copy(target);
      this.initialized = true;
    }
    const hl = player.isTraversing ? 10 : 16;
    this.pivot.x = damp(this.pivot.x, target.x, hl, dt);
    this.pivot.z = damp(this.pivot.z, target.z, hl, dt);
    this.pivot.y = damp(this.pivot.y, target.y, player.grounded || player.isTraversing ? 9 : 4, dt);

    this.compose(dt);
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    this.shakeT += dt;
  }

  private compose(dt: number): void {
    const pitch = clamp(this.pitch + this.hintPitch, -0.8, 1.2);
    const cp = Math.cos(pitch);
    this.dir.set(Math.sin(this.yaw) * cp, -Math.sin(pitch), Math.cos(this.yaw) * cp);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const origin = this.tmp.copy(this.pivot).addScaledVector(this.right, this.shoulder);
    // Spring arm collision
    const back = this.dir.clone().negate();
    // Thick probe: centre ray + 4 offset rays approximate a sphere cast (radius ~0.28 m).
    let allowed = this.dist;
    const up = new THREE.Vector3(0, 1, 0);
    const side = this.right;
    for (const [ox, oy] of [[0, 0], [0.28, 0], [-0.28, 0], [0, 0.24], [0, -0.2]]) {
      const o = origin.clone().addScaledVector(side, ox).addScaledVector(up, oy);
      const hit = this.world.raycast(o, back, this.dist + 0.35, true, true);
      if (hit !== null) allowed = Math.min(allowed, Math.max(0.55, hit - 0.35));
    }
    // Pull in quickly but smoothly (no pops), ease back out slowly once clear.
    if (dt <= 0) this.arm = Math.min(this.arm, allowed);
    else if (allowed < this.arm) this.arm = Math.max(allowed, damp(this.arm, allowed, 22, dt));
    else this.arm = damp(this.arm, allowed, 2.2, dt);
    // Hard guarantee: never beyond the nearest hit.
    this.arm = Math.min(this.arm, allowed + 0.05);
    const pos = this.output.position.copy(origin).addScaledVector(back, this.arm);
    // Never below terrain.
    const ground = this.world.terrainHeight(pos.x, pos.z) + 0.35;
    if (pos.y < ground) pos.y = ground;
    const lookAt = origin.clone().addScaledVector(this.dir, 10);
    this.lookMat.lookAt(pos, lookAt, new THREE.Vector3(0, 1, 0));
    this.output.quaternion.setFromRotationMatrix(this.lookMat);
    // Shake (smooth noise, trauma^2)
    const s = this.trauma * this.trauma * this.shakeScale;
    if (s > 0.0001) {
      const t = this.shakeT * 22;
      const nx = Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4;
      const ny = Math.sin(t * 1.3 + 2.1) * 0.6 + Math.sin(t * 3.1 + 0.4) * 0.4;
      const nr = Math.sin(t * 0.9 + 4.2);
      const e = new THREE.Euler(nx * 0.035 * s, ny * 0.035 * s, nr * 0.02 * s);
      this.output.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
      pos.y += ny * 0.04 * s;
    }
    this.output.fov = this.baseFov + this.fovAdd;
  }

  /** Current forward look direction (for aligning to cinematics). */
  get forward(): THREE.Vector3 {
    return this.dir;
  }
}
