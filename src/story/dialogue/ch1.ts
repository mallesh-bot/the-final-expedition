import type { Line } from '../Dialogue';

/** Chapter 1 — THE DISCOVERY. All lines follow STORY_BIBLE.md §3, §8, §12. */
export const CH1 = {
  intro: [
    { speaker: 'TOBY', text: "Sixty-eight years nobody finds this valley, and you walk in with a photocopy and a hunch." },
    { speaker: 'INES', text: 'A letter. In her handwriting. Dated three years after they buried an empty coffin.' },
    { speaker: 'TOBY', text: "Right. That. Well — I'll be here. Guarding the boat. Heroically." },
    { speaker: 'INES', text: 'Keep the radio on.' },
  ] as Line[],
  trail: [
    { speaker: 'INES', text: "Trail's been cut. Not recently..." },
    { speaker: 'INES', text: '...but not in 1958, either.' },
  ] as Line[],
  campReveal: [
    { speaker: 'INES', text: "Camp Four. It's all still here.", radio: true },
    { speaker: 'TOBY', text: "Define 'all'.", radio: true },
    { speaker: 'INES', text: 'Tents. Crates. Dinner, apparently.', radio: true },
  ] as Line[],
  crates: [
    { speaker: 'INES', text: "Every crate's chalked. 'Do not ship.'", radio: true },
    { speaker: 'TOBY', text: 'Ominous chalk. My favourite kind.', radio: true },
  ] as Line[],
  theodolite: [
    { speaker: 'INES', text: "Anselm Roy's theodolite. Still sighted up the ridge." },
    { speaker: 'INES', text: 'They were measuring something up there.' },
  ] as Line[],
  journal1: [{ speaker: 'INES', text: 'Her handwriting.' }] as Line[],
  journal2: [
    { speaker: 'INES', text: 'She drew the gate. Rain got to most of it.' },
  ] as Line[],
  journal3: [{ speaker: 'INES', text: '"Your mother was stubborn for a reason."' }] as Line[],
  relic: [
    { speaker: 'INES', text: 'An eye. Nine notches — one filed away.', radio: true },
    { speaker: 'TOBY', text: "Don't lose that. Please. I'm begging you.", radio: true },
  ] as Line[],
  cliffBase: [
    { speaker: 'INES', text: 'Red cloth. Route markers, up the rock.', radio: true },
    { speaker: 'TOBY', text: 'From 1958?', radio: true },
    { speaker: 'INES', text: "...No. These knots are new. Someone's been keeping this route.", radio: true },
  ] as Line[],
  narrow: [{ speaker: 'TOBY', text: "Describe the drop. Actually, don't.", radio: true }] as Line[],
  cliffTop: [
    { speaker: 'INES', text: "I'm on the ridge.", radio: true },
    { speaker: 'TOBY', text: 'Anything?', radio: true },
  ] as Line[],
  gateReveal: [
    { speaker: 'INES', text: 'A gate. Carved. Three stone drums in front of it.', radio: true },
    { speaker: 'TOBY', text: 'Tell me there\'s writing.', radio: true },
    { speaker: 'INES', text: "There's writing.", radio: true },
    { speaker: 'TOBY', text: 'Oh, that is — read it to me. Slowly. Describe every scratch.', radio: true },
  ] as Line[],
  drumsHint: [
    { speaker: 'TOBY', text: 'Ysharu script runs right to left. They wrote the way they thought the sun walked.', radio: true },
  ] as Line[],
  initials: [{ speaker: 'INES', text: 'M.K.  ...She stood right here.' }] as Line[],
  mural: [{ speaker: 'INES', text: "The sun's path. Rising, the eye, setting... and a water-sign, scratched out." }] as Line[],
  hintSoft: [
    { speaker: 'TOBY', text: "Try it from her notes. Back to the valley — where does the sun rise?", radio: true },
  ] as Line[],
  hintStrong: [
    { speaker: 'INES', text: "Right hand, the rising sun. Then the eye. The setting sun on my left.", radio: false },
  ] as Line[],
  gateOpen: [
    { speaker: 'TOBY', text: 'Ines? What was that noise? Ines!', radio: true },
    { speaker: 'INES', text: "It's open.", radio: true },
  ] as Line[],
  cityReveal: [
    { speaker: 'INES', text: "Toby... there's a whole city down there.", radio: true },
    { speaker: 'TOBY', text: '...I think I need to sit down. I am sitting down. I need to sit down more.', radio: true },
  ] as Line[],
  tobyTalk: [
    [{ speaker: 'TOBY', text: "Go on. I'll keep the fire going. And the boat. And my nerve, mostly." }],
    [{ speaker: 'TOBY', text: "If you find writing, don't touch it. Photograph it. Then — fine — touch it a little." }],
    [{ speaker: 'TOBY', text: 'Heights, Ines. I have a condition. It is called sense.' }],
    [{ speaker: 'TOBY', text: 'Ines. Whatever she wrote in that letter... I hope it is up there.' }],
  ] as Line[][],
  fallRespawn: [{ speaker: 'TOBY', text: 'That sounded bad. Tell me that sounded worse than it was.', radio: true }] as Line[],
};
