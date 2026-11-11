// The film camera: takes the engine's camera for one scripted move around a building and hands it
// back exactly as it found it. Three moves: an orbit that rises around the building, a flyover that
// comes in from far off and settles in front of it, and a slow wide arc for the history replay. Every
// move is planned before it starts: the path is checked against the city (never inside a building,
// never with another tower between the lens and the subject) and lifted where it has to be, the lift is
// smoothed so nothing jerks, and the speed eases in and runs out slowly so the last seconds sit on the
// building's sign.
import * as THREE from 'three';
import type { Site } from './place.ts';

export interface FilmPart { ring: number[]; base: number; top: number }

/** The building being filmed: its shape, and where its sign is. */
export interface FilmTarget {
  parts: FilmPart[];
  cx: number; cz: number;
  base: number; top: number;
  /** Farthest corner from the middle, in meters. */
  radius: number;
  /** Middle of the sign (the logo on the crown of a tall building, the letters over the door of a small one). */
  sign: THREE.Vector3;
  /** Unit vector the sign faces. */
  signOut: THREE.Vector3;
  signSize: number;
}

/** What the camera needs to know about the city. */
export interface FilmWorld {
  /** Highest roof (or the ground) at a spot. */
  solidTop(x: number, z: number): number;
  /** How far along a→b (0..1) the view gets before a building is in the way. */
  ray(a: THREE.Vector3, b: THREE.Vector3): number;
}

export type ShotKind = 'orbit' | 'flyover' | 'history';
export interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
export interface Shot { duration: number; pose(t: number, out: Pose): void }

/** Where a site's sign is, worked out the way earth/sites.ts and city/entrance.ts place it. */
export function filmTarget(site: Site, parts: FilmPart[]): FilmTarget {
  const ring = site.footprint ?? [];
  const base = site.door.y, top = site.top.y, h = top - base;
  const all = parts.length ? parts : [{ ring, base, top }];
  let radius = 0;
  for (const p of all) for (let i = 0; i < p.ring.length; i += 2) radius = Math.max(radius, Math.hypot(p.ring[i] - site.center.x, p.ring[i + 1] - site.center.z));
  if (!radius) radius = Math.max(8, Math.hypot(site.door.x - site.center.x, site.door.z - site.center.z));
  const out = site.doorOut;
  // Small buildings: the letters over the door.
  let sign = site.door.clone().addScaledVector(out, 0.4).setY(base + Math.min(5.2, Math.max(3, h * 0.6)));
  let signOut = out.clone(), signSize = 7;
  if (h > 22 && ring.length >= 6) {
    // Tall ones: the logo on the crown of the wall that faces the street.
    let best = -Infinity;
    for (let i = 0, n = ring.length / 2; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 4) continue;
      const ox = -(bz - az) / len, oz = (bx - ax) / len;
      const score = (ox * out.x + oz * out.z) * Math.min(len, 30), s = Math.min(len * 0.6, 22, h * 0.3);
      if (score <= best || s < 3.5) continue;
      best = score;
      signSize = s;
      signOut = new THREE.Vector3(ox, 0, oz);
      sign = new THREE.Vector3((ax + bx) / 2 + ox * 0.35, top - s / 2 - 2.6, (az + bz) / 2 + oz * 0.35);
    }
  }
  return { parts: all, cx: site.center.x, cz: site.center.z, base, top, radius, sign, signOut, signSize };
}

const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** Progress along a move for each moment: eases in, then runs out slowly, never quite stopping. */
function pacing(tail: number) {
  const N = 240, acc = new Float32Array(N + 1);
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    acc[i + 1] = acc[i] + smooth(x / 0.14) * (Math.pow(1 - x, 1.7) + tail);
  }
  return (x: number) => {
    const f = THREE.MathUtils.clamp(x, 0, 1) * N, i = Math.min(N - 1, Math.floor(f));
    return (acc[i] + (acc[i + 1] - acc[i]) * (f - i)) / acc[N];
  };
}

/** Where the sign reads best from: straight out in front of it, as far back as the street allows. */
function signPose(t: FilmTarget, w: FilmWorld, aspect: number, fov: number): Pose {
  const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // The sign fills about a third of the frame's short side.
  let d = t.signSize / (0.3 * 2 * half * Math.min(1, aspect));
  const y = t.sign.y + (t.top - t.base > 22 ? t.signSize * 0.1 : 0.4);
  // Not through the building across the street.
  let clear = 6;
  for (; clear < d; clear += 2) if (w.solidTop(t.sign.x + t.signOut.x * (clear + 3), t.sign.z + t.signOut.z * (clear + 3)) > y - 1) break;
  d = Math.max(9, Math.min(d, clear));
  return { pos: t.sign.clone().addScaledVector(t.signOut, d).setY(y), look: t.sign.clone(), fov };
}

