// Builds one map tile of the world (worker side): terrain, painted ground, water, buildings, roads,
// bridges, markings, street furniture and trees, plus the data the main thread needs.
import { WORLD } from '../frame.ts';
import { demFor } from '../dem.ts';
import { clipLine, clipRing, decodeTile, num, str, type Layers } from '../mvt.ts';
import { GROUND, regionKey, regionOf, taggedColor } from './palette.ts';
import { GROUND_KIND, STYLE, STYLES, chooseStyle, encodeSeed, facadeDims, groundFromPoi } from './facades.ts';
import { Buf, alongY, cleanRing, cumLen, densify, disc, hash01, hashStr, inRing, reversed, ribbon, signedArea, strip, triangulate } from './geo.ts';
import type { ChunkJob, ChunkOut, EdgeData, FootprintData, SignalData } from './types.ts';
import { buildParks } from './parks.ts';
import { assignHousenumbers, landmarkZones, type LandmarkClaim } from '../landmarks/zones.ts';

const EMPTY: Layers = { extent: 4096, buffer: 0, polys: {}, lines: {}, points: {} };
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const SKIP_ROAD = new Set(['rail', 'transit', 'ferry', 'aerialway', 'raceway', 'bus_guideway', 'construction', 'proposed']);

interface RoadSpec { width: number; lanes: number; drive: boolean; walk: boolean }
function roadSpec(cls: string, sub: string, oneway: boolean, ramp: boolean, service: string): RoadSpec | null {
  const d = (width: number, lanes: number, walk = true): RoadSpec => ({ width, lanes, drive: true, walk });
  switch (cls) {
    case 'motorway': return ramp ? d(6.5, 1, false) : oneway ? d(11.5, 3, false) : d(22, 6, false);
    case 'trunk': return ramp ? d(6.5, 1, false) : oneway ? d(8.5, 2, false) : d(15, 4, false);
    case 'primary': return ramp ? d(6.5, 1) : oneway ? d(10.5, 3) : d(14, 4);
    case 'secondary': return oneway ? d(9, 2) : d(12, 2);
    case 'tertiary': return oneway ? d(7.5, 2) : d(10, 2);
    case 'minor': return oneway ? d(7, 1) : d(8, 2);
    case 'busway': return d(7, 2);
    case 'service':
      if (service === 'driveway') return d(3.5, 1);
      if (service === 'parking_aisle') return d(5.5, oneway ? 1 : 2);
      return d(5.5, oneway ? 1 : 2);
    case 'track': return { width: 3.2, lanes: 1, drive: false, walk: true };
    case 'path': {
      const w = sub === 'pedestrian' ? 6 : sub === 'footway' ? 2.4 : sub === 'steps' ? 2.4 : sub === 'cycleway' ? 2.3 : 2.1;
      if (sub === 'corridor' || sub === 'platform' || sub === 'elevator') return null;
      return { width: w, lanes: 1, drive: false, walk: true };
    }
    case 'pier': return { width: 6, lanes: 1, drive: false, walk: true };
    default: return null;
  }
}

/** Boolean raster over the chunk for "is something already here" checks. */
class Raster {
  data: Uint8Array;
  cell: number;
  constructor(public n: number, public size: number) { this.data = new Uint8Array(n * n); this.cell = size / n; }
  get(x: number, z: number) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
    return this.data[j * this.n + i];
  }
  fill(rings: number[][], v = 1) {
    scan(rings, this.n, this.cell, 0.5, (i, j) => { this.data[j * this.n + i] = v; });
  }
  seg(ax: number, az: number, bx: number, bz: number, r: number, val = 1) {
    const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / (this.cell * 0.7)));
    const rc = Math.ceil(r / this.cell);
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
      const i0 = Math.floor(x / this.cell), j0 = Math.floor(z / this.cell);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i >= 0 && j >= 0 && i < this.n && j < this.n) this.data[j * this.n + i] = Math.max(this.data[j * this.n + i], val);
      }
    }
  }
}

