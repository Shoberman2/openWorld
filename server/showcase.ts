// The public city, server side. Turns the catalog (showcaseCatalog.ts) into buildings anyone can visit:
// shown on its own when GitHub isn't connected, or next to your repos when you switch it on in Settings.
// Everything here only reads. Live numbers, recent pull requests, READMEs and diffs come from GitHub's
// public API (with your token when there is one, without it otherwise: 60 requests an hour), fetched as
// late as possible and kept on disk for days. When GitHub can't be reached or says "slow down", the
// catalog alone still builds the city and the people inside read from a script.
// Writes never get here: findRepo (github.ts) refuses showcase names, so agents, PRs, schedules, project
// leads and HQ dispatch all answer with SHOWCASE_REFUSAL.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, NextFunction, Request, Response as Res } from 'express';
import type { Repo, RepoDetail, TalkRequest, Worker } from '../shared/types.ts';
import { PATHS, logEvent, readConfig, readJson, writeConfig, writeJson } from './config.ts';
import { detectAgent, getMe, getToken, listRepos, logoContentType, logoFile } from './github.ts';
import { loopback } from './guard.ts';
import { streamClaude, transcriptPrompt } from './llm.ts';
import { SHOWCASE, showcaseEntry, type ShowcaseEntry } from './showcaseCatalog.ts';

const DIR = join(PATHS.cache, 'showcase');
mkdirSync(DIR, { recursive: true });
const STATS_FILE = join(DIR, 'stats.json');
const DAY = 86_400_000;
const STATS_TTL = 3 * DAY;
const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_'); // same rule as the logo cache
const full = (x: ShowcaseEntry) => `${x.owner}/${x.repo}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- GitHub, read-only, with or without a token ----------

/** Without a token GitHub allows 60 requests an hour: once it says no, stop asking until the hour resets. */
let limitedUntil = 0;

async function pub(url: string, opts: { accept?: string; body?: unknown; timeoutMs?: number } = {}): Promise<Response | null> {
  const target = url.startsWith('/') ? `https://api.github.com${url}` : url;
  const isApi = target.startsWith('https://api.github.com');
  const tok = isApi ? (await getToken())?.token : undefined;
  if (isApi && !tok && Date.now() < limitedUntil) return null;
  const call = (auth?: string) => fetch(target, {
    method: opts.body ? 'POST' : 'GET',
    headers: {
      Accept: opts.accept || (isApi ? 'application/vnd.github+json' : '*/*'),
      'User-Agent': 'openworld-game',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
  });
  try {
    let res = await call(tok);
    if (res.status === 401 && tok && !opts.body) res = await call(); // a stale token: public data needs none
    if (isApi && (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      if (!tok) limitedUntil = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 15 * 60_000;
      return null;
    }
    return res;
  } catch {
    return null; // offline, DNS, timeout
  }
}

/** The start of a response body (diffs of famous projects can run to megabytes). */
async function textCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
    if (out.length > max) { void reader.cancel().catch(() => {}); break; }
  }
  return out;
}

// ---------- live numbers ----------

interface Live {
  at: number;
  stars: number;
  language: string | null;
  languageColor: string | null;
  pushedAt: string;
  createdAt: string;
  homepageUrl: string;
  diskKb: number;
  commits: number;
  prs: number;
}

const stats: Record<string, Live> = readJson<Record<string, Live>>(STATS_FILE, {});
const fresh = (x: ShowcaseEntry) => !!stats[x.label] && Date.now() - stats[x.label].at < STATS_TTL;
const BASE = { landmark: 40, tower: 30, midrise: 20, small: 10 } as const;

