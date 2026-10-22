// The phone's project page: one repo's control center. Its live state (CI, PRs, issues, agents,
// commits, release) and everything you can do about it from anywhere in the world: give a task, stop or
// review agents, merge / close / comment on PRs, open / close issues or hand one to an agent, re-run
// failed CI, and switch on the lead's scheduled work. Every button here does the real thing.
import type { AgentInfo, IssueDetail, PrDetail, Repo, RepoPulse } from '../../../shared/types.ts';
import { projects, track } from '../api.ts';
import { esc } from '../interact.ts';
import { pulse } from '../pulse.ts';
import { TEMPLATES, addTemplate, cadenceLabel, renderSchedulesApp, runSchedule, schedulesFor, toggleSchedule } from './schedules.ts';
import { agentPicker, pickedAgent } from './agentPick.ts';
import './phoneProject.css';

export type ProjectSub = 'pr' | 'issue' | 'new-issue' | 'add-schedule';
export interface ProjectView { app: 'project'; repo: string; sub?: ProjectSub; n?: number }

export interface ProjectDeps {
  el: HTMLElement;
  header(title: string, sub?: string, right?: string): string;
  bindCommon(): void;
  /** Navigate the phone. */
  go(v: ProjectView | { app: 'agent'; id: string } | { app: 'thread'; id: string } | { app: 'projects' }): void;
  /** Still showing this view? (async results arriving late shouldn't redraw another screen) */
  showing(v: ProjectView): boolean;
  repo(name: string): Repo | undefined;
  agents(): AgentInfo[];
  agentCard(a: AgentInfo): string;
  bindAgentCards(): void;
  hire(repo: string, task: string): Promise<AgentInfo>;
  travelTo(repo: string): void;
  canTravel(repo: string): boolean;
  leadAvatar(r: Repo | undefined, name: string): string;
  toast(text: string): void;
  /** Back from a sub-form (schedule add) */
  setBack(fn: (() => boolean) | null): void;
}

const LIVE = new Set(['preparing', 'running', 'needs_input']);
const CI_LABEL = { passing: 'CI passing', failing: 'CI failing', pending: 'CI running', none: 'No CI' } as const;
const needsReview = (a: AgentInfo) => a.review === 'pending' || (a.review == null && a.status === 'done' && a.filesChanged.length > 0 && !a.prUrl);

export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const m = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  if (m < 60 * 24 * 60) return `${Math.round(m / 1440)}d ago`;
  return `${Math.round(m / 43200)}mo ago`;
}

/** Compact status for project lists: CI dot plus what's open and who's working. */
export function projectStatusHtml(p: RepoPulse | undefined, working: number) {
  const bits: string[] = [];
  if (working) bits.push(`<span class="good">${working} working</span>`);
  if (p?.openPrs.length) bits.push(`${p.openPrs.length} PR${p.openPrs.length === 1 ? '' : 's'}`);
  if (p?.openIssues.length) bits.push(`${p.openIssues.length} issue${p.openIssues.length === 1 ? '' : 's'}`);
  if (p && !bits.length) bits.push(p.stale ? `quiet · ${ago(p.pushedAt)}` : `pushed ${ago(p.pushedAt)}`);
  return `<span class="pj-ci ${p?.ci ?? 'none'}" title="${CI_LABEL[p?.ci ?? 'none']}"></span>${bits.join(' · ')}`;
}

// Two-tap confirm for anything public or destructive: the first tap arms the button for a few seconds.
const armed = new Map<string, number>();
function armOrGo(btn: HTMLButtonElement, key: string, armedText: string): boolean {
  if ((armed.get(key) ?? 0) > Date.now()) { armed.delete(key); return true; }
  armed.set(key, Date.now() + 4000);
  const was = btn.textContent;
  btn.textContent = armedText;
  btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected && btn.classList.contains('armed')) { btn.textContent = was; btn.classList.remove('armed'); } }, 4000);
  return false;
}

const prCache = new Map<string, PrDetail>();
const issueCache = new Map<string, IssueDetail>();

export function renderProject(d: ProjectDeps, v: ProjectView, fresh: boolean) {
  if (v.sub === 'pr' && v.n) return renderPr(d, v, v.n);
  if (v.sub === 'issue' && v.n) return renderIssue(d, v, v.n);
  if (v.sub === 'new-issue') return renderNewIssue(d, v);
  if (v.sub === 'add-schedule') return renderAddSchedule(d, v);
  return renderOverview(d, v, fresh);
}

