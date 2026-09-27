import * as THREE from 'three';
import { fbm2, smoothstep, lerp } from '../../systems/noise';
import { makeClimb, makeLedge, type TraversalSet } from '../../traversal/TraversalTypes';
import type { CheckpointDef } from '../Chapter';

/**
 * Chapter 1 — THE DISCOVERY — hand-authored layout.
 * Axes: +Z = north (toward the ridge and the Gate), +X = west, -X = east.
 * The dusk sun sits low in the north-west, so standing at the gate with your back to the
 * valley, the sun is setting on your LEFT (+X) — exactly as Marta's journal says.
 */
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const SUN_DIR = v(0.52, 0.16, 0.84).normalize();
export const PLATEAU_Y = 12;

export const LANDING = v(-2, 0, -57);
export const TOBY_SEAT = v(2.6, 0, -59.2);
export const LANDING_FIRE = v(0.9, 0, -57.8);
export const CAMP = v(2, 0, -10);
export const CLIFF_BASE = v(10, 0, 19.6);
export const GATE = v(4, PLATEAU_Y, 50.6);
export const POOL = v(-16, 0, 18.5);

export const TRAIL: [number, number][] = [
  [-2, -60], [-1.5, -50], [1.5, -40], [4, -30], [3, -21], [2, -13], [4, -3], [7.5, 6], [9.5, 13], [10, 19.5],
];
export const PLATEAU_PATH: [number, number][] = [
  [25.5, 25], [23, 29], [20, 33], [15, 37], [10, 41], [6, 44], [4, 47],
];
export const STREAM: [number, number][] = [
  [-16, 18.5], [-18.5, 8], [-17, -6], [-13.5, -22], [-10.5, -38], [-9, -54], [-8, -66],
];
export const PLATEAU_STREAM: [number, number][] = [
  [-28, 47], [-24, 38], [-19, 31], [-16.2, 26.6],
];

export function riverZ(x: number): number {
  return -71 + Math.sin(x * 0.028) * 4.5 + Math.sin(x * 0.071 + 1.3) * 1.5;
}