function toRepo(x: ShowcaseEntry): Repo {
  const l: Live | undefined = stats[x.label];
  return {
    name: x.label,
    owner: x.owner,
    fullName: full(x),
    description: x.description,
    url: `https://github.com/${full(x)}`,
    homepageUrl: l?.homepageUrl ?? '',
    isPrivate: false,
    language: l?.language ?? null,
    languageColor: l?.languageColor ?? null,
    stars: l?.stars ?? 0,
    diskKb: l?.diskKb ?? 0,
    commits: l?.commits ?? 0,
    prs: l?.prs ?? 0,
    pushedAt: l?.pushedAt ?? '',
    createdAt: l?.createdAt ?? '',
    // Only orders showcase buildings among themselves; the client places your own repos first.
    score: Math.round((BASE[x.tier] + Math.min(9, Math.log1p(l?.stars ?? 0) * 0.7)) * 100) / 100,
    tier: x.tier,
    hasLogo: logoFile(x.label) != null,
    brandColor: x.brandColor,
    showcase: true,
  };
}

const STATS_FIELDS = `stargazerCount pushedAt createdAt homepageUrl diskUsage primaryLanguage { name color }
  pullRequests { totalCount } defaultBranchRef { target { ... on Commit { history { totalCount } } } }`;

/** With a token: every project's numbers in a handful of GraphQL calls. */
async function refreshAllStats() {
  const stale = SHOWCASE.filter((x) => !fresh(x));
  const batches: ShowcaseEntry[][] = [];
  for (let i = 0; i < stale.length; i += 6) batches.push(stale.slice(i, i + 6));
  await Promise.all(batches.map(async (batch) => {
    const query = `query {\n${batch.map((x, k) => `r${k}: repository(owner: ${JSON.stringify(x.owner)}, name: ${JSON.stringify(x.repo)}) { ${STATS_FIELDS} }`).join('\n')}\n}`;
    const res = await pub('/graphql', { body: { query }, timeoutMs: 20_000 });
    const data = res?.ok ? ((await res.json().catch(() => null)) as any)?.data : null;
    if (!data) return;
    batch.forEach((x, k) => {
      const n = data[`r${k}`];
      if (!n) return;
      stats[x.label] = {
        at: Date.now(), stars: n.stargazerCount ?? 0, language: n.primaryLanguage?.name ?? null, languageColor: n.primaryLanguage?.color ?? null,
        pushedAt: n.pushedAt ?? '', createdAt: n.createdAt ?? '', homepageUrl: n.homepageUrl || '', diskKb: n.diskUsage ?? 0,
        commits: n.defaultBranchRef?.target?.history?.totalCount ?? 0, prs: n.pullRequests?.totalCount ?? 0,
      };
    });
  }));
  writeJson(STATS_FILE, stats);
}

/** Without a token: one project's numbers, only when someone walks in (three requests of the hourly 60). */
async function refreshStats(x: ShowcaseEntry) {
  const res = await pub(`/repos/${full(x)}`);
  if (!res?.ok) return;
  const r = (await res.json()) as any;
  // One item per page: the number of the last page is the number of items.
  const count = async (path: string) => {
    const c = await pub(`/repos/${full(x)}/${path}per_page=1`);
    const last = c?.ok ? /[?&]page=(\d+)>;\s*rel="last"/.exec(c.headers.get('link') || '')?.[1] : null;
    return last ? Number(last) : null;
  };
  const [commits, prs] = await Promise.all([count('commits?'), count('pulls?state=all&')]);
  stats[x.label] = {
    at: Date.now(), stars: r.stargazers_count ?? 0, language: r.language ?? null, languageColor: null,
    pushedAt: r.pushed_at ?? '', createdAt: r.created_at ?? '', homepageUrl: r.homepage || '', diskKb: r.size ?? 0,
    commits: commits ?? stats[x.label]?.commits ?? 0, prs: prs ?? stats[x.label]?.prs ?? 0,
  };
  writeJson(STATS_FILE, stats);
}

// ---------- logos ----------

const logoJobs = new Map<string, Promise<string | null>>();
const logoFailed = new Set<string>();

