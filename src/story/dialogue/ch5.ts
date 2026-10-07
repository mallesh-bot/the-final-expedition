import type { Line } from '../Dialogue';

/** Chapter 5 — THE FINAL EXPEDITION. STORY_BIBLE §12 voice, §14.6–14.7 (recording is canon). */
export const CH5 = {
  intro: [
    { speaker: 'INES', text: "Water. Knee deep. Cold." },
    { speaker: 'INES', text: "Marta said the lower passage floods. She'd know." },
  ] as Line[],
  antechamber: [{ speaker: 'INES', text: 'Someone lived down here. Not for long. Long enough.' }] as Line[],
  recorder: [{ speaker: 'INES', text: "A reel-to-reel. Wrapped in oilcloth. There's still tape on it." }] as Line[],
  // STORY_BIBLE §14.7 — verbatim, split for subtitles.
  recording: [
    { speaker: 'MARTA', text: 'This is Marta Kovač. It is the twenty-first of June, 1979, a little before noon.', duration: 6 },
    { speaker: 'MARTA', text: 'The light is coming down the shaft the way it always does — like someone lowering a rope.', duration: 6 },
    { speaker: 'MARTA', text: "I came back to check the seal. It holds. Hollis would be pleased; he never trusted anything he hadn't measured twice.", duration: 7 },
    { speaker: 'MARTA', text: 'If you are hearing this, you came through the gate, so you understand the drums. Then understand this as well.', duration: 6.5 },
    { speaker: 'MARTA', text: 'In June of 1958 Edmund Aldercott tried to take the Lens out of the Sunlock. He knew what it held back. Hollis had read him the wall. He did it anyway.', duration: 8 },
    { speaker: 'MARTA', text: 'We stopped him. Hollis brought the stair down behind him so he could not come back with men and ropes. We let him go.', duration: 7 },
    { speaker: 'MARTA', text: 'We did not think he would tell the world we were dead. Then we understood it was the kindest lie anyone could tell: nobody digs for the dead.', duration: 8 },
    { speaker: 'MARTA', text: 'So we stayed. Anselm, Pilar, Teodor, Hollis and I. Tamsa Alta took us in.', duration: 6 },
    { speaker: 'MARTA', text: 'Lena. My Lena. You are twenty-four now. I wrote to you once. I don\'t know if Vesna gave it to you.', duration: 7 },
    { speaker: 'MARTA', text: 'I hope you were angry with me — angry is better than sad, and it lasts less long.', duration: 6 },
    { speaker: 'MARTA', text: 'I did not stay away because I stopped loving you. I stayed away because forty thousand people live downriver, and somebody had to keep a promise none of them will ever know about.', duration: 9 },
    { speaker: 'MARTA', text: 'Whoever you are: put it back if you moved it. Close the gate behind you. And if you see the light come down at noon — stand still a minute. It\'s worth it. — M.', duration: 9 },
  ] as Line[],
  corwinBreaks: [
    { speaker: 'CORWIN', text: '…He knew.' },
    { speaker: 'CORWIN', text: 'All my life I thought they ruined him. He ruined them. And then he let the world call them dead.' },
    { speaker: 'INES', text: 'Now you know.' },
    { speaker: 'CORWIN', text: "Now I know. Dace came down ahead of me. He has charges left. I told him to wait." },
    { speaker: 'INES', text: "Did he ever?" },
    { speaker: 'CORWIN', text: '…No.' },
  ] as Line[],
  dace: [
    { speaker: 'DACE', text: 'There it is. All that fuss over a bit of glass.' },
    { speaker: 'CORWIN', text: 'Dace. Put it back. Now.' },
    { speaker: 'DACE', text: "You stopped paying me ten minutes ago, boss. I'm paying myself." },
    { speaker: 'INES', text: 'Listen. The whole mountain just shifted.' },
    { speaker: 'CORWIN', text: 'DACE!' },
    { speaker: 'TOBY', text: "Ines! I'm here — I came down the shaft — I'm on a rope. Don't look at me. I'm on a rope." },
    { speaker: 'INES', text: 'Toby. The high mirror beside you. When I call, turn it.' },
    { speaker: 'TOBY', text: 'Turn the giant ancient bronze mirror. While hanging over a pit. Yes. Fine. Good.' },
    { speaker: 'CORWIN', text: "I've got the counterweight. It won't hold long. Put it back, Ms. Kovač." },
  ] as Line[],
  pickLens: [{ speaker: 'INES', text: "Heavier than it looks. Nine facets. One missing." }] as Line[],
  seated: [
    { speaker: 'INES', text: "It's in. The light's splitting three ways." },
    { speaker: 'TOBY', text: 'Three beams — three houses! Rising, the Eye, Setting. Each mirror has to send its beam home.' },
  ] as Line[],
  callToby: [
    [{ speaker: 'INES', text: 'Toby — turn it!' }, { speaker: 'TOBY', text: 'Turning! Turning. Oh, that was a big creak.' }],
    [{ speaker: 'INES', text: 'Again!' }, { speaker: 'TOBY', text: 'Again. Yes. Absolutely. Again.' }],
    [{ speaker: 'INES', text: 'Once more!' }, { speaker: 'TOBY', text: "I'm turning it! I'm a turner now!" }],
  ] as Line[][],
  warn: [
    [{ speaker: 'CORWIN', text: "The water's over the channels!" }],
    [{ speaker: 'TOBY', text: "It's at the dais, Ines! It's — it's coming up fast!" }],
    [{ speaker: 'CORWIN', text: "Thirty seconds — I can't hold it!" }],
  ] as Line[][],
  plateLit: [{ speaker: 'TOBY', text: "That's one house home!" }] as Line[],
  solved: [
    { speaker: 'CORWIN', text: "It's settling. The counterweights — they're settling." },
    { speaker: 'TOBY', text: 'The light. Look at the light.' },
    { speaker: 'INES', text: 'Noon.' },
    { speaker: 'INES', text: 'Stand still a minute, Toby.' },
    { speaker: 'TOBY', text: "I'm on a rope, Ines." },
    { speaker: 'INES', text: 'I know. Stand still anyway.' },
  ] as Line[],
  leave: [
    { speaker: 'CORWIN', text: 'Marta said the lower passage. It floods to the waist.' },
    { speaker: 'INES', text: 'Then we get wet.' },
  ] as Line[],
  filmTin: [{ speaker: 'INES', text: '"For Lena." I\'ll get it developed, Mum.' }] as Line[],
  cord: [{ speaker: 'INES', text: 'Same knot as the ribbons. Of course it is.' }] as Line[],
  ending: [
    { speaker: 'TOBY', text: 'Is it over?' },
    { speaker: 'INES', text: "It's closed." },
    { speaker: 'CORWIN', text: "I'll tell them. All of it. The families deserve that much." },
    { speaker: 'INES', text: 'Tell them the truth. Leave out the map.' },
  ] as Line[],
  drowned: [{ speaker: 'INES', text: 'Again. Faster this time.' }] as Line[],
};
