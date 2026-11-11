// Teammates, on this player's side: holds the one outbound connection to the team relay, decides what
// to share (and what never leaves: tokens, keys, private repo names), and bridges the team to the game
// page over the local /ws broadcast and /api/team/*. The browser never talks to the relay itself.
// "Host a team on this computer" runs the same relay code in this process on its own port; the main
// HTTP server stays loopback-only (guard.ts). Everything arriving from the relay is cleaned again here.
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { Express, Request, Response, RequestHandler } from 'express';
import { WebSocket, type WebSocketServer } from 'ws';
import type { Repo, ServerMsg, TeamChatMessage, TeamMember, TeamPose, TeamPoseReport, TeamState, TeamStatus } from '../../shared/types.ts';
import { PATHS, readConfig, readJson, writeConfig, writeJson } from '../config.ts';
import { getMe, hidingPrivate, listRepos } from '../github.ts';
import { listAgents } from '../agents.ts';
import { reverse } from '../geo.ts';
import { loopback } from '../guard.ts';
import { startRelay, type Relay } from './relay.ts';
import { localWork } from './work.ts';
import {
  DEFAULT_RELAY_PORT, LIMITS, PROTOCOL, cleanInfo, cleanName, cleanPing, cleanPose, makeInvite, newCode, newId, parseInvite,
  repoHash, roomKey, str, text, validId,
  type FromRelay, type ToRelay, type WireInfo, type WirePose, type WireRepo,
} from './protocol.ts';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler;
type TeamConfig = NonNullable<ReturnType<typeof readConfig>['team']>;

interface Member {
  id: string;
  name: string;
  online: boolean;
  lastSeen: number;
  color: number;
  pose?: WirePose;
  info?: WireInfo;
  /** Reverse-geocoded place, when they didn't send one. */
  geo?: { lat: number; lon: number; label: string; at: number };
}

// Suit colors for teammates: none of them the player's own navy.
const SUITS = ['#c2410c', '#0f766e', '#b91c1c', '#15803d', '#a16207', '#0e7490', '#be185d', '#4d7c0f', '#1d4ed8', '#9a3412', '#047857', '#b45309', '#0369a1', '#9f1239', '#3f6212', '#7c2d12'];
const FILE = join(PATHS.home, 'team.json');
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

