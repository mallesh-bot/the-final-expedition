// In-engine character review shots (gameplay camera + free-camera close-ups).
//   npm run dev   then   node scripts/shots-char.mjs      (set TFE_URL if not on :5173)
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

mkdirSync('playtest-output', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('console', (m) => m.type() === 'warning' && /Anim|clip/.test(m.text()) && console.log('WARN', m.text()));
const { waitSim } = simHelpers(page);
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.evaluate(() => window.__TFE.setQuality('high'));
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 15000 });
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForFunction(() => window.__TFE.state().player.mode === 'ground', null, { timeout: 15000 });
await waitSim(1.5);
const E = (f, a) => page.evaluate(f, a);
const shot = async (name) => {
  await page.screenshot({ path: `playtest-output/char-${name}.png` });
  console.log('shot', name, JSON.stringify(await E(() => window.__TFE.state().player)));
};

// 1. Gameplay camera at the landing, as the player first sees her.
await E(() => { window.__TFE.teleport(-1.5, 0, -57, 0.6); window.__TFE.setCameraYaw(0.6, 0.15); });
await waitSim(1.2);
await shot('gameplay');
// 2. Ines close-up, firelit.
await E(() => { window.__TFE.teleport(0, 0, -57.5, -1.2); });
await waitSim(0.8);
await E(() => window.__TFE.freeCam(-1.25, 1.62, -57.0, 0, 1.52, -57.5));
await waitSim(0.6);
await shot('ines-face');
await E(() => window.__TFE.freeCam(-2.8, 1.2, -56.2, 0, 0.95, -57.5));
await waitSim(0.4);
await shot('ines-full');
// 3. Toby at the fire.
await E(() => window.__TFE.freeCam(1.0, 1.3, -57.6, 2.6, 0.9, -59.2));
await waitSim(0.6);
await shot('toby');
await E(() => window.__TFE.clearFreeCam());
// 4. Running, seen from the side.
await E(() => { window.__TFE.teleport(1.5, 0, -45, 0.2); window.__TFE.setCameraYaw(0.2, 0.1); });
await page.keyboard.down('KeyW');
await waitSim(1.0);
let p = await E(() => window.__TFE.state().player.pos);
await E((p) => window.__TFE.freeCam(p[0] - 3.4, 1.3, p[2] + 2.8, p[0], 1.0, p[2] + 2.0), p);
await waitSim(0.12);
await shot('run');
await page.keyboard.up('KeyW');
await E(() => window.__TFE.clearFreeCam());
// 5. Climb and hang on the red-rock wall.
await E(() => { window.__TFE.teleport(10, 0, 21.6, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(0.4);
await page.keyboard.press('KeyE');
await waitSim(0.4);
await page.keyboard.down('KeyW');
await waitSim(0.9);
await E(() => window.__TFE.freeCam(12.2, 2.4, 19.8, 10, 2.2, 22.4));
await waitSim(0.1);
await shot('climb');
await waitSim(1.4);
await page.keyboard.up('KeyW');
await waitSim(0.3);
await E(() => window.__TFE.freeCam(12.4, 3.6, 20.2, 10, 3.4, 22.5));
await waitSim(0.2);
await shot('hang');
await E(() => window.__TFE.clearFreeCam());
// 6. Gameplay camera on the climb.
await waitSim(0.6);
await shot('hang-gameplay');
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
