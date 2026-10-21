import * as THREE from 'three';

// Physically based sky: Preetham daylight scattering (the same model as three's Sky example) on a
// dome that rides with the camera, a night sky with a moon and stars, and soft volumetric-looking
// cumulus drawn as camera-facing, noise-eroded puffs in a single instanced draw call. The haze color
// used for fog and the sunlight color are evaluated on the CPU from the same model, so distant
// buildings fade into exactly the sky behind them.

/** Colors of the sky at one moment, derived from the sun's elevation (night and cloud tints). */
export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color; // warm light around the sun near the horizon
  glowAmount: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  sunLight: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
}

const C = (h: number) => new THREE.Color(h);
// Twilight and night only: daytime colors come from the scattering model.
const PAL = {
  day: { zen: C(0x3f6fb8), hor: C(0xb9cbdc), lit: C(0xfbf8f2), shade: C(0x9aa3b0) },
  gold: { zen: C(0x3c5a96), hor: C(0xe3b48c), lit: C(0xffd6aa), shade: C(0x8a8296) },
  dusk: { zen: C(0x1d2a58), hor: C(0xb8735e), lit: C(0xe89a74), shade: C(0x4e4560) },
  night: { zen: C(0x02050d), hor: C(0x0b1424), lit: C(0x131a28), shade: C(0x080c16) },
};

/** Blend the palette for a sun elevation in degrees. */
export function skyColors(elev: number, out?: SkyColors): SkyColors {
  const o = out ?? {
    zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), glowAmount: 0,
    cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), sunLight: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
  };
  const sm = THREE.MathUtils.smoothstep;
  const tDusk = sm(elev, -10, -1); // night -> dusk
  const tGold = sm(elev, -1.5, 5); // dusk -> golden hour
  const tDay = sm(elev, 5, 22); // golden -> full day
  const mix = (k: 'zen' | 'hor' | 'lit' | 'shade', dst: THREE.Color) =>
    dst.copy(PAL.night[k]).lerp(PAL.dusk[k], tDusk).lerp(PAL.gold[k], tGold).lerp(PAL.day[k], tDay);
  mix('zen', o.zenith); mix('hor', o.horizon); mix('lit', o.cloudLit); mix('shade', o.cloudShade);
  o.glow.set(0xff8a4a).lerp(C(0xffc27a), tGold);
  o.glowAmount = tDusk * (1 - tDay) * 0.9 + 0.08;
  o.sunLight.set(0xff8a4c).lerp(C(0xffd6a6), tGold).lerp(C(0xfff4e6), tDay);
  o.hemiSky.copy(o.zenith).lerp(C(0xdfe6ee), 0.55);
  o.hemiGround.set(0x2a2622).lerp(C(0x6e6a60), tDay);
  return o;
}

// ------------------------------------------------------------------------------ art-directed sky

/**
 * An art-directed sky: saturated blue days, periwinkle-to-peach sunsets
 * with lavender shade, deep navy nights. Keyed on sun elevation (degrees); colors are sRGB hex.
 */
