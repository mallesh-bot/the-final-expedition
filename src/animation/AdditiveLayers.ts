import * as THREE from 'three';
import { clamp, damp } from '../systems/noise';

/**
 * Procedural layers applied after the mixer each frame, on any rig that maps the logical bone
 * names. Everything is expressed in the character's frame and converted per bone, so it behaves
 * the same on every rig: turn lean, acceleration lean, in-air body attitude, look-at, speech.
 */
export class AdditiveLayers {
  private lookYaw = 0;
  private lookPitch = 0;
  /** Smoothed body attitude (radians, character frame): + pitch forward, + roll to her right. */
  private pitch = 0;
  private roll = 0;
  private headNod = 0;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();
  private inv = new THREE.Quaternion();
  private rootQ = new THREE.Quaternion();
  private qWorld = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 0;
  enabled = true;
  /** Desired attitude this frame, set by the owner before update(). */
  bodyPitch = 0;
  bodyRoll = 0;
  /** Attitude response (per second): quick on the ground, floatier in the air. */
  attitudeRate = 7;
  /** 0..1 speech energy: small head movement while talking. */
  speech = 0;
  /** 0..1 how far the arms spread for balance in a fall. */
  airSpread = 0;
  private spread = 0;
  private flail = 0;

  constructor(private bones: { hips?: THREE.Object3D; spine?: THREE.Object3D; chest?: THREE.Object3D; neck?: THREE.Object3D; head?: THREE.Object3D; upperArmL?: THREE.Object3D; upperArmR?: THREE.Object3D; lowerArmL?: THREE.Object3D; lowerArmR?: THREE.Object3D; thighL?: THREE.Object3D; thighR?: THREE.Object3D }) {}

  /** Rotate `bone` by pitch/yaw/roll given in the character's frame. */
  private bend(bone: THREE.Object3D | undefined, pitch: number, yaw: number, roll: number): void {
    if (!bone || !bone.parent) return;
    this.e.set(pitch, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.qWorld.copy(this.rootQ).multiply(this.q).multiply(this.inv.copy(this.rootQ).invert());
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(this.parentQ);
    this.q.copy(this.parentQ).invert().multiply(this.qWorld).multiply(this.parentQ);
    bone.quaternion.premultiply(this.q);
    bone.updateMatrixWorld(true);
  }

  update(dt: number, root: THREE.Object3D, allowLook: boolean): void {
    if (!this.enabled) return;
    root.updateWorldMatrix(true, false);
    root.getWorldQuaternion(this.rootQ);
    // Body attitude, split between hips and spine so the bend reads through the whole torso.
    this.pitch = damp(this.pitch, clamp(this.bodyPitch, -0.6, 0.7), this.attitudeRate, dt);
    this.roll = damp(this.roll, clamp(this.bodyRoll, -0.42, 0.42), this.attitudeRate, dt);
    if (Math.abs(this.pitch) + Math.abs(this.roll) > 1e-3) {
      this.bend(this.bones.hips, this.pitch * 0.3, 0, this.roll * 0.45);
      this.bend(this.bones.spine, this.pitch * 0.35, 0, this.roll * 0.3);
      this.bend(this.bones.chest, this.pitch * 0.35, 0, this.roll * 0.25);
      // Eyes stay level: the neck counter-rotates most of the lean.
      this.bend(this.bones.neck, -this.pitch * 0.55, 0, -this.roll * 0.6);
    }
    // Falling: the arms come up and out and work for balance, the legs open a little.
    this.spread = damp(this.spread, this.airSpread, 4.5, dt);
    if (this.spread > 0.01) {
      this.flail += dt * 7;
      const s = this.spread;
      const a = Math.sin(this.flail) * 0.16 * s;
      const b = Math.sin(this.flail * 0.73 + 1.4) * 0.16 * s;
      this.bend(this.bones.upperArmL, a * 0.6, 0, s * 1.15 + b);
      this.bend(this.bones.upperArmR, -b * 0.6, 0, -s * 1.15 - a);
      this.bend(this.bones.lowerArmL, 0, 0, s * 0.35);
      this.bend(this.bones.lowerArmR, 0, 0, -s * 0.35);
      this.bend(this.bones.thighL, a * 0.5, 0, s * 0.16);
      this.bend(this.bones.thighR, b * 0.5, 0, -s * 0.16);
    }
    // Head look-at (clamped), in root space.
    let ty = 0;
    let tp = 0;
    const w = allowLook && this.lookTarget ? this.lookWeight : 0;
    if (w > 0 && this.lookTarget && this.bones.head) {
      this.bones.head.getWorldPosition(this.tmp);
      const dir = this.tmp.subVectors(this.lookTarget, this.tmp);
      dir.applyQuaternion(this.inv.copy(this.rootQ).invert());
      ty = clamp(Math.atan2(dir.x, dir.z), -1.1, 1.1);
      tp = clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.6, 0.5);
      if (Math.abs(Math.atan2(dir.x, dir.z)) > 1.9) {
        ty = 0;
        tp = 0;
      }
    }
    this.lookYaw = damp(this.lookYaw, ty * w, 5, dt);
    this.lookPitch = damp(this.lookPitch, tp * w, 5, dt);
    this.headNod = damp(this.headNod, this.speech, 8, dt);
    const now = performance.now();
    const nod = this.headNod > 0.01 ? (Math.sin(now * 0.0072) * 0.035 + Math.sin(now * 0.0031) * 0.03) * this.headNod : 0;
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) + Math.abs(nod) > 1e-4) {
      this.bend(this.bones.neck, this.lookPitch * 0.4, this.lookYaw * 0.4, 0);
      this.bend(this.bones.head, this.lookPitch * 0.6 + nod, this.lookYaw * 0.6, 0);
    }
  }
}
