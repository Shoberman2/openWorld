// Teammates, page side: the team's state as our own server reports it (roster, poses, chat, pings),
// and the calls that change it. Everything in here that came from a teammate is untrusted text and
// numbers: escape it before it touches innerHTML, and check numbers before using them.
import type { TeamChatMessage, TeamMember, TeamPing, TeamPose, TeamState } from '../../../shared/types.ts';
import { onLive } from '../api.ts';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `${res.status} ${res.statusText}`);
  return body as T;
}
const post = <T>(url: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));

export const teamApi = {
  state: () => fetch('/api/team').then((r) => json<TeamState>(r)),
  chat: () => fetch('/api/team/chat').then((r) => json<{ messages: TeamChatMessage[] }>(r)),
  host: (name?: string) => post<TeamState>('/api/team/host', { name }),
  join: (invite: string, name?: string) => post<TeamState>('/api/team/join', { invite, name }),
  leave: () => post<TeamState>('/api/team/leave'),
  settings: (patch: { name?: string; shareLocation?: boolean; shareWork?: boolean; sharePrivate?: boolean }) => post<TeamState>('/api/team/settings', patch),
  say: (text: string) => post<{ ok: true }>('/api/team/chat', { text }),
  emote: () => post<{ ok: true }>('/api/team/emote', { kind: 'wave' }),
  ping: (at: { lat: number; lon: number; alt: number; label: string }) => post<{ ok: true }>('/api/team/ping', at),
};

/** One received pose and when it arrived (performance.now()). */
export interface Snap { t: number; p: TeamPose }
export type TeamChange = 'state' | 'chat' | 'ping';
/** A "come here" marker stays this long. */
export const PING_MS = 90_000;

