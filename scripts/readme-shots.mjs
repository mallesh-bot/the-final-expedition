// Captures the README screenshots (debug overlay hidden) into docs/screenshots/.
import { chromium } from 'playwright';
const out = 'docs/screenshots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5173/?debug');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 60000 });
await page.addStyleTag({ content: '.dev{display:none!important}' });
const snap = (n) => page.screenshot({ path: `${out}/${n}.jpg`, type: 'jpeg', quality: 86 });
const E = (f, a) => page.evaluate(f, a);
const T = (x, y, z, yaw, pitch = 0.16) => E(([x, y, z, yaw, pitch]) => { window.__TFE.teleport(x, y, z, yaw); window.__TFE.setCameraYaw(yaw, pitch); }, [x, y, z, yaw, pitch]);
const wait = (ms) => page.waitForTimeout(ms);
await wait(2500);
await snap('main-menu');
await page.click('button[data-action="new"]');
await wait(4200);
await snap('intro-title');
await E(() => window.__TFE.skipCinematic());
await wait(6000);
await T(-2, 0, -57, 0.05); await wait(1500); await snap('river-landing');
await T(-1.5, 0, -56.5, 2.6, 0.1); await wait(1500); await snap('toby-campfire');
await T(1.5, 0, -40, 0.2, 0.12); await wait(1500); await snap('jungle-trail');
await T(2.5, 0, -19, 0, 0.18); await wait(2500); await snap('camp-four');
await E(() => window.__TFE.freeCam(-9, 2.2, 10, -16, 5, 22)); await wait(1500); await snap('waterfall');
await E(() => window.__TFE.clearFreeCam());
// Climbing
await T(10, 0, 21.6, 0, 0.1); await wait(400);
await page.keyboard.down('KeyE'); await wait(80); await page.keyboard.up('KeyE');
await page.keyboard.down('KeyW'); await wait(1500); await page.keyboard.up('KeyW');
await E(() => window.__TFE.setCameraYaw(0.5, 0.1)); await wait(1200); await snap('cliff-climb');
// Narrow ledge
await T(12.2, 4.6, 23.15, 0, 0.15); await wait(300);
await page.keyboard.down('KeyA'); await wait(2200); await page.keyboard.up('KeyA'); await wait(900); await snap('narrow-ledge');
// Puzzle
await T(4, 12, 43.2, 0, 0.1); await wait(1800); await snap('gate-drums');
// Journal
await E(() => { const g = window.__TFE.game; ['ch1_journal_1','ch1_journal_2','ch1_journal_3','ch1_relic_token'].forEach((c) => g.state.progress.collectibles.add(c)); });
await page.keyboard.down('KeyJ'); await wait(80); await page.keyboard.up('KeyJ'); await wait(600);
await page.click('.journal li:nth-child(2)'); await wait(500); await snap('journal');
await page.keyboard.down('KeyJ'); await wait(80); await page.keyboard.up('KeyJ'); await wait(800);
// Gate opening cinematic
await E(() => window.__TFE.chapter().puzzle.debugSolve());
await wait(5200); await snap('gate-opening');
await page.waitForFunction(() => window.__TFE.state().cinematic === null, null, { timeout: 25000 });
await wait(2000);
// City reveal
await T(4, 12, 53.5, 0, 0.1);
await page.keyboard.down('KeyW'); await wait(1300); await page.keyboard.up('KeyW');
await wait(12500); await snap('city-reveal');
await browser.close();
console.log('done');
