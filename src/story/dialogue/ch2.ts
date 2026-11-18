import type { Line } from '../Dialogue';

/** Chapter 2 — INTO THE UNKNOWN. STORY_BIBLE §12 voice, §14.3 beats. */
export const CH2 = {
  intro: [
    { speaker: 'TOBY', text: 'Ines. Ines. Tell me you slept somewhere with walls.', radio: true },
    { speaker: 'INES', text: 'Gate arch. Very dry. Excellent view.', radio: true },
    { speaker: 'INES', text: 'The channel was busy before dawn. Who were you talking to?', radio: true },
    { speaker: 'TOBY', text: 'Talking? Nobody. Static. Mountains do that.', radio: true },
    { speaker: 'TOBY', text: "I've been staring at a cliff all night. The cliff has been staring back.", radio: true },
    { speaker: 'INES', text: "I'll fix a rope off the overlook. You follow it when you're ready.", radio: true },
    { speaker: 'TOBY', text: "When I'm ready. Yes. Pencil me in for my next life.", radio: true },
  ] as Line[],
  stairGone: [
    { speaker: 'INES', text: "There was a stair here. Somebody blew it out from underneath." },
    { speaker: 'INES', text: 'Charges. Old ones. The rock is still scorched.' },
  ] as Line[],
  ropeFixed: [
    { speaker: 'INES', text: 'Rope is fixed. Double-bowline, backed up on the column.', radio: true },
    { speaker: 'TOBY', text: "I don't know what that means but I'm choosing to find it comforting.", radio: true },
  ] as Line[],
  kitchens: [
    { speaker: 'INES', text: 'Hearths. Grinding stones. They lived up here, not just prayed.' },
  ] as Line[],
  wallClimb: [{ speaker: 'INES', text: 'Wall has slumped. Up and over.' }] as Line[],
  house: [
    { speaker: 'INES', text: "Someone sealed this doorway with a tarp. A 1950s tarp." },
  ] as Line[],
  cacheFound: [
    { speaker: 'INES', text: 'Toby. Her plates. Developed. She had a darkroom down here.', radio: true },
    { speaker: 'TOBY', text: "Wait — what's the date on them?", radio: true },
    { speaker: 'INES', text: 'Ninth of June. Eleventh. Twelfth.', radio: true },
    { speaker: 'TOBY', text: 'Edmund said the avalanche was the fourth.', radio: true },
    { speaker: 'INES', text: 'I know what Edmund said.', radio: true },
  ] as Line[],
  plate41: [{ speaker: 'INES', text: 'Breakfast. Five days after they were supposed to be dead.' }] as Line[],
  plate43: [{ speaker: 'INES', text: "Hollis Varne. Copying a wall by lamplight. 'An instruction.'" }] as Line[],
  plate44: [
    { speaker: 'INES', text: "Edmund. He didn't want to be photographed here." },
    { speaker: 'INES', text: 'She took it anyway. Of course she did.' },
  ] as Line[],
  note: [{ speaker: 'INES', text: '"Look at the dates." I am, Marta. I am.' }] as Line[],
  bridge: [
    { speaker: 'INES', text: 'Rope bridge. Hemp, steel cable spliced in. 1958, repaired since.', radio: true },
    { speaker: 'TOBY', text: 'Repaired by whom?', radio: true },
    { speaker: 'INES', text: 'Someone who knows how to splice cable.', radio: true },
  ] as Line[],
  bridgeHalf: [{ speaker: 'TOBY', text: "Don't describe the bridge. I'll have to cross it. Describe something nice.", radio: true }] as Line[],
  ledge: [{ speaker: 'INES', text: 'Narrow. Face the rock. Small steps.' }] as Line[],
  cistern: [
    { speaker: 'INES', text: 'The cistern is overflowing down the stair. I can\'t go down through that.' },
    { speaker: 'INES', text: 'Three sluices. One feeds the stair, one goes over the edge… and one runs to that counterweight.' },
  ] as Line[],
  cisternHint: [
    { speaker: 'INES', text: 'Shut the stair. Shut the spill. Let it all run into the counterweight basin.' },
  ] as Line[],
  basinTrickle: [{ speaker: 'INES', text: "The spill is stealing the flow. The basin's only getting a trickle." }] as Line[],
  stairStillFlooded: [{ speaker: 'INES', text: 'Stair is still running. That one first.' }] as Line[],
  doorOpen: [
    { speaker: 'INES', text: 'There it goes. Five hundred years and the counterweight still works.', radio: true },
    { speaker: 'TOBY', text: "Engineers. Not sorcerers. I've been telling people that for nine years.", radio: true },
  ] as Line[],
  span: [
    { speaker: 'INES', text: 'The aqueduct. The waterfall is hitting it dead centre.' },
    { speaker: 'INES', text: "It's held for five centuries. It can hold for one more minute." },
  ] as Line[],
  collapse: [{ speaker: 'INES', text: 'No — no, no, no —' }] as Line[],
  spanSafe: [
    { speaker: 'TOBY', text: "What was that noise? Ines? That was a very large noise.", radio: true },
    { speaker: 'INES', text: "The aqueduct. It's gone. I'm fine. Find another way down.", radio: true },
    { speaker: 'TOBY', text: 'Another way. Of course. I\'ll just ask the cliff.', radio: true },
  ] as Line[],
  shaftMouth: [
    { speaker: 'INES', text: 'A shaft, cut straight into the mountain. Light going in, not out.', radio: true },
    { speaker: 'TOBY', text: "Sun-shafts. The calendar halls. Ines, if the inscriptions are intact I'll —", radio: true },
    { speaker: 'INES', text: "Come and see. Use the rope. I'll wait at the entrance.", radio: true },
    { speaker: 'TOBY', text: "I'm coming. I'm already regretting it, but I'm coming.", radio: true },
  ] as Line[],
  fallRespawn: [{ speaker: 'TOBY', text: 'Was that a scream or the wind? Tell me it was the wind.', radio: true }] as Line[],
};
