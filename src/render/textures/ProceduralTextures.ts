import * as THREE from 'three';
import { clamp, fbmTile, mulberry32, worleyTile } from '../../systems/noise';

/**
 * All textures in the game are generated here at load time (no external image assets).
 * Albedo maps are sRGB; normal/roughness maps are linear.
 */

type RGB = [number, number, number];

function dataTex(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function canvasTex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Build a tangent-space normal map from a height field (wrapping). */
function normalFromHeight(h: Float32Array, size: number, strength: number, wrap = true): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + size) % size;
      y = (y + size) % size;
    } else {
      x = clamp(x, 0, size - 1);
      y = clamp(y, 0, size - 1);
    }
    return h[y * size + x];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
  /** Optional mask (e.g. carved grooves) for emissive effects. */
  mask?: THREE.Texture;
}

// ---------------------------------------------------------------- stone
export type StoneStyle = 'rock' | 'cliff' | 'masonry';

/**
 * Natural stone. 'rock' = weathered boulders (ridged fbm, pitting, lichen);
 * 'cliff' = sedimentary strata with iron-oxide streaks and sparse fractures;
 * 'masonry' = dressed Ysharu blocks: flat faces, chipped edges, rain streaks.
 */
export function stoneTextures(seed = 1, size = 512, base: RGB = [150, 138, 118], style: StoneStyle = 'rock'): PBRSet {
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const rnd = mulberry32(seed);
  const lichenSeed = Math.floor(rnd() * 1000);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Domain warp for organic shapes
      const wx = fbmTile(u, v, 3, 3, seed + 31) - 0.5;
      const wy = fbmTile(u, v, 3, 3, seed + 47) - 0.5;
      const uu = u + wx * 0.12;
      const vv = v + wy * 0.12;
      const large = fbmTile(uu, vv, 4, 5, seed);
      const ridged = 1 - Math.abs(fbmTile(uu, vv, 6, 4, seed + 5) * 2 - 1);
      const fine = fbmTile(u, v, 32, 3, seed + 9);
      const pits = Math.max(0, 0.62 - fbmTile(u, v, 48, 2, seed + 13)) * 2;
      const [f1, f2] = worleyTile(uu, vv, 5, seed + 3);
      const crack = Math.pow(clamp(1 - (f2 - f1) * 22, 0, 1), 2) * (fbmTile(u, v, 4, 2, seed + 71) > 0.45 ? 1 : 0.15);
      let height: number;
      let c: RGB;
      if (style === 'cliff') {
        const strata = Math.sin((vv * 14 + large * 2.4) * Math.PI) * 0.5 + 0.5;
        const band = Math.pow(strata, 3);
        height = large * 0.45 + ridged * 0.25 + band * 0.25 + fine * 0.15 - crack * 0.45;
        c = mix([base[0] * 0.7, base[1] * 0.68, base[2] * 0.66], base, large * 0.8 + band * 0.3);
        const streak = fbmTile(u * 1, v * 0.08, 24, 2, seed + 91);
        c = mix(c, [150, 88, 52], clamp((streak - 0.5) * 3, 0, 1) * 0.35);
        c = mix(c, [base[0] * 1.2, base[1] * 1.15, base[2] * 1.1], band * 0.25);
      } else if (style === 'masonry') {
        height = large * 0.25 + fine * 0.25 - pits * 0.15 - crack * 0.4;
        c = mix([base[0] * 0.78, base[1] * 0.76, base[2] * 0.72], base, large);
        const streak = fbmTile(u * 1, v * 0.1, 18, 2, seed + 55);
        c = mix(c, [70, 72, 60], clamp((streak - 0.55) * 2.5, 0, 1) * 0.4);
      } else {
        height = large * 0.4 + ridged * 0.35 + fine * 0.2 - pits * 0.2 - crack * 0.35;
        c = mix([base[0] * 0.66, base[1] * 0.65, base[2] * 0.62], base, large * 0.7 + ridged * 0.4);
      }
      h[y * size + x] = height;
      const lichen = clamp((fbmTile(u, v, 10, 3, lichenSeed) - 0.64) * 6, 0, 1);
      c = mix(c, [base[0] * 1.12, base[1] * 1.1, base[2] * 1.04], fine * 0.35);
      c = mix(c, [176, 170, 118], lichen * 0.5);
      c = mix(c, [48, 44, 38], crack * 0.7 + pits * 0.18);
      const i = (y * size + x) * 4;
      alb[i] = clamp(c[0], 0, 255);
      alb[i + 1] = clamp(c[1], 0, 255);
      alb[i + 2] = clamp(c[2], 0, 255);
      alb[i + 3] = 255;
      const r = clamp(0.8 + crack * 0.12 - fine * 0.1 + pits * 0.08, 0, 1) * 255;
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
    }
  }
  return {
    map: dataTex(alb, size, true),
    normalMap: dataTex(normalFromHeight(h, size, style === 'masonry' ? 3.5 : 5.5), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
}

// ---------------------------------------------------------------- moss
export function mossTextures(seed = 7, size = 256): PBRSet {
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmTile(u, v, 8, 4, seed);
      const f = fbmTile(u, v, 48, 2, seed + 4);
      h[y * size + x] = n * 0.6 + f * 0.4;
      const c = mix(mix([38, 58, 22], [92, 118, 42], n), [130, 140, 60], f * 0.35);
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
    }
  }
  return { map: dataTex(alb, size, true), normalMap: dataTex(normalFromHeight(h, size, 3), size, false) };
}

