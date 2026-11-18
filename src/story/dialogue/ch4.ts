import type { Line } from '../Dialogue';

/** Chapter 4 — THE EXPEDITION. STORY_BIBLE §12 voice, §14.5 beats. */
export const CH4 = {
  intro: [
    { speaker: 'TOBY', text: "Maybe they're archaeologists. Nice, quiet, underfunded archaeologists." },
    { speaker: 'INES', text: 'With a drill rig.' },
    { speaker: 'TOBY', text: '…Well-funded archaeologists.' },
  ] as Line[],
  confrontation: [
    { speaker: 'CORWIN', text: 'Dr. Mensah-Reyes. You made it. And this must be Ms. Kovač.' },
    { speaker: 'INES', text: 'You know his name.' },
    { speaker: 'CORWIN', text: 'I know everyone I pay.' },
    { speaker: 'INES', text: 'Toby.' },
    { speaker: 'TOBY', text: "Ines — it was a grant. It was supposed to be a grant. He only wanted the story, he said —" },
    { speaker: 'INES', text: 'The route. The radio. What else?' },
    { speaker: 'TOBY', text: '…The letter. A copy. I\'m sorry. I\'m so sorry.' },
    { speaker: 'CORWIN', text: "Don't be hard on him. Without Edmund's diaries I'd have the city and no door. Without you I'd have neither." },
    { speaker: 'CORWIN', text: 'My grandfather found the greatest site of the century and came home to be called a murderer. I intend to finish what he started.' },
    { speaker: 'INES', text: 'Read the inner wall. The Lens is holding back a lake. You take it out, San Rocín drowns.' },
    { speaker: 'CORWIN', text: 'A carving. A five-hundred-year-old metaphor.' },
    { speaker: 'INES', text: 'Varne didn\'t think so. Marta didn\'t. They stayed down here for the rest of their lives because of it.' },
    { speaker: 'CORWIN', text: 'Then they were wrong in the same way, and I\'ll prove it the same way they couldn\'t — by opening the sanctum.' },
    { speaker: 'DACE', text: "Charges are in on the upper seal, boss. Bridge is clear. Say the word." },
    { speaker: 'CORWIN', text: 'Give me twenty minutes with Ms. Kovač, Dace. Then the word.' },
  ] as Line[],
  afterConfrontation: [{ speaker: 'INES', text: "Twenty minutes. I'm not giving him twenty seconds." }] as Line[],
  tobyTalk: [
    [
      { speaker: 'TOBY', text: "I told myself he only wanted to write a book. I believed it because I needed to." },
      { speaker: 'INES', text: 'You gave him her letter, Toby.' },
    ],
    [
      { speaker: 'TOBY', text: "I'll tell him to stop. He won't listen to me. Nobody's ever listened to me except you." },
      { speaker: 'INES', text: "Then you should have listened to yourself." },
    ],
    [{ speaker: 'TOBY', text: '…' }],
  ] as Line[][],
  corwinTalk: [
    [
      { speaker: 'CORWIN', text: 'Your grandmother was declared dead. So was everyone on that expedition. Their families sued us into the ground.' },
      { speaker: 'INES', text: 'And now you want the city to say you were right.' },
    ],
    [
      { speaker: 'CORWIN', text: "I'm an engineer, Ms. Kovač. Sluices fail when they're neglected. I don't intend to neglect anything." },
      { speaker: 'INES', text: "You're about to set off explosives in a structure you don't understand." },
    ],
    [{ speaker: 'CORWIN', text: 'Nineteen minutes.' }],
  ] as Line[][],
  diary: [{ speaker: 'INES', text: '"I will not be forgotten." Well. You got that, Edmund.' }] as Line[],
  payment: [{ speaker: 'INES', text: 'Eighteen thousand pounds. For a route, a frequency, and a letter.' }] as Line[],
  charges: [{ speaker: 'INES', text: "Varne's own charge plan. So that's why the stair was gone." }] as Line[],
  datum: [{ speaker: 'INES', text: "Anselm Roy's benchmark. Polished. Someone still comes here." }] as Line[],
  daceLeaves: [{ speaker: 'DACE', text: "Boss says twenty minutes. I say I'll be on the bridge." }] as Line[],
  stopDace: [{ speaker: 'INES', text: 'Dace! Get away from that box!' }] as Line[],
  blast: [
    { speaker: 'DACE', text: "Stay back, love. It's just the job." },
    { speaker: 'CORWIN', text: 'Dace — not yet! DACE!' },
    { speaker: 'DACE', text: 'Fire in the hole.' },
  ] as Line[],
  run: [{ speaker: 'TOBY', text: 'INES! The bridge — run! Don\'t stop!' }] as Line[],
  gapAhead: [{ speaker: 'INES', text: 'Jump. Jump —' }] as Line[],
  climb: [{ speaker: 'INES', text: 'Up. Get up.' }] as Line[],
  rockfall: [{ speaker: 'INES', text: 'The whole wall is coming down —' }] as Line[],
  ledge: [{ speaker: 'INES', text: 'Ledge. Go.' }] as Line[],
  ending: [
    { speaker: 'TOBY', text: 'INES!' },
    { speaker: 'INES', text: "…I'm alive. Don't — don't come after me. You can't." },
    { speaker: 'TOBY', text: "I can see the camp from here. Corwin — Corwin's going down the other side. The sanctum." },
    { speaker: 'INES', text: 'Then so am I.' },
    { speaker: 'INES', text: "There's a ribbon on the rock below me. Red. Her knot." },
    { speaker: 'INES', text: 'A cut doorway under it, and water running out. Marta marked a way in.' },
  ] as Line[],
  fallRespawn: [{ speaker: 'INES', text: 'Not like that. Move.' }] as Line[],
};
