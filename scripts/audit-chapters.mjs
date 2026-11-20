// Pre-launch sweep of every chapter: renders that would come out black (vertex-colour materials on
// geometry with no colours), broken geometry, missing textures, console errors, and a screenshot of
// every checkpoint.   npm run dev   then   node scripts/audit-chapters.mjs [ids]
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const ids = (process.argv[2] ?? '1,2,3,4,5,6').split(',').map(Number);
mkdirSync('playtest-output/audit', { recursive: true });
const browser = await launch();
let fails = 0;
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const { waitSim } = simHelpers(page);
  await page.goto(BASE_URL);
  await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
  await page.evaluate((n) => window.__TFE.startChapter(n), id);
  await page.waitForFunction((n) => window.__TFE.state().chapter === n && window.__TFE.state().gameState === 'playing', id, { timeout: 180000 });
  await waitSim(1);
  await page.evaluate(() => window.__TFE.skipCinematic());
  await waitSim(2);
  const scan = await page.evaluate(() => {
    const g = window.__TFE.game;
    const black = [];
    const nan = [];
    const noTex = [];
    g.renderer.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints) || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const at = o.geometry.attributes;
      for (const m of mats) {
        if (!m) continue;
        if (m.vertexColors && !at.color && !o.isSkinnedMesh) black.push(`${o.name || o.parent?.name || o.type} (${m.type}, ${at.position?.count} verts)`);
        for (const k of ['map', 'normalMap', 'roughnessMap']) {
          const t = m[k];
          if (t && t.isTexture && !t.isRenderTargetTexture && !t.isDataTexture && !t.isCompressedTexture && !t.image && !t.source?.data) noTex.push(`${o.name || o.parent?.name} ${k}`);
        }
      }
      const p = at.position?.array;
      if (p) for (let i = 0; i < Math.min(p.length, 30000); i += 7) if (!Number.isFinite(p[i])) { nan.push(o.name || o.parent?.name || o.type); break; }
    });
    return { black: [...new Set(black)], nan: [...new Set(nan)], noTex: [...new Set(noTex)] };
  });
  const check = (n, ok, d = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [ch${id}] ${n}${d ? '  ' + d : ''}`);
  };
  check('no meshes that render black for lack of vertex colours', scan.black.length === 0, scan.black.slice(0, 12).join(' | '));
  check('no broken (NaN) geometry', scan.nan.length === 0, scan.nan.join(' | '));
  check('no missing textures', scan.noTex.length === 0, scan.noTex.slice(0, 8).join(' | '));
  const cps = await page.evaluate(() => Object.keys(window.__TFE.chapter().checkpoints));
  for (const cp of cps) {
    await page.evaluate((c) => window.__TFE.gotoCheckpoint(c), cp);
    await waitSim(1.6);
    const st = await page.evaluate(() => window.__TFE.state());
    const ok = st.player.pos.every(Number.isFinite) && st.player.mode !== 'dead';
    check(`checkpoint ${cp}: she stands there`, ok, `pos ${st.player.pos} mode ${st.player.mode}`);
    await page.screenshot({ path: `playtest-output/audit/ch${id}-${cp}.png` });
  }
  check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
console.log(fails ? `\n${fails} audit check(s) failed` : '\nall chapter audit checks passed');
process.exit(fails ? 1 : 0);