// ---------------------------------------------------------------- ground (mud + leaf litter)
export function groundTextures(seed = 11, size = 512): PBRSet {
  const [c, ctx] = makeCanvas(size);
  const h = new Float32Array(size * size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmTile(u, v, 6, 5, seed);
      const f = fbmTile(u, v, 40, 2, seed + 2);
      h[y * size + x] = n * 0.5 + f * 0.2;
      const col = mix(mix([48, 36, 24], [96, 74, 50], n), [70, 62, 44], f * 0.4);
      const i = (y * size + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Leaf litter: scattered elongated leaves, drawn with wrap-around.
  const rnd = mulberry32(seed + 99);
  const leafCols = ['#7a4f25', '#8d6a2c', '#5f4a26', '#6b5a2a', '#9a5b2a', '#4c4a26', '#a57a3a'];
  for (let k = 0; k < 900; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 5 + rnd() * 11;
    const w = len * (0.28 + rnd() * 0.2);
    const a = rnd() * Math.PI;
    ctx.fillStyle = leafCols[Math.floor(rnd() * leafCols.length)];
    ctx.globalAlpha = 0.55 + rnd() * 0.4;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.save();
      ctx.translate(x + ox, y + oy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, len, w, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  const d = ctx.getImageData(0, 0, size, size).data;
  // Fold litter into height for normals (leaves are raised slightly).
  for (let i = 0; i < size * size; i++) {
    const lum = (d[i * 4] + d[i * 4 + 1]) / 510;
    h[i] += lum * 0.25;
  }
  return { map: canvasTex(c), normalMap: dataTex(normalFromHeight(h, size, 4), size, false) };
}

// ---------------------------------------------------------------- grass-ground albedo
export function grassGroundTexture(seed = 21, size = 512): THREE.Texture {
  const alb = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmTile(u, v, 5, 5, seed);
      const blades = fbmTile(u * 1, v * 1, 64, 2, seed + 3);
      const c = mix(mix([46, 62, 26], [88, 104, 40], n), [120, 128, 58], blades * 0.35);
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
    }
  }
  return dataTex(alb, size, true);
}

// ---------------------------------------------------------------- bark
export function barkTextures(seed = 31, size = 256): PBRSet {
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const ridges = fbmTile(u * 1, v * 0.25, 12, 4, seed);
      const fine = fbmTile(u, v, 32, 2, seed + 1);
      const val = Math.pow(ridges, 1.4);
      h[y * size + x] = val + fine * 0.2;
      const c = mix(mix([34, 28, 22], [96, 84, 66], val), [80, 96, 60], fine * 0.25);
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
    }
  }
  return { map: dataTex(alb, size, true), normalMap: dataTex(normalFromHeight(h, size, 6), size, false) };
}

