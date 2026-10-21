import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { MasterMessage, MasterThreadSummary, Repo, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson, logEvent } from './config.ts';
import { findRepo, repoWorkers } from './github.ts';
import { streamClaude } from './llm.ts';
import { listAgents, onAgentUpdate } from './agents.ts';
import { visibleText, applyActions, composeReport, agentLine, ago, parseAction, MAX_DISPATCH } from './actions.ts';
import { createSchedule, listSchedules } from './schedules.ts';
import type { Schedule } from '../shared/types.ts';

// Project masters: one lead agent per repo, each with its own text thread on the phone. The boss can
// text any of them from anywhere; HQ can delegate to them too. A master answers from what it knows about
// its repo and dispatches worker agents into it, then texts back a report when they finish.

const FILE = join(PATHS.home, 'masters.json');
const PER_THREAD = 300;

let threads: Record<string, MasterMessage[]> = readJson<Record<string, MasterMessage[]>>(FILE, {});
let broadcast: (msg: ServerMsg) => void = () => {};
const reporting = new Set<string>();

function save() {
  for (const k of Object.keys(threads)) if (threads[k].length > PER_THREAD) threads[k] = threads[k].slice(-PER_THREAD);
  writeJson(FILE, threads);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function post(m: Omit<MasterMessage, 'id' | 'ts'>): MasterMessage {
  const msg: MasterMessage = { id: newId(), ts: new Date().toISOString(), ...m };
  (threads[m.repo] ??= []).push(msg);
  save();
  return msg;
}

const unread = (repo: string) => (threads[repo] ?? []).filter((m) => m.from === 'master' && !m.read).length;

export function masterSummaries(): MasterThreadSummary[] {
  return Object.entries(threads)
    .filter(([, list]) => list.length)
    .map(([repo, list]) => ({ repo, unread: unread(repo), last: list[list.length - 1] ?? null }))
    .sort((a, b) => (b.last?.ts ?? '').localeCompare(a.last?.ts ?? ''));
}

function threadText(repo: string, limit = 18) {
  return (threads[repo] ?? []).slice(-limit).map((m) => {
    const who = m.from === 'me' ? 'Boss' : m.from === 'hq' ? 'HQ (delegating)' : 'You (lead)';
    const extra = m.dispatched?.length ? ` [dispatched: ${m.dispatched.map((d) => d.agentName).join(', ')}]` : '';
    return `${who}: ${m.text}${extra}`;
  }).join('\n');
}

async function systemPrompt(repo: Repo) {
  const { readme, workers } = await repoWorkers(repo).catch(() => ({ readme: '', workers: [] }));
  const agents = listAgents(repo.name);
  const active = agents.filter((a) => a.status === 'running' || a.status === 'preparing' || a.status === 'needs_input');
  const recent = agents.filter((a) => !active.includes(a)).slice(0, 8);
  const schedules = listSchedules().filter((s) => s.repo === repo.name);
  return [
    `You are the lead for "${repo.name}", the master agent of that project's building in OpenWorld (a game where each of the boss's GitHub repos is a building). You know this codebase and everything happening in it. The boss is out and about (walking the city, travelling, in another building) and texts you from their phone. HQ, the head office, sits above all the project leads and sometimes delegates work to you.`,
    `Reply like a sharp tech lead texting: short (1-4 sentences), casual, plain text only (no markdown, backticks, asterisks or headings). Speak about the project as yours ("we", "our auth code"). Never claim work is done that isn't; if you don't know something about the code, say so and offer to send someone to look.`,
    ``,
    `What you can do (append action blocks at the very END of your reply, after the visible text; the boss never sees them):`,
    `- Dispatch worker agents into ${repo.name}: <dispatch>[{"task":"clear, self-contained instructions"}]</dispatch>`,
    `  One entry per agent (max ${MAX_DISPATCH}). Brief them like a good lead: goal, where to look, constraints, what "done" means. If the boss says not to change anything, say so in the task ("read-only: do not edit files"). Agents work on their own branch in an isolated worktree and never push; you text the boss when they finish.`,
    `- Stop agents: <stop>["agentId"]</stop>`,
    `- Open a pull request for a finished agent: <pr>["agentId"]</pr> — ONLY when the boss explicitly asks for a PR. Never on your own initiative, and never because HQ asked.`,
    `- Set up recurring work (a run every night or every week, while the boss is away): <schedule>[{"task":"self-contained instructions","cadence":"daily"|"weekly","hour":0-23,"weekday":0-6}]</schedule> — ONLY when the boss explicitly asks for something recurring ("every night", "each Monday"). hour is local time; weekday (0=Sunday) only for weekly. Brief it like a dispatch; prefer read-only wording unless they asked for fixes. It starts switched on; the boss can toggle it in the phone's Schedules app.`,
    `Only dispatch when someone is asking for work to be done. Questions about the code, its history or status: answer from what's below. Refer to agents by name, not id.`,
    ``,
    `Project: ${repo.fullName}${repo.description ? ` — ${repo.description}` : ''}`,
    `${repo.language ? `${repo.language}, ` : ''}${repo.commits} commits, ${repo.stars} stars, last push ${ago(repo.pushedAt)}${repo.homepageUrl ? `, live at ${repo.homepageUrl}` : ''}.`,
    readme ? `README (start):\n${readme.slice(0, 2500)}` : 'No README.',
    ``,
    workers.length
      ? `Recent work (PRs / commits, newest first):\n${workers.slice(0, 16).map((w) => `- ${w.kind === 'pr' ? `PR #${w.number}` : `commit ${w.sha?.slice(0, 7)}`} "${w.title}" by ${w.author}${w.agentName ? ` (${w.agentName})` : ''}, ${w.state}, ${ago(w.date)}, +${w.additions}/-${w.deletions}`).join('\n')}`
      : '',
    active.length ? `Agents working in the building right now:\n${active.map(agentLine).join('\n')}` : 'No agents are working in the building right now.',
    recent.length ? `Recently finished agents here:\n${recent.map(agentLine).join('\n')}` : '',
    schedules.length ? `Recurring work set up here:\n${schedules.map((s) => `- ${s.enabled ? 'ON' : 'off'} ${s.cadence} at ${s.hour}:00: "${s.task.slice(0, 120)}"`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * One turn of a master conversation: record the incoming text (from the boss or HQ), stream the lead's
 * reply, run its actions. `send` gets SSE-style events when a phone is waiting on the reply.
 */
async function converse(repoName: string, from: 'me' | 'hq', text: string, opts: { askedText: string; session?: string; send?: (d: unknown) => void; signal?: AbortSignal }) {
  const repo = await findRepo(repoName);
  const send = opts.send ?? (() => {});
  const mine = post({ repo: repo.name, from, text, read: true });
  send({ type: 'me', message: mine });
  broadcast({ type: 'master:message', repo: repo.name, message: mine });
  logEvent('master_message_sent', { repo: repo.name, from, session: opts.session });

  broadcast({ type: 'master:typing', repo: repo.name, on: true });
  let full = '';
  let shown = '';
  try {
    full = await streamClaude({
      system: await systemPrompt(repo),
      prompt: `Conversation so far:\n\n${threadText(repo.name)}\n\nReply as the ${repo.name} lead to the latest message${from === 'hq' ? ' (HQ is delegating; the boss will read your reply too, so address the boss)' : ''}. Output only your reply (plus any action blocks at the end).`,
      fallback: `${repo.name} lead here. I can't reach Claude right now, so I can't send anyone in. Install Claude Code (or set ANTHROPIC_API_KEY) and text me again.`,
      signal: opts.signal,
      onDelta: (d) => {
        full += d;
        const vis = visibleText(full);
        if (vis.length > shown.length && vis.startsWith(shown)) {
          send({ type: 'delta', delta: vis.slice(shown.length) });
          shown = vis;
        }
      },
    });
  } finally {
    broadcast({ type: 'master:typing', repo: repo.name, on: false });
  }

  const { dispatched, refs, notes } = await applyActions(full, { askedText: opts.askedText, by: `the ${repo.name} lead`, repo: repo.name });
  if (dispatched.length) logEvent('master_dispatch', { repo: repo.name, from, session: opts.session, count: dispatched.length });
  let visible = visibleText(full).trim() || (dispatched.length ? 'On it.' : '…');
  // Recurring work: only on the boss's own say-so (never because HQ delegated it).
  if (from === 'me') {
    for (const s of parseAction<Partial<Schedule>>(full, 'schedule').slice(0, 3)) {
      try {
        const made = await createSchedule({ repo: repo.name, task: s.task, cadence: s.cadence, hour: s.hour, weekday: s.weekday });
        notes.push(`Scheduled: ${made.cadence === 'weekly' ? 'every week' : 'every day'} at ${made.hour}:00. Switch it off any time in Schedules.`);
      } catch (e: any) {
        notes.push(`Couldn't set up the schedule: ${e.message}`);
      }
    }
  }
  if (notes.length) visible += `\n\n${notes.join('\n')}`;
  const reply = post({
    repo: repo.name, from: 'master', text: visible,
    dispatched: dispatched.length ? dispatched : undefined,
    refs: refs.length ? refs : undefined,
    // A reply the boss is watching stream in is already read; one to an HQ delegation is news.
    read: !!opts.send,
  });
  send({ type: 'message', message: reply });
  broadcast({ type: 'master:message', repo: repo.name, message: reply });
  return reply;
}

