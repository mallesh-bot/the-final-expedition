import * as THREE from 'three';
import { clamp, damp } from '../systems/noise';

/** Ground query: height of the walkable surface under (x, z) not above maxY, plus its normal. */
export type GroundSampler = (x: number, z: number, maxY: number, normalOut: THREE.Vector3) => number;

interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  /** Smoothed vertical correction (m). */
  offset: number;
  /** Smoothed ground normal under the foot. */
  normal: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _ab = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Apply a world-space rotation to a bone (keeps its parent intact). */
function rotateWorld(bone: THREE.Object3D, rot: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(_pq);
  // local' = parent^-1 * rot * parent * local
  _q2.copy(_pq).invert().multiply(rot).multiply(_pq);
  bone.quaternion.premultiply(_q2);
  bone.updateMatrixWorld(true);
}

/**
 * Terrain-adaptive feet (PRD §11.2): after the clip pose, each foot is moved by the terrain
 * height difference between its own position and the character's root, the hips drop to let
 * the lower foot reach, a two-bone solver bends the knee, and the foot tilts to the ground
 * slope. Clip lift (steps, jumps) is preserved because only the *terrain delta* is added.
 */
export class FootIK {
  private legs: Leg[] = [];
  private hipOffset = 0;
  /** 0..1, faded in/out by the caller (grounded locomotion only). */
  weight = 0;
  enabled = true;

  constructor(
    private hips: THREE.Object3D | undefined,
    legs: { thigh?: THREE.Object3D; calf?: THREE.Object3D; foot?: THREE.Object3D }[],
  ) {
    for (const l of legs) {
      if (l.thigh && l.calf && l.foot) this.legs.push({ thigh: l.thigh, calf: l.calf, foot: l.foot, offset: 0, normal: new THREE.Vector3(0, 1, 0) });
    }
  }

  get ready(): boolean {
    return this.enabled && !!this.hips && this.legs.length === 2;
  }

  /** Last applied per-foot corrections (debug/tests). */
  get corrections(): number[] {
    return this.legs.map((l) => l.offset);
  }

  update(dt: number, root: THREE.Object3D, ground: GroundSampler): void {
    if (!this.ready || this.weight <= 0.001) {
      this.hipOffset = damp(this.hipOffset, 0, 12, dt);
      for (const l of this.legs) l.offset = damp(l.offset, 0, 12, dt);
      if (Math.abs(this.hipOffset) < 1e-4) return;
    }
    root.updateMatrixWorld(true);
    const rootY = root.position.y;
    // 1. Terrain delta under each foot, relative to the ground under the root.
    let minDelta = 0;
    const deltas: number[] = [];
    for (const l of this.legs) {
      l.foot.getWorldPosition(_a);
      const gy = ground(_a.x, _a.z, rootY + 0.6, _n);
      const d = clamp(gy - rootY, -0.4, 0.35) * this.weight;
      deltas.push(d);
      minDelta = Math.min(minDelta, d);
      l.normal.lerp(_n, 1 - Math.exp(-14 * dt)).normalize();
    }
    // 2. Lower the hips so the lower foot can reach (smoothed to avoid pops).
    this.hipOffset = damp(this.hipOffset, minDelta, 14, dt);
    if (Math.abs(this.hipOffset) > 1e-4) {
      const hips = this.hips!;
      hips.parent!.getWorldQuaternion(_pq);
      hips.parent!.getWorldScale(_b);
      _c.set(0, this.hipOffset / Math.max(_b.y, 1e-4), 0).applyQuaternion(_pq.invert());
      hips.position.add(_c);
      hips.updateMatrixWorld(true);
    }
    // 3. Two-bone IK per leg toward (current ankle + remaining delta).
    this.legs.forEach((l, i) => {
      l.offset = damp(l.offset, deltas[i] - this.hipOffset, 14, dt);
      if (Math.abs(l.offset) < 1e-4) {
        this.alignFoot(l);
        return;
      }
      l.thigh.getWorldPosition(_a); // hip joint
      l.calf.getWorldPosition(_b); // knee
      l.foot.getWorldPosition(_c); // ankle
      _t.copy(_c);
      _t.y += l.offset;
      const l1 = _a.distanceTo(_b);
      const l2 = _b.distanceTo(_c);
      const reach = clamp(_a.distanceTo(_t), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
      // Knee: set the inner angle from the law of cosines, bending in the current knee plane.
      const cur = _a.distanceTo(_c);
      const angCur = Math.acos(clamp((l1 * l1 + l2 * l2 - cur * cur) / (2 * l1 * l2), -1, 1));
      const angNew = Math.acos(clamp((l1 * l1 + l2 * l2 - reach * reach) / (2 * l1 * l2), -1, 1));
      const ab = _ab.subVectors(_b, _a);
      const bc = _bc.subVectors(_c, _b);
      const axis = _axis.crossVectors(ab, bc);
      if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).applyQuaternion(l.thigh.getWorldQuaternion(_q)); // straight leg: bend forward
      axis.normalize();
      _q.setFromAxisAngle(axis, angCur - angNew);
      rotateWorld(l.calf, _q);
      // Thigh: swing hip->ankle onto hip->target.
      l.foot.getWorldPosition(_c);
      const from = _from.subVectors(_c, _a).normalize();
      const to = _to.subVectors(_t, _a).normalize();
      _q.setFromUnitVectors(from, to);
      rotateWorld(l.thigh, _q);
      this.alignFoot(l);
    });
  }

  /** Tilt the foot to the ground slope (clamped to 25 degrees). */
  private alignFoot(l: Leg): void {
    if (this.weight <= 0.001) return;
    const n = _n.copy(l.normal);
    const ang = Math.acos(clamp(n.dot(UP), -1, 1));
    if (ang < 0.01) return;
    const k = Math.min(1, THREE.MathUtils.degToRad(25) / ang) * this.weight;
    _q.setFromUnitVectors(UP, n);
    _q2.identity().slerp(_q, k);
    rotateWorld(l.foot, _q2);
  }
}
