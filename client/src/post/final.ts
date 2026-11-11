// The last step of the frame, in one pass over the screen instead of three: add the bloom, map the HDR
// image to the display (Khronos Neutral: colors come out as painted, only highlights roll off), then
// the camera-like grade: a gentle S-curve and a touch more color, a light sharpen, a soft vignette,
// and a pixel of dither so sky gradients don't band.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Bloom } from './bloom.ts';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse, tBloom;
  uniform float uBloom, uExposure, uSat, uContrast, uVignette, uSharpen;
  uniform vec2 uTexel;
  varying vec2 vUv;
  // Khronos PBR Neutral tone mapping.
  vec3 neutral(vec3 color) {
    const float startCompression = 0.8 - 0.04, desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }
  vec3 toSrgb(vec3 v) {
    v = clamp(v, 0.0, 1.0);
    return mix(pow(v, vec3(0.41666)) * 1.055 - 0.055, v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
  }
  vec3 display(vec3 hdr) { return toSrgb(neutral(hdr * uExposure)); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    vec3 hdr = src.rgb;
    if (uBloom > 0.0) hdr += texture2D(tBloom, vUv).rgb * uBloom;
    vec3 c = display(hdr);
    if (uSharpen > 0.0) {
      // Restore the texture detail multisampling softens (measured on the displayed image, without the glow).
      vec3 n = display(texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb) + display(texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb)
             + display(texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb) + display(texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb);
      vec3 d = display(src.rgb) - n * 0.25;
      c += clamp(d, -0.06, 0.06) * uSharpen * 4.0;
    }
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    // S-curve around mid grey: richer shadows and highlights without crushing either.
    vec3 x = clamp(c, 0.0, 1.0);
    vec3 s = x * x * (3.0 - 2.0 * x);
    c = mix(x, s, (uContrast - 1.0) * 2.0);
    vec2 dv = vUv - 0.5;
    c *= 1.0 - uVignette * smoothstep(0.25, 0.75, dot(dv, dv) * 2.0);
    c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

export class FinalPass extends Pass {
  /** Grade controls (same names the old grade pass used). */
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null }, tBloom: { value: null as THREE.Texture | null },
    uBloom: { value: 0 }, uExposure: { value: 1 },
    uSat: { value: 1.07 }, uContrast: { value: 1.06 }, uVignette: { value: 0.12 }, uSharpen: { value: 0.22 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  };
  private mat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);

  constructor(private bloom: Bloom) {
    super();
    this.black.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.quad.material = this.mat;
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const u = this.uniforms, on = this.bloom.active;
    u.tDiffuse.value = read.texture;
    u.tBloom.value = on ? this.bloom.texture : this.black;
    // Spread over six levels, the glow sums to several times the bright pass: scaled back to match.
    u.uBloom.value = on ? this.bloom.strength * 0.55 : 0;
    u.uExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }

  dispose() { this.mat.dispose(); this.quad.dispose(); this.black.dispose(); }
}
