// End-to-end playtest of the Chapter 1 vertical slice, driven through real keyboard input.
//   npm run dev  (in another terminal)   then   npm run playtest
// Fails (exit 1) on any console error / page error or failed check. Screenshots in playtest-output/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.TFE_URL ?? 'http://localhost:5173/?debug';
mkdirSync('playtest-output', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 800));
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const S = () => page.evaluate(() => window.__TFE.state());
const wait = (ms) => page.waitForTimeout(ms);
const T = (x, y, z, yaw = 0) => page.evaluate(([x, y, z, yaw]) => window.__TFE.teleport(x, y, z, yaw), [x, y, z, yaw]);
const camYaw = (y) => page.evaluate((y) => window.__TFE.setCameraYaw(y, 0.2), y);
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
const tap = async (k) => {
  await page.keyboard.down(k);
  await wait(60);
  await page.keyboard.up(k);
};
/** Hold keys until predicate on state is true (or timeout). Records seen modes. */
const holdUntil = async (keys, pred, timeout, seen = new Set()) => {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now();
  let s = await S();
  while (Date.now() - t0 < timeout) {
    s = await S();
    seen.add(s.player.mode);
    if (pred(s)) break;
    await wait(80);
  }
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return s;
};
const shot = (n) => page.screenshot({ path: `playtest-output/pt-${n}.png` });

// ------------------------------------------------------------------ boot
const t0 = Date.now();
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
let s = await S();
check('boot → main menu', s.gameState === 'menu', `${((Date.now() - t0) / 1000).toFixed(1)}s · ${s.gpu}`);
check('continue disabled with no save', await page.$eval('button[data-action="continue"]', (b) => b.disabled));
await shot('01-menu');

// ------------------------------------------------------------------ new game + intro
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 15000 });
check('intro cinematic plays', true);
await wait(3000);
await shot('02-intro');
s = await S();
check('player input locked during cinematic', s.player.mode === 'scripted');
await hold(['Space'], 1100); // hold-to-skip
await wait(2500);
s = await S();
check('intro skippable (hold SPACE)', s.cinematic === null && s.player.mode === 'ground', `cin=${s.cinematic} mode=${s.player.mode}`);
check('intro flag set', s.flags.ch1_intro_seen === true);

// ------------------------------------------------------------------ locomotion
await camYaw(0.05);
const p0 = (await S()).player.pos;
await hold(['KeyW'], 1600);
s = await S();
check('walk/run forward (W)', s.player.pos[2] - p0[2] > 3, `dz=${(s.player.pos[2] - p0[2]).toFixed(2)}`);
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await wait(1200);
s = await S();
check('sprint (SHIFT)', s.player.sprinting && s.player.speed > 5.8, `speed=${s.player.speed}`);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await wait(700);
const y0 = (await S()).player.pos[1];
await tap('Space');
await wait(280);
s = await S();
check('jump (SPACE)', s.player.pos[1] - y0 > 0.4, `dy=${(s.player.pos[1] - y0).toFixed(2)}`);
await wait(900);
s = await S();
check('land after jump', s.player.grounded && s.player.mode === 'ground');
check('minimap visible in gameplay', await page.isVisible('canvas.minimap.show'));
await shot('02b-minimap');

// ------------------------------------------------------------------ pause / resume
await tap('Escape');
await wait(400);
s = await S();
const tp = s.simTime;
await wait(1000);
const s2 = await S();
check('ESC pauses (sim time frozen)', s.gameState === 'paused' && s2.paused && Math.abs(s2.simTime - tp) < 1e-6);
check('pause menu visible', await page.isVisible('button[data-action="resume"]'));
await shot('03-pause');
await page.click('button[data-action="resume"]');
await wait(600);
s = await S();
check('RESUME continues exact state', s.gameState === 'playing' && s.simTime > tp && Math.abs(s.player.pos[2] - s2.player.pos[2]) < 0.01);

// ------------------------------------------------------------------ collectible
await T(0.6, 0.1, -12.2, 0);
await camYaw(0);
await wait(500);
await tap('KeyE');
await wait(1600);
s = await S();
check('pick up journal page (E)', s.collectibles.includes('ch1_journal_1'), s.collectibles.join(','));
check('camp checkpoint reached', s.checkpoint === 'ch1_camp', s.checkpoint);
await tap('KeyJ');
await wait(500);
s = await S();
check('journal opens (J) and pauses', s.gameState === 'journal' && s.paused);
await shot('04-journal');
await tap('KeyJ');
await wait(500);

