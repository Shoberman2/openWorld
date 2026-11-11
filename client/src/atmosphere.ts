import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';
import { Reflections } from './post/reflect.ts';
import { LightField, lights } from './post/lights.ts';
import { AutoExposure } from './post/exposure.ts';
import { CLOUD_SLAB, VolumetricClouds } from './post/clouds.ts';

// Depth-aware post effects on the linear HDR image, before bloom and tone mapping:
//  - ground-truth ambient occlusion (GTAO, half resolution, normals rebuilt from depth): dark seams
//    where walls meet the street, under ledges and between buildings;
//  - aerial perspective that brightens toward the sun (the haze is lit, not flat);
//  - ground fog, thickest in the morning, lying in the low streets and lit by the sun;
//  - light shafts: the bright sky around the sun smeared radially, so beams pour through gaps in
//    the clouds and between towers;
//  - screen-space reflections (post/reflect.ts), the night's street lights (post/lights.ts) and eye
//    adaptation (post/exposure.ts), all blended in the one composite.

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const VIEWPOS = /* glsl */ `
  uniform mat4 uProjInv;
  vec3 viewPos(vec2 uv, float d) {
    vec4 c = vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    vec4 v = uProjInv * c;
    return v.xyz / v.w;
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tColor, tDepth, tAO, tRays, tRefl, tLight, tExpo, tCloud, tCloudShadow;
  uniform float uCloudOn, uCSOn, uCSExtent;
  uniform vec2 uCSCenter;
  uniform vec3 uCSDir;
  ${CLOUD_SLAB}
  uniform vec2 uAOTexel;
  uniform float uReflOn, uLightOn, uAmbRef, uExpoOn, uExpoKey, uExpoMin, uExpoMax, uDebug;
  uniform mat4 uCamWorld;
  uniform float uAO, uMie, uFogDensity, uGround, uGroundBase, uGroundH, uRays;
  uniform vec3 uHaze, uSunCol, uSunDir;
  varying vec2 vUv;
  ${VIEWPOS}
  // Optical depth of an exponential ground-fog layer along a straight ray.
  float fogDepth(float y0, float y1, float d) {
    float a = exp(-clamp((y0 - uGroundBase) / uGroundH, -2.0, 30.0));
    float b = exp(-clamp((y1 - uGroundBase) / uGroundH, -2.0, 30.0));
    float dy = y1 - y0;
    return abs(dy) < 0.01 ? d * a : d * (a - b) * uGroundH / dy;
  }
  void main() {
    vec4 col = texture2D(tColor, vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec3 camPos = uCamWorld[3].xyz;
    bool sky = depth >= 0.99999;
    vec3 vp = viewPos(vUv, sky ? 0.5 : depth);
    float dist = sky ? 4000.0 : length(vp);
    vec3 rd = normalize(mat3(uCamWorld) * vp);
    vec3 wp = camPos + rd * dist;
    float mask = clamp(1.0 - col.a, 0.0, 1.0);
    if (!sky && uLightOn > 0.0) {
      // The night's lamps: the pixel's own color stands in for the surface color (it is lit only by
      // the dim, even ambient, so color / ambient is close to the albedo).
      vec3 alb = clamp(col.rgb / uAmbRef, vec3(0.02), vec3(0.8));
      col.rgb += alb * texture2D(tLight, vUv).rgb * uLightOn;
    }
    if (!sky && uReflOn > 0.0 && mask > 0.02) {
      // Reflections, smeared a little up and down where the surface is merely damp (rougher), which
      // draws lights out into the long streaks a wet street shows; puddles and glass stay sharp.
      float spread = 1.0 + 5.0 * (1.0 - smoothstep(0.3, 0.45, mask));
      vec4 acc = vec4(0.0); float ws = 0.0;
      for (int i = -2; i <= 2; i++) {
        vec4 s = texture2D(tRefl, vUv + vec2(0.0, float(i) * spread * uAOTexel.y));
        float w = i == 0 ? 1.6 : abs(float(i)) < 1.5 ? 1.0 : 0.6;
        acc += vec4(s.rgb * s.a, s.a) * w; ws += w;
      }
      if (acc.a > 1e-4) col.rgb = mix(col.rgb, acc.rgb / acc.a, clamp(acc.a / ws, 0.0, 1.0));
    }
    if (!sky && uAO > 0.0) {
      // Depth-aware upsample of the half-resolution occlusion (it stores ao and view depth).
      float zc = -vp.z, ao = 0.0, wsum = 0.0;
      for (int i = 0; i < 5; i++) {
        vec2 o = i == 0 ? vec2(0.0) : vec2(i < 3 ? -1.0 : 1.0, mod(float(i), 2.0) < 0.5 ? -1.0 : 1.0);
        vec2 s = texture2D(tAO, vUv + o * uAOTexel).rg;
        float w = exp(-abs(s.g - zc) / max(0.05, zc * 0.03)) * (i == 0 ? 2.0 : 1.0);
        ao += s.r * w; wsum += w;
      }
      ao = wsum > 1e-4 ? ao / wsum : 1.0;
      float fade = 1.0 - smoothstep(120.0, 450.0, dist);
      col.rgb *= mix(1.0, ao, uAO * fade);
    }
    if (!sky && uCSOn > 0.0 && wp.y < uCloudBase) {
      // Cloud shadows drifting over the city: follow the sun's ray up from this spot to the layer and
      // look up how much light gets through there. Shade goes a little blue, as under a real cloud.
      vec3 q = wp + uCSDir * ((uCloudBase - wp.y) / uCSDir.y);
      vec2 suv = (q.xz - uCSCenter) / uCSExtent + 0.5;
      vec2 e = smoothstep(vec2(0.0), vec2(0.1), suv) * (1.0 - smoothstep(vec2(0.9), vec2(1.0), suv));
      float sh = (1.0 - texture2D(tCloudShadow, suv).r) * e.x * e.y;
      // Far off, the pixel is mostly haze, which a shadow on the ground behind it doesn't darken.
      float clearAir = exp(-pow(uFogDensity * dist, 2.0));
      col.rgb *= mix(vec3(1.0), vec3(0.6, 0.65, 0.74), sh * uCSOn * clearAir);
    }
    float mu = max(dot(rd, uSunDir), 0.0);
    float phase = pow(mu, 6.0) * 0.55 + pow(mu, 48.0) * 0.9;
    if (!sky) {
      // The scene's haze, lit forward by the sun (aerial perspective toward the light).
      float fd = uFogDensity * dist;
      float haze = 1.0 - exp(-fd * fd);
      col.rgb += uSunCol * phase * haze * uMie;
    }
    if (uCloudOn > 0.0) {
      // The cloud layer, over the sky and over anything that lies beyond where the view enters it.
      vec2 span = cloudSpan(camPos, rd);
      if (span.x < span.y && (sky || dist > span.x)) {
        vec4 cl = texture2D(tCloud, vUv);
        col.rgb = col.rgb * cl.a + cl.rgb;
      }
    }
    if (uGround > 0.0) {
      float od = fogDepth(camPos.y, wp.y, min(dist, 4000.0));
      float f = 1.0 - exp(-uGround * od);
      vec3 fc = uHaze * 1.05 + uSunCol * (0.06 + phase * 0.5);
      col.rgb = mix(col.rgb, fc, f * (sky ? 0.85 : 1.0));
    }
    col.rgb += texture2D(tRays, vUv).rgb * uRays;
    if (uExpoOn > 0.0) col.rgb *= clamp(uExpoKey / exp(texture2D(tExpo, vec2(0.5)).r), uExpoMin, uExpoMax);
    // Cap HDR spikes (a mirror-sharp sun glint off a pond or a pane can be thousands of times
    // brighter than the scene) so bloom makes a glint, not a blinding disk.
    gl_FragColor = vec4(min(col.rgb, vec3(3.0)), col.a);
    // Debug views (engine.atmo.debug): 1 the light buffer, 2 the reflection mask, 3 the reflections.
    if (uDebug > 2.5) { vec4 r = texture2D(tRefl, vUv); gl_FragColor = vec4(r.rgb * r.a, 1.0); }
    else if (uDebug > 1.5) gl_FragColor = vec4(vec3(mask), 1.0);
    else if (uDebug > 0.5) gl_FragColor = vec4(texture2D(tLight, vUv).rgb * 0.2, 1.0);
  }`;

