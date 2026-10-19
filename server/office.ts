import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { AgentInfo, OfficeChannel, OfficeDispatch, OfficeMessage, OfficeRequest, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson, logEvent } from './config.ts';
import { listRepos, findRepo } from './github.ts';
import { streamClaude } from './llm.ts';
import { listAgents, startAgent, stopAgent, openPr, agentLog, onAgentUpdate } from './agents.ts';

// "HQ": the office as one orchestrator agent. You text or email it from the in-game phone; it answers,
// dispatches worker agents into repo buildings, stops them, and reports back when they finish.

const FILE = join(PATHS.home, 'office.json');
const ACTION_TAGS = ['dispatch', 'stop', 'pr'];
const MAX_DISPATCH = 5;

let messages: OfficeMessage[] = readJson<OfficeMessage[]>(FILE, []);
let broadcast: (msg: ServerMsg) => void = () => {};
const reporting = new Set<string>();

function save() {
  if (messages.length > 500) messages = messages.slice(-500);
  writeJson(FILE, messages);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function post(m: Omit<OfficeMessage, 'id' | 'ts'>): OfficeMessage {
  const msg: OfficeMessage = { id: newId(), ts: new Date().toISOString(), ...m };
  messages.push(msg);
  save();
  return msg;
}

const unread = () => messages.filter((m) => m.from === 'hq' && !m.read).length;

/** Visible part of a streamed reply: everything before an action tag (or a partial one at the end). */
export function visibleText(full: string): string {
  const re = new RegExp(`<(${ACTION_TAGS.join('|')})>`, 'i');
  const m = re.exec(full);
  let out = m ? full.slice(0, m.index) : full;
  const lt = out.lastIndexOf('<');
  if (lt >= 0) {
    const tail = out.slice(lt + 1).toLowerCase();
    if (!tail.includes('>') && ACTION_TAGS.some((t) => (t + '>').startsWith(tail))) out = out.slice(0, lt);
  }
  return out;
}

/** Pull a JSON array out of <tag>[...]</tag>. */
export function parseAction<T>(full: string, tag: string): T[] {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(full);
  if (!m) return [];
  try {
    const v = JSON.parse(m[1].trim());
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? `${Math.round(d)} days ago` : `${Math.round(d / 30)} months ago`;
}

function agentLine(a: AgentInfo) {
  const cost = a.costUsd != null ? `, $${a.costUsd.toFixed(2)}` : '';
  return `- [${a.id}] ${a.name} in ${a.repo} — ${a.status}${cost}. Task: "${a.task.slice(0, 140)}". Last: ${a.lastAction.slice(0, 120)}. Files changed: ${a.filesChanged.slice(0, 8).join(', ') || 'none'}${a.prUrl ? `. PR: ${a.prUrl}` : ''}`;
}

function threadText(limit = 18) {
  return messages.slice(-limit).map((m) => {
    const who = m.from === 'me' ? 'Boss' : 'HQ';
    const via = m.channel === 'email' ? `email${m.subject ? ` "${m.subject}"` : ''}` : 'text';
    const extra = m.dispatched?.length ? ` [dispatched: ${m.dispatched.map((d) => `${d.agentName}→${d.repo}`).join(', ')}]` : '';
    return `${who} (${via}): ${m.text}${extra}`;
  }).join('\n');
}

async function systemPrompt(channel: OfficeChannel) {
  const repos = await listRepos().catch(() => []);
  const agents = listAgents();
  const active = agents.filter((a) => a.status === 'running' || a.status === 'preparing');
  const recent = agents.filter((a) => !active.includes(a)).slice(0, 12);
  return [
    `You are HQ, the head office in OpenWorld: a game where each of the boss's GitHub repositories is a building in a city. You are one agent connected to many others — you run every building and can dispatch AI coding agents (Claude Code) to work inside any repo. The boss is out walking the city and contacts you from their phone.`,
    channel === 'text'
      ? `This is a TEXT message thread. Reply like a sharp chief of staff texting: short (1-4 sentences), casual, plain text only (no markdown, backticks, asterisks or headings), no bullet lists unless listing agents.`
      : `This is an EMAIL. Reply as a proper but brief email: a greeting line ("Hi,"), a few short paragraphs, then sign off with "— HQ". Plain text, no markdown (no backticks, asterisks or headings).`,
    ``,
    `What you can do (append action blocks at the very END of your reply, after the visible text; the boss never sees them):`,
    `- Dispatch worker agents: <dispatch>[{"repo":"exact-repo-name","task":"clear, self-contained instructions for the agent"}]</dispatch>`,
    `  One entry per agent; several repos or several agents per repo are fine (max ${MAX_DISPATCH}). Write tasks the way a good engineering manager briefs an engineer: goal, where to look, constraints, what "done" means. If the boss says not to change anything, say so in the task ("read-only: do not edit files").`,
    `  Agents work on their own git branch in an isolated worktree, never push, and you report back when they finish.`,
    `- Stop agents: <stop>["agentId"]</stop>`,
    `- Open a pull request for a finished agent: <pr>["agentId"]</pr> — ONLY when the boss explicitly asks for a PR in their latest message. Never on your own initiative.`,
    `Only dispatch when the boss is asking for work to be done. If the request is ambiguous about which repo, ask a quick question instead of guessing (unless one repo is an obvious match). For status questions, answer from the agent list below. Refer to agents by name (e.g. "Nova"), not id. Never claim work is done that isn't. When you dispatch, say who you're sending where in plain words.`,
    ``,
    `Repos (buildings), biggest first:`,
    ...repos.slice(0, 80).map((r) => `- ${r.name} (${r.tier}${r.language ? `, ${r.language}` : ''}, ${r.commits} commits, pushed ${ago(r.pushedAt)})${r.description ? `: ${r.description.slice(0, 120)}` : ''}`),
    ``,
    active.length ? `Agents working right now:\n${active.map(agentLine).join('\n')}` : 'No agents are working right now.',
    recent.length ? `Recently finished agents:\n${recent.map(agentLine).join('\n')}` : '',
  ].filter((l) => l !== undefined).join('\n');
}

async function handleMessage(req: OfficeRequest, send: (d: unknown) => void, signal: AbortSignal) {
  const channel: OfficeChannel = req.channel === 'email' ? 'email' : 'text';
  const text = String(req.text || '').trim().slice(0, 8000);
  const subject = channel === 'email' ? String(req.subject || '').trim().slice(0, 200) || 'Note from the field' : undefined;
  const mine = post({ from: 'me', channel, subject, text, read: true });
  send({ type: 'me', message: mine });
  const session = typeof req.session === 'string' ? req.session.slice(0, 32) : undefined;
  logEvent('office_message_sent', { channel, session });

  broadcast({ type: 'office:typing', on: true, channel });
  let full = '';
  let shown = '';
  try {
    full = await streamClaude({
      system: await systemPrompt(channel),
      prompt: `Conversation so far:\n\n${threadText()}\n\nReply as HQ to the boss's latest ${channel === 'email' ? 'email' : 'text'}. Output only your reply (plus any action blocks at the end).`,
      fallback: "HQ here — I can't reach Claude right now, so I can't dispatch agents. Install Claude Code (or set ANTHROPIC_API_KEY) and text me again.",
      signal,
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
    broadcast({ type: 'office:typing', on: false, channel });
  }

  // ---- actions ----
  const dispatched: OfficeDispatch[] = [];
  const refs: NonNullable<OfficeMessage['refs']> = [];
  const notes: string[] = [];
  for (const d of parseAction<{ repo?: string; task?: string }>(full, 'dispatch').slice(0, MAX_DISPATCH)) {
    try {
      const repo = await findRepo(String(d.repo || ''));
      const task = String(d.task || '').trim();
      if (!task) continue;
      const a = await startAgent(repo, `${task}\n\n(Dispatched by HQ for the boss, who asked: "${text.slice(0, 600)}")`);
      dispatched.push({ agentId: a.id, agentName: a.name, repo: repo.name, task });
    } catch (e: any) {
      notes.push(`Couldn't dispatch to ${d.repo}: ${e.message}`);
    }
  }
  for (const id of parseAction<string>(full, 'stop')) {
    try {
      stopAgent(String(id));
      refs.push({ agentId: String(id), action: 'stopped' });
    } catch (e: any) {
      notes.push(`Couldn't stop ${id}: ${e.message}`);
    }
  }
  const prIds = parseAction<string>(full, 'pr');
  if (prIds.length && /\b(pr|prs|pull request|pull-request)\b/i.test(text)) {
    for (const id of prIds) {
      try {
        const a = await openPr(String(id));
        refs.push({ agentId: a.id, action: 'pr' });
        notes.push(`PR opened for ${a.name}: ${a.prUrl}`);
      } catch (e: any) {
        notes.push(`Couldn't open a PR for ${id}: ${e.message}`);
      }
    }
  }
  if (dispatched.length) logEvent('office_dispatch', { channel, session, count: dispatched.length, repos: dispatched.map((d) => d.repo) });

  let visible = visibleText(full).trim() || (dispatched.length ? 'On it.' : '…');
  if (notes.length) visible += `\n\n${notes.join('\n')}`;
  const reply = post({
    from: 'hq', channel, text: visible,
    subject: subject ? (subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`) : undefined,
    dispatched: dispatched.length ? dispatched : undefined,
    refs: refs.length ? refs : undefined,
    read: true,
  });
  send({ type: 'message', message: reply });
  broadcast({ type: 'office:message', message: reply });
}

/** When an agent HQ dispatched finishes, HQ sends a report on the channel the work was asked on. */
async function reportOn(info: AgentInfo) {
  if (info.status !== 'done' && info.status !== 'error') return;
  if (reporting.has(info.id)) return;
  const origin = messages.find((m) => m.dispatched?.some((d) => d.agentId === info.id));
  if (!origin) return;
  if (messages.some((m) => m.refs?.some((r) => r.agentId === info.id && r.action === 'report'))) return;
  reporting.add(info.id);

  const log = agentLog(info.id).events;
  const result = [...log].reverse().find((e) => e.event.kind === 'result')?.event as { text?: string } | undefined;
  const diff = [...log].reverse().find((e) => e.event.kind === 'diff')?.event as { stat?: string } | undefined;
  const cost = info.costUsd != null ? `$${info.costUsd.toFixed(2)}` : 'unknown cost';
  const channel = origin.channel;
  const fallback = info.status === 'done'
    ? `${info.name} finished in ${info.repo}. ${info.filesChanged.length ? `Changed ${info.filesChanged.length} file(s): ${info.filesChanged.slice(0, 5).join(', ')}.` : 'No files changed.'} ${result?.text ? result.text.slice(0, 400) : ''} (${cost})`
    : `${info.name} hit a problem in ${info.repo}: ${info.lastAction}`;

  broadcast({ type: 'office:typing', on: true, channel });
  let text = fallback;
  try {
    const out = await streamClaude({
      system: `You are HQ, the head office in OpenWorld, reporting to the boss on their phone about work a worker agent just completed. ${channel === 'text' ? 'Write a TEXT: 2-3 short sentences, under 60 words, casual, no markdown (no backticks or asterisks).' : 'Write a brief EMAIL body: "Hi," then 1-3 short paragraphs, sign off "— HQ". Plain text, no markdown (no backticks, asterisks or headings).'} Be concrete: what the agent found or changed, anything to review, and the next step (e.g. walk into the building to see the diff, or ask you to open a PR). Never invent details that are not below.`,
      prompt: [
        `Agent: ${info.name} in repo ${info.repo}. Status: ${info.status}. Cost: ${cost}. Branch: ${info.branch}.`,
        `Task: ${info.task.slice(0, 1500)}`,
        `Files changed: ${info.filesChanged.join(', ') || 'none'}`,
        diff?.stat ? `Diff stat:\n${diff.stat.slice(0, 1500)}` : '',
        `Agent's final message:\n${(result?.text || info.lastAction).slice(0, 4000)}`,
      ].filter(Boolean).join('\n\n'),
      fallback,
    });
    if (out.trim()) text = out.trim();
  } catch {
    /* template fallback */
  } finally {
    broadcast({ type: 'office:typing', on: false, channel });
  }
  const msg = post({
    from: 'hq', channel, text,
    subject: channel === 'email' ? `${info.status === 'done' ? 'Report' : 'Problem'}: ${info.name} on ${info.repo}` : undefined,
    refs: [{ agentId: info.id, action: 'report' }],
  });
  reporting.delete(info.id);
  logEvent('office_report', { repo: info.repo, ok: info.status === 'done' });
  broadcast({ type: 'office:message', message: msg });
}

export function registerOffice(app: Express, bc: (msg: ServerMsg) => void) {
  broadcast = bc;
  onAgentUpdate((info) => void reportOn(info).catch((e) => console.warn('office report failed:', e.message)));

  app.get('/api/office/thread', (_req: Request, res: Response) => {
    res.json({ messages, unread: unread() });
  });

  app.post('/api/office/read', (req: Request, res: Response) => {
    const channel = req.body?.channel === 'email' || req.body?.channel === 'text' ? req.body.channel : null;
    let changed = false;
    for (const m of messages) if (!m.read && (!channel || m.channel === channel)) { m.read = true; changed = true; }
    if (changed) save();
    res.json({ unread: unread() });
  });

  app.post('/api/office/message', async (req: Request, res: Response) => {
    const body = req.body as OfficeRequest;
    if (!String(body?.text || '').trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (d: unknown) => res.write(`data: ${JSON.stringify(d)}\n\n`);
    // HQ keeps working if the phone closes mid-reply: dispatches still happen.
    const ctrl = new AbortController();
    try {
      await handleMessage(body, send, ctrl.signal);
    } catch (e: any) {
      send({ type: 'error', error: e.message });
    }
    send({ type: 'done' });
    res.end();
  });
}
