import * as THREE from 'three';
import { InstanceBatch, displacedSlab } from '../../world/RockKit';
import { waterfallMesh, riverMesh } from '../../world/Water';
import { farTreeGeometry } from '../../world/Vegetation';
import { mulberry32 } from '../../systems/noise';
import { terrainHeight } from './layout';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * The Hollow Meridian (STORY_BIBLE §5): a city carved into the walls of the gorge —
 * terraces stepping down the rock, houses with dark doorways, zig-zag stairs, an arched
 * aqueduct across the gorge, the sun tower on the floor, and falls feeding the river.
 * Built only as a vista (seen when the gate opens) with a handful of instanced draws.
 */
export function buildGorge(opts: {
  mason: THREE.Material;
  fall: THREE.Material;
  water: THREE.Material;
  foliage: THREE.Material;
  bronze: THREE.Material;
}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'gorge-city';
  const rnd = mulberry32(1440);
  const block = displacedSlab(701, 1, 1, 1, 0.03, 5, 0.06);
  const dark = new THREE.MeshStandardMaterial({ color: 0x080706, roughness: 1 });
  const stone = new InstanceBatch();
  const holes = new InstanceBatch();
  const holeGeo = new THREE.BoxGeometry(1, 1, 1);

  /** First z (searching from the gorge toward the far wall) where the rock rises above y. */
  const farFace = (x: number, y: number) => {
    for (let z = 120; z < 200; z += 0.5) if (terrainHeight(x, z) > y) return z;
    return 200;
  };
  /** Side wall face x for a given z & height, searching outward from the gorge centre. */
  const sideFace = (sign: number, z: number, y: number) => {
    for (let d = 30; d < 90; d += 0.5) if (terrainHeight(4 + sign * d, z) > y) return 4 + sign * d;
    return 4 + sign * 90;
  };

  /** `base` is on the rock face; the house is built outward along `facing` (slightly embedded). */
  const house = (base: THREE.Vector3, facing: THREE.Vector3, w: number, h: number, d: number, tone: number) => {
    const yaw = Math.atan2(facing.x, facing.z);
    const c = base.clone().addScaledVector(facing, d / 2 - 0.6).setY(base.y + h / 2);
    stone.add(block, c, v(w, h, d), yaw, tone);
    if (rnd() < 0.7) stone.add(block, c.clone().setY(base.y + h + 0.6), v(w * 0.7, 1.2, d * 0.7), yaw, tone * 0.95);
    // Doorway and windows (dark insets on the front face)
    const front = base.clone().addScaledVector(facing, d - 0.6 + 0.05);
    const right = new THREE.Vector3(facing.z, 0, -facing.x);
    holes.add(holeGeo, front.clone().addScaledVector(right, (rnd() - 0.5) * w * 0.4).setY(base.y + 1.3), v(1.3, 2.6, 0.3), yaw);
    const nw = Math.floor(rnd() * 3);
    for (let i = 0; i < nw; i++) holes.add(holeGeo, front.clone().addScaledVector(right, (i - 1) * w * 0.3).setY(base.y + h * 0.72), v(0.8, 0.9, 0.3), yaw);
  };

  // ---------------------------------------------------------------- far wall terraces
  const levels = [-60, -44, -28, -12, 4, 20, 36];
  levels.forEach((y, li) => {
    const span = 36 + li * 7;
    for (let x = 4 - span; x < 4 + span; x += 7 + rnd() * 5) {
      const face = farFace(x, y + 2);
      const depth = 7;
      // Terrace platform
      stone.add(block, v(x, y - 0.8, face - depth / 2 + 1), v(8.5, 1.6, depth + 2), 0, 0.92);
      if (rnd() < 0.85) house(v(x + (rnd() - 0.5) * 2, y, face), v(0, 0, -1), 4 + rnd() * 4, 4 + rnd() * 6, 4.5, 0.6 + rnd() * 0.3);
      // Parapet
      if (rnd() < 0.5) stone.add(block, v(x, y + 0.4, face - depth), v(8, 0.8, 0.5), 0, 0.85);
    }
    // Zig-zag stair down to the next level
    if (li > 0) {
      const x0 = 4 + (li % 2 ? -1 : 1) * (10 + li * 3);
      const yTop = y;
      const yBot = levels[li - 1];
      const steps = Math.round((yTop - yBot) / 0.9);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const x = x0 + (li % 2 ? 1 : -1) * t * 14;
        const yy = yTop - t * (yTop - yBot);
        const face = farFace(x, yy + 1);
        stone.add(block, v(x, yy - 0.3, face - 2), v(1.2, 0.6, 3), 0, 0.9);
      }
    }
  });

  // ---------------------------------------------------------------- side wall terraces
  for (const sign of [-1, 1]) {
    for (const y of [-50, -30, -10, 10]) {
      for (let z = 72; z < 144; z += 8 + rnd() * 6) {
        const fx = sideFace(sign, z, y + 2);
        const facing = v(-sign, 0, 0);
        stone.add(block, v(fx - sign * 3.5, y - 0.8, z), v(8, 1.6, 8), 0, 0.9);
        if (rnd() < 0.7) house(v(fx, y, z), facing, 4 + rnd() * 3, 4 + rnd() * 5, 4, 0.6 + rnd() * 0.3);
      }
    }
  }

  // ---------------------------------------------------------------- aqueduct across the gorge
  {
    const z = 108;
    const yDeck = -26;
    const xa = sideFace(-1, z, yDeck) + 2;
    const xb = sideFace(1, z, yDeck) - 2;
    const n = Math.round((xb - xa) / 11);
    for (let i = 0; i <= n; i++) {
      const x = xa + ((xb - xa) * i) / n;
      const floor = terrainHeight(x, z);
      const h = yDeck - floor;
      if (h > 1) stone.add(block, v(x, floor + h / 2, z), v(3.2, h, 3.2), 0, 0.85);
      if (i < n) {
        stone.add(block, v(x + (xb - xa) / n / 2, yDeck + 0.9, z), v((xb - xa) / n + 0.2, 1.8, 3.6), 0, 0.9);
        // Arch spandrels
        stone.add(block, v(x + (xb - xa) / n / 2, yDeck - 1.2, z), v((xb - xa) / n * 0.55, 2.4, 3.3), 0, 0.82);
      }
    }
    // Water channel on the deck
    g.add(riverMesh([v(xa, yDeck + 1.85, z), v((xa + xb) / 2, yDeck + 1.85, z), v(xb, yDeck + 1.85, z)], 1.4, opts.water, 30));
  }

  // ---------------------------------------------------------------- the sun tower
  {
    const base = v(-14, terrainHeight(-14, 128), 128);
    let y = base.y;
    let w = 14;
    for (let k = 0; k < 10; k++) {
      const hh = 10 - k * 0.3;
      stone.add(block, v(base.x, y + hh / 2, base.z), v(w, hh, w), k * 0.12, 0.88);
      if (k % 2 === 0) holes.add(holeGeo, v(base.x, y + hh * 0.45, base.z - w / 2 - 0.02), v(1.6, 3, 0.3), 0);
      y += hh;
      w -= 0.9;
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.45, 10, 40), opts.bronze);
    ring.position.set(base.x, y + 4.5, base.z);
    ring.rotation.y = 0.2;
    g.add(ring);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.4, 36), opts.bronze);
    disc.rotation.x = Math.PI / 2;
    disc.position.copy(ring.position);
    g.add(disc);
  }

  // ---------------------------------------------------------------- falls + river
  g.add(waterfallMesh(v(24, 72, farFace(24, 70) + 1), v(24, -72, farFace(24, -70) - 2), 13, v(0, 0, -1), opts.fall));
  g.add(waterfallMesh(v(-26, 48, farFace(-26, 46) + 1), v(-26, -72, farFace(-26, -70) - 2), 6, v(0, 0, -1), opts.fall));
  const riverPts: THREE.Vector3[] = [];
  for (let z = 146; z > 58; z -= 11) riverPts.push(v(4 + Math.sin(z * 0.05) * 9, -73.4, z));
  g.add(riverMesh(riverPts, 9, opts.water, 60));

  // ---------------------------------------------------------------- overgrowth
  {
    const geo = farTreeGeometry(11);
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 260; i++) {
      const x = -50 + rnd() * 108;
      const z = 64 + rnd() * 84;
      const y = terrainHeight(x, z);
      if (y > 30) continue;
      q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0));
      m.compose(v(x, y - 1, z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.6 + rnd() * 0.6));
      mats.push(m.clone());
    }
    // Trees on the terraces too
    levels.forEach((y) => {
      for (let i = 0; i < 10; i++) {
        const x = -40 + rnd() * 90;
        const face = farFace(x, y + 2);
        q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0));
        m.compose(v(x, y, face - 6), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.35 + rnd() * 0.3));
        mats.push(m.clone());
      }
    });
    const im = new THREE.InstancedMesh(geo, opts.foliage, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    g.add(im);
  }

  g.add(...stone.build(opts.mason, { castShadow: false, name: 'city' }));
  g.add(...holes.build(dark, { castShadow: false, receiveShadow: false, name: 'city-openings' }));
  return g;
}
