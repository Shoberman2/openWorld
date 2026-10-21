import * as THREE from 'three';

// Body-in-motion effects for the player: wind streaks rushing past the camera at speed, a speed
// vignette at the screen edge, and one-shot bursts (the smoke ring and ground dust of a rocket
// ignition, the dust of a landing). All cheap: one line batch, one point batch, one DOM layer.

const STREAKS = 110;
const RANGE = 16; // streaks live in a box this far around the camera (m)

/** Wind streaks around the camera, fading in from ~18 m/s. Hidden in VR (comfort). */
export class WindStreaks {
  group = new THREE.Group();
  private off = new Float32Array(STREAKS * 3); // offsets from the camera
  private pos = new Float32Array(STREAKS * 6);
  private col = new Float32Array(STREAKS * 8); // rgba per vertex: the tail fades to nothing
  private geo = new THREE.BufferGeometry();
  private mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  private dir = new THREE.Vector3();
  private seeded = false;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.geo, this.mat);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    this.group.add(lines);
    this.group.visible = false;
  }

  /** A point on a ring around the travel axis, `ahead` meters along it. */
  private spawn(i: number, ahead: number) {
    const d = this.dir;
    const a = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = a.cross(d).normalize();
    const w = new THREE.Vector3().crossVectors(d, u);
    const ang = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.random() * 7; // never through the middle of the view
    this.off[i * 3] = d.x * ahead + (u.x * Math.cos(ang) + w.x * Math.sin(ang)) * r;
    this.off[i * 3 + 1] = d.y * ahead + (u.y * Math.cos(ang) + w.y * Math.sin(ang)) * r;
    this.off[i * 3 + 2] = d.z * ahead + (u.z * Math.cos(ang) + w.z * Math.sin(ang)) * r;
  }

  /** vel: the player's velocity (m/s). cam: where the camera is this frame. */
  update(dt: number, cam: THREE.Vector3, vel: THREE.Vector3, enabled: boolean) {
    const sp = vel.length();
    const k = enabled ? Math.min(1, Math.max(0, (sp - 18) / 45)) : 0;
    this.group.visible = k > 0.01;
    if (!this.group.visible) { this.seeded = false; return; }
    this.dir.copy(vel).divideScalar(sp);
    if (!this.seeded) {
      for (let i = 0; i < STREAKS; i++) this.spawn(i, (Math.random() * 2 - 1) * RANGE);
      this.seeded = true;
    }
    // Air moves past at -vel; a streak is the smear of that motion over ~1/30 s, longer when faster.
    const len = Math.min(9, sp * 0.06);
    const step = sp * dt;
    const d = this.dir;
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 3;
      this.off[o] -= d.x * step; this.off[o + 1] -= d.y * step; this.off[o + 2] -= d.z * step;
      const along = this.off[o] * d.x + this.off[o + 1] * d.y + this.off[o + 2] * d.z;
      if (along < -RANGE * 0.5) this.spawn(i, RANGE * (0.6 + Math.random() * 0.4));
      const x = cam.x + this.off[o], y = cam.y + this.off[o + 1], z = cam.z + this.off[o + 2];
      const p = i * 6;
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
      this.pos[p + 3] = x + d.x * len; this.pos[p + 4] = y + d.y * len; this.pos[p + 5] = z + d.z * len;
      // Bright at the trailing end, nothing at the head; dim near the edges of the box.
      const fade = 1 - Math.min(1, Math.abs(along) / RANGE);
      const a = k * 0.7 * fade * (0.45 + 0.55 * ((i * 0.618) % 1));
      const c = i * 8;
      this.col[c] = this.col[c + 1] = this.col[c + 2] = 1; this.col[c + 3] = a;
      this.col[c + 4] = this.col[c + 5] = this.col[c + 6] = 1; this.col[c + 7] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); this.group.removeFromParent(); }
}

