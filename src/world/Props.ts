import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalUniforms, injectFogUniforms } from '../render/HeightFog';
import { stencilTexture, type PBRSet } from '../render/textures/ProceduralTextures';
import { fbm2, mulberry32 } from '../systems/noise';

export interface PropMaterials {
  wood: THREE.MeshStandardMaterial;
  canvas: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  ribbon: THREE.MeshStandardMaterial;
  rope: THREE.MeshStandardMaterial;
  glassLit: THREE.MeshStandardMaterial;
  fire: THREE.MeshBasicMaterial;
  stencilAldercott: THREE.MeshStandardMaterial;
  stencilDoNotShip: THREE.MeshStandardMaterial;
  stencilCamp: THREE.MeshStandardMaterial;
}

/** Cloth that flutters with the wind; displacement grows with uv.x (distance from the knot). */
function clothMaterial(color: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    injectFogUniforms(s);
    s.uniforms.uTime = globalUniforms.uTime;
    s.uniforms.uWindDir = globalUniforms.uWindDir;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWindDir;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wk = uv.x;
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float ph = uTime * 6.0 + ip.x * 3.1 + ip.z * 1.7 + uv.x * 7.0;
        transformed.y += sin(ph) * 0.05 * wk;
        transformed.z += cos(ph * 0.8) * 0.06 * wk;
        transformed.y -= wk * wk * 0.12;`,
      );
  };
  m.customProgramCacheKey = () => 'cloth';
  return m;
}

export function createPropMaterials(t: { wood: PBRSet; canvas: PBRSet; rust: PBRSet }): PropMaterials {
  const decal = (tex: THREE.Texture) =>
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return {
    wood: new THREE.MeshStandardMaterial({ map: t.wood.map, normalMap: t.wood.normalMap, roughness: 0.88 }),
    canvas: new THREE.MeshStandardMaterial({ map: t.canvas.map, normalMap: t.canvas.normalMap, roughness: 0.95, side: THREE.DoubleSide }),
    rust: new THREE.MeshStandardMaterial({ map: t.rust.map, normalMap: t.rust.normalMap, roughnessMap: t.rust.roughnessMap ?? null, metalness: 0.55, roughness: 1 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2b2d2c, metalness: 0.7, roughness: 0.55 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.85, roughness: 0.38, emissive: 0x1a1006 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xd8ccae, roughness: 0.9, side: THREE.DoubleSide }),
    ribbon: clothMaterial(0x8f2419),
    rope: new THREE.MeshStandardMaterial({ color: 0x8d7a58, roughness: 0.95 }),
    glassLit: new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xffa040, emissiveIntensity: 3.2, roughness: 0.3 }),
    fire: new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    stencilAldercott: decal(stencilTexture(['ALDERCOTT', 'EXPEDITION · 1958'], { color: 'rgba(30,26,20,0.85)', font: 'bold 64px Arial, sans-serif' })),
    stencilDoNotShip: decal(stencilTexture(['DO NOT SHIP'], { color: 'rgba(235,232,220,0.85)', font: 'italic 70px "Comic Sans MS", "Chalkboard", cursive', rotate: -0.08, chalk: true })),
    stencilCamp: decal(stencilTexture(['CAMP IV', 'V. 1958'], { color: 'rgba(40,30,20,0.9)', font: 'bold 72px Georgia, serif' })),
  };
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, cast = true): THREE.Mesh {
  const x = new THREE.Mesh(g, m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
}

export function crate(M: PropMaterials, w = 0.9, h = 0.6, d = 0.6, stencil: 'aldercott' | 'dns' | 'both' | 'none' = 'aldercott', open = false): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crate';
  const body = mesh(box(w, h, d), M.wood);
  body.position.y = h / 2;
  g.add(body);
  // Corner battens
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const b = mesh(box(0.05, h + 0.01, 0.05), M.wood);
      b.position.set((sx * (w - 0.04)) / 2, h / 2, (sz * (d - 0.04)) / 2);
      g.add(b);
    }
  if (open) {
    const lid = mesh(box(w, 0.04, d), M.wood);
    lid.position.set(0.05, h + 0.12, -d * 0.45);
    lid.rotation.x = -1.1;
    g.add(lid);
  }
  const addDecal = (mat: THREE.Material, sx: number, sy: number, face: 'front' | 'side', y = h / 2) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat);
    if (face === 'front') p.position.set(0, y, d / 2 + 0.003);
    else {
      p.position.set(w / 2 + 0.003, y, 0);
      p.rotation.y = Math.PI / 2;
    }
    p.renderOrder = 1;
    g.add(p);
  };
  if (stencil === 'aldercott' || stencil === 'both') addDecal(M.stencilAldercott, w * 0.85, h * 0.5, 'front');
  if (stencil === 'dns' || stencil === 'both') addDecal(M.stencilDoNotShip, d * 0.95, h * 0.45, 'side', h * 0.55);
  return g;
}

/** A-frame canvas tent. `collapse` 0..1 sags one end to the ground. */
export function tent(M: PropMaterials, seed: number, collapse = 0, torn = false): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tent';
  const L = 2.6;
  const W = 2.0;
  const H = 1.5;
  const rnd = mulberry32(seed);
  const makeSide = (s: number) => {
    const geo = new THREE.PlaneGeometry(L, Math.hypot(W / 2, H), 16, 8);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const u = v.x / L + 0.5; // along length
      const k = v.y / Math.hypot(W / 2, H) + 0.5; // 0 bottom .. 1 ridge
      let x = v.x;
      let y = k * H;
      let z = s * (1 - k) * (W / 2);
      // Sag between poles + collapse
      y -= Math.sin(u * Math.PI) * 0.12 * k;
      const col = collapse * Math.pow(u, 1.5);
      y *= 1 - col * 0.85;
      z *= 1 + col * 0.4;
      y += fbm2(x * 2 + seed, k * 3) * 0.04;
      if (torn && s > 0 && u > 0.55 && u < 0.8 && k > 0.3 && k < 0.7) y -= 0.25 * Math.sin((u - 0.55) * 12) * Math.sin((k - 0.3) * 7.8);
      p.setXYZ(i, x, Math.max(0.02, y), z);
    }
    geo.computeVertexNormals();
    return mesh(geo, M.canvas);
  };
  g.add(makeSide(1), makeSide(-1));
  // Poles
  const poleH = H * (1 - collapse * 0.8);
  const p1 = mesh(new THREE.CylinderGeometry(0.025, 0.03, H, 6), M.wood);
  p1.position.set(-L / 2 + 0.05, H / 2, 0);
  g.add(p1);
  const p2 = mesh(new THREE.CylinderGeometry(0.025, 0.03, poleH, 6), M.wood);
  p2.position.set(L / 2 - 0.05, poleH / 2, 0);
  p2.rotation.z = collapse * 0.9;
  g.add(p2);
  // Guy ropes
  for (const [x, s] of [
    [-L / 2, 1],
    [-L / 2, -1],
    [L / 2, 1],
    [L / 2, -1],
  ] as const) {
    const top = new THREE.Vector3(x, x < 0 ? H : poleH, 0);
    const bot = new THREE.Vector3(x * 1.35, 0, s * 1.6);
    const r = mesh(new THREE.CylinderGeometry(0.006, 0.006, top.distanceTo(bot), 3), M.rope, false);
    r.position.copy(top).add(bot).multiplyScalar(0.5);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bot.clone().sub(top).normalize());
    g.add(r);
  }
  void rnd;
  return g;
}

export function cot(M: PropMaterials, overturned = true): THREE.Group {
  const g = new THREE.Group();
  const frameGeo = mergeGeometries([
    box(1.9, 0.04, 0.04).translate(0, 0.4, 0.33),
    box(1.9, 0.04, 0.04).translate(0, 0.4, -0.33),
    ...[-0.85, 0, 0.85].map((x) => box(0.04, 0.4, 0.7).translate(x, 0.2, 0)),
  ])!;
  g.add(mesh(frameGeo, M.wood));
  const bed = mesh(box(1.85, 0.02, 0.66), M.canvas);
  bed.position.y = 0.4;
  g.add(bed);
  if (overturned) {
    g.rotation.x = Math.PI * 0.92;
    g.position.y = 0.42;
  }
  return g;
}

export function stove(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(box(0.45, 0.28, 0.35), M.rust);
  b.position.y = 0.14;
  g.add(b);
  const pot = mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.16, 14, 1), M.darkMetal);
  pot.position.set(-0.08, 0.36, 0);
  g.add(pot);
  const kettle = mesh(new THREE.SphereGeometry(0.09, 12, 8), M.rust);
  kettle.scale.y = 0.8;
  kettle.position.set(0.14, 0.34, 0.02);
  g.add(kettle);
  // Tin plates set for dinner
  for (let i = 0; i < 3; i++) {
    const p = mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.015, 14), M.darkMetal);
    p.position.set(0.6 + i * 0.28, 0.01, 0.3 - i * 0.05);
    g.add(p);
  }
  return g;
}

export function table(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(crate(M, 0.7, 0.7, 0.5, 'none'));
  const top = mesh(box(1.6, 0.05, 0.8), M.wood);
  top.position.y = 0.73;
  g.add(top);
  const c2 = crate(M, 0.6, 0.7, 0.5, 'none');
  c2.position.x = 0.55;
  g.add(c2);
  return g;
}

export function radioMast(M: PropMaterials, height = 7.5): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.18;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(new THREE.CylinderGeometry(0.02, 0.025, height, 5).translate(Math.cos(a) * r, height / 2, Math.sin(a) * r));
  }
  for (let y = 0.6; y < height; y += 0.9)
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2;
      const a1 = ((i + 1) / 3) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r);
      const p1 = new THREE.Vector3(Math.cos(a1) * r, y + 0.45, Math.sin(a1) * r);
      const c = new THREE.CylinderGeometry(0.008, 0.008, p0.distanceTo(p1), 3);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()));
      c.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      parts.push(c);
    }
  parts.push(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 3).translate(0, height, 0));
  const m = mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!, M.rust);
  g.add(m);
  g.rotation.z = 0.12;
  g.rotation.x = -0.05;
  return g;
}

/** Surveyor's theodolite on a tripod; `aim` is the world point it's sighted on. */
export function theodolite(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.45, 5), M.wood);
    leg.position.set(Math.cos(a) * 0.28, 0.68, Math.sin(a) * 0.28);
    leg.rotation.set(Math.sin(a) * 0.38, 0, -Math.cos(a) * 0.38);
    g.add(leg);
  }
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 1.38;
  const base = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.08, 12), M.bronze);
  head.add(base);
  const scope = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 12), M.bronze);
  scope.rotation.x = Math.PI / 2;
  scope.position.y = 0.12;
  head.add(scope);
  const lens = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12), M.darkMetal);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.12, 0.17);
  head.add(lens);
  g.add(head);
  return g;
}

export function lantern(M: PropMaterials, lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 10), M.rust);
  const top = mesh(new THREE.ConeGeometry(0.09, 0.08, 10), M.rust);
  top.position.y = 0.26;
  const glass = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10), lit ? M.glassLit : new THREE.MeshStandardMaterial({ color: 0x556055, transparent: true, opacity: 0.45, roughness: 0.2 }), false);
  glass.position.y = 0.13;
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 12, Math.PI), M.darkMetal, false);
  handle.position.y = 0.3;
  g.add(base, top, glass, handle);
  return g;
}

export function campfire(M: PropMaterials, stones: THREE.Material, lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(5);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = mesh(new THREE.DodecahedronGeometry(0.13 + rnd() * 0.06, 0), stones);
    s.position.set(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(s);
  }
  for (let i = 0; i < 4; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), M.wood);
    log.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI * 2, 0);
    log.position.y = 0.12;
    g.add(log);
  }
  if (lit) {
    const flames = new THREE.Group();
    flames.name = 'flames';
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.02, 0.55 - i * 0.05, 8, 1, true), M.fire);
      f.position.set((rnd() - 0.5) * 0.12, 0.3, (rnd() - 0.5) * 0.12);
      f.userData.phase = rnd() * 6;
      flames.add(f);
    }
    g.add(flames);
  }
  return g;
}

export function canoe(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.42 + 0.001, (t - 0.5) * 4.6));
  }
  const hull = new THREE.LatheGeometry(pts, 16, Math.PI * 0.5, Math.PI);
  hull.rotateZ(Math.PI / 2);
  hull.scale(1, 0.75, 1);
  const m = mesh(hull, new THREE.MeshStandardMaterial({ color: 0x6a3f25, roughness: 0.7, side: THREE.DoubleSide }));
  m.rotation.y = Math.PI / 2;
  g.add(m);
  for (const x of [-1, 0.2, 1.2]) {
    const seat = mesh(box(0.08, 0.03, 0.7), M.wood);
    seat.position.set(0, 0.02, x);
    g.add(seat);
  }
  return g;
}

export function tinBox(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(box(0.28, 0.1, 0.2), M.rust);
  b.position.y = 0.05;
  const lid = mesh(box(0.29, 0.02, 0.21), M.rust);
  lid.position.set(0, 0.13, -0.08);
  lid.rotation.x = -0.7;
  g.add(b, lid);
  return g;
}

export function paperPage(M: PropMaterials): THREE.Mesh {
  const g = new THREE.PlaneGeometry(0.21, 0.28, 3, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 12) * 0.006);
  g.rotateX(-Math.PI / 2);
  const m = mesh(g, M.paper);
  m.position.y = 0.01;
  return m;
}

export function sunToken(M: PropMaterials): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24), M.bronze);
  m.position.y = 0.01;
  return m;
}

/** Rusted piton with a faded red ribbon tied through the eye. Ribbon uv.x = along length. */
export function pitonRibbon(M: PropMaterials, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const pin = mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.16, 5), M.rust, false);
  pin.rotation.x = Math.PI / 2;
  pin.position.z = 0.05;
  const eye = mesh(new THREE.TorusGeometry(0.022, 0.006, 4, 10), M.rust, false);
  eye.position.z = 0.13;
  g.add(pin, eye);
  const len = 0.35 + rnd() * 0.25;
  const rg = new THREE.PlaneGeometry(len, 0.045, 8, 1);
  rg.translate(len / 2, 0, 0);
  const r = mesh(rg, M.ribbon, false);
  r.position.set(0, -0.01, 0.13);
  r.rotation.set(0, -0.3 + rnd() * 0.6, -1.2 - rnd() * 0.3);
  g.add(r);
  return g;
}

export function signBoard(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const post = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6), M.wood);
  post.position.y = 0.75;
  const board = mesh(box(0.8, 0.4, 0.04), M.wood);
  board.position.set(0, 1.35, 0);
  board.rotation.z = -0.06;
  const d = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.36), M.stencilCamp);
  d.position.set(0, 1.35, 0.025);
  d.rotation.z = -0.06;
  g.add(post, board, d);
  return g;
}

export function rucksack(M: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(new THREE.CapsuleGeometry(0.18, 0.25, 4, 10), new THREE.MeshStandardMaterial({ color: 0x5b5236, roughness: 0.95 }));
  b.scale.set(1, 1, 0.7);
  b.rotation.z = 1.3;
  b.position.y = 0.16;
  const flap = mesh(box(0.3, 0.02, 0.26), M.canvas);
  flap.position.set(0.25, 0.3, 0);
  flap.rotation.z = 0.5;
  g.add(b, flap);
  return g;
}
