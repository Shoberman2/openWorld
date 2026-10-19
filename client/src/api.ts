import type { AgentEvent, AgentInfo, Me, Repo, RepoDetail, ServerMsg, TalkRequest, BoardroomRequest, OfficeChannel, OfficeMessage, OfficeRequest } from '../../shared/types.ts';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  me: () => fetch('/api/me').then((r) => json<Me>(r)),
  saveToken: (token: string) =>
    fetch('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).then((r) => json<Me>(r)),
  repos: () => fetch('/api/repos').then((r) => json<Repo[]>(r)),
  repo: (name: string) => fetch(`/api/repos/${encodeURIComponent(name)}`).then((r) => json<RepoDetail>(r)),
  logoUrl: (name: string) => `/api/repos/${encodeURIComponent(name)}/logo`,
  agents: () => fetch('/api/agents').then((r) => json<AgentInfo[]>(r)),
  startAgent: (repo: string, task: string) =>
    fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo, task }) }).then((r) => json<AgentInfo>(r)),
  agentLog: (id: string) => fetch(`/api/agents/${id}/log`).then((r) => json<{ events: { event: AgentEvent; ts: number }[] }>(r)),
  stopAgent: (id: string) => fetch(`/api/agents/${id}/stop`, { method: 'POST' }).then((r) => json<AgentInfo>(r)),
  openPr: (id: string) => fetch(`/api/agents/${id}/pr`, { method: 'POST' }).then((r) => json<AgentInfo>(r)),
};

/** POST that returns a text/event-stream; calls onEvent with each parsed `data:` JSON payload. */
export async function postSSE<T = unknown>(url: string, body: unknown, onEvent: (data: T) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          try { onEvent(JSON.parse(line.slice(5).trim()) as T); } catch { /* ignore partial */ }
        }
      }
    }
  }
}

export const talk = (req: TalkRequest, onEvent: (d: { delta?: string; done?: boolean; error?: string }) => void, signal?: AbortSignal) =>
  postSSE('/api/talk', req, onEvent, signal);

export const boardroom = (req: BoardroomRequest, onEvent: (d: any) => void, signal?: AbortSignal) =>
  postSSE('/api/boardroom', req, onEvent, signal);

// ---------- WebSocket: live agent updates ----------
type Listener = (msg: ServerMsg) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;

export function connectLive() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as ServerMsg;
      listeners.forEach((l) => l(msg));
    } catch { /* ignore */ }
  };
  ws.onclose = () => setTimeout(connectLive, 2000);
}

export function onLive(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------- Local-only product analytics (written to ~/.openworld/events.jsonl) ----------
const sessionId = Math.random().toString(36).slice(2, 10);
export const getSessionId = () => sessionId;
export function track(name: string, props: Record<string, unknown> = {}) {
  fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Headless test runs are tagged so they don't count toward the learning metrics.
    body: JSON.stringify({ name, props: { ...props, session: sessionId, ...(navigator.webdriver ? { automated: true } : {}) } }),
  }).catch(() => {});
}

// ---------- Office (HQ) via the phone ----------
export const office = {
  thread: () => fetch('/api/office/thread').then((r) => json<{ messages: OfficeMessage[]; unread: number }>(r)),
  markRead: (channel?: OfficeChannel) =>
    fetch('/api/office/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel }) }).then((r) => json<{ unread: number }>(r)),
  send: (req: OfficeRequest, onEvent: (d: { type: 'me' | 'delta' | 'message' | 'error' | 'done'; message?: OfficeMessage; delta?: string; error?: string }) => void) =>
    postSSE('/api/office/message', { ...req, session: sessionId }, onEvent),
};
