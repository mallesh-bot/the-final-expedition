import type { Line } from '../Dialogue';

/** Chapter 3 — THE HIDDEN PATH. STORY_BIBLE §12 voice, §14.4 beats. */
export const CH3 = {
  intro: [
    { speaker: 'INES', text: "I'm in. It's dark — no. It's not dark. It's aimed.", radio: true },
    { speaker: 'TOBY', text: "Aimed? Light doesn't get aimed. Light just… arrives.", radio: true },
    { speaker: 'INES', text: 'Not in here.', radio: true },
  ] as Line[],
  hall1: [
    { speaker: 'INES', text: 'A slit in the wall. A bronze mirror on a pivot. And a sun carved on the far wall.' },
    { speaker: 'INES', text: 'Point one at the other.' },
  ] as Line[],
  hall1Solved: [{ speaker: 'INES', text: "There. The Rising House. And — that's a door." }] as Line[],
  tobyArrives: [
    { speaker: 'TOBY', text: 'I did it. I did the rope. Nobody speak to me for at least a minute.' },
    { speaker: 'INES', text: 'You did well.' },
    { speaker: 'TOBY', text: "I said nobody speak to me." },
    { speaker: 'TOBY', text: '…Oh. Oh, look at the walls. Ines, look at the walls.' },
  ] as Line[],
  notebook: [{ speaker: 'INES', text: "Hollis Varne's notebook. 'Each chamber is a sentence.'" }] as Line[],
  bootprints: [
    { speaker: 'INES', text: 'Boot prints. Vibram soles. Size forty-five, maybe.', radio: false },
    { speaker: 'TOBY', text: "Those aren't 1958 boots." },
    { speaker: 'INES', text: 'No. These are from this week.' },
  ] as Line[],
  bootprintsSolo: [{ speaker: 'INES', text: 'Boot prints. Modern soles. From this week.' }] as Line[],
  drill: [
    { speaker: 'INES', text: 'Someone drilled this. Clean hole, tungsten bit, charge-sized.' },
    { speaker: 'TOBY', text: 'Charge as in… explosive charge?' },
    { speaker: 'INES', text: "It's tagged. Aldercott Survey." },
    { speaker: 'TOBY', text: "…Aldercott. As in Sir Edmund Aldercott? That's — that's a coincidence. Surely." },
  ] as Line[],
  drillSolo: [{ speaker: 'INES', text: "A drilled charge-hole. Tagged 'Aldercott Survey'. 2026." }] as Line[],
  journal: [{ speaker: 'INES', text: '"Edmund asked how much bronze there was." Of course he did.' }] as Line[],
  lightglass: [{ speaker: 'INES', text: "A lens. Rock crystal, ground by hand. Too small to be what they're guarding." }] as Line[],
  hall2: [
    { speaker: 'TOBY', text: 'Three houses. Rising, the Open Eye, Setting. The Watcher walks from your right hand…' },
    { speaker: 'INES', text: '…so you wake them right to left. In order.' },
    { speaker: 'TOBY', text: 'And that one — the wavy line — is the water-sign. A lie told to strangers.' },
  ] as Line[],
  hall2Solo: [
    { speaker: 'INES', text: 'Three houses. Rising, the Open Eye, Setting. Right hand first.' },
  ] as Line[],
  lit: [
    [{ speaker: 'TOBY', text: 'The Rising House. Good. Now the Eye.' }],
    [{ speaker: 'TOBY', text: 'The Open Eye! Last one — Setting.' }],
    [{ speaker: 'TOBY', text: 'All three. Oh — oh, the wall. The wall is lit.' }],
  ] as Line[][],
  wrongOrder: [{ speaker: 'TOBY', text: "It went dark. Order matters — the sun doesn't skip a house." }] as Line[],
  serpent: [{ speaker: 'TOBY', text: "That's the water-sign. Every lit house just went out. Told you — it's a lie for strangers." }] as Line[],
  hintSoft: [{ speaker: 'INES', text: 'Rising is on the right — the east wall. Let the beam run straight to it.' }] as Line[],
  hintStrong: [{ speaker: 'INES', text: "Turn the first mirror edge-on to let the light pass. Then swing it north, and use the second mirror for the west." }] as Line[],
  innerWall: [
    { speaker: 'TOBY', text: "It's a warning. Not a prayer. A warning." },
    { speaker: 'TOBY', text: '"We closed the valley of the Watcher and carried the eye down to the water…"' },
    { speaker: 'TOBY', text: '"…and set it in the lock, so the sky would not drown the valley again."' },
    { speaker: 'INES', text: 'The sky drowning the valley.' },
    { speaker: 'TOBY', text: 'Lake Iruvai. A glacial lake, up behind the ridges. If it burst…' },
    { speaker: 'INES', text: "San Rocín. Forty thousand people." },
    { speaker: 'TOBY', text: "The Lens isn't treasure, Ines. It's a keystone. It's holding something shut." },
  ] as Line[],
  exitHum: [
    { speaker: 'INES', text: "Hear that?" },
    { speaker: 'TOBY', text: "…Is that a generator?" },
  ] as Line[],
  ending: [
    { speaker: 'INES', text: 'Floodlights. Tents. A drill rig on the bridge.' },
    { speaker: 'TOBY', text: "That's — Ines, those are Aldercott Survey crates." },
    { speaker: 'INES', text: 'Toby. How did they get here before us?' },
    { speaker: 'TOBY', text: '…' },
  ] as Line[],
  fallRespawn: [{ speaker: 'TOBY', text: 'Careful. Please. I only have the one friend down here.' }] as Line[],
};
