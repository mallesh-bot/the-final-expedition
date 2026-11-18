import * as THREE from 'three';

/**
 * Rebuilds the legs of the locomotion clips from gait biomechanics.
 *
 * The library's jog is a stylised bound: half of every cycle has both feet off the ground, the
 * trailing leg hangs split for a quarter of it and then snaps through in two frames, and to match
 * her speed it plays at about 100 steps a minute. So the leg and pelvis tracks are generated here
 * (foot paths solved with two-bone IK) while the arms and torso keep the clip's performance.
 *
 * The generated stance foot moves backwards at exactly the body's speed, so feet do not slide, and
 * the knee plane is explicit, so knees cannot fold sideways. Phase 0 is the left foot striking and
 * 0.5 the right, the same convention the footstep sounds and clip sync use.
 */
export interface GaitSpec {
  /** Metres covered per full cycle (two steps). Must match `locomotion.*Stride`. */
  stride: number;
  /** Ankle position relative to the pelvis at foot strike and at toe-off (m, forward +). */
  strikeZ: number;
  toeOffZ: number;
  /** Peak ankle height in swing, above the planted ankle (m). */
  swingLift: number;
  /** Pelvis height (m) and bob (m). `bobAtStance`: walks are highest over the planted foot. */
  hip: number;
  bob: number;
  bobAtStance: boolean;
  sway: number;
  /** Foot pitch (deg, + = toes down) at strike, toe-off and in swing. */
  strikePitch: number;
  toeOffPitch: number;
  swingPitch: number;
}

export const GAITS: Record<'WALK' | 'RUN' | 'SPRINT', GaitSpec> = {
  WALK: { stride: 1.6, strikeZ: 0.36, toeOffZ: -0.58, swingLift: 0.16, hip: 0.885, bob: 0.016, bobAtStance: true, sway: 0.022, strikePitch: -15, toeOffPitch: 38, swingPitch: 34 },
  RUN: { stride: 3.1, strikeZ: 0.3, toeOffZ: -0.58, swingLift: 0.42, hip: 0.862, bob: 0.028, bobAtStance: false, sway: 0.012, strikePitch: -7, toeOffPitch: 48, swingPitch: 62 },
  SPRINT: { stride: 3.96, strikeZ: 0.3, toeOffZ: -0.62, swingLift: 0.56, hip: 0.85, bob: 0.03, bobAtStance: false, sway: 0.008, strikePitch: 4, toeOffPitch: 52, swingPitch: 76 },
};

const SAMPLES = 48;
const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface FootPose {
  z: number;
  y: number;
  pitch: number;
  /** 0..1 how flat the toes stay on the ground while the heel lifts. */
  toeFlat: number;
}

/** One foot's path in the pelvis' ground frame at cycle phase `p` (0 = its own strike). */
export function footPath(g: GaitSpec, p: number, ankleY: number, k: number): FootPose {
  const travel = (g.strikeZ - g.toeOffZ) * k;
  const duty = travel / g.stride;
  const zF = g.strikeZ * k;
  const zB = g.toeOffZ * k;
  const heelLever = 0.13 * k;
  if (p < duty) {
    // Stance: straight back at ground speed. The heel peels up over the ball in the last part.
    const s = p / duty;
    const roll = smooth(0.52, 1, s);
    const settle = smooth(0, 0.16, s);
    const pitch = lerp(g.strikePitch * (1 - settle), g.toeOffPitch, roll);
    const heel = Math.max(0, Math.sin(pitch * DEG)) * heelLever;
    return { z: lerp(zF, zB, s), y: ankleY + heel, pitch, toeFlat: smooth(0, 0.2, s) };
  }
  // Swing: leaves at ground speed, folds up behind, drives through, retracts into the next strike.
  const s = (p - duty) / (1 - duty);
  const swingTime = (1 - duty) * g.stride;
  const m0 = -swingTime * 0.2;
  const m1 = -swingTime * 0.14;
  const s2 = s * s;
  const s3 = s2 * s;
  const z = (2 * s3 - 3 * s2 + 1) * zB + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * zF + (s3 - s2) * m1;
  const toeHeel = Math.max(0, Math.sin(g.toeOffPitch * DEG)) * heelLever;
  const base = lerp(ankleY + toeHeel, ankleY, smooth(0.25, 1, s));
  const y = base + g.swingLift * k * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 1.25);
  const toSwing = smooth(0, 0.3, s);
  const toStrike = smooth(0.4, 1, s);
  const pitch = lerp(lerp(g.toeOffPitch, g.swingPitch, toSwing), g.strikePitch, toStrike);
  return { z, y, pitch, toeFlat: 1 - smooth(0, 0.22, s) };
}