// Theodolite sighting (short cinematic) + the remaining camp collectibles
await T(2.8, 0.1, -3.2, 0);
await camYaw(0);
await wait(400);
await tap('KeyE');
await wait(600);
s = await S();
check('theodolite sighting cinematic', s.cinematic === 'ch1_theodolite', `cin=${s.cinematic}`);
await wait(8000);
s = await S();
check('control returns after sighting', s.cinematic === null && s.player.mode === 'ground', s.player.mode);
for (const [x, z, yaw, id] of [
  [7.2, -14.9, 0, 'ch1_journal_3'],
  [-2.3, -4.0, Math.PI, 'ch1_relic_token'],
  [10.9, 19.2, 0, 'ch1_journal_2'],
]) {
  await T(x, 0.1, z, yaw);
  await camYaw(yaw);
  await wait(400);
  await tap('KeyE');
  await wait(1500);
  s = await S();
  check(`collect ${id}`, s.collectibles.includes(id), s.collectibles.join(','));
}
await tap('KeyJ');
await wait(400);
await page.click('.journal li:nth-child(2)');
await wait(300);
check('journal page 2 shows Marta\'s sketch', await page.isVisible('.journal .page img'));
await shot('04b-journal-sketch');
await tap('KeyJ');
await wait(400);
check('audio context running after user gesture', await page.evaluate(() => window.__TFE.game.audio.ctx?.state === 'running'));

// ------------------------------------------------------------------ climbing route
await T(10, 0, 21.6, 0);
await camYaw(0);
await wait(500);
await tap('KeyE');
await wait(500);
s = await S();
check('climb mount (E at climb wall)', s.player.mode === 'climb' || s.player.mode === 'mount', s.player.mode);
const seen = new Set();
s = await holdUntil(['KeyW'], (x) => x.player.mode === 'ground' && x.player.pos[1] > 4.3, 14000, seen);
check('climb → hang → climb up onto shelf', s.player.pos[1] > 4.3 && seen.has('hang') && seen.has('climbUp'), `y=${s.player.pos[1]} seen=${[...seen]}`);
await shot('05-shelf');

// Narrow ledge (move left = +X, camera facing north)
await camYaw(0);
const seen2 = new Set();
s = await holdUntil(['KeyA'], (x) => x.player.pos[0] > 22.2, 16000, seen2);
check('narrow ledge traversal', seen2.has('ledge') && s.player.pos[0] > 20, `x=${s.player.pos[0]} seen=${[...seen2]}`);
await shot('06-stairs');

// Assisted gap jump
await T(22.3, 6.12, 23.3, Math.PI / 2);
await camYaw(Math.PI / 2);
await wait(400);
await page.keyboard.down('KeyW');
await wait(150);
await tap('Space');
await wait(1200);
await page.keyboard.up('KeyW');
await wait(500);
s = await S();
check('assisted gap jump across broken stair', s.player.pos[0] > 24.9 && s.player.pos[1] > 6.3, `pos=${s.player.pos}`);
s = await holdUntil(['KeyW'], (x) => x.player.pos[0] > 28.3 && x.player.pos[1] > 8.3, 6000);
check('climb stair to upper landing', s.player.pos[1] > 8.3, `pos=${s.player.pos}`);

// Climb B → hang ledge B → shimmy → climb up
await T(28.8, 8.4, 23.1, 0);
await camYaw(0);
await wait(400);
await tap('KeyE');
await wait(400);
const seen3 = new Set();
s = await holdUntil(['KeyW'], (x) => x.player.mode === 'hang', 8000, seen3);
check('climb B to ledge hang', s.player.mode === 'hang', `mode=${s.player.mode}`);
await hold(['KeyW'], 600);
s = await S();
check('no climb-up where boulders block', s.player.mode === 'hang');
const seen4 = new Set();
s = await holdUntil(['KeyD'], (x) => x.player.pos[0] < 25.8, 9000, seen4);
check('shimmy along ledge (D)', s.player.pos[0] < 26.3, `x=${s.player.pos[0]}`);
s = await holdUntil(['KeyW'], (x) => x.player.mode === 'ground' && x.player.pos[1] > 11.8, 5000);
check('climb up onto the ridge', s.player.pos[1] > 11.8, `y=${s.player.pos[1]}`);
await wait(800);
s = await S();
check('ridge checkpoint', s.checkpoint === 'ch1_cliff_top', s.checkpoint);
await shot('07-ridge');

// Vault the fallen column
{
  const yaw = 0.62;
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  await T(21.2 - ax * 2.2, 12, 31.2 - az * 2.2, yaw);
  await camYaw(yaw);
  await wait(400);
  const seen5 = new Set();
  s = await holdUntil(['KeyW', 'ShiftLeft'], (x) => x.player.mode === 'vault', 3000, seen5);
  await wait(900);
  s = await S();
  const along = (s.player.pos[0] - 21.2) * ax + (s.player.pos[2] - 31.2) * az;
  check('contextual vault over fallen column', seen5.has('vault') && along > 0.4, `along=${along.toFixed(2)} seen=${[...seen5]}`);
}

// ------------------------------------------------------------------ fall + respawn
await T(14, 12.1, 25.4, Math.PI);
await camYaw(Math.PI);
await wait(300);
await hold(['KeyW'], 1200);
await wait(3500);
s = await S();
check('lethal fall respawns at checkpoint', Math.abs(s.player.pos[1] - 12) < 0.6 && s.player.mode === 'ground', `pos=${s.player.pos}`);