/** Darkened, slightly blown-out screen edges at speed: the "wind in your eyes" cue. */
export class SpeedVignette {
  private el: HTMLDivElement;
  private shown = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .15s linear;'
      + 'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(20,24,30,.38) 100%),'
      + 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 0deg 3deg, rgba(255,255,255,.05) 3deg 3.6deg);'
      + '-webkit-mask-image:radial-gradient(ellipse at center, transparent 48%, #000 92%);mask-image:radial-gradient(ellipse at center, transparent 48%, #000 92%);';
    document.body.appendChild(this.el);
  }

  update(speed: number, enabled: boolean) {
    const k = enabled ? Math.min(1, Math.max(0, (speed - 30) / 60)) : 0;
    const q = Math.round(k * 20) / 20;
    if (q === this.shown) return;
    this.shown = q;
    this.el.style.opacity = String(q * 0.9);
  }

  dispose() { this.el.remove(); }
}

// ---------------------------------------------------------------------------------------------
// Bursts: one point batch, particles flung outward with drag and a little rise, fading out.

const BURST_N = 600;

export class Bursts {
  group = new THREE.Group();
  private start = new Float32Array(BURST_N * 3);
  private vel = new Float32Array(BURST_N * 3);
  private born = new Float32Array(BURST_N).fill(-100);
  private life = new Float32Array(BURST_N).fill(1);
  private size = new Float32Array(BURST_N);
  private tint = new Float32Array(BURST_N * 3);
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private head = 0;
  private time = 0;
  private dirty = false;

  constructor() {
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(this.start, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('vel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('born', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 vel; attribute float born; attribute float life; attribute float psize; attribute vec3 tint;
        uniform float uTime;
        varying float vAge; varying vec3 vTint;
        void main() {
          float t = uTime - born;
          float age = t / life;
          vAge = age; vTint = tint;
          // Drag: travel saturates (1 - e^-3t)/3; smoke and dust drift up a little as they slow.
          vec3 p = position + vel * (1.0 - exp(-3.0 * t)) / 3.0 + vec3(0.0, 0.35 * t, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float s = psize * mix(0.5, 1.6, sqrt(clamp(age, 0.0, 1.0)));
          gl_PointSize = age < 0.0 || age > 1.0 ? 0.0 : s * 600.0 / max(0.5, -mv.z);
        }`,
      fragmentShader: `
        varying float vAge; varying vec3 vTint;
        void main() {
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * (1.0 - vAge) * (1.0 - vAge) * 0.55;
          gl_FragColor = vec4(vTint, a);
        }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, this.mat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, gc: number, b: number) {
    const i = this.head; this.head = (this.head + 1) % BURST_N;
    this.start[i * 3] = x; this.start[i * 3 + 1] = y; this.start[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.born[i] = this.time; this.life[i] = life; this.size[i] = size;
    this.tint[i * 3] = r; this.tint[i * 3 + 1] = gc; this.tint[i * 3 + 2] = b;
    this.dirty = true;
  }

  /** A flat ring of smoke blown outward along the ground (or in the air, around the feet). */
  ring(at: THREE.Vector3, n: number, speed: number, size: number, life: number, tint: [number, number, number], up = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const s = speed * (0.75 + Math.random() * 0.5);
      const shade = 0.9 + Math.random() * 0.2;
      this.emit(at.x + Math.sin(a) * 0.3, at.y + 0.05, at.z + Math.cos(a) * 0.3,
        Math.sin(a) * s, up * (0.5 + Math.random()), Math.cos(a) * s,
        life * (0.8 + Math.random() * 0.4), size * (0.8 + Math.random() * 0.5),
        tint[0] * shade, tint[1] * shade, tint[2] * shade);
    }
  }

  /** A puff thrown along a direction (the downward blast under the shoes). */
  puff(at: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number, size: number, life: number, tint: [number, number, number]) {
    for (let i = 0; i < n; i++) {
      const s = speed * (0.5 + Math.random() * 0.7);
      this.emit(at.x, at.y, at.z,
        dir.x * s + (Math.random() - 0.5) * speed * 0.5, dir.y * s + (Math.random() - 0.5) * speed * 0.5, dir.z * s + (Math.random() - 0.5) * speed * 0.5,
        life * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), tint[0], tint[1], tint[2]);
    }
  }

  update(dt: number) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (!this.dirty) return;
    this.dirty = false;
    for (const k of ['position', 'vel', 'born', 'life', 'psize', 'tint']) this.geo.attributes[k].needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); this.group.removeFromParent(); }
}
