import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { BoardroomRequest, RepoDetail, ServerMsg, TalkRequest } from '../shared/types.ts';
import { PATHS, writeConfig, logEvent } from './config.ts';
import {
  getMe, listRepos, findRepo, repoWorkers, findWorker, workerDiff, ensureLogo, logoContentType,
  validateToken, resetToken,
} from './github.ts';
import { streamClaude, transcriptPrompt } from './llm.ts';
import { listAgents, startAgent, stopAgent, openPr, agentLog, setBroadcaster, agentDiff, reviewAgent, answerAgent } from './agents.ts';
import { convene, listDecisions } from './boardroom.ts';
import { searchPlaces, reverse } from './geo.ts';
import { registerOffice } from './office.ts';
import { registerMasters } from './masters.ts';
import { registerTiles } from './tiles.ts';
import { registerWeather } from './weather.ts';
import { registerPhotos } from './photos.ts';
import { httpsEnabled, startHttps } from './https.ts';
import { registerPulse } from './pulse.ts';
import { registerSchedules } from './schedules.ts';
import { registerBriefing } from './briefing.ts';
import { registerControl } from './control.ts';
import { registerProviders, providerStatuses } from './providers/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4317;
const app = express();
// Photo uploads (large data URLs) parse their own body.
const json1mb = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/photos' ? next() : json1mb(req, res, next)));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then(
    (out) => {
      if (out !== undefined && !res.headersSent) res.json(out);
    },
    next,
  );
};

function sse(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function abortOnClose(res: Response) {
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ctrl.abort();
  });
  return ctrl.signal;
}

// ---------- account ----------

// agentsReady is checked fresh each time (it changes when keys are added); the GitHub part is cached.
app.get('/api/me', h(async () => ({ ...(await getMe()), agentsReady: (await providerStatuses()).some((p) => p.ready) })));

app.post('/api/token', h(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token is required' });
  const me = await validateToken(token);
  if (!me.connected) return res.status(401).json({ error: 'That token was rejected by GitHub' });
  writeConfig({ token });
  resetToken();
  return getMe();
}));

// ---------- repos ----------

app.get('/api/repos', h(() => listRepos()));

app.get('/api/repos/:name', h(async (req) => {
  const repo = await findRepo(String(req.params.name));
  const { readme, workers } = await repoWorkers(repo);
  const detail: RepoDetail = {
    repo,
    readme,
    workers,
    decisions: listDecisions(repo.name),
    agents: listAgents(repo.name),
  };
  return detail;
}));

app.get('/api/repos/:name/logo', h(async (req, res) => {
  const repo = await findRepo(String(req.params.name));
  const file = await ensureLogo(repo);
  if (!file) return res.status(404).json({ error: 'No logo found' });
  res.setHeader('Content-Type', logoContentType(file));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(readFileSync(file));
  return undefined;
}));

// ---------- desk talk ----------