async function saveLogo(x: ShowcaseEntry, url: string): Promise<string | null> {
  const res = await pub(url, { timeoutMs: 8000 });
  const type = res?.headers.get('content-type') || '';
  if (!res?.ok || !type.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 400 || buf.length > 2_000_000) return null;
  const ext = type.includes('png') ? '.png' : type.includes('svg') ? '.svg' : type.includes('webp') ? '.webp' : type.includes('jpeg') ? '.jpg' : '.ico';
  const out = join(PATHS.logos, safe(x.label) + ext);
  writeFileSync(out, buf);
  return out;
}

/** The icon a project's own site asks browsers to use: the touch icon if it has one, else its largest icon. */
async function siteIcons(site: string): Promise<string[]> {
  const res = await pub(site, { accept: 'text/html', timeoutMs: 8000 });
  const html = res?.ok ? await textCapped(res, 300_000) : '';
  const found: { url: string; rank: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*["']?([^"'>]+)`, 'i').exec(tag)?.[1]?.trim() ?? '';
    const rel = attr('rel').toLowerCase(), href = attr('href');
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const size = Number(/(\d+)x\d+/.exec(attr('sizes'))?.[1] ?? 0);
    try { found.push({ url: new URL(href, res!.url || site).href, rank: (rel.includes('apple-touch') ? 1000 : 0) + (/\.svg(\?|$)/.test(href) ? 600 : 0) + size }); } catch { /* a bad href */ }
  }
  const origin = new URL(site).origin;
  return [...found.sort((a, b) => b.rank - a.rank).map((f) => f.url), `${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`];
}

/**
 * Most of these projects live in an organization whose GitHub picture is the project's logo; the rest
 * name their own site in the catalog. Neither needs a token or an API request. (The game's logo search
 * through a repo's files needs a token and, on repos this size, picks test fixtures: not used here.)
 * No logo found: the building keeps the brand-color sign.
 */
function ensureShowcaseLogo(x: ShowcaseEntry): Promise<string | null> {
  const have = logoFile(x.label);
  if (have) return Promise.resolve(have);
  if (logoFailed.has(x.label)) return Promise.resolve(null);
  let job = logoJobs.get(x.label);
  if (!job) {
    job = (async () => {
      if (!x.site) return saveLogo(x, `https://github.com/${x.owner}.png?size=256`);
      for (const url of (await siteIcons(x.site)).slice(0, 5)) {
        const out = await saveLogo(x, url);
        if (out) return out;
      }
      return null;
    })().catch(() => null).then((p) => { if (!p) logoFailed.add(x.label); return p; }).finally(() => logoJobs.delete(x.label));
    logoJobs.set(x.label, job);
  }
  return job;
}

// ---------- who sees it ----------

/** The Settings switch, for people who are connected (without GitHub the showcase is always on). */
export const showcaseToggle = () => !!readConfig().showShowcase;

async function state() {
  const me = await getMe();
  return { connected: me.connected, on: !me.connected || showcaseToggle() };
}

/** The showcase projects in the world right now. Your own repos keep their names: a clash drops the showcase one. */
async function visible(): Promise<ShowcaseEntry[]> {
  const st = await state();
  if (!st.on) return [];
  const own = st.connected ? await listRepos().catch(() => [] as Repo[]) : [];
  const taken = new Set(own.map((r) => r.name.toLowerCase()));
  return SHOWCASE.filter((x) => !taken.has(x.label.toLowerCase()));
}

/** The showcase project behind a building name, when it is in the world and not one of your own. */
async function guest(name: string): Promise<ShowcaseEntry | null> {
  const x = showcaseEntry(name);
  if (!x) return null;
  return (await visible().catch(() => [] as ShowcaseEntry[])).includes(x) ? x : null;
}

async function listShowcase(): Promise<{ on: boolean; connected: boolean; repos: Repo[] }> {
  const st = await state();
  const list = await visible();
  if (list.length) {
    // Numbers first (only with a token: one cheap batch), then logos; neither may hold the world up for long.
    if ((await getToken()) && list.some((x) => !fresh(x))) await Promise.race([refreshAllStats().catch(() => {}), sleep(6000)]);
    await Promise.race([Promise.all(list.map((x) => ensureShowcaseLogo(x))), sleep(3500)]);
  }
  return { ...st, repos: list.map(toRepo) };
}

// ---------- inside a building: README, the people at the desks, their diffs ----------

interface Detail { at: number; authed: boolean; readme: string; workers: Worker[] }

const DETAIL_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 24, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { number title body state createdAt mergedAt additions deletions changedFiles url author { login } files(first: 40) { nodes { path } } }
    }
    defaultBranchRef { target { ... on Commit { history(first: 30) {
      nodes { oid messageHeadline message committedDate additions deletions changedFilesIfAvailable url author { name user { login } } parents { totalCount } }
    } } } }
  }
}`;

function prWorker(p: { number: number; title: string; body: string; login: string; state: Worker['state']; date: string; additions: number; deletions: number; changedFiles: number; files: string[]; url: string }): Worker {
  const agentName = detectAgent(p.login, p.body);
  return { id: `pr-${p.number}`, kind: 'pr', number: p.number, sha: null, title: p.title, body: p.body.slice(0, 2000), author: p.login, isAgent: !!agentName, agentName,
    state: p.state, date: p.date, additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles, files: p.files, url: p.url };
}

function commitWorker(c: { sha: string; message: string; login: string; date: string; additions: number; deletions: number; changedFiles: number; url: string }): Worker {
  const agentName = detectAgent(c.login, c.message);
  return { id: `c-${c.sha.slice(0, 7)}`, kind: 'commit', number: null, sha: c.sha, title: c.message.split('\n')[0].slice(0, 200), body: c.message.slice(0, 2000), author: c.login, isAgent: !!agentName, agentName,
    state: 'committed', date: c.date, additions: c.additions, deletions: c.deletions, changedFiles: c.changedFiles, files: [], url: c.url };
}

async function readReadme(x: ShowcaseEntry, authed: boolean): Promise<string> {
  if (authed) {
    const res = await pub(`/repos/${full(x)}/readme`, { accept: 'application/vnd.github.raw' });
    if (res?.ok) return textCapped(res, 4000);
  }
  // The raw file host doesn't count against the API limit.
  for (const f of ['README.md', 'README.rst', 'README']) {
    const res = await pub(`https://raw.githubusercontent.com/${full(x)}/HEAD/${f}`, { timeoutMs: 8000 });
    if (res?.ok) return textCapped(res, 4000);
  }
  return '';
}