const RAYMASK = /* glsl */ `
  uniform sampler2D tColor, tDepth, tCloud;
  uniform vec2 uSun; uniform float uAspect, uThresh, uCloudOn;
  varying vec2 vUv;
  void main() {
    float sky = step(0.99999, texture2D(tDepth, vUv).x);
    // Same HDR cap as the composite: a lone sun glint off glass at a sky edge (thousands of times
    // brighter than the sky) would otherwise be smeared into a long white bar across the screen.
    vec3 c = min(texture2D(tColor, vUv).rgb, vec3(3.0));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float fall = pow(clamp(1.0 - length(d) / 0.55, 0.0, 1.0), 2.0);
    // Clouds stand in the way: the beams come through the gaps between them.
    float open = mix(1.0, texture2D(tCloud, vUv).a, uCloudOn);
    gl_FragColor = vec4(c * smoothstep(uThresh, uThresh * 2.2, l) * fall * sky * open, 1.0);
  }`;

const RAYBLUR = /* glsl */ `
  uniform sampler2D tIn; uniform vec2 uSun; uniform float uStep;
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv - uSun) * uStep / 24.0;
    vec2 uv = vUv;
    vec3 sum = vec3(0.0); float w = 1.0, wsum = 0.0;
    for (int i = 0; i < 24; i++) {
      sum += texture2D(tIn, uv).rgb * w; wsum += w;
      uv -= delta; w *= 0.955;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }`;