/** Even-odd scanline over grid points ((i + off) * step, (j + off) * step) inside the rings. */
function scan(rings: number[][], n: number, step: number, off: number, cb: (i: number, j: number) => void) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const r of rings) for (let k = 1; k < r.length; k += 2) { if (r[k] < minZ) minZ = r[k]; if (r[k] > maxZ) maxZ = r[k]; }
  const j0 = Math.max(0, Math.ceil(minZ / step - off)), j1 = Math.min(n - 1, Math.floor(maxZ / step - off));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const z = (j + off) * step;
    xs.length = 0;
    for (const r of rings) for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
      const z1 = r[k + 1], z2 = r[i + 1];
      if ((z1 > z) !== (z2 > z)) xs.push(r[k] + ((z - z1) / (z2 - z1)) * (r[i] - r[k]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil(xs[q] / step - off)), i1 = Math.min(n - 1, Math.floor(xs[q + 1] / step - off));
      for (let i = i0; i <= i1; i++) cb(i, j);
    }
  }
}

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export async function buildChunk(job: ChunkJob): Promise<{ out: ChunkOut; transfer: Transferable[] }> {
  const t0 = performance.now();
  const { z, tx, ty, lod, k, e0 } = job;
  const s = WORLD / 2 ** z;
  const size = s * k;
  const mxW = tx * s - WORLD / 2, myN = WORLD / 2 - ty * s;
  const reg = regionOf(job.country);
  const tropical = Math.abs(job.lat) < 27;
  const north = Math.abs(job.lat) > 52;

  const [layers, dem] = await Promise.all([
    fetch(`/api/tiles/v/${z}/${tx}/${ty}`).then(async (r) => (r.status === 200 ? decodeTile(await r.arrayBuffer()) : EMPTY)).catch(() => EMPTY),
    demFor(lod === 0 ? Math.min(13, z - 1) : Math.min(12, z - 2), mxW - s * 0.03, myN - s * 1.03, mxW + s * 1.03, myN + s * 0.03, lod === 0 ? 1.4 : 0.8),
  ]);
  const E = layers.extent, S = size / E;
  const toM = (r: number[]) => r.map((v) => v * S);
  const nodeKey = (px: number, py: number) => `${Math.round((tx * E + px) * 2)},${Math.round((ty * E + py) * 2)}`;

  // ---------------------------------------------------------------- terrain
  const N = lod === 0 ? 128 : 48;
  const cell = size / N;
  const H = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = dem.at(mxW + (i / N) * s, myN - (j / N) * s) - e0;
  const RAW = H.slice();
  const interp = (g: Float32Array, x: number, zz: number) => {
    const gx = Math.min(N - 1e-6, Math.max(0, x / cell)), gz = Math.min(N - 1e-6, Math.max(0, zz / cell));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const r = N + 1;
    const a = g[j * r + i], b = g[j * r + i + 1], c = g[(j + 1) * r + i], d = g[(j + 1) * r + i + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
  const raw = (x: number, zz: number) => interp(RAW, x, zz);

  // ---------------------------------------------------------------- water
  const M = lod === 0 ? 128 : 32;
  const wcell = size / M;
  const wet = new Float32Array(M * M).fill(NaN);
  const waterBuf = new Buf();
  const shoreBuf = new Buf();
  const waterPaint: number[][][] = [];
  for (const f of layers.polys.water ?? []) {
    const cls = str(f.props.class);
    if (num(f.props.intermittent) === 1) continue;
    for (const poly of f.polys) {
      const outer = clipRing(poly[0], E);
      if (!outer.length) continue;
      const rings = [toM(outer), ...poly.slice(1).map((r) => clipRing(r, E)).filter((r) => r.length).map(toM)];
      let level: number;
      if (cls === 'ocean') level = -e0;
      else {
        const hs: number[] = [];
        const r0 = rings[0], step = Math.max(2, Math.floor(r0.length / 2 / 40)) * 2;
        for (let q = 0; q < r0.length; q += step) hs.push(raw(r0[q], r0[q + 1]));
        hs.sort((a, b) => a - b);
        level = hs[Math.floor(hs.length * 0.3)] ?? 0;
      }
      waterPaint.push(rings);
      if (lod === 0) shoreline(shoreBuf, rings, level, size, cls === 'ocean' ? 1 : cls === 'lake' ? 0.6 : 0.4);
      scan(rings, M, wcell, 0.5, (i, j) => { const o = wet[j * M + i]; wet[j * M + i] = Number.isNaN(o) ? level : Math.max(o, level); });
      scan(rings, N + 1, cell, 0, (i, j) => { const q = j * (N + 1) + i; H[q] = Math.min(H[q], level - 2.4); });
      // Surface.
      let outerR = rings[0];
      if (signedArea(outerR) > 0) outerR = reversed(outerR);
      const holes = rings.slice(1).map((h) => (signedArea(h) < 0 ? reversed(h) : h));
      const all = outerR.concat(...holes);
      const tris = triangulate(outerR, holes);
      const base = waterBuf.count;
      for (let q = 0; q < all.length; q += 2) { waterBuf.v(all[q], level, all[q + 1]); waterBuf.nrm.push(0, 1, 0); waterBuf.uv.push(all[q] / 40, all[q + 1] / 40); }
      for (let q = 0; q < tris.length; q += 3) {
        const A = tris[q], B = tris[q + 1], C = tris[q + 2];
        const ax = all[A * 2], az = all[A * 2 + 1], bx = all[B * 2], bz = all[B * 2 + 1], cx = all[C * 2], cz = all[C * 2 + 1];
        const ny = (cx - ax) * (bz - az) - (bx - ax) * (cz - az);
        if (ny >= 0) waterBuf.tri(base + A, base + B, base + C); else waterBuf.tri(base + A, base + C, base + B);
      }
    }
  }
  const hAt = (x: number, zz: number) => interp(H, x, zz);
  const wetAt = (x: number, zz: number) => {
    const i = Math.floor(x / wcell), j = Math.floor(zz / wcell);
    if (i < 0 || j < 0 || i >= M || j >= M) return false;
    return !Number.isNaN(wet[j * M + i]);
  };

  // ---------------------------------------------------------------- buildings
  const occ = new Raster(lod === 0 ? 512 : 128, size);
  // Where the drivable streets are, so shopfronts know which walls face one.
  const streetR = new Raster(lod === 0 ? 512 : 1, size);
  if (lod === 0) for (const f of layers.lines.transportation ?? []) {
    const cls = str(f.props.class);
    if (!DRIVE.has(cls) || cls === 'motorway' || cls === 'service' || str(f.props.brunnel) === 'tunnel') continue;
    const sp = roadSpec(cls, str(f.props.subclass), num(f.props.oneway) !== 0, num(f.props.ramp) === 1, '');
    if (!sp) continue;
    for (const line of f.lines) for (const piece of clipLine(line, E)) {
      const m = toM(piece);
      // 2 = an avenue or main street (shops), 1 = a side street.
      const major = cls === 'primary' || cls === 'secondary' || cls === 'tertiary' || cls === 'trunk';
      for (let q = 2; q < m.length; q += 2) streetR.seg(m[q - 2], m[q - 1], m[q], m[q + 1], sp.width / 2 + 2.5, major ? 2 : 1);
    }
  }
  // Commercial and retail land: shops on every street there.
  const commR = new Raster(lod === 0 ? 128 : 1, size);
  if (lod === 0) for (const f of layers.polys.landuse ?? []) {
    const c = str(f.props.class);
    if (c !== 'commercial' && c !== 'retail') continue;
    for (const poly of f.polys) { const o = clipRing(poly[0], E); if (o.length) commR.fill([toM(o)]); }
  }
  // Buildings go into a 4x4 grid of meshes so the camera and the shadow pass can cull them.
  const CELLS = 4;
  const cells = Array.from({ length: CELLS * CELLS }, () => new Buf());
  // See-through ironwork (fire escapes): its own alpha-tested mesh.
  const iron = new Buf();
  const footprints: FootprintData[] = [];
  const density = new Float32Array(16 * 16);
  const paintBuildings: number[][] = [];
  let nBuildings = 0;
  const B = layers.buffer;
  // Landmarks are drawn by hand (landmarks/): their map buildings are handed over, not extruded.
  const lmZones = landmarkZones(job);
  const lmClaims: LandmarkClaim[] = [];
  // Where each building stands (its neighborhood picks the architecture), and what its shops are.
  const rk = regionKey(job.country);
  const n2 = 2 ** z;
  const lonAt = (x: number) => ((tx + x / size) / n2) * 360 - 180;
  const latAt = (zz: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + zz / size)) / n2))) * 180) / Math.PI;
  const poiGrid = new Map<string, { x: number; z: number; g: number }[]>();
  if (lod === 0) for (const p of layers.points.poi ?? []) {
    const g = groundFromPoi(str(p.props.class), str(p.props.subclass));
    if (g < 0) continue;
    const x = p.x * S, zz = p.y * S, k = `${Math.floor(x / 40)},${Math.floor(zz / 40)}`;
    let l = poiGrid.get(k); if (!l) poiGrid.set(k, (l = [])); l.push({ x, z: zz, g });
  }
  /** The street-level kind the map's points of interest inside this footprint suggest (-1: none). */
  const groundOf = (ring: number[]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let q = 0; q < ring.length; q += 2) { x0 = Math.min(x0, ring[q]); x1 = Math.max(x1, ring[q]); z0 = Math.min(z0, ring[q + 1]); z1 = Math.max(z1, ring[q + 1]); }
    const votes = new Map<number, number>();
    for (let i = Math.floor(x0 / 40); i <= Math.floor(x1 / 40); i++) for (let j = Math.floor(z0 / 40); j <= Math.floor(z1 / 40); j++)
      for (const p of poiGrid.get(`${i},${j}`) ?? []) if (inRing(ring, p.x, p.z)) votes.set(p.g, (votes.get(p.g) ?? 0) + 1);
    let best = -1, bn = 0;
    for (const [g, n] of votes) if (n > bn || (n === bn && g > best)) { best = g; bn = n; }
    return best;
  };
  for (const f of layers.polys.building ?? []) {
    if (f.props.hide_3d === true) continue;
    const hTag = Math.max(3, num(f.props.render_height, 8));
    const minH = Math.max(0, num(f.props.render_min_height, 0));
    const colourTag = str(f.props.colour);
    f.polys.forEach((poly, pi) => {
      let outer = poly[0], holes = poly.slice(1);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let q = 0; q < outer.length; q += 2) { minX = Math.min(minX, outer[q]); maxX = Math.max(maxX, outer[q]); minY = Math.min(minY, outer[q + 1]); maxY = Math.max(maxY, outer[q + 1]); }
      const truncated = B > 0 && (minX <= -B + 2 || minY <= -B + 2 || maxX >= E + B - 2 || maxY >= E + B - 2);
      if (!truncated) {
        // Whole building: drawn by the tile that holds its center (neighbors skip their copy).
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        if (cx < 0 || cy < 0 || cx >= E || cy >= E) return;
      } else {
        outer = clipRing(outer, E);
        holes = holes.map((h) => clipRing(h, E)).filter((h) => h.length);
        if (!outer.length) return;
      }
      let ring = cleanRing(toM(outer));
      if (ring.length < 6) return;
      const sa = signedArea(ring);
      if (Math.abs(sa) < 4) return;
      if (sa > 0) ring = reversed(ring);
      const hs = holes.map((h) => { const c = cleanRing(toM(h)); return c.length >= 6 ? (signedArea(c) < 0 ? reversed(c) : c) : null; }).filter((h): h is number[] => !!h);
      const area = Math.abs(sa);
      // Far away, small low buildings are just noise (and most of Tokyo): leave them out.
      if (lod === 1 && area < 140 && hTag < 13) return;
      const key = f.id * 16 + (pi % 16);
      const seed = hash01(key % 2147483647 + pi);
      let gmin = Infinity, cx = 0, cz = 0;
      for (let q = 0; q < ring.length; q += 2) { gmin = Math.min(gmin, hAt(ring[q], ring[q + 1])); cx += ring[q]; cz += ring[q + 1]; }
      cx /= ring.length / 2; cz /= ring.length / 2;
      const h = Math.max(hTag, minH + 1.5);
      const lmId = lmZones.any ? lmZones.claim(cx, cz, h) : null;
      if (lmId) { lmClaims.push({ id: lmId, ring, holes: hs, base: gmin, top: gmin + h, minH }); return; }
      const glass = h >= 70 ? seed < 0.55 : h >= 40 ? seed < 0.18 : h >= 18 ? seed < 0.03 : false;
      // Architecture: from the neighborhood, height and footprint (facades.ts), and what's on the ground floor.
      const style = glass ? STYLE.generic : chooseStyle(rk, job.country, latAt(cz), lonAt(cx), h, area, hash01(key + 101));
      const sty = STYLES[style];
      const poiG = lod === 0 && minH < 0.5 ? groundOf(ring) : -1;
      const groundK = poiG >= 0 ? poiG : h < 7 ? GROUND_KIND.none : sty.ground0 === 1 ? GROUND_KIND.shops : sty.ground0 === 2 ? (hash01(key + 103) < 0.55 ? GROUND_KIND.lobby : GROUND_KIND.shops) : GROUND_KIND.none;
      // A few towers in colored glass (green, bronze, red, deep blue), like the video's red one.
      const tint = glass && hash01(key + 107) < 0.14 ? [0x4f7a6a, 0x7a5c44, 0x8a3c38, 0x3c5a86][Math.floor(hash01(key + 109) * 4)] : null;
      const pal = glass ? reg.glass : style === STYLE.generic ? reg.walls : sty.walls;
      const tagged = colourTag ? taggedColor(colourTag) : null;
      const wall = tint ?? (!glass && tagged !== null && seed < 0.8 ? tagged : pal[Math.floor(hash01(key + 3) * pal.length)]);
      const roof = glass ? 0x9aa4ad : reg.roofs[Math.floor(hash01(key + 5) * reg.roofs.length)];
      const flat = (reg.flat ?? 0xc9c6bf) - Math.floor(hash01(key + 7) * 3) * 0x060606;
      const y0 = minH > 0.5 ? gmin + minH : gmin - 1.6;
      const top = gmin + h;
      const cell = Math.min(CELLS - 1, Math.max(0, Math.floor((cz / size) * CELLS))) * CELLS + Math.min(CELLS - 1, Math.max(0, Math.floor((cx / size) * CELLS)));
      const bld = cells[cell];
      const start = bld.count;
      const fs = seed * 0.999;
      const sd = encodeSeed(seed, glass, style, groundK);
      const W = rgb(wall);
      const dims = facadeDims(style, fs, h, groundK);
      // Street level, wall by wall: shops face avenues (and every street in commercial districts and
      // Manhattan's busy core), houses and walk-ups face side streets, back walls have none.
      const lat0 = latAt(cz), lon0 = lonAt(cx);
      const busy = lod === 0 && (commR.get(cx, cz) > 0 || (job.country === 'us' && lat0 < 40.766 && lat0 > 40.70 && lon0 > -74.02 && lon0 < -73.965 && h >= 12));
      const wallGround = (front: number) => {
        if (glass || lod > 0) return groundK;
        if (h < 7 || front === 0) return GROUND_KIND.none;
        if (poiG >= 0) return poiG;
        // Row houses on an avenue have shops below (the avenue walls of a merged row).
        if (sty.ground0 === 0) return front === 2 && h >= 9 && (style === STYLE.brownstone || style === STYLE.georgian || style === STYLE.victorian) ? GROUND_KIND.shops : GROUND_KIND.none;
        if (front === 2 || busy) return groundK;
        return sty.ground0 === 2 && hash01(key + 117) < 0.5 ? GROUND_KIND.lobby : GROUND_KIND.none;
      };
      // Walls (outer + courtyard rings).
      for (const r of [ring, ...hs]) {
        const n = r.length / 2;
        for (let q = 0; q < n; q++) {
          const p2 = (q + 1) % n;
          const ax = r[q * 2], az = r[q * 2 + 1], bx = r[p2 * 2], bz = r[p2 * 2 + 1];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.05) continue;
          const nx = -(bz - az) / len, nz = (bx - ax) / len;
          const front = r === ring && lod === 0 ? streetR.get((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4) : 1;
          const wsd = encodeSeed(seed, glass, style, wallGround(front));
          const a0 = bld.v(ax, y0, az), b0 = bld.v(bx, y0, bz), b1 = bld.v(bx, top, bz), a1 = bld.v(ax, top, az);
          bld.quad(a0, b0, b1, a1);
          for (const [u, y] of [[0, y0], [len, y0], [len, top], [0, top]]) {
            bld.nrm.push(nx, 0, nz); bld.col.push(...W); bld.fac.push(u, y - gmin, len, h); bld.seed.push(wsd);
          }
        }
      }
      // Roof: gabled for small houses in places that build them, flat otherwise.
      let pitched = false;
      const pitchy = style === STYLE.generic || style === STYLE.stucco || style === STYLE.mediterranean || style === STYLE.canal || style === STYLE.altbau || style === STYLE.latin || style === STYLE.asiamodern;
      if (!glass && pitchy && !hs.length && reg.pitch > 0 && h <= reg.pitch && area >= 25 && area <= 520 && minH < 0.5 && hash01(key + 11) < 0.85) {
        pitched = gable(bld, ring, area, top, h, gmin, sd, W, rgb(roof));
      }
      if (!pitched) {
        const tris = triangulate(ring, hs);
        const all = ring.concat(...hs);
        const base = bld.count;
        const R = rgb(flat);
        for (let q = 0; q < all.length; q += 2) { bld.v(all[q], top, all[q + 1]); bld.nrm.push(0, 1, 0); bld.col.push(...R); bld.fac.push(0, h, 0, h); bld.seed.push(sd); }
        for (let q = 0; q < tris.length; q += 3) {
          const A = tris[q], Bq = tris[q + 1], C = tris[q + 2];
          const ax = all[A * 2], az = all[A * 2 + 1], bx = all[Bq * 2], bz = all[Bq * 2 + 1], qx = all[C * 2], qz = all[C * 2 + 1];
          const ny = (qx - ax) * (bz - az) - (bx - ax) * (qz - az);
          if (ny >= 0) bld.tri(base + A, base + Bq, base + C); else bld.tri(base + A, base + C, base + Bq);
        }
      }
      // Rooftop clutter: AC boxes and stair bulkheads, and New York's wooden water towers.
      if (!pitched && lod === 0 && area > 120 && h < 120) {
        const nBox = 1 + Math.floor(hash01(key + 13) * Math.min(4, area / 300));
        for (let q = 0; q < nBox; q++) {
          const bx = cx + (hash01(key + q * 17) - 0.5) * Math.sqrt(area) * 0.6, bz = cz + (hash01(key + q * 29) - 0.5) * Math.sqrt(area) * 0.6;
          const w = 1.6 + hash01(key + q * 3) * 2.6, d = 1.4 + hash01(key + q * 5) * 2.2, hh = 1.2 + hash01(key + q * 7) * 2;
          if (!inRing(ring, bx - w / 2, bz - d / 2) || !inRing(ring, bx + w / 2, bz + d / 2)) continue;
          roofBox(bld, bx, bz, w, d, top, top + hh, glass ? [196, 200, 204] : [178, 175, 168], sd, h);
        }
        const towerP = style === STYLE.prewar || style === STYLE.tenement || style === STYLE.castiron ? 0.55 : style === STYLE.office || style === STYLE.deco ? 0.35 : 0.2;
        if (job.country === 'us' && !glass && h > 15 && h < 90 && area > 220 && hash01(key + 21) < towerP) {
          const tx0 = cx + (hash01(key + 23) - 0.5) * Math.sqrt(area) * 0.4, tz0 = cz + (hash01(key + 25) - 0.5) * Math.sqrt(area) * 0.4;
          if (inRing(ring, tx0, tz0)) waterTower(bld, tx0, tz0, top, sd, h);
        }
      }
      // Near tier: real trim. A cornice and parapet around flat roofs (a thin metal coping on glass
      // towers), a string course over the shop floor, and awnings and blade signs over street-front shops.
      if (lod === 0 && !pitched && !hs.length) {
        if (glass) trimBand(bld, ring, top - 0.15, top + 1.0, top, 0.06, 0.25, [78, 82, 86], sd, h, gmin);
        else if (h >= 5) {
          // Each style's cornice: brownstones and tenements carry a big bracketed (often dark, pressed-metal) one.
          const big = sty.cornice >= 0.5;
          const proj = sty.cornice * (0.75 + hash01(key + 31) * 0.5), par = big ? 0.25 + hash01(key + 33) * 0.3 : 0.4 + hash01(key + 33) * 0.75;
          const cc = sty.corniceColor && hash01(key + 35) < 0.7 ? sty.corniceColor : trimColor(W, key);
          trimBand(bld, ring, top - (big ? 0.9 : 0.5), top + par, top, Math.max(0.06, proj), 0.3, cc, sd, h, gmin);
        }
      }
      if (lod === 0 && !glass && h >= 7 && minH < 0.5 && dims.groundH > 0) {
        // Same shop-floor height as the facade shader (both read it from facades.ts).
        ledge(bld, ring, gmin + dims.groundH - 0.02, 0.13, 0.22, trimColor(W, key), sd, h, gmin);
        shopfronts(bld, ring, streetR, gmin, dims.groundH, key, sd, h);
      }
      // Street-facing extras: stoops, fire escapes, sidewalk sheds.
      if (lod === 0 && !glass && minH < 0.5 && !hs.length) {
        const wantStoop = sty.stoop > 0 && hash01(key + 111) < sty.stoop && h < 26;
        const wantEscape = sty.fireEscape > 0 && hash01(key + 113) < sty.fireEscape && h >= 9 && h < 50;
        const wantShed = job.country === 'us' && h > 14 && hash01(key + 115) < 0.035;
        if (wantStoop || wantEscape || wantShed) streetWalls(ring, streetR, (ax, az, bx, bz, len, nx, nz) => {
          const tx0 = (bx - ax) / len, tz0 = (bz - az) / len;
          const dims = facadeDims(style, fs, h, wallGround(streetR.get((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4)));
          const bays = Math.max(1, Math.floor((len - 0.9) / dims.bayW)), margin = (len - bays * dims.bayW) / 2;
          const sideStreet = streetR.get((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4) === 1;
          if (wantStoop && sideStreet && len >= 3.5) {
            // One stoop per house front (~6 m lots on long rows), up to the parlor-floor door in the first bay.
            // The facade shader lays each lot out the same way and puts the door in its first bay.
            const lots = Math.max(1, Math.round(len / 6.2)), lotW = len / lots;
            const lotBays = Math.max(1, Math.floor((lotW - 0.4) / dims.bayW)), lotMargin = (lotW - lotBays * dims.bayW) / 2;
            for (let k = 0; k < lots; k++) {
              const uDoor = lotW * k + lotMargin + dims.bayW * 0.5;
              stoop(bld, ax + tx0 * uDoor, az + tz0 * uDoor, tx0, tz0, nx, nz, gmin, dims.plinth || 1.6, sty.base, sd, h);
            }
          }
          if (wantEscape && len >= 6) {
            const n = len > 22 ? 2 : 1;
            for (let k = 0; k < n; k++) {
              const bay0 = Math.min(bays - 2, Math.max(0, Math.floor(((k + 0.5) / n) * bays) - 1));
              if (bay0 < 0) continue;
              const u0 = margin + bay0 * dims.bayW + 0.15, u1 = margin + (bay0 + 2) * dims.bayW - 0.15;
              fireEscape(iron, ax, az, tx0, tz0, nx, nz, u0, u1, gmin, dims.first, dims.floorH, h);
            }
          }
          if (wantShed && len >= 8) shed(bld, ax, az, tx0, tz0, nx, nz, len, gmin, sd, h);
        });
      }
      nBuildings++;
      if (minH < 2.5) {
        occ.fill([ring]);
        paintBuildings.push(ring);
        const di = Math.min(15, Math.max(0, Math.floor((cx / size) * 16))), dj = Math.min(15, Math.max(0, Math.floor((cz / size) * 16)));
        density[dj * 16 + di] += area;
        if (lod === 0) footprints.push({ key, ring, area, cx, cz, base: gmin, top, h, glass, color: wall, roof, pitched, cell, start, count: bld.count - start });
      }
    });
  }

  // Points of interest name the buildings they sit in (and tell interiors what kind of place it is).
  if (lod === 0 && footprints.length) {
    const G = 40, cellsF = new Map<string, FootprintData[]>();
    for (const f of footprints) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let q = 0; q < f.ring.length; q += 2) { x0 = Math.min(x0, f.ring[q]); x1 = Math.max(x1, f.ring[q]); z0 = Math.min(z0, f.ring[q + 1]); z1 = Math.max(z1, f.ring[q + 1]); }
      for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
        const k = `${i},${j}`; let l = cellsF.get(k); if (!l) cellsF.set(k, (l = [])); l.push(f);
      }
    }
    const RANK: Record<string, number> = { place_of_worship: 9, shop: 3, grocery: 3, clothing_store: 3, department_store: 6, mall: 7, museum: 8, cinema: 6, theatre: 7, library: 6, restaurant: 2, cafe: 2, bar: 2, fast_food: 1, hotel: 5, bank: 3, college: 5, school: 4, hospital: 6, town_hall: 7, attraction: 6 };
    for (const p of layers.points.poi ?? []) {
      const name = str(p.props.name_en) || str(p.props.name);
      if (!name || num(p.props.level) !== 0 && p.props.level !== undefined) continue;
      const x = p.x * S, z = p.y * S;
      const cls = str(p.props.class), sub = str(p.props.subclass);
      for (const f of cellsF.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) {
        if (!inRing(f.ring, x, z)) continue;
        if (!f.poi || (RANK[cls] ?? 1) > (RANK[f.poi.cls] ?? 1)) f.poi = { name, cls, sub };
        break;
      }
    }
  }
  if (lod === 0) assignHousenumbers(layers, footprints, S);

  // ---------------------------------------------------------------- roads
  const roads: { pts: number[]; keys: string[]; spec: RoadSpec; cls: string; sub: string; bridge: boolean; layer: number; oneway: boolean; service: string }[] = [];
  for (const f of layers.lines.transportation ?? []) {
    const p = f.props;
    const cls = str(p.class), sub = str(p.subclass), brunnel = str(p.brunnel);
    if (SKIP_ROAD.has(cls) || brunnel === 'tunnel' || brunnel === 'ford' || num(p.level) < 0 || p.indoor === 1) continue;
    const oneway = num(p.oneway) !== 0;
    const spec = roadSpec(cls, sub, oneway, num(p.ramp) === 1, str(p.service));
    if (!spec) continue;
    for (const line of f.lines) for (let piece of clipLine(line, E)) {
      if (num(p.oneway) === -1) piece = reversed(piece);
      const keys: string[] = [];
      for (let q = 0; q < piece.length; q += 2) keys.push(nodeKey(piece[q], piece[q + 1]));
      roads.push({ pts: toM(piece), keys, spec, cls, sub, bridge: brunnel === 'bridge', layer: num(p.layer), oneway, service: str(p.service) });
    }
  }
  // Node use: shared vertices are intersections.
  const use = new Map<string, number>();
  const bridgeEnds = new Map<string, number>();
  for (const r of roads) {
    r.keys.forEach((kk, q) => use.set(kk, (use.get(kk) ?? 0) + (q === 0 || q === r.keys.length - 1 ? 2 : 1)));
    if (r.bridge && r.layer >= 1) for (const kk of [r.keys[0], r.keys[r.keys.length - 1]]) bridgeEnds.set(kk, (bridgeEnds.get(kk) ?? 0) + 1);
  }

  const edges: EdgeData[] = [];
  const roadBuf = new Buf(), walkBuf = new Buf(), whiteBuf = new Buf(), yellowBuf = new Buf(), deckBuf = new Buf();
  const pillars: number[] = [];
  const rd = new Raster(lod === 0 ? 512 : 64, size);
  const us = job.country === 'us' || job.country === 'ca';
  const nodes = new Map<string, { x: number; z: number; edges: EdgeData[]; maxW: number; drive: number; major: number }>();
  const LIFT_ROAD = 0.1, LIFT_WALK = 0.07, CURB = 0.14;
  for (const r of roads) {
    // Densify for draping, remembering where the original vertices landed.
    const dense: number[] = [r.pts[0], r.pts[1]];
    const at: number[] = [0];
    for (let q = 2; q < r.pts.length; q += 2) {
      const ax = r.pts[q - 2], az = r.pts[q - 1], bx = r.pts[q], bz = r.pts[q + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 7));
      for (let m = 1; m <= n; m++) dense.push(ax + ((bx - ax) * m) / n, az + ((bz - az) * m) / n);
      at.push(dense.length / 2 - 1);
    }
    const np = dense.length / 2;
    const ys: number[] = new Array(np);
    if (r.bridge) {
      const cum = cumLen(dense), len = cum[np - 1];
      const clr = r.layer >= 1 ? 6.5 * Math.min(3, r.layer) : 0;
      const endY = (q: number, kk: string) => {
        const x = dense[q * 2], zz = dense[q * 2 + 1];
        const edge = x < 0.01 || zz < 0.01 || x > size - 0.01 || zz > size - 0.01;
        const elevated = (bridgeEnds.get(kk) ?? 0) >= 2 || edge;
        return { y: elevated ? Math.max(hAt(x, zz), raw(x, zz)) + Math.max(clr, edge ? 6 : 0) + LIFT_ROAD : hAt(x, zz) + LIFT_ROAD, free: !elevated };
      };
      const A = endY(0, r.keys[0]), Bn = endY(np - 1, r.keys[r.keys.length - 1]);
      for (let q = 0; q < np; q++) {
        const x = dense[q * 2], zz = dense[q * 2 + 1], t = len > 0 ? cum[q] / len : 0;
        const over = wetAt(x, zz) ? 7 : clr;
        let y = Math.max(A.y + (Bn.y - A.y) * t, Math.max(raw(x, zz), hAt(x, zz)) + over);
        if (A.free) y = Math.min(y, A.y + cum[q] * 0.12);
        if (Bn.free) y = Math.min(y, Bn.y + (len - cum[q]) * 0.12);
        ys[q] = Math.max(y, hAt(x, zz) + LIFT_ROAD);
      }
      for (let pass = 0; pass < 3; pass++) for (let q = 1; q < np - 1; q++) ys[q] = (ys[q - 1] + ys[q] * 2 + ys[q + 1]) / 4;
    } else {
      for (let q = 0; q < np; q++) ys[q] = hAt(dense[q * 2], dense[q * 2 + 1]) + LIFT_ROAD;
    }
    // Surfaces.
    const yRoad = r.bridge ? (_x: number, _z: number, q: number) => ys[q] : (x: number, zz: number) => hAt(x, zz) + LIFT_ROAD;
    const yWalk = r.bridge ? (_x: number, _z: number, q: number) => ys[q] - 0.02 : (x: number, zz: number) => hAt(x, zz) + LIFT_WALK;
    if (lod === 0) {
      // Street surfaces carry their own pattern coordinates: asphalt uv = (meters across, road width);
      // paving uv = (meters in from the curb, or 500+ where there's no curb; meters along).
      if (r.spec.drive) {
        ribbon(roadBuf, dense, r.spec.width, yRoad, 0, (o) => o, r.spec.width);
        if (r.spec.walk && r.cls !== 'service' && !r.bridge) {
          const sw = r.cls === 'minor' ? 2.6 : 3.4;
          ribbon(walkBuf, dense, r.spec.width + sw * 2, yWalk, 0, (o) => 500 + o);
        }
      } else ribbon(walkBuf, dense, r.spec.width, yWalk, 0, (o) => 500 + o);
      if (r.bridge) bridgeSides(deckBuf, dense, ys, r.spec.width + (r.spec.drive ? 1 : 0.4), pillars, hAt);
    }
    for (let q = 2; q < dense.length; q += 2) rd.seg(dense[q - 2], dense[q - 1], dense[q], dense[q + 1], r.spec.width / 2 + (r.spec.drive ? 2.5 : 0.8));
    // Split into graph edges at intersections.
    let startV = 0;
    for (let v = 1; lod === 0 && v < r.keys.length; v++) {
      if (v < r.keys.length - 1 && (use.get(r.keys[v]) ?? 0) < 2) continue;
      const d0 = at[startV], d1 = at[v];
      const pts = dense.slice(d0 * 2, d1 * 2 + 2), eys = ys.slice(d0, d1 + 1);
      let len = 0;
      for (let q = 2; q < pts.length; q += 2) len += Math.hypot(pts[q] - pts[q - 2], pts[q + 1] - pts[q - 1]);
      if (len > 0.5) {
        const lanes = r.spec.lanes;
        const lanesF = r.spec.drive ? (r.oneway ? lanes : Math.max(1, Math.floor(lanes / 2))) : 1;
        const lanesB = r.spec.drive ? (r.oneway ? 0 : Math.max(1, lanes - lanesF)) : 1;
        const e: EdgeData = { a: r.keys[startV], b: r.keys[v], pts, ys: eys, width: r.spec.width, lanesF, lanesB, cls: r.cls === 'path' ? r.sub || 'path' : r.cls, name: null, bridge: r.bridge, drive: r.spec.drive, walk: r.spec.walk };
        edges.push(e);
        for (const [kk, idx] of [[e.a, 0], [e.b, pts.length - 2]] as const) {
          let nd = nodes.get(kk);
          if (!nd) nodes.set(kk, (nd = { x: pts[idx], z: pts[idx + 1], edges: [], maxW: 0, drive: 0, major: 0 }));
          nd.edges.push(e);
          if (e.drive) { nd.drive++; nd.maxW = Math.max(nd.maxW, e.width); if (MAJOR.has(r.cls)) nd.major++; }
        }
      }
      startV = v;
    }
  }

  // Intersections, signals, markings, lamps.
  const signals: SignalData[] = [];
  const poles: number[] = [];
  const lamps: number[] = [];
  const trees: number[] = [];
  const pits: number[] = [];
  const leaving = (e: EdgeData, atA: boolean) => {
    const p = e.pts, m = p.length;
    if (atA) { const l = Math.hypot(p[2] - p[0], p[3] - p[1]) || 1; return { x: (p[2] - p[0]) / l, z: (p[3] - p[1]) / l }; }
    const l = Math.hypot(p[m - 4] - p[m - 2], p[m - 3] - p[m - 1]) || 1;
    return { x: (p[m - 4] - p[m - 2]) / l, z: (p[m - 3] - p[m - 1]) / l };
  };
  if (lod === 0) {
    const sigNodes: { key: string; nd: { x: number; z: number; edges: EdgeData[]; maxW: number; drive: number; major: number }; phase: number; ref: number }[] = [];
    for (const [key, nd] of nodes) {
      if (nd.drive >= 2) {
        const bridgeNode = nd.edges.some((e) => e.bridge);
        const y = bridgeNode ? undefined : (x: number, zz: number) => hAt(x, zz) + LIFT_ROAD;
        if (y) disc(roadBuf, nd.x, nd.z, nd.maxW / 2, y, 14, [-1, 0]);
      }
      const minor = nd.edges.filter((e) => e.drive && !MAJOR.has(e.cls)).length;
      const isSignal = nd.drive >= 3 && !nd.edges.some((e) => e.bridge || e.cls === 'motorway' || e.cls === 'service') && (nd.major >= 2 || (nd.major >= 1 && minor >= 2 && nd.maxW >= 10));
      if (isSignal) {
        const d = leaving(nd.edges[0], nd.edges[0].a === key);
        sigNodes.push({ key, nd, phase: hash01(hashStr(key)) * 30, ref: Math.atan2(d.z, d.x) });
      }
    }
    // Clustered signals (dual carriageways) share a phase.
    for (const a of sigNodes) for (const b of sigNodes) if (b !== a && b.key < a.key && Math.hypot(a.nd.x - b.nd.x, a.nd.z - b.nd.z) < 32) { a.phase = b.phase; a.ref = b.ref; }
    for (const sg of sigNodes) {
      const idx = signals.length;
      signals.push({ key: sg.key, x: sg.nd.x, y: hAt(sg.nd.x, sg.nd.z), z: sg.nd.z, phase: sg.phase, ref: sg.ref });
      for (const e of sg.nd.edges) {
        if (!e.drive) continue;
        const d = leaving(e, e.a === sg.key);
        const side = DRIVE_LEFT.has(job.country) ? -1 : 1;
        const rx = d.z * side, rz = -d.x * side;
        const back = sg.nd.maxW / 2 + 1.2, out = e.width / 2 + 0.9;
        const x = sg.nd.x + d.x * back + rx * out, zz = sg.nd.z + d.z * back + rz * out;
        if (occ.get(x, zz) || x < 0 || zz < 0 || x > size || zz > size) continue;
        const da = Math.atan2(d.z, d.x) - sg.ref;
        const a = ((da % Math.PI) + Math.PI) % Math.PI;
        const group = a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1;
        poles.push(x, hAt(x, zz), zz, Math.atan2(d.x, d.z), idx, group);
      }
    }
    const isSig = new Set(sigNodes.map((q) => q.key));
    const tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
    const clear = (key: string) => { const nd = nodes.get(key)!; return nd.drive >= 3 || isSig.has(key) ? nd.maxW / 2 + 4.5 : 0; };
    for (const e of edges) {
      if (!e.drive) continue;
      const cum = cumLen(e.pts), len = cum[cum.length - 1];
      const yOf = (q: typeof tmp) => (e.bridge ? q.y + 0.04 : hAt(q.x, q.z) + LIFT_ROAD + 0.04);
      if (e.width >= 7 && e.cls !== 'service') {
        const s0 = clear(e.a), s1 = len - clear(e.b);
        if (s1 - s0 > 6) {
          const pt = (sv: number, off: number) => { alongY(e.pts, e.ys, cum, sv, tmp); return { x: tmp.x - tmp.tz * off, z: tmp.z + tmp.tx * off, y: yOf(tmp) }; };
          const solid = (off: number, w: number, dst: Buf) => {
            let p = pt(s0, off);
            for (let sv = s0 + 3; sv <= s1 + 0.01; sv += 3) { const q = pt(Math.min(sv, s1), off); strip(dst, p.x, p.z, p.y, q.x, q.z, q.y, w); p = q; }
          };
          const dashed = (off: number, dst: Buf) => {
            for (let sv = s0; sv + 3 <= s1; sv += 9) { const p = pt(sv, off), q = pt(sv + 3, off); strip(dst, p.x, p.z, p.y, q.x, q.z, q.y, 0.14); }
          };
          const twoWay = e.lanesB > 0;
          const left = DRIVE_LEFT.has(job.country);
          if (twoWay) {
            if (us) { solid(-0.17, 0.11, yellowBuf); solid(0.17, 0.11, yellowBuf); }
            else if (e.width >= 11) solid(0, 0.14, whiteBuf);
            else dashed(0, whiteBuf);
          }
          const laneW = Math.min(3.5, e.width / Math.max(1, e.lanesF + e.lanesB));
          const side = (lanes: number, sign: number, c0: number) => { for (let q = 1; q < lanes; q++) dashed(sign * (c0 + laneW * q), whiteBuf); };
          if (twoWay) { side(e.lanesF, left ? -1 : 1, 0); side(e.lanesB, left ? 1 : -1, 0); }
          else side(e.lanesF, 1, -(e.lanesF * laneW) / 2);
          if (e.width >= 11) { solid(e.width / 2 - 0.5, 0.12, whiteBuf); solid(-(e.width / 2 - 0.5), 0.12, whiteBuf); }
        }
      }
      // Street lights.
      if (!(e.cls === 'service' && len < 40)) {
        const spacing = e.cls === 'motorway' ? 45 : 32;
        let q = 0;
        for (let sv = 10; sv < len - 8; sv += spacing, q++) {
          alongY(e.pts, e.ys, cum, sv, tmp);
          const sideL = q % 2 === 0 || e.width >= 12 ? [1, -1][q % 2] : 1;
          const off = e.width / 2 + 0.9;
          const x = tmp.x - tmp.tz * off * sideL, zz = tmp.z + tmp.tx * off * sideL;
          if (x < 0 || zz < 0 || x > size || zz > size || occ.get(x, zz) || wetAt(x, zz)) continue;
          lamps.push(x, e.bridge ? tmp.y - LIFT_ROAD : hAt(x, zz), zz, Math.atan2(tmp.tz * sideL, -tmp.tx * sideL));
        }
      }
      // Street trees on city streets.
      if (['minor', 'tertiary', 'secondary', 'primary'].includes(e.cls) && !e.bridge) {
        const spacing = tropical ? 15 : 11;
        let q = 0;
        for (let sv = 6; sv < len - 6; sv += spacing, q++) {
          if (hash01(hashStr(e.a) + q * 7) < 0.35) continue;
          alongY(e.pts, e.ys, cum, sv, tmp);
          const sd = q % 2 ? 1 : -1, off = e.width / 2 + 1.5;
          const x = tmp.x - tmp.tz * off * sd, zz = tmp.z + tmp.tx * off * sd;
          if (x < 0 || zz < 0 || x > size || zz > size || occ.get(x, zz) || wetAt(x, zz)) continue;
          trees.push(x, hAt(x, zz), zz, hash01(q * 13 + sv) * 6.28, 0.75 + hash01(q + sv) * 0.4, tropical ? 2 : 0);
          // A tree pit in the paving, square to the street.
          pits.push(x, zz, Math.atan2(-tmp.tz, tmp.tx));
        }
      }
    }
    // Zebra crossings at busy intersections.
    for (const [key, nd] of nodes) {
      if (!(isSig.has(key) || nd.drive >= 4)) continue;
      for (const e of nd.edges) {
        if (!e.drive || e.cls === 'motorway' || e.cls === 'service' || e.bridge) continue;
        const d = leaving(e, e.a === key);
        const dist = nd.maxW / 2 + 1.8;
        const cx = nd.x + d.x * dist, cz = nd.z + d.z * dist;
        const rx = -d.z, rz = d.x;
        for (let o = -e.width / 2 + 0.6; o < e.width / 2 - 0.4; o += 1.2) {
          const px = cx + rx * o, pz = cz + rz * o;
          const ax = px - d.x * 1.6, az = pz - d.z * 1.6, bx = px + d.x * 1.6, bz = pz + d.z * 1.6;
          strip(whiteBuf, ax, az, hAt(ax, az) + LIFT_ROAD + 0.04, bx, bz, hAt(bx, bz) + LIFT_ROAD + 0.04, 0.6);
        }
      }
    }
  }

  // Raised sidewalks with a curb along city streets, cut back at intersections (the flat paving shows
  // there, like a dropped curb at the crossing), and the street furniture standing on them.
  const props: number[] = [];
  const curbs: number[] = [];
  // Where the map has real litter bins and mailboxes, use those instead of made-up ones.
  let poiBins = false, poiBoxes = false;
  if (lod === 0) {
    let nb = 0, nm = 0;
    for (const p of layers.points.poi ?? []) { const c = str(p.props.class); if (c === 'waste_basket') nb++; else if (c === 'post' && str(p.props.subclass) === 'post_box') nm++; }
    poiBins = nb >= 6; poiBoxes = nm >= 3;
  }
  if (lod === 0) {
    const tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
    const trimAt = (key: string) => { const nd = nodes.get(key); return nd && nd.drive >= 3 ? nd.maxW / 2 + 1.2 : 0; };
    for (const e of edges) {
      if (!e.drive || !e.walk || e.bridge || e.cls === 'service' || e.cls === 'motorway' || e.cls === 'trunk') continue;
      const sw = e.cls === 'minor' ? 2.6 : 3.4, inner = e.width / 2;
      const cum = cumLen(e.pts), len = cum[cum.length - 1];
      const s0 = trimAt(e.a), s1 = len - trimAt(e.b);
      if (s1 - s0 < 1.5) continue;
      raisedWalk(walkBuf, e.pts, cum, s0, s1, inner, inner + sw, hAt, LIFT_ROAD, CURB, curbs, (x, zz) => occ.get(x, zz) === 1);
      const seed = hashStr(e.a + e.b);
      const put = (sv: number, side: number, off: number, kind: number) => {
        if ((kind === 1 && poiBins) || (kind === 4 && poiBoxes)) return; // the map has the real ones
        alongY(e.pts, e.ys, cum, sv, tmp);
        const x = tmp.x - tmp.tz * off * side, zz = tmp.z + tmp.tx * off * side;
        if (x < 0 || zz < 0 || x > size || zz > size || occ.get(x, zz) || wetAt(x, zz)) return;
        // Faces the road.
        props.push(x, hAt(x, zz) + LIFT_ROAD + CURB, zz, Math.atan2(side * tmp.tz, -side * tmp.tx), kind);
      };
      let k = 0;
      for (let sv = s0 + 6; sv < s1 - 3; sv += 30, k++) {
        const side = k % 2 ? 1 : -1, h = hash01(seed + k * 13 + 7);
        if (h < 0.28) put(sv, side, inner + 1.15, 0);
        else if (h < 0.56) put(sv, side, inner + 0.5, 1);
        else if (us && h < 0.63) put(sv, side, inner + 0.55, 4);
      }
      if (us && hash01(seed + 3) < 0.6) put(s0 + 1.6, 1, inner + 0.45, 2);
      if (us && hash01(seed + 5) < 0.45) put(s1 - 1.6, -1, inner + 0.45, 2);
      // Manholes in the lanes.
      k = 0;
      for (let sv = s0 + 8; sv < s1 - 4; sv += 41, k++) {
        alongY(e.pts, e.ys, cum, sv, tmp);
        const off = (hash01(seed + k * 31) - 0.5) * e.width * 0.55;
        const x = tmp.x - tmp.tz * off, zz = tmp.z + tmp.tx * off;
        if (x < 0 || zz < 0 || x > size || zz > size) continue;
        props.push(x, hAt(x, zz) + LIFT_ROAD + 0.004, zz, hash01(seed + k) * 6.28, 3);
      }
    }
    // Tree pits under the street trees (on the raised sidewalk).
    for (let i = 0; i < pits.length; i += 3) props.push(pits[i], hAt(pits[i], pits[i + 1]) + LIFT_ROAD + CURB + 0.004, pits[i + 1], pits[i + 2], 5);
    // Street furniture where the map says it is: subway entrances, bus shelters, bike-share docks,
    // litter bins, mailboxes, newsstands. Oriented to the nearest street.
    const segs = new Map<string, number[]>();
    for (const e of edges) {
      if (!e.drive || e.bridge || e.cls === 'motorway') continue;
      for (let q = 2; q < e.pts.length; q += 2) {
        const ax = e.pts[q - 2], az = e.pts[q - 1], bx = e.pts[q], bz = e.pts[q + 1];
        const k = `${Math.floor((ax + bx) / 2 / 30)},${Math.floor((az + bz) / 2 / 30)}`;
        let l = segs.get(k); if (!l) segs.set(k, (l = [])); l.push(ax, az, bx, bz, e.width);
      }
    }
    const nearest = (x: number, zz: number) => {
      let best: { d: number; px: number; pz: number; tx: number; tz: number; w: number } | null = null;
      const ci = Math.floor(x / 30), cj = Math.floor(zz / 30);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const l = segs.get(`${i},${j}`); if (!l) continue;
        for (let q = 0; q < l.length; q += 5) {
          const ax = l[q], az = l[q + 1], ex = l[q + 2] - ax, ez = l[q + 3] - az, l2 = ex * ex + ez * ez;
          if (l2 < 0.01) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (zz - az) * ez) / l2));
          const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, zz - pz);
          if (!best || d < best.d) { const ll = Math.sqrt(l2); best = { d, px, pz, tx: ex / ll, tz: ez / ll, w: l[q + 4] }; }
        }
      }
      return best;
    };
    const city = density.reduce((a, b) => a + b, 0) / (size * size) > 0.18;
    for (const p of layers.points.poi ?? []) {
      const cls = str(p.props.class), sub = str(p.props.subclass);
      const kind = sub === 'subway_entrance' ? 6 : cls === 'bus' && sub === 'bus_stop' && city ? 8 : cls === 'bicycle_rental' && city ? 9
        : cls === 'waste_basket' ? 1 : cls === 'post' && sub === 'post_box' && us ? 4 : (sub === 'kiosk' || sub === 'newsagent') && city ? 7 : -1;
      if (kind < 0) continue;
      let x = p.x * S, zz = p.y * S;
      if (x < 0 || zz < 0 || x >= size || zz >= size) continue;
      const nr = nearest(x, zz);
      if (!nr || nr.d > 22) continue;
      // Which side of the street, and how far out from its centerline.
      const side = (x - nr.px) * -nr.tz + (zz - nr.pz) * nr.tx >= 0 ? 1 : -1;
      const rx = -nr.tz * side, rz = nr.tx * side;
      const curbOff = nr.w / 2;
      if (kind === 8 || kind === 4 || kind === 1 || kind === 7) {
        // Put it on the sidewalk by the curb.
        const off = curbOff + (kind === 8 ? 1.5 : kind === 7 ? 2.0 : 0.6);
        x = nr.px + rx * off; zz = nr.pz + rz * off;
      } else if (kind === 6 && nr.d < curbOff + 1.0) {
        x = nr.px + rx * (curbOff + 1.6); zz = nr.pz + rz * (curbOff + 1.6);
      }
      if (occ.get(x, zz) || wetAt(x, zz)) continue;
      const d = Math.hypot(x - nr.px, zz - nr.pz);
      const onWalk = d > curbOff + 0.1 && d < curbOff + 3.6;
      const y = hAt(x, zz) + (onWalk ? LIFT_ROAD + CURB : d <= curbOff ? LIFT_ROAD : 0.02);
      // Facing the road (the bench convention), or along it for entrances and docks.
      const face = Math.atan2(-rx, -rz);
      props.push(x, y, zz, kind === 6 || kind === 9 ? Math.atan2(-nr.tz, nr.tx) : face, kind);
    }
  }

  // ---------------------------------------------------------------- parks and woods (parks.ts)
  const parks = buildParks({
    layers, E, S, size, lod, tx, ty, north, tropical, hAt, wetAt,
    built: (x, zz) => occ.get(x, zz) > 0, road: (x, zz) => rd.get(x, zz) > 0,
  });

  // ---------------------------------------------------------------- ground mesh
  const ground = new Buf();
  const r1 = N + 1;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = H[j * r1 + i];
    ground.v(i * cell, h, j * cell);
    ground.uv.push(i / N, j / N);
    const hl = H[j * r1 + Math.max(0, i - 1)], hr = H[j * r1 + Math.min(N, i + 1)];
    const hu = H[Math.max(0, j - 1) * r1 + i], hd = H[Math.min(N, j + 1) * r1 + i];
    const dx = (hr - hl) / ((Math.min(N, i + 1) - Math.max(0, i - 1)) * cell), dz = (hd - hu) / ((Math.min(N, j + 1) - Math.max(0, j - 1)) * cell);
    const l = Math.hypot(dx, 1, dz);
    ground.nrm.push(-dx / l, 1 / l, -dz / l);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * r1 + i, b = a + 1, c = a + r1, d = c + 1;
    ground.tri(a, c, b); ground.tri(b, c, d);
  }
  // Skirts hide cracks between neighbors at different detail.
  const skirt = (list: number[], flip: boolean) => {
    const base = ground.count;
    for (const v of list) {
      ground.v(ground.pos[v * 3], ground.pos[v * 3 + 1] - 10, ground.pos[v * 3 + 2]);
      ground.uv.push(ground.uv[v * 2], ground.uv[v * 2 + 1]);
      ground.nrm.push(ground.nrm[v * 3], ground.nrm[v * 3 + 1], ground.nrm[v * 3 + 2]);
    }
    for (let q = 0; q + 1 < list.length; q++) {
      const t0v = list[q], t1v = list[q + 1], b0 = base + q, b1 = base + q + 1;
      if (flip) { ground.tri(t0v, b1, t1v); ground.tri(t0v, b0, b1); } else { ground.tri(t0v, t1v, b1); ground.tri(t0v, b1, b0); }
    }
  };
  const rowN = [...Array(r1).keys()];
  skirt(rowN.map((i) => i), false);
  skirt(rowN.map((i) => N * r1 + i), true);
  skirt(rowN.map((j) => j * r1), true);
  skirt(rowN.map((j) => j * r1 + N), false);

  // ---------------------------------------------------------------- painted ground texture
  let tex: ImageBitmap | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const T = lod === 0 ? 1024 : 256;
    const cv = new OffscreenCanvas(T, T);
    // Software canvas: workers painting on the GPU process at once can overwhelm it.
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const P = T / size;
    // Base: grass where it's open, paving where it's built up.
    const small = new OffscreenCanvas(16, 16), sg = small.getContext('2d', { willReadFrequently: true })!;
    const grass = rgb(parseInt(GROUND.grass.slice(1), 16)), urban = rgb(parseInt(GROUND.urban.slice(1), 16));
    const cellA = (size / 16) ** 2;
    for (let q = 0; q < 256; q++) {
      const cov = density[q] / cellA;
      const t = Math.min(1, Math.max(0, (cov - 0.08) / 0.24));
      sg.fillStyle = `rgb(${grass.map((v, c) => Math.round(v + (urban[c] - v) * t)).join(',')})`;
      sg.fillRect(q % 16, Math.floor(q / 16), 1, 1);
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(small, -T / 32, -T / 32, T + T / 16, T + T / 16);
    const path = (rings: number[][]) => {
      g.beginPath();
      for (const r of rings) { for (let q = 0; q < r.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, r[q] * P, r[q + 1] * P); g.closePath(); }
    };
    const fillLayer = (layer: string, color: (p: Record<string, unknown>) => string | null) => {
      for (const f of layers.polys[layer] ?? []) {
        const c = color(f.props);
        if (!c) continue;
        g.fillStyle = c;
        for (const poly of f.polys) { path(poly.map((r) => r.map((v) => v * S))); g.fill('evenodd'); }
      }
    };
    fillLayer('landuse', (p) => {
      const c = str(p.class);
      if (['commercial', 'retail', 'industrial', 'railway', 'garages', 'quarry'].includes(c)) return GROUND.urban;
      if (['school', 'university', 'college', 'hospital', 'kindergarten', 'library', 'theme_park', 'zoo'].includes(c)) return GROUND.civic;
      if (c === 'cemetery') return GROUND.cemetery;
      if (['pitch', 'playground', 'stadium'].includes(c)) return GROUND.pitch;
      if (c === 'residential' || c === 'suburb' || c === 'neighbourhood') return null;
      return null;
    });
    fillLayer('landcover', (p) => {
      const c = str(p.class), sub = str(p.subclass);
      return c === 'wood' ? GROUND.wood : c === 'grass' ? (sub === 'park' ? GROUND.park : GROUND.grass) : c === 'farmland' ? GROUND.farmland
        : c === 'sand' ? GROUND.sand : c === 'wetland' ? GROUND.wetland : c === 'ice' ? GROUND.ice : c === 'rock' ? GROUND.rock : null;
    });
    fillLayer('park', () => GROUND.park);
    parks.paint(g, P);
    // Soft contact shadow around buildings.
    // One path, one blur (a filter applies per draw call).
    g.save();
    g.filter = `blur(${Math.max(1, 2.2 * P)}px)`;
    g.fillStyle = 'rgba(60,60,52,0.28)';
    g.beginPath();
    for (const r of paintBuildings) { for (let q = 0; q < r.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, r[q] * P, r[q + 1] * P); g.closePath(); }
    g.fill('nonzero');
    g.restore();
    // Rivers drawn as lines, then water bodies.
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of layers.lines.waterway ?? []) {
      if (str(f.props.brunnel) === 'tunnel') continue;
      const c = str(f.props.class);
      const w = c === 'river' ? 14 : c === 'canal' ? 9 : 3;
      g.strokeStyle = GROUND.water; g.lineWidth = Math.max(1, w * P);
      for (const l of f.lines) { g.beginPath(); for (let q = 0; q < l.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, l[q] * S * P, l[q + 1] * S * P); g.stroke(); }
    }
    g.fillStyle = GROUND.water;
    for (const rings of waterPaint) { path(rings); g.fill('evenodd'); }
    // Roads and rails, so the ground reads as a map from the air.
    for (const r of roads) {
      g.strokeStyle = r.spec.drive ? GROUND.road : GROUND.path;
      g.lineWidth = Math.max(lod === 0 ? 1 : 1.5, (r.spec.width + (r.spec.drive && lod === 1 ? 4 : 0)) * P);
      g.beginPath();
      for (let q = 0; q < r.pts.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, r.pts[q] * P, r.pts[q + 1] * P);
      g.stroke();
    }
    for (const f of layers.lines.transportation ?? []) {
      if (str(f.props.class) !== 'rail' || str(f.props.brunnel) === 'tunnel') continue;
      g.strokeStyle = GROUND.rail; g.lineWidth = Math.max(1, 3.5 * P);
      for (const l of f.lines) { g.beginPath(); for (let q = 0; q < l.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, l[q] * S * P, l[q + 1] * S * P); g.stroke(); }
    }
    tex = cv.transferToImageBitmap();
  }

  // ---------------------------------------------------------------- labels
  const names: ChunkOut['names'] = [];
  for (const f of layers.lines.transportation_name ?? []) {
    const name = str(f.props.name_en) || str(f.props.name) || str(f.props.ref);
    if (!name) continue;
    const cls = str(f.props.class);
    const spec = roadSpec(cls, str(f.props.subclass), false, false, '');
    for (const l of f.lines) for (const piece of clipLine(l, E)) names.push({ name, pts: toM(piece), w: spec?.width ?? 8 });
  }
  const places: ChunkOut['places'] = [];
  for (const p of layers.points.place ?? []) {
    if (p.x < 0 || p.y < 0 || p.x >= E || p.y >= E) continue;
    const name = str(p.props.name_en) || str(p.props.name);
    if (name) places.push({ name, cls: str(p.props.class), x: p.x * S, z: p.y * S, rank: num(p.props.rank, 10) });
  }

  // ---------------------------------------------------------------- pack
  const groundM = ground.out()!;
  const out: ChunkOut = {
    id: job.id, z, tx, ty, lod, size, n: N, heights: H, wetN: M, wet,
    ground: groundM, tex,
    water: waterBuf.out(), buildings: cells.map((b) => b.out()), footprints,
    iron: iron.out(),
    road: roadBuf.out(), walk: walkBuf.out(), paintW: whiteBuf.out(), paintY: yellowBuf.out(), deck: deckBuf.out(),
    trees: new Float32Array(trees), parks: parks.out, lamps: new Float32Array(lamps), poles: new Float32Array(poles), pillars: new Float32Array(pillars),
    props: new Float32Array(props), curbs: new Float32Array(curbs), shore: shoreBuf.out(),
    signals, landmarks: lmClaims, edges: lod === 0 ? edges : [], names: lod === 0 ? names : [], places,
    stats: { buildings: nBuildings, roads: roads.length, ms: Math.round(performance.now() - t0), verts: cells.reduce((a, b) => a + b.count, 0) },
  };
  const transfer: Transferable[] = [H.buffer, wet.buffer, out.trees.buffer, out.lamps.buffer, out.poles.buffer, out.pillars.buffer, out.props.buffer, out.curbs.buffer, parks.out.trees.buffer, parks.out.rocks.buffer];
  for (const m of [out.ground, out.water, parks.out.wall, ...out.buildings, out.iron, out.road, out.walk, out.paintW, out.paintY, out.deck, out.shore]) {
    if (!m) continue;
    for (const a of [m.pos, m.nrm, m.uv, m.col, m.fac, m.seed, m.idx]) if (a) transfer.push(a.buffer);
  }
  if (tex) transfer.push(tex);
  return { out, transfer };
}

