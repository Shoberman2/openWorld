// Map tile worker: fetches and parses vector tiles and rasterizes style tiles off the main thread.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { extractLabels, parseTile, renderTile, type Label, type Parsed } from './tilerender.ts';

export interface TileReq { id: number; sz: number; x: number; y: number; dz: number; px: number }
export interface TileRes { id: number; bitmap: ImageBitmap | null; dataKey: string; labels: Label[] | null; error?: string }

const data = new Map<string, Promise<{ parsed: Parsed | null; labels: Label[] }>>();
const sentLabels = new Set<string>();

function load(dz: number, x: number, y: number) {
  const key = `${dz}/${x}/${y}`;
  let p = data.get(key);
  if (p) { data.delete(key); data.set(key, p); return p; }
  p = fetch(`/api/tiles/v/${key}`).then(async (res) => {
    if (res.status === 204) return { parsed: null, labels: [] };
    if (!res.ok) throw new Error(`tile ${key}: ${res.status}`);
    const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    return { parsed: parseTile(vt), labels: extractLabels(vt, dz, x, y) };
  });
  p.catch(() => data.delete(key));
  data.set(key, p);
  while (data.size > 48) data.delete(data.keys().next().value!);
  return p;
}

self.onmessage = async (e: MessageEvent<TileReq>) => {
  const r = e.data;
  const f = 2 ** (r.sz - r.dz);
  const dx = Math.floor(r.x / f), dy = Math.floor(r.y / f);
  const dataKey = `${r.dz}/${dx}/${dy}`;
  try {
    const d = await load(r.dz, dx, dy);
    if (r.px === 0) {
      // Labels only (satellite view draws imagery, but still wants place names).
      sentLabels.add(dataKey);
      (self as unknown as Worker).postMessage({ id: r.id, bitmap: null, dataKey, labels: d.labels } satisfies TileRes);
      return;
    }
    const cv = new OffscreenCanvas(r.px, r.px);
    renderTile(d.parsed, r.sz, r.x, r.y, r.dz, r.px, cv);
    const bitmap = cv.transferToImageBitmap();
    const labels = sentLabels.has(dataKey) ? null : d.labels;
    sentLabels.add(dataKey);
    if (sentLabels.size > 4000) sentLabels.clear();
    (self as unknown as Worker).postMessage({ id: r.id, bitmap, dataKey, labels } satisfies TileRes, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: r.id, bitmap: null, dataKey, labels: null, error: String((err as Error).message) } satisfies TileRes);
  }
};
