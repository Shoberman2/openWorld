// Project control: what the phone's project page can do to a repo. Merge or close PRs, comment, open
// and close issues, hand an issue to an agent, re-run failed CI. Every write refreshes that repo's pulse
// so the building (and the phone) catch up; dry-run writes patch the pulse locally instead.
import type { Express, Request, Response } from 'express';
import type { ControlResult } from '../shared/types.ts';
import { logEvent } from './config.ts';
import {
  DRY_GITHUB, findRepo, prDetail, issueDetail, mergePr, closePr, commentOn, createIssue, closeIssue, rerunFailedCi,
} from './github.ts';
import { patchPulse, refreshRepo } from './pulse.ts';
import { startAgent } from './agents.ts';

type Handler = (req: Request) => Promise<unknown>;
const h = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    res.json(await fn(req));
  } catch (e: any) {
    res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message || String(e) });
  }
};

const num = (req: Request) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Bad number'), { status: 400 });
  return n;
};
const text = (v: unknown, field: string, max = 20_000) => {
  const s = String(v ?? '').trim();
  if (!s) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  return s.slice(0, max);
};

/** Log it, then let GitHub settle a moment before re-reading the repo (or patch it locally in dry runs). */
function after(repo: string, action: string, result: { dry: boolean; message: string; number?: number; url?: string }, dryPatch?: Parameters<typeof patchPulse>[1]): ControlResult {
  logEvent('project_control', { repo, action, dry: result.dry });
  if (result.dry) { if (dryPatch) patchPulse(repo, dryPatch); }
  else setTimeout(() => void refreshRepo(repo), 1500);
  return { ok: true, message: result.message, number: result.number, url: result.url, dry: result.dry || undefined };
}

export function registerControl(app: Express) {
  if (DRY_GITHUB) console.log('GitHub writes are dry runs (OPENWORLD_DRY_GITHUB): nothing is sent.');

  app.get('/api/projects/:repo/prs/:n', h(async (req) => prDetail(await findRepo(String(req.params.repo)), num(req))));
  app.get('/api/projects/:repo/issues/:n', h(async (req) => issueDetail(await findRepo(String(req.params.repo)), num(req))));

  app.post('/api/projects/:repo/prs/:n/merge', h(async (req) => {
    const repo = await findRepo(String(req.params.repo)), n = num(req);
    return after(repo.name, 'merge', await mergePr(repo, n), (p) => { p.openPrs = p.openPrs.filter((x) => x.number !== n); });
  }));
  app.post('/api/projects/:repo/prs/:n/close', h(async (req) => {
    const repo = await findRepo(String(req.params.repo)), n = num(req);
    return after(repo.name, 'close_pr', await closePr(repo, n), (p) => { p.openPrs = p.openPrs.filter((x) => x.number !== n); });
  }));
  app.post('/api/projects/:repo/prs/:n/comment', h(async (req) => {
    const repo = await findRepo(String(req.params.repo));
    return after(repo.name, 'comment_pr', await commentOn(repo, num(req), text(req.body?.body, 'Comment')));
  }));

  app.post('/api/projects/:repo/issues', h(async (req) => {
    const repo = await findRepo(String(req.params.repo));
    const title = text(req.body?.title, 'Title', 256);
    const r = await createIssue(repo, title, String(req.body?.body ?? '').slice(0, 20_000));
    return after(repo.name, 'create_issue', r, (p) => {
      p.openIssues.unshift({ number: r.number, title, url: r.url, labels: [], createdAt: new Date().toISOString() });
    });
  }));
  app.post('/api/projects/:repo/issues/:n/close', h(async (req) => {
    const repo = await findRepo(String(req.params.repo)), n = num(req);
    return after(repo.name, 'close_issue', await closeIssue(repo, n), (p) => { p.openIssues = p.openIssues.filter((x) => x.number !== n); });
  }));
  app.post('/api/projects/:repo/issues/:n/comment', h(async (req) => {
    const repo = await findRepo(String(req.params.repo));
    return after(repo.name, 'comment_issue', await commentOn(repo, num(req), text(req.body?.body, 'Comment')));
  }));
  // An agent takes the issue: its title and body become the task. Nothing is pushed until you review it.
  app.post('/api/projects/:repo/issues/:n/agent', h(async (req) => {
    const repo = await findRepo(String(req.params.repo));
    const i = await issueDetail(repo, num(req));
    logEvent('project_control', { repo: repo.name, action: 'issue_to_agent' });
    return startAgent(repo, `Work on GitHub issue #${i.number}: ${i.title}\n\n${i.body || '(no description)'}\n\nMake the smallest change that resolves it. Mention "#${i.number}" in your summary.`, req.body?.provider ? String(req.body.provider) : null);
  }));

  app.post('/api/projects/:repo/ci/rerun', h(async (req) => {
    const repo = await findRepo(String(req.params.repo));
    return after(repo.name, 'rerun_ci', await rerunFailedCi(repo), (p) => { p.ci = 'pending'; p.ciSince = new Date().toISOString(); });
  }));
}
