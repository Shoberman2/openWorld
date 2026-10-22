import type { ProvidersState, CompatTest, AgentEvent, AgentInfo, ReviewAction, Me, Repo, RepoDetail, ServerMsg, TalkRequest, BoardroomRequest, OfficeChannel, OfficeMessage, OfficeRequest, MasterMessage, MasterThreadSummary, Schedule, Briefing, RepoPulse, PrDetail, IssueDetail, ControlResult } from '../../shared/types.ts';

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
  /** provider: which coding agent (claude | codex | gemini); the server falls back to the user's default. */
  startAgent: (repo: string, task: string, provider?: string | null) =>
    fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo, task, provider: provider || undefined }) }).then((r) => json<AgentInfo>(r)),
  agentLog: (id: string) => fetch(`/api/agents/${id}/log`).then((r) => json<{ events: { event: AgentEvent; ts: number }[] }>(r)),
  stopAgent: (id: string) => fetch(`/api/agents/${id}/stop`, { method: 'POST' }).then((r) => json<AgentInfo>(r)),
  openPr: (id: string) => fetch(`/api/agents/${id}/pr`, { method: 'POST' }).then((r) => json<AgentInfo>(r)),
  agentDiff: (id: string) => fetch(`/api/agents/${id}/diff`).then((r) => json<{ stat: string; diff: string; files: string[] }>(r)),
  reviewAgent: (id: string, action: ReviewAction, note?: string) =>
    fetch(`/api/agents/${id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, note }) }).then((r) => json<AgentInfo>(r)),
  answerAgent: (id: string, text: string) =>
    fetch(`/api/agents/${id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).then((r) => json<AgentInfo>(r)),
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

// ---------- Project masters (each repo's lead agent) via the phone ----------
type ConvoEvent<M> = { type: 'me' | 'delta' | 'message' | 'error' | 'done'; message?: M; delta?: string; error?: string };
export const masters = {
  list: () => fetch('/api/masters').then((r) => json<{ threads: MasterThreadSummary[] }>(r)),
  thread: (repo: string) => fetch(`/api/masters/${encodeURIComponent(repo)}`).then((r) => json<{ messages: MasterMessage[] }>(r)),
  markRead: (repo: string) => fetch(`/api/masters/${encodeURIComponent(repo)}/read`, { method: 'POST' }).then((r) => json<{ unread: number }>(r)),
  send: (repo: string, text: string, onEvent: (d: ConvoEvent<MasterMessage>) => void) =>
    postSSE(`/api/masters/${encodeURIComponent(repo)}/message`, { text, session: sessionId }, onEvent),
};

// ---------- Schedules (project leads that work while you're away) and the briefing ----------
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
export const schedules = {
  list: () => fetch('/api/schedules').then((r) => json<Schedule[]>(r)),
  create: (s: { repo: string; task: string; cadence: Schedule['cadence']; hour: number; weekday?: number; enabled?: boolean }) =>
    fetch('/api/schedules', send('POST', s)).then((r) => json<Schedule>(r)),
  update: (id: string, patch: Partial<Pick<Schedule, 'enabled' | 'task' | 'cadence' | 'hour' | 'weekday'>>) =>
    fetch(`/api/schedules/${encodeURIComponent(id)}`, send('PATCH', patch)).then((r) => json<Schedule>(r)),
  remove: (id: string) => fetch(`/api/schedules/${encodeURIComponent(id)}`, send('DELETE')).then((r) => json<{ ok: true }>(r)),
  run: (id: string) => fetch(`/api/schedules/${encodeURIComponent(id)}/run`, send('POST')).then((r) => json<AgentInfo>(r)),
};
export const briefing = {
  get: (since?: string) => fetch(`/api/briefing${since ? `?since=${encodeURIComponent(since)}` : ''}`).then((r) => json<Briefing>(r)),
  seen: () => fetch('/api/briefing/seen', send('POST')).then((r) => json<{ ok: true }>(r)),
};

// ---------- Work pulse (CI, PRs, issues, commits, releases per repo) ----------
export const pulse = {
  all: () => fetch('/api/pulse').then((r) => json<RepoPulse[]>(r)),
  repo: (name: string) => fetch(`/api/pulse/${encodeURIComponent(name)}`).then((r) => json<RepoPulse>(r)),
};

// ---------- Project control (phone project page) ----------
const repoUrl = (repo: string) => `/api/projects/${encodeURIComponent(repo)}`;
const postJson = <T>(url: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));
export const projects = {
  pr: (repo: string, n: number) => fetch(`${repoUrl(repo)}/prs/${n}`).then((r) => json<PrDetail>(r)),
  issue: (repo: string, n: number) => fetch(`${repoUrl(repo)}/issues/${n}`).then((r) => json<IssueDetail>(r)),
  merge: (repo: string, n: number) => postJson<ControlResult>(`${repoUrl(repo)}/prs/${n}/merge`),
  closePr: (repo: string, n: number) => postJson<ControlResult>(`${repoUrl(repo)}/prs/${n}/close`),
  commentPr: (repo: string, n: number, body: string) => postJson<ControlResult>(`${repoUrl(repo)}/prs/${n}/comment`, { body }),
  createIssue: (repo: string, title: string, body: string) => postJson<ControlResult>(`${repoUrl(repo)}/issues`, { title, body }),
  closeIssue: (repo: string, n: number) => postJson<ControlResult>(`${repoUrl(repo)}/issues/${n}/close`),
  commentIssue: (repo: string, n: number, body: string) => postJson<ControlResult>(`${repoUrl(repo)}/issues/${n}/comment`, { body }),
  issueToAgent: (repo: string, n: number, provider?: string | null) => postJson<AgentInfo>(`${repoUrl(repo)}/issues/${n}/agent`, { provider: provider || undefined }),
  rerunCi: (repo: string) => postJson<ControlResult>(`${repoUrl(repo)}/ci/rerun`),
};

// ---------- Agents & keys (Settings): the user's own keys stay on the server; only the last 4 come back ----------
const sendJson = <T>(method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => json<T>(r));
export const providers = {
  state: () => fetch('/api/providers').then((r) => json<ProvidersState>(r)),
  saveKey: (id: string, key: string) => sendJson<ProvidersState>('POST', `/api/providers/${encodeURIComponent(id)}/key`, { key }),
  removeKey: (id: string) => sendJson<ProvidersState>('DELETE', `/api/providers/${encodeURIComponent(id)}/key`),
  setDefault: (provider: string) => sendJson<ProvidersState>('POST', '/api/providers/default', { provider }),
  setChat: (provider: string, model?: string) => sendJson<ProvidersState>('POST', '/api/providers/chat', { provider, model }),
  testCompat: (c: { preset?: string; baseUrl: string; key?: string; model?: string }) => sendJson<CompatTest>('POST', '/api/providers/compat/test', c),
  saveCompat: (c: { preset?: string; baseUrl: string; key?: string; model: string }) => sendJson<ProvidersState>('POST', '/api/providers/compat', c),
  removeCompat: () => sendJson<ProvidersState>('DELETE', '/api/providers/compat'),
};
