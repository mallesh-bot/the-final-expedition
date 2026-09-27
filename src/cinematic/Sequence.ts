import type * as THREE from 'three';

export type V3Source = THREE.Vector3 | (() => THREE.Vector3);

export interface Shot {
  t0: number;
  t1: number;
  /** Camera positions along the shot (≥2 → Catmull-Rom path). */
  path: V3Source[];
  /** Look targets (≥1; interpolated linearly along the shot). */
  look: V3Source[];
  fov?: [number, number];
  ease?: 'linear' | 'inOut' | 'out' | 'in';
  /** Focus distance override for DOF; default = distance to look target. */
  focus?: number;
  /** Per-shot handheld sway amount. */
  sway?: number;
}

export interface SequenceEvent {
  t: number;
  run: (skipped: boolean) => void;
  /** If true (default) the event is still executed (with skipped=true) when the player skips. */
  onSkip?: boolean;
}

export interface Sequence {
  id: string;
  duration: number;
  skippable: boolean;
  letterbox: boolean;
  shots: Shot[];
  events: SequenceEvent[];
  /** Seconds to blend from the last shot back to the gameplay camera. */
  blendOut: number;
  /** Gameplay camera yaw to hand back to (default: keep). */
  exitYaw?: () => number;
  exitPitch?: number;
  /** Keep player input disabled until blend completes (default true). */
  lockDuringBlend?: boolean;
  dof?: boolean;
}
