// Generates TEMPORARY, fully original, rigged + animated GLB characters for The Final Expedition.
//   node scripts/gen-temp-character.mjs
// Output: public/assets/models/temp/ines_temp.glb, toby_temp.glb
// These are placeholder assets (see ASSET_LICENSES.md). Replace by dropping in new GLBs and
// updating src/assets/characters.json clip-name maps — no gameplay code changes needed.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- Node polyfill for GLTFExporter's FileReader usage ----
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64');
      this.onloadend?.();
    });
  }
};

const D = THREE.MathUtils.degToRad;

// ======================================================================= skeleton
function buildSkeleton(s) {
  // s = uniform scale for body proportions. Positions are in bind pose (identity rotations).
  const def = [
    ['Hips', null, [0, 0.96, 0]],
    ['Spine', 'Hips', [0, 0.1, 0]],
    ['Chest', 'Spine', [0, 0.16, 0]],
    ['Neck', 'Chest', [0, 0.22, 0]],
    ['Head', 'Neck', [0, 0.09, 0]],
    ['UpperArmL', 'Chest', [0.19, 0.18, 0]],
    ['LowerArmL', 'UpperArmL', [0, -0.28, 0]],
    ['HandL', 'LowerArmL', [0, -0.25, 0]],
    ['UpperArmR', 'Chest', [-0.19, 0.18, 0]],
    ['LowerArmR', 'UpperArmR', [0, -0.28, 0]],
    ['HandR', 'LowerArmR', [0, -0.25, 0]],
    ['UpperLegL', 'Hips', [0.095, -0.05, 0]],
    ['LowerLegL', 'UpperLegL', [0, -0.42, 0]],
    ['FootL', 'LowerLegL', [0, -0.41, 0]],
    ['UpperLegR', 'Hips', [-0.095, -0.05, 0]],
    ['LowerLegR', 'UpperLegR', [0, -0.42, 0]],
    ['FootR', 'LowerLegR', [0, -0.41, 0]],
  ];
  const bones = {};
  const list = [];
  for (const [name, parent, p] of def) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(p[0] * s, p[1] * s, p[2] * s);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    list.push(b);
  }
  return { bones, list, root: bones.Hips };
}

// ======================================================================= geometry helpers
const parts = [];
function hex(c) {
  const col = new THREE.Color(c);
  col.convertSRGBToLinear();
  return col;
}
/** colorFn: (pos) => THREE.Color ; weightFn: (pos) => {bone: w} */
function addPart(geo, colorFn, weightFn) {
  geo = geo.index ? geo : geo;
  geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  parts.push({ geo, colorFn: typeof colorFn === 'function' ? colorFn : () => colorFn, weightFn });
}
const rigid = (bone) => () => ({ [bone]: 1 });
/** knots: [[bone, topY], ...] descending by topY. Bone i owns (knots[i+1].y, knots[i].y]. */
function chainY(knots, blend = 0.05, scale = 1) {
  const k = knots.map(([b, y]) => [b, y * scale]);
  const bl = blend * scale;
  return (p) => {
    const y = p.y;
    let i = 0;
    while (i < k.length - 1 && y <= k[i + 1][1]) i++;
    const res = { [k[i][0]]: 1 };
    const add = (b, w) => (res[b] = (res[b] ?? 0) + w);
    if (i > 0) {
      const d = k[i][1] - y;
      if (d < bl) {
        const w = 0.5 * (1 - d / bl);
        res[k[i][0]] -= w;
        add(k[i - 1][0], w);
      }
    }
    if (i < k.length - 1) {
      const d = y - k[i + 1][1];
      if (d < bl) {
        const w = 0.5 * (1 - d / bl);
        res[k[i][0]] -= w;
        add(k[i + 1][0], w);
      }
    }
    return res;
  };
}
function lathe(profile, segs = 16) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}
function place(geo, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Box with rounded edges (bevel radius r), for bags/pads. */
function roundedBox(w, h, d, r, segs = 4) {
  const g = new THREE.BoxGeometry(w, h, d, segs, segs, segs);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ix = Math.max(-w / 2 + r, Math.min(w / 2 - r, v.x));
    const iy = Math.max(-h / 2 + r, Math.min(h / 2 - r, v.y));
    const iz = Math.max(-d / 2 + r, Math.min(d / 2 - r, v.z));
    n.set(v.x - ix, v.y - iy, v.z - iz);
    if (n.lengthSq() > 1e-10) n.normalize().multiplyScalar(r);
    p.setXYZ(i, ix + n.x, iy + n.y, iz + n.z);
  }
  g.computeVertexNormals();
  return g;
}
/** Small deterministic wobble on a geometry (hair volume, cloth folds). */
function wobble(g, amp, freq, seed = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amp * (Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + seed * 2) + 0.5 * Math.sin(z * freq * 2.1 + y * freq));
    p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.5), z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ======================================================================= body builder
