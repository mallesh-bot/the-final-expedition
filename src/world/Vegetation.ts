import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm2, mulberry32 } from '../systems/noise';

/** UV rects in the foliage atlas (see ProceduralTextures.foliageAtlas). [u0, v0, u1, v1] */
export const ATLAS = {
  fern: [0.02, 0.51, 0.48, 0.97] as const,
  broadleaf: [0.54, 0.52, 0.96, 0.955] as const,
  grass: [0.03, 0.0, 0.47, 0.48] as const,
  canopy: [0.56, 0.06, 0.94, 0.44] as const,
};

type Rect = readonly [number, number, number, number];

/** Arched strip (frond/leaf/blade) from origin along +Z. */
function strip(len: number, width: number, segs: number, uv: Rect, arch: number, droop: number, taper = 0.2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const z = s * len * (1 - droop * 0.25 * s);
    const y = len * (arch * s - droop * s * s);
    const w = width * (1 - (1 - taper) * Math.pow(s, 1.6)) * (s < 0.08 ? 0.4 + s * 7 : 1);
    const v = uv[1] + (uv[3] - uv[1]) * s;
    pos.push(-w / 2, y, z, w / 2, y, z);
    uvs.push(uv[0], v, uv[2], v);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Point all normals away from a center (soft, volumetric shading for foliage clumps). */
function sphericalNormals(g: THREE.BufferGeometry, center: THREE.Vector3, blend = 0.75): void {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  const o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(center).normalize();
    o.fromBufferAttribute(n, i).lerp(v, blend).normalize();
    n.setXYZ(i, o.x, o.y, o.z);
  }
}

export function fernGeometry(seed: number, fronds = 9, len = 1.1): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < fronds; i++) {
    const l = len * (0.7 + rnd() * 0.5);
    const g = strip(l, l * 0.55, 6, ATLAS.fern, 0.7 + rnd() * 0.3, 0.9 + rnd() * 0.4, 0.15);
    g.rotateX(-0.05 - rnd() * 0.25);
    g.rotateY((i / fronds) * Math.PI * 2 + rnd() * 0.4);
    parts.push(g);
  }
  const m = mergeGeometries(parts)!;
  sphericalNormals(m, new THREE.Vector3(0, -0.3, 0), 0.6);
  return m;
}

export function broadleafGeometry(seed: number, leaves = 6, len = 1.2): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < leaves; i++) {
    const l = len * (0.75 + rnd() * 0.45);
    const g = strip(l, l * 0.8, 5, ATLAS.broadleaf, 0.55, 0.6 + rnd() * 0.3, 0.3);
    // Lift the leaf on a petiole.
    g.translate(0, l * 0.3 + rnd() * 0.2, l * 0.15);
    g.rotateY((i / leaves) * Math.PI * 2 + rnd() * 0.6);
    parts.push(g);
  }
  const m = mergeGeometries(parts)!;
  sphericalNormals(m, new THREE.Vector3(0, 0, 0), 0.5);
  return m;
}

export function grassGeometry(h = 0.6, w = 0.75): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(w, h, 1, 2);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, ATLAS.grass[0] + (ATLAS.grass[2] - ATLAS.grass[0]) * uv.getX(k), ATLAS.grass[1] + (ATLAS.grass[3] - ATLAS.grass[1]) * uv.getY(k));
    }
    g.translate(0, h / 2, 0);
    g.rotateY((i / 3) * Math.PI);
    parts.push(g);
  }
  const m = mergeGeometries(parts)!;
  // Up-facing normals: grass lit like the ground it grows from.
  const n = m.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return m;
}

