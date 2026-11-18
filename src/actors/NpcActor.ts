import * as THREE from 'three';
import type { CharacterAvatar, CharacterId } from '../animation/CharacterAvatar';
import type { AnimState } from '../animation/AnimationDriver';
import type { CollisionWorld } from '../physics/Colliders';
import { damp, dampAngle } from '../systems/noise';

/**
 * A story character driven by the chapter: place, walk/run along authored paths, follow the
 * player at a distance, face someone, play a pose (talk, sit, look around). Ground height comes
 * from the collision world, so NPCs stand on terrain, slabs and bridges alike. NPCs never block
 * or push the player; chapters add a small collider where it matters (e.g. a seated NPC).
 */
export class NpcActor {
  readonly position = new THREE.Vector3();
  yaw = 0;
  private path: THREE.Vector3[] = [];
  private speed = 0;
  private targetSpeed = 0;
  private moveSpeed = 1.6;
  private onArrive: (() => void) | null = null;
  private faceTarget: THREE.Vector3 | null = null;
  private pose: AnimState = 'IDLE';
  private followTarget: (() => THREE.Vector3) | null = null;
  private followDist = 3;
  /** Hide beyond this camera distance (LOW preset budget: characters are many draw calls). */
  static cullDistance = Infinity;
  static camera: THREE.Vector3 | null = null;
  /** Scratch point the owner can write `headTarget` into. */
  readonly lookPoint = new THREE.Vector3();
  /** Where the head looks (independent of body facing). */
  headTarget: THREE.Vector3 | null = null;
  /** Set while this character's line is being spoken: small head movement, talk gesture. */
  speaking = false;
  /** Optional per-frame IK pose (e.g. hanging on a rope). */
  rig: ((dt: number) => void) | null = null;
  /** How this character stands when nothing else is asked of them (Corwin folds his arms). */
  idleStyle: AnimState = 'IDLE';
  private talking = false;
  /** When false the NPC keeps its authored height (sitting, hanging on ropes, cinematics). */
  groundSnap = true;
  visible = true;

  constructor(
    readonly avatar: CharacterAvatar,
    private world: CollisionWorld,
    parent: THREE.Object3D,
  ) {
    parent.add(avatar.root);
  }