function buildBody(look, s) {
  parts.length = 0;
  const torsoChain = chainY([['Head', 9], ['Neck', 1.54], ['Chest', 1.45], ['Spine', 1.2], ['Hips', 1.03]], 0.07, s);
  const armChain = (side) => chainY([['Chest', 9], [`UpperArm${side}`, 1.42], [`LowerArm${side}`, 1.12], [`Hand${side}`, 0.88]], 0.06, s);
  const legChain = (side) => chainY([['Hips', 9], [`UpperLeg${side}`, 0.92], [`LowerLeg${side}`, 0.49], [`Foot${side}`, 0.09]], 0.06, s);

  // --- Torso (jacket over base layer), elliptical cross-section.
  const torso = lathe(
    [
      [0.0, 0.84], [0.15, 0.86], [0.168, 0.92], [0.165, 0.99], [0.152, 1.06], [0.158, 1.14],
      [0.182, 1.24], [0.2, 1.32], [0.202, 1.38], [0.178, 1.43], [0.1, 1.47], [0.05, 1.49], [0.0, 1.495],
    ].map(([r, y]) => [r * s * look.girth, y * s]),
    20,
  );
  place(torso, { sz: 0.66 });
  addPart(torso, (p) => {
    const y = p.y / s;
    if (y < 0.985) return look.pants;
    if (y < 1.02) return look.belt;
    if (y > 1.43 && Math.abs(p.x) < 0.07 * s && p.z > 0) return look.base; // collar opening
    return look.jacket;
  }, torsoChain);
  // Collar
  const collar = new THREE.TorusGeometry(0.075 * s, 0.022 * s, 8, 18);
  place(collar, { y: 1.455 * s, rx: Math.PI / 2, sz: 1, sx: 1.05 });
  addPart(collar, look.jacketDark, torsoChain);
  // Chest pockets with flaps, front placket and jacket hem
  for (const side of [-1, 1]) {
    const pk = roundedBox(0.075 * s, 0.085 * s, 0.026 * s, 0.008 * s, 2);
    place(pk, { x: side * 0.085 * s, y: 1.29 * s, z: 0.122 * s * look.girth });
    addPart(pk, look.jacketDark, torsoChain);
    const flap = roundedBox(0.08 * s, 0.022 * s, 0.03 * s, 0.006 * s, 2);
    place(flap, { x: side * 0.085 * s, y: 1.335 * s, z: 0.126 * s * look.girth });
    addPart(flap, look.jacket, torsoChain);
  }
  const placket = new THREE.BoxGeometry(0.018 * s, 0.4 * s, 0.012 * s);
  place(placket, { y: 1.23 * s, z: 0.113 * s * look.girth });
  addPart(placket, look.jacketDark, torsoChain);
  const hem = new THREE.TorusGeometry(0.16 * s * look.girth, 0.012 * s, 6, 26);
  place(hem, { y: 1.035 * s, rx: Math.PI / 2, sy: 0.68 });
  addPart(hem, look.jacketDark, torsoChain);
  // Neck
  const neck = new THREE.CylinderGeometry(0.042 * s, 0.05 * s, 0.14 * s, 12, 4);
  place(neck, { y: 1.5 * s });
  addPart(neck, look.skin, torsoChain);

  // --- Head: skull, jaw/chin, cheekbones, nose, eyes (whites + iris), brows, lips, ears
  const H = rigid('Head');
  const head = new THREE.SphereGeometry(0.092 * s, 20, 14);
  place(head, { y: 1.632 * s, z: -0.004 * s, sy: 1.14, sz: 1.08 });
  addPart(head, look.skin, H);
  const jaw = new THREE.SphereGeometry(0.066 * s, 16, 12);
  place(jaw, { y: 1.573 * s, z: 0.02 * s, sx: 1.02, sy: 0.82, sz: 1.08 });
  addPart(jaw, look.skin, H);
  const chin = new THREE.SphereGeometry(0.026 * s, 10, 8);
  place(chin, { y: 1.543 * s, z: 0.066 * s, sx: 1.2, sy: 0.9 });
  addPart(chin, look.skin, H);
  for (const side of [-1, 1]) {
    const cheek = new THREE.SphereGeometry(0.03 * s, 10, 8);
    place(cheek, { x: side * 0.046 * s, y: 1.61 * s, z: 0.06 * s, sx: 1.1, sy: 0.8, sz: 0.8 });
    addPart(cheek, look.skin, H);
  }
  const nose = new THREE.SphereGeometry(0.016 * s, 10, 8);
  place(nose, { y: 1.617 * s, z: 0.094 * s, sx: 0.8, sy: 1.5, sz: 1.0 });
  addPart(nose, look.skinDark, H);
  const noseTip = new THREE.SphereGeometry(0.012 * s, 8, 6);
  place(noseTip, { y: 1.601 * s, z: 0.104 * s });
  addPart(noseTip, look.skin, H);
  const lips = new THREE.SphereGeometry(0.021 * s, 10, 6);
  place(lips, { y: 1.573 * s, z: 0.086 * s, sx: 1.25, sy: 0.38, sz: 0.55 });
  addPart(lips, look.lips ?? look.skinDark, H);
  const browRidge = new THREE.SphereGeometry(0.07 * s, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.35);
  place(browRidge, { y: 1.62 * s, z: 0.035 * s, rx: Math.PI / 2 - 0.2, sx: 1.05, sz: 0.6 });
  addPart(browRidge, look.skin, H);
  for (const side of [-1, 1]) {
    const white = new THREE.SphereGeometry(0.0125 * s, 10, 8);
    place(white, { x: side * 0.033 * s, y: 1.638 * s, z: 0.08 * s, sy: 0.8 });
    addPart(white, hex(0xe6ddd2), H);
    const iris = new THREE.SphereGeometry(0.0068 * s, 8, 6);
    place(iris, { x: side * 0.033 * s, y: 1.638 * s, z: 0.0905 * s });
    addPart(iris, look.eyes ?? hex(0x2a1a10), H);
    const lid = new THREE.SphereGeometry(0.0135 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45);
    place(lid, { x: side * 0.033 * s, y: 1.64 * s, z: 0.081 * s, rx: 0.25 });
    addPart(lid, look.skinDark, H);
    const brow = roundedBox(0.038 * s, 0.009 * s, 0.012 * s, 0.004 * s, 2);
    place(brow, { x: side * 0.035 * s, y: 1.662 * s, z: 0.088 * s, rz: side * -0.14 });
    addPart(brow, look.brow ?? look.hair, H);
    const ear = new THREE.SphereGeometry(0.02 * s, 8, 6);
    place(ear, { x: side * 0.09 * s, y: 1.625 * s, sz: 0.65, sx: 0.45, sy: 1.3 });
    addPart(ear, look.skinDark, H);
  }
  look.headExtras(s, addPart, place, rigid);

  // --- Arms
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const arm = lathe(
      [
        [0.0, 1.445], [0.04, 1.44], [0.056, 1.415], [0.056, 1.36], [0.052, 1.26], [0.046, 1.16],
        [0.043, 1.1], [0.041, 1.02], [0.034, 0.93], [0.03, 0.9], [0.0, 0.895],
      ].map(([r, y]) => [r * s * look.girth, y * s]),
      12,
    );
    place(arm, { x: sx * 0.19 * s });
    addPart(arm, (p) => (p.y / s > look.sleeveEnd ? look.jacket : look.skin), armChain(side));
    if (look.rolledSleeves) {
      const roll = new THREE.TorusGeometry(0.047 * s * look.girth, 0.016 * s, 8, 14);
      place(roll, { x: sx * 0.19 * s, y: (look.sleeveEnd + 0.01) * s, rx: Math.PI / 2 });
      addPart(roll, look.jacketDark, armChain(side));
    }
    // Hand: palm + 4 fingers + thumb (palm faces the thigh)
    const HR = rigid(`Hand${side}`);
    const palm = roundedBox(0.026 * s, 0.07 * s, 0.05 * s, 0.009 * s, 3);
    place(palm, { x: sx * 0.192 * s, y: 0.858 * s });
    addPart(palm, look.skin, HR);
    for (let f = 0; f < 4; f++) {
      const len = [0.036, 0.042, 0.04, 0.032][f] * s;
      const fin = new THREE.CapsuleGeometry(0.0072 * s, len, 3, 6);
      place(fin, { x: sx * 0.196 * s, y: 0.822 * s - len / 2, z: (0.017 - f * 0.0115) * s, rx: 0.08 * (f - 1.5), rz: sx * 0.12 });
      addPart(fin, look.skin, HR);
    }
    const thumb = new THREE.CapsuleGeometry(0.0085 * s, 0.03 * s, 3, 6);
    place(thumb, { x: sx * 0.182 * s, y: 0.848 * s, z: 0.03 * s, rx: 0.55, rz: -sx * 0.3 });
    addPart(thumb, look.skin, HR);
    if (look.gloves) {
      const cuff = new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.03 * s, 10);
      place(cuff, { x: sx * 0.192 * s, y: 0.9 * s });
      addPart(cuff, look.gloves, HR);
    }
  }

  // --- Legs
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const leg = lathe(
      [
        [0.0, 1.0], [0.07, 0.99], [0.092, 0.93], [0.086, 0.8], [0.074, 0.62], [0.064, 0.52],
        [0.062, 0.46], [0.065, 0.36], [0.058, 0.24], [0.056, 0.18], [0.0, 0.17],
      ].map(([r, y]) => [r * s * look.girth, y * s]),
      12,
    );
    place(leg, { x: sx * 0.095 * s });
    addPart(leg, look.pants, legChain(side));
    // Cargo pocket
    const pk = new THREE.BoxGeometry(0.03 * s, 0.1 * s, 0.08 * s);
    place(pk, { x: sx * 0.18 * s, y: 0.7 * s });
    addPart(pk, look.pantsDark, legChain(side));
    // Knee patch
    const knee = roundedBox(0.09 * s, 0.1 * s, 0.03 * s, 0.01 * s, 2);
    place(knee, { x: sx * 0.095 * s, y: 0.5 * s, z: 0.058 * s });
    addPart(knee, look.pantsDark, legChain(side));
    // Boot: shaft + tongue + laces + foot
    const tongue = roundedBox(0.045 * s, 0.13 * s, 0.02 * s, 0.006 * s, 2);
    place(tongue, { x: sx * 0.095 * s, y: 0.15 * s, z: 0.056 * s });
    addPart(tongue, look.bootsLight ?? look.boots, legChain(side));
    for (let k = 0; k < 4; k++) {
      const lace = new THREE.BoxGeometry(0.05 * s, 0.005 * s, 0.006 * s);
      place(lace, { x: sx * 0.095 * s, y: (0.1 + k * 0.035) * s, z: 0.068 * s, rz: k % 2 ? 0.3 : -0.3 });
      addPart(lace, hex(0xc8b89a), legChain(side));
    }
    const shaft = new THREE.CylinderGeometry(0.058 * s, 0.056 * s, 0.17 * s, 12, 3);
    place(shaft, { x: sx * 0.095 * s, y: 0.13 * s });
    addPart(shaft, look.boots, legChain(side));
    const foot = new THREE.CapsuleGeometry(0.048 * s, 0.13 * s, 4, 10);
    place(foot, { x: sx * 0.095 * s, y: 0.045 * s, z: 0.05 * s, rx: Math.PI / 2, sx: 1.05, sz: 0.85 });
    addPart(foot, look.boots, rigid(`Foot${side}`));
    const sole = new THREE.BoxGeometry(0.1 * s, 0.022 * s, 0.26 * s);
    place(sole, { x: sx * 0.095 * s, y: 0.011 * s, z: 0.05 * s });
    addPart(sole, look.sole, rigid(`Foot${side}`));
  }
  look.bodyExtras(s, addPart, place, rigid, torsoChain, legChain);
}

