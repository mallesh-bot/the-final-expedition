// Edges: anywhere no wall can be seen she must fall, and a fall must lead back to a checkpoint.
//   npm run dev   then   npm run test:edges
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const results = [];
const check = (n, ok, d = '') => {
  results.push(!!ok);
  console.log(ok ? 'PASS' : 'FAIL', n, d);
};
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const { waitSim } = simHelpers(page);
await page.goto(BASE_URL.includes('chapters') ? BASE_URL : `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}chapters=all`);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });

const start = async (id, cp) => {
  await page.evaluate((id) => window.__TFE.startChapter(id), id);
  await page.waitForFunction((id) => window.__TFE.state().chapter === id && window.__TFE.state().gameState === 'playing', id, { timeout: 120000 });
  await page.evaluate(() => window.__TFE.skipCinematic());
  await waitSim(1, 60000);
  if (cp) await page.evaluate((cp) => window.__TFE.gotoCheckpoint(cp), cp);
  await waitSim(0.5, 60000);
};
const P = () => page.evaluate(() => window.__TFE.state().player);

/** Teleports, runs on a heading, and reports whether she went over and was returned to a checkpoint. */
async function runOff(name, x, y, z, yaw, opts = {}) {
  await page.evaluate(([x, y, z, yaw]) => {
    window.__TFE.teleport(x, y, z, yaw);
    window.__TFE.setCameraYaw(yaw, 0.2);
  }, [x, y, z, yaw]);
  await waitSim(0.25, 60000);
  const y0 = (await P()).pos[1];
  await page.keyboard.down('KeyW');
  let lowest = y0;
  let died = false;
  let sawFall = false;
  for (let i = 0; i < 90; i++) {
    await waitSim(0.1, 30000);
    const s = await page.evaluate(() => window.__TFE.state().player);
    lowest = Math.min(lowest, s.pos[1]);
    if (s.anim === 'FALL') sawFall = true;
    if (s.mode === 'dead') {
      died = true;
      break;
    }
    if (opts.stopAt && i * 0.1 > opts.stopAt) break;
  }
  await page.keyboard.up('KeyW');
  if (opts.blocked) {
    check(name, !died && lowest > y0 - 0.5, `stayed at y=${lowest.toFixed(2)}`);
    return;
  }
  // The respawn must put her back on solid ground, alive, without help.
  let back = false;
  if (died) {
    for (let i = 0; i < 80; i++) {
      await waitSim(0.1, 30000);
      const s = await P();
      if (s.mode === 'ground' && s.grounded) {
        back = true;
        break;
      }
    }
  }
  check(name, died && sawFall && back, `drop=${(y0 - lowest).toFixed(1)}m fallAnim=${sawFall} died=${died} respawned=${back}`);
  await waitSim(0.6, 60000);
}

await start(2);
await runOff('Ch2 overlook: the gap where the stair was', 3, 0, 3, 0);
await runOff('Ch2 overlook: the parapet still stops her', -3, 0, 3, 0, { blocked: true, stopAt: 2 });
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch2_terraces'));
await waitSim(0.6, 60000);
await runOff('Ch2 kitchens terrace: west edge', -5, -10, 14, -Math.PI / 2);
await runOff('Ch2 bridge: off the side of the planks', -16, -10.4, 42, 0);
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch2_bridge'));
await waitSim(0.6, 60000);
await runOff('Ch2 terrace house: west edge', -5, -10, 34, -Math.PI / 2);
await runOff('Ch2 far terrace: south edge', -31, -10, 34, Math.PI);
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch2_cistern'));
await waitSim(0.6, 60000);
await runOff('Ch2 cistern terrace: chasm side', -23, -10, 75, Math.PI / 2);
await runOff('Ch2 cistern terrace: north edge', -23, -10, 77, 0);
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch2_span'));
await waitSim(0.6, 60000);
await runOff('Ch2 landing: side edge', -28, -20, 97, Math.PI / 2);

// The narrow ledge (the walk along the wall).
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch2_cistern'));
await waitSim(0.6, 60000);
await page.evaluate(() => {
  window.__TFE.teleport(-28.7, -10, 55, 0);
  window.__TFE.setCameraYaw(0, 0.2);
});
await waitSim(0.5, 60000);
check('Ch2 narrow ledge: she takes to it', (await P()).mode === 'ledge', `mode=${(await P()).mode}`);
await page.keyboard.down('KeyW');
await waitSim(0.8, 60000);
await page.keyboard.up('KeyW');
const onLedge = await P();
check('Ch2 narrow ledge: walking along it is safe', onLedge.mode === 'ledge', `mode=${onLedge.mode} z=${onLedge.pos[2]}`);
// Push away from the wall: +X is away, and the camera faces +Z, so her left arrow-key direction is +X.
await waitSim(2.5, 60000); // (the camera swings round to look at the wall from outside)
await page.keyboard.down('KeyS');
let fellOff = false;
let diedOff = false;
for (let i = 0; i < 60; i++) {
  await waitSim(0.1, 30000);
  const s = await P();
  if (s.mode === 'ground' && !s.grounded) fellOff = true;
  if (s.mode === 'dead') {
    diedOff = true;
    break;
  }
}
await page.keyboard.up('KeyS');
check('Ch2 narrow ledge: pushing away from the wall drops her', fellOff && diedOff, `fell=${fellOff} died=${diedOff}`);
await waitSim(2.5, 60000);

await start(4);
await page.evaluate(() => window.__TFE.gotoCheckpoint('ch4_far'));
await waitSim(0.8, 60000);
{
  const at = (await P()).pos;
  await runOff('Ch4 far terrace: north edge', -5, at[1], 150, 0);
}
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} edge checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
