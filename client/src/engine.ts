import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Bloom } from './post/bloom.ts';
import { lights } from './post/lights.ts';
import { FinalPass } from './post/final.ts';
import { TemporalUpscale } from './post/taa.ts';
import { Clouds, SkyDome, SkylineRing, artSky, makeStars } from './sky.ts';
import { WeatherState, Precipitation, Lightning, Aurora } from './weather.ts';
import { AtmospherePass } from './atmosphere.ts';

export type QualityTier = 'ultra' | 'high' | 'low';

/**
 * A desktop GPU that can take Ultra: Apple silicon Macs, recent NVIDIA / AMD / Intel Arc cards.
 * Phones, tablets and integrated laptop graphics stay on High.
 */
function capableGpu() {
  try {
    const ua = navigator.userAgent;
    if (/Mobi|Android|iPhone|iPad|Quest|OculusBrowser/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return false;
    if ((navigator.hardwareConcurrency || 4) < 8) return false;
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/SwiftShader|llvmpipe|Software/i.test(name)) return false;
    // Safari only says "Apple GPU": on a Mac with 8+ cores that's Apple silicon.
    if (/Apple GPU/.test(name)) return /Macintosh/.test(ua);
    return /Apple M\d|RTX|Radeon RX ?[5-9]\d{3}|Radeon Pro|GTX 1[06-9]\d0|GTX 16\d0|Arc\(TM\) A|Arc A\d/i.test(name);
  } catch {
    return false;
  }
}

const Q = new URLSearchParams(location.search).get('q');
const TIER: QualityTier = Q === 'low' ? 'low' : Q === 'ultra' ? 'ultra' : Q === 'high' ? 'high' : capableGpu() ? 'ultra' : 'high';

/**
 * Rendering quality tier, from `?q=` (Settings writes it) or, with none, the GPU:
 *  - `ultra`: up to a 4K-sized frame (Retina, or supersampled on a 1080p screen), an 8K sun shadow
 *    map, SMAA on top of the multisampling, finer ambient occlusion, max texture filtering and a
 *    wider detailed city;
 *  - `high`: the standard look;
 *  - `low` (`?q=low`: slow GPUs, headless tests) or a VR headset: the costly extras off (big shadow
 *    maps, soft shadow filtering, AO). Read it; set `low` before a DayNight is built.
 */
export const quality = { low: TIER === 'low', ultra: TIER === 'ultra', tier: TIER };
document.documentElement.dataset.quality = TIER;

// Sharp ground, roads and facades at grazing angles (three clamps this to what the GPU supports).
THREE.Texture.DEFAULT_ANISOTROPY = TIER === 'ultra' ? 16 : TIER === 'high' ? 8 : 1;

/** Pixel ratio a tier asks for at this window size (Ultra: up to a 3840x2160-sized frame). */
function tierPixelRatio(w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  if (quality.low) return 0.6;
  if (!quality.ultra) return Math.min(dpr, 1.75);
  const k4 = Math.sqrt((3840 * 2160) / Math.max(1, w * h));
  return Math.max(1, Math.min(2, Math.max(dpr, 1.5), k4));
}

/** Uniforms shared by every procedural material (windows, streetlights...). */
export const shared = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  /** How wet the streets are (0 dry .. 1 soaked): rises within a minute of rain, dries over a few. */
  uWet: { value: 0 },
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

/** Draws the scene into its own (multisampled) target; the atmosphere pass picks it up from there. */
class ScenePass extends Pass {
  constructor(public scene: THREE.Scene, public camera: THREE.Camera, private target: THREE.WebGLRenderTarget) {
    super();
    this.needsSwap = false;
  }
  /** Set for a frame to time this pass on the GPU: called around the draw. */
  timer: { begin: () => void; end: () => void } | null = null;
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.target);
    this.timer?.begin();
    renderer.render(this.scene, this.camera);
    this.timer?.end();
  }
}

/** The post chain's share on top of the scene pass (measured: about a quarter of the frame's GPU time). */
const POST_SHARE = 1.3;
/** Fractions of the output resolution the scene may be drawn at (below 1, the temporal upscaler fills in). */
const SCALES = [1, 0.8, 0.67];
const TAA_Q = new URLSearchParams(location.search).get('taa');

