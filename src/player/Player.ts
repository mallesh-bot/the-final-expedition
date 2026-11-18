import * as THREE from 'three';
import { CharacterMotor } from '../physics/CharacterMotor';
import type { CollisionWorld } from '../physics/Colliders';
import type { InputManager } from '../input/InputManager';
import type { EventBus } from '../systems/EventBus';
import type { CharacterAvatar } from '../animation/CharacterAvatar';
import type { AnimState } from '../animation/AnimationDriver';
import type { Persistable } from '../state/Persistable';
import { HANG_DROP, HANG_OUT, TraversalSystem } from '../traversal/TraversalSystem';
import type { ClimbSurface, Ledge, NarrowLedge } from '../traversal/TraversalTypes';
import { angleDelta, clamp, damp, dampAngle, smoothstep } from '../systems/noise';

export type PlayerMode =
  | { kind: 'ground' }
  | { kind: 'climb'; surface: ClimbSurface; u: number; v: number }
  | { kind: 'hang'; ledge: Ledge; t: number; hold: number }
  | { kind: 'climbUp'; ledge: Ledge; from: THREE.Vector3; to: THREE.Vector3; edge: THREE.Vector3; k: number }
  | { kind: 'ledge'; narrow: NarrowLedge; t: number; slip?: number }
  | { kind: 'vault'; from: THREE.Vector3; to: THREE.Vector3; topY: number; k: number }
  | { kind: 'mount'; from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; k: number; dur: number; next: PlayerMode }
  | { kind: 'locked'; timer: number }
  | { kind: 'scripted' }
  | { kind: 'dead'; timer: number };

export type ModeKind = PlayerMode['kind'];

interface PlayerSave {
  pos: [number, number, number] | null;
  yaw: number;
}

export type ScriptRig =
  | { kind: 'climb'; normal: THREE.Vector3 }
  | { kind: 'hang'; normal: THREE.Vector3; ledgeY: number }
  | { kind: 'sidle'; normal: THREE.Vector3 }
  /** `wall` is a point on the face, `topY` the lip: she only leans out once she is over it. */
  | { kind: 'rappel'; normal: THREE.Vector3; wall: THREE.Vector3; topY: number };

export const SPEED = { walk: 1.75, run: 4.3, sprint: 6.6 };
const ACCEL = 18;
const DECEL = 22;
const AIR_ACCEL = 5;
const JUMP_V = 6.6;
const COYOTE = 0.14;
const JUMP_BUFFER = 0.14;
const HARD_LAND = 4.0;
const DEATH_FALL = 9.5;
const CLIMB_SPEED = 1.0;
const CLIMB_LATERAL = 0.8;
const SHIMMY_SPEED = 0.8;
const NARROW_SPEED = 0.9;
/** Seconds of pushing away from the wall before she loses the narrow ledge. */
const NARROW_SLIP = 0.28;
const CLIMB_UP_TIME = 1.55;
const VAULT_TIME = 0.66;
/** Seconds of committed forward roll after a hard landing at speed. */
const ROLL_TIME = 0.95;


/**
 * The player: kinematic motor + avatar + traversal state machine.
 * Reads only logical input actions; exposes state for camera/audio/UI.
 */
export class Player implements Persistable<PlayerSave> {
  readonly key = 'player';
  readonly version = 1;
  readonly motor: CharacterMotor;
  mode: PlayerMode = { kind: 'ground' };
  yaw = 0;
  /** Horizontal speed (m/s) for animation + camera. */
  speed = 0;
  sprinting = false;
  turnRate = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private airTime = 0;
  private assist = 0;
  private grabCooldown = 0;
  private lastLedge: Ledge | null = null;
  private lastPhase = 0;
  private hardLandLock = 0;
  private landing = false;
  readonly facing = new THREE.Vector3(0, 0, 1);
  private moveDir = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** Called when interact is pressed in ground mode. Returns true if consumed. */
  onInteract: (() => boolean) | null = null;
  /** Called when the player dies (fall) — chapter manager respawns. */
  onDeath: ((reason: string) => void) | null = null;
  /** Optional speed cap for calm story spaces. */
  speedCap = Infinity;
  /** Context prompt the HUD can show (e.g. "Climb"). */
  prompt: string | null = null;
  /** Scripted moments can hold a traversal pose (rappel, cinematic hang) on the IK rig. */
  scriptRig: ScriptRig | null = null;
  private rollT = 0;
  private leaping = false;
  private lastSpeed = 0;
  private accelLean = 0;
  private landCompress = 0;
  private caught = false;
  /** Below this height the player is lost (per level; deep gorges set it lower). */
  killY = -30;