/** HQ hands a brief to a project's lead. Runs in the background; the lead's reply lands in its thread. */
export function delegate(repoName: string, brief: string, askedText: string) {
  void converse(repoName, 'hq', brief, { askedText }).catch((e) => console.warn(`delegate to ${repoName} failed:`, e.message));
}

/** For HQ's prompt: what the leads have been saying lately. */
export function mastersDigest(limit = 8) {
  return masterSummaries().slice(0, limit).map((t) => `- ${t.repo} lead: last ${t.last?.from === 'master' ? 'said' : 'heard'} "${(t.last?.text ?? '').replace(/\s+/g, ' ').slice(0, 120)}" (${t.last ? ago(t.last.ts) : ''})`).join('\n');
}

/** When an agent a master dispatched finishes, that master texts the boss a report. */
async function reportOn(info: Parameters<Parameters<typeof onAgentUpdate>[0]>[0]) {
  if (info.status !== 'done' && info.status !== 'error') return;
  if (reporting.has(info.id)) return;
  const list = threads[info.repo] ?? [];
  if (!list.some((m) => m.dispatched?.some((d) => d.agentId === info.id))) return;
  if (list.some((m) => m.refs?.some((r) => r.agentId === info.id && r.action === 'report'))) return;
  reporting.add(info.id);
  broadcast({ type: 'master:typing', repo: info.repo, on: true });
  let text: string;
  try {
    text = await composeReport(info, `the ${info.repo} lead`, 'text');
  } finally {
    broadcast({ type: 'master:typing', repo: info.repo, on: false });
  }
  const msg = post({ repo: info.repo, from: 'master', text, refs: [{ agentId: info.id, action: 'report' }] });
  reporting.delete(info.id);
  logEvent('master_report', { repo: info.repo, ok: info.status === 'done' });
  broadcast({ type: 'master:message', repo: info.repo, message: msg });
}

