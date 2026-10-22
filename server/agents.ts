import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChildProcess } from 'node:child_process';
import type { AgentEvent, AgentInfo, AgentProviderId, Repo, ReviewAction, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson, run, spawnProc, logEvent } from './config.ts';
import { getDefaultBranch } from './github.ts';
import { summarizeTool } from './providers/common.ts';
import { pickProvider, runner, runnerEnv } from './providers/index.ts';

export { summarizeTool } from './providers/common.ts';
export { parseStreamLine, sessionIdOf } from './providers/claude.ts';

const NAMES = [
  'Nova', 'Atlas', 'Juniper', 'Orion', 'Wren', 'Sable', 'Indigo', 'Rook', 'Lyra', 'Cass',
  'Milo', 'Vega', 'Quinn', 'Echo', 'Sage', 'Bodhi', 'Iris', 'Pax', 'Remy', 'Tess',
];

/** OPENWORLD_FAKE_AGENTS=1: simulated runs (no clone, no claude) with a believable log and diff, for tests and tutorials. */
const FAKE = process.env.OPENWORLD_FAKE_AGENTS === '1';
/** OPENWORLD_DRY_PR=1: approving never pushes; it records a made-up PR link. */
const DRY_PR = process.env.OPENWORLD_DRY_PR === '1';

interface LiveAgent {
  info: AgentInfo;
  dir: string;
  log: { event: AgentEvent; ts: number }[];
  proc: ChildProcess | null;
  /** Fake mode: the simulated diff, and a pending timer chain. */
  fake?: { diff: string; files: string[]; timer: NodeJS.Timeout | null; step: number; note: string };
}

const agents = new Map<string, LiveAgent>();
let broadcast: (msg: ServerMsg) => void = () => {};

export function setBroadcaster(fn: (msg: ServerMsg) => void) {
  broadcast = fn;
}

/** Other server modules (the office) can watch agent status changes. */
const updateListeners = new Set<(info: AgentInfo) => void>();
export function onAgentUpdate(fn: (info: AgentInfo) => void) {
  updateListeners.add(fn);
}

// restore persisted agents; anything that was running when we died is now stopped. needs_input runs
// survive: answering resumes the claude session by id.
for (const info of readJson<AgentInfo[]>(PATHS.agents, [])) {
  if (info.status === 'running' || info.status === 'preparing') {
    info.status = 'stopped';
    info.endedAt = info.endedAt || new Date().toISOString();
  }
  // Runs from before the review station: finished with changes and no PR means it's waiting on review.
  if (info.status === 'done' && info.filesChanged.length && !info.prUrl && info.review == null) info.review = 'pending';
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
  for (const fn of updateListeners) fn(a.info);
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

/** "3 files changed, +40 −12" from `git diff --shortstat` (or a raw unified diff). */
export function shortStat(files: number, diff: string): string {
  let add = 0, del = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return `${files} file${files === 1 ? '' : 's'} changed, +${add} −${del}`;
}

async function readDiff(a: LiveAgent): Promise<{ stat: string; diff: string; files: string[] }> {
  if (a.fake || FAKE) {
    const f = a.fake ?? fakeWork(a.info);
    const shown = f.step >= FAKE_EDIT_STEP || a.info.status === 'done' ? f : { diff: '', files: [] };
    return { stat: shown.files.length ? shortStat(shown.files.length, shown.diff) : '', diff: shown.diff, files: shown.files };
  }
  // Intent-to-add makes new files show up in the diff (openPr adds everything anyway).
  await run('git', ['add', '-N', '.'], { cwd: a.dir }).catch(() => {});
  const [stat, diff, porcelain] = await Promise.all([
    run('git', ['diff', '--stat'], { cwd: a.dir }),
    run('git', ['diff'], { cwd: a.dir }),
    run('git', ['status', '--porcelain'], { cwd: a.dir }),
  ]);
  const files = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  return { stat: stat.trim(), diff: diff.length > 200_000 ? diff.slice(0, 200_000) + '\n... [truncated]' : diff, files };
}

async function emitDiff(a: LiveAgent) {
  try {
    const d = await readDiff(a);
    emit(a, { kind: 'diff', stat: d.stat, diff: d.diff.length > 20_000 ? d.diff.slice(0, 20_000) + '\n... [truncated]' : d.diff, files: d.files });
    update(a, { filesChanged: d.files, diffStat: d.files.length ? shortStat(d.files.length, d.diff) : null });
  } catch {
    /* worktree gone */
  }
}

/** GET /api/agents/:id/diff */
export async function agentDiff(id: string) {
  const a = getAgent(id);
  if (!a.fake && !FAKE && !existsSync(a.dir)) return { stat: '', diff: '', files: a.info.filesChanged };
  return readDiff(a);
}

/** One clone/fetch/worktree-add at a time per repo: two agents hired together would race on the same clone. */
const repoLocks = new Map<string, Promise<unknown>>();
function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repo) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  repoLocks.set(repo, tail);
  void tail.then(() => { if (repoLocks.get(repo) === tail) repoLocks.delete(repo); });
  return next;
}