  constructor(
    private readonly world: CollisionWorld,
    private traversal: TraversalSystem,
    private input: InputManager,
    private events: EventBus,
    readonly avatar: CharacterAvatar,
  ) {
    this.motor = new CharacterMotor(world);
    avatar.climb.onPlant = (isHand) => {
      if (this.mode.kind === 'ledge') {
        if (!isHand) this.events.emit('player:footstep', { surface: 'stone', intensity: 0.2 });
      } else if (isHand) this.events.emit('traversal:grab', { kind: 'climb-step' });
    };
  }

  get position(): THREE.Vector3 {
    return this.motor.position;
  }

  get grounded(): boolean {
    return this.motor.grounded;
  }

  get isTraversing(): boolean {
    const k = this.mode.kind;
    return k === 'climb' || k === 'hang' || k === 'climbUp' || k === 'ledge' || k === 'mount';
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.mode = { kind: 'ground' };
    this.motor.kinematic = false;
    this.motor.teleport(p);
    this.yaw = yaw;
    this.speed = 0;
    this.airTime = 0;
    this.rollT = 0;
    this.landing = false;
    this.scriptRig = null;
    this.syncAvatar();
    this.anim('IDLE', 0.01);
  }

  setScripted(on: boolean): void {
    if (on) {
      this.mode = { kind: 'scripted' };
      this.motor.kinematic = true;
      this.motor.velocity.set(0, 0, 0);
      this.speed = 0;
    } else if (this.mode.kind === 'scripted') {
      this.scriptRig = null;
      this.mode = { kind: 'ground' };
      this.motor.kinematic = false;
      this.motor.teleport(this.motor.position);
    }
  }

  /** Play a locked one-shot (interact/push) facing a target. */
  /** World position of her head (for other characters' look-ats). */
  head(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.avatar.bones.head;
    return h ? h.getWorldPosition(out) : out.copy(this.position).setY(this.position.y + 1.6);
  }

  playAction(state: AnimState, face: THREE.Vector3 | null, duration: number): void {
    if (this.mode.kind !== 'ground' || !this.motor.grounded) return;
    if (face) this.yaw = Math.atan2(face.x - this.position.x, face.z - this.position.z);
    this.motor.velocity.set(0, 0, 0);
    this.speed = 0;
    this.mode = { kind: 'locked', timer: duration };
    this.anim(state, 0.18, true);
  }

  private anim(s: AnimState, fade = 0.2, restart = false): void {
    this.avatar.driver.setState(s, { fade, restart });
  }

  // =================================================================== update
  update(dt: number, camYaw: number): void {
    if (dt <= 0) return;
    this.grabCooldown = Math.max(0, this.grabCooldown - dt);
    this.prompt = null;
    const prevYaw = this.yaw;
    let rate = 1;

    switch (this.mode.kind) {
      case 'ground':
        rate = this.updateGround(dt, camYaw);
        break;
      case 'climb':
        rate = this.updateClimb(dt, this.mode);
        break;
      case 'hang':
        rate = this.updateHang(dt, this.mode);
        break;
      case 'climbUp':
        this.updateClimbUp(dt, this.mode);
        break;
      case 'ledge':
        rate = this.updateNarrow(dt, this.mode, camYaw);
        break;
      case 'vault':
        this.updateVault(dt, this.mode);
        break;
      case 'mount':
        this.updateMount(dt, this.mode);
        break;
      case 'locked':
        this.mode.timer -= dt;
        this.speed = 0;
        if (this.mode.timer <= 0) {
          this.mode = { kind: 'ground' };
          this.anim('IDLE', 0.3);
        }
        break;
      case 'scripted':
        break;
      case 'dead':
        this.mode.timer -= dt;
        break;
    }

    // Kill plane
    if (this.position.y < this.killY && this.mode.kind !== 'dead') this.die('fell');

    this.turnRate = angleDelta(prevYaw, this.yaw) / dt;
    this.syncAvatar();
    // The climbing modes play a neutral base under the IK, at normal speed.
    const k = this.mode.kind;
    if (k === 'climb' || k === 'hang' || k === 'ledge' || k === 'mount') rate = 1;
    this.avatar.driver.update(dt, { speed: this.speed, rate });
    this.updateAttitude(dt);
    this.avatar.layers.update(dt, this.avatar.root, k === 'ground' || k === 'scripted');
    this.updateRig(dt);
    // Feet adapt to the terrain only while standing/moving on the ground (not mid-air, climbing,
    // hanging or vaulting, where the clip owns the legs). Fades so it never pops.
    this.landCompress = damp(this.landCompress, 0, 7, dt);
    const ik = this.avatar.footIK;
    ik.compress = this.landCompress;
    const ikOn = (this.mode.kind === 'ground' || this.mode.kind === 'locked') && this.motor.grounded && !this.landing;
    ik.weight = damp(ik.weight, ikOn ? 1 : 0, 10, dt);
    ik.update(dt, this.avatar.root, this.groundSampler);
    this.footsteps();
  }