interface Applier {
  bone: THREE.Object3D;
  apply(t: number): void;
}

/** Evaluates a clip's tracks directly onto the bones (no mixer). */
function appliers(root: THREE.Object3D, clip: THREE.AnimationClip): Applier[] {
  const out: Applier[] = [];
  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const bone = root.getObjectByName(parsed.nodeName);
    if (!bone) continue;
    // (createInterpolant exists on every track at runtime; three's types only declare it per subclass)
    const interp = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
    const prop = parsed.propertyName;
    if (prop === 'quaternion') out.push({ bone, apply: (t) => void bone.quaternion.fromArray(interp.evaluate(t) as unknown as number[]) });
    else if (prop === 'position') out.push({ bone, apply: (t) => void bone.position.fromArray(interp.evaluate(t) as unknown as number[]) });
  }
  return out;
}

const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
const _wc = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _rot = new THREE.Quaternion();

/** A bone's long axis and its front, in the bone's own space, taken from the skeleton's rest pose. */
interface BoneFrame {
  aim: THREE.Vector3;
  front: THREE.Vector3;
}

function restFrame(bone: THREE.Object3D, child: THREE.Object3D): BoneFrame {
  const inv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  const aim = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const front = new THREE.Vector3(0, 0, 1).addScaledVector(aim, -aim.z).normalize();
  return { aim: aim.applyQuaternion(inv), front: front.applyQuaternion(inv) };
}

const _mW = new THREE.Matrix4();
const _mL = new THREE.Matrix4();

/**
 * Sets a bone's full orientation: its long axis along `aim` and its front toward `frontHint`.
 * Unlike a shortest-arc aim this leaves no free twist, so the shin (which carries the boot) can
 * never end up rotated about its own length relative to the knee or the foot.
 */
function orientBone(bone: THREE.Object3D, f: BoneFrame, aim: THREE.Vector3, frontHint: THREE.Vector3): void {
  _wa.copy(frontHint).addScaledVector(aim, -frontHint.dot(aim)).normalize();
  _wb.crossVectors(aim, _wa);
  _mW.makeBasis(aim, _wa, _wb);
  _wc.crossVectors(f.aim, f.front);
  _mL.makeBasis(f.aim, f.front, _wc).transpose();
  _mW.multiply(_mL);
  setWorldQuaternion(bone, _rot.setFromRotationMatrix(_mW));
}

const _sole = new THREE.Vector3();
const _qp = new THREE.Quaternion();

/**
 * Foot pitch (deg, + = toes down) limited to what an ankle can do against the shin it hangs from:
 * about 45 degrees of pointing and 20 of flexing either side of a right angle.
 */
function clampAnklePitch(pitch: number, shin: THREE.Vector3): number {
  let p = pitch;
  for (let i = 0; i < 90; i++) {
    _sole.set(0, 0, 1).applyQuaternion(_qp.setFromAxisAngle(X, p * DEG));
    const between = Math.acos(Math.min(1, Math.max(-1, _sole.dot(shin)))) / DEG;
    if (between < 45) p -= 1;
    else if (between > 110) p += 1;
    else break;
  }
  return p;
}

/**
 * Which way the knee points: forward and slightly out. When the leg is kicked up behind her the
 * hip-to-ankle line is nearly level and "forward" stops meaning anything, so the knee is also
 * biased downward there to keep it under that line instead of swinging out sideways.
 */
function kneePole(out: THREE.Vector3, side: number, dir: THREE.Vector3, spread: number): THREE.Vector3 {
  out.set(side * spread, -Math.max(0, -dir.z) * 0.6, 1);
  return out.addScaledVector(dir, -out.dot(dir)).normalize();
}