// ------------------------------------------------------------------ puzzle
const drum = async (x, presses) => {
  await T(x, 12, 45.25, 0);
  await camYaw(0);
  await wait(300);
  for (let i = 0; i < presses; i++) {
    await tap('KeyE');
    await wait(1700);
  }
};
await drum(5.9, 1);
s = await S();
const midSnap = await page.evaluate(() => window.__TFE.snapshot().systems['puzzle:ch1_sun_gate']);
check('drum rotates with E', midSnap.data.state[0] === 1, JSON.stringify(midSnap.data));
await shot('08-drums');
await drum(5.9, 1);
await drum(4.0, 2);
await drum(2.1, 2);
await wait(600);
s = await S();
check('puzzle solved → gate cinematic', s.puzzles.includes('ch1_sun_gate') && (s.cinematic === 'ch1_gate_open' || s.cinematicActive), `cin=${s.cinematic}`);
await wait(5000);
await shot('09-gate-cinematic');
await page.waitForFunction(() => window.__TFE.state().cinematic === null, null, { timeout: 20000 });
await wait(2600);
s = await S();
const worldSnap = await page.evaluate(() => window.__TFE.snapshot().systems['ch1.world']);
check('gate open + checkpoint after cinematic', worldSnap.data.gateOpen === true && s.checkpoint === 'ch1_gate_open', `cp=${s.checkpoint}`);
check('control returns after cinematic', s.player.mode === 'ground');
await shot('10-gate-open');

// ------------------------------------------------------------------ save / reload / continue
await tap('Escape');
await wait(400);
await page.click('button[data-action="save"]');
await wait(400);
const before = await page.evaluate(() => window.__TFE.snapshot());
await page.reload();
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
check('continue enabled after reload', !(await page.$eval('button[data-action="continue"]', (b) => b.disabled)));
await page.click('button[data-action="continue"]');
await page.waitForFunction(() => window.__TFE.state().gameState === 'playing', null, { timeout: 20000 });
await wait(1500);
const after = await page.evaluate(() => window.__TFE.snapshot());
s = await S();
check('restored chapter + checkpoint', after.chapter === before.chapter && after.checkpoint === before.checkpoint, `${after.checkpoint}`);
check('restored collectibles', JSON.stringify(after.collectibles.sort()) === JSON.stringify(before.collectibles.sort()), after.collectibles.join(','));
check('restored puzzle + gate state', after.systems['puzzle:ch1_sun_gate'].data.solved === true && after.systems['ch1.world'].data.gateOpen === true);
check('restored exact position (manual save)', Math.hypot(s.player.pos[0] - before.systems.player.data.pos[0], s.player.pos[2] - before.systems.player.data.pos[2]) < 0.5, `pos=${s.player.pos}`);

// ------------------------------------------------------------------ settings persistence
{
  await tap('Escape');
  await wait(300);
  await page.click('.pause button[data-action="settings"]');
  await wait(300);
  await page.click('.seg button[data-value="medium"]');
  await page.click('button[data-tab="controls"]');
  await wait(200);
  // Rebind "Journal" to KeyK
  const btns = await page.$$('.keybtn');
  await btns[btns.length - 1].click();
  await page.keyboard.press('KeyK');
  await wait(200);
  await page.click('button[data-action="close-settings"]');
  await wait(200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tfe.settings.v1')));
  check('settings persist (quality + rebinding)', stored.quality === 'medium' && stored.bindings.journal[0] === 'KeyK', `${stored.quality} ${stored.bindings.journal}`);
  await page.click('button[data-action="resume"]');
  await wait(400);
  await tap('KeyK');
  await wait(400);
  s = await S();
  check('rebound key works in game', s.gameState === 'journal');
  await tap('KeyK');
  await wait(400);
}

// ------------------------------------------------------------------ quality presets
const fpsAt = async (q) => {
  await page.evaluate((q) => window.__TFE.setQuality(q), q);
  await T(2.5, 0, -19, 0);
  await camYaw(0);
  await wait(3500);
  const x = await S();
  return { q, label: x.quality, fps: x.fps.toFixed(0), calls: x.drawCalls, tris: Math.round(x.triangles / 1000) + 'k' };
};
const perf = [await fpsAt('low'), await fpsAt('medium'), await fpsAt('high')];
for (const p of perf) console.log('  quality', JSON.stringify(p));
check('quality presets switch live', perf[0].label === 'LOW' && perf[1].label === 'MEDIUM' && perf[2].label.startsWith('HIGH'));
await shot('11-camp-high');

// ------------------------------------------------------------------ chapter end
await T(4, 12, 52.5, 0);
await camYaw(0);
s = await holdUntil(['KeyW'], (x) => x.cinematic === 'ch1_city_reveal', 5000);
check('city reveal cinematic on terrace', s.cinematic === 'ch1_city_reveal');
await wait(6000);
await shot('12-city-reveal');
await page.waitForFunction(() => window.__TFE.state().gameState === 'ended', null, { timeout: 20000 }).catch(() => {});
await wait(2000);
s = await S();
check('chapter complete → end card', s.gameState === 'ended' && s.chapter === 2, `state=${s.gameState} ch=${s.chapter}`);
await shot('13-end-card');

// ------------------------------------------------------------------ report
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
