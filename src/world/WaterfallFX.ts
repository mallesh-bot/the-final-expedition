import * as THREE from 'three';
import { fogUniforms, globalUniforms } from '../render/HeightFog';
import { mulberry32 } from '../systems/noise';
import { waterfallMesh } from './Water';
import { ambientParticles } from './Particles';

/**
 * Layered cliff waterfall: front + back sheets at different speeds, GPU falling droplets that
 * follow the fall curve, a looping splash, mist, and an animated ripple/foam disc on the pool.
 * All motion is closed-form on the GPU and driven by the (pausable) global game time.
 */
export function buildWaterfallFX(opts: {
  top: THREE.Vector3;
  bottom: THREE.Vector3;
  width: number;
  outward: THREE.Vector3;
  material: THREE.ShaderMaterial;
  poolY: number;
  dot: THREE.Texture;
  mist: THREE.Texture;
  particleScale: number;
}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'waterfall-fx';
  const { top, bottom, width, outward } = opts;
  const out = outward.clone().setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize();
  const ps = Math.max(0.2, opts.particleScale);

  // Front sheet (shared material) + slightly wider, recessed back sheet with its own speed.
  g.add(waterfallMesh(top, bottom, width, out, opts.material));
  const back = opts.material.clone();
  back.uniforms.uTime = globalUniforms.uTime;
  back.uniforms.uSunDir = globalUniforms.uSunDirWorld;
  back.uniforms.uStreak.value = opts.material.uniforms.uStreak.value;
  back.uniforms.uSpeed = { value: 1.15 };
  back.uniforms.uOpacity = { value: 0.55 };
  Object.assign(back.uniforms, fogUniforms);
  const backMesh = waterfallMesh(top.clone().addScaledVector(out, -0.25), bottom.clone().addScaledVector(out, -0.3), width * 1.25, out, back);
  backMesh.renderOrder = 2;
  g.add(backMesh);

  // Impact point = where the sheet meets the pool (matches waterfallMesh's outward bulge).
  const impact = bottom.clone().addScaledVector(out, 1.4).setY(opts.poolY);

  // Falling droplets following the fall curve.
  {
    const n = Math.round(260 * ps);
    const rnd = mulberry32(31);
    const seed = new Float32Array(n * 4);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 4; i++) seed[i] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    geo.boundingSphere = new THREE.Sphere(top.clone().lerp(bottom, 0.5), top.distanceTo(bottom) + width * 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: opts.dot },
          uTop: { value: top.clone() },
          uBottom: { value: bottom.clone() },
          uOut: { value: out.clone() },
          uRight: { value: right.clone() },
          uWidth: { value: width },
          uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        },
      ]) as Record<string, THREE.IUniform>,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec4 seed;
        uniform float uTime, uWidth, uPixelRatio;
        uniform vec3 uTop, uBottom, uOut, uRight;
        varying float vA;
        void main() {
          float t = fract(uTime * (0.55 + seed.x * 0.45) + seed.y);
          float fall = t * t; // accelerating
          vec3 p = mix(uTop, uBottom, fall);
          p += uOut * (sqrt(fall) * 1.4 + sin(fall * 3.14159) * 0.3 + seed.z * 0.35);
          p += uRight * (seed.w - 0.5) * uWidth * 1.2;
          vA = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.85, t);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (0.05 + seed.z * 0.06) * uPixelRatio * (300.0 / -mvPosition.z);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uTex;
        varying float vA;
        void main() {
          float a = texture2D(uTex, gl_PointCoord).a * vA * 0.85;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.9, 0.95, 0.95), a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.uTime = globalUniforms.uTime;
    Object.assign(mat.uniforms, fogUniforms);
    const pts = new THREE.Points(geo, mat);
    pts.name = 'waterfall-droplets';
    pts.renderOrder = 11;
    g.add(pts);
  }

  // Splash (looping upward bursts) + low mist at the impact.
  g.add(ambientParticles({ kind: 'spray', count: Math.round(260 * ps), center: impact.clone(), size: new THREE.Vector3(width * 1.2, 1, 1.2), texture: opts.mist, color: new THREE.Color(0.92, 0.96, 0.96), pointSize: 1.6, opacity: 0.28, seed: 7 }));
  g.add(ambientParticles({ kind: 'spray', count: Math.round(120 * ps), center: impact.clone(), size: new THREE.Vector3(width * 0.8, 1, 0.8), texture: opts.dot, color: new THREE.Color(1, 1, 1), pointSize: 0.12, opacity: 0.8, seed: 17 }));
  g.add(ambientParticles({ kind: 'mist', count: Math.round(16 * ps) + 6, center: impact.clone().setY(opts.poolY - 0.2), size: new THREE.Vector3(9, 4, 7), texture: opts.mist, color: new THREE.Color(0.9, 0.93, 0.92), pointSize: 8, opacity: 0.32, seed: 8 }));

  // Ripple / foam disc on the pool surface.
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: opts.mist } }]) as Record<string, THREE.IUniform>,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float ang = atan(d.y, d.x);
          float wob = sin(ang * 7.0 + uTime * 1.3) * 0.02;
          float rings = pow(0.5 + 0.5 * sin((r + wob) * 26.0 - uTime * 5.0), 6.0);
          float rings2 = pow(0.5 + 0.5 * sin((r - wob) * 15.0 - uTime * 3.1 + 1.7), 8.0);
          float foamN = texture2D(uTex, vUv * 1.7 + vec2(uTime * 0.05, -uTime * 0.04)).a;
          float foam = smoothstep(0.55, 0.0, r) * (0.55 + foamN * 0.7);
          float fade = smoothstep(1.0, 0.25, r);
          float a = clamp((rings * 0.35 + rings2 * 0.25) * fade + foam * 0.7, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.85, 0.9, 0.9), a * 0.75);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.uTime = globalUniforms.uTime;
    Object.assign(mat.uniforms, fogUniforms);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48).rotateX(-Math.PI / 2), mat);
    disc.position.copy(impact).setY(opts.poolY + 0.03);
    disc.renderOrder = 4;
    disc.name = 'pool-ripples';
    g.add(disc);
  }
  return g;
}