async function fetchDetail(x: ShowcaseEntry, authed: boolean): Promise<Detail> {
  const workers: Worker[] = [];
  const readme = readReadme(x, authed).catch(() => '');
  if (authed) {
    const res = await pub('/graphql', { body: { query: DETAIL_QUERY, variables: { owner: x.owner, name: x.repo } }, timeoutMs: 25_000 });
    const r = res?.ok ? ((await res.json().catch(() => null)) as any)?.data?.repository : null;
    for (const pr of (r?.pullRequests?.nodes ?? []) as any[]) {
      workers.push(prWorker({
        number: pr.number, title: pr.title, body: pr.body || '', login: pr.author?.login || 'ghost',
        state: pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed', date: pr.mergedAt || pr.createdAt,
        additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles, files: (pr.files?.nodes || []).map((f: any) => f.path), url: pr.url,
      }));
    }
    if (workers.length < 8) for (const c of (r?.defaultBranchRef?.target?.history?.nodes ?? []) as any[]) {
      if (workers.length >= 24) break;
      if (c.parents.totalCount > 1) continue; // merge commit
      workers.push(commitWorker({ sha: c.oid, message: c.message, login: c.author?.user?.login || c.author?.name || 'unknown', date: c.committedDate,
        additions: c.additions, deletions: c.deletions, changedFiles: c.changedFilesIfAvailable ?? 0, url: c.url }));
    }
  } else {
    // No token: the list endpoints (one request each). They don't carry line counts; the diff fills the talk in.
    const res = await pub(`/repos/${full(x)}/pulls?state=all&sort=created&direction=desc&per_page=24`);
    for (const pr of (res?.ok ? await res.json().catch(() => []) : []) as any[]) {
      workers.push(prWorker({
        number: pr.number, title: pr.title, body: pr.body || '', login: pr.user?.login || 'ghost',
        state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed', date: pr.merged_at || pr.created_at,
        additions: 0, deletions: 0, changedFiles: 0, files: [], url: pr.html_url,
      }));
    }
    if (workers.length < 8) {
      const cres = await pub(`/repos/${full(x)}/commits?per_page=30`);
      for (const c of (cres?.ok ? await cres.json().catch(() => []) : []) as any[]) {
        if (workers.length >= 24) break;
        if ((c.parents?.length ?? 1) > 1) continue;
        workers.push(commitWorker({ sha: c.sha, message: c.commit?.message || '', login: c.author?.login || c.commit?.author?.name || 'unknown', date: c.commit?.author?.date || '',
          additions: 0, deletions: 0, changedFiles: 0, url: c.html_url }));
      }
    }
  }
  return { at: Date.now(), authed, readme: (await readme).slice(0, 4000), workers };
}

