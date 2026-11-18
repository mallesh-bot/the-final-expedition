// Frame-by-frame contact sheets of the player's movement, for animation review.
//   npm run dev   then   node scripts/anim-sheet.mjs [section ...]
// Slows the simulation so each frame is exactly `spacing` sim-seconds apart.
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const OUT = 'playtest-output/anim';
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 520, height: 620 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 30000 });
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForFunction(() => window.__TFE.state().player.mode === 'ground', null, { timeout: 15000 });

await page.evaluate(() => {
  const T = window.__TFE;
  document.querySelectorAll('.hud, .layer.hud, .card').forEach((e) => (e.style.visibility = 'hidden'));
  T.reviewLight(true);
  window.__follow = null;
  const step = () => {
    const f = window.__follow;
    if (f) {
      const p = T.state().player.pos;
      T.freeCam(p[0] + f[0], p[1] + f[1], p[2] + f[2], p[0], p[1] + f[3], p[2]);
    }
    requestAnimationFrame(step);
  };
  step();
});
const E = (f, a) => page.evaluate(f, a);
const follow = (o) => E((o) => (window.__follow = o), o);
const slow = (k) => E((k) => (window.__TFE.game.clock.timeScale = k), k);
const T = (x, y, z, yaw = 0) => E(([x, y, z, yaw]) => { window.__TFE.teleport(x, y, z, yaw); window.__TFE.setCameraYaw(yaw, 0.2); }, [x, y, z, yaw]);
const tap = async (k) => {
  await page.keyboard.down(k);
  await waitSim(0.05);
  await page.keyboard.up(k);
};
const mode = () => E(() => window.__TFE.state().player);

/** n frames, `spacing` sim-seconds apart, composed into one labelled sheet. */
async function sheet(name, n, spacing, cols = 8) {
  await slow(0.08);
  const frames = [];
  const probes = [];
  for (let i = 0; i < n; i++) {
    const png = await page.screenshot({ type: 'jpeg', quality: 80 });
    const s = await mode();
    const r = await E(() => window.__TFE.rigProbe());
    probes.push({ i, mode: s.mode, state: r.state, pos: s.pos, pelvis: r.pelvis, chest: r.chest, head: r.head, err: r.limbs.map((l) => l.err), planted: r.limbs.map((l) => +l.planted) });
    frames.push({ src: `data:image/jpeg;base64,${png.toString('base64')}`, label: `${i} ${s.mode} ${r.state} y${s.pos[1].toFixed(2)}` });
    await waitSim(spacing, 60000);
  }
  await slow(1);
  const p2 = await browser.newPage({ viewport: { width: 1800, height: 900 } });
  await p2.setContent(
    `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px">` +
      frames.map((f) => `<div style="position:relative"><img src="${f.src}" style="width:100%;display:block"><span style="position:absolute;left:3px;top:2px;color:#fff;font:11px monospace;text-shadow:0 0 3px #000">${f.label}</span></div>`).join('') +
      '</body>',
  );
  await p2.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, type: 'png' });
  await p2.close();
  writeFileSync(`${OUT}/${name}.json`, probes.map((p) => JSON.stringify(p)).join('\n'));
  console.log(`${name}: ${frames[n - 1].label}`);
}

