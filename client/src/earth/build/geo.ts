// Geometry helpers for the chunk builder (worker side): growable indexed buffers, draped ribbons,
// polygon utilities. No three.js scene objects here, only math.
import { ShapeUtils, Vector2 } from 'three';
import type { MeshData } from './types.ts';

/** Growable indexed mesh buffer. */
export class Buf {
  pos: number[] = [];
  idx: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  fac: number[] = [];
  seed: number[] = [];
  get count() { return this.pos.length / 3; }

  v(x: number, y: number, z: number) { this.pos.push(x, y, z); return this.count - 1; }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }

  /** Finish: typed arrays; normals computed (smooth per shared vertex) unless provided. */
  out(opts: { normals?: boolean } = {}): MeshData | null {
    if (!this.idx.length) return null;
    const pos = new Float32Array(this.pos);
    const m: MeshData = { pos, idx: new Uint32Array(this.idx) };
    if (this.nrm.length) m.nrm = toInt8(this.nrm);
    else if (opts.normals !== false) m.nrm = toInt8(computeNormals(pos, m.idx!));
    if (this.uv.length) m.uv = new Float32Array(this.uv);
    if (this.col.length) m.col = new Uint8Array(this.col);
    if (this.fac.length) m.fac = new Float32Array(this.fac);
    if (this.seed.length) m.seed = new Float32Array(this.seed);
    return m;
  }
}

function toInt8(n: number[] | Float32Array) {
  const o = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) o[i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127)));
  return o;
}

export function computeNormals(pos: Float32Array, idx: Uint32Array) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Signed area of a flat [x,z,...] ring (positive = counter-clockwise in x/z math coordinates). */
export function signedArea(p: number[]) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
  return a / 2;
}

export function reversed(p: number[]) {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** Drop duplicate and nearly collinear points. */
export function cleanRing(p: number[], tol = 0.2) {
  let out: number[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.hypot(out[n - 2] - p[i], out[n - 1] - p[i + 1]) < tol) continue;
    out.push(p[i], p[i + 1]);
  }
  if (out.length >= 4 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) < tol) out.length -= 2;
  // Collinear removal (a few passes).
  for (let pass = 0; pass < 2 && out.length > 6; pass++) {
    const keep: number[] = [];
    const n = out.length / 2;
    for (let i = 0; i < n; i++) {
      const a = ((i - 1 + n) % n) * 2, b = i * 2, c = ((i + 1) % n) * 2;
      const cross = (out[b] - out[a]) * (out[c + 1] - out[a + 1]) - (out[b + 1] - out[a + 1]) * (out[c] - out[a]);
      const len = Math.hypot(out[c] - out[a], out[c + 1] - out[a + 1]) || 1;
      if (Math.abs(cross) / len < 0.08) continue;
      keep.push(out[b], out[b + 1]);
    }
    if (keep.length < 6) break;
    out = keep;
  }
  return out;
}

/** Triangulate a ring with holes; returns index triples into the concatenated [ring, ...holes] vertex list. */
export function triangulate(ring: number[], holes: number[][]): number[] {
  const toV = (r: number[]) => { const v: Vector2[] = []; for (let i = 0; i < r.length; i += 2) v.push(new Vector2(r[i], r[i + 1])); return v; };
  try {
    const tris = ShapeUtils.triangulateShape(toV(ring), holes.map(toV));
    return tris.flat();
  } catch {
    return [];
  }
}

export function inRing(p: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function hash01(n: number) {
  let t = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Insert points so no segment is longer than `max` (for draping on terrain). */
export function densify(pts: number[], max: number) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / max);
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  }
  return out;
}