const DRIVE_LEFT = new Set(['gb', 'ie', 'jp', 'au', 'nz', 'in', 'za', 'hk', 'sg', 'my', 'th', 'id', 'pk', 'bd', 'lk', 'np', 'ke', 'tz', 'ug', 'zw', 'zm', 'mw', 'mz', 'bw', 'na', 'jm', 'tt', 'bb', 'bs', 'cy', 'mt', 'mo', 'mu', 'bn', 'fj', 'gy', 'sr']);
export const driveLeft = (country: string) => DRIVE_LEFT.has(country);

/** Gabled roof over a near-rectangular footprint, ridge along the long side. Returns false if the footprint isn't boxy enough. */
function gable(b: Buf, ring: number[], area: number, top: number, h: number, gmin: number, sd: number, wall: [number, number, number], roof: [number, number, number]) {
  const n = ring.length / 2;
  let best = 0, ux = 1, uz = 0;
  for (let q = 0; q < n; q++) {
    const p2 = (q + 1) % n;
    const dx = ring[p2 * 2] - ring[q * 2], dz = ring[p2 * 2 + 1] - ring[q * 2 + 1], l = Math.hypot(dx, dz);
    if (l > best) { best = l; ux = dx / l; uz = dz / l; }
  }
  let vx = -uz, vz = ux;
  let cx = 0, cz = 0;
  for (let q = 0; q < n; q++) { cx += ring[q * 2]; cz += ring[q * 2 + 1]; }
  cx /= n; cz /= n;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let q = 0; q < n; q++) {
    const px = ring[q * 2] - cx, pz = ring[q * 2 + 1] - cz;
    const a = px * ux + pz * uz, bb = px * vx + pz * vz;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, bb); b1 = Math.max(b1, bb);
  }
  let L = a1 - a0, W = b1 - b0;
  if (area / (L * W) < 0.8 || W < 3 || W > 24 || L > 70) return false;
  if (W > L) { // ridge along the longer extent
    [ux, uz, vx, vz] = [vx, vz, -ux, -uz];
    [a0, a1, b0, b1] = [b0, b1, -a1, -a0];
    [L, W] = [W, L];
  }
  const rise = Math.min(Math.max(W * 0.42, 1.6), 5.5);
  const o = 0.35;
  const P = (a: number, bb: number, y: number): [number, number, number] => [cx + ux * a + vx * bb, y, cz + uz * a + vz * bb];
  const mid = (b0 + b1) / 2;
  const ridgeA = P(a0 - o, mid, top + rise), ridgeB = P(a1 + o, mid, top + rise);
  const eave = top - o * (rise / (W / 2));
  const l0 = P(a0 - o, b0 - o, eave), l1 = P(a1 + o, b0 - o, eave), r0 = P(a0 - o, b1 + o, eave), r1 = P(a1 + o, b1 + o, eave);
  const face = (pts: [number, number, number][], col: [number, number, number], fac: (p: [number, number, number]) => [number, number, number, number], want: [number, number, number]) => {
    const [A, Bp, C] = pts;
    const e1 = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    const base = b.count;
    for (const p of pts) { b.v(p[0], p[1], p[2]); b.nrm.push(nx / l, ny / l, nz / l); b.col.push(...col); b.fac.push(...fac(p)); b.seed.push(sd); }
    if (pts.length === 3) { if (flip) b.tri(base, base + 2, base + 1); else b.tri(base, base + 1, base + 2); }
    else if (flip) { b.tri(base, base + 2, base + 1); b.tri(base, base + 3, base + 2); } else b.quad(base, base + 1, base + 2, base + 3);
  };
  const roofFac = (): [number, number, number, number] => [0, h, -1, h];
  // Slopes (normals tilt up and out toward each eave side).
  face([l0, l1, ridgeB, ridgeA], roof, roofFac, [-vx, 1, -vz]);
  face([r0, r1, ridgeB, ridgeA], roof, roofFac, [vx, 1, vz]);
  // Gable ends (wall-colored triangles over the end walls).
  const g0 = P(a0, b0, top), g1 = P(a0, b1, top), gt = P(a0, mid, top + rise);
  const g2 = P(a1, b0, top), g3 = P(a1, b1, top), gt2 = P(a1, mid, top + rise);
  const gfac = (p: [number, number, number]): [number, number, number, number] => [0, p[1] - gmin, -2, h];
  face([g0, g1, gt], wall, gfac, [-ux, 0, -uz]);
  face([g2, g3, gt2], wall, gfac, [ux, 0, uz]);
  // Undersides of the overhang are skipped; from the street the eaves read fine.
  return true;
}