export interface ArtSky {
  zenith: THREE.Color; horizon: THREE.Color; horizonSun: THREE.Color;
  glow: THREE.Color; glowAmount: number;
  sun: THREE.Color; cloudLit: THREE.Color; cloudShade: THREE.Color;
  hemiSky: THREE.Color; hemiGround: THREE.Color;
}
type ArtKey = { e: number; zen: number; hor: number; horS: number; glow: number; ga: number; sun: number; lit: number; shade: number; hs: number; hg: number };
const ART: ArtKey[] = [
  { e: -14, zen: 0x060a1a, hor: 0x111a33, horS: 0x151d38, glow: 0x000000, ga: 0, sun: 0x9fb4ff, lit: 0x1a2236, shade: 0x0c1122, hs: 0x2a3560, hg: 0x10131c },
  { e: -6, zen: 0x232c66, hor: 0x4d4a80, horS: 0x7a5a86, glow: 0xd06a70, ga: 0.35, sun: 0xff8a6a, lit: 0x8a6a96, shade: 0x3a3a68, hs: 0x5a5f9c, hg: 0x2a2630 },
  { e: -1, zen: 0x4d62b4, hor: 0x9a8cbc, horS: 0xe8969a, glow: 0xff8f6e, ga: 0.8, sun: 0xff9466, lit: 0xf4b0a0, shade: 0x8a78b0, hs: 0x8e8fd0, hg: 0x4a4048 },
  { e: 2.5, zen: 0x6680d4, hor: 0xbca8cc, horS: 0xffa478, glow: 0xff8c5a, ga: 1.1, sun: 0xffb27c, lit: 0xffd2b4, shade: 0xa48cbc, hs: 0xa6a6e0, hg: 0x5e5450 },
  { e: 9, zen: 0x5e8fe0, hor: 0xc8d2ea, horS: 0xffdcb6, glow: 0xffd0a0, ga: 0.45, sun: 0xffe2bc, lit: 0xfff3e2, shade: 0xb6bcda, hs: 0xb8cdf0, hg: 0x76705e },
  { e: 24, zen: 0x3d86e2, hor: 0xbcd9f4, horS: 0xd8e8f8, glow: 0xfff4e0, ga: 0.18, sun: 0xfff6ec, lit: 0xffffff, shade: 0xbac7de, hs: 0xc4dcf6, hg: 0x7e7a6a },
];
const _a = new THREE.Color(), _b = new THREE.Color();
function lerpHex(out: THREE.Color, a: number, b: number, t: number) { return out.copy(_a.setHex(a)).lerp(_b.setHex(b), t); }
export function artSky(elev: number, out?: ArtSky): ArtSky {
  const o = out ?? {
    zenith: new THREE.Color(), horizon: new THREE.Color(), horizonSun: new THREE.Color(), glow: new THREE.Color(), glowAmount: 0,
    sun: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
  };
  let i = 0;
  while (i < ART.length - 2 && elev > ART[i + 1].e) i++;
  const A = ART[i], B = ART[i + 1];
  const t = THREE.MathUtils.smoothstep(elev, A.e, B.e);
  lerpHex(o.zenith, A.zen, B.zen, t); lerpHex(o.horizon, A.hor, B.hor, t); lerpHex(o.horizonSun, A.horS, B.horS, t);
  lerpHex(o.glow, A.glow, B.glow, t); o.glowAmount = A.ga + (B.ga - A.ga) * t;
  lerpHex(o.sun, A.sun, B.sun, t); lerpHex(o.cloudLit, A.lit, B.lit, t); lerpHex(o.cloudShade, A.shade, B.shade, t);
  lerpHex(o.hemiSky, A.hs, B.hs, t); lerpHex(o.hemiGround, A.hg, B.hg, t);
  return o;
}

// ------------------------------------------------------------------------------- scattering model

/** Overall brightness of the scattered sky relative to the lit scene (pre tone mapping). */
export const SKY_GAIN = 0.42;

// Constants from the Preetham / Hoffman & Preetham model, as in three/examples Sky.js.
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734, STEEP = 1.5, EE = 1000;
const MIE_G = 0.8;

interface Scatter { sunE: number; betaR: number[]; betaM: number[] }
function scatterSetup(sun: THREE.Vector3, turbidity: number, rayleigh: number, mie: number): Scatter {
  const zc = THREE.MathUtils.clamp(sun.y, -1, 1);
  const sunE = EE * Math.max(0, 1 - Math.exp(-((CUTOFF - Math.acos(zc)) / STEEP)));
  const sunfade = 1 - THREE.MathUtils.clamp(1 - Math.exp(sun.y * 400000 / 450000), 0, 1);
  const rc = rayleigh - (1 - sunfade);
  const c = 0.2 * turbidity * 10e-18;
  return { sunE, betaR: TOTAL_RAYLEIGH.map((v) => v * rc), betaM: MIE_CONST.map((v) => 0.434 * c * v * mie) };
}