export class AtmospherePass extends Pass {
  /** Ambient occlusion strength (0 off). */
  ao = 0.4;
  /** Ground fog density (0 none); set by the day/night cycle. */
  ground = 0;
  groundBase = 0;
  groundH = 18;
  /** Haze lit by the sun, strength. */
  mie = 0.7;
  /** Light shafts strength (0 off). */
  rays = 0.9;
  /** Scene fog density (FogExp2) to light; 0 disables the sun-lit haze (interiors). */
  fogDensity = 0;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly haze = new THREE.Color(0.7, 0.75, 0.8);
  /** Outdoor effects (haze, fog, shafts) only apply to this scene; AO applies everywhere. */
  outdoor: THREE.Scene | null = null;
  scene: THREE.Scene | null = null;
  /** The scene's own render target (color + depth); defaults to the composer's read buffer. */
  source: THREE.WebGLRenderTarget | null = null;
  /** Where the result goes instead of the composer's buffer (the temporal upscaler reads it from there). */
  target: THREE.WebGLRenderTarget | null = null;

  /** Screen-space reflections (wet streets, glass, water). */
  readonly reflections = new Reflections();
  reflect = true;
  /** Street lamps, headlights and other small lights after dark. */
  readonly lightField = new LightField();
  /** Brightness of the light buffer (the day/night cycle fades it in at dusk). */
  lightGain = 0;
  /** What a white surface reads under the night's ambient light alone (to recover surface color). */
  ambientRef = 0.1;
  /** Eye adaptation (outdoors). */
  readonly exposure = new AutoExposure();
  autoExposure = true;
  /** The volumetric cloud layer (outdoors; the sprite clouds stand in under low quality and VR). */
  readonly clouds = new VolumetricClouds();
  volumetricClouds = true;
  /** How dark the clouds' shadows fall on the ground (0 none; the day/night cycle sets it). */
  cloudShadow = 0;
  /** 0 off; 1 light buffer, 2 reflection mask, 3 reflections. */
  debug = 0;

