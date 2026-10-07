import * as THREE from 'three';
import { Puzzle } from './Puzzle';

export interface MirrorDef {
  id: string;
  /** Pivot (beam height). */
  pos: THREE.Vector3;
  /** Initial orientation step (0..steps-1). The mirror NORMAL points at angle step·(2π/steps) (atan2(x,z)). */
  initial: number;
  /** Visual that turns about Y with the mirror. */
  object: THREE.Object3D;
  /** Locked mirrors are part of the route but can't be turned. */
  fixed?: boolean;
  halfWidth?: number;
}

export interface ReceptorDef {
  id: string;
  pos: THREE.Vector3;
  radius: number;
}

export interface BeamSource {
  pos: THREE.Vector3;
  /** Horizontal direction. */
  dir: THREE.Vector3;
  enabled: boolean;
}

/** Axis-aligned XZ rectangle the beam stops at (walls, pillars). */
export interface BeamBlocker {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BeamTrace {
  points: THREE.Vector3[];
  hit: string | null;
}

/**
 * Light-redirection puzzle: sunbeams travel horizontally from sources, bounce off rotatable bronze
 * mirrors (mirror normals in 45° steps) and stop at walls or receptors. The puzzle only reports
 * what is lit; the chapter decides what that means (an order to follow, all at once, …) and
 * calls `markSolved()`. Beams are rendered as additive cylinders with a light where they land.
 */
export class BeamPuzzle extends Puzzle<{ angles: number[]; extra: unknown }> {
  readonly steps = 8;
  angles: number[];
  private shown: number[];
  readonly group = new THREE.Group();
  private beamMat: THREE.MeshBasicMaterial;
  private pool: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  traces: BeamTrace[] = [];
  /** Chapter-owned extra state (e.g. which receptors are lit in order). */
  extra: unknown = null;
  onTraced: ((traces: BeamTrace[]) => void) | null = null;
  onTurnStart: ((i: number) => void) | null = null;
  onTurnEnd: ((i: number) => void) | null = null;
  readonly turnTime = 0.7;
  turns = 0;
  private dirty = true;
  restoreExtra: ((x: unknown) => void) | null = null;

  constructor(
    id: string,
    readonly mirrors: MirrorDef[],
    readonly receptors: ReceptorDef[],
    readonly sources: BeamSource[],
    readonly blockers: BeamBlocker[],
    color = new THREE.Color(1.0, 0.82, 0.5),
  ) {
    super(id);
    this.angles = mirrors.map((m) => m.initial);
    this.shown = [...this.angles];
    this.beamMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.group.name = 'beams';
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(color, 0, 7, 2);
      this.lights.push(l);
      this.group.add(l);
    }
    this.applyRotations();
  }

  get busy(): boolean {
    return this.shown.some((a, i) => a !== this.angles[i]);
  }

  /** Turn mirror i by one step (dir ±1). */
  turn(i: number, dir = 1): void {
    const m = this.mirrors[i];
    if (!m || m.fixed || this.solved || this.shown[i] !== this.angles[i]) return;
    this.angles[i] = this.angles[i] + dir;
    this.turns++;
    this.onTurnStart?.(i);
  }

  markSolved(): void {
    if (this.solved) return;
    this.solved = true;
    this.onSolved?.();
  }

  setSourceEnabled(i: number, on: boolean): void {
    if (this.sources[i].enabled === on) return;
    this.sources[i].enabled = on;
    this.dirty = true;
  }

  update(dt: number): void {
    const step = dt / this.turnTime;
    for (let i = 0; i < this.shown.length; i++) {
      if (this.shown[i] === this.angles[i]) continue;
      const d = this.angles[i] - this.shown[i];
      this.shown[i] = Math.abs(d) <= step ? this.angles[i] : this.shown[i] + Math.sign(d) * step;
      if (this.shown[i] === this.angles[i]) {
        // Normalise to 0..steps-1 once settled.
        this.angles[i] = ((this.angles[i] % this.steps) + this.steps) % this.steps;
        this.shown[i] = this.angles[i];
        this.dirty = true;
        this.onTurnEnd?.(i);
      }
    }
    this.applyRotations();
    // While a mirror turns its beam is "searching": hide downstream segments.
    if (this.busy) {
      for (const p of this.pool) p.visible = false;
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    if (this.dirty) {
      this.dirty = false;
      this.retrace();
    }
    // Shimmer
    const t = performance.now() / 1000;
    this.beamMat.opacity = 0.5 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1) * 0.03;
  }

  private applyRotations(): void {
    this.mirrors.forEach((m, i) => {
      m.object.rotation.y = (this.shown[i] * Math.PI * 2) / this.steps;
    });
  }

  /** Normal of mirror i (horizontal, unit). */
  normal(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = (this.angles[i] * Math.PI * 2) / this.steps;
    return out.set(Math.sin(a), 0, Math.cos(a));
  }

  retrace(): void {
    this.traces = this.sources.map((s) => (s.enabled ? this.traceFrom(s.pos, s.dir) : { points: [], hit: null }));
    this.draw();
    this.onTraced?.(this.traces);
  }

