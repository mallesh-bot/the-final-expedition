import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics/Colliders';
import { CharacterMotor } from '../src/physics/CharacterMotor';
import { addRockCollider, displacedRock } from '../src/world/RockKit';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Flat world with optional colliders; no heightfield (ground = y 0). */
function world(): CollisionWorld {
  return new CollisionWorld();
}

function walk(m: CharacterMotor, dir: THREE.Vector3, speed: number, seconds: number, onStep?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    m.velocity.x = dir.x * speed;
    m.velocity.z = dir.z * speed;
    m.update(1 / 60);
    onStep?.();
  }
}

describe('CollisionWorld.resolveCylinder', () => {
  it('pushes a cylinder out of a box along the shortest axis', () => {
    const w = world();
    w.addBox(v(0, 1, 0), v(1, 1, 1));
    const p = v(0.9, 0, 0);
    expect(w.resolveCylinder(p, 0.3, 0.1, 1.8)).toBe(true);
    expect(p.x).toBeCloseTo(1.3, 5);
  });

  it('respects box yaw', () => {
    const w = world();
    w.addBox(v(0, 1, 0), v(2, 1, 0.2), Math.PI / 2); // long axis now along Z
    const p = v(0.3, 0, 1.5);
    w.resolveCylinder(p, 0.3, 0.1, 1.8);
    expect(Math.abs(p.x)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });

  it('ignores boxes entirely below the step band', () => {
    const w = world();
    w.addBox(v(0, 0.15, 0), v(1, 0.15, 1)); // 0.3 m tall: steppable
    const p = v(0.5, 0, 0);
    expect(w.resolveCylinder(p, 0.3, 0.42, 1.72)).toBe(false);
  });
});

describe('CharacterMotor', () => {
  it('stops flush against a wall and never embeds', () => {
    const w = world();
    w.addBox(v(0, 2, 5), v(5, 2, 0.5)); // wall face at z = 4.5
    const m = new CharacterMotor(w);
    m.teleport(v(0, 0, 0));
    let worst = 0;
    walk(m, v(0, 0, 1), 6.6, 2, () => (worst = Math.max(worst, m.penetrationDepth())));
    expect(m.position.z).toBeCloseTo(4.5 - m.radius, 2);
    expect(worst).toBeLessThan(0.01);
  });

  it('slides along an angled wall instead of stopping dead', () => {
    const w = world();
    w.addBox(v(0, 2, 5), v(5, 2, 0.5), 0.5);
    const m = new CharacterMotor(w);
    m.teleport(v(0, 0, 0));
    walk(m, v(0, 0, 1), 4.3, 2);
    expect(Math.abs(m.position.x)).toBeGreaterThan(0.5);
  });

  it('steps up onto low obstacles and is blocked by tall ones', () => {
    const w = world();
    w.addBox(v(0, 0.15, 2), v(2, 0.15, 0.5)); // 0.3 m step
    w.addBox(v(0, 0.5, 6), v(2, 0.5, 0.5)); // 1.0 m block
    const m = new CharacterMotor(w);
    m.teleport(v(0, 0, 0));
    walk(m, v(0, 0, 1), 3, 3);
    expect(m.position.z).toBeGreaterThan(3); // got over the step
    expect(m.position.z).toBeLessThan(5.5 - m.radius + 0.01); // stopped at the block
  });

  it('teleport escapes a gap narrower than the capsule', () => {
    const w = world();
    w.addBox(v(-0.55, 1, 0), v(0.3, 1, 2));
    w.addBox(v(0.55, 1, 0), v(0.3, 1, 2)); // 0.5 m gap < 0.64 m capsule
    const m = new CharacterMotor(w);
    m.teleport(v(0, 0, 0));
    expect(m.penetrationDepth()).toBeLessThanOrEqual(0.01);
  });

  it('never walks into a gap narrower than the capsule', () => {
    const w = world();
    w.addBox(v(-0.55, 1, 3), v(0.3, 1, 2));
    w.addBox(v(0.55, 1, 3), v(0.3, 1, 2));
    const m = new CharacterMotor(w);
    m.teleport(v(0, 0, 0));
    let worst = 0;
    walk(m, v(0, 0, 1), 4.3, 2, () => (worst = Math.max(worst, m.penetrationDepth())));
    expect(worst).toBeLessThanOrEqual(0.01);
    expect(m.position.z).toBeLessThan(1.2);
  });

  it('reports landing with fall height', () => {
    const w = world();
    const m = new CharacterMotor(w);
    m.teleport(v(0, 5, 0));
    let landed: number | null = null;
    for (let i = 0; i < 120 && landed === null; i++) {
      const ev = m.update(1 / 60);
      if (ev.landed) landed = ev.landed.fallHeight;
    }
    expect(landed).not.toBeNull();
    expect(landed!).toBeCloseTo(5, 1);
  });
});

describe('addRockCollider', () => {
  it('fits a proxy that covers the scaled rock footprint', () => {
    const w = world();
    const geo = displacedRock(10, 2, 0.32, 0.72);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const s = v(1.6, 1.0, 1.5);
    const c = addRockCollider(w, geo, v(0, 0, 0), s, 0, 0)!;
    expect(c).not.toBeNull();
    const reach = Math.min((bb.max.x - bb.min.x) * s.x, (bb.max.z - bb.min.z) * s.z) / 2;
    expect(c.half.x).toBeGreaterThan(reach * 0.75); // no more under-sized proxies
    expect(c.center.y + c.half.y).toBeGreaterThan(0.3);
  });

  it('skips rocks that barely rise above the ground', () => {
    const w = world();
    const geo = displacedRock(11, 2, 0.3, 0.72);
    expect(addRockCollider(w, geo, v(0, -0.6, 0), 0.5, 0, 0)).toBeNull();
  });
});