  private aoRT: THREE.WebGLRenderTarget;
  private rayA: THREE.WebGLRenderTarget;
  private rayB: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private maskMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private white = new THREE.DataTexture(new Uint16Array([0x3c00, 0x7bff, 0, 0x3c00]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  private v = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private low: boolean) {
    super();
    this.black.needsUpdate = true;
    this.white.needsUpdate = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rayA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rayB = new THREE.WebGLRenderTarget(1, 1, opts);
    for (const t of [this.rayA, this.rayB]) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;

    this.aoMat = new THREE.ShaderMaterial({
      defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0, SAMPLES: 12, FRAGMENT_OUTPUT: 'vec4(ao, -viewPos.z, 0.0, 1.0)' },
      uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
      vertexShader: GTAOShader.vertexShader,
      // Occlusion fades out by 450 m (depth precision runs out, and it can't be seen): skip the far pixels.
      fragmentShader: GTAOShader.fragmentShader.replace('vec3 viewNormal = getViewNormal(vUv);',
        'if (-viewPos.z > 460.0) { gl_FragColor = vec4(1.0, -viewPos.z, 0.0, 1.0); return; }\n\t\t\tvec3 viewNormal = getViewNormal(vUv);'),
      depthTest: false, depthWrite: false,
    });
    const au = this.aoMat.uniforms;
    au.tNoise.value = generateMagicSquareNoise();
    au.radius.value = 2.2;
    au.thickness.value = 2.5;
    au.distanceExponent.value = 1.6;
    au.distanceFallOff.value = 1;
    au.scale.value = 1.15;

    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, tCloud: { value: null }, uCloudOn: { value: 0 }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThresh: { value: 1 } },
      vertexShader: VERT, fragmentShader: RAYMASK, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } },
      vertexShader: VERT, fragmentShader: RAYBLUR, depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, tRays: { value: null },
        uAOTexel: { value: new THREE.Vector2() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uAO: { value: 0 }, uMie: { value: 0 }, uFogDensity: { value: 0 }, uGround: { value: 0 }, uGroundBase: { value: 0 }, uGroundH: { value: 18 }, uRays: { value: 0 },
        uHaze: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
        tRefl: { value: null }, tLight: { value: null }, tExpo: { value: null }, tCloud: { value: null },
        uCloudOn: { value: 0 }, uCloudBase: { value: 950 }, uCloudTop: { value: 1850 },
        tCloudShadow: { value: null }, uCSOn: { value: 0 }, uCSExtent: { value: 12000 }, uCSCenter: { value: new THREE.Vector2() }, uCSDir: { value: new THREE.Vector3(0, 1, 0) },
        uReflOn: { value: 0 }, uLightOn: { value: 0 }, uAmbRef: { value: 0.1 }, uExpoOn: { value: 0 }, uExpoKey: { value: 0.2 }, uExpoMin: { value: 0.7 }, uExpoMax: { value: 1.7 }, uDebug: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
    });
  }

  /** The volumetric clouds are drawing (so the sprite clouds should not). */
  cloudsActive() { return !this.low && this.volumetricClouds && this.clouds.active(); }

  setSize(w: number, h: number) {
    this.aoRT.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.rayA.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
    this.rayB.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
    (this.aoMat.uniforms.resolution.value as THREE.Vector2).set(this.aoRT.width, this.aoRT.height);
    (this.compMat.uniforms.uAOTexel.value as THREE.Vector2).set(1 / this.aoRT.width, 1 / this.aoRT.height);
    this.reflections.setSize(w, h);
    this.lightField.setSize(w, h);
    this.clouds.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, composerRead: THREE.WebGLRenderTarget) {
    const readBuffer = this.source ?? composerRead;
    const cam = this.camera;
    const depth = readBuffer.depthTexture;
    const cu = this.compMat.uniforms;
    const outdoor = !!this.outdoor && this.scene === this.outdoor;
    cu.uProjInv.value.copy(cam.projectionMatrixInverse);
    cu.uCamWorld.value.copy(cam.matrixWorld);

    // Ambient occlusion at half resolution.
    const aoOn = !this.low && this.ao > 0 && !!depth;
    if (aoOn) {
      const au = this.aoMat.uniforms;
      au.tDepth.value = depth;
      au.cameraNear.value = cam.near;
      au.cameraFar.value = cam.far;
      au.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
      au.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
      au.cameraWorldMatrix.value.copy(cam.matrixWorld);
      renderer.setRenderTarget(this.aoRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, false, false);
      this.quad.material = this.aoMat;
      this.quad.render(renderer);
    }

    // The cloud layer first: the light shafts and the ground's cloud shadows both read it.
    const cloudsOn = this.cloudsActive() && outdoor && !!depth;
    if (cloudsOn) {
      this.clouds.render(renderer, depth!, cam, performance.now() / 1000);
      if (this.cloudShadow > 0.01) this.clouds.renderShadow(renderer, cam);
    }
    const shadeOn = cloudsOn && this.cloudShadow > 0.01;
    cu.tCloudShadow.value = shadeOn ? this.clouds.shadowRT.texture : this.white;
    cu.uCSOn.value = shadeOn ? this.cloudShadow : 0;
    cu.uCSExtent.value = this.clouds.shadowExtent;
    cu.uCSCenter.value.copy(this.clouds.shadowCenter);
    cu.uCSDir.value.copy(this.clouds.shadowDir);

    // Light shafts: where is the sun on screen, and is it in front of us?
    let raysOn = false;
    if (outdoor && !this.low && this.rays > 0 && depth && this.sunDir.y > -0.05 && this.sunColor.r + this.sunColor.g + this.sunColor.b > 0.06) {
      this.v.copy(this.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
      const fwd = cam.getWorldDirection(new THREE.Vector3()).dot(this.sunDir);
      const sx = this.v.x * 0.5 + 0.5, sy = this.v.y * 0.5 + 0.5;
      const off = Math.max(0, Math.abs(sx - 0.5) - 0.5, Math.abs(sy - 0.5) - 0.5);
      const vis = fwd > 0.05 ? THREE.MathUtils.clamp(1 - off / 0.45, 0, 1) * THREE.MathUtils.smoothstep(fwd, 0.05, 0.4) : 0;
      if (vis > 0.01) {
        raysOn = true;
        const mu = this.maskMat.uniforms;
        mu.tColor.value = readBuffer.texture; mu.tDepth.value = depth;
        mu.tCloud.value = cloudsOn ? this.clouds.rt.texture : this.black; mu.uCloudOn.value = cloudsOn ? 1 : 0;
        mu.uSun.value.set(sx, sy); mu.uAspect.value = cam.aspect;
        // Only the bright sky near the sun feeds the beams (scaled to the sun's own brightness).
        mu.uThresh.value = Math.max(0.03, (this.sunColor.r + this.sunColor.g + this.sunColor.b) * 0.05);
        this.quad.material = this.maskMat;
        renderer.setRenderTarget(this.rayA); this.quad.render(renderer);
        const bu = this.blurMat.uniforms;
        bu.uSun.value.set(sx, sy);
        this.quad.material = this.blurMat;
        bu.tIn.value = this.rayA.texture; bu.uStep.value = 0.85;
        renderer.setRenderTarget(this.rayB); this.quad.render(renderer);
        bu.tIn.value = this.rayB.texture; bu.uStep.value = 0.3;
        renderer.setRenderTarget(this.rayA); this.quad.render(renderer);
        cu.uRays.value = this.rays * vis;
      }
    }

    // Reflections, the night's lights, eye adaptation.
    const fx = !this.low && !!depth;
    lights.enabled = fx;
    const reflOn = fx && this.reflect;
    if (reflOn) this.reflections.render(renderer, readBuffer.texture, depth!, cam, performance.now() / 1000);
    const lightsOn = fx && outdoor && this.lightGain > 0.01 && this.lightField.render(renderer, depth!, cam);
    if (!lightsOn) lights.endFrame();
    const expoOn = fx && outdoor && this.autoExposure;
    if (expoOn) this.exposure.render(renderer, readBuffer.texture);
    cu.tRefl.value = reflOn ? this.reflections.rt.texture : this.black;
    cu.uReflOn.value = reflOn ? 1 : 0;
    cu.tLight.value = lightsOn ? this.lightField.rt.texture : this.black;
    cu.uLightOn.value = lightsOn ? this.lightGain : 0;
    cu.uAmbRef.value = this.ambientRef;
    cu.tExpo.value = expoOn ? this.exposure.texture : this.black;
    cu.uExpoOn.value = expoOn ? 1 : 0;
    cu.tCloud.value = cloudsOn ? this.clouds.rt.texture : this.black;
    cu.uCloudOn.value = cloudsOn ? 1 : 0;
    cu.uCloudBase.value = this.clouds.base; cu.uCloudTop.value = this.clouds.top;
    cu.uDebug.value = this.debug;
    cu.uExpoKey.value = this.exposure.key; cu.uExpoMin.value = this.exposure.min; cu.uExpoMax.value = this.exposure.max;

    cu.tColor.value = readBuffer.texture;
    cu.tDepth.value = depth ?? this.black;
    cu.tAO.value = aoOn ? this.aoRT.texture : this.white;
    cu.tRays.value = raysOn ? this.rayA.texture : this.black;
    if (!raysOn) cu.uRays.value = 0;
    cu.uAO.value = aoOn ? this.ao : 0;
    cu.uMie.value = outdoor ? this.mie : 0;
    cu.uFogDensity.value = outdoor ? this.fogDensity : 0;
    cu.uGround.value = outdoor && depth ? this.ground : 0;
    cu.uGroundBase.value = this.groundBase;
    cu.uGroundH.value = this.groundH;
    cu.uHaze.value.copy(this.haze);
    cu.uSunCol.value.copy(this.sunColor);
    cu.uSunDir.value.copy(this.sunDir);
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : this.target ?? writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    for (const t of [this.aoRT, this.rayA, this.rayB]) t.dispose();
    this.reflections.dispose(); this.lightField.dispose(); this.exposure.dispose(); this.clouds.dispose();
    for (const m of [this.aoMat, this.maskMat, this.blurMat, this.compMat]) m.dispose();
    this.quad.dispose();
  }
}
