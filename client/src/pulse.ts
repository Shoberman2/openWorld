// The live state of every project (CI, open PRs and issues, commits, releases, who's working),
// kept fresh from the server's pulse feed. The city and the interiors draw from it.
import type { RepoPulse } from '../../shared/types.ts';
import { onLive, pulse as pulseApi } from './api.ts';

type Listener = (next: RepoPulse, prev: RepoPulse | undefined) => void;

class PulseStore {
  private map = new Map<string, RepoPulse>();
  private listeners = new Set<Listener>();
  private started = false;

  /** Load once and follow the live feed. Safe to call more than once. */
  start() {
    if (this.started) return;
    this.started = true;
    onLive((msg) => { if (msg.type === 'pulse:update') this.set(msg.pulse); });
    pulseApi.all().then((list) => list.forEach((p) => this.set(p))).catch(() => {});
  }

  get(repo: string) { return this.map.get(repo); }
  all() { return [...this.map.values()]; }

  set(p: RepoPulse) {
    const prev = this.map.get(p.repo);
    this.map.set(p.repo, p);
    for (const fn of this.listeners) fn(p, prev);
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Testing: merge fields into a repo's pulse as if the server had sent them. */
  inject(repo: string, patch: Partial<RepoPulse>) {
    const base: RepoPulse = this.map.get(repo) ?? {
      repo, ci: 'none', ciSince: null, openPrs: [], openIssues: [], recentCommits: [], lastRelease: null,
      pushedAt: new Date().toISOString(), stale: false, activeAgents: 0, needsYou: 0, updatedAt: '',
    };
    this.set({ ...base, ...patch, repo, updatedAt: new Date().toISOString() });
  }
}

export const pulse = new PulseStore();

const CI_WORD = { failing: 'CI red', pending: 'CI running', passing: '', none: '' } as const;

function clock(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(/\s/g, '').toLowerCase();
  return sameDay ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** "2 PRs waiting · CI red since 3pm · 1 agent working": only the parts that are true. Empty when nothing's notable. */
export function pulseSummary(p: RepoPulse | undefined, liveAgents = 0): string[] {
  if (!p) return liveAgents ? [`${liveAgents} agent${liveAgents > 1 ? 's' : ''} working`] : [];
  const parts: string[] = [];
  const prs = p.openPrs.length;
  if (prs) parts.push(`${prs} PR${prs > 1 ? 's' : ''} waiting`);
  if (p.ci === 'failing') parts.push(`${CI_WORD.failing}${p.ciSince ? ` since ${clock(p.ciSince)}` : ''}`);
  else if (p.ci === 'pending') parts.push(CI_WORD.pending);
  const working = Math.max(p.activeAgents, liveAgents);
  if (working) parts.push(`${working} agent${working > 1 ? 's' : ''} working`);
  const review = p.needsYou - p.openPrs.filter((x) => x.isAgent).length;
  if (review > 0) parts.push(`${review} need${review > 1 ? '' : 's'} you`);
  if (p.lastRelease && Date.now() - Date.parse(p.lastRelease.publishedAt) < 86_400_000) parts.push(`released ${p.lastRelease.tag}`);
  return parts;
}