function prepareWorktree(repo: Repo, id: string, branch: string): Promise<string> {
  return withRepoLock(repo.name, () => addWorktree(repo, id, branch));
}

async function addWorktree(repo: Repo, id: string, branch: string): Promise<string> {
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

export async function startAgent(repo: Repo, task: string, requested?: AgentProviderId | string | null): Promise<AgentInfo> {
  task = task.trim();
  if (!task) throw Object.assign(new Error('Task is required'), { status: 400 });
  const provider = (await pickProvider(requested)) ?? (FAKE ? 'claude' : null);
  if (!provider) throw Object.assign(new Error('No coding agent is set up yet. Add one in Settings → Agents & keys.'), { status: 400 });
  const id = Math.random().toString(36).slice(2, 8);
  const used = new Set(listAgents(repo.name).map((a) => a.name));
  const name = 'Agent ' + (NAMES.find((n) => !used.has('Agent ' + n)) || NAMES[agents.size % NAMES.length]);
  const branch = `openworld/${slugify(task)}-${id}`;
  const info: AgentInfo = {
    id, repo: repo.name, task, name, status: 'preparing', branch,
    startedAt: new Date().toISOString(), endedAt: null,
    lastAction: 'Getting a desk and cloning the repo', filesChanged: [], prUrl: null, costUsd: null,
    question: null, summary: null, diffStat: null, review: null, provider,
  };
  const a: LiveAgent = { info, dir: worktreeDir(repo.name, id), log: [], proc: null };
  agents.set(id, a);
  update(a, {});
  emit(a, { kind: 'status', status: 'preparing', message: info.lastAction });
  logEvent('agent_started', { repo: repo.name, provider });

  if (FAKE) {
    a.fake = fakeWork(info);
    a.fake.timer = setTimeout(() => fakeStep(a), 1500);
    return info;
  }
  void (async () => {
    try {
      a.dir = await prepareWorktree(repo, id, branch);
    } catch (e: any) {
      update(a, { status: 'error', lastAction: `Setup failed: ${e.message}`, endedAt: new Date().toISOString() });
      emit(a, { kind: 'status', status: 'error', message: e.message });
      return;
    }
    if (a.info.status === 'stopped') return;
    launch(a, a.info.task);
  })();
  return info;
}

/** The `QUESTION: ...` line an agent ends its turn with when it's blocked on the user. Exported for testing. */
export function extractQuestion(text: string): string | null {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const m = lines[i].replace(/^[*_`>\s]+/, '').match(/^QUESTION:\s*[*_`]*\s*(.+?)[*_`]*$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/** The result text minus the QUESTION line, trimmed to a readable summary. */
function summaryOf(text: string) {
  return text.split('\n').filter((l) => !/^\W*QUESTION:/i.test(l.trim())).join('\n').trim().slice(0, 4000) || null;
}

/** Start (or, with the agent's session id, resume) its coding CLI in the agent's worktree. */
function launch(a: LiveAgent, prompt: string) {
  const r = runner(a.info.provider ?? 'claude')!;
  const resuming = !!a.info.sessionId;
  const cmd = r.command(prompt, a.info.sessionId ?? null, a.dir);
  const child = spawnProc(r.bin, cmd.args, {
    cwd: a.dir,
    stdio: [cmd.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: true,
    // PWD too: some CLIs (OpenCode) take their project from it, and the inherited one is the server's own folder.
    env: { ...runnerEnv(r), PWD: a.dir },
  });
  a.proc = child;
  update(a, { status: 'running', endedAt: null, question: null, lastAction: resuming ? 'Picking the work back up' : 'Reading the task' });
  emit(a, { kind: 'status', status: 'running' });

  const parse = r.parser(a.dir);
  let stderr = '';
  let resultText = '';
  child.stderr!.on('data', (d) => (stderr += d));
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { events, sessionId: sid } = parse(msg);
    if (sid && sid !== a.info.sessionId) update(a, { sessionId: sid });
    for (const { toolName, ...ev } of events) {
      emit(a, ev as AgentEvent);
      if (ev.kind === 'tool') update(a, { lastAction: ev.summary });
      if (ev.kind === 'result') {
        resultText = ev.text;
        if (ev.costUsd != null) update(a, { costUsd: (a.info.costUsd ?? 0) + ev.costUsd });
      }
      if (ev.kind === 'tool_result' && toolName && /^(Edit|MultiEdit|Write|Bash)$/.test(toolName)) void emitDiff(a);
    }
  });
  child.on('error', (e: any) => {
    const message = e?.code === 'ENOENT' ? `${r.label} isn't installed. ${r.installCmd}` : e.message;
    update(a, { status: 'error', lastAction: message, endedAt: new Date().toISOString() });
    emit(a, { kind: 'status', status: 'error', message });
  });
  child.on('close', async (code) => {
    a.proc = null;
    await emitDiff(a);
    if (a.info.status === 'stopped' || a.info.status === 'error') return;
    if (code === 0) finish(a, resultText);
    else {
      update(a, { status: 'error', endedAt: new Date().toISOString(), lastAction: `Exited (${code}) ${stderr.trim().slice(0, 200)}` });
      emit(a, { kind: 'status', status: 'error', message: a.info.lastAction });
      logEvent('agent_finished', { repo: a.info.repo, ok: false, files: a.info.filesChanged.length, provider: r.id });
    }
  });
  if (cmd.stdin != null) child.stdin!.end(cmd.stdin);
}

/** A turn ended cleanly: either the agent is waiting on a question, or the run is done and up for review. */
function finish(a: LiveAgent, resultText: string) {
  const question = extractQuestion(resultText);
  const summary = summaryOf(resultText) ?? a.info.summary ?? null;
  if (question) {
    update(a, { status: 'needs_input', question, summary, lastAction: `Asking you: ${question.slice(0, 120)}` });
    emit(a, { kind: 'status', status: 'needs_input', message: question });
    logEvent('agent_question', { repo: a.info.repo });
    return;
  }
  const files = a.info.filesChanged.length;
  update(a, {
    status: 'done',
    endedAt: new Date().toISOString(),
    question: null,
    summary,
    review: files && !a.info.prUrl ? 'pending' : a.info.review ?? null,
    lastAction: files ? `Finished — ${files} file(s) changed, ready for review` : 'Finished — no files changed',
  });
  emit(a, { kind: 'status', status: 'done', message: a.info.lastAction });
  logEvent('agent_finished', { repo: a.info.repo, ok: true, files });
}

/** POST /api/agents/:id/answer: the user answered the agent's question; continue the same session. */
export function answerAgent(id: string, text: string): AgentInfo {
  const a = getAgent(id);
  text = text.trim();
  if (!text) throw Object.assign(new Error('An answer is required'), { status: 400 });
  if (a.info.status !== 'needs_input') throw Object.assign(new Error(`${a.info.name} isn't waiting on a question`), { status: 409 });
  emit(a, { kind: 'text', text: `You: ${text}` });
  logEvent('agent_answered', { repo: a.info.repo });
  resume(a, `The user answered your question.\n\nQuestion: ${a.info.question ?? ''}\nAnswer: ${text}\n\nContinue the task.`);
  return a.info;
}

function resume(a: LiveAgent, prompt: string) {
  if (FAKE) {
    a.fake ??= fakeWork(a.info);
    a.fake.step = Math.max(a.fake.step, FAKE_QUESTION_STEP + 1);
    update(a, { status: 'running', endedAt: null, question: null, lastAction: 'Picking the work back up' });
    emit(a, { kind: 'status', status: 'running' });
    a.fake.timer = setTimeout(() => fakeStep(a), 1200);
    return;
  }
  if (!existsSync(a.dir)) throw Object.assign(new Error('Agent workspace no longer exists'), { status: 410 });
  if (!a.info.sessionId) throw Object.assign(new Error(`${a.info.name}'s session was lost; start a new run`), { status: 410 });
  launch(a, prompt);
}

/** POST /api/agents/:id/review: the user's decision at the review station. */
export async function reviewAgent(id: string, action: ReviewAction, note = '', fullName?: string): Promise<AgentInfo> {
  const a = getAgent(id);
  if (a.proc || a.info.status === 'running' || a.info.status === 'preparing') {
    throw Object.assign(new Error(`${a.info.name} is still working`), { status: 409 });
  }
  logEvent('agent_review', { repo: a.info.repo, action });
  if (action === 'approve') {
    const info = await openPr(id, fullName);
    update(a, { review: 'approved' });
    return info;
  }
  if (action === 'changes') {
    note = note.trim();
    if (!note) throw Object.assign(new Error('Say what to change'), { status: 400 });
    if (a.info.prUrl) throw Object.assign(new Error('A PR is already open for this run'), { status: 409 });
    update(a, { review: null });
    emit(a, { kind: 'text', text: `You asked for changes: ${note}` });
    if (FAKE) {
      a.fake = fakeWork(a.info, note);
      a.fake.step = FAKE_QUESTION_STEP + 1;
    }
    resume(a, `The user reviewed your changes and asked for this:\n\n${note}\n\nMake those changes, then summarize what you did.`);
    return a.info;
  }
  if (action === 'discard') {
    stopAgent(id);
    if (a.fake?.timer) clearTimeout(a.fake.timer);
    if (!FAKE && existsSync(a.dir)) {
      const base = join(PATHS.workspaces, a.info.repo);
      await run('git', ['worktree', 'remove', '--force', a.dir], { cwd: base }).catch(() => rmSync(a.dir, { recursive: true, force: true }));
      await run('git', ['branch', '-D', a.info.branch], { cwd: base }).catch(() => {});
    }
    update(a, { review: 'discarded', question: null, lastAction: 'Discarded by you' });
    return a.info;
  }
  throw Object.assign(new Error(`Unknown review action ${action}`), { status: 400 });
}

// ---------- fake agents (OPENWORLD_FAKE_AGENTS=1) ----------

const FAKE_EDIT_STEP = 6;
const FAKE_QUESTION_STEP = 4;
const asksUser = (task: string) => /\?|\bask me\b/i.test(task.split('\n\n(')[0]);

/** A plausible change for the task: which files, and a unified diff. Deterministic per agent. */
function fakeWork(info: AgentInfo, note = ''): NonNullable<LiveAgent['fake']> {
  const t = (info.task + ' ' + note).toLowerCase();
  // One diff section per file; a second hunk for the same file joins the first.
  const sections = new Map<string, string[]>();
  const hunk = (file: string, at: number, ctx: string[], del: string[], add: string[], isNew = false) => {
    const body = [...ctx.map((l) => ' ' + l), ...del.map((l) => '-' + l), ...add.map((l) => '+' + l)];
    const head = `@@ -${isNew ? 0 : at},${isNew ? 0 : ctx.length + del.length} +${isNew ? 1 : at},${ctx.length + add.length} @@`;
    const sec = sections.get(file);
    if (sec) { sec.push(head, ...body); return; }
    sections.set(file, [
      `diff --git a/${file} b/${file}`,
      ...(isNew ? ['new file mode 100644', 'index 0000000..3f2a9c1', '--- /dev/null'] : [`index 8c1d2e4..3f2a9c1 100644`, `--- a/${file}`]),
      `+++ b/${file}`, head, ...body,
    ]);
  };
  if (/readme|doc/.test(t)) {
    hunk('README.md', 1, [`# ${info.repo}`, ''], ['A project.'], [
      `${info.repo} — what it does, in one line, and who it's for.`, '', '## Setup', '', '```sh', 'npm install', 'npm run dev', '```', '',
      '## Scripts', '', '| Command | What it does |', '|---|---|', '| `npm run dev` | Start the dev server |', '| `npm test` | Run the test suite |',
    ]);
  }
  if (/test/.test(t)) {
    hunk('tests/dates.test.ts', 0, [], [], [
      "import { describe, it, expect } from 'vitest';", "import { parseDate } from '../src/dates';", '',
      "describe('parseDate', () => {", "  it('reads ISO dates', () => {", "    expect(parseDate('2026-10-20').getDate()).toBe(20);", '  });',
      "  it('rejects garbage', () => {", "    expect(() => parseDate('soon')).toThrow();", '  });', '});',
    ], true);
  }
  if (!sections.size || /bug|fix|error|crash|handl/.test(t)) {
    hunk('src/dates.ts', 12, ['export function parseDate(input: string): Date {'], ['  return new Date(input);'], [
      '  const d = new Date(input);', '  // new Date("soon") is an Invalid Date, not an error; callers assumed it threw.',
      '  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${input}`);', '  return d;',
    ]);
    hunk('src/api/events.ts', 41, ['  const start = parseDate(body.start);'], ['  const end = parseDate(body.end);'], [
      '  const end = body.end ? parseDate(body.end) : new Date(start.getTime() + 60 * 60 * 1000);',
      "  if (end < start) return res.status(400).json({ error: 'end is before start' });",
    ]);
  }
  if (note) {
    hunk('src/dates.ts', 30, ['}'], [], ['', '/** Same as parseDate, but returns null instead of throwing. */',
      'export function tryParseDate(input: string): Date | null {', '  try { return parseDate(input); } catch { return null; }', '}']);
  }
  return { diff: [...sections.values()].map((x) => x.join('\n')).join('\n') + '\n', files: [...sections.keys()], timer: null, step: 0, note };
}

/** One beat of a simulated run; reschedules itself until the run finishes or asks a question. */
function fakeStep(a: LiveAgent) {
  const f = a.fake!;
  f.timer = null;
  if (a.info.status === 'stopped' || a.info.review === 'discarded') return;
  const file = f.files[0] ?? 'src/index.ts';
  const tool = (name: string, input: Record<string, unknown>, result: string) => {
    const summary = summarizeTool(name, input, '');
    emit(a, { kind: 'tool', tool: name, summary, input });
    emit(a, { kind: 'tool_result', summary: result, isError: false });
    update(a, { lastAction: summary });
  };
  const step = f.step++;
  if (step === 0) {
    update(a, { status: 'running', lastAction: 'Reading the task' });
    emit(a, { kind: 'status', status: 'running' });
    emit(a, { kind: 'text', text: "I'll start by getting the lay of the land: project layout, then the code the task touches." });
  } else if (step === 1) tool('Glob', { pattern: '**/*.{ts,md,json}' }, `README.md\npackage.json\n${f.files.join('\n')}`);
  else if (step === 2) tool('Read', { file_path: 'README.md' }, `# ${a.info.repo}`);
  else if (step === 3) tool('Grep', { pattern: file.includes('test') ? 'parseDate' : 'new Date(' }, `${file}:12`);
  else if (step === FAKE_QUESTION_STEP) {
    tool('Read', { file_path: file }, `export function parseDate(input: string): Date {`);
    if (asksUser(a.info.task)) {
      const question = 'Should an invalid date throw an error, or quietly fall back to "now"? Callers do both today.';
      emit(a, { kind: 'text', text: `I found two callers that disagree on this.\n\nQUESTION: ${question}` });
      emit(a, { kind: 'result', text: `I found two callers that disagree on this.\n\nQUESTION: ${question}`, costUsd: 0.04 });
      update(a, { costUsd: (a.info.costUsd ?? 0) + 0.04 });
      finish(a, `I found two callers that disagree on this.\n\nQUESTION: ${question}`);
      return;
    }
  } else if (step === 5) emit(a, { kind: 'text', text: `The root cause is in ${file}: it trusts its input. I'll make it explicit and update the caller.` });
  else if (step < FAKE_EDIT_STEP + f.files.length) {
    const target = f.files[step - FAKE_EDIT_STEP];
    tool(target.startsWith('tests/') ? 'Write' : 'Edit', { file_path: target }, 'The file has been updated.');
    void emitDiff(a);
  } else if (step === FAKE_EDIT_STEP + f.files.length) tool('Bash', { command: 'npm test' }, 'Tests: 24 passed, 24 total');
  else {
    const summary = `${f.note ? `Done: "${f.note.slice(0, 120).replace(/[.!]+$/, '')}". Added \`tryParseDate\`, which returns null instead of throwing. ` : ''}Changed ${f.files.map((x) => '`' + x + '`').join(', ')}. ${f.files.some((x) => x.startsWith('src/')) ? 'Invalid dates now throw a clear RangeError instead of slipping through as Invalid Date, and the events API defaults a missing end time to one hour after the start.' : 'The README now explains what the project is, how to set it up, and the scripts.'} All 24 tests pass.`;
    const cost = 0.18 + (a.info.id.charCodeAt(0) % 20) / 100;
    emit(a, { kind: 'text', text: summary });
    emit(a, { kind: 'result', text: summary, costUsd: cost });
    update(a, { costUsd: (a.info.costUsd ?? 0) + cost });
    void emitDiff(a).then(() => finish(a, summary));
    return;
  }
  f.timer = setTimeout(() => fakeStep(a), 1600 + ((a.info.id.charCodeAt(step % a.info.id.length) * 37) % 1400));
}

export function stopAgent(id: string): AgentInfo {
  const a = getAgent(id);
  if (a.fake?.timer) { clearTimeout(a.fake.timer); a.fake.timer = null; }
  if (a.proc?.pid) {
    try {
      process.kill(-a.proc.pid, 'SIGTERM');
    } catch {
      a.proc.kill('SIGTERM');
    }
  }
  if (a.info.status === 'running' || a.info.status === 'preparing' || a.info.status === 'needs_input') {
    update(a, { status: 'stopped', endedAt: new Date().toISOString(), question: null, lastAction: 'Stopped by you' });
    emit(a, { kind: 'status', status: 'stopped' });
  }
  return a.info;
}

/** Agents with a push or PR under way: a double click must not push twice or open two PRs. */
const shipping = new Set<string>();

export async function openPr(id: string, fullName?: string): Promise<AgentInfo> {
  const a = getAgent(id);
  if (shipping.has(id)) throw Object.assign(new Error('The pull request is already being opened'), { status: 409 });
  shipping.add(id);
  try {
    return await shipPr(a, fullName);
  } finally {
    shipping.delete(id);
  }
}

async function shipPr(a: LiveAgent, fullName?: string): Promise<AgentInfo> {
  if (a.proc || a.fake?.timer) throw Object.assign(new Error('Agent is still working — stop it or wait for it to finish'), { status: 409 });
  if (a.info.prUrl) return a.info;
  if (a.info.review === 'discarded') throw Object.assign(new Error('This run was discarded'), { status: 410 });
  if (DRY_PR || FAKE) {
    if (!a.info.filesChanged.length) throw Object.assign(new Error('No changes to ship'), { status: 400 });
    const n = 100 + (parseInt(a.info.id, 36) % 900);
    update(a, { prUrl: `https://github.com/${fullName || `you/${a.info.repo}`}/pull/${n}`, review: 'approved', lastAction: 'Opened a pull request (dry run)' });
    logEvent('agent_pr_opened', { repo: a.info.repo, dry: true });
    return a.info;
  }
  if (!existsSync(a.dir)) throw Object.assign(new Error('Agent workspace no longer exists'), { status: 410 });
  const status = await run('git', ['status', '--porcelain'], { cwd: a.dir });
  const ahead = await run('git', ['rev-list', '--count', `origin/${getDefaultBranch(a.info.repo)}..HEAD`], { cwd: a.dir }).catch(() => '0');
  if (!status.trim() && ahead.trim() === '0') throw Object.assign(new Error('No changes to ship'), { status: 400 });
  const title = a.info.task.split('\n')[0].slice(0, 72);
  if (status.trim()) {
    await run('git', ['add', '-A'], { cwd: a.dir });
    const coAuthor = a.info.provider === 'claude' || !a.info.provider ? '\n\nCo-Authored-By: Claude <noreply@anthropic.com>' : '';
    const body = `${a.info.task}\n\nMade by ${a.info.name} (${runner(a.info.provider)?.label ?? 'an AI agent'}) in OpenWorld.${coAuthor}`;
    await run('git', ['commit', '-m', title, '-m', body], { cwd: a.dir });
  }
  await run('git', ['push', '-u', 'origin', a.info.branch], { cwd: a.dir, timeoutMs: 5 * 60_000 });
  const url = (await run('gh', ['pr', 'create', '--fill', '--title', title, '--head', a.info.branch], { cwd: a.dir, timeoutMs: 2 * 60_000 })).trim();
  update(a, { prUrl: url.split('\n').pop() || url, review: 'approved', lastAction: 'Opened a pull request' });
  logEvent('agent_pr_opened', { repo: a.info.repo });
  return a.info;
}

/** Agents run in their own process groups (detached), so they'd outlive the server: stop them with it. */
export function stopAllAgents() {
  for (const a of agents.values()) {
    if (a.fake?.timer) clearTimeout(a.fake.timer);
    if (!a.proc?.pid) continue;
    try { process.kill(-a.proc.pid, 'SIGTERM'); } catch { a.proc.kill('SIGTERM'); }
    a.info.status = 'stopped';
    a.info.endedAt = new Date().toISOString();
    a.info.lastAction = 'Stopped when OpenWorld shut down';
  }
  persist();
}