/** Bridge deck edges (parapets), underside, and pillars down to the ground. */
function bridgeSides(b: Buf, pts: number[], ys: number[], width: number, pillars: number[], hAt: (x: number, z: number) => number) {
  const n = pts.length / 2;
  let acc = 0, next = 12;
  for (let q = 0; q + 1 < n; q++) {
    const ax = pts[q * 2], az = pts[q * 2 + 1], bx = pts[q * 2 + 2], bz = pts[q * 2 + 3];
    const l = Math.hypot(bx - ax, bz - az) || 1, ox = (-(bz - az) / l) * (width / 2), oz = ((bx - ax) / l) * (width / 2);
    const ya = ys[q], yb = ys[q + 1];
    for (const sg of [-1, 1]) {
      const x0 = ax + ox * sg, z0 = az + oz * sg, x1 = bx + ox * sg, z1 = bz + oz * sg;
      const p0 = b.v(x0, ya + 0.9, z0), p1 = b.v(x1, yb + 0.9, z1), p2 = b.v(x1, yb - 1.3, z1), p3 = b.v(x0, ya - 1.3, z0);
      if (sg > 0) b.quad(p0, p1, p2, p3); else b.quad(p0, p3, p2, p1);
    }
    // Underside.
    const u0 = b.v(ax - ox, ya - 1.3, az - oz), u1 = b.v(ax + ox, ya - 1.3, az + oz), u2 = b.v(bx + ox, yb - 1.3, bz + oz), u3 = b.v(bx - ox, yb - 1.3, bz - oz);
    b.quad(u0, u3, u2, u1);
    acc += l;
    while (acc >= next) {
      const t = 1 - (acc - next) / l;
      const x = ax + (bx - ax) * t, zz = az + (bz - az) * t, y = ya + (yb - ya) * t;
      const g = hAt(x, zz);
      if (y - g > 3.5) pillars.push(x, g - 1, zz, y - 1.3 - g + 1);
      next += 30;
    }
  }
}

