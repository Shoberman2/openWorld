// Temporal upscaling: when the GPU can't hold 60 fps at full resolution, the scene is drawn with fewer
// pixels and no multisampling, nudged by a different fraction of a pixel every frame, and this pass
// rebuilds a full-resolution image from the last several frames. Each output pixel remembers what it
// showed before (found again through the depth buffer as the camera moves) and takes in the new
// frame's nearest sample, weighted by how close that sample landed. Standing still, it converges on a
// supersampled picture; moving, history that no longer matches its surroundings is pulled back to
// them, so nothing trails. It also steadies the grain of the reflections and clouds.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const RESOLVE = /* glsl */ `
  uniform sampler2D tColor, tDepth, tHist;
  uniform mat4 uInvVP, uPrevVP;
  uniform vec2 uShift, uSrcTexel, uHistTexel;
  uniform float uHasHist, uBlend, uSharp;
  varying vec2 vUv;
  // Blending in a compressed range keeps one searing highlight from flickering the result.
  vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
  vec3 itm(vec3 c) { return c / max(1e-4, 1.0 - max(c.r, max(c.g, c.b))); }
  // History is read with a sharper (Catmull-Rom) filter than plain bilinear, which would blur it a
  // little more every frame it is carried forward.
  vec3 history(vec2 uv) {
    vec2 p = uv / uHistTexel - 0.5;
    vec2 i = floor(p), f = p - i;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t0 = (i - 0.5) * uHistTexel, t3 = (i + 2.5) * uHistTexel, t12 = (i + 0.5 + w2 / w12) * uHistTexel;
    vec3 c = texture2D(tHist, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
           + texture2D(tHist, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
           + texture2D(tHist, vec2(t12.x, t12.y)).rgb * (w12.x * w12.y)
           + texture2D(tHist, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
           + texture2D(tHist, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
    float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(c / ws, vec3(0.0));
  }
  void main() {
    // Where this output pixel falls in the (shifted) frame just drawn, and the sample nearest to it.
    vec2 uvJ = vUv + uShift;
    vec2 near = (floor(uvJ / uSrcTexel) + 0.5) * uSrcTexel;
    vec2 off = (uvJ - near) / uSrcTexel;
    vec4 src = texture2D(tColor, near);
    vec3 c = tm(src.rgb);
    // What the frame looks like around here: history must stay within it.
    vec3 m1 = c, m2 = c * c, lo = c, hi = c;
    float d = texture2D(tDepth, near).x;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 o = vec2(float(i), float(j)) * uSrcTexel;
      vec3 s = tm(texture2D(tColor, near + o).rgb);
      m1 += s; m2 += s * s; lo = min(lo, s); hi = max(hi, s);
      // The nearest surface in the neighborhood decides where the pixel came from, so the edge of
      // something in front moves with it and not with what's behind.
      d = min(d, texture2D(tDepth, near + o).x);
    }
    m1 /= 9.0; m2 /= 9.0;
    vec3 sd = sqrt(max(m2 - m1 * m1, vec3(0.0)));
    lo = max(lo, m1 - sd * 1.25); hi = min(hi, m1 + sd * 1.25);

    vec4 w = uInvVP * vec4(vec3(vUv, d) * 2.0 - 1.0, 1.0);
    vec4 pc = uPrevVP * vec4(w.xyz / w.w, 1.0);
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    bool ok = uHasHist > 0.5 && pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0;
    if (!ok) { gl_FragColor = vec4(texture2D(tColor, uvJ).rgb, src.a); return; }
    vec3 h = tm(history(puv));
    vec3 hc = clamp(h, lo, hi);
    // A sample that landed on this pixel counts for more than one that landed between pixels; history
    // that had to be pulled a long way back is stale, so the new frame gets a bigger say.
    float wNear = exp(-dot(off, off) * uSharp);
    float stale = clamp(length(h - hc) * 6.0, 0.0, 1.0);
    float a = clamp(uBlend * wNear + stale * 0.25, 0.02, 1.0);
    gl_FragColor = vec4(itm(mix(hc, c, a)), src.a);
  }`;

const COPY = /* glsl */ `uniform sampler2D tIn; varying vec2 vUv; void main() { gl_FragColor = texture2D(tIn, vUv); }`;

/** Halton sequence, for sub-pixel offsets that cover the pixel evenly over a cycle. */
function halton(i: number, base: number) {
  let f = 1, r = 0;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}

export class TemporalUpscale extends Pass {
  /** The low-resolution frame to rebuild from (color; its depth texture is `depth`). */
  source: THREE.WebGLRenderTarget | null = null;
  depth: THREE.Texture | null = null;
  /** How much of each new frame goes in (lower: steadier, slower to react). */
  blend = 0.12;
  private hist: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private copy: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private frame = 0;
  private hasHist = false;
  private proj = new THREE.Matrix4();
  private vp = new THREE.Matrix4();
  private prevVP = new THREE.Matrix4();
  private lastCam = new THREE.Vector3();
  private jittered: THREE.PerspectiveCamera | null = null;

  constructor() {
    super();
    this.hist = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.hist.texture.minFilter = this.hist.texture.magFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tHist: { value: null },
        uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() },
        uShift: { value: new THREE.Vector2() }, uSrcTexel: { value: new THREE.Vector2() }, uHistTexel: { value: new THREE.Vector2() },
        uHasHist: { value: 0 }, uBlend: { value: 0.12 }, uSharp: { value: 4 },
      },
      vertexShader: VERT, fragmentShader: RESOLVE, depthTest: false, depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({ uniforms: { tIn: { value: null } }, vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false });
  }

  setSize(w: number, h: number) {
    if (w !== this.hist.width || h !== this.hist.height) this.hasHist = false;
    this.hist.setSize(w, h);
    (this.mat.uniforms.uHistTexel.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  /** Forget the history (the scene changed under the camera). */
  reset() { this.hasHist = false; }

  /** Before the scene is drawn: shift the camera's projection by this frame's fraction of a pixel. */
  begin(cam: THREE.PerspectiveCamera, srcW: number, srcH: number) {
    this.frame = (this.frame + 1) % 16;
    const jx = halton(this.frame + 1, 2) - 0.5, jy = halton(this.frame + 1, 3) - 0.5;
    this.proj.copy(cam.projectionMatrix);
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cam.projectionMatrix.elements[8] += (2 * jx) / srcW;
    cam.projectionMatrix.elements[9] += (2 * jy) / srcH;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.jittered = cam;
    const u = this.mat.uniforms;
    // Adding to those two terms slides the image the other way.
    (u.uShift.value as THREE.Vector2).set(-jx / srcW, -jy / srcH);
    (u.uSrcTexel.value as THREE.Vector2).set(1 / srcW, 1 / srcH);
    // The fewer pixels drawn, the pickier each output pixel is about which samples it takes.
    u.uSharp.value = 2 + 5 * Math.max(0, this.hist.width / srcW - 1);
  }

  /** After the frame: give the camera its own projection back. */
  end() {
    const cam = this.jittered;
    if (!cam) return;
    cam.projectionMatrix.copy(this.proj);
    cam.projectionMatrixInverse.copy(this.proj).invert();
    this.jittered = null;
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget) {
    const src = this.source, cam = this.jittered;
    if (!src || !cam || !this.depth) return;
    // A jump (teleport, walking through a door) starts over.
    if (this.lastCam.distanceToSquared(cam.position) > 60 * 60) this.hasHist = false;
    this.lastCam.copy(cam.position);
    const u = this.mat.uniforms;
    u.tColor.value = src.texture; u.tDepth.value = this.depth; u.tHist.value = this.hist.texture;
    (u.uInvVP.value as THREE.Matrix4).copy(this.vp).invert();
    (u.uPrevVP.value as THREE.Matrix4).copy(this.prevVP);
    u.uHasHist.value = this.hasHist ? 1 : 0;
    u.uBlend.value = this.blend;
    this.quad.material = this.mat;
    renderer.setRenderTarget(write);
    this.quad.render(renderer);
    // Keep the result for next frame.
    this.copy.uniforms.tIn.value = write.texture;
    this.quad.material = this.copy;
    renderer.setRenderTarget(this.hist);
    this.quad.render(renderer);
    this.prevVP.copy(this.vp);
    this.hasHist = true;
  }

  dispose() { this.hist.dispose(); this.mat.dispose(); this.copy.dispose(); this.quad.dispose(); }
}
