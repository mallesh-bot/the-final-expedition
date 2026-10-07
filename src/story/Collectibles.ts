import { journalSketchDataURL } from '../render/textures/ProceduralTextures';
import { photoDataURL } from './PhotoArt';

export interface CollectibleDef {
  id: string;
  chapter: number;
  kind: 'journal' | 'relic' | 'photo' | 'document' | 'recording';
  title: string;
  /** Canon text — must match STORY_BIBLE §13 / §14. */
  text: string;
  image?: () => string;
}

/** Registry of all collectibles (content locked to the story bible). */
export const COLLECTIBLES: CollectibleDef[] = [
  // ------------------------------------------------------------ Chapter 1 (STORY_BIBLE §13)
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
  // ------------------------------------------------------------ Chapter 2 (§14.3)
  {
    id: 'ch2_plate_41',
    chapter: 2,
    kind: 'photo',
    title: 'Plate 41 — The Terrace Kitchens',
    text: 'A contact print, sepia, curling at one corner. Hollis, Anselm, Pilar and Teodor at a stone hearth, bowls in hand, squinting into morning light. Pencil on the sleeve: 9 June 1958. Breakfast in a city nobody has eaten in for five hundred years. — M.',
    image: () => photoDataURL('kitchens'),
  },
  {
    id: 'ch2_plate_43',
    chapter: 2,
    kind: 'photo',
    title: 'Plate 43 — The Inner Wall',
    text: 'Hollis on a ladder against a carved wall, a lamp in his teeth, copying glyphs into a notebook. Pencil on the sleeve: 11 June. He has not slept. He says the wall is not a prayer, it is an instruction. — M.',
    image: () => photoDataURL('wall'),
  },
  {
    id: 'ch2_plate_44',
    chapter: 2,
    kind: 'photo',
    title: 'Plate 44 — Edmund',
    text: 'Edmund at the rope bridge, half turned toward the camera, one hand raised to stop the shot. Pencil on the sleeve: 12 June. He asked me not to. I did it anyway. — M.',
    image: () => photoDataURL('edmund'),
  },
  {
    id: 'ch2_cache_note',
    chapter: 2,
    kind: 'journal',
    title: "Marta's Cache",
    text: 'Plates 41 to 44, developed in the dark of the sun-shaft. If these are ever found, someone will already have said we died on the fourth of June. Look at the dates. — M.',
  },
  // ------------------------------------------------------------ Chapter 3 (§14.4)
  {
    id: 'ch3_varne_notebook',
    chapter: 3,
    kind: 'document',
    title: 'Hollis Varne — Field Notebook',
    text: 'The mirrors are not decoration. Each chamber is a sentence, and the sun is the reader. Rising, the Open Eye, Setting — always from the right hand. Marta says I talk about light the way Edmund talks about money. She is not wrong. — H.V., 30 May 1958',
  },
  {
    id: 'ch3_journal_mirrors',
    chapter: 3,
    kind: 'journal',
    title: "Marta's Journal — The Mirror Halls",
    text: 'Hollis polished the first mirror with his sleeve and the whole hall woke up. I have never photographed anything so quickly in my life. Edmund asked how much bronze there was. — M.',
  },
  {
    id: 'ch3_survey_tag',
    chapter: 3,
    kind: 'document',
    title: 'Survey Tag — BH-07',
    text: 'A plastic sample tag zip-tied to a drill-hole marker: ALDERCOTT SURVEY LTD · BH-07 · CHARGE POINT · 2026. The dust on it is days old, not decades.',
  },
  {
    id: 'ch3_relic_lightglass',
    chapter: 3,
    kind: 'relic',
    title: 'Ysharu Light-Glass',
    text: "A thumb-sized lens of clear rock crystal, ground so precisely it throws a perfect point of light. Too small to be the Lens. Practice, maybe — or a student's.",
  },
  // ------------------------------------------------------------ Chapter 4 (§14.5)
  {
    id: 'ch4_edmund_diary',
    chapter: 4,
    kind: 'document',
    title: 'Sir Edmund Aldercott — Diary',
    text: '3 June 1958. Varne calls it a keystone. I call it proof. A crystal the size of a dinner plate, set in bronze, and he wants to leave it where it is because of a carving. Men like Varne die poor and are forgotten. I will not be forgotten. — E.A.',
  },
  {
    id: 'ch4_payment',
    chapter: 4,
    kind: 'document',
    title: 'Payment Advice — Aldercott Survey Ltd.',
    text: 'Payee: Dr T. Mensah-Reyes. Description: route consultancy, Sael valley, river landing to ridge; radio frequency schedule; copy of private letter (Kovač, 1961). Amount: £18,000. Status: PAID.',
  },
  {
    id: 'ch4_varne_charges',
    chapter: 4,
    kind: 'document',
    title: 'Hollis Varne — Charge Schedule',
    text: 'Six charges under the overlook stair, below the gate. Bring it down behind him; leave the gate standing. Edmund never learned the drums. Without them he will not find the way back, and the guides will not take him. God forgive me for the rest. — H.V., 17 June 1958',
  },
  {
    id: 'ch4_relic_datum',
    chapter: 4,
    kind: 'relic',
    title: 'Brass Datum Disc',
    text: "A survey benchmark hammered into the bridge abutment: A.R. 1958. Anselm Roy marked the bridge's height. Someone has polished it since.",
  },
  // ------------------------------------------------------------ Chapter 5 (§14.6, §14.7)
  {
    id: 'ch5_recording',
    chapter: 5,
    kind: 'recording',
    title: "Marta's Recording — 1979",
    text:
      "This is Marta Kovač. It is the twenty-first of June, 1979, a little before noon. The light is coming down the shaft the way it always does — like someone lowering a rope. I came back to check the seal. It holds. Hollis would be pleased; he never trusted anything he hadn't measured twice. If you are hearing this, you came through the gate, so you understand the drums. Then understand this as well. In June of 1958 Edmund Aldercott tried to take the Lens out of the Sunlock. He knew what it held back. Hollis had read him the wall. He did it anyway. We stopped him. Hollis brought the stair down behind him so he could not come back with men and ropes. We let him go. We did not think he would tell the world we were dead. Then we understood it was the kindest lie anyone could tell: nobody digs for the dead. So we stayed. Anselm, Pilar, Teodor, Hollis and I. Tamsa Alta took us in. Lena. My Lena. You are twenty-four now. I wrote to you once. I don't know if Vesna gave it to you. I hope you were angry with me — angry is better than sad, and it lasts less long. I did not stay away because I stopped loving you. I stayed away because forty thousand people live downriver, and somebody had to keep a promise none of them will ever know about. Whoever you are: put it back if you moved it. Close the gate behind you. And if you see the light come down at noon — stand still a minute. It's worth it. — M.",
  },
  {
    id: 'ch5_film_tin',
    chapter: 5,
    kind: 'relic',
    title: 'Film Tin — "For Lena"',
    text: 'Marta\'s last roll, never developed. The label: "Sanctum, 1979. For Lena." Ines puts it inside her jacket, next to the letter.',
  },
  {
    id: 'ch5_relic_cord',
    chapter: 5,
    kind: 'relic',
    title: 'Knotted Cord',
    text: 'A length of red cloth on a brass ring, knotted the same way as the ribbons on the cliff. Left here, not lost.',
  },
  // ------------------------------------------------------------ Epilogue (§14.9)
  {
    id: 'ep_photo_gate',
    chapter: 6,
    kind: 'photo',
    title: 'The Sealed Gate, 1979',
    text: "Marta's photograph of the Gate of the Watching Sun, closed. On the back, in the same handwriting as the letter: For whoever comes next. Keep it closed. — M.",
    image: () => photoDataURL('gate'),
  },
];

export function collectible(id: string): CollectibleDef | undefined {
  return COLLECTIBLES.find((c) => c.id === id);
}

export function chapterCollectibles(chapter: number): CollectibleDef[] {
  return COLLECTIBLES.filter((c) => c.chapter === chapter);
}

export const KIND_LABEL: Record<CollectibleDef['kind'], string> = {
  journal: 'Journal',
  relic: 'Relic',
  photo: 'Photograph',
  document: 'Document',
  recording: 'Recording',
};
