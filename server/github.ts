import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { CiState, IssueDetail, Me, PrDetail, PulseCommit, PulseIssue, PulsePr, Repo, Tier, Worker } from '../shared/types.ts';
import { PATHS, readConfig, run, hasClaude, logEvent } from './config.ts';

// ---------- token ----------

let tokenCache: { token: string; source: Me['tokenSource'] } | null = null;

export async function getToken(): Promise<{ token: string; source: Me['tokenSource'] } | null> {
  if (tokenCache) return tokenCache;
  try {
    const t = (await run('gh', ['auth', 'token'], { timeoutMs: 10_000 })).trim();
    if (t) return (tokenCache = { token: t, source: 'gh' });
  } catch {
    /* gh missing or logged out */
  }
  if (process.env.GITHUB_TOKEN) return (tokenCache = { token: process.env.GITHUB_TOKEN, source: 'env' });
  const cfg = readConfig();
  if (cfg.token) return (tokenCache = { token: cfg.token, source: 'config' });
  return null;
}

export function resetToken() {
  tokenCache = null;
  meCache = null;
  reposCache = null;
}

export class GitHubError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function gh(path: string, init: { accept?: string; method?: string; body?: unknown; timeoutMs?: number; token?: string } = {}) {
  const tok = init.token ?? (await getToken())?.token;
  if (!tok) throw new GitHubError('GitHub is not connected', 401);
  const res = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: init.accept || 'application/vnd.github+json',
      'User-Agent': 'openworld-game',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  return res;
}

