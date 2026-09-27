import * as THREE from 'three';
import { PostFX } from './PostFX';
import type { QualitySettings } from '../systems/Quality';
import { installHeightFog } from './HeightFog';
import { isPhone, isTouchPrimary } from '../systems/Device';

/** Owns the WebGL renderer, main camera, scene and the post-processing stack. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly post: PostFX;
  private quality!: QualitySettings;
  private pixelBudget = 2.2e6;

  constructor(readonly canvas: HTMLCanvasElement) {
    installHeightFog();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x0b0d0c, 1);
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2500);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    window.addEventListener('resize', () => this.resize());
    // iOS reports stale sizes on the orientationchange event itself.
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  applyQuality(q: QualitySettings): void {
    this.quality = q;
    this.pixelBudget = q.preset === 'low' ? 1.3e6 : q.preset === 'medium' ? 2.3e6 : 3.8e6;
    // Mobile GPUs are fill-rate bound: keep far fewer pixels than desktop at the same preset.
    if (isTouchPrimary) this.pixelBudget *= isPhone() ? 0.55 : 0.75;
    this.renderer.shadowMap.enabled = q.shadows;
    this.post.applyQuality(q);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cap = this.quality?.pixelRatioCap ?? 1.5;
    let pr = Math.min(window.devicePixelRatio || 1, cap) * (this.quality?.renderScale ?? 1);
    // Keep total pixel count within the preset's budget (e.g. retina at 1440x900 on HIGH).
    const px = w * h * pr * pr;
    if (px > this.pixelBudget) pr *= Math.sqrt(this.pixelBudget / px);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
  }

  render(realDt: number, time: number): void {
    this.renderer.info.reset();
    // Narrow/portrait screens: widen the vertical FOV so the horizontal view doesn't collapse.
    // Desktop aspects (>= 1.3) are untouched.
    const cam = this.camera;
    const fov = cam.fov;
    if (cam.aspect < 1.3) {
      const k = Math.pow(1.3 / cam.aspect, 0.6);
      const t = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * k;
      cam.fov = Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(t)));
      cam.updateProjectionMatrix();
    }
    this.post.render(realDt, time);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  get info() {
    return this.renderer.info;
  }
}