/** Run a project action with button feedback, a toast, and analytics. */
async function act(d: ProjectDeps, btn: HTMLButtonElement | null, busyText: string, repo: string, action: string, fn: () => Promise<{ message: string; dry?: boolean } | void>) {
  const was = btn?.textContent ?? '';
  if (btn) { btn.disabled = true; btn.classList.remove('armed'); btn.textContent = busyText; }
  try {
    const r = await fn();
    track('project_action', { repo, action });
    if (r) d.toast(`${r.message}${r.dry ? ' · dry run, nothing sent' : ''}`);
    return true;
  } catch (e) {
    d.toast(`Couldn't do that: ${(e as Error).message}`);
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = was; }
    return false;
  }
}

// ---------------------------------------------------------------- overview
function renderOverview(d: ProjectDeps, v: ProjectView, fresh: boolean) {
  const name = v.repo;
  const r = d.repo(name);
  const p = pulse.get(name);
  const mine = d.agents().filter((a) => a.repo === name);
  const live = mine.filter((a) => LIVE.has(a.status));
  const asking = mine.filter((a) => a.status === 'needs_input');
  const review = mine.filter(needsReview);
  const working = live.filter((a) => a.status !== 'needs_input');
  const scheds = schedulesFor(name);
  if (fresh) track('project_opened', { repo: name });

  let html = d.header(esc(name), esc(r?.description ? r.description.slice(0, 60) : 'Project'),
    `<button class="pv-icon" data-chat title="Text the lead">${CHAT}</button>${d.canTravel(name) ? `<button class="pv-icon" data-travel title="Teleport to its building">${PIN}</button>` : ''}`);
  html += `<div class="pv-scroll pj">`;

  // Status strip
  const ci = p?.ci ?? 'none';
  html += `<div class="pj-status">
    <div class="pj-stat ci-${ci}"><b><span class="pj-ci ${ci}"></span>${CI_LABEL[ci]}</b><small>${p?.ciSince && ci !== 'none' ? `since ${ago(p.ciSince)}` : p ? `pushed ${ago(p.pushedAt)}` : 'loading…'}</small>
      ${ci === 'failing' ? '<div class="pj-ci-acts"><button class="pbtn sm" data-rerun>Re-run</button><button class="pbtn sm ghost" data-fix-ci>Fix with an agent</button></div>' : ''}</div>
    <div class="pj-nums">
      <a href="#pj-prs"><b>${p?.openPrs.length ?? '–'}</b><small>PRs</small></a>
      <a href="#pj-issues"><b>${p?.openIssues.length ?? '–'}</b><small>issues</small></a>
      <a href="#pj-agents"><b>${live.length}</b><small>agents</small></a>
    </div>
  </div>`;

  // Give a task
  html += `<form class="pj-task" data-task><input data-keep="pj-task-${esc(name)}" placeholder="Give ${esc(name)} a task…" autocomplete="off" /><button class="pbtn" type="submit">Start</button></form>
    <p class="pj-hint">An agent works on its own branch. Nothing is pushed until you approve it.</p>`;

  // Needs you
  if (asking.length || review.length) {
    html += `<h5 class="home-h">Needs you</h5>${[...asking, ...review].map(d.agentCard).join('')}`;
  }
  // Agents
  html += `<h5 class="home-h" id="pj-agents">Agents</h5>`;
  html += working.length ? working.map(d.agentCard).join('') : `<p class="pj-empty">No one is working here right now.</p>`;

  // Pull requests
  const prs = p?.openPrs ?? [];
  html += `<h5 class="home-h" id="pj-prs">Pull requests${prs.length ? ` · ${prs.length}` : ''}</h5>`;
  html += prs.length ? `<div class="pj-list">${prs.map((x) => `<button class="pj-row" data-pr="${x.number}">
      <span class="pj-num">#${x.number}</span><div><b>${esc(x.title)}</b><small>${esc(x.author)}${x.isAgent ? ' · <span class="pj-agent">agent</span>' : ''}${x.isDraft ? ' · draft' : ''} · ${ago(x.createdAt)}</small></div><span class="pj-chev">›</span></button>`).join('')}</div>`
    : `<p class="pj-empty">${p ? 'No open pull requests.' : 'Loading…'}</p>`;

  // Issues
  const issues = p?.openIssues ?? [];
  html += `<h5 class="home-h pj-h-row" id="pj-issues"><span>Issues${issues.length ? ` · ${issues.length}` : ''}</span><button class="pbtn sm ghost" data-new-issue>+ New issue</button></h5>`;
  html += issues.length ? `<div class="pj-list">${issues.map((x) => `<button class="pj-row" data-issue="${x.number}">
      <span class="pj-num">#${x.number}</span><div><b>${esc(x.title)}</b><small>${x.labels.length ? `${x.labels.slice(0, 3).map(esc).join(', ')} · ` : ''}${ago(x.createdAt)}</small></div><span class="pj-chev">›</span></button>`).join('')}</div>`
    : `<p class="pj-empty">${p ? 'No open issues.' : 'Loading…'}</p>`;

  // Automations (the lead's scheduled work)
  html += `<h5 class="home-h">Runs on a schedule</h5>`;
  if (!scheds) html += `<p class="pj-empty">Loading…</p>`;
  else {
    html += scheds.map((s) => `<div class="pj-sched" data-sched="${esc(s.id)}">
      <div><b>${esc((TEMPLATES.find((t) => t.task === s.task)?.title) ?? s.task.split('\n')[0].slice(0, 60))}</b><small>${esc(cadenceLabel(s))}${s.lastRunAt ? ` · last ${ago(s.lastRunAt)}` : ''}</small></div>
      <button class="pbtn sm ghost" data-run-sched>Run now</button>
      <button class="sc-toggle ${s.enabled ? 'on' : ''}" data-toggle-sched aria-pressed="${s.enabled}" title="${s.enabled ? 'Turn off' : 'Turn on'}"></button></div>`).join('');
    const unused = TEMPLATES.filter((t) => !scheds.some((s) => s.task === t.task));
    html += `<div class="pj-tpls">${unused.map((t) => `<button class="pj-tpl" data-tpl="${t.id}" title="${esc(t.blurb)}">+ ${esc(t.title)}</button>`).join('')}<button class="pj-tpl" data-custom-sched>+ Custom…</button></div>`;
  }

  // Recent activity
  if (p?.recentCommits.length || p?.lastRelease) {
    html += `<h5 class="home-h">Recent</h5><div class="pj-commits">`;
    if (p.lastRelease) html += `<div><span class="pj-rel">${esc(p.lastRelease.tag)}</span><small>released ${ago(p.lastRelease.publishedAt)}</small></div>`;
    html += p.recentCommits.slice(0, 4).map((c) => `<div><code>${esc(c.sha.slice(0, 7))}</code><span>${esc(c.message)}</span><small>${esc(c.author)} · ${ago(c.date)}</small></div>`).join('');
    html += `</div>`;
  }
  if (r) html += `<a class="pbtn ghost pj-gh" href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a>`;
  html += `</div>`;

  d.el.innerHTML = html;
  d.bindCommon();
  d.bindAgentCards();
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => d.el.querySelector<T>(s);
  $('[data-chat]')?.addEventListener('click', () => d.go({ app: 'thread', id: name }));
  $('[data-travel]')?.addEventListener('click', () => d.travelTo(name));
  d.el.querySelectorAll<HTMLAnchorElement>('.pj-nums a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    d.el.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const rerun = $<HTMLButtonElement>('[data-rerun]');
  rerun?.addEventListener('click', () => void act(d, rerun, 'Re-running…', name, 'rerun_ci', () => projects.rerunCi(name)));
  const fixCi = $<HTMLButtonElement>('[data-fix-ci]');
  fixCi?.addEventListener('click', () => void act(d, fixCi, 'Starting…', name, 'fix_ci', async () => {
    const a = await d.hire(name, `CI is failing on the default branch${p?.ciSince ? ` (since ${p.ciSince.slice(0, 10)})` : ''}. Run the build, tests and type checker the way CI does, find the cause, and fix it with the smallest sensible change. If it can't be reproduced locally, explain what you found.`);
    return { message: `${a.name} is fixing CI` };
  }));

  const form = $<HTMLFormElement>('[data-task]')!;
  form.after(agentPicker());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input')!;
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const a = await d.hire(name, text);
      input.value = '';
      track('agent_assigned', { from: 'phone_project' });
      d.toast(`${a.name} is on it`);
    } catch (err) { d.toast(`Couldn't start an agent: ${(err as Error).message}`); }
    btn.disabled = false;
    btn.textContent = 'Start';
  });

  d.el.querySelectorAll<HTMLElement>('[data-pr]').forEach((b) => b.addEventListener('click', () => d.go({ app: 'project', repo: name, sub: 'pr', n: Number(b.dataset.pr) })));
  d.el.querySelectorAll<HTMLElement>('[data-issue]').forEach((b) => b.addEventListener('click', () => d.go({ app: 'project', repo: name, sub: 'issue', n: Number(b.dataset.issue) })));
  $('[data-new-issue]')?.addEventListener('click', () => d.go({ app: 'project', repo: name, sub: 'new-issue' }));
  $('[data-custom-sched]')?.addEventListener('click', () => d.go({ app: 'project', repo: name, sub: 'add-schedule' }));
  d.el.querySelectorAll<HTMLButtonElement>('[data-tpl]').forEach((b) => b.addEventListener('click', () =>
    void act(d, b, 'Adding…', name, 'schedule_add', async () => {
      const s = await addTemplate(name, b.dataset.tpl!);
      return { message: `Scheduled · ${cadenceLabel(s)}` };
    })));
  d.el.querySelectorAll<HTMLElement>('[data-sched]').forEach((row) => {
    const s = scheds?.find((x) => x.id === row.dataset.sched);
    if (!s) return;
    row.querySelector('[data-toggle-sched]')!.addEventListener('click', () => void act(d, null, '', name, 'schedule_toggle', async () => { await toggleSchedule(s); }));
    const run = row.querySelector<HTMLButtonElement>('[data-run-sched]')!;
    run.addEventListener('click', () => void act(d, run, 'Starting…', name, 'schedule_run', async () => {
      const a = await runSchedule(s.id);
      return { message: `${a.name} started` };
    }));
  });
}

