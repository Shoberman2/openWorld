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
  /** True when at least one coding agent (Claude Code, Codex, Gemini, Grok, OpenCode) is ready to take tasks. */
  agentsReady?: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  claudeAvailable: boolean;
  tokenSource: 'gh' | 'env' | 'config' | null;
  /** Private repos are left out of the world (Settings, or OPENWORLD_PUBLIC_ONLY=1). */
  hidePrivate?: boolean;
  hidePrivateFromEnv?: boolean;
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

export type AgentStatus = 'preparing' | 'running' | 'needs_input' | 'done' | 'error' | 'stopped';

/** What the user decided at the lobby review station. null = not reviewed yet. */
export type ReviewState = 'pending' | 'approved' | 'changes_requested' | 'discarded';

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
  /** Set while status is 'needs_input': the question the agent is blocked on. */
  question?: string | null;
  /** Agent's own final summary of what it did (last result text). */
  summary?: string | null;
  /** `git diff --stat` one-liner, e.g. "3 files changed, +40 −12". */
  diffStat?: string | null;
  /** Review lifecycle; 'pending' once a run finishes with changes. */
  review?: ReviewState | null;
  /** Schedule that started this run, if any. */
  scheduleId?: string | null;
  /** Claude Code session, so answers and change requests resume the same conversation. */
  sessionId?: string | null;
  /** Which coding agent runs this (claude | codex | gemini | grok | opencode). Older runs have none and were Claude. */
  provider?: AgentProviderId;
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
  | { type: 'office:typing'; on: boolean; channel: OfficeChannel }
  | { type: 'master:message'; repo: string; message: MasterMessage }
  | { type: 'master:typing'; repo: string; on: boolean }
  | { type: 'pulse:update'; pulse: RepoPulse }
  | { type: 'schedule:update'; schedule: Schedule };

// ---------- Work pulse: the live state of each repo, drawn onto its building ----------
// GET /api/pulse            -> RepoPulse[]   (refreshed in the background ~every 2 min; WS pulse:update on change)
// GET /api/pulse/:repo      -> RepoPulse

export type CiState = 'passing' | 'failing' | 'pending' | 'none';

export interface PulsePr {
  number: number;
  title: string;
  author: string;
  isAgent: boolean;
  url: string;
  createdAt: string;
  isDraft: boolean;
}

export interface PulseIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  createdAt: string;
}

export interface PulseCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface RepoPulse {
  repo: string;
  ci: CiState;
  /** When the default branch entered its current CI state (best effort). */
  ciSince: string | null;
  openPrs: PulsePr[];
  openIssues: PulseIssue[];
  recentCommits: PulseCommit[]; // last ~10 on the default branch
  lastRelease: { tag: string; publishedAt: string } | null;
  pushedAt: string;
  /** No push in 30+ days. */
  stale: boolean;
  /** Agents in this repo with status preparing|running|needs_input. */
  activeAgents: number;
  /** Things waiting on the user: agent runs pending review + agents needing input + open PRs by agents. */
  needsYou: number;
  updatedAt: string;
}

// ---------- Agent review + questions ----------
// GET  /api/agents/:id/diff                      -> {stat: string, diff: string, files: string[]}
// POST /api/agents/:id/review {action, note?}    -> AgentInfo
//      action 'approve' = commit+push+open PR (same as /pr), 'changes' = resume the agent with note,
//      'discard' = mark discarded and remove the worktree
// POST /api/agents/:id/answer {text}             -> AgentInfo  (resumes a needs_input agent)
// Env OPENWORLD_FAKE_AGENTS=1: agents are simulated (no claude, no clone) with a fake diff, for tests/tutorials.
// Env OPENWORLD_DRY_PR=1: "approve" never pushes; it records a fake prUrl.

export type ReviewAction = 'approve' | 'changes' | 'discard';

// ---------- Schedules: project leads that work while you're away ----------
// GET    /api/schedules                 -> Schedule[]
// POST   /api/schedules {repo, task, cadence, hour, weekday?} -> Schedule
// PATCH  /api/schedules/:id {enabled?, task?, cadence?, hour?, weekday?} -> Schedule
// DELETE /api/schedules/:id             -> {ok:true}
// POST   /api/schedules/:id/run         -> AgentInfo   (run now)

