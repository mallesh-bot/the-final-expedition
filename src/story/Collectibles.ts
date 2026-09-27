import { journalSketchDataURL } from '../render/textures/ProceduralTextures';

export interface CollectibleDef {
  id: string;
  chapter: number;
  kind: 'journal' | 'relic';
  title: string;
  /** Canon text — must match STORY_BIBLE §13. */
  text: string;
  image?: () => string;
}

/** Registry of all collectibles (content locked to the story bible). */
export const COLLECTIBLES: CollectibleDef[] = [
  {
    id: 'ch1_journal_1',
    chapter: 1,
    kind: 'journal',
    title: "Marta's Journal — Camp Four",
    text:
      '14 May 1958. Camp Four. Hollis says three more days to the ridge. Edmund counts the crates every evening as if they were already full. The porters will not go past the red rock, and I don\'t blame them — the mist here has weight. — M.',
  },
  {
    id: 'ch1_journal_2',
    chapter: 1,
    kind: 'journal',
    title: "Marta's Journal — The Watching Sun",
    text:
      "The gate reads as the sun walks. Stand with your back to the valley and it rises at your right hand, climbs to the Watcher's open eye, and sets at your left. Three drums, three houses. Hollis says the water-sign is a lie told to strangers. I drew what I could before the light went. — M.",
    image: journalSketchDataURL,
  },
  {
    id: 'ch1_journal_3',
    chapter: 1,
    kind: 'journal',
    title: "Marta's Journal — Do Not Ship",
    text:
      '2 June. Edmund chalked every crate DO NOT SHIP after Hollis read the inner wall. Nothing is to be recorded until he has "secured the find". I am photographing everything anyway. Lena, if you ever read this — your mother was stubborn for a reason. — M.',
  },
  {
    id: 'ch1_relic_token',
    chapter: 1,
    kind: 'relic',
    title: 'Ysharu Sun Token',
    text: 'A bronze disc stamped with a single open eye. Nine notches around the rim; one has been filed smooth.',
  },
];

export function collectible(id: string): CollectibleDef | undefined {
  return COLLECTIBLES.find((c) => c.id === id);
}
