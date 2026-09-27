import type * as THREE from 'three';

export interface MinimapImage {
  image: HTMLCanvasElement;
  /** World bounds covered by the image. The image is north-up: +Z up, +X (west) to the left. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MinimapMarker {
  pos: THREE.Vector3;
  kind: 'objective' | 'poi';
  label?: string;
}

/**
 * Circular, camera-relative minimap (forward is always up). Draws a baked terrain image
 * plus the player arrow and markers onto a small 2D canvas — no extra 3D render pass.
 */
export class Minimap {
  readonly root: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: MinimapImage | null = null;
  private size = 176;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  /** Metres visible across the radius. */
  range = 34;
  private visible = false;
  private t = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('canvas');
    this.root.className = 'minimap';
    this.root.width = this.size * this.dpr;
    this.root.height = this.size * this.dpr;
    this.root.style.width = `${this.size}px`;
    this.root.style.height = `${this.size}px`;
    this.ctx = this.root.getContext('2d')!;
    parent.append(this.root);
  }

  setMap(m: MinimapImage | null): void {
    this.map = m;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('show', v);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  draw(dt: number, player: THREE.Vector3, playerYaw: number, camYaw: number, markers: MinimapMarker[]): void {
    if (!this.visible || !this.map) return;
    this.t += dt;
    const c = this.ctx;
    const S = this.size * this.dpr;
    const R = S / 2;
    const m = this.map;
    const pxPerM = m.image.width / (m.maxX - m.minX);
    const scale = (R * 0.92) / (this.range * pxPerM);
    const toMap = (x: number, z: number) => [(m.maxX - x) * pxPerM, (m.maxZ - z) * pxPerM] as const;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(R, R, R * 0.94, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(8,11,10,0.8)';
    c.fillRect(0, 0, S, S);
    // Map layer, rotated so the camera's forward points up.
    c.translate(R, R);
    c.rotate(camYaw);
    c.scale(scale, scale);
    const [px, py] = toMap(player.x, player.z);
    c.translate(-px, -py);
    c.globalAlpha = 0.9;
    c.drawImage(m.image, 0, 0);
    c.globalAlpha = 1;
    // Markers (in map space so they rotate with the map)
    for (const mk of markers) {
      const [mx, my] = toMap(mk.pos.x, mk.pos.z);
      const d = Math.hypot(mx - px, my - py) * scale;
      const inv = 1 / scale;
      if (mk.kind === 'objective' && d > R * 0.8) continue; // drawn on the rim below
      c.beginPath();
      if (mk.kind === 'objective') {
        const pulse = 1 + Math.sin(this.t * 3) * 0.15;
        c.arc(mx, my, 6.5 * this.dpr * inv * pulse, 0, Math.PI * 2);
        c.strokeStyle = '#e0b86a';
        c.lineWidth = 2 * this.dpr * inv;
        c.stroke();
        c.beginPath();
        c.arc(mx, my, 2.2 * this.dpr * inv, 0, Math.PI * 2);
        c.fillStyle = '#e0b86a';
        c.fill();
      } else {
        c.arc(mx, my, 2.6 * this.dpr * inv, 0, Math.PI * 2);
        c.fillStyle = 'rgba(233,227,214,0.75)';
        c.fill();
      }
    }
    c.restore();
    // Off-map objective: chevron on the rim pointing toward it.
    for (const mk of markers) {
      if (mk.kind !== 'objective') continue;
      const [mx, my] = toMap(mk.pos.x, mk.pos.z);
      const dx = (mx - px) * scale;
      const dy = (my - py) * scale;
      if (Math.hypot(dx, dy) <= R * 0.8) continue;
      const a = Math.atan2(dy, dx) + camYaw;
      const rx = R + Math.cos(a) * R * 0.8;
      const ry = R + Math.sin(a) * R * 0.8;
      c.save();
      c.translate(rx, ry);
      c.rotate(a + Math.PI / 2);
      c.beginPath();
      c.moveTo(0, -7 * this.dpr);
      c.lineTo(5.5 * this.dpr, 4 * this.dpr);
      c.lineTo(-5.5 * this.dpr, 4 * this.dpr);
      c.closePath();
      c.fillStyle = '#e0b86a';
      c.fill();
      c.restore();
    }
    // Player arrow (centre)
    c.save();
    c.translate(R, R);
    c.rotate(camYaw - playerYaw);
    c.beginPath();
    c.moveTo(0, -8 * this.dpr);
    c.lineTo(5.5 * this.dpr, 6 * this.dpr);
    c.lineTo(0, 3 * this.dpr);
    c.lineTo(-5.5 * this.dpr, 6 * this.dpr);
    c.closePath();
    c.fillStyle = '#f2ece0';
    c.shadowColor = 'rgba(0,0,0,0.8)';
    c.shadowBlur = 4 * this.dpr;
    c.fill();
    c.restore();
    // Rim + north tick
    c.beginPath();
    c.arc(R, R, R * 0.94, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(201,163,91,0.55)';
    c.lineWidth = 1.5 * this.dpr;
    c.stroke();
    const na = camYaw - Math.PI / 2;
    c.fillStyle = '#c9a35b';
    c.font = `${10 * this.dpr}px Avenir Next, Segoe UI, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', R + Math.cos(na) * R * 0.82, R + Math.sin(na) * R * 0.82);
  }
}
