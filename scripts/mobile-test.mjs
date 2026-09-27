// Touch/responsive playtest across phone & tablet viewports (Chromium mobile emulation + CDP multi-touch).
//   npm run dev   then   node scripts/mobile-test.mjs [--quick]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.TFE_URL ?? 'http://localhost:5173/?debug';
const DEVICES = [
  ['iphone14-portrait', 390, 844, 3],
  ['iphone14-landscape', 844, 390, 3],
  ['android-small', 360, 640, 2],
  ['pixel7-landscape', 915, 412, 2.6],
  ['ipad-portrait', 820, 1180, 2],
  ['ipad-landscape', 1180, 820, 2],
];
mkdirSync('playtest-output/mobile', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
const quick = process.argv.includes('--quick');

for (const [name, w, h, dpr] of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const check = (n, ok, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${name}] ${n}${d ? '  — ' + d : ''}`);
  };
  const S = () => page.evaluate(() => window.__TFE.state());
  const wait = (ms) => page.waitForTimeout(ms);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const center = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const holdAt = async (pt, ms) => {
    await touch('touchStart', [pt]);
    await wait(ms);
    await touch('touchEnd', []);
  };
  const shot = (n) => page.screenshot({ path: `playtest-output/mobile/${name}-${n}.png` });
  /** Every visible interactive element must lie inside the viewport. */
  const overflow = (sel) =>
    page.evaluate((sel) => {
      const bad = [];
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${e.className || e.tagName}:${e.textContent.slice(0, 12)}`);
      }
      return bad.concat(document.documentElement.scrollWidth > innerWidth ? ['page-hscroll'] : []);
    }, sel);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
  check('boot → menu, touch mode on', await page.evaluate(() => document.body.classList.contains('touch')), (await S()).quality);
  await wait(800);
  const o1 = await overflow('.menu:not(.pause) button');
  check('menu fits viewport', o1.length === 0, o1.join(','));
  await shot('01-menu');

  await page.tap('button[data-action="new"]');
  await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 15000 });
  await wait(1500);
  check('touch controls hidden-but-jump in cinematic', await page.evaluate(() => {
    const ui = document.querySelector('.touch-ui');
    return ui.classList.contains('show') && ui.classList.contains('cine') && getComputedStyle(ui.querySelector('.interact')).display === 'none';
  }));
  await shot('02-intro');
  await holdAt(await center('.tbtn.jump'), 1200);
  await wait(2500);
  let s = await S();
  check('hold JUMP button skips intro', s.cinematic === null && s.player.mode === 'ground', `cin=${s.cinematic}`);
  const o2 = await overflow('.touch-ui .tbtn, .minimap');
  check('HUD controls inside viewport', o2.length === 0, o2.join(','));
  await shot('03-hud');
  if (quick && name !== 'iphone14-portrait' && name !== 'ipad-landscape') {
    check('no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    continue;
  }

  // Move stick
  await page.evaluate(() => window.__TFE.setCameraYaw(0.05, 0.2));
  const p0 = s.player.pos;
  const sx = w * 0.18, sy = h * 0.72;
  await touch('touchStart', [[sx, sy]]);
  await touch('touchMove', [[sx, sy - 25]]);
  await touch('touchMove', [[sx, sy - 55]]);
  await wait(1500);
  s = await S();
  const d = Math.hypot(s.player.pos[0] - p0[0], s.player.pos[2] - p0[2]);
  check('stick moves player', d > 2.5, `d=${d.toFixed(2)}`);
  await touch('touchMove', [[sx, sy - 140]]);
  await wait(900);
  s = await S();
  check('over-push sprints', s.player.sprinting, `speed=${s.player.speed}`);
  await shot('04-stick');
  // Simultaneous look while moving (multi-touch)
  const yaw0 = s.cameraYaw;
  const lx = w * 0.7, ly = h * 0.4;
  await touch('touchMove', [[sx, sy - 140], [lx, ly]]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[sx, sy - 140], [lx + i * 20, ly]]);
    await wait(30);
  }
  await touch('touchEnd', []);
  s = await S();
  check('drag right side rotates camera (while moving)', Math.abs(s.cameraYaw - yaw0) > 0.1, `dyaw=${(s.cameraYaw - yaw0).toFixed(2)}`);
  await wait(800);
  // Jump
  const y0 = (await S()).player.pos[1];
  await holdAt(await center('.tbtn.jump'), 80);
  await wait(250);
  s = await S();
  check('JUMP button jumps', s.player.pos[1] - y0 > 0.4, `dy=${(s.player.pos[1] - y0).toFixed(2)}`);
  await wait(900);
  check('no accidental pointer lock', !(await S()).pointerLocked);
  // Pause
  await holdAt(await center('.tbtn.pause'), 60);
  await wait(700);
  check('pause button pauses', (await S()).gameState === 'paused');
  const o3 = await overflow('.pause button, .pause .objective');
  check('pause menu fits', o3.length === 0, o3.join(','));
  await shot('05-pause');
  await page.tap('.pause button[data-action="settings"]');
  await wait(700);
  const o4 = await overflow('.panel');
  check('settings panel fits', o4.length === 0, o4.join(','));
  await shot('06-settings');
  await page.tap('.panel .actions button >> nth=-1').catch(() => {});
  await wait(500);
  if (await page.isVisible('.panel')) await page.tap('.panel .actions button >> nth=0');
  await wait(500);
  await page.tap('.pause button[data-action="resume"]');
  await wait(600);
  check('resume via tap', (await S()).gameState === 'playing');
  // Journal
  await holdAt(await center('.tbtn.journal'), 60);
  await wait(700);
  check('journal button opens journal', (await S()).gameState === 'journal');
  await shot('07-journal');
  await page.tap('.journal .close button');
  await wait(700);
  check('journal Close button returns to game', (await S()).gameState === 'playing');
  await wait(3000);
  s = await S();
  check('perf sample', true, `${s.fps?.toFixed(0)} fps · ${s.quality} · ${s.drawCalls} calls`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Desktop unchanged: no touch UI, no body.touch
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
const desk = await page.evaluate(() => ({ touch: document.body.classList.contains('touch'), fov: window.__TFE.state().quality }));
console.log(`${desk.touch ? 'FAIL' : 'PASS'}  [desktop] no touch mode · ${desk.fov}`);
if (desk.touch) fails++;
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
