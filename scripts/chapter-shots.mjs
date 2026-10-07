// Visual + smoke check for one chapter: start it, skip the intro, visit every checkpoint and
// screenshot it. Usage: node scripts/chapter-shots.mjs <chapterId> [cp1,cp2,...]
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const id = Number(process.argv[2] ?? 2);
const only = process.argv[3]?.split(',');
mkdirSync('playtest-output', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
await page.addInitScript(() => {
  const orig = console.error.bind(console);
  console.error = (...a) => orig(...a, ' @ ' + (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 7).join(' | '));
});
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
const t0 = Date.now();
await page.evaluate((n) => window.__TFE.startChapter(n), id);
await page.waitForFunction((n) => window.__TFE.state().chapter === n && window.__TFE.state().gameState === 'playing', id, { timeout: 120000 });
console.log(`chapter ${id} loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const start = await page.evaluate(() => window.__TFE.state().simTime);
for (const t of process.argv.includes('--no-intro') ? [] : [1.5, 5, 9, 14]) {
  await page.waitForFunction((x) => window.__TFE.state().simTime >= x, start + t, { timeout: 120000, polling: 50 });
  await page.screenshot({ path: `playtest-output/ch${id}-intro-${t}.png` });
}
await page.evaluate(() => window.__TFE.skipCinematic());
await waitSim(2.5);
const cps = await page.evaluate(() => Object.keys(window.__TFE.chapter().checkpoints));
for (const cp of cps) {
  if (only && !only.includes(cp)) continue;
  await page.evaluate((c) => window.__TFE.gotoCheckpoint(c), cp);
  await waitSim(1.8);
  const st = await page.evaluate(() => window.__TFE.state());
  console.log(cp.padEnd(18), 'pos', st.player.pos, 'mode', st.player.mode, 'fps', st.fps?.toFixed?.(0), 'calls', st.drawCalls, 'tris', Math.round(st.triangles / 1000) + 'k');
  await page.screenshot({ path: `playtest-output/ch${id}-${cp}.png` });
}
console.log(errs.length ? `ERRORS:\n${errs.slice(0, 8).join('\n')}` : 'no console errors');
await browser.close();