function canopyCards(rnd: () => number, centers: THREE.Vector3[], cardsPer: number, size: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of centers) {
    for (let i = 0; i < cardsPer; i++) {
      const s = size * (0.7 + rnd() * 0.6);
      const g = new THREE.PlaneGeometry(s, s);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++)
        uv.setXY(k, ATLAS.canopy[0] + (ATLAS.canopy[2] - ATLAS.canopy[0]) * uv.getX(k), ATLAS.canopy[1] + (ATLAS.canopy[3] - ATLAS.canopy[1]) * uv.getY(k));
      g.rotateX(-Math.PI / 2 + (rnd() - 0.5) * 1.3);
      g.rotateY(rnd() * Math.PI * 2);
      const r = size * 0.9;
      g.translate(c.x + (rnd() - 0.5) * r * 2, c.y + (rnd() - 0.4) * r * 0.9, c.z + (rnd() - 0.5) * r * 2);
      parts.push(g);
    }
  }
  const m = mergeGeometries(parts)!;
  const center = new THREE.Vector3();
  centers.forEach((c) => center.add(c));
  center.divideScalar(centers.length);
  center.y -= size * 0.6;
  sphericalNormals(m, center, 0.8);
  return m;
}

function trunk(rnd: () => number, height: number, r0: number, r1: number, buttress: number, lean: THREE.Vector2): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, 14, 18, true);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const o = rnd() * 50;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.y / height;
    const ang = Math.atan2(v.z, v.x);
    const n = fbm2(ang * 1.2 + o, v.y * 0.35, 3) * 0.12 + fbm2(ang * 4 + o, v.y * 1.5, 2) * 0.04;
    // Buttress fins near the base
    const fins = buttress > 0 ? Math.pow(Math.max(0, Math.cos(ang * 5 + o)), 6) * Math.pow(Math.max(0, 1 - t * 4), 2) * buttress : 0;
    const flare = Math.pow(Math.max(0, 1 - t * 6), 2) * r0 * 0.6;
    const scale = 1 + n + fins / Math.max(0.2, r0) + flare / Math.max(0.2, r0);
    v.x *= scale;
    v.z *= scale;
    v.x += lean.x * t * t * height * 0.15;
    v.z += lean.y * t * t * height * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // UV repeat for bark
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * height * 0.35);
  return g;
}

function branch(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 3, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len * 0.35);
  return g;
}

export interface TreeGeometry {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  leavesLod: THREE.BufferGeometry;
  height: number;
  trunkRadius: number;
}

export function rainforestTree(seed: number, kind: 'giant' | 'slender'): TreeGeometry {
  const rnd = mulberry32(seed);
  const height = kind === 'giant' ? 18 + rnd() * 6 : 10 + rnd() * 4;
  const r0 = kind === 'giant' ? 0.75 + rnd() * 0.25 : 0.28 + rnd() * 0.1;
  const r1 = r0 * 0.45;
  const lean = new THREE.Vector2(rnd() - 0.5, rnd() - 0.5);
  const barks: THREE.BufferGeometry[] = [trunk(rnd, height, r0, r1, kind === 'giant' ? 1.1 : 0.15, lean)];
  const top = new THREE.Vector3(lean.x * height * 0.15, height, lean.y * height * 0.15);
  const centers: THREE.Vector3[] = [];
  const nb = kind === 'giant' ? 5 : 3;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rnd() * 0.8;
    const startY = height * (0.72 + rnd() * 0.2);
    const from = new THREE.Vector3(top.x * (startY / height) ** 2, startY, top.z * (startY / height) ** 2);
    const reach = (kind === 'giant' ? 5 : 2.6) * (0.7 + rnd() * 0.5);
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * reach, reach * (0.35 + rnd() * 0.3), Math.sin(a) * reach));
    barks.push(branch(from, to, r1 * 0.75, r1 * 0.25));
    centers.push(to.clone().add(new THREE.Vector3(0, 0.6, 0)));
  }
  centers.push(top.clone().add(new THREE.Vector3(0, 1.2, 0)));
  const size = kind === 'giant' ? 4.4 : 3.0;
  // Extra inner clusters so crowns read as dense masses, not speckles.
  const inner = centers.map((c) => c.clone().lerp(top, 0.45).add(new THREE.Vector3(0, 0.8, 0)));
  const leaves = canopyCards(rnd, [...centers, ...inner], kind === 'giant' ? 26 : 18, size);
  const leavesLod = canopyCards(rnd, centers, kind === 'giant' ? 9 : 7, size * 1.6);
  return { bark: mergeGeometries(barks)!, leaves, leavesLod, height, trunkRadius: r0 };
}