/** A small box on a roof (facade code 0 = plain roof material). */
function roofBox(b: Buf, x: number, z: number, w: number, d: number, y0: number, y1: number, col: [number, number, number], sd: number, h: number) {
  const xs = [x - w / 2, x + w / 2], zs = [z - d / 2, z + d / 2];
  const faces: [number[], [number, number, number]][] = [
    [[xs[0], zs[1], xs[1], zs[1]], [0, 0, 1]], [[xs[1], zs[1], xs[1], zs[0]], [1, 0, 0]],
    [[xs[1], zs[0], xs[0], zs[0]], [0, 0, -1]], [[xs[0], zs[0], xs[0], zs[1]], [-1, 0, 0]],
  ];
  const shade = (k: number): [number, number, number] => [col[0] * k, col[1] * k, col[2] * k];
  for (const [[ax, az, bx, bz], n] of faces) {
    const base = b.count;
    for (const [px, py, pz] of [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]]) { b.v(px, py, pz); b.nrm.push(...n); b.col.push(...shade(0.92)); b.fac.push(0, h, 0, h); b.seed.push(sd); }
    b.quad(base, base + 1, base + 2, base + 3);
  }
  const base = b.count;
  for (const [px, pz] of [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]]) { b.v(px, y1, pz); b.nrm.push(0, 1, 0); b.col.push(...col); b.fac.push(0, h, 0, h); b.seed.push(sd); }
  b.tri(base, base + 3, base + 2); b.tri(base, base + 2, base + 1);
}

