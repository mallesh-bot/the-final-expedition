// Pre-launch audit checks: save round-trips past Chapter 5, Continue after a finished chapter,
// death + quit races, double completion, the restart loop, tab-away audio and the Chapter 5
// sequence break.   npm run dev   then   node scripts/launch-test.mjs
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(2);
const { E, check, state, waitSim, page } = T;
const menu = () => page.waitForFunction(() => window.__TFE.state().gameState === 'menu', null, { timeout: 120000 });
const playing = (n) => page.waitForFunction((n) => window.__TFE.state().chapter === n && window.__TFE.state().gameState === 'playing', n, { timeout: 120000 });
const toMenu = async () => {
  await E(() => void window.__TFE.game['toMainMenu']());
  await menu();
  await page.waitForTimeout(1200);
};

// ---- 1. Finishing a chapter twice in one frame shows one end card and saves once.
await E(() => { const g = window.__TFE.game; g.state.progress.collectibles.add('ch2_plate_41'); g.chapters.completeChapter(); g.chapters.completeChapter(); });
await page.waitForSelector('.end-card.show button', { timeout: 20000 });
await page.waitForTimeout(1800);
check('double completion: one end card', (await page.$$eval('.end-card.show button', (b) => b.length)) === 2);
check('double completion: save points at the next chapter once', (await E(() => window.__TFE.game.saves.latest()?.chapter)) === 3);

// ---- 2. End card -> Main Menu -> Continue starts the next chapter at its own start.
await page.click('.end-card.show button:has-text("Main Menu")');
await menu();
await page.waitForTimeout(1200);
check('menu offers Continue after a finished chapter', !(await page.$eval('button[data-action="continue"]', (b) => b.disabled)));
await page.click('button[data-action="continue"]');
await playing(3);
await waitSim(1);
await T.skipCine();
await waitSim(1.5);
{
  const d = await E(() => {
    const g = window.__TFE.game;
    const cp = g.chapters.current.checkpoints.ch3_start.pos;
    return { d: g.player.position.distanceTo(cp), cp: g.state.progress.checkpoint, coll: [...g.state.progress.collectibles] };
  });
  check('Continue: she starts Chapter 3 at its start (not at the old position)', d.d < 6, `dist ${d.d.toFixed(1)} m, cp ${d.cp}`);
  check('Continue: collectibles carried', d.coll.includes('ch2_plate_41'));
}

// ---- 3. Dying and quitting to the menu at the same moment must not respawn into the menu.
await E(() => { const g = window.__TFE.game; g.player.kill('fall'); });
await page.waitForTimeout(100);
await toMenu();
await page.waitForTimeout(3500);
{
  const st = await state();
  check('death + quit: still on the menu, Chapter 1 backdrop', st.gameState === 'menu' && (await E(() => window.__TFE.chapter().id)) === 1 && st.chapter === 1, `state ${st.gameState} ch ${st.chapter}`);
}

// ---- 4. Restart loop: New Expedition twice, state fully reset each time.
for (let round = 1; round <= 2; round++) {
  await E(() => void window.__TFE.game['newGame'](1));
  await playing(1);
  await waitSim(1);
  await T.skipCine();
  await waitSim(1.5);
  const st = await state();
  const pt = await E(() => window.__TFE.game.state.progress.playtimeSec);
  check(`restart ${round}: fresh state`, st.collectibles.length === 0 && Object.keys(st.flags).filter((f) => f !== 'ch1_intro_seen').length === 0 && pt < 30 && st.player.mode === 'ground', `coll ${st.collectibles.length} flags ${Object.keys(st.flags)} time ${pt.toFixed(0)}s mode ${st.player.mode}`);
  // Tab away and back: the game pauses, audio is silenced, and nothing jumps on return.
  if (round === 1) {
    const before = (await state()).player.pos;
    await E(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    const hid = await E(() => ({ gs: window.__TFE.state().gameState, audio: window.__TFE.game.audio.ctx?.state ?? 'none' }));
    check('tab hidden: game pauses', hid.gs === 'paused', hid.gs);
    check('tab hidden: audio is suspended', hid.audio === 'suspended' || hid.audio === 'none', hid.audio);
    await E(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    const back = await E(() => ({ gs: window.__TFE.state().gameState, audio: window.__TFE.game.audio.ctx?.state ?? 'none' }));
    check('tab back: still paused, audio running again', back.gs === 'paused' && (back.audio === 'running' || back.audio === 'none'), `${back.gs} ${back.audio}`);
    await E(() => window.__TFE.game.resume());
    await waitSim(0.5);
    const after = (await state()).player.pos;
    check('tab back: she has not moved', Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.3);
  }
  await E(() => window.__TFE.pause());
  await page.waitForTimeout(300);
  await toMenu();
}

// ---- 5. Epilogue saves survive a reload of the save (they used to be rejected as corrupt).
await E(() => void window.__TFE.game['newGame'](6));
await playing(6);
await waitSim(1);
check('epilogue: autosave is readable', (await E(() => window.__TFE.game.saves.latest()?.chapter)) === 6);
await T.skipCine();
await waitSim(1);
await E(() => window.__TFE.game.chapters.completeChapter());
await page.waitForSelector('.end-card.show button', { timeout: 20000 });
check('finished game: save is readable', (await E(() => window.__TFE.game.saves.latest()?.chapter)) === 7);
check('finished game: no save was thrown away as corrupt', (await E(() => Object.keys(localStorage).filter((k) => k.startsWith('tfe.save.corrupt')).length)) === 0);
await page.click('.end-card.show button:has-text("Main Menu")');
await menu();
await page.waitForTimeout(1200);
await page.click('button[data-action="continue"]');
await page.waitForSelector('.end-card.show h1', { timeout: 20000 });
check('finished game: Continue shows the completion card', (await page.textContent('.end-card.show h1')) === 'EXPEDITION COMPLETE');
await page.click('.end-card.show button:has-text("Main Menu")');
await menu();

// ---- 6. Chapter 5: walking past the recorder into the sanctum must not leave her with nothing to do.
await E(() => void window.__TFE.game['newGame'](5));
await playing(5);
await waitSim(1);
await T.skipCine();
await waitSim(1.5);
await T.teleport(0, 0.1, 29, 0);
await waitSim(0.5);
const st5 = await T.holdUntil(['KeyW'], (s) => s.cinematic === 'ch5_recording' || s.player.pos[2] > 40, 12);
check('ch5: heading for the sanctum without the recording starts the recording scene', st5.cinematic === 'ch5_recording', `cinematic ${st5.cinematic} z ${st5.player.pos[2]}`);

await T.finish('launch');
