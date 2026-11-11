// Bloom, the cheap way: the bright parts of the frame are pulled out at half resolution, shrunk down
// a chain of ever smaller buffers and blurred back up through it (dual filtering). A handful of tiny
// passes instead of ten full-size blurs, so it can stay on all day: sun glints off glass and chrome by
// day, lamps, signs, headlights and lit windows glowing at night. The final pass adds the result in.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */ `
  uniform sampler2D tIn; uniform vec2 uTexel; uniform float uThreshold, uKnee;
  varying vec2 vUv;
  void main() {
    // Four taps, each weighted down by its own brightness, so one searing pixel (a sun glint) can't
    // flicker the whole glow as it crawls across the screen.
    vec3 sum = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i < 2 ? -1.0 : 1.0, mod(float(i), 2.0) < 0.5 ? -1.0 : 1.0) * uTexel;
      vec3 c = min(texture2D(tIn, vUv + o).rgb, vec3(8.0));
      float w = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
      sum += c * w; ws += w;
    }
    vec3 c = sum / ws;
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    gl_FragColor = vec4(c * max(soft, br - uThreshold) / max(br, 1e-4), 1.0);
  }`;

const DOWN = /* glsl */ `
  uniform sampler2D tIn; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tIn, vUv).rgb * 4.0;
    c += texture2D(tIn, vUv + uTexel).rgb + texture2D(tIn, vUv - uTexel).rgb;
    c += texture2D(tIn, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tIn, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
    gl_FragColor = vec4(c / 8.0, 1.0);
  }`;

const UP = /* glsl */ `
  uniform sampler2D tIn, tAdd; uniform vec2 uTexel; uniform float uSpread;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel;
    vec3 c = texture2D(tIn, vUv + vec2(-t.x * 2.0, 0.0)).rgb + texture2D(tIn, vUv + vec2(t.x * 2.0, 0.0)).rgb
           + texture2D(tIn, vUv + vec2(0.0, -t.y * 2.0)).rgb + texture2D(tIn, vUv + vec2(0.0, t.y * 2.0)).rgb;
    c += (texture2D(tIn, vUv + vec2(-t.x, t.y)).rgb + texture2D(tIn, vUv + t).rgb
        + texture2D(tIn, vUv + vec2(t.x, -t.y)).rgb + texture2D(tIn, vUv - t).rgb) * 2.0;
    // The wider (smaller) levels count for a little less each: a tight core with a soft, wide skirt.
    gl_FragColor = vec4(texture2D(tAdd, vUv).rgb + c / 12.0 * uSpread, 1.0);
  }`;

const LEVELS = 6;

export class Bloom extends Pass {
  /** How much glow the final pass adds (0 off). */
  strength = 0.1;
  /** Linear brightness where things start to glow. */
  threshold = 0.95;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private pre: THREE.ShaderMaterial;
  private dn: THREE.ShaderMaterial;
  private upm: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();

  constructor() {
    super();
    this.needsSwap = false;
    const o = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    for (let i = 0; i < LEVELS; i++) {
      this.down.push(new THREE.WebGLRenderTarget(1, 1, o));
      if (i < LEVELS - 1) this.up.push(new THREE.WebGLRenderTarget(1, 1, o));
    }
    for (const t of [...this.down, ...this.up]) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false });
    this.pre = mk(PREFILTER, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.95 }, uKnee: { value: 0.35 } });
    this.dn = mk(DOWN, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upm = mk(UP, { tIn: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 0.85 } });
  }

  /** The glow (half resolution, linear), to add to the frame. */
  get texture() { return this.up[0].texture; }
  get active() { return this.enabled && this.strength > 0.015; }

  setSize(w: number, h: number) {
    let cw = Math.max(1, Math.ceil(w / 2)), ch = Math.max(1, Math.ceil(h / 2));
    for (let i = 0; i < LEVELS; i++) {
      this.down[i].setSize(cw, ch);
      if (i < LEVELS - 1) this.up[i].setSize(cw, ch);
      cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2));
    }
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.active) return;
    const draw = (m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget) => { this.quad.material = m; renderer.setRenderTarget(to); this.quad.render(renderer); };
    const pu = this.pre.uniforms;
    pu.tIn.value = read.texture;
    (pu.uTexel.value as THREE.Vector2).set(0.5 / this.down[0].width, 0.5 / this.down[0].height);
    pu.uThreshold.value = this.threshold;
    draw(this.pre, this.down[0]);
    for (let i = 1; i < LEVELS; i++) {
      this.dn.uniforms.tIn.value = this.down[i - 1].texture;
      (this.dn.uniforms.uTexel.value as THREE.Vector2).set(0.5 / this.down[i].width, 0.5 / this.down[i].height);
      draw(this.dn, this.down[i]);
    }
    let src = this.down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      const u = this.upm.uniforms;
      u.tIn.value = src.texture; u.tAdd.value = this.down[i].texture;
      (u.uTexel.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
      draw(this.upm, this.up[i]);
      src = this.up[i];
    }
  }

  dispose() {
    for (const t of [...this.down, ...this.up]) t.dispose();
    for (const m of [this.pre, this.dn, this.upm]) m.dispose();
    this.quad.dispose();
  }
}