// ======================================================================= merge + skin
function buildSkinnedMesh(skel) {
  const boneIndex = Object.fromEntries(skel.list.map((b, i) => [b.name, i]));
  const geos = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo : part.geo;
    const pos = g.attributes.position;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const nrm = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      const c = part.colorFn(p);
      // Baked lighting cue: top-facing surfaces a touch lighter, undersides darker (fake AO),
      // plus a subtle per-vertex variation so large panels don't read flat.
      const ny = nrm ? nrm.getY(i) : 0;
      const ao = 0.8 + 0.26 * (ny * 0.5 + 0.5);
      const varn = 1 + 0.035 * Math.sin(p.x * 91 + p.y * 57 + p.z * 73);
      const f = ao * varn;
      colors[i * 3] = c.r * f;
      colors[i * 3 + 1] = c.g * f;
      colors[i * 3 + 2] = c.b * f;
      const w = Object.entries(part.weightFn(p))
        .filter(([, v]) => v > 1e-4)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const total = w.reduce((s, [, v]) => s + v, 0) || 1;
      w.forEach(([b, v], k) => {
        if (boneIndex[b] === undefined) throw new Error('Unknown bone ' + b);
        si[i * 4 + k] = boneIndex[b];
        sw[i * 4 + k] = v / total;
      });
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeGeometries(geos, false);
  merged.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, name: 'body' });
  const mesh = new THREE.SkinnedMesh(merged, mat);
  mesh.name = 'Body';
  return mesh;
}

// ======================================================================= animation authoring
const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'UpperArmL', 'LowerArmL', 'HandL', 'UpperArmR', 'LowerArmR', 'HandR', 'UpperLegL', 'LowerLegL', 'FootL', 'UpperLegR', 'LowerLegR', 'FootR'];
const BASE = { UpperArmL: [0, 0, 7], UpperArmR: [0, 0, -7], LowerArmL: [-8, 0, 0], LowerArmR: [-8, 0, 0] };

function sampleClip(name, duration, poseFn, skel, s, fps = 30) {
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = [];
  const rot = Object.fromEntries(BONES.map((b) => [b, []]));
  const hipsPos = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const rest = skel.bones.Hips.position;
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * duration;
    times.push(t);
    const pose = poseFn(t / duration, t);
    for (const b of BONES) {
      const base = BASE[b] ?? [0, 0, 0];
      const r = pose[b] ?? [0, 0, 0];
      e.set(D(base[0] + r[0]), D(base[1] + r[1]), D(base[2] + r[2]), 'XYZ');
      q.setFromEuler(e);
      rot[b].push(q.x, q.y, q.z, q.w);
    }
    const hp = pose.hipsPos ?? [0, 0, 0];
    hipsPos.push(rest.x + hp[0] * s, rest.y + hp[1] * s, rest.z + hp[2] * s);
  }
  // Ensure quaternion continuity (avoid long-way slerps).
  for (const b of BONES) {
    const a = rot[b];
    for (let i = 4; i < a.length; i += 4) {
      const dot = a[i] * a[i - 4] + a[i + 1] * a[i - 3] + a[i + 2] * a[i - 2] + a[i + 3] * a[i - 1];
      if (dot < 0) for (let k = 0; k < 4; k++) a[i + k] = -a[i + k];
    }
  }
  const tracks = BONES.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, rot[b]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos));
  return new THREE.AnimationClip(name, duration, tracks);
}