/** Scattered sky radiance in direction `dir` (linear, scaled by SKY_GAIN, no sun disk). Mirrors the dome shader. */
function skyRadiance(dir: THREE.Vector3, sun: THREE.Vector3, s: Scatter, out: THREE.Color) {
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const cos = dir.dot(sun);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cos * 0.5 + 0.5, 2));
  const g2 = MIE_G * MIE_G;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * MIE_G * cos + g2, 1.5));
  const blend = THREE.MathUtils.clamp(Math.pow(1 - sun.y, 5), 0, 1);
  const rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(s.betaR[i] * sR + s.betaM[i] * sM));
    const ratio = (s.betaR[i] * rPhase + s.betaM[i] * mPhase) / (s.betaR[i] + s.betaM[i]);
    let lin = Math.pow(s.sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(s.sunE * ratio * fex, 0.5) - 1) * blend;
    const L0 = 0.1 * fex;
    rgb[i] = (lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  const sunfade = 1 - THREE.MathUtils.clamp(1 - Math.exp(sun.y * 400000 / 450000), 0, 1);
  const e = 1 / (1.2 + 1.2 * sunfade);
  return out.setRGB(Math.pow(rgb[0], e) * SKY_GAIN, Math.pow(rgb[1], e) * SKY_GAIN, Math.pow(rgb[2], e) * SKY_GAIN);
}

const _d = new THREE.Vector3(), _c = new THREE.Color();
/**
 * Evaluate the daylight sky for a sun direction: the haze color at the horizon (averaged around the
 * compass, so fog matches the sky in every direction), the zenith, and the sunlight color after its
 * trip through the atmosphere (warm and dim near the horizon).
 */
export function daylight(sun: THREE.Vector3, turbidity: number, rayleigh: number, out: { horizon: THREE.Color; zenith: THREE.Color; sun: THREE.Color }) {
  const s = scatterSetup(sun, turbidity, rayleigh, 0.005);
  out.horizon.setRGB(0, 0, 0);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    _d.set(Math.cos(a), 0.035, Math.sin(a)).normalize();
    out.horizon.add(skyRadiance(_d, sun, s, _c));
  }
  out.horizon.multiplyScalar(1 / N);
  skyRadiance(_d.set(0, 1, 0), sun, s, out.zenith);
  // Sun transmittance along its own path.
  const zen = Math.acos(Math.max(0, sun.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(Math.max(0.01, 93.885 - (zen * 180) / Math.PI), -1.253));
  const t = [0, 1, 2].map((i) => Math.exp(-(s.betaR[i] * 8.4e3 + s.betaM[i] * 1.25e3) * inv));
  // (Softened: the plain model turns the afternoon sun orange too early.)
  const m = Math.max(t[0], t[1], t[2], 1e-4);
  out.sun.setRGB(Math.sqrt(t[0] / m), Math.sqrt(t[1] / m), Math.sqrt(t[2] / m));
  return out;
}

// ------------------------------------------------------------------------------------------ dome

const domeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const domeFrag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uHorizonSun, uGlow, uSunDir, uMoonDir, uSunColor, uHaze;
uniform float uNight, uSunVis, uFlat, uGlowAmt;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  float ct = dot(d, uSunDir);
  // Painted gradient: the horizon warms toward the sun (peach at sunset), lavender away from it.
  vec2 sh = uSunDir.xz; float shl = length(sh);
  // (clamped: dot() can land a hair outside [-1, 1], and pow() of a negative is NaN, which the
  // environment bake would smear over every lit surface)
  float toward = shl > 1e-3 && length(d.xz) > 1e-3 ? clamp(dot(normalize(d.xz), sh / shl) * 0.5 + 0.5, 0.0, 1.0) : 0.5;
  vec3 hor = mix(uHorizon, uHorizonSun, pow(toward, 2.2));
  vec3 col = mix(hor, uZenith, pow(up, 0.42));
  // A wide warm glow around the sun, hugging the horizon.
  col += uGlow * uGlowAmt * (pow(max(ct, 0.0), 4.0) * 0.7 + pow(max(ct, 0.0), 32.0) * 0.8) * (1.0 - up * 0.5);
  // Overcast / dust / fog: the sky flattens into a grey gradient.
  col = mix(col, mix(uHaze, uZenith, pow(up, 0.6)), uFlat);
  // The bottom of the sky melts into the haze so the fog line is invisible.
  col = mix(col, mix(uHaze, hor, 0.55), 1.0 - smoothstep(-0.03, 0.03, y));
  // Sun disk and a bright aureole.
  float disk = smoothstep(0.99955, 0.99975, ct) * uSunVis * (1.0 - uFlat * 0.85);
  float aureole = pow(max(ct, 0.0), 700.0) * 0.6 * uSunVis * (1.0 - uFlat);
  col += uSunColor * (disk * 3.0 + aureole);
  // Moon at night.
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99955, 0.9997, md) * uNight;
  float moonHalo = pow(max(md, 0.0), 160.0) * 0.08 * uNight;
  col += vec3(0.9, 0.92, 1.0) * moon * 1.4 + vec3(0.35, 0.42, 0.6) * moonHalo;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome {
  mesh: THREE.Mesh;
  uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHorizonSun: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGlowAmt: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uNight: { value: 0 },
    uSunVis: { value: 1 },
    uFlat: { value: 0 },
  };
  constructor(radius = 1000) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: domeVert, fragmentShader: domeFrag,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
  /** A second dome sharing this one's uniforms (for the environment-map scene). */
  clone() {
    const m = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    m.frustumCulled = false;
    return m;
  }
}

