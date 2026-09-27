/**
 * Every stateful gameplay system implements Persistable and registers itself with the
 * StateRegistry. Checkpoints and saves are simply snapshots of all registered systems.
 *
 * Rules:
 *  - serialize() returns plain JSON-safe data (no class instances, no THREE objects).
 *  - restore() must tolerate missing/partial data (older saves) and fall back to defaults.
 *  - bump `version` when the shape changes and handle old versions inside restore().
 */
export interface Persistable<T = unknown> {
  readonly key: string;
  readonly version: number;
  serialize(): T;
  restore(data: T | undefined, version: number): void;
}

export interface SystemRecord {
  v: number;
  data: unknown;
}
