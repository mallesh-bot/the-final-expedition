// Copies Three.js DRACO / Basis (KTX2) decoders into public/decoders so compressed
// assets can be loaded without a CDN. Runs automatically before dev/build.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/three/examples/jsm/libs';
const dst = 'public/decoders';
for (const lib of ['draco', 'basis']) {
  if (!existsSync(`${src}/${lib}`)) continue;
  mkdirSync(`${dst}/${lib}`, { recursive: true });
  cpSync(`${src}/${lib}`, `${dst}/${lib}`, { recursive: true });
}
console.log('[copy-decoders] ok');
