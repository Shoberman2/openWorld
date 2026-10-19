import * as THREE from 'three';

// Stylized sky for the "early Apple Maps" look: a gradient dome with a sun, moon and stars, and
// big puffy cartoon cumulus drawn as camera-facing puffs in a single instanced draw call.

/** Colors of the sky at one moment, derived from the sun's elevation. */
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
const PAL = {
  day: { zen: C(0x2a68d6), hor: C(0xa4d9f3), lit: C(0xffffff), shade: C(0xb4c3e6) },
  gold: { zen: C(0x4462b8), hor: C(0xf7bf8e), lit: C(0xffd2a0), shade: C(0xa08cb6) },
  dusk: { zen: C(0x24306c), hor: C(0xec8a6c), lit: C(0xffa478), shade: C(0x6a4f86) },
  night: { zen: C(0x050c22), hor: C(0x16284a), lit: C(0x1d2848), shade: C(0x0c142e) },
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
  o.sunLight.set(0xff9a5c).lerp(C(0xffe2b8), tGold).lerp(C(0xfff6ea), tDay);
  // Ambient: mostly white with a hint of sky, so grey roads stay grey (not navy).
  o.hemiSky.copy(o.zenith).lerp(C(0xf6f2ea), 0.88);
  o.hemiGround.set(0x40362a).lerp(C(0xa8a08a), tDay);
  return o;
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
uniform vec3 uZenith, uHorizon, uGlow, uSunDir, uMoonDir, uSunColor;
uniform float uGlowAmt, uNight, uSunVis;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
  // A soft band of brighter haze right at the horizon.
  col = mix(col, uHorizon * 1.06, (1.0 - smoothstep(0.0, 0.08, abs(y))) * 0.5);
  // Below the horizon: hazy ground color (hidden by terrain most of the time).
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.15, y));
  float sd = dot(d, uSunDir);
  // Warm glow around the sun, strongest near the horizon (sunrise/sunset).
  float g = pow(max(sd, 0.0), 5.0) * (1.0 - up * 0.8);
  col = mix(col, uGlow, clamp(g * uGlowAmt, 0.0, 1.0));
  // Sun: a crisp disk plus a halo.
  float disk = smoothstep(0.99955, 0.99975, sd) * uSunVis;
  float halo = pow(max(sd, 0.0), 350.0) * 0.6 * uSunVis;
  col += uSunColor * (disk * 6.0 + halo);
  // Moon at night.
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99935, 0.9996, md) * uNight;
  float moonHalo = pow(max(md, 0.0), 120.0) * 0.25 * uNight;
  col += vec3(0.95, 0.96, 1.0) * moon * 1.6 + vec3(0.5, 0.6, 0.9) * moonHalo;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome {
  mesh: THREE.Mesh;
  uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGlowAmt: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uNight: { value: 0 },
    uSunVis: { value: 1 },
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
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float a = atan(p.y, p.x);
  // Lumpy, cauliflower edges.
  float edge = 0.95 + 0.022 * sin(a * 5.0 + vSeed * 9.0) + 0.012 * sin(a * 9.0 + vSeed * 4.0);
  if (r2 > edge * edge) discard;
  if (vWorld.y < vBase) discard; // flat bottoms
  vec3 toCam = normalize(uCam - vWorld);
  vec3 pn = normalize(uRight * p.x + uUp * p.y + toCam * sqrt(max(0.0, 1.0 - r2)));
  // Blend each puff's own roundness with the shape of the whole cloud so it reads as one mass.
  vec3 cn = normalize((vWorld - vCenter) / vSize);
  vec3 n = normalize(pn * 0.5 + cn * 0.65);
  float lam = dot(n, uSunDir) * 0.5 + 0.5;
  float h = clamp((vWorld.y - vBase) / (vTop - vBase), 0.0, 1.0);
  // Soft cartoon shading: lit tops, cool shaded bellies.
  float k = clamp(smoothstep(0.15, 0.8, lam) * (0.55 + 0.45 * smoothstep(0.0, 0.55, h)) + 0.12, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, k);
  // Bright silver lining on the sunny rim.
  col *= 0.94;
  col += uLit * 0.05 * pow(1.0 - sqrt(max(0.0, 1.0 - r2)), 3.0) * smoothstep(0.5, 1.0, lam);
  // Distance haze into the horizon color.
  float f = 1.0 - exp(-pow(vDist / uHazeDist, 2.0));
  col = mix(col, uHaze, clamp(max(f * 0.85, vEdge), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
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

  constructor(clusters = 110, seed = 7) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const cl: number[] = [], pf: number[] = [], sh: number[] = [];
    // Spread cluster seeds so any cover value gives an even distribution.
    for (let i = 0; i < clusters; i++) {
      const cx = (rnd() * 2 - 1) * this.range, cz = (rnd() * 2 - 1) * this.range;
      const base = 750 + rnd() * 700;
      const order = (i + rnd() * 0.9) / clusters; // cover threshold
      const width = 220 + rnd() * 520; // cluster half-width
      const tall = 0.6 + rnd() * 0.7;
      const n = Math.round(9 + (width / 740) * 12);
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
        const rad = (lvl === 0 ? 105 : lvl === 1 ? 140 : 150) * (0.7 + rnd() * 0.6) * (0.6 + width / 900) * tall;
        const oy = rad * (lvl === 0 ? 0.55 : lvl === 1 ? 1.05 : 1.6) * tall + rnd() * 20;
        cl.push(cx, cz, base, order);
        pf.push(ox, oy, oz, rad);
        sh.push(width, 330 * tall * (0.6 + width / 900));
      }
    }
    const count = cl.length / 4;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aCluster', new THREE.InstancedBufferAttribute(new Float32Array(cl), 4));
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(pf), 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(sh), 2));
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: cloudVert, fragmentShader: cloudFrag, fog: false });
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
