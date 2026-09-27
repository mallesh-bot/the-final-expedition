import * as THREE from 'three';
import type { CollisionWorld, Surface } from './Colliders';

export interface MotorEvents {
  landed?: { fallHeight: number; impactSpeed: number; surface: Surface };
  leftGround?: boolean;
  blocked?: boolean;
}

/**
 * Kinematic capsule (approximated as a vertical cylinder) with gravity, step-up,
 * ground snapping, box collision and terrain slope limits.
 */
export class CharacterMotor {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  radius = 0.32;
  height = 1.72;
  stepHeight = 0.42;
  gravity = 25;
  maxFallSpeed = 42;
  /** cos of steepest walkable terrain slope (~50°). */
  maxSlopeCos = Math.cos(THREE.MathUtils.degToRad(50));
  grounded = false;
  groundSurface: Surface = 'dirt';
  groundY = 0;
  /** Highest Y reached since last grounded, for fall damage. */
  private peakY = 0;
  private contactNormal = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  /** Disable gravity/collision while traversal systems drive the position directly. */
  kinematic = false;

  constructor(private readonly world: CollisionWorld) {}

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    const g = this.world.groundAt(p.x, p.z, p.y + 0.5);
    this.groundY = g.y;
    this.grounded = Math.abs(p.y - g.y) < 0.3;
    if (this.grounded) this.position.y = g.y;
    this.peakY = this.position.y;
  }

  jump(speed: number): void {
    this.velocity.y = speed;
    this.grounded = false;
  }

  /** Mark as airborne starting from current height (e.g. after letting go of a ledge). */
  beginFall(): void {
    this.grounded = false;
    this.peakY = this.position.y;
  }

  update(dt: number): MotorEvents {
    const ev: MotorEvents = {};
    if (this.kinematic || dt <= 0) return ev;
    const wasGrounded = this.grounded;

    // Gravity
    if (!this.grounded) {
      this.velocity.y = Math.max(this.velocity.y - this.gravity * dt, -this.maxFallSpeed);
    } else if (this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    // Horizontal movement in sub-steps to avoid tunnelling.
    const hx = this.velocity.x * dt;
    const hz = this.velocity.z * dt;
    const dist = Math.hypot(hx, hz);
    const steps = Math.max(1, Math.ceil(dist / 0.15));
    for (let s = 0; s < steps; s++) {
      const ox = this.position.x;
      const oz = this.position.z;
      this.position.x += hx / steps;
      this.position.z += hz / steps;
      if (this.terrainBlocks(this.position.x, this.position.z)) {
        // Try sliding along each axis.
        this.position.x = ox + hx / steps;
        this.position.z = oz;
        if (this.terrainBlocks(this.position.x, this.position.z)) {
          this.position.x = ox;
          this.position.z = oz + hz / steps;
          if (this.terrainBlocks(this.position.x, this.position.z)) {
            this.position.z = oz;
          }
        }
        ev.blocked = true;
      }
      const feet = this.position.y + this.stepHeight;
      if (this.world.resolveCylinder(this.position, this.radius, feet, this.position.y + this.height, this.contactNormal)) {
        ev.blocked = true;
        // Remove velocity into the contact.
        const n = this.contactNormal;
        const l = Math.hypot(n.x, n.z);
        if (l > 1e-4) {
          const nx = n.x / l;
          const nz = n.z / l;
          const vn = this.velocity.x * nx + this.velocity.z * nz;
          if (vn < 0) {
            this.velocity.x -= vn * nx;
            this.velocity.z -= vn * nz;
          }
        }
      }
    }

    // Vertical movement
    this.position.y += this.velocity.y * dt;
    const probeTop = this.position.y + this.stepHeight;
    const g = this.world.groundAt(this.position.x, this.position.z, probeTop, this.radius * 0.45);
    this.groundY = g.y;

    if (this.velocity.y <= 0) {
      const gap = this.position.y - g.y;
      const snap = wasGrounded ? this.stepHeight + 0.05 : 0.0;
      if (gap <= snap || gap < 0) {
        this.position.y = g.y;
        if (!wasGrounded) {
          ev.landed = {
            fallHeight: Math.max(0, this.peakY - g.y),
            impactSpeed: -this.velocity.y,
            surface: g.surface,
          };
        }
        this.grounded = true;
        this.groundSurface = g.surface;
        this.velocity.y = 0;
      } else {
        this.grounded = false;
      }
    } else {
      this.grounded = false;
      // Head bump
      const ceil = this.world.query(this.position.x - 0.5, this.position.z - 0.5, this.position.x + 0.5, this.position.z + 0.5);
      for (const b of ceil) {
        const bottom = b.center.y - b.half.y;
        const headY = this.position.y + this.height;
        if (headY > bottom && this.position.y + this.height * 0.5 < bottom) {
          const dx = this.position.x - b.center.x;
          const dz = this.position.z - b.center.z;
          const lx = b.cos * dx - b.sin * dz;
          const lz = b.sin * dx + b.cos * dz;
          if (Math.abs(lx) < b.half.x && Math.abs(lz) < b.half.z) {
            this.position.y = bottom - this.height;
            this.velocity.y = 0;
          }
        }
      }
    }

    if (this.grounded) this.peakY = this.position.y;
    else this.peakY = Math.max(this.peakY, this.position.y);
    if (wasGrounded && !this.grounded) ev.leftGround = true;
    return ev;
  }

  /** Terrain acts as a wall where it's both steep and higher than a step. */
  private terrainBlocks(x: number, z: number): boolean {
    const hf = this.world.heightfield;
    if (!hf) return false;
    const h = hf.heightAt(x, z);
    if (h <= this.position.y + this.stepHeight) return false;
    const n = hf.normalAt(x, z, this.tmpN);
    return n.y < this.maxSlopeCos || h > this.position.y + this.stepHeight * 2.5;
  }

  get feet(): THREE.Vector3 {
    return this.tmp.copy(this.position);
  }
}
