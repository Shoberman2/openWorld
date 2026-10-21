import { join } from 'node:path';
import type { Express } from 'express';
import type { AgentInfo, Briefing } from '../shared/types.ts';
import { PATHS, readJson, writeJson, logEvent } from './config.ts';
import { listAgents } from './agents.ts';
import { getPulse } from './pulse.ts';
import { listSchedules } from './schedules.ts';

// The briefing: what happened while you were away. Shown on the apartment desk and the phone's
// "Today" app. Plain facts from the agents, the pulse and the schedules; no LLM.

const FILE = join(PATHS.home, 'briefing.json');
const DAY = 86400_000;

function lastSeen(): string | null {
  return readJson<{ seenAt?: string }>(FILE, {}).seenAt ?? null;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "overnight", "this morning", "since yesterday"… for the headline. */
function span(since: Date, now = new Date()) {
  const hours = (now.getTime() - since.getTime()) / 3600_000;
  if (hours < 1) return 'in the last hour';
  if (hours < 14 && now.getHours() >= 5 && now.getHours() < 12 && since.getHours() >= 17) return 'overnight';
  if (hours < 24) return since.toDateString() === now.toDateString() ? 'today' : `in the last ${Math.round(hours)} hours`;
  if (hours < 48) return 'since yesterday';
  return `in the last ${Math.round(hours / 24)} days`;
}

export function headline(b: Omit<Briefing, 'headline'>, now = new Date()): string {
  const when = span(new Date(b.since), now);
  const parts: string[] = [];
  if (b.finished.length) parts.push(`${plural(b.finished.length, 'run')} finished ${when}`);
  const waiting: string[] = [];
  if (b.needsReview.length) waiting.push(`${b.needsReview.length} ${b.needsReview.length === 1 ? 'needs' : 'need'} your review`);
  if (b.needsInput.length) waiting.push(`${plural(b.needsInput.length, 'agent')} ${b.needsInput.length === 1 ? 'has a question' : 'have questions'}`);
  if (b.failingCi.length) waiting.push(`CI is red on ${b.failingCi.length > 2 ? `${b.failingCi.length} projects` : b.failingCi.map((f) => f.repo).join(' and ')}`);
  if (b.newPrs.length) waiting.push(`${plural(b.newPrs.length, 'new PR')} opened`);
  if (!parts.length && !waiting.length) {
    const next = b.scheduled[0];
    return next
      ? `All quiet. Next up: ${next.repo} at ${new Date(next.nextRunAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
      : 'All quiet. Nothing is waiting on you.';
  }
  const text = [...parts, ...waiting].join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/, ([^,]*)$/, ', and $1') + '.';
}

const endedSince = (a: AgentInfo, since: number) => !!a.endedAt && new Date(a.endedAt).getTime() >= since;

export function buildBriefing(sinceParam?: string): Briefing {
  const now = Date.now();
  const sinceIso = sinceParam && !isNaN(Date.parse(sinceParam)) ? new Date(sinceParam).toISOString() : lastSeen() ?? new Date(now - DAY).toISOString();
  const since = new Date(sinceIso).getTime();
  const agents = listAgents();
  const pulse = getPulse();
  const b: Omit<Briefing, 'headline'> = {
    since: sinceIso,
    finished: agents.filter((a) => (a.status === 'done' || a.status === 'error') && endedSince(a, since)),
    needsReview: agents.filter((a) => a.review === 'pending'),
    needsInput: agents.filter((a) => a.status === 'needs_input'),
    failingCi: pulse.filter((p) => p.ci === 'failing').map((p) => ({ repo: p.repo, since: p.ciSince })),
    newPrs: pulse
      .flatMap((p) => p.openPrs.map((pr) => ({ ...pr, repo: p.repo })))
      .filter((pr) => new Date(pr.createdAt).getTime() >= since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    scheduled: listSchedules().filter((s) => s.enabled && s.nextRunAt),
  };
  return { ...b, headline: headline(b) };
}

export function registerBriefing(app: Express) {
  app.get('/api/briefing', (req, res) => {
    res.json(buildBriefing(typeof req.query.since === 'string' ? req.query.since : undefined));
  });
  app.post('/api/briefing/seen', (_req, res) => {
    writeJson(FILE, { seenAt: new Date().toISOString() });
    logEvent('briefing_seen');
    res.json({ ok: true });
  });
}
