import * as THREE from 'three';
import { globalUniforms } from '../render/HeightFog';
import { fogUniforms } from '../render/HeightFog';
import { mulberry32 } from '../systems/noise';

export type ParticleKind = 'dust' | 'fireflies' | 'mist' | 'leaves' | 'spray' | 'pollen';

/**
 * GPU-animated ambient particles: every particle's motion is a closed-form function of
 * time + per-particle seed computed in the vertex shader (zero per-frame CPU work).
 */
export function ambientParticles(opts: {
  kind: ParticleKind;
  count: number;
  center: THREE.Vector3;
  size: THREE.Vector3;
  texture: THREE.Texture;
  color: THREE.Color;
  pointSize: number;
  opacity: number;
  seed?: number;
}): THREE.Points {
  const rnd = mulberry32(opts.seed ?? 7);
  const n = opts.count;
  const base = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    base[i * 3] = (rnd() - 0.5) * opts.size.x;
    base[i * 3 + 1] = rnd() * opts.size.y;
    base[i * 3 + 2] = (rnd() - 0.5) * opts.size.z;
    seed[i * 4] = rnd();
    seed[i * 4 + 1] = rnd();
    seed[i * 4 + 2] = rnd();
    seed[i * 4 + 3] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, opts.size.y / 2, 0), opts.size.length() / 2);
  const kindId = ['dust', 'fireflies', 'mist', 'leaves', 'spray', 'pollen'].indexOf(opts.kind);
  const additive = opts.kind === 'fireflies' || opts.kind === 'dust' || opts.kind === 'pollen';
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTex: { value: opts.texture },
        uColor: { value: opts.color },
        uSize: { value: opts.pointSize },
        uOpacity: { value: opts.opacity },
        uBox: { value: opts.size.clone() },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uIntensity: { value: 1 },
      },
    ]) as Record<string, THREE.IUniform>,
    defines: { KIND: kindId },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 seed;
      uniform float uTime, uSize, uPixelRatio;
      uniform vec3 uBox;
      uniform vec2 uWindDir;
      varying float vAlpha;
      varying float vRot;
      varying float vFlick;
      void main() {
        vec3 p = position;
        float t = uTime;
        vFlick = 1.0;
        #if KIND == 0 || KIND == 5
          // Dust / pollen: slow drift with gentle rise, wraps in the box.
          p.x += sin(t * (0.1 + seed.x * 0.2) + seed.y * 6.28) * 0.8 + uWindDir.x * t * 0.05;
          p.z += cos(t * (0.12 + seed.z * 0.2) + seed.x * 6.28) * 0.8 + uWindDir.y * t * 0.05;
          p.y = mod(p.y + t * (0.03 + seed.w * 0.05), uBox.y);
          vAlpha = smoothstep(0.0, 0.15, p.y / uBox.y) * smoothstep(1.0, 0.8, p.y / uBox.y);
          vFlick = 0.6 + 0.4 * sin(t * (1.0 + seed.z * 2.0) + seed.w * 20.0);
        #elif KIND == 1
          // Fireflies: wandering loops, blinking.
          p.x += sin(t * (0.3 + seed.x * 0.4) + seed.y * 6.28) * 1.6;
          p.z += sin(t * (0.25 + seed.z * 0.3) + seed.w * 6.28) * 1.6;
          p.y += sin(t * (0.4 + seed.w * 0.3) + seed.x * 6.28) * 0.6;
          float blink = sin(t * (0.8 + seed.y * 1.6) + seed.z * 30.0);
          vFlick = smoothstep(0.2, 0.9, blink);
          vAlpha = 1.0;
        #elif KIND == 2
          // Mist: huge soft billboards drifting slowly.
          p.x += sin(t * 0.02 + seed.x * 6.28) * 6.0 + uWindDir.x * t * 0.25;
          p.z += cos(t * 0.017 + seed.y * 6.28) * 6.0 + uWindDir.y * t * 0.25;
          p.x = mod(p.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5;
          p.z = mod(p.z + uBox.z * 0.5, uBox.z) - uBox.z * 0.5;
          vAlpha = 0.6 + 0.4 * sin(t * 0.05 + seed.z * 6.28);
        #elif KIND == 3
          // Falling leaves: fall with sway, spin, wrap vertically.
          float fall = mod(p.y - t * (0.35 + seed.x * 0.4), uBox.y);
          p.y = fall;
          p.x += sin(t * (0.9 + seed.y) + seed.z * 6.28) * 0.9 + uWindDir.x * (uBox.y - fall) * 0.3;
          p.z += cos(t * (0.7 + seed.w) + seed.x * 6.28) * 0.9 + uWindDir.y * (uBox.y - fall) * 0.3;
          vAlpha = smoothstep(0.0, 0.08, fall / uBox.y) * smoothstep(1.0, 0.9, fall / uBox.y);
          vRot = t * (1.0 + seed.z * 3.0) + seed.w * 6.28;
        #else
          // Spray: short upward bursts that fall back, looping.
          float life = fract(t * (0.35 + seed.x * 0.35) + seed.y);
          vec2 dir = normalize(vec2(seed.z - 0.5, seed.w - 0.5) + 0.001);
          p.xz = p.xz * 0.35 + dir * life * (2.0 + seed.x * 3.0);
          p.y = life * (4.0 + seed.w * 3.0) - life * life * 5.0;
          vAlpha = (1.0 - life) * smoothstep(0.0, 0.1, life);
        #endif
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float sz = uSize * (0.6 + seed.z * 0.8);
        #if KIND == 2
          sz *= 1.0;
        #endif
        gl_PointSize = sz * uPixelRatio * (300.0 / -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uTex;
      uniform vec3 uColor;
      uniform float uOpacity, uIntensity;
      varying float vAlpha;
      varying float vRot;
      varying float vFlick;
      void main() {
        vec2 uv = gl_PointCoord;
        #if KIND == 3
          float c = cos(vRot), s = sin(vRot);
          uv = mat2(c, -s, s, c) * (uv - 0.5) + 0.5;
        #endif
        vec4 tex = texture2D(uTex, uv);
        float a = tex.a * vAlpha * uOpacity * vFlick;
        if (a < 0.004) discard;
        vec3 col = uColor * tex.rgb * uIntensity;
        #if KIND == 1
          col *= 6.0;
        #endif
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
  m.uniforms.uTime = globalUniforms.uTime;
  m.uniforms.uWindDir = globalUniforms.uWindDir;
  Object.assign(m.uniforms, fogUniforms);
  const pts = new THREE.Points(g, m);
  pts.position.copy(opts.center);
  pts.position.y -= 0;
  pts.frustumCulled = true;
  pts.name = `particles:${opts.kind}`;
  pts.renderOrder = opts.kind === 'mist' ? 5 : 10;
  return pts;
}

interface Burst {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
}

/**
 * CPU particle pool for one-off bursts (debris, dust puffs). Fixed-size buffer; dead
 * particles are recycled — no allocation during gameplay.
 */
export class BurstPool {
  readonly points: THREE.Points;
  private items: Burst[] = [];
  private free: number[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(capacity: number, texture: THREE.Texture, color: THREE.Color, size: number, private gravity = 9) {
    this.pos = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < capacity; i++) {
      this.items.push({ pos: new THREE.Vector3(0, -9999, 0), vel: new THREE.Vector3(), life: 0, max: 1 });
      this.free.push(i);
      this.pos[i * 3 + 1] = -9999;
    }
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: texture }, uColor: { value: color }, uSize: { value: size } }]) as Record<string, THREE.IUniform>,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute float alpha; varying float vA; uniform float uSize;
        void main(){
          vA = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = uSize * (300.0 / -mvPosition.z) * (1.5 - alpha * 0.5);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    Object.assign(m.uniforms, fogUniforms);
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
    this.points.name = 'bursts';
  }

  emit(origin: THREE.Vector3, count: number, spread: THREE.Vector3, velocity: THREE.Vector3, velSpread: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const idx = this.free.pop();
      if (idx === undefined) return;
      const it = this.items[idx];
      it.pos.set(origin.x + (Math.random() - 0.5) * spread.x, origin.y + (Math.random() - 0.5) * spread.y, origin.z + (Math.random() - 0.5) * spread.z);
      it.vel.set(velocity.x + (Math.random() - 0.5) * velSpread, velocity.y + (Math.random() - 0.5) * velSpread, velocity.z + (Math.random() - 0.5) * velSpread);
      it.max = it.life = life * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let any = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      any = true;
      it.life -= dt;
      it.vel.y -= this.gravity * dt;
      it.vel.multiplyScalar(1 - dt * 0.6);
      it.pos.addScaledVector(it.vel, dt);
      this.pos[i * 3] = it.pos.x;
      this.pos[i * 3 + 1] = it.pos.y;
      this.pos[i * 3 + 2] = it.pos.z;
      this.alpha[i] = Math.max(0, it.life / it.max);
      if (it.life <= 0) {
        this.alpha[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        this.free.push(i);
      }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
    }
  }
}