  /** Body language: lean into acceleration and turns on the ground; attitude follows flight in the air. */
  private updateAttitude(dt: number): void {
    const L = this.avatar.layers;
    const groundMode = this.mode.kind === 'ground' || this.mode.kind === 'locked';
    L.airSpread = groundMode && !this.motor.grounded ? clamp((-this.motor.velocity.y - 3.5) / 5, 0, 1) : 0;
    if (!groundMode) {
      L.bodyPitch = 0;
      L.bodyRoll = 0;
      L.attitudeRate = 10;
      this.lastSpeed = this.speed;
      return;
    }
    const v = this.motor.velocity;
    if (this.motor.grounded) {
      const accel = clamp((this.speed - this.lastSpeed) / Math.max(dt, 1e-3), -24, 24);
      this.accelLean = damp(this.accelLean, accel * 0.009, 9, dt);
      L.bodyPitch = this.accelLean + (this.speed / SPEED.sprint) * 0.1;
      // Into the turn (+roll leans to her right, a positive turn rate turns to her left).
      L.bodyRoll = clamp(-this.turnRate * this.speed * 0.026, -0.2, 0.2);
      L.attitudeRate = 8;
    } else {
      // Flight: carry the run's forward lean, come upright at the apex, brace on the way down.
      // Air steering rolls the body gently into the sideways drift instead of spinning it.
      const fwd = v.x * this.facing.x + v.z * this.facing.z;
      const side = v.x * this.facing.z - v.z * this.facing.x; // + = drifting to her left
      L.bodyPitch = clamp(fwd * 0.045, -0.2, 0.3) + clamp(v.y * -0.018, -0.14, 0.14);
      L.bodyRoll = clamp(-side * 0.075, -0.3, 0.3);
      L.attitudeRate = 5.5;
    }
    this.lastSpeed = this.speed;
  }

  private updateRig(dt: number): void {
    const c = this.avatar.climb;
    const root = this.avatar.root;
    const m = this.mode;
    switch (m.kind) {
      case 'climb':
        c.climb(dt, root, m.surface.normal);
        break;
      case 'hang':
        c.hang(dt, root, m.ledge.normal, m.ledge.a.y);
        break;
      case 'mount':
        if (m.next.kind === 'climb') c.climb(dt, root, m.next.surface.normal, m.to);
        else if (m.next.kind === 'hang') c.hang(dt, root, m.next.ledge.normal, m.next.ledge.a.y, m.to, this.caught);
        break;
      case 'ledge':
        c.sidle(dt, root, m.narrow.normal);
        break;
      case 'climbUp':
        c.over(m.k, dt, root, m.ledge.normal, m.edge);
        break;
      case 'vault':
        c.vault(m.k, root, this.tmp.lerpVectors(m.from, m.to, 0.5).setY(m.topY), this.facing);
        break;
      case 'scripted': {
        const r = this.scriptRig;
        if (r?.kind === 'climb') c.climb(dt, root, r.normal);
        else if (r?.kind === 'hang') c.hang(dt, root, r.normal, r.ledgeY);
        else if (r?.kind === 'sidle') c.sidle(dt, root, r.normal);
        else if (r?.kind === 'rappel' && root.position.y < r.topY - 0.45) {
          const d = this.tmp.subVectors(root.position, r.wall).dot(r.normal);
          c.rappel(dt, root, r.normal, clamp(d, 0.45, 0.9));
        } else c.release(dt);
        break;
      }
      default:
        c.release(dt);
    }
  }

  private groundSampler = (x: number, z: number, maxY: number, normalOut: THREE.Vector3): number => {
    const g = this.world.groundAt(x, z, maxY);
    if (g.box || !this.world.heightfield) normalOut.set(0, 1, 0);
    else this.world.heightfield.normalAt(x, z, normalOut);
    return g.y;
  };

