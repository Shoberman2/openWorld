// Shared by the map renderer and its worker: the light map style, vector-tile parsing, and
// rasterizing one style tile (and its labels) into a canvas.
import type { VectorTile, VectorTileLayer } from '@mapbox/vector-tile';
import { WORLD } from '../earth/frame.ts';

export const DATA_MAX = 14; // vector tiles stop here; deeper zooms render a piece of the z14 tile
export const TILE = 256; // logical tile size in CSS px

// ------------------------------------------------------------------ style

export const C = {
  land: '#f3efe8',
  water: '#a6d3f2',
  waterLine: '#8cc3ea',
  park: '#c9e4b1',
  wood: '#c2deaa',
  grass: '#d6eac2',
  sand: '#f2e7c7',
  ice: '#ffffff',
  rock: '#e6e2db',
  farm: '#eef0dd',
  residential: '#efeae2',
  commercial: '#f2e6e3',
  industrial: '#ebe6ee',
  school: '#f3ebd6',
  hospital: '#f6dfdf',
  cemetery: '#d6e6cc',
  pitch: '#bde2a6',
  building: '#e1dbd1',
  buildingEdge: '#d2cabd',
  minor: '#ffffff',
  casing: '#d9d2c6',
  major: '#ffffff',
  primary: '#fbe08a',
  primaryCase: '#e8c264',
  motorway: '#f9bd5a',
  motorwayCase: '#e09b35',
  path: '#d4cbbd',
  rail: '#b7b0a6',
  boundary: '#a49cb8',
  label: '#3a3a3c',
  labelHalo: 'rgba(255,255,255,0.9)',
};

const LANDCOVER: Record<string, string> = { wood: C.wood, forest: C.wood, grass: C.grass, wetland: C.grass, sand: C.sand, ice: C.ice, rock: C.rock, farmland: C.farm };
const LANDUSE: Record<string, string> = {
  residential: C.residential, suburb: C.residential, neighbourhood: C.residential, commercial: C.commercial, retail: C.commercial,
  industrial: C.industrial, railway: C.industrial, quarry: C.rock, school: C.school, university: C.school, college: C.school, kindergarten: C.school,
  hospital: C.hospital, cemetery: C.cemetery, pitch: C.pitch, playground: C.pitch, stadium: C.pitch, track: C.pitch, zoo: C.park,
  garden: C.park, park: C.park, theme_park: C.park, military: C.industrial, bus_station: C.commercial,
};

interface RoadStyle { minZ: number; meters: number; minPx: number; fill: string; casing: string }
const ROADS: Record<string, RoadStyle> = {
  motorway: { minZ: 5, meters: 22, minPx: 1.6, fill: C.motorway, casing: C.motorwayCase },
  trunk: { minZ: 6, meters: 20, minPx: 1.4, fill: C.motorway, casing: C.motorwayCase },
  primary: { minZ: 8, meters: 16, minPx: 1.2, fill: C.primary, casing: C.primaryCase },
  secondary: { minZ: 9, meters: 14, minPx: 1.1, fill: C.major, casing: C.casing },
  tertiary: { minZ: 10, meters: 12, minPx: 1, fill: C.major, casing: C.casing },
  minor: { minZ: 12, meters: 9, minPx: 0.8, fill: C.minor, casing: C.casing },
  busway: { minZ: 12, meters: 9, minPx: 0.8, fill: C.minor, casing: C.casing },
  raceway: { minZ: 12, meters: 9, minPx: 0.8, fill: C.minor, casing: C.casing },
  service: { minZ: 14, meters: 5, minPx: 0.6, fill: C.minor, casing: C.casing },
  track: { minZ: 14, meters: 3, minPx: 0.6, fill: C.minor, casing: C.casing },
};
const ROAD_ORDER = ['track', 'service', 'minor', 'busway', 'raceway', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];

/** Meters per CSS pixel at zoom z (at the tile's latitude). */
const mpp = (z: number, lat: number) => (WORLD * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);

// ------------------------------------------------------------------ tiles
export interface Label { name: string; u: number; v: number; rank: number; kind: 'place' | 'water' | 'peak'; cls: string; minZ: number; maxZ: number }

/** Which place classes show at which zoom, and how big. */
function placeZooms(cls: string, rank: number): [number, number] {
  switch (cls) {
    case 'continent': return [0, 3];
    case 'country': return [rank <= 2 ? 2 : 3, 7];
    case 'state': case 'province': return [5, 8];
    case 'city': return [rank <= 3 ? 4 : rank <= 6 ? 6 : 8, 13];
    case 'town': return [9, 14];
    case 'village': return [11, 15];
    case 'suburb': case 'quarter': return [12, 16];
    case 'neighbourhood': return [14, 19];
    case 'island': return [10, 15];
    default: return [13, 17];
  }
}

// ------------------------------------------------------------------ tile rendering