const TAU = Math.PI * 2;
const pos = (x) => Math.max(0, x);
const sm = (t) => t * t * (3 - 2 * t);

/** Keyframed pose function with smooth easing between keys. keys: [[t01, pose], ...] */
function keys(list) {
  return (u) => {
    let i = 0;
    while (i < list.length - 2 && u > list[i + 1][0]) i++;
    const [t0, a] = list[i];
    const [t1, b] = list[i + 1];
    const k = sm(Math.min(1, Math.max(0, (u - t0) / Math.max(1e-6, t1 - t0))));
    const out = {};
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const n of names) {
      const va = a[n] ?? [0, 0, 0];
      const vb = b[n] ?? [0, 0, 0];
      out[n] = [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k];
    }
    return out;
  };
}

function gait({ thigh, kneeSwing, kneeStance, foot, arm, elbow, elbowSwing, bob, lean, twist, drop = 0, armOut = 0 }) {
  return (u) => {
    const p = u * TAU;
    const P = {};
    for (const [side, ph] of [['L', 0], ['R', Math.PI]]) {
      const q = p + ph;
      const s = Math.sin(q);
      const c = Math.cos(q);
      P[`UpperLeg${side}`] = [-thigh * s, 0, 0];
      P[`LowerLeg${side}`] = [kneeStance + kneeSwing * Math.pow(pos(c), 1.6), 0, 0];
      P[`Foot${side}`] = [-foot * 0.7 * pos(s) + foot * Math.pow(pos(-s), 2) * pos(-c) * 1.4 - 4, 0, 0];
      const armSide = side === 'L' ? 1 : -1;
      P[`UpperArm${side}`] = [arm * s, 0, armSide * armOut];
      P[`LowerArm${side}`] = [-(elbow + elbowSwing * pos(-s)), 0, 0];
    }
    const s2 = Math.cos(2 * p);
    P.Hips = [lean * 0.3, twist * Math.sin(p), 2 * Math.sin(p)];
    P.Spine = [lean * 0.4, -twist * 0.6 * Math.sin(p), 0];
    P.Chest = [lean * 0.3 - 2 * s2, -twist * 0.6 * Math.sin(p), 0];
    P.Neck = [-lean * 0.4, twist * 0.3 * Math.sin(p), 0];
    P.Head = [-lean * 0.3 + 1.5 * s2, 0, 0];
    P.hipsPos = [0, bob * s2 - drop, 0];
    return P;
  };
}