// ---------------------------------------------------------------- pull request
function renderPr(d: ProjectDeps, v: ProjectView, n: number) {
  const name = v.repo;
  const key = `${name}#${n}`;
  const summary = pulse.get(name)?.openPrs.find((x) => x.number === n);
  const pr = prCache.get(key);
  let html = d.header(`#${n}`, esc(name));
  html += `<div class="pv-scroll pj pj-detail">`;
  html += `<h4 class="pj-title">${esc(pr?.title ?? summary?.title ?? 'Pull request')}</h4>`;
  if (!pr) {
    html += `<p class="pj-empty">Loading the pull request…</p>`;
  } else {
    const ciTxt = pr.ci === 'none' ? 'No checks' : CI_LABEL[pr.ci];
    const merge = pr.mergeable === false ? '<span class="bad">Has conflicts</span>' : pr.mergeable === null ? 'Checking mergeability…' : '<span class="good">Can merge</span>';
    const review = pr.reviewDecision === 'APPROVED' ? ' · <span class="good">Approved</span>' : pr.reviewDecision === 'CHANGES_REQUESTED' ? ' · <span class="bad">Changes requested</span>' : '';
    html += `<p class="pj-meta">${esc(pr.author)}${pr.isAgent ? ' · <span class="pj-agent">agent</span>' : ''}${pr.isDraft ? ' · draft' : ''} · ${ago(pr.createdAt)}<br>
      <code>${esc(pr.headRef)}</code> → <code>${esc(pr.baseRef)}</code></p>
      <div class="pj-facts"><span><span class="pj-ci ${pr.ci}"></span>${ciTxt}</span><span>${merge}${review}</span><span><b class="good">+${pr.additions}</b> <b class="bad">−${pr.deletions}</b> · ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'}</span></div>`;
    if (pr.body.trim()) html += `<div class="pj-body">${esc(pr.body.slice(0, 1600))}${pr.body.length > 1600 ? '…' : ''}</div>`;
    if (pr.files.length) html += `<details class="pj-files"><summary>Files changed</summary>${pr.files.map((f) => `<div><code>${esc(f.path)}</code><small><b class="good">+${f.additions}</b> <b class="bad">−${f.deletions}</b></small></div>`).join('')}</details>`;
    html += `<div class="pj-actions">
      <button class="pbtn" data-merge ${pr.isDraft || pr.mergeable === false ? 'disabled' : ''}>${pr.isDraft ? 'Draft: can’t merge' : pr.mergeable === false ? 'Conflicts: can’t merge' : 'Squash & merge'}</button>
      <button class="pbtn danger" data-close>Close</button>
    </div>
    <form class="pj-comment" data-comment><textarea data-keep="pj-c-${esc(key)}" placeholder="Leave a comment on #${n}…"></textarea><button class="pbtn sm" type="submit">Comment</button></form>`;
  }
  html += `<a class="pbtn ghost pj-gh" href="${esc(pr?.url ?? summary?.url ?? '#')}" target="_blank" rel="noopener">Open on GitHub ↗</a></div>`;
  d.el.innerHTML = html;
  d.bindCommon();

  if (!pr) {
    projects.pr(name, n).then((x) => { prCache.set(key, x); if (d.showing(v)) renderPr(d, v, n); })
      .catch((e) => { const el = d.el.querySelector('.pj-empty'); if (el && d.showing(v)) el.textContent = `Couldn't load it: ${(e as Error).message}`; });
    return;
  }
  const done = () => { prCache.delete(key); d.go({ app: 'project', repo: name }); };
  const mergeBtn = d.el.querySelector<HTMLButtonElement>('[data-merge]')!;
  mergeBtn.addEventListener('click', async () => {
    if (!armOrGo(mergeBtn, `merge:${key}`, `Tap again to merge into ${pr.baseRef}`)) return;
    if (await act(d, mergeBtn, 'Merging…', name, 'merge_pr', () => projects.merge(name, n))) done();
  });
  const closeBtn = d.el.querySelector<HTMLButtonElement>('[data-close]')!;
  closeBtn.addEventListener('click', async () => {
    if (!armOrGo(closeBtn, `close:${key}`, 'Tap again to close')) return;
    if (await act(d, closeBtn, 'Closing…', name, 'close_pr', () => projects.closePr(name, n))) done();
  });
  bindComment(d, name, 'comment_pr', (body) => projects.commentPr(name, n, body), () => { const c = prCache.get(key); if (c) c.comments++; });
}

