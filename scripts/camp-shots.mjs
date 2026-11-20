// Screenshots of Camp Four from a few angles (visual check of the camp props).
import { openChapter } from './lib/chapterTest.mjs';
const T = await openChapter(1);
const { E, waitSim, page } = T;
await E(() => window.__TFE.gotoCheckpoint('ch1_camp'));
await waitSim(1.5);
const p = await E(() => window.__TFE.state().player.pos);
console.log('camp cp', p);
const views = process.argv.slice(2).length ? JSON.parse(process.argv[2]) : [
  ['n', [p[0], p[1] + 2.2, p[2] + 5], [p[0], p[1] + 0.5, p[2] - 6]],
  ['s', [p[0], p[1] + 2.2, p[2] - 5], [p[0], p[1] + 0.5, p[2] + 6]],
  ['e', [p[0] - 5, p[1] + 2.2, p[2]], [p[0] + 6, p[1] + 0.5, p[2]]],
  ['w', [p[0] + 5, p[1] + 2.2, p[2]], [p[0] - 6, p[1] + 0.5, p[2]]],
];
for (const [n, c, l] of views) {
  await E(([c, l]) => window.__TFE.freeCam(...c, ...l), [c, l]);
  await waitSim(0.6);
  await page.screenshot({ path: `playtest-output/camp-${n}.png` });
}
await T.finish('camp');
