// Amsterdam's canal houses (worker side): the map merges a row of houses into one footprint, so along
// each street-facing wall this splits the row into ~6 m lots (the same lots the facade shader paints
// doors and windows in) and stands a gable on each: bell, neck, step and spout gables in the brick of
// the wall with white sandstone copings, and a steep tiled roof running back from each one.
import { Buf, inRing, triangulate } from '../build/geo.ts';

type RGB = [number, number, number];
interface Grid { get(x: number, z: number): number }

const h01 = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** Gable outline in (u across the lot from 0..w, y up from 0), counter-clockwise from the bottom left. */
function outline(kind: number, w: number, gh: number): [number, number][] {
  const m = w / 2;
  switch (kind) {
    case 0: { // bell gable: a tall neck with curved shoulders
      const n = Math.min(w * 0.36, 2.2), out: [number, number][] = [[0, 0], [w, 0]];
      for (let k = 0; k <= 5; k++) { const t = k / 5; out.push([w - (m - n / 2) * (1 - Math.cos((t * Math.PI) / 2)), gh * 0.62 * Math.sin((t * Math.PI) / 2)]); }
      out.push([m + n / 2, gh * 0.9], [m, gh], [m - n / 2, gh * 0.9]);
      for (let k = 5; k >= 0; k--) { const t = k / 5; out.push([(m - n / 2) * (1 - Math.cos((t * Math.PI) / 2)), gh * 0.62 * Math.sin((t * Math.PI) / 2)]); }
      return out;
    }
    case 1: { // neck gable: square shoulders, a tall neck, a pediment
      const n = Math.min(w * 0.4, 2.4);
      return [[0, 0], [w, 0], [w, gh * 0.18], [m + n / 2, gh * 0.4], [m + n / 2, gh * 0.82], [m + n / 2 + 0.25, gh * 0.82], [m, gh], [m - n / 2 - 0.25, gh * 0.82], [m - n / 2, gh * 0.82], [m - n / 2, gh * 0.4], [0, gh * 0.18]];
    }
    case 2: { // step gable
      const steps = 4, out: [number, number][] = [[0, 0], [w, 0]];
      for (let k = 0; k < steps; k++) { const x = w - (k / steps) * (m - 0.6), y = ((k + 1) / steps) * gh * 0.92; out.push([x, y - gh * 0.92 / steps + 0.0], [x, y], [x - (m - 0.6) / steps, y]); }
      out.push([m + 0.6, gh], [m - 0.6, gh]);
      for (let k = steps - 1; k >= 0; k--) { const x = (k / steps) * (m - 0.6), y = ((k + 1) / steps) * gh * 0.92; out.push([x + (m - 0.6) / steps, y], [x, y], [x, y - gh * 0.92 / steps]); }
      // Drop repeated points.
      return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 0.01);
    }
    default: // spout gable: a plain point
      return [[0, 0], [w, 0], [m, gh]];
  }
}

/**
 * Gables along the street walls of a canal-house row. `W` the wall colour, `roof` the tiles, `sd` the
 * facade seed, `h` the building height (facade shader frame), `gmin` the ground.
 */
export function canalGables(b: Buf, ring: number[], streetR: Grid, gmin: number, top: number, h: number, W: RGB, sd: number, key: number) {
  const n = ring.length / 2;
  const trim: RGB = [236, 232, 222], tiles: RGB = [92, 64, 54], dark: RGB = [W[0] * 0.8, W[1] * 0.8, W[2] * 0.8];
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4.5 || len > 140) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
    if (!streetR.get((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4)) continue;
    // The facade shader's lots: ~6.2 m houses.
    const lots = Math.max(1, Math.floor(len / 6.2 + 0.5)), LW = len / lots;
    for (let k = 0; k < lots; k++) {
      const s = h01(key * 0.013 + q * 7.1 + k * 3.7);
      const kind = s < 0.3 ? 0 : s < 0.55 ? 1 : s < 0.8 ? 2 : 3;
      const u0 = k * LW, w = LW - 0.05, gh = Math.min(6.5, w * (kind === 3 ? 0.75 : 1.05));
      // Only where the house runs back far enough for its roof.
      const mu = u0 + w / 2, depth = Math.min(10, 2 * w);
      if (!inRing(ring, ax + tx * mu - nx * depth, az + tz * mu - nz * depth)) continue;
      const P = (u: number, o: number, y: number): [number, number, number] => [ax + tx * (u0 + u) - nx * o, top + y, az + tz * (u0 + u) - nz * o];
      const pts = outline(kind, w, gh);
      // Front face (brick, painted by the facade shader as the same wall) and back face.
      const flat: number[] = [];
      for (const [u, y] of pts) flat.push(u, y);
      const tris = triangulate(flat, []);
      for (const [o, front] of [[0, true], [0.35, false]] as [number, boolean][]) {
        const base = b.count;
        for (const [u, y] of pts) {
          const p = P(u, o, y);
          b.v(p[0], p[1], p[2]);
          if (front) { b.nrm.push(nx, 0, nz); b.col.push(...W); b.fac.push(u0 + u, top + y - gmin, len, h); }
          else { b.nrm.push(-nx, 0, -nz); b.col.push(...dark); b.fac.push(0, h, 0, h); }
          b.seed.push(sd);
        }
        for (let i = 0; i < tris.length; i += 3) {
          const A = pts[tris[i]], B = pts[tris[i + 1]], C = pts[tris[i + 2]];
          const ccw = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0;
          // Seen from outside (the front), counter-clockwise in (u, y) faces out.
          if (ccw === front) b.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
          else b.tri(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
        }
      }
      // White sandstone coping along the gable's edge (a thin band on top of each upper edge).
      for (let i = 1; i < pts.length; i++) {
        const [u1, y1] = pts[i], [u2, y2] = pts[(i + 1) % pts.length];
        if (y1 < 0.01 && y2 < 0.01) continue;
        const base = b.count;
        for (const [u, y, o] of [[u1, y1, -0.06], [u2, y2, -0.06], [u2, y2 + 0.16, -0.06], [u1, y1 + 0.16, -0.06]] as [number, number, number][]) {
          const p = P(u, o, y); b.v(p[0], p[1], p[2]); b.nrm.push(nx, 0, nz); b.col.push(...trim); b.fac.push(0, h, 0, h); b.seed.push(sd);
        }
        if (u2 >= u1) b.quad(base, base + 1, base + 2, base + 3); else b.quad(base, base + 3, base + 2, base + 1);
      }
      // The steep roof behind: two slopes from the eaves up to the ridge, running back from the gable.
      const ridge = Math.min(gh * 0.85, w * 0.9);
      for (const side of [0, 1]) {
        const ue = side ? w : 0, base = b.count;
        const quad: [number, number, number][] = [[ue, 0.35, 0], [mu - u0, 0.35, ridge], [mu - u0, depth, ridge], [ue, depth, 0]];
        const sx = side ? 1 : -1;
        const slope = Math.hypot(w / 2, ridge);
        const rn: [number, number, number] = [tx * sx * (ridge / slope), (w / 2) / slope, tz * sx * (ridge / slope)];
        for (const [u, o, y] of quad) { const p = P(u, o, y); b.v(p[0], p[1], p[2]); b.nrm.push(...rn); b.col.push(...tiles); b.fac.push(0, h, -1, h); b.seed.push(sd); }
        if (side) b.quad(base, base + 3, base + 2, base + 1); else b.quad(base, base + 1, base + 2, base + 3);
      }
    }
  }
}