function bindComment(d: ProjectDeps, repo: string, action: string, send: (body: string) => Promise<{ message: string; dry?: boolean }>, after: () => void) {
  const form = d.el.querySelector<HTMLFormElement>('[data-comment]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = form.querySelector('textarea')!;
    const body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    if (await act(d, form.querySelector('button'), 'Sending…', repo, action, () => send(body))) {
      ta.value = '';
      after();
      const b = form.querySelector('button')!;
      b.disabled = false;
      b.textContent = 'Comment';
    }
  });
}

// ---------------------------------------------------------------- issue
function renderIssue(d: ProjectDeps, v: ProjectView, n: number) {
  const name = v.repo;
  const key = `${name}#${n}`;
  const summary = pulse.get(name)?.openIssues.find((x) => x.number === n);
  const issue = issueCache.get(key);
  let html = d.header(`Issue #${n}`, esc(name));
  html += `<div class="pv-scroll pj pj-detail"><h4 class="pj-title">${esc(issue?.title ?? summary?.title ?? 'Issue')}</h4>`;
  if (!issue) html += `<p class="pj-empty">Loading the issue…</p>`;
  else {
    html += `<p class="pj-meta">${esc(issue.author)} · ${ago(issue.createdAt)}${issue.comments ? ` · ${issue.comments} comment${issue.comments === 1 ? '' : 's'}` : ''}${issue.labels.length ? `<br>${issue.labels.map((l) => `<span class="pj-label">${esc(l)}</span>`).join(' ')}` : ''}</p>`;
    html += issue.body.trim() ? `<div class="pj-body">${esc(issue.body.slice(0, 1600))}${issue.body.length > 1600 ? '…' : ''}</div>` : `<p class="pj-empty">No description.</p>`;
    html += `<div class="pj-actions">
      <button class="pbtn" data-agent>Hand to an agent</button>
      <button class="pbtn danger" data-close>Close issue</button>
    </div>
    <form class="pj-comment" data-comment><textarea data-keep="pj-c-${esc(key)}" placeholder="Comment on #${n}…"></textarea><button class="pbtn sm" type="submit">Comment</button></form>`;
  }
  html += `<a class="pbtn ghost pj-gh" href="${esc(issue?.url ?? summary?.url ?? '#')}" target="_blank" rel="noopener">Open on GitHub ↗</a></div>`;
  d.el.innerHTML = html;
  d.bindCommon();
  if (!issue) {
    projects.issue(name, n).then((x) => { issueCache.set(key, x); if (d.showing(v)) renderIssue(d, v, n); })
      .catch((e) => { const el = d.el.querySelector('.pj-empty'); if (el && d.showing(v)) el.textContent = `Couldn't load it: ${(e as Error).message}`; });
    return;
  }
  const agentBtn = d.el.querySelector<HTMLButtonElement>('[data-agent]')!;
  agentBtn.addEventListener('click', async () => {
    agentBtn.disabled = true;
    agentBtn.textContent = 'Starting…';
    try {
      const a = await projects.issueToAgent(name, n, pickedAgent());
      track('project_action', { repo: name, action: 'issue_to_agent' });
      d.toast(`${a.name} took issue #${n}`);
      d.go({ app: 'agent', id: a.id });
    } catch (e) {
      d.toast(`Couldn't start an agent: ${(e as Error).message}`);
      agentBtn.disabled = false;
      agentBtn.textContent = 'Hand to an agent';
    }
  });
  const closeBtn = d.el.querySelector<HTMLButtonElement>('[data-close]')!;
  closeBtn.addEventListener('click', async () => {
    if (!armOrGo(closeBtn, `close:${key}`, 'Tap again to close')) return;
    if (await act(d, closeBtn, 'Closing…', name, 'close_issue', () => projects.closeIssue(name, n))) { issueCache.delete(key); d.go({ app: 'project', repo: name }); }
  });
  bindComment(d, name, 'comment_issue', (body) => projects.commentIssue(name, n, body), () => { const c = issueCache.get(key); if (c) c.comments++; });
}

