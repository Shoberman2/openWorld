import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChildProcess } from 'node:child_process';
import type { AgentEvent, AgentInfo, Repo, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson, run, spawnProc, logEvent } from './config.ts';
import { getDefaultBranch } from './github.ts';

const NAMES = [
  'Nova', 'Atlas', 'Juniper', 'Orion', 'Wren', 'Sable', 'Indigo', 'Rook', 'Lyra', 'Cass',
  'Milo', 'Vega', 'Quinn', 'Echo', 'Sage', 'Bodhi', 'Iris', 'Pax', 'Remy', 'Tess',
];

const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(ls:*)',
  'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx tsc:*)',
];

interface LiveAgent {
  info: AgentInfo;
  dir: string;
  log: { event: AgentEvent; ts: number }[];
  proc: ChildProcess | null;
}

const agents = new Map<string, LiveAgent>();
let broadcast: (msg: ServerMsg) => void = () => {};

export function setBroadcaster(fn: (msg: ServerMsg) => void) {
  broadcast = fn;
}

// restore persisted agents; anything that was running when we died is now stopped
for (const info of readJson<AgentInfo[]>(PATHS.agents, [])) {
  if (info.status === 'running' || info.status === 'preparing') {
    info.status = 'stopped';
    info.endedAt = info.endedAt || new Date().toISOString();
  }
  agents.set(info.id, { info, dir: worktreeDir(info.repo, info.id), log: [], proc: null });
}

function worktreeDir(repo: string, id: string) {
  return join(PATHS.workspaces, `${repo}-agents`, id);
}

function persist() {
  writeJson(PATHS.agents, [...agents.values()].map((a) => a.info));
}

function update(a: LiveAgent, patch: Partial<AgentInfo>) {
  Object.assign(a.info, patch);
  persist();
  broadcast({ type: 'agent:update', agent: a.info });
}

function emit(a: LiveAgent, event: AgentEvent) {
  const entry = { event, ts: Date.now() };
  a.log.push(entry);
  if (a.log.length > 2000) a.log.splice(0, a.log.length - 2000);
  broadcast({ type: 'agent:event', agentId: a.info.id, event, ts: entry.ts });
}

export function listAgents(repo?: string): AgentInfo[] {
  return [...agents.values()]
    .map((a) => a.info)
    .filter((i) => !repo || i.repo.toLowerCase() === repo.toLowerCase())
    .sort((x, y) => y.startedAt.localeCompare(x.startedAt));
}

export function getAgent(id: string) {
  const a = agents.get(id);
  if (!a) throw Object.assign(new Error(`Unknown agent ${id}`), { status: 404 });
  return a;
}

export function agentLog(id: string) {
  return { events: getAgent(id).log };
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task';
}

function rel(dir: string, p: unknown) {
  const s = String(p ?? '');
  return s.startsWith(dir) ? s.slice(dir.length + 1) : s;
}

