// Chapter 5 playthrough: the recording, Dace and the Lens, the Sunlock under pressure, the exit.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(5);
const { E, check, state, dbg, teleport, press, holdUntil, waitSim, skipCine, page } = T;
const faceAt = async (x, z, tx, tz) => teleport(x, 0, z, Math.atan2(tx - x, tz - z));

let st = await holdUntil(['KeyW'], (s) => s.player.pos[2] > 15.5, 14);
check('wades through the passage into the antechamber', st.player.pos[2] > 15.5, `pos=${st.player.pos}`);

await faceAt(-3.7, 23.0, -4.6, 24.4);
await waitSim(0.3);
// The film tin and the cord sit beside the recorder: E picks those up first, then plays the tape.
for (let i = 0; i < 4 && (await state()).cinematic !== 'ch5_recording'; i++) {
  await press('KeyE');
  await waitSim(1.6);
}
await waitSim(3);
await page.screenshot({ path: 'playtest-output/ch5-test-recording.png' });
check('playing the tape starts the recording', (await state()).cinematic === 'ch5_recording');
await skipCine();
await waitSim(1);
let d = await dbg();
check('recording collected + Corwin present', d.recording && (await state()).collectibles.includes('ch5_recording'), JSON.stringify(d));

await teleport(0, 0, 30.5, 0);
await waitSim(0.3);
st = await holdUntil(['KeyW'], (s) => s.cinematicActive, 6);
await waitSim(12);
await page.screenshot({ path: 'playtest-output/ch5-test-dace.png' });
await skipCine();
await waitSim(1);
d = await dbg();
check('Dace scene: Lens on the floor, the flood timer running', d.dace && d.lens === 'floor' && d.timer > 200, JSON.stringify(d));

await faceAt(5.2, 40.0, 5.2, 41.5);
await waitSim(0.3);
await press('KeyE');
await waitSim(1.5);
check('picks up the Lens', (await dbg()).lens === 'carried');
await faceAt(0, 46.4, 0, 48);
await waitSim(0.3);
await press('KeyE');
await waitSim(2);
d = await dbg();
check('seats the Lens — three beams', d.lens === 'seated' && d.hits.length === 3, JSON.stringify(d));

const turn = async (x, z) => {
  await faceAt(x, z - 1.4, x, z);
  await waitSim(0.3);
  await press('KeyE');
  await waitSim(1.4);
};
await turn(-7, 48);
await turn(-7, 48);
await turn(7, 48);
await turn(7, 48);
d = await dbg();
check('Rising and Setting houses lit', d.hits.includes('rising') && d.hits.includes('setting'), JSON.stringify(d));
await page.screenshot({ path: 'playtest-output/ch5-test-beams.png' });
for (let i = 0; i < 2; i++) {
  await faceAt(0, 51.2, 0, 52.8);
  await waitSim(0.3);
  await press('KeyE');
  await waitSim(3.2);
}
d = await dbg();
check('Toby turns the high mirror — the Sunlock is set', d.done, JSON.stringify(d));
await waitSim(2);
await skipCine();
await waitSim(1.5);

await teleport(-17, 0, 41.5, -Math.PI / 2);
await waitSim(0.3);
st = await holdUntil(['KeyW'], (s) => s.cinematicActive, 30);
check('wades out through the lower passage', st.cinematicActive, `pos=${st.player.pos}`);
await waitSim(1);
await skipCine();
await waitSim(3);
st = await state();
check('chapter completes', st.gameState === 'ended' && st.flags.ch5_complete, `state=${st.gameState}`);
await T.finish('chapter 5');