const READ_KEY = 'openworld.team.read';
const okNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export class TeamStore {
  state: TeamState | null = null;
  chat: TeamChatMessage[] = [];
  /** Recent poses per teammate, oldest first. */
  snaps = new Map<string, Snap[]>();
  pings: TeamPing[] = [];
  /** Join, leave, wave: for toasts. */
  onEvent: ((e: { kind: 'join' | 'leave' | 'wave'; id: string; name: string }) => void) | null = null;
  onChat: ((m: TeamChatMessage) => void) | null = null;
  onPing: ((p: TeamPing) => void) | null = null;
  private listeners = new Set<(what: TeamChange) => void>();
  private readTs = 0;

  constructor() {
    try { this.readTs = Number(localStorage.getItem(READ_KEY)) || 0; } catch { /* private mode */ }
    void this.reload();
    onLive((msg) => {
      if (msg.type === 'team:state') {
        // The broadcast carries no invites (they hold the team code); keep the ones we fetched ourselves.
        const keep = this.state;
        this.state = { ...msg.state, canEdit: keep?.canEdit ?? msg.state.canEdit, invites: msg.state.configured ? keep?.invites ?? [] : [] };
        if (msg.state.configured && !this.state.invites.length && this.state.canEdit) void this.reload();
        for (const id of [...this.snaps.keys()]) if (!msg.state.members.some((m) => m.id === id && m.online && !m.idle && (m.lat != null || m.inside?.kind === 'hq'))) this.snaps.delete(id);
        if (!msg.state.configured) { this.chat = []; this.pings = []; }
        this.emit('state');
      } else if (msg.type === 'team:poses') {
        const now = performance.now();
        for (const [id, p] of Object.entries(msg.poses)) {
          if (!p || !Array.isArray(p.rot)) continue;
          let list = this.snaps.get(id);
          if (!list) this.snaps.set(id, (list = []));
          list.push({ t: now, p });
          if (list.length > 8) list.shift();
        }
      } else if (msg.type === 'team:chat') {
        if (this.chat.some((m) => m.id === msg.message.id)) return;
        this.chat.push(msg.message);
        if (this.chat.length > 200) this.chat.shift();
        this.onChat?.(msg.message);
        this.emit('chat');
      } else if (msg.type === 'team:ping') {
        const p = msg.ping;
        if (!okNum(p.lat) || !okNum(p.lon)) return;
        this.pings = this.pings.filter((x) => x.from !== p.from);
        this.pings.push(p);
        this.onPing?.(p);
        this.emit('ping');
      } else if (msg.type === 'team:event') this.onEvent?.({ kind: msg.kind, id: msg.id, name: msg.name });
      else if (msg.type === 'team:emote') this.onEvent?.({ kind: 'wave', id: msg.id, name: msg.name });
    });
  }

  /** Fetch the state (with invites, when this is the computer running OpenWorld) and the recent chat. */
  async reload() {
    try {
      const [state, chat] = await Promise.all([teamApi.state(), teamApi.chat()]);
      this.state = state;
      this.chat = chat.messages;
      this.emit('state');
      this.emit('chat');
    } catch { /* server not up yet: the live socket will fill it in */ }
    return this.state;
  }
  /** Use a state a settings call just returned. */
  adopt(state: TeamState) {
    this.state = state;
    if (!state.configured) { this.chat = []; this.pings = []; this.snaps.clear(); }
    this.emit('state');
  }

  subscribe(fn: (what: TeamChange) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(what: TeamChange) { for (const fn of this.listeners) fn(what); }

  get online() { return this.state?.status === 'online'; }
  /** Teammates who are connected right now. */
  here(): TeamMember[] { return this.state?.members.filter((m) => m.online) ?? []; }
  member(id: string) { return this.state?.members.find((m) => m.id === id) ?? null; }
  /** The newest pose we have for a teammate (null when they're not sharing where they are). */
  pose(id: string): TeamPose | null { const l = this.snaps.get(id); return l?.length ? l[l.length - 1].p : null; }
  /** Where a teammate is on Earth right now, if they share it. */
  geo(id: string): { lat: number; lon: number } | null {
    const p = this.pose(id), m = this.member(id);
    const lat = p?.lat ?? m?.lat, lon = p?.lon ?? m?.lon;
    return okNum(lat) && okNum(lon) ? { lat, lon } : null;
  }
  livePings() { const now = Date.now(); return (this.pings = this.pings.filter((p) => now - p.ts < PING_MS)); }

  unread() { return this.chat.filter((m) => !m.mine && m.ts > this.readTs).length; }
  markRead() {
    const last = this.chat[this.chat.length - 1]?.ts ?? 0;
    if (last <= this.readTs) return;
    this.readTs = last;
    try { localStorage.setItem(READ_KEY, String(last)); } catch { /* private mode */ }
    this.emit('chat');
  }
}

let store: TeamStore | null = null;
export const teamStore = () => (store ??= new TeamStore());

/** "2h ago", "just now". */
export function agoShort(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

const VEHICLE_WORD: Record<string, string> = { skate: 'Skating', bike: 'Cycling', jeep: 'Driving', plane: 'Flying a plane', kayak: 'Kayaking', boat: 'On a boat', shuttle: 'In the shuttle' };

/** One line on where a teammate is: "In openWorld · Work floor", "Midtown, New York", "Last seen 2h ago". */
export function whereLine(m: TeamMember) {
  if (!m.online) return `Last seen ${agoShort(m.lastSeen)}`;
  if (m.idle) return 'Online · game closed';
  if (m.inside) return `In ${m.inside.label}${m.inside.room ? ` · ${m.inside.room}` : ''}`;
  const v = VEHICLE_WORD[m.vehicle];
  if (m.place) return v ? `${v} · ${m.place}` : m.place;
  return v ?? (m.lat == null ? 'Location not shared' : 'Out in the world');
}

/** One line on what they're working on: "work-loop · server/index.ts · 2 agents", or '' when nothing is shared. */
export function workLine(m: TeamMember) {
  const w = m.online ? m.work : null;
  if (!w) return '';
  const parts: string[] = [];
  if (w.branch) parts.push(w.branch);
  if (w.file) parts.push(w.file.split('/').slice(-2).join('/'));
  if (w.agentCount) parts.push(`${w.agentCount} agent${w.agentCount === 1 ? '' : 's'} working`);
  return parts.join(' · ');
}

export const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#8a93a2');
export const initials = (name: string) => (name.trim().split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?');
