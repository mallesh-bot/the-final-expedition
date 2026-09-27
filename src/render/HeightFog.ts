import * as THREE from 'three';

/**
 * Global exponential height fog with sun in-scattering, installed by patching Three's fog
 * shader chunks once at boot. Works for every built-in material and any ShaderMaterial
 * that includes the standard fog chunks.
 */
export const fogUniforms = {
  fogSunDir: { value: new THREE.Vector3(0, 0.2, 1).normalize() },
  fogSunColor: { value: new THREE.Color(1.0, 0.72, 0.45) },
  fogHeightBase: { value: 0 },
  fogHeightFalloff: { value: 0.045 },
  fogSunPower: { value: 7 },
};

/** Shared time/wind uniforms for animated materials. */
export const globalUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 1 },
  uWetness: { value: 0.35 },
  uSunDirWorld: { value: new THREE.Vector3(0, 0.2, 1).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.8, 0.6) },
  uPlayerPos: { value: new THREE.Vector3(0, -999, 0) },
  uPlayerTrail: { value: new THREE.Vector3(0, -999, 0) },
};

let installed = false;

export function injectFogUniforms(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, fogUniforms);
}

export function installHeightFog(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform float fogHeightBase;
  uniform float fogHeightFalloff;
  uniform float fogSunPower;
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogRay = vFogWorldPos - cameraPosition;
  float fogDist = length(fogRay);
  vec3 fogDirN = fogRay / max(fogDist, 1e-4);
  #ifdef FOG_EXP2
    float hf = max(fogHeightFalloff, 1e-4);
    float camH = max(cameraPosition.y, fogHeightBase);
    float h0 = camH - fogHeightBase;
    float dy = max(vFogWorldPos.y, fogHeightBase) - camH;
    float fogBase = fogDensity * exp(-hf * h0);
    float fogAmt = abs(dy) > 0.01 ? fogBase * fogDist * (1.0 - exp(-hf * dy)) / (hf * dy) : fogBase * fogDist;
    float fogFactor = 1.0 - exp(-max(fogAmt, 0.0));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogDist);
  #endif
  float fogSun = pow(max(dot(fogDirN, fogSunDir), 0.0), max(fogSunPower, 1.0));
  vec3 fogCol = mix(fogColor, fogSunColor, fogSun);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 1.0));
#endif`;

  // Every material gets the extra fog uniforms unless it overrides onBeforeCompile
  // (our own patched materials call injectFogUniforms themselves).
  (THREE.Material.prototype as unknown as { onBeforeCompile: (s: { uniforms: Record<string, THREE.IUniform> }) => void }).onBeforeCompile =
    function (shader) {
      injectFogUniforms(shader);
    };
}