// ---------------------------------------------------------------- canvas cloth (tents)
export function canvasClothTextures(seed = 41, size = 256): PBRSet {
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const weave = (Math.sin(x * 1.6) * 0.5 + 0.5) * (Math.sin(y * 1.6) * 0.5 + 0.5);
      const stain = fbmTile(u, v, 4, 4, seed);
      const dirt = fbmTile(u, v, 16, 3, seed + 5);
      h[y * size + x] = weave * 0.4 + dirt * 0.2;
      let c: RGB = mix([118, 112, 82], [150, 142, 106], weave * 0.4 + dirt * 0.3);
      c = mix(c, [70, 62, 40], clamp((stain - 0.55) * 3, 0, 1) * 0.7);
      c = mix(c, [60, 78, 40], clamp((v - 0.72) * 3, 0, 1) * dirt * 0.8);
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
    }
  }
  return { map: dataTex(alb, size, true), normalMap: dataTex(normalFromHeight(h, size, 2), size, false) };
}

// ---------------------------------------------------------------- wood planks (crates)
export function woodTextures(seed = 51, size = 256): PBRSet {
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const planks = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const p = Math.floor(v * planks);
      const inPlank = (v * planks) % 1;
      const gap = inPlank < 0.04 || inPlank > 0.96 ? 1 : 0;
      const grain = fbmTile(u * 0.2 + p * 0.37, v * 4, 16, 3, seed + p);
      const rot = fbmTile(u, v, 6, 4, seed + 13);
      h[y * size + x] = grain * 0.4 - gap * 0.8;
      let c: RGB = mix([92, 70, 44], [140, 108, 70], grain);
      c = mix(c, [60, 70, 50], clamp((rot - 0.55) * 3, 0, 1) * 0.6);
      if (gap) c = [30, 24, 18];
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
    }
  }
  return { map: dataTex(alb, size, true), normalMap: dataTex(normalFromHeight(h, size, 4), size, false) };
}

// ---------------------------------------------------------------- rusted metal
export function rustTextures(seed = 61, size = 256): PBRSet {
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmTile(u, v, 6, 5, seed);
      const pit = fbmTile(u, v, 40, 2, seed + 2);
      const rust = clamp((n - 0.35) * 2.2, 0, 1);
      h[y * size + x] = rust * 0.4 + pit * 0.2;
      const c = mix([62, 66, 64], mix([120, 58, 26], [160, 92, 40], pit), rust);
      const i = (y * size + x) * 4;
      alb[i] = c[0];
      alb[i + 1] = c[1];
      alb[i + 2] = c[2];
      alb[i + 3] = 255;
      rough[i] = rough[i + 1] = rough[i + 2] = clamp(0.45 + rust * 0.5, 0, 1) * 255;
      rough[i + 3] = 255;
    }
  }
  return {
    map: dataTex(alb, size, true),
    normalMap: dataTex(normalFromHeight(h, size, 3), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
}

// ---------------------------------------------------------------- water normals
export function waterNormalTexture(seed = 71, size = 256): THREE.Texture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      h[y * size + x] = fbmTile(u, v, 4, 5, seed) * 0.7 + fbmTile(u, v, 16, 3, seed + 3) * 0.3;
    }
  }
  return dataTex(normalFromHeight(h, size, 6), size, false);
}

// ---------------------------------------------------------------- foliage atlas (2x2)
/**
 * Cells: [0,0] fern frond · [1,0] broadleaf · [0,1] grass clump · [1,1] canopy leaf cluster.
 * UV (0..0.5, 0.5..1) = cell 0 etc. (canvas y is flipped by flipY).
 */
