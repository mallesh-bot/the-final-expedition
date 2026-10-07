// Collision & camera integrity checks (dev server must be running; set TFE_URL if not :5173).
//   node scripts/collision-test.mjs
// Exits 1 on any failure. All waits are simulation time, so results don't depend on GPU speed.
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

mkdirSync('playtest-output', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim, holdSim } = simHelpers(page);
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 15000 });
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForFunction(() => window.__TFE.state().player.mode === 'ground', null, { timeout: 15000 });
await waitSim(0.8);

const res = [];
const check = (name, ok, detail = '') => res.push([name, !!ok, detail]);
const place = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => { window.__TFE.teleport(x, y, z, yaw); window.__TFE.setCameraYaw(yaw, 0.2); }, [x, y, z, yaw]);
const pos = () => page.evaluate(() => window.__TFE.state().player.pos);
const pen = () => page.evaluate(() => window.__TFE.penetration());

// 1. Walk north into the lower cliff wall (face at z = 22.6): must stop flush, not pass or embed.
await place(10, 0, 19, 0);
await waitSim(0.3);
let maxPen = 0;
await page.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) {
  await waitSim(0.25);
  maxPen = Math.max(maxPen, await pen());
}
await page.keyboard.up('KeyW');
let p = await pos();
check('wall: reaches the wall and stops flush', p[2] > 21.9 && p[2] < 22.3, `z=${p[2]}`);
check('wall: never embedded', maxPen <= 0.02, `maxPen=${maxPen.toFixed(3)}`);
await page.screenshot({ path: 'playtest-output/col-wall.png' });

// 2. Walk into a large boulder and a tree trunk (found from the collision world).
const obs = await page.evaluate(() => {
  const w = window.__TFE.game.world;
  const q = w.query(-40, -60, 44, 20).filter((b) => b.round).map((b) => ({ x: b.center.x, z: b.center.z, y: b.center.y - b.half.y, r: b.half.x, s: b.surface }));
  const rock = q.filter((b) => b.s === 'stone' && b.r > 0.9 && b.z < 15 && b.z > -55)[0];
  const tree = q.filter((b) => b.s === 'wood' && b.r > 0.6 && b.z < 15 && b.z > -55)[0];
  return { rock, tree };
});
for (const [name, o] of [['rock', obs.rock], ['tree', obs.tree]]) {
  if (!o) {
    check(name, false, 'none found');
    continue;
  }
  await place(o.x, o.y + 0.5, o.z - 4, 0);
  await waitSim(0.3);
  let mp = 0;
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 10; i++) {
    await waitSim(0.25);
    mp = Math.max(mp, await pen());
  }
  await page.keyboard.up('KeyW');
  p = await pos();
  const d = Math.hypot(p[0] - o.x, p[2] - o.z);
  check(`${name}: stops at the proxy`, d >= o.r + 0.32 - 0.05, `dist=${d.toFixed(2)} needs>=${(o.r + 0.27).toFixed(2)}`);
  check(`${name}: never embedded`, mp <= 0.02, `maxPen=${mp.toFixed(3)}`);
  await page.screenshot({ path: `playtest-output/col-${name}.png` });

  // 3. Camera: orbit 8 directions around the player next to the obstacle; nothing solid may sit
  //    between the pivot and the camera.
  let blocked = 0;
  for (let k = 0; k < 8; k++) {
    await page.evaluate((y) => window.__TFE.setCameraYaw(y, 0.25), (k / 8) * Math.PI * 2);
    await waitSim(0.6);
    const c = await page.evaluate(() => window.__TFE.cameraClear());
    if (c.hit !== null && c.hit < c.len - 0.05) blocked++;
  }
  check(`${name}: camera never behind geometry (8 angles)`, blocked === 0, `blocked=${blocked}`);
}

// 4. Camp props that used to be walk-through (stove, cots, campfire): walking straight at them
//    must never put the capsule inside them (sliding around them is fine).
for (const [name, x, z, tx, tz] of [['stove', 3.4, -9.6, 3.4, -8.0], ['cot', 4.4, -5.2, 4.4, -3.4], ['campfire', 4.2, -12.4, 4.2, -10.6]]) {
  await place(x, 0.1, z, 0);
  await waitSim(0.2);
  let mp = 0;
  let closest = 99;
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 6; i++) {
    await waitSim(0.2);
    mp = Math.max(mp, await pen());
    const q = await pos();
    closest = Math.min(closest, Math.hypot(q[0] - tx, q[2] - tz));
  }
  await page.keyboard.up('KeyW');
  check(`${name}: solid (never entered)`, mp <= 0.02 && closest > 0.3, `maxPen=${mp.toFixed(3)} closest=${closest.toFixed(2)}`);
}

// 5. Foliage interaction uniform tracks the player.
await holdSim(['KeyA'], 0.5);
await waitSim(0.6); // let her come to rest: the uniform is written once per rendered frame
const fp = await page.evaluate(() => window.__TFE.foliagePlayer());
p = await pos();
check('foliage uniform follows the player', Math.hypot(fp[0] - p[0], fp[2] - p[2]) < 0.05, `uniform=${fp.map((v) => v.toFixed(2))} player=${p}`);

// 6. Sweep: thousands of moves against every collider.
const sweep = await page.evaluate(() => window.__TFE.collisionSweep(3000, 3));
check('sweep: capsule never embedded > 2 cm', sweep.worst <= 0.02, JSON.stringify(sweep).slice(0, 400));

check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
for (const r of res) console.log(r[1] ? 'PASS' : 'FAIL', r[0], r[2]);
const failed = res.filter((r) => !r[1]).length;
console.log(`\n${res.length - failed}/${res.length} collision checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
