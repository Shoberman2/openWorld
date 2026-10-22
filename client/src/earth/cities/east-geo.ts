// East US building geometry (chunk worker): what the facade shader can't paint on a flat wall.
//  - South Beach Art Deco: a white "eyebrow" sunshade over each window band, and on some buildings a
//    vertical fin over the entrance carrying a neon stripe (lit after dark).
//  - Back Bay / South End bowfronts: a full-height bow on each house front beside its door, windowed
//    by the same shader (each bow face shows one of the house's window bays).
//  - Brickell / Toronto condos: a slab edge and glass rail on every floor (balconies all round).
import type { Buf } from '../build/geo.ts';
import { STYLE, STYLES, facadeDims } from '../build/facades.ts';

type RGB = [number, number, number];
const TRIM = -3, LIT = -4;

const hash01 = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const fract = (v: number) => v - Math.floor(v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** One quad with trim attributes (facade code: -3 plain, -4 lit). */
function face(b: Buf, p: number[][], n: [number, number, number], col: RGB, u0: number, u1: number, gmin: number, sd: number, h: number, code = TRIM) {
  const base = b.count;
  p.forEach((v, i) => { b.v(v[0], v[1], v[2]); b.nrm.push(...n); b.col.push(...col); b.fac.push(i === 1 || i === 2 ? u1 : u0, v[1] - gmin, code, h); b.seed.push(sd); });
  b.quad(base, base + 1, base + 2, base + 3);
}

/** A box in a wall's frame (u along from a, o outward, y up): front, top, bottom, ends. */
function box(b: Buf, ax: number, az: number, tx: number, tz: number, nx: number, nz: number, u0: number, u1: number, o0: number, o1: number, y0: number, y1: number, col: RGB, sd: number, h: number, gmin: number, front = TRIM) {
  const P = (u: number, o: number, y: number) => [ax + tx * u + nx * o, y, az + tz * u + nz * o];
  const dk: RGB = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8];
  face(b, [P(u0, o1, y0), P(u1, o1, y0), P(u1, o1, y1), P(u0, o1, y1)], [nx, 0, nz], col, u0, u1, gmin, sd, h, front);
  face(b, [P(u0, o1, y1), P(u1, o1, y1), P(u1, o0, y1), P(u0, o0, y1)], [0, 1, 0], col, u0, u1, gmin, sd, h);
  face(b, [P(u0, o0, y0), P(u1, o0, y0), P(u1, o1, y0), P(u0, o1, y0)], [0, -1, 0], dk, u0, u1, gmin, sd, h);
  face(b, [P(u1, o1, y0), P(u1, o0, y0), P(u1, o0, y1), P(u1, o1, y1)], [tx, 0, tz], dk, 0, o1 - o0, gmin, sd, h);
  face(b, [P(u0, o0, y0), P(u0, o1, y0), P(u0, o1, y1), P(u0, o0, y1)], [-tx, 0, -tz], dk, 0, o1 - o0, gmin, sd, h);
}

/** The ring pushed out along its outward normals (mitered; the ring winds so (-dz, dx) points out). */
function offset(ring: number[], d: number) {
  const n = ring.length / 2, out: number[] = [];
  for (let q = 0; q < n; q++) {
    const p = (q + n - 1) % n, r = (q + 1) % n;
    const ax = ring[p * 2], az = ring[p * 2 + 1], bx = ring[q * 2], bz = ring[q * 2 + 1], cx = ring[r * 2], cz = ring[r * 2 + 1];
    const l0 = Math.hypot(bx - ax, bz - az) || 1, l1 = Math.hypot(cx - bx, cz - bz) || 1;
    const n0x = -(bz - az) / l0, n0z = (bx - ax) / l0, n1x = -(cz - bz) / l1, n1z = (cx - bx) / l1;
    let mx = n0x + n1x, mz = n0z + n1z;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * n1x + mz * n1z));
    out.push(bx + mx * d * k, bz + mz * d * k);
  }
  return out;
}

