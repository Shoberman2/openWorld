// Volumetric clouds: a real layer of cumulus a kilometer up, ray-marched through 3D noise at quarter
// resolution. They have depth and shape from every angle (walk under them, fly up through them, look
// down on their tops from the shuttle), the sun lights their near side and shades their far side, and
// the weather's cloud cover thickens them from scattered fair-weather heaps to a solid grey deck.
//
// Colors come from the same painted palette as the sky (lit / shade / haze), so they sit in it the way
// the old sprite clouds did. The atmosphere composite lays the result over the sky and anything beyond.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const N = 64;

/** Tileable 3D noise: R = billowy shape (value fbm cut by cell noise), G = finer cell noise for wisps. */
function buildNoise(onDone: (data: Uint8Array) => void) {
  const data = new Uint8Array(N * N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const lattice = (p: number) => { const a = new Float32Array(p * p * p); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const points = (p: number) => { const a = new Float32Array(p * p * p * 3); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const V = [lattice(4), lattice(8), lattice(16)];
  const W = [{ p: 4, f: points(4) }, { p: 8, f: points(8) }, { p: 16, f: points(16) }];
  const value = (L: Float32Array, p: number, x: number, y: number, z: number) => {
    const fx = x * p, fy = y * p, fz = z * p;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let tx = fx - ix, ty = fy - iy, tz = fz - iz;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
    const at = (i: number, j: number, k: number) => L[(((k % p) * p) + (j % p)) * p + (i % p)];
    const a = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * tx;
    const b = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * tx;
    const c = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * tx;
    const d = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * tx;
    return (a + (b - a) * ty) + ((c + (d - c) * ty) - (a + (b - a) * ty)) * tz;
  };
  /** 1 at a cell's feature point, falling to 0 a cell away (inverted Worley). */
  const cells = (w: { p: number; f: Float32Array }, x: number, y: number, z: number) => {
    const p = w.p, fx = x * p, fy = y * p, fz = z * p;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let best = 9;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, cz = iz + k;
      const q = ((((cz + p) % p) * p) + ((cy + p) % p)) * p + ((cx + p) % p);
      const dx = cx + w.f[q * 3] - fx, dy = cy + w.f[q * 3 + 1] - fy, dz = cz + w.f[q * 3 + 2] - fz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  };
  let z = 0;
  const slice = () => {
    const t0 = performance.now();
    // A few slices per turn, so building the texture never holds up a frame.
    while (z < N && performance.now() - t0 < 6) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
        const fbm = value(V[0], 4, u, v, w) * 0.55 + value(V[1], 8, u, v, w) * 0.3 + value(V[2], 16, u, v, w) * 0.15;
        const wl = cells(W[0], u, v, w) * 0.6 + cells(W[1], u, v, w) * 0.4;
        const shape = Math.min(1, Math.max(0, fbm * 0.55 + wl * 0.75 - 0.12));
        const detail = cells(W[1], u, v, w) * 0.5 + cells(W[2], u, v, w) * 0.5;
        const i = ((z * N + y) * N + x) * 4;
        data[i] = Math.round(shape * 255); data[i + 1] = Math.round(detail * 255); data[i + 2] = Math.round(fbm * 255); data[i + 3] = 255;
      }
      z++;
    }
    if (z < N) setTimeout(slice, 0); else onDone(data);
  };
  setTimeout(slice, 0);
}

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Shared with the composite: where a view ray enters and leaves the cloud layer. */
export const CLOUD_SLAB = /* glsl */ `
  uniform float uCloudBase, uCloudTop;
  /** Distances along the ray to the layer (x enter, y leave); x >= y when it misses. */
  vec2 cloudSpan(vec3 ro, vec3 rd) {
    float ry = abs(rd.y) < 1e-4 ? (rd.y < 0.0 ? -1e-4 : 1e-4) : rd.y;
    float a = (uCloudBase - ro.y) / ry, b = (uCloudTop - ro.y) / ry;
    return vec2(max(min(a, b), 0.0), max(a, b));
  }`;

const DENSITY = /* glsl */ `
  // How much cloud there is at p (0 none). The big picture comes from two slow sheets of the noise
  // (where the heaps are), a height profile gives each heap a flat base and a domed top, and 3D
  // noise carves the billows; fine wisps only where it's worth it (fine = true).
  float density(vec3 p, bool fine) {
    float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
    if (h <= 0.0 || h >= 1.0) return 0.0;
    vec2 w = p.xz + uWind;
    float c1 = texture(tNoise, vec3(w / 17000.0, 0.31)).b;
    float c2 = texture(tNoise, vec3(w / 7200.0 + 0.37, 0.71)).r;
    float field = c1 * 0.55 + c2 * 0.6;
    // Cover 0..1 slides the threshold: scattered heaps, then banks, then a solid deck.
    float thr = mix(0.92, 0.18, uCover);
    float m = smoothstep(thr, thr + 0.22, field);
    if (m <= 0.0) return 0.0;
    // Tall where the field is strong; overcast decks are flatter and fill the layer.
    float top = mix(0.3 + 0.7 * m * m, 0.85, smoothstep(0.75, 1.0, uCover));
    float prof = smoothstep(0.0, 0.09, h) * (1.0 - smoothstep(top * 0.4, top, h));
    float d = m * prof;
    vec3 q = vec3(w.x, p.y * 1.6, w.y) / 2500.0;
    float shape = texture(tNoise, q).r;
    d = clamp((d - (1.0 - shape) * 0.62) / 0.38, 0.0, 1.0);
    if (fine && d > 0.0) {
      float det = texture(tNoise, vec3(w.x, p.y, w.y) / 520.0 + vec3(0.0, uTime * 0.004, 0.0)).g;
      // Wispy at the edges and base, solid in the core.
      d = clamp((d - (1.0 - det) * 0.3 * (1.0 - d)) / (1.0 - 0.3 * (1.0 - d)), 0.0, 1.0);
    }
    return d;
  }`;

// The layer's shadow on the ground: how much sunlight gets down through the cloud above each spot, as a
// small top-down map around the camera (redrawn every few frames; clouds drift slowly).
const SHADOW = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D tNoise;
  uniform vec2 uWind, uCenter;
  uniform vec3 uDir;
  uniform float uCover, uTime, uExtent, uStorm;
  uniform float uCloudBase, uCloudTop;
  varying vec2 vUv;
  ${DENSITY}
  void main() {
    vec3 p = vec3(uCenter.x + (vUv.x - 0.5) * uExtent, uCloudBase + 1.0, uCenter.y + (vUv.y - 0.5) * uExtent);
    float len = (uCloudTop - uCloudBase) / uDir.y, st = len / 6.0, od = 0.0;
    p += uDir * st * 0.5;
    for (int i = 0; i < 6; i++) { od += density(p, false) * st; p += uDir * st; }
    float T = exp(-od * mix(0.011, 0.02, uStorm) * 0.5);
    gl_FragColor = vec4(T, T, T, 1.0);
  }`;

const FRAG = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D tNoise;
  uniform sampler2D tDepth, tPrev;
  uniform mat4 uProjInv, uCamWorld, uPrevVP;
  uniform float uHasPrev, uFrame;
  uniform vec2 uWind, uTexel;
  uniform vec3 uSunDir, uLit, uShade, uHaze;
  uniform float uCover, uHazeDist, uStorm, uTime;
  varying vec2 vUv;
  ${CLOUD_SLAB}
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  ${DENSITY}
  void main() {
    // The nearest depth of the block of pixels this one stands for (so a roofline keeps its edge).
    float dz = 1.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++)
      dz = min(dz, texture2D(tDepth, vUv + (vec2(float(i), float(j)) * 2.0 - 1.0) * uTexel).x);
    vec4 v = uProjInv * vec4(vec3(vUv, 0.5) * 2.0 - 1.0, 1.0);
    vec3 rdv = normalize(v.xyz / v.w);
    vec3 rd = normalize(mat3(uCamWorld) * rdv);
    vec3 ro = uCamWorld[3].xyz;
    vec2 span = cloudSpan(ro, rd);
    float tEnd = min(span.y, 42000.0);
    if (span.x >= tEnd) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    // Where this bit of sky was on screen last frame. Each frame marches from a different offset and
    // is blended into the running result, so the grain of a coarse march averages away.
    vec3 pw = ro + rd * clamp(span.x + 1500.0, 2500.0, 40000.0);
    vec4 pc = uPrevVP * vec4(pw, 1.0);
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    bool hist = uHasPrev > 0.5 && pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0;
    if (dz < 0.99999) {
      vec4 pv = uProjInv * vec4(vec3(vUv, dz) * 2.0 - 1.0, 1.0);
      float sd = length(pv.xyz / pv.w);
      // Behind a building: nothing to march, but carry the sky's clouds along for when it shows again.
      if (sd <= span.x) { gl_FragColor = hist ? texture2D(tPrev, puv) : vec4(0.0, 0.0, 0.0, 1.0); return; }
      tEnd = min(tEnd, sd);
    }

    float mu = dot(rd, uSunDir);
    // Forward scattering: a bright fringe when you look toward the sun through thin cloud.
    float fwd = pow(max(mu, 0.0), 8.0);
    float T = 1.0;
    vec3 C = vec3(0.0);
    float t = span.x;
    float stepLen = max(70.0, t * 0.04);
    t += stepLen * ign(gl_FragCoord.xy + uFrame * 5.588238);
    float sigma = mix(0.011, 0.02, uStorm);
    for (int i = 0; i < 30; i++) {
      if (t >= tEnd || T < 0.03) break;
      vec3 p = ro + rd * t;
      // Far cloud thins away to nothing instead of piling up into a wall along the horizon.
      float d = density(p, t < 12000.0) * (1.0 - smoothstep(9000.0, 30000.0, t));
      if (d > 0.002) {
        // Light reaching this point: a short march toward the sun through the cloud above it.
        float od = 0.0, ls = 70.0;
        vec3 lp = p;
        for (int k = 0; k < 3; k++) {
          lp += uSunDir * ls;
          od += density(lp, false) * ls;
          ls *= 2.3;
        }
        float h = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
        float sun = exp(-od * sigma * 0.55);
        // Thick cloud still glows a little from light scattered around inside it.
        sun = max(sun, exp(-od * sigma * 0.14) * 0.32);
        // Sunlit tops and flanks, shade in the folds and underneath, deeper under a storm.
        float amb = (0.45 + 0.55 * h) * (1.0 - uStorm * 0.45);
        vec3 col = uShade * amb + uLit * sun * (0.82 + fwd * 1.3);
        // Edges catch the light (thin cloud lets it through).
        col += uLit * fwd * (1.0 - d) * 0.5 * sun;
        // The air between here and there.
        float f = 1.0 - exp(-pow(t / uHazeDist, 1.6));
        col = mix(col, uHaze, clamp(f, 0.0, 1.0) * 0.6);
        float a = 1.0 - exp(-d * stepLen * sigma);
        C += T * a * col;
        T *= 1.0 - a;
      }
      stepLen = max(70.0, t * 0.04);
      t += stepLen;
    }
    vec4 cur = vec4(C, T);
    gl_FragColor = hist ? mix(texture2D(tPrev, puv), cur, 0.14) : cur;
  }`;

export class VolumetricClouds {
  /** Quarter-resolution cloud color (premultiplied) and what shows through (a = transmittance). */
  rt: THREE.WebGLRenderTarget;
  private prev: THREE.WebGLRenderTarget;
  private prevVP = new THREE.Matrix4();
  private vp = new THREE.Matrix4();
  private lastCam = new THREE.Vector3();
  private hasPrev = false;
  private frame = 0;
  /** Bottom and top of the layer, meters. */
  base = 950;
  top = 1850;
  cover = 0.5;
  /** 0 fair weather .. 1 thunderstorm (denser, darker undersides). */
  storm = 0;
  readonly wind = new THREE.Vector2();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly lit = new THREE.Color(1, 1, 1);
  readonly shade = new THREE.Color(0.6, 0.65, 0.8);
  readonly haze = new THREE.Color(0.7, 0.85, 0.95);
  /** False until the noise texture has been built (a few frames after startup). */
  ready = false;
  private mat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private noise: THREE.Data3DTexture | null = null;
  /** Sunlight reaching the ground through the layer (r: 1 clear .. 0 fully shaded), a square map `shadowExtent` meters wide around `shadowCenter`. */
  readonly shadowRT: THREE.WebGLRenderTarget;
  readonly shadowCenter = new THREE.Vector2();
  readonly shadowExtent = 12000;
  /** The direction the shadow map was cast along (the sun, kept off the horizon). */
  readonly shadowDir = new THREE.Vector3(0, 1, 0);
  private shadowMat: THREE.ShaderMaterial;
  private shadowAge = 99;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.prev = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    for (const t of [this.rt, this.prev]) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tNoise: { value: null }, tDepth: { value: null }, tPrev: { value: null },
        uPrevVP: { value: new THREE.Matrix4() }, uHasPrev: { value: 0 }, uFrame: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uWind: { value: this.wind }, uTexel: { value: new THREE.Vector2() },
        uSunDir: { value: this.sunDir }, uLit: { value: this.lit }, uShade: { value: this.shade }, uHaze: { value: this.haze },
        uCover: { value: 0.5 }, uHazeDist: { value: 16000 }, uStorm: { value: 0 }, uTime: { value: 0 },
        uCloudBase: { value: 950 }, uCloudTop: { value: 1850 },
      },
      vertexShader: VERT.replace(/varying/g, 'out'),
      fragmentShader: FRAG.replace(/varying/g, 'in').replace(/texture2D/g, 'texture').replace(/gl_FragColor/g, 'outColor').replace('precision highp sampler3D;', 'precision highp sampler3D;\n  layout(location = 0) out highp vec4 outColor;'),
      depthTest: false, depthWrite: false,
    });
    this.shadowRT = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false });
    this.shadowRT.texture.minFilter = this.shadowRT.texture.magFilter = THREE.LinearFilter;
    const mu = this.mat.uniforms;
    this.shadowMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tNoise: mu.tNoise, uWind: mu.uWind, uCover: mu.uCover, uTime: mu.uTime, uStorm: mu.uStorm, uCloudBase: mu.uCloudBase, uCloudTop: mu.uCloudTop,
        uCenter: { value: this.shadowCenter }, uDir: { value: this.shadowDir }, uExtent: { value: this.shadowExtent },
      },
      vertexShader: VERT.replace(/varying/g, 'out'),
      fragmentShader: SHADOW.replace(/varying/g, 'in').replace(/gl_FragColor/g, 'outColor').replace('precision highp sampler3D;', 'precision highp sampler3D;\n  layout(location = 0) out highp vec4 outColor;'),
      depthTest: false, depthWrite: false,
    });
    buildNoise((data) => {
      const tex = new THREE.Data3DTexture(data, N, N, N);
      tex.format = THREE.RGBAFormat;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      this.noise = tex;
      this.mat.uniforms.tNoise.value = tex;
      this.ready = true;
    });
  }

  setSize(w: number, h: number) {
    const qw = Math.max(1, Math.ceil(w / 4)), qh = Math.max(1, Math.ceil(h / 4));
    if (qw !== this.rt.width || qh !== this.rt.height) this.hasPrev = false;
    this.rt.setSize(qw, qh); this.prev.setSize(qw, qh);
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  /** Whether there is anything to draw from this camera (clouds in the sky, the noise ready). */
  active() { return this.ready && this.cover > 0.01; }

  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, cam: THREE.PerspectiveCamera, time: number) {
    const u = this.mat.uniforms;
    u.tDepth.value = depth;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCover.value = this.cover; u.uStorm.value = this.storm; u.uTime.value = time;
    u.uCloudBase.value = this.base; u.uCloudTop.value = this.top;
    // Last frame's result becomes the history; a jump (teleport, entering a building) starts over.
    const t = this.rt; this.rt = this.prev; this.prev = t;
    if (this.lastCam.distanceToSquared(cam.position) > 400 * 400) this.hasPrev = false;
    this.lastCam.copy(cam.position);
    u.tPrev.value = this.prev.texture;
    u.uPrevVP.value.copy(this.prevVP);
    u.uHasPrev.value = this.hasPrev ? 1 : 0;
    u.uFrame.value = this.frame = (this.frame + 1) % 64;
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    this.prevVP.copy(this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.hasPrev = true;
  }

  /** Redraw the ground shadow map when it has gone stale (every few frames, or after a jump). */
  renderShadow(renderer: THREE.WebGLRenderer, cam: THREE.Camera) {
    const texel = this.shadowExtent / this.shadowRT.width;
    // Centered on the camera, in whole texels so the pattern doesn't swim as you move.
    const cx = Math.round(cam.position.x / texel) * texel, cz = Math.round(cam.position.z / texel) * texel;
    const moved = Math.abs(cx - this.shadowCenter.x) + Math.abs(cz - this.shadowCenter.y) > 400;
    if (++this.shadowAge < 6 && !moved) return;
    this.shadowAge = 0;
    this.shadowCenter.set(cx, cz);
    this.shadowDir.copy(this.sunDir);
    if (this.shadowDir.y < 0.2) { this.shadowDir.y = 0.2; this.shadowDir.normalize(); }
    const u = this.mat.uniforms;
    u.uCover.value = this.cover; u.uStorm.value = this.storm; u.uCloudBase.value = this.base; u.uCloudTop.value = this.top;
    this.quad.material = this.shadowMat;
    renderer.setRenderTarget(this.shadowRT);
    this.quad.render(renderer);
    this.quad.material = this.mat;
  }

  /** Forget the accumulated history (the scene changed under the camera). */
  reset() { this.hasPrev = false; }

  dispose() { this.prev.dispose(); this.rt.dispose(); this.shadowRT.dispose(); this.shadowMat.dispose(); this.mat.dispose(); this.quad.dispose(); this.noise?.dispose(); }
}