/** The classic Manhattan rooftop water tank: a wooden barrel with a cone hat, up on short legs. */
function waterTower(b: Buf, x: number, z: number, roofY: number, sd: number, h: number) {
  const r = 2.1, legs = 2.4, body = 3.6, hat = 1.3, seg = 10;
  const wood: [number, number, number] = [128, 92, 62], dark: [number, number, number] = [70, 62, 56];
  const ring = (y: number, rad: number) => Array.from({ length: seg }, (_, i) => [x + Math.cos((i / seg) * Math.PI * 2) * rad, y, z + Math.sin((i / seg) * Math.PI * 2) * rad]);
  const lo = ring(roofY + legs, r), hi = ring(roofY + legs + body, r);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg, a = (i + 0.5) / seg * Math.PI * 2;
    const base = b.count;
    for (const p of [lo[i], lo[j], hi[j], hi[i]]) { b.v(p[0], p[1], p[2]); b.nrm.push(Math.cos(a), 0, Math.sin(a)); b.col.push(...wood); b.fac.push(0, h, 0, h); b.seed.push(sd); }
    b.tri(base, base + 2, base + 1); b.tri(base, base + 3, base + 2);
    // Cone hat.
    const tip = [x, roofY + legs + body + hat, z];
    const hb = b.count;
    for (const p of [hi[i], hi[j], tip]) { b.v(p[0], p[1], p[2]); b.nrm.push(Math.cos(a) * 0.7, 0.7, Math.sin(a) * 0.7); b.col.push(...dark); b.fac.push(0, h, 0, h); b.seed.push(sd); }
    b.tri(hb, hb + 2, hb + 1);
  }
  // Legs.
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) roofBox(b, x + dx * r * 0.6, z + dz * r * 0.6, 0.25, 0.25, roofY, roofY + legs, dark, sd, h);
}

