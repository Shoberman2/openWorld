// Parks and woods (worker side): the forest canopy that makes Central Park read as Central Park from
// the air, built from the real map data. Wooded areas are dense; the rest of a park gets clustered
// stands of big trees with clearings, and the lawns, ball fields, playgrounds, rock outcrops, water
// and paths the map knows about stay open. Also rock outcrops, the low stone wall along a big park's
// edge (with gaps where paths come in), and earthy banks with boulders around park lakes.
import { clipRing, str, type Layers } from '../mvt.ts';
import { Buf, hash01, hashStr, inRing, signedArea } from './geo.ts';
import type { MeshData } from './types.ts';

export interface ParkCtx {
  layers: Layers;
  /** Tile extent and meters per tile unit. */
  E: number; S: number;
  size: number;
  lod: 0 | 1;
  tx: number; ty: number;
  north: boolean; tropical: boolean;
  hAt(x: number, z: number): number;
  wetAt(x: number, z: number): boolean;
  /** A building footprint covers this spot. */
  built(x: number, z: number): boolean;
  /** A road, path or its margin covers this spot. */
  road(x: number, z: number): boolean;
}

export interface ParkOut {
  /** Park and wood trees: x, y, z, rotation, scale, kind (0 broadleaf, 1 conifer, 2 palm). */
  trees: Float32Array;
  /** Boulders and outcrops: x, y, z, rotation, sx, sy, sz. */
  rocks: Float32Array;
  /** Stone walls along big parks' edges. */
  wall: MeshData | null;
}

// Cover classes in the raster.
const NONE = 0, PARK = 1, WOOD = 2, OPEN = 3, ROCK = 4, SCRUB = 5;
const LAWN = new Set(['grass', 'meadow', 'grassland', 'garden', 'flowerbed', 'village_green', 'recreation_ground', 'allotments']);
/** Grass areas at least this big (m²) inside a park are kept open as lawns. */
const LAWN_MIN = 9000;
const OPEN_USE = new Set(['pitch', 'playground', 'track', 'stadium', 'golf_course', 'parking', 'school', 'zoo', 'theme_park']);

/** Value noise in [0, 1], smooth, for clustering the park's tree stands. */
function vnoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const h = (i: number, j: number) => hash01(((i * 73856093) ^ (j * 19349663) ^ seed) >>> 0);
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, z: number, seed: number) => vnoise(x, z, seed) * 0.62 + vnoise(x * 2.3, z * 2.3, seed + 7) * 0.38;
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Fill polygon rings (chunk meters) into a byte raster with value v (even-odd, cell centers). */
function fillRaster(data: Uint8Array, n: number, cell: number, rings: number[][], v: number, only?: (old: number) => boolean) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const r of rings) for (let q = 1; q < r.length; q += 2) { minZ = Math.min(minZ, r[q]); maxZ = Math.max(maxZ, r[q]); }
  const j0 = Math.max(0, Math.floor(minZ / cell)), j1 = Math.min(n - 1, Math.ceil(maxZ / cell));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const zc = (j + 0.5) * cell;
    xs.length = 0;
    for (const r of rings) for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
      const za = r[k + 1], zb = r[i + 1];
      if ((za > zc) !== (zb > zc)) xs.push(r[k] + ((zc - za) / (zb - za)) * (r[i] - r[k]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil(xs[q] / cell - 0.5)), i1 = Math.min(n - 1, Math.floor(xs[q + 1] / cell - 0.5));
      for (let i = i0; i <= i1; i++) {
        const o = j * n + i;
        if (!only || only(data[o])) data[o] = v;
      }
    }
  }
}