  private syncAvatar(): void {
    this.avatar.root.position.copy(this.motor.position);
    this.avatar.root.rotation.set(0, this.yaw, 0);
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private footsteps(): void {
    const ph = this.avatar.driver.gaitPhase;
    if (this.mode.kind === 'ground' && this.motor.grounded && this.speed > 0.6) {
      const crossed = (this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase;
      if (crossed) this.events.emit('player:footstep', { surface: this.motor.groundSurface, intensity: clamp(this.speed / SPEED.sprint, 0.25, 1) });
    }
    this.lastPhase = ph;
  }

  /** Hazard death (collapse, drowning, rockfall): same respawn flow as a lethal fall. */
  kill(reason: string): void {
    if (this.mode.kind === 'dead') return;
    this.die(reason);
  }

  get isDead(): boolean {
    return this.mode.kind === 'dead';
  }

  private die(reason: string): void {
    this.mode = { kind: 'dead', timer: 1.5 };
    this.motor.kinematic = true;
    this.motor.velocity.set(0, 0, 0);
    this.events.emit('player:died', { reason });
    this.onDeath?.(reason);
  }

  // =================================================================== ground
  private updateGround(dt: number, camYaw: number): number {
    const m = this.motor;
    const mv = this.input.move();
    const fwd = this.tmp.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    const right = this.tmp2.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
    this.moveDir.set(0, 0, 0).addScaledVector(fwd, mv.y).addScaledVector(right, mv.x);
    const inputMag = Math.min(1, this.moveDir.length());
    if (inputMag > 0.001) this.moveDir.normalize();

    // Committed roll after a hard landing at speed: momentum carries her, no steering.
    if (this.rollT > 0) {
      this.rollT -= dt;
      const sp = Math.max(2.4, this.speed * (1 - dt * 0.9));
      m.velocity.x = this.facing.x * sp;
      m.velocity.z = this.facing.z * sp;
      const evr = m.update(dt);
      this.speed = Math.hypot(m.velocity.x, m.velocity.z);
      if (this.rollT <= 0) {
        this.landing = false;
        this.locomotionAnim();
      }
      if (evr.landed) this.onLanded(evr.landed.fallHeight, evr.landed.surface);
      return 1;
    }
    this.sprinting = this.input.held('sprint') && inputMag > 0.5 && m.grounded;
    let target = inputMag * (this.sprinting ? SPEED.sprint : SPEED.run);
    target = Math.min(target, this.speedCap);
    if (this.hardLandLock > 0) {
      this.hardLandLock -= dt;
      target *= 0.15;
    }

    // Facing
    if (m.grounded) {
      if (inputMag > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), this.speed < 1 ? 13 : 10, dt);
    } else {
      // In the air the body follows where she is actually flying; steering shows as a lean
      // (see updateAttitude), never as the whole character spinning to the stick.
      const hv = Math.hypot(m.velocity.x, m.velocity.z);
      if (hv > 1.2) this.yaw = dampAngle(this.yaw, Math.atan2(m.velocity.x, m.velocity.z), 4.5, dt);
      else if (inputMag > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), 3, dt);
    }

    // Velocity (accelerate toward desired, in the movement direction but mostly along facing
    // so turns carve rather than strafe).
    const vx = m.velocity.x;
    const vz = m.velocity.z;
    const facingBlend = m.grounded ? 0.55 : 0;
    const dirX = inputMag > 0.05 ? this.moveDir.x * (1 - facingBlend) + Math.sin(this.yaw) * facingBlend : 0;
    const dirZ = inputMag > 0.05 ? this.moveDir.z * (1 - facingBlend) + Math.cos(this.yaw) * facingBlend : 0;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const tx = (dirX / dl) * target;
    const tz = (dirZ / dl) * target;
    if (this.assist > 0) {
      this.assist -= dt;
    } else {
      const a = m.grounded ? (target > Math.hypot(vx, vz) ? ACCEL : DECEL) : AIR_ACCEL;
      const dvx = tx - vx;
      const dvz = tz - vz;
      const dv = Math.hypot(dvx, dvz);
      const step = a * dt;
      if (dv <= step) {
        m.velocity.x = tx;
        m.velocity.z = tz;
      } else {
        m.velocity.x += (dvx / dv) * step;
        m.velocity.z += (dvz / dv) * step;
      }
    }

    // Jump (coyote + buffer)
    if (this.input.pressed('jump')) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = m.grounded ? COYOTE : Math.max(0, this.coyote - dt);

    // Contextual vault takes priority over jump when running at an obstacle.
    if (m.grounded && inputMag > 0.5 && (this.jumpBuffer > 0 || this.speed > SPEED.run * 0.8)) {
      const v = this.traversal.findVault(this.position, this.facing);
      if (v) {
        this.jumpBuffer = 0;
        this.startVault(v.from, v.to, v.topY);
        return 1;
      }
    }

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      const link = this.traversal.findJumpLink(this.position, inputMag > 0.1 ? this.moveDir : this.facing);
      if (link) {
        // Assisted gap jump: solve a ballistic arc to the authored landing.
        const dx = link.to.x - this.position.x;
        const dz = link.to.z - this.position.z;
        const dy = link.to.y - this.position.y;
        const T = clamp(Math.hypot(dx, dz) / 5.4, 0.5, 0.85);
        m.velocity.set(dx / T, (dy + 0.5 * m.gravity * T * T) / T, dz / T);
        m.grounded = false;
        this.yaw = Math.atan2(dx, dz);
        this.assist = T * 0.9;
      } else {
        m.jump(JUMP_V);
      }
      // A running take-off drives off one leg; a standing jump gathers and springs.
      this.leaping = this.speed > SPEED.walk + 0.5;
      // (the clip's wind-up is skipped: the impulse has already left the ground)
      if (this.leaping) this.anim('LEAP', 0.13, true);
      else this.avatar.driver.setState('JUMP', { fade: 0.08, restart: true, startAt: 0.3 });
      this.airTime = 0;
    }

