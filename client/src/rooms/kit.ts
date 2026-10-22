// Geometry kit for building interiors: an oriented frame for each footprint, polygon inset, merged
// vertex-colored buffers (one draw call per material), walls with openings, furniture boxes.
import * as THREE from 'three';

export type RGB = [number, number, number];
export const hex = (c: number): RGB => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inRing(p: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function signedArea(p: number[]) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
  return a / 2;
}

/** Distance from (x,z) to the nearest ring edge. */
export function edgeDist(p: number[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], ex = p[i] - ax, ez = p[i + 1] - az, l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

/**
 * Inset a ring by d meters (vertex i stays vertex i, so edge indices survive). Falls back to
 * shrinking toward the centroid when the offset folds over itself.
 */
export function insetRing(ring: number[], d: number): number[] {
  const n = ring.length / 2;
  const sa = signedArea(ring);
  const s = sa < 0 ? 1 : -1; // inward normal = s * (dz, -dx) for the edge direction (dx, dz)
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = ring[p * 2], az = ring[p * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1], cx = ring[q * 2], cz = ring[q * 2 + 1];
    const l1 = Math.hypot(bx - ax, bz - az) || 1, l2 = Math.hypot(cx - bx, cz - bz) || 1;
    const n1x = (s * (bz - az)) / l1, n1z = (-s * (bx - ax)) / l1, n2x = (s * (cz - bz)) / l2, n2z = (-s * (cx - bx)) / l2;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n1x; mz = n1z; } else { mx /= ml; mz /= ml; }
    const cos = Math.max(0.35, mx * n1x + mz * n1z);
    out.push(bx + (mx * d) / cos, bz + (mz * d) / cos);
  }
  const ok = signedArea(out) * sa > 0 && Math.abs(signedArea(out)) > Math.abs(sa) * 0.25;
  if (ok) return out;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
  cx /= n; cz /= n;
  const r = Math.sqrt(Math.abs(sa)) / 2;
  const k = Math.max(0.3, 1 - d / Math.max(r, d * 2));
  return ring.map((v, i) => (i % 2 ? cz + (v - cz) * k : cx + (v - cx) * k));
}

/** The building's own axes: u along its longest wall, v across. Furniture lines up with them. */
export class Frame {
  ux = 1; uz = 0; vx = 0; vz = 1;
  constructor(ring: number[]) {
    let best = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const dx = ring[i] - ring[j], dz = ring[i + 1] - ring[j + 1], l = Math.hypot(dx, dz);
      if (l > best) { best = l; this.ux = dx / l; this.uz = dz / l; }
    }
    this.vx = -this.uz; this.vz = this.ux;
  }
  /** (u, v) -> (x, z) */
  x(u: number, v: number) { return u * this.ux + v * this.vx; }
  z(u: number, v: number) { return u * this.uz + v * this.vz; }
  u(x: number, z: number) { return x * this.ux + z * this.uz; }
  v(x: number, z: number) { return x * this.vx + z * this.vz; }
  /** Rotation about y that turns local +z (a furniture front) to face direction v (+1) in this frame. */
  yaw(du: number, dv: number) {
    const x = du * this.ux + dv * this.vx, z = du * this.uz + dv * this.vz;
    return Math.atan2(x, z);
  }
}

/** Growable vertex-colored triangle soup (non-indexed). */
export class Buf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], n: number[], col: RGB) {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) { this.nrm.push(...n); this.col.push(...col); }
  }
  quad(a: number[], b: number[], c: number[], d: number[], col: RGB) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((v) => v / l);
    this.tri(a, b, c, n, col);
    this.tri(a, c, d, n, col);
  }
  /**
   * Oriented box: center (x, z), footprint w (along yaw-rotated x) by d, from y0 up h.
   */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, yaw: number, col: RGB, top?: RGB) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const side = col; // the lights shade the sides; no painted-on darkening
    // +z, -z, +x, -x, top, bottom (all wound outward)
    this.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), col);
    this.quad(P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), side);
    this.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), side);
    this.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), side);
    this.quad(P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), top ?? col);
    if (y0 > 0.05) this.quad(P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd), side);
  }
  /** Any geometry (leaves, cylinders, spheres), placed by `m`, in one color. */
  geom(g: THREE.BufferGeometry, m: THREE.Matrix4, col: RGB) {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.attributes.position, n = src.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nrm.push(w.x, w.y, w.z); this.col.push(...col);
    }
    if (src !== g) src.dispose();
  }
  mesh(mat: THREE.Material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    return m;
  }
}

/** Upward (or downward) facing polygon with holes. */
export function slab(buf: Buf, ring: number[], holes: number[][], y: number, up: boolean, col: RGB) {
  const toV = (r: number[]) => { const v: THREE.Vector2[] = []; for (let i = 0; i < r.length; i += 2) v.push(new THREE.Vector2(r[i], r[i + 1])); return v; };
  const contour = toV(ring), hs = holes.map(toV);
  let tris: number[][];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { return; }
  const all = contour.concat(...hs);
  for (const [a, b, c] of tris) {
    const A = all[a], B = all[b], C = all[c];
    const ny = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
    const pa = [A.x, y, A.y], pb = [B.x, y, B.y], pc = [C.x, y, C.y];
    if ((ny >= 0) === up) buf.tri(pa, pb, pc, [0, up ? 1 : -1, 0], col);
    else buf.tri(pa, pc, pb, [0, up ? 1 : -1, 0], col);
  }
}

export interface Opening { t0: number; t1: number; y0: number; y1: number }

/** A wall from a to b (meters), y0..y1, facing `inward` (unit x,z), with rectangular openings. */
export function wall(buf: Buf, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, open: Opening[], col: RGB) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const P = (t: number, y: number) => [ax + ((bx - ax) * t) / len, y, az + ((bz - az) * t) / len];
  const cuts = [0, len, ...open.flatMap((o) => [o.t0, o.t1])].filter((t) => t >= 0 && t <= len).sort((a, b) => a - b);
  for (let k = 0; k + 1 < cuts.length; k++) {
    const t0 = cuts[k], t1 = cuts[k + 1];
    if (t1 - t0 < 1e-3) continue;
    const mid = (t0 + t1) / 2;
    const o = open.find((q) => mid > q.t0 && mid < q.t1);
    const spans: [number, number][] = o ? [[y0, o.y0], [o.y1, y1]] : [[y0, y1]];
    for (const [ya, yb] of spans) if (yb - ya > 1e-3) buf.quad(P(t0, ya), P(t1, ya), P(t1, yb), P(t0, yb), col);
  }
}

let backdrop: THREE.Texture | null = null;
/** What you see through a window: bright sky over a soft blue city. */
export function backdropTexture() {
  if (backdrop) return backdrop;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#5fa2e6'); sky.addColorStop(0.6, '#bfe0f6'); sky.addColorStop(1, '#e6f2fa');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 6; i++) { const x = (i * 97) % 512, y = 40 + (i * 37) % 60; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + k * 16, y - (k % 2) * 8, 14, 0, Math.PI * 2); g.fill(); } }
  let x = 0, seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (x < 512) {
    const w = 14 + r() * 30, h = 30 + r() * 90;
    g.fillStyle = `rgba(${120 + r() * 40},${145 + r() * 30},${175 + r() * 30},0.9)`;
    g.fillRect(x, 256 - h, w, h);
    x += w + 2;
  }
  backdrop = new THREE.CanvasTexture(c);
  backdrop.colorSpace = THREE.SRGBColorSpace;
  backdrop.wrapS = THREE.RepeatWrapping;
  return backdrop;
}