export function buildParks(c: ParkCtx) {
  const { layers, E, S, size, lod } = c;
  const toM = (r: number[]) => r.map((v) => v * S);
  const C = lod === 0 ? 4 : 8;
  const n = Math.ceil(size / C);
  const cover = new Uint8Array(n * n);
  const rings = (poly: number[][]) => {
    const outer = clipRing(poly[0], E);
    if (!outer.length) return null;
    return [toM(outer), ...poly.slice(1).map((r) => clipRing(r, E)).filter((r) => r.length).map(toM)];
  };
  const parkPolys: number[][][] = [];

  // 1. Parks (leisure=park is landcover grass/park; the park layer adds nature reserves and the like).
  for (const f of layers.polys.landcover ?? []) {
    if (str(f.props.class) !== 'grass' || str(f.props.subclass) !== 'park') continue;
    for (const p of f.polys) { const r = rings(p); if (r) { fillRaster(cover, n, C, r, PARK); parkPolys.push(r); } }
  }
  for (const f of layers.polys.park ?? []) {
    for (const p of f.polys) { const r = rings(p); if (r) { fillRaster(cover, n, C, r, PARK, (o) => o === NONE); parkPolys.push(r); } }
  }
  // 2. Woods and scrub.
  for (const f of layers.polys.landcover ?? []) {
    const cls = str(f.props.class), sub = str(f.props.subclass);
    const v = cls === 'wood' ? WOOD : cls === 'grass' && (sub === 'scrub' || sub === 'shrubbery' || sub === 'heath') ? SCRUB : NONE;
    if (!v) continue;
    for (const p of f.polys) { const r = rings(p); if (r) fillRaster(cover, n, C, r, v); }
  }
  // 3. What stays open inside parks: lawns, fields, sand. Rock outcrops get boulders, not trees.
  const rockPolys: number[][][] = [];
  for (const f of layers.polys.landcover ?? []) {
    const cls = str(f.props.class), sub = str(f.props.subclass);
    if (cls === 'rock') { for (const p of f.polys) { const r = rings(p); if (r) { fillRaster(cover, n, C, r, ROCK); rockPolys.push(r); } } continue; }
    const open = cls === 'sand' || (cls === 'grass' && LAWN.has(sub));
    if (!open) continue;
    for (const p of f.polys) {
      const r = rings(p);
      // Only real lawns and meadows stay open; the map also has hundreds of small grass patches
      // between the paths, which in a park like Central Park are under the trees.
      if (r && (cls === 'sand' || Math.abs(signedArea(r[0])) > LAWN_MIN)) fillRaster(cover, n, C, r, OPEN, (o) => o === PARK || o === SCRUB);
    }
  }
  for (const f of layers.polys.landuse ?? []) {
    if (!OPEN_USE.has(str(f.props.class))) continue;
    for (const p of f.polys) { const r = rings(p); if (r) fillRaster(cover, n, C, r, OPEN, (o) => o !== NONE); }
  }

  // Water bodies, so no trunk stands in a lake (the shared wet raster is too coarse for that).
  const wat = new Uint8Array(n * n);
  const waterRings: { r: number[][]; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (const f of layers.polys.water ?? []) for (const p of f.polys) {
    const r = rings(p);
    if (!r) continue;
    fillRaster(wat, n, C, r, 1);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let q = 0; q < r[0].length; q += 2) { minX = Math.min(minX, r[0][q]); maxX = Math.max(maxX, r[0][q]); minZ = Math.min(minZ, r[0][q + 1]); maxZ = Math.max(maxZ, r[0][q + 1]); }
    waterRings.push({ r, minX, maxX, minZ, maxZ });
  }
  const nearWater = (x: number, z: number) => {
    const i = Math.floor(x / C), j = Math.floor(z / C);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n && wat[jj * n + ii]) return true;
    }
    return false;
  };
  const inWater = (x: number, z: number) => {
    for (const w of waterRings) {
      if (x < w.minX - 2 || x > w.maxX + 2 || z < w.minZ - 2 || z > w.maxZ + 2) continue;
      // The trunk and a little margin: test the point and four points 1.5 m around it.
      for (const [ox, oz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
        if (inRing(w.r[0], x + ox, z + oz) && !w.r.slice(1).some((h) => inRing(h, x + ox, z + oz))) return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------- trees
  // Jittered grid: a tree every D meters where the cover allows, thinned into stands in open parkland.
  let wood = 0, park = 0, scrub = 0;
  for (let q = 0; q < cover.length; q++) { const v = cover[q]; if (v === WOOD) wood++; else if (v === PARK) park++; else if (v === SCRUB) scrub++; }
  const cap = lod === 0 ? 32000 : 6000;
  let D = lod === 0 ? 7.5 : 15;
  const est = ((wood * 0.92 + park * 0.62 + scrub * 0.5) * C * C) / (D * D);
  let grow = 1;
  if (est > cap) { grow = Math.sqrt(est / cap); D *= grow; }
  const trees: number[] = [];
  const seed = hashStr(`park:${c.tx},${c.ty}`);
  const at = (x: number, z: number) => {
    const i = Math.floor(x / C), j = Math.floor(z / C);
    return i < 0 || j < 0 || i >= n || j >= n ? NONE : cover[j * n + i];
  };
  const G = Math.ceil(size / D);
  for (let gj = 0; gj < G; gj++) for (let gi = 0; gi < G; gi++) {
    const h = ((gi * 92837111) ^ (gj * 689287499) ^ seed) >>> 0;
    const x = (gi + 0.5 + (hash01(h) - 0.5) * 0.85) * D, z = (gj + 0.5 + (hash01(h + 1) - 0.5) * 0.85) * D;
    if (x < 0 || z < 0 || x >= size || z >= size) continue;
    const v = at(x, z);
    if (v !== WOOD && v !== PARK && v !== SCRUB) continue;
    // Stands and clearings: big soft patches of trees, denser in the woods.
    const stand = fbm(x / 85, z / 85, seed);
    const keep = v === WOOD ? 0.94 : v === SCRUB ? 0.55 : 0.22 + 0.76 * smooth(0.24, 0.52, stand);
    if (hash01(h + 2) > keep) continue;
    if (c.road(x, z) || c.built(x, z) || c.wetAt(x, z) || (nearWater(x, z) && inWater(x, z))) continue;
    const big = v === SCRUB ? 0.55 + hash01(h + 3) * 0.35 : (v === WOOD ? 1.35 : 1.55) + hash01(h + 3) * 0.9 + (stand - 0.5) * 0.4;
    const conifer = c.north ? hash01(h + 4) < 0.7 : v === WOOD ? hash01(h + 4) < 0.18 : hash01(h + 4) < 0.05;
    const kind = c.tropical && hash01(h + 5) < 0.35 ? 2 : conifer ? 1 : 0;
    trees.push(x, c.hAt(x, z), z, hash01(h + 6) * 6.28, big * (lod === 1 ? 1.15 : 1) * Math.min(1.5, grow), kind);
  }

  // ---------------------------------------------------------------- rocks
  const rocks: number[] = [];
  if (lod === 0) {
    for (const r of rockPolys) {
      const o = r[0];
      const area = Math.abs(signedArea(o));
      if (area < 6) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let q = 0; q < o.length; q += 2) { minX = Math.min(minX, o[q]); maxX = Math.max(maxX, o[q]); minZ = Math.min(minZ, o[q + 1]); maxZ = Math.max(maxZ, o[q + 1]); }
      const want = Math.min(14, Math.max(1, Math.round(area / 45)));
      const rs = hashStr(`rock:${minX | 0},${minZ | 0}`);
      const span = Math.min(9, Math.max(1.6, Math.sqrt(area / want) * 0.85));
      for (let k = 0, tries = 0; k < want && tries < want * 6; tries++) {
        const x = minX + hash01(rs + tries * 3) * (maxX - minX), z = minZ + hash01(rs + tries * 3 + 1) * (maxZ - minZ);
        if (!inRing(o, x, z) || c.road(x, z) || c.built(x, z)) continue;
        const w = span * (0.6 + hash01(rs + tries * 3 + 2) * 0.7);
        rocks.push(x, c.hAt(x, z) - 0.25 * w * 0.35, z, hash01(rs + tries) * 6.28, w, w * (0.28 + hash01(rs + tries + 9) * 0.22), w * (0.6 + hash01(rs + tries + 5) * 0.5));
        k++;
      }
    }
  }

  // ---------------------------------------------------------------- park lakes: boulders on the banks
  const banks: number[][][] = [];
  for (const f of layers.polys.water ?? []) {
    const cls = str(f.props.class);
    if (cls !== 'lake' && cls !== 'pond' && cls !== 'basin' && cls !== 'reservoir') continue;
    for (const p of f.polys) {
      const r = rings(p);
      if (!r) continue;
      // Only water in parks: sample a few points just outside the outer ring.
      const o = r[0];
      let inPark = 0, tot = 0;
      for (let q = 0; q < o.length; q += Math.max(2, Math.floor(o.length / 24) * 2)) {
        tot++;
        const v = at(o[q], o[q + 1]);
        if (v === PARK || v === WOOD || v === OPEN || v === ROCK || v === SCRUB) inPark++;
      }
      if (!tot || inPark / tot < 0.4) continue;
      banks.push(r);
      if (lod !== 0) continue;
      const bs = hashStr(`bank:${o[0] | 0},${o[1] | 0}`);
      const area = Math.abs(signedArea(o));
      // The Reservoir and other big basins have a built edge, not boulders.
      if (cls === 'reservoir' || cls === 'basin' || area > 300000) continue;
      for (let q = 0, k = 0; q < o.length; q += 2) {
        const ax = o[q], az = o[q + 1], bx = o[(q + 2) % o.length], bz = o[(q + 3) % o.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (onEdge(ax, az, bx, bz, size)) continue;
        for (let s = 0; s < len; s += 3.2, k++) {
          const t = s / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          // Clusters along the shore, not a uniform necklace.
          if (fbm(x / 22, z / 22, bs) < 0.55 || hash01(bs + k) < 0.35) continue;
          if (c.road(x, z) || c.built(x, z)) continue;
          const w = 0.7 + hash01(bs + k * 7) * 1.5;
          rocks.push(x, c.hAt(x, z) - w * 0.15, z, hash01(bs + k * 3) * 6.28, w, w * (0.4 + hash01(bs + k * 5) * 0.3), w * (0.7 + hash01(bs + k * 11) * 0.4));
        }
      }
    }
  }

  // ---------------------------------------------------------------- stone walls along big parks
  const wallBuf = new Buf();
  // Gates: wherever a road or path crosses the park line. (Not the road raster: the sidewalk along
  // the park runs right on the line, and it would erase the whole wall.)
  const crossing: { ax: number; az: number; bx: number; bz: number; w: number }[] = [];
  if (lod === 0) for (const f of layers.lines.transportation ?? []) {
    if (str(f.props.brunnel) === 'tunnel') continue;
    const cls = str(f.props.class);
    const w = cls === 'path' || cls === 'track' ? 3 : cls === 'service' || cls === 'minor' ? 7 : 12;
    for (const l of f.lines) for (let q = 2; q < l.length; q += 2) crossing.push({ ax: l[q - 2] * S, az: l[q - 1] * S, bx: l[q] * S, bz: l[q + 1] * S, w });
  }
  if (lod === 0) {
    for (const r of parkPolys) {
      const o = r[0];
      if (Math.abs(signedArea(o)) < 60000) continue;
      const ccw = signedArea(o) > 0;
      for (let q = 0; q < o.length; q += 2) {
        const ax = o[q], az = o[q + 1], bx = o[(q + 2) % o.length], bz = o[(q + 3) % o.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.5 || onEdge(ax, az, bx, bz, size)) continue;
        const tx = (bx - ax) / len, tz = (bz - az) / len;
        // Inward normal, so the wall stands just inside the park line (the sidewalk is outside).
        const nx = ccw ? -tz : tz, nz = ccw ? tx : -tx;
        // Gaps (arc-length intervals along this edge) where something crosses it.
        const gaps: [number, number][] = [];
        for (const k of crossing) {
          const ex = k.bx - k.ax, ez = k.bz - k.az;
          const den = tx * ez - tz * ex;
          if (Math.abs(den) < 1e-6) continue;
          const sx = k.ax - ax, sz = k.az - az;
          const sAlong = (sx * ez - sz * ex) / den, u = (sx * tz - sz * tx) / den;
          if (u < 0 || u > 1 || sAlong < -k.w || sAlong > len + k.w) continue;
          // Wider for a shallow crossing angle.
          const sin = Math.abs(den) / Math.hypot(ex, ez);
          const half = (k.w / 2 + 1.2) / Math.max(0.35, sin);
          gaps.push([sAlong - half, sAlong + half]);
        }
        const STEP = 2;
        let run0 = -1;
        const flush = (s0: number, s1: number) => {
          if (s1 - s0 < 3) return;
          wallRun(wallBuf, ax + tx * s0 + nx * 0.5, az + tz * s0 + nz * 0.5, ax + tx * s1 + nx * 0.5, az + tz * s1 + nz * 0.5, c.hAt);
        };
        for (let s = 0; s <= len; s += STEP) {
          const x = ax + tx * s + nx * 0.5, z = az + tz * s + nz * 0.5;
          const ok = !gaps.some(([g0, g1]) => s >= g0 && s <= g1) && !c.built(x, z) && !c.wetAt(x, z);
          if (ok && run0 < 0) run0 = s;
          if (!ok && run0 >= 0) { flush(run0, s - STEP * 0.5); run0 = -1; }
        }
        if (run0 >= 0) flush(run0, len);
      }
    }
  }

  // ---------------------------------------------------------------- painting the ground
  /** Shade under the canopy, earthy banks around park water. Call after the land cover is painted. */
  const paint = (g: OffscreenCanvasRenderingContext2D, P: number) => {
    // Forest floor: deep shade where the crowns are, so gaps between trees read as woods, not lawn.
    g.save();
    g.filter = `blur(${Math.max(0.6, 1.2 * P).toFixed(2)}px)`;
    g.fillStyle = 'rgba(46,66,34,0.72)';
    g.beginPath();
    for (let q = 0; q < trees.length; q += 6) {
      const r = Math.max(0.8, trees[q + 4] * 2.6 * P);
      g.moveTo(trees[q] * P + r, trees[q + 2] * P);
      g.arc(trees[q] * P, trees[q + 2] * P, r, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
    // Banks: a band of packed earth and stone along park water, under the water fill painted next.
    g.save();
    g.lineJoin = 'round';
    for (const r of banks) {
      g.beginPath();
      for (const ring of r) { for (let q = 0; q < ring.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, ring[q] * P, ring[q + 1] * P); g.closePath(); }
      g.strokeStyle = 'rgb(116,104,82)'; g.lineWidth = Math.max(1.5, 7 * P); g.stroke();
      g.strokeStyle = 'rgb(92,86,70)'; g.lineWidth = Math.max(1, 3.5 * P); g.stroke();
    }
    g.restore();
  };

  const out: ParkOut = { trees: new Float32Array(trees), rocks: new Float32Array(rocks), wall: wallBuf.out() };
  return { out, paint };
}

/** A segment running along the tile's clipped edge (not a real boundary). */
function onEdge(ax: number, az: number, bx: number, bz: number, size: number) {
  const e = 0.6;
  return (Math.abs(ax) < e && Math.abs(bx) < e) || (Math.abs(az) < e && Math.abs(bz) < e)
    || (Math.abs(ax - size) < e && Math.abs(bx - size) < e) || (Math.abs(az - size) < e && Math.abs(bz - size) < e);
}

const STONE: [number, number, number] = [118, 110, 98], CAP: [number, number, number] = [150, 144, 132];

/** A low fieldstone wall with a coping stone, draped on the terrain in 4 m pieces. */
function wallRun(b: Buf, ax: number, az: number, bx: number, bz: number, hAt: (x: number, z: number) => number) {
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
  const pieces = Math.max(1, Math.round(len / 4));
  const H = 1.05, T = 0.32, CT = 0.4, CH = 0.12;
  for (let p = 0; p < pieces; p++) {
    const s0 = (p / pieces) * len, s1 = ((p + 1) / pieces) * len;
    const x0 = ax + tx * s0, z0 = az + tz * s0, x1 = ax + tx * s1, z1 = az + tz * s1;
    const y0 = hAt(x0, z0), y1 = hAt(x1, z1);
    box(b, x0, z0, x1, z1, nx, nz, T, y0 - 0.3, y1 - 0.3, H + 0.3 - CH, STONE);
    box(b, x0, z0, x1, z1, nx, nz, CT, y0 + H - CH, y1 + H - CH, CH, CAP);
  }
}

/** An oriented box along a segment: half-thickness t, from base y to base y + h (sloped ends). */
function box(b: Buf, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, t: number, ya: number, yb: number, h: number, col: [number, number, number]) {
  const P = [
    [x0 - nx * t, ya, z0 - nz * t], [x1 - nx * t, yb, z1 - nz * t], [x1 + nx * t, yb, z1 + nz * t], [x0 + nx * t, ya, z0 + nz * t],
  ];
  const top = P.map((p) => [p[0], p[1] + h, p[2]]);
  const face = (a: number[], bb: number[], cc: number[], d: number[], n: [number, number, number], shade: number) => {
    const i = b.count;
    for (const p of [a, bb, cc, d]) { b.v(p[0], p[1], p[2]); b.nrm.push(n[0], n[1], n[2]); b.col.push(col[0] * shade, col[1] * shade, col[2] * shade); }
    b.quad(i, i + 1, i + 2, i + 3);
  };
  const tx = -nz, tz = nx;
  face(P[0], P[1], top[1], top[0], [-nx, 0, -nz], 0.94);
  face(P[2], P[3], top[3], top[2], [nx, 0, nz], 0.94);
  face(top[0], top[1], top[2], top[3], [0, 1, 0], 1.06);
  face(P[3], P[0], top[0], top[3], [-tx, 0, -tz], 0.9);
  face(P[1], P[2], top[2], top[1], [tx, 0, tz], 0.9);
}
