import type { ChapterEntry } from './Chapter';

/**
 * Every chapter of the game, in order. Chapter modules are lazy-loaded via dynamic import()
 * so only the chapter being played is downloaded/built. Story content: STORY_BIBLE §8, §14.
 */
export const CHAPTERS: ChapterEntry[] = [
  { id: 1, numberLabel: 'CHAPTER ONE', title: 'THE DISCOVERY', stub: false, load: () => import('./ch1/Chapter1') },
  { id: 2, numberLabel: 'CHAPTER TWO', title: 'INTO THE UNKNOWN', stub: false, load: () => import('./ch2/Chapter2') },
  { id: 3, numberLabel: 'CHAPTER THREE', title: 'THE HIDDEN PATH', stub: false, load: () => import('./ch3/Chapter3') },
  { id: 4, numberLabel: 'CHAPTER FOUR', title: 'THE EXPEDITION', stub: false, load: () => import('./ch4/Chapter4') },
  { id: 5, numberLabel: 'CHAPTER FIVE', title: 'THE FINAL EXPEDITION', stub: false, load: () => import('./ch5/Chapter5') },
  { id: 6, numberLabel: 'EPILOGUE', title: 'TAMSA ALTA', stub: false, load: () => import('./epilogue/Epilogue') },
];

export const LAST_CHAPTER = CHAPTERS[CHAPTERS.length - 1].id;

export function chapterEntry(id: number): ChapterEntry | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** End-of-chapter card copy (shown between chapters). */
export const CHAPTER_OUTROS: Record<number, string> = {
  1: 'The Gate of the Watching Sun stands open. Below, in the mist, the Hollow Meridian waits — and someone has been keeping the path to it for sixty years.',
  2: "Four photographs, four dates, all after the avalanche that never was. Marta was alive in this city — and she wanted someone, one day, to know it.",
  3: '"So the sky would not drown the valley again." The Lens was never treasure. Somewhere below, a generator hums, and someone has been drilling.',
  4: 'The bridge is gone, the seal is breached, and the people she trusted are on the other side of the fall. Ines goes down alone.',
  5: 'The Sunlock holds. The Lens is where Marta left it. Three people walk out of the mountain carrying a secret none of them will ever sell.',
  6: 'For whoever comes next. Keep it closed.',
};