async function ghJson<T = any>(path: string, opts: Parameters<typeof gh>[1] = {}): Promise<T> {
  const res = await gh(path, opts);
  if (!res.ok) throw new GitHubError(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`, res.status === 404 ? 404 : 502);
  return res.json() as Promise<T>;
}

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  // GitHub answers big GraphQL queries with an HTML 502/504 page now and then; retry those.
  for (let attempt = 0; ; attempt++) {
    const res = await gh('/graphql', { method: 'POST', body: { query, variables }, timeoutMs: 30_000 });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* HTML error page */ }
    if (json && res.ok && !json.errors) return json.data;
    if (attempt < 2 && (!json || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    const detail = json ? JSON.stringify(json.errors || json) : `${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`;
    throw new GitHubError(`GitHub GraphQL: ${detail.slice(0, 300)}`);
  }
}

// ---------- me ----------

let meCache: Me | null = null;
export async function getMe(token?: string): Promise<Me> {
  if (meCache && !token) return meCache;
  const claudeAvailable = await hasClaude();
  const t = token ? { token, source: 'config' as const } : await getToken();
  if (!t) return { connected: false, login: null, name: null, avatarUrl: null, claudeAvailable, tokenSource: null };
  try {
    const u = await ghJson('/user', { token: t.token });
    const me: Me = { connected: true, login: u.login, name: u.name, avatarUrl: u.avatar_url, claudeAvailable, tokenSource: t.source };
    if (!token) meCache = me;
    return me;
  } catch {
    return { connected: false, login: null, name: null, avatarUrl: null, claudeAvailable, tokenSource: t.source };
  }
}

// ---------- repos ----------

const REPOS_QUERY = `
query($cursor: String) {
  viewer {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false,
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name description diskUsage pushedAt createdAt stargazerCount homepageUrl isPrivate isArchived url
        owner { login }
        primaryLanguage { name color }
        pullRequests { totalCount }
        defaultBranchRef { name target { ... on Commit { history { totalCount } } } }
      }
    }
  }
}`;

let reposCache: { at: number; repos: Repo[] } | null = null;
const defaultBranch = new Map<string, string>();

export async function listRepos(): Promise<Repo[]> {
  if (reposCache && Date.now() - reposCache.at < 10 * 60_000) {
    for (const r of reposCache.repos) r.hasLogo = logoFile(r.name) != null;
    return reposCache.repos;
  }
  const nodes: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    let data: any;
    try { data = await gql(REPOS_QUERY, { cursor }); }
    catch (e) { if (reposCache) return reposCache.repos; throw e; } // GitHub down: keep the last good city
    const conn = data.viewer.repositories;
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  const now = Date.now();
  const repos: Repo[] = nodes
    .filter((n) => !n.isArchived)
    .map((n) => {
      if (n.defaultBranchRef?.name) defaultBranch.set(n.name, n.defaultBranchRef.name);
      const commits = n.defaultBranchRef?.target?.history?.totalCount ?? 0;
      const prs = n.pullRequests.totalCount;
      const diskKb = n.diskUsage ?? 0;
      const days = (now - Date.parse(n.pushedAt || n.createdAt)) / 86_400_000;
      const recency = Math.max(0, 1 - days / 180);
      const score =
        2.2 * Math.log1p(commits) +
        0.9 * Math.log1p(diskKb / 1024) +
        1.4 * Math.log1p(prs) +
        (n.homepageUrl ? 2.5 : 0) +
        2.0 * recency +
        Math.log1p(n.stargazerCount);
      return {
        name: n.name,
        owner: n.owner.login,
        fullName: `${n.owner.login}/${n.name}`,
        description: n.description || '',
        url: n.url,
        homepageUrl: n.homepageUrl || '',
        isPrivate: n.isPrivate,
        language: n.primaryLanguage?.name ?? null,
        languageColor: n.primaryLanguage?.color ?? null,
        stars: n.stargazerCount,
        diskKb,
        commits,
        prs,
        pushedAt: n.pushedAt,
        createdAt: n.createdAt,
        score: Math.round(score * 100) / 100,
        tier: 'small' as Tier,
        hasLogo: logoFile(n.name) != null,
        brandColor: n.primaryLanguage?.color || '#6b7a8f',
      };
    })
    .sort((a, b) => b.score - a.score);

  const total = repos.length;
  repos.forEach((r, i) => {
    const p = (i + 0.5) / total;
    r.tier = p < 0.1 ? 'landmark' : p < 0.3 ? 'tower' : p < 0.65 ? 'midrise' : 'small';
  });

  reposCache = { at: Date.now(), repos };
  // discover logos in the background
  void discoverAllLogos(repos);
  return repos;
}

export async function findRepo(name: string): Promise<Repo> {
  const repo = (await listRepos()).find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!repo) throw new GitHubError(`Unknown repo ${name}`, 404);
  return repo;
}

export function getDefaultBranch(name: string) {
  return defaultBranch.get(name) || 'main';
}

// ---------- logos ----------

const LOGO_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function logoFile(name: string): string | null {
  const base = safeName(name);
  for (const ext of Object.keys(LOGO_TYPES)) {
    const p = join(PATHS.logos, base + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

function logoMissingMarker(name: string) {
  return join(PATHS.logos, safeName(name) + '.none');
}

export function logoContentType(file: string) {
  return LOGO_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
}

const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|out|Pods|vendor|\.git|coverage|__tests__|tests?|fixtures?|__snapshots__|\.vercel|DerivedData|site-packages)(\/|$)/i;
const LOGO_NAME = /(logo|icon|favicon|apple-touch-icon|brand|mark)/i;

export function rankLogoPath(path: string, repoName?: string): number {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop()!;
  const ext = extname(base);
  if (!['.png', '.svg', '.jpg', '.jpeg', '.webp'].includes(ext)) return -1;
  if (SKIP_DIR.test(path) || !LOGO_NAME.test(base)) return -1;
  // skip generic UI icon sets
  if (/(^|\/)(icons?|lucide|heroicons|emoji)\//.test(lower) && !/logo|app-?icon|favicon|apple-touch/.test(base)) return -1;
  let s = 0;
  if (base.includes('logo')) s += 100;
  else if (base.includes('apple-touch-icon')) s += 80;
  else if (/icon-?(512|192|256)/.test(base)) s += 70;
  else if (/^favicon\.(svg|png)$/.test(base)) s += 60;
  else if (/app-?icon/.test(base)) s += 55;
  else if (base.includes('brand')) s += 40;
  else s += 10;
  if (/(^|\/)(public|assets|static|images|img)\//.test(lower)) s += 15;
  if (ext === '.svg') s += 6;
  if (ext === '.png') s += 4;
  if (/(dark|white|mono|small|16|32)/.test(base)) s -= 8;
  // Variants (logo-ember.svg, logo-old.png, logo-v2-alt.svg…) lose to the plain logo and the repo-named one.
  const stem = base.slice(0, base.length - ext.length);
  if (stem === 'logo') s += 12;
  else if (repoName && stem.replace(/[-_ .]/g, '') === `${repoName.toLowerCase().replace(/[-_ .]/g, '')}logo`) s += 10;
  if (/(ember|light|black|inverse|invert|alt|old|legacy|draft|test|v\d|outline|wordmark|text|full|horizontal|stacked|banner|og-image|social)/.test(stem)) s -= 10;
  if (/(^|\/)(docs?|archive|deliverables|marketing|examples?|mockups?)\//.test(lower)) s -= 20;
  s -= path.split('/').length * 3;
  return s;
}

const inflight = new Map<string, Promise<string | null>>();

export function ensureLogo(repo: Repo): Promise<string | null> {
  const have = logoFile(repo.name);
  if (have) return Promise.resolve(have);
  if (existsSync(logoMissingMarker(repo.name))) return Promise.resolve(null);
  if (!inflight.has(repo.name)) {
    inflight.set(
      repo.name,
      discoverLogo(repo)
        .catch(() => null)
        .then((p) => {
          if (!p) writeFileSync(logoMissingMarker(repo.name), '');
          repo.hasLogo = !!p;
          return p;
        })
        .finally(() => inflight.delete(repo.name)),
    );
  }
  return inflight.get(repo.name)!;
}

async function discoverLogo(repo: Repo): Promise<string | null> {
  const branch = getDefaultBranch(repo.name);
  try {
    const tree = await ghJson(`/repos/${repo.fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const candidates = (tree.tree as any[])
      .filter((e) => e.type === 'blob' && (e.size ?? 0) < 2_000_000)
      .map((e) => ({ path: e.path as string, score: rankLogoPath(e.path, repo.name) }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score);
    for (const c of candidates.slice(0, 3)) {
      const res = await gh(`/repos/${repo.fullName}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, {
        accept: 'application/vnd.github.raw',
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) continue;
      const out = join(PATHS.logos, safeName(repo.name) + extname(c.path).toLowerCase());
      writeFileSync(out, buf);
      return out;
    }
  } catch {
    /* empty repo or tree too big; fall through */
  }
  if (repo.homepageUrl) {
    const base = repo.homepageUrl.replace(/\/$/, '');
    for (const p of ['/apple-touch-icon.png', '/favicon.ico']) {
      try {
        const res = await fetch(base + p, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) continue;
        const ext = type.includes('png') ? '.png' : type.includes('svg') ? '.svg' : type.includes('jpeg') ? '.jpg' : '.ico';
        const out = join(PATHS.logos, safeName(repo.name) + ext);
        writeFileSync(out, buf);
        return out;
      } catch {
        /* unreachable homepage */
      }
    }
  }
  return null;
}

async function discoverAllLogos(repos: Repo[]) {
  const queue = repos.filter((r) => !logoFile(r.name) && !existsSync(logoMissingMarker(r.name)));
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const r = queue.shift()!;
      await ensureLogo(r);
    }
  });
  await Promise.all(workers);
}

// ---------- repo detail ----------

const DETAIL_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 24, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number title body state createdAt mergedAt additions deletions changedFiles url
        author { login }
        files(first: 40) { nodes { path } }
        commits(last: 5) { nodes { commit { message } } }
      }
    }
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 40) {
            nodes {
              oid messageHeadline message committedDate additions deletions changedFilesIfAvailable url
              author { name user { login } }
              parents { totalCount }
            }
          }
        }
      }
    }
  }
}`;

const AGENT_PATTERNS: [RegExp, string][] = [
  [/co-authored-by:\s*claude|generated with \[claude code\]|claude\.ai\/code|noreply@anthropic\.com/i, 'Claude'],
  [/co-authored-by:\s*.*copilot|copilot-swe-agent/i, 'Copilot'],
  [/co-authored-by:\s*.*codex|chatgpt\.com\/codex|openai codex/i, 'Codex'],
  [/co-authored-by:\s*.*devin|devin-ai-integration/i, 'Devin'],
  [/co-authored-by:\s*.*cursor|cursoragent/i, 'Cursor'],
];
const LOGIN_PATTERNS: [RegExp, string][] = [
  [/claude/i, 'Claude'],
  [/copilot/i, 'Copilot'],
  [/codex|openai/i, 'Codex'],
  [/devin/i, 'Devin'],
  [/cursor/i, 'Cursor'],
  [/dependabot/i, 'Dependabot'],
  [/renovate/i, 'Renovate'],
  [/vercel/i, 'Vercel Bot'],
  [/\[bot\]$/i, 'Bot'],
];

export function detectAgent(login: string, ...texts: string[]): string | null {
  for (const [re, name] of LOGIN_PATTERNS) if (re.test(login)) return name;
  const text = texts.join('\n');
  for (const [re, name] of AGENT_PATTERNS) if (re.test(text)) return name;
  return null;
}

const detailCache = new Map<string, { at: number; readme: string; workers: Worker[] }>();

export async function repoWorkers(repo: Repo): Promise<{ readme: string; workers: Worker[] }> {
  const hit = detailCache.get(repo.name);
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit;

  const [data, readme] = await Promise.all([
    gql(DETAIL_QUERY, { owner: repo.owner, name: repo.name }),
    gh(`/repos/${repo.fullName}/readme`, { accept: 'application/vnd.github.raw' })
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => ''),
  ]);
  const r = data.repository;
  const workers: Worker[] = [];
  for (const pr of r.pullRequests.nodes as any[]) {
    const login = pr.author?.login || 'ghost';
    const commitMsgs = (pr.commits?.nodes || []).map((n: any) => n.commit.message);
    const agentName = detectAgent(login, pr.body || '', ...commitMsgs);
    workers.push({
      id: `pr-${pr.number}`,
      kind: 'pr',
      number: pr.number,
      sha: null,
      title: pr.title,
      body: (pr.body || '').slice(0, 2000),
      author: login,
      isAgent: !!agentName,
      agentName,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed',
      date: pr.mergedAt || pr.createdAt,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      files: (pr.files?.nodes || []).map((f: any) => f.path),
      url: pr.url,
    });
  }
  if (workers.length < 8) {
    const commits = (r.defaultBranchRef?.target?.history?.nodes || []) as any[];
    for (const c of commits) {
      if (workers.length >= 24) break;
      if (c.parents.totalCount > 1) continue; // merge commit
      const login = c.author?.user?.login || c.author?.name || 'unknown';
      const agentName = detectAgent(login, c.message);
      workers.push({
        id: `c-${c.oid.slice(0, 7)}`,
        kind: 'commit',
        number: null,
        sha: c.oid,
        title: c.messageHeadline,
        body: c.message.slice(0, 2000),
        author: login,
        isAgent: !!agentName,
        agentName,
        state: 'committed',
        date: c.committedDate,
        additions: c.additions,
        deletions: c.deletions,
        changedFiles: c.changedFilesIfAvailable ?? 0,
        files: [],
        url: c.url,
      });
    }
  }
  const out = { at: Date.now(), readme: (readme || '').slice(0, 4000), workers };
  detailCache.set(repo.name, out);
  return out;
}

export async function findWorker(repo: Repo, workerId: string): Promise<Worker> {
  const { workers } = await repoWorkers(repo);
  const w = workers.find((x) => x.id === workerId);
  if (!w) throw new GitHubError(`Unknown worker ${workerId}`, 404);
  return w;
}

const diffCache = new Map<string, string>();

/** The worker's actual diff (PR or commit), truncated. Also fills commit file lists. */
export async function workerDiff(repo: Repo, w: Worker, max = 12_000): Promise<string> {
  const key = `${repo.name}:${w.id}`;
  if (diffCache.has(key)) return diffCache.get(key)!;
  let diff = '';
  try {
    const path = w.kind === 'pr' ? `/repos/${repo.fullName}/pulls/${w.number}` : `/repos/${repo.fullName}/commits/${w.sha}`;
    const res = await gh(path, { accept: 'application/vnd.github.diff', timeoutMs: 20_000 });
    if (res.ok) diff = await res.text();
  } catch {
    /* diff unavailable */
  }
  if (w.kind === 'commit' && !w.files.length && diff) {
    w.files = [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).slice(0, 40);
  }
  if (diff.length > max) diff = diff.slice(0, max) + `\n... [diff truncated, ${diff.length - max} more chars]`;
  diffCache.set(key, diff);
  return diff;
}

/** Validate a token without caching it. */
export async function validateToken(token: string) {
  return getMe(token);
}

export function readLogo(file: string) {
  return readFileSync(file);
}

export function listCachedLogos() {
  return readdirSync(PATHS.logos);
}

// ---------- pulse: the live state of many repos in one query ----------

const PULSE_FIELDS = `
  pushedAt
  latestRelease { tagName publishedAt }
  defaultBranchRef {
    target {
      ... on Commit {
        history(first: 10) {
          nodes { oid messageHeadline committedDate author { name user { login } } statusCheckRollup { state } }
        }
      }
    }
  }
  pullRequests(states: OPEN, first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes { number title url createdAt isDraft body author { login } commits(last: 3) { nodes { commit { message } } } }
  }
  issues(states: OPEN, first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes { number title url createdAt labels(first: 6) { nodes { name } } }
  }`;

const CI: Record<string, CiState> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' };

export interface RawPulse {
  pushedAt: string;
  ci: CiState;
  ciSince: string | null;
  openPrs: PulsePr[];
  openIssues: PulseIssue[];
  recentCommits: PulseCommit[];
  lastRelease: { tag: string; publishedAt: string } | null;
}

/** CI, open PRs and issues, recent commits and the latest release for up to ~8 repos per GraphQL call. */
export async function repoPulses(repos: Repo[]): Promise<Map<string, RawPulse>> {
  const out = new Map<string, RawPulse>();
  for (let i = 0; i < repos.length; i += 8) {
    const batch = repos.slice(i, i + 8);
    const query = `query {\n${batch.map((r, k) => `  r${k}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) { ${PULSE_FIELDS} }`).join('\n')}\n}`;
    const data = await gql(query);
    batch.forEach((r, k) => {
      const n = data[`r${k}`];
      if (!n) return;
      const history: any[] = n.defaultBranchRef?.target?.history?.nodes ?? [];
      const state = (c: any): CiState => CI[c?.statusCheckRollup?.state] ?? 'none';
      const ci = history.length ? state(history[0]) : 'none';
      // The branch has been in this state since the oldest commit of the newest unbroken run.
      let since: string | null = null;
      for (const c of history) { if (state(c) !== ci) break; since = c.committedDate; }
      out.set(r.name, {
        pushedAt: n.pushedAt,
        ci,
        ciSince: ci === 'none' ? null : since,
        openPrs: (n.pullRequests?.nodes ?? []).map((p: any) => {
          const login = p.author?.login ?? 'ghost';
          // AI coding agents only: dependency bots aren't waiting on a conversation with you.
          const agent = detectAgent(login, p.body || '', ...(p.commits?.nodes ?? []).map((c: any) => c.commit?.message || ''));
          return {
            number: p.number, title: p.title, author: login, url: p.url, createdAt: p.createdAt, isDraft: !!p.isDraft,
            isAgent: !!agent && !/^(Dependabot|Renovate|Vercel Bot|Bot)$/.test(agent),
          };
        }),
        openIssues: (n.issues?.nodes ?? []).map((x: any) => ({
          number: x.number, title: x.title, url: x.url, createdAt: x.createdAt, labels: (x.labels?.nodes ?? []).map((l: any) => l.name),
        })),
        recentCommits: history.map((c) => ({ sha: c.oid, message: c.messageHeadline, author: c.author?.user?.login || c.author?.name || 'unknown', date: c.committedDate })),
        lastRelease: n.latestRelease ? { tag: n.latestRelease.tagName, publishedAt: n.latestRelease.publishedAt } : null,
      });
    });
  }
  return out;
}

// ---------- project control: PRs, issues and CI from the phone ----------

/** Writes are logged and faked, never sent (tests, demos). OPENWORLD_DRY_PR implies it. */
export const DRY_GITHUB = process.env.OPENWORLD_DRY_GITHUB === '1' || process.env.OPENWORLD_DRY_PR === '1';

/** One GitHub write. In dry mode, logs the exact request it would have made and returns `fake`. */
async function ghWrite<T = any>(method: string, path: string, body: unknown, fake: T): Promise<{ data: T; dry: boolean }> {
  if (DRY_GITHUB) {
    console.log(`[dry-github] ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    logEvent('dry_github_write', { method, path, body });
    return { data: fake, dry: true };
  }
  const res = await gh(path, { method, body });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
    throw new GitHubError(`GitHub said no: ${msg}`, res.status === 404 ? 404 : res.status === 405 || res.status === 409 || res.status === 422 ? 409 : 502);
  }
  return { data: (text ? JSON.parse(text) : {}) as T, dry: false };
}

const PR_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      number title body url isDraft createdAt headRefName baseRefName additions deletions changedFiles mergeable reviewDecision
      author { login }
      comments { totalCount }
      files(first: 40) { nodes { path additions deletions } }
      commits(last: 1) { nodes { commit { message statusCheckRollup { state } } } }
    }
  }
}`;

export async function prDetail(repo: Repo, n: number): Promise<PrDetail> {
  const data = await gql(PR_QUERY, { owner: repo.owner, name: repo.name, n });
  const p = data.repository?.pullRequest;
  if (!p) throw new GitHubError(`No PR #${n} in ${repo.name}`, 404);
  const last = p.commits?.nodes?.[0]?.commit;
  const login = p.author?.login ?? 'ghost';
  return {
    number: p.number, title: p.title, body: (p.body || '').slice(0, 6000), author: login,
    isAgent: !!detectAgent(login, p.body || '', last?.message || ''),
    url: p.url, isDraft: !!p.isDraft, createdAt: p.createdAt, headRef: p.headRefName, baseRef: p.baseRefName,
    additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
    files: (p.files?.nodes ?? []).map((f: any) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    ci: CI[last?.statusCheckRollup?.state] ?? 'none',
    mergeable: p.mergeable === 'MERGEABLE' ? true : p.mergeable === 'CONFLICTING' ? false : null,
    reviewDecision: p.reviewDecision ?? null,
    comments: p.comments?.totalCount ?? 0,
  };
}

export async function issueDetail(repo: Repo, n: number): Promise<IssueDetail> {
  const i = await ghJson(`/repos/${repo.owner}/${repo.name}/issues/${n}`);
  return {
    number: i.number, title: i.title, body: (i.body || '').slice(0, 6000), author: i.user?.login ?? 'ghost', url: i.html_url,
    labels: (i.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)), createdAt: i.created_at, comments: i.comments ?? 0,
  };
}

export async function mergePr(repo: Repo, n: number) {
  const { dry } = await ghWrite('PUT', `/repos/${repo.owner}/${repo.name}/pulls/${n}/merge`, { merge_method: 'squash' }, { merged: true });
  return { dry, message: `Merged #${n} into ${getDefaultBranch(repo.name)}` };
}

export async function closePr(repo: Repo, n: number) {
  const { dry } = await ghWrite('PATCH', `/repos/${repo.owner}/${repo.name}/pulls/${n}`, { state: 'closed' }, {});
  return { dry, message: `Closed #${n}` };
}

/** PRs and issues share GitHub's comment thread. */
export async function commentOn(repo: Repo, n: number, body: string) {
  const { dry, data } = await ghWrite('POST', `/repos/${repo.owner}/${repo.name}/issues/${n}/comments`, { body }, { html_url: `https://github.com/${repo.fullName}/issues/${n}` });
  return { dry, message: `Commented on #${n}`, url: data.html_url as string };
}

export async function createIssue(repo: Repo, title: string, body: string) {
  const { dry, data } = await ghWrite('POST', `/repos/${repo.owner}/${repo.name}/issues`, { title, body }, { number: 0, html_url: `https://github.com/${repo.fullName}/issues` });
  return { dry, number: data.number as number, url: data.html_url as string, message: dry ? 'Issue created (dry run)' : `Opened issue #${data.number}` };
}

export async function closeIssue(repo: Repo, n: number) {
  const { dry } = await ghWrite('PATCH', `/repos/${repo.owner}/${repo.name}/issues/${n}`, { state: 'closed', state_reason: 'completed' }, {});
  return { dry, message: `Closed issue #${n}` };
}

/** Re-run the failed jobs of the newest failed GitHub Actions run on the default branch. */
export async function rerunFailedCi(repo: Repo) {
  const branch = getDefaultBranch(repo.name);
  const runs = await ghJson(`/repos/${repo.owner}/${repo.name}/actions/runs?branch=${encodeURIComponent(branch)}&status=failure&per_page=1`);
  const r = runs.workflow_runs?.[0];
  if (!r) throw new GitHubError(`No failed GitHub Actions run on ${branch} to re-run (CI may come from another service)`, 404);
  const { dry } = await ghWrite('POST', `/repos/${repo.owner}/${repo.name}/actions/runs/${r.id}/rerun-failed-jobs`, null, {});
  return { dry, message: `Re-running “${r.name}” on ${branch}`, url: r.html_url as string };
}