interface LegRig {
  legs: { thigh: BoneFrame; calf: BoneFrame; l1: number; l2: number; x: number }[];
  /** World orientation of a foot flat on the ground pointing straight ahead (both feet share axes). */
  footFlat: THREE.Quaternion;
  ballFlat: THREE.Quaternion | null;
  ballLocal: THREE.Quaternion | null;
  ankleY: number;
  /** Rig size relative to the 0.87 m thigh + shin the gait distances are authored for. */
  k: number;
}

/**
 * Everything the leg solvers need, measured once. Bone axes and lengths come from the skeleton's
 * rest pose, where both legs are straight and symmetric. The flat foot comes from the PLANTED foot
 * of a walking mid-stance and is used for both feet: taking each foot from that frame instead gives
 * the other leg its mid-swing, toes-down orientation.
 */
function legRig(root: THREE.Object3D, reference: THREE.AnimationClip, legs: LegBones[]): LegRig | null {
  let skinned: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) return null;
  (skinned as THREE.SkinnedMesh).skeleton.pose();
  root.updateMatrixWorld(true);
  const P = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const per = legs.map((l) => ({
    thigh: restFrame(l.thigh, l.calf),
    calf: restFrame(l.calf, l.foot),
    l1: P(l.thigh).distanceTo(P(l.calf)),
    l2: P(l.calf).distanceTo(P(l.foot)),
    x: P(l.foot).x,
  }));
  for (const a of appliers(root, reference)) a.apply((5 / 24) * reference.duration);
  root.updateMatrixWorld(true);
  const planted = P(legs[0].foot).y <= P(legs[1].foot).y ? legs[0] : legs[1];
  return {
    legs: per,
    footFlat: planted.foot.getWorldQuaternion(new THREE.Quaternion()),
    ballFlat: planted.ball?.getWorldQuaternion(new THREE.Quaternion()) ?? null,
    ballLocal: planted.ball?.quaternion.clone() ?? null,
    ankleY: P(planted.foot).y,
    k: (per[0].l1 + per[0].l2) / 0.87,
  };
}

function setWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

interface LegBones {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  ball: THREE.Object3D | undefined;
  side: 1 | -1;
}

/**
 * Returns a copy of `clip` with new leg and pelvis tracks. `reference` supplies the leg's neutral
 * pose (a walking mid-stance): solving from one fixed pose keeps thigh twist steady all cycle.
 * Bones are restored afterwards so the mixer records clean originals.
 */
