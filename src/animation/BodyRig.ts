import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _k = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _oq = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/** Apply a world-space rotation to a bone (keeps its parent intact). */
function rotateWorld(bone: THREE.Object3D, rot: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(_pq);
  _q2.copy(_pq).invert().multiply(rot).multiply(_pq);
  bone.quaternion.premultiply(_q2);
  bone.updateMatrixWorld(true);
}

/** Set a bone's world rotation, blended from where the pose has it by `w`. */
function setWorldRotation(bone: THREE.Object3D, target: THREE.Quaternion, w: number): void {
  bone.parent!.getWorldQuaternion(_pq);
  _q2.copy(_pq).invert().multiply(target);
  bone.quaternion.slerp(_q2, w);
  bone.updateMatrixWorld(true);
}

export interface LimbGoal {
  /** World target for the wrist / ankle. */
  target: THREE.Vector3;
  /** 0 = leave the clip's limb alone, 1 = fully on target. */
  w: number;
  /** Rotation relative to the T-pose, expressed in the character frame. */
  orient: THREE.Quaternion;
  orientW: number;
  /** World direction the elbow / knee should point. */
  pole: THREE.Vector3;
  /** Finger curl 0..1 (hands). */
  grip: number;
}

export interface BodyGoal {
  /** Pelvis world target. */
  pelvis: THREE.Vector3;
  pelvisW: number;
  /** Torso bend in the character frame, radians: + pitch leans forward. */
  pitch: number;
  yaw: number;
  roll: number;
  /** Pelvis tilt in the character frame. */
  hipPitch: number;
  hipRoll: number;
  hipYaw: number;
  /** Head turn in the character frame: + pitch looks down. */
  headPitch: number;
  headYaw: number;
  limbs: [LimbGoal, LimbGoal, LimbGoal, LimbGoal];
}

export const HAND_L = 0;
export const HAND_R = 1;
export const FOOT_L = 2;
export const FOOT_R = 3;

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  rest: THREE.Quaternion;
}

interface FingerJoint {
  bone: THREE.Object3D;
  axis: THREE.Vector3;
  amount: number;
}

const newLimb = (): LimbGoal => ({ target: new THREE.Vector3(), w: 0, orient: new THREE.Quaternion(), orientW: 0, pole: new THREE.Vector3(0, -1, 0), grip: 0 });

export function newBodyGoal(): BodyGoal {
  return { pelvis: new THREE.Vector3(), pelvisW: 0, pitch: 0, yaw: 0, roll: 0, hipPitch: 0, hipRoll: 0, hipYaw: 0, headPitch: 0, headYaw: 0, limbs: [newLimb(), newLimb(), newLimb(), newLimb()] };
}

/**
 * Full-body IK applied after the animation clips: pelvis placement, torso and head bends, two-bone
 * arms and legs with pole control, hand/foot orientation and finger grip. The controller that owns
 * it (climbing, mantling, vaulting) only ever says where the body parts should be in the world.
 */
export class BodyRig {
  private limbs: Limb[] = [];
  private pelvis: THREE.Object3D | undefined;
  private spine: THREE.Object3D[] = [];
  private neck: THREE.Object3D | undefined;
  private head: THREE.Object3D | undefined;
  private fingers: [FingerJoint[], FingerJoint[]] = [[], []];
  /** Arm length (shoulder to wrist) measured from the skeleton. */
  armLength = 0.55;
  legLength = 0.85;
  ready = false;

