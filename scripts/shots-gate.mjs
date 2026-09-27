// Captures the gate-opening and city-reveal cinematics at several moments.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:5173/?debug');
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 60000 });
await page.click('button[data-action="new"]');
await page.waitForTimeout(1200);
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForTimeout(2000);
await page.evaluate(() => window.__TFE.chapter().puzzle.debugSolve());
for (const t of [1.5, 4, 7, 10, 13]) {
  await page.waitForTimeout(t === 1.5 ? 2400 : 3000);
  await page.screenshot({ path: `playtest-output/gate-${t}.png` });
}
await page.waitForFunction(() => window.__TFE.state().cinematic === null, null, { timeout: 20000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'playtest-output/gate-after.png' });
await page.evaluate(() => { window.__TFE.teleport(4, 12, 53.5, 0); window.__TFE.setCameraYaw(0, 0.2); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
for (const t of [3, 7, 11]) {
  await page.waitForTimeout(t === 3 ? 3000 : 4000);
  await page.screenshot({ path: `playtest-output/city-${t}.png` });
}
console.log('errors', errs);
await browser.close();
