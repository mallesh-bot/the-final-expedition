import * as THREE from 'three';
import { BodyRig, FOOT_L, FOOT_R, HAND_L, HAND_R, newBodyGoal, type BodyGoal } from './BodyRig';
import { clamp, damp, lerp, mulberry32, smoothstep as ss } from '../systems/noise';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();

/** Rotation from three orthonormal column vectors (images of +X, +Y, +Z). */
function basis(x: [number, number, number], y: [number, number, number], z: [number, number, number]): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Hand orientations relative to the T-pose, in the character frame (+Z = forward, +X = her left).
/** Palm flat on a wall in front, fingers up (turned a little inward, as hands naturally sit). */
const PALM_WALL_L = basis([0, 1, 0], [0, 0, -1], [-1, 0, 0]).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0));
const PALM_WALL_R = basis([0, -1, 0], [0, 0, -1], [1, 0, 0]);
/** Fingers over a ledge lip: pointing forward, palm down. */
const OVER_L = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const OVER_R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
/** Toes to the wall with the heel dropped: the way a climber stands on a hold. */
const TOE_ON_WALL = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0));
const FOOT_FLAT = new THREE.Quaternion();

type RigKind = 'none' | 'climb' | 'hang' | 'sidle' | 'over' | 'vault' | 'rappel' | 'rope';

interface WallPreset {
  /** Rest offsets of [LH, RH, LF, RF] from the root, along (her right, up), metres. */
  rest: [number, number][];
  handOut: number;
  footOut: number;
  /** Distance of the root from the wall plane. */
  wallDist: number;
  /** Fixed world height for the hands (ledge lip); null = free on the wall. */
  handY: number | null;
  step: number;
  pelvisH: number;
  pelvisOut: number;
  pitch: number;
  headPitch: number;
  grip: number;
  /** Hands hold a rope that travels with the body (no reaching). */
  handsFollow?: boolean;
  /** Feet too (free-hanging on a rope). */
  feetFollow?: boolean;
}

const CLIMB: WallPreset = {
  rest: [[-0.21, 1.78], [0.21, 1.78], [-0.18, 0.47], [0.18, 0.47]],
  handOut: 0.045,
  footOut: 0.15,
  wallDist: 0.36,
  handY: null,
  step: 0.5,
  pelvisH: 0.93,
  pelvisOut: 0.33,
  pitch: 0.12,
  headPitch: -0.32,
  grip: 0.42,
};
const HANG: WallPreset = {
  rest: [[-0.22, 0], [0.22, 0], [-0.15, 0.38], [0.17, 0.5]],
  handOut: 0.05,
  footOut: 0.15,
  wallDist: 0.3,
  handY: 0,
  step: 0.32,
  pelvisH: 1.0,
  pelvisOut: 0.27,
  pitch: 0.04,
  headPitch: -0.3,
  grip: 0.82,
};
const SIDLE: WallPreset = {
  rest: [[-0.42, 1.38], [0.42, 1.38], [-0.14, 0.08], [0.14, 0.08]],
  handOut: 0.04,
  footOut: 0.27,
  wallDist: 0.3,
  handY: null,
  step: 0.3,
  pelvisH: 0.88,
  pelvisOut: 0.27,
  pitch: 0.06,
  headPitch: 0.05,
  grip: 0.12,
};

/** Rappelling: leaning out from the wall, feet walking down it, one hand high and one braking. */
const RAPPEL: WallPreset = {
  rest: [[-0.04, 1.42], [0.09, 0.98], [-0.16, 0.5], [0.16, 0.5]],
  handOut: 0.62,
  footOut: 0.15,
  wallDist: 0.85,
  handY: null,
  step: 0.42,
  pelvisH: 0.8,
  pelvisOut: 0.9,
  pitch: -0.05,
  headPitch: 0.3,
  grip: 0.85,
  handsFollow: true,
};
/** Free-hanging on a rope: hands stacked above the head, one knee up around the rope. */
const ROPE: WallPreset = {
  rest: [[-0.02, 1.84], [0.02, 1.58], [-0.1, 0.3], [0.03, 0.58]],
  handOut: 0.0,
  footOut: 0.02,
  wallDist: 0.0,
  handY: null,
  step: 1,
  pelvisH: 0.96,
  pelvisOut: 0.22,
  pitch: 0.12,
  headPitch: 0.25,
  grip: 0.9,
  handsFollow: true,
  feetFollow: true,
};

