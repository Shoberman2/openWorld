// Screen-space reflections: wet streets mirror the lit windows and headlights, glass towers mirror the
// buildings across the avenue, water mirrors the shore. Materials mark what reflects in the alpha
// channel of the HDR color buffer (alpha = 1 - mask; everything else writes 1, so it costs nothing):
//   mask 0..0.45    a wet, water-like surface (weak head-on, mirror-like at grazing angles), rippled;
//   mask 0.5        polished stone and window glass (the same, but flat);
//   mask 0.6..1     curtain-wall glass and polished metal (stronger head-on, flat).
// The pass marches the reflected ray through the depth buffer at half resolution and stores the color
// it lands on, with how much to trust it; the atmosphere composite blends it in. Rays that leave the
// screen keep the material's own (environment-map) reflection.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `varying vec2 vUv0; void main() { vUv0 = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** GLSL: write the reflection mask into alpha. Paste after <opaque_fragment>; `expr` is the mask (0..1). */
export const reflectOut = (expr: string) => /* glsl */ `gl_FragColor.a = 1.0 - clamp(${expr}, 0.0, 1.0);`;

const FRAG = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform mat4 uProj, uProjInv, uCamWorld;
  uniform vec2 uTexel;
  uniform float uNear, uTime, uRain;
  varying vec2 vUv0;
  vec3 viewPos(vec2 uv, float d) {
    vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    // Snapped to a depth texel's center: this buffer's pixels sit on the corners between four of them,
    // and nearest-neighbor depth there would flip between rows.
    vec2 vUv = (floor(vUv0 / uTexel) + 0.5) * uTexel;
    vec4 src = texture2D(tColor, vUv);
    float m = 1.0 - src.a;
    float d0 = texture2D(tDepth, vUv).x;
    if (m < 0.02 || d0 >= 0.99999) { gl_FragColor = vec4(0.0); return; }
    vec3 P = viewPos(vUv, d0);
    // The surface normal from the depth buffer: of each pair of neighbors, the one on the same surface.
    vec3 Pl = viewPos(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x);
    vec3 Pr = viewPos(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x);
    vec3 Pd = viewPos(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x);
    vec3 Pu = viewPos(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x);
    vec3 dx = abs(Pl.z - P.z) < abs(Pr.z - P.z) ? P - Pl : Pr - P;
    vec3 dy = abs(Pd.z - P.z) < abs(Pu.z - P.z) ? P - Pd : Pu - P;
    vec3 N = normalize(cross(dx, dy));
    float dist = -P.z;
    float glass = smoothstep(0.55, 0.65, m);
    if (m < 0.47) {
      // Water on the ground is never glass-flat: a slow swell and fine ripples (rain stipples it) break
      // the mirror up, more so up close; far away it averages back to flat.
      vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
      vec2 q = W.xz;
      float t = uTime;
      vec2 g = vec2(vn(q * 0.9 + vec2(t * 0.11, 0.0)) - vn(q * 0.9 + vec2(0.37, t * 0.09)),
                    vn(q * 0.9 + vec2(5.2, t * 0.1)) - vn(q * 0.9 + vec2(1.7, 9.1 - t * 0.08)));
      vec2 g2 = vec2(vn(q * 7.0 + t * 1.3) - 0.5, vn(q * 7.0 + 19.0 - t * 1.1) - 0.5);
      float fade = 1.0 / (1.0 + dist * 0.02);
      vec3 wn = vec3(g.x * 0.035 + g2.x * (0.02 + 0.05 * uRain), 0.0, g.y * 0.035 + g2.y * (0.02 + 0.05 * uRain)) * fade;
      vec3 up = normalize((transpose(uCamWorld) * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      // Only on surfaces lying flat (streets, water), not a wet wall.
      float flatK = smoothstep(0.7, 0.95, dot(N, up));
      N = normalize(N + mat3(transpose(uCamWorld)) * wn * flatK);
    }
    vec3 V = normalize(P);
    float ndv = max(dot(-V, N), 0.0);
    vec3 R = reflect(V, N);
    // Schlick: water and wet stone barely reflect head-on; glass a good deal more.
    float f0 = mix(0.035, 0.42, glass);
    float fres = f0 + (1.0 - f0) * pow(1.0 - ndv, mix(4.0, 5.0, glass));
    float strength = fres * (glass > 0.5 ? smoothstep(0.55, 1.0, m) * 0.6 + 0.4 : smoothstep(0.0, 0.45, m));
    // Rays coming back at the camera have nothing on screen to land on.
    strength *= 1.0 - smoothstep(0.1, 0.45, R.z);
    if (strength < 0.01) { gl_FragColor = vec4(0.0); return; }

    float stepLen = max(0.06, dist * 0.01);
    float t = stepLen * (0.35 + ign(gl_FragCoord.xy));
    float prevT = 0.0;
    float hit = 0.0;
    vec2 hitUv = vec2(0.0);
    for (int i = 0; i < 40; i++) {
      vec3 Q = P + R * t;
      if (Q.z > -uNear) break;
      vec4 c = uProj * vec4(Q, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sd = texture2D(tDepth, uv).x;
      float sz = viewPos(uv, sd).z;
      float diff = sz - Q.z; // > 0: the ray has gone behind what's drawn there
      if (diff > 0.0 && sd < 0.99999) {
        float thick = stepLen * 1.6 + 0.25 + (-Q.z) * 0.02;
        if (diff < thick) {
          // Close in on the crossing.
          float a = prevT, b = t;
          for (int k = 0; k < 5; k++) {
            float mid = (a + b) * 0.5;
            vec3 Qm = P + R * mid;
            vec4 cm = uProj * vec4(Qm, 1.0);
            vec2 um = cm.xy / cm.w * 0.5 + 0.5;
            float zm = viewPos(um, texture2D(tDepth, um).x).z;
            if (zm - Qm.z > 0.0) b = mid; else a = mid;
          }
          vec3 Qh = P + R * b;
          vec4 ch = uProj * vec4(Qh, 1.0);
          hitUv = ch.xy / ch.w * 0.5 + 0.5;
          hit = 1.0;
          break;
        }
        // Passed behind something thin or in front: keep going, more carefully.
      }
      prevT = t;
      stepLen *= 1.16;
      t += stepLen;
    }
    if (hit < 0.5) { gl_FragColor = vec4(0.0); return; }
    // Fade toward the screen edges, where the next frame may have nothing to reflect.
    vec2 e = smoothstep(vec2(0.0), vec2(0.07), hitUv) * (1.0 - smoothstep(vec2(0.93), vec2(1.0), hitUv));
    float conf = e.x * e.y * strength;
    vec3 rc = min(texture2D(tColor, hitUv).rgb, vec3(6.0));
    gl_FragColor = vec4(rc, conf);
  }`;

export class Reflections {
  /** Half-resolution reflected color (rgb) and how much of it to blend in (a). */
  readonly rt: THREE.WebGLRenderTarget;
  /** Rain intensity 0..1 (stipples the puddles). */
  rain = 0;
  private mat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.25 }, uTime: { value: 0 }, uRain: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.quad.material = this.mat;
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  render(renderer: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, cam: THREE.PerspectiveCamera, time: number) {
    const u = this.mat.uniforms;
    u.tColor.value = color; u.tDepth.value = depth;
    u.uProj.value.copy(cam.projectionMatrix); u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uCamWorld.value.copy(cam.matrixWorld);
    u.uNear.value = cam.near; u.uTime.value = time; u.uRain.value = this.rain;
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
  }

  dispose() { this.rt.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
