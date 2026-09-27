// Worst-case proxy: software WebGL (SwiftShader). Reports probe choice + FPS per preset.
import { chromium } from 'playwright';
const angle = process.argv[2] ?? 'swiftshader';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--use-angle=${angle}`, '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?debug');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 180000 });
let s = await page.evaluate(() => window.__TFE.state());
console.log('gpu', s.gpu, '→ default quality', s.quality);
await page.click('button[data-action="new"]');
await page.waitForTimeout(3000);
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForTimeout(3000);
for (const q of ['low', 'medium', 'high']) {
  await page.evaluate((q) => { window.__TFE.setQuality(q); window.__TFE.teleport(2.5, 0, -19, 0); window.__TFE.setCameraYaw(0, 0.18); }, q);
  await page.waitForTimeout(6000);
  s = await page.evaluate(() => window.__TFE.state());
  console.log(q, s.quality, 'fps', s.fps.toFixed(1), 'ms', s.frameMs.toFixed(1), 'calls', s.drawCalls);
}
await browser.close();
