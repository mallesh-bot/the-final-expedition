// Shared harness for the per-chapter playthrough tests (scripts/ch*-test.mjs).
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './browser.mjs';

export async function openChapter(id) {
  mkdirSync('playtest-output', { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const sim = simHelpers(page);
  await page.goto(BASE_URL);
  await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
  await page.evaluate((n) => window.__TFE.startChapter(n), id);
  await page.waitForFunction((n) => window.__TFE.state().chapter === n && window.__TFE.state().gameState === 'playing', id, { timeout: 120000 });
  await sim.waitSim(1);
  await page.evaluate(() => window.__TFE.skipCinematic());
  await sim.waitSim(2.2);
  const E = (f, a) => page.evaluate(f, a);
  const res = [];
  const check = (n, ok, d = '') => {
    res.push([n, !!ok, d]);
    console.log(ok ? 'PASS' : 'FAIL', n, d);
  };
  const state = () => E(() => window.__TFE.state());
  const dbg = () => E(() => window.__TFE.chapterDebug());
  const teleport = (x, y, z, yaw = 0) => E(([x, y, z, yaw]) => { window.__TFE.teleport(x, y, z, yaw); window.__TFE.setCameraYaw(yaw, 0.2); }, [x, y, z, yaw]);
  const press = async (code, hold = 0.15) => {
    await E((c) => window.__TFE.key(c, true), code);
    await sim.waitSim(hold);
    await E((c) => window.__TFE.key(c, false), code);
  };
  const hold = async (codes, seconds) => {
    for (const c of codes) await E((k) => window.__TFE.key(k, true), c);
    await sim.waitSim(seconds);
    for (const c of codes) await E((k) => window.__TFE.key(k, false), c);
  };
  /** Hold keys until fn(state) is true or the timeout (sim seconds) runs out. */
  const holdUntil = async (codes, fn, maxSec = 10) => {
    for (const c of codes) await E((k) => window.__TFE.key(k, true), c);
    const start = (await state()).simTime;
    let st = await state();
    while (!fn(st) && st.simTime - start < maxSec) {
      await sim.waitSim(0.1);
      st = await state();
    }
    for (const c of codes) await E((k) => window.__TFE.key(k, false), c);
    return st;
  };
  const skipCine = async () => {
    for (let i = 0; i < 40; i++) {
      const st = await state();
      if (!st.cinematicActive) return;
      await E(() => window.__TFE.skipCinematic());
      await sim.waitSim(0.3);
    }
  };
  const finish = async (name) => {
    check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    const failed = res.filter((r) => !r[1]).length;
    console.log(`\n${res.length - failed}/${res.length} ${name} checks passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  };
  return { browser, page, errs, ...sim, E, check, state, dbg, teleport, press, hold, holdUntil, skipCine, finish };
}
