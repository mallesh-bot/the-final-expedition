// Chapter 3 playthrough: mirror halls, Toby joins, the inner wall, the balcony.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(3);
const { E, check, state, dbg, teleport, press, holdUntil, waitSim, skipCine, page } = T;
const turnMirror = async (x, z) => {
  await teleport(x, -2, z - 1.4, 0);
  await waitSim(0.3);
  await press('KeyE');
  await waitSim(1.4);
};

// Walk in from the mouth to the first hall.
let st = await holdUntil(['KeyW'], (s) => s.player.pos[2] > 17, 16);
check('walks down the shaft into the first hall', st.player.pos[2] > 17 && st.player.pos[1] < -1.5, `pos=${st.player.pos}`);

// Hall 1: two turns send the beam to the Rising House; the door opens.
await turnMirror(0, 20);
check('first turn: not yet', !(await dbg()).h1.solved, JSON.stringify((await dbg()).h1));
await turnMirror(0, 20);
let d = await dbg();
check('hall 1 solved — beam hits the Rising House', d.h1.solved && d.h1.hit === 'rising1', JSON.stringify(d.h1));
await waitSim(3);
check('door into the passage opens', (await dbg()).door1 > 0.95);
await page.screenshot({ path: 'playtest-output/ch3-test-hall1.png' });
// Toby arrives after a few seconds and follows.
await waitSim(9);
d = await dbg();
check('Toby arrives', d.toby !== null, JSON.stringify(d.toby));
await teleport(5.2, -2, 33, 0);
st = await holdUntil(['KeyW'], (s) => s.player.pos[2] > 43, 12);
for (let i = 0; i < 24 && !((await dbg()).toby?.[2] > 34); i++) await waitSim(0.5);
d = await dbg();
check('Toby follows along the passage', d.toby && d.toby[2] > 34, `toby=${d.toby}`);

// Hall 2: Rising (M1 edge-on) → Eye (M2 edge-on, then M1 north) → Setting (M2 west).
await turnMirror(0, 48); // M1 3→4
d = await dbg();
check('Rising House wakes first', d.h2.lit.join() === 'rising', JSON.stringify(d.h2));
await turnMirror(0, 58); // M2 1→2
await turnMirror(0, 48); // M1 4→5
d = await dbg();
check('then the Open Eye', d.h2.lit.join() === 'rising,eye', JSON.stringify(d.h2));
await turnMirror(0, 58); // M2 2→3
d = await dbg();
check('then Setting — hall solved', d.h2.solved && d.h2.lit.length === 3, JSON.stringify(d.h2));
await page.screenshot({ path: 'playtest-output/ch3-test-hall2.png' });
await waitSim(3);
await skipCine();
await waitSim(5);
check('the inner wall opens', (await dbg()).inner > 0.95);

// Exit to the balcony → chapter end.
await teleport(0, -2, 70, 0);
await holdUntil(['KeyW'], (s) => s.cinematicActive, 12);
await waitSim(1);
await skipCine();
await waitSim(3);
st = await state();
check('chapter completes', st.gameState === 'ended' && st.flags.ch3_complete, `state=${st.gameState}`);
await T.finish('chapter 3');
