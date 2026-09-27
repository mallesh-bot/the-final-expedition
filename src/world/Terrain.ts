import * as THREE from 'three';
import type { Heightfield } from '../physics/Heightfield';

export interface SplatFn {
  /** Returns [mud/path, grass, rock] weights (unnormalized) at a world point. */
  (x: number, z: number, h: number, slopeY: number): [number, number, number];
}

/** Builds the render mesh for a heightfield with per-vertex splat weights and baked AO. */
export function buildTerrainMesh(hf: Heightfield, splat: SplatFn, material: THREE.Material): THREE.Mesh {
  const res = hf.res;
  const count = res * res;
  const pos = new Float32Array(count * 3);
  const sp = new Float32Array(count * 4);
  const col = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const n = new THREE.Vector3();
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const x = hf.originX + i * hf.cell;
      const z = hf.originZ + j * hf.cell;
      const h = hf.heights[k];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = i / (res - 1);
      uv[k * 2 + 1] = j / (res - 1);
      hf.normalAt(x, z, n);
      const [a, b, c] = splat(x, z, h, n.y);
      sp[k * 4] = a;
      sp[k * 4 + 1] = b;
      sp[k * 4 + 2] = c;
      sp[k * 4 + 3] = 0;
      // Cavity AO: compare with neighbourhood average height.
      let avg = 0;
      const r = 3;
      let cnt = 0;
      for (let dj = -r; dj <= r; dj += r)
        for (let di = -r; di <= r; di += r) {
          const ii = Math.min(res - 1, Math.max(0, i + di));
          const jj = Math.min(res - 1, Math.max(0, j + dj));
          avg += hf.heights[jj * res + ii];
          cnt++;
        }
      avg /= cnt;
      const ao = THREE.MathUtils.clamp(1 + (h - avg) * 0.18, 0.55, 1.08);
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
    }
  }
  const idx = new Uint32Array((res - 1) * (res - 1) * 6);
  let q = 0;
  for (let j = 0; j < res - 1; j++)
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i;
      const b = (j + 1) * res + i;
      const c = (j + 1) * res + i + 1;
      const d = j * res + i + 1;
      idx[q++] = a;
      idx[q++] = b;
      idx[q++] = d;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('splat', new THREE.BufferAttribute(sp, 4));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Tiled terrain with two LODs per tile (full-res near, 1/4-res far) and skirts that hide
 * LOD seams. Physics keeps using the full heightfield.
 */
export class TerrainTiles {
  readonly group = new THREE.Group();
  private tiles: { hi: THREE.Mesh; lo: THREE.Mesh; cx: number; cz: number; half: number }[] = [];
  lodDistance = 95;
  private timer = 0;

  constructor(hf: Heightfield, splat: SplatFn, material: THREE.Material, tileCells = 40) {
    this.group.name = 'terrain';
    const full = buildTerrainMesh(hf, splat, material);
    const src = full.geometry;
    const pos = src.attributes.position.array as Float32Array;
    const nrm = src.attributes.normal.array as Float32Array;
    const spl = src.attributes.splat.array as Float32Array;
    const col = src.attributes.color.array as Float32Array;
    const res = hf.res;
    const nTiles = Math.ceil((res - 1) / tileCells);
    for (let tj = 0; tj < nTiles; tj++)
      for (let ti = 0; ti < nTiles; ti++) {
        const i0 = ti * tileCells;
        const j0 = tj * tileCells;
        const i1 = Math.min(res - 1, i0 + tileCells);
        const j1 = Math.min(res - 1, j0 + tileCells);
        const hi = this.tile(pos, nrm, spl, col, res, i0, j0, i1, j1, 1, false);
        const lo = this.tile(pos, nrm, spl, col, res, i0, j0, i1, j1, 4, true);
        const mk = (g: THREE.BufferGeometry) => {
          const m = new THREE.Mesh(g, material);
          m.receiveShadow = true;
          m.name = 'terrain';
          this.group.add(m);
          return m;
        };
        const h = mk(hi);
        const l = mk(lo);
        l.visible = false;
        const cx = hf.originX + ((i0 + i1) / 2) * hf.cell;
        const cz = hf.originZ + ((j0 + j1) / 2) * hf.cell;
        this.tiles.push({ hi: h, lo: l, cx, cz, half: ((i1 - i0) / 2) * hf.cell });
      }
    src.dispose();
  }

  private tile(pos: Float32Array, nrm: Float32Array, spl: Float32Array, col: Float32Array, res: number, i0: number, j0: number, i1: number, j1: number, step: number, skirt: boolean): THREE.BufferGeometry {
    const P: number[] = [];
    const Nn: number[] = [];
    const S: number[] = [];
    const C: number[] = [];
    const idx: number[] = [];
    const cols: number[] = [];
    for (let i = i0; i < i1; i += step) cols.push(i);
    cols.push(i1);
    const rows: number[] = [];
    for (let j = j0; j < j1; j += step) rows.push(j);
    rows.push(j1);
    const push = (k: number, dy = 0) => {
      P.push(pos[k * 3], pos[k * 3 + 1] + dy, pos[k * 3 + 2]);
      Nn.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
      S.push(spl[k * 4], spl[k * 4 + 1], spl[k * 4 + 2], spl[k * 4 + 3]);
      C.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
      return P.length / 3 - 1;
    };
    const w = cols.length;
    for (const j of rows) for (const i of cols) push(j * res + i);
    for (let r = 0; r < rows.length - 1; r++)
      for (let c = 0; c < w - 1; c++) {
        const a = r * w + c;
        const b = (r + 1) * w + c;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    if (skirt) {
      const edge = (list: number[]) => {
        const base = list.map((k) => push(k, 0));
        const low = list.map((k) => push(k, -3));
        for (let n = 0; n < list.length - 1; n++) idx.push(base[n], low[n], base[n + 1], low[n], low[n + 1], base[n + 1], base[n], base[n + 1], low[n], low[n], base[n + 1], low[n + 1]);
      };
      edge(cols.map((i) => rows[0] * res + i));
      edge(cols.map((i) => rows[rows.length - 1] * res + i));
      edge(rows.map((j) => j * res + cols[0]));
      edge(rows.map((j) => j * res + cols[w - 1]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('splat', new THREE.Float32BufferAttribute(S, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((P.length / 3) * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  update(dt: number, cam: THREE.Vector3, force = false): void {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.25;
    for (const t of this.tiles) {
      const dx = Math.max(Math.abs(cam.x - t.cx) - t.half, 0);
      const dz = Math.max(Math.abs(cam.z - t.cz) - t.half, 0);
      const far = Math.hypot(dx, dz) > this.lodDistance;
      t.hi.visible = !far;
      t.lo.visible = far;
    }
  }

  dispose(): void {
    for (const t of this.tiles) {
      t.hi.geometry.dispose();
      t.lo.geometry.dispose();
    }
    this.group.removeFromParent();
  }
}
