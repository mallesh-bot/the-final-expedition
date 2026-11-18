import * as THREE from 'three';

/**
 * A flat water sheet in the same layout the water shader expects from a river: uv.x runs along the
 * flow (metres * 0.1), uv.y across (0..1). Long thin sheets run along their length; pools barely
 * move. `flow` overrides that (negative runs the other way).
 */
export function flowPlaneGeometry(w: number, d: number, flow?: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(Math.abs(w), Math.abs(d)).rotateX(-Math.PI / 2);
  const alongZ = Math.abs(d) >= Math.abs(w);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const across = alongZ ? Math.abs(w) : Math.abs(d);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, (alongZ ? z : x) * 0.1, (alongZ ? x : z) / across + 0.5);
  }
  const ratio = Math.max(Math.abs(w), Math.abs(d)) / Math.max(1e-3, Math.min(Math.abs(w), Math.abs(d)));
  const f = flow ?? (ratio > 1.6 ? 1 : 0.1);
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Array(pos.count).fill(f), 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(new Array(pos.count).fill(across), 1));
  return g;
}

/**
 * Builds a river/stream ribbon from a centerline polyline. uv.x runs along the flow
 * (meters * 0.1), uv.y across (0..1) so the water shader can scroll + foam the banks.
 */
export function riverMesh(points: THREE.Vector3[], width: number | ((t: number) => number), material: THREE.Material, samples = 120): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos: number[] = [];
  const uv: number[] = [];
  const widths: number[] = [];
  const idx: number[] = [];
  const len = curve.getLength();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.crossVectors(up, tan).normalize();
    const w = typeof width === 'function' ? width(t) : width;
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * w * 0.5 * s, p.y, p.z + side.z * w * 0.5 * s);
      uv.push(t * len * 0.1, s < 0 ? 0 : 1);
      widths.push(w);
    }
    if (i < samples) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Array(widths.length).fill(1), 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(widths, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure upward normals regardless of winding.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.renderOrder = 2;
  m.name = 'water';
  return m;
}

/** Curved sheet for a waterfall: top lip -> bottom pool, bulging outward. */
export function waterfallMesh(top: THREE.Vector3, bottom: THREE.Vector3, width: number, outward: THREE.Vector3, material: THREE.Material, throwDist = 1.4): THREE.Mesh {
  const segsY = 24;
  const segsX = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const metres: number[] = [];
  const idx: number[] = [];
  let fallen = 0;
  const prevC = new THREE.Vector3();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
  for (let j = 0; j <= segsY; j++) {
    const t = j / segsY;
    const y = top.y + (bottom.y - top.y) * t;
    // Parabolic fall: leaves the lip outward, then drops almost vertical.
    // Water leaves the lip sideways and falls: distance out grows with the square root of the drop.
    const out = Math.sqrt(t) * throwDist + Math.sin(t * Math.PI) * 0.3 * Math.min(1, throwDist / 1.4);
    const c = new THREE.Vector3().lerpVectors(top, bottom, t).setY(y).addScaledVector(outward, out);
    const w = width * (1 + t * 0.35);
    if (j > 0) fallen += prevC.distanceTo(c);
    prevC.copy(c);
    for (let i = 0; i <= segsX; i++) {
      const s = i / segsX - 0.5;
      // The sheet is rounded across its width (thickest in the middle), so it has body from the side.
      const belly = Math.cos(s * Math.PI) * Math.min(0.5, w * 0.28);
      pos.push(c.x + right.x * w * s + outward.x * belly, c.y, c.z + right.z * w * s + outward.z * belly);
      uv.push(i / segsX, 1 - t);
      metres.push(w * s, fallen);
    }
    if (j < segsY)
      for (let i = 0; i < segsX; i++) {
        const a = j * (segsX + 1) + i;
        const b = a + segsX + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aMetres', new THREE.Float32BufferAttribute(metres, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 3;
  m.name = 'waterfall';
  return m;
}