  get id(): CharacterId {
    return this.avatar.id;
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  place(p: THREE.Vector3, yaw: number, pose: AnimState = 'IDLE'): this {
    this.position.copy(p);
    if (this.groundSnap) this.position.y = this.ground(p.x, p.z, p.y + 1.2);
    this.yaw = yaw;
    this.path = [];
    this.followTarget = null;
    this.route = null;
    this.speed = this.targetSpeed = 0;
    this.faceTarget = null;
    this.setPose(pose, 0.01);
    this.sync();
    return this;
  }

  setPose(state: AnimState, fade = 0.35): void {
    this.pose = state;
    if (!this.moving) this.avatar.driver.setState(this.restState(), { fade });
  }

  /** The state to hold while not walking: the pose, its talking version while speaking. */
  private restState(): AnimState {
    if (this.talking && !this.rig) {
      if (this.pose === 'SIT') return 'SIT_TALK';
      if (this.pose === 'IDLE') return 'TALK';
    }
    return this.pose === 'IDLE' ? this.idleStyle : this.pose;
  }

  /** The dialogue system marks whoever is speaking: they gesture and move their head. */
  setSpeaking(on: boolean): void {
    this.speaking = on;
    if (on === this.talking) return;
    this.talking = on;
    if (!this.moving) this.avatar.driver.setState(this.restState(), { fade: 0.45 });
  }

  /** Walk (or run) through `points`; `onArrive` fires at the last one. */
  walkTo(points: THREE.Vector3[], opts: { speed?: number; onArrive?: () => void } = {}): void {
    this.path = points.map((p) => p.clone());
    this.moveSpeed = opts.speed ?? 1.6;
    this.onArrive = opts.onArrive ?? null;
    this.followTarget = null;
    this.faceTarget = null;
    this.avatar.driver.setState(this.moveSpeed > 2.5 ? 'RUN' : 'WALK', { fade: 0.25 });
  }

  /** Keep within `dist` metres of a moving target (companion). */
  follow(target: (() => THREE.Vector3) | null, dist = 3): void {
    this.followTarget = target;
    this.followDist = dist;
    if (!target) this.path = [];
  }

  /**
   * Companion following along an authored route (corridors, doors): stays `lag` metres behind the
   * target's progress along the route, never cutting through walls. Pass null to stop.
   */
  followRoute(route: THREE.Vector3[] | null, target: (() => THREE.Vector3) | null = null, lag = 2.8): void {
    this.route = route && target ? { pts: route, target, lag, timer: 0 } : null;
    this.followTarget = null;
    if (!route) this.path = [];
  }

  private route: { pts: THREE.Vector3[]; target: () => THREE.Vector3; lag: number; timer: number } | null = null;

  private routeS(p: THREE.Vector3): number {
    const pts = this.route!.pts;
    let best = Infinity;
    let bestS = 0;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len * len || 1)));
      const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) + Math.abs(p.y - (a.y + (b.y - a.y) * t)) * 0.5;
      if (d < best) {
        best = d;
        bestS = acc + len * t;
      }
      acc += len;
    }
    return bestS;
  }

  private routePoint(s: number): THREE.Vector3 {
    const pts = this.route!.pts;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      if (s <= acc + len) return pts[i].clone().lerp(pts[i + 1], (s - acc) / (len || 1));
      acc += len;
    }
    return pts[pts.length - 1].clone();
  }

  private updateRoute(dt: number): void {
    const r = this.route;
    if (!r) return;
    r.timer -= dt;
    if (r.timer > 0) return;
    r.timer = 0.4;
    const goalS = Math.max(0, this.routeS(r.target()) - r.lag);
    const myS = this.routeS(this.position);
    if (Math.abs(goalS - myS) < 0.8) {
      if (this.path.length) this.stop();
      return;
    }
    // Waypoints: every route vertex between me and the goal, then the goal.
    const pts = r.pts;
    const way: THREE.Vector3[] = [];
    let acc = 0;
    const verts: number[] = [0];
    for (let i = 0; i < pts.length - 1; i++) {
      acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      verts.push(acc);
    }
    if (goalS > myS) verts.forEach((s, i) => s > myS + 0.3 && s < goalS && way.push(pts[i].clone()));
    else
      [...verts]
        .map((s, i) => [s, i] as const)
        .reverse()
        .forEach(([s, i]) => s < myS - 0.3 && s > goalS && way.push(pts[i].clone()));
    way.push(this.routePoint(goalS));
    const far = Math.abs(goalS - myS) > 7;
    const keepPose = this.pose;
    this.walkTo(way, { speed: far ? 4.0 : 1.7 });
    this.pose = keepPose;
  }

  lookAt(p: THREE.Vector3 | null): void {
    this.faceTarget = p ? p.clone() : null;
  }

  stop(): void {
    this.path = [];
    this.followTarget = null;
    this.onArrive = null;
    this.targetSpeed = 0;
    this.avatar.driver.setState(this.restState(), { fade: 0.3 });
  }

  update(dt: number): void {
    this.updateRoute(dt);
    if (this.followTarget) {
      const t = this.followTarget();
      const d = Math.hypot(t.x - this.position.x, t.z - this.position.z);
      if (d > this.followDist + 0.6) {
        const k = (d - this.followDist) / d;
        const goal = new THREE.Vector3(this.position.x + (t.x - this.position.x) * k, t.y, this.position.z + (t.z - this.position.z) * k);
        this.path = [goal];
        this.moveSpeed = d > this.followDist + 5 ? 4.2 : 1.7;
        if (this.avatar.driver.state !== 'WALK' && this.avatar.driver.state !== 'RUN') this.avatar.driver.setState('WALK', { fade: 0.25 });
      } else if (this.path.length && d < this.followDist + 0.1) {
        this.path = [];
        this.avatar.driver.setState(this.restState(), { fade: 0.3 });
      }
    }
    if (this.path.length) {
      const goal = this.path[0];
      const dx = goal.x - this.position.x;
      const dz = goal.z - this.position.z;
      const d = Math.hypot(dx, dz);
      this.targetSpeed = this.moveSpeed;
      if (d < Math.max(0.15, this.speed * dt * 1.5)) {
        this.path.shift();
        if (!this.path.length) {
          this.targetSpeed = 0;
          this.speed = 0;
          if (!this.groundSnap) this.position.y = goal.y;
          this.avatar.driver.setState(this.restState(), { fade: 0.3 });
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.();
        }
      } else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
        const step = Math.min(d, this.speed * dt);
        this.position.x += (dx / d) * step;
        this.position.z += (dz / d) * step;
        if (!this.groundSnap) this.position.y += ((goal.y - this.position.y) * step) / Math.max(d, 1e-3);
      }
    } else this.targetSpeed = 0;
    this.speed = damp(this.speed, this.targetSpeed, 6, dt);
    if (!this.path.length && this.faceTarget) this.yaw = dampAngle(this.yaw, Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z), 5, dt);
    if (this.groundSnap) {
      const gy = this.ground(this.position.x, this.position.z, this.position.y + 0.6);
      this.position.y = damp(this.position.y, gy, 18, dt);
    }
    this.sync();
    this.avatar.driver.update(dt, { speed: this.path.length ? this.speed : 0, rate: 1 });
    // Natural lean into walking, and a head that actually follows who she or he is talking to.
    this.avatar.layers.bodyPitch = (this.path.length ? this.speed : 0) * 0.012;
    if (this.headTarget) {
      this.avatar.layers.lookTarget = this.headTarget;
      this.avatar.layers.lookWeight = damp(this.avatar.layers.lookWeight, 0.8, 4, dt);
    } else this.avatar.layers.lookWeight = damp(this.avatar.layers.lookWeight, 0, 4, dt);
    this.avatar.layers.speech = this.speaking ? 1 : 0;
    this.avatar.layers.update(dt, this.avatar.root, true);
    this.rig?.(dt);
  }

  private ground(x: number, z: number, maxY: number): number {
    return this.world.groundAt(x, z, maxY).y;
  }

  private sync(): void {
    this.avatar.root.position.copy(this.position);
    this.avatar.root.rotation.set(0, this.yaw, 0);
    const cam = NpcActor.camera;
    this.avatar.root.visible = this.visible && (!cam || cam.distanceTo(this.position) < NpcActor.cullDistance);
  }

  /** World position of the head (for look-ats and cinematic framing). */
  head(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.avatar.bones.head;
    if (h) return h.getWorldPosition(out);
    return out.copy(this.position).setY(this.position.y + 1.6);
  }

  dispose(): void {
    this.avatar.dispose();
  }
}