export function foliageAtlas(seed = 81, size = 1024): THREE.Texture {
  const [c, ctx] = makeCanvas(size);
  const half = size / 2;
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);

  const leafGrad = (x0: number, y0: number, x1: number, y1: number, a: string, b: string) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  };

  // --- Fern frond (cell top-left): central rachis with alternating pinnae.
  ctx.save();
  ctx.translate(half * 0.5, half * 0.97);
  ctx.strokeStyle = '#3d4a1c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(10, -half * 0.5, -6, -half * 0.92);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const y = -t * half * 0.9;
    const x = 10 * Math.sin(t * 2.8) - t * 8;
    const len = (1 - t) * half * 0.38 + 10;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(side * (1.15 - t * 0.35));
      ctx.fillStyle = leafGrad(0, 0, 0, -len, '#39521d', i % 3 === 0 ? '#6f8f32' : '#5b7a2a');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.16, -len * 0.5, 0, -len);
      ctx.quadraticCurveTo(-len * 0.16, -len * 0.5, 0, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  // --- Broadleaf (cell top-right): large heart-shaped leaf with veins.
  ctx.save();
  ctx.translate(half * 1.5, half * 0.95);
  const L = half * 0.85;
  ctx.fillStyle = leafGrad(0, 0, 0, -L, '#24401a', '#4f7a2b');
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(L * 0.55, -L * 0.15, L * 0.5, -L * 0.8, 0, -L);
  ctx.bezierCurveTo(-L * 0.5, -L * 0.8, -L * 0.55, -L * 0.15, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,210,120,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -L * 0.97);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 9; i++) {
    const y = -L * (i / 10);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(s * L * 0.2, y - L * 0.05, s * L * 0.38 * Math.sin((i / 10) * Math.PI), y - L * 0.14);
      ctx.stroke();
    }
  }
  // Holes / tears for character.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse((rnd() - 0.5) * L * 0.5, -L * (0.3 + rnd() * 0.5), 4 + rnd() * 8, 2 + rnd() * 4, rnd(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // --- Grass clump (cell bottom-left).
  ctx.save();
  ctx.translate(half * 0.5, size - 4);
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * half * 0.7;
    const hgt = half * (0.45 + rnd() * 0.5);
    const bend = (rnd() - 0.5) * half * 0.35;
    const w = 3 + rnd() * 5;
    const g = leafGrad(0, 0, 0, -hgt, '#2e4418', rnd() > 0.5 ? '#8fa24a' : '#6f8a36');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, 0);
    ctx.quadraticCurveTo(x + bend * 0.5, -hgt * 0.6, x + bend, -hgt);
    ctx.quadraticCurveTo(x + bend * 0.5 + w * 0.3, -hgt * 0.6, x + w, 0);
    ctx.fill();
  }
  ctx.restore();

  // --- Canopy leaf cluster (cell bottom-right): many small leaves radiating.
  ctx.save();
  ctx.translate(half * 1.5, half * 1.5);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * half * 0.36;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const len = 18 + rnd() * 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (rnd() - 0.5));
    const shade = 0.6 + rnd() * 0.4;
    ctx.fillStyle = `rgb(${Math.floor(40 * shade + 10)},${Math.floor(92 * shade + 10)},${Math.floor(34 * shade)})`;
    ctx.beginPath();
    ctx.ellipse(0, -len * 0.5, len * 0.26, len * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const t = canvasTex(c, true, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.premultiplyAlpha = false;
  return t;
}

// ---------------------------------------------------------------- glyphs
export type GlyphId = 'rising' | 'eye' | 'setting' | 'serpent';
export const GLYPHS: GlyphId[] = ['rising', 'eye', 'setting', 'serpent'];

/** Draw an Ysharu glyph centered at (cx, cy) fitting in `s` pixels. Stroke color taken from ctx. */
export function drawGlyph(ctx: CanvasRenderingContext2D, g: GlyphId, cx: number, cy: number, s: number): void {
  const lw = Math.max(2, s * 0.07);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = s * 0.26;
  ctx.beginPath();
  switch (g) {
    case 'rising': {
      // Horizon line, half-disc above, three rays upward, chevron pointing up beneath.
      ctx.moveTo(cx - s * 0.4, cy + s * 0.08);
      ctx.lineTo(cx + s * 0.4, cy + s * 0.08);
      ctx.moveTo(cx - r, cy + s * 0.08);
      ctx.arc(cx, cy + s * 0.08, r, Math.PI, 0);
      for (const a of [-0.55, 0, 0.55]) {
        const ax = Math.sin(a);
        const ay = -Math.cos(a);
        ctx.moveTo(cx + ax * r * 1.3, cy + s * 0.08 + ay * r * 1.3);
        ctx.lineTo(cx + ax * r * 1.75, cy + s * 0.08 + ay * r * 1.75);
      }
      ctx.moveTo(cx - s * 0.14, cy + s * 0.34);
      ctx.lineTo(cx, cy + s * 0.22);
      ctx.lineTo(cx + s * 0.14, cy + s * 0.34);
      break;
    }
    case 'setting': {
      // Horizon line, half-disc below, rays downward, chevron pointing down above.
      ctx.moveTo(cx - s * 0.4, cy - s * 0.08);
      ctx.lineTo(cx + s * 0.4, cy - s * 0.08);
      ctx.moveTo(cx + r, cy - s * 0.08);
      ctx.arc(cx, cy - s * 0.08, r, 0, Math.PI);
      for (const a of [-0.55, 0, 0.55]) {
        const ax = Math.sin(a);
        const ay = Math.cos(a);
        ctx.moveTo(cx + ax * r * 1.3, cy - s * 0.08 + ay * r * 1.3);
        ctx.lineTo(cx + ax * r * 1.75, cy - s * 0.08 + ay * r * 1.75);
      }
      ctx.moveTo(cx - s * 0.14, cy - s * 0.34);
      ctx.lineTo(cx, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.14, cy - s * 0.34);
      break;
    }
    case 'eye': {
      // Almond eye, pupil, rays all around (the Watcher at zenith).
      ctx.moveTo(cx - s * 0.36, cy);
      ctx.quadraticCurveTo(cx, cy - s * 0.3, cx + s * 0.36, cy);
      ctx.quadraticCurveTo(cx, cy + s * 0.3, cx - s * 0.36, cy);
      ctx.moveTo(cx + s * 0.09, cy);
      ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.45;
        ctx.moveTo(cx + Math.cos(a) * s * 0.26, cy + Math.sin(a) * s * 0.26);
        ctx.lineTo(cx + Math.cos(a) * s * 0.4, cy + Math.sin(a) * s * 0.4);
      }
      break;
    }
    case 'serpent': {
      // Wavy water-serpent line with a small head.
      ctx.moveTo(cx - s * 0.4, cy + s * 0.05);
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        ctx.lineTo(cx - s * 0.4 + t * s * 0.72, cy + s * 0.05 + Math.sin(t * Math.PI * 3) * s * 0.12);
      }
      ctx.moveTo(cx + s * 0.32 + s * 0.07, cy + s * 0.05);
      ctx.arc(cx + s * 0.32, cy + s * 0.05, s * 0.07, 0, Math.PI * 2);
      ctx.moveTo(cx - s * 0.3, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.3, cy + s * 0.3);
      break;
    }
  }
  ctx.stroke();
}

