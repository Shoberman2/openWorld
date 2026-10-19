// Vector tile decoding (OpenMapTiles schema) into flat arrays, plus exact clipping to the tile square.
// Runs in the chunk worker. Coordinates stay in tile units (0..extent, y pointing south) until the
// builder scales them to meters.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export type Props = Record<string, string | number | boolean>;
/** One polygon: outer ring then holes, each a flat [x0,y0,x1,y1,...] without the closing point. */
export type Poly = number[][];
export interface PolyFeature { id: number; props: Props; polys: Poly[] }
export interface LineFeature { id: number; props: Props; lines: number[][] }
export interface PointFeature { id: number; props: Props; x: number; y: number }

export interface Layers {
  extent: number;
  /** How far features reach past the tile edge (the encoder's buffer), in tile units. */
  buffer: number;
  polys: Record<string, PolyFeature[]>;
  lines: Record<string, LineFeature[]>;
  points: Record<string, PointFeature[]>;
}

export function decodeTile(buf: ArrayBuffer): Layers {
  const t = new VectorTile(new Pbf(new Uint8Array(buf)));
  const out: Layers = { extent: 4096, buffer: 0, polys: {}, lines: {}, points: {} };
  let lo = 0, hi = 0;
  for (const [name, layer] of Object.entries(t.layers)) {
    out.extent = layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const geom = f.loadGeometry();
      const props = f.properties as Props;
      const id = typeof f.id === 'number' ? f.id : i;
      if (f.type === 1) {
        for (const ring of geom) for (const p of ring) (out.points[name] ??= []).push({ id, props, x: p.x, y: p.y });
        continue;
      }
      const flat = geom.map((ring) => {
        const a: number[] = [];
        for (const p of ring) {
          a.push(p.x, p.y);
          if (p.x < lo) lo = p.x; if (p.y < lo) lo = p.y;
          if (p.x > hi) hi = p.x; if (p.y > hi) hi = p.y;
        }
        return a;
      });
      if (f.type === 2) (out.lines[name] ??= []).push({ id, props, lines: flat });
      else if (f.type === 3) {
        const polys = classifyRings(flat.map(open));
        if (polys.length) (out.polys[name] ??= []).push({ id, props, polys });
      }
    }
  }
  out.buffer = Math.max(0, -lo, hi - out.extent);
  return out;
}

/** Drop a repeated closing point. */
function open(r: number[]) {
  const n = r.length;
  return n >= 4 && r[0] === r[n - 2] && r[1] === r[n - 1] ? r.slice(0, -2) : r;
}

/** Shoelace sum (tile coordinates, y down); its sign separates outer rings from holes. */
export function ringArea(r: number[]) {
  let s = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += (r[j] - r[i]) * (r[i + 1] + r[j + 1]);
  return s / 2;
}

/** MVT v2: the first ring's winding marks outer rings; the opposite winding marks holes of the last outer. */
function classifyRings(rings: number[][]): Poly[] {
  const polys: Poly[] = [];
  let cur: Poly | null = null;
  let outerNeg: boolean | undefined;
  for (const r of rings) {
    if (r.length < 6) continue;
    const a = ringArea(r);
    if (a === 0) continue;
    if (outerNeg === undefined) outerNeg = a < 0;
    if ((a < 0) === outerNeg) {
      if (cur) polys.push(cur);
      cur = [r];
    } else if (cur) cur.push(r);
  }
  if (cur) polys.push(cur);
  return polys;
}

/** Sutherland–Hodgman clip of a ring to the square [0, e]². */
export function clipRing(r: number[], e: number): number[] {
  let pts = r;
  const edges: [(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]][] = [
    [(x) => x >= 0, (ax, ay, bx, by) => [0, ay + ((0 - ax) * (by - ay)) / (bx - ax)]],
    [(x) => x <= e, (ax, ay, bx, by) => [e, ay + ((e - ax) * (by - ay)) / (bx - ax)]],
    [(_, y) => y >= 0, (ax, ay, bx, by) => [ax + ((0 - ay) * (bx - ax)) / (by - ay), 0]],
    [(_, y) => y <= e, (ax, ay, bx, by) => [ax + ((e - ay) * (bx - ax)) / (by - ay), e]],
  ];
  for (const [inside, cut] of edges) {
    const out: number[] = [];
    const n = pts.length;
    if (!n) break;
    for (let i = 0; i < n; i += 2) {
      const j = (i - 2 + n) % n;
      const ax = pts[j], ay = pts[j + 1], bx = pts[i], by = pts[i + 1];
      const ia = inside(ax, ay), ib = inside(bx, by);
      if (ib) {
        if (!ia) out.push(...cut(ax, ay, bx, by));
        out.push(bx, by);
      } else if (ia) out.push(...cut(ax, ay, bx, by));
    }
    pts = out;
  }
  return pts.length >= 6 ? pts : [];
}

/** Clip a polyline to the square [0, e]², splitting it where it leaves and re-enters. */
export function clipLine(l: number[], e: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  const flush = () => { if (cur.length >= 4) out.push(cur); cur = []; };
  for (let i = 0; i + 3 < l.length; i += 2) {
    let ax = l[i], ay = l[i + 1], bx = l[i + 2], by = l[i + 3];
    // Liang–Barsky.
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    let ok = true;
    for (const [p, q] of [[-dx, ax], [dx, e - ax], [-dy, ay], [dy, e - ay]] as const) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { flush(); continue; }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1;
    if (t0 > 0) flush();
    if (!cur.length) cur.push(sx, sy);
    cur.push(ex, ey);
    if (t1 < 1) flush();
    ax = bx; ay = by;
  }
  flush();
  return out;
}

export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown) => (typeof v === 'string' ? v : '');
