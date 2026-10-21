import type { AgentInfo, OfficeDispatch } from '../shared/types.ts';
import { findRepo } from './github.ts';
import { streamClaude } from './llm.ts';
import { startAgent, stopAgent, openPr, agentLog } from './agents.ts';

// What HQ and the project masters share: hidden action blocks at the end of a reply
// (<dispatch>, <stop>, <pr>, <delegate>), running them, and writing finish reports.

export const ACTION_TAGS = ['dispatch', 'stop', 'pr', 'delegate', 'schedule'];
export const MAX_DISPATCH = 5;

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

export function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? `${Math.round(d)} days ago` : `${Math.round(d / 30)} months ago`;
}

export function agentLine(a: AgentInfo) {
  const cost = a.costUsd != null ? `, $${a.costUsd.toFixed(2)}` : '';
  return `- [${a.id}] ${a.name} in ${a.repo} — ${a.status}${cost}. Task: "${a.task.slice(0, 140)}". Last: ${a.lastAction.slice(0, 120)}. Files changed: ${a.filesChanged.slice(0, 8).join(', ') || 'none'}${a.question ? `. Waiting on the boss: "${a.question.slice(0, 160)}"` : ''}${a.review ? `. Review: ${a.review}` : ''}${a.prUrl ? `. PR: ${a.prUrl}` : ''}`;
}

export interface ActionResult {
  dispatched: OfficeDispatch[];
  refs: { agentId: string; action: 'stopped' | 'pr' }[];
  notes: string[];
}

/**
 * Run the <dispatch>, <stop> and <pr> blocks in a reply. `repo` pins dispatches to one repo (a project
 * master); `by` names who dispatched, for the agent's brief. PRs only open when the boss's own message
 * asked for one.
 */
export async function applyActions(full: string, opts: { askedText: string; by: string; repo?: string }): Promise<ActionResult> {
  const out: ActionResult = { dispatched: [], refs: [], notes: [] };
  for (const d of parseAction<{ repo?: string; task?: string }>(full, 'dispatch').slice(0, MAX_DISPATCH)) {
    const name = opts.repo ?? String(d.repo || '');
    try {
      const repo = await findRepo(name);
      const task = String(d.task || '').trim();
      if (!task) continue;
      const a = await startAgent(repo, `${task}\n\n(Dispatched by ${opts.by} for the boss, who asked: "${opts.askedText.slice(0, 600)}")`);
      out.dispatched.push({ agentId: a.id, agentName: a.name, repo: repo.name, task });
    } catch (e: any) {
      out.notes.push(`Couldn't dispatch to ${name}: ${e.message}`);
    }
  }
  for (const id of parseAction<string>(full, 'stop')) {
    try {
      stopAgent(String(id));
      out.refs.push({ agentId: String(id), action: 'stopped' });
    } catch (e: any) {
      out.notes.push(`Couldn't stop ${id}: ${e.message}`);
    }
  }
  const prIds = parseAction<string>(full, 'pr');
  if (prIds.length && /\b(pr|prs|pull request|pull-request)\b/i.test(opts.askedText)) {
    for (const id of prIds) {
      try {
        const a = await openPr(String(id));
        out.refs.push({ agentId: a.id, action: 'pr' });
        out.notes.push(`PR opened for ${a.name}: ${a.prUrl}`);
      } catch (e: any) {
        out.notes.push(`Couldn't open a PR for ${id}: ${e.message}`);
      }
    }
  }
  return out;
}

/** A finish report on a worker agent, written by `who` ("HQ" or a project lead) as a text or an email. */
export async function composeReport(info: AgentInfo, who: string, channel: 'text' | 'email'): Promise<string> {
  const log = agentLog(info.id).events;
  const result = [...log].reverse().find((e) => e.event.kind === 'result')?.event as { text?: string } | undefined;
  const diff = [...log].reverse().find((e) => e.event.kind === 'diff')?.event as { stat?: string } | undefined;
  const cost = info.costUsd != null ? `$${info.costUsd.toFixed(2)}` : 'unknown cost';
  const fallback = info.status === 'done'
    ? `${info.name} finished in ${info.repo}. ${info.filesChanged.length ? `Changed ${info.filesChanged.length} file(s): ${info.filesChanged.slice(0, 5).join(', ')}.` : 'No files changed.'} ${result?.text ? result.text.slice(0, 400) : ''} (${cost})`
    : `${info.name} hit a problem in ${info.repo}: ${info.lastAction}`;
  try {
    const out = await streamClaude({
      system: `You are ${who} in OpenWorld, reporting to the boss on their phone about work a worker agent just completed. ${channel === 'text' ? 'Write a TEXT: 2-3 short sentences, under 60 words, casual, no markdown (no backticks or asterisks).' : `Write a brief EMAIL body: "Hi," then 1-3 short paragraphs, sign off "— ${who}". Plain text, no markdown (no backticks, asterisks or headings).`} Be concrete: what the agent found or changed, anything to review, and the next step (e.g. walk into the building to see the diff, or ask you to open a PR). Never invent details that are not below.`,
      prompt: [
        `Agent: ${info.name} in repo ${info.repo}. Status: ${info.status}. Cost: ${cost}. Branch: ${info.branch}.`,
        `Task: ${info.task.slice(0, 1500)}`,
        `Files changed: ${info.filesChanged.join(', ') || 'none'}`,
        diff?.stat ? `Diff stat:\n${diff.stat.slice(0, 1500)}` : '',
        `Agent's final message:\n${(result?.text || info.lastAction).slice(0, 4000)}`,
      ].filter(Boolean).join('\n\n'),
      fallback,
    });
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}