/** Carved-stone atlas of the 4 glyphs (1 row × 4 cells), plus matching normal map. */
export function glyphDrumTextures(seed = 91, cell = 256): PBRSet {
  const w = cell * 4;
  const [c, ctx] = makeCanvas(w, cell);
  const base = stoneTextures(seed, cell, [148, 134, 110], 'masonry');
  // Base stone: tile the stone albedo into each cell by reading its data.
  const src = (base.map as THREE.DataTexture).image.data as Uint8Array;
  const img = ctx.createImageData(w, cell);
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < w; x++) {
      const si = (y * cell + (x % cell)) * 4;
      const di = (y * w + x) * 4;
      img.data[di] = src[si];
      img.data[di + 1] = src[si + 1];
      img.data[di + 2] = src[si + 2];
      img.data[di + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  // Carve height: draw glyphs into a separate mask canvas.
  const [maskCanvas, mctx] = makeCanvas(w, cell);
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, cell);
  mctx.strokeStyle = '#fff';
  mctx.filter = 'blur(2px)';
  GLYPHS.forEach((g, i) => drawGlyph(mctx, g, cell * i + cell / 2, cell / 2, cell * 0.78));
  // Frame border around each face.
  mctx.lineWidth = 6;
  GLYPHS.forEach((_, i) => mctx.strokeRect(cell * i + 14, 14, cell - 28, cell - 28));
  mctx.filter = 'none';
  const mask = mctx.getImageData(0, 0, w, cell).data;
  // Darken grooves in albedo.
  const out = ctx.getImageData(0, 0, w, cell);
  const h = new Float32Array(w * cell);
  for (let i = 0; i < w * cell; i++) {
    const m = mask[i * 4] / 255;
    h[i] = -m;
    out.data[i * 4] *= 1 - m * 0.55;
    out.data[i * 4 + 1] *= 1 - m * 0.55;
    out.data[i * 4 + 2] *= 1 - m * 0.5;
  }
  ctx.putImageData(out, 0, 0);
  // Non-square normal from height.
  const nrm = new Uint8Array(w * cell * 4);
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < w; x++) {
      const hx = (xx: number, yy: number) => h[clamp(yy, 0, cell - 1) * w + clamp(xx, 0, w - 1)];
      const dx = (hx(x + 1, y) - hx(x - 1, y)) * 4;
      const dy = (hx(x, y + 1) - hx(x, y - 1)) * 4;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
      nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  const nt = new THREE.DataTexture(nrm, w, cell, THREE.RGBAFormat);
  nt.needsUpdate = true;
  nt.generateMipmaps = true;
  nt.minFilter = THREE.LinearMipmapLinearFilter;
  base.map.dispose();
  base.normalMap.dispose();
  base.roughnessMap?.dispose();
  const map = canvasTex(c, true, false);
  // Emissive mask: glyph grooves only (no frame), so solved drums glow in the carving.
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, cell);
  mctx.strokeStyle = '#fff';
  mctx.filter = 'blur(3px)';
  GLYPHS.forEach((g, i) => drawGlyph(mctx, g, cell * i + cell / 2, cell / 2, cell * 0.78));
  mctx.filter = 'none';
  const glowMask = canvasTex(maskCanvas, true, false);
  return { map, normalMap: nt, mask: glowMask };
}