/** A slab all round the ring at y (thick t, projecting `proj`), with an optional glass rail on its edge. */
function slab(b: Buf, ring: number[], O: number[], y: number, t: number, col: RGB, rail: RGB | null, sd: number, h: number, gmin: number) {
  const n = ring.length / 2;
  const under: RGB = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const A = [O[q * 2], O[q * 2 + 1]], B = [O[r * 2], O[r * 2 + 1]];
    face(b, [[ax, y, az], [bx, y, bz], [B[0], y, B[1]], [A[0], y, A[1]]], [0, -1, 0], under, 0, len, gmin, sd, h);
    face(b, [[A[0], y, A[1]], [B[0], y, B[1]], [B[0], y + t, B[1]], [A[0], y + t, A[1]]], [nx, 0, nz], col, 0, len, gmin, sd, h);
    face(b, [[A[0], y + t, A[1]], [B[0], y + t, B[1]], [bx, y + t, bz], [ax, y + t, az]], [0, 1, 0], col, 0, len, gmin, sd, h);
    if (rail) face(b, [[A[0], y + t, A[1]], [B[0], y + t, B[1]], [B[0], y + t + 1.05, B[1]], [A[0], y + t + 1.05, A[1]]], [nx, 0, nz], rail, 0, len, gmin, sd, h);
  }
}

/** One of the East US styles (no New York water tanks on their roofs; extras from eastExtras). */
export const isEastStyle = (style: number) => style === STYLE.miamideco || style === STYLE.condo || style === STYLE.bowfront || style === STYLE.chicagoschool;

const NEON: RGB[] = [[255, 70, 170], [60, 220, 255], [120, 255, 170], [255, 150, 60], [180, 110, 255]];

/**
 * Extras for one building of an East US style (called by the chunk builder for detailed chunks).
 * `front(x, z)`: the street raster (2 avenue, 1 side street, 0 none).
 */
