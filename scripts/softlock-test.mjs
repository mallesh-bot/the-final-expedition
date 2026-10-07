// PRD §57.1(4): no soft-locks — force a death at every checkpoint of every chapter (2–5, epilogue)
// and check the respawn puts the player back on their feet at that checkpoint with an objective.
//   npm run dev   then   node scripts/softlock-test.mjs [chapterIds]
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const ids = (process.argv[2] ?? '2,3,4,5,6').split(',').map(Number);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
const res = [];
const check = (n, ok, d = '') => {
  res.push([n, !!ok]);
  console.log(ok ? 'PASS' : 'FAIL', n, d);
};
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
for (const id of ids) {
  await page.evaluate(() => {
    const g = window.__TFE.game;
    g.cinematic.reset();
    g.gameState = 'menu';
  });
  await page.evaluate((n) => window.__TFE.startChapter(n), id);
  await page.waitForFunction((n) => window.__TFE.state().chapter === n && window.__TFE.state().gameState === 'playing', id, { timeout: 180000 });
  await waitSim(1);
  await page.evaluate(() => window.__TFE.skipCinematic());
  await waitSim(1);
  const cps = await page.evaluate(() => Object.entries(window.__TFE.chapter().checkpoints).map(([k, c]) => [k, c.pos.toArray()]));
  for (const [cp, pos] of cps) {
    await page.evaluate((c) => {
      window.__TFE.game.cinematic.reset();
      window.__TFE.game.chapters.reachCheckpoint(c);
      window.__TFE.gotoCheckpoint(c);
    }, cp);
    await waitSim(0.6);
    await page.evaluate(() => window.__TFE.game.player.kill('test'));
    // Respawn: fade out, restore, fade in (wall-clock timers inside the manager).
    await page.waitForFunction(() => window.__TFE.state().player.mode !== 'dead', null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.__TFE.game.cinematic.reset());
    await waitSim(0.8);
    const st = await page.evaluate(() => window.__TFE.state());
    const obj = await page.evaluate(() => window.__TFE.chapter().objective());
    const p = st.player.pos;
    const near = Math.hypot(p[0] - pos[0], p[2] - pos[2]) < 6 && Math.abs(p[1] - pos[1]) < 3;
    check(`ch${id} ${cp}: respawns standing at the checkpoint`, near && st.player.mode !== 'dead' && st.checkpoint === cp, `pos=${p} mode=${st.player.mode} cp=${st.checkpoint}`);
    check(`ch${id} ${cp}: has an objective`, id === 6 || obj.length > 0, obj);
  }
}
check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
const failed = res.filter((r) => !r[1]).length;
console.log(`\n${res.length - failed}/${res.length} soft-lock checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