app.post('/api/talk', h(async (req, res) => {
  const body = req.body as TalkRequest;
  const repo = await findRepo(String(body.repo));
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const { readme, workers } = await repoWorkers(repo);
  let system: string;
  let opener: string;
  let fallback: string;

  if (body.workerId === 'reception') {
    const agents = listAgents(repo.name);
    system = [
      `You are Morgan, the receptionist in the lobby of the "${repo.name}" building in an open-world city game where every GitHub repo is a building.`,
      `You know this project well and greet visitors warmly. Speak in first person, concise (<=120 words unless asked for detail), no markdown headings.`,
      `Direct visitors around the office: the desks on the work floor are staffed by the people and AI agents behind past pull requests and commits (walk up and press E to talk to them); the glass Agent Lab is where you can hire new AI agents to work on the code and watch them live; the Boardroom at the back is where the board debates big decisions.`,
      ``,
      `Project: ${repo.fullName}${repo.description ? ` — ${repo.description}` : ''}`,
      `Stats: ${repo.commits} commits, ${repo.prs} pull requests, ${repo.stars} stars, main language ${repo.language ?? 'unknown'}, last push ${repo.pushedAt}${repo.homepageUrl ? `, live at ${repo.homepageUrl}` : ''}.`,
      readme ? `README excerpt:\n${readme.slice(0, 3000)}` : 'There is no README.',
      workers.length ? `People at the desks (most recent first):\n${workers.slice(0, 15).map((w) => `- ${w.agentName ? `${w.agentName} (AI agent)` : w.author}: ${w.title} [${w.state}, ${w.date.slice(0, 10)}]`).join('\n')}` : 'No one is at the desks yet.',
      agents.length ? `Agents hired in the Agent Lab:\n${agents.slice(0, 6).map((a) => `- ${a.name}: "${a.task.slice(0, 80)}" (${a.status})`).join('\n')}` : '',
    ].join('\n');
    opener = 'A visitor just walked up to your reception desk. Greet them and give a short, vivid overview of what this project is, what has been happening lately, and where they might want to go first.';
    fallback = `Welcome to ${repo.name}! ${repo.description || 'This is one of your projects.'} We have ${repo.commits} commits and ${repo.prs} pull requests on record. The desks behind me are staffed by the people and agents behind recent changes — walk up and press E to chat. Hire new agents in the Agent Lab, or take big decisions to the Boardroom at the back.`;
  } else {
    const w = await findWorker(repo, String(body.workerId));
    const diff = await workerDiff(repo, w);
    const who = w.agentName ? `${w.agentName}, an AI coding agent` : w.author;
    system = [
      `You are ${who}, a worker at a desk inside the "${repo.name}" building in an open-world city game where every GitHub repo is a building.`,
      `You made this change and you're proud of it. Speak in first person, warm and concise (<=120 words unless asked for detail), like a colleague explaining their work at their desk. Explain what changed and why, and what risks or follow-ups remain. No markdown headings. If asked something the diff doesn't show, say so honestly.`,
      ``,
      `Your ${w.kind === 'pr' ? `pull request #${w.number}` : `commit ${w.sha?.slice(0, 7)}`}: "${w.title}" (${w.state}, ${w.date.slice(0, 10)}, +${w.additions}/-${w.deletions}, ${w.changedFiles} files)`,
      w.body && w.body !== w.title ? `Description:\n${w.body}` : '',
      w.files.length ? `Files: ${w.files.join(', ')}` : '',
      diff ? `The diff:\n${diff}` : 'The diff is unavailable.',
      repo.description ? `About the project: ${repo.description}` : '',
    ].filter(Boolean).join('\n');
    opener = 'A visitor just walked up to your desk. Greet them briefly and summarize the change you made: what it does, why, and anything still worth watching.';
    fallback = `Hi! I'm ${who}. I ${w.kind === 'pr' ? `opened PR #${w.number}` : 'committed'} "${w.title}" — that touched ${w.changedFiles || w.files.length} files (+${w.additions}/-${w.deletions}). ${w.body && w.body !== w.title ? w.body.slice(0, 300) : ''}`;
  }

  logEvent('desk_talk', { repo: repo.name, worker: body.workerId, turn: messages.length });
  const send = sse(res);
  const signal = abortOnClose(res);
  try {
    await streamClaude({
      system,
      prompt: transcriptPrompt(messages, opener),
      fallback,
      signal,
      onDelta: (delta) => send({ delta }),
    });
    send({ done: true });
  } catch (e: any) {
    send({ error: e.message });
  }
  res.end();
  return undefined;
}));

// ---------- agents ----------

app.get('/api/agents', h(async () => listAgents()));
app.post('/api/agents', h(async (req) => {
  const repo = await findRepo(String(req.body?.repo));
  return startAgent(repo, String(req.body?.task || ''), req.body?.provider ? String(req.body.provider) : null);
}));
app.get('/api/agents/:id/log', h(async (req) => agentLog(String(req.params.id))));
app.post('/api/agents/:id/stop', h(async (req) => stopAgent(String(req.params.id))));
app.post('/api/agents/:id/pr', h(async (req) => openPr(String(req.params.id))));

// ---- review ----
app.get('/api/agents/:id/diff', h(async (req) => agentDiff(String(req.params.id))));
app.post('/api/agents/:id/review', h(async (req) => {
  const id = String(req.params.id);
  const action = String(req.body?.action);
  if (action !== 'approve' && action !== 'changes' && action !== 'discard') throw Object.assign(new Error('action must be approve, changes or discard'), { status: 400 });
  const repo = listAgents().find((a) => a.id === id)?.repo;
  const fullName = repo ? (await findRepo(repo).catch(() => null))?.fullName : undefined;
  return reviewAgent(id, action, String(req.body?.note ?? '').slice(0, 4000), fullName);
}));
app.post('/api/agents/:id/answer', h(async (req) => answerAgent(String(req.params.id), String(req.body?.text ?? '').slice(0, 4000))));
// ---- /review ----

// ---------- real places ----------

