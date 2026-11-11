// The public web demo: the same game, served to anyone, with only the parts that are safe in public.
// Visitors walk the real planet (map tiles, terrain, imagery, weather, place search) and the city of
// famous open-source projects (showcase.ts), reading READMEs and talking to the desks with scripted
// lines. Nothing here knows a GitHub account, runs a coding agent, holds a key or saves what a visitor
// does: only the routes below exist, every write but two is refused, and the rest of the API answers
// "run it on your own computer". Hosted on Vercel by scripts/vercel-build.mjs; `npm run demo` runs it here.
import './demo-env.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Briefing, Me, ProvidersState, TeamState } from '../shared/types.ts';
import { registerShowcase } from './showcase.ts';
import { registerTiles } from './tiles.ts';
import { registerWeather } from './weather.ts';
import { reverse, searchPlaces } from './geo.ts';

const NOT_HERE = 'Not in the web demo. Run OpenWorld on your own computer for this: github.com/Shoberman2/openWorld';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Reads only, plus talking to a desk (scripted) and the page's analytics ping (dropped).
const POSTS = new Set(['/api/talk', '/api/events']);
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || (req.method === 'POST' && POSTS.has(req.originalUrl.split('?')[0]))) return next();
  res.status(403).json({ error: NOT_HERE });
});

// The CDN keeps what doesn't change, so the same tile or search is fetched upstream once, not per visitor.
const CDN: [RegExp, number][] = [
  [/^\/api\/tiles\//, 30 * 86400],
  [/^\/api\/repos\/[^/]+\/logo$/, 86400],
  [/^\/api\/geo\//, 86400],
  [/^\/api\/showcase$/, 3600],
  [/^\/api\/repos\/[^/]+$/, 3600],
  [/^\/api\/weather/, 600],
];
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const hit = CDN.find(([re]) => re.test(req.path));
    if (hit) res.setHeader('Vercel-CDN-Cache-Control', `public, max-age=${hit[1]}, stale-while-revalidate=${hit[1]}`);
  }
  next();
});

// Nobody is signed in here; the page uses `demo` to show how to get your own city instead of the GitHub form.
app.get('/api/me', (_req, res) => {
  const me: Me = { connected: false, login: null, name: null, avatarUrl: null, claudeAvailable: false, tokenSource: null, agentsReady: false, hidePrivate: false, showcase: true, demo: true };
  res.json(me);
});
// Lists a visitor would have of their own: always empty.
for (const path of ['/api/repos', '/api/agents', '/api/pulse', '/api/schedules']) app.get(path, (_req, res) => { res.json([]); });
app.get('/api/office/thread', (_req, res) => { res.json({ messages: [], unread: 0 }); });
app.get('/api/masters', (_req, res) => { res.json({ threads: [] }); });
app.post('/api/events', (_req, res) => { res.json({ ok: true }); });
// Empty states for the phone and Settings, so they render "nothing here" instead of an error.
app.get('/api/briefing', (_req, res) => {
  const b: Briefing = { since: new Date().toISOString(), finished: [], needsReview: [], needsInput: [], failingCi: [], newPrs: [], scheduled: [], headline: '' };
  res.json(b);
});
app.get('/api/providers', (_req, res) => {
  const p: ProvidersState = { providers: [], defaultProvider: null, chat: { provider: null, model: null, models: [], options: [] }, compat: null, canEdit: false };
  res.json(p);
});
app.get('/api/team', (_req, res) => {
  const t: TeamState = { status: 'off', error: null, configured: false, hosting: false, relay: null, me: null, members: [], cap: 0, shareLocation: false, shareWork: false, sharePrivate: false, hidePrivate: false, canEdit: false, invites: [] };
  res.json(t);
});
app.get('/api/team/chat', (_req, res) => { res.json({ messages: [] }); });

registerShowcase(app);

app.get('/api/geo/search', async (req, res, next) => {
  try { res.json(await searchPlaces(String(req.query.q ?? '').slice(0, 200))); } catch (e) { next(e); }
});
app.get('/api/geo/reverse', async (req, res, next) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) { res.status(400).json({ error: 'lat and lon are required' }); return; }
  try {
    const place = await reverse(Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3);
    if (place) res.json(place); else res.status(404).json({ error: 'nothing there' });
  } catch (e) { next(e); }
});
registerTiles(app);
registerWeather(app);

app.use('/api', (_req, res) => { res.status(404).json({ error: NOT_HERE }); });
app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) { res.end(); return; }
  res.status(typeof err?.status === 'number' ? err.status : 500).json({ error: err?.message || 'Server error' });
});

export default app;

// Locally: `npm run demo` builds the demo client and serves it next to the API, as the website does.
if (!process.env.VERCEL && process.argv[1]?.endsWith('demo.ts')) {
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist-demo');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(join(dist, 'index.html')));
  const port = Number(process.env.PORT) || 4400;
  app.listen(port, '127.0.0.1', () => console.log(`OpenWorld web demo on http://localhost:${port}`));
}
