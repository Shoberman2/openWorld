// Chunk worker: map tiles in, mesh arrays out (off the main thread so streaming never stutters).
import { buildChunk } from './build/chunk.ts';
import { buildFar, type FarJob } from './build/far.ts';
import type { ChunkJob } from './build/types.ts';
import { demFor } from './dem.ts';

type Msg =
  | { type: 'chunk'; job: ChunkJob }
  | { type: 'far'; job: FarJob }
  | { type: 'elev'; id: number; mx: number; my: number };

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'chunk') {
      const { out, transfer } = await buildChunk(m.job);
      post({ type: 'chunk', out }, transfer);
    } else if (m.type === 'far') {
      const { out, transfer } = await buildFar(m.job);
      post({ type: 'far', out }, transfer);
    } else if (m.type === 'elev') {
      const dem = await demFor(13, m.mx - 50, m.my - 50, m.mx + 50, m.my + 50, 1.4);
      post({ type: 'elev', id: m.id, h: dem.at(m.mx, m.my) });
    }
  } catch (err) {
    const id = m.type === 'elev' ? m.id : m.job.id;
    post({ type: 'error', id, error: String((err as Error)?.stack || err) });
  }
};