  constructor(private scene: THREE.Object3D) {
    let skeleton: THREE.Skeleton | null = null;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !skeleton) skeleton = m.skeleton;
    });
    const sk = skeleton as THREE.Skeleton | null;
    const get = (n: string) => scene.getObjectByName(n);
    const restOf = (b: THREE.Object3D | undefined): THREE.Quaternion => {
      const q = new THREE.Quaternion();
      if (!b || !sk) return q;
      const i = sk.bones.indexOf(b as THREE.Bone);
      if (i >= 0) {
        _m.copy(sk.boneInverses[i]).invert();
        _m.decompose(_a, q, _s);
      }
      return q;
    };
    const restPos = (b: THREE.Object3D | undefined): THREE.Vector3 => {
      const p = new THREE.Vector3();
      if (!b || !sk) return p;
      const i = sk.bones.indexOf(b as THREE.Bone);
      if (i >= 0) {
        _m.copy(sk.boneInverses[i]).invert();
        p.setFromMatrixPosition(_m);
      }
      return p;
    };
    const limb = (u: string, l: string, e: string): Limb | null => {
      const upper = get(u);
      const lower = get(l);
      const end = get(e);
      if (!upper || !lower || !end) return null;
      return { upper, lower, end, rest: restOf(end) };
    };
    const ls = [limb('upperarm_l', 'lowerarm_l', 'hand_l'), limb('upperarm_r', 'lowerarm_r', 'hand_r'), limb('thigh_l', 'calf_l', 'foot_l'), limb('thigh_r', 'calf_r', 'foot_r')];
    if (ls.some((l) => !l)) return;
    this.limbs = ls as Limb[];
    this.pelvis = get('pelvis');
    this.spine = ['spine_01', 'spine_02', 'spine_03'].map(get).filter(Boolean) as THREE.Object3D[];
    this.neck = get('neck_01');
    this.head = get('Head');
    const L = this.limbs;
    this.armLength = restPos(L[0].upper).distanceTo(restPos(L[0].lower)) + restPos(L[0].lower).distanceTo(restPos(L[0].end));
    this.legLength = restPos(L[2].upper).distanceTo(restPos(L[2].lower)) + restPos(L[2].lower).distanceTo(restPos(L[2].end));
    // Fingers curl toward the palm: in the T-pose palms face down, so the axis is ±Z of the
    // character. Stored per bone so the curl is a local rotation that follows the hand.
    for (const [side, sign, list] of [['l', -1, this.fingers[0]], ['r', 1, this.fingers[1]]] as const) {
      for (const f of ['index', 'middle', 'ring', 'pinky']) {
        for (const [j, amt] of [['01', 1.15], ['02', 1.35], ['03', 0.9]] as const) {
          const b = get(`${f}_${j}_${side}`);
          if (!b) continue;
          const axis = new THREE.Vector3(0, 0, sign).applyQuaternion(restOf(b).invert());
          list.push({ bone: b, axis, amount: amt });
        }
      }
      for (const [j, amt] of [['02', 0.5], ['03', 0.55]] as const) {
        const b = get(`thumb_${j}_${side}`);
        if (!b) continue;
        const axis = new THREE.Vector3(0, 0, sign).applyQuaternion(restOf(b).invert());
        list.push({ bone: b, axis, amount: amt });
      }
    }
    this.ready = !!this.pelvis && this.spine.length > 0;
  }

  /** Solve the pose for this frame. `frame` is the character's world rotation. */
  solve(g: BodyGoal, frame: THREE.Quaternion, weight: number): void {
    if (!this.ready || weight <= 0.001) return;
    this.scene.updateWorldMatrix(true, true);
    const pelvis = this.pelvis!;
    // Pelvis position.
    if (g.pelvisW > 0.001) {
      pelvis.getWorldPosition(_a);
      _a.lerp(g.pelvis, g.pelvisW * weight);
      pelvis.parent!.worldToLocal(_a);
      pelvis.position.copy(_a);
      pelvis.updateMatrixWorld(true);
    }
    // Pelvis + torso bends (in the character frame, distributed down the spine).
    this.bend(pelvis, g.hipPitch * weight, g.hipYaw * weight, g.hipRoll * weight, frame);
    const n = this.spine.length;
    for (const b of this.spine) this.bend(b, (g.pitch * weight) / n, (g.yaw * weight) / n, (g.roll * weight) / n, frame);
    if (this.neck) this.bend(this.neck, g.headPitch * 0.35 * weight, g.headYaw * 0.35 * weight, 0, frame);
    if (this.head) this.bend(this.head, g.headPitch * 0.65 * weight, g.headYaw * 0.65 * weight, 0, frame);

    // Never let hands miss their hold: if a hand target is out of reach, move the body toward it.
    this.assistReach(g, weight);

    g.limbs.forEach((goal, i) => this.solveLimb(this.limbs[i], goal, frame, weight));
    this.applyGrip(0, g.limbs[HAND_L].grip * weight);
    this.applyGrip(1, g.limbs[HAND_R].grip * weight);
  }

  private bend(b: THREE.Object3D, pitch: number, yaw: number, roll: number, frame: THREE.Quaternion): void {
    if (Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll) < 1e-4) return;
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    // Rotation given in the character frame → world.
    const worldRot = _pq.copy(frame).multiply(_q).multiply(_q2.copy(frame).invert());
    _q.copy(worldRot);
    rotateWorld(b, _q);
  }

  private assistReach(g: BodyGoal, weight: number): void {
    let needX = 0;
    let needY = 0;
    let needZ = 0;
    let worst = 0;
    for (const i of [HAND_L, HAND_R]) {
      const goal = g.limbs[i];
      if (goal.w * weight < 0.6) continue;
      const L = this.limbs[i];
      L.upper.getWorldPosition(_a);
      _d.subVectors(goal.target, _a);
      const dist = _d.length();
      const over = dist - this.armLength * 0.985;
      if (over > worst) {
        worst = over;
        _d.normalize();
        needX = _d.x * over;
        needY = _d.y * over;
        needZ = _d.z * over;
      }
    }
    if (worst > 1e-3) {
      const pelvis = this.pelvis!;
      pelvis.getWorldPosition(_a);
      _a.x += needX;
      _a.y += needY;
      _a.z += needZ;
      pelvis.parent!.worldToLocal(_a);
      pelvis.position.copy(_a);
      pelvis.updateMatrixWorld(true);
    }
  }

  private solveLimb(L: Limb, goal: LimbGoal, frame: THREE.Quaternion, weight: number): void {
    const w = goal.w * weight;
    if (w > 0.001) {
      L.upper.getWorldPosition(_a);
      L.lower.getWorldPosition(_b);
      L.end.getWorldPosition(_c);
      _t.copy(_c).lerp(goal.target, w);
      const l1 = _a.distanceTo(_b);
      const l2 = _b.distanceTo(_c);
      _d.subVectors(_t, _a);
      let dist = _d.length();
      const max = l1 + l2 - 1e-3;
      const min = Math.abs(l1 - l2) + 1e-3;
      if (dist > max) dist = max;
      if (dist < min) dist = min;
      _d.normalize();
      // Desired joint: along the shoulder→wrist axis, offset toward the pole.
      const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
      _p.copy(goal.pole).addScaledVector(_d, -goal.pole.dot(_d));
      if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0).addScaledVector(_d, _d.y);
      _p.normalize();
      _k.copy(_a).addScaledVector(_d, x).addScaledVector(_p, h);
      // Swing the upper bone onto the joint, then the lower bone onto the target.
      _b.sub(_a).normalize();
      _q.setFromUnitVectors(_b, _p.subVectors(_k, _a).normalize());
      rotateWorld(L.upper, _q);
      L.lower.getWorldPosition(_b);
      L.end.getWorldPosition(_c);
      _d.subVectors(_c, _b).normalize();
      _p.copy(_a).addScaledVector(_t.sub(_a).normalize(), dist).sub(_b).normalize();
      _q.setFromUnitVectors(_d, _p);
      rotateWorld(L.lower, _q);
    }
    if (goal.orientW * weight > 0.001) {
      _oq.copy(frame).multiply(goal.orient).multiply(L.rest);
      setWorldRotation(L.end, _oq, goal.orientW * weight);
    }
  }

  private applyGrip(side: 0 | 1, grip: number): void {
    if (grip < 0.01) return;
    for (const j of this.fingers[side]) {
      _q.setFromAxisAngle(j.axis, j.amount * grip);
      j.bone.quaternion.multiply(_q);
    }
    (side === 0 ? this.limbs[0] : this.limbs[1]).end.updateMatrixWorld(true);
  }

  /** World position of a limb's end (tests + hit checks). */
  limbEnd(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.limbs[i]?.end.getWorldPosition(out) ?? out;
  }

  pelvisPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.pelvis?.getWorldPosition(out) ?? out;
  }
}