function makeClips(skel, s) {
  const C = [];
  const add = (name, dur, fn) => C.push(sampleClip(name, dur, fn, skel, s));

  add('idle', 3.6, (u) => {
    const p = u * TAU;
    const br = Math.sin(p * 2);
    return {
      Hips: [0, 2 * Math.sin(p), 1.2 * Math.sin(p)],
      Spine: [1 + br * 0.6, 0, -0.8 * Math.sin(p)],
      Chest: [br * 1.4, 0, 0],
      Neck: [-1, 3 * Math.sin(p + 1), 0],
      Head: [2 + br * 0.5, 4 * Math.sin(p + 0.6), 0],
      UpperArmL: [2 + br, 0, 1 + br * 0.5],
      UpperArmR: [2 + br, 0, -1 - br * 0.5],
      LowerArmL: [-4, 0, 0],
      LowerArmR: [-6, 0, 0],
      UpperLegL: [-2, 0, 1.5 + Math.sin(p)],
      UpperLegR: [2, 3, -1.5 + Math.sin(p)],
      LowerLegL: [3, 0, 0],
      LowerLegR: [6, 0, 0],
      FootL: [-1, 0, 0],
      FootR: [-4, 0, 0],
      hipsPos: [0.012 * Math.sin(p), -0.006 + 0.003 * br, 0],
    };
  });
  add('look_around', 5.0, (u) => {
    const p = u * TAU;
    const look = Math.sin(p) * 28;
    return {
      Hips: [0, 3 * Math.sin(p), 1.5],
      Spine: [2, look * 0.15, 0],
      Chest: [Math.sin(p * 4) * 1.2, look * 0.2, 0],
      Neck: [-2, look * 0.3, 0],
      Head: [-3 + 4 * Math.sin(p * 2), look * 0.4, 0],
      UpperArmL: [4, 0, 2],
      UpperArmR: [-8, 0, -18],
      LowerArmR: [-80, 0, 0],
      LowerArmL: [-10, 0, 0],
      UpperLegL: [-3, 0, 3],
      UpperLegR: [3, 4, -2],
      LowerLegL: [4, 0, 0],
      LowerLegR: [8, 0, 0],
      hipsPos: [0.015, -0.01, 0],
    };
  });
  add('walk', 1.05, gait({ thigh: 24, kneeSwing: 48, kneeStance: 6, foot: 16, arm: 16, elbow: 12, elbowSwing: 14, bob: 0.018, lean: 3, twist: 6 }));
  add('run', 0.72, gait({ thigh: 42, kneeSwing: 88, kneeStance: 14, foot: 24, arm: 32, elbow: 72, elbowSwing: 18, bob: 0.045, lean: 11, twist: 9, drop: 0.03, armOut: 4 }));
  add('sprint', 0.6, gait({ thigh: 55, kneeSwing: 110, kneeStance: 16, foot: 30, arm: 48, elbow: 88, elbowSwing: 10, bob: 0.06, lean: 18, twist: 10, drop: 0.05, armOut: 3 }));
  add('jump', 0.55, keys([
    [0, { UpperLegL: [-20, 0, 0], LowerLegL: [30, 0, 0], UpperLegR: [-10, 0, 0], LowerLegR: [20, 0, 0], Spine: [8, 0, 0], UpperArmL: [20, 0, 10], UpperArmR: [20, 0, -10], hipsPos: [0, -0.05, 0] }],
    [0.3, { UpperLegL: [-55, 0, 0], LowerLegL: [80, 0, 0], FootL: [-10, 0, 0], UpperLegR: [-15, 0, 0], LowerLegR: [45, 0, 0], FootR: [20, 0, 0], Spine: [4, 0, 0], UpperArmL: [-70, 0, 25], UpperArmR: [-40, 0, -30], LowerArmL: [-40, 0, 0], LowerArmR: [-50, 0, 0], Head: [-6, 0, 0], hipsPos: [0, 0.02, 0] }],
    [1, { UpperLegL: [-45, 0, 0], LowerLegL: [65, 0, 0], FootL: [-5, 0, 0], UpperLegR: [-20, 0, 0], LowerLegR: [50, 0, 0], FootR: [10, 0, 0], Spine: [6, 0, 0], UpperArmL: [-50, 0, 35], UpperArmR: [-30, 0, -40], LowerArmL: [-45, 0, 0], LowerArmR: [-45, 0, 0], Head: [-4, 0, 0], hipsPos: [0, 0.02, 0] }],
  ]));
  add('fall', 1.2, (u) => {
    const p = u * TAU;
    return {
      Spine: [-4, 0, 0],
      Chest: [-3, 0, 0],
      Head: [8, 0, 0],
      UpperArmL: [-35 + 12 * Math.sin(p), 0, 55 + 10 * Math.sin(p * 2)],
      UpperArmR: [-35 - 12 * Math.sin(p), 0, -55 - 10 * Math.sin(p * 2 + 1)],
      LowerArmL: [-30, 0, 0],
      LowerArmR: [-30, 0, 0],
      UpperLegL: [-30 + 14 * Math.sin(p), 0, 6],
      UpperLegR: [-12 - 14 * Math.sin(p), 0, -6],
      LowerLegL: [45 + 10 * Math.sin(p), 0, 0],
      LowerLegR: [35 - 10 * Math.sin(p), 0, 0],
      FootL: [10, 0, 0],
      FootR: [10, 0, 0],
    };
  });
  add('land', 0.5, keys([
    [0, { UpperLegL: [-50, 0, 4], LowerLegL: [90, 0, 0], FootL: [-40, 0, 0], UpperLegR: [-40, 0, -4], LowerLegR: [80, 0, 0], FootR: [-38, 0, 0], Spine: [22, 0, 0], Chest: [10, 0, 0], Head: [-18, 0, 0], UpperArmL: [-30, 0, 30], UpperArmR: [-30, 0, -30], LowerArmL: [-40, 0, 0], LowerArmR: [-40, 0, 0], hipsPos: [0, -0.24, 0.03] }],
    [0.35, { UpperLegL: [-42, 0, 4], LowerLegL: [76, 0, 0], FootL: [-34, 0, 0], UpperLegR: [-34, 0, -4], LowerLegR: [68, 0, 0], FootR: [-32, 0, 0], Spine: [18, 0, 0], Chest: [8, 0, 0], Head: [-14, 0, 0], UpperArmL: [-20, 0, 20], UpperArmR: [-20, 0, -20], LowerArmL: [-30, 0, 0], LowerArmR: [-30, 0, 0], hipsPos: [0, -0.2, 0.02] }],
    [1, { UpperLegL: [-4, 0, 1], LowerLegL: [6, 0, 0], FootL: [-2, 0, 0], UpperLegR: [0, 0, -1], LowerLegR: [5, 0, 0], FootR: [-2, 0, 0], Spine: [3, 0, 0], hipsPos: [0, -0.01, 0] }],
  ]));
  // Wall climb (wall is in front, +Z). Alternating reach.
  add('climb', 1.3, (u) => {
    const p = u * TAU;
    const s = Math.sin(p);
    return {
      Hips: [-8, 0, 5 * s],
      Spine: [4, 0, -3 * s],
      Chest: [4, 0, -2 * s],
      Head: [-20, 0, 0],
      UpperArmL: [-148 - 22 * s, 0, 18],
      LowerArmL: [-28 - 38 * pos(-s), 0, 0],
      UpperArmR: [-148 + 22 * s, 0, -18],
      LowerArmR: [-28 - 38 * pos(s), 0, 0],
      UpperLegL: [-42 + 30 * s, 0, 14],
      LowerLegL: [78 - 40 * s, 0, 0],
      FootL: [-20, 0, 0],
      UpperLegR: [-42 - 30 * s, 0, -14],
      LowerLegR: [78 + 40 * s, 0, 0],
      FootR: [-20, 0, 0],
      hipsPos: [0, 0.03 * Math.cos(2 * p), -0.06],
    };
  });
  add('hang', 2.4, (u) => {
    const p = u * TAU;
    const sw = Math.sin(p);
    return {
      Hips: [-4 + 3 * sw, 0, 0],
      Spine: [-3, 0, 0],
      Chest: [-6, 0, 0],
      Neck: [-8, 0, 0],
      Head: [-18, 0, 0],
      UpperArmL: [-172, 0, 12],
      UpperArmR: [-172, 0, -12],
      LowerArmL: [-6, 0, 0],
      LowerArmR: [-6, 0, 0],
      UpperLegL: [-14 + 5 * sw, 0, 4],
      UpperLegR: [-4 + 5 * sw, 0, -4],
      LowerLegL: [22, 0, 0],
      LowerLegR: [14, 0, 0],
      FootL: [18, 0, 0],
      FootR: [22, 0, 0],
      hipsPos: [0, 0, -0.02],
    };
  });
  // Shimmy to the character's LEFT (+X). Play with negative timeScale for right.
  add('shimmy', 0.9, (u) => {
    const p = u * TAU;
    const s = Math.sin(p);
    const c = Math.cos(p);
    return {
      Hips: [-4, 0, 6 * s],
      Spine: [-3, 0, -4 * s],
      Chest: [-6, 0, -3 * s],
      Head: [-16, 10, 0],
      UpperArmL: [-168, 0, 20 + 14 * pos(s)],
      UpperArmR: [-168, 0, -8 - 10 * pos(-s)],
      LowerArmL: [-10 - 12 * pos(-s), 0, 0],
      LowerArmR: [-10 - 12 * pos(s), 0, 0],
      UpperLegL: [-14, 0, 8 + 10 * pos(c)],
      UpperLegR: [-8, 0, -4 + 8 * pos(-c)],
      LowerLegL: [24, 0, 0],
      LowerLegR: [18, 0, 0],
      FootL: [18, 0, 0],
      FootR: [20, 0, 0],
      hipsPos: [0, 0.01 * Math.cos(2 * p), -0.02],
    };
  });
  const HANG_POSE = { Chest: [-6, 0, 0], Head: [-18, 0, 0], UpperArmL: [-172, 0, 12], UpperArmR: [-172, 0, -12], LowerArmL: [-6, 0, 0], LowerArmR: [-6, 0, 0], UpperLegL: [-14, 0, 4], UpperLegR: [-4, 0, -4], LowerLegL: [22, 0, 0], LowerLegR: [14, 0, 0], FootL: [18, 0, 0], FootR: [22, 0, 0] };
  add('climb_up', 1.15, keys([
    [0, HANG_POSE],
    [0.35, { Spine: [20, 0, 0], Chest: [14, 0, 0], Head: [-6, 0, 0], UpperArmL: [-70, 0, 30], UpperArmR: [-70, 0, -30], LowerArmL: [-115, 0, 0], LowerArmR: [-115, 0, 0], UpperLegL: [-30, 0, 4], UpperLegR: [-10, 0, -4], LowerLegL: [60, 0, 0], LowerLegR: [40, 0, 0] }],
    [0.62, { Spine: [34, 0, 0], Chest: [14, 0, 0], Head: [-10, 0, 0], UpperArmL: [-10, 0, 25], UpperArmR: [-10, 0, -25], LowerArmL: [-25, 0, 0], LowerArmR: [-25, 0, 0], UpperLegL: [-100, 0, 6], LowerLegL: [115, 0, 0], FootL: [-20, 0, 0], UpperLegR: [-10, 0, -4], LowerLegR: [50, 0, 0], FootR: [30, 0, 0], hipsPos: [0, -0.05, 0] }],
    [0.84, { Spine: [24, 0, 0], Chest: [6, 0, 0], Head: [-6, 0, 0], UpperArmL: [10, 0, 14], UpperArmR: [10, 0, -14], LowerArmL: [-20, 0, 0], LowerArmR: [-20, 0, 0], UpperLegL: [-50, 0, 3], LowerLegL: [60, 0, 0], FootL: [-10, 0, 0], UpperLegR: [-30, 0, -3], LowerLegR: [70, 0, 0], FootR: [-20, 0, 0], hipsPos: [0, -0.12, 0] }],
    [1, { Spine: [3, 0, 0], UpperLegL: [-3, 0, 1], LowerLegL: [5, 0, 0], UpperLegR: [0, 0, -1], LowerLegR: [5, 0, 0], hipsPos: [0, -0.01, 0] }],
  ]));
  // Narrow ledge sidestep, chest to the wall, moving to the character's LEFT (+X).
  add('ledge_step', 1.1, (u) => {
    const p = u * TAU;
    const s = Math.sin(p);
    const c = Math.cos(p);
    return {
      Hips: [-2, 0, 0],
      Spine: [4, 0, 0],
      Chest: [2, 0, 0],
      Head: [0, 38, 0],
      Neck: [0, 12, 0],
      UpperArmL: [-58, 0, 64 + 10 * pos(s)],
      UpperArmR: [-58, 0, -60 + 6 * pos(-s)],
      LowerArmL: [-50, 0, 0],
      LowerArmR: [-50, 0, 0],
      UpperLegL: [-6 - 8 * pos(s), 0, 6 + 14 * pos(s)],
      LowerLegL: [8 + 18 * pos(s), 0, 0],
      UpperLegR: [-6 - 8 * pos(-s), 0, -6 + 8 * pos(-s)],
      LowerLegR: [8 + 18 * pos(-s), 0, 0],
      FootL: [-4, 0, 0],
      FootR: [-4, 0, 0],
      hipsPos: [0.02 * c, -0.03 + 0.01 * Math.cos(2 * p), 0],
    };
  });
  add('ledge_idle', 2.5, (u) => {
    const p = u * TAU;
    return {
      Spine: [4 + Math.sin(p * 2) * 0.8, 0, 0],
      Head: [0, 38 + 6 * Math.sin(p), 0],
      Neck: [0, 12, 0],
      UpperArmL: [-58, 0, 64],
      UpperArmR: [-58, 0, -60],
      LowerArmL: [-50, 0, 0],
      LowerArmR: [-50, 0, 0],
      UpperLegL: [-4, 0, 6],
      UpperLegR: [-4, 0, -6],
      LowerLegL: [8, 0, 0],
      LowerLegR: [8, 0, 0],
      hipsPos: [0, -0.03, 0],
    };
  });
  add('vault', 0.62, keys([
    [0, { Spine: [18, 0, 0], UpperArmL: [-60, 0, 10], LowerArmL: [-20, 0, 0], UpperLegL: [-40, 0, 0], LowerLegL: [50, 0, 0], UpperLegR: [20, 0, 0], LowerLegR: [30, 0, 0] }],
    [0.45, { Spine: [28, 0, -10], Chest: [4, 0, -6], UpperArmL: [-40, 0, 20], LowerArmL: [-8, 0, 0], UpperArmR: [-30, 0, -50], LowerArmR: [-30, 0, 0], UpperLegL: [-85, 0, -14], LowerLegL: [110, 0, 0], UpperLegR: [-75, 0, -20], LowerLegR: [100, 0, 0], FootL: [10, 0, 0], FootR: [10, 0, 0], hipsPos: [0, 0.05, 0] }],
    [1, { Spine: [8, 0, 0], UpperLegL: [-30, 0, 0], LowerLegL: [40, 0, 0], UpperLegR: [10, 0, 0], LowerLegR: [30, 0, 0], UpperArmL: [-10, 0, 10], UpperArmR: [10, 0, -10], hipsPos: [0, -0.04, 0] }],
  ]));
  add('interact', 1.1, keys([
    [0, {}],
    [0.4, { Spine: [16, 8, 0], Chest: [6, 0, 0], Head: [18, 0, 0], UpperArmR: [-62, 0, -6], LowerArmR: [-26, 0, 0], HandR: [-10, 0, 0], UpperLegL: [-10, 0, 0], LowerLegL: [16, 0, 0], UpperLegR: [4, 0, 0], LowerLegR: [10, 0, 0], hipsPos: [0, -0.04, 0] }],
    [0.65, { Spine: [18, 8, 0], Chest: [6, 0, 0], Head: [20, 0, 0], UpperArmR: [-66, 0, -6], LowerArmR: [-20, 0, 0], HandR: [-10, 0, 0], UpperLegL: [-10, 0, 0], LowerLegL: [16, 0, 0], UpperLegR: [4, 0, 0], LowerLegR: [10, 0, 0], hipsPos: [0, -0.05, 0] }],
    [1, {}],
  ]));
  // Two-handed push (rotating a stone drum).
  add('push', 1.25, keys([
    [0, {}],
    [0.3, { Spine: [22, 0, 0], Chest: [8, 0, 0], Head: [-10, 0, 0], UpperArmL: [-78, 0, 8], UpperArmR: [-78, 0, -8], LowerArmL: [-24, 0, 0], LowerArmR: [-24, 0, 0], UpperLegL: [-34, 0, 0], LowerLegL: [30, 0, 0], UpperLegR: [18, 0, 0], LowerLegR: [10, 0, 0], FootR: [20, 0, 0], hipsPos: [0, -0.06, 0] }],
    [0.7, { Spine: [26, -8, 0], Chest: [10, -6, 0], Head: [-12, 0, 0], UpperArmL: [-70, 0, 14], UpperArmR: [-86, 0, -4], LowerArmL: [-30, 0, 0], LowerArmR: [-14, 0, 0], UpperLegL: [-40, 0, 0], LowerLegL: [36, 0, 0], UpperLegR: [24, 0, 0], LowerLegR: [8, 0, 0], FootR: [26, 0, 0], hipsPos: [0, -0.07, 0.03] }],
    [1, {}],
  ]));
  add('sit', 4.0, (u) => {
    const p = u * TAU;
    const g = Math.pow(pos(Math.sin(p)), 3);
    return {
      Spine: [12 + Math.sin(p * 2) * 1, 0, 0],
      Chest: [6, 0, 0],
      Neck: [-8, 6 * Math.sin(p), 0],
      Head: [-6, 8 * Math.sin(p * 0.5), 0],
      UpperLegL: [-86, 0, 8],
      UpperLegR: [-86, 0, -8],
      LowerLegL: [88, 0, 0],
      LowerLegR: [92, 0, 0],
      FootL: [-4, 0, 0],
      FootR: [-4, 0, 0],
      UpperArmL: [-38, 0, 12],
      UpperArmR: [-38 - 40 * g, 0, -12 - 10 * g],
      LowerArmL: [-52, 0, 0],
      LowerArmR: [-52 - 30 * g, 0, 0],
      hipsPos: [0, -0.5, -0.04],
    };
  });
  add('talk', 3.0, (u) => {
    const p = u * TAU;
    const g1 = Math.pow(pos(Math.sin(p)), 2);
    const g2 = Math.pow(pos(Math.sin(p * 2 + 1)), 2);
    return {
      Spine: [2, 4 * Math.sin(p), 0],
      Chest: [Math.sin(p * 3) * 1.5, 0, 0],
      Head: [3 * Math.sin(p * 2.5), 8 * Math.sin(p), 2 * Math.sin(p * 3)],
      UpperArmR: [-30 * g1, 0, -10 - 12 * g1],
      LowerArmR: [-40 - 50 * g1, 0, 0],
      UpperArmL: [-26 * g2, 0, 10 + 10 * g2],
      LowerArmL: [-30 - 50 * g2, 0, 0],
      UpperLegR: [3, 0, -2],
      LowerLegR: [5, 0, 0],
      hipsPos: [0.01 * Math.sin(p), -0.005, 0],
    };
  });
  return C;
}

