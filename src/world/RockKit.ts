import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm2, mulberry32 } from '../systems/noise';

/**
 * Procedural rock geometry: noise-displaced, with baked cavity/height AO in vertex colors so
 * shapes read as weathered stone under the triplanar material rather than as primitives.
 */
export function displacedRock(seed: number, detail = 3, roughness = 0.35, flatten = 0.75): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const ox = rnd() * 100;
  const oz = rnd() * 100;
  const v = new THREE.Vector3();
  const disp = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n1 = fbm2(v.x * 1.4 + ox, v.y * 1.4 + v.z * 0.7 + oz, 4);
    const n2 = fbm2(v.x * 4 + oz, v.z * 4 + v.y * 2 + ox, 3);
    // Chunky facets: quantize a bit for strata
    const strata = Math.round((v.y + n1 * 0.3) * 5) / 5;
    let r = 1 + n1 * roughness + n2 * roughness * 0.3 + (strata - v.y) * 0.08;
    disp[i] = n1;
    v.multiplyScalar(r);
    v.y *= v.y < 0 ? flatten * 0.8 : flatten;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const ao = THREE.MathUtils.clamp(0.72 + disp[i] * 0.6 + y * 0.12, 0.45, 1.1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  g.computeBoundingSphere();
  return g;
}

/** Subdivided box with displaced faces (cliff slabs, masonry) — keeps a flat-ish footprint. */
export function displacedSlab(seed: number, w: number, h: number, d: number, amp: number, segs = 10, bevel = 0.18): THREE.BufferGeometry {
  const sx = Math.max(2, Math.round(segs * (w / Math.max(w, h, d))));
  const sy = Math.max(2, Math.round(segs * (h / Math.max(w, h, d))));
  const sz = Math.max(2, Math.round(segs * (d / Math.max(w, h, d))));
  const base = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const o = rnd() * 100;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Round the corners (bevel) by pulling toward an inner box.
    const ix = THREE.MathUtils.clamp(v.x, -w / 2 + bevel, w / 2 - bevel);
    const iy = THREE.MathUtils.clamp(v.y, -h / 2 + bevel, h / 2 - bevel);
    const iz = THREE.MathUtils.clamp(v.z, -d / 2 + bevel, d / 2 - bevel);
    n.set(v.x - ix, v.y - iy, v.z - iz);
    const len = n.length();
    if (len > 1e-5) {
      n.divideScalar(len);
      v.set(ix, iy, iz).addScaledVector(n, bevel);
    }
    const nz = fbm2((v.x + v.z) * 0.45 + o, v.y * 0.45 + o * 0.5, 4);
    const fine = fbm2(v.x * 2.2 + o, (v.y + v.z) * 2.2, 2);
    const a = nz * amp + fine * amp * 0.25;
    v.addScaledVector(n, a);
    p.setXYZ(i, v.x, v.y, v.z);
    const ao = THREE.MathUtils.clamp(0.8 + nz * 0.55 + (v.y / h) * 0.1, 0.45, 1.1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  g.computeBoundingSphere();
  return g;
}

interface Placement {
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

/** Collects placements per geometry variant, then builds one InstancedMesh per variant. */
export class InstanceBatch {
  private lists = new Map<THREE.BufferGeometry, Placement[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, pos: THREE.Vector3, scale: THREE.Vector3 | number, rot: THREE.Euler | number = 0, tint = 1, hue?: THREE.Color): void {
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
    if (typeof rot === 'number') this.e.set(0, rot, 0);
    else this.e.copy(rot);
    this.q.setFromEuler(this.e);
    this.m.compose(pos, this.q, s);
    let list = this.lists.get(geo);
    if (!list) this.lists.set(geo, (list = []));
    const c = hue ? hue.clone().multiplyScalar(tint) : new THREE.Color(tint, tint, tint);
    list.push({ matrix: this.m.clone(), color: c });
  }

  build(material: THREE.Material, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const [geo, list] of this.lists) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((p, i) => {
        im.setMatrixAt(i, p.matrix);
        im.setColorAt(i, p.color);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = opts.castShadow ?? true;
      im.receiveShadow = opts.receiveShadow ?? true;
      im.computeBoundingSphere();
      im.name = opts.name ?? 'instances';
      out.push(im);
    }
    return out;
  }

  get count(): number {
    let n = 0;
    for (const l of this.lists.values()) n += l.length;
    return n;
  }
}