/**
 * Full-body climbing (reference: third-person adventure games): hands and feet are planted on
 * the rock and never slide; the body moves between them, a diagonal pair reaches at a time, the
 * hips shift weight away from the reaching hand, and the head looks where the hand is going.
 * Also: catch-and-swing on ledge grabs, hand-over-hand shimmy, wall sidle, mantling and vaults.
 */
export class ClimbController {
  readonly rig: BodyRig;
  private goal: BodyGoal = newBodyGoal();
  private weight = 0;
  private kind: RigKind = 'none';
  private planted = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private from = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private to = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private k = [1, 1, 1, 1];
  private swingDur = 0.3;
  private nextPair = 0;
  private lastRoot = new THREE.Vector3();
  private speed = 0;
  private dir = new THREE.Vector3();
  private sway = 0;
  private heave = 0;
  private idleT = 0;
  private rest = 0;
  private lookYaw = 0;
  private rnd = mulberry32(77);
  /** Pendulum from a ledge catch: offset along the wall normal + velocity. */
  private swing = 0;
  private swingV = 0;
  private catchT = 0;
  private frame = new THREE.Quaternion();
  /** A hand or foot came down on a hold (sound). */
  onPlant: ((isHand: boolean) => void) | null = null;
  /** 0..1 how much the body is pulling right now (the player's climb speed follows it). */
  pull = 1;

  constructor(scene: THREE.Object3D) {
    this.rig = new BodyRig(scene);
  }

  get active(): boolean {
    return this.weight > 0.001;
  }

  /** Limb world positions (tests: hands on holds, no sliding). */
  plantedPoint(i: number): THREE.Vector3 {
    return this.planted[i];
  }

  isPlanted(i: number): boolean {
    return this.k[i] >= 1;
  }

  // ------------------------------------------------------------------ per-mode entry points
  climb(dt: number, root: THREE.Object3D, normal: THREE.Vector3, rootFinal?: THREE.Vector3): void {
    this.gait('climb', CLIMB, dt, root, normal, null, rootFinal);
  }

  hang(dt: number, root: THREE.Object3D, normal: THREE.Vector3, ledgeY: number, rootFinal?: THREE.Vector3, caught = false): void {
    if (caught && this.kind !== 'hang') {
      this.swingV = 1.1;
      this.catchT = 0.55;
    }
    this.gait('hang', HANG, dt, root, normal, ledgeY, rootFinal);
  }

  sidle(dt: number, root: THREE.Object3D, normal: THREE.Vector3): void {
    this.gait('sidle', SIDLE, dt, root, normal, null);
  }

  rappel(dt: number, root: THREE.Object3D, normal: THREE.Vector3, wallDist: number): void {
    RAPPEL.wallDist = wallDist;
    RAPPEL.handOut = Math.max(0.2, wallDist - 0.22);
    RAPPEL.pelvisOut = wallDist + 0.05;
    this.gait('rappel', RAPPEL, dt, root, normal, null);
  }

  /** Hanging free on a rope, facing along `normal`'s opposite. */
  ropeHang(dt: number, root: THREE.Object3D, normal: THREE.Vector3): void {
    this.gait('rope', ROPE, dt, root, normal, null);
  }

  private plantAll(p: WallPreset, root: THREE.Vector3, normal: THREE.Vector3, right: THREE.Vector3, handY: number | null): void {
    const onWall = _w.copy(root).addScaledVector(normal, -p.wallDist);
    const base = onWall.clone();
    for (let i = 0; i < 4; i++) {
      const hand = i < 2;
      const [dx, dy] = p.rest[i];
      const stagger = (i === HAND_L || i === FOOT_R ? 1 : -1) * p.step * 0.22 * (p.handY === null ? 1 : 0);
      this.planted[i].copy(base).addScaledVector(right, dx).addScaledVector(normal, hand ? p.handOut : p.footOut);
      this.planted[i].y = hand && handY !== null ? handY + 0.025 : base.y + dy + (hand || p !== SIDLE ? stagger : 0);
      this.k[i] = 1;
    }
    this.nextPair = 0;
  }

