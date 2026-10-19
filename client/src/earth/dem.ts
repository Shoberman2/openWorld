// Terrain elevation from terrarium-encoded tiles (Mapterhorn / AWS), sampled in Web Mercator meters.
// Runs in the chunk worker. Decoded tiles are cached; sampling is bilinear and seamless across tiles.
import { WORLD } from './frame.ts';

const cache = new Map<string, Promise<{ size: number; h: Float32Array } | null>>();
const ORDER: string[] = [];

async function decode(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const size = bmp.width;
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0, k = 0; i < h.length; i++, k += 4) h[i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
  return { size, h };
}

function tile(z: number, x: number, y: number) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/tiles/dem/${key}`)
      .then(async (r) => (r.status === 200 ? decode(await r.blob()) : null))
      .catch(() => null);
    cache.set(key, p);
    ORDER.push(key);
    if (ORDER.length > 48) cache.delete(ORDER.shift()!);
  }
  return p;
}

/** A height sampler over a mercator rectangle, ready once the covering DEM tiles are loaded. */
export interface Dem { at(mx: number, my: number): number }

/**
 * Load the zoom-`z` DEM tiles covering the mercator box (with a margin) and return a sampler.
 * Heights are smoothed with a small cross filter: it hides survey noise and the odd bump without
 * flattening hills.
 */
export async function demFor(z: number, mxMin: number, myMin: number, mxMax: number, myMax: number, smooth = 1.2): Promise<Dem> {
  const n = 2 ** z, ts = WORLD / n;
  const tx0 = Math.floor((mxMin + WORLD / 2) / ts - 0.05), tx1 = Math.floor((mxMax + WORLD / 2) / ts + 0.05);
  const ty0 = Math.floor((WORLD / 2 - myMax) / ts - 0.05), ty1 = Math.floor((WORLD / 2 - myMin) / ts + 0.05);
  const tiles = new Map<string, { size: number; h: Float32Array } | null>();
  await Promise.all(
    [...range(tx0, tx1)].flatMap((x) => [...range(ty0, ty1)].map(async (y) => tiles.set(`${x},${y}`, await tile(z, x, y)))),
  );
  const any = [...tiles.values()].find(Boolean);
  const size = any?.size ?? 256;
  const px = (ts / size); // mercator meters per pixel
  const raw = (gx: number, gy: number) => {
    // gx, gy: global pixel coordinates at this zoom (pixel centers at +0.5).
    const tx = Math.floor(gx / size), ty = Math.floor(gy / size);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return 0;
    const ix = Math.min(size - 1, Math.max(0, Math.floor(gx - tx * size)));
    const iy = Math.min(size - 1, Math.max(0, Math.floor(gy - ty * size)));
    const v = t.h[iy * size + ix];
    return v < -500 ? 0 : v;
  };
  const bilinear = (mx: number, my: number) => {
    const gx = (mx + WORLD / 2) / px - 0.5, gy = (WORLD / 2 - my) / px - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const a = raw(x0, y0), b = raw(x0 + 1, y0), c = raw(x0, y0 + 1), d = raw(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const o = px * smooth;
  return {
    at(mx, my) {
      if (smooth <= 0) return bilinear(mx, my);
      return (bilinear(mx, my) * 2 + bilinear(mx + o, my) + bilinear(mx - o, my) + bilinear(mx, my + o) + bilinear(mx, my - o)) / 6;
    },
  };
}

function* range(a: number, b: number) { for (let i = a; i <= b; i++) yield i; }