// ======================================================================= looks
const INES = {
  name: 'ines',
  scale: 1.0,
  girth: 1.0,
  skin: hex(0xc4906c),
  skinDark: hex(0xa8775a),
  lips: hex(0x9c5a4c),
  eyes: hex(0x3a2716),
  hair: hex(0x6a3222),
  brow: hex(0x4a2418),
  jacket: hex(0x7a7550),
  jacketDark: hex(0x5c5838),
  base: hex(0xbd5a2c),
  pants: hex(0x6f6455),
  pantsDark: hex(0x574e42),
  belt: hex(0x33281e),
  boots: hex(0x6e4629),
  bootsLight: hex(0x8a5e3a),
  sole: hex(0x7d6c57),
  sleeveEnd: 1.06,
  rolledSleeves: true,
  headExtras(s, add, place, rigid) {
    const H = rigid('Head');
    // Full hair volume: cap over top/back/sides with a soft wobble, side panels over the ears.
    const cap = wobble(new THREE.SphereGeometry(0.102 * s, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), 0.03, 60, 1);
    place(cap, { y: 1.644 * s, z: -0.012 * s, sy: 1.12, sz: 1.12, rx: -0.3 });
    add(cap, this.hair, H);
    const back = wobble(new THREE.SphereGeometry(0.09 * s, 18, 12), 0.03, 70, 2);
    place(back, { y: 1.61 * s, z: -0.045 * s, sx: 1.08, sy: 0.9, sz: 0.85 });
    add(back, this.hair, H);
    for (const side of [-1, 1]) {
      const panel = wobble(new THREE.SphereGeometry(0.05 * s, 12, 10), 0.04, 80, 3 + side);
      place(panel, { x: side * 0.083 * s, y: 1.63 * s, z: -0.012 * s, sx: 0.36, sy: 1.0, sz: 0.95 });
      add(panel, this.hair, H);
      // Loose strands framing the face
      const strand = new THREE.CapsuleGeometry(0.0065 * s, 0.07 * s, 3, 6);
      place(strand, { x: side * 0.07 * s, y: 1.635 * s, z: 0.065 * s, rz: side * 0.18, rx: 0.12 });
      add(strand, this.hair, H);
    }
    // Low knot + tie
    const knot = wobble(new THREE.SphereGeometry(0.047 * s, 14, 10), 0.05, 90, 5);
    place(knot, { y: 1.575 * s, z: -0.105 * s, sx: 1.15, sy: 0.9 });
    add(knot, this.hair, H);
    const tie = new THREE.TorusGeometry(0.022 * s, 0.006 * s, 4, 12);
    place(tie, { y: 1.585 * s, z: -0.075 * s });
    add(tie, hex(0x8f2419), H);
  },
  bodyExtras(s, add, place, rigid, torsoChain, legChain) {
    // Expedition backpack: body, lid, side pockets, bedroll, shoulder straps.
    const packCol = hex(0x5f6a4c);
    const packDark = hex(0x464f38);
    const body = roundedBox(0.3 * s, 0.38 * s, 0.15 * s, 0.045 * s, 3);
    place(body, { y: 1.22 * s, z: -0.205 * s });
    add(body, packCol, torsoChain);
    const lid = roundedBox(0.31 * s, 0.07 * s, 0.17 * s, 0.03 * s, 3);
    place(lid, { y: 1.42 * s, z: -0.2 * s, rx: 0.08 });
    add(lid, packDark, torsoChain);
    const front = roundedBox(0.2 * s, 0.15 * s, 0.05 * s, 0.02 * s, 3);
    place(front, { y: 1.15 * s, z: -0.29 * s });
    add(front, packDark, torsoChain);
    for (const side of [-1, 1]) {
      const pocket = roundedBox(0.05 * s, 0.17 * s, 0.1 * s, 0.02 * s, 3);
      place(pocket, { x: side * 0.172 * s, y: 1.13 * s, z: -0.205 * s });
      add(pocket, packDark, torsoChain);
      // Shoulder strap: arc from the pack top over the shoulder to the chest.
      const strap = new THREE.TorusGeometry(0.15 * s, 0.013 * s, 4, 18, Math.PI * 1.05);
      place(strap, { x: side * 0.1 * s, y: 1.3 * s, z: -0.04 * s, ry: Math.PI / 2, sz: 0.9 });
      add(strap, hex(0x2f3326), torsoChain);
      const buckle = new THREE.BoxGeometry(0.03 * s, 0.02 * s, 0.008 * s);
      place(buckle, { x: side * 0.1 * s, y: 1.24 * s, z: 0.13 * s });
      add(buckle, hex(0x9aa0a2), torsoChain);
    }
    const bedroll = new THREE.CylinderGeometry(0.055 * s, 0.055 * s, 0.34 * s, 14, 1);
    place(bedroll, { y: 1.0 * s, z: -0.19 * s, rz: Math.PI / 2 });
    add(bedroll, hex(0x8a3b24), torsoChain);
    for (const side of [-1, 1]) {
      const band = new THREE.TorusGeometry(0.057 * s, 0.006 * s, 4, 14);
      place(band, { x: side * 0.1 * s, y: 1.0 * s, z: -0.19 * s, ry: Math.PI / 2 });
      add(band, hex(0x2f3326), torsoChain);
    }
    // Climbing harness: waist belt + leg loops.
    const belt = new THREE.TorusGeometry(0.163 * s, 0.014 * s, 6, 24);
    place(belt, { y: 0.98 * s, rx: Math.PI / 2, sy: 0.66 });
    add(belt, hex(0x7b2a1c), torsoChain);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const loop = new THREE.TorusGeometry(0.094 * s, 0.012 * s, 6, 18);
      place(loop, { x: sx * 0.095 * s, y: 0.87 * s, rx: Math.PI / 2 + 0.15 });
      add(loop, hex(0x7b2a1c), legChain(side));
    }
    // Satchel on right hip + strap across chest.
    const bag = new THREE.BoxGeometry(0.07 * s, 0.2 * s, 0.24 * s, 1, 2, 2);
    place(bag, { x: -0.21 * s, y: 0.95 * s, z: 0.0 });
    add(bag, hex(0x8a7650), rigid('Hips'));
    const strap = new THREE.TorusGeometry(0.24 * s, 0.01 * s, 4, 30);
    place(strap, { y: 1.19 * s, rz: -0.95, sz: 0.62 });
    add(strap, hex(0x4a3b28), torsoChain);
    // Carabiners (metal) on harness.
    for (let i = 0; i < 3; i++) {
      const c = new THREE.TorusGeometry(0.014 * s, 0.004 * s, 4, 10);
      place(c, { x: (0.1 + i * 0.03) * s, y: 0.94 * s, z: -0.09 * s, sy: 1.5 });
      add(c, hex(0x9aa0a2), rigid('Hips'));
    }
  },
};