const sections = {
  climb: async () => {
    await T(10, 0, 21.6, 0);
    await waitSim(0.6);
    await follow([0.4, 0.5, -2.1, 1.05]);
    await tap('KeyE');
    await page.keyboard.down('KeyW');
    await sheet('climb-back', 16, 0.1);
    await T(10, 0, 21.6, 0);
    await waitSim(0.6);
    await follow([2.4, 0.5, -0.5, 1.05]);
    await tap('KeyE');
    await sheet('climb-side', 16, 0.1);
    await page.keyboard.up('KeyW');
  },
  hang: async () => {
    await T(28.8, 8.4, 23.1, 0);
    await waitSim(0.5);
    await follow([-2.2, 0.0, -2.2, 0.6]);
    await tap('KeyE');
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 200; i++) {
      if ((await mode()).mode === 'hang') break;
      await waitSim(0.1);
    }
    await page.keyboard.up('KeyW');
    await sheet('hang-idle', 6, 0.5);
    await page.keyboard.down('KeyD');
    await sheet('shimmy', 12, 0.2);
    for (let i = 0; i < 200; i++) {
      if ((await mode()).pos[0] < 25.8) break;
      await waitSim(0.1);
    }
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyW');
    await sheet('mantle', 18, 0.11);
    await page.keyboard.up('KeyW');
  },
  sidle: async () => {
    await T(12.2, 4.6, 23.48, 0);
    await waitSim(0.5);
    await follow([0.3, 0.5, -2.8, 0.95]);
    await page.keyboard.down('KeyA');
    for (let i = 0; i < 80; i++) {
      if ((await mode()).mode === 'ledge') break;
      await waitSim(0.1);
    }
    await sheet('sidle', 16, 0.14);
    await page.keyboard.up('KeyA');
  },
  vault: async () => {
    await T(19.6, 8.6, 29.6, 0.62);
    await E(() => window.__TFE.teleport(19.4, 8.6, 29.1, 0.62));
    await waitSim(0.5);
    const y = await E(() => window.__TFE.state().player.pos[1]);
    console.log('vault start y', y);
    await follow([3.2, 0.5, -0.6, 0.9]);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 40; i++) {
      if ((await mode()).mode === 'vault') break;
      await waitSim(0.05);
    }
    await sheet('vault', 16, 0.05);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  },
  ch4end: async () => {
    await E(() => window.__TFE.startChapter(4));
    await page.waitForFunction(() => window.__TFE.state().chapter === 4 && window.__TFE.state().gameState === 'playing', null, { timeout: 90000 });
    await E(() => window.__TFE.skipCinematic());
    await waitSim(1);
    await E(() => { document.querySelectorAll('.hud, .layer.hud, .card').forEach((e) => (e.style.visibility = 'hidden')); });
    await E(() => window.__TFE.clearFreeCam());
    await E(() => window.__TFE.chapterCall('playEnd'));
    await sheet('ch4-end', 24, 0.8);
  },
  ground: async () => {
    await T(2.5, 0, -19, Math.PI / 2);
    await waitSim(0.6);
    await follow([0.6, 0.7, -4.0, 0.95]);
    await sheet('idle', 6, 0.4);
    await page.keyboard.down('KeyW');
    await sheet('walk-start', 12, 0.1);
    await page.keyboard.up('KeyW');
    await sheet('walk-stop', 6, 0.12);
    await T(2.5, 0, -19, Math.PI / 2);
    await waitSim(0.4);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await waitSim(1.0);
    await sheet('sprint', 12, 0.06);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  },
  jump: async () => {
    await T(2.5, 0, -19, 0);
    await waitSim(0.6);
    await E(() => window.__TFE.setCameraYaw(0, 0.2));
    await follow([3.0, 0.5, 0.3, 0.9]);
    await tap('Space');
    await sheet('jump-standing', 16, 0.075);
    await T(2.5, 0, -30, 0);
    await page.keyboard.down('KeyW');
    await waitSim(0.9);
    await tap('Space');
    await sheet('jump-run', 16, 0.06);
    await page.keyboard.up('KeyW');
    await waitSim(0.5);
    // The reported case: tilting the stick sideways while airborne.
    await T(2.5, 0, -30, 0);
    await page.keyboard.down('KeyW');
    await waitSim(0.9);
    await tap('Space');
    await page.keyboard.down('KeyA');
    await sheet('jump-air-steer', 16, 0.06);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
  },
  toby: async () => {
    await E(() => { window.__TFE.teleport(4.2, 0, -57.5, 3.6); window.__TFE.setCameraYaw(3.6, 0.2); });
    await waitSim(1.0);
    await E(() => window.__TFE.freeCam(0.9, 1.5, -57.6, 2.6, 0.75, -59.2));
    await sheet('toby-sit', 8, 0.7);
    await tap('KeyE');
    await waitSim(0.6);
    await sheet('toby-talk', 8, 0.7);
  },
  rappel: async () => {
    await E(() => window.__TFE.startChapter(2));
    await page.waitForFunction(() => window.__TFE.state().chapter === 2 && window.__TFE.state().gameState === 'playing', null, { timeout: 90000 });
    await E(() => window.__TFE.skipCinematic());
    await waitSim(1);
    await E(() => { document.querySelectorAll('.hud, .layer.hud, .card').forEach((e) => (e.style.visibility = 'hidden')); window.__TFE.reviewLight(true); });
    await E(() => { window.__TFE.chapterCall('useRope'); });
    await waitSim(1.7);
    await E(() => { window.__TFE.teleport(2.5, 0, 5.0, 3.14); });
    await follow([3.0, 0.6, 2.6, 0.8]);
    await E(() => window.__TFE.chapterCall('useRope'));
    await sheet('rappel', 24, 0.24);
  },
  rope: async () => {
    await E(() => window.__TFE.startChapter(5));
    await page.waitForFunction(() => window.__TFE.state().chapter === 5 && window.__TFE.state().gameState === 'playing', null, { timeout: 90000 });
    await E(() => window.__TFE.skipCinematic());
    await waitSim(1);
    await E(() => { document.querySelectorAll('.hud, .layer.hud, .card').forEach((e) => (e.style.visibility = 'hidden')); window.__TFE.reviewLight(true); });
    const n = await E(() => window.__TFE.heroFrames());
    await E((i) => window.__TFE.heroFrame(i), n.indexOf('toby-rope'));
    await waitSim(1.5);
    await E(() => window.__TFE.freeCam(-1.6, 7.9, 53.4, 0.9, 7.6, 56.6));
    await sheet('toby-rope', 8, 0.5);
  },
  land: async () => {
    await T(2.5, 6, -19, 0);
    await follow([3.0, 0.5, 0.3, 0.9]);
    await sheet('land-hard-standing', 24, 0.075);
    await T(2.5, 6, -30, 0);
    await page.keyboard.down('KeyW');
    await sheet('land-hard-moving', 24, 0.075);
    await page.keyboard.up('KeyW');
  },
};

for (const [name, fn] of Object.entries(sections)) {
  if (want.length && !want.includes(name)) continue;
  await follow(null);
  await slow(1);
  await fn();
}
writeFileSync(`${OUT}/errors.txt`, errs.join('\n'));
console.log(errs.length ? `ERRORS (${errs.length}):\n${errs.slice(0, 6).join('\n')}` : 'no page errors');
await browser.close();
