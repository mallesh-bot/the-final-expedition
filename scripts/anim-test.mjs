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

// 4. Climbing (the wall by the camp): hands and feet stay on their holds, the torso stays upright.
await E(() => { window.__TFE.teleport(10, 0, 21.6, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(0.6);
await page.keyboard.down('KeyE');
await waitSim(0.05);
await page.keyboard.up('KeyE');
await page.keyboard.down('KeyW');
await waitSim(0.5);
await E(() => {
  window.__rigLog = [];
  const step = () => {
    const T = window.__TFE;
    if (T.state().player.mode === 'climb') window.__rigLog.push(T.rigProbe());
    if (window.__rigLog.length < 240) window.__rigRaf = requestAnimationFrame(step);
  };
  step();
});
await waitSim(2.2);
await page.keyboard.up('KeyW');
const log = await E(() => {
  cancelAnimationFrame(window.__rigRaf);
  return window.__rigLog;
});
{
  let handErr = 0;
  let footErr = 0;
  let handSlide = 0;
  let pelvisMin = 9;
  let pelvisMax = 0;
  let headBelow = 0;
  let planes = 0;
  const last = [null, null, null, null];
  for (const r of log) {
    r.limbs.forEach((l, i) => {
      if (l.planted) {
        if (i < 2) handErr = Math.max(handErr, l.err);
        else footErr = Math.max(footErr, l.err);
        if (i < 2 && last[i]) handSlide = Math.max(handSlide, Math.hypot(l.world[0] - last[i][0], l.world[1] - last[i][1], l.world[2] - last[i][2]));
        last[i] = l.world;
      } else last[i] = null;
    });
    pelvisMin = Math.min(pelvisMin, r.pelvis[1]);
    pelvisMax = Math.max(pelvisMax, r.pelvis[1]);
    if (r.head[1] < r.chest[1] + 0.1) headBelow++;
    planes += r.limbs.filter((l) => !l.planted).length > 0 ? 1 : 0;
  }
  check('climbing: enough samples', log.length > 20, `n=${log.length}`);
  check('climbing: planted hands on their holds (< 5 cm)', handErr < 0.05, `worst ${handErr}`);
  check('climbing: planted hands do not slide (< 2 cm a frame)', handSlide < 0.02, `worst ${handSlide.toFixed(4)}`);
  check('climbing: planted feet near their holds (< 16 cm)', footErr < 0.16, `worst ${footErr}`);
  check('climbing: pelvis stays with the body (no IK drift)', pelvisMax - pelvisMin < 0.2, `y ${pelvisMin}..${pelvisMax}`);
  check('climbing: head never drops below the chest', headBelow === 0, `${headBelow} frames`);
  check('climbing: limbs actually reach', planes > 5, `${planes} frames with a limb in the air`);
}

// 5. Procedural layers never accumulate: a still character keeps a still pose however long it runs.
await E(() => { window.__TFE.teleport(2.5, 0, -19, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(1);
await E(() => (window.__TFE.game.player.avatar.layers.bodyRoll = 0));
const p0 = await E(() => window.__TFE.rigProbe());
await waitSim(4);
const p1 = await E(() => window.__TFE.rigProbe());
const drift = Math.hypot(p1.head[0] - p0.head[0], p1.head[2] - p0.head[2]);
check('idle: no pose drift over 4 s (head < 6 cm)', drift < 0.06, `drift ${drift.toFixed(3)}`);

// 6. A jump's air steering leans the body but does not spin it to the stick.
await E(() => { window.__TFE.teleport(2.5, 0, -30, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(0.4);
await page.keyboard.down('KeyW');
await waitSim(0.9);
await page.keyboard.down('Space');
await waitSim(0.05);
await page.keyboard.up('Space');
const yaw0 = await E(() => window.__TFE.game.player.yaw);
await page.keyboard.down('KeyA');
await waitSim(0.3);
const yaw1 = await E(() => window.__TFE.game.player.yaw);
const st = await E(() => window.__TFE.game.player.avatar.driver.state);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
check('running jump uses the leap', st === 'LEAP', st);
check('air steering turns the body gently (< 30 deg in 0.3 s)', Math.abs(yaw1 - yaw0) < 0.52, `${((yaw1 - yaw0) * 57.3).toFixed(1)} deg`);

// 7. The run is a real gait: planted foot stays put, knees bend, no snapping, normal cadence.
await E(() => { window.__TFE.teleport(-2, 0.05, -57, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(0.5);
await page.keyboard.down('KeyW');
await waitSim(1.0);
const gait = await E(() => new Promise((resolve) => {
  const T = window.__TFE;
  const p = T.game.player;
  const b = p.avatar.bones;
  T.game.clock.timeScale = 0.15;
  const V = () => b.hips.position.clone().set(0, 0, 0);
  const rows = [];
  let prev = null;
  const step = () => {
    const f = [b.footL, b.footR].map((x) => x.getWorldPosition(V()));
    const th = [b.thighL, b.thighR].map((x) => x.getWorldPosition(V()));
    const k = [b.calfL, b.calfR].map((x) => x.getWorldPosition(V()));
    const knee = [0, 1].map((i) => Math.PI - k[i].clone().sub(th[i]).angleTo(f[i].clone().sub(k[i])));
    const q = [b.thighL, b.thighR].map((x) => x.getWorldQuaternion(new x.quaternion.constructor()));
    const t = T.game.clock.time;
    const g = [0, 1].map((i) => f[i].y - T.game.world.groundAt(f[i].x, f[i].z, f[i].y + 0.5).y);
    const row = { t, g, knee, x: f.map((v) => v.x), z: f.map((v) => v.z), hip: b.hips.getWorldPosition(V()).y - p.position.y, ph: p.avatar.driver.gaitPhase, rate: 0 };
    if (prev && t > prev.t) row.rate = Math.max(q[0].angleTo(prev.q[0]), q[1].angleTo(prev.q[1])) / (t - prev.t);
    prev = { t, q };
    rows.push(row);
    if (rows.length && t - rows[0].t > 2.2) {
      T.game.clock.timeScale = 1;
      resolve(rows);
    } else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
await page.keyboard.up('KeyW');
{
  const groundY = Math.min(...gait.flatMap((r) => r.g));
  let slipDist = 0;
  let slipTime = 0;
  let bothUp = 0;
  for (let i = 1; i < gait.length; i++) {
    const a = gait[i - 1];
    const c = gait[i];
    const planted = [0, 1].filter((s) => c.g[s] < groundY + 0.035 && a.g[s] < groundY + 0.035);
    for (const s of planted) {
      slipDist += Math.hypot(c.x[s] - a.x[s], c.z[s] - a.z[s]);
      slipTime += c.t - a.t;
    }
    if (c.g[0] > groundY + 0.035 && c.g[1] > groundY + 0.035) bothUp++;
  }
  const hips = gait.map((r) => r.hip);
  const kneeMax = Math.max(...gait.flatMap((r) => r.knee)) * 57.3;
  const peak = Math.max(...gait.map((r) => r.rate));
  let wraps = 0;
  for (let i = 1; i < gait.length; i++) if (gait[i].ph < gait[i - 1].ph) wraps++;
  const cycle = (gait[gait.length - 1].t - gait[0].t) / Math.max(1, wraps);
  check('run: enough samples', gait.length > 40, `n=${gait.length}`);
  check('run: planted foot does not skate (< 0.9 m/s)', slipTime > 0 && slipDist / slipTime < 0.9, `${(slipDist / Math.max(slipTime, 1e-3)).toFixed(2)} m/s over ${slipTime.toFixed(2)} s`);
  check('run: airborne less than 60% of the cycle', bothUp / gait.length < 0.6, `${((bothUp / gait.length) * 100).toFixed(0)}%`);
  // (Real runners bounce 6-10 cm; the library jog this replaced bounced 24 cm.)
  check('run: hips bounce under 12 cm', Math.max(...hips) - Math.min(...hips) < 0.12, `${((Math.max(...hips) - Math.min(...hips)) * 100).toFixed(1)} cm`);
  check('run: knee never locks straight (< 177 deg)', kneeMax < 177, `${kneeMax.toFixed(1)} deg`);
  check('run: legs do not snap (< 14 rad/s)', peak < 14, `${peak.toFixed(1)} rad/s`);
  check('run: cadence 140-200 steps a minute', 120 / cycle > 140 && 120 / cycle < 200, `${(120 / cycle).toFixed(0)} spm`);
}

// 8. Anatomy: both feet point forward and neither shin is twisted, standing and through the stride.
//    (Direction of ankle->toe and of the knee, in the character's frame: 0 deg = straight ahead.)
const legPose = () => E(() => {
  const p = window.__TFE.game.player;
  const root = p.avatar.root;
  root.updateMatrixWorld(true);
  const model = root.children[0];
  const V = () => root.position.clone().set(0, 0, 0);
  const L = (n) => root.worldToLocal(model.getObjectByName(n).getWorldPosition(V()));
  const inv = root.getWorldQuaternion(root.quaternion.clone()).invert();
  const out = [];
  for (const s of ['l', 'r']) {
    const hip = L(`thigh_${s}`), knee = L(`calf_${s}`), ankle = L(`foot_${s}`), ball = L(`ball_${s}`);
    const toe = ball.clone().sub(ankle);
    const shinX = V().set(1, 0, 0).applyQuaternion(inv.clone().multiply(model.getObjectByName(`calf_${s}`).getWorldQuaternion(root.quaternion.clone())));
    const horiz = Math.hypot(toe.x, toe.z);
    // Heading from the foot's own side-to-side axis: it stays meaningful when the foot hangs toes-down
    // in the swing (the toe direction does not).
    const footX = V().set(1, 0, 0).applyQuaternion(inv.clone().multiply(model.getObjectByName(`foot_${s}`).getWorldQuaternion(root.quaternion.clone())));
    out.push({
      toeYaw: Math.atan2(-footX.z, footX.x) * 57.3,
      // Angle at the ankle between shin and foot: about 60 standing, outside 35..100 no ankle goes.
      ankle: Math.acos(Math.min(1, Math.max(-1, toe.clone().normalize().dot(ankle.clone().sub(knee).normalize())))) * 57.3,
      toeDown: Math.atan2(-toe.y, horiz) * 57.3,
      shinTwist: Math.atan2(-shinX.z, shinX.x) * 57.3,
      kneeSide: Math.abs(knee.x - (hip.x + ankle.x) / 2),
      grounded: ankle.y < 0.11,
    });
  }
  return out;
});
await E(() => { window.__TFE.teleport(-2, 0.05, -57, 0); window.__TFE.setCameraYaw(0, 0.2); });
await waitSim(1.2);
{
  const st = await legPose();
  const yaw = st.map((l) => +l.toeYaw.toFixed(0));
  check('standing: both feet point forward (within 15 deg)', st.every((l) => Math.abs(l.toeYaw) < 15), `yaw L/R ${yaw}`);
  check('standing: feet are mirror images of each other', Math.abs(st[0].toeYaw + st[1].toeYaw) < 6 && Math.abs(st[0].toeDown - st[1].toeDown) < 6, `yaw ${yaw} pitch ${st.map((l) => +l.toeDown.toFixed(0))}`);
  check('standing: feet flat on the ground', st.every((l) => l.grounded && l.toeDown > 15 && l.toeDown < 45), `pitch ${st.map((l) => +l.toeDown.toFixed(0))}`);
  check('standing: shins not twisted (within 15 deg)', st.every((l) => Math.abs(l.shinTwist) < 15), `${st.map((l) => +l.shinTwist.toFixed(0))}`);
  check('standing: ankles at a natural angle (45-80 deg)', st.every((l) => l.ankle > 45 && l.ankle < 80), `${st.map((l) => +l.ankle.toFixed(0))}`);
}
for (const [name, cap] of [['walking', 1.7], ['running', Infinity]]) {
  await E(() => { window.__TFE.teleport(-2, 0.05, -57, 0); window.__TFE.setCameraYaw(0, 0.2); });
  await E((cap) => (window.__TFE.game.player.speedCap = cap), cap);
  await waitSim(0.4);
  await page.keyboard.down('KeyW');
  await waitSim(1.0);
  let worstYaw = 0;
  let worstTwist = 0;
  let worstKnee = 0;
  let worstPlanted = 0;
  let ankleMin = 180;
  let ankleMax = 0;
  let n = 0;
  for (let i = 0; i < 70; i++) {
    await waitSim(0.035);
    for (const l of await legPose()) {
      worstYaw = Math.max(worstYaw, Math.abs(l.toeYaw));
      worstTwist = Math.max(worstTwist, Math.abs(l.shinTwist));
      worstKnee = Math.max(worstKnee, l.kneeSide);
      ankleMin = Math.min(ankleMin, l.ankle);
      ankleMax = Math.max(ankleMax, l.ankle);
      if (l.grounded) worstPlanted = Math.max(worstPlanted, Math.abs(l.toeYaw));
      n++;
    }
  }
  await page.keyboard.up('KeyW');
  await E(() => (window.__TFE.game.player.speedCap = Infinity));
  check(`${name}: feet never turn sideways or backwards (within 25 deg)`, n > 40 && worstYaw < 25, `worst ${worstYaw.toFixed(0)} deg over ${n} samples (flat and sloped ground)`);
  check(`${name}: planted foot points forward (within 15 deg)`, worstPlanted < 15, `worst ${worstPlanted.toFixed(0)} deg`);
  check(`${name}: ankles stay in their natural range (35-100 deg)`, ankleMin > 35 && ankleMax < 100, `${ankleMin.toFixed(0)}..${ankleMax.toFixed(0)} deg`);
  check(`${name}: shins not twisted (within 20 deg)`, worstTwist < 20, `worst ${worstTwist.toFixed(0)} deg`);
  check(`${name}: knees track over the feet (under 8 cm sideways)`, worstKnee < 0.08, `worst ${(worstKnee * 100).toFixed(1)} cm`);
  await waitSim(0.6);
}

check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
for (const r of res) console.log(r[1] ? 'PASS' : 'FAIL', r[0], r[2]);
const failed = res.filter((r) => !r[1]).length;
console.log(`\n${res.length - failed}/${res.length} animation checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
