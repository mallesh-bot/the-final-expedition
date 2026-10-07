import * as THREE from 'three';

export interface RockDrop {
  x: number;
  z: number;
  groundY: number;
  /** Seconds after start() when it lands. */
  t: number;
  size: number;
  /** Lethal radius at impact. */
  radius?: number;
}

/**
 * Telegraphed falling rocks: a dark shadow grows on the ground for 1.3 s, then the rock lands.
 * Anyone inside the radius at impact is killed (the chapter wires `onImpact` to Player.kill).
 * Deterministic and resettable for checkpoint retries.
 */
export class Rockfall {
  readonly group = new THREE.Group();
  private t = -1;
  private rocks: { mesh: THREE.Mesh; shadow: THREE.Mesh; done: boolean }[] = [];
  onImpact: ((d: RockDrop, i: number) => void) | null = null;
  static readonly WARN = 1.3;

  constructor(
    readonly drops: RockDrop[],
    geos: THREE.BufferGeometry[],
    material: THREE.Material,
  ) {
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    drops.forEach((d, i) => {
      const m = new THREE.Mesh(geos[i % geos.length], material);
      m.scale.setScalar(d.size);
      m.castShadow = true;
      m.visible = false;
      const s = new THREE.Mesh(new THREE.CircleGeometry(d.radius ?? d.size * 1.1, 20).rotateX(-Math.PI / 2), shadowMat.clone());
      s.position.set(d.x, d.groundY + 0.03, d.z);
      s.visible = false;
      this.group.add(m, s);
      this.rocks.push({ mesh: m, shadow: s, done: false });
    });
  }

  get started(): boolean {
    return this.t >= 0;
  }

  start(): void {
    if (this.t < 0) this.t = 0;
  }

  reset(): void {
    this.t = -1;
    for (const r of this.rocks) {
      r.mesh.visible = false;
      r.shadow.visible = false;
      r.done = false;
    }
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    this.drops.forEach((d, i) => {
      const r = this.rocks[i];
      if (r.done) return;
      const k = this.t - (d.t - Rockfall.WARN);
      if (k < 0) return;
      r.shadow.visible = true;
      const w = Math.min(1, k / Rockfall.WARN);
      (r.shadow.material as THREE.MeshBasicMaterial).opacity = 0.15 + w * 0.45;
      r.shadow.scale.setScalar(0.4 + w * 0.6);
      // Fall: 30 m in the warning window.
      const fallT = Rockfall.WARN - Math.min(Rockfall.WARN, k);
      r.mesh.visible = true;
      r.mesh.position.set(d.x, d.groundY + d.size * 0.4 + 0.5 * 36 * fallT * fallT, d.z);
      r.mesh.rotation.set(k * 3 + i, k * 2, k);
      if (k >= Rockfall.WARN) {
        r.done = true;
        r.shadow.visible = false;
        r.mesh.position.y = d.groundY + d.size * 0.35;
        this.onImpact?.(d, i);
      }
    });
  }
}
