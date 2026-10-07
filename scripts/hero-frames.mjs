// PRD §55 hero frames: capture each chapter's fixed no-UI shots + per-frame budget numbers.
//   node scripts/hero-frames.mjs <chapterId> [preset=high] [frameIndex,…]
import { mkdirSync } from 'node:fs';
import { BASE_URL, launch, simHelpers } from './lib/browser.mjs';

const id = Number(process.argv[2] ?? 3);
const preset = process.argv[3] ?? 'high';
const only = process.argv[4]?.split(',').map(Number);
mkdirSync('playtest-output/hero', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
await page.evaluate((q) => window.__TFE.setQuality(q), preset);
await page.evaluate((n) => window.__TFE.startChapter(n), id);
await page.waitForFunction(() => window.__TFE.state().gameState === 'playing', null, { timeout: 180000 });
await waitSim(1);
await page.evaluate(() => window.__TFE.skipCinematic());
await waitSim(2);
const names = await page.evaluate(() => window.__TFE.heroFrames());
for (let i = 0; i < names.length; i++) {
  if (only && !only.includes(i)) continue;
  const settle = await page.evaluate((k) => window.__TFE.heroFrame(k), i);
  await waitSim(settle);
  const ds = await page.evaluate(() => window.__TFE.drawStats());
  const st = await page.evaluate(() => window.__TFE.state());
  const calls = ds.counts.reduce((s, [, n]) => s + n, 0);
  const tris = ds.tris.reduce((s, [, t]) => s + parseInt(t), 0);
  console.log(`${String(i).padStart(2)} ${names[i].padEnd(20)} visible ${String(calls).padStart(4)} objs · ~${tris}k tris · ${ds.shadowCasters} casters · ${st.drawCalls} calls total · ${st.fps?.toFixed?.(0)} fps`);
  await page.screenshot({ path: `playtest-output/hero/ch${id}-${String(i).padStart(2, '0')}-${names[i]}-${preset}.png` });
}
console.log(errs.length ? `ERRORS: ${errs.slice(0, 4).join(' | ')}` : 'no console errors');
await browser.close();
