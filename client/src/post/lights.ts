// Hundreds of real lights after dark, for the price of one small pass: street lamps, headlights,
// shop fronts and screens each light the street, the walls, the cars and the people around them.
// Every light is drawn as a sphere into a half-resolution light buffer; each pixel inside rebuilds its
// position and normal from the depth buffer and adds that light's falloff. The atmosphere composite
// then lights the scene with it (using the pixel's own color as the surface color).
import * as THREE from 'three';

const MAX = 512;

/**
 * The lights for this frame. Static ones (lamps) are replaced as a set when the streets around you
 * change; dynamic ones (headlights) are pushed every frame and cleared after it's drawn.
 */
class LightList {
  /** x, y, z, radius per light. */
  readonly pos = new Float32Array(MAX * 4);
  /** r, g, b (linear, already scaled by brightness), spare. */
  readonly col = new Float32Array(MAX * 4);
  private nStatic = 0;
  private nDyn = 0;
  private stat = new Float32Array(MAX * 8);
  /** Master switch (the deferred light pass is running: low quality and VR fall back to decals). */
  enabled = false;

  /** Replace the static set: [x, y, z, radius, r, g, b, _] per light. */
  setStatic(data: ArrayLike<number>, n: number) {
    this.nStatic = Math.min(n, MAX);
    for (let i = 0; i < this.nStatic * 8; i++) this.stat[i] = data[i];
  }
  /** Add a light for this frame only. */
  push(x: number, y: number, z: number, radius: number, r: number, g: number, b: number) {
    const i = this.nStatic + this.nDyn;
    if (i >= MAX) return;
    this.pos[i * 4] = x; this.pos[i * 4 + 1] = y; this.pos[i * 4 + 2] = z; this.pos[i * 4 + 3] = radius;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
    this.nDyn++;
  }
  /** Pack for drawing; returns the count. */
  pack() {
    for (let i = 0; i < this.nStatic; i++) {
      this.pos[i * 4] = this.stat[i * 8]; this.pos[i * 4 + 1] = this.stat[i * 8 + 1]; this.pos[i * 4 + 2] = this.stat[i * 8 + 2]; this.pos[i * 4 + 3] = this.stat[i * 8 + 3];
      this.col[i * 4] = this.stat[i * 8 + 4]; this.col[i * 4 + 1] = this.stat[i * 8 + 5]; this.col[i * 4 + 2] = this.stat[i * 8 + 6];
    }
    return this.nStatic + this.nDyn;
  }
  endFrame() { this.nDyn = 0; }
  get staticCount() { return this.nStatic; }
}

export const lights = new LightList();

const VERT = /* glsl */ `
  attribute vec4 aLight; attribute vec4 aColor;
  varying vec4 vLight; varying vec3 vColor;
  void main() {
    vLight = aLight; vColor = aColor.rgb;
    vec3 w = aLight.xyz + position * aLight.w * 1.08;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv, uCamWorld;
  uniform vec2 uRes, uTexel;
  varying vec4 vLight; varying vec3 vColor;
  vec3 viewPos(vec2 uv, float d) {
    vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  void main() {
    // Snapped to a depth texel's center: this buffer's pixels sit on the corners between four of them,
    // and nearest-neighbor depth there would flip between rows.
    vec2 uv = (floor(gl_FragCoord.xy / uRes / uTexel) + 0.5) * uTexel;
    float d = texture2D(tDepth, uv).x;
    if (d >= 0.99999) discard;
    vec3 P = viewPos(uv, d);
    vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
    vec3 L = vLight.xyz - W;
    float r = vLight.w, dist2 = dot(L, L);
    if (dist2 > r * r) discard;
    // Normal from depth (the nearer neighbor on each axis).
    vec3 Pr = viewPos(uv + vec2(uTexel.x, 0.0), texture2D(tDepth, uv + vec2(uTexel.x, 0.0)).x);
    vec3 Pl = viewPos(uv - vec2(uTexel.x, 0.0), texture2D(tDepth, uv - vec2(uTexel.x, 0.0)).x);
    vec3 Pu = viewPos(uv + vec2(0.0, uTexel.y), texture2D(tDepth, uv + vec2(0.0, uTexel.y)).x);
    vec3 Pd = viewPos(uv - vec2(0.0, uTexel.y), texture2D(tDepth, uv - vec2(0.0, uTexel.y)).x);
    vec3 dx = abs(Pl.z - P.z) < abs(Pr.z - P.z) ? P - Pl : Pr - P;
    vec3 dy = abs(Pd.z - P.z) < abs(Pu.z - P.z) ? P - Pd : Pu - P;
    vec3 N = mat3(uCamWorld) * normalize(cross(dx, dy));
    float dist = sqrt(dist2);
    // Inverse-square with a soft core, windowed to zero at the radius.
    float win = 1.0 - dist2 / (r * r);
    float att = win * win / (1.0 + dist2 * 0.075);
    // Wrapped: a lamp also lifts surfaces turned a little away from it (light bounces around a street).
    float ndl = clamp(dot(N, L / max(dist, 1e-3)) * 0.8 + 0.2, 0.0, 1.0);
    gl_FragColor = vec4(vColor * att * ndl, 1.0);
  }`;

export class LightField {
  readonly rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aLight: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  /** Lights drawn last frame. */
  count = 0;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    const ico = new THREE.IcosahedronGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', ico.getAttribute('position'));
    if (ico.index) this.geo.setIndex(ico.index);
    this.aLight = new THREE.InstancedBufferAttribute(lights.pos, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aColor = new THREE.InstancedBufferAttribute(lights.col, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.geo.setAttribute('aLight', this.aLight);
    this.geo.setAttribute('aColor', this.aColor);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      // Back faces, no depth test: correct whether the camera is outside or inside the light's sphere.
      side: THREE.BackSide, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.rt.setSize(hw, hh);
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(hw, hh);
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  /** Draw this frame's lights. Returns false (and draws nothing) when there are none. */
  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, cam: THREE.PerspectiveCamera) {
    const n = lights.pack();
    lights.endFrame();
    this.count = n;
    if (!n) return false;
    this.geo.instanceCount = n;
    this.aLight.needsUpdate = true;
    this.aColor.needsUpdate = true;
    const u = this.mat.uniforms;
    u.tDepth.value = depth;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.render(this.scene, cam);
    renderer.setClearColor(prevColor, prevAlpha);
    return true;
  }

  dispose() { this.rt.dispose(); this.mat.dispose(); this.geo.dispose(); }
}
