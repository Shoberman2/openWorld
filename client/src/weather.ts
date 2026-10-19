// Weather: live conditions where you are (or set by hand), rain and snow around the camera, fog,
// overcast, thunderstorms with lightning, dust haze, and auroras on high-latitude nights.
import * as THREE from 'three';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'dust';

interface Live { tempC: number; windKmh: number; windDir: number; cloudCover: number; precip: number; kind: WeatherKind }

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Targets for each kind of weather (at intensity 1). */
const LOOK: Record<WeatherKind, { cover: number; dark: number; rain: number; snow: number; fog: number; dust: number; storm: number }> = {
  clear: { cover: 0.35, dark: 0, rain: 0, snow: 0, fog: 0, dust: 0, storm: 0 },
  cloudy: { cover: 0.92, dark: 0.4, rain: 0, snow: 0, fog: 2, dust: 0, storm: 0 },
  rain: { cover: 1, dark: 0.68, rain: 1, snow: 0, fog: 10, dust: 0, storm: 0 },
  snow: { cover: 1, dark: 0.4, rain: 0, snow: 1, fog: 30, dust: 0, storm: 0 },
  storm: { cover: 1, dark: 0.9, rain: 1, snow: 0, fog: 14, dust: 0, storm: 1 },
  fog: { cover: 0.85, dark: 0.3, rain: 0, snow: 0, fog: 110, dust: 0, storm: 0 },
  dust: { cover: 0.4, dark: 0.2, rain: 0, snow: 0, fog: 50, dust: 1, storm: 0 },
};

/** The current weather, eased toward a target so changes roll in rather than snap. */
export class WeatherState {
  mode: 'live' | 'manual' = 'live';
  kind: WeatherKind = 'clear';
  intensity = 0.6;
  windDir = 250; // degrees, blowing FROM
  windSpeed = 12; // km/h
  tempC = 18;
  baseCover = 0.55;
  // Eased values the renderer reads.
  cover = 0.55; dark = 0; rain = 0; snow = 0; fog = 0; dust = 0; storm = 0;
  private lat = NaN; private lon = NaN;
  private fetchedAt = 0;
  private fetching = false;

  setWeather(kind: WeatherKind, intensity = 1, opts: { windDir?: number; windSpeed?: number; tempC?: number } = {}) {
    this.mode = 'manual';
    this.kind = kind;
    this.intensity = THREE.MathUtils.clamp(intensity, 0, 1);
    if (opts.windDir !== undefined) this.windDir = opts.windDir;
    if (opts.windSpeed !== undefined) this.windSpeed = opts.windSpeed;
    else if (kind === 'storm') this.windSpeed = Math.max(this.windSpeed, 45);
    if (opts.tempC !== undefined) this.tempC = opts.tempC;
    else if (kind === 'snow') this.tempC = Math.min(this.tempC, -3);
  }

  /** Back to the real weather where you are. */
  live() { this.mode = 'live'; this.fetchedAt = 0; if (Number.isFinite(this.lat)) this.setLocation(this.lat, this.lon); }

