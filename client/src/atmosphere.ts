import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';

// Depth-aware post effects on the linear HDR image, before bloom and tone mapping:
//  - ground-truth ambient occlusion (GTAO, half resolution, normals rebuilt from depth): dark seams
//    where walls meet the street, under ledges and between buildings;
//  - aerial perspective that brightens toward the sun (the haze is lit, not flat);
//  - ground fog, thickest in the morning, lying in the low streets and lit by the sun;
//  - light shafts: the bright sky around the sun smeared radially, so beams pour through gaps in
//    the clouds and between towers.

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const VIEWPOS = /* glsl */ `
  uniform mat4 uProjInv;
  vec3 viewPos(vec2 uv, float d) {
    vec4 c = vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    vec4 v = uProjInv * c;
    return v.xyz / v.w;
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tColor, tDepth, tAO, tRays;
  uniform vec2 uAOTexel;
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
    float mu = max(dot(rd, uSunDir), 0.0);
    float phase = pow(mu, 6.0) * 0.55 + pow(mu, 48.0) * 0.9;
    if (!sky) {
      // The scene's haze, lit forward by the sun (aerial perspective toward the light).
      float fd = uFogDensity * dist;
      float haze = 1.0 - exp(-fd * fd);
      col.rgb += uSunCol * phase * haze * uMie;
    }
    if (uGround > 0.0) {
      float od = fogDepth(camPos.y, wp.y, min(dist, 4000.0));
      float f = 1.0 - exp(-uGround * od);
      vec3 fc = uHaze * 1.05 + uSunCol * (0.06 + phase * 0.5);
      col.rgb = mix(col.rgb, fc, f * (sky ? 0.85 : 1.0));
    }
    col.rgb += texture2D(tRays, vUv).rgb * uRays;
    // Cap HDR spikes (a mirror-sharp sun glint off a pond or a pane can be thousands of times
    // brighter than the scene) so bloom makes a glint, not a blinding disk.
    gl_FragColor = vec4(min(col.rgb, vec3(3.0)), col.a);
  }`;

const RAYMASK = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform vec2 uSun; uniform float uAspect, uThresh;
  varying vec2 vUv;
  void main() {
    float sky = step(0.99999, texture2D(tDepth, vUv).x);
    vec3 c = texture2D(tColor, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float fall = pow(clamp(1.0 - length(d) / 0.55, 0.0, 1.0), 2.0);
    gl_FragColor = vec4(c * smoothstep(uThresh, uThresh * 2.2, l) * fall * sky, 1.0);
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
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThresh: { value: 1 } },
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
      },
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
    });
  }

  setSize(w: number, h: number) {
    this.aoRT.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.rayA.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
    this.rayB.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
    (this.aoMat.uniforms.resolution.value as THREE.Vector2).set(this.aoRT.width, this.aoRT.height);
    (this.compMat.uniforms.uAOTexel.value as THREE.Vector2).set(1 / this.aoRT.width, 1 / this.aoRT.height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
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
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    for (const t of [this.aoRT, this.rayA, this.rayB]) t.dispose();
    for (const m of [this.aoMat, this.maskMat, this.blurMat, this.compMat]) m.dispose();
    this.quad.dispose();
  }
}
