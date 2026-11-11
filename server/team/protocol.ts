// What travels between a player's local server and a team relay, and the cleaners both ends run on
// every message. Nothing here is trusted: the relay clips what a player sends before passing it on,
// and each receiving server clips it again before the game page sees it. Only these few message
// kinds exist; anything else is dropped.
import { createHash, randomBytes } from 'node:crypto';

export const PROTOCOL = 1;
export const DEFAULT_RELAY_PORT = 4319;
export const LIMITS = {
  /** Biggest message a relay accepts (bytes). */
  payload: 4096,
  /** People in one team at once. */
  room: 16,
  name: 32, chat: 500, place: 80, branch: 80, file: 140, task: 140, repo: 140, room_name: 40, label: 60,
  agents: 6,
} as const;

const STATES = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'fly', 'land', 'roll', 'sit', 'wave', 'crouch', 'sprawl', 'skate', 'bike', 'drive', 'pilot', 'paddle']);
const VEHICLES = new Set(['foot', 'skate', 'bike', 'jeep', 'plane', 'kayak', 'boat', 'shuttle']);
const AGENT_STATUS = new Set(['preparing', 'running', 'needs_input', 'done', 'error', 'stopped']);

/** Fast-changing: where the robot is and how it's moving (~10 a second). */
export interface WirePose {
  /** Outdoors (or the door of the building they're in). Absent when location sharing is off. */
  lat?: number; lon?: number;
  /** Meters above sea level, and above the ground under them. */
  alt?: number; agl?: number;
  /** The robot's rotation (Euler YXZ: x, y, z), radians. */
  rot: [number, number, number];
  st: string; sp: number; veh: string;
  rk: number; lx: number; lz: number; wg: number; cad: number;
  /** Inside a project HQ ('hq', with a position in that interior's own space) or any other building ('room'). */
  in?: 'hq' | 'room';
  x?: number; y?: number; z?: number;
}

/** A project, by name when it's public, by salted hash when it's private. */
export interface WireRepo { full?: string; hash?: string; priv: boolean }

/** Slow-changing: who they are and what they're on (every few seconds, or when it changes). */
export interface WireInfo {
  name: string;
  /** Their game isn't open right now (the server is up, nobody is playing). */
  idle: boolean;
  /** False when they don't share where they are: forget any position you had. */
  loc: boolean;
  place?: string;
  veh: string;
  in?: { k: 'hq' | 'room'; repo?: WireRepo; room?: string; title?: string };
  work?: { repo: WireRepo; branch?: string; file?: string; agents: { name: string; task: string; status: string }[]; n: number };
}

export type ToRelay =
  | { t: 'hello'; v: number; code: string; id: string; name: string }
  | { t: 'pose'; p: WirePose }
  | { t: 'info'; i: WireInfo }
  | { t: 'chat'; text: string }
  | { t: 'emote'; kind: 'wave' }
  | { t: 'ping'; lat: number; lon: number; alt: number; label: string };

export type FromRelay =
  | { t: 'welcome'; id: string; cap: number; peers: { id: string; name: string; p?: WirePose; i?: WireInfo }[] }
  | { t: 'join'; id: string; name: string }
  | { t: 'leave'; id: string }
  | { t: 'pose'; id: string; p: WirePose }
  | { t: 'info'; id: string; i: WireInfo }
  | { t: 'chat'; id: string; name: string; text: string; ts: number }
  | { t: 'emote'; id: string; kind: 'wave' }
  | { t: 'ping'; id: string; name: string; lat: number; lon: number; alt: number; label: string; ts: number }
  | { t: 'error'; reason: 'code' | 'full' | 'version' | 'busy' | 'hello' };

// ---------- cleaners ----------

/** Control characters, line/paragraph separators and text-direction overrides (they can disguise a name). */
const unsafe = (c: number, keepNewline: boolean) =>
  (c < 0x20 && !(keepNewline && c === 0x0a)) || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
function scrub(v: string, keepNewline: boolean) {
  let out = '';
  for (const ch of v.slice(0, 8000)) out += unsafe(ch.codePointAt(0)!, keepNewline) ? ' ' : ch;
  return out;
}
/** A plain one-line string, clipped. Control characters and line breaks become spaces. */
export function str(v: unknown, max: number): string {
  return typeof v === 'string' ? scrub(v, false).trim().slice(0, max) : '';
}
/** Chat text keeps its line breaks. */
export function text(v: unknown, max: number): string {
  return typeof v === 'string' ? scrub(v, true).replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
}
export function num(v: unknown, min: number, max: number, dflt = 0): number {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
const round = (n: number, places: number) => { const k = 10 ** places; return Math.round(n * k) / k; };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v);
export const validCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
export const cleanName = (v: unknown) => str(v, LIMITS.name) || 'Player';