const fract = (v: number) => v - Math.floor(v);

/** Stone trim for a wall color: brick gets pale limestone dressings, render a lighter shade of itself. */
function trimColor(w: [number, number, number], key: number): [number, number, number] {
  const lum = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2];
  const k = 0.92 + hash01(key + 41) * 0.12;
  if (w[0] / Math.max(1, w[1]) > 1.25 && lum < 140) return [196 * k, 188 * k, 172 * k];
  return [(w[0] + (216 - w[0]) * 0.35) * k, (w[1] + (211 - w[1]) * 0.35) * k, (w[2] + (200 - w[2]) * 0.35) * k];
}

/** The ring pushed out (d > 0) or in (d < 0) along its outward normals, mitered at the corners. */
function offsetRing(ring: number[], d: number) {
  const n = ring.length / 2, out: number[] = [];
  for (let q = 0; q < n; q++) {
    const p = (q + n - 1) % n, nx = (q + 1) % n;
    const ax = ring[p * 2], az = ring[p * 2 + 1], bx = ring[q * 2], bz = ring[q * 2 + 1], cx = ring[nx * 2], cz = ring[nx * 2 + 1];
    const l0 = Math.hypot(bx - ax, bz - az) || 1, l1 = Math.hypot(cx - bx, cz - bz) || 1;
    const n0x = -(bz - az) / l0, n0z = (bx - ax) / l0, n1x = -(cz - bz) / l1, n1z = (cx - bx) / l1;
    let mx = n0x + n1x, mz = n0z + n1z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * n1x + mz * n1z));
    out.push(bx + mx * d * k, bz + mz * d * k);
  }
  return out;
}

type RGB = [number, number, number];
/** One flat face (4 corners, given normal) with trim attributes: facade code -3 (plain) or -4 (lit sign). */
function face4(b: Buf, p: number[][], n: [number, number, number], col: RGB, u0: number, u1: number, gmin: number, sd: number, h: number, code = -3) {
  const base = b.count;
  p.forEach((v, i) => { b.v(v[0], v[1], v[2]); b.nrm.push(...n); b.col.push(...col); b.fac.push(i === 1 || i === 2 ? u1 : u0, v[1] - gmin, code, h); b.seed.push(sd); });
  b.quad(base, base + 1, base + 2, base + 3);
}

/** Cornice + parapet: a band projecting `proj` out from yBot up to yTop, `thick` deep, its inner face down to the roof. */
function trimBand(b: Buf, ring: number[], yBot: number, yTop: number, roofY: number, proj: number, thick: number, col: RGB, sd: number, h: number, gmin: number) {
  const O = offsetRing(ring, proj), I = offsetRing(ring, -thick), n = ring.length / 2;
  const under: RGB = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8];
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const Ao = [O[q * 2], O[q * 2 + 1]], Bo = [O[r * 2], O[r * 2 + 1]], Ai = [I[q * 2], I[q * 2 + 1]], Bi = [I[r * 2], I[r * 2 + 1]];
    face4(b, [[ax, yBot, az], [bx, yBot, bz], [Bo[0], yBot, Bo[1]], [Ao[0], yBot, Ao[1]]], [0, -1, 0], under, 0, len, gmin, sd, h);
    face4(b, [[Ao[0], yBot, Ao[1]], [Bo[0], yBot, Bo[1]], [Bo[0], yTop, Bo[1]], [Ao[0], yTop, Ao[1]]], [nx, 0, nz], col, 0, len, gmin, sd, h);
    face4(b, [[Ao[0], yTop, Ao[1]], [Bo[0], yTop, Bo[1]], [Bi[0], yTop, Bi[1]], [Ai[0], yTop, Ai[1]]], [0, 1, 0], col, 0, len, gmin, sd, h);
    if (yTop > roofY + 0.05) face4(b, [[Bi[0], roofY, Bi[1]], [Ai[0], roofY, Ai[1]], [Ai[0], yTop, Ai[1]], [Bi[0], yTop, Bi[1]]], [-nx, 0, -nz], under, len, 0, gmin, sd, h);
  }
}

/** A string course: a slim projecting ledge running round the building at height y. */
function ledge(b: Buf, ring: number[], y: number, proj: number, thick: number, col: RGB, sd: number, h: number, gmin: number) {
  const O = offsetRing(ring, proj), n = ring.length / 2;
  const under: RGB = [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75];
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const Ao = [O[q * 2], O[q * 2 + 1]], Bo = [O[r * 2], O[r * 2 + 1]];
    face4(b, [[ax, y, az], [bx, y, bz], [Bo[0], y, Bo[1]], [Ao[0], y, Ao[1]]], [0, -1, 0], under, 0, len, gmin, sd, h);
    face4(b, [[Ao[0], y, Ao[1]], [Bo[0], y, Bo[1]], [Bo[0], y + thick, Bo[1]], [Ao[0], y + thick, Ao[1]]], [nx, 0, nz], col, 0, len, gmin, sd, h);
    face4(b, [[Ao[0], y + thick, Ao[1]], [Bo[0], y + thick, Bo[1]], [bx, y + thick, bz], [ax, y + thick, az]], [0, 1, 0], col, 0, len, gmin, sd, h);
  }
}

const AWNINGS: RGB[] = [[34, 72, 48], [112, 30, 32], [30, 44, 76], [30, 30, 32], [150, 122, 84], [140, 34, 26], [82, 86, 90], [96, 60, 36]];
const SIGNS: RGB[] = [[196, 44, 34], [232, 184, 46], [34, 96, 168], [236, 236, 230], [34, 142, 92], [206, 96, 34], [120, 40, 120]];

/** Blade signs over the ground-floor shop bays of walls that face a street (awnings are kept but switched off). */
function shopfronts(b: Buf, ring: number[], streetR: Raster, gmin: number, gH: number, key: number, sd: number, h: number) {
  const n = ring.length / 2;
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4.5) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
    const mx = (ax + bx) / 2 + nx * 4, mz = (az + bz) / 2 + nz * 4;
    if (!streetR.get(mx, mz)) continue;
    const bays = Math.floor(len / 4.2);
    for (let k = 0; k < bays; k++) {
      const rr = hash01(key * 7 + q * 131 + k * 17);
      const u0 = 4.2 * k + 0.42, u1 = 4.2 * k + 3.78;
      const P = (u: number, out: number, y: number) => [ax + tx * u + nx * out, y, az + tz * u + nz * out];
      if (rr < 0) {
        // Fabric awning (off: the lit shop windows and their sign band are the look): sloping out and down from just over the shop window, with a valance.
        const col = AWNINGS[Math.floor(hash01(key + q * 7 + k * 3) * AWNINGS.length)];
        const yT = gmin + gH - 0.4, yL = yT - 0.55, out = 1.15;
        const sl = Math.hypot(out, 0.55), nup: [number, number, number] = [nx * 0.55 / sl, out / sl, nz * 0.55 / sl];
        face4(b, [P(u0, out, yL), P(u1, out, yL), P(u1, 0.02, yT), P(u0, 0.02, yT)], nup, col, u0, u1, gmin, sd, h);
        const dark: RGB = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
        face4(b, [P(u0, 0.02, yT), P(u1, 0.02, yT), P(u1, out, yL), P(u0, out, yL)], [-nup[0], -nup[1], -nup[2]], dark, u0, u1, gmin, sd, h);
        face4(b, [P(u0, out, yL - 0.24), P(u1, out, yL - 0.24), P(u1, out, yL), P(u0, out, yL)], [nx, 0, nz], col, u0, u1, gmin, sd, h);
        face4(b, [P(u1, out, yL - 0.24), P(u0, out, yL - 0.24), P(u0, out, yL), P(u1, out, yL)], [-nx, 0, -nz], dark, u1, u0, gmin, sd, h);
      } else if (rr < 0.14) {
        // Blade sign sticking out over the sidewalk (lit at night).
        const col = SIGNS[Math.floor(hash01(key + q * 5 + k * 11) * SIGNS.length)];
        const u = u0 + 0.2, y0 = gmin + gH + 0.35, y1 = y0 + 1.1 + hash01(key + k) * 0.8, o0 = 0.15, o1 = 0.95, th = 0.05;
        face4(b, [P(u - th, o0, y0), P(u - th, o1, y0), P(u - th, o1, y1), P(u - th, o0, y1)], [-tx, 0, -tz], col, 0, 0.8, gmin, sd, h, -4);
        face4(b, [P(u + th, o1, y0), P(u + th, o0, y0), P(u + th, o0, y1), P(u + th, o1, y1)], [tx, 0, tz], col, 0, 0.8, gmin, sd, h, -4);
        const edge: RGB = [40, 40, 42];
        face4(b, [P(u - th, o1, y0), P(u + th, o1, y0), P(u + th, o1, y1), P(u - th, o1, y1)], [nx, 0, nz], edge, 0, 0.1, gmin, sd, h);
      }
    }
  }
}

