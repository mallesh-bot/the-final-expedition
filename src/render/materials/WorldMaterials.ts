import * as THREE from 'three';
import { fogUniforms, globalUniforms, injectFogUniforms } from '../HeightFog';
import type { PBRSet } from '../textures/ProceduralTextures';

/**
 * Shader patches layered on MeshStandardMaterial so we keep Three's PBR lighting, shadows,
 * fog and tone mapping while adding triplanar mapping, moss, wetness, splatting and wind.
 */

type Shader = THREE.WebGLProgramParametersWithUniforms;

const TRI_VERT_PARS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
`;
const TRI_VERT_MAIN = /* glsl */ `
  vec4 triWorld = vec4(transformed, 1.0);
  vec3 triN = objectNormal;
  #ifdef USE_INSTANCING
    triWorld = instanceMatrix * triWorld;
    triN = mat3(instanceMatrix) * triN;
  #endif
  triWorld = modelMatrix * triWorld;
  vTriPos = triWorld.xyz;
  vTriNormal = normalize(mat3(modelMatrix) * triN);
`;

const TRI_FRAG_PARS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform float uTriScale;
uniform float uWetness;
#ifdef TRI_MOSS
  uniform sampler2D mossMap;
  uniform sampler2D mossNormalMap;
  uniform float uMossAmount;
  uniform float uMossMin;
#endif
#ifdef TRI_SPLAT
  varying vec4 vSplat;
  uniform sampler2D grassMap;
  uniform sampler2D rockMap;
  uniform sampler2D rockNormalMap;
  uniform float uRockScale;
#endif
vec3 triBlend(vec3 n) {
  vec3 b = pow(abs(n), vec3(4.0));
  return b / (b.x + b.y + b.z + 1e-5);
}
vec4 triSample(sampler2D t, vec3 p, vec3 b, float s) {
  return texture2D(t, p.zy * s) * b.x + texture2D(t, p.xz * s) * b.y + texture2D(t, p.xy * s) * b.z;
}
vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 b, float s, float strength) {
  vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
  tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
}
float triHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float triNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(triHash(i), triHash(i + vec2(1, 0)), f.x), mix(triHash(i + vec2(0, 1)), triHash(i + vec2(1, 1)), f.x), f.y);
}
`;

export interface WorldMaterialOptions {
  set: PBRSet;
  color?: THREE.ColorRepresentation;
  triScale?: number;
  roughness?: number;
  normalScale?: number;
  moss?: { set: PBRSet; amount: number; min: number };
  splat?: { grass: THREE.Texture; rock: PBRSet; rockScale: number };
  vertexColors?: boolean;
  /** Receives wetness darkening/sheen. */
  wet?: boolean;
  side?: THREE.Side;
}