/** Distance at which the whole building (and some sky) fits the frame. */
function fitDistance(t: FilmTarget, aspect: number, fov: number, room = 1.3) {
  const half = Math.tan(THREE.MathUtils.degToRad(fov / 2)), h = t.top - t.base;
  return Math.max((h * room) / 2 / half, (t.radius * 1.35) / (half * aspect), t.radius + 24);
}

export function makeShot(kind: ShotKind, t: FilmTarget, w: FilmWorld, aspect: number, duration = kind === 'history' ? 18 : 10): Shot {
  const h = t.top - t.base, mid = new THREE.Vector3(t.cx, t.base + h * 0.55, t.cz);
  const endFov = 40, end = signPose(t, w, aspect, endFov);
  const cyl = (p: THREE.Vector3) => ({ a: Math.atan2(p.x - t.cx, p.z - t.cz), r: Math.hypot(p.x - t.cx, p.z - t.cz) });
  const keep = t.radius + 8;
  // How far the building reaches from its middle in each direction, padded and rounded off, so a
  // move can come in close to a long building's flat side without cutting its corners.
  const A = 96, reachAt = new Float32Array(A);
  for (let i = 0; i < A; i++) {
    const a = (i / A) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    let far = 0;
    for (const part of t.parts) for (let k = 0, n = part.ring.length / 2; k < n; k++) {
      const j = (k + 1) % n;
      const ax = part.ring[k * 2] - t.cx, az = part.ring[k * 2 + 1] - t.cz, ex = part.ring[j * 2] - t.cx - ax, ez = part.ring[j * 2 + 1] - t.cz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-6) continue;
      const along = (ax * ez - az * ex) / den, on = (ax * dz - az * dx) / den;
      if (along > far && on >= 0 && on <= 1) far = along;
    }
    reachAt[i] = far || t.radius;
  }
  {
    const tmp = new Float32Array(A);
    for (let i = 0; i < A; i++) { let m = 0; for (let j = -4; j <= 4; j++) m = Math.max(m, reachAt[(i + j + A) % A]); tmp[i] = m; }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < A; i++) reachAt[i] = (tmp[(i + A - 1) % A] + tmp[i] * 2 + tmp[(i + 1) % A]) / 4;
      tmp.set(reachAt);
    }
  }
  /** Keep a point at least `pad` meters outside the building's outline. */
  const outside = (v: THREE.Vector3, pad = 6) => {
    const r = Math.hypot(v.x - t.cx, v.z - t.cz) || 1e-3;
    const f = ((Math.atan2(v.x - t.cx, v.z - t.cz) / (Math.PI * 2) + 1) % 1) * A, i = Math.floor(f) % A;
    const min = reachAt[i] + (reachAt[(i + 1) % A] - reachAt[i]) * (f - Math.floor(f)) + pad;
    if (r < min) { v.x = t.cx + ((v.x - t.cx) / r) * min; v.z = t.cz + ((v.z - t.cz) / r) * min; }
    return v;
  };
  outside(end.pos);
  const e = cyl(end.pos);
  const pace = pacing(kind === 'history' ? 0.12 : 0.05);
  type Raw = (u: number, out: Pose) => void;
  /** One way to fly the move: round one way or the other (dir), from the planned distance or closer in (k). */
  const variant = (dir: number, k: number): Raw => {
  let raw: Raw;
  if (kind === 'orbit') {
    // More than half way round, climbing from low on the far side up to the sign.
    const sweep = Math.PI * 1.15, r0 = Math.max(keep + 14, fitDistance(t, aspect, 52) * 0.8), y0 = t.base + Math.max(7, h * 0.16);
    raw = (u, o) => {
      // Wide for the first half (the building in its city), closing in on the sign over the second.
      const a = e.a - dir * sweep * (1 - u), r = r0 + (e.r - r0) * smooth((u - 0.45) / 0.55);
      outside(o.pos.set(t.cx + Math.sin(a) * r, y0 + (end.pos.y - y0) * smooth(u), t.cz + Math.cos(a) * r));
      o.look.copy(mid).lerp(end.look, smooth((u - 0.45) / 0.55));
      o.fov = 52 + (endFov - 52) * smooth((u - 0.4) / 0.6);
    };
  } else if (kind === 'flyover') {
    // In from far off and high, a little to one side, swooping down the street to the sign.
    const far = Math.max(520, h * 3.2), yaw = 0.42 * dir;
    const from = new THREE.Vector3(t.signOut.x * Math.cos(yaw) + t.signOut.z * Math.sin(yaw), 0, t.signOut.z * Math.cos(yaw) - t.signOut.x * Math.sin(yaw));
    const start = new THREE.Vector3(t.cx, t.top + Math.max(170, h * 0.7), t.cz).addScaledVector(from, far);
    const ctrl = end.pos.clone().addScaledVector(t.signOut, far * 0.42).setY(end.pos.y + Math.max(30, h * 0.12));
    const crown = new THREE.Vector3(t.cx, t.base + h * 0.8, t.cz);
    raw = (u, o) => {
      const k = 1 - u;
      outside(o.pos.set(0, 0, 0).addScaledVector(start, k * k).addScaledVector(ctrl, 2 * k * u).addScaledVector(end.pos, u * u));
      o.look.copy(crown).lerp(end.look, smooth((u - 0.5) / 0.5));
      o.fov = 56 + (endFov - 56) * smooth(u);
    };
  } else {
    // History: stand well back so the whole building and the sky over it stay in frame, drift a
    // quarter of the way round to the front, then ease in toward the sign for the finale.
    const fov = 46, r = Math.max(keep + 10, fitDistance(t, aspect, fov, 1.2) * k), sweep = Math.PI * 0.5, y0 = t.base + h * 0.5;
    // The finale looks up at the roof line, where the fireworks go off.
    const wide = new THREE.Vector3(), lookEnd = new THREE.Vector3(t.cx, t.top + 6 + h * 0.04, t.cz).lerp(end.look, 0.3);
    raw = (u, o) => {
      const a = e.a - dir * sweep * (1 - smooth(Math.min(1, u / 0.82)));
      wide.set(t.cx + Math.sin(a) * r, y0, t.cz + Math.cos(a) * r);
      const push = smooth((u - 0.8) / 0.2) * 0.3;
      outside(o.pos.copy(wide).lerp(end.pos, push));
      o.look.copy(mid).lerp(lookEnd, smooth((u - 0.8) / 0.2));
      o.fov = fov + (endFov + 4 - fov) * push;
    };
  }
  return raw;
  };

  // ---- lift the path over whatever is in the way, then smooth the lift ----
  const K = 200, p: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  const probe = new THREE.Vector3(), low = new THREE.Vector3(t.cx, t.base + h * 0.3, t.cz);
  /** How far along cam→look the view reaches the building itself. */
  const reach = (from: THREE.Vector3, to: THREE.Vector3) => {
    for (let i = 1; i <= 48; i++) {
      probe.lerpVectors(from, to, i / 48);
      if (Math.hypot(probe.x - t.cx, probe.z - t.cz) < t.radius + 3) return (i - 1) / 48;
    }
    return 1;
  };
  /** The lift a variant needs along its length, and how much of it still has a neighbor in front of the building. */
  const plan = (raw: Raw) => {
  const need = new Float32Array(K + 1);
  let blocked = 0;
  for (let i = 0; i <= K; i++) {
    raw(i / K, p);
    let floor = -Infinity;
    for (const [ox, oz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) floor = Math.max(floor, w.solidTop(p.pos.x + ox, p.pos.z + oz));
    let lift = Math.max(0, floor + 5 - p.pos.y);
    // The subject has to be in view, and for the history film its lower floors too (the building rises from the ground).
    const stop = reach(p.pos, p.look) - 0.03, stopLow = reach(p.pos, low) - 0.03;
    for (let n = 0; ; n++) {
      probe.copy(p.pos); probe.y += lift;
      if (w.ray(probe, p.look) >= stop && (kind !== 'history' || w.ray(probe, low) >= stopLow)) break;
      // The last seconds (the sign) matter most.
      if (n >= 28) { blocked += i > K * 0.8 ? 3 : 1; break; }
      // Not so high that the film turns into a view straight down: past that, a neighbor in the corner of the frame is the lesser evil.
      if (p.pos.y + lift + 10 > Math.max(t.top, floor) + 12 + Math.hypot(p.pos.x - t.cx, p.pos.z - t.cz) * 0.55) { blocked += i > K * 0.8 ? 3 : 1; break; }
      lift += 10;
    }
    need[i] = lift;
  }
  const wide = new Float32Array(K + 1), tmp = new Float32Array(K + 1);
  for (let i = 0; i <= K; i++) { let m = 0; for (let j = Math.max(0, i - 15); j <= Math.min(K, i + 15); j++) m = Math.max(m, need[j]); wide[i] = m; }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i <= K; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - 5); j <= Math.min(K, i + 5); j++) { s += wide[j]; n++; } tmp[i] = s / n; }
    wide.set(tmp);
  }
  return { raw, lift: wide, blocked };
  };
  // Try the move a few ways and keep the one with the clearest view of the building.
  const tries: [number, number][] = kind === 'history' ? [[1, 1], [-1, 1], [1, 0.7], [-1, 0.7], [1, 0.5], [-1, 0.5], [1, 0.35], [-1, 0.35]] : [[1, 1], [-1, 1]];
  let best = plan(variant(...tries[0]));
  for (let i = 1; i < tries.length && best.blocked > 0; i++) { const next = plan(variant(...tries[i])); if (next.blocked < best.blocked) best = next; }
  const { raw, lift: wide } = best;
  const liftAt = (u: number) => {
    const f = THREE.MathUtils.clamp(u, 0, 1) * K, i = Math.min(K - 1, Math.floor(f)), x = f - i;
    const a = wide[Math.max(0, i - 1)], b = wide[i], c = wide[i + 1], d = wide[Math.min(K, i + 2)];
    // Catmull-Rom, so the lift has no corners.
    return Math.max(0, 0.5 * (2 * b + (c - a) * x + (2 * a - 5 * b + 4 * c - d) * x * x + (3 * b - a - 3 * c + d) * x * x * x));
  };

  return {
    duration,
    pose(time, out) {
      const u = pace(time / duration);
      raw(u, out);
      out.pos.y += liftAt(u);
    },
  };
}