export function treeFernGeometry(seed: number): TreeGeometry {
  const rnd = mulberry32(seed);
  const height = 3.2 + rnd() * 2.2;
  const lean = new THREE.Vector2((rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5);
  const bark = trunk(rnd, height, 0.16, 0.13, 0, lean);
  const top = new THREE.Vector3(lean.x * height * 0.15, height, lean.y * height * 0.15);
  const parts: THREE.BufferGeometry[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const l = 2.4 + rnd() * 0.9;
    const g = strip(l, l * 0.5, 7, ATLAS.fern, 0.55, 1.1, 0.1);
    g.rotateX(-0.25 - rnd() * 0.3);
    g.rotateY((i / n) * Math.PI * 2 + rnd() * 0.3);
    g.translate(top.x, top.y, top.z);
    parts.push(g);
  }
  const leaves = mergeGeometries(parts)!;
  sphericalNormals(leaves, top.clone().setY(top.y - 1), 0.5);
  return { bark, leaves, leavesLod: leaves, height, trunkRadius: 0.16 };
}

/** Hanging vine strip (uses the canopy leaf cell). */
export function vineGeometry(seed: number, len: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.max(3, Math.floor(len / 0.7));
  for (let i = 0; i < n; i++) {
    const s = 0.5 + rnd() * 0.4;
    const g = new THREE.PlaneGeometry(s, s);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++)
      uv.setXY(k, ATLAS.canopy[0] + (ATLAS.canopy[2] - ATLAS.canopy[0]) * uv.getX(k), ATLAS.canopy[1] + (ATLAS.canopy[3] - ATLAS.canopy[1]) * uv.getY(k));
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 0.25, -i * (len / n), (rnd() - 0.5) * 0.1);
    parts.push(g);
  }
  const m = mergeGeometries(parts)!;
  // Vines sway from the TOP: invert height weighting by storing positive y downward offset.
  m.translate(0, len, 0);
  return m;
}

/**
 * Distant tree: 5-sided trunk + a few large canopy cards, single foliage material (the trunk
 * samples an opaque dark-leaf area of the atlas). Reads as forest through the fog.
 */
export function farTreeGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const trunkG = new THREE.CylinderGeometry(0.35, 0.75, 17, 5, 1, true);
  trunkG.translate(0, 8.5, 0);
  const uv = trunkG.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.74 + uv.getX(i) * 0.02, 0.7 + uv.getY(i) * 0.02);
  const n = trunkG.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 0.9, n.getZ(i) * 0.4);
  const centers = [0, 1, 2, 3].map((i) => new THREE.Vector3(Math.cos(i * 1.7) * 2.6, 15 + rnd() * 3.5, Math.sin(i * 1.7) * 2.6));
  centers.push(new THREE.Vector3(0, 19, 0));
  const cards = canopyCards(rnd, centers, 7, 6.5);
  return mergeGeometries([trunkG.toNonIndexed(), cards.index ? cards.toNonIndexed() : cards])!;
}

/** Cheap distant-forest canopy blob (opaque). */
export function canopyBlob(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CylinderGeometry(0.25, 0.4, 8, 5, 1, true);
  t.translate(0, 4, 0);
  parts.push(t.index ? t.toNonIndexed() : t);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(2.4 + rnd() * 1.5, 0);
    g.scale(1, 0.62, 1);
    g.translate((rnd() - 0.5) * 3, 8 + rnd() * 2.5, (rnd() - 0.5) * 3);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  for (const p of parts) p.deleteAttribute('uv');
  const trunkVerts = parts[0].attributes.position.count;
  const m = mergeGeometries(parts)!;
  const col = new Float32Array(m.attributes.position.count * 3);
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const trunkPart = i < trunkVerts ? 1 : 0;
    const c = trunkPart ? [0.22, 0.17, 0.12] : [0.12 + y * 0.008, 0.2 + y * 0.012, 0.08];
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeVertexNormals();
  return m;
}

// ======================================================================= chunked instancing + LOD

