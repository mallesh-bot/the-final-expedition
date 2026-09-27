/** Minimal object pool to avoid per-frame allocations for short-lived objects. */
export class Pool<T> {
  private free: T[] = [];
  constructor(
    private readonly create: () => T,
    private readonly reset?: (item: T) => void,
    prefill = 0,
  ) {
    for (let i = 0; i < prefill; i++) this.free.push(create());
  }
  acquire(): T {
    return this.free.pop() ?? this.create();
  }
  release(item: T): void {
    this.reset?.(item);
    this.free.push(item);
  }
  get available(): number {
    return this.free.length;
  }
}
