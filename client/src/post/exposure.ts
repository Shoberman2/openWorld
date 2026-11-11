// Eye adaptation: the camera's exposure follows what you're looking at, as an eye or a phone camera
// does. Walk into a shaded street canyon and it opens up (the sunlit towers beyond glow); fly out over
// bright water and it stops down. Entirely on the GPU: the frame's log-average brightness is measured
// into a tiny buffer, and a 1x1 texture eases toward it over about a second. The composite reads that
// one texel.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MEASURE = /* glsl */ `
  uniform sampler2D tColor; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    // Four taps per cell of the small buffer, so thin bright things aren't skipped over.
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i < 2 ? -1.0 : 1.0, mod(float(i), 2.0) < 0.5 ? -1.0 : 1.0) * uTexel;
      vec3 c = min(texture2D(tColor, vUv + o).rgb, vec3(4.0));
      s += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    }
    gl_FragColor = vec4(s * 0.25, 0.0, 0.0, 1.0);
  }`;

const ADAPT = /* glsl */ `
  uniform sampler2D tLum, tPrev; uniform float uRate, uFirst;
  void main() {
    // Center-weighted average of the measured buffer (what you're looking at counts for more).
    float s = 0.0, w = 0.0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 12; i++) {
      vec2 uv = (vec2(float(i), float(j)) + 0.5) / vec2(12.0, 8.0);
      vec2 d = uv - 0.5;
      float k = 1.0 - 0.6 * smoothstep(0.1, 0.5, length(d));
      s += texture2D(tLum, uv).r * k; w += k;
    }
    float target = s / w;
    float prev = texture2D(tPrev, vec2(0.5)).r;
    gl_FragColor = vec4(mix(mix(prev, target, uRate), target, uFirst), 0.0, 0.0, 1.0);
  }`;

export class AutoExposure {
  /** Middle grey the meter aims for. */
  key = 0.2;
  /** How far the exposure may move from 1 (as multipliers). */
  min = 0.72;
  max = 1.7;
  private lum: THREE.WebGLRenderTarget;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private measure: THREE.ShaderMaterial;
  private adapt: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private first = true;
  private last = 0;

  constructor() {
    const o = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.lum = new THREE.WebGLRenderTarget(48, 27, o);
    this.lum.texture.minFilter = this.lum.texture.magFilter = THREE.LinearFilter;
    this.a = new THREE.WebGLRenderTarget(1, 1, o);
    this.b = new THREE.WebGLRenderTarget(1, 1, o);
    this.measure = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2(1 / 192, 1 / 108) } }, vertexShader: VERT, fragmentShader: MEASURE, depthTest: false, depthWrite: false });
    this.adapt = new THREE.ShaderMaterial({ uniforms: { tLum: { value: this.lum.texture }, tPrev: { value: null }, uRate: { value: 0.05 }, uFirst: { value: 1 } }, vertexShader: VERT, fragmentShader: ADAPT, depthTest: false, depthWrite: false });
  }

  /** The adapted log-luminance (1x1). */
  get texture() { return this.a.texture; }

  /** Jump straight to the next measurement (a scene change: going indoors, a teleport). */
  reset() { this.first = true; }

  render(renderer: THREE.WebGLRenderer, color: THREE.Texture) {
    const now = performance.now();
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.measure.uniforms.tColor.value = color;
    this.quad.material = this.measure;
    renderer.setRenderTarget(this.lum);
    this.quad.render(renderer);
    const u = this.adapt.uniforms;
    u.tPrev.value = this.a.texture;
    // Eyes adjust in about a second.
    u.uRate.value = 1 - Math.exp(-dt * 1.6);
    u.uFirst.value = this.first ? 1 : 0;
    this.first = false;
    this.quad.material = this.adapt;
    renderer.setRenderTarget(this.b);
    this.quad.render(renderer);
    const t = this.a; this.a = this.b; this.b = t;
  }

  dispose() { for (const t of [this.lum, this.a, this.b]) t.dispose(); this.measure.dispose(); this.adapt.dispose(); this.quad.dispose(); }
}