export function synthesizeGait(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  reference: THREE.AnimationClip,
  spec: GaitSpec,
  bones: Record<string, string>,
): THREE.AnimationClip {
  const hips = root.getObjectByName(bones.hips);
  const legs: LegBones[] = [];
  for (const [side, th, ca, fo, ba] of [[1, bones.thighL, bones.calfL, bones.footL, 'ball_l'], [-1, bones.thighR, bones.calfR, bones.footR, 'ball_r']] as const) {
    const thigh = root.getObjectByName(th);
    const calf = root.getObjectByName(ca);
    const foot = root.getObjectByName(fo);
    if (thigh && calf && foot) legs.push({ thigh, calf, foot, ball: root.getObjectByName(ba), side });
  }
  if (!hips || !hips.parent || legs.length !== 2) return clip;

  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone()]));

  const rig = legRig(root, reference, legs);
  if (!rig) return clip;
  const ref = rig.legs;
  const k = rig.k;
  const groundedAnkle = rig.ankleY;
  const qyaw = new THREE.Quaternion();
  const YAX = new THREE.Vector3(0, 1, 0);

  const clipApply = appliers(root, clip);
  const times = new Float32Array(SAMPLES + 1);
  const hipPos = new Float32Array((SAMPLES + 1) * 3);
  const rot = legs.flatMap(() => [0, 1, 2, 3].map(() => new Float32Array((SAMPLES + 1) * 4)));
  const qx = new THREE.Quaternion();
  const hipTarget = new THREE.Vector3();
  const hipOrigin = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const ankle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const qTmp = new THREE.Quaternion();

  const duty = ((spec.strikeZ - spec.toeOffZ) * k) / spec.stride;
  for (let i = 0; i <= SAMPLES; i++) {
    const phase = (i % SAMPLES) / SAMPLES;
    const t = (phase * clip.duration) % clip.duration;
    times[i] = (i / SAMPLES) * clip.duration;
    for (const a of clipApply) a.apply(t);
    // Pelvis bob: twice a cycle. Running sits lowest mid-stance; walking rides highest there.
    const mid = duty / 2;
    const wave = Math.cos(4 * Math.PI * (phase - mid));
    const y = (spec.hip + (spec.bobAtStance ? wave : -wave) * spec.bob) * k;
    const swayX = Math.cos(2 * Math.PI * (phase - mid)) * spec.sway * k;
    hipTarget.set(swayX, y, 0);
    hips.parent.updateWorldMatrix(true, false);
    hips.parent.worldToLocal(hipTarget);
    hips.position.copy(hipTarget);
    hips.position.toArray(hipPos, i * 3);
    hips.updateMatrixWorld(true);

    legs.forEach((l, li) => {
      const r = ref[li];
      const lp = (phase + (l.side === 1 ? 0 : 0.5)) % 1;
      const f = footPath(spec, lp, groundedAnkle, k);
      ankle.set(r.x * 0.82, f.y, f.z);
      l.thigh.getWorldPosition(hipOrigin);
      dir.subVectors(ankle, hipOrigin);
      const reach = r.l1 + r.l2;
      const dist = Math.min(dir.length(), reach * 0.992);
      dir.normalize();
      // Knees point forward and very slightly out, whatever the clip's hips are doing.
      kneePole(pole, l.side, dir, 0.1);
      const a = (r.l1 * r.l1 - r.l2 * r.l2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, r.l1 * r.l1 - a * a));
      knee.copy(hipOrigin).addScaledVector(dir, a).addScaledVector(pole, h);
      ankle.copy(hipOrigin).addScaledVector(dir, dist);
      orientBone(l.thigh, r.thigh, dir.subVectors(knee, hipOrigin).normalize(), pole);
      l.calf.getWorldPosition(knee);
      orientBone(l.calf, r.calf, dir.subVectors(ankle, knee).normalize(), pole);
      // Toes a few degrees out, the same on both feet.
      qyaw.setFromAxisAngle(YAX, l.side * 5 * DEG);
      f.pitch = clampAnklePitch(f.pitch, dir);
      qx.setFromAxisAngle(X, f.pitch * DEG);
      setWorldQuaternion(l.foot, qTmp.copy(qyaw).multiply(qx).multiply(rig.footFlat));
      if (l.ball && rig.ballFlat) {
        qx.setFromAxisAngle(X, f.pitch * DEG * (1 - f.toeFlat * 0.8));
        setWorldQuaternion(l.ball, qTmp.copy(qyaw).multiply(qx).multiply(rig.ballFlat));
      }
      const parts = [l.thigh.quaternion, l.calf.quaternion, l.foot.quaternion, l.ball?.quaternion ?? null];
      parts.forEach((q, pi) => {
        if (q) q.toArray(rot[li * 4 + pi], i * 4);
      });
    });
  }

  const legTrackNames = new Set<string>();
  const tracks: THREE.KeyframeTrack[] = [];
  const addQuat = (bone: THREE.Object3D, data: Float32Array) => {
    // Keep neighbouring keys on the same hemisphere so slerp takes the short way round.
    for (let i = 4; i < data.length; i += 4) {
      const d = data[i] * data[i - 4] + data[i + 1] * data[i - 3] + data[i + 2] * data[i - 2] + data[i + 3] * data[i - 1];
      if (d < 0) for (let c = 0; c < 4; c++) data[i + c] = -data[i + c];
    }
    const name = `${bone.name}.quaternion`;
    legTrackNames.add(name);
    tracks.push(new THREE.QuaternionKeyframeTrack(name, times, data));
  };
  legs.forEach((l, li) => {
    addQuat(l.thigh, rot[li * 4]);
    addQuat(l.calf, rot[li * 4 + 1]);
    addQuat(l.foot, rot[li * 4 + 2]);
    if (l.ball) addQuat(l.ball, rot[li * 4 + 3]);
  });
  const hipName = `${hips.name}.position`;
  legTrackNames.add(hipName);
  tracks.push(new THREE.VectorKeyframeTrack(hipName, times, hipPos));
  for (const t of clip.tracks) if (!legTrackNames.has(t.name)) tracks.push(t);

  for (const [o, p, q] of saved) {
    o.position.copy(p);
    o.quaternion.copy(q);
  }
  root.updateMatrixWorld(true);
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Standing states whose legs are rebuilt (the library poses stand wide with one leg turned out). */
export const STANCE_STATES = ['IDLE', 'TALK', 'FOLD_ARMS', 'NOD', 'SHAKE_HEAD'] as const;