    // Interact / climb mount
    const climbable = m.grounded ? this.traversal.findClimb(this.position, this.facing, false) : null;
    if (climbable) this.prompt = 'Climb';
    if (this.input.pressed('interact')) {
      if (!(this.onInteract?.() ?? false) && climbable) {
        this.mountClimb(climbable.surface, climbable.u, climbable.v);
        return 1;
      }
    }

    const ev = m.update(dt);
    this.speed = Math.hypot(m.velocity.x, m.velocity.z);

    if (!m.grounded) {
      this.airTime += dt;
      // Ledge grab while airborne.
      if (this.grabCooldown <= 0) {
        const g = this.traversal.findLedgeGrab(this.position, m.velocity.y, this.facing, this.lastLedge);
        if (g) {
          this.mountHang(g.ledge, g.t);
          return 1;
        }
        const c = this.traversal.findClimb(this.position, this.facing, true);
        if (c && this.airTime > 0.15 && inputMag > 0.3) {
          this.mountClimb(c.surface, c.u, c.v);
          return 1;
        }
      }
      if (m.velocity.y < (this.leaping ? -6.5 : -2.5) && this.airTime > 0.32) this.anim('FALL', 0.3);
    } else {
      this.leaping = false;
      this.lastLedge = null;
      this.airTime = 0;
      // Narrow ledge auto-enter
      const n = this.traversal.findNarrow(this.position);
      if (n) {
        this.mode = { kind: 'ledge', narrow: n.narrow, t: n.t };
        this.anim('LEDGE_IDLE', 0.3);
        return 0;
      }
    }

