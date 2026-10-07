import type { Line } from '../Dialogue';

/** Epilogue — TAMSA ALTA. STORY_BIBLE §14.8–14.9 (letter and montage are canon). */
export const EP = {
  arrive: [{ speaker: 'INES', text: 'Tamsa Alta. Five weeks, three hospitals and one very long statement later.' }] as Line[],
  toby: [
    [
      { speaker: 'TOBY', text: '"A Grammar of the Ysharu Script." Four hundred pages. Not one map.' },
      { speaker: 'INES', text: 'Good.' },
      { speaker: 'TOBY', text: "My publisher hates it. I've never been happier." },
    ],
    [
      { speaker: 'TOBY', text: "Corwin sent every family a letter. Signed. His grandfather's diaries go out next month." },
      { speaker: 'INES', text: 'And Dace?' },
      { speaker: 'TOBY', text: "Found alive downriver. He won't talk about it. I think that's the most sensible thing he's ever done." },
    ],
    [
      { speaker: 'TOBY', text: "I'm sorry, Ines. I'll keep saying it until it's boring." },
      { speaker: 'INES', text: "It's getting there." },
    ],
  ] as Line[][],
  ayme: [
    { speaker: 'AYME', text: "You stand the way she stood. As if the ground owes you an explanation." },
    { speaker: 'INES', text: 'You knew her.' },
    { speaker: 'AYME', text: 'I carried bread up to the foreigners who stayed. I was nine. She taught me to hold a camera still.' },
    { speaker: 'AYME', text: 'She left this with my father, Teodor. "For whoever comes next," she said. "You will know them."' },
    { speaker: 'INES', text: '"For whoever comes next. Keep it closed."' },
    { speaker: 'INES', text: "It's closed." },
    { speaker: 'AYME', text: 'Good. Then come inside and eat. She would have made you eat.' },
  ] as Line[],
  montage: [
    { speaker: 'NARRATION', text: 'Dr Tobias Mensah-Reyes publishes "A Grammar of the Ysharu Script". The site is described only as "a valley in the Cordillera Velada".', duration: 7 },
    { speaker: 'NARRATION', text: 'Corwin Aldercott publishes his grandfather\'s diaries with a statement clearing the families of the 1958 expedition.', duration: 7 },
    { speaker: 'NARRATION', text: 'Dace Holloway was found alive by Tamsa Alta guides, eleven kilometres downriver. He has not spoken about the valley.', duration: 7 },
  ] as Line[],
  // STORY_BIBLE §14.8 — Marta's 1961 letter, read by Ines at Lena's grave.
  letter: [
    { speaker: 'INES', text: 'My darling Lena, you are six, and you will not remember me, and that is my fault.', duration: 6 },
    { speaker: 'INES', text: 'They will tell you I died in the mountains. Let them. It is safer than the truth, and the truth is not mine alone to tell.', duration: 7.5 },
    { speaker: 'INES', text: 'I am well. I am warm. I can see a river from my window, and every morning I think: that water reaches the sea, and the sea reaches you.', duration: 8 },
    { speaker: 'INES', text: 'Be stubborn. Be kind when it costs you something. One day I will explain.', duration: 6 },
    { speaker: 'INES', text: 'Until then — your mother, who has not stopped. — M.', duration: 6 },
  ] as Line[],
  cliff: [{ speaker: 'INES', text: 'The foot of the red-rock trail. Someone has to keep the knots new.' }] as Line[],
};
