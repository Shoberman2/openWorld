import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Clouds, SkyDome, makeStars, skyColors } from './sky.ts';
import { WeatherState, Precipitation, Lightning, Aurora } from './weather.ts';

/** Uniforms shared by every procedural material (windows, streetlights...). */
export const shared = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

export interface SkyLook {
  turbidity: number;
  rayleigh: number;
  fogColorDay: THREE.Color;
  fogColorNight: THREE.Color;
  fogDensity: number;
  sunAzimuth: number; // degrees
  maxElevation: number; // degrees
  /** Fraction of the sky with puffy clouds (0..1). Default 0.55. */
  cloudCover?: number;
  /** Daytime sky-reflection (environment) light. The streaming world keeps it low so shade stays neutral grey; the classic cities' darker materials want more. */
  envLight?: number;
  /** Daytime hemisphere (ambient) light. */
  ambient?: number;
}

/** Gentle "storybook" grade on the final image: a touch more saturation and contrast, soft vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.12 }, uContrast: { value: 1.04 }, uVignette: { value: 0.18 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class Engine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  pmrem: THREE.PMREMGenerator;
  grade: ShaderPass;

  /** The scene currently being rendered (city or an interior). */
  scene: THREE.Scene;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // ?q=low renders at a lower resolution (slow GPUs, headless tests).
    const low = new URLSearchParams(location.search).get('q') === 'low';
    this.renderer.setPixelRatio(low ? 0.6 : Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 30000);
    this.scene = new THREE.Scene();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
    this.renderPass.scene = scene;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /**
   * Adaptive resolution: if frames run long for a couple of seconds, render fewer pixels (down to
   * 1x); when there's headroom, climb back up. Keeps flying smooth on big Retina screens.
   */
  private frameMs = 16;
  private judge = 0;
  private lastFrame = 0;
  maxPixelRatio = 0;
  render() {
    const now = performance.now();
    if (this.lastFrame) {
      const dt = Math.min(200, now - this.lastFrame);
      this.frameMs += (dt - this.frameMs) * 0.05;
      this.judge += dt;
      if (this.judge > 2000) {
        this.judge = 0;
        if (!this.maxPixelRatio) this.maxPixelRatio = this.renderer.getPixelRatio();
        const pr = this.renderer.getPixelRatio();
        let next = pr;
        if (this.frameMs > 24 && pr > 1) next = Math.max(1, pr - 0.25);
        else if (this.frameMs < 14 && pr < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, pr + 0.25);
        if (next !== pr) {
          this.renderer.setPixelRatio(next);
          this.composer.setPixelRatio(next);
          this.resize();
        }
      }
    }
    this.lastFrame = now;
    this.composer.render();
  }
}


const OVERCAST = new THREE.Color(), STORMY = new THREE.Color();
const SNOWY = new THREE.Color(0xdfe3e8), DUSTY = new THREE.Color(0xc9a878), FLASH = new THREE.Color(0xe6ecff);