    if (ev.landed) this.onLanded(ev.landed.fallHeight, ev.landed.surface);
    else if (m.grounded) {
      if (this.landing && this.speed > 1.5 && this.hardLandLock <= 0) this.landing = false;
      if (!this.landing) this.locomotionAnim();
    }
    return 1;
  }

  private locomotionAnim(): void {
    const s = this.speed;
    const st: AnimState = s < 0.15 ? 'IDLE' : s < SPEED.walk + 0.4 ? 'WALK' : s < SPEED.run + 0.5 ? 'RUN' : 'SPRINT';
    this.anim(st, 0.2);
  }

  private onLanded(h: number, surface: string): void {
    this.events.emit('player:landed', { fallHeight: h, surface });
    if (h > DEATH_FALL) {
      this.die('fall');
      return;
    }
    const endLanding = () => {
      this.landing = false;
    };
    // Knees always absorb the impact, in proportion to the drop.
    if (h > 0.25) this.landCompress = Math.max(this.landCompress, clamp(0.03 + h * 0.08, 0, 0.28));
    if (h > HARD_LAND && this.speed > 2.5) {
      // At speed a hard landing turns into a roll, keeping momentum.
      this.rollT = ROLL_TIME;
      this.landing = true;
      // (entering past the clip's opening dive: she is already low from the impact)
      this.avatar.driver.setState('ROLL', { fade: 0.12, restart: true, startAt: 0.35 });
    } else if (h > HARD_LAND) {
      this.hardLandLock = 0.5;
      this.motor.velocity.x *= 0.2;
      this.motor.velocity.z *= 0.2;
      this.landing = true;
      this.avatar.driver.setState('LAND_HARD', { fade: 0.06, restart: true, onDone: endLanding });
    } else if (h > 0.6 && this.speed < 2.5) {
      this.landing = true;
      this.avatar.driver.setState('LAND', { fade: 0.08, restart: true, onDone: endLanding });
    } else {
      this.locomotionAnim();
    }
  }

  // =================================================================== mounts
  private mountClimb(s: ClimbSurface, u: number, v: number): void {
    const to = this.traversal.climbPoint(s, clamp(u, 0.3, s.width - 0.3), clamp(v, 0.05, s.height - HANG_DROP), new THREE.Vector3());
    const toYaw = Math.atan2(-s.normal.x, -s.normal.z);
    this.startMount(to, toYaw, 0.28, { kind: 'climb', surface: s, u: clamp(u, 0.3, s.width - 0.3), v: clamp(v, 0.05, s.height - HANG_DROP) });
    this.anim('CLIMB', 0.25);
    this.events.emit('traversal:grab', { kind: 'climb' });
  }

  private mountHang(l: Ledge, t: number): void {
    this.caught = !this.motor.grounded && this.mode.kind === 'ground';
    const to = this.traversal.hangPosition(l, t, new THREE.Vector3());
    const toYaw = Math.atan2(-l.normal.x, -l.normal.z);
    this.startMount(to, toYaw, 0.18, { kind: 'hang', ledge: l, t, hold: 0 });
    this.anim('HANG', 0.15);
    this.events.emit('traversal:grab', { kind: 'ledge' });
  }

  private startMount(to: THREE.Vector3, toYaw: number, dur: number, next: PlayerMode): void {
    this.motor.kinematic = true;
    this.motor.velocity.set(0, 0, 0);
    this.speed = 0;
    this.mode = { kind: 'mount', from: this.position.clone(), to, fromYaw: this.yaw, toYaw, k: 0, dur, next };
  }

  private updateMount(dt: number, m: Extract<PlayerMode, { kind: 'mount' }>): void {
    m.k = Math.min(1, m.k + dt / m.dur);
    const e = smoothstep(0, 1, m.k);
    this.position.lerpVectors(m.from, m.to, e);
    this.yaw = m.fromYaw + angleDelta(m.fromYaw, m.toYaw) * e;
    if (m.k >= 1) this.mode = m.next;
  }

  // =================================================================== climb
  private updateClimb(dt: number, c: Extract<PlayerMode, { kind: 'climb' }>): number {
    const s = c.surface;
    const mv = this.input.move();
    const maxV = s.height - HANG_DROP;
    const pull = this.avatar.climb.pull;
    c.u = clamp(c.u + mv.x * CLIMB_LATERAL * pull * dt, 0.3, s.width - 0.3);
    c.v = c.v + mv.y * CLIMB_SPEED * pull * dt;
    this.prompt = null;
    // Top: transition onto the linked ledge.
    if (c.v >= maxV) {
      c.v = maxV;
      const l = s.topLedge ? this.traversal.ledge(s.topLedge) : undefined;
      if (l && mv.y > 0.2) {
        const p = this.traversal.climbPoint(s, c.u, c.v, this.tmp);
        const dir = this.traversal.ledgeDir(l, this.tmp2);
        const t = clamp(new THREE.Vector3().subVectors(p, l.a).dot(dir), 0.3, this.traversal.ledgeLength(l) - 0.3);
        this.mountHang(l, t);
        return 1;
      }
    }
    // Bottom: step off.
    if (c.v <= 0 && mv.y < -0.2) {
      this.dismountToGround();
      return 1;
    }
    c.v = Math.max(0, c.v);
    if (this.input.pressed('drop') || this.input.pressed('jump')) {
      // Let go (jump pushes away from the wall).
      this.motor.kinematic = false;
      this.motor.velocity.copy(s.normal).multiplyScalar(this.input.pressed('jump') ? 2.5 : 0.6);
      this.motor.velocity.y = this.input.pressed('jump') ? 3 : 0;
      this.motor.beginFall();
      this.mode = { kind: 'ground' };
      this.grabCooldown = 0.4;
      this.anim('FALL', 0.2);
      return 1;
    }
    this.traversal.climbPoint(s, c.u, c.v, this.position);
    this.yaw = Math.atan2(-s.normal.x, -s.normal.z);
    this.anim('CLIMB', 0.2);
    return 1;
  }

  private dismountToGround(): void {
    this.motor.kinematic = false;
    const s = this.mode.kind === 'climb' ? this.mode.surface : null;
    if (s) this.position.addScaledVector(s.normal, 0.15);
    this.motor.teleport(this.position);
    this.mode = { kind: 'ground' };
    this.grabCooldown = 0.3;
    this.anim('IDLE', 0.25);
  }

  // =================================================================== hang
  private updateHang(dt: number, h: Extract<PlayerMode, { kind: 'hang' }>): number {
    const l = h.ledge;
    const mv = this.input.move();
    const len = this.traversal.ledgeLength(l);
    // Shimmy along the ledge. Ledge a→b direction vs player's right decides sign.
    const dir = this.traversal.ledgeDir(l, this.tmp2);
    const right = this.tmp.set(l.normal.z, 0, -l.normal.x); // player's right when facing the wall
    const sign = dir.dot(right) >= 0 ? 1 : -1;
    const dt_ = mv.x * sign * SHIMMY_SPEED * dt;
    h.t = clamp(h.t + dt_, 0.3, len - 0.3);
    const canUp = this.traversal.canClimbUp(l, h.t);
    this.prompt = canUp ? 'Climb up' : null;
    this.traversal.hangPosition(l, h.t, this.position);
    this.yaw = Math.atan2(-l.normal.x, -l.normal.z);

    if ((mv.y > 0.3 || this.input.pressed('jump')) && canUp) {
      h.hold += dt;
      if (h.hold > 0.12 || this.input.pressed('jump')) {
        this.startClimbUp(l, h.t);
        return 1;
      }
    } else h.hold = 0;

    if (mv.y < -0.3 || this.input.pressed('drop')) {
      const below = l.wallBelow ? this.traversal.climb(l.wallBelow) : undefined;
      const loc = below ? this.traversal.climbLocal(below, this.position) : null;
      if (below && loc && loc.u > 0.3 && loc.u < below.width - 0.3 && !this.input.pressed('drop')) {
        this.mode = { kind: 'climb', surface: below, u: clamp(loc.u, 0.3, below.width - 0.3), v: below.height - HANG_DROP - 0.05 };
        this.anim('CLIMB', 0.25);
        return 0;
      }
      if (this.input.pressed('drop') || mv.y < -0.8) {
        this.motor.kinematic = false;
        this.position.addScaledVector(l.normal, 0.1);
        this.motor.velocity.set(0, 0, 0);
        this.motor.beginFall();
        this.mode = { kind: 'ground' };
        this.lastLedge = l;
        this.grabCooldown = 0.45;
        this.anim('FALL', 0.2);
        return 1;
      }
    }
    if (Math.abs(mv.x) > 0.1) {
      this.anim('SHIMMY', 0.18);
      // shimmy clip moves toward character's left (+X local) => negative player-right.
      return -Math.sign(mv.x);
    }
    this.anim('HANG', 0.25);
    return 1;
  }

  private startClimbUp(l: Ledge, t: number): void {
    const edge = this.traversal.ledgePoint(l, t, new THREE.Vector3());
    const to = edge.clone().addScaledVector(l.normal, -0.55);
    const g = this.motor;
    // Land on actual ground height at target.
    to.y = Math.max(edge.y, (g as CharacterMotor).position.y);
    this.mode = { kind: 'climbUp', ledge: l, from: this.position.clone(), to, edge, k: 0 };
    this.anim('CLIMB_UP', 0.1, true);
    this.events.emit('traversal:grab', { kind: 'climb-up' });
  }

  private updateClimbUp(dt: number, c: Extract<PlayerMode, { kind: 'climbUp' }>): void {
    c.k = Math.min(1, c.k + dt / CLIMB_UP_TIME);
    const k = c.k;
    const n = c.ledge.normal;
    // Path: pull up (vertical) -> knee onto ledge -> stand inward.
    const p = this.position;
    const hangOut = HANG_OUT;
    if (k < 0.45) {
      const e = smoothstep(0, 0.45, k);
      p.copy(c.from);
      p.y = c.from.y + e * (HANG_DROP - 0.75);
      p.addScaledVector(n, -e * (hangOut - 0.12));
    } else if (k < 0.8) {
      const e = smoothstep(0.45, 0.8, k);
      p.copy(c.edge).addScaledVector(n, 0.12 - e * 0.45);
      p.y = c.edge.y - 0.75 + e * 0.7;
    } else {
      const e = smoothstep(0.8, 1, k);
      p.copy(c.edge).addScaledVector(n, -0.33 - e * 0.22);
      p.y = c.edge.y - 0.05 + e * 0.05;
    }
    this.yaw = Math.atan2(-n.x, -n.z);
    if (c.k >= 1) {
      this.motor.kinematic = false;
      this.motor.teleport(c.to.setY(c.edge.y));
      this.mode = { kind: 'ground' };
      this.anim('IDLE', 0.25);
    }
  }

  // =================================================================== narrow ledge
  private updateNarrow(dt: number, n: Extract<PlayerMode, { kind: 'ledge' }>, camYaw: number): number {
    const nl = n.narrow;
    const len = nl.a.distanceTo(nl.b);
    const dir = this.tmp2.subVectors(nl.b, nl.a).normalize();
    const mv = this.input.move();
    // Camera-relative input projected onto the ledge direction.
    const along = (Math.sin(camYaw) * mv.y - Math.cos(camYaw) * mv.x) * dir.x + (Math.cos(camYaw) * mv.y + Math.sin(camYaw) * mv.x) * dir.z;
    const v = Math.abs(along) > 0.2 ? Math.sign(along) * NARROW_SPEED * Math.min(1, Math.abs(along) * 1.3) : 0;
    n.t += v * dt;
    this.speed = 0;
    // Pushing away from the wall (or jumping, or dropping) takes her off the ledge.
    const away = (Math.sin(camYaw) * mv.y - Math.cos(camYaw) * mv.x) * nl.normal.x + (Math.cos(camYaw) * mv.y + Math.sin(camYaw) * mv.x) * nl.normal.z;
    // (Only a clear push counts: walking along the ledge with the camera at an angle must stay safe.)
    n.slip = away > 0.6 && away > Math.abs(along) ? (n.slip ?? 0) + dt : 0;
    if (n.slip > NARROW_SLIP || this.input.pressed('jump') || this.input.pressed('drop')) {
      const m = this.motor;
      m.velocity.set(nl.normal.x * 2.6, 1.6, nl.normal.z * 2.6);
      m.beginFall();
      this.mode = { kind: 'ground' };
      this.grabCooldown = 0.5;
      this.leaping = false;
      this.airTime = 0;
      this.anim('FALL', 0.2);
      return 1;
    }
    if (n.t < 0.05 || n.t > len - 0.05) {
      // Step off the end back into normal movement.
      const p = this.traversal.narrowPoint(nl, clamp(n.t, 0, len), new THREE.Vector3());
      p.addScaledVector(dir, Math.sign(v || 1) * 0.35);
      this.position.copy(p);
      this.motor.teleport(this.position);
      this.mode = { kind: 'ground' };
      this.anim('WALK', 0.25);
      return 1;
    }
    this.traversal.narrowPoint(nl, n.t, this.position);
    // Face the wall (wall is opposite the normal).
    this.yaw = dampAngle(this.yaw, Math.atan2(-nl.normal.x, -nl.normal.z), 10, dt);
    const playerRight = this.tmp.set(nl.normal.z, 0, -nl.normal.x);
    if (Math.abs(v) > 0.01) {
      this.anim('LEDGE', 0.25);
      // ledge_step clip moves toward character's left (= -playerRight).
      return -Math.sign(dir.dot(playerRight) * v);
    }
    this.anim('LEDGE_IDLE', 0.3);
    return 1;
  }

  // =================================================================== vault
  private startVault(from: THREE.Vector3, to: THREE.Vector3, topY: number): void {
    this.motor.kinematic = true;
    const g = this.motor;
    to.y = g.position.y;
    this.yaw = Math.atan2(to.x - from.x, to.z - from.z);
    this.mode = { kind: 'vault', from: from.clone(), to, topY, k: 0 };
    this.anim('VAULT', 0.08, true);
    this.events.emit('traversal:grab', { kind: 'vault' });
  }

  private updateVault(dt: number, v: Extract<PlayerMode, { kind: 'vault' }>): void {
    v.k = Math.min(1, v.k + dt / VAULT_TIME);
    const e = smoothstep(0, 1, v.k);
    this.position.lerpVectors(v.from, v.to, e);
    const arc = Math.sin(v.k * Math.PI);
    this.position.y = v.from.y + (v.topY + 0.12 - v.from.y) * arc;
    this.speed = SPEED.run * 0.8;
    if (v.k >= 1) {
      this.motor.kinematic = false;
      this.motor.teleport(v.to);
      const f = this.facing;
      this.motor.velocity.set(f.x * SPEED.run * 0.8, 0, f.z * SPEED.run * 0.8);
      this.mode = { kind: 'ground' };
      this.locomotionAnim();
    }
  }

  // =================================================================== persistence
  serialize(): PlayerSave {
    const safe = this.mode.kind === 'ground' && this.motor.grounded;
    const p = this.position;
    return { pos: safe ? [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] : null, yaw: +this.yaw.toFixed(4) };
  }

  /** Restores exact position only when saved in a safe state; otherwise the checkpoint spawn is used. */
  restore(data: PlayerSave | undefined): void {
    this.pendingRestore = data?.pos ? { pos: new THREE.Vector3(...data.pos), yaw: data.yaw } : null;
  }
  pendingRestore: { pos: THREE.Vector3; yaw: number } | null = null;

  /** Camera framing hint derived from mode. */
  get cameraContext(): 'explore' | 'climb' | 'hang' | 'narrow' | 'locked' {
    switch (this.mode.kind) {
      case 'climb':
      case 'mount':
        return 'climb';
      case 'hang':
      case 'climbUp':
        return 'hang';
      case 'ledge':
        return 'narrow';
      case 'locked':
        return 'locked';
      default:
        return 'explore';
    }
  }

  get narrowNormal(): THREE.Vector3 | null {
    return this.mode.kind === 'ledge' ? this.mode.narrow.normal : null;
  }

  /** Debug/test helper: human-readable state. */
  debugState(): Record<string, unknown> {
    return {
      mode: this.mode.kind,
      anim: this.avatar.driver.state,
      pos: this.position.toArray().map((v) => +v.toFixed(2)),
      speed: +this.speed.toFixed(2),
      grounded: this.motor.grounded,
      sprinting: this.sprinting,
    };
  }
}
