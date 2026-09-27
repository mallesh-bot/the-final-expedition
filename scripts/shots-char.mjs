// Close-up character poses for animation review (free camera beside the player).
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?debug');
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 60000 });
await page.click('button[data-action="new"]');
await page.waitForTimeout(1200);
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForTimeout(2000);
const E = (f, a) => page.evaluate(f, a);
// Idle close-up at the landing (lit by the fire)
await E(() => { window.__TFE.teleport(0, 0, -57.5, -1.2); });
await page.waitForTimeout(600);
await E(() => window.__TFE.freeCam(-1.6, 1.5, -56.2, 0, 1.1, -57.5));
await page.waitForTimeout(900);
await page.screenshot({ path: 'playtest-output/char-idle.png' });
// Running (camera tracks alongside)
await E(() => { window.__TFE.clearFreeCam(); window.__TFE.teleport(1.5, 0, -45, 0.2); window.__TFE.setCameraYaw(0.2, 0.1); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
const s = await E(() => window.__TFE.state().player.pos);
await E((p) => window.__TFE.freeCam(p[0] - 3.2, 1.3, p[2] + 2.6, p[0], 1.0, p[2] + 2.2), s);
await page.waitForTimeout(250);
await page.screenshot({ path: 'playtest-output/char-run.png' });
await page.keyboard.up('KeyW');
// Climbing
await E(() => { window.__TFE.clearFreeCam(); window.__TFE.teleport(10, 0, 21.6, 0); window.__TFE.setCameraYaw(0, 0.2); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await E(() => window.__TFE.freeCam(12.2, 2.4, 19.8, 10, 2.2, 22.4));
await page.waitForTimeout(250);
await page.screenshot({ path: 'playtest-output/char-climb.png' });
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
const st = await E(() => window.__TFE.state().player);
console.log('after climb', st.mode, st.anim, st.pos);
await E(() => window.__TFE.freeCam(12.4, 3.6, 20.2, 10, 3.4, 22.5));
await page.waitForTimeout(300);
await page.screenshot({ path: 'playtest-output/char-hang.png' });
await browser.close();