export function summarizeTool(name: string, input: any, dir: string): string {
  switch (name) {
    case 'Read': return `Reading ${rel(dir, input?.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${rel(dir, input?.file_path)}`;
    case 'Write': return `Writing ${rel(dir, input?.file_path)}`;
    case 'Glob': return `Looking for ${input?.pattern}`;
    case 'Grep': return `Searching for "${input?.pattern}"`;
    case 'Bash': return `Running ${String(input?.command ?? '').slice(0, 80)}`;
    case 'TodoWrite': return 'Planning next steps';
    case 'WebFetch': return `Reading ${input?.url}`;
    case 'WebSearch': return `Searching the web for ${input?.query}`;
    default: return `Using ${name}`;
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  return '';
}

async function emitDiff(a: LiveAgent) {
  try {
    const [stat, diff, porcelain] = await Promise.all([
      run('git', ['diff', '--stat'], { cwd: a.dir }),
      run('git', ['diff'], { cwd: a.dir }),
      run('git', ['status', '--porcelain'], { cwd: a.dir }),
    ]);
    const files = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
    const untracked = porcelain.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
    const statOut = stat + (untracked.length ? `\n new files: ${untracked.join(', ')}` : '');
    emit(a, { kind: 'diff', stat: statOut.trim(), diff: diff.length > 20_000 ? diff.slice(0, 20_000) + '\n... [truncated]' : diff, files });
    update(a, { filesChanged: files });
  } catch {
    /* worktree gone */
  }
}

async function prepareWorktree(repo: Repo, id: string, branch: string): Promise<string> {
  const base = join(PATHS.workspaces, repo.name);
  if (!existsSync(join(base, '.git'))) {
    await run('gh', ['repo', 'clone', repo.fullName, base], { timeoutMs: 10 * 60_000 });
  } else {
    await run('git', ['fetch', 'origin', '--prune'], { cwd: base, timeoutMs: 5 * 60_000 });
  }
  const def = getDefaultBranch(repo.name);
  const dir = worktreeDir(repo.name, id);
  mkdirSync(join(PATHS.workspaces, `${repo.name}-agents`), { recursive: true });
  await run('git', ['worktree', 'add', '-b', branch, dir, `origin/${def}`], { cwd: base, timeoutMs: 2 * 60_000 });
  return dir;
}

export async function startAgent(repo: Repo, task: string): Promise<AgentInfo> {
  task = task.trim();
  if (!task) throw Object.assign(new Error('Task is required'), { status: 400 });
  const id = Math.random().toString(36).slice(2, 8);
  const used = new Set(listAgents(repo.name).map((a) => a.name));
  const name = 'Agent ' + (NAMES.find((n) => !used.has('Agent ' + n)) || NAMES[agents.size % NAMES.length]);
  const branch = `openworld/${slugify(task)}-${id}`;
  const info: AgentInfo = {
    id, repo: repo.name, task, name, status: 'preparing', branch,
    startedAt: new Date().toISOString(), endedAt: null,
    lastAction: 'Getting a desk and cloning the repo', filesChanged: [], prUrl: null, costUsd: null,
  };
  const a: LiveAgent = { info, dir: worktreeDir(repo.name, id), log: [], proc: null };
  agents.set(id, a);
  update(a, {});
  emit(a, { kind: 'status', status: 'preparing', message: info.lastAction });
  logEvent('agent_started', { repo: repo.name });

  void (async () => {
    try {
      a.dir = await prepareWorktree(repo, id, branch);
    } catch (e: any) {
      update(a, { status: 'error', lastAction: `Setup failed: ${e.message}`, endedAt: new Date().toISOString() });
      emit(a, { kind: 'status', status: 'error', message: e.message });
      return;
    }
    if (a.info.status === 'stopped') return;
    launch(a);
  })();
  return info;
}

function launch(a: LiveAgent) {
  const child = spawnProc(
    'claude',
    [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ALLOWED_TOOLS.join(' '),
      '--append-system-prompt',
      'You are an agent working inside the OpenWorld game office for this repo. Make focused changes for the task. Do not push or open PRs; the user does that from the game.',
    ],
    { cwd: a.dir, stdio: ['pipe', 'pipe', 'pipe'], detached: true },
  );
  a.proc = child;
  update(a, { status: 'running', lastAction: 'Reading the task' });
  emit(a, { kind: 'status', status: 'running' });

  const pendingTools = new Map<string, string>();
  let stderr = '';
  child.stderr!.on('data', (d) => (stderr += d));
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    for (const { toolName, ...ev } of parseStreamLine(msg, a.dir, pendingTools)) {
      emit(a, ev as AgentEvent);
      if (ev.kind === 'tool') update(a, { lastAction: ev.summary });
      if (ev.kind === 'result') update(a, { costUsd: ev.costUsd });
      if (ev.kind === 'tool_result' && toolName && /^(Edit|MultiEdit|Write|Bash)$/.test(toolName)) void emitDiff(a);
    }
  });
  child.on('error', (e) => {
    update(a, { status: 'error', lastAction: e.message, endedAt: new Date().toISOString() });
    emit(a, { kind: 'status', status: 'error', message: e.message });
  });
  child.on('close', async (code) => {
    a.proc = null;
    await emitDiff(a);
    if (a.info.status === 'stopped') return;
    const ok = code === 0;
    update(a, {
      status: ok ? 'done' : 'error',
      endedAt: new Date().toISOString(),
      lastAction: ok ? `Finished — ${a.info.filesChanged.length} file(s) changed` : `Exited (${code}) ${stderr.trim().slice(0, 200)}`,
    });
    emit(a, { kind: 'status', status: a.info.status, message: a.info.lastAction });
    logEvent('agent_finished', { repo: a.info.repo, ok, files: a.info.filesChanged.length });
  });
  child.stdin!.end(a.info.task);
}