export function cleanPose(raw: unknown): WirePose | null {
  if (!isObj(raw)) return null;
  const r = Array.isArray(raw.rot) ? raw.rot : [];
  const p: WirePose = {
    rot: [round(num(r[0], -7, 7), 3), round(num(r[1], -7, 7), 3), round(num(r[2], -7, 7), 3)],
    st: STATES.has(raw.st as string) ? (raw.st as string) : 'idle',
    sp: round(num(raw.sp, 0, 12000), 2),
    veh: VEHICLES.has(raw.veh as string) ? (raw.veh as string) : 'foot',
    rk: round(num(raw.rk, 0, 2), 2), lx: round(num(raw.lx, -1, 1), 2), lz: round(num(raw.lz, -1, 1), 2),
    wg: round(num(raw.wg, 0, 1), 2), cad: round(num(raw.cad, 0, 6), 2),
  };
  if (typeof raw.lat === 'number' && typeof raw.lon === 'number' && Number.isFinite(raw.lat) && Number.isFinite(raw.lon) && Math.abs(raw.lat) <= 85.06 && Math.abs(raw.lon) <= 180) {
    p.lat = round(raw.lat, 7); p.lon = round(raw.lon, 7);
    p.alt = round(num(raw.alt, -500, 500_000), 2);
    p.agl = round(num(raw.agl, 0, 500_000), 2);
  }
  if (raw.in === 'hq' || raw.in === 'room') {
    p.in = raw.in;
    if (raw.in === 'hq') { p.x = round(num(raw.x, -200, 200), 2); p.y = round(num(raw.y, -20, 200), 2); p.z = round(num(raw.z, -200, 200), 2); }
  }
  return p;
}

export function cleanRepo(raw: unknown): WireRepo | null {
  if (!isObj(raw)) return null;
  const priv = raw.priv === true;
  const hash = typeof raw.hash === 'string' && /^[a-f0-9]{32}$/.test(raw.hash) ? raw.hash : undefined;
  const full = typeof raw.full === 'string' && /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/.test(raw.full) ? raw.full : undefined;
  // A private project never travels by name.
  if (priv) return hash ? { hash, priv } : null;
  return full ? { full, priv } : null;
}

export function cleanInfo(raw: unknown): WireInfo | null {
  if (!isObj(raw)) return null;
  const i: WireInfo = { name: cleanName(raw.name), idle: raw.idle === true, loc: raw.loc !== false, veh: VEHICLES.has(raw.veh as string) ? (raw.veh as string) : 'foot' };
  const place = str(raw.place, LIMITS.place);
  if (place) i.place = place;
  if (isObj(raw.in) && (raw.in.k === 'hq' || raw.in.k === 'room')) {
    i.in = { k: raw.in.k };
    const repo = cleanRepo(raw.in.repo), room = str(raw.in.room, LIMITS.room_name), title = str(raw.in.title, LIMITS.label);
    if (repo) i.in.repo = repo;
    if (room) i.in.room = room;
    if (title) i.in.title = title;
  }
  if (isObj(raw.work)) {
    const repo = cleanRepo(raw.work.repo);
    if (repo) {
      const agents = (Array.isArray(raw.work.agents) ? raw.work.agents : []).slice(0, LIMITS.agents).filter(isObj)
        .map((a) => ({ name: str(a.name, LIMITS.name), task: str(a.task, LIMITS.task), status: AGENT_STATUS.has(a.status as string) ? (a.status as string) : 'running' }))
        .filter((a) => a.name);
      i.work = { repo, agents, n: Math.round(num(raw.work.n, 0, 99, agents.length)) };
      const branch = str(raw.work.branch, LIMITS.branch), file = str(raw.work.file, LIMITS.file);
      if (branch) i.work.branch = branch;
      if (file) i.work.file = file;
    }
  }
  return i;
}

export function cleanPing(raw: unknown): { lat: number; lon: number; alt: number; label: string } | null {
  if (!isObj(raw) || typeof raw.lat !== 'number' || typeof raw.lon !== 'number' || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  if (Math.abs(raw.lat) > 85.06 || Math.abs(raw.lon) > 180) return null;
  return { lat: round(raw.lat, 7), lon: round(raw.lon, 7), alt: round(num(raw.alt, -500, 500_000), 1), label: str(raw.label, LIMITS.label) };
}

// ---------- codes, invites, hashes ----------

export const newCode = () => randomBytes(18).toString('base64url');
export const newId = () => randomBytes(9).toString('base64url');

/** A private project's name never leaves the machine: teammates get this, and match it against their own repos. */
export function repoHash(code: string, fullName: string) {
  return createHash('sha256').update(`${code}\n${fullName.toLowerCase()}`).digest('hex').slice(0, 32);
}
/** Rooms are kept by a hash of the code, so a relay's memory never holds the code itself. */
export const roomKey = (code: string) => createHash('sha256').update(`room\n${code}`).digest('hex');

export const makeInvite = (relay: string, code: string) => `${relay.replace(/\/+$/, '')}/#${code}`;

/** "ws://host:4319/#code" (or host:4319#code) -> where to connect and the team code. */
export function parseInvite(invite: string): { relay: string; code: string } | null {
  let s = invite.trim();
  if (!s || s.length > 400) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `ws://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const proto = u.protocol === 'http:' ? 'ws:' : u.protocol === 'https:' ? 'wss:' : u.protocol;
  if (proto !== 'ws:' && proto !== 'wss:') return null;
  const code = decodeURIComponent(u.hash.replace(/^#/, ''));
  if (!validCode(code) || !u.hostname || u.username || u.password) return null;
  const port = u.port || (proto === 'ws:' ? String(DEFAULT_RELAY_PORT) : '');
  const path = u.pathname.replace(/\/+$/, '');
  return { relay: `${proto}//${u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname}${port ? `:${port}` : ''}${path}`, code };
}

/** A small token bucket: `take()` is false once more than `burst` arrive faster than `perSec`. */
export class Bucket {
  private tokens: number;
  private at = Date.now();
  constructor(private perSec: number, private burst: number) { this.tokens = burst; }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSec);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
