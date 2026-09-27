import * as THREE from 'three';
import type { ClimbSurface, JumpLink, Ledge, NarrowLedge, TraversalSet, VaultBlock } from './TraversalTypes';

/** Player hang geometry (meters). Tuned to the character rig's overhead reach. */
export const HANG_DROP = 2.02;
export const HANG_OUT = 0.3;
export const CLIMB_OUT = 0.36;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Spatial queries over authored traversal data. Movement itself lives in the Player. */
export class TraversalSystem {
  private set: TraversalSet = { climbs: [], ledges: [], narrows: [], vaults: [], jumps: [] };
  private byId = new Map<string, ClimbSurface | Ledge>();

  load(set: TraversalSet): void {
    this.set = set;
    this.byId.clear();
    for (const c of set.climbs) this.byId.set(c.id, c);
    for (const l of set.ledges) this.byId.set(l.id, l);
  }

  clear(): void {
    this.load({ climbs: [], ledges: [], narrows: [], vaults: [], jumps: [] });
  }

  get data(): TraversalSet {
    return this.set;
  }

  ledge(id: string): Ledge | undefined {
    const l = this.byId.get(id);
    return l && 'a' in l ? (l as Ledge) : undefined;
  }
  climb(id: string): ClimbSurface | undefined {
    const c = this.byId.get(id);
    return c && 'origin' in c ? (c as ClimbSurface) : undefined;
  }

  /** Local (u, v, dist) of a world point relative to a climb surface. */
  climbLocal(s: ClimbSurface, p: THREE.Vector3): { u: number; v: number; dist: number } {
    tmp.subVectors(p, s.origin);
    return { u: tmp.dot(s.right), v: p.y - s.origin.y, dist: tmp.x * s.normal.x + tmp.z * s.normal.z };
  }

  climbPoint(s: ClimbSurface, u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(s.origin).addScaledVector(s.right, u).setY(s.origin.y + v).addScaledVector(s.normal, CLIMB_OUT);
  }

  /** A climb surface the player can mount from where they stand / fly. */
  findClimb(p: THREE.Vector3, facing: THREE.Vector3, airborne: boolean): { surface: ClimbSurface; u: number; v: number } | null {
    let best: { surface: ClimbSurface; u: number; v: number } | null = null;
    let bestD = Infinity;
    for (const s of this.set.climbs) {
      const { u, v, dist } = this.climbLocal(s, p);
      if (u < 0.25 || u > s.width - 0.25) continue;
      const maxDist = airborne ? 0.75 : 1.2;
      if (dist < -0.1 || dist > maxDist) continue;
      if (v < -0.6 || v > s.height - HANG_DROP + 0.1) continue;
      const face = -(facing.x * s.normal.x + facing.z * s.normal.z);
      if (face < (airborne ? 0.45 : 0.25)) continue;
      if (dist < bestD) {
        bestD = dist;
        best = { surface: s, u, v: Math.max(0.05, v) };
      }
    }
    return best;
  }

  ledgePoint(l: Ledge, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const len = l.a.distanceTo(l.b);
    return out.lerpVectors(l.a, l.b, len > 0 ? t / len : 0);
  }

  ledgeLength(l: Ledge): number {
    return l.a.distanceTo(l.b);
  }

  ledgeDir(l: Ledge, out = new THREE.Vector3()): THREE.Vector3 {
    return out.subVectors(l.b, l.a).normalize();
  }

  /** Feet position while hanging at t. */
  hangPosition(l: Ledge, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.ledgePoint(l, t, out);
    out.addScaledVector(l.normal, HANG_OUT);
    out.y -= HANG_DROP;
    return out;
  }

  canClimbUp(l: Ledge, t: number): boolean {
    return l.climbUp.some(([a, b]) => t >= a && t <= b);
  }

  /** Airborne ledge grab. */
  findLedgeGrab(p: THREE.Vector3, velY: number, facing: THREE.Vector3, exclude: Ledge | null): { ledge: Ledge; t: number } | null {
    if (velY > 3.0) return null;
    let best: { ledge: Ledge; t: number } | null = null;
    let bestD = Infinity;
    for (const l of this.set.ledges) {
      if (l === exclude) continue;
      const len = this.ledgeLength(l);
      const dir = this.ledgeDir(l, tmp2);
      tmp.subVectors(p, l.a);
      const t = THREE.MathUtils.clamp(tmp.dot(dir), 0.25, len - 0.25);
      const hp = this.hangPosition(l, t, tmp);
      const dy = p.y - hp.y;
      if (dy < -0.55 || dy > 0.45) continue;
      const dxz = Math.hypot(p.x - hp.x, p.z - hp.z);
      if (dxz > 0.6) continue;
      const face = -(facing.x * l.normal.x + facing.z * l.normal.z);
      if (face < 0.2) continue;
      const d = dxz + Math.abs(dy);
      if (d < bestD) {
        bestD = d;
        best = { ledge: l, t };
      }
    }
    return best;
  }

  /** Narrow ledge under the player's feet. */
  findNarrow(p: THREE.Vector3): { narrow: NarrowLedge; t: number } | null {
    for (const n of this.set.narrows) {
      const len = n.a.distanceTo(n.b);
      const dir = tmp2.subVectors(n.b, n.a).normalize();
      tmp.subVectors(p, n.a);
      const t = tmp.dot(dir);
      if (t < 0.15 || t > len - 0.15) continue;
      const lateral = Math.abs(tmp.x * n.normal.x + tmp.z * n.normal.z);
      if (lateral > 0.45) continue;
      if (Math.abs(p.y - n.a.y) > 0.35) continue;
      return { narrow: n, t };
    }
    return null;
  }

  narrowPoint(n: NarrowLedge, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const len = n.a.distanceTo(n.b);
    return out.lerpVectors(n.a, n.b, t / len);
  }

  /** Vault over a low obstacle the player is running into. */
  findVault(p: THREE.Vector3, moveDir: THREE.Vector3): { block: VaultBlock; from: THREE.Vector3; to: THREE.Vector3; topY: number } | null {
    for (const v of this.set.vaults) {
      const c = Math.cos(v.yaw);
      const s = Math.sin(v.yaw);
      const dx = p.x - v.center.x;
      const dz = p.z - v.center.z;
      const lx = c * dx - s * dz;
      const lz = s * dx + c * dz;
      if (Math.abs(lx) > v.half.x - 0.15) continue;
      const approach = Math.abs(lz) - v.half.z;
      if (approach < 0 || approach > 0.95) continue;
      const side = Math.sign(lz);
      // local -z*side is the crossing direction
      const crossW = new THREE.Vector3(c * 0 + s * (-side), 0, -s * 0 + c * (-side));
      if (moveDir.dot(crossW) < 0.6) continue;
      const topY = v.center.y + v.half.y;
      const toL = -side * (v.half.z + 0.55);
      const to = new THREE.Vector3(v.center.x + (c * lx + s * toL), 0, v.center.z + (-s * lx + c * toL));
      return { block: v, from: p.clone(), to, topY };
    }
    return null;
  }

  findJumpLink(p: THREE.Vector3, dir: THREE.Vector3): JumpLink | null {
    for (const j of this.set.jumps) {
      if (Math.hypot(p.x - j.from.x, p.z - j.from.z) > j.fromRadius) continue;
      if (Math.abs(p.y - j.from.y) > 0.7) continue;
      tmp.subVectors(j.to, j.from).setY(0).normalize();
      if (dir.lengthSq() > 0.01 && tmp.dot(dir) < 0.55) continue;
      return j;
    }
    return null;
  }
}
