import * as THREE from 'three';
import { globalUniforms } from './HeightFog';

export interface SkyParams {
  sunDir: THREE.Vector3;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunHorizon: THREE.Color;
  sunColor: THREE.Color;
  ground: THREE.Color;
  cloudCover: number;
  sunIntensity: number;
}

/** Procedural dusk sky: gradient, sun disc + halo, drifting cloud layer. Follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(p: SkyParams) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: p.sunDir.clone().normalize() },
        uZenith: { value: p.zenith.clone() },
        uHorizon: { value: p.horizon.clone() },
        uSunHorizon: { value: p.sunHorizon.clone() },
        uSunColor: { value: p.sunColor.clone() },
        uGround: { value: p.ground.clone() },
        uCloud: { value: p.cloudCover },
        uSunIntensity: { value: p.sunIntensity },
        uTime: globalUniforms.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uZenith, uHorizon, uSunHorizon, uSunColor, uGround;
        uniform float uCloud, uSunIntensity, uTime;
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float sunDot = max(dot(d, uSunDir), 0.0);
          float el = d.y;
          float sunSide = pow(sunDot, 3.0);
          vec3 hor = mix(uHorizon, uSunHorizon, sunSide);
          float t = pow(clamp(el, 0.0, 1.0), 0.45);
          vec3 col = mix(hor, uZenith, t);
          col = mix(col, uGround, smoothstep(0.0, -0.12, el));
          // Sun halo + disc
          col += uSunColor * pow(sunDot, 12.0) * 0.6;
          col += uSunColor * pow(sunDot, 180.0) * 2.5;
          col += uSunColor * smoothstep(0.99955, 0.99975, sunDot) * uSunIntensity;
          // Clouds on a virtual plane
          if (el > 0.0) {
            vec2 uv = d.xz / (el + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
            float c = fbm(uv * 1.3);
            float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.35, c);
            float lit = pow(sunDot, 4.0);
            vec3 cloudCol = mix(uHorizon * 0.85 + vec3(0.03), uSunHorizon * 1.35, lit * 0.9 + 0.1);
            cloudCol = mix(cloudCol, uZenith * 1.1, smoothstep(0.2, 0.8, el) * 0.4);
            col = mix(col, cloudCol, cov * smoothstep(0.0, 0.12, el) * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  follow(cam: THREE.Camera): void {
    this.mesh.position.copy(cam.position);
  }

  /** Bake the sky into a PMREM environment map for PBR reflections/ambient. */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pm = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    const m = new THREE.Mesh(this.mesh.geometry, this.material);
    m.scale.setScalar(100);
    scene.add(m);
    const rt = pm.fromScene(scene, 0.02, 0.1, 500);
    pm.dispose();
    return rt.texture;
  }
}
