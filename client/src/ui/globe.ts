// The world map zoomed out: a 3D globe of Sentinel-2 imagery lit by the real sun (day and night), with
// live layers from Open-Meteo's current conditions on a 15° grid: cloud cover, precipitation and storms,
// and wind. The layers are honest about their resolution: coverage comes from the data, the cloud
// texture inside a grid cell is drawn, not observed.
import * as THREE from 'three';

export interface GlobalWeather {
  at: number; lat0: number; lon0: number; step: number; rows: number; cols: number;
  cloud: number[]; precip: number[]; code: number[]; wind: number[]; windDir: number[];
}

export type GlobeLayer = 'clouds' | 'storms' | 'wind';

const SAT_Z = 3;
const N = 2 ** SAT_Z;

const vert = /* glsl */ `
  varying vec3 vN; varying vec3 vW;
  void main() {
    vN = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frag = /* glsl */ `
  uniform sampler2D uSat; uniform sampler2D uWx; uniform vec3 uSun; uniform vec3 uLayers; uniform float uTime; uniform float uHaveWx;
  uniform vec4 uGrid; // lat0, lon0, step (degrees), rows; cols = 360 / step
  varying vec3 vN; varying vec3 vW;
  const float PI = 3.141592653589793;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 n = normalize(vN);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.x, n.z);
    // Web Mercator mosaic (the satellite tiles), with the poles beyond 85° painted as ice.
    float latc = clamp(lat, -1.4844, 1.4844);
    float my = log(tan(PI / 4.0 + latc / 2.0));
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - my / (2.0 * PI));
    vec3 col = texture2D(uSat, uv).rgb;
    col = mix(col, vec3(0.88, 0.91, 0.95), smoothstep(1.47, 1.5, abs(lat)));
    // Weather grid: texel (r, c) sits at (lat0 + r·step, lon0 + c·step); sample between texel centers.
    float cols = 360.0 / uGrid.z;
    vec2 wuv = vec2(((lon / PI * 180.0 - uGrid.y) / uGrid.z + 0.5) / cols, clamp(((lat / PI * 180.0 - uGrid.x) / uGrid.z + 0.5) / uGrid.w, 0.0, 1.0));
    vec4 wx = texture2D(uWx, wuv) * uHaveWx;
    // Precipitation / storms: blue → yellow → red heat, thunderstorms hot red.
    if (uLayers.y > 0.5) {
      float p = wx.g;
      vec3 heat = mix(vec3(0.2, 0.55, 1.0), vec3(1.0, 0.85, 0.2), smoothstep(0.15, 0.5, p));
      heat = mix(heat, vec3(1.0, 0.18, 0.12), smoothstep(0.5, 0.9, max(p, wx.b)));
      col = mix(col, heat, smoothstep(0.03, 0.2, max(p, wx.b)) * 0.75);
    }
    // Day and night from the real sun.
    float sun = dot(n, uSun);
    float day = smoothstep(-0.12, 0.18, sun);
    vec3 lit = col * (0.25 + 0.95 * max(sun, 0.0));
    col = mix(col * vec3(0.10, 0.12, 0.2), lit, day);
    // Clouds: how much from the data, the shapes from warped noise (drifting). Even overcast cells
    // break up a little, so the grid never shows as blocks.
    if (uLayers.x > 0.5) {
      float cover = wx.r;
      vec2 q = vec2(lon * 6.0 * cos(lat * 0.6), lat * 6.0);
      vec2 warp = vec2(fbm(q * 1.3 + 3.1), fbm(q * 1.3 - 7.7)) * 2.0;
      float detail = fbm(q * 2.6 + warp + vec2(uTime * 0.012, 0.0));
      float t = 1.0 - cover * 0.62;
      float c = smoothstep(t - 0.04, t + 0.16, detail) * smoothstep(0.04, 0.2, cover);
      col = mix(col, vec3(0.97) * (0.12 + 0.95 * max(sun, 0.0)) + 0.03, c * 0.9);
    }
    // Atmosphere: a blue rim, brighter on the day side.
    vec3 v = normalize(cameraPosition - vW);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.35, 0.6, 1.0) * rim * (0.25 + 0.75 * day);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export class Globe {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  private sphere: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private satCanvas = document.createElement('canvas');
  private satTex: THREE.CanvasTexture;
  private wxTex: THREE.DataTexture;
  private ray = new THREE.Raycaster();
  weather: GlobalWeather | null = null;
  layers: Record<GlobeLayer, boolean> = { clouds: true, storms: false, wind: false };
  private disposed = false;

  constructor(parent: HTMLElement, private dpr: number, onLoad: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ow-globe';
    parent.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(dpr);
    this.satCanvas.width = this.satCanvas.height = N * 256;
    const g = this.satCanvas.getContext('2d')!;
    g.fillStyle = '#1d3b5a'; g.fillRect(0, 0, N * 256, N * 256);
    this.satTex = new THREE.CanvasTexture(this.satCanvas);
    this.satTex.colorSpace = THREE.SRGBColorSpace;
    // Row 0 of the mosaic is the north (tile y = 0), and no mipmaps: they'd draw a seam at the antimeridian.
    this.satTex.flipY = false;
    this.satTex.generateMipmaps = false;
    this.satTex.minFilter = THREE.LinearFilter;
    this.wxTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uSat: { value: this.satTex }, uWx: { value: this.wxTex }, uGrid: { value: new THREE.Vector4(-75, -180, 15, 11) }, uSun: { value: new THREE.Vector3(0, 0, 1) }, uLayers: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 }, uHaveWx: { value: 0 } },
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.mat);
    this.scene.add(this.sphere);
    // Imagery: the 64 z3 tiles, drawn in as they arrive.
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const img = new Image();
      img.onload = () => { if (this.disposed) return; g.drawImage(img, x * 256, y * 256, 256, 256); this.satTex.needsUpdate = true; onLoad(); };
      img.src = `/api/tiles/sat/${SAT_Z}/${x}/${y}`;
    }
    void fetch('/api/weather/global').then((r) => (r.ok ? r.json() : null)).then((w: GlobalWeather | null) => {
      if (!w || this.disposed) return;
      this.weather = w;
      const d = new Uint8Array(w.rows * w.cols * 4);
      for (let i = 0; i < w.rows * w.cols; i++) {
        const code = w.code[i];
        d[i * 4] = Math.round(w.cloud[i] * 255);
        d[i * 4 + 1] = Math.min(255, Math.round(Math.sqrt(w.precip[i]) * 110));
        d[i * 4 + 2] = code >= 95 ? 255 : code === 65 || code === 82 || code === 75 ? 170 : 0;
        d[i * 4 + 3] = Math.min(255, Math.round(w.wind[i] * 3));
      }
      this.wxTex.dispose();
      this.wxTex = new THREE.DataTexture(d, w.cols, w.rows, THREE.RGBAFormat);
      this.wxTex.magFilter = this.wxTex.minFilter = THREE.LinearFilter;
      this.wxTex.wrapS = THREE.RepeatWrapping;
      this.wxTex.needsUpdate = true;
      this.mat.uniforms.uWx.value = this.wxTex;
      this.mat.uniforms.uGrid.value.set(w.lat0, w.lon0, w.step, w.rows);
      this.mat.uniforms.uHaveWx.value = 1;
      onLoad();
    }).catch(() => {});
  }

  /** Camera distance (globe radii) that shows about as much as the flat map does at `zoom`. */
  static distance(zoom: number, cssHeight: number) {
    // Matches the flat map's scale where they cross-fade (z5); zoomed all the way out the globe still
    // fills about two thirds of the screen.
    return Math.min(3.3, 1 + ((cssHeight / 256) * 2 * Math.PI) / 2 ** zoom / (2 * Math.tan((20 * Math.PI) / 180)));
  }

  /** Point the camera at (lat, lon) from the distance for `zoom`. */
  setView(lat: number, lon: number, zoom: number, w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const D = Globe.distance(zoom, h);
    this.camera.position.copy(toVec(lat, lon)).multiplyScalar(D);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    // Real sun: subsolar point from today's date and the UTC time.
    const now = new Date();
    const doy = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5;
    const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
    const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
    this.mat.uniforms.uSun.value.copy(toVec(decl, -15 * (utcH - 12)));
    this.mat.uniforms.uLayers.value.set(this.layers.clouds ? 1 : 0, this.layers.storms ? 1 : 0, this.layers.wind ? 1 : 0);
    this.mat.uniforms.uTime.value = performance.now() / 1000;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /** The globe's radius on screen (CSS px). */
  radiusPx(w: number, h: number) {
    const D = this.camera.position.length();
    return (Math.tan(Math.asin(1 / D)) / Math.tan((this.camera.fov * Math.PI) / 360)) * (h / 2);
  }

  /** Lat/lon under a canvas point (CSS px), or null off the globe. */
  pick(x: number, y: number, w: number, h: number) {
    this.ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.sphere)[0];
    return hit ? fromVec(hit.point) : null;
  }

  /** Screen position (CSS px) of (lat, lon), and whether it's on the side facing us. */
  project(lat: number, lon: number, w: number, h: number) {
    const p = toVec(lat, lon);
    const facing = p.dot(this.camera.position.clone().sub(p)) > 0;
    const s = p.clone().project(this.camera);
    return { x: (s.x + 1) / 2 * w, y: (1 - s.y) / 2 * h, visible: facing };
  }

  dispose() {
    this.disposed = true;
    this.sphere.geometry.dispose(); this.mat.dispose(); this.satTex.dispose(); this.wxTex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

/** Unit vector for (lat, lon): +Y north, lon 0 toward +Z, east toward +X (matches the shader). */
export function toVec(lat: number, lon: number) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}
export function fromVec(v: THREE.Vector3) {
  const n = v.clone().normalize();
  return { lat: (Math.asin(n.y) * 180) / Math.PI, lon: (Math.atan2(n.x, n.z) * 180) / Math.PI };
}