/** Runs a shot on the engine's camera. `update` is called from the game loop instead of the player's camera. */
export class Cinema {
  active = false;
  /** Seconds into the current shot. */
  time = 0;
  private shot: Shot | null = null;
  private saved: { pos: THREE.Vector3; quat: THREE.Quaternion; up: THREE.Vector3; fov: number; near: number; far: number; zoom: number } | null = null;
  private done: ((finished: boolean) => void) | null = null;
  private p: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  /** Called each frame of a shot, after the camera is placed. */
  onFrame: ((time: number, dt: number) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Take the camera and run the shot. Resolves true when it played to the end, false if it was stopped. */
  play(shot: Shot): Promise<boolean> {
    this.stop();
    const c = this.camera;
    this.saved = { pos: c.position.clone(), quat: c.quaternion.clone(), up: c.up.clone(), fov: c.fov, near: c.near, far: c.far, zoom: c.zoom };
    this.shot = shot;
    this.time = 0;
    this.active = true;
    this.place(0);
    return new Promise((resolve) => { this.done = resolve; });
  }

  update(dt: number) {
    if (!this.active || !this.shot) return;
    this.time += dt;
    const over = this.time >= this.shot.duration;
    this.place(Math.min(this.time, this.shot.duration));
    this.onFrame?.(Math.min(this.time, this.shot.duration), dt);
    if (over) this.finish(true);
  }

  /** Stop early and give the camera back. */
  stop() { if (this.active) this.finish(false); }

  private place(time: number) {
    const c = this.camera, p = this.p;
    this.shot!.pose(time, p);
    c.position.copy(p.pos);
    c.up.set(0, 1, 0);
    c.lookAt(p.look);
    if (Math.abs(c.fov - p.fov) > 0.005) { c.fov = p.fov; c.updateProjectionMatrix(); }
  }

  private finish(finished: boolean) {
    const c = this.camera, s = this.saved;
    this.active = false;
    this.shot = null;
    this.saved = null;
    if (s) {
      c.position.copy(s.pos); c.quaternion.copy(s.quat); c.up.copy(s.up);
      c.fov = s.fov; c.near = s.near; c.far = s.far; c.zoom = s.zoom;
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
    }
    const done = this.done;
    this.done = null;
    done?.(finished);
  }
}
