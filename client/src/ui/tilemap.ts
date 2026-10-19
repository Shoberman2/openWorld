// A small slippy-map renderer for OpenMapTiles vector tiles (and Sentinel-2 imagery), drawn to a 2D
// canvas in a light "Apple Maps" style. A worker fetches, parses and rasterizes tiles into bitmaps;
// each frame just composites them (rotated for the minimap) and places labels on top.
import { mercY, WORLD } from '../earth/frame.ts';
import { C, DATA_MAX, TILE, type Label } from './tilerender.ts';
import type { TileReq, TileRes } from './tilemap.worker.ts';

export type MapStyle = 'map' | 'satellite';

const SAT_MAX = 15;
const MAX_INFLIGHT = 6;

/** Global mercator coordinates in 0..1 (u east, v south). */
function uv(lat: number, lon: number) {
  return { u: (lon + 180) / 360, v: (WORLD / 2 - mercY(lat)) / WORLD };
}
function latLonOf(u: number, v: number) {
  const lon = u * 360 - 180;
  const my = WORLD / 2 - v * WORLD;
  return { lat: (2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2) * 180 / Math.PI, lon };
}
const wrapDu = (d: number) => d - Math.round(d);

class LRU<V> {
  private m = new Map<string, V>();
  constructor(private cap: number, private onEvict?: (v: V) => void) {}
  get(k: string) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  peek(k: string) { return this.m.get(k); }
  has(k: string) { return this.m.has(k); }
  set(k: string, v: V) {
    this.m.delete(k); this.m.set(k, v);
    while (this.m.size > this.cap) { const [ok, ov] = this.m.entries().next().value!; this.m.delete(ok); this.onEvict?.(ov); }
  }
}


export class TileMap {
  style: MapStyle;
  /** Draw place/water labels (the minimap turns these off). */
  labels = true;
  /** Labels per data tile (dz/x/y), sent by the worker with the first style tile it renders from it. */
  private data = new LRU<{ labels: Label[] }>(160);
  private rendered = new LRU<ImageBitmap>(160, (b) => b.close());
  private sat = new LRU<ImageBitmap | null>(160, (b) => b?.close());
  private satLoading = new Set<string>();
  private failed = new Map<string, number>();
  private worker: Worker | null = null;
  private inflight = new Map<string, number>(); // style key -> request id
  private byId = new Map<number, string>();
  private wanted: string[] = []; // style keys requested this frame, most important first
  private nextId = 1;
  private dirtyFlag = false;

  constructor(opts: { style?: MapStyle } = {}) {
    this.style = opts.style ?? 'map';
  }

  project(lat: number, lon: number, centerLat: number, centerLon: number, zoom: number) {
    const a = uv(lat, lon), c = uv(centerLat, centerLon);
    const s = TILE * 2 ** zoom;
    return { x: wrapDu(a.u - c.u) * s, y: (a.v - c.v) * s };
  }

  unproject(dx: number, dy: number, centerLat: number, centerLon: number, zoom: number) {
    const c = uv(centerLat, centerLon);
    const s = TILE * 2 ** zoom;
    let u = c.u + dx / s;
    u -= Math.floor(u);
    const v = Math.min(0.9999, Math.max(0.0001, c.v + dy / s));
    return latLonOf(u, v);
  }

