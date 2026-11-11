// Clips recorded in the game (an HQ's orbit, flyover or history replay), saved locally in
// ~/.openworld/clips. Like photos.ts: the browser sends the finished file, we check it is what it
// says it is, give it our own name and keep a small sidecar with what it shows.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import type { ClipInfo } from '../shared/types.ts';
import { PATHS, logEvent } from './config.ts';

const DIR = join(PATHS.home, 'clips');
mkdirSync(DIR, { recursive: true });
/** A 20 second 1080p clip is 15 to 40 MB; nothing we record comes near this. */
const LIMIT = '96mb';
const NAME = /^[\w-]+\.(mp4|webm)$/;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, max);
const shown = (file: string) => (file.startsWith(homedir()) ? `~${file.slice(homedir().length)}` : file);

function info(name: string): ClipInfo {
  let meta: Partial<ClipInfo> = {};
  try { meta = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')); } catch { /* no sidecar */ }
  const file = join(DIR, name);
  return {
    name, url: `/api/clips/${name}`, path: shown(file),
    repo: meta.repo ?? '', kind: meta.kind ?? '', aspect: meta.aspect ?? '',
    bytes: existsSync(file) ? statSync(file).size : 0,
    takenAt: name.slice(0, 19).replace(/-(\d\d)-(\d\d)$/, ':$1:$2'),
  };
}

export function registerClips(app: Express) {
  app.post('/api/clips', express.raw({ type: ['video/mp4', 'video/webm'], limit: LIMIT }), (req: Request, res: Response) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 1024) { res.status(400).json({ error: 'expected a video' }); return; }
    // Trust the bytes, not the header: MP4 says "ftyp" at byte 4, WebM starts with the EBML magic.
    const mp4 = body.subarray(4, 8).toString('latin1') === 'ftyp';
    const webm = body.readUInt32BE(0) === 0x1a45dfa3;
    if (!mp4 && !webm) { res.status(400).json({ error: 'expected an MP4 or WebM video' }); return; }
    const kind = clean(req.query.kind, 16).replace(/[^a-z]/g, '') || 'clip';
    const aspect = req.query.aspect === '9:16' ? '9:16' : '16:9';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}-${kind}.${mp4 ? 'mp4' : 'webm'}`;
    writeFileSync(join(DIR, name), body);
    writeFileSync(join(DIR, `${name}.json`), JSON.stringify({ repo: clean(req.query.repo, 100), kind, aspect, seconds: Math.min(120, Number(req.query.seconds) || 0) }));
    logEvent('clip_file_saved', { kind, aspect, bytes: body.length });
    res.json(info(name));
  });

  app.get('/api/clips', (_req: Request, res: Response) => {
    res.json(readdirSync(DIR).filter((f) => NAME.test(f)).sort().reverse().slice(0, 60).map(info));
  });

  app.get('/api/clips/:name', (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!NAME.test(name) || !existsSync(join(DIR, name))) { res.status(404).end(); return; }
    // sendFile answers Range requests, so the preview can seek.
    res.sendFile(name, { root: DIR, headers: { 'Content-Type': name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' } });
  });
}