  private gait(kind: RigKind, p: WallPreset, dt: number, root: THREE.Object3D, normal: THREE.Vector3, ledgeY: number | null, rootFinal?: THREE.Vector3): void {
    const right = _x.set(normal.z, 0, -normal.x).clone();
    const handY = ledgeY;
    if (this.kind !== kind) {
      this.plantAll(p, rootFinal ?? root.position, normal, right, handY);
      this.kind = kind;
      this.lastRoot.copy(root.position);
      this.dir.set(0, 0, 0);
      this.speed = 0;
    }
    // Body motion along the wall.
    const inst = _v.subVectors(root.position, this.lastRoot);
    const dist = inst.length();
    const sp = dt > 0 ? dist / dt : 0;
    if (dist > 1e-4) this.dir.copy(inst).normalize();
    this.speed = damp(this.speed, sp, 10, dt);
    this.lastRoot.copy(root.position);
    const wallPt = _w.copy(root.position).addScaledVector(normal, -p.wallDist);
    const moving = rootFinal ? false : this.speed > 0.06;

    // Reach: when a limb has fallen half a step behind, its diagonal pair takes the next hold.
    const idealInto = (i: number, out: THREE.Vector3) => {
      const hand = i < 2;
      const [dx, dy] = p.rest[i];
      out.copy(wallPt).addScaledVector(right, dx).addScaledVector(normal, hand ? p.handOut : p.footOut);
      out.y = hand && handY !== null ? handY + 0.025 : wallPt.y + dy;
      return out;
    };
    if (p.handsFollow) for (const i of p.feetFollow ? [0, 1, 2, 3] : [0, 1]) {
      idealInto(i, this.planted[i]);
      this.k[i] = 1;
    }
    const swinging = this.k.some((v) => v < 1);
    if (!swinging && !rootFinal && !p.feetFollow) {
      const pairs = [[HAND_L, FOOT_R], [HAND_R, FOOT_L]];
      let err = 0;
      for (const i of p.handsFollow ? [2, 3] : [0, 1, 2, 3]) err = Math.max(err, idealInto(i, _v).distanceTo(this.planted[i]));
      if (err > p.step * (moving ? 0.5 : 0.8)) {
        const pair = pairs[this.nextPair];
        this.nextPair = 1 - this.nextPair;
        // Climbing is reach-then-heave: a deliberate reach; ledge and wall sidles are quicker.
        this.swingDur = kind === 'climb' ? 0.42 : clamp((p.step * 0.72) / Math.max(this.speed, 0.5), 0.17, 0.42);
        for (const i of pair) {
          if (p.handsFollow && i < 2) continue;
          this.from[i].copy(this.planted[i]);
          idealInto(i, this.to[i]);
          if (moving) this.to[i].addScaledVector(this.dir, p.step * 0.36);
          // Natural variation: holds are never in a perfect grid.
          this.to[i].addScaledVector(right, (this.rnd() - 0.5) * 0.06);
          if (!(i < 2 && handY !== null)) this.to[i].y += (this.rnd() - 0.5) * 0.05;
          this.k[i] = 0;
        }
      }
    }
    // Swing limbs in an arc off the wall.
    let handSwing = 0;
    let reachSide = 0;
    for (let i = 0; i < 4; i++) {
      if (this.k[i] >= 1) continue;
      this.k[i] = Math.min(1, this.k[i] + dt / this.swingDur);
      const e = ss(0, 1, this.k[i]);
      this.planted[i].lerpVectors(this.from[i], this.to[i], e).addScaledVector(normal, Math.sin(this.k[i] * Math.PI) * (i < 2 ? 0.09 : 0.07));
      if (i < 2) {
        handSwing = Math.sin(this.k[i] * Math.PI);
        reachSide = i === HAND_L ? -1 : 1;
      }
      if (this.k[i] >= 1) this.onPlant?.(i < 2);
    }
    // The body waits while a hand reaches, then heaves up through the planted holds.
    const heaving = kind === 'climb' && handSwing === 0 && moving ? 1 : 0;
    this.heave = damp(this.heave, heaving, 12, dt);
    const pullTarget = kind === 'climb' ? (handSwing > 0 ? 0.3 : 1.6) : handSwing > 0 ? 0.75 : 1.2;
    this.pull = damp(this.pull, pullTarget, 11, dt);

    // Weight shift: hips move away from the reaching hand, the torso twists into the reach.
    this.sway = damp(this.sway, -reachSide * 0.075 * handSwing, 9, dt);
    this.lookYaw = damp(this.lookYaw, reachSide * 0.45 * handSwing, 7, dt);
    // Ledge catch pendulum.
    this.catchT = Math.max(0, this.catchT - dt);
    this.swingV += (-this.swing * 42 - this.swingV * 5) * dt;
    this.swing += this.swingV * dt;

    // At rest on the wall she breathes, her weight settles, and she looks around for the next move.
    this.idleT += dt;
    this.rest = damp(this.rest, moving || handSwing > 0 ? 0 : 1, 3, dt);
    const breathe = Math.sin(this.idleT * 1.5) * this.rest;
    const settle = Math.sin(this.idleT * 0.55) * this.rest;
    const scan = Math.sin(this.idleT * 0.37) * this.rest;

    const g = this.goal;
    root.getWorldQuaternion(this.frame);
    g.pelvis.copy(root.position).addScaledVector(UP, p.pelvisH + breathe * 0.008 - Math.abs(settle) * (kind === 'hang' ? 0.012 : 0)).addScaledVector(normal, p.pelvisOut - p.wallDist + this.swing * 0.55 + (kind === 'climb' ? handSwing * 0.05 - this.heave * 0.035 : 0)).addScaledVector(right, this.sway);
    g.pelvisW = 1;
    // Charcter frame: her left is +X, and `right` above is her right, so sway → -roll.
    g.pitch = p.pitch - this.swing * 0.5 - (kind === 'climb' ? handSwing * 0.14 - this.heave * 0.1 : 0);
    g.yaw = -reachSide * 0.2 * handSwing;
    g.roll = this.sway * 1.1;
    g.hipPitch = -0.06;
    g.hipRoll = -this.sway * 1.8;
    g.hipYaw = reachSide * 0.05 * handSwing;
    g.headPitch = p.headPitch - (kind === 'climb' ? handSwing * 0.14 : 0);
    g.headYaw = -this.lookYaw + scan * 0.3;
    g.pitch += breathe * 0.014;
    g.roll += settle * 0.015;
    const hang = kind === 'hang';
    const footW = hang ? 1 - ss(0.15, 0.55, this.catchT) : 1;
    for (let i = 0; i < 4; i++) {
      const L = g.limbs[i];
      const hand = i < 2;
      const left = i === HAND_L || i === FOOT_L;
      L.target.copy(this.planted[i]);
      L.w = hand ? 1 : footW;
      if (hand) {
        L.orient.copy(hang ? (left ? OVER_L : OVER_R) : left ? PALM_WALL_L : PALM_WALL_R);
        L.orientW = 1;
        L.pole.copy(right).multiplyScalar(left ? -1 : 1).addScaledVector(UP, kind === 'sidle' ? -0.9 : -1.2).addScaledVector(normal, 0.5);
        L.grip = this.k[i] < 1 ? p.grip * 0.25 : p.grip;
      } else {
        L.orient.copy(kind === 'sidle' ? FOOT_FLAT : TOE_ON_WALL);
        L.orientW = kind === 'sidle' ? 0.7 : 1 * footW;
        L.pole.copy(right).multiplyScalar(left ? -0.8 : 0.8).addScaledVector(normal, -1).addScaledVector(UP, 0.3);
      }
    }
    this.weight = Math.min(1, this.weight + dt / 0.2);
    this.rig.solve(g, this.frame, this.weight);
  }

