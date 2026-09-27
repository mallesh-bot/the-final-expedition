import * as THREE from 'three';
import { globalUniforms } from '../render/HeightFog';

/**
 * Fake volumetric sun shafts: additive tapered cones with animated noise, fading by view
 * angle and camera proximity so they never look like solid geometry.
 */
export function createShaftMaterial(color: THREE.Color, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uIntensity: { value: intensity }, uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWPos; varying vec3 vWNormal;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWPos = w.xyz;
        vWNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
      varying vec2 vUv; varying vec3 vWPos; varying vec3 vWNormal;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      float n1(float x){ float i = floor(x); float f = fract(x); f = f*f*(3.0-2.0*f); return mix(h(i), h(i+1.0), f); }
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        float facing = abs(dot(V, normalize(vWNormal)));
        float edge = pow(facing, 1.5);
        float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float streaks = 0.72 + 0.28 * n1(vUv.x * 9.0 + uTime * 0.12) * n1(vUv.x * 4.0 - uTime * 0.05 + 3.0);
        float near = smoothstep(1.5, 9.0, distance(cameraPosition, vWPos));
        float a = edge * along * streaks * near * uIntensity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function lightShaft(origin: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, r1: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, length, 16, 1, true);
  // uv.y: 0 at bottom (far end), 1 at top (origin)
  g.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(origin);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  m.renderOrder = 20;
  m.name = 'shaft';
  return m;
}