export function extractLabels(vt: VectorTile, z: number, x: number, y: number): Label[] {
  const out: Label[] = [];
  const n = 2 ** z;
  const add = (layer: VectorTileLayer | undefined, kind: Label['kind']) => {
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties;
      const name = (p['name:en'] || p.name_en || p.name) as string | undefined;
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      // Point labels (or the first vertex of a line/polygon label anchor).
      let gx = 0, gy = 0, k = 0;
      for (const pt of geom[0]) { gx += pt.x; gy += pt.y; k++; }
      gx /= k; gy /= k;
      if (gx < 0 || gy < 0 || gx > layer.extent || gy > layer.extent) continue;
      const cls = String(p.class ?? '');
      const rank = Number(p.rank ?? 10);
      let [minZ, maxZ] = kind === 'place' ? placeZooms(cls, rank) : kind === 'water' ? [cls === 'ocean' ? 0 : cls === 'sea' || cls === 'bay' ? 5 : 11, 19] : [12, 19];
      if (kind === 'place' && cls === 'city' && z >= 10) minZ = Math.min(minZ, 10);
      out.push({ name, u: (x + gx / layer.extent) / n, v: (y + gy / layer.extent) / n, rank: (kind === 'place' ? 0 : 20) + rank + (cls === 'country' ? -10 : cls === 'city' ? -5 : 0), kind, cls, minZ, maxZ });
    }
  };
  add(vt.layers.place, 'place');
  add(vt.layers.water_name, 'water');
  add(vt.layers.mountain_peak, 'peak');
  return out;
}

// Parsed once per data tile: geometry as flat number arrays with bounding boxes, grouped by what we draw.
type Geo = { rings: number[][]; bb: [number, number, number, number] };
export interface Parsed {
  ext: number;
  fills: (Geo & { color: string })[];
  waterways: (Geo & { cls: string })[];
  buildings: Geo[];
  boundaries: (Geo & { lvl: number })[];
  paths: Geo[];
  rails: Geo[];
  roads: (Geo & { cls: string; tunnel: boolean; bridge: boolean })[];
}