  /** Tell the weather where you are; in live mode it follows the real conditions there. */
  setLocation(lat: number, lon: number) {
    const moved = !Number.isFinite(this.lat) || Math.abs(lat - this.lat) > 0.2 || Math.abs(lon - this.lon) > 0.2;
    this.lat = lat; this.lon = lon;
    if (this.mode !== 'live' || this.fetching) return;
    if (!moved && Date.now() - this.fetchedAt < 15 * 60_000) return;
    this.fetching = true;
    fetch(`/api/weather?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w: Live | null) => {
        this.fetchedAt = Date.now();
        if (!w || this.mode !== 'live') return;
        this.kind = w.kind;
        this.tempC = w.tempC;
        this.windDir = w.windDir;
        this.windSpeed = w.windKmh;
        this.intensity = w.kind === 'rain' || w.kind === 'snow' ? THREE.MathUtils.clamp(0.3 + w.precip / 4, 0.3, 1) : w.kind === 'clear' ? 0.6 : 1;
        this.baseCover = THREE.MathUtils.clamp(w.cloudCover, 0.15, 0.95);
      })
      .catch(() => {})
      .finally(() => { this.fetching = false; });
  }

  /** Snow instead of rain when it's freezing (cold places, high mountains). */
  private effectiveKind(altitude: number): WeatherKind {
    const t = this.tempC - Math.max(0, altitude) * 0.0065;
    if (this.kind === 'rain' && t < 0.5) return 'snow';
    if (this.kind === 'snow' && t > 4) return 'rain';
    return this.kind;
  }

  update(dt: number, altitude = 0) {
    const k = this.effectiveKind(altitude);
    const L = LOOK[k], i = this.intensity;
    const cover = k === 'clear' ? this.baseCover * 0.75 : THREE.MathUtils.lerp(this.baseCover, L.cover, Math.min(1, 0.4 + i));
    // Live weather rolls in slowly; a change you asked for arrives in a few seconds.
    const ease = 1 - Math.exp(-dt * (this.mode === 'manual' ? 0.9 : 0.25));
    this.cover += (cover - this.cover) * ease;
    this.dark += (L.dark * (0.5 + 0.5 * i) - this.dark) * ease;
    this.rain += (L.rain * i - this.rain) * ease;
    this.snow += (L.snow * i - this.snow) * ease;
    this.fog += (L.fog * (0.4 + 0.6 * i) - this.fog) * ease;
    this.dust += (L.dust * i - this.dust) * ease;
    this.storm += (L.storm * i - this.storm) * ease;
  }

  /** Wind as a ground-plane vector (m/s) in local x = east, z = south. */
  windVector(out = new THREE.Vector2()) {
    const toward = THREE.MathUtils.degToRad(this.windDir + 180);
    const ms = this.windSpeed / 3.6;
    return out.set(Math.sin(toward) * ms, -Math.cos(toward) * ms);
  }

  summary(imperial = false, hour = 12) {
    const night = hour < 6 || hour > 20;
    const k = this.effectiveKind(0), i = this.intensity;
    const word = k === 'rain' ? (i < 0.45 ? 'Light rain' : i > 0.8 ? 'Heavy rain' : 'Rain')
      : k === 'snow' ? (i < 0.45 ? 'Light snow' : i > 0.8 ? 'Heavy snow' : 'Snow')
      : k === 'storm' ? 'Thunderstorms' : k === 'fog' ? 'Fog' : k === 'dust' ? 'Dust storm'
      : k === 'cloudy' ? 'Overcast'
      : this.baseCover > 0.6 ? 'Mostly cloudy' : this.baseCover > 0.35 ? (night ? 'Partly cloudy' : 'Partly sunny') : night ? 'Clear' : 'Sunny';
    const from = DIRS[Math.round((((this.windDir % 360) + 360) % 360) / 45) % 8];
    const temp = imperial ? `${Math.round(this.tempC * 9 / 5 + 32)} °F` : `${Math.round(this.tempC)} °C`;
    const wind = imperial ? `${Math.round(this.windSpeed / 1.609)} mph` : `${Math.round(this.windSpeed)} km/h`;
    return `${word} · ${temp} · wind ${wind} from the ${from}`;
  }
}

// ------------------------------------------------------------------------------------- precipitation

const precipVert = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uTime, uSnow, uAmount, uBox;
varying float vAlpha;
varying vec2 vUv;
varying float vSnow;
void main() {
  vUv = uv;
  vSnow = uSnow;
  // Thin out by amount: each drop has a rank in aSeed.w.
  float on = step(aSeed.w, uAmount);
  float fall = mix(11.0, 1.3, uSnow);
  vec3 vel = vec3(uWind.x, -fall, uWind.y) * mix(1.0, 0.6, uSnow);
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  // Snow wobbles as it drifts.
  p.x += uSnow * sin(uTime * 1.3 + aSeed.w * 40.0) * 0.6;
  p.z += uSnow * cos(uTime * 1.1 + aSeed.x * 30.0) * 0.6;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  // Streaks along the velocity for rain; round flakes facing the camera for snow.
  vec3 toCam = normalize(uCam - p);
  vec3 dir = normalize(vel);
  vec3 side = normalize(cross(dir, toCam));
  float len = mix(0.75, 0.07, uSnow), wid = mix(0.012, 0.07, uSnow);
  vec3 up = mix(dir, normalize(cross(toCam, side)), uSnow);
  vec3 w = p + side * position.x * wid * 2.0 + up * position.y * len;
  float d = length(uCam - p);
  vAlpha = on * smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const precipFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;
varying float vSnow;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float flake = 1.0 - smoothstep(0.55, 1.0, length(q));
  float streak = (1.0 - abs(q.x)) * (1.0 - smoothstep(0.3, 1.0, abs(q.y)));
  float a = mix(streak, flake, vSnow) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** Rain streaks or snowflakes in a box that follows the camera: one draw call. */
export class Precipitation {
  mesh: THREE.InstancedMesh;
  uniforms = {
    uCam: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uSnow: { value: 0 },
    uAmount: { value: 0 },
    uBox: { value: 46 },
    uColor: { value: new THREE.Color(0xc8d4e2) },
    uOpacity: { value: 0.55 },
  };

  constructor(count = 9000) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(count * 4);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) { seeds[i * 4] = rnd(); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = rnd(); seeds[i * 4 + 3] = rnd(); }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: precipVert, fragmentShader: precipFrag, transparent: true, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  update(dt: number, camera: THREE.Camera, rain: number, snow: number, wind: THREE.Vector2, night: number) {
    const u = this.uniforms;
    const amount = Math.min(1, rain + snow);
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    u.uTime.value += dt;
    camera.getWorldPosition(u.uCam.value);
    u.uWind.value.copy(wind);
    u.uSnow.value = snow / Math.max(0.001, rain + snow);
    u.uAmount.value = amount;
    u.uColor.value.setRGB(1, 1, 1).lerp(new THREE.Color(0xa9b8cc), (1 - u.uSnow.value) * 0.5).multiplyScalar(1 - night * 0.6);
    u.uOpacity.value = THREE.MathUtils.lerp(0.42, 0.9, u.uSnow.value);
  }
}

// ----------------------------------------------------------------------------------------- lightning

/** Thunderstorm lightning: a jagged bolt in the distance and a flash that lights the whole sky. */
export class Lightning {
  group = new THREE.Group();
  flash = 0;
  private bolt: THREE.LineSegments;
  private next = 3;
  private flicker = 0;

  constructor() {
    const mat = new THREE.LineBasicMaterial({ color: 0xf2f4ff, transparent: true, opacity: 0, fog: false, toneMapped: false });
    this.bolt = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
  }

  private strike(cam: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2, d = 900 + Math.random() * 2500;
    const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
    const pts: number[] = [];
    const branch = (px: number, py: number, pz: number, len: number, depth: number) => {
      let cx = px, cy = py, cz = pz;
      const steps = Math.max(4, Math.round(len / 60));
      for (let i = 0; i < steps; i++) {
        const nx = cx + (Math.random() - 0.5) * 70, ny = cy - len / steps, nz = cz + (Math.random() - 0.5) * 70;
        pts.push(cx, cy, cz, nx, ny, nz);
        if (depth < 2 && Math.random() < 0.2) branch(nx, ny, nz, len * 0.35, depth + 1);
        cx = nx; cy = ny; cz = nz;
      }
    };
    branch(x, cam.y * 0 + 900, z, 900, 0);
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry();
    this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.flicker = 0.45;
  }

  update(dt: number, storm: number, cam: THREE.Vector3) {
    this.next -= dt * (0.4 + storm);
    if (storm > 0.3 && this.next <= 0) {
      this.strike(cam);
      this.next = 3 + Math.random() * 9;
    }
    if (this.flicker > 0) {
      this.flicker -= dt;
      // Two or three quick pulses, like the real thing.
      const t = this.flicker;
      this.flash = t > 0 ? (Math.sin(t * 60) > 0.2 ? 1 : 0.25) * Math.min(1, t * 4) : 0;
    } else this.flash = Math.max(0, this.flash - dt * 6);
    (this.bolt.material as THREE.LineBasicMaterial).opacity = this.flash;
    this.bolt.visible = this.flash > 0.02;
  }
}

// ------------------------------------------------------------------------------------------- aurora

const auroraVert = /* glsl */ `
varying vec2 vUv;
varying float vH;
void main() {
  vUv = uv;
  vH = uv.y;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;
const auroraFrag = /* glsl */ `
uniform float uTime, uStrength;
varying vec2 vUv;
varying float vH;
float hsh(float n) { return fract(sin(n) * 43758.5453); }
float vn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hsh(i), hsh(i + 1.0), f); }
void main() {
  float x = vUv.x * 40.0;
  // Curtains: folds that sway, fine vertical rays, bright lower hem fading up into violet.
  float fold = vn(x * 0.7 + uTime * 0.05) * 0.6 + vn(x * 2.3 - uTime * 0.11) * 0.4;
  float rays = 0.55 + 0.45 * vn(x * 18.0 + uTime * 0.6);
  float hem = smoothstep(0.0, 0.12, vH) * (1.0 - smoothstep(0.25, 1.0, vH));
  float a = hem * rays * smoothstep(0.25, 0.8, fold) * uStrength;
  vec3 green = vec3(0.25, 1.0, 0.55), violet = vec3(0.6, 0.3, 1.0);
  vec3 col = mix(green, violet, smoothstep(0.25, 0.9, vH));
  gl_FragColor = vec4(col * a * 1.6, a);
}`;

/** Northern (or southern) lights: glowing curtains on high-latitude nights. */
export class Aurora {
  mesh: THREE.Mesh;
  uniforms = { uTime: { value: 0 }, uStrength: { value: 0 } };

  constructor() {
    // A wavy ribbon arcing across the poleward sky.
    const seg = 160, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = -1.2 + t * 2.4;
      const r = 3400 + Math.sin(t * 9.0) * 300;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r + Math.sin(t * 5.0) * 500;
      pos.push(x, 700, z, x, 2300, z);
      uv.push(t, 0, t, 1);
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: auroraVert, fragmentShader: auroraFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -4;
  }

  /** `lat` decides the odds and which way to look (north in the north, south in the south). */
  update(dt: number, cam: THREE.Vector3, night: number, lat: number, cover: number, force = false) {
    this.uniforms.uTime.value += dt;
    // Likelier the further poleward; the same answer all night (seeded by the date).
    const day = Math.floor(Date.now() / 86400000);
    const odds = THREE.MathUtils.smoothstep(Math.abs(lat), 52, 68);
    const tonight = force || ((Math.sin(day * 12.9898) * 43758.5453) % 1 + 1) % 1 < odds;
    const s = (tonight ? 1 : 0) * THREE.MathUtils.smoothstep(night, 0.6, 1) * (1 - cover * 0.8);
    this.uniforms.uStrength.value = s;
    this.mesh.visible = s > 0.01;
    this.mesh.position.set(cam.x, 0, cam.z);
    this.mesh.rotation.y = lat >= 0 ? 0 : Math.PI;
  }
}