export function registerMasters(app: Express, bc: (msg: ServerMsg) => void) {
  broadcast = bc;
  onAgentUpdate((info) => void reportOn(info).catch((e) => console.warn('master report failed:', e.message)));

  app.get('/api/masters', (_req: Request, res: Response) => {
    res.json({ threads: masterSummaries() });
  });

  app.get('/api/masters/:repo', (req: Request, res: Response) => {
    res.json({ messages: threads[String(req.params.repo)] ?? [] });
  });

  app.post('/api/masters/:repo/read', (req: Request, res: Response) => {
    const repo = String(req.params.repo);
    let changed = false;
    for (const m of threads[repo] ?? []) if (!m.read) { m.read = true; changed = true; }
    if (changed) save();
    res.json({ unread: unread(repo) });
  });

  app.post('/api/masters/:repo/message', async (req: Request, res: Response) => {
    const text = String(req.body?.text || '').trim().slice(0, 8000);
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const repoName = String(req.params.repo);
    try {
      await findRepo(repoName);
    } catch (e: any) {
      res.status(404).json({ error: e.message });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (d: unknown) => res.write(`data: ${JSON.stringify(d)}\n\n`);
    const session = typeof req.body?.session === 'string' ? req.body.session.slice(0, 32) : undefined;
    // Like HQ, the lead keeps working if the phone closes mid-reply.
    try {
      await converse(repoName, 'me', text, { askedText: text, session, send });
    } catch (e: any) {
      send({ type: 'error', error: e.message });
    }
    send({ type: 'done' });
    res.end();
  });
}