type ParsedEvent = AgentEvent & { toolName?: string };

/** Turn one stream-json line from `claude -p` into game events. Exported for testing. */
export function parseStreamLine(msg: any, dir: string, pendingTools: Map<string, string>): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text?.trim()) out.push({ kind: 'text', text: block.text });
      if (block.type === 'tool_use') {
        pendingTools.set(block.id, block.name);
        out.push({ kind: 'tool', tool: block.name, summary: summarizeTool(block.name, block.input, dir), input: block.input });
      }
    }
  } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      const text = resultText(block.content).trim();
      out.push({
        kind: 'tool_result',
        summary: text.slice(0, 200),
        isError: !!block.is_error,
        toolName: pendingTools.get(block.tool_use_id),
      });
    }
  } else if (msg.type === 'result') {
    out.push({ kind: 'result', text: typeof msg.result === 'string' ? msg.result : '', costUsd: msg.total_cost_usd ?? null });
  }
  return out;
}

export function stopAgent(id: string): AgentInfo {
  const a = getAgent(id);
  if (a.proc?.pid) {
    try {
      process.kill(-a.proc.pid, 'SIGTERM');
    } catch {
      a.proc.kill('SIGTERM');
    }
  }
  if (a.info.status === 'running' || a.info.status === 'preparing') {
    update(a, { status: 'stopped', endedAt: new Date().toISOString(), lastAction: 'Stopped by you' });
    emit(a, { kind: 'status', status: 'stopped' });
  }
  return a.info;
}

export async function openPr(id: string): Promise<AgentInfo> {
  const a = getAgent(id);
  if (a.proc) throw Object.assign(new Error('Agent is still working — stop it or wait for it to finish'), { status: 409 });
  if (a.info.prUrl) return a.info;
  if (!existsSync(a.dir)) throw Object.assign(new Error('Agent workspace no longer exists'), { status: 410 });
  const status = await run('git', ['status', '--porcelain'], { cwd: a.dir });
  const ahead = await run('git', ['rev-list', '--count', `origin/${getDefaultBranch(a.info.repo)}..HEAD`], { cwd: a.dir }).catch(() => '0');
  if (!status.trim() && ahead.trim() === '0') throw Object.assign(new Error('No changes to ship'), { status: 400 });
  const title = a.info.task.split('\n')[0].slice(0, 72);
  if (status.trim()) {
    await run('git', ['add', '-A'], { cwd: a.dir });
    const body = `${a.info.task}\n\nMade by ${a.info.name} in OpenWorld.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    await run('git', ['commit', '-m', title, '-m', body], { cwd: a.dir });
  }
  await run('git', ['push', '-u', 'origin', a.info.branch], { cwd: a.dir, timeoutMs: 5 * 60_000 });
  const url = (await run('gh', ['pr', 'create', '--fill', '--title', title, '--head', a.info.branch], { cwd: a.dir, timeoutMs: 2 * 60_000 })).trim();
  update(a, { prUrl: url.split('\n').pop() || url, lastAction: 'Opened a pull request' });
  logEvent('agent_pr_opened', { repo: a.info.repo });
  return a.info;
}