export interface Schedule {
  id: string;
  repo: string;
  task: string;
  cadence: 'daily' | 'weekly';
  hour: number; // local hour 0-23
  weekday?: number; // 0=Sun, weekly only
  enabled: boolean;
  lastRunAt: string | null;
  lastAgentId: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

// ---------- Briefing: what happened while you were away (apartment desk, phone "Today") ----------
// GET /api/briefing?since=ISO   -> Briefing   (since defaults to the last time the briefing was opened)
// POST /api/briefing/seen       -> {ok:true}

export interface Briefing {
  since: string;
  finished: AgentInfo[]; // runs that ended since `since`
  needsReview: AgentInfo[]; // review === 'pending'
  needsInput: AgentInfo[]; // status === 'needs_input'
  failingCi: { repo: string; since: string | null }[];
  newPrs: (PulsePr & { repo: string })[];
  scheduled: Schedule[]; // enabled schedules, soonest first
  headline: string; // one-sentence plain summary, e.g. "3 runs finished overnight, 2 need your review."
}

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
  /** Repos whose project lead HQ handed this to (see masters). */
  delegated?: string[];
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

// ---------- Project masters (phone "Projects" app) ----------
// Every repo has a master agent: the lead for that building, reachable by text from anywhere.
// It knows the repo (README, recent PRs/commits, agents in the building), answers questions and
// dispatches worker agents into that repo. HQ sits above the masters and can delegate to them.
// GET  /api/masters                 -> {threads: MasterThreadSummary[]}  (only repos with messages)
// GET  /api/masters/:repo           -> {messages: MasterMessage[]}
// POST /api/masters/:repo/message {text} -> SSE, same events as /api/office/message
// POST /api/masters/:repo/read      -> {unread}

export interface MasterMessage {
  id: string;
  repo: string;
  /** 'hq' when HQ delegated work to this master. */
  from: 'me' | 'master' | 'hq';
  text: string;
  ts: string;
  dispatched?: OfficeDispatch[];
  refs?: { agentId: string; action: 'stopped' | 'pr' | 'report' }[];
  read?: boolean;
}

export interface MasterThreadSummary {
  repo: string;
  unread: number;
  last: MasterMessage | null;
}

// ---------- Project control (phone project page): act on a repo's PRs, issues and CI ----------
// GET  /api/projects/:repo/prs/:n                 -> PrDetail
// POST /api/projects/:repo/prs/:n/merge           -> ControlResult   (squash merge)
// POST /api/projects/:repo/prs/:n/close           -> ControlResult
// POST /api/projects/:repo/prs/:n/comment {body}  -> ControlResult
// GET  /api/projects/:repo/issues/:n              -> IssueDetail
// POST /api/projects/:repo/issues {title, body?}  -> ControlResult  (number/url of the new issue)
// POST /api/projects/:repo/issues/:n/close        -> ControlResult
// POST /api/projects/:repo/issues/:n/comment {body} -> ControlResult
// POST /api/projects/:repo/issues/:n/agent        -> AgentInfo      (an agent takes the issue as its task)
// POST /api/projects/:repo/ci/rerun               -> ControlResult  (re-runs the failed jobs of the latest failed Actions run)
// Every write refreshes that repo's pulse. Env OPENWORLD_DRY_GITHUB=1 (implied by OPENWORLD_DRY_PR=1): writes are
// logged, never sent, and answered with a fake success.

export interface PrDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  isAgent: boolean;
  url: string;
  isDraft: boolean;
  createdAt: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: { path: string; additions: number; deletions: number }[];
  ci: CiState;
  /** GitHub's mergeability: false = conflicts, null = still computing. */
  mergeable: boolean | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  comments: number;
}

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  labels: string[];
  createdAt: string;
  comments: number;
}

export interface ControlResult {
  ok: true;
  message: string;
  number?: number;
  url?: string;
  /** True when OPENWORLD_DRY_GITHUB kept the write from reaching GitHub. */
  dry?: boolean;
}

// ---------- Agent providers + your own keys (Settings → Agents & keys) ----------
// Keys live only on this machine, in ~/.openworld/config.json (mode 0600). The API never returns a key, only its last 4.
// GET    /api/providers                      -> ProvidersState
// POST   /api/providers/:id/key {key}        -> ProvidersState   (validated with a cheap API call; loopback only)
// DELETE /api/providers/:id/key              -> ProvidersState   (loopback only)
// POST   /api/providers/default {provider}   -> ProvidersState   (default agent for new tasks)
// POST   /api/providers/chat {provider, model} -> ProvidersState (who voices HQ, the leads and the desks)
// POST /api/agents accepts an optional {provider}.

export type AgentProviderId = 'claude' | 'codex' | 'gemini' | 'grok' | 'opencode';

export interface ProviderStatus {
  id: AgentProviderId;
  label: string; // "Claude Code"
  vendor: string; // "Anthropic"
  /** CLI found on PATH (and new enough). */
  installed: boolean;
  version: string | null;
  /** Signed in through the CLI's own login (no key needed). */
  signedIn: boolean;
  /** A key is stored in config (or set by env). */
  key: { set: boolean; last4: string | null; fromEnv: boolean };
  /** Can take a task right now. */
  ready: boolean;
  /** What to do when not ready, e.g. "Install Codex CLI: npm i -g @openai/codex". */
  hint: string | null;
  installCmd: string;
  keyUrl: string; // where to create a key
  keyPrefix: string; // "sk-ant-", "sk-", "AIza", "xai-"; "" when it borrows the other keys (OpenCode)
}

export interface ProvidersState {
  providers: ProviderStatus[];
  defaultProvider: AgentProviderId | null;
  chat: { provider: ChatProviderId | null; model: string | null; models: string[]; options: ChatProviderId[] };
  /** Any OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio, Groq…), or null when none is set up. */
  compat: CompatStatus | null;
  /** Keys can only be changed from this computer (not from a headset on the network). */
  canEdit: boolean;
}

export type ChatProviderId = 'anthropic' | 'claude-cli' | 'codex-cli' | 'openai' | 'gemini' | 'xai' | 'grok-cli' | 'compat';

export interface CompatStatus {
  preset: string | null; // "openrouter", "ollama"… or null for a custom URL
  baseUrl: string;
  model: string;
  key: { set: boolean; last4: string | null };
  fromEnv: boolean;
}

// POST   /api/providers/compat/test {preset?, baseUrl, key?, model?} -> CompatTest (loopback only)
// POST   /api/providers/compat      {preset?, baseUrl, key?, model}  -> ProvidersState (tested first; loopback only)
// DELETE /api/providers/compat                                       -> ProvidersState
export interface CompatTest { ok: boolean; message: string; models: string[] }
