// Chapter 4 playthrough: camp confrontation, the blast, the bridge escape, the far terrace.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(4);
const { E, check, state, dbg, teleport, press, holdUntil, waitSim, skipCine, page } = T;

// Walk into the camp → confrontation.
let st = await holdUntil(['KeyW'], (s) => s.cinematicActive, 20);
check('walking into camp starts the confrontation', st.cinematicActive && (await dbg()).met, `pos=${st.player.pos}`);
await waitSim(3);
await page.screenshot({ path: 'playtest-output/ch4-test-confrontation.png' });
await skipCine();
await waitSim(1.5);
check('checkpoint: camp', (await state()).checkpoint === 'ch4_camp');
// Dace heads out onto the bridge.
await waitSim(4);
const d0 = await dbg();
check('Dace walks toward the bridge', d0.dace[2] > 42, `dace=${d0.dace}`);

// Out onto the bridge → the blast.
await teleport(0, 0, 70, 0);
await waitSim(0.3);
st = await holdUntil(['KeyW'], (s) => s.cinematicActive, 6);
check('the blast cinematic fires on the bridge', (await dbg()).blast);
await waitSim(4.5);
await page.screenshot({ path: 'playtest-output/ch4-test-blast.png' });
await skipCine();
await waitSim(0.4);

// RUN: sprint, jump the gap, reach the far abutment.
await E(() => { window.__TFE.key('KeyW', true); window.__TFE.key('ShiftLeft', true); });
st = await holdUntil([], (s) => s.player.pos[2] > 96.6 || s.player.mode === 'dead', 8);
await press('Space', 0.1);
st = await holdUntil([], (s) => s.player.pos[2] > 128.6 || s.player.mode === 'dead', 8);
await E(() => { window.__TFE.key('ShiftLeft', false); });
check('outran the collapse across the bridge', st.player.mode !== 'dead' && st.player.pos[2] > 128, `pos=${st.player.pos} mode=${st.player.mode}`);
await page.screenshot({ path: 'playtest-output/ch4-test-run.png' });
await press('KeyE');
st = await holdUntil([], (s) => s.player.pos[1] > 3 && s.player.mode === 'ground', 10);
await E(() => window.__TFE.key('KeyW', false));
check('climbed onto the far abutment', st.player.pos[1] > 3, `pos=${st.player.pos} mode=${st.player.mode}`);

// Cross the crumbling terrace to the shelf.
const p = st.player.pos;
const yaw = Math.atan2(13.6 - p[0], 157.4 - p[2]);
await E((y) => window.__TFE.setCameraYaw(y, 0.2), yaw);
st = await holdUntil(['KeyW', 'ShiftLeft'], (s) => s.player.pos[2] > 157 || s.player.mode === 'dead', 10);
check('crossed the crumbling terrace alive', st.player.mode !== 'dead', `pos=${st.player.pos}`);
await E(() => window.__TFE.setCameraYaw(0, 0.2));
await teleport(13.95, 3.2, 158.6, 0);
await waitSim(0.3);
st = await holdUntil(['KeyW'], (s) => s.cinematicActive, 14);
check('the last ledge ends the run', st.cinematicActive, `pos=${st.player.pos} mode=${st.player.mode}`);
await waitSim(2);
await skipCine();
await waitSim(3);
st = await state();
check('chapter completes', st.gameState === 'ended' && st.flags.ch4_complete, `state=${st.gameState}`);
await T.finish('chapter 4');
