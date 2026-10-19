import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  pmrem: THREE.PMREMGenerator;

  /** The scene currently being rendered (city or an interior). */
  scene: THREE.Scene;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
    this.scene = new THREE.Scene();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

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

  render() {
    this.composer.render();
  }
}

/** Sun, sky, stars, fog and environment lighting, driven by a 24h clock. */
export class DayNight {
  hour = 16.5;
  speed = 1 / 60; // game hours per real second (1 game day = 24 real minutes)
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3226, 0.6);
  sky = new Sky();
  stars: THREE.Points;
  private skyScene = new THREE.Scene();
  private skyForEnv = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -99;
  private sunDir = new THREE.Vector3();
  private nightSky = new THREE.Color(0x0a1322);

  constructor(private engine: Engine, private scene: THREE.Scene, private look: SkyLook) {
    this.sky.scale.setScalar(4500);
    scene.add(this.sky);
    this.skyForEnv.scale.setScalar(4500);
    this.skyScene.add(this.skyForEnv);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -140; s.right = 140; s.top = 140; s.bottom = -140; s.near = 10; s.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);

    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 2500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(4000);
      pts.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);

    scene.fog = new THREE.FogExp2(look.fogColorDay.clone(), look.fogDensity);
    this.apply(true);
  }

  get night() { return shared.uNight.value; }

  update(dt: number, focus: THREE.Vector3) {
    this.hour = (this.hour + dt * this.speed) % 24;
    this.apply(false);
    // Keep the shadow frustum around the player, snapped to texels to avoid shimmering.
    const snap = (280 / 2048) * 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 400);
  }

  private apply(force: boolean) {
    const h = this.hour;
    const elevDeg = Math.sin(((h - 6) / 12) * Math.PI) * this.look.maxElevation;
    const az = THREE.MathUtils.degToRad(this.look.sunAzimuth + (h - 12) * 15);
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elevDeg, -12));
    this.sunDir.setFromSphericalCoords(1, phi, az);

    const night = 1 - THREE.MathUtils.smoothstep(elevDeg, -6, 6);
    shared.uNight.value = night;
    const golden = THREE.MathUtils.smoothstep(elevDeg, -2, 4) * (1 - THREE.MathUtils.smoothstep(elevDeg, 6, 22));

    for (const sky of [this.sky, this.skyForEnv]) {
      const u = sky.material.uniforms;
      u.turbidity.value = this.look.turbidity;
      u.rayleigh.value = this.look.rayleigh * (1 + golden);
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      u.sunPosition.value.copy(this.sunDir);
    }

    const sunUp = Math.max(0, Math.sin(THREE.MathUtils.degToRad(elevDeg)));
    this.sun.intensity = 2.5 * THREE.MathUtils.smoothstep(elevDeg, -1, 10);
    this.sun.color.setRGB(1, 0.78 + 0.22 * sunUp, 0.55 + 0.45 * sunUp);
    this.sun.castShadow = elevDeg > 0;
    this.hemi.intensity = THREE.MathUtils.lerp(0.45, 0.5, night);
    this.hemi.color.setRGB(THREE.MathUtils.lerp(0.75, 0.36, night), THREE.MathUtils.lerp(0.85, 0.42, night), THREE.MathUtils.lerp(1.0, 0.62, night));
    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.9;
    // The scattering sky goes pure black after dusk; swap to a moonlit navy backdrop.
    this.sky.visible = night < 0.9;
    this.scene.background = this.nightSky;

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.look.fogColorDay).lerp(this.look.fogColorNight, night);
    if (golden > 0) fog.color.lerp(new THREE.Color(0xf2a272), golden * 0.35);
    this.nightSky.copy(fog.color);
    this.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.72, 0.6, night);
    this.engine.bloom.strength = THREE.MathUtils.lerp(0.15, 0.5, night);

    // Re-bake the reflection environment every ~15 game minutes.
    if (force || Math.abs(h - this.lastEnvHour) > 0.25) {
      this.lastEnvHour = h;
      const old = this.envRT;
      this.envRT = this.engine.pmrem.fromScene(this.skyScene, 0, 0.1, 5000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = THREE.MathUtils.lerp(0.6, 0.35, night);
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
