import * as THREE from 'three';
import type { Heightfield } from './Heightfield';

export type Surface = 'dirt' | 'grass' | 'stone' | 'wood' | 'water' | 'metal' | 'mud' | 'leaves';

export interface BoxCollider {
  id: number;
  center: THREE.Vector3;
  half: THREE.Vector3;
  yaw: number;
  cos: number;
  sin: number;
  surface: Surface;
  /** Camera spring-arm collides with this box. */
  blocksCamera: boolean;
  enabled: boolean;
  tag?: string;
  /** Round proxy (vertical cylinder, radius = half.x) — trunks, boulders. */
  round?: boolean;
}

export interface GroundHit {
  y: number;
  surface: Surface;
  box: BoxCollider | null;
}

const CELL = 8;
const key = (i: number, j: number) => i * 73856093 ^ j * 19349663;

/**
 * Static collision world: heightfield + yaw-rotated boxes, with a uniform spatial hash.
 * Dynamic boxes (doors, moving blocks) live in a small list checked every query.
 */
export class CollisionWorld {
  heightfield: Heightfield | null = null;
  terrainSurface: (x: number, z: number) => Surface = () => 'dirt';
  private boxes = new Map<number, BoxCollider>();
  private grid = new Map<number, BoxCollider[]>();
  private dynamic: BoxCollider[] = [];
  private nextId = 1;
  private scratch: BoxCollider[] = [];
  private stamp = new Map<number, number>();
  private queryId = 0;
  /** Invisible world bounds (min/max XZ). */
  bounds = { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 };

  clear(): void {
    this.boxes.clear();
    this.grid.clear();
    this.dynamic = [];
    this.heightfield = null;
  }

  addBox(
    center: THREE.Vector3,
    half: THREE.Vector3,
    yaw = 0,
    opts: { surface?: Surface; blocksCamera?: boolean; dynamic?: boolean; tag?: string } = {},
  ): BoxCollider {
    const b: BoxCollider = {
      id: this.nextId++,
      center: center.clone(),
      half: half.clone(),
      yaw,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      surface: opts.surface ?? 'stone',
      blocksCamera: opts.blocksCamera ?? true,
      enabled: true,
      tag: opts.tag,
    };
    this.boxes.set(b.id, b);
    if (opts.dynamic) this.dynamic.push(b);
    else this.insert(b);
    return b;
  }

  /** Vertical cylinder proxy (trees, boulders): smooth sliding around round obstacles. */
  addCylinder(center: THREE.Vector3, radius: number, halfHeight: number, opts: { surface?: Surface; blocksCamera?: boolean; tag?: string } = {}): BoxCollider {
    const b = this.addBox(center, new THREE.Vector3(radius, halfHeight, radius), 0, opts);
    b.round = true;
    return b;
  }

  /** Axis-aligned-in-local-space box matching a mesh's world transform (yaw only). */
  addBoxFromObject(obj: THREE.Object3D, size: THREE.Vector3, opts: Parameters<CollisionWorld['addBox']>[3] = {}): BoxCollider {
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    obj.matrixWorld.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return this.addBox(p, new THREE.Vector3(size.x * s.x * 0.5, size.y * s.y * 0.5, size.z * s.z * 0.5), e.y, opts);
  }

  setBoxYaw(b: BoxCollider, yaw: number): void {
    b.yaw = yaw;
    b.cos = Math.cos(yaw);
    b.sin = Math.sin(yaw);
  }

