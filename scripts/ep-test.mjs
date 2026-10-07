// Epilogue playthrough: Tamsa Alta, Doña Ayme and the photograph, montage + letter, the ribbon.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(6);
const { E, check, state, dbg, teleport, press, holdUntil, waitSim, skipCine, page } = T;

let st = await holdUntil(['KeyW'], (s) => s.player.pos[2] > -20, 14);
check('walks up the village path', st.player.pos[2] > -20, `pos=${st.player.pos}`);
await teleport(0.1, 6.5, 29.3, 0);
await waitSim(0.6);
await press('KeyE');
await waitSim(3);
check('Doña Ayme scene starts', (await state()).cinematic === 'ep_ayme');
await page.screenshot({ path: 'playtest-output/ep-test-ayme.png' });
await skipCine();
await waitSim(1);
check('the photograph is in the journal', (await state()).collectibles.includes('ep_photo_gate'));
// Montage + letter over black, then the cliff trail.
const t0 = (await state()).simTime;
await page.waitForFunction(() => window.__TFE.state().checkpoint === 'ep_cliff', null, { timeout: 600000, polling: 250 });
await waitSim(3);
check('montage and letter play, then the red-rock trail', (await state()).checkpoint === 'ep_cliff', `took ${((await state()).simTime - t0).toFixed(0)} s`);
await page.screenshot({ path: 'playtest-output/ep-test-cliff.png' });
await teleport(300.5, 0, 6.2, 0.5);
await waitSim(0.5);
await press('KeyE');
await waitSim(4);
await page.screenshot({ path: 'playtest-output/ep-test-ribbon.png' });
check('ties the ribbon', (await dbg()).tied);
await skipCine();
await waitSim(3);
st = await state();
check('the game ends', st.gameState === 'ended' && st.flags.ch6_complete, `state=${st.gameState}`);
await page.screenshot({ path: 'playtest-output/ep-test-end.png' });
await T.finish('epilogue');