// ---------------------------------------------------------------------------------------- clouds

const cloudVert = /* glsl */ `
attribute vec4 aCluster; // x, z (wind-free), base altitude, seed 0..1
attribute vec4 aPuff;    // offset x, y (above base), z, radius
attribute vec2 aShape;   // cluster half-width, height
uniform vec3 uCam, uRight, uUp;
uniform vec2 uWind;
uniform float uRange, uCover;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBase, vTop, vSeed, vDist, vEdge;
varying vec3 vCenter, vSize;
void main() {
  vec2 c = aCluster.xy + uWind;
  c = uCam.xz + mod(c - uCam.xz + uRange, 2.0 * uRange) - uRange;
  vec3 center = vec3(c.x + aPuff.x, aCluster.z + aPuff.y, c.y + aPuff.z);
  float r = aPuff.w;
  // Fade out at the edge of the wrap range by shrinking (no popping), and when the camera is inside.
  float hd = length(c - uCam.xz);
  r *= 1.0 - smoothstep(uRange * 0.93, uRange * 0.995, hd);
  vEdge = smoothstep(uRange * 0.55, uRange * 0.92, hd);
  float cd = length(center - uCam);
  r *= smoothstep(aPuff.w * 0.9, aPuff.w * 2.2, cd);
  // Cloud cover: only the first fraction of clusters are present.
  r *= step(aCluster.w, uCover);
  vec3 w = center + (uRight * position.x + uUp * position.y) * r * 2.0;
  vUv = position.xy + 0.5;
  vWorld = w;
  vBase = aCluster.z;
  vTop = aCluster.z + aShape.y;
  vCenter = vec3(c.x, aCluster.z + aShape.y * 0.25, c.y);
  vSize = vec3(aShape.x, aShape.y * 0.75, aShape.x);
  vSeed = aPuff.x * 0.013 + aPuff.z * 0.007 + aCluster.w * 17.0;
  vDist = length(w - uCam);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uRight, uUp, uCam, uSunDir, uLit, uShade, uHaze;
uniform float uHazeDist;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBase, vTop, vSeed, vDist, vEdge;
varying vec3 vCenter, vSize;
float ch(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return cn(p) * 0.5 + cn(p * 2.03 + 7.1) * 0.27 + cn(p * 4.1 + 3.7) * 0.15 + cn(p * 8.3 + 1.3) * 0.08; }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Cotton-ball cumulus: round, soft-edged puffs (a little noise so the rims aren't perfect circles).
  float n = fbm(p * 2.0 + vec2(vSeed * 13.1, vSeed * 7.3));
  float dens = smoothstep(1.0, 0.72, r2 + (n - 0.5) * 0.22);
  // Flat bases.
  float h = clamp((vWorld.y - vBase) / max(vTop - vBase, 1.0), 0.0, 1.0);
  dens *= smoothstep(-6.0, 22.0, vWorld.y - vBase + (n - 0.5) * 10.0);
  if (dens < 0.01) discard;
  vec3 toCam = normalize(uCam - vWorld);
  vec3 pn = normalize(uRight * p.x + uUp * p.y + toCam * sqrt(max(0.0, 1.0 - r2)));
  vec3 cnn = normalize((vWorld - vCenter) / vSize);
  vec3 nn = normalize(pn * 0.7 + cnn * 0.55);
  float lam = dot(nn, uSunDir);
  // Bright sunlit lobes, soft colored shade underneath (lavender at sunset, blue-grey by day).
  float k = smoothstep(-0.55, 0.75, lam) * (0.55 + 0.45 * smoothstep(0.0, 0.75, h));
  k = mix(k, k * (0.92 + 0.08 * n), 0.5);
  vec3 col = mix(uShade, uLit, clamp(k + 0.1, 0.0, 1.0));
  // Silver lining: rims glow when looking toward the sun.
  float fwd = pow(max(dot(-toCam, uSunDir), 0.0), 6.0);
  col += uLit * fwd * smoothstep(0.55, 1.0, r2) * 0.6;
  // Aerial perspective toward the horizon haze.
  float f = 1.0 - exp(-pow(vDist / uHazeDist, 2.0));
  col = mix(col, uHaze, clamp(max(f * 0.9, vEdge), 0.0, 1.0));
  gl_FragColor = vec4(col * dens, dens);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Clouds {
  mesh: THREE.InstancedMesh;
  range = 6500;
  private windOffset = new THREE.Vector2();
  wind = new THREE.Vector2(4.5, 1.8); // m/s
  uniforms = {
    uCam: { value: new THREE.Vector3() },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uWind: { value: new THREE.Vector2() },
    uRange: { value: 6500 },
    uCover: { value: 0.55 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.6, 0.65, 0.8) },
    uHaze: { value: new THREE.Color(0.7, 0.85, 0.95) },
    uHazeDist: { value: 9000 },
  };

  constructor(clusters = 300, seed = 7) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const cl: number[] = [], pf: number[] = [], sh: number[] = [];
    // Spread cluster seeds so any cover value gives an even distribution.
    for (let i = 0; i < clusters; i++) {
      const cx = (rnd() * 2 - 1) * this.range, cz = (rnd() * 2 - 1) * this.range;
      const base = 750 + rnd() * 700;
      const order = (i + rnd() * 0.9) / clusters; // cover threshold
      // Fair-weather cumulus: lots of small heaps, a few big ones (sizes skewed small).
      const sz = rnd();
      const width = 90 + sz * sz * 520; // cluster half-width
      const tall = 0.8 + rnd() * 0.5; // puffy cumulus: about as tall as wide
      const n = Math.round(6 + (width / 1000) * 22);
      const ang = rnd() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const stretch = 0.45 + rnd() * 0.35; // elongated along one axis
      for (let k = 0; k < n; k++) {
        // Bottom ring of smaller puffs, bigger puffs stacked toward the middle top.
        const t = k / n;
        const lvl = t < 0.55 ? 0 : t < 0.85 ? 1 : 2;
        const spread = lvl === 0 ? 0.85 : lvl === 1 ? 0.5 : 0.25;
        const u = (rnd() * 2 - 1) * width * spread, v = (rnd() * 2 - 1) * width * spread * stretch;
        const ox = u * ca - v * sa, oz = u * sa + v * ca;
        const rad = (lvl === 0 ? 105 : lvl === 1 ? 140 : 150) * (0.7 + rnd() * 0.6) * (0.35 + width / 700) * tall;
        const oy = rad * (lvl === 0 ? 0.55 : lvl === 1 ? 1.05 : 1.6) * tall + rnd() * 20;
        cl.push(cx, cz, base, order);
        pf.push(ox, oy, oz, rad);
        sh.push(width, 330 * tall * (0.35 + width / 700));
      }
    }
    const count = cl.length / 4;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aCluster', new THREE.InstancedBufferAttribute(new Float32Array(cl), 4));
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(pf), 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(sh), 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: cloudVert, fragmentShader: cloudFrag, fog: false,
      transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  set cover(v: number) { this.uniforms.uCover.value = THREE.MathUtils.clamp(v, 0, 1); }
  get cover() { return this.uniforms.uCover.value; }

  update(dt: number, camera: THREE.Camera) {
    this.windOffset.addScaledVector(this.wind, dt);
    const u = this.uniforms;
    u.uWind.value.copy(this.windOffset);
    u.uRange.value = this.range;
    camera.getWorldPosition(u.uCam.value);
    u.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    u.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  }
}

// ----------------------------------------------------------------------------------------- stars

export function makeStars(radius: number) {
  const g = new THREE.BufferGeometry();
  const pts: number[] = [], col: number[] = [];
  let s = 91;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() > 1 || v.lengthSq() < 0.01) { i--; continue; }
    v.normalize();
    if (v.y < 0.02) v.y = Math.abs(v.y) + 0.02;
    v.normalize().multiplyScalar(radius);
    pts.push(v.x, v.y, v.z);
    const b = 0.4 + rnd() * 0.6, warm = rnd();
    col.push(b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.15));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  p.frustumCulled = false;
  p.renderOrder = -9;
  return p;
}

// ------------------------------------------------------------------- skyline in the reflections

/**
 * The real buildings around you, painted into the reflection environment: a profile of the skyline
 * (per compass sector: the angle up to the roofs and down to the street, and how far away) drawn as
 * facades with floors and windows. Glass towers and car paint then mirror the street they stand on
 * instead of an empty sky. Lives only in the environment scene; rebaked as you move.
 */
const ringVert = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ringFrag = /* glsl */ `
uniform sampler2D uProfile;
uniform vec3 uLit, uShade, uGlass, uHaze, uSunDir, uGround;
uniform float uNight, uFog, uOn;
varying vec3 vDir;
float rh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.x, d.z);
  vec4 pr = texture2D(uProfile, vec2(az / 6.28318 + 0.5, 0.5));
  float el = asin(clamp(d.y, -1.0, 1.0));
  float top = pr.r, bot = pr.g, dist = max(pr.b, 1.0);
  bool bld = uOn > 0.5 && pr.a > 0.5 && el <= top && el >= bot;
  if (!bld && el >= 0.0) discard;
  vec3 c;
  if (bld) {
    // The facade facing us: lit if it faces the sun.
    vec2 n = -normalize(d.xz);
    float sunK = clamp(dot(n, normalize(uSunDir.xz + 1e-4)), 0.0, 1.0) * smoothstep(-0.02, 0.12, uSunDir.y);
    vec3 wall = mix(uShade, uLit, sunK);
    // Floors and window bays at that distance.
    float y = dist * tan(el), x = az * dist;
    vec2 cell = vec2(floor(x / 1.7), floor(y / 3.8));
    vec2 f = vec2(fract(x / 1.7), fract(y / 3.8));
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.85);
    float glassy = step(0.45, rh(vec2(floor(az * 40.0), floor(dist / 15.0))));
    win = mix(win, 1.0, glassy * 0.75);
    // Bays smaller than a texel of the environment map blur into their average (no sparkle in the glass).
    float aa = clamp(max(fwidth(x / 1.7), fwidth(y / 3.8)) * 1.5, 0.0, 1.0);
    win = mix(win, mix(0.36, 1.0, glassy * 0.75), aa);
    vec3 glass = uGlass * mix(0.8 + 0.4 * rh(cell), 1.0, aa);
    c = mix(wall, glass, win);
    c += win * mix(step(0.62, rh(cell + 7.0)), 0.38, aa) * uNight * vec3(1.0, 0.75, 0.45) * 0.9;
    // Distance haze.
    c = mix(c, uHaze, 1.0 - exp(-dist * uFog));
  } else {
    c = uGround;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class SkylineRing {
  static SECTORS = 256;
  readonly data = new Float32Array(SkylineRing.SECTORS * 4);
  readonly tex = new THREE.DataTexture(this.data, SkylineRing.SECTORS, 1, THREE.RGBAFormat, THREE.FloatType);
  uniforms = {
    uProfile: { value: this.tex },
    uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uGlass: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 }, uFog: { value: 0.0004 }, uOn: { value: 0 },
  };
  mesh: THREE.Mesh;
  constructor(radius = 800) {
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.needsUpdate = true;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 64, 32),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: ringVert, fragmentShader: ringFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.mesh.frustumCulled = false;
  }
}