const TOBY = {
  name: 'toby',
  scale: 1.07,
  girth: 0.97,
  skin: hex(0x7d5238),
  skinDark: hex(0x66422d),
  lips: hex(0x5e362a),
  hair: hex(0x241a14),
  jacket: hex(0xc9c3b0),
  jacketDark: hex(0xada68f),
  base: hex(0xc9c3b0),
  pants: hex(0x8a7b5a),
  pantsDark: hex(0x756846),
  belt: hex(0x3a2c20),
  boots: hex(0x5a3b24),
  sole: hex(0x241c16),
  sleeveEnd: 1.12,
  rolledSleeves: true,
  headExtras(s, add, place, rigid) {
    const hairCap = wobble(new THREE.SphereGeometry(0.097 * s, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), 0.04, 120, 7);
    place(hairCap, { y: 1.645 * s, z: -0.008 * s, sy: 1.08, sz: 1.08, rx: -0.2 });
    add(hairCap, this.hair, rigid('Head'));
    // Bucket hat
    const crown = new THREE.CylinderGeometry(0.085 * s, 0.1 * s, 0.08 * s, 18, 1);
    place(crown, { y: 1.72 * s, z: -0.005 * s });
    add(crown, hex(0xb8a77c), rigid('Head'));
    const brim = new THREE.CylinderGeometry(0.15 * s, 0.155 * s, 0.012 * s, 22, 1);
    place(brim, { y: 1.685 * s, z: -0.005 * s, rx: 0.06 });
    add(brim, hex(0xa8976c), rigid('Head'));
    // Round spectacles
    for (const side of [-1, 1]) {
      const lens = new THREE.TorusGeometry(0.02 * s, 0.003 * s, 4, 14);
      place(lens, { x: side * 0.034 * s, y: 1.64 * s, z: 0.094 * s });
      add(lens, hex(0x2a2522), rigid('Head'));
    }
    const bridge = new THREE.BoxGeometry(0.03 * s, 0.004 * s, 0.004 * s);
    place(bridge, { y: 1.645 * s, z: 0.096 * s });
    add(bridge, hex(0x2a2522), rigid('Head'));
  },
  bodyExtras(s, add, place, rigid) {
    // Notebook in shirt pocket + camera-strap-free: pens.
    for (let i = 0; i < 3; i++) {
      const pen = new THREE.CylinderGeometry(0.004 * s, 0.004 * s, 0.06 * s, 5);
      place(pen, { x: (0.07 + i * 0.011) * s, y: 1.33 * s, z: 0.123 * s });
      add(pen, hex([0x1f3b73, 0x8c1c13, 0x222222][i]), rigid('Chest'));
    }
    const nb = new THREE.BoxGeometry(0.13 * s, 0.18 * s, 0.03 * s);
    place(nb, { x: 0.2 * s, y: 0.9 * s, z: 0.02 * s, rz: 0.05 });
    add(nb, hex(0x6a4a2a), rigid('Hips'));
  },
};

// ======================================================================= export
async function exportCharacter(look) {
  const s = look.scale;
  const skel = buildSkeleton(s);
  buildBody(look, s);
  const mesh = buildSkinnedMesh(skel);
  const root = new THREE.Group();
  root.name = `${look.name}_root`;
  root.add(skel.root);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(skel.list);
  mesh.bind(skeleton);
  const clips = makeClips(skel, s);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, animations: clips, onlyVisible: false });
  const out = `public/assets/models/temp/${look.name}_temp.glb`;
  writeFileSync(out, Buffer.from(glb));
  const verts = mesh.geometry.attributes.position.count;
  console.log(`[gen-temp-character] ${out}  verts=${verts} bones=${skel.list.length} clips=${clips.map((c) => c.name).join(',')}`);
}

mkdirSync('public/assets/models/temp', { recursive: true });
await exportCharacter(INES);
await exportCharacter(TOBY);
