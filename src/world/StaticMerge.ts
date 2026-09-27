import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bakes every static Mesh under `group` into one merged mesh per (material, shadow flags,
 * attribute layout). Dozens of small props collapse into a handful of draw calls.
 * Only use for objects that never move independently.
 */
export function mergeStatic(group: THREE.Object3D, name = 'static-merged'): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; geos: THREE.BufferGeometry[] }>();
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (Array.isArray(m.material)) return;
    meshes.push(m);
  });
  for (const m of meshes) {
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${Object.keys(g.attributes).sort().join(',')}|${m.renderOrder}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, geos: [] }));
    b.geos.push(g);
  }
  const out = new THREE.Group();
  out.name = name;
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.renderOrder = b.order;
    mesh.name = name;
    out.add(mesh);
  }
  // Source geometries are no longer needed.
  for (const m of meshes) m.geometry.dispose();
  group.removeFromParent();
  return out;
}