  /**
   * Mantle: from the hang, pull the chest over the lip, step a foot up, stand. Driven by k (0..1).
   * `edge` is the ledge lip under her, `normal` points out of the wall.
   */
  over(k: number, dt: number, root: THREE.Object3D, normal: THREE.Vector3, edge: THREE.Vector3): void {
    const right = _x.set(normal.z, 0, -normal.x).clone();
    this.kind = 'over';
    const g = this.goal;
    root.getWorldQuaternion(this.frame);
    const inward = -1;
    // Pelvis path through four keys (out from the wall → over the lip → standing).
    const keys: [number, number, number][] = [
      [0.0, 0.27, -1.02],
      [0.36, 0.2, -0.42],
      [0.62, -0.1, 0.34],
      [0.84, -0.38, 0.62],
      [1.0, -0.55, 0.92],
    ];
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (k >= keys[i][0] && k <= keys[i + 1][0]) {
      a = keys[i];
      b = keys[i + 1];
    }
    const t = ss(a[0], b[0], k);
    g.pelvis.copy(edge).addScaledVector(normal, lerp(a[1], b[1], t)).addScaledVector(UP, lerp(a[2], b[2], t));
    g.pelvisW = 1;
    // Torso folds forward over the lip, then straightens as she stands.
    g.pitch = 0.05 + ss(0.15, 0.55, k) * 0.85 - ss(0.68, 1, k) * 0.9;
    g.yaw = 0;
    g.roll = 0;
    g.hipPitch = ss(0.2, 0.6, k) * 0.5 - ss(0.68, 1, k) * 0.5;
    g.hipRoll = 0;
    g.hipYaw = 0;
    g.headPitch = -0.3 + ss(0.1, 0.6, k) * 0.45 - ss(0.75, 1, k) * 0.15;
    g.headYaw = 0;
    // Hands stay on the lip and press; they let go as she rises.
    for (const i of [HAND_L, HAND_R]) {
      const L = g.limbs[i];
      const left = i === HAND_L;
      const side = left ? -0.24 : 0.24;
      L.target.copy(edge).addScaledVector(right, side).addScaledVector(normal, 0.05 + inward * 0.2 * ss(0.3, 0.6, k)).addScaledVector(UP, 0.03 + ss(0.3, 0.6, k) * 0.06);
      L.w = 1 - ss(0.74, 0.92, k);
      L.orient.copy(left ? OVER_L : OVER_R);
      L.orientW = 1 - ss(0.74, 0.92, k);
      L.pole.copy(right).multiplyScalar(left ? -1 : 1).addScaledVector(UP, ss(0.3, 0.6, k) * 1.1 - 0.5).addScaledVector(normal, 0.4);
      L.grip = (1 - ss(0.3, 0.55, k)) * 0.8;
    }
    // Feet walk up the wall; the right steps onto the lip first, then the left follows.
    const fr = g.limbs[FOOT_R];
    const fl = g.limbs[FOOT_L];
    const wallFoot = (out: THREE.Vector3, sideOff: number, y: number) => out.copy(edge).addScaledVector(right, sideOff).addScaledVector(normal, 0.15).addScaledVector(UP, y);
    const pelvisY = lerp(a[2], b[2], t);
    wallFoot(_v, 0.17, Math.min(-0.2, pelvisY - 0.58));
    _w.copy(edge).addScaledVector(right, 0.14).addScaledVector(normal, -0.2).addScaledVector(UP, 0.09);
    {
      const s = ss(0.38, 0.6, k);
      fr.target.copy(_v).lerp(_w, s).addScaledVector(UP, Math.sin(s * Math.PI) * 0.16).addScaledVector(normal, Math.sin(s * Math.PI) * 0.1);
      const st = ss(0.8, 1, k);
      if (st > 0) fr.target.lerp(_w.copy(edge).addScaledVector(right, 0.13).addScaledVector(normal, -0.55).addScaledVector(UP, 0.08), st);
    }
    wallFoot(_v, -0.15, Math.min(-0.34, pelvisY - 0.68));
    _w.copy(edge).addScaledVector(right, -0.13).addScaledVector(normal, -0.55).addScaledVector(UP, 0.08);
    {
      const s = ss(0.62, 0.92, k);
      fl.target.copy(_v).lerp(_w, s).addScaledVector(UP, Math.sin(s * Math.PI) * 0.18);
    }
    for (const L of [fr, fl]) {
      L.w = 1 - ss(0.94, 1, k);
      L.orient.copy(FOOT_FLAT);
      L.orientW = 0.8 * (1 - ss(0.94, 1, k));
      L.pole.copy(normal).multiplyScalar(-1).addScaledVector(UP, 0.25).addScaledVector(right, L === fr ? 0.3 : -0.3);
    }
    this.weight = 1 - ss(0.95, 1, k);
    void dt;
    this.rig.solve(g, this.frame, this.weight);
  }