  private traceFrom(origin: THREE.Vector3, dir: THREE.Vector3): BeamTrace {
    const pts = [origin.clone()];
    const p = origin.clone();
    const d = dir.clone().setY(0).normalize();
    let lastMirror = -1;
    const n = new THREE.Vector3();
    for (let bounce = 0; bounce < 12; bounce++) {
      let best = 60;
      let kind = 'none' as 'mirror' | 'receptor' | 'wall' | 'none';
      let idx = -1;
      // Mirrors: segment through pivot, perpendicular to the normal.
      this.mirrors.forEach((m, i) => {
        if (i === lastMirror) return;
        this.normal(i, n);
        const denom = d.x * n.x + d.z * n.z;
        if (Math.abs(denom) < 1e-4) return;
        const t = ((m.pos.x - p.x) * n.x + (m.pos.z - p.z) * n.z) / denom;
        if (t <= 0.05 || t >= best) return;
        const hx = p.x + d.x * t - m.pos.x;
        const hz = p.z + d.z * t - m.pos.z;
        if (Math.hypot(hx, hz) > (m.halfWidth ?? 0.55)) return;
        best = t;
        kind = 'mirror';
        idx = i;
      });
      // Receptors: circles.
      this.receptors.forEach((r, i) => {
        const ox = p.x - r.pos.x;
        const oz = p.z - r.pos.z;
        const b = ox * d.x + oz * d.z;
        const c = ox * ox + oz * oz - r.radius * r.radius;
        const disc = b * b - c;
        if (disc < 0) return;
        const t = -b - Math.sqrt(disc);
        if (t <= 0.05 || t >= best) return;
        best = t;
        kind = 'receptor';
        idx = i;
      });
      // Walls: slab test.
      for (const w of this.blockers) {
        const t = rayBox(p.x, p.z, d.x, d.z, w);
        if (t !== null && t > 0.05 && t < best) {
          best = t;
          kind = 'wall';
          idx = -1;
        }
      }
      p.addScaledVector(d, best);
      pts.push(p.clone());
      if (kind === 'mirror') {
        this.normal(idx, n);
        const dot = d.x * n.x + d.z * n.z;
        d.x -= 2 * dot * n.x;
        d.z -= 2 * dot * n.z;
        d.normalize();
        lastMirror = idx;
        continue;
      }
      return { points: pts, hit: kind === 'receptor' ? this.receptors[idx].id : null };
    }
    return { points: pts, hit: null };
  }

  private draw(): void {
    let k = 0;
    const up = new THREE.Vector3(0, 1, 0);
    let li = 0;
    for (const tr of this.traces) {
      for (let i = 0; i + 1 < tr.points.length; i++) {
        const a = tr.points[i];
        const b = tr.points[i + 1];
        let m = this.pool[k];
        if (!m) {
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 8, 1, true), this.beamMat);
          m.frustumCulled = false;
          this.pool.push(m);
          this.group.add(m);
        }
        const len = a.distanceTo(b);
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.scale.set(1, len, 1);
        m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
        m.visible = true;
        k++;
      }
      const end = tr.points[tr.points.length - 1];
      if (end && li < this.lights.length) {
        const l = this.lights[li++];
        l.position.copy(end);
        l.intensity = tr.hit ? 9 : 5;
      }
    }
    for (; k < this.pool.length; k++) this.pool[k].visible = false;
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
  }

  /** Mirror nearest to a world position (for interaction prompts). */
  nearest(p: THREE.Vector3, maxDist: number): number {
    let best = -1;
    let bd = maxDist;
    this.mirrors.forEach((m, i) => {
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d < bd && !m.fixed) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  protected getState(): { angles: number[]; extra: unknown } {
    return { angles: [...this.angles], extra: this.extra };
  }

  protected setState(s: { angles: number[]; extra: unknown } | undefined): void {
    this.angles = s?.angles && s.angles.length === this.mirrors.length ? [...s.angles] : this.mirrors.map((m) => m.initial);
    this.shown = [...this.angles];
    this.extra = s?.extra ?? null;
    this.restoreExtra?.(this.extra);
    this.applyRotations();
    this.dirty = true;
  }

  protected applySolvedInstant(): void {
    this.dirty = true;
  }

  dispose(): void {
    for (const m of this.pool) m.geometry.dispose();
    this.beamMat.dispose();
    this.group.removeFromParent();
  }
}

function rayBox(px: number, pz: number, dx: number, dz: number, b: BeamBlocker): number | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (px < b.minX || px > b.maxX) return null;
  } else {
    const a = (b.minX - px) / dx;
    const c = (b.maxX - px) / dx;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  if (Math.abs(dz) < 1e-9) {
    if (pz < b.minZ || pz > b.maxZ) return null;
  } else {
    const a = (b.minZ - pz) / dz;
    const c = (b.maxZ - pz) / dz;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  if (t1 < t0 || t1 < 0) return null;
  return t0 > 0 ? t0 : null;
}
