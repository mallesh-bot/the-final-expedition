import { mulberry32 } from '../systems/noise';

/**
 * Marta's photographs, drawn procedurally as aged sepia contact prints (no external art).
 * Simple silhouettes and carved shapes; grain, vignette and a curled corner sell the age.
 */
export type PhotoId = 'kitchens' | 'wall' | 'edmund' | 'gate';

const cache = new Map<PhotoId, string>();

export function photoDataURL(id: PhotoId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const W = 520;
  const H = 380;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const rnd = mulberry32(id.length * 977 + id.charCodeAt(0));
  // Print border
  x.fillStyle = '#efe6d2';
  x.fillRect(0, 0, W, H);
  const P = 22;
  const iw = W - P * 2;
  const ih = H - P * 2 - 18;
  x.save();
  x.translate(P, P);
  x.beginPath();
  x.rect(0, 0, iw, ih);
  x.clip();
  // Base tone: light from above
  const g = x.createLinearGradient(0, 0, 0, ih);
  g.addColorStop(0, '#d9c29a');
  g.addColorStop(1, '#6f5638');
  x.fillStyle = g;
  x.fillRect(0, 0, iw, ih);
  const ink = (a: number) => `rgba(52,34,18,${a})`;
  const figure = (fx: number, fy: number, s: number, opts: { hat?: boolean; arm?: number; bowl?: boolean; lean?: number } = {}) => {
    x.save();
    x.translate(fx, fy);
    x.rotate(opts.lean ?? 0);
    x.fillStyle = ink(0.88);
    // legs
    x.fillRect(-s * 0.18, -s * 0.9, s * 0.14, s * 0.9);
    x.fillRect(s * 0.04, -s * 0.9, s * 0.14, s * 0.9);
    // torso
    x.beginPath();
    x.moveTo(-s * 0.28, -s * 0.9);
    x.lineTo(-s * 0.24, -s * 1.7);
    x.lineTo(s * 0.24, -s * 1.7);
    x.lineTo(s * 0.28, -s * 0.9);
    x.fill();
    // head
    x.beginPath();
    x.arc(0, -s * 1.9, s * 0.17, 0, Math.PI * 2);
    x.fill();
    if (opts.hat) x.fillRect(-s * 0.26, -s * 2.04, s * 0.52, s * 0.06);
    // arms
    x.lineWidth = s * 0.11;
    x.strokeStyle = ink(0.88);
    x.beginPath();
    x.moveTo(-s * 0.22, -s * 1.6);
    x.lineTo(-s * 0.36, -s * 1.1);
    x.moveTo(s * 0.22, -s * 1.6);
    const a = opts.arm ?? 0;
    x.lineTo(s * 0.22 + Math.cos(a) * s * 0.5, -s * 1.6 + Math.sin(a) * s * 0.5);
    x.stroke();
    if (opts.bowl) {
      x.beginPath();
      x.ellipse(s * 0.05, -s * 1.15, s * 0.16, s * 0.06, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  };
  const carvedWall = (x0: number, y0: number, w: number, h: number, rows: number) => {
    x.fillStyle = 'rgba(120,92,60,0.55)';
    x.fillRect(x0, y0, w, h);
    x.strokeStyle = ink(0.35);
    x.lineWidth = 2;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < 9; k++) {
        const cx = x0 + 18 + k * ((w - 36) / 8);
        const cy = y0 + 22 + r * ((h - 40) / Math.max(1, rows - 1));
        x.beginPath();
        if ((k + r) % 3 === 0) x.arc(cx, cy, 7, Math.PI, 0);
        else if ((k + r) % 3 === 1) x.ellipse(cx, cy, 9, 5, 0, 0, Math.PI * 2);
        else {
          x.moveTo(cx - 9, cy);
          for (let t = 0; t <= 6; t++) x.lineTo(cx - 9 + t * 3, cy + (t % 2 ? -4 : 4));
        }
        x.stroke();
      }
  };

  if (id === 'kitchens') {
    // Terraced wall + hearth, four figures with bowls, morning light from the left.
    x.fillStyle = 'rgba(90,66,40,0.5)';
    for (let i = 0; i < 6; i++) x.fillRect(0, ih * 0.15 + i * 18, iw, 10);
    x.fillStyle = ink(0.6);
    x.fillRect(iw * 0.38, ih * 0.62, iw * 0.24, ih * 0.16);
    x.fillStyle = 'rgba(240,220,180,0.35)';
    x.beginPath();
    x.ellipse(iw * 0.5, ih * 0.6, 40, 18, 0, 0, Math.PI * 2);
    x.fill();
    figure(iw * 0.2, ih * 0.92, 70, { hat: true, bowl: true });
    figure(iw * 0.34, ih * 0.95, 64, { bowl: true, arm: -0.4 });
    figure(iw * 0.68, ih * 0.94, 66, { bowl: true });
    figure(iw * 0.82, ih * 0.93, 72, { hat: true, arm: -1.2 });
  } else if (id === 'wall') {
    carvedWall(iw * 0.08, ih * 0.06, iw * 0.84, ih * 0.82, 6);
    // Ladder
    x.strokeStyle = ink(0.9);
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(iw * 0.52, ih);
    x.lineTo(iw * 0.6, ih * 0.25);
    x.moveTo(iw * 0.62, ih);
    x.lineTo(iw * 0.7, ih * 0.25);
    x.stroke();
    x.lineWidth = 4;
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      x.beginPath();
      x.moveTo(iw * (0.52 + t * 0.08), ih * (1 - t * 0.75));
      x.lineTo(iw * (0.62 + t * 0.08), ih * (1 - t * 0.75));
      x.stroke();
    }
    figure(iw * 0.64, ih * 0.62, 56, { arm: -2.2, lean: 0.12 });
    // Lamp glow
    const lg = x.createRadialGradient(iw * 0.62, ih * 0.38, 2, iw * 0.62, ih * 0.38, 70);
    lg.addColorStop(0, 'rgba(255,240,200,0.75)');
    lg.addColorStop(1, 'rgba(255,240,200,0)');
    x.fillStyle = lg;
    x.fillRect(0, 0, iw, ih);
  } else if (id === 'edmund') {
    // Rope bridge receding, one figure close, hand raised toward the lens.
    x.strokeStyle = ink(0.7);
    x.lineWidth = 3;
    for (const off of [0, 40]) {
      x.beginPath();
      x.moveTo(0, ih * 0.45 + off);
      x.quadraticCurveTo(iw * 0.5, ih * 0.62 + off, iw, ih * 0.4 + off);
      x.stroke();
    }
    for (let k = 0; k < 24; k++) {
      const t = k / 23;
      const yy = ih * 0.45 + 40 + Math.sin(t * Math.PI) * ih * 0.12;
      x.beginPath();
      x.moveTo(t * iw, yy - 40);
      x.lineTo(t * iw, yy);
      x.stroke();
    }
    figure(iw * 0.4, ih * 1.05, 150, { hat: true, arm: -1.9, lean: -0.06 });
    // Motion blur of the raised hand
    x.fillStyle = 'rgba(52,34,18,0.35)';
    x.beginPath();
    x.ellipse(iw * 0.58, ih * 0.38, 40, 26, 0.3, 0, Math.PI * 2);
    x.fill();
  } else {
    // The gate, closed: pillars, lintel, three drums, low sun from the left.
    x.fillStyle = 'rgba(70,50,30,0.55)';
    x.fillRect(0, ih * 0.75, iw, ih * 0.25);
    x.fillStyle = ink(0.75);
    x.fillRect(iw * 0.3, ih * 0.15, iw * 0.08, ih * 0.62);
    x.fillRect(iw * 0.62, ih * 0.15, iw * 0.08, ih * 0.62);
    x.fillRect(iw * 0.26, ih * 0.08, iw * 0.48, ih * 0.1);
    x.fillStyle = 'rgba(110,84,56,0.8)';
    x.fillRect(iw * 0.38, ih * 0.18, iw * 0.24, ih * 0.59);
    x.fillStyle = ink(0.8);
    for (const k of [0.38, 0.5, 0.62]) x.fillRect(iw * k - 14, ih * 0.7, 28, 30);
    carvedWall(iw * 0.4, ih * 0.22, iw * 0.2, ih * 0.3, 2);
  }
  // Grain + vignette + fading
  const img = x.getImageData(0, 0, iw, ih);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8));
  }
  x.putImageData(img, 0, 0);
  const vg = x.createRadialGradient(iw / 2, ih / 2, ih * 0.25, iw / 2, ih / 2, iw * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(40,24,10,0.55)');
  x.fillStyle = vg;
  x.fillRect(0, 0, iw, ih);
  // Scratches
  x.strokeStyle = 'rgba(245,235,215,0.35)';
  x.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    x.beginPath();
    const sx = rnd() * iw;
    x.moveTo(sx, 0);
    x.lineTo(sx + (rnd() - 0.5) * 40, ih);
    x.stroke();
  }
  x.restore();
  // Pencil caption on the border
  x.fillStyle = 'rgba(70,60,50,0.8)';
  x.font = 'italic 15px Georgia, serif';
  const captions: Record<PhotoId, string> = { kitchens: '41 · 9.VI.58', wall: '43 · 11.VI.58', edmund: '44 · 12.VI.58', gate: 'Vrata · 1979' };
  x.fillText(captions[id], P + 4, H - 14);
  // Curled corner
  x.fillStyle = 'rgba(0,0,0,0.12)';
  x.beginPath();
  x.moveTo(W, H - 46);
  x.lineTo(W - 46, H);
  x.lineTo(W, H);
  x.fill();
  const url = c.toDataURL('image/jpeg', 0.85);
  cache.set(id, url);
  return url;
}
