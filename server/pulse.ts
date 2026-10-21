// Work pulse: live state of each repo (CI, PRs, issues, commits, releases), drawn onto its building.
// GitHub is polled in the background; the last good pulse is kept on disk so a restart is instant.
import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { AgentInfo, RepoPulse, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson } from './config.ts';
import { findRepo, listRepos, repoPulses, type RawPulse } from './github.ts';
import { listAgents, onAgentUpdate } from './agents.ts';

const FILE = join(PATHS.home, 'pulse.json');
const REFRESH_MS = 2 * 60_000;
const STALE_DAYS = 30;

const pulses = new Map<string, RepoPulse>(readJson<RepoPulse[]>(FILE, []).map((p) => [p.repo, p]));
let broadcast: (msg: ServerMsg) => void = () => {};

const live = (a: AgentInfo) => a.status === 'preparing' || a.status === 'running' || a.status === 'needs_input';

/** The part of a pulse that, when it changes, is worth telling the clients about. */
const sig = (p: RepoPulse) => JSON.stringify({ ...p, updatedAt: '' });

function withAgents(p: Omit<RepoPulse, 'activeAgents' | 'needsYou' | 'updatedAt'>, agents: AgentInfo[]): RepoPulse {
  const mine = agents.filter((a) => a.repo.toLowerCase() === p.repo.toLowerCase());
  const waiting = mine.filter((a) => a.review === 'pending' || a.status === 'needs_input').length;
  return {
    ...p,
    stale: Date.now() - Date.parse(p.pushedAt) > STALE_DAYS * 86_400_000,
    activeAgents: mine.filter(live).length,
    needsYou: waiting + p.openPrs.filter((pr) => pr.isAgent).length,
    updatedAt: new Date().toISOString(),
  };
}

function put(next: RepoPulse) {
  const prev = pulses.get(next.repo);
  pulses.set(next.repo, next);
  if (!prev || sig(prev) !== sig(next)) {
    broadcast({ type: 'pulse:update', pulse: next });
    return true;
  }
  return false;
}

function save() {
  writeJson(FILE, [...pulses.values()]);
}

let refreshing: Promise<void> | null = null;
export function refreshPulse(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const repos = await listRepos();
      const raw: Map<string, RawPulse> = await repoPulses(repos);
      const agents = listAgents();
      for (const r of repos) {
        const p = raw.get(r.name);
        if (p) put(withAgents({ repo: r.name, stale: false, ...p }, agents));
      }
      save();
    } catch (e: any) {
      console.warn('pulse refresh failed:', e.message); // keep the last good pulse
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Re-read one repo right after the user acted on it from the phone (merge, close, new issue…). */
export async function refreshRepo(name: string) {
  try {
    const repo = await findRepo(name);
    const p = (await repoPulses([repo])).get(repo.name);
    if (p && put(withAgents({ repo: repo.name, stale: false, ...p }, listAgents()))) save();
  } catch (e: any) {
    console.warn(`pulse refresh for ${name} failed:`, e.message);
  }
}

/** Apply a local change to a repo's pulse (dry-run writes never reach GitHub, so nothing would change). */
export function patchPulse(name: string, fn: (p: RepoPulse) => void) {
  const p = pulses.get(name);
  if (!p) return;
  const next: RepoPulse = structuredClone(p);
  fn(next);
  if (put(withAgents(next, listAgents()))) save();
}

/** Agents changed: recount who's working and what's waiting, without asking GitHub. */
function recountAgents() {
  const agents = listAgents();
  let changed = false;
  for (const p of pulses.values()) changed = put(withAgents(p, agents)) || changed;
  if (changed) save();
}

export function getPulse(): RepoPulse[] {
  return [...pulses.values()];
}

export function registerPulse(app: Express, bc: (msg: ServerMsg) => void) {
  broadcast = bc;
  onAgentUpdate(() => recountAgents());
  app.get('/api/pulse', (_req: Request, res: Response) => { res.json(getPulse()); });
  app.get('/api/pulse/:repo', (req: Request, res: Response) => {
    const p = pulses.get(String(req.params.repo)) ?? [...pulses.values()].find((x) => x.repo.toLowerCase() === String(req.params.repo).toLowerCase());
    if (!p) res.status(404).json({ error: 'No pulse for that repo yet' });
    else res.json(p);
  });
  // First refresh shortly after start (the repo list warms up first), then every couple of minutes.
  setTimeout(() => void refreshPulse(), 3_000);
  setInterval(() => void refreshPulse(), REFRESH_MS).unref();
}