/**
 * Returns a copy of a standing clip with the legs re-posed: feet planted under the hips, toes a few
 * degrees out, knees forward. The clip's own pelvis motion (breathing, weight shift) is kept, and
 * because the feet are solved to fixed points they stay planted while the body moves over them.
 */
export function synthesizeStance(root: THREE.Object3D, clip: THREE.AnimationClip, reference: THREE.AnimationClip, bones: Record<string, string>): THREE.AnimationClip {
  const hips = root.getObjectByName(bones.hips);
  const legs: LegBones[] = [];
  for (const [side, th, ca, fo, ba] of [[1, bones.thighL, bones.calfL, bones.footL, 'ball_l'], [-1, bones.thighR, bones.calfR, bones.footR, 'ball_r']] as const) {
    const thigh = root.getObjectByName(th);
    const calf = root.getObjectByName(ca);
    const foot = root.getObjectByName(fo);
    if (thigh && calf && foot) legs.push({ thigh, calf, foot, ball: root.getObjectByName(ba), side });
  }
  if (!hips || !hips.parent || legs.length !== 2) return clip;
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone()]));

  const rig = legRig(root, reference, legs);
  if (!rig) return clip;
  const ref = rig.legs;
  const k = rig.k;
  const ankleY = rig.ankleY;

  const clipApply = appliers(root, clip);
  const n = Math.max(8, Math.min(96, Math.round(clip.duration * 12)));
  const times = new Float32Array(n + 1);
  const hipPos = new Float32Array((n + 1) * 3);
  const rot = legs.flatMap(() => [0, 1, 2, 3].map(() => new Float32Array((n + 1) * 4)));
  const Y = new THREE.Vector3(0, 1, 0);
  const qy = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const hipOrigin = new THREE.Vector3();
  const hipW = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const ankle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pole = new THREE.Vector3();
  // Average pelvis position over the clip: the feet go under it.
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    for (const a of clipApply) a.apply((i / n) * clip.duration);
    hips.updateWorldMatrix(true, false);
    hips.getWorldPosition(hipW);
    cx += hipW.x / n;
    cz += hipW.z / n;
  }
  // The library stance turns the hips to one side over staggered feet. With the feet now square,
  // the hips are squared too, and the spine takes the turn back so the upper body is unchanged.
  const spine = root.getObjectByName(bones.spine);
  const hipRot = new Float32Array((n + 1) * 4);
  const spineRot = new Float32Array((n + 1) * 4);
  const xAxis = new THREE.Vector3();
  const qFix = new THREE.Quaternion();
  let hipYaw = 0;
  for (let i = 0; i < n; i++) {
    for (const a of clipApply) a.apply((i / n) * clip.duration);
    hips.updateWorldMatrix(true, false);
    xAxis.set(1, 0, 0).applyQuaternion(hips.getWorldQuaternion(qFix));
    hipYaw += Math.atan2(-xAxis.z, xAxis.x) / n;
  }
  const squareHips = spine && spine.parent === hips;
  const maxReach = (ref[0].l1 + ref[0].l2) * 0.985;
  for (let i = 0; i <= n; i++) {
    times[i] = (i / n) * clip.duration;
    for (const a of clipApply) a.apply(i === n ? 0 : times[i]);
    hips.updateWorldMatrix(true, false);
    if (squareHips) {
      const spineWorld = spine!.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuaternion(hips, qFix.setFromAxisAngle(Y, -hipYaw).multiply(hips.getWorldQuaternion(new THREE.Quaternion())));
      setWorldQuaternion(spine!, spineWorld);
      hips.quaternion.toArray(hipRot, i * 4);
      spine!.quaternion.toArray(spineRot, i * 4);
    }
    hips.updateMatrixWorld(true);
    // Never ask for more leg than she has: lower the pelvis a touch if the clip stands too tall.
    let drop = 0;
    for (const l of legs) {
      l.thigh.getWorldPosition(hipOrigin);
      const dx = cx + l.side * 0.105 * k - hipOrigin.x;
      const dz = cz + l.side * 0.035 * k - hipOrigin.z;
      const maxDy = Math.sqrt(Math.max(0.01, maxReach * maxReach - dx * dx - dz * dz));
      drop = Math.max(drop, hipOrigin.y - ankleY - maxDy);
    }
    if (drop > 0) {
      hips.getWorldPosition(hipW);
      hipW.y -= drop;
      hips.parent.worldToLocal(hipW);
      hips.position.copy(hipW);
      hips.updateMatrixWorld(true);
    }
    hips.position.toArray(hipPos, i * 3);
    legs.forEach((l, li) => {
      const r = ref[li];
      // (left foot a little ahead of the right: nobody stands with their heels in a line)
      ankle.set(cx + l.side * 0.105 * k, ankleY, cz + l.side * 0.035 * k);
      l.thigh.getWorldPosition(hipOrigin);
      dir.subVectors(ankle, hipOrigin);
      const dist = Math.min(dir.length(), (r.l1 + r.l2) * 0.992);
      dir.normalize();
      kneePole(pole, l.side, dir, 0.14);
      const a = (r.l1 * r.l1 - r.l2 * r.l2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, r.l1 * r.l1 - a * a));
      knee.copy(hipOrigin).addScaledVector(dir, a).addScaledVector(pole, h);
      ankle.copy(hipOrigin).addScaledVector(dir, dist);
      orientBone(l.thigh, r.thigh, dir.subVectors(knee, hipOrigin).normalize(), pole);
      l.calf.getWorldPosition(knee);
      orientBone(l.calf, r.calf, dir.subVectors(ankle, knee).normalize(), pole);
      qy.setFromAxisAngle(Y, l.side * 9 * DEG);
      setWorldQuaternion(l.foot, qTmp.copy(qy).multiply(rig.footFlat));
      if (l.ball && rig.ballLocal) l.ball.quaternion.copy(rig.ballLocal);
      [l.thigh.quaternion, l.calf.quaternion, l.foot.quaternion, l.ball?.quaternion ?? null].forEach((q, pi) => {
        if (q) q.toArray(rot[li * 4 + pi], i * 4);
      });
    });
  }
  const replaced = new Set<string>();
  const tracks: THREE.KeyframeTrack[] = [];
  const addQuat = (bone: THREE.Object3D, data: Float32Array) => {
    for (let i = 4; i < data.length; i += 4) {
      const d = data[i] * data[i - 4] + data[i + 1] * data[i - 3] + data[i + 2] * data[i - 2] + data[i + 3] * data[i - 1];
      if (d < 0) for (let c = 0; c < 4; c++) data[i + c] = -data[i + c];
    }
    const name = `${bone.name}.quaternion`;
    replaced.add(name);
    tracks.push(new THREE.QuaternionKeyframeTrack(name, times, data));
  };
  legs.forEach((l, li) => {
    addQuat(l.thigh, rot[li * 4]);
    addQuat(l.calf, rot[li * 4 + 1]);
    addQuat(l.foot, rot[li * 4 + 2]);
    if (l.ball) addQuat(l.ball, rot[li * 4 + 3]);
  });
  if (squareHips) {
    addQuat(hips, hipRot);
    addQuat(spine!, spineRot);
  }
  const hipName = `${hips.name}.position`;
  replaced.add(hipName);
  tracks.push(new THREE.VectorKeyframeTrack(hipName, times, hipPos));
  for (const t of clip.tracks) if (!replaced.has(t.name)) tracks.push(t);
  for (const [o, p, q] of saved) {
    o.position.copy(p);
    o.quaternion.copy(q);
  }
  root.updateMatrixWorld(true);
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
