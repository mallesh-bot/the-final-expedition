import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DynamicResolution } from '../src/systems/DynamicResolution';
import { resolveQuality } from '../src/systems/Quality';
import { RotatingDrumsPuzzle } from '../src/puzzles/RotatingDrumsPuzzle';
import { TraversalSystem } from '../src/traversal/TraversalSystem';
import { TRAVERSAL, DRUMS } from '../src/chapters/ch1/layout';
import { radialDeadzone } from '../src/input/GamepadProvider';
import { InputManager } from '../src/input/InputManager';
import type { InputProvider } from '../src/input/InputProvider';
import { CinematicDirector } from '../src/cinematic/CinematicDirector';
import { EventBus } from '../src/systems/EventBus';

describe('DynamicResolution', () => {
  it('scales down when over budget and never below the floor', () => {
    let applied = 1;
    const d = new DynamicResolution((s) => (applied = s));
    d.configure(1000 / 30, 0.55);
    for (let i = 0; i < 2000; i++) d.update(1 / 12); // 83 ms frames
    expect(applied).toBeLessThan(1);
    expect(applied).toBeGreaterThanOrEqual(0.55);
  });

  it('recovers resolution when there is headroom', () => {
    let applied = 1;
    const d = new DynamicResolution((s) => (applied = s));
    d.configure(1000 / 30, 0.55);
    for (let i = 0; i < 600; i++) d.update(1 / 12);
    const low = applied;
    for (let i = 0; i < 4000; i++) d.update(1 / 60);
    expect(applied).toBeGreaterThan(low);
  });
});

describe('Quality presets', () => {
  it('LOW scales resolution and overdraw, not only post-FX', () => {
    const low = resolveQuality('low', 0);
    const high = resolveQuality('high', 0);
    expect(low.renderScale).toBeLessThan(1);
    expect(low.vegetationShadows).toBe(false);
    expect(low.grassDistance).toBeLessThan(high.grassDistance);
    expect(low.targetFrameMs).toBeGreaterThan(high.targetFrameMs);
  });

  it('ULTRA exists, is opt-in and outranks HIGH', () => {
    const ultra = resolveQuality('ultra', 0);
    const high = resolveQuality('high', 0);
    expect(ultra.preset).toBe('ultra');
    expect(ultra.shadowMapSize).toBeGreaterThanOrEqual(high.shadowMapSize);
    expect(ultra.vegetationDistance).toBeGreaterThan(high.vegetationDistance);
  });
});

describe('Gate of the Watching Sun puzzle', () => {
  const make = () =>
    new RotatingDrumsPuzzle(
      'test',
      DRUMS.map((d) => ({ object: new THREE.Object3D(), initial: d.initial, solution: d.solution })),
    );
  const step = (p: RotatingDrumsPuzzle) => {
    for (let i = 0; i < 120; i++) p.update(1 / 60);
  };

  it('is solved by the bible order: right-to-left Rising, Open Eye, Setting', () => {
    const p = make();
    let solved = false;
    p.onSolved = () => (solved = true);
    // Rotate each drum until it shows its solution glyph.
    DRUMS.forEach((d, i) => {
      for (let k = 0; k < (d.solution - d.initial + 4) % 4; k++) {
        p.rotate(i);
        step(p);
      }
    });
    expect(solved).toBe(true);
    // Right-hand drum (smallest x, east) is Rising (0); left (largest x) is Setting (2).
    const byX = [...DRUMS].sort((a, b) => a.x - b.x).map((d) => d.solution);
    expect(byX).toEqual([0, 1, 2]);
  });

  it('round-trips through save state', () => {
    const p = make();
    p.rotate(0);
    step(p);
    const saved = p.serialize();
    const q = make();
    q.restore(saved);
    expect(q.indices).toEqual(p.indices);
  });
});

describe('Chapter 1 traversal data', () => {
  const t = new TraversalSystem();
  t.load(TRAVERSAL);

  it('every climb surface links to an existing ledge and back', () => {
    for (const c of TRAVERSAL.climbs) {
      expect(c.topLedge && t.ledge(c.topLedge)).toBeTruthy();
    }
    for (const l of TRAVERSAL.ledges) if (l.wallBelow) expect(t.climb(l.wallBelow)).toBeTruthy();
  });

  it('the stair gap jump is within assisted-jump reach', () => {
    for (const j of TRAVERSAL.jumps) {
      const d = Math.hypot(j.to.x - j.from.x, j.to.z - j.from.z);
      expect(d).toBeLessThan(5.4 * 0.85 + 0.5);
    }
  });

  it('finds the vault only when running at the column', () => {
    const vb = TRAVERSAL.vaults[0];
    const toward = new THREE.Vector3(Math.sin(vb.yaw), 0, Math.cos(vb.yaw));
    const start = vb.center.clone().addScaledVector(toward, -(vb.half.z + 0.5));
    expect(t.findVault(start, toward)).not.toBeNull();
    expect(t.findVault(start, toward.clone().negate())).toBeNull();
  });
});

describe('Input', () => {
  it('radial dead zone removes stick drift and rescales', () => {
    expect(radialDeadzone(0.1, 0.1)).toEqual([0, 0]);
    const [x] = radialDeadzone(1, 0);
    expect(x).toBeCloseTo(1, 5);
  });

  it('pressed edges fire in the first substep only', () => {
    const held = new Set<string>(['jump']);
    const fake: InputProvider = {
      id: 'fake',
      attach() {},
      detach() {},
      poll(frame) {
        for (const h of held) frame.held.add(h as never);
      },
      endFrame() {},
    };
    const im = new InputManager();
    im.add(fake);
    im.update(1 / 60);
    expect(im.pressed('jump')).toBe(true);
    im.consumeEdges();
    expect(im.pressed('jump')).toBe(false);
    expect(im.held('jump')).toBe(true);
  });
});

describe('CinematicDirector', () => {
  const seq = (blendIn?: number) => ({
    id: 's',
    duration: 2,
    skippable: true,
    letterbox: true,
    blendOut: 0.5,
    blendIn,
    shots: [{ t0: 0, t1: 2, path: [new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 2, 0)], look: [new THREE.Vector3(0, 0, 5)] }],
    events: [] as { t: number; run: (s: boolean) => void }[],
  });

  it('blends in from the gameplay camera instead of cutting', () => {
    const c = new CinematicDirector(new EventBus());
    void c.play(seq());
    expect(c.blendAmount).toBe(0);
    c.update(0.3);
    expect(c.blendAmount).toBeGreaterThan(0);
    expect(c.blendAmount).toBeLessThan(1);
    c.update(0.5);
    expect(c.blendAmount).toBe(1);
  });

  it('blendIn 0 is a deliberate cut', () => {
    const c = new CinematicDirector(new EventBus());
    void c.play(seq(0));
    expect(c.blendAmount).toBe(1);
  });

  it('skip still fires world-state events and blends out smoothly', () => {
    const c = new CinematicDirector(new EventBus());
    const s = seq();
    let fired = false;
    s.events.push({ t: 1.5, run: () => (fired = true) });
    void c.play(s);
    c.update(0.2);
    const before = c.blendAmount;
    c.skip();
    expect(fired).toBe(true);
    c.update(0.01);
    expect(c.blendAmount).toBeLessThanOrEqual(before);
  });
});
