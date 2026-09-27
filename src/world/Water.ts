import * as THREE from 'three';

/**
 * Builds a river/stream ribbon from a centerline polyline. uv.x runs along the flow
 * (meters * 0.1), uv.y across (0..1) so the water shader can scroll + foam the banks.
 */
export function riverMesh(points: THREE.Vector3[], width: number | ((t: number) => number), material: THREE.Material, samples = 120): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos: number[] = [];
  const uv: number[] = [];
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
    }
    if (i < samples) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
export function waterfallMesh(top: THREE.Vector3, bottom: THREE.Vector3, width: number, outward: THREE.Vector3, material: THREE.Material): THREE.Mesh {
  const segsY = 24;
  const segsX = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
  for (let j = 0; j <= segsY; j++) {
    const t = j / segsY;
    const y = top.y + (bottom.y - top.y) * t;
    // Parabolic fall: leaves the lip outward, then drops almost vertical.
    const out = Math.sqrt(t) * 1.4 + Math.sin(t * Math.PI) * 0.3;
    const c = new THREE.Vector3().lerpVectors(top, bottom, t).setY(y).addScaledVector(outward, out);
    const w = width * (1 + t * 0.35);
    for (let i = 0; i <= segsX; i++) {
      const s = i / segsX - 0.5;
      pos.push(c.x + right.x * w * s, c.y, c.z + right.z * w * s);
      uv.push(i / segsX, 1 - t);
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
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 3;
  m.name = 'waterfall';
  return m;
}