app.get('/api/geo/search', h(async (req) => searchPlaces(String(req.query.q ?? '').slice(0, 200))));
app.get('/api/geo/reverse', h(async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat and lon are required' });
  return (await reverse(Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4)) ?? res.status(404).json({ error: 'nothing there' });
}));

// ---------- boardroom ----------

app.post('/api/boardroom', h(async (req, res) => {
  const body = req.body as BoardroomRequest;
  const question = String(body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  const repo = await findRepo(String(body.repo));
  const send = sse(res);
  const signal = abortOnClose(res);
  try {
    await convene(repo, question, send, signal);
  } catch (e: any) {
    send({ type: 'error', error: e.message });
  }
  res.end();
  return undefined;
}));

// ---------- local analytics ----------

app.post('/api/events', h(async (req) => {
  const name = String(req.body?.name || '').slice(0, 64);
  if (name) logEvent(name, typeof req.body?.props === 'object' && req.body.props ? req.body.props : {});
  return { ok: true };
}));

app.get('/api/stats', h(async () => {
  const lines = existsSync(PATHS.events) ? readFileSync(PATHS.events, 'utf8').split('\n').filter(Boolean) : [];
  const byDay: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  const phoneSessions = new Set<string>();
  const dispatchSessions = new Set<string>();
  const earthSessions = new Set<string>();
  const exploredSessions = new Set<string>();
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.props?.automated) continue;
      if (e.name === 'session_start' && e.props?.city === 'world' && e.props?.session) earthSessions.add(e.props.session);
      if ((e.name === 'explore_far' || e.name === 'explore_teleport') && e.props?.session) exploredSessions.add(e.props.session);
      if (e.name === 'phone_opened' && e.props?.session) phoneSessions.add(e.props.session);
      if (e.name === 'office_dispatch' && e.props?.session) dispatchSessions.add(e.props.session);
      const day = String(e.ts).slice(0, 10);
      (byDay[day] ||= {})[e.name] = (byDay[day][e.name] || 0) + 1;
      totals[e.name] = (totals[e.name] || 0) + 1;
    } catch {
      /* skip bad line */
    }
  }
  const sessions = totals.session_start || 0;
  return {
    sessions,
    totals,
    // Learning metric for the phone: share of game sessions where HQ dispatched at least one agent.
    phone: {
      sessionsOpened: phoneSessions.size,
      sessionsDispatched: dispatchSessions.size,
      dispatchShare: sessions ? Math.round((dispatchSessions.size / sessions) * 1000) / 1000 : 0,
    },
    // Learning metric for the streaming world: share of Earth sessions that leave the home district
    // (fly or walk 2 km+ away, or drop in somewhere else from the map).
    explore: {
      earthSessions: earthSessions.size,
      exploredSessions: exploredSessions.size,
      exploreShare: earthSessions.size ? Math.round((exploredSessions.size / earthSessions.size) * 1000) / 1000 : 0,
    },
    byDay,
    perSession: sessions
      ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round((v / sessions) * 100) / 100]))
      : {},
  };
}));

registerOffice(app, (msg) => broadcastAll(msg));
registerMasters(app, (msg) => broadcastAll(msg));
registerTiles(app);
registerWeather(app);
registerPhotos(app);
// ---- pulse ----
registerPulse(app, (msg) => broadcastAll(msg));
// ---- schedules & briefing ----
registerSchedules(app, (msg) => broadcastAll(msg));
registerBriefing(app);
// ---- project control ----
registerControl(app);

// ---- agents & keys ----
registerProviders(app, h);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- static client (production) ----------

const dist = join(ROOT, 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ error: err?.message || 'Server error' });
});

// ---------- http + websocket ----------

const server = createServer(app);
const sockets = [new WebSocketServer({ server, path: '/ws' })];
function broadcastAll(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const wss of sockets) for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}
setBroadcaster(broadcastAll);
// OPENWORLD_HTTPS=1: also serve over HTTPS on the LAN, for VR headsets (WebXR needs a secure context).
if (httpsEnabled()) {
  startHttps(app, Number(process.env.HTTPS_PORT) || PORT + 1, (srv, allowed) =>
    sockets.push(new WebSocketServer({ server: srv, path: '/ws', verifyClient: ({ req }: { req: IncomingMessage }) => allowed(req) })));
}

server.listen(PORT, () => {
  console.log(`OpenWorld server on http://localhost:${PORT}`);
  // warm the repo cache (and kick off logo discovery) so the city loads fast
  listRepos().catch((e) => console.warn('GitHub not ready:', e.message));
});