  /** Speed vault: right hand on the obstacle, body over, legs tucked to one side. */
  vault(k: number, root: THREE.Object3D, top: THREE.Vector3, forward: THREE.Vector3): void {
    this.kind = 'vault';
    const g = this.goal;
    root.getWorldQuaternion(this.frame);
    const right = _x.set(-forward.z, 0, forward.x).clone();
    const crouch = Math.sin(k * Math.PI);
    g.pelvis.copy(root.position).addScaledVector(UP, 0.92 - crouch * 0.12).addScaledVector(right, -crouch * 0.12);
    g.pelvisW = crouch > 0.02 ? 1 : 0;
    g.pitch = crouch * 0.42;
    g.yaw = crouch * 0.25;
    g.roll = crouch * 0.28;
    g.hipPitch = crouch * 0.1;
    g.hipRoll = crouch * 0.2;
    g.hipYaw = crouch * 0.35;
    g.headPitch = crouch * -0.3;
    g.headYaw = 0;
    const HR = g.limbs[HAND_R];
    HR.target.copy(top).addScaledVector(right, 0.14).addScaledVector(UP, 0.08);
    HR.w = ss(0.05, 0.3, k) * (1 - ss(0.62, 0.82, k));
    HR.orient.copy(OVER_R);
    HR.orientW = HR.w;
    HR.pole.copy(right).addScaledVector(forward, -0.5);
    HR.grip = 0.2;
    // The free arm goes out and low, balancing the body against the planted hand.
    const HL = g.limbs[HAND_L];
    HL.target.copy(root.position).addScaledVector(right, -0.62).addScaledVector(forward, 0.12).addScaledVector(UP, 1.0 - crouch * 0.05);
    HL.w = crouch * 0.9;
    HL.orientW = 0;
    HL.pole.copy(right).multiplyScalar(-1).addScaledVector(UP, -0.6).addScaledVector(forward, -0.4);
    HL.grip = 0;
    // Legs swing past the obstacle on her left, tucked.
    for (const i of [FOOT_L, FOOT_R]) {
      const L = g.limbs[i];
      const lead = i === FOOT_L;
      L.target.copy(root.position).addScaledVector(right, lead ? -0.32 : -0.12).addScaledVector(forward, lerp(-0.25, 0.45, k) + (lead ? 0.12 : -0.1)).addScaledVector(UP, 0.12 + crouch * (lead ? 0.26 : 0.34));
      L.w = crouch > 0.05 ? crouch * 0.95 : 0;
      L.orient.copy(FOOT_FLAT);
      L.orientW = 0;
      L.pole.copy(forward).addScaledVector(right, -0.6).addScaledVector(UP, 0.3);
    }
    this.weight = 1;
    this.rig.solve(g, this.frame, this.weight);
  }

  /** Nothing to do this frame: ease out of whatever pose we held. */
  release(dt: number, rate = 8): void {
    this.kind = 'none';
    this.k.fill(1);
    this.swing = 0;
    this.swingV = 0;
    this.weight = Math.max(0, this.weight - dt * rate);
    if (this.weight > 0.001) this.rig.solve(this.goal, this.frame, this.weight);
  }
}