/** Calls fn for each wall of the ring that faces a drivable street (outward normal nx, nz). */
function streetWalls(ring: number[], streetR: Raster, fn: (ax: number, az: number, bx: number, bz: number, len: number, nx: number, nz: number) => void) {
  const n = ring.length / 2;
  for (let q = 0; q < n; q++) {
    const r = (q + 1) % n;
    const ax = ring[q * 2], az = ring[q * 2 + 1], bx = ring[r * 2], bz = ring[r * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 3) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (!streetR.get((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4)) continue;
    fn(ax, az, bx, bz, len, nx, nz);
  }
}

/**
 * A box in a wall's frame: along the wall u0..u1 (from a, direction t), out from it o0..o1 (normal n),
 * y0..y1. Plain trim faces (facade code -3); `bottom` adds an underside.
 */
function wallBox(b: Buf, ax: number, az: number, tx: number, tz: number, nx: number, nz: number, u0: number, u1: number, o0: number, o1: number, y0: number, y1: number, col: RGB, sd: number, h: number, gmin: number, bottom = false) {
  const P = (u: number, o: number, y: number) => [ax + tx * u + nx * o, y, az + tz * u + nz * o];
  const dark: RGB = [col[0] * 0.78, col[1] * 0.78, col[2] * 0.78];
  face4(b, [P(u0, o1, y0), P(u1, o1, y0), P(u1, o1, y1), P(u0, o1, y1)], [nx, 0, nz], col, u0, u1, gmin, sd, h);
  face4(b, [P(u0, o1, y1), P(u1, o1, y1), P(u1, o0, y1), P(u0, o0, y1)], [0, 1, 0], col, u0, u1, gmin, sd, h);
  face4(b, [P(u1, o1, y0), P(u1, o0, y0), P(u1, o0, y1), P(u1, o1, y1)], [tx, 0, tz], dark, 0, o1 - o0, gmin, sd, h);
  face4(b, [P(u0, o0, y0), P(u0, o1, y0), P(u0, o1, y1), P(u0, o0, y1)], [-tx, 0, -tz], dark, 0, o1 - o0, gmin, sd, h);
  if (o0 > 0.01) face4(b, [P(u1, o0, y0), P(u0, o0, y0), P(u0, o0, y1), P(u1, o0, y1)], [-nx, 0, -nz], dark, u1, u0, gmin, sd, h);
  if (bottom) face4(b, [P(u0, o0, y0), P(u1, o0, y0), P(u1, o1, y0), P(u0, o1, y0)], [0, -1, 0], dark, u0, u1, gmin, sd, h);
}

/** A brownstone stoop: steps rising from the sidewalk to the parlor-floor door at `rise`, between stone cheek walls. */
function stoop(b: Buf, x: number, z: number, tx: number, tz: number, nx: number, nz: number, gmin: number, rise: number, col: RGB, sd: number, h: number) {
  const steps = Math.max(4, Math.round(rise / 0.19)), run = 0.29, w = 1.7;
  const stone: RGB = [col[0] * 1.05, col[1] * 1.05, col[2] * 1.05];
  const ax = x - tx * (w / 2), az = z - tz * (w / 2);
  const landing = 1.25;
  // Top landing, then each step out toward the street.
  wallBox(b, ax, az, tx, tz, nx, nz, 0, w, 0, landing, gmin, gmin + rise, stone, sd, h, gmin);
  for (let s = 0; s < steps - 1; s++) {
    const o0 = landing + s * run, y1 = gmin + rise * (1 - (s + 1) / steps);
    wallBox(b, ax, az, tx, tz, nx, nz, 0, w, o0, o0 + run, gmin, y1, stone, sd, h, gmin);
  }
  // Cheek walls (sloping caps) with a newel post at the bottom.
  const out = landing + (steps - 1) * run;
  for (const u of [-0.22, w]) {
    wallBox(b, ax, az, tx, tz, nx, nz, u, u + 0.22, 0, out, gmin, gmin + rise + 0.75, col, sd, h, gmin);
    wallBox(b, ax, az, tx, tz, nx, nz, u - 0.03, u + 0.25, out - 0.35, out + 0.05, gmin, gmin + 1.1, col, sd, h, gmin);
  }
}

/**
 * A New York fire escape on a street wall between u0 and u1, as a few see-through quads in the
 * ironwork mesh (its shader cuts the bars and slats): a slatted platform with railings at each floor
 * above the ground floor, a stair between platforms, a drop ladder over the sidewalk.
 * Iron uv = (meters along, meters up); color r = pattern (1 railing, 2 slats, 3 rungs).
 */
function fireEscape(b: Buf, ax: number, az: number, tx: number, tz: number, nx: number, nz: number, u0: number, u1: number, gmin: number, first: number, floorH: number, h: number) {
  const depth = 1.15;
  const P = (u: number, o: number, y: number): [number, number, number] => [ax + tx * u + nx * o, y, az + tz * u + nz * o];
  const quad = (p: [number, number, number][], uv: number[], pat: number) => {
    const base = b.count;
    p.forEach((q, i) => { b.v(q[0], q[1], q[2]); b.uv.push(uv[i * 2], uv[i * 2 + 1]); b.col.push(pat * 60, 0, 0); });
    b.quad(base, base + 1, base + 2, base + 3);
  };
  const floors = Math.floor((h - first - 1.2) / floorH);
  for (let k = 1; k <= floors; k++) {
    const y = gmin + first + floorH * k - 0.05;
    if (y > gmin + h - 1.5) break;
    const L = u1 - u0;
    quad([P(u0, 0.05, y), P(u1, 0.05, y), P(u1, depth, y), P(u0, depth, y)], [0, 0, L, 0, L, depth, 0, depth], 2);
    quad([P(u0, depth, y), P(u1, depth, y), P(u1, depth, y + 1.0), P(u0, depth, y + 1.0)], [0, 0, L, 0, L, 1.0, 0, 1.0], 1);
    quad([P(u0, 0.05, y), P(u0, depth, y), P(u0, depth, y + 1.0), P(u0, 0.05, y + 1.0)], [0, 0, depth, 0, depth, 1.0, 0, 1.0], 1);
    quad([P(u1, depth, y), P(u1, 0.05, y), P(u1, 0.05, y + 1.0), P(u1, depth, y + 1.0)], [0, 0, depth, 0, depth, 1.0, 0, 1.0], 1);
    // The stair up to the next platform: a steep slatted ramp, alternating ends.
    if (k < floors) {
      const left = k % 2 === 1, ua = left ? u0 + 0.25 : u1 - 0.25, ub = left ? ua + 1.6 : ua - 1.6;
      const run = Math.hypot(1.6, floorH);
      quad([P(ua, 0.35, y), P(ua, 0.95, y), P(ub, 0.95, y + floorH), P(ub, 0.35, y + floorH)], [0, 0, 0.6, 0, 0.6, run, 0, run], 3);
    }
  }
  // Drop ladder hanging from the lowest platform.
  if (floors >= 1) {
    const y = gmin + first + floorH - 0.05, ul = u1 - 0.7;
    quad([P(ul, depth - 0.2, y - 2.1), P(ul + 0.5, depth - 0.2, y - 2.1), P(ul + 0.5, depth - 0.2, y), P(ul, depth - 0.2, y)], [0, 0, 0.5, 0, 0.5, 2.1, 0, 2.1], 3);
  }
}

/** A New York sidewalk shed (scaffolding): a green plywood deck on posts over the sidewalk. */
function shed(b: Buf, ax: number, az: number, tx: number, tz: number, nx: number, nz: number, len: number, gmin: number, sd: number, h: number) {
  const green: RGB = [52, 84, 58], post: RGB = [70, 92, 74], depth = 2.0, y = gmin + 3.3;
  wallBox(b, ax, az, tx, tz, nx, nz, 0.3, len - 0.3, 0, depth, y, y + 0.35, green, sd, h, gmin, true);
  wallBox(b, ax, az, tx, tz, nx, nz, 0.3, len - 0.3, depth - 0.06, depth, y + 0.35, y + 1.25, green, sd, h, gmin);
  for (let u = 0.4; u < len - 0.4; u += 2.4) wallBox(b, ax, az, tx, tz, nx, nz, u, u + 0.12, depth - 0.2, depth - 0.08, gmin, y, post, sd, h, gmin);
}

/**
 * Sidewalks on both sides of a street centerline between arc lengths s0 and s1: a top `curb` above
 * the road from offset `inner` to `outer`, a curb face down to the road, and an outer edge. Records
 * the raised stretches in `curbs` for walking.
 */
function raisedWalk(b: Buf, pts: number[], cum: number[], s0: number, s1: number, inner: number, outer: number, hAt: (x: number, z: number) => number, lift: number, curb: number, curbs: number[], solid: (x: number, z: number) => boolean) {
  const n = pts.length / 2;
  // Mitered right-hand normals per point (as in ribbon()).
  const nx: number[] = [], nz: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let tx = 0, tz = 0;
    if (i > 0) { const dx = x - pts[i * 2 - 2], dz = z - pts[i * 2 - 1], l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; }
    if (i < n - 1) { const dx = pts[i * 2 + 2] - x, dz = pts[i * 2 + 3] - z, l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = x - pts[i * 2 - 2], dz = z - pts[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
      k = Math.min(2.2, 1 / Math.max(0.3, (dx / l) * tx + (dz / l) * tz));
    }
    nx.push(-tz * k); nz.push(tx * k);
  }
  // Where a building stands a little way back, the paving runs on up to its wall.
  const reach = (i: number, side: number) => {
    for (let d = outer + 0.5; d <= outer + 6; d += 0.75) {
      if (solid(pts[i * 2] + nx[i] * d * side, pts[i * 2 + 1] + nz[i] * d * side)) return d + 0.4;
    }
    return outer;
  };
  const outR = Array.from({ length: n }, (_, i) => reach(i, 1)), outL = Array.from({ length: n }, (_, i) => reach(i, -1));
  for (let i = 0; i + 1 < n; i++) {
    const a = Math.max(s0, cum[i]), c = Math.min(s1, cum[i + 1]);
    const segL = cum[i + 1] - cum[i];
    if (c - a < 0.05 || segL < 1e-3) continue;
    const ta = (a - cum[i]) / segL, tb = (c - cum[i]) / segL;
    const L = (t: number) => ({
      x: pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, z: pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t,
      nx: nx[i] + (nx[i + 1] - nx[i]) * t, nz: nz[i] + (nz[i + 1] - nz[i]) * t,
      oR: outR[i] + (outR[i + 1] - outR[i]) * t, oL: outL[i] + (outL[i + 1] - outL[i]) * t,
    });
    const A = L(ta), B = L(tb);
    curbs.push(A.x, A.z, B.x, B.z, inner, Math.max(A.oR, A.oL, B.oR, B.oL));
    for (const side of [1, -1]) {
      const at = (p: typeof A, off: number) => { const x = p.x + p.nx * off * side, z = p.z + p.nz * off * side; return { x, z, g: hAt(x, z) }; };
      const ia = at(A, inner), ib = at(B, inner), oa = at(A, side > 0 ? A.oR : A.oL), ob = at(B, side > 0 ? B.oR : B.oL);
      // uv: (meters in from the curb, meters along) on top; -1 marks the granite curb face, -2 the outer edge.
      const top = (q: { x: number; z: number; g: number }, d: number, s: number) => { b.uv.push(d, s); return b.v(q.x, q.g + lift + curb, q.z); };
      const wR = (side > 0 ? A.oR : A.oL) - inner, wR1 = (side > 0 ? B.oR : B.oL) - inner;
      // Top (faces up), wound left-to-right across the direction of travel as in ribbon().
      const [l0, l1, r0, r1, dl0, dl1, dr0, dr1] = side > 0 ? [ia, ib, oa, ob, 0, 0, wR, wR1] : [oa, ob, ia, ib, wR, wR1, 0, 0];
      const vl0 = top(l0, dl0, a), vr0 = top(r0, dr0, a), vr1 = top(r1, dr1, c), vl1 = top(l1, dl1, c);
      b.tri(vl0, vr0, vr1); b.tri(vl0, vr1, vl1);
      // Curb face toward the road, and the outer edge down to the ground.
      const wall = (p: { x: number; z: number; g: number }, q: { x: number; z: number; g: number }, y0: number, faceRight: boolean, code: number) => {
        b.uv.push(code, a, code, c, code, c, code, a);
        const p0 = b.v(p.x, p.g + y0, p.z), q0 = b.v(q.x, q.g + y0, q.z), q1 = b.v(q.x, q.g + lift + curb, q.z), p1 = b.v(p.x, p.g + lift + curb, p.z);
        if (faceRight) b.quad(p0, q0, q1, p1); else b.quad(q0, p0, p1, q1);
      };
      wall(ia, ib, lift - 0.02, side < 0, -1);
      wall(oa, ob, 0, side > 0, -2);
    }
  }
}

/** Foam and shallow water along the real shoreline of a water polygon (tile-edge cuts are skipped). */
function shoreline(b: Buf, rings: number[][], level: number, size: number, strength: number) {
  const width = 4 + strength * 5;
  const edge = (v: number) => v < 0.05 || v > size - 0.05;
  rings.forEach((r, ri) => {
    const area = signedArea(r);
    // Water lies inside the outer ring and outside the holes; (-dz, dx) points out of a ring with area < 0.
    const inward = (area < 0) !== (ri > 0) ? -1 : 1;
    let u = 0;
    const n = r.length / 2;
    for (let q = 0; q < n; q++) {
      const p = (q + 1) % n;
      const ax = r[q * 2], az = r[q * 2 + 1], bx = r[p * 2], bz = r[p * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      if ((edge(ax) && edge(bx) && Math.abs(ax - bx) < 0.1) || (edge(az) && edge(bz) && Math.abs(az - bz) < 0.1)) { u += len; continue; }
      const ix = (-(bz - az) / len) * inward, iz = ((bx - ax) / len) * inward;
      const y = level + 0.035;
      const base = b.count;
      for (const [x, z, uu, vv] of [[ax, az, u, 0], [bx, bz, u + len, 0], [bx + ix * width, bz + iz * width, u + len, 1], [ax + ix * width, az + iz * width, u, 1]]) {
        b.v(x, y, z); b.nrm.push(0, 1, 0); b.uv.push(uu, vv); b.col.push(Math.round(strength * 255), 0, 0);
      }
      b.tri(base, base + 2, base + 1); b.tri(base, base + 3, base + 2);
      u += len;
    }
  });
}
