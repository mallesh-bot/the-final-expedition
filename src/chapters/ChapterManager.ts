import type { Chapter, ChapterContext } from './Chapter';
import { chapterEntry } from './ChapterRegistry';
import { cloneSnapshot, emptySnapshot, type Snapshot } from '../state/Snapshot';
import type { SaveManager } from '../save/SaveManager';

/**
 * Owns chapter lifecycle: lazy load/unload, asset acquire/release, checkpoint snapshots,
 * respawn, autosave, chapter transitions, audio + cinematic state on restore.
 */
export class ChapterManager {
  current: Chapter | null = null;
  private checkpointSnapshot: Snapshot | null = null;
  private respawning = false;
  onProgress: (f: number, label: string) => void = () => {};
  onChapterComplete: ((id: number) => void) | null = null;

  constructor(
    private ctx: ChapterContext,
    private saves: SaveManager,
    private saveLabel: () => string,
  ) {}

  get loadedId(): number | null {
    return this.current?.id ?? null;
  }

  /** Load a chapter module (lazy) and build it. No-op if already loaded. */
  async ensureLoaded(id: number): Promise<Chapter> {
    if (this.current?.id === id) return this.current;
    const entry = chapterEntry(id);
    if (!entry || entry.stub || !entry.load) throw new Error(`Chapter ${id} is not playable (stub)`);
    await this.unload();
    this.onProgress(0.02, 'Loading chapter');
    const mod = await entry.load();
    const ch = new mod.default();
    const { streaming } = await this.ctx.assets.loadManifest(ch.manifest, (l, t, label) => this.onProgress(0.05 + 0.6 * (l / t), label));
    await ch.load(this.ctx, (f, label) => this.onProgress(0.65 + 0.35 * f, label));
    void streaming;
    this.current = ch;
    this.ctx.events.emit('chapter:loaded', { id });
    return ch;
  }

  async unload(): Promise<void> {
    if (!this.current) return;
    const ch = this.current;
    this.current = null;
    ch.dispose();
    this.ctx.interaction.clear();
    this.ctx.traversal.clear();
    this.ctx.world.clear();
    this.ctx.audio.ambience.stop();
    this.ctx.assets.releaseManifest(ch.manifest.id);
    this.ctx.assets.disposeUnused();
  }

  /** Start a chapter fresh (new game or next chapter). */
  startNew(): void {
    const ch = this.current!;
    const snap = emptySnapshot(ch.id, ch.firstCheckpoint);
    this.ctx.state.restore(snap);
    ch.onRestored(ch.firstCheckpoint, true);
    this.checkpointSnapshot = this.ctx.state.capture();
    this.saves.write('auto', this.checkpointSnapshot, this.saveLabel());
    ch.begin(true);
  }

  /** Continue from a saved snapshot. */
  continueFrom(s: Snapshot): void {
    const ch = this.current!;
    this.ctx.state.restore(s);
    const cp = ch.checkpoints[s.checkpoint] ? s.checkpoint : ch.firstCheckpoint;
    ch.onRestored(cp, false);
    // Respawns go back to the checkpoint state, not the exact manual-save position.
    this.checkpointSnapshot = cloneSnapshot(s);
    delete this.checkpointSnapshot.systems.player;
    ch.begin(false);
  }

  reachCheckpoint(id: string): void {
    const ch = this.current;
    if (!ch || !ch.checkpoints[id]) return;
    const p = this.ctx.state.progress;
    if (p.checkpoint === id) return;
    p.checkpoint = id;
    this.checkpointSnapshot = this.ctx.state.capture();
    delete this.checkpointSnapshot.systems.player;
    this.saves.write('auto', this.ctx.state.capture(), this.saveLabel());
    this.ctx.events.emit('checkpoint:reached', { id, label: ch.checkpoints[id].label });
  }

  /** Fade out, restore the last checkpoint snapshot, fade in. */
  async respawn(): Promise<void> {
    if (this.respawning || !this.current || !this.checkpointSnapshot) return;
    this.respawning = true;
    await this.ctx.hud.fade(true, 0.9);
    const snap = cloneSnapshot(this.checkpointSnapshot);
    // Keep collectibles found since the checkpoint (never take pickups away).
    const found = new Set([...snap.collectibles, ...this.ctx.state.progress.collectibles]);
    snap.collectibles = [...found];
    snap.playtimeSec = this.ctx.state.progress.playtimeSec;
    this.ctx.state.restore(snap);
    this.current.onRestored(snap.checkpoint, false);
    await new Promise((r) => setTimeout(r, 250));
    await this.ctx.hud.fade(false, 0.9);
    this.respawning = false;
  }

  completeChapter(): void {
    const ch = this.current;
    if (!ch) return;
    const p = this.ctx.state.progress;
    p.setFlag(`ch${ch.id}_complete`);
    p.chapter = ch.id + 1;
    p.checkpoint = `ch${ch.id + 1}_start`;
    this.saves.write('auto', this.ctx.state.capture(), this.saveLabel());
    this.ctx.events.emit('chapter:complete', { id: ch.id });
    this.onChapterComplete?.(ch.id);
  }
}
