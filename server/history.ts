// A repo's whole life, for the "Replay history" film at its building: commits per week (or month),
// releases, the first commit and when each contributor first showed up. The counts come from the
// commit log; who joined when comes from GitHub's contributor stats, which answer 202 while they're
// being computed, so that call is retried with a backoff (and its weekly sums stand in for the counts
// if the log can't be read). If GitHub can't answer at all, the curve is even growth between the
// repo's creation and its last push and says so (`approximate`). Nothing here is ever made up: a
// milestone is only reported when GitHub gave it to us. Answers are kept on disk under cache/history.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { Repo, RepoHistory } from '../shared/types.ts';
import { PATHS, readJson, writeJson } from './config.ts';
import { findRepo, ghFetch, ghJson, gql } from './github.ts';

const DIR = join(PATHS.cache, 'history');
mkdirSync(DIR, { recursive: true });
const WEEK = 7 * 86_400_000;
const fileOf = (repo: Repo) => join(DIR, `${`${repo.owner}__${repo.name}`.replace(/[^\w.-]/g, '_')}.json`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();

type Parts = Pick<RepoHistory, 'unit' | 'buckets' | 'contributors'>;

/** GitHub's per-contributor weekly stats: 202 while it computes them, 204 for an empty repo. */
async function fromStats(repo: Repo, tries: number): Promise<Parts | null> {
  for (let i = 0; i < tries; i++) {
    const res = await ghFetch(`/repos/${repo.owner}/${repo.name}/stats/contributors`);
    if (res.status === 202) { await res.arrayBuffer().catch(() => {}); await sleep(1200 * (i + 1)); continue; }
    if (res.status !== 200) return null;
    const list = (await res.json()) as { author: { login: string } | null; total: number; weeks: { w: number; c: number }[] }[];
    if (!Array.isArray(list) || !list.length) return null;
    const perWeek = new Map<number, number>();
    const contributors: RepoHistory['contributors'] = [];
    for (const c of list) {
      let first = 0;
      for (const w of c.weeks ?? []) {
        if (!w.c) continue;
        perWeek.set(w.w, (perWeek.get(w.w) ?? 0) + w.c);
        if (!first || w.w < first) first = w.w;
      }
      if (first && c.author?.login) contributors.push({ login: c.author.login, firstAt: iso(first * 1000), commits: c.total });
    }
    const weeks = [...perWeek.keys()].sort((a, b) => a - b);
    if (!weeks.length) return null;
    const buckets: RepoHistory['buckets'] = [];
    for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w += WEEK / 1000) buckets.push({ t: iso(w * 1000), commits: perWeek.get(w) ?? 0 });
    contributors.sort((a, b) => a.firstAt.localeCompare(b.firstAt) || b.commits - a.commits);
    return { unit: 'week', buckets, contributors };
  }
  return null;
}

/**
 * Exact commit counts on the default branch, one aliased GraphQL count per bucket: weeks for a repo up
 * to three years old, calendar months beyond that. (The contributor stats can't give this: they count a
 * co-authored commit once for each author.)
 */
