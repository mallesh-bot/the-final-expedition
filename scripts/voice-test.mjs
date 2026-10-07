// Voice acting smoke test: lines start their clip, radio lines route through the handset filter,
// subtitles stay up at least as long as the clip, and pausing pauses the voice.
import { openChapter } from './lib/chapterTest.mjs';

const T = await openChapter(2);
const { E, check, waitSim, page } = T;
await E(() => window.__TFE.game.audio.unlock());
await page.waitForTimeout(500);
const say = (speaker, text, radio) => E(([s, t, r]) => window.__TFE.game.dialogue.say({ speaker: s, text: t, radio: r }, true), [speaker, text, radio]);
const probe = () => E(() => {
  const g = window.__TFE.game;
  const vb = g.voice;
  return { playing: vb['playing']?.key ?? null, radio: vb['playing']?.radio ?? null, ctx: g.audio.ctx?.state, line: g.dialogue.current?.text ?? null };
});
await say('INES', "I'll fix a rope off the overlook. You follow it when you're ready.", true);
let ok = false;
for (let i = 0; i < 30 && !ok; i++) {
  await page.waitForTimeout(100);
  ok = !!(await probe()).playing;
}
let p = await probe();
check('a radio line plays its voice clip', p.playing && p.radio === true, JSON.stringify(p));
const dur = await E(() => {
  const g = window.__TFE.game;
  const l = g.dialogue.current;
  return { voice: g.voice.duration(l), shown: g.dialogue.durationOf(l) };
});
check('subtitle stays up at least as long as the voice', dur.voice > 0.5 && dur.shown >= dur.voice, JSON.stringify(dur));
await E(() => window.__TFE.pause());
await page.waitForTimeout(300);
p = await probe();
check('pausing stops the voice', !p.playing, JSON.stringify(p));
await E(() => window.__TFE.resume());
await page.waitForTimeout(400);
p = await probe();
check('resuming continues the line', !!p.playing, JSON.stringify(p));
await say('TOBY', 'Wait — what\'s the date on them?', true);
await page.waitForTimeout(800);
p = await probe();
check('a new line replaces the old clip', p.playing && p.line?.startsWith('Wait'), JSON.stringify(p));
const missing = await E(() => {
  const g = window.__TFE.game;
  return ['MARTA', 'CORWIN', 'DACE', 'AYME', 'NARRATION'].map((s) => s);
});
void missing;
await waitSim(0.2);
await T.finish('voice');
