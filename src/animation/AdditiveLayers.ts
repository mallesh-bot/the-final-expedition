import * as THREE from 'three';
import { clamp, damp } from '../systems/noise';

/**
 * Procedural layers applied after the mixer each frame, on any rig that maps the logical
 * bone names: turn lean, head look-at, and slope/landing compression. Rig-agnostic.
 */
export class AdditiveLayers {
  private lean = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();
  private inv = new THREE.Quaternion();
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 0;
  enabled = true;

  constructor(private bones: { hips?: THREE.Object3D; spine?: THREE.Object3D; chest?: THREE.Object3D; neck?: THREE.Object3D; head?: THREE.Object3D }) {}

  update(dt: number, root: THREE.Object3D, turnRate: number, speed: number, allowLook: boolean): void {
    if (!this.enabled) return;
    // Lean into turns proportional to angular velocity and speed.
    const targetLean = clamp(-turnRate * speed * 0.035, -0.22, 0.22);
    this.lean = damp(this.lean, targetLean, 6, dt);
    if (this.bones.spine && Math.abs(this.lean) > 1e-4) {
      this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean);
      this.bones.spine.quaternion.multiply(this.q);
    }
    // Head look-at (clamped), in root space.
    let ty = 0;
    let tp = 0;
    const w = allowLook && this.lookTarget ? this.lookWeight : 0;
    if (w > 0 && this.lookTarget && this.bones.head) {
      this.bones.head.getWorldPosition(this.tmp);
      const dir = this.tmp.subVectors(this.lookTarget, this.tmp);
      root.getWorldQuaternion(this.inv).invert();
      dir.applyQuaternion(this.inv);
      ty = clamp(Math.atan2(dir.x, dir.z), -1.1, 1.1);
      tp = clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.6, 0.5);
      if (Math.abs(Math.atan2(dir.x, dir.z)) > 1.9) {
        ty = 0;
        tp = 0;
      }
    }
    this.lookYaw = damp(this.lookYaw, ty * w, 5, dt);
    this.lookPitch = damp(this.lookPitch, tp * w, 5, dt);
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 1e-4) {
      if (this.bones.neck) {
        this.e.set(this.lookPitch * 0.4, this.lookYaw * 0.4, 0);
        this.bones.neck.quaternion.multiply(this.q.setFromEuler(this.e));
      }
      if (this.bones.head) {
        this.e.set(this.lookPitch * 0.6, this.lookYaw * 0.6, 0);
        this.bones.head.quaternion.multiply(this.q.setFromEuler(this.e));
      }
    }
  }
}
