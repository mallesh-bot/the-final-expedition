// Licence gate (PRD §33): every shipped asset file needs a complete row in ASSET_LICENSES.md.
//   npm run assets:check        (exits 1 on any problem)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const ASSET_DIR = join(ROOT, 'public', 'assets');
const REQUIRED = ['Path', 'Asset', 'Creator', 'Source', 'Licence', 'Licence URL', 'Modify', 'Redistribute (web)', 'Attribution', 'Verified'];
const REJECT = /\b(NC|ND|non-?commercial|personal use|no derivatives|AGPL)\b/i;

function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else out.push(relative(ROOT, p).split(sep).join('/'));
  }
  return out;
}

const md = readFileSync(join(ROOT, 'ASSET_LICENSES.md'), 'utf8');
const section = md.split(/^## Registry\s*$/m)[1]?.split(/^## /m)[0] ?? '';
const lines = section.split('\n').filter((l) => l.trim().startsWith('|'));
const header = lines[0]?.split('|').slice(1, -1).map((s) => s.trim()) ?? [];
const problems = [];
for (const col of REQUIRED) if (!header.includes(col)) problems.push(`registry is missing column "${col}"`);
const rows = new Map();
for (const l of lines.slice(2)) {
  const cells = l.split('|').slice(1, -1).map((s) => s.trim());
  const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  const path = row.Path.replace(/`/g, '');
  for (const col of REQUIRED) if (!row[col]) problems.push(`${path}: empty "${col}"`);
  if (REJECT.test(row.Licence)) problems.push(`${path}: licence "${row.Licence}" is on the reject list`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.Verified)) problems.push(`${path}: "Verified" must be a YYYY-MM-DD date`);
  rows.set(path, row);
}
const files = walk(ASSET_DIR);
// A row may cover a generated set with a single `dir/*.ext` glob (e.g. the voice clips).
const escape = (t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globs = [...rows.keys()].filter((p) => p.includes('*')).map((p) => [p, new RegExp('^' + p.split('*').map(escape).join('[^/]+') + '$')]);
const covered = (f) => rows.has(f) || globs.some(([, re]) => re.test(f));
for (const f of files) if (!covered(f)) problems.push(`${f}: not in the ASSET_LICENSES.md registry`);
for (const p of rows.keys()) {
  const g = globs.find(([gp]) => gp === p);
  if (g ? !files.some((f) => g[1].test(f)) : !files.includes(p)) problems.push(`${p}: registry row for a file that doesn't exist`);
}

if (problems.length) {
  console.error(`assets:check FAILED (${problems.length})\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`assets:check OK — ${files.length} asset file(s), all registered with complete licence rows.`);
