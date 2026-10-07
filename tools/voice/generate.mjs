// Voice acting: synthesizes every subtitle line in the game with Kokoro-82M (Apache-2.0, local,
// offline, free) and writes compressed clips + a manifest the game loads at runtime.
//
//   KOKORO_DIR=<folder with kokoro-js installed> node tools/voice/generate.mjs [--force] [--only=ch5]
//
// Lines are found by scanning src/ for `{ speaker: 'X', text: '…' }` literals, so dialogue modules
// and inline chapter lines are both covered. Clips are keyed by a hash of speaker + text, which the
// runtime computes the same way (src/audio/VoiceBank.ts) — edit a line and only that line is redone.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'voice');
const MANIFEST = join(ROOT, 'src', 'assets', 'voice.json');
const force = process.argv.includes('--force');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/** Cast (Kokoro voice ids) and delivery speed per speaker. */
export const CAST = {
  INES: { voice: 'bf_emma', speed: 1.0 },
  TOBY: { voice: 'bm_lewis', speed: 1.08 },
  CORWIN: { voice: 'bm_george', speed: 0.94 },
  DACE: { voice: 'am_onyx', speed: 0.95 },
  MARTA: { voice: 'bf_alice', speed: 0.9 },
  AYME: { voice: 'af_nicole', speed: 0.88 },
  NARRATION: { voice: 'bm_fable', speed: 0.95 },
};

/** Must match src/audio/VoiceBank.ts voiceKey(). */
export function voiceKey(speaker, text) {
  let h = 0x811c9dc5;
  const s = `${speaker}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function chapterOf(file) {
  const f = basename(file).toLowerCase();
  const m = f.match(/ch(?:apter)?(\d)/);
  if (m) return Number(m[1]);
  if (f.includes('epilogue')) return 6;
  return 0;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Text as it should be spoken (subtitles keep the original punctuation). */
function speakable(t) {
  return t
    .replace(/\s*—\s*M\.\s*$/, '')
    .replace(/—/g, ', ')
    .replace(/…/g, '...')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}

const re = /speaker:\s*'([A-Z]+)',\s*text:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const lines = new Map();
for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(re)) {
    const speaker = m[1];
    const text = Function(`return ${m[2]}`)();
    if (!CAST[speaker] || !/[A-Za-z]/.test(speakable(text))) continue; // '…' beats stay silent
    const key = voiceKey(speaker, text);
    if (!lines.has(key)) lines.set(key, { speaker, text, chapter: chapterOf(file) });
  }
}
console.log(`${lines.size} unique lines`);

mkdirSync(OUT, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const todo = [...lines.entries()].filter(([k, l]) => (force || !manifest[k] || !existsSync(join(OUT, `${k}.ogg`))) && (!only || `ch${l.chapter}` === only));
console.log(`${todo.length} to synthesize`);

if (todo.length) {
  const kdir = process.env.KOKORO_DIR ?? join(ROOT, '..', '_tools', 'voice');
  const { KokoroTTS } = await import(pathToFileURL(join(kdir, 'node_modules', 'kokoro-js', 'dist', 'kokoro.js')).href);
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  let n = 0;
  for (const [key, l] of todo) {
    const cast = CAST[l.speaker];
    const audio = await tts.generate(speakable(l.text), { voice: cast.voice, speed: cast.speed });
    const wav = join(OUT, `${key}.wav`);
    await audio.save(wav);
    const ogg = join(OUT, `${key}.ogg`);
    // Trim edge silence, gentle loudness normalisation, mono Opus at 40 kbps.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2', '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '40k', ogg]);
    unlinkSync(wav);
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ogg]).toString().trim());
    manifest[key] = { d: +dur.toFixed(2), c: l.chapter, s: l.speaker };
    n++;
    if (n % 10 === 0 || n === todo.length) {
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 0));
      console.log(`${n}/${todo.length}  [${l.speaker}] ${l.text.slice(0, 60)}`);
    }
  }
}
// Drop clips for lines that no longer exist.
for (const k of Object.keys(manifest)) {
  if (!lines.has(k)) {
    delete manifest[k];
    const f = join(OUT, `${k}.ogg`);
    if (existsSync(f)) unlinkSync(f);
  }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 0));
console.log(`manifest: ${Object.keys(manifest).length} clips`);
