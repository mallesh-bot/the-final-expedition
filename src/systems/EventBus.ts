type Handler<T> = (payload: T) => void;

/** Game-wide typed events. Add new events here so every emitter/listener stays type-checked. */
export interface GameEvents {
  'checkpoint:reached': { id: string; label?: string };
  'collectible:found': { id: string; title: string };
  'puzzle:solved': { id: string };
  'puzzle:changed': { id: string };
  'player:landed': { fallHeight: number; surface: string };
  'player:footstep': { surface: string; intensity: number };
  'player:died': { reason: string };
  'traversal:grab': { kind: string };
  'cinematic:start': { id: string };
  'cinematic:end': { id: string; skipped: boolean };
  'chapter:loaded': { id: number };
  'chapter:complete': { id: number };
  'settings:changed': Record<string, never>;
  'quality:changed': { tier: string };
  'game:paused': { paused: boolean };
  'ui:click': Record<string, never>;
  'ui:hover': Record<string, never>;
}

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
