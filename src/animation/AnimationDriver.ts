/** Logical animation states. Gameplay speaks only in these; drivers map them to clips. */
export type AnimState =
  | 'IDLE'
  | 'WALK'
  | 'RUN'
  | 'SPRINT'
  | 'JUMP'
  | 'FALL'
  | 'LAND'
  | 'CLIMB'
  | 'HANG'
  | 'SHIMMY'
  | 'CLIMB_UP'
  | 'LEDGE'
  | 'LEDGE_IDLE'
  | 'VAULT'
  | 'INTERACT'
  | 'PUSH'
  | 'CINEMATIC'
  | 'SIT'
  | 'TALK';

export const LOCOMOTION_STATES: AnimState[] = ['IDLE', 'WALK', 'RUN', 'SPRINT'];

export interface AnimParams {
  /** Horizontal speed in m/s (drives locomotion blend + cadence). */
  speed: number;
  /** Signed playback rate for directional loops (climb up/down, shimmy/ledge left/right). */
  rate: number;
}

export interface AnimationDriver {
  readonly state: AnimState;
  /** Crossfade to a state. `fade` in seconds. One-shot states fire onDone when finished. */
  setState(state: AnimState, opts?: { fade?: number; restart?: boolean; onDone?: () => void }): void;
  update(dt: number, params: AnimParams): void;
  /** Normalized locomotion phase (0..1) for footstep sync. */
  readonly gaitPhase: number;
  dispose(): void;
}
