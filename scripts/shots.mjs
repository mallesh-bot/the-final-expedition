// Visual review: starts a new game, skips the intro and captures framed screenshots.
import { chromium } from 'playwright';
const base = 'http://localhost:5173/?debug';
const only = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 1500)); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(base);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'playtest-output/shot-menu.png' });
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 20000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'playtest-output/shot-intro1.png' });
await page.waitForTimeout(4500);
await page.screenshot({ path: 'playtest-output/shot-intro2.png' });
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForTimeout(2500);
const T = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => window.__TFE.teleport(x, y, z, yaw), [x, y, z, yaw]);
const cam = (yaw, pitch) => page.evaluate(([a, b]) => window.__TFE.setCameraYaw(a, b), [yaw, pitch]);
const free = (...a) => page.evaluate((a) => window.__TFE.freeCam(...a), a);
const shots = [
  ['landing', async () => { await T(-2, 0, -57, 0.05); await cam(0.05, 0.15); }],
  ['landing-fire', async () => { await T(-1.5, 0, -56.5, 2.6); await cam(2.6, 0.1); }],
  ['trail', async () => { await T(1.5, 0, -40, 0.2); await cam(0.2, 0.1); }],
  ['camp', async () => { await T(2.5, 0, -19, 0); await cam(0.0, 0.18); }],
  ['camp2', async () => { await T(5, 0, -8, 3.4); await cam(3.4, 0.2); }],
  ['cliffbase', async () => { await T(10, 0, 16, 0); await cam(0, -0.15); }],
  ['cliffwide', async () => { await free(-4, 4, 2, 10, 7, 24); }],
  ['waterfall', async () => { await free(-10, 2.5, 8, -16, 5, 22); }],
  ['ridge', async () => { await T(25.4, 12, 26.4, -0.6); await cam(-0.6, 0.1); }],
  ['plaza', async () => { await T(4, 12, 42, 0); await cam(0, 0.12); }],
  ['gate-close', async () => { await T(4, 12, 45.2, 0); await cam(0, 0.05); }],
  ['valley-from-ridge', async () => { await free(10, 16, 30, 0, 4, -30); }],
];
for (const [name, fn] of shots) {
  if (only && !name.startsWith(only)) continue;
  await page.evaluate(() => window.__TFE.clearFreeCam());
  await fn();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `playtest-output/shot-${name}.png` });
  const s = await page.evaluate(() => window.__TFE.state());
  console.log(name, 'fps', s.fps.toFixed(0), 'calls', s.drawCalls, 'tris', (s.triangles / 1000).toFixed(0) + 'k', s.player.mode, s.player.pos.join(','));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
