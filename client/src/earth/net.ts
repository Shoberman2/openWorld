// The road network of every loaded chunk, joined across tile edges by shared node keys. Chunks add
// and remove their edges as they stream in and out; cars and people walk whatever is loaded.
import type { EdgeData, SignalData } from './build/types.ts';

export interface NNode {
  id: number; key: string;
  x: number; z: number; y: number;
  edges: NEdge[];
  signal: boolean; phase: number; ref: number;
  maxW: number;
}
export interface NEdge {
  id: number;
  a: NNode; b: NNode;
  pts: number[]; ys: number[]; cum: number[]; len: number;
  width: number; lanesF: number; lanesB: number;
  cls: string; name: string | null;
  bridge: boolean; drive: boolean; walk: boolean;
  owner: string;
  alive: boolean;
}

export class RoadNet {
  nodes = new Map<string, NNode>();
  private byOwner = new Map<string, NEdge[]>();
  private nid = 1;
  private eid = 1;
  version = 0;
  private cache = { v: -1, drive: [] as NEdge[], walk: [] as NEdge[] };

  add(owner: string, list: EdgeData[], x0: number, z0: number, signals: SignalData[]) {
    this.remove(owner);
    const mine: NEdge[] = [];
    const node = (key: string, x: number, z: number, y: number) => {
      let n = this.nodes.get(key);
      if (!n) this.nodes.set(key, (n = { id: this.nid++, key, x, z, y, edges: [], signal: false, phase: 0, ref: 0, maxW: 0 }));
      return n;
    };
    for (const d of list) {
      const pts = d.pts.map((v, i) => v + (i % 2 ? z0 : x0));
      const m = pts.length;
      const a = node(d.a, pts[0], pts[1], d.ys[0]), b = node(d.b, pts[m - 2], pts[m - 1], d.ys[d.ys.length - 1]);
      const cum = [0];
      for (let i = 2; i < m; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
      const e: NEdge = { id: this.eid++, a, b, pts, ys: d.ys, cum, len: cum[cum.length - 1], width: d.width, lanesF: d.lanesF, lanesB: d.lanesB, cls: d.cls, name: d.name, bridge: d.bridge, drive: d.drive, walk: d.walk, owner, alive: true };
      a.edges.push(e); b.edges.push(e);
      if (e.drive) { a.maxW = Math.max(a.maxW, e.width); b.maxW = Math.max(b.maxW, e.width); }
      mine.push(e);
    }
    for (const sg of signals) {
      const n = this.nodes.get(sg.key);
      if (n) { n.signal = true; n.phase = sg.phase; n.ref = sg.ref; }
    }
    this.byOwner.set(owner, mine);
    this.version++;
  }

  remove(owner: string) {
    const list = this.byOwner.get(owner);
    if (!list) return;
    for (const e of list) {
      e.alive = false;
      for (const n of [e.a, e.b]) {
        n.edges = n.edges.filter((x) => x !== e);
        if (!n.edges.length) this.nodes.delete(n.key);
      }
    }
    this.byOwner.delete(owner);
    this.version++;
  }

  private refresh() {
    if (this.cache.v === this.version) return;
    const drive: NEdge[] = [], walk: NEdge[] = [];
    for (const list of this.byOwner.values()) for (const e of list) {
      if (e.drive && e.lanesF + e.lanesB > 0 && e.cls !== 'service') drive.push(e);
      if (e.walk) walk.push(e);
    }
    this.cache = { v: this.version, drive, walk };
  }
  get drive() { this.refresh(); return this.cache.drive; }
  get walk() { this.refresh(); return this.cache.walk; }

  private grid = { v: -1, cells: new Map<string, NEdge[]>() };
  /** Edges with a point within ~r of (x, z), from a 150 m grid rebuilt when the network changes. */
  near(x: number, z: number, r: number, kind: 'drive' | 'walk'): NEdge[] {
    const C = 150;
    if (this.grid.v !== this.version) {
      const cells = new Map<string, NEdge[]>();
      for (const list of this.byOwner.values()) for (const e of list) {
        const seen = new Set<string>();
        for (let i = 0; i < e.pts.length; i += 2) {
          const k = `${Math.floor(e.pts[i] / C)},${Math.floor(e.pts[i + 1] / C)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          let l = cells.get(k);
          if (!l) cells.set(k, (l = []));
          l.push(e);
        }
      }
      this.grid = { v: this.version, cells };
    }
    const out = new Set<NEdge>();
    const R = Math.ceil(r / C);
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const l = this.grid.cells.get(`${ci + i},${cj + j}`);
      if (l) for (const e of l) if (kind === 'drive' ? e.drive && e.lanesF + e.lanesB > 0 && e.cls !== 'service' : e.walk) out.add(e);
    }
    return [...out];
  }
}

/** Point, tangent and surface y at distance s along an edge (from a). */
export function along(e: NEdge, s: number, out: { x: number; z: number; y: number; tx: number; tz: number }) {
  s = Math.max(0, Math.min(e.len, s));
  let k = 1;
  const c = e.cum;
  // Binary search: edges can have dozens of points after draping.
  let lo = 1, hi = c.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < s) lo = mid + 1; else hi = mid; }
  k = lo;
  const s0 = c[k - 1], s1 = c[k];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const ax = e.pts[(k - 1) * 2], az = e.pts[(k - 1) * 2 + 1], bx = e.pts[k * 2], bz = e.pts[k * 2 + 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.x = ax + (bx - ax) * f; out.z = az + (bz - az) * f;
  out.y = e.ys[k - 1] + (e.ys[k] - e.ys[k - 1]) * f;
  out.tx = (bx - ax) / l; out.tz = (bz - az) / l;
  return out;
}

export function leaving(e: NEdge, n: NNode) {
  const p = e.pts;
  if (e.a === n) { const l = Math.hypot(p[2] - p[0], p[3] - p[1]) || 1; return { x: (p[2] - p[0]) / l, z: (p[3] - p[1]) / l }; }
  const m = p.length;
  const l = Math.hypot(p[m - 4] - p[m - 2], p[m - 3] - p[m - 1]) || 1;
  return { x: (p[m - 4] - p[m - 2]) / l, z: (p[m - 3] - p[m - 1]) / l };
}

export function approachGroup(n: NNode, e: NEdge) {
  const d = leaving(e, n);
  let a = Math.atan2(d.z, d.x) - n.ref;
  a = ((a % Math.PI) + Math.PI) % Math.PI;
  return a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1;
}

export const SIGNAL_CYCLE = 30;
export function signalState(phase: number, group: number, t: number): 'g' | 'y' | 'r' {
  const c = (((t + phase) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const g0 = c < 12 ? 'g' : c < 14.5 ? 'y' : 'r';
  const g1 = c >= 15 && c < 27 ? 'g' : c >= 27 && c < 29.5 ? 'y' : 'r';
  return group === 0 ? g0 : g1;
}