function renderNewIssue(d: ProjectDeps, v: ProjectView) {
  const name = v.repo;
  d.el.innerHTML = `${d.header('New issue', esc(name))}
    <form class="pv-scroll pj pj-new">
      <label>Title<input name="title" data-keep="ni-title-${esc(name)}" placeholder="What's wrong or missing?" autocomplete="off" maxlength="256" /></label>
      <label>Details<textarea name="body" data-keep="ni-body-${esc(name)}" placeholder="Steps, context, what done looks like (optional)"></textarea></label>
      <div class="pj-actions"><button class="pbtn" type="submit">Open issue</button></div>
      <label class="pj-check"><input type="checkbox" name="agent" /> Also hand it to an agent</label>
    </form>`;
  d.bindCommon();
  const f = d.el.querySelector<HTMLFormElement>('form')!;
  const title = f.querySelector<HTMLInputElement>('[name=title]')!;
  setTimeout(() => title.focus(), 30);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const body = (f.querySelector<HTMLTextAreaElement>('[name=body]')!).value.trim();
    const withAgent = f.querySelector<HTMLInputElement>('[name=agent]')!.checked;
    let made: { number?: number; dry?: boolean } = {};
    const ok = await act(d, f.querySelector('button'), 'Opening…', name, 'create_issue', async () => { const r = await projects.createIssue(name, t, body); made = r; return r; });
    if (!ok) return;
    if (withAgent) {
      // Dry runs make no real issue to hand over, so the agent gets the text directly.
      try {
        const a = made.number && !made.dry ? await projects.issueToAgent(name, made.number, pickedAgent()) : await d.hire(name, `${t}\n\n${body}`.trim());
        d.toast(`${a.name} is on it`);
        d.go({ app: 'agent', id: a.id });
        return;
      } catch (err) { d.toast(`Issue opened, but the agent didn't start: ${(err as Error).message}`); }
    }
    d.go({ app: 'project', repo: name });
  });
}

function renderAddSchedule(d: ProjectDeps, v: ProjectView) {
  renderSchedulesApp(d.el, {
    header: (t, sub) => d.header(esc(t), sub ? esc(sub) : ''),
    bindCommon: d.bindCommon,
    repos: () => [v.repo],
    setBackHandler: d.setBack,
    onDone: () => { d.setBack(null); if (d.showing(v)) d.go({ app: 'project', repo: v.repo }); },
  }, { repo: v.repo });
}

const icon = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CHAT = icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>');
const PIN = icon('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>');