/** Sun, moon, stylized sky, puffy clouds, haze and environment lighting, driven by a 24h clock. */
export class DayNight {
  hour = 16.5;
  speed = 1 / 60; // game hours per real second (1 game day = 24 real minutes)
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3226, 0.6);
  /** Show the cloud layer. */
  clouds = true;
  readonly dome: SkyDome;
  readonly cloudLayer: Clouds;
  stars: THREE.Points;
  private skyScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -99;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private colors = skyColors(30);
  private background = new THREE.Color();
  /** Live (or hand-set) weather: clouds, rain/snow, fog, storms, dust. */
  readonly weather = new WeatherState();
  readonly precip = new Precipitation();
  readonly lightning = new Lightning();
  readonly aurora = new Aurora();
  /** Latitude of the place (auroras, live weather). */
  lat = 40;
  /** Force an aurora tonight regardless of the odds. */
  auroraAlways = false;
  private lapse = false;
  private baseSpeed = 1 / 60;
  private envWeather = -1;
  private windV = new THREE.Vector2();

  constructor(private engine: Engine, private scene: THREE.Scene, private look: SkyLook) {
    this.dome = new SkyDome(1000);
    scene.add(this.dome.mesh);
    this.skyScene.add(this.dome.clone());

    this.cloudLayer = new Clouds();
    this.cloudLayer.cover = look.cloudCover ?? 0.55;
    scene.add(this.cloudLayer.mesh);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -150; s.right = 150; s.top = 150; s.bottom = -150; s.near = 10; s.far = 1200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.stars = makeStars(900);
    scene.add(this.stars);
    this.weather.baseCover = this.weather.cover = look.cloudCover ?? 0.55;
    scene.add(this.precip.mesh, this.lightning.group, this.aurora.mesh);

    scene.fog = new THREE.FogExp2(new THREE.Color(), look.fogDensity * 0.35);
    scene.background = this.background;
    this.apply(true);
  }

  get night() { return shared.uNight.value; }

  /** Where we are: the weather follows the real conditions there (in live mode), auroras the latitude. */
  setLocation(lat: number, lon: number) {
    this.lat = lat;
    this.weather.setLocation(lat, lon);
  }

  /** Hand-set weather ('live' goes back to the real conditions). */
  setWeather(kind: Parameters<WeatherState['setWeather']>[0] | 'live', intensity = 1) {
    if (kind === 'live') this.weather.live();
    else this.weather.setWeather(kind, intensity);
  }

  /** Time-lapse: the clock runs 40x and the clouds race across the sky. */
  timelapse(on: boolean) {
    if (on === this.lapse) return;
    if (on) this.baseSpeed = this.speed;
    this.lapse = on;
    this.speed = on ? this.baseSpeed * 40 : this.baseSpeed;
  }
  get timelapsing() { return this.lapse; }

  /** Fraction of the sky covered by clouds (0..1). */
  get cloudCover() { return this.cloudLayer.cover; }
  set cloudCover(v: number) { this.cloudLayer.cover = v; }

  update(dt: number, focus: THREE.Vector3) {
    this.hour = (this.hour + dt * this.speed) % 24;
    shared.uTime.value += dt;
    const w = this.weather;
    w.update(this.lapse ? dt * 8 : dt, focus.y);
    this.apply(false);
    // Keep the shadow frustum around the player, snapped to texels to avoid shimmering.
    const snap = (300 / 2048) * 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 500);
    // Sky things ride along with the camera.
    const cam = this.engine.camera;
    // Thinner haze when looking down from altitude (the air is clearer above the city).
    // Weather thickens it: rain and snow a little, fog and dust a lot (and they hug the ground).
    const thick = 1 + w.fog / (1 + Math.max(0, cam.position.y) / 300);
    (this.scene.fog as THREE.FogExp2).density = this.look.fogDensity * 0.35 * thick / (1 + Math.max(0, cam.position.y) / 500);
    this.dome.mesh.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.cloudLayer.cover = w.cover;
    this.cloudLayer.mesh.visible = this.clouds && this.cloudLayer.cover > 0;
    // Clouds ride the wind (a bit faster aloft; racing in a time-lapse).
    w.windVector(this.windV).multiplyScalar(1.6 * (this.lapse ? 12 : 1));
    if (this.windV.lengthSq() < 1) this.windV.set(3, 1.2);
    this.cloudLayer.wind.copy(this.windV);
    this.cloudLayer.update(dt, cam);
    w.windVector(this.windV);
    this.precip.update(dt, cam, w.rain, w.snow, this.windV, this.night);
    this.lightning.update(dt, w.storm, cam.position);
    this.aurora.update(dt, cam.position, this.night, this.lat, w.cover > 0.9 ? w.cover : w.cover * 0.5, this.auroraAlways);
  }

  private apply(force: boolean) {
    const h = this.hour;
    const elevDeg = Math.sin(((h - 6) / 12) * Math.PI) * this.look.maxElevation;
    const az = THREE.MathUtils.degToRad(this.look.sunAzimuth + (h - 12) * 15);
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    this.sunDir.setFromSphericalCoords(1, phi, az);
    // The moon rides opposite the sun, a little off-axis so it isn't straight overhead at midnight.
    this.moonDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 + elevDeg * 0.8 + 0), az + Math.PI * 0.85);
    if (this.moonDir.y < 0.15) this.moonDir.y = 0.15;
    this.moonDir.normalize();

    const night = 1 - THREE.MathUtils.smoothstep(elevDeg, -6, 4);
    shared.uNight.value = night;
    const c = skyColors(elevDeg, this.colors);
    // Weather: overcast skies go grey, storms go dark, dust goes tan, snow goes bright white-grey.
    const w = this.weather, flash = this.lightning.flash;
    const grey = THREE.MathUtils.clamp(Math.max(0, w.cover - 0.6) * 2.2 + w.fog * 0.03, 0, 1) * (0.4 + w.dark);
    const overcast = OVERCAST.set(0x9aa4ae).lerp(SNOWY, w.snow * 0.8).multiplyScalar(1 - w.dark * 0.45 * (1 - w.snow));
    overcast.lerp(DUSTY, w.dust).multiplyScalar(1 - night * 0.8);
    const g = Math.min(1, grey + w.dust * 0.7);
    c.zenith.lerp(overcast, g); c.horizon.lerp(overcast, Math.min(1, g * 0.9 + w.fog * 0.02));
    c.glowAmount *= 1 - g;
    c.cloudLit.lerp(overcast, w.dark * 0.6).multiplyScalar(1 - w.dark * 0.25);
    c.cloudShade.lerp(STORMY.set(0x4f5660).multiplyScalar(1 - night * 0.7), w.dark * 0.8);
    if (flash > 0) { c.zenith.lerp(FLASH, flash * 0.6); c.horizon.lerp(FLASH, flash * 0.6); }

    const u = this.dome.uniforms;
    u.uZenith.value.copy(c.zenith);
    u.uHorizon.value.copy(c.horizon);
    u.uGlow.value.copy(c.glow);
    u.uGlowAmt.value = c.glowAmount;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uSunColor.value.copy(c.sunLight);
    u.uNight.value = night;
    u.uSunVis.value = THREE.MathUtils.smoothstep(elevDeg, -2.5, 0.5);

    // Daylight from the sun; after dark a dim blue moonlight casts the shadows.
    const day = THREE.MathUtils.smoothstep(elevDeg, -1, 8);
    if (day > 0.02) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.06) { this.lightDir.y = 0.06; this.lightDir.normalize(); }
      this.sun.color.copy(c.sunLight);
      this.sun.intensity = 2.5 * day;
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.set(0x9fb4ff);
      this.sun.intensity = 0.7 * night;
    }
    // Under heavy cloud the sun barely gets through: softer light, weaker shadows.
    this.sun.intensity *= 1 - Math.min(0.93, g * 1.05);
    this.sun.castShadow = this.sun.intensity > 0.1;
    this.hemi.color.copy(c.hemiSky).lerp(overcast, g * 0.5);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = THREE.MathUtils.lerp(this.look.ambient ?? 2.3, 0.55, night) * (1 - w.dark * 0.3) + flash * 3;

    const cl = this.cloudLayer.uniforms;
    cl.uSunDir.value.copy(day > 0.02 ? this.sunDir : this.moonDir);
    cl.uLit.value.copy(c.cloudLit);
    cl.uShade.value.copy(c.cloudShade);
    cl.uHaze.value.copy(c.horizon);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(night, 0.5, 1) * 0.95;

    // Haze matches the horizon so distant buildings melt into the sky.
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(c.horizon);
    this.background.copy(c.horizon);
    this.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 0.9, night);
    this.engine.bloom.strength = THREE.MathUtils.lerp(0.12, 0.45, night);

    // Re-bake the reflection environment every ~15 game minutes.
    const wk = g + flash * 0.5;
    if (force || Math.abs(h - this.lastEnvHour) > 0.25 || Math.abs(wk - this.envWeather) > 0.15) {
      this.envWeather = wk;
      this.lastEnvHour = h;
      const old = this.envRT;
      this.envRT = this.engine.pmrem.fromScene(this.skyScene, 0, 0.1, 5000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = THREE.MathUtils.lerp(this.look.envLight ?? 0.14, 0.2, night);
      old?.dispose();
    }
  }

  label() {
    const hh = Math.floor(this.hour), mm = Math.floor((this.hour - hh) * 60);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
  }
}