  private insert(b: BoxCollider): void {
    const r = Math.hypot(b.half.x, b.half.z);
    const i0 = Math.floor((b.center.x - r) / CELL);
    const i1 = Math.floor((b.center.x + r) / CELL);
    const j0 = Math.floor((b.center.z - r) / CELL);
    const j1 = Math.floor((b.center.z + r) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
  }

  /** Boxes whose cells overlap the XZ rectangle. Result array is reused — copy if kept. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): BoxCollider[] {
    const out = this.scratch;
    out.length = 0;
    const qid = ++this.queryId;
    const i0 = Math.floor(minX / CELL);
    const i1 = Math.floor(maxX / CELL);
    const j0 = Math.floor(minZ / CELL);
    const j1 = Math.floor(maxZ / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const list = this.grid.get(key(i, j));
        if (!list) continue;
        for (const b of list) {
          if (!b.enabled || this.stamp.get(b.id) === qid) continue;
          this.stamp.set(b.id, qid);
          out.push(b);
        }
      }
    for (const b of this.dynamic) if (b.enabled) out.push(b);
    return out;
  }

  terrainHeight(x: number, z: number): number {
    return this.heightfield ? this.heightfield.heightAt(x, z) : 0;
  }

  /** Highest walkable surface under (x,z) not above maxY. */
  groundAt(x: number, z: number, maxY: number, footRadius = 0.12): GroundHit {
    let y = this.terrainHeight(x, z);
    let surface: Surface = this.terrainSurface(x, z);
    let box: BoxCollider | null = null;
    for (const b of this.query(x - 1, z - 1, x + 1, z + 1)) {
      const top = b.center.y + b.half.y;
      if (top > maxY || top <= y) continue;
      const dx = x - b.center.x;
      const dz = z - b.center.z;
      const lx = b.cos * dx - b.sin * dz;
      const lz = b.sin * dx + b.cos * dz;
      const inside = b.round ? Math.hypot(dx, dz) <= b.half.x + footRadius : Math.abs(lx) <= b.half.x + footRadius && Math.abs(lz) <= b.half.z + footRadius;
      if (inside) {
        y = top;
        surface = b.surface;
        box = b;
      }
    }
    return { y, surface, box };
  }

  /**
   * Push a vertical cylinder out of boxes. Returns true if any contact occurred.
   * `out` receives the accumulated contact normal (XZ).
   */
  resolveCylinder(pos: THREE.Vector3, radius: number, feetY: number, headY: number, out?: THREE.Vector3): boolean {
    let hit = false;
    out?.set(0, 0, 0);
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const b of this.query(pos.x - radius - 1, pos.z - radius - 1, pos.x + radius + 1, pos.z + radius + 1)) {
        const bMin = b.center.y - b.half.y;
        const bMax = b.center.y + b.half.y;
        if (bMax <= feetY || bMin >= headY) continue;
        const dx = pos.x - b.center.x;
        const dz = pos.z - b.center.z;
        if (b.round) {
          const d = Math.hypot(dx, dz);
          const min = b.half.x + radius;
          if (d >= min) continue;
          const nx = d > 1e-5 ? dx / d : 1;
          const nz = d > 1e-5 ? dz / d : 0;
          pos.x = b.center.x + nx * min;
          pos.z = b.center.z + nz * min;
          if (out) {
            out.x += nx;
            out.z += nz;
          }
          any = hit = true;
          continue;
        }
        const lx = b.cos * dx - b.sin * dz;
        const lz = b.sin * dx + b.cos * dz;
        const cx = Math.max(-b.half.x, Math.min(b.half.x, lx));
        const cz = Math.max(-b.half.z, Math.min(b.half.z, lz));
        let px = lx - cx;
        let pz = lz - cz;
        const d2 = px * px + pz * pz;
        if (d2 >= radius * radius) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) {
          // Center inside box: push along the axis of least penetration.
          const penX = b.half.x - Math.abs(lx);
          const penZ = b.half.z - Math.abs(lz);
          if (penX < penZ) {
            px = Math.sign(lx) || 1;
            pz = 0;
            d = -penX;
          } else {
            px = 0;
            pz = Math.sign(lz) || 1;
            d = -penZ;
          }
        } else {
          px /= d;
          pz /= d;
        }
        const push = radius - d;
        const wx = b.cos * px + b.sin * pz;
        const wz = -b.sin * px + b.cos * pz;
        pos.x += wx * push;
        pos.z += wz * push;
        if (out) {
          out.x += wx;
          out.z += wz;
        }
        any = hit = true;
      }
      if (!any) break;
    }
    // World bounds
    const bd = this.bounds;
    if (pos.x < bd.minX + radius) (pos.x = bd.minX + radius), (hit = true);
    if (pos.x > bd.maxX - radius) (pos.x = bd.maxX - radius), (hit = true);
    if (pos.z < bd.minZ + radius) (pos.z = bd.minZ + radius), (hit = true);
    if (pos.z > bd.maxZ - radius) (pos.z = bd.maxZ - radius), (hit = true);
    return hit;
  }

  /** Ray vs boxes (+ terrain). Returns hit distance or null. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, cameraOnly = true, terrain = true): number | null {
    let best = maxDist;
    let found = false;
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    for (const b of this.query(Math.min(origin.x, ex) - 1, Math.min(origin.z, ez) - 1, Math.max(origin.x, ex) + 1, Math.max(origin.z, ez) + 1)) {
      if (cameraOnly && !b.blocksCamera) continue;
      const t = rayBox(origin, dir, b);
      if (t !== null && t < best) {
        best = t;
        found = true;
      }
    }
    if (terrain && this.heightfield) {
      const step = 0.4;
      let prevT = 0;
      for (let t = step; t <= best; t += step) {
        const x = origin.x + dir.x * t;
        const y = origin.y + dir.y * t;
        const z = origin.z + dir.z * t;
        if (y < this.terrainHeight(x, z)) {
          // Refine
          let a = prevT;
          let c = t;
          for (let k = 0; k < 6; k++) {
            const m = (a + c) / 2;
            const my = origin.y + dir.y * m;
            if (my < this.terrainHeight(origin.x + dir.x * m, origin.z + dir.z * m)) c = m;
            else a = m;
          }
          if (a < best) {
            best = a;
            found = true;
          }
          break;
        }
        prevT = t;
      }
    }
    return found ? best : null;
  }
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: BoxCollider): number | null {
  const dx = o.x - b.center.x;
  const dz = o.z - b.center.z;
  const lox = b.cos * dx - b.sin * dz;
  const loz = b.sin * dx + b.cos * dz;
  const loy = o.y - b.center.y;
  const ldx = b.cos * d.x - b.sin * d.z;
  const ldz = b.sin * d.x + b.cos * d.z;
  const ldy = d.y;
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: [number, number, number][] = [
    [lox, ldx, b.half.x],
    [loy, ldy, b.half.y],
    [loz, ldz, b.half.z],
  ];
  for (const [oo, dd, h] of axes) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < -h || oo > h) return null;
    } else {
      let t1 = (-h - oo) / dd;
      let t2 = (h - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : null; // origin inside box: ignore (camera pivot inside geometry)
}
