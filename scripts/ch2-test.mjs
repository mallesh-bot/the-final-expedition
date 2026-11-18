// Chapter 2 playthrough: every mechanic in order. Needs `npm run dev`; set TFE_URL if not :5173.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(2);
const { E, check, state, dbg, teleport, press, holdUntil, waitSim, skipCine, page } = T;
const pos = async () => (await state()).player.pos;

// 1. Fix the rope, then rappel.
await teleport(2.5, 0, 3.0, 0);
await waitSim(0.5);
await press('KeyE');
await waitSim(3); // (tying the rope and letting it run out takes 2.4 s)
check('rope fixed at the overlook', (await dbg()).rope);
await press('KeyE');
await waitSim(5.5);
let p = await pos();
check('rappel lands on the kitchen terrace', Math.abs(p[1] + 10) < 0.3 && p[2] > 5.5, `pos=${p}`);
check('checkpoint: upper terraces', (await state()).checkpoint === 'ch2_terraces');

// 2. Wall climb up to the slumped wall top.
await teleport(1.5, -10, 21.2, 0);
await waitSim(0.4);
await press('KeyE');
let st = await holdUntil(['KeyW'], (s) => s.player.pos[1] > -6.3 && s.player.mode === 'ground', 14);
check('climbs the slumped wall', st.player.pos[1] > -6.3, `pos=${st.player.pos} mode=${st.player.mode}`);

// 3. Rope bridge (east), no falling.
await teleport(-6.5, -10, 42, -Math.PI / 2);
await waitSim(0.4);
st = await holdUntil(['KeyW'], (s) => s.player.pos[0] < -26.5, 12);
check('crosses the rope bridge', st.player.pos[0] < -26.5 && st.player.pos[1] > -11, `pos=${st.player.pos}`);
await page.screenshot({ path: 'playtest-output/ch2-test-bridge.png' });

// 4. Aqueduct ledge (narrow) north to the cistern terrace.
await teleport(-28.7, -10, 48.5, 0);
await waitSim(0.4);
let sawLedge = false;
st = await holdUntil(['KeyW'], (s) => {
  if (s.player.mode === 'ledge') sawLedge = true;
  return s.player.pos[2] > 63;
}, 20);
check('shuffles along the aqueduct ledge', sawLedge && st.player.pos[2] > 63 && st.player.pos[1] > -11, `pos=${st.player.pos} ledge=${sawLedge}`);

// 5. Sluices: stair (A) closed, basin (B) open, spill (C) closed.
const wheel = [[-29.4, 74.6, Math.PI], [-26.4, 69.4, -Math.PI / 2], [-35.6, 69.4, Math.PI / 2]];
const turn = async (i) => {
  const [x, z] = wheel[i];
  const face = Math.atan2(([-29.4, -27.2, -34.8][i]) - x, ([73.8, 69.4, 69.4][i]) - z);
  await teleport(x, -10, z, face);
  await waitSim(0.4);
  await press('KeyE');
  await waitSim(2.2);
};
check('stair is flooded at the start', (await dbg()).sluice[0] === true);
await turn(0);
await turn(2);
check('basin not yet open', !(await dbg()).solved);
await turn(1);
await waitSim(2.5);
let d = await dbg();
check('sluice puzzle solved (A closed, B open, C closed)', d.solved, JSON.stringify(d));
await skipCine();
await waitSim(1);
d = await dbg();
check('door raised by the counterweight', d.doorK > 0.95, JSON.stringify(d));

// 6. Water-stair down to the aqueduct landing.
await teleport(-31, -10, 79.0, 0);
await waitSim(0.4);
st = await holdUntil(['KeyW'], (s) => s.player.pos[2] > 96, 14);
check('descends the water-stair through the door', st.player.pos[2] > 96 && st.player.pos[1] < -19.5, `pos=${st.player.pos}`);
check('checkpoint: aqueduct', (await state()).checkpoint === 'ch2_span');

// 7. The collapsing span: sprint, jump the gap.
await teleport(-30, -20, 101.5, 0);
await waitSim(0.3);
await E(() => { window.__TFE.key('KeyW', true); window.__TFE.key('ShiftLeft', true); });
st = await holdUntil([], (s) => s.player.pos[2] > 122.8 || s.player.mode === 'dead', 8);
await press('Space', 0.1);
st = await holdUntil([], (s) => s.player.pos[2] > 129 || s.player.mode === 'dead', 4);
await E(() => { window.__TFE.key('KeyW', false); window.__TFE.key('ShiftLeft', false); });
await waitSim(1.5);
d = await dbg();
check('span collapsed behind her', d.spanStarted, JSON.stringify(d));
check('made it across the gap alive', d.spanDone && (await state()).player.mode !== 'dead', `pos=${(await state()).player.pos}`);
await page.screenshot({ path: 'playtest-output/ch2-test-span.png' });

// 8. The sun-shaft mouth ends the chapter.
await teleport(-30, -20, 139, 0);
await waitSim(0.3);
await holdUntil(['KeyW'], (s) => s.cinematicActive, 6);
await waitSim(1);
await skipCine();
await waitSim(3);
st = await state();
check('chapter completes', st.gameState === 'ended' && st.flags.ch2_complete, `state=${st.gameState}`);
await T.finish('chapter 2');