interface Chunk {
  center: THREE.Vector3;
  min: THREE.Vector2;
  max: THREE.Vector2;
  hi: THREE.InstancedMesh;
  lo: THREE.InstancedMesh | null;
  full: number;
}

/**
 * Spatially chunked InstancedMeshes: per-chunk frustum culling (by Three), distance culling
 * and an optional low-detail geometry for distant chunks. Density is applied by lowering
 * the instance count (instances are shuffled at build time so this removes a random subset).
 */
export class ChunkedInstances {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private timer = 0;
  maxDistance = 120;
  lodDistance = 60;
  density = 1;

  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private opts: {
      chunkSize?: number;
      lodGeometry?: THREE.BufferGeometry;
      castShadow?: boolean;
      receiveShadow?: boolean;
      depthMaterial?: THREE.Material;
      name?: string;
    } = {},
  ) {
    this.group.name = opts.name ?? 'vegetation';
  }

  build(matrices: THREE.Matrix4[], colors?: THREE.Color[]): void {
    const size = this.opts.chunkSize ?? 24;
    const cells = new Map<string, number[]>();
    const p = new THREE.Vector3();
    // Shuffle so density reduction removes a spatially random subset.
    const order = matrices.map((_, i) => i);
    const rnd = mulberry32(matrices.length);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      p.setFromMatrixPosition(matrices[i]);
      const k = `${Math.floor(p.x / size)},${Math.floor(p.z / size)}`;
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    }
    for (const [k, list] of cells) {
      const [cx, cz] = k.split(',').map(Number);
      // Tight XZ bounds of the instances in this chunk (for distance-based culling / LOD).
      const min = new THREE.Vector2(Infinity, Infinity);
      const max = new THREE.Vector2(-Infinity, -Infinity);
      for (const idx of list) {
        p.setFromMatrixPosition(matrices[idx]);
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.z);
      }
      const mk = (geo: THREE.BufferGeometry) => {
        const im = new THREE.InstancedMesh(geo, this.material, list.length);
        list.forEach((idx, n) => {
          im.setMatrixAt(n, matrices[idx]);
          if (colors) im.setColorAt(n, colors[idx]);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = this.opts.castShadow ?? false;
        im.receiveShadow = this.opts.receiveShadow ?? true;
        if (this.opts.depthMaterial) im.customDepthMaterial = this.opts.depthMaterial;
        im.computeBoundingSphere();
        this.group.add(im);
        return im;
      };
      const hi = mk(this.geometry);
      const lo = this.opts.lodGeometry ? mk(this.opts.lodGeometry) : null;
      if (lo) {
        lo.castShadow = false;
        lo.visible = false;
      }
      this.chunks.push({ center: new THREE.Vector3((cx + 0.5) * size, hi.boundingSphere?.center.y ?? 0, (cz + 0.5) * size), min, max, hi, lo, full: list.length });
    }
    this.applyDensity(this.density);
  }

  setCastShadow(on: boolean): void {
    for (const c of this.chunks) c.hi.castShadow = on;
  }

  applyDensity(d: number): void {
    this.density = d;
    for (const c of this.chunks) {
      const n = Math.max(0, Math.round(c.full * d));
      c.hi.count = n;
      if (c.lo) c.lo.count = n;
    }
  }

  update(dt: number, cam: THREE.Vector3, force = false): void {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.2;
    for (const c of this.chunks) {
      // Distance from the camera to the nearest instance bound (not the chunk centre).
      const dx = Math.max(c.min.x - cam.x, 0, cam.x - c.max.x);
      const dz = Math.max(c.min.y - cam.z, 0, cam.z - c.max.y);
      const d = Math.hypot(dx, dz);
      const inRange = d < this.maxDistance;
      const useLo = c.lo !== null && d > this.lodDistance;
      c.hi.visible = inRange && !useLo;
      if (c.lo) c.lo.visible = inRange && useLo;
    }
  }

  get instanceCount(): number {
    return this.chunks.reduce((s, c) => s + c.hi.count, 0);
  }

  dispose(): void {
    for (const c of this.chunks) {
      c.hi.dispose();
      c.lo?.dispose();
    }
    this.group.removeFromParent();
  }
}