/**
 * Mural of the Watcher's path, read right-to-left: Rising at right, Open Eye at the top,
 * Setting at left, and the water-serpent struck through below (the decoy).
 */
export function muralTextures(seed = 101, w = 1024, hgt = 512): PBRSet {
  const [c, ctx] = makeCanvas(w, hgt);
  const stone = stoneTextures(seed, 512, [140, 128, 104], 'masonry');
  const src = (stone.map as THREE.DataTexture).image.data as Uint8Array;
  const img = ctx.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++) {
      const si = ((y % 512) * 512 + (x % 512)) * 4;
      const di = (y * w + x) * 4;
      img.data[di] = src[si];
      img.data[di + 1] = src[si + 1];
      img.data[di + 2] = src[si + 2];
      img.data[di + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  stone.map.dispose();
  stone.normalMap.dispose();
  stone.roughnessMap?.dispose();

  const [mc, m] = makeCanvas(w, hgt);
  m.fillStyle = '#000';
  m.fillRect(0, 0, w, hgt);
  m.strokeStyle = '#fff';
  m.filter = 'blur(2px)';
  // Arc of the sun's walk (dotted), right -> left.
  m.lineWidth = 6;
  m.setLineDash([4, 22]);
  m.beginPath();
  m.arc(w / 2, hgt * 0.78, w * 0.36, Math.PI * 1.05, Math.PI * 1.95);
  m.stroke();
  m.setLineDash([]);
  // Arrow heads along arc pointing leftwards (direction of the walk).
  m.lineWidth = 7;
  for (const a of [1.72, 1.28]) {
    const ang = Math.PI * a;
    const px = w / 2 + Math.cos(ang) * w * 0.36;
    const py = hgt * 0.78 + Math.sin(ang) * w * 0.36;
    const tx = Math.sin(ang);
    const ty = -Math.cos(ang);
    m.beginPath();
    m.moveTo(px - tx * 18 + ty * 14, py - ty * 18 - tx * 14);
    m.lineTo(px, py);
    m.lineTo(px - tx * 18 - ty * 14, py - ty * 18 + tx * 14);
    m.stroke();
  }
  drawGlyph(m, 'rising', w * 0.84, hgt * 0.58, 170);
  drawGlyph(m, 'eye', w * 0.5, hgt * 0.2, 170);
  drawGlyph(m, 'setting', w * 0.16, hgt * 0.58, 170);
  // Serpent below, struck through: "not the sky".
  drawGlyph(m, 'serpent', w * 0.5, hgt * 0.8, 150);
  m.lineWidth = 9;
  m.beginPath();
  m.moveTo(w * 0.4, hgt * 0.68);
  m.lineTo(w * 0.6, hgt * 0.94);
  m.stroke();
  // Border.
  m.lineWidth = 10;
  m.strokeRect(18, 18, w - 36, hgt - 36);
  m.filter = 'none';

  const mask = m.getImageData(0, 0, w, hgt).data;
  const out = ctx.getImageData(0, 0, w, hgt);
  const h = new Float32Array(w * hgt);
  for (let i = 0; i < w * hgt; i++) {
    const mm = mask[i * 4] / 255;
    h[i] = -mm;
    out.data[i * 4] *= 1 - mm * 0.5;
    out.data[i * 4 + 1] *= 1 - mm * 0.5;
    out.data[i * 4 + 2] *= 1 - mm * 0.45;
  }
  ctx.putImageData(out, 0, 0);
  const nrm = new Uint8Array(w * hgt * 4);
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++) {
      const hx = (xx: number, yy: number) => h[clamp(yy, 0, hgt - 1) * w + clamp(xx, 0, w - 1)];
      const dx = (hx(x + 1, y) - hx(x - 1, y)) * 4;
      const dy = (hx(x, y + 1) - hx(x, y - 1)) * 4;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
      nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  const nt = new THREE.DataTexture(nrm, w, hgt, THREE.RGBAFormat);
  nt.needsUpdate = true;
  nt.generateMipmaps = true;
  nt.minFilter = THREE.LinearMipmapLinearFilter;
  void mc;
  return { map: canvasTex(c, true, false), normalMap: nt };
}

// ---------------------------------------------------------------- stencils / decals
export function stencilTexture(lines: string[], opts: { color: string; font: string; w?: number; h?: number; rotate?: number; chalk?: boolean }): THREE.Texture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 256;
  const [c, ctx] = makeCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(opts.rotate ?? 0);
  ctx.fillStyle = opts.color;
  ctx.font = opts.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = h / (lines.length + 1);
  lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
  ctx.restore();
  // Weathering: erase random specks so stencils look sprayed / chalked.
  const rnd = mulberry32(lines.join('').length * 13);
  ctx.globalCompositeOperation = 'destination-out';
  const specks = opts.chalk ? 2600 : 1400;
  for (let i = 0; i < specks; i++) {
    ctx.globalAlpha = 0.3 + rnd() * 0.7;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * (opts.chalk ? 3 : 4), 1 + rnd() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const t = canvasTex(c, true, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------- particle sprites
export function softDotTexture(size = 64): THREE.Texture {
  const [c, ctx] = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = canvasTex(c, false, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function mistTexture(size = 128): THREE.Texture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = fbmTile(u, v, 4, 4, 5);
      const a = clamp((1 - d) * (0.4 + n * 0.9), 0, 1);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * a * 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = canvasTex(c, false, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function leafSpriteTexture(size = 64): THREE.Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.translate(size / 2, size / 2);
  ctx.rotate(0.6);
  ctx.fillStyle = '#b07a32';
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.18, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,50,20,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.4);
  ctx.lineTo(0, size * 0.42);
  ctx.stroke();
  const t = canvasTex(c, true, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Streaky, tileable waterfall texture (alpha in luminance). */
export function waterfallTexture(size = 256): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const streak = fbmTile(u, v * 0.125, 24, 3, 3);
      const foam = fbmTile(u, v, 8, 4, 9);
      const val = clamp(streak * 1.2 - 0.25 + foam * 0.35, 0, 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val * 255;
      data[i + 3] = 255;
    }
  return dataTex(data, size, false);
}

/**
 * Marta's journal sketch of the gate drums. Rain has run the ink: only the right-hand drum
 * (Rising) survives clearly; the player must combine the text, the murals and the real sun.
 */
export function journalSketchDataURL(): string {
  const [c, ctx] = makeCanvas(420, 220);
  ctx.strokeStyle = 'rgba(52,40,26,0.9)';
  ctx.fillStyle = 'rgba(52,40,26,0.9)';
  const order: GlyphId[] = ['setting', 'eye', 'rising'];
  order.forEach((g, i) => {
    const x = 80 + i * 130;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 48, 40, 96, 110);
    drawGlyph(ctx, g, x, 95, 80);
  });
  ctx.font = 'italic 15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(360, 180);
  ctx.lineTo(60, 180);
  ctx.moveTo(72, 172);
  ctx.lineTo(60, 180);
  ctx.lineTo(72, 188);
  ctx.stroke();
  ctx.fillText('as the Watcher walks', 210, 205);
  ctx.fillText('right hand', 340, 28);
  // Water damage: ink has run over the left and middle drums.
  const rnd = mulberry32(77);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.beginPath();
    ctx.ellipse(40 + rnd() * 230, 40 + rnd() * 120, 8 + rnd() * 26, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.06 + rnd() * 0.08;
    ctx.fillStyle = 'rgb(90,64,30)';
    ctx.beginPath();
    ctx.ellipse(40 + rnd() * 240, 30 + rnd() * 140, 10 + rnd() * 30, 8 + rnd() * 24, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c.toDataURL();
}