const detailJobs = new Map<string, Promise<Detail>>();

async function showcaseDetail(x: ShowcaseEntry): Promise<{ readme: string; workers: Worker[] }> {
  const file = join(DIR, `detail-${safe(x.label)}.json`);
  const hit = readJson<Detail | null>(file, null);
  const authed = !!(await getToken());
  if (hit && Date.now() - hit.at < (authed ? DAY / 4 : 3 * DAY)) return hit;
  let job = detailJobs.get(x.label);
  if (!job) {
    job = fetchDetail(x, authed).finally(() => detailJobs.delete(x.label));
    detailJobs.set(x.label, job);
  }
  const next = await job.catch(() => null);
  // Nothing came back (offline, rate-limited): keep what we had, however old.
  if (!next || (!next.workers.length && !next.readme)) return hit ?? { readme: '', workers: [] };
  writeJson(file, next);
  return next;
}

/** The change itself. github.com serves any public PR or commit as a diff, outside the API limit. */
async function showcaseDiff(x: ShowcaseEntry, w: Worker, max = 12_000): Promise<string> {
  const file = join(DIR, `diff-${safe(x.label)}-${safe(w.id)}.txt`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const res = await pub(`https://github.com/${full(x)}/${w.kind === 'pr' ? `pull/${w.number}` : `commit/${w.sha}`}.diff`, { timeoutMs: 15_000 });
  if (!res?.ok) return '';
  let diff = await textCapped(res, max + 1);
  if (diff.length > max) diff = diff.slice(0, max) + '\n... [diff truncated]';
  writeFileSync(file, diff);
  return diff;
}

// ---------- routes ----------

const onlyHere = (req: Request) => loopback(req.socket.remoteAddress);

export function registerShowcase(app: Express) {
  const wrap = (fn: (req: Request, res: Res, next: NextFunction) => Promise<unknown>) => (req: Request, res: Res, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

  // GET /api/showcase -> { on, connected, repos: Repo[] }  (repos is empty when the showcase is off)
  app.get('/api/showcase', wrap(async (_req, res) => {
    // Never fail the world over this: the worst case is the catalog as it is, or nothing.
    res.json(await listShowcase().catch(() => ({ on: false, connected: false, repos: [] as Repo[] })));
  }));

  // POST /api/settings/showcase {on} -> { showcase }   (only from this computer, like the other settings)
  app.post('/api/settings/showcase', wrap(async (req, res) => {
    if (!onlyHere(req)) { res.status(403).json({ error: 'Change this on the computer running OpenWorld' }); return; }
    writeConfig({ showShowcase: !!req.body?.on });
    logEvent('showcase_toggle', { on: !!req.body?.on });
    res.json({ showcase: showcaseToggle() });
  }));

  // The three things a visitor reads. Anything that isn't a showcase building falls through to the usual routes.
  app.get('/api/repos/:name', wrap(async (req, res, next) => {
    const x = await guest(String(req.params.name));
    if (!x) return next();
    if (!(await getToken()) && !fresh(x)) await refreshStats(x).catch(() => {});
    const { readme, workers } = await showcaseDetail(x);
    const detail: RepoDetail = { repo: toRepo(x), readme, workers, decisions: [], agents: [] };
    res.json(detail);
  }));

  app.get('/api/repos/:name/logo', wrap(async (req, res, next) => {
    const x = await guest(String(req.params.name));
    if (!x) return next();
    const file = await ensureShowcaseLogo(x);
    if (!file) { res.status(404).json({ error: 'No logo found' }); return; }
    res.setHeader('Content-Type', logoContentType(file));
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(readFileSync(file));
  }));

  app.post('/api/talk', wrap(async (req, res, next) => {
    const body = req.body as TalkRequest;
    const x = await guest(String(body?.repo ?? ''));
    if (!x) return next();
    const repo = toRepo(x);
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const { readme, workers } = await showcaseDetail(x);
    const numbers = [repo.stars ? `${repo.stars.toLocaleString('en-US')} stars` : '', repo.commits ? `${repo.commits.toLocaleString('en-US')} commits` : '', repo.prs ? `${repo.prs.toLocaleString('en-US')} pull requests` : '', repo.language ? `mostly ${repo.language}` : '']
      .filter(Boolean).join(', ');
    const visiting = `The visitor does not own this project: it is a famous public open-source project (${repo.fullName} on GitHub) shown in the city for anyone to walk through. They can look around and ask questions, but cannot hire agents, open pull requests or change anything here. Their own projects get buildings like this one once they connect GitHub in Settings.`;
    let system: string, opener: string, fallback: string;

    if (body.workerId === 'reception') {
      system = [
        `You are Morgan, the receptionist in the lobby of the "${repo.name}" building in an open-world city game where GitHub repositories are buildings.`,
        `You know this project well and greet visitors warmly. Speak in first person, concise (<=120 words unless asked for detail), no markdown headings.`,
        visiting,
        `Point visitors to the work floor upstairs: the desks are staffed by the people behind the project's recent pull requests and commits (walk up and press E to talk to them).`,
        ``,
        `Project: ${repo.fullName}. ${repo.description}`,
        numbers ? `Numbers: ${numbers}.` : '',
        readme ? `README excerpt:\n${readme.slice(0, 3000)}` : '',
        workers.length ? `People at the desks (most recent first):\n${workers.slice(0, 15).map((w) => `- ${w.author}: ${w.title} [${w.state}${w.date ? `, ${w.date.slice(0, 10)}` : ''}]`).join('\n')}` : '',
      ].filter((l) => l !== '').join('\n');
      opener = 'A visitor just walked up to your reception desk. Greet them, say in a sentence that this is a public project they are visiting, and give a short, vivid overview of what the project is and what has been happening lately.';
      fallback = `Welcome to ${repo.name}. ${repo.description} This is a public open-source project (${repo.fullName}) you're visiting${numbers ? `: ${numbers}` : ''}. `
        + (workers.length ? `Lately: ${workers.slice(0, 3).map((w) => `"${w.title}" by ${w.author}`).join('; ')}. The people behind recent changes are at the desks upstairs: walk up and press E. ` : 'The desks upstairs fill in when GitHub can be reached. ')
        + 'Connect GitHub in Settings and your own projects move into buildings like this one.';
    } else {
      const w = workers.find((k) => k.id === String(body.workerId));
      if (!w) { res.status(404).json({ error: `Unknown worker ${body.workerId}` }); return; }
      const diff = await showcaseDiff(x, w).catch(() => '');
      const who = w.agentName ? `${w.agentName}, an AI coding agent` : w.author;
      const ref = w.kind === 'pr' ? `pull request #${w.number}` : `commit ${w.sha?.slice(0, 7)}`;
      system = [
        `You are ${who}, a contributor at a desk inside the "${repo.name}" building in an open-world city game where GitHub repositories are buildings.`,
        `You made this change. Speak in first person, warm and concise (<=120 words unless asked for detail), like a colleague explaining their work at their desk. Explain what changed and why. No markdown headings. If asked something the diff doesn't show, say so honestly.`,
        visiting,
        ``,
        `Your ${ref}: "${w.title}" (${w.state}${w.date ? `, ${w.date.slice(0, 10)}` : ''})`,
        w.body && w.body !== w.title ? `Description:\n${w.body}` : '',
        w.files.length ? `Files: ${w.files.join(', ')}` : '',
        diff ? `The diff:\n${diff}` : 'The diff is unavailable.',
        `About the project: ${repo.description}`,
      ].filter(Boolean).join('\n');
      opener = 'A visitor just walked up to your desk. Greet them briefly and summarize the change you made: what it does and why.';
      const files = diff ? [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).slice(0, 6) : w.files.slice(0, 6);
      fallback = `Hi, I'm ${who}. I ${w.kind === 'pr' ? `opened PR #${w.number}` : 'committed'} "${w.title}" in ${repo.fullName}.${files.length ? ` It touches ${files.join(', ')}.` : ''} ${w.body && w.body !== w.title ? w.body.replace(/\s+/g, ' ').slice(0, 300) : ''}`.trim();
    }

    logEvent('desk_talk', { repo: repo.name, worker: body.workerId, turn: messages.length, showcase: true });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    try {
      await streamClaude({ system, prompt: transcriptPrompt(messages, opener), fallback, signal: ctrl.signal, onDelta: (delta) => send({ delta }) });
      send({ done: true });
    } catch (e: any) {
      send({ error: e.message });
    }
    res.end();
  }));
}

// ---------- the experiment (docs/experiments.md): does a city of famous projects pull people in? ----------

/** For GET /api/stats: of the sessions that saw the showcase without GitHub, how many walked in, and how many connected. */
export function showcaseStats() {
  const lines = existsSync(PATHS.events) ? readFileSync(PATHS.events, 'utf8').split('\n').filter(Boolean) : [];
  const shown = new Set<string>(), entered = new Set<string>(), clicked = new Set<string>(), connected = new Set<string>();
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      const s = e.props?.session;
      if (!s || e.props?.automated) continue;
      if (e.name === 'showcase_shown' && e.props.connected === false) shown.add(s);
      else if (e.name === 'showcase_entered') entered.add(s);
      else if (e.name === 'showcase_connect_clicked') clicked.add(s);
      else if (e.name === 'github_connected') connected.add(s);
    } catch { /* skip bad line */ }
  }
  const of = (set: Set<string>) => [...set].filter((s) => shown.has(s)).length;
  const share = (n: number) => (shown.size ? Math.round((n / shown.size) * 1000) / 1000 : 0);
  return {
    noGithubSessions: shown.size,
    enteredSessions: of(entered),
    connectClickedSessions: of(clicked),
    connectedSessions: of(connected),
    // Pass marks (decided up front): enterShare >= 0.4, connectShare >= 0.1.
    enterShare: share(of(entered)),
    connectClickShare: share(of(clicked)),
    connectShare: share(of(connected)),
  };
}