export function eastExtras(b: Buf, style: number, glass: boolean, balconies: boolean, ring: number[], front: (x: number, z: number) => number,
  gmin: number, h: number, top: number, fs: number, sd: number, wall: RGB, key: number, ground: number) {
  if (glass) {
    // Glass condo towers (Miami, Toronto): balconies on the shader's 3.9 m curtain-wall floors.
    if (!balconies || h < 30 || h > 330 || ring.length > 80 || hash01(key + 211) > 0.55) return;
    const O = offset(ring, 1.7);
    for (let y = gmin + 3.9 * 2; y < top - 4; y += 3.9) slab(b, ring, O, y - 0.05, 0.25, [236, 238, 236], [150, 186, 196], sd, h, gmin);
    return;
  }
  const st = STYLES[style];
  if (style === STYLE.condo) {
    if (h < 20 || ring.length > 80) return;
    const dims = facadeDims(style, fs, h, ground);
    const O = offset(ring, 1.6);
    for (let y = gmin + dims.first + dims.floorH; y < top - 2; y += dims.floorH) slab(b, ring, O, y - 0.05, 0.22, [244, 244, 240], [150, 184, 194], sd, h, gmin);
    return;
  }
  if (style === STYLE.miamideco) {
    if (h < 6) return;
    const dims = facadeDims(style, fs, h, ground);
    const wh = mix(st.winH[0], st.winH[1], fract(fs * 13.7)) * 0.5;
    const n = ring.length / 2;
    let best = -1, bestLen = 0;
    for (let q = 0; q < n; q++) {
      const r = (q + 1) % n;
      const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      if (!front((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4)) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      // Eyebrows: a thin white shade over each floor's windows, the length of the street front.
      for (let f = 0; ; f++) {
        const y = gmin + dims.first + dims.floorH * (f + 0.5 + wh) + 0.06;
        if (y > top - 0.9) break;
        box(b, ax, az, tx, tz, nx, nz, 0.05, len - 0.05, 0, 0.55, y, y + 0.1, st.trim, sd, h, gmin);
      }
      if (len > bestLen) { bestLen = len; best = q; }
    }
    // A vertical fin over the entrance, rising past the parapet, with a neon stripe down its edge.
    if (best >= 0 && bestLen >= 9 && h >= 9 && hash01(key + 223) < 0.45) {
      const r = (best + 1) % n;
      const ax = ring[best * 2], az = ring[best * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
      const tx = (bx - ax) / bestLen, tz = (bz - az) / bestLen, nx = -tz, nz = tx;
      const u = bestLen * (0.5 + (hash01(key + 227) - 0.5) * 0.3);
      const y0 = gmin + dims.first + 0.4, y1 = top + 2.2 + hash01(key + 229) * 2.5;
      const finC: RGB = hash01(key + 231) < 0.6 ? st.trim : [wall[0] * 0.92, wall[1] * 0.92, wall[2] * 0.92];
      box(b, ax, az, tx, tz, nx, nz, u - 0.17, u + 0.17, 0, 0.95, y0, y1, finC, sd, h, gmin);
      box(b, ax, az, tx, tz, nx, nz, u - 0.07, u + 0.07, 0.95, 1.02, y0 + 0.3, y1 - 0.3, NEON[Math.floor(hash01(key + 233) * NEON.length)], sd, h, gmin, LIT);
    }
    return;
  }
  if (style === STYLE.bowfront) {
    if (h < 7 || h > 26 || hash01(key + 241) > 0.8) return;
    const n = ring.length / 2;
    for (let q = 0; q < n; q++) {
      const r = (q + 1) % n;
      const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5.2) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const fr = front((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4);
      if (!fr) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      const dims = facadeDims(style, fs, h, 0);
      // Lots laid out exactly as the facade shader does (~6.2 m houses, the door in the first bay).
      const lots = Math.max(1, Math.floor(len / 6.2 + 0.5)), LW = len / lots;
      const bays = Math.max(1, Math.floor((LW - 0.4) / dims.bayW));
      if (bays < 3) continue;
      const margin = (LW - bays * dims.bayW) / 2;
      const y0 = gmin - 1.6, y1 = top - 0.95;
      for (let k = 0; k < lots; k++) {
        // The bow fills the bays beside the door.
        const u0 = LW * k + margin + dims.bayW + 0.05, u1 = LW * k + margin + bays * dims.bayW - 0.05;
        const wBow = u1 - u0, depth = Math.min(1.25, wBow * 0.32), side = depth * 0.62;
        const P = (u: number, o: number) => [ax + tx * u + nx * o, az + tz * u + nz * o];
        const pts = [P(u0, 0), P(u0 + side, depth), P(u1 - side, depth), P(u1, 0)];
        // Each face shows one window bay: the left side bay 1, the front bay 1 again, the right side the last bay.
        const bayU = [1, 1, bays - 1];
        for (let s = 0; s < 3; s++) {
          const [px, pz] = pts[s], [qx, qz] = pts[s + 1];
          const fl = Math.hypot(qx - px, qz - pz);
          const fnx = -(qz - pz) / fl, fnz = (qx - px) / fl;
          const ua = LW * k + margin + bayU[s] * dims.bayW, ub = ua + dims.bayW;
          // Facade coordinates: u maps onto that bay of a wall LW long (so the shader draws one centered window).
          const base = b.count;
          for (const [x, y, z, u] of [[px, y0, pz, ua], [qx, y0, qz, ub], [qx, y1, qz, ub], [px, y1, pz, ua]] as number[][]) {
            b.v(x, y, z); b.nrm.push(fnx, 0, fnz); b.col.push(...wall); b.fac.push(u - LW * k, y - gmin, LW, h); b.seed.push(sd);
          }
          b.quad(base, base + 1, base + 2, base + 3);
        }
        // Its roof (under the cornice), and a cornice of its own.
        const roofC: RGB = [96, 94, 92];
        const rb = b.count;
        for (const [x, z] of pts) { b.v(x, y1, z); b.nrm.push(0, 1, 0); b.col.push(...roofC); b.fac.push(0, h, 0, h); b.seed.push(sd); }
        b.tri(rb, rb + 1, rb + 2); b.tri(rb, rb + 2, rb + 3);
        const cc = st.corniceColor ?? st.trim;
        for (let s = 0; s < 3; s++) {
          const [px, pz] = pts[s], [qx, qz] = pts[s + 1];
          const fl = Math.hypot(qx - px, qz - pz), ftx = (qx - px) / fl, ftz = (qz - pz) / fl;
          box(b, px, pz, ftx, ftz, -ftz, ftx, 0, fl, 0, 0.3, y1 - 0.55, y1, cc, sd, h, gmin);
        }
      }
    }
  }
}
