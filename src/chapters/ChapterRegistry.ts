import type { ChapterEntry } from './Chapter';

/**
 * All chapters of the vertical slice. Chapter modules are lazy-loaded via dynamic import()
 * so only the chapter being played is downloaded/built.
 *
 * STUB: Chapters 2–5 are registry entries only. Their story content is locked in
 * STORY_BIBLE.md; gameplay is not implemented yet (scope lock until Chapter 1 is final).
 */
export const CHAPTERS: ChapterEntry[] = [
  { id: 1, numberLabel: 'CHAPTER ONE', title: 'THE DISCOVERY', stub: false, load: () => import('./ch1/Chapter1') },
  { id: 2, numberLabel: 'CHAPTER TWO', title: 'INTO THE UNKNOWN', stub: true },
  { id: 3, numberLabel: 'CHAPTER THREE', title: 'THE HIDDEN PATH', stub: true },
  { id: 4, numberLabel: 'CHAPTER FOUR', title: 'THE EXPEDITION', stub: true },
  { id: 5, numberLabel: 'CHAPTER FIVE', title: 'THE FINAL EXPEDITION', stub: true },
];

export function chapterEntry(id: number): ChapterEntry | undefined {
  return CHAPTERS.find((c) => c.id === id);
}
