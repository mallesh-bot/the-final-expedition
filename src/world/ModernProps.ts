import * as THREE from 'three';
import { stencilTexture } from '../render/textures/ProceduralTextures';

/**
 * Corwin's 2026 expedition kit (Chapter 4+): nylon dome tents, a generator, floodlight masts,
 * a drill rig, survey crates and cables. Procedural, cheap, readable at a distance — and visibly
 * modern next to the 1958 canvas and timber.
 */
export interface ModernMaterials {
  nylonOrange: THREE.MeshStandardMaterial;
  nylonBlue: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  case: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
  stencilSurvey: THREE.MeshStandardMaterial;
  all: THREE.Material[];
}

export function createModernMaterials(): ModernMaterials {
  const st = stencilTexture(['ALDERCOTT SURVEY LTD', 'GEOTECH · 2026'], { color: 'rgba(240,240,236,0.92)', font: 'bold 52px Arial, sans-serif' });
  const m: Omit<ModernMaterials, 'all'> = {
    nylonOrange: new THREE.MeshStandardMaterial({ color: 0xd8662a, roughness: 0.7, side: THREE.DoubleSide }),
    nylonBlue: new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.7, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.8, roughness: 0.4 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b21c, metalness: 0.3, roughness: 0.55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.75 }),
    case: new THREE.MeshStandardMaterial({ color: 0x3c4a40, roughness: 0.6 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3.0) }),
    stencilSurvey: new THREE.MeshStandardMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.8 }),
  };
  return { ...m, all: Object.values(m) };
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
  const x = new THREE.Mesh(g, m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
};

export function domeTent(M: ModernMaterials, color: 'orange' | 'blue', r = 1.3): THREE.Group {
  const g = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), color === 'orange' ? M.nylonOrange : M.nylonBlue);
  shell.scale.set(1.25, 0.85, 1);
  g.add(shell);
  // Poles
  for (const a of [0.6, -0.6]) {
    const pole = mesh(new THREE.TorusGeometry(r * 1.02, 0.018, 4, 24, Math.PI), M.black, false);
    pole.rotation.set(0, a + Math.PI / 2, 0);
    pole.scale.set(1.25, 0.85, 1);
    g.add(pole);
  }
  // Door
  const door = mesh(new THREE.CircleGeometry(r * 0.45, 12, 0, Math.PI), M.black, false);
  door.position.set(0, 0.01, r * 0.99);
  g.add(door);
  return g;
}

export function surveyCrate(M: ModernMaterials, w = 1.0, h = 0.55, d = 0.6): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(w, h, d), M.case);
  body.position.y = h / 2;
  g.add(body);
  for (const sx of [-1, 1]) {
    const latch = mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), M.steel, false);
    latch.position.set(sx * w * 0.3, h * 0.85, d / 2 + 0.015);
    g.add(latch);
  }
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.45), M.stencilSurvey);
  decal.position.set(0, h * 0.45, d / 2 + 0.004);
  g.add(decal);
  return g;
}

export function generator(M: ModernMaterials): THREE.Group {
  const g = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(1.3, 0.8, 0.8), M.yellow);
  frame.position.y = 0.45;
  g.add(frame);
  const tank = mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 12).rotateZ(Math.PI / 2), M.black);
  tank.position.set(0, 0.95, 0);
  g.add(tank);
  const exhaust = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), M.steel);
  exhaust.position.set(0.55, 1.05, -0.25);
  g.add(exhaust);
  return g;
}

/** Floodlight mast; returns the group and the lamp head world offset (for a PointLight). */
export function floodlight(M: ModernMaterials, h = 4.2): { group: THREE.Group; head: THREE.Vector3 } {
  const g = new THREE.Group();
  const mast = mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 8), M.steel);
  mast.position.y = h / 2;
  g.add(mast);
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), M.steel, false);
    leg.position.set(Math.sin(a) * 0.45, 0.5, Math.cos(a) * 0.45);
    leg.rotation.set(Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55);
    g.add(leg);
  }
  for (const s of [-1, 1]) {
    const head = mesh(new THREE.BoxGeometry(0.42, 0.3, 0.16), M.black);
    head.position.set(s * 0.25, h, 0.08);
    head.rotation.x = -0.35;
    g.add(head);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), M.lamp);
    lens.position.set(s * 0.25, h - 0.03, 0.17);
    lens.rotation.x = -0.35;
    g.add(lens);
  }
  return { group: g, head: new THREE.Vector3(0, h, 0.3) };
}

export function drillRig(M: ModernMaterials, h = 6): THREE.Group {
  const g = new THREE.Group();
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.09, h + 0.3, 6), M.yellow);
    leg.position.set(Math.sin(a) * 0.9, h / 2, Math.cos(a) * 0.9);
    leg.rotation.set(Math.cos(a) * 0.15, 0, -Math.sin(a) * 0.15);
    g.add(leg);
  }
  const head = mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), M.black);
  head.position.y = h;
  g.add(head);
  const rod = mesh(new THREE.CylinderGeometry(0.05, 0.05, h - 0.4, 8), M.steel);
  rod.position.y = (h - 0.4) / 2;
  g.add(rod);
  const motor = mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), M.yellow);
  motor.position.set(1.4, 0.3, 0);
  g.add(motor);
  return g;
}

/** Cable lying on the ground along points (y taken from the points). */
export function cable(M: ModernMaterials, pts: THREE.Vector3[]): THREE.Mesh {
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 8, 0.025, 5), M.black, false);
}

/** The detonator box with its reel of wire. */
export function detonator(M: ModernMaterials): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), M.yellow);
  b.position.y = 0.125;
  g.add(b);
  const handle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6), M.black);
  handle.position.y = 0.42;
  g.add(handle);
  const reel = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 14).rotateZ(Math.PI / 2), M.black);
  reel.position.set(0.45, 0.18, 0);
  g.add(reel);
  return g;
}
