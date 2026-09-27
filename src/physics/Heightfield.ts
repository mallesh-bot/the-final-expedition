import * as THREE from 'three';

/**
 * Regular-grid heightfield shared by terrain rendering and collision so visuals and
 * physics always match exactly.
 */
export class Heightfield {
  readonly heights: Float32Array;
  readonly cell: number;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly size: number,
    readonly res: number,
    fn: (x: number, z: number) => number,
  ) {
    this.cell = size / (res - 1);
    this.heights = new Float32Array(res * res);
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) this.heights[j * res + i] = fn(originX + i * this.cell, originZ + j * this.cell);
  }

  get maxX(): number {
    return this.originX + this.size;
  }
  get maxZ(): number {
    return this.originZ + this.size;
  }

  private at(i: number, j: number): number {
    i = i < 0 ? 0 : i >= this.res ? this.res - 1 : i;
    j = j < 0 ? 0 : j >= this.res ? this.res - 1 : j;
    return this.heights[j * this.res + i];
  }

  /** Height matching the rendered triangle mesh (two triangles per quad, same diagonal). */
  heightAt(x: number, z: number): number {
    const fx = (x - this.originX) / this.cell;
    const fz = (z - this.originZ) / this.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h00 = this.at(i, j);
    const h10 = this.at(i + 1, j);
    const h01 = this.at(i, j + 1);
    const h11 = this.at(i + 1, j + 1);
    // PlaneGeometry-style diagonal: (i,j+1)-(i+1,j)
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell * 0.5;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
}