export function distToPolyline(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/** Terrain height (the heightfield samples this once at load). */
export function terrainHeight(x: number, z: number): number {
  const n = fbm2(x * 0.024, z * 0.024, 4);
  let h = n * 1.3 + fbm2(x * 0.1, z * 0.1, 2) * 0.22;

  // Valley walls to the east & west, forested slopes.
  const wall = Math.max(0, Math.abs(x - 2) - 34);
  h += Math.pow(wall / 16, 1.45) * 20 * (1 + n * 0.35);
  // Hills south of the river.
  const south = Math.max(0, -80 - z);
  h += Math.pow(south / 14, 1.35) * 12;

  // River channel
  const dr = Math.abs(z - riverZ(x));
  h = lerp(h, -1.9, 1 - smoothstep(3.2, 9, dr));
  // Stream channel & pool
  const ds = distToPolyline(x, z, STREAM);
  h -= 0.8 * (1 - smoothstep(0.7, 2.4, ds));
  const dp = Math.hypot(x - POOL.x, z - POOL.z);
  h = Math.min(h, lerp(-1.3, h, smoothstep(2.4, 5.5, dp)));
  // Trail & camp clearing (flattened, gentle)
  const dt = distToPolyline(x, z, TRAIL);
  h = lerp(h, h * 0.35 + 0.05, 1 - smoothstep(1.2, 3.6, dt));
  const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
  h = lerp(h, 0.08 + n * 0.1, 1 - smoothstep(9, 15, dc));
  const dl = Math.hypot(x - LANDING.x, z - LANDING.z - 1);
  h = lerp(h, 0.05, 1 - smoothstep(5, 9, dl));

  // Plateau above the cliff (the cliff face itself is authored rock geometry).
  const plat = smoothstep(25.2, 27.0, z);
  if (plat > 0) {
    const edgeCalm = smoothstep(27, 34, z);
    let ph = PLATEAU_Y + fbm2(x * 0.05, z * 0.05, 3) * 0.55 * edgeCalm;
    const pw = Math.max(0, Math.abs(x - 2) - 30);
    ph += Math.pow(pw / 10, 1.5) * 22;
    const dpp = distToPolyline(x, z, PLATEAU_PATH);
    ph = lerp(ph, PLATEAU_Y + 0.02, 1 - smoothstep(1.5, 4, dpp) * 1);
    const dps = distToPolyline(x, z, PLATEAU_STREAM);
    ph -= 0.6 * (1 - smoothstep(0.6, 1.8, dps));
    // Gate plaza: flat
    const dg = Math.hypot(x - GATE.x, z - 46.5);
    ph = lerp(ph, PLATEAU_Y, 1 - smoothstep(6, 10, dg));
    h = lerp(h, ph, plat);
  }
  // The gorge of the Hollow Meridian beyond the gate ridge.
  const gorge = smoothstep(57, 66, z);
  if (gorge > 0) {
    const far = smoothstep(146, 166, z) * 150 + smoothstep(166, 260, z) * 60;
    const sides = smoothstep(44, 62, Math.abs(x - 4)) * 130 + Math.max(0, Math.abs(x - 4) - 62) * 0.8;
    h = lerp(h, -75 + far + sides + fbm2(x * 0.03, z * 0.03, 3) * 6, gorge);
  }
  return h;
}

/** Splat weights: [mud/path, grass, rock]. */
export function terrainSplat(x: number, z: number, h: number, slopeY: number): [number, number, number] {
  const dt = Math.min(distToPolyline(x, z, TRAIL), z > 26 ? distToPolyline(x, z, PLATEAU_PATH) : 99);
  const path = 1 - smoothstep(0.8, 2.6, dt);
  const camp = 1 - smoothstep(6, 12, Math.hypot(x - CAMP.x, z - CAMP.z));
  const bank = 1 - smoothstep(4, 11, Math.abs(z - riverZ(x)));
  const stream = 1 - smoothstep(1, 3.5, distToPolyline(x, z, STREAM));
  const rock = smoothstep(0.82, 0.6, slopeY) + (h > 22 ? 0.4 : 0) + (z > 56 ? 0.8 : 0);
  const mud = Math.max(path, camp * 0.8, bank * 0.9, stream * 0.8) + (fbm2(x * 0.08, z * 0.08, 2) > 0.35 ? 0.3 : 0);
  const grass = Math.max(0.05, 1 - mud) * (1 - Math.min(1, rock));
  return [mud, grass, rock];
}

/** Where vegetation may grow (0..1). Keeps paths, camp and landing clear. */
export function vegetationMask(x: number, z: number): number {
  const dt = distToPolyline(x, z, TRAIL);
  const dpp = z > 26 ? distToPolyline(x, z, PLATEAU_PATH) : 99;
  const clear = Math.min(smoothstep(2.2, 5, dt), smoothstep(2, 4.5, dpp));
  const camp = smoothstep(11, 16, Math.hypot(x - CAMP.x, z - CAMP.z));
  const land = smoothstep(7, 12, Math.hypot(x - LANDING.x, z - LANDING.z));
  const river = smoothstep(5, 9, Math.abs(z - riverZ(x)));
  const stream = smoothstep(1.2, 2.5, distToPolyline(x, z, STREAM));
  const pool = smoothstep(4.5, 7, Math.hypot(x - POOL.x, z - POOL.z));
  const cliff = z > 21 && z < 27.5 ? 0 : 1;
  const plaza = z > 38 ? smoothstep(7, 11, Math.hypot(x - GATE.x, z - 46)) : 1;
  const gorge = z > 53 ? 0 : 1;
  return clear * camp * land * river * stream * pool * cliff * plaza * gorge;
}

// ------------------------------------------------------------------ checkpoints
export const CHECKPOINTS: Record<string, CheckpointDef> = {
  ch1_landing: { pos: LANDING.clone(), yaw: 0.05, label: 'The river landing' },
  ch1_camp: { pos: v(2.6, 0, -19.5), yaw: 0.1, label: 'Camp Four' },
  ch1_cliff_base: { pos: v(10, 0, 18.6), yaw: 0, label: 'The red-rock cliff' },
  ch1_cliff_top: { pos: v(25.4, PLATEAU_Y, 26.2), yaw: -0.7, label: 'The ridge' },
  ch1_gate_open: { pos: v(4, PLATEAU_Y, 47.4), yaw: 0, label: 'Gate of the Watching Sun' },
};

// ------------------------------------------------------------------ cliff route
export const N = v(0, 0, -1); // cliff faces south

/** Collider boxes for the cliff: [center, half]. Visuals are dressed on top of these. */
export const CLIFF_BOXES: { c: THREE.Vector3; h: THREE.Vector3; kind: 'face' | 'shelf' | 'step' }[] = [
  { c: v(-11.5, 6, 24.9), h: v(18.5, 6, 2.3), kind: 'face' }, // east of the route (x -30..7)
  { c: v(10, 2.3, 24.9), h: v(3, 2.3, 2.3), kind: 'face' }, // W1 lower wall with climb A (x 7..13)
  { c: v(16.5, 8.3, 25.5), h: v(14.5, 3.7, 1.7), kind: 'face' }, // W2 upper cliff (x 2..31, z 23.8..27.2)
  { c: v(23.5, 2.3, 25.5), h: v(10.5, 2.3, 1.7), kind: 'face' }, // below narrow ledge & stairs (x 13..34)
  { c: v(32.5, 6, 24.9), h: v(1.5, 6, 2.3), kind: 'face' }, // west end (x 31..34)
  { c: v(38, 8, 25), h: v(4.5, 8, 3), kind: 'face' }, // join into the valley wall
  { c: v(-34, 8, 25), h: v(4.5, 8, 3), kind: 'face' },
  // Narrow ledge (0.45 m) along W2 from the shelf to the stair
  { c: v(16.3, 2.3, 23.575), h: v(3.3, 2.3, 0.225), kind: 'shelf' },
  // Rock infill beneath the stair (a fall into the gap is survivable and recoverable)
  { c: v(25.1, 2.3, 23.25), h: v(5.5, 2.3, 0.55), kind: 'face' },
  // Broken Ysharu stair (x 19.6 → 22.8), gap, landing block, final steps, P2 landing
  { c: v(20.0, 4.79, 23.3), h: v(0.4, 0.19, 0.5), kind: 'step' },
  { c: v(20.8, 5.17, 23.3), h: v(0.4, 0.19, 0.5), kind: 'step' },
  { c: v(21.6, 5.55, 23.3), h: v(0.4, 0.19, 0.5), kind: 'step' },
  { c: v(22.4, 5.93, 23.3), h: v(0.4, 0.19, 0.5), kind: 'step' },
  // -- gap 22.8 .. 25.0 --
  { c: v(25.5, 6.25, 23.3), h: v(0.5, 0.25, 0.5), kind: 'step' },
  { c: v(26.2, 6.69, 23.3), h: v(0.2, 0.19, 0.5), kind: 'step' },
  { c: v(26.6, 7.07, 23.3), h: v(0.2, 0.19, 0.5), kind: 'step' },
  { c: v(27.0, 7.45, 23.3), h: v(0.2, 0.19, 0.5), kind: 'step' },
  { c: v(27.4, 7.83, 23.3), h: v(0.2, 0.19, 0.5), kind: 'step' },
  { c: v(29.1, 8.2, 23.25), h: v(1.5, 0.2, 0.55), kind: 'step' }, // P2 landing (top 8.4)
  // Blocking boulders on the ridge top above ledge B (forces the shimmy)
  { c: v(28.7, 12.9, 24.8), h: v(2.3, 0.9, 1.0), kind: 'face' },
];

/** Support pillars beneath stair blocks (visual + collision under the floating steps). */
export const STAIR_SUPPORT_BELOW = true;

export const CLIMB_A = makeClimb('climbA', v(10, 0, 22.6), N, 3.0, 4.6, 'ledgeA');
export const LEDGE_A = makeLedge('ledgeA', v(11.5, 4.6, 22.6), v(8.5, 4.6, 22.6), N, 'all', 'climbA');
export const CLIMB_B = makeClimb('climbB', v(28.8, 8.4, 23.8), N, 2.2, 3.6, 'ledgeB');
// Ledge B runs a (x=30.4) -> b (x=24.2); climb-up only where the boulders leave a gap.
export const LEDGE_B = makeLedge('ledgeB', v(30.4, 12, 23.8), v(24.2, 12, 23.8), N, [[4.1, 5.8]], 'climbB');

export const TRAVERSAL: TraversalSet = {
  climbs: [CLIMB_A, CLIMB_B],
  ledges: [LEDGE_A, LEDGE_B],
  narrows: [{ id: 'narrow1', a: v(12.1, 4.6, 23.5), b: v(19.75, 4.6, 23.5), normal: N.clone() }],
  vaults: [{ id: 'column', center: v(21.2, PLATEAU_Y + 0.5, 31.2), half: v(2.4, 0.5, 0.45), yaw: 0.62 }],
  jumps: [{ id: 'stairGap', from: v(22.35, 6.12, 23.3), fromRadius: 0.9, to: v(25.4, 6.5, 23.3) }],
};

// ------------------------------------------------------------------ gate & puzzle
/** Drums left→right as the player faces the gate (north). Left is +X (west, the setting sun). */
export const DRUMS = [
  { x: 5.9, solution: 2, initial: 0 }, // left  — Setting
  { x: 4.0, solution: 1, initial: 3 }, // middle — Open Eye
  { x: 2.1, solution: 0, initial: 2 }, // right — Rising (right hand, east)
];
export const DRUM_Z = 46.4;

export const MENU_PATH = [-26, -15, -4, 7, 18].map((x, i) => v(x, 5.5 + i * 1.2, riverZ(x) + 1.5));
export const MENU_LOOK = [v(-6, 6, -30), v(0, 8, -16), v(4, 11, 12), v(4, 14, 48)];
