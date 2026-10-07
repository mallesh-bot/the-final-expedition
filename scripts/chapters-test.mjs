// Runs every chapter playthrough (Ch2–5, epilogue) and the chapter-flow test, one browser each.
//   npm run dev   then   npm run test:chapters      (set TFE_URL if not on :5173)
import { spawnSync } from 'node:child_process';

const tests = ['ch2-test', 'ch3-test', 'ch4-test', 'ch5-test', 'ep-test', 'flow-test'];
const results = [];
for (const t of tests) {
  const r = spawnSync(process.execPath, [`scripts/${t}.mjs`], { encoding: 'utf8', env: process.env, timeout: 20 * 60 * 1000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const summary = out.trim().split('\n').reverse().find((l) => /checks passed/.test(l)) ?? `crashed (exit ${r.status})`;
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
  results.push([t, r.status === 0, summary, fails]);
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${t.padEnd(10)} ${summary}`);
  for (const f of fails) console.log(`        ${f}`);
}
const bad = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - bad}/${results.length} chapter suites passed`);
process.exit(bad ? 1 : 0);