async function fromCounts(repo: Repo, firstAt: string | null): Promise<Parts | null> {
  const start = Date.parse(firstAt ?? repo.createdAt), end = Math.max(Date.parse(repo.pushedAt), Date.parse(repo.createdAt), start);
  const weekly = end - start <= 156 * WEEK;
  const edges: number[] = [];
  if (weekly) {
    // Weeks start on Sunday (UTC), like GitHub's own.
    const d = new Date(start), first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay());
    for (let t = first; t <= end; t += WEEK) edges.push(t);
    edges.push(edges[edges.length - 1] + WEEK);
  } else {
    const d = new Date(start);
    for (let y = d.getUTCFullYear(), m = d.getUTCMonth(); edges.length < 481; m++) { const t = Date.UTC(y, m, 1); edges.push(t); if (t > end) break; }
  }
  const buckets: RepoHistory['buckets'] = [];
  for (let i = 0; i + 1 < edges.length; i += 40) {
    const n = Math.min(40, edges.length - 1 - i);
    const fields = Array.from({ length: n }, (_, k) => `b${k}: history(since: "${iso(edges[i + k])}", until: "${iso(edges[i + k + 1] - 1000)}") { totalCount }`).join('\n');
    const data = await gql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { target { ... on Commit {\n${fields}\n} } } } }`, { owner: repo.owner, name: repo.name });
    const t = data.repository?.defaultBranchRef?.target;
    if (!t) return null;
    for (let k = 0; k < n; k++) buckets.push({ t: iso(edges[i + k]), commits: t[`b${k}`]?.totalCount ?? 0 });
  }
  return buckets.some((b) => b.commits) ? { unit: weekly ? 'week' : 'month', buckets, contributors: [] } : null;
}

/** The oldest commit on the default branch: the last page of the commit list, one commit per page. */
async function firstCommit(repo: Repo): Promise<string | null> {
  const base = `/repos/${repo.owner}/${repo.name}/commits?per_page=1`;
  const res = await ghFetch(base);
  if (!res.ok) return null;
  let list = (await res.json()) as any[];
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(res.headers.get('link') ?? '');
  if (last && Number(last[1]) > 1) list = await ghJson<any[]>(`${base}&page=${last[1]}`);
  const c = list?.[0]?.commit;
  return c?.author?.date ?? c?.committer?.date ?? null;
}

async function releases(repo: Repo): Promise<RepoHistory['releases']> {
  const list = await ghJson<any[]>(`/repos/${repo.owner}/${repo.name}/releases?per_page=100`);
  return list.filter((r) => !r.draft && r.published_at).map((r) => ({ tag: String(r.tag_name), publishedAt: String(r.published_at) }))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

/** Nothing better to go on: the commits we know the repo has, spread evenly over its life. */
function estimate(repo: Repo): Parts {
  const a = Date.parse(repo.createdAt), b = Math.max(a, Date.parse(repo.pushedAt));
  const n = Math.max(1, Math.min(240, Math.ceil((b - a) / (30.44 * 86_400_000))));
  const total = Math.max(0, repo.commits);
  const buckets: RepoHistory['buckets'] = [];
  for (let i = 0; i < n; i++) buckets.push({ t: iso(a + ((b - a) * i) / n), commits: Math.round((total * (i + 1)) / n) - Math.round((total * i) / n) });
  return { unit: 'month', buckets, contributors: [] };
}

const inflight = new Map<string, Promise<RepoHistory>>();

export function repoHistory(repo: Repo): Promise<RepoHistory> {
  const file = fileOf(repo);
  const cached = existsSync(file) ? readJson<RepoHistory | null>(file, null) : null;
  if (cached?.buckets?.length) {
    const age = Date.now() - Date.parse(cached.fetchedAt);
    // Real history only changes when something is pushed; a guess is worth another try after a minute.
    if (cached.approximate ? age < 60_000 : cached.pushedAt === repo.pushedAt && age < 7 * 86_400_000) return Promise.resolve(cached);
  }
  let p = inflight.get(file);
  if (!p) {
    p = build(repo).then((h) => { writeJson(file, h); return h; }).finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  return p;
}

async function build(repo: Repo): Promise<RepoHistory> {
  const quiet = <T>(p: Promise<T>, fallback: T) => p.catch((e: Error) => { console.warn(`history for ${repo.name}:`, e.message); return fallback; });
  const [stats, first, rel] = await Promise.all([
    quiet(fromStats(repo, 6), null), quiet(firstCommit(repo), null), quiet(releases(repo), [] as RepoHistory['releases']),
  ]);
  // Counts straight from the commit log are exact; the stats' weekly sums stand in when that fails
  // (coarser: a co-authored commit is counted for each author). Who joined when comes from the stats.
  const counts = await quiet(fromCounts(repo, first), null);
  const real = counts ?? stats;
  const parts = real ? { ...real, contributors: stats?.contributors ?? [] } : estimate(repo);
  return {
    repo: repo.name, ...parts,
    totalCommits: parts.buckets.reduce((s, b) => s + b.commits, 0),
    firstCommitAt: first, createdAt: repo.createdAt, pushedAt: repo.pushedAt,
    releases: rel,
    source: counts ? 'commits' : stats ? 'stats' : 'estimate',
    approximate: !real,
    fetchedAt: new Date().toISOString(),
  };
}

export function registerHistory(app: Express) {
  app.get('/api/repos/:name/history', (req: Request, res: Response, next) => {
    findRepo(String(req.params.name)).then((repo) => repoHistory(repo)).then((h) => res.json(h), next);
  });
}
