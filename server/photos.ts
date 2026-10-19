// Photo mode pictures, saved locally in ~/.openworld/photos.
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { PATHS } from './config.ts';

const DIR = join(PATHS.home, 'photos');
mkdirSync(DIR, { recursive: true });

export interface PhotoInfo { name: string; url: string; place: string; takenAt: string }

export function registerPhotos(app: Express) {
  app.post('/api/photos', express.json({ limit: '25mb' }), (req: Request, res: Response) => {
    const data = String(req.body?.data ?? '');
    const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(data);
    if (!m) { res.status(400).json({ error: 'expected a data URL' }); return; }
    const place = String(req.body?.place ?? '').replace(/[^\p{L}\p{N} ,.'&·-]/gu, '').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}.${m[1] === 'png' ? 'png' : 'jpg'}`;
    writeFileSync(join(DIR, name), Buffer.from(m[2], 'base64'));
    writeFileSync(join(DIR, `${name}.json`), JSON.stringify({ place, lat: req.body?.lat, lon: req.body?.lon }));
    res.json({ name, url: `/api/photos/${name}`, place, takenAt: new Date().toISOString() } satisfies PhotoInfo);
  });

  app.get('/api/photos', (_req: Request, res: Response) => {
    const list: PhotoInfo[] = readdirSync(DIR).filter((f) => /\.(jpg|png)$/.test(f)).sort().reverse().slice(0, 60).map((name) => {
      let place = '';
      try { place = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')).place ?? ''; } catch { /* no sidecar */ }
      return { name, url: `/api/photos/${name}`, place, takenAt: name.slice(0, 19).replace(/-(\d\d)-(\d\d)$/, ':$1:$2') };
    });
    res.json(list);
  });

  app.get('/api/photos/:name', (req: Request, res: Response) => {
    const name = String(req.params.name);
    const file = join(DIR, name);
    if (!/^[\w-]+\.(jpg|png)$/.test(name) || !existsSync(file)) { res.status(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.end(readFileSync(file));
  });
}
