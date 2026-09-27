import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { QualitySettings } from '../systems/Quality';

/**
 * Renders the scene once into an HDR target with a depth texture, which is then reused by
 * AO (GTAO, depth-reconstructed normals — no second scene render) and cinematic DOF.
 */
class SceneRenderPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    samples: number,
  ) {
    super();
    this.needsSwap = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }

  setSamples(n: number): void {
    if (this.target.samples !== n) {
      this.target.samples = n;
      this.target.dispose();
    }
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copyMat.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
  }

  dispose(): void {
    this.target.dispose();
    this.copyMat.dispose();
    this.copy.dispose();
  }
}

const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: 8 },
    uAperture: { value: 0.6 },
    uMaxBlur: { value: 6 },
    uAmount: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uAmount; uniform vec2 uResolution;
    varying vec2 vUv;
    float linDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(d, uNear, uFar);
    }
    float coc(float z) { return clamp(abs(z - uFocus) / max(z, 0.001) * uAperture * 4.0, 0.0, 1.0) * uMaxBlur * uAmount; }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uAmount < 0.001) { gl_FragColor = base; return; }
      float z = linDepth(vUv);
      float c = coc(z);
      vec3 acc = base.rgb; float wsum = 1.0;
      const float GA = 2.39996323;
      for (int i = 1; i < 24; i++) {
        float fi = float(i);
        float r = sqrt(fi / 24.0) * c;
        vec2 off = vec2(cos(fi * GA), sin(fi * GA)) * r / uResolution;
        vec2 suv = vUv + off;
        float sz = linDepth(suv);
        // Prevent sharp foreground from bleeding into blurred background and vice versa.
        float sc = coc(sz);
        float w = sz < z ? clamp(sc / max(c, 0.001), 0.0, 1.0) : 1.0;
        acc += texture2D(tDiffuse, suv).rgb * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uLetterbox: { value: 0 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uPause: { value: 0 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.12 },
    uLift: { value: new THREE.Vector3(0.004, 0.01, 0.014) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    uFlash: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform float uTime, uVignette, uGrain, uLetterbox, uFade, uPause, uSaturation, uContrast, uFlash;
    uniform vec3 uFadeColor, uLift, uGain;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uPause > 0.001) {
        vec2 px = (2.0 + uPause * 3.0) / uResolution;
        vec3 b = vec3(0.0);
        for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) b += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * px).rgb;
        c = mix(c, b / 25.0, uPause);
        c *= 1.0 - 0.5 * uPause;
      }
      c = uGain * (c + uLift * (1.0 - c));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c += vec3(-0.012, 0.004, 0.02) * (1.0 - l) + vec3(0.02, 0.008, -0.018) * l;
      vec2 d = uv - 0.5; d.x *= uResolution.x / uResolution.y;
      float v = smoothstep(1.05, 0.28, length(d));
      c *= mix(1.0, v, uVignette);
      float n = fract(sin(dot(floor(uv * uResolution) + fract(uTime * 7.13) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;
      c += vec3(uFlash);
      float bar = uLetterbox * 0.11;
      if (uv.y < bar || uv.y > 1.0 - bar) c = vec3(0.0);
      c = mix(c, uFadeColor, uFade);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private scenePass: SceneRenderPass;
  private gtao: GTAOPass;
  private dof: ShaderPass;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  readonly grade: ShaderPass;
  private smaa: SMAAPass;
  private fxaa: FXAAPass;
  private width = 1;
  private height = 1;

  /** Cinematic depth-of-field target (0..1 blend). Set by the cinematic director. */
  dofAmount = 0;
  dofFocus = 8;
  dofAllowed = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new SceneRenderPass(scene, camera, 0);
    // Reuse the scene depth (normals reconstructed from depth) — no second scene render.
    // (Construct with defaults first: GTAOPass.setGBuffer reads its internal target.)
    this.gtao = new GTAOPass(scene, camera, 1, 1);
    this.gtao.setGBuffer(this.scenePass.target.depthTexture!);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.dof = new ShaderPass(DofShader);
    this.dof.uniforms.tDepth.value = this.scenePass.target.depthTexture;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.88);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.dof);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);
  }

  applyQuality(q: QualitySettings): void {
    this.gtao.enabled = q.ao;
    this.bloom.enabled = q.bloom;
    this.dofAllowed = q.dof;
    this.smaa.enabled = q.antialias === 'smaa';
    this.fxaa.enabled = q.antialias === 'fxaa';
    this.scenePass.setSamples(q.antialias === 'msaa' ? q.msaaSamples : 0);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.width = Math.floor(w * pixelRatio);
    this.height = Math.floor(h * pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.scenePass.setSize(this.width, this.height);
    this.gtao.setSize(this.width, this.height);
    this.bloom.setSize(Math.floor(this.width / 2), Math.floor(this.height / 2));
    this.grade.uniforms.uResolution.value.set(this.width, this.height);
    this.dof.uniforms.uResolution.value.set(this.width, this.height);
  }

  render(realDt: number, time: number): void {
    const dofOn = this.dofAllowed && this.dofAmount > 0.01;
    this.dof.enabled = dofOn;
    if (dofOn) {
      const u = this.dof.uniforms;
      u.uNear.value = this.camera.near;
      u.uFar.value = this.camera.far;
      u.uFocus.value = this.dofFocus;
      u.uAmount.value = this.dofAmount;
    }
    this.grade.uniforms.uTime.value = time;
    this.composer.render(realDt);
  }

  get gradeUniforms() {
    return this.grade.uniforms as typeof GradeShader.uniforms;
  }

  dispose(): void {
    this.composer.dispose();
    this.scenePass.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
  }
}
