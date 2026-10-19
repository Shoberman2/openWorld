// Contract shared by the local server (server/) and the game client (client/).

export type CityId = 'nyc' | 'sf' | 'miami' | 'boston';

// ---------- Real places (OpenStreetMap) ----------
// GET /api/geo/search?q=          -> GeoPlace[]
// GET /api/geo/reverse?lat=&lon=  -> GeoPlace
// GET /api/tiles/{v|dem|sat}/z/x/y -> map tiles (vector, terrain, imagery), cached in ~/.openworld/cache/tiles

export interface GeoPlace {
  name: string;
  label: string; // "Times Square, New York, United States"
  lat: number;
  lon: number;
  countryCode: string;
  kind: string;
}

/** Building size class, derived from how "big" a repo is (commits, size, PRs, live site). */
export type Tier = 'landmark' | 'tower' | 'midrise' | 'small';

export interface Repo {
  name: string;
  owner: string;
  fullName: string;
  description: string;
  url: string;
  homepageUrl: string;
  isPrivate: boolean;
  language: string | null;
  languageColor: string | null;
  stars: number;
  diskKb: number;
  commits: number;
  prs: number;
  pushedAt: string;
  createdAt: string;
  score: number;
  tier: Tier;
  /** Served by the local server at /api/repos/:name/logo when a logo was found. */
  hasLogo: boolean;
  /** Brand color, guessed from the logo or language. */
  brandColor: string;
}

export interface Me {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  claudeAvailable: boolean;
  tokenSource: 'gh' | 'env' | 'config' | null;
}

/** A desk worker: one past PR or (for repos with no PRs) one past commit. */
export interface Worker {
  id: string; // "pr-12" or "c-<sha7>"
  kind: 'pr' | 'commit';
  number: number | null;
  sha: string | null;
  title: string;
  body: string;
  author: string;
  /** True when an AI agent wrote it (bot author or Co-Authored-By: Claude/Copilot/etc). */
  isAgent: boolean;
  agentName: string | null; // "Claude", "Copilot", "Codex", "Devin"...
  state: 'merged' | 'open' | 'closed' | 'committed';
  date: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: string[];
  url: string;
}

export interface RepoDetail {
  repo: Repo;
  readme: string; // first ~4k chars
  workers: Worker[];
  decisions: BoardDecision[];
  agents: AgentInfo[];
}

// ---------- Live agents (Claude Code running in a clone of the repo) ----------

export type AgentStatus = 'preparing' | 'running' | 'done' | 'error' | 'stopped';

export interface AgentInfo {
  id: string;
  repo: string;
  task: string;
  name: string; // human-ish name e.g. "Agent Nova"
  status: AgentStatus;
  branch: string;
  startedAt: string;
  endedAt: string | null;
  lastAction: string;
  filesChanged: string[];
  prUrl: string | null;
  costUsd: number | null;
}

export type AgentEvent =
  | { kind: 'status'; status: AgentStatus; message?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; summary: string; input?: unknown }
  | { kind: 'tool_result'; summary: string; isError: boolean }
  | { kind: 'diff'; stat: string; diff: string; files: string[] }
  | { kind: 'result'; text: string; costUsd: number | null };

// ---------- Boardroom ----------

export interface BoardMember {
  id: string; // "chair" | "cto" | "product" | "design" | "growth"
  name: string;
  role: string;
  color: string;
}

export interface BoardMessage {
  memberId: string;
  text: string;
  stance: 'for' | 'against' | 'neutral';
}

export interface BoardDecision {
  id: string;
  repo: string;
  question: string;
  messages: BoardMessage[];
  resolution: string;
  createdAt: string;
}

// ---------- WebSocket messages, server -> client ----------

export type ServerMsg =
  | { type: 'agent:update'; agent: AgentInfo }
  | { type: 'agent:event'; agentId: string; event: AgentEvent; ts: number }
  | { type: 'office:message'; message: OfficeMessage }
  | { type: 'office:typing'; on: boolean; channel: OfficeChannel };

// ---------- SSE streams ----------
// POST /api/talk       body TalkRequest       -> SSE events: {delta:string} ... {done:true}
// POST /api/boardroom  body BoardroomRequest  -> SSE events:
//      {type:'turn', memberId}  {type:'delta', memberId, delta}
//      {type:'message', message: BoardMessage}  {type:'resolution', text}  {type:'done', decision}
export interface TalkRequest {
  repo: string;
  workerId: string; // a Worker id, or "reception" for the lobby receptionist
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface BoardroomRequest {
  repo: string;
  question: string;
}

// ---------- REST summary ----------
// GET  /api/me                      -> Me
// POST /api/token {token}           -> Me             (save a GitHub token when gh is not available)
// GET  /api/repos                   -> Repo[]
// GET  /api/repos/:name             -> RepoDetail
// GET  /api/repos/:name/logo        -> image bytes (404 if none)
// GET  /api/agents                  -> AgentInfo[]
// POST /api/agents {repo, task}     -> AgentInfo
// GET  /api/agents/:id/log          -> {events: {event:AgentEvent, ts:number}[]}
// POST /api/agents/:id/stop         -> AgentInfo
// POST /api/agents/:id/pr           -> AgentInfo (commits, pushes branch, opens PR)
// POST /api/events {name, props}    -> {ok:true}     (local-only product analytics)
// GET  /api/stats                   -> learning metrics summary

// ---------- Office / phone ----------
// The office ("HQ") is one orchestrator agent that owns every repo and dispatches worker agents.
// POST /api/office/message {channel, text, subject?} -> SSE: {type:'me', message} {type:'delta', delta}
//      {type:'message', message} (HQ's final message, with dispatched agents) {type:'error', error} {type:'done'}
// GET  /api/office/thread  -> {messages: OfficeMessage[], unread: number}
// POST /api/office/read {channel?} -> {unread}   (marks HQ messages read, optionally for one channel)

export type OfficeChannel = 'text' | 'email';

export interface OfficeDispatch {
  agentId: string;
  agentName: string;
  repo: string;
  task: string;
}

export interface OfficeMessage {
  id: string;
  from: 'me' | 'hq';
  channel: OfficeChannel;
  subject?: string;
  text: string;
  ts: string;
  /** Worker agents HQ started because of this message. */
  dispatched?: OfficeDispatch[];
  /** Agents this message is about (stops, PRs, finish reports). */
  refs?: { agentId: string; action: 'stopped' | 'pr' | 'report' }[];
  read?: boolean;
}

export interface OfficeRequest {
  channel: OfficeChannel;
  text: string;
  subject?: string;
  /** Client session id, for local analytics only. */
  session?: string;
}
