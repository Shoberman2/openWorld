// Distant terrain (worker side): a coarse elevation grid draped with Sentinel-2 imagery, for the
// horizon and for flying. Detailed chunks are drawn over it; it hides itself under them in the shader.
import { WORLD } from '../frame.ts';
import { demFor } from '../dem.ts';
import { Buf } from './geo.ts';
import type { MeshData } from './types.ts';

export interface FarJob { id: number; z: number; tx: number; ty: number; k: number; e0: number }
export interface FarOut { id: number; z: number; tx: number; ty: number; size: number; ground: MeshData; tex: ImageBitmap | null }

async function sat(z: number, x: number, y: number) {
  try {
    const r = await fetch(`/api/tiles/sat/${z}/${x}/${y}`);
    if (r.status !== 200) return null;
    return await createImageBitmap(await r.blob());
  } catch { return null; }
}

export async function buildFar(job: FarJob): Promise<{ out: FarOut; transfer: Transferable[] }> {
  const { z, tx, ty, k, e0 } = job;
  const s = WORLD / 2 ** z, size = s * k;
  const mxW = tx * s - WORLD / 2, myN = WORLD / 2 - ty * s;
  const N = 40;
  const dem = await demFor(Math.max(1, z - 1), mxW - s * 0.05, myN - s * 1.05, mxW + s * 1.05, myN + s * 0.05, 0.6);
  const b = new Buf();
  const H: number[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = Math.max(-e0 - 3, dem.at(mxW + (i / N) * s, myN - (j / N) * s) - e0);
    H.push(h);
    b.v((i / N) * size, h, (j / N) * size);
    b.uv.push(i / N, j / N);
  }
  const r1 = N + 1, cell = size / N;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const hl = H[j * r1 + Math.max(0, i - 1)], hr = H[j * r1 + Math.min(N, i + 1)];
    const hu = H[Math.max(0, j - 1) * r1 + i], hd = H[Math.min(N, j + 1) * r1 + i];
    const dx = (hr - hl) / (2 * cell), dz = (hd - hu) / (2 * cell), l = Math.hypot(dx, 1, dz);
    b.nrm.push(-dx / l, 1 / l, -dz / l);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * r1 + i;
    b.tri(a, a + r1, a + 1); b.tri(a + 1, a + r1, a + r1 + 1);
  }
  // Imagery: the 2x2 children at the next zoom, for a sharper 512 px texture.
  let tex: ImageBitmap | null = null;
  const zi = Math.min(15, z + 1);
  const kids = await Promise.all([0, 1].flatMap((dy) => [0, 1].map((dx) => sat(zi, tx * 2 + dx, ty * 2 + dy))));
  if (kids.some(Boolean)) {
    const cv = new OffscreenCanvas(512, 512), g = cv.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#6f8f5a'; g.fillRect(0, 0, 512, 512);
    kids.forEach((bm, q) => { if (bm) { g.drawImage(bm, (q % 2) * 256, Math.floor(q / 2) * 256, 256, 256); bm.close(); } });
    tex = cv.transferToImageBitmap();
  }
  const ground = b.out()!;
  const transfer: Transferable[] = [];
  for (const a of [ground.pos, ground.nrm, ground.uv, ground.idx]) if (a) transfer.push(a.buffer);
  if (tex) transfer.push(tex);
  return { out: { id: job.id, z, tx, ty, size, ground, tex }, transfer };
}