export class Engine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  renderPass: ScenePass;
  /** Where the 3D scene is drawn: HDR color (alpha = 1 - reflection mask) and depth, multisampled. */
  sceneRT: THREE.WebGLRenderTarget;
  bloom: Bloom;
  /** Edge antialiasing on the final image (Ultra). */
  smaa: SMAAPass | null = null;
  /** Ambient occlusion, sun-lit haze, ground fog and light shafts (needs the scene's depth). */
  atmo: AtmospherePass;
  pmrem: THREE.PMREMGenerator;
  /** Bloom, tone mapping and the grade, in one pass (post/final.ts). Depth of field goes in before it. */
  grade: FinalPass;
  /** Rebuilds a full-resolution frame when the scene is drawn with fewer pixels (post/taa.ts). */
  upscaler: TemporalUpscale;
  /** The atmosphere's result at the scene's (reduced) resolution, for the upscaler. */
  private lowRT: THREE.WebGLRenderTarget;
  /** May the scene drop below output resolution and be upscaled? (`?taa=0` turns it off, `?taa=0.67` pins a scale.) */
  upscale = !quality.low && TAA_Q !== '0';
  /** Fraction of the output resolution the scene is drawn at. */
  renderScale = 1;
  private scaleCeil = 0;
  private scaleCeilUntil = 0;

  /** The scene currently being rendered (city or an interior). */
  scene: THREE.Scene;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // ?q=low renders at a lower resolution (slow GPUs, headless tests); Ultra at up to 4K.
    this.renderer.setPixelRatio(tierPixelRatio(window.innerWidth, window.innerHeight));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Neutral tone mapping: colors come out as painted (the art-directed sky and facades), only
    // highlights roll off.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 30000);
    this.scene = new THREE.Scene();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    // The scene is drawn off-screen, where the canvas's antialiasing doesn't apply, into its own
    // multisampled target (with the depth the post effects read). The composer's two buffers only ever
    // take full-screen passes, so they stay plain: no multisample resolve after each one.
    this.sceneRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: quality.low ? 0 : 4 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight, THREE.FloatType);
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.renderPass = new ScenePass(this.scene, this.camera, this.sceneRT);
    this.composer.addPass(this.renderPass);
    this.atmo = new AtmospherePass(this.camera, quality.low);
    this.atmo.scene = this.scene;
    this.atmo.source = this.sceneRT;
    this.composer.addPass(this.atmo);
    this.lowRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.upscaler = new TemporalUpscale();
    this.upscaler.enabled = false;
    this.composer.addPass(this.upscaler);
    const pin = Number(TAA_Q);
    if (this.upscale && pin > 0.3 && pin < 1) { this.renderScale = pin; this.pinned = true; }
    this.bloom = new Bloom();
    this.composer.addPass(this.bloom);
    this.grade = new FinalPass(this.bloom);
    if (quality.low) this.grade.uniforms.uSharpen.value = 0;
    // Ultra renders more pixels: less sharpening, so edges don't ring.
    if (quality.ultra) this.grade.uniforms.uSharpen.value = 0.16;
    this.composer.addPass(this.grade);
    if (quality.ultra) {
      // SMAA on the graded image catches what multisampling can't: shader edges (window frames,
      // mullions, road paint) and specular sparkle.
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
    this.gpuTimer = this.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
    this.resize();

    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
    this.renderPass.scene = scene;
    this.atmo.scene = scene;
    this.upscaler.reset();
  }
  private pinned = false;
  private sharpen0: number | undefined;

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    // Below full scale the scene is drawn smaller, unmultisampled (the upscaler does the smoothing),
    // and everything that reads its depth works at that size too.
    const up = this.renderScale < 1;
    const fw = Math.round(w * pr), fh = Math.round(h * pr);
    const rw = Math.max(1, Math.round(fw * this.renderScale)), rh = Math.max(1, Math.round(fh * this.renderScale));
    const samples = quality.low || up ? 0 : 4;
    if (this.sceneRT.samples !== samples) { this.sceneRT.samples = samples; this.sceneRT.dispose(); }
    this.sceneRT.setSize(rw, rh);
    this.lowRT.setSize(up ? rw : 1, up ? rh : 1);
    this.atmo.target = up ? this.lowRT : null;
    this.atmo.needsSwap = !up;
    this.atmo.setSize(rw, rh);
    this.upscaler.enabled = up;
    // Moving, an upscaled frame is a touch softer than a native one: a little more sharpening evens it out.
    this.sharpen0 ??= this.grade.uniforms.uSharpen.value;
    this.grade.uniforms.uSharpen.value = this.sharpen0 + (up ? 0.1 : 0);
    this.upscaler.source = this.lowRT;
    this.upscaler.depth = this.sceneRT.depthTexture;
    (this.grade.uniforms.uTexel.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
    // Supersampled 1.5x or more past the screen's own pixels, the edges are smooth already: SMAA
    // only earns its cost below that.
    if (this.smaa) this.smaa.enabled = pr / (window.devicePixelRatio || 1) < 1.5;
  }

  /**
   * Adaptive resolution: if frames run long for a couple of seconds, render fewer pixels (down to
   * 1x); when there's headroom, climb back up. Keeps flying smooth on big Retina screens. Where the
   * browser can time the GPU (Chrome, Firefox), headroom is judged from real GPU milliseconds, so a
   * step up is only taken if it should still fit in a 60 fps frame; elsewhere from the frame rate.
   */
  private frameMs = 16;
  private judge = 0;
  private lastFrame = 0;
  private gpuTimer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];
  /** GPU milliseconds per frame (smoothed), or 0 if the browser can't tell. */
  gpuMs = 0;
  /** Time the GPU per frame (tests turn it off to run their own timer). */
  gpuTiming = true;
  private calm = 0;
  private ceiling = 0;
  private ceilingUntil = 0;
  maxPixelRatio = 0;
  render() {
    // In VR the headset sets the resolution and post-processing doesn't run per eye: draw straight out.
    if (this.renderer.xr.isPresenting) { lights.enabled = false; this.renderer.render(this.scene, this.camera); return; }
    const now = performance.now();
    if (this.lastFrame) {
      const dt = Math.min(200, now - this.lastFrame);
      this.frameMs += (dt - this.frameMs) * 0.05;
      this.judge += dt;
      if (this.judge > 2000) {
        this.judge = 0;
        if (!this.maxPixelRatio) this.maxPixelRatio = this.renderer.getPixelRatio();
        const pr = this.renderer.getPixelRatio();
        const gpu = this.gpuTiming ? this.gpuMs : 0;
        let next = pr;
        // Frames are missing 60 fps, and (where we can tell) the GPU is what's holding them up:
        // when the CPU is the bottleneck (a dense city's draw calls), fewer pixels wouldn't help.
        const slow = this.frameMs > 21 && (!gpu || gpu > this.frameMs * 0.7);
        const si = SCALES.indexOf(this.renderScale);
        let scale = this.renderScale;
        if (slow && this.upscale && !this.pinned && si >= 0 && si < SCALES.length - 1) {
          // First draw fewer pixels and rebuild the full frame from several: it costs far less sharpness
          // than shrinking the output.
          scale = SCALES[si + 1];
          this.scaleCeil = this.renderScale; this.scaleCeilUntil = now + 45000; this.calm = 0;
        } else if (slow && pr > 1) {
          next = Math.max(1, pr - (this.frameMs > 30 ? 0.5 : 0.25));
          // Don't climb straight back to a resolution that didn't hold up.
          this.ceiling = pr; this.ceilingUntil = now + 45000; this.calm = 0;
        } else if (pr < this.maxPixelRatio) {
          const up = Math.min(this.maxPixelRatio, pr + 0.25);
          // Cost scales with pixel count: will the next step still fit in a 60 fps frame (with a margin)?
          const fits = gpu ? this.frameMs < 18 && gpu * (up / pr) ** 2 < 14 : this.frameMs < 14;
          const banned = now < this.ceilingUntil && up >= this.ceiling;
          this.calm = fits && !banned ? this.calm + 1 : 0;
          if (this.calm >= 2) { next = up; this.calm = 0; }
        } else if (si > 0 && !this.pinned) {
          const up = SCALES[si - 1];
          const fits = gpu ? this.frameMs < 18 && gpu * (up / scale) ** 2 * (up === 1 ? 1.5 : 1) < 14 : this.frameMs < 14;
          const banned = now < this.scaleCeilUntil && up >= this.scaleCeil;
          this.calm = fits && !banned ? this.calm + 1 : 0;
          if (this.calm >= 2) { scale = up; this.calm = 0; }
        }
        if (next !== pr || scale !== this.renderScale) {
          this.renderScale = scale;
          this.renderer.setPixelRatio(next);
          this.composer.setPixelRatio(next);
          this.resize();
        }
      }
    }
    this.lastFrame = now;
    const ext = this.gpuTiming ? this.gpuTimer : null;
    if (this.upscaler.enabled) this.upscaler.begin(this.camera, this.sceneRT.width, this.sceneRT.height);
    if (!ext) { this.renderPass.timer = null; this.composer.render(); this.upscaler.end(); return; }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    // Collect finished timings (they arrive a frame or two late).
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.queries.shift()!;
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) * POST_SHARE;
        this.gpuMs = this.gpuMs ? this.gpuMs + (ms - this.gpuMs) * 0.1 : ms;
      }
      gl.deleteQuery(q);
    }
    // Only the scene pass is timed (shadows and the multisampled draw: where the pixels go). A timer
    // around the whole chain also counts the gaps between its many small passes and reads far too high.
    if (this.queries.length > 4) this.renderPass.timer = null;
    else {
      this.renderPass.timer ??= {
        begin: () => { const q = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, q); this.queries.push(q); },
        end: () => gl.endQuery(ext.TIME_ELAPSED_EXT),
      };
    }
    this.composer.render();
    this.upscaler.end();
  }
}


