import * as THREE from 'three';

/**
 * Authored traversal data. Levels place these explicitly (and dress them with ribbons,
 * pitons, pale worn stone) — traversal is never guessed from arbitrary geometry.
 */

export interface ClimbSurface {
  id: string;
  /** Bottom-left corner (left as seen by the player facing the wall). */
  origin: THREE.Vector3;
  /** Unit vector along the wall toward the player's right when facing it. */
  right: THREE.Vector3;
  /** Unit horizontal normal pointing out of the wall (toward the player). */
  normal: THREE.Vector3;
  width: number;
  height: number;
  /** Ledge at the top: climbing past the top transitions to hanging on it. */
  topLedge?: string;
}

export interface Ledge {
  id: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Horizontal outward normal (away from the wall). */
  normal: THREE.Vector3;
  /** Ranges [start, end] in meters along a→b where climbing up onto the top is possible. */
  climbUp: [number, number][];
  /** Climb surface directly beneath (pressing down while hanging climbs down onto it). */
  wallBelow?: string;
}

export interface NarrowLedge {
  id: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Wall normal (pointing away from the wall, toward the drop). */
  normal: THREE.Vector3;
}

export interface VaultBlock {
  id: string;
  center: THREE.Vector3;
  /** Half extents in the block's local frame (x = along obstacle, z = crossing direction). */
  half: THREE.Vector3;
  yaw: number;
}

export interface JumpLink {
  id: string;
  from: THREE.Vector3;
  fromRadius: number;
  to: THREE.Vector3;
}

export interface TraversalSet {
  climbs: ClimbSurface[];
  ledges: Ledge[];
  narrows: NarrowLedge[];
  vaults: VaultBlock[];
  jumps: JumpLink[];
}

export function makeClimb(
  id: string,
  bottomCenter: THREE.Vector3,
  normal: THREE.Vector3,
  width: number,
  height: number,
  topLedge?: string,
): ClimbSurface {
  const n = normal.clone().setY(0).normalize();
  const right = new THREE.Vector3(n.z, 0, -n.x);
  const origin = bottomCenter.clone().addScaledVector(right, -width / 2);
  return { id, origin, right, normal: n, width, height, topLedge };
}

export function makeLedge(
  id: string,
  a: THREE.Vector3,
  b: THREE.Vector3,
  normal: THREE.Vector3,
  climbUp: [number, number][] | 'all' = 'all',
  wallBelow?: string,
): Ledge {
  const len = a.distanceTo(b);
  return {
    id,
    a: a.clone(),
    b: b.clone(),
    normal: normal.clone().setY(0).normalize(),
    climbUp: climbUp === 'all' ? [[0, len]] : climbUp,
    wallBelow,
  };
}
