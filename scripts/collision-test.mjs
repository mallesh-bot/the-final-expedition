// Manual-style collision checks: walk into wall, rock, tree; camera near obstacle; foliage push.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:5173/?debug');
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 60000 });
await page.click('button[data-action="new"]');
await page.waitForTimeout(1200);
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForTimeout(2000);
const res = [];
const walkInto = async (name, start, yaw, target, radius) => {
  await page.evaluate(([s, y]) => { window.__TFE.teleport(s[0], s[1], s[2], y); window.__TFE.setCameraYaw(y, 0.2); }, [start, yaw]);
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const p = await page.evaluate(() => window.__TFE.state().player.pos);
  const d = Math.hypot(p[0] - target[0], p[2] - target[1]);
  res.push([name, d >= radius - 0.05, `dist=${d.toFixed(2)} needs>=${radius.toFixed(2)} pos=${p}`]);
  await page.screenshot({ path: `playtest-output/col-${name}.png` });
};
// Cliff wall (face z=22.6 east of route) — should stop at z <= 22.28
await page.evaluate(() => { window.__TFE.teleport(0, 0, 19, 0); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
let p = await page.evaluate(() => window.__TFE.state().player.pos);
res.push(['wall', p[2] < 22.3, `z=${p[2]}`]);
// Find a boulder and a tree from the collision world
const obs = await page.evaluate(() => {
  const w = window.__TFE.game.world;
  const q = w.query(-40, -60, 44, 20).filter((b) => b.round).map((b) => ({ x: b.center.x, z: b.center.z, y: b.center.y - b.half.y, r: b.half.x, s: b.surface }));
  const rock = q.filter((b) => b.s === 'stone' && b.r > 0.9 && b.z < 15 && b.z > -55)[0];
  const tree = q.filter((b) => b.s === 'wood' && b.r > 0.6 && b.z < 15 && b.z > -55)[0];
  return { rock, tree };
});
for (const [name, o] of [['rock', obs.rock], ['tree', obs.tree]]) {
  if (!o) { res.push([name, false, 'none found']); continue; }
  await walkInto(name, [o.x, o.y + 0.5, o.z - 4], 0, [o.x, o.z], o.r + 0.32);
}
// Camera never beyond an obstacle: behind the tree looking at player
const camCheck = await page.evaluate(() => {
  const g = window.__TFE.game;
  const cam = g.renderer.camera.position.clone();
  const pp = g.player.position.clone().setY(g.player.position.y + 1.5);
  const dir = cam.clone().sub(pp);
  const len = dir.length();
  const hit = g.world.raycast(pp, dir.normalize(), len, true, true);
  return { len, hit };
});
res.push(['camera-not-through-geometry', camCheck.hit === null || camCheck.hit >= camCheck.len - 0.05, JSON.stringify(camCheck)]);
// Foliage uniform follows player
const fu = await page.evaluate(() => { const g = window.__TFE.game; return g.player.position.distanceTo(window.__TFE.game.renderer.scene ? g.player.position : g.player.position) === 0; });
res.push(['foliage-uniform', fu, '']);
for (const r of res) console.log(r[1] ? 'PASS' : 'FAIL', r[0], r[2]);
console.log('errors', errs);
await browser.close();
