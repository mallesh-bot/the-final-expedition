import type * as THREE from 'three';
import type { QualityPreset } from '../save/SettingsStore';
import { isPhone, isTouchPrimary } from './Device';

/** Effective, concrete render settings. Purely visual — never read by gameplay. */
export interface QualitySettings {
  preset: QualityPreset;
  /** For HIGH: current adaptive level (0 = best). Informational label. */
  label: string;
  pixelRatioCap: number;
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  antialias: 'msaa' | 'smaa' | 'fxaa' | 'none';
  msaaSamples: number;
  vegetationDensity: number;
  vegetationDistance: number;
  grassDistance: number;
  particleScale: number;
  anisotropy: number;
  lightShafts: boolean;
  /** Tree trunks and canopies cast sun shadows (alpha-tested shadow pass; understory is HIGH+ only). */
  vegetationShadows: boolean;
  /** Dynamic resolution holds this frame time (ms) by scaling render resolution. */
  targetFrameMs: number;
  /** Lowest dynamic render-scale multiplier allowed (1 = never scale down). */
  dynamicResFloor: number;
}

/*
 * Budgets come from PRD §27–§28. Profiling on an integrated GPU showed the game is fill-rate
 * bound (half resolution = 2.5x FPS; alpha-tested foliage overdraw is the next cost), so presets
 * scale resolution, overdraw and shadow casters rather than just post-processing.
 */
const LOW: QualitySettings = {
  preset: 'low',
  label: 'LOW',
  pixelRatioCap: 1,
  renderScale: 0.8,
  shadows: true,
  shadowMapSize: 1024,
  ao: false,
  bloom: false,
  dof: false,
  antialias: 'fxaa',
  msaaSamples: 0,
  vegetationDensity: 0.35,
  vegetationDistance: 55,
  grassDistance: 18,
  particleScale: 0.3,
  anisotropy: 2,
  lightShafts: false,
  vegetationShadows: false,
  targetFrameMs: 1000 / 30,
  dynamicResFloor: 0.55,
};

const MEDIUM: QualitySettings = {
  preset: 'medium',
  label: 'MEDIUM',
  pixelRatioCap: 1.5,
  renderScale: 0.9,
  shadows: true,
  shadowMapSize: 2048,
  ao: false,
  bloom: true,
  dof: true,
  antialias: 'smaa',
  msaaSamples: 0,
  vegetationDensity: 0.7,
  vegetationDistance: 90,
  grassDistance: 30,
  particleScale: 0.6,
  anisotropy: 4,
  lightShafts: true,
  vegetationShadows: true,
  targetFrameMs: 20,
  dynamicResFloor: 0.65,
};

/**
 * HIGH is adaptive. Level 0 is the ceiling (4096 shadows, AO, MSAA); higher levels step
 * down in order of cost-to-visual-impact. The start level comes from a capability probe;
 * PerfMonitor moves between levels at runtime.
 */
const HIGH_LEVELS: Partial<QualitySettings>[] = [
  { label: 'HIGH · ultra', shadowMapSize: 4096, ao: true, renderScale: 1 },
  { label: 'HIGH', shadowMapSize: 2048, ao: true, renderScale: 1 },
  { label: 'HIGH · balanced', shadowMapSize: 2048, ao: false, renderScale: 1 },
  { label: 'HIGH · scaled', shadowMapSize: 2048, ao: false, renderScale: 0.85 },
  { label: 'HIGH · performance', shadowMapSize: 1024, ao: false, renderScale: 0.75, vegetationDistance: 110 },
];

const HIGH_BASE: QualitySettings = {
  preset: 'high',
  label: 'HIGH',
  pixelRatioCap: 2,
  renderScale: 1,
  shadows: true,
  shadowMapSize: 2048,
  ao: true,
  bloom: true,
  dof: true,
  antialias: 'msaa',
  msaaSamples: 4,
  vegetationDensity: 1,
  vegetationDistance: 150,
  grassDistance: 50,
  particleScale: 1,
  anisotropy: 8,
  lightShafts: true,
  vegetationShadows: true,
  targetFrameMs: 1000 / 60,
  dynamicResFloor: 0.8,
};

/** Opt-in, never auto-selected. Falls back via the dynamic-resolution floor and adaptive watchdog. */
const ULTRA: QualitySettings = {
  ...HIGH_BASE,
  preset: 'ultra',
  label: 'ULTRA (experimental)',
  shadowMapSize: 4096,
  vegetationDistance: 200,
  grassDistance: 70,
  particleScale: 1.5,
  anisotropy: 16,
  dynamicResFloor: 0.85,
};

export const HIGH_LEVEL_COUNT = HIGH_LEVELS.length;

export function resolveQuality(preset: QualityPreset, highLevel: number): QualitySettings {
  let q: QualitySettings;
  if (preset === 'low') q = { ...LOW };
  else if (preset === 'medium') q = { ...MEDIUM };
  else if (preset === 'ultra') q = { ...ULTRA };
  else q = { ...HIGH_BASE, ...HIGH_LEVELS[Math.max(0, Math.min(HIGH_LEVELS.length - 1, highLevel))] };
  return isTouchPrimary ? mobileTrim(q) : q;
}

/** Mobile/tablet GPUs: trim the costliest features at every preset. Desktop is never affected. */
function mobileTrim(q: QualitySettings): QualitySettings {
  const phone = isPhone();
  q.ao = false;
  q.shadowMapSize = Math.min(q.shadowMapSize, phone ? 1024 : 2048);
  q.anisotropy = Math.min(q.anisotropy, 4);
  q.grassDistance *= phone ? 0.65 : 0.8;
  q.vegetationDistance *= phone ? 0.75 : 0.9;
  q.particleScale *= phone ? 0.6 : 0.8;
  if (phone) q.dof = false;
  return q;
}

export interface GpuProbe {
  renderer: string;
  vendor: string;
  maxTexture: number;
  cores: number;
  software: boolean;
  /** Suggested best starting HIGH level (0..n). */
  suggestedHighLevel: number;
  /** Suggested preset for first-time players. */
  suggestedPreset: QualityPreset;
}

/** Capability probe used to choose where adaptive HIGH starts. */
export function probeGpu(renderer: THREE.WebGLRenderer): GpuProbe {
  const gl = renderer.getContext();
  let rendererStr = 'unknown';
  let vendor = 'unknown';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) {
    rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
  }
  const r = rendererStr.toLowerCase();
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const cores = navigator.hardwareConcurrency || 4;
  const software = /swiftshader|llvmpipe|software|basic render/.test(r);

  let level = 2;
  if (software) level = 4;
  else if (/rtx|radeon rx [6-9]|rx 7|apple m[2-9] (pro|max|ultra)|apple m[3-9]/.test(r)) level = 0;
  else if (/apple m|apple gpu|nvidia|geforce|radeon/.test(r)) level = 1;
  else if (/intel.*(iris|xe|arc)/.test(r)) level = 2;
  else if (/intel|mali|adreno/.test(r)) level = 3;
  if (maxTexture < 8192) level = Math.max(level, 3);
  if (cores <= 4) level = Math.max(level, 2);

  if (isTouchPrimary) level = Math.max(level, isPhone() ? 4 : 3);
  const suggestedPreset: QualityPreset = software || isPhone() ? 'low' : level >= 3 ? 'medium' : 'high';
  return { renderer: rendererStr, vendor, maxTexture, cores, software, suggestedHighLevel: level, suggestedPreset };
}