  /** Nearest named place to a spot (for naming a dropped pin), from tiles already loaded. */
  nearestName(lat: number, lon: number, zoom: number): string | null {
    const c = uv(lat, lon);
    const dz = Math.max(0, Math.min(DATA_MAX, Math.round(zoom)));
    const n = 2 ** dz;
    let best: Label | null = null, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const t = this.data.peek(`${dz}/${(((Math.floor(c.u * n) + dx) % n) + n) % n}/${Math.floor(c.v * n) + dy}`);
      if (!t) continue;
      for (const l of t.labels) {
        if (l.kind !== 'place' && l.kind !== 'peak') continue;
        const d = Math.hypot(wrapDu(l.u - c.u), l.v - c.v);
        if (d < bd) { bd = d; best = l; }
      }
    }
    // Within ~6 tiles' worth of the spot at this zoom.
    return best && bd * n < 3 ? best.name : null;
  }

  // -------------------------------------------------------------- loading

  private ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./tilemap.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<TileRes>) => {
      const r = e.data;
      const key = this.byId.get(r.id);
      this.byId.delete(r.id);
      if (!key) { r.bitmap?.close(); return; }
      this.inflight.delete(key);
      if (r.labels) this.data.set(r.dataKey, { labels: r.labels });
      if (r.bitmap) this.rendered.set(key, r.bitmap);
      else if (r.error) this.failed.set(key, Date.now() + 15000);
      this.dirtyFlag = true;
      this.pump();
    };
    this.worker = w;
    return w;
  }

  /** Send the most-wanted missing tiles to the worker, a few at a time. */
  private pump() {
    const w = this.ensureWorker();
    for (const key of this.wanted) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      if (this.inflight.has(key) || this.rendered.has(key) || (this.failed.get(key) ?? 0) > Date.now()) continue;
      if (key.endsWith('@0') && this.data.has(key.slice(0, -2))) continue;
      const [zxy, pxs] = key.split('@');
      const [sz, x, y] = zxy.split('/').map(Number);
      const id = this.nextId++;
      this.inflight.set(key, id);
      this.byId.set(id, key);
      w.postMessage({ id, sz, x, y, dz: Math.min(sz, DATA_MAX), px: Number(pxs) } satisfies TileReq);
    }
  }

  /** True once since the last call if new tiles arrived (lets callers skip redundant redraws). */
  takeDirty() { const d = this.dirtyFlag; this.dirtyFlag = false; return d; }

  private loadSat(z: number, x: number, y: number) {
    const key = `${z}/${x}/${y}`;
    if (this.sat.has(key)) return this.sat.get(key) ?? null;
    if (!this.satLoading.has(key) && (this.failed.get(`s${key}`) ?? 0) < Date.now()) {
      this.satLoading.add(key);
      fetch(`/api/tiles/sat/${key}`)
        .then(async (res) => {
          if (res.status === 204) { this.sat.set(key, null); return; }
          if (!res.ok) throw new Error(String(res.status));
          this.sat.set(key, await createImageBitmap(await res.blob()));
        })
        .catch(() => this.failed.set(`s${key}`, Date.now() + 15000))
        .finally(() => this.satLoading.delete(key));
    }
    return undefined;
  }

  /** Rendered style tile at zoom sz (data from min(sz, 14)). undefined = not ready yet. */
  private styleTile(sz: number, x: number, y: number, px: number): ImageBitmap | undefined {
    const key = `${sz}/${x}/${y}@${px}`;
    const hit = this.rendered.get(key);
    if (!hit) this.wanted.push(key);
    return hit;
  }

  // -------------------------------------------------------------- drawing

  /**
   * Draw the map with (centerLat, centerLon) at canvas pixel (cx, cy) — canvas pixels, i.e. already
   * multiplied by dpr — at fractional `zoom`. `rotation` is the heading (radians, clockwise from north)
   * that should point up; 0 = north up. Returns false while tiles are still loading.
   */
  draw(g: CanvasRenderingContext2D, centerLat: number, centerLon: number, zoom: number, cx: number, cy: number, rotation = 0, dpr = 1): boolean {
    this.wanted.length = 0;
    const W = g.canvas.width, H = g.canvas.height;
    const sat = this.style === 'satellite';
    const sz = Math.max(0, Math.min(sat ? SAT_MAX : 19, Math.round(zoom)));
    const n = 2 ** sz;
    const scale = 2 ** (zoom - sz) * dpr; // CSS px per style-tile px, in canvas px
    const tilePx = TILE * scale;
    const px = Math.min(512, Math.max(256, Math.ceil(TILE * scale / 128) * 128));
    const c = uv(centerLat, centerLon);
    const fx = c.u * n, fy = c.v * n; // center in tile units at sz
    const radius = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) / tilePx + 1;
    let complete = true;

    g.save();
    g.fillStyle = sat ? '#20303a' : C.land;
    g.fillRect(0, 0, W, H);
    g.translate(cx, cy);
    g.rotate(-rotation);
    g.imageSmoothingEnabled = true;
    for (let ty = Math.floor(fy - radius); ty <= Math.floor(fy + radius); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let txr = Math.floor(fx - radius); txr <= Math.floor(fx + radius); txr++) {
        const tx = ((txr % n) + n) % n;
        const x0 = (txr - fx) * tilePx, y0 = (ty - fy) * tilePx;
        // Skip tiles outside the circle that covers the canvas.
        const mx = x0 + tilePx / 2, my = y0 + tilePx / 2;
        if (Math.hypot(mx, my) > (radius - 0.3) * tilePx + tilePx) continue;
        const ok = sat ? this.drawSat(g, sz, tx, ty, x0, y0, tilePx) : this.drawVec(g, sz, tx, ty, x0, y0, tilePx, px);
        if (!ok) complete = false;
      }
    }
    g.restore();

    if (this.labels) this.drawLabels(g, c.u, c.v, zoom, cx, cy, rotation, dpr, sat);
    // Nearest tiles first.
    const order = (k: string) => { const [zxy] = k.split('@'); const [, x, y] = zxy.split('/').map(Number); return Math.hypot(x + 0.5 - fx, y + 0.5 - fy); };
    this.wanted.sort((a, b) => order(a) - order(b));
    this.pump();
    return complete;
  }

  private drawVec(g: CanvasRenderingContext2D, sz: number, tx: number, ty: number, x0: number, y0: number, tilePx: number, px: number) {
    const t = this.styleTile(sz, tx, ty, px);
    const pad = 0.6;
    if (t) { g.drawImage(t, x0 - pad / 2, y0 - pad / 2, tilePx + pad, tilePx + pad); return true; }
    // Fall back to any rendered ancestor (or descendant-less blank).
    for (let up = 1; up <= 6 && sz - up >= 0; up++) {
      const f = 2 ** up;
      const ax = Math.floor(tx / f), ay = Math.floor(ty / f);
      let anc: ImageBitmap | undefined;
      for (const p of [512, 384, 256]) { anc = this.rendered.peek(`${sz - up}/${ax}/${ay}@${p}`); if (anc) break; }
      if (!anc) continue;
      const s = anc.width / f;
      g.drawImage(anc, (tx - ax * f) * s, (ty - ay * f) * s, s, s, x0 - pad / 2, y0 - pad / 2, tilePx + pad, tilePx + pad);
      return false;
    }
    return false;
  }

  private drawSat(g: CanvasRenderingContext2D, sz: number, tx: number, ty: number, x0: number, y0: number, tilePx: number) {
    const pad = 0.6;
    const b = this.loadSat(sz, tx, ty);
    if (b) { g.drawImage(b, x0 - pad / 2, y0 - pad / 2, tilePx + pad, tilePx + pad); return true; }
    if (b === null) { g.fillStyle = '#1d4f78'; g.fillRect(x0, y0, tilePx, tilePx); return true; }
    for (let up = 1; up <= 6 && sz - up >= 0; up++) {
      const f = 2 ** up;
      const ax = Math.floor(tx / f), ay = Math.floor(ty / f);
      const anc = this.sat.peek(`${sz - up}/${ax}/${ay}`);
      if (!anc) continue;
      const s = anc.width / f;
      g.drawImage(anc, (tx - ax * f) * s, (ty - ay * f) * s, s, s, x0 - pad / 2, y0 - pad / 2, tilePx + pad, tilePx + pad);
      return false;
    }
    return false;
  }

  private drawLabels(g: CanvasRenderingContext2D, cu: number, cv: number, zoom: number, cx: number, cy: number, rotation: number, dpr: number, sat: boolean) {
    const dz = Math.max(0, Math.min(DATA_MAX, Math.round(zoom)));
    const n = 2 ** dz;
    const W = g.canvas.width, H = g.canvas.height;
    const s = TILE * 2 ** zoom * dpr;
    const span = Math.ceil(Math.hypot(W, H) / 2 / (TILE * 2 ** (zoom - dz) * dpr)) + 1;
    const seen = new Set<string>();
    const list: { l: Label; x: number; y: number }[] = [];
    const cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
      const ty = Math.floor(cv * n) + dy;
      if (ty < 0 || ty >= n) continue;
      const tx = (((Math.floor(cu * n) + dx) % n) + n) % n;
      const t = this.data.peek(`${dz}/${tx}/${ty}`);
      if (!t) { if (sat && Math.abs(dx) <= span - 1 && Math.abs(dy) <= span - 1) this.wanted.push(`${dz}/${tx}/${ty}@0`); continue; }
      for (const l of t.labels) {
        if (zoom < l.minZ || zoom >= l.maxZ) continue;
        const k = `${l.name}|${l.kind}`;
        if (seen.has(k)) continue;
        const rx = wrapDu(l.u - cu) * s, ry = (l.v - cv) * s;
        const x = cx + rx * cos - ry * sin, y = cy + rx * sin + ry * cos;
        if (x < -100 || y < -40 || x > W + 100 || y > H + 40) continue;
        seen.add(k);
        list.push({ l, x, y });
      }
    }
    list.sort((a, b) => a.l.rank - b.l.rank);
    const boxes: number[][] = [];
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const { l, x, y } of list) {
      const big = l.cls === 'country' || l.cls === 'continent' || (l.cls === 'city' && l.rank <= 4);
      const size = (l.kind === 'water' ? 12 : big ? 14 : l.cls === 'city' || l.cls === 'state' ? 13 : l.cls === 'town' ? 12 : 11) * dpr;
      const weight = l.kind === 'water' ? 'italic 500' : big || l.cls === 'city' ? '700' : '600';
      g.font = `${weight} ${size}px Inter, -apple-system, sans-serif`;
      const text = l.cls === 'country' || l.cls === 'continent' || l.cls === 'state' ? l.name.toUpperCase() : l.name;
      const w = g.measureText(text).width;
      const box = [x - w / 2 - 4 * dpr, y - size / 2 - 3 * dpr, x + w / 2 + 4 * dpr, y + size / 2 + 3 * dpr];
      if (boxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      boxes.push(box);
      if (sat) {
        g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 4 * dpr;
        g.fillStyle = l.kind === 'water' ? '#cfe8ff' : '#ffffff';
        g.fillText(text, x, y);
        g.shadowBlur = 0;
      } else {
        g.strokeStyle = C.labelHalo; g.lineWidth = 3 * dpr;
        g.strokeText(text, x, y);
        g.fillStyle = l.kind === 'water' ? '#4a86b8' : l.kind === 'peak' ? '#6b5b45' : (l.cls === 'suburb' || l.cls === 'neighbourhood' || l.cls === 'quarter') ? '#7b7470' : C.label;
        g.fillText(text, x, y);
      }
      if (boxes.length > 60) break;
    }
    g.restore();
  }
}

