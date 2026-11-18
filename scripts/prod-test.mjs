// Production check: serves dist/ from a sub-folder (the hardest common hosting case), plays the
// opening, and fails on any 404, failed request or page error. Run after `npm run build`.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { launch, simHelpers } from './lib/browser.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2' };
const PREFIX = '/some/sub/folder';
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (!path.startsWith(PREFIX)) {
    res.writeHead(404);
    return res.end();
  }
  let file = normalize(join('dist', path.slice(PREFIX.length)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(5301, r));

const res = [];
const check = (n, ok, d = '') => {
  res.push(!!ok);
  console.log(ok ? 'PASS' : 'FAIL', n, d);
};
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const bad = [];
const errs = [];
let bytes = 0;
page.on('response', async (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  const n = +(r.headers()['content-length'] ?? 0);
  bytes += n;
});
page.on('requestfailed', (r) => bad.push(`failed ${r.url()}`));
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const { waitSim } = simHelpers(page);
const t0 = Date.now();
await page.goto(`http://localhost:5301${PREFIX}/?debug`);
await page.waitForFunction(() => window.__TFE?.state().gameState === 'menu', null, { timeout: 120000 });
const menuS = (Date.now() - t0) / 1000;
check('menu loads', true, `${menuS.toFixed(1)} s`);
await page.click('button[data-action="new"]');
await page.waitForFunction(() => window.__TFE.state().cinematic === 'ch1_intro', null, { timeout: 60000 });
check('new game starts', true, `${((Date.now() - t0) / 1000).toFixed(1)} s, ${(bytes / 1048576).toFixed(0)} MB fetched`);
await waitSim(4);
await page.evaluate(() => window.__TFE.skipCinematic());
await page.waitForFunction(() => window.__TFE.state().player.mode === 'ground', null, { timeout: 15000 });
await page.keyboard.down('KeyW');
await waitSim(2);
await page.keyboard.up('KeyW');
const p = await page.evaluate(() => window.__TFE.state().player.pos);
check('player moves', Math.abs(p[0]) + Math.abs(p[2]) > 1, `pos=${p}`);
const voice = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/assets/voice/')).map((e) => e.name.replace(/.*\/some/, '/some')));
check('voice clips come from the sub-folder', voice.length > 0 && voice.every((v) => v.startsWith(PREFIX)), `${voice.length} fetched`);
await page.screenshot({ path: 'playtest-output/prod-subfolder.png' });
check('no failed requests', bad.length === 0, bad.slice(0, 8).join(' | '));
check('no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
await browser.close();
server.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} production checks passed`);
process.exit(res.every(Boolean) ? 0 : 1);
