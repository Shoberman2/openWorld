// Rocket exhaust smoke for the shuttle: a column of billowing puffs left hanging in the air along the
// flight path, plus the ground cloud blown sideways off the pad at lift-off. World-space billboards
// (instanced quads, so a 30 m puff right by the camera is still the right size), in a ring buffer.
import * as THREE from 'three';

const N = 3200;

export class Plume {
  readonly mesh: THREE.Mesh;
  private offset = new Float32Array(N * 3);
  private drift = new Float32Array(N * 3);
  private born = new Float32Array(N).fill(-1e4);
  private size = new Float32Array(N);
  private head = 0;
  private time = 0;
  private last: THREE.Vector3[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = Math.random();
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offset, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('drift', new THREE.InstancedBufferAttribute(this.drift, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('born', new THREE.InstancedBufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size0', new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = N;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFire: { value: new THREE.Vector3() }, uFireK: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 offset; attribute vec3 drift; attribute float born; attribute float size0; attribute float seed;
        uniform float uTime; uniform vec3 uFire; uniform float uFireK;
        varying vec2 vUv; varying float vA; varying float vShade; varying float vGlow; varying float vSeed;
        void main() {
          float t = uTime - born;
          float life = 22.0 + 18.0 * seed;
          float age = t / life;
          vUv = uv; vSeed = seed;
          // Puffs balloon out fast, then slowly; drift carries the pad cloud sideways and eases off;
          // the whole column rises a little and wanders on the wind.
          float grow = 1.0 + 2.6 * sqrt(clamp(t / 6.0, 0.0, 1.0)) + 1.4 * clamp(age, 0.0, 1.0);
          vec3 c = offset + drift * 7.0 * (1.0 - exp(-t / 7.0)) + vec3(0.35, 0.5, 0.2) * t;
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          float s = size0 * grow;
          float r = seed * 6.2831;
          vec2 q = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
          mv.xy += q * s;
          gl_Position = projectionMatrix * mv;
          vA = (t < 0.0 || age > 1.0) ? 0.0 : smoothstep(0.0, 0.25, t) * (1.0 - age) * (1.0 - age);
          // Thin out what's right on top of the camera instead of whiting out the screen.
          vA *= smoothstep(s * 0.6, s * 2.5 + 6.0, -mv.z);
          vShade = 0.5 + 0.5 * position.y; // lit from above
          vGlow = uFireK * exp(-distance(c, uFire) / (8.0 + s * 0.5)) * (1.0 - clamp(t / 3.0, 0.0, 1.0) * 0.6);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying float vShade; varying float vGlow; varying float vSeed;
        void main() {
          vec2 p = vUv - 0.5;
          float d = length(p) * 2.0;
          // A lumpy edge so puffs read as cauliflower smoke, not discs.
          float a = atan(p.y, p.x);
          float edge = 1.0 - 0.12 * (sin(a * 5.0 + vSeed * 20.0) * 0.5 + 0.5) - 0.08 * sin(a * 11.0 + vSeed * 7.0);
          float m = smoothstep(edge, edge * 0.45, d);
          float alpha = m * vA * 0.55;
          if (alpha < 0.004) discard;
          vec3 col = mix(vec3(0.70, 0.71, 0.74), vec3(0.97, 0.97, 0.98), vShade);
          col = mix(col, vec3(1.0, 0.62, 0.25) * 1.6, clamp(vGlow, 0.0, 1.0));
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  private emit(x: number, y: number, z: number, size: number, dx: number, dy: number, dz: number, at: number) {
    const i = this.head; this.head = (this.head + 1) % N;
    this.offset[i * 3] = x; this.offset[i * 3 + 1] = y; this.offset[i * 3 + 2] = z;
    this.drift[i * 3] = dx; this.drift[i * 3 + 1] = dy; this.drift[i * 3 + 2] = dz;
    this.born[i] = at;
    this.size[i] = size;
  }

  /**
   * Advance and emit. `nozzles` are world positions this frame, `k` the burn (0 off .. ~1.8 boosters),
   * `ground` the height under the vehicle (the pad cloud spreads along it while you're low).
   */
  update(dt: number, nozzles: THREE.Vector3[], k: number, ground: number, fire: THREE.Vector3) {
    this.time += dt;
    const t = this.time;
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uFire.value.copy(fire);
    this.mat.uniforms.uFireK.value = Math.min(1, k);
    if (k < 0.08) { this.last.length = 0; this.flush(); return; }
    nozzles.forEach((n, j) => {
      const prev = this.last[j] ?? n.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 0.01);
      const dist = prev.distanceTo(n);
      // A puff every ~2.5 m of path (so the column stays solid at Mach 1), at least one a frame.
      const count = Math.min(14, Math.max(1, Math.round(dist / 2.5)));
      for (let i = 1; i <= count; i++) {
        const f = i / count;
        const j3 = 0.8;
        this.emit(prev.x + (n.x - prev.x) * f + (Math.random() - 0.5) * j3, prev.y + (n.y - prev.y) * f, prev.z + (n.z - prev.z) * f + (Math.random() - 0.5) * j3,
          (1.6 + Math.random() * 1.6) * (0.6 + 0.5 * Math.min(k, 1.6)), (Math.random() - 0.5) * 0.6, -0.4, (Math.random() - 0.5) * 0.6, t - dt * (1 - f));
      }
      this.last[j] = (this.last[j] ?? new THREE.Vector3()).copy(n);
    });
    // The ground cloud: exhaust hitting the ground rolls out sideways in a ring.
    const low = nozzles[0].y - ground;
    if (low < 45) {
      const g = 1 - low / 45;
      const n = Math.round(6 * g * Math.min(k, 1.4));
      const c = nozzles[0];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 5;
        this.emit(c.x + Math.cos(a) * 3, ground + 1.5 + Math.random() * 2, c.z + Math.sin(a) * 3, 3 + Math.random() * 3,
          Math.cos(a) * sp, 0.2 + Math.random() * 0.5, Math.sin(a) * sp, t);
      }
    }
    this.flush();
  }

  private flush() {
    const a = this.geo.attributes;
    a.offset.needsUpdate = true; a.drift.needsUpdate = true; a.born.needsUpdate = true; a.size0.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
