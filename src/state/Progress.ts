/**
 * Top-level story progression. Lives outside individual systems because the save format
 * exposes it directly (chapter, checkpoint, puzzles, collectibles, flags).
 */
export class Progress {
  chapter = 1;
  checkpoint = '';
  completedPuzzles = new Set<string>();
  collectibles = new Set<string>();
  storyFlags: Record<string, boolean> = {};
  playtimeSec = 0;

  flag(name: string): boolean {
    return !!this.storyFlags[name];
  }
  setFlag(name: string, value = true): void {
    this.storyFlags[name] = value;
  }
  reset(chapter = 1, checkpoint = ''): void {
    this.chapter = chapter;
    this.checkpoint = checkpoint;
    this.completedPuzzles.clear();
    this.collectibles.clear();
    this.storyFlags = {};
    this.playtimeSec = 0;
  }
}
