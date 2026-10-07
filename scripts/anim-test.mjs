// Animation integrity checks (PRD §11.3): feet on slopes (foot IK) and head look-at.
//   npm run dev   then   node scripts/anim-test.mjs     (set TFE_URL if not on :5173)
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

mkdirSync('playtest-output', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 15000 });
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForFunction(() => window.__TFE.state().player.mode === 'ground', null, { timeout: 15000 });
const res = [];
const check = (n, ok, d = '') => res.push([n, !!ok, d]);
const E = (f, a) => page.evaluate(f, a);

// 1. Reference: foot heights on flat ground (camp clearing).
await E(() => { window.__TFE.teleport(2.5, 0, -19, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(1.5);
const flat = await E(() => window.__TFE.footGaps());
check('flat ground: feet on the ground', flat.every((g) => g > -0.02 && g < 0.2), `gaps=${flat}`);
const ref = Math.min(...flat);

// 2. On a real slope, with and without foot IK.
let slope = null;
for (const [cx, cz] of [[-20, -30], [34, -20], [-30, -20], [36, 0], [-32, 5], [20, -45]]) {
  slope = await E(([x, z]) => window.__TFE.findSlope(x, z, 0.86, 0.97), [cx, cz]);
  if (slope && slope.ny < 0.96) break;
}
if (!slope) check('found a test slope', false);
else {
  const measure = async (on) => {
    await E((on) => window.__TFE.setFootIK(on), on);
    await E((s) => { window.__TFE.teleport(s.x, s.y, s.z, s.yaw); window.__TFE.setCameraYaw(s.yaw + Math.PI / 2, 0.2); }, slope);
    await waitSim(1.5);
    return E(() => window.__TFE.footGaps());
  };
  const off = await measure(false);
  const on = await measure(true);
  const errOff = Math.max(...off.map((g) => Math.abs(g - ref)));
  const errOn = Math.max(...on.map((g) => Math.abs(g - ref)));
  check(`slope (normal.y ${slope.ny}): feet planted with IK (<= 3 cm vs flat)`, errOn <= 0.03, `IK on gaps=${on} err=${errOn.toFixed(3)} | IK off gaps=${off} err=${errOff.toFixed(3)}`);
  check('IK improves on the clip pose', errOn < errOff, `${errOn.toFixed(3)} < ${errOff.toFixed(3)}`);
  await page.screenshot({ path: 'playtest-output/anim-slope.png' });
}

// 3. Head look-at: stand beside Toby, facing past him; the head should turn toward him.
await E(() => { window.__TFE.setFootIK(true); window.__TFE.teleport(1.2, 0, -58.0, 0.9); window.__TFE.setCameraYaw(0.9, 0.2); });
await E(() => window.__TFE.setLookAt(false));
await waitSim(1.2);
const q0 = await E(() => window.__TFE.headQuat());
const toby = [2.6, 1.2, -59.2];
const errOff = await E(([t, q]) => window.__TFE.lookError(t[0], t[1], t[2], q), [toby, q0]);
await E(() => window.__TFE.setLookAt(true));
await waitSim(1.5);
const errOn = await E(([t, q]) => window.__TFE.lookError(t[0], t[1], t[2], q), [toby, q0]);
check('head turns TOWARD the point of interest (gaze error shrinks by > 15 deg)', errOff - errOn > 15, `gaze error off=${errOff} on=${errOn}`);
await page.screenshot({ path: 'playtest-output/anim-lookat.png' });

check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
for (const r of res) console.log(r[1] ? 'PASS' : 'FAIL', r[0], r[2]);
const failed = res.filter((r) => !r[1]).length;
console.log(`\n${res.length - failed}/${res.length} animation checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