export function registerTeam(app: Express, h: Wrap, broadcast: (msg: ServerMsg) => void) {
  const cfg = (): TeamConfig => readConfig().team ?? {};
  const save = (patch: Partial<TeamConfig>) => writeConfig({ team: { ...cfg(), ...patch } });
  const configured = () => { const c = cfg(); return !!(c.relay && c.code && c.uid); };

  let relay: Relay | null = null;
  let link: WebSocket | null = null;
  let status: TeamStatus = 'off';
  let error: string | null = null;
  let gen = 0;
  let tries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let cap: number = LIMITS.room;
  let githubName = '';
  let myRepos: Repo[] = [];
  let byHash = new Map<string, string>();
  const members = new Map<string, Member>();
  let chat: TeamChatMessage[] = [];
  let chatN = 0;

  // ---------- what's remembered between runs: who was on the team, when they were last seen, recent chat ----------
  const teamKey = () => (cfg().code ? roomKey(cfg().code!).slice(0, 16) : '');
  function load() {
    members.clear(); chat = [];
    const saved = readJson<{ key?: string; members?: { id: string; name: string; lastSeen: number; color: number }[]; chat?: TeamChatMessage[] }>(FILE, {});
    if (!saved.key || saved.key !== teamKey()) return;
    for (const m of saved.members ?? []) if (validId(m.id)) members.set(m.id, { id: m.id, name: cleanName(m.name), online: false, lastSeen: Number(m.lastSeen) || 0, color: Number(m.color) || 0 });
    chat = (saved.chat ?? []).filter((m) => m && typeof m.text === 'string').slice(-200);
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function remember() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!configured()) return;
      try {
        writeJson(FILE, { key: teamKey(), members: [...members.values()].map((m) => ({ id: m.id, name: m.name, lastSeen: m.lastSeen, color: m.color })), chat: chat.slice(-200) });
      } catch { /* not worth failing over */ }
    }, 1500);
  }

  // ---------- my repos: to recognise the project a teammate is in ----------
  async function refreshRepos() {
    myRepos = await listRepos().catch(() => myRepos);
    const code = cfg().code;
    byHash = new Map(code ? myRepos.map((r) => [repoHash(code, r.fullName), r.name]) : []);
  }
  const resolve = (ref: WireRepo | undefined): { label: string; local: string | null } | null => {
    if (!ref) return null;
    if (ref.full) return { label: ref.full.split('/')[1] ?? ref.full, local: myRepos.find((r) => r.fullName.toLowerCase() === ref.full!.toLowerCase())?.name ?? null };
    const local = ref.hash ? byHash.get(ref.hash) ?? null : null;
    return { label: local ?? 'A private project', local };
  };

  // ---------- state for the page ----------
  const myName = () => cleanName(cfg().name || githubName);
  const member = (id: string, name?: string): Member => {
    let m = members.get(id);
    if (!m) {
      const used = new Set([...members.values()].map((x) => x.color));
      let color = 0;
      while (used.has(color) && color < SUITS.length - 1) color++;
      members.set(id, (m = { id, name: cleanName(name), online: false, lastSeen: Date.now(), color }));
    } else if (name) m.name = cleanName(name);
    return m;
  };
  function view(m: Member): TeamMember {
    const i = m.online ? m.info : undefined, p = m.online ? m.pose : undefined;
    const inRepo = i?.in?.k === 'hq' ? resolve(i.in.repo) : null;
    const work = i?.work ? resolve(i.work.repo) : null;
    return {
      id: m.id, name: m.name, color: SUITS[m.color % SUITS.length], online: m.online, idle: m.online && (i?.idle ?? true),
      lastSeen: new Date(m.lastSeen).toISOString(),
      place: i?.place ?? (m.online ? m.geo?.label ?? null : null),
      lat: p?.lat ?? null, lon: p?.lon ?? null,
      vehicle: i?.veh ?? 'foot',
      inside: i?.in ? { kind: i.in.k, label: i.in.k === 'hq' ? inRepo?.label ?? 'A project HQ' : i.in.title || 'A building', localRepo: inRepo?.local ?? null, fullName: i.in.k === 'hq' ? i.in.repo?.full ?? null : null, room: i.in.room ?? null } : null,
      work: i?.work && work ? { repo: work.label, private: i.work.repo.priv, branch: i.work.branch ?? null, file: i.work.file ?? null, agents: i.work.agents, agentCount: i.work.n } : null,
    };
  }
  function invites(): TeamState['invites'] {
    const c = cfg();
    if (!c.relay || !c.code) return [];
    if (!c.host) return [{ label: 'Invite', url: makeInvite(c.relay, c.code) }];
    const out: TeamState['invites'] = [];
    for (const a of Object.values(networkInterfaces()).flat()) {
      if (!a || a.internal || a.family !== 'IPv4') continue;
      const [x, y] = a.address.split('.').map(Number);
      const label = x === 100 && y >= 64 && y < 128 ? 'Tailscale' : x === 10 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168) ? 'Same network' : 'Internet';
      out.push({ label: `${label} · ${a.address}`, url: makeInvite(`ws://${a.address}:${c.port ?? DEFAULT_RELAY_PORT}`, c.code) });
    }
    if (!out.length) out.push({ label: 'This computer only', url: makeInvite(c.relay, c.code) });
    return out;
  }
  function state(local = false): TeamState {
    const c = cfg();
    let host: string | null = null;
    try { host = c.relay ? new URL(c.relay).host : null; } catch { /* shown as unknown */ }
    return {
      status, error, configured: configured(), hosting: !!c.host && !!relay, relay: host,
      me: c.uid ? { id: c.uid, name: myName() } : null,
      members: [...members.values()].map(view).sort((a, b) => Number(b.online) - Number(a.online) || Number(a.idle) - Number(b.idle) || b.lastSeen.localeCompare(a.lastSeen)),
      cap,
      shareLocation: c.shareLocation !== false, shareWork: c.shareWork !== false, sharePrivate: c.sharePrivate !== false && !hidingPrivate(),
      hidePrivate: hidingPrivate(), canEdit: local, invites: local ? invites() : [],
    };
  }
  let stateTimer: ReturnType<typeof setTimeout> | null = null;
  const changed = () => {
    if (stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; broadcast({ type: 'team:state', state: state() }); }, 150);
  };
  const setStatus = (s: TeamStatus, e: string | null = null) => { status = s; error = e; changed(); };

  // Teammates' poses reach the page in one batch, ten times a second.
  const fresh = new Set<string>();
  setInterval(() => {
    if (!fresh.size) return;
    const poses: Record<string, TeamPose> = {};
    for (const id of fresh) { const p = members.get(id)?.pose; if (p) poses[id] = p; }
    fresh.clear();
    broadcast({ type: 'team:poses', poses });
  }, 100).unref();

  // ---------- the connection to the relay ----------
  const send = (msg: ToRelay) => { if (link?.readyState === WebSocket.OPEN && status === 'online') link.send(JSON.stringify(msg)); };
  const REASONS: Record<string, string> = {
    code: "That relay doesn't know this team. Ask for a new invite.", full: 'The team is full.',
    version: 'This relay speaks a different version. Update OpenWorld.', busy: 'The relay dropped the connection.', hello: 'The relay dropped the connection.',
  };
  function connect() {
    const c = cfg();
    if (!c.relay || !c.code || !c.uid) return;
    const my = ++gen;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (status !== 'error') setStatus('connecting');
    let why: string | null = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(c.relay, { handshakeTimeout: 8000, maxPayload: 512 * 1024, perMessageDeflate: false });
    } catch (e) {
      setStatus('error', `That relay address doesn't work: ${(e as Error).message}`);
      return;
    }
    link = ws;
    ws.on('open', () => { if (my === gen) ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, code: c.code!, id: c.uid!, name: myName() } satisfies ToRelay)); });
    ws.on('message', (data, isBinary) => {
      if (my !== gen || isBinary) return;
      let m: FromRelay;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'error') { why = REASONS[String(m.reason)] ?? 'The relay refused the connection.'; return; }
      onRelay(m);
    });
    ws.on('error', (e) => { why ??= `Can't reach the relay at ${state().relay ?? 'that address'}. Is it running? (${(e as NodeJS.ErrnoException).code ?? e.message})`; });
    ws.on('close', () => {
      if (my !== gen) return;
      link = null;
      const was = status;
      for (const m of members.values()) if (m.online) { m.online = false; m.lastSeen = Date.now(); }
      if (!configured()) return;
      tries++;
      setStatus(why || was !== 'online' ? 'error' : 'connecting', why ?? (was === 'online' ? null : `Can't reach the relay at ${state().relay ?? 'that address'}.`));
      retryTimer = setTimeout(connect, Math.min(30_000, 1500 * 2 ** Math.min(5, tries - 1)));
    });
  }

  function onRelay(m: FromRelay) {
    const me = cfg().uid;
    switch (m.t) {
      case 'welcome': {
        tries = 0;
        cap = Math.round(Number(m.cap)) || LIMITS.room;
        const here = new Set<string>();
        for (const p of Array.isArray(m.peers) ? m.peers.slice(0, 64) : []) {
          if (!validId(p?.id) || p.id === me) continue;
          const x = member(p.id, p.name);
          x.online = true; x.lastSeen = Date.now();
          x.pose = cleanPose(p.p) ?? undefined; x.info = cleanInfo(p.i) ?? undefined;
          if (x.pose) fresh.add(x.id);
          here.add(x.id);
        }
        for (const x of members.values()) if (!here.has(x.id)) x.online = false;
        setStatus('online');
        lastInfo = '';
        void sendInfo();
        remember();
        return;
      }
      case 'join': {
        if (!validId(m.id) || m.id === me) return;
        const x = member(m.id, m.name);
        const was = x.online;
        x.online = true; x.lastSeen = Date.now(); x.pose = undefined; x.info = undefined;
        if (!was) broadcast({ type: 'team:event', kind: 'join', id: x.id, name: x.name });
        changed(); remember();
        return;
      }
      case 'leave': {
        const x = validId(m.id) ? members.get(m.id) : undefined;
        if (!x || !x.online) return;
        x.online = false; x.lastSeen = Date.now();
        broadcast({ type: 'team:event', kind: 'leave', id: x.id, name: x.name });
        changed(); remember();
        return;
      }
      case 'pose': {
        const x = validId(m.id) && m.id !== me ? members.get(m.id) : undefined;
        const p = cleanPose(m.p);
        if (!x || !x.online || !p) return;
        x.pose = p;
        fresh.add(x.id);
        return;
      }
      case 'info': {
        const x = validId(m.id) && m.id !== me ? members.get(m.id) : undefined;
        const i = cleanInfo(m.i);
        if (!x || !x.online || !i) return;
        const before = JSON.stringify(x.info);
        x.info = i; x.name = i.name; x.lastSeen = Date.now();
        if (i.idle || !i.loc) { x.pose = undefined; x.geo = undefined; }
        if (JSON.stringify(i) !== before) changed();
        return;
      }
      case 'chat': {
        if (!validId(m.id)) return;
        const body = text(m.text, LIMITS.chat);
        if (!body) return;
        const ts = Number.isFinite(m.ts) ? Math.min(Date.now() + 5000, Number(m.ts)) : Date.now();
        const msg: TeamChatMessage = { id: `${ts}-${++chatN}`, from: m.id, name: m.id === me ? myName() : members.get(m.id)?.name ?? cleanName(m.name), text: body, ts, mine: m.id === me };
        chat.push(msg);
        if (chat.length > 200) chat.splice(0, chat.length - 200);
        broadcast({ type: 'team:chat', message: msg });
        remember();
        return;
      }
      case 'emote': {
        const x = validId(m.id) && m.id !== me ? members.get(m.id) : undefined;
        if (x && m.kind === 'wave') broadcast({ type: 'team:emote', id: x.id, name: x.name, kind: 'wave' });
        return;
      }
      case 'ping': {
        if (!validId(m.id)) return;
        const at = cleanPing(m);
        if (!at) return;
        broadcast({ type: 'team:ping', ping: { from: m.id, name: m.id === me ? myName() : members.get(m.id)?.name ?? cleanName(m.name), ...at, ts: Date.now(), mine: m.id === me } });
        return;
      }
      default:
        return;
    }
  }

  // ---------- what I share ----------
  let report: (TeamPoseReport & { at: number }) | null = null;
  let reportKey = '';
  let lastPose = 0;
  let lastInfo = '';
  let lastInfoAt = 0;
  let infoBusy = false;
  let infoAgain = false;

  function onPagePose(raw: unknown) {
    const p = cleanPose(raw);
    if (!p) return;
    const r = raw as Record<string, unknown>;
    report = { ...p, place: str(r.place, LIMITS.place), repo: str(r.repo, LIMITS.repo), room: str(r.room, LIMITS.room_name), title: str(r.title, LIMITS.label), pub: str(r.pub, LIMITS.repo), at: Date.now() };
    const key = `${p.in}|${report.repo}|${report.room}|${report.title}|${p.veh}`;
    if (key !== reportKey) { reportKey = key; void sendInfo(); }
    if (status !== 'online' || cfg().shareLocation === false) return;
    const now = Date.now();
    if (now - lastPose < 90) return;
    lastPose = now;
    send({ t: 'pose', p });
  }

  async function buildInfo(): Promise<WireInfo> {
    const c = cfg();
    const rep = report && Date.now() - report.at < 8000 ? report : null;
    const loc = c.shareLocation !== false, work = c.shareWork !== false;
    const i: WireInfo = { name: myName(), idle: !rep, loc, veh: rep?.veh ?? 'foot' };
    if (!rep) return i;
    const details = c.sharePrivate !== false && !hidingPrivate();
    if (loc && rep.place) i.place = rep.place;
    const repo = rep.in === 'hq' && rep.repo ? myRepos.find((r) => r.name === rep.repo) ?? (await refreshRepos(), myRepos.find((r) => r.name === rep.repo)) : undefined;
    // A private project travels as a salted hash of its name, never the name.
    let ref: WireRepo | undefined = repo && c.code ? (repo.isPrivate ? { hash: repoHash(c.code, repo.fullName), priv: true } : { full: repo.fullName, priv: false }) : undefined;
    // Visiting a public showcase project (not one of mine): its public name, unless it collides with a private repo of mine.
    if (!repo && rep.in === 'hq' && rep.pub && !myRepos.some((r) => r.isPrivate && r.fullName.toLowerCase() === rep.pub!.toLowerCase())) ref = { full: rep.pub, priv: false };
    if (loc && rep.in) {
      i.in = { k: rep.in };
      if (rep.in === 'hq') { if (work && ref) i.in.repo = ref; if (rep.room) i.in.room = rep.room; }
      else if (rep.title) i.in.title = rep.title;
    }
    if (work && repo && ref) {
      const open = !repo.isPrivate || details;
      const live = listAgents(repo.name).filter((a) => a.status === 'preparing' || a.status === 'running' || a.status === 'needs_input');
      i.work = { repo: ref, agents: open ? live.slice(0, LIMITS.agents).map((a) => ({ name: a.name, task: a.task.replace(/\s+/g, ' ').slice(0, LIMITS.task), status: a.status })) : [], n: live.length };
      if (open) {
        const w = await localWork(repo);
        if (w.branch) i.work.branch = w.branch;
        if (w.file) i.work.file = w.file;
      }
    }
    return i;
  }
  async function sendInfo() {
    if (status !== 'online') return;
    // Asked again while one is being put together (git can take a moment): send a fresh one right after.
    if (infoBusy) { infoAgain = true; return; }
    infoBusy = true;
    try {
      const i = cleanInfo(await buildInfo());
      const s = JSON.stringify(i);
      // Also a heartbeat: the relay drops connections that go quiet.
      if (i && (s !== lastInfo || Date.now() - lastInfoAt > 10_000)) { lastInfo = s; lastInfoAt = Date.now(); send({ t: 'info', i }); }
    } catch { /* next tick */ }
    infoBusy = false;
    if (infoAgain) { infoAgain = false; void sendInfo(); }
  }
  setInterval(() => { void sendInfo(); }, 3000).unref();

  // Teammates who share a position but no place name: look it up, one at a time, not often.
  setInterval(() => {
    if (status !== 'online') return;
    for (const m of members.values()) {
      const p = m.pose;
      if (!m.online || m.info?.place || p?.lat == null || p.lon == null) continue;
      if (m.geo && (Date.now() - m.geo.at < 30_000 || (Math.abs(m.geo.lat - p.lat) < 0.003 && Math.abs(m.geo.lon - p.lon) < 0.003))) continue;
      const lat = Math.round(p.lat * 1e3) / 1e3, lon = Math.round(p.lon * 1e3) / 1e3;
      m.geo = { lat: p.lat, lon: p.lon, label: m.geo?.label ?? '', at: Date.now() };
      void reverse(lat, lon).then((g) => { if (g && m.geo) { m.geo.label = str(g.label || g.name, LIMITS.place); changed(); } });
      break;
    }
  }, 5000).unref();

  // ---------- start, stop ----------
  async function stop() {
    gen++;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    link?.close();
    link = null;
    if (relay) { await relay.close().catch(() => {}); relay = null; }
    tries = 0;
    status = 'off'; error = null;
  }
  async function start() {
    const c = cfg();
    if (!c.relay || !c.code) return;
    if (!c.uid) save({ uid: newId() });
    load();
    void refreshRepos();
    if (c.host && !relay) {
      try {
        relay = await startRelay({ port: c.port ?? DEFAULT_RELAY_PORT, codes: () => (cfg().code ? [cfg().code!] : []) });
      } catch (e) {
        setStatus('error', `Couldn't host on port ${c.port ?? DEFAULT_RELAY_PORT}: ${(e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'something else is using it' : (e as Error).message}.`);
        return;
      }
    }
    connect();
  }
  // Reconnect to the saved team straight away; the GitHub name (the default display name) follows.
  setTimeout(() => { start().catch((e) => console.warn('Team:', (e as Error).message)); }, 0);
  void getMe().then((me) => { githubName = me.name || me.login || ''; lastInfo = ''; changed(); }).catch(() => {});
  setInterval(() => { if (configured()) void refreshRepos(); }, 120_000).unref();

  // ---------- routes ----------
  const local = (req: Request) => loopback(req.socket.remoteAddress);
  const localOnly = (req: Request) => { if (!local(req)) throw fail(403, 'Change team settings on the computer running OpenWorld'); };
  const online = () => { if (status !== 'online') throw fail(409, "You're not connected to a team right now"); };

  app.get('/api/team', h(async (req) => { hook(); return state(local(req)); }));
  app.get('/api/team/chat', h(async () => ({ messages: chat })));

  app.post('/api/team/host', h(async (req) => {
    localOnly(req);
    if (cfg().host && relay && status !== 'off') return state(true);
    const port = Math.round(Number(req.body?.port)) || cfg().port || DEFAULT_RELAY_PORT;
    if (port < 1024 || port > 65535) throw fail(400, 'Pick a port between 1024 and 65535');
    await stop();
    let r: Relay;
    try {
      r = await startRelay({ port, codes: () => (cfg().code ? [cfg().code!] : []) });
    } catch (e) {
      throw fail(409, (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${port} is already in use on this computer` : `Couldn't start the relay: ${(e as Error).message}`);
    }
    relay = r;
    const name = str(req.body?.name, LIMITS.name);
    save({ host: true, port, code: newCode(), relay: `ws://127.0.0.1:${port}`, uid: cfg().uid ?? newId(), ...(name ? { name } : {}) });
    load();
    void refreshRepos();
    connect();
    return state(true);
  }));

  app.post('/api/team/join', h(async (req) => {
    localOnly(req);
    const inv = parseInvite(String(req.body?.invite ?? ''));
    if (!inv) throw fail(400, "That doesn't look like an invite. It starts with ws:// and ends with the team code.");
    await stop();
    const name = str(req.body?.name, LIMITS.name);
    save({ host: false, port: undefined, relay: inv.relay, code: inv.code, uid: cfg().uid ?? newId(), ...(name ? { name } : {}) });
    load();
    void refreshRepos();
    connect();
    return state(true);
  }));

  app.post('/api/team/leave', h(async (req) => {
    localOnly(req);
    await stop();
    save({ relay: undefined, code: undefined, host: undefined, port: undefined });
    members.clear(); chat = [];
    try { writeJson(FILE, {}); } catch { /* fine */ }
    changed();
    return state(true);
  }));

  app.post('/api/team/settings', h(async (req) => {
    localOnly(req);
    const b = req.body ?? {};
    const patch: Partial<TeamConfig> = {};
    if (typeof b.name === 'string') patch.name = str(b.name, LIMITS.name) || undefined;
    for (const k of ['shareLocation', 'shareWork', 'sharePrivate'] as const) if (typeof b[k] === 'boolean') patch[k] = b[k];
    save(patch);
    lastInfo = '';
    void sendInfo();
    changed();
    return state(true);
  }));

  app.post('/api/team/chat', h(async (req) => {
    online();
    const body = text(req.body?.text, LIMITS.chat);
    if (!body) throw fail(400, 'Type a message first');
    send({ t: 'chat', text: body });
    return { ok: true };
  }));
  app.post('/api/team/emote', h(async () => { online(); send({ t: 'emote', kind: 'wave' }); return { ok: true }; }));
  app.post('/api/team/ping', h(async (req) => {
    online();
    if (cfg().shareLocation === false) throw fail(409, 'Turn on "Share where I am" to call teammates over');
    const at = cleanPing(req.body);
    if (!at) throw fail(400, 'lat and lon are required');
    send({ t: 'ping', ...at });
    return { ok: true };
  }));

  // ---------- the page reports its own robot over /ws ----------
  let sockets: () => WebSocketServer[] = () => [];
  const hooked = new WeakSet<object>();
  const listen = (ws: WebSocket) => {
    if (hooked.has(ws)) return;
    hooked.add(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary || (data as Buffer).length > 2048) return;
      try {
        const m = JSON.parse(data.toString());
        if (m?.type === 'team:pose') onPagePose(m.pose);
      } catch { /* not ours */ }
    });
  };
  function hook() {
    for (const wss of sockets()) {
      if (!hooked.has(wss)) { hooked.add(wss); wss.on('connection', listen); }
      for (const ws of wss.clients) listen(ws);
    }
  }

  return {
    /** Give it the game's WebSocket servers (there can be a second one for HTTPS). */
    attach(get: () => WebSocketServer[]) { sockets = get; hook(); },
    stop,
  };
}
