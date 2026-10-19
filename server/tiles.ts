// Map tiles for the streaming world, proxied and cached on disk so a place loads instantly the second time.
//   /api/tiles/v/:z/:x/:y    OpenMapTiles vector tiles (OpenFreeMap, © OpenStreetMap contributors), z0-14, .pbf
//   /api/tiles/dem/:z/:x/:y  Terrain elevation (Mapterhorn, terrarium RGB encoding, 512 px .webp; AWS terrain tiles fallback)
//   /api/tiles/sat/:z/:x/:y  Sentinel-2 cloudless 2016 imagery (EOX, CC BY 4.0), 256 px .jpg
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Express, Request, Response } from 'express';
import { PATHS } from './config.ts';

const UA = 'OpenWorldHQ/0.1 (local open-world game)';
const DIR = join(PATHS.cache, 'tiles');

interface Source {
  dir: string;
  maxZ: number;
  type: string;
  urls(z: number, x: number, y: number): Promise<string[]>;
  /** Content type when the fallback URL answers instead. */
  fallbackType?: string;
}

let ofmTiles: { url: string; at: number } | null = null;
/** OpenFreeMap publishes dated planet builds; the TileJSON says which one is current. */
async function openFreeMapTemplate() {
  if (ofmTiles && Date.now() - ofmTiles.at < 6 * 3600_000) return ofmTiles.url;
  try {
    const res = await fetch('https://tiles.openfreemap.org/planet', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    const tj = (await res.json()) as { tiles?: string[] };
    if (tj.tiles?.[0]) ofmTiles = { url: tj.tiles[0], at: Date.now() };
  } catch { /* keep the old one */ }
  return ofmTiles?.url ?? 'https://tiles.openfreemap.org/planet/20261011_080001_pt/{z}/{x}/{y}.pbf';
}

const SOURCES: Record<string, Source> = {
  v: {
    dir: 'v', maxZ: 14, type: 'application/x-protobuf',
    async urls(z, x, y) { return [(await openFreeMapTemplate()).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))]; },
  },
  dem: {
    dir: 'dem', maxZ: 14, type: 'image/webp', fallbackType: 'image/png',
    async urls(z, x, y) {
      return [`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`];
    },
  },
  sat: {
    dir: 'sat', maxZ: 15, type: 'image/jpeg',
    async urls(z, x, y) { return [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`]; },
  },
};

const inflight = new Map<string, Promise<{ body: Buffer; type: string } | null>>();
/**
 * A few upstream requests at a time per source (be a polite client of free tile servers), with
 * separate lanes so a burst of distant imagery never delays the map data you're standing on.
 */
const LANES: Record<string, { max: number; active: number; queue: (() => void)[] }> = {
  v: { max: 6, active: 0, queue: [] }, dem: { max: 4, active: 0, queue: [] }, sat: { max: 4, active: 0, queue: [] },
  // Background warming of tiles next to the ones you asked for: never more than two at a time.
  pre: { max: 2, active: 0, queue: [] },
};
async function slot<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  const l = LANES[kind];
  if (l.active >= l.max) await new Promise<void>((r) => l.queue.push(r));
  l.active++;
  try { return await fn(); } finally { l.active--; l.queue.shift()?.(); }
}

async function getTile(kind: string, z: number, x: number, y: number, lane = kind) {
  const src = SOURCES[kind];
  const file = join(DIR, src.dir, String(z), String(x), `${y}`);
  for (const [ext, type] of [['', src.type], ['.alt', src.fallbackType ?? src.type]] as const) {
    if (existsSync(file + ext)) {
      // Touch on use, so the cache trims the places you haven't been to in a while first.
      try { const now = new Date(); utimesSync(file + ext, now, now); } catch { /* read-only is fine */ }
      return { body: readFileSync(file + ext), type };
    }
  }
  if (existsSync(`${file}.none`)) return null;
  const key = `${kind}/${z}/${x}/${y}`;
  let p = inflight.get(key);
  if (!p) {
    p = slot(lane, async () => {
      const urls = await src.urls(z, x, y);
      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
          if (res.status === 404 || res.status === 204) continue;
          if (!res.ok) throw new Error(`${res.status}`);
          const body = Buffer.from(await res.arrayBuffer());
          const ext = i === 0 ? '' : '.alt';
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(`${file}${ext}.tmp`, body);
          renameSync(`${file}${ext}.tmp`, file + ext);
          noteWrite(body.length);
          return { body, type: i === 0 ? src.type : src.fallbackType ?? src.type };
        } catch (e) {
          if (i === urls.length - 1) throw e;
        }
      }
      // Nothing there (open ocean, beyond the data): remember, so we don't ask again.
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.none`, '');
      return null;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

// ---------- cache size cap ----------

const CAP = (Number(process.env.OPENWORLD_TILE_CACHE_MB) || 3000) * 1024 * 1024;
let cacheBytes = -1;
let sinceTrim = 0;
function walk(dir: string, out: { f: string; size: number; t: number }[]) {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = join(dir, n);
    try {
      const st = statSync(f);
      if (st.isDirectory()) walk(f, out); else out.push({ f, size: st.size, t: st.mtimeMs });
    } catch { /* raced with a write */ }
  }
  return out;
}
/** Keep the tile cache under the cap (default 3 GB): drop the least recently used tiles down to 80%. */
function noteWrite(n: number) {
  sinceTrim += n;
  if (cacheBytes < 0 || sinceTrim > 64 * 1024 * 1024) {
    sinceTrim = 0;
    const files = walk(DIR, []);
    cacheBytes = files.reduce((a, b) => a + b.size, 0);
    if (cacheBytes <= CAP) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) {
      if (cacheBytes <= CAP * 0.8) break;
      try { unlinkSync(f.f); cacheBytes -= f.size; } catch { /* gone */ }
    }
    console.log(`[tiles] cache trimmed to ${Math.round(cacheBytes / 1048576)} MB`);
  } else cacheBytes += n;
}

/** Warm the neighbors of a map tile in the background, so walking or flying into them is instant. */
const warmed = new Set<string>();
function warmAround(z: number, x: number, y: number) {
  const k = `${z}/${x}/${y}`;
  if (warmed.has(k)) return;
  warmed.add(k);
  if (warmed.size > 5000) warmed.clear();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const n = 2 ** z;
    if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= n || y + dy >= n) continue;
    getTile('v', z, x + dx, y + dy, 'pre').catch(() => {});
  }
  getTile('dem', z - 1, x >> 1, y >> 1, 'pre').catch(() => {});
}

export function registerTiles(app: Express) {
  app.get('/api/tiles/:kind/:z/:x/:y', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    const z = Number(req.params.z), x = Number(req.params.x), y = Number(String(req.params.y).replace(/\.\w+$/, ''));
    const src = SOURCES[kind];
    const n = 2 ** z;
    if (!src || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > src.maxZ || x < 0 || y < 0 || x >= n || y >= n) {
      res.status(400).json({ error: 'bad tile' });
      return;
    }
    try {
      const t = await getTile(kind, z, x, y);
      if (kind === 'v' && z === 14) warmAround(z, x, y);
      if (!t) { res.status(204).end(); return; }
      res.setHeader('Content-Type', t.type);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.end(t.body);
    } catch (e) {
      res.status(502).json({ error: `tile upstream failed: ${(e as Error).message}` });
    }
  });
}