/** Triplanar PBR material (rocks, ruins, cliffs) or splat-mapped terrain. */
export function createWorldMaterial(o: WorldMaterialOptions): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    map: o.set.map,
    normalMap: o.set.normalMap,
    roughnessMap: o.set.roughnessMap ?? null,
    roughness: o.roughness ?? 0.9,
    metalness: 0,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
  });
  m.normalScale.setScalar(o.normalScale ?? 1);
  const triScale = { value: o.triScale ?? 0.35 };
  m.defines = m.defines ?? {};
  if (o.moss) m.defines.TRI_MOSS = '';
  if (o.splat) m.defines.TRI_SPLAT = '';
  if (o.wet !== false) m.defines.TRI_WET = '';
  if (o.set.roughnessMap) m.defines.TRI_ROUGH = '';

  m.onBeforeCompile = (shader: Shader) => {
    injectFogUniforms(shader);
    shader.uniforms.uTriScale = triScale;
    shader.uniforms.uWetness = globalUniforms.uWetness;
    if (o.moss) {
      shader.uniforms.mossMap = { value: o.moss.set.map };
      shader.uniforms.mossNormalMap = { value: o.moss.set.normalMap };
      shader.uniforms.uMossAmount = { value: o.moss.amount };
      shader.uniforms.uMossMin = { value: o.moss.min };
    }
    if (o.splat) {
      shader.uniforms.grassMap = { value: o.splat.grass };
      shader.uniforms.rockMap = { value: o.splat.rock.map };
      shader.uniforms.rockNormalMap = { value: o.splat.rock.normalMap };
      shader.uniforms.uRockScale = { value: o.splat.rockScale };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TRI_VERT_PARS}\n${o.splat ? 'attribute vec4 splat; varying vec4 vSplat;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TRI_VERT_MAIN}\n${o.splat ? 'vSplat = splat;' : ''}`);

    const albedo = o.splat
      ? /* glsl */ `
      vec3 tb = triBlend(vTriNormal);
      vec2 guv = vTriPos.xz * uTriScale;
      vec4 mudC = texture2D(map, guv);
      vec4 grassC = texture2D(grassMap, guv * 0.7) * 0.6 + texture2D(grassMap, guv * 0.13) * 0.4;
      vec4 rockC = triSample(rockMap, vTriPos, tb, uRockScale);
      float nz = triNoise(vTriPos.xz * 0.35);
      vec4 w = vSplat;
      w.g *= 0.7 + nz * 0.6;
      w.r *= 0.7 + (1.0 - nz) * 0.6;
      float steep = smoothstep(0.62, 0.45, vTriNormal.y);
      w.b = max(w.b, steep);
      w /= (w.r + w.g + w.b + 1e-4);
      vec4 texelColor = mudC * w.r + grassC * w.g + rockC * w.b;
      diffuseColor *= texelColor;
      float triWetMask = w.r;
      `
      : /* glsl */ `
      vec3 tb = triBlend(vTriNormal);
      vec4 texelColor = triSample(map, vTriPos, tb, uTriScale);
      #ifdef TRI_MOSS
        float mossN = triNoise(vTriPos.xz * 0.9) * 0.6 + triNoise(vTriPos.xz * 3.1) * 0.4;
        float mossAmt = smoothstep(uMossMin, uMossMin + 0.22, vTriNormal.y + (mossN - 0.5) * 0.7) * uMossAmount;
        vec4 mossC = triSample(mossMap, vTriPos, tb, uTriScale * 1.6);
        texelColor = mix(texelColor, mossC, mossAmt);
      #endif
      diffuseColor *= texelColor;
      float triWetMask = 1.0;
      `;

    const normalCode = o.splat
      ? /* glsl */ `
      {
        vec3 nG = triNormal(normalMap, vTriPos, vTriNormal, vec3(0.0, 1.0, 0.0), uTriScale, normalScale.x);
        vec3 nR = triNormal(rockNormalMap, vTriPos, vTriNormal, tb, uRockScale, normalScale.x * 1.2);
        vec3 wn = normalize(mix(nG, nR, w.b));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`
      : /* glsl */ `
      {
        vec3 wn = triNormal(normalMap, vTriPos, vTriNormal, tb, uTriScale, normalScale.x);
        #ifdef TRI_MOSS
          vec3 mn = triNormal(mossNormalMap, vTriPos, vTriNormal, tb, uTriScale * 1.6, normalScale.x * 0.7);
          wn = normalize(mix(wn, mn, mossAmt));
        #endif
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`;

    const roughCode = /* glsl */ `
      float roughnessFactor = roughness;
      #ifdef TRI_ROUGH
        #ifndef TRI_SPLAT
          roughnessFactor *= triSample(roughnessMap, vTriPos, tb, uTriScale).g;
        #endif
      #endif
      #ifdef TRI_MOSS
        roughnessFactor = mix(roughnessFactor, 0.95, mossAmt);
      #endif
      #ifdef TRI_WET
        float wetN = triNoise(vTriPos.xz * 0.45) * 0.7 + triNoise(vTriPos.xz * 2.3) * 0.3;
        float wet = clamp(uWetness * (0.45 + wetN) * triWetMask * (0.4 + 0.6 * clamp(vTriNormal.y, 0.0, 1.0)), 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.18, wet * 0.8);
        diffuseColor.rgb *= 1.0 - wet * 0.35;
      #endif
    `;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRI_FRAG_PARS}`)
      .replace('#include <map_fragment>', albedo)
      .replace('#include <normal_fragment_maps>', normalCode)
      .replace('#include <roughnessmap_fragment>', roughCode);
  };
  m.customProgramCacheKey = () =>
    `world-${o.moss ? 1 : 0}${o.splat ? 1 : 0}${o.wet !== false ? 1 : 0}${o.set.roughnessMap ? 1 : 0}`;
  return m;
}

// ---------------------------------------------------------------- foliage (wind + translucency)

export interface FoliageOptions {
  map: THREE.Texture;
  /** Object-space height at which sway reaches full strength. */
  swayHeight: number;
  swayAmount: number;
  color?: THREE.ColorRepresentation;
  translucency?: number;
  alphaTest?: number;
  alphaToCoverage?: boolean;
  /** How strongly the plant bends away from the player (0 = static). */
  push?: number;
}

const WIND_VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uSwayHeight;
uniform float uSwayAmount;
uniform vec3 uPlayerPos;
uniform vec3 uPlayerTrail;
uniform float uPush;
`;
const WIND_VERT = /* glsl */ `
  {
    vec3 instP = vec3(0.0);
    #ifdef USE_INSTANCING
      instP = instanceMatrix[3].xyz;
    #endif
    float ww = clamp(position.y / uSwayHeight, 0.0, 1.0);
    ww *= ww;
    float ph = dot(instP.xz, vec2(0.13, 0.17)) + uTime * 1.3;
    float gust = sin(uTime * 0.33 + instP.x * 0.021 + instP.z * 0.017) * 0.5 + 0.5;
    float flutter = sin(uTime * 7.0 + position.x * 5.0 + position.z * 4.0) * 0.08;
    vec2 sway = uWindDir * (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25 + flutter) * (0.35 + gust) * uWindStrength * uSwayAmount * ww;
    transformed.xz += sway;
    transformed.y -= dot(sway, sway) * 0.35;
  }
  if (uPush > 0.0) {
    // Player interaction: bend away from the character (and from its lagging trail, so
    // plants spring back smoothly after she passes). Zero cost beyond ~1.5 m.
    vec4 pw4 = vec4(transformed, 1.0);
    mat3 toW = mat3(modelMatrix);
    #ifdef USE_INSTANCING
      pw4 = instanceMatrix * pw4;
      toW = toW * mat3(instanceMatrix);
    #endif
    pw4 = modelMatrix * pw4;
    vec2 d1 = pw4.xz - uPlayerPos.xz;
    vec2 d2 = pw4.xz - uPlayerTrail.xz;
    float l1 = length(d1);
    float l2 = length(d2);
    float near = step(abs(pw4.y - uPlayerPos.y - 0.5), 2.2);
    float f1 = (1.0 - smoothstep(0.15, 1.35, l1)) * near;
    float f2 = (1.0 - smoothstep(0.1, 1.0, l2)) * near * 0.55;
    if (f1 + f2 > 0.001) {
      float hw = clamp(position.y / uSwayHeight, 0.0, 1.0);
      vec2 pushW = (d1 / max(l1, 0.08)) * f1 + (d2 / max(l2, 0.08)) * f2;
      vec3 pw = vec3(pushW.x, 0.0, pushW.y) * uPush * (0.25 + hw);
      vec3 pl = inverse(toW) * pw;
      transformed += pl;
      transformed.y -= length(pw) * 0.35 * hw;
    }
  }
`;

function patchWind(shader: Shader, o: FoliageOptions) {
  shader.uniforms.uTime = globalUniforms.uTime;
  shader.uniforms.uWindDir = globalUniforms.uWindDir;
  shader.uniforms.uWindStrength = globalUniforms.uWindStrength;
  shader.uniforms.uSwayHeight = { value: o.swayHeight };
  shader.uniforms.uSwayAmount = { value: o.swayAmount };
  shader.uniforms.uPlayerPos = globalUniforms.uPlayerPos;
  shader.uniforms.uPlayerTrail = globalUniforms.uPlayerTrail;
  shader.uniforms.uPush = { value: o.push ?? 0 };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_VERT_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT}`);
}

export function createFoliageMaterial(o: FoliageOptions): { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const m = new THREE.MeshStandardMaterial({
    map: o.map,
    color: o.color ?? 0xffffff,
    alphaTest: o.alphaTest ?? 0.5,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
    alphaToCoverage: o.alphaToCoverage ?? false,
  });
  const trans = { value: o.translucency ?? 0.35 };
  m.onBeforeCompile = (shader: Shader) => {
    injectFogUniforms(shader);
    patchWind(shader, o);
    shader.uniforms.uTranslucency = trans;
    shader.uniforms.uSunDirWorld = globalUniforms.uSunDirWorld;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTranslucency;\nuniform vec3 uSunDirWorld;\nuniform vec3 uSunColor;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Cheap translucency: leaves glow when the sun is behind them relative to the viewer.
          vec3 vDirW = normalize(transpose(mat3(viewMatrix)) * -vViewPosition);
          float back = pow(max(dot(vDirW, uSunDirWorld), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (0.08 + back * 0.9) * uTranslucency;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'foliage';

  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: o.map,
    alphaTest: o.alphaTest ?? 0.5,
    side: THREE.DoubleSide,
  });
  depth.onBeforeCompile = (shader: Shader) => patchWind(shader, o);
  depth.customProgramCacheKey = () => 'foliage-depth';
  return { material: m, depth };
}

/** Standard PBR material for props (wood, canvas, metal) with fog uniforms wired. */
export function createPropMaterial(set: PBRSet, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap ?? null,
    roughness: 0.85,
    metalness: 0,
    ...params,
  });
}

// ---------------------------------------------------------------- water

export function createWaterMaterial(normal: THREE.Texture, env: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x10262a),
    roughness: 0.07,
    metalness: 0.0,
    transparent: true,
    opacity: 0.88,
    normalMap: normal,
    envMap: env,
    envMapIntensity: 0.7,
    depthWrite: false,
  });
  m.normalScale.setScalar(0.55);
  m.onBeforeCompile = (shader: Shader) => {
    injectFogUniforms(shader);
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWUv;\nvarying vec3 vWPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWUv = uv;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWUv;\nvarying vec3 vWPos;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          vec2 flow = vec2(uTime * 0.09, 0.0);
          vec3 n1 = texture2D(normalMap, vec2(vWUv.x * 0.18, vWUv.y * 1.2) + flow).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vWPos.xz * 0.11 + vec2(-uTime * 0.021, uTime * 0.017)).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z));
          vec3 wn = normalize(vec3(n.x, n.z, n.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float edge = abs(vWUv.y * 2.0 - 1.0);
          float foamN = texture2D(normalMap, vec2(vWUv.x * 0.5 - uTime * 0.12, vWUv.y * 3.0)).x;
          float foam = smoothstep(0.78, 1.0, edge + foamN * 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.7, 0.66), foam * 0.55);
          diffuseColor.a = mix(diffuseColor.a, 1.0, foam * 0.5);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}

// ---------------------------------------------------------------- waterfall (custom shader, fogged)

export function createWaterfallMaterial(streaks: THREE.Texture, speed = 1.6, opacity = 0.85): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uStreak: { value: streaks }, uSpeed: { value: speed }, uOpacity: { value: opacity }, uSunDir: { value: new THREE.Vector3(0, 0.2, 1) } },
    ]) as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWPos;
      varying vec3 vWNormal;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWPos = w.xyz;
        vWNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uStreak;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uOpacity;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vWPos;
      varying vec3 vWNormal;
      void main() {
        float t = uTime * uSpeed;
        // Three layered sheets scrolling downward at different rates/scales.
        float a1 = texture2D(uStreak, vec2(vUv.x * 2.0, vUv.y * 0.9 + t)).r;
        float a2 = texture2D(uStreak, vec2(vUv.x * 3.3 + 0.37, vUv.y * 1.4 + t * 1.45)).r;
        float a3 = texture2D(uStreak, vec2(vUv.x * 5.1 + 0.71, vUv.y * 2.3 + t * 2.1)).r;
        float streak = a1 * 0.5 + a2 * 0.4 + a3 * 0.3;
        // Alpha breakup: gaps between the ropes of water.
        float breakup = smoothstep(0.22, 0.62, a1 * 0.7 + a3 * 0.5);
        float edgeX = min(vUv.x, 1.0 - vUv.x);
        float edge = smoothstep(0.0, 0.16, edgeX);
        float top = smoothstep(1.0, 0.95, vUv.y);
        float bottom = smoothstep(0.0, 0.14, vUv.y);
        float foam = smoothstep(0.2, 0.0, edgeX) * 0.6 + smoothstep(0.86, 1.0, vUv.y) * 0.9 + (1.0 - bottom) * 0.9;
        foam = clamp(foam * (0.6 + a2 * 0.8), 0.0, 1.0);
        // Darker translucent core, bright aerated streaks + foam.
        vec3 core = vec3(0.16, 0.24, 0.25);
        vec3 aerated = vec3(0.8, 0.86, 0.85);
        vec3 col = mix(core, aerated, clamp(streak * 1.1, 0.0, 1.0));
        col = mix(col, vec3(0.95, 0.97, 0.96), foam);
        // Specular-ish sparkle: view vs reflected sun, plus fresnel rim.
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 N = normalize(vWNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float fres = pow(1.0 - abs(dot(V, N)), 3.0);
        vec3 R = reflect(-normalize(uSunDir), N);
        float spec = pow(max(dot(R, V), 0.0), 24.0) * a3;
        col += vec3(1.0, 0.85, 0.65) * (spec * 0.8 + fres * 0.15 * streak);
        float alpha = clamp((streak * 0.8 + 0.25) * mix(0.55, 1.0, breakup) + foam * 0.4, 0.0, 1.0) * edge * top;
        alpha *= mix(0.55, 1.0, bottom);
        gl_FragColor = vec4(col, alpha * uOpacity);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  m.uniforms.uTime = globalUniforms.uTime;
  m.uniforms.uSunDir = globalUniforms.uSunDirWorld;
  return m;
}

/** Keep ShaderMaterials that use uTime in sync with the global clock. */
export function bindTime(m: THREE.ShaderMaterial): void {
  m.uniforms.uTime = globalUniforms.uTime;
  Object.assign(m.uniforms, fogUniforms);
}