const OVERCAST = new THREE.Color(), STORMY = new THREE.Color();
const SNOWY = new THREE.Color(0xdfe3e8), DUSTY = new THREE.Color(0xc9a878), FLASH = new THREE.Color(0xe6ecff);
const HAZE = new THREE.Color(), _grey = new THREE.Color();
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
/** Scene haze relative to the place's fog density: thick enough that the skyline fades into the sky's color, as in the game this is styled after. */
const FOG_K = 0.62;

/** Sun, moon, physically based sky, clouds, haze and environment lighting, driven by a 24h clock. */
export class DayNight {
  hour = 16.5;
  speed = 1 / 60; // game hours per real second (1 game day = 24 real minutes)
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3226, 0.6);
  /** Show the cloud layer. */
  clouds = true;
  /** Half-width of the sun's shadow frustum, in meters (the world widens it with altitude). */
  shadowReach = 150;
  readonly dome: SkyDome;
  readonly cloudLayer: Clouds;
  stars: THREE.Points;
  private skyScene = new THREE.Scene();
  private envGround: THREE.Mesh;
  /** The buildings around you, for reflections (the streaming world fills in its profile). */
  readonly skyline = new SkylineRing();
  private skylineDirty = false;
  private lastBake = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -99;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private art = artSky(30);
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
  /** How misty mornings are (0 never, 1 a ground fog most calm mornings). */
  mist = 1;
  private lapse = false;
  private baseSpeed = 1 / 60;
  private envWeather = -1;
  private windV = new THREE.Vector2();

  constructor(private engine: Engine, private scene: THREE.Scene, private look: SkyLook) {
    this.dome = new SkyDome(1000);
    scene.add(this.dome.mesh);
    this.skyScene.add(this.dome.clone());
    // The reflection environment needs ground below the horizon (dim, warm), not more sky, or every
    // underside and shadow picks up a blue glow.
    this.envGround = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 12, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03),
      new THREE.MeshBasicMaterial({ color: 0x222018, side: THREE.BackSide, fog: false }),
    );
    this.skyScene.add(this.envGround);
    this.skyline.mesh.renderOrder = 1;
    this.skyScene.add(this.skyline.mesh);

    this.cloudLayer = new Clouds();
    this.cloudLayer.cover = look.cloudCover ?? 0.55;
    scene.add(this.cloudLayer.mesh);

    this.sun.castShadow = true;
    // Ultra: an 8K map, so shadows stay crisp (railings, lamp posts, people) across the whole frustum.
    const ultraMap = quality.ultra && engine.renderer.capabilities.maxTextureSize >= 8192;
    const map = quality.low ? 2048 : ultraMap ? 8192 : 4096;
    this.sun.shadow.mapSize.set(map, map);
    const s = this.sun.shadow.camera;
    s.left = -150; s.right = 150; s.top = 150; s.bottom = -150; s.near = 10; s.far = 2600;
    this.sun.shadow.bias = -0.0003;
    // Finer texels need less offset: contact shadows tuck in closer under ledges and feet.
    this.sun.shadow.normalBias = ultraMap ? 0.25 : 0.4;
    this.sun.shadow.radius = quality.low ? 1 : 2.5;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.stars = makeStars(900);
    scene.add(this.stars);
    this.weather.baseCover = this.weather.cover = look.cloudCover ?? 0.55;
    scene.add(this.precip.mesh, this.lightning.group, this.aurora.mesh);

    scene.fog = new THREE.FogExp2(new THREE.Color(), look.fogDensity * FOG_K);
    scene.background = this.background;
    engine.atmo.outdoor = scene;
    this.apply(true);
  }

  get night() { return shared.uNight.value; }

  /** The skyline profile changed (you moved): rebake the reflections soon. */
  skylineChanged() { this.skylineDirty = true; }

  /** Where we are: the weather follows the real conditions there (in live mode), auroras the latitude. */
  setLocation(lat: number, lon: number) {
    this.lat = lat;
    this.realSun = true;
    this.weather.setLocation(lat, lon);
  }
  /** Follow the real sun for `lat` and today's date (the streaming world); otherwise the place's stylized arc. */
  private realSun = false;
  private declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear(new Date()) + 10));

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
    // Streets get wet quickly in rain (and melting snow) and dry off slowly after.
    {
      const want = Math.min(1, w.rain * 1.2 + w.snow * 0.35), wet = shared.uWet;
      const rate = (want > wet.value ? 1 / 40 : 1 / 240) * (this.lapse ? 20 : 1);
      wet.value += THREE.MathUtils.clamp(want - wet.value, -rate * dt, rate * dt);
    }
    this.apply(false);
    // Keep the shadow frustum around the player (wider when flying), snapped to texels to avoid shimmering.
    const reach = Math.round(this.shadowReach / 20) * 20;
    const sc = this.sun.shadow.camera;
    if (sc.right !== reach) {
      sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach;
      sc.updateProjectionMatrix();
    }
    const snap = ((reach * 2) / this.sun.shadow.mapSize.x) * 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 1200);
    // Sky things ride along with the camera.
    const cam = this.engine.camera;
    // Thinner haze when looking down from altitude (the air is clearer above the city).
    // Weather thickens it: rain and snow a little, fog and dust a lot (and they hug the ground).
    const thick = 1 + w.fog / (1 + Math.max(0, cam.position.y) / 300);
    // From a shuttle at 9 km the haze thins out a lot more (you see the coast 50 km off), not just a bit.
    const up = Math.max(0, cam.position.y);
    (this.scene.fog as THREE.FogExp2).density = this.look.fogDensity * FOG_K * thick / (1 + up / 1400 + (up / 2500) ** 2);
    // Ground fog: mist lying in the streets on calm mornings (the towers rise out of it), and real fog.
    const at = this.engine.atmo, hr = this.hour;
    const morning = THREE.MathUtils.smoothstep(hr, 4.5, 6.2) * (1 - THREE.MathUtils.smoothstep(hr, 8.3, 10.5));
    const calm = THREE.MathUtils.clamp(1 - (w.windSpeed - 10) / 25, 0, 1);
    const foggy = Math.min(1, w.fog / 110);
    at.ground = (0.006 * morning * calm * this.mist + foggy * 0.01) * (1 - w.dust * 0.5);
    at.groundH = 20 + foggy * 45;
    at.fogDensity = (this.scene.fog as THREE.FogExp2).density;
    this.dome.mesh.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.cloudLayer.cover = w.cover;
    // The volumetric layer takes over from the sprite clouds where the post chain runs (not VR, not low).
    const vol = at.clouds;
    vol.cover = this.clouds ? w.cover : 0;
    vol.storm = w.dark;
    const volOn = at.cloudsActive() && !this.engine.renderer.xr.isPresenting;
    this.cloudLayer.mesh.visible = this.clouds && this.cloudLayer.cover > 0 && !volOn;
    // Clouds ride the wind (a bit faster aloft; racing in a time-lapse).
    w.windVector(this.windV).multiplyScalar(1.6 * (this.lapse ? 12 : 1));
    if (this.windV.lengthSq() < 1) this.windV.set(3, 1.2);
    this.cloudLayer.wind.copy(this.windV);
    this.cloudLayer.update(dt, cam);
    vol.wind.addScaledVector(this.windV, dt);
    w.windVector(this.windV);
    this.precip.update(dt, cam, w.rain, w.snow, this.windV, this.night);
    this.lightning.update(dt, w.storm, cam.position);
    this.aurora.update(dt, cam.position, this.night, this.lat, w.cover > 0.9 ? w.cover : w.cover * 0.5, this.auroraAlways);
  }

  private apply(force: boolean) {
    const h = this.hour;
    let elevDeg: number, az: number;
    if (this.realSun) {
      // Solar position from latitude, declination and the hour angle (the clock reads local solar time).
      const D = THREE.MathUtils.DEG2RAD, lat = this.lat * D, dec = this.declination * D, ha = (h - 12) * 15 * D;
      const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
      // Azimuth clockwise from north.
      const azN = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
      elevDeg = el / D;
      // Local frame: x east, z south.
      this.sunDir.set(Math.sin(azN) * Math.cos(el), Math.sin(el), -Math.cos(azN) * Math.cos(el));
      az = Math.atan2(this.sunDir.x, this.sunDir.z);
    } else {
      elevDeg = Math.sin(((h - 6) / 12) * Math.PI) * this.look.maxElevation;
      az = THREE.MathUtils.degToRad(this.look.sunAzimuth + (h - 12) * 15);
      this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), az);
    }
    // The moon rides opposite the sun, a little off-axis so it isn't straight overhead at midnight.
    this.moonDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 + elevDeg * 0.8 + 0), az + Math.PI * 0.85);
    if (this.moonDir.y < 0.15) this.moonDir.y = 0.15;
    this.moonDir.normalize();

    const night = 1 - THREE.MathUtils.smoothstep(elevDeg, -6, 4);
    shared.uNight.value = night;
    // The painted sky: blue days, periwinkle-and-peach sunsets, navy nights.
    const a = artSky(elevDeg, this.art);
    // Haze between the sun-side and far-side horizon colors (fog is one color for the whole view).
    const haze = HAZE.copy(a.horizon).lerp(a.horizonSun, 0.35);
    // Weather: overcast skies go grey, storms go dark, dust goes tan, snow goes bright white-grey.
    const w = this.weather, flash = this.lightning.flash;
    const grey = THREE.MathUtils.clamp(Math.max(0, w.cover - 0.6) * 2.2 + w.fog * 0.03, 0, 1) * (0.4 + w.dark);
    const dayLum = THREE.MathUtils.clamp(haze.r * 0.3 + haze.g * 0.59 + haze.b * 0.11, 0.02, 1.2);
    const overcast = OVERCAST.set(0xa3a9b1).multiplyScalar(dayLum * 1.1).lerp(SNOWY, w.snow * 0.8 * (1 - night)).multiplyScalar(1 - w.dark * 0.45 * (1 - w.snow));
    overcast.lerp(DUSTY, w.dust * (1 - night)).multiplyScalar(1 - night * 0.85);
    const g = Math.min(1, grey + w.dust * 0.7);
    a.zenith.lerp(overcast, g); a.horizon.lerp(overcast, g); a.horizonSun.lerp(overcast, g);
    haze.lerp(overcast, Math.min(1, g * 0.9 + w.fog * 0.02));
    a.cloudLit.lerp(overcast, w.dark * 0.6).multiplyScalar(1 - w.dark * 0.25);
    a.cloudShade.lerp(STORMY.set(0x4a5058).multiplyScalar(1 - night * 0.7), w.dark * 0.8);
    if (flash > 0) for (const k of [a.zenith, a.horizon, a.horizonSun, haze]) k.lerp(FLASH, flash * 0.6);

    const u = this.dome.uniforms;
    u.uZenith.value.copy(a.zenith);
    u.uHorizon.value.copy(a.horizon);
    u.uHorizonSun.value.copy(a.horizonSun);
    u.uHaze.value.copy(haze);
    u.uGlow.value.copy(a.glow);
    u.uGlowAmt.value = a.glowAmount * (1 - g);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uSunColor.value.copy(a.sun);
    u.uNight.value = night;
    u.uSunVis.value = THREE.MathUtils.smoothstep(elevDeg, -2.5, 0.5);
    u.uFlat.value = Math.min(1, g + flash * 0.6);

    // Sunlight in the palette's color; after dark a dim blue moonlight casts the shadows.
    const day = THREE.MathUtils.smoothstep(elevDeg, -1.5, 6);
    if (day > 0.02) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.06) { this.lightDir.y = 0.06; this.lightDir.normalize(); }
      this.sun.color.copy(a.sun);
      this.sun.intensity = 3.4 * (0.72 + 0.28 * day);
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.set(0x9fb4ff);
      this.sun.intensity = 0.5 * night;
    }
    // Under heavy cloud the sun barely gets through: softer light, weaker shadows.
    this.sun.intensity *= 1 - Math.min(0.93, g * 1.05);
    this.sun.castShadow = this.sun.intensity > 0.1;
    // Bright, sky-colored fill: shade reads lavender-grey at dusk and soft blue by day, never black.
    this.hemi.color.copy(a.hemiSky).lerp(_grey.setScalar(a.hemiSky.r * 0.3 + a.hemiSky.g * 0.59 + a.hemiSky.b * 0.11), this.realSun ? 0.55 : 0.8).lerp(overcast, g * 0.5);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = THREE.MathUtils.lerp(this.look.ambient ?? 1.8, 0.9, night) * (1 - w.dark * 0.3) * (1 + g * 0.5) + flash * 3;

    const cl = this.cloudLayer.uniforms;
    cl.uSunDir.value.copy(day > 0.02 ? this.sunDir : this.moonDir);
    cl.uLit.value.copy(a.cloudLit);
    cl.uShade.value.copy(a.cloudShade);
    cl.uHaze.value.copy(haze);
    const vc = this.engine.atmo.clouds;
    vc.sunDir.copy(cl.uSunDir.value); vc.lit.copy(a.cloudLit); vc.shade.copy(a.cloudShade); vc.haze.copy(haze);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(night, 0.5, 1) * 0.95 * (1 - g);

    (this.envGround.material as THREE.MeshBasicMaterial).color.copy(a.hemiGround).multiplyScalar(0.8);
    // Facades in the reflections: sunlit stone, shade that takes the sky's color, glass that mirrors it.
    const sk = this.skyline.uniforms, lum = 1 - night * 0.97;
    sk.uLit.value.setRGB(0.6, 0.57, 0.52).multiply(a.sun).multiplyScalar(lum * (1 - Math.min(0.7, g)));
    sk.uShade.value.copy(a.hemiSky).multiplyScalar(0.32 * lum).lerp(sk.uLit.value, g * 0.4);
    sk.uGlass.value.copy(a.zenith).lerp(haze, 0.4).multiplyScalar(0.55 * lum).addScalar(0.01);
    sk.uHaze.value.copy(haze);
    sk.uGround.value.copy(a.hemiGround).multiplyScalar(0.8);
    sk.uSunDir.value.copy(this.sunDir);
    sk.uNight.value = night;
    sk.uFog.value = (this.scene.fog as THREE.FogExp2 | null)?.density ?? 0.0004;
    // Haze matches the horizon so distant buildings melt into the sky.
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(haze);
    // Post effects: the haze and ground fog take the horizon color and are lit by the (cloud-dimmed) sun.
    const at = this.engine.atmo;
    at.haze.copy(haze);
    at.sunDir.copy(this.sunDir);
    at.sunColor.copy(a.horizonSun).multiplyScalar(day * (1 - Math.min(0.95, g * 1.1)));
    // The night's lamps come up at dusk. What a white wall reads under the ambient alone, so the
    // light pass can tell a surface's color from its (dimly lit) pixel.
    at.lightGain = night;
    at.ambientRef = Math.max(0.03, (this.hemi.intensity * (this.hemi.color.r * 0.3 + this.hemi.color.g * 0.59 + this.hemi.color.b * 0.11)) / Math.PI * 0.8 + night * 0.06);
    at.reflections.rain = w.rain;
    // Cloud shadows on a day of broken cloud; under a solid deck the whole light is already dimmed.
    at.cloudShadow = day * (1 - Math.min(1, g * 1.4)) * 0.9;
    // Eyes open up in the dark, but night should stay night.
    at.exposure.max = THREE.MathUtils.lerp(1.7, 1.3, night);
    this.background.copy(haze);
    this.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.25, night);
    this.engine.bloom.strength = THREE.MathUtils.lerp(0.06, 0.17, night);

    // Re-bake the reflection environment every ~15 game minutes.
    const wk = g + flash * 0.5;
    const now = performance.now();
    if (force || Math.abs(h - this.lastEnvHour) > 0.25 || Math.abs(wk - this.envWeather) > 0.15 || (this.skylineDirty && now - this.lastBake > 3000)) {
      this.skylineDirty = false;
      this.lastBake = now;
      this.envWeather = wk;
      this.lastEnvHour = h;
      const old = this.envRT;
      this.envRT = this.engine.pmrem.fromScene(this.skyScene, 0, 0.1, 5000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = THREE.MathUtils.lerp(this.look.envLight ?? 0.75, 0.5, night);
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
