// Quick smoke probe: loads the game, waits for the menu, reports console errors + GPU + screenshot.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/?debug';
const headless = !process.argv.includes('--headed');
const browser = await chromium.launch({
  channel: 'chrome',
  headless,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__TFE && window.__TFE.state().gameState === 'menu', null, { timeout: 180000 }).catch((e) => errors.push('menu timeout ' + e.message));
console.log('menu after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(2500);
const st = await page.evaluate(() => window.__TFE?.state());
console.log(JSON.stringify(st, null, 1));
await page.screenshot({ path: 'playtest-output/probe-menu.png' });
const counts = new Map();
for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
console.log('ERRORS (' + errors.length + '):');
for (const [e, n] of counts) console.log(`x${n} ` + e.slice(0, 3000));
await browser.close();