function geoOf(f: { loadGeometry(): { x: number; y: number }[][] }): Geo {
  const rings: number[][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of f.loadGeometry()) {
    const a: number[] = new Array(r.length * 2);
    for (let i = 0; i < r.length; i++) {
      const x = r[i].x, y = r[i].y;
      a[i * 2] = x; a[i * 2 + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    rings.push(a);
  }
  return { rings, bb: [x0, y0, x1, y1] };
}

export function parseTile(vt: VectorTile): Parsed {
  const ext = (Object.values(vt.layers)[0] as VectorTileLayer | undefined)?.extent ?? 4096;
  const p: Parsed = { ext, fills: [], waterways: [], buildings: [], boundaries: [], paths: [], rails: [], roads: [] };
  const each = (name: string, fn: (props: Record<string, unknown>, type: number, f: { loadGeometry(): { x: number; y: number }[][] }) => void) => {
    const L = vt.layers[name];
    if (!L) return;
    for (let i = 0; i < L.length; i++) { const f = L.feature(i); fn(f.properties, f.type, f); }
  };
  const fill = (name: string, color: (pr: Record<string, unknown>) => string | null) => each(name, (pr, type, f) => {
    if (type !== 3) return;
    const c = color(pr);
    if (c) p.fills.push({ ...geoOf(f), color: c });
  });
  fill('landcover', (pr) => LANDCOVER[String(pr.class)] ?? (pr.subclass === 'park' || pr.subclass === 'garden' ? C.park : null));
  fill('landuse', (pr) => LANDUSE[String(pr.class)] ?? null);
  fill('park', () => C.park);
  fill('water', () => C.water);
  each('waterway', (pr, type, f) => { if (type === 2 && pr.brunnel !== 'tunnel') p.waterways.push({ ...geoOf(f), cls: String(pr.class) }); });
  each('building', (pr, type, f) => { if (type === 3 && !pr.hide_3d) p.buildings.push(geoOf(f)); });
  each('boundary', (pr, type, f) => { if (type === 2 && !pr.maritime) p.boundaries.push({ ...geoOf(f), lvl: Number(pr.admin_level) }); });
  each('transportation', (pr, type, f) => {
    if (type !== 2) return;
    const cls = String(pr.class);
    if (cls === 'path') p.paths.push(geoOf(f));
    else if (cls === 'rail' || cls === 'transit') { if (pr.brunnel !== 'tunnel') p.rails.push(geoOf(f)); }
    else if (ROADS[cls]) p.roads.push({ ...geoOf(f), cls, tunnel: pr.brunnel === 'tunnel', bridge: pr.brunnel === 'bridge' });
  });
  return p;
}

/**
 * Render style tile (sz, x, y) from a parsed data tile at dz (dz <= sz) into a px-sized canvas.
 * When sz > dz, only the matching sub-square of the data tile is drawn, magnified.
 */
export function renderTile(pt: Parsed | null, sz: number, x: number, y: number, dz: number, px: number, cv: OffscreenCanvas | HTMLCanvasElement) {
  cv.width = cv.height = px;
  const g = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  if (!pt) { g.fillStyle = sz < 6 ? C.water : C.land; g.fillRect(0, 0, px, px); return cv; }
  const f = 2 ** (sz - dz);
  const ox = x - Math.floor(x / f) * f, oy = y - Math.floor(y / f) * f;
  const ext = pt.ext;
  const k = (px * f) / ext; // canvas px per tile unit
  const offX = -ox * px, offY = -oy * px;
  // Visible window in tile units (with a margin for line widths).
  const span = ext / f, m = span * 0.08;
  const vx0 = ox * span - m, vy0 = oy * span - m, vx1 = (ox + 1) * span + m, vy1 = (oy + 1) * span + m;
  const vis = (bb: number[]) => bb[2] >= vx0 && bb[0] <= vx1 && bb[3] >= vy0 && bb[1] <= vy1;
  const n = 2 ** sz;
  const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (y + 0.5)) / n))) - Math.PI / 2) * 180 / Math.PI;
  const pxPerCss = px / TILE;
  const metersPerPx = mpp(sz, lat) / pxPerCss; // meters per canvas px

  g.fillStyle = C.land;
  g.fillRect(0, 0, px, px);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const path = (geo: Geo, close: boolean) => {
    g.beginPath();
    for (const r of geo.rings) {
      g.moveTo(r[0] * k + offX, r[1] * k + offY);
      for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k + offX, r[i + 1] * k + offY);
      if (close) g.closePath();
    }
  };

  for (const a of pt.fills) {
    if (!vis(a.bb)) continue;
    g.fillStyle = a.color;
    path(a, true);
    g.fill('evenodd');
  }

  // Rivers and streams.
  if (sz >= 8) {
    g.strokeStyle = C.water;
    for (const w of pt.waterways) {
      if ((w.cls !== 'river' && sz < 13) || !vis(w.bb)) continue;
      const mw = w.cls === 'river' ? 30 : w.cls === 'canal' ? 15 : 4;
      g.lineWidth = Math.max(w.cls === 'river' ? 1.2 : 0.6, mw / metersPerPx);
      path(w, false);
      g.stroke();
    }
  }

  // Buildings.
  if (sz >= 14) {
    g.fillStyle = C.building;
    g.strokeStyle = C.buildingEdge;
    g.lineWidth = Math.max(0.5, px / 512);
    for (const b of pt.buildings) {
      if (!vis(b.bb)) continue;
      path(b, true);
      g.fill('evenodd');
      if (sz >= 15) g.stroke();
    }
  }

  // Admin boundaries at low zoom.
  if (sz <= 10) {
    g.setLineDash([4 * pxPerCss, 3 * pxPerCss]);
    g.strokeStyle = C.boundary;
    for (const b of pt.boundaries) {
      if (b.lvl > (sz < 5 ? 2 : 4) || !vis(b.bb)) continue;
      g.lineWidth = (b.lvl <= 2 ? 1.2 : 0.7) * pxPerCss;
      path(b, false);
      g.stroke();
    }
    g.setLineDash([]);
  }

  // Roads: paths, rail, then casings and fills from small to big.
  if (sz >= 15) {
    g.strokeStyle = C.path;
    g.lineWidth = Math.max(0.8 * pxPerCss, 2 / metersPerPx);
    g.setLineDash([3 * pxPerCss, 2 * pxPerCss]);
    for (const p of pt.paths) if (vis(p.bb)) { path(p, false); g.stroke(); }
    g.setLineDash([]);
  }
  if (sz >= 11) {
    g.strokeStyle = C.rail;
    g.lineWidth = Math.max(0.8, 1.2 * pxPerCss);
    for (const p of pt.rails) if (vis(p.bb)) { path(p, false); g.stroke(); }
  }
  const width = (st: RoadStyle) => Math.max(st.minPx * pxPerCss, st.meters / metersPerPx);
  const roads = pt.roads.filter((r) => sz >= ROADS[r.cls].minZ && vis(r.bb));
  const order = (cls: string) => ROAD_ORDER.indexOf(cls);
  roads.sort((a, b) => order(a.cls) - order(b.cls));
  for (const layer of ['tunnel', 'ground', 'bridge'] as const) {
    const list = roads.filter((r) => (layer === 'tunnel') === r.tunnel && (layer === 'bridge') === r.bridge);
    // Casings first, then fills, so junctions merge cleanly.
    for (const pass of ['case', 'fill'] as const) {
      for (const r of list) {
        const st = ROADS[r.cls];
        const w = width(st);
        if (pass === 'case') {
          if (sz < 11 && r.cls !== 'motorway' && r.cls !== 'trunk' && r.cls !== 'primary') continue;
          g.strokeStyle = st.casing;
          g.lineWidth = w + Math.max(1, w * 0.25);
        } else {
          g.strokeStyle = st.fill;
          g.lineWidth = w;
        }
        g.globalAlpha = r.tunnel ? 0.45 : 1;
        path(r, false);
        g.stroke();
      }
    }
  }
  g.globalAlpha = 1;
  return cv;
}