export function cumLen(pts: number[]) {
  const c = [0];
  for (let i = 2; i < pts.length; i += 2) c.push(c[c.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return c;
}

/** Point, tangent and interpolated y at distance s along a polyline with per-point ys. */
export function alongY(pts: number[], ys: number[], cum: number[], s: number, out: { x: number; z: number; y: number; tx: number; tz: number }) {
  const len = cum[cum.length - 1];
  s = Math.max(0, Math.min(len, s));
  let k = 1;
  while (k < cum.length - 1 && cum[k] < s) k++;
  const s0 = cum[k - 1], s1 = cum[k];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const ax = pts[(k - 1) * 2], az = pts[(k - 1) * 2 + 1], bx = pts[k * 2], bz = pts[k * 2 + 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.x = ax + (bx - ax) * f; out.z = az + (bz - az) * f;
  out.y = ys[k - 1] + (ys[k] - ys[k - 1]) * f;
  out.tx = (bx - ax) / l; out.tz = (bz - az) / l;
  return out;
}

/**
 * A ribbon of `width` along a polyline, mitered at corners. `yAt(x, z, i)` gives each edge vertex
 * its height (draped on terrain, or the bridge deck at point i). Faces up.
 */
/**
 * A strip of `width` along a polyline, draped by yAt. With uvLen, uv = (0|1 across, length / uvLen);
 * with uvx, uv = (uvx(0)|uvx(width) across, meters along or the constant uvy) for street surfaces
 * that pattern themselves.
 */
export function ribbon(b: Buf, pts: number[], width: number, yAt: (x: number, z: number, i: number) => number, uvLen = 0, uvx: ((o: number) => number) | null = null, uvy: number | null = null) {
  const n = pts.length / 2;
  if (n < 2) return;
  const half = width / 2;
  let acc = 0;
  let prevL = -1, prevR = -1;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let tx = 0, tz = 0;
    if (i > 0) { const dx = x - pts[i * 2 - 2], dz = z - pts[i * 2 - 1], l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; acc += l; }
    if (i < n - 1) { const dx = pts[i * 2 + 2] - x, dz = pts[i * 2 + 3] - z, l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = x - pts[i * 2 - 2], dz = z - pts[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
      k = Math.min(2.2, 1 / Math.max(0.3, (dx / l) * tx + (dz / l) * tz));
    }
    const rx = -tz * half * k, rz = tx * half * k;
    const lx = x - rx, lz = z - rz, qx = x + rx, qz = z + rz;
    const L = b.v(lx, yAt(lx, lz, i), lz), Rr = b.v(qx, yAt(qx, qz, i), qz);
    if (uvx) b.uv.push(uvx(0), uvy ?? acc, uvx(width), uvy ?? acc);
    else if (uvLen > 0) b.uv.push(0, acc / uvLen, 1, acc / uvLen);
    if (prevL >= 0) {
      // Wound to face up (+y) with z pointing south.
      b.tri(prevL, prevR, Rr);
      b.tri(prevL, Rr, L);
    }
    prevL = L; prevR = Rr;
  }
}

/** Flat-ish disc (draped) for rounding intersections. */
export function disc(b: Buf, x: number, z: number, r: number, yAt: (x: number, z: number) => number, seg = 14, uv: [number, number] | null = null) {
  const c = b.v(x, yAt(x, z), z);
  if (uv) b.uv.push(uv[0], uv[1]);
  const first = b.count;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    b.v(px, yAt(px, pz), pz);
    if (uv) b.uv.push(uv[0], uv[1]);
  }
  for (let i = 0; i < seg; i++) b.tri(c, first + ((i + 1) % seg), first + i);
}

/** Painted strip between two points (dashes, zebra stripes). */
export function strip(b: Buf, ax: number, az: number, ay: number, bx: number, bz: number, by: number, w: number) {
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const rx = (-(bz - az) / l) * (w / 2), rz = ((bx - ax) / l) * (w / 2);
  const a = b.v(ax - rx, ay, az - rz), c = b.v(ax + rx, ay, az + rz), d = b.v(bx + rx, by, bz + rz), e = b.v(bx - rx, by, bz - rz);
  b.tri(a, c, d); b.tri(a, d, e);
}
