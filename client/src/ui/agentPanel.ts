import type { AgentEvent, AgentInfo, Repo, RepoDetail } from '../../../shared/types.ts';
import type { GameCtx } from '../ctx.ts';
import { api, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { openPanel, toast } from './panel.ts';

/** Task ideas tailored a little to the repo. */
export function agentSuggestions(repo: Repo, detail?: RepoDetail | null): string[] {
  const s: string[] = [];
  const lang = repo.language ?? '';
  const recentFiles = detail?.workers.flatMap((w) => w.files).filter((f) => /\.(ts|tsx|js|jsx|py|swift|go|rs)$/.test(f)) ?? [];
  if (recentFiles[0]) s.push(`Write tests for ${recentFiles[0]}`);
  s.push('Find and fix one real bug, explain the root cause');
  s.push('Improve the README: setup steps, what the project does, screenshots section');
  if (/TypeScript|JavaScript/.test(lang)) s.push('Fix TypeScript/lint errors without changing behavior');
  if (/Swift/.test(lang)) s.push('Fix compiler warnings and tidy up SwiftUI views');
  if (/Python/.test(lang)) s.push('Add type hints and fix any obvious edge cases');
  if (detail?.workers[0]) s.push(`Review the last change (“${detail.workers[0].title}”) and fix anything risky`);
  s.push('Add basic error handling and loading states where they are missing');
  return s.slice(0, 6);
}

export function openHireAgentPanel(ctx: GameCtx, repo: Repo, detail: RepoDetail | null, onLaunched: (a: AgentInfo) => void) {
  const panel = openPanel({ title: 'Hire an agent', subtitle: `Claude Code will work in a fresh branch of <b>${esc(repo.fullName)}</b>. Nothing is pushed until you open a PR.`, avatar: '🤖', color: '#3ddc97' });
  panel.body.innerHTML = `
    <div class="section-title">What should the agent do?</div>
    <textarea class="task" placeholder="e.g. Add a dark mode toggle to the settings page"></textarea>
    <div class="section-title">Ideas</div>
    <div class="chips">${agentSuggestions(repo, detail).map((s) => `<button class="chip">${esc(s)}</button>`).join('')}</div>
    <p class="hint">The agent can read and edit files and run tests/builds in an isolated git worktree. You can watch it live at its desk in the Agent Lab.</p>
    <div class="err hidden"></div>`;
  const ta = panel.body.querySelector('textarea')!;
  panel.body.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', () => { ta.value = b.textContent ?? ''; ta.focus(); }));
  panel.footer.innerHTML = `<button class="btn">Cancel</button><div style="flex:1"></div><button class="btn primary">Launch agent</button>`;
  const [cancel, launch] = panel.footer.querySelectorAll('button');
  cancel.addEventListener('click', () => panel.close());
  const err = panel.body.querySelector<HTMLDivElement>('.err')!;
  launch.addEventListener('click', async () => {
    const task = ta.value.trim();
    if (!task) { ta.focus(); return; }
    launch.disabled = true;
    launch.textContent = 'Launching…';
    try {
      const agent = await api.startAgent(repo.name, task);
      ctx.agents.set(agent.id, agent);
      track('agent_started', { repo: repo.name, taskLen: task.length });
      toast(`<b>${esc(agent.name)}</b> started on ${esc(repo.name)}`);
      panel.close();
      onLaunched(agent);
      openAgentLivePanel(ctx, agent);
    } catch (e) {
      err.textContent = `Couldn't start the agent: ${(e as Error).message}`;
      err.classList.remove('hidden');
      launch.disabled = false;
      launch.textContent = 'Launch agent';
    }
  });
  setTimeout(() => ta.focus(), 50);
  return panel;
}

function renderDiff(diff: string) {
  if (!diff.trim()) return '<span class="muted">No changes yet.</span>';
  return diff.split('\n').map((l) => {
    const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
    return `<span class="${cls}">${esc(l)}</span>`;
  }).join('\n');
}

function renderEvent(ev: AgentEvent): string {
  switch (ev.kind) {
    case 'status': return `<div class="ev">◆ ${esc(ev.status)}${ev.message ? ` — ${esc(ev.message)}` : ''}</div>`;
    case 'text': return `<div class="ev text">${esc(ev.text)}</div>`;
    case 'tool': return `<div class="ev tool">⚙ ${esc(ev.summary || ev.tool)}</div>`;
    case 'tool_result': return `<div class="ev${ev.isError ? ' err' : ''}">  ↳ ${esc(ev.summary.slice(0, 200))}</div>`;
    case 'diff': return `<div class="ev">Δ ${esc(ev.files.length + ' files changed')}</div>`;
    case 'result': return `<div class="ev text"><b>Done.</b> ${esc(ev.text)}${ev.costUsd != null ? ` <span class="muted">($${ev.costUsd.toFixed(2)})</span>` : ''}</div>`;
  }
}

export function openAgentLivePanel(ctx: GameCtx, agent: AgentInfo) {
  let a = ctx.agents.get(agent.id) ?? agent;
  const panel = openPanel({ title: a.name, subtitle: '', avatar: '🤖', color: '#3ddc97', wide: true });
  const sub = panel.el.querySelector('.panel-header p') ?? (() => {
    const p = document.createElement('p');
    panel.el.querySelector('.panel-header div:nth-child(2)')!.appendChild(p);
    return p;
  })();
  panel.body.innerHTML = `
    <div class="task-line"></div>
    <div class="tabs"><button class="tab on" data-t="log">Activity</button><button class="tab" data-t="diff">Changes</button></div>
    <div class="log tabpane" data-p="log"></div>
    <pre class="diff tabpane hidden" data-p="diff"></pre>`;
  const logEl = panel.body.querySelector<HTMLDivElement>('.log')!;
  const diffEl = panel.body.querySelector<HTMLPreElement>('.diff')!;
  panel.body.querySelector('.task-line')!.innerHTML = `<b>Task:</b> ${esc(a.task)}`;
  panel.body.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.addEventListener('click', () => {
    panel.body.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    panel.body.querySelectorAll<HTMLElement>('.tabpane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t.dataset.t));
  }));
  let lastDiff = '';

  panel.footer.innerHTML = `<button class="btn danger stop">Stop</button><div class="pr-link" style="flex:1;align-self:center"></div><button class="btn primary pr">Open pull request</button>`;
  const stopBtn = panel.footer.querySelector<HTMLButtonElement>('.stop')!;
  const prBtn = panel.footer.querySelector<HTMLButtonElement>('.pr')!;
  const prLink = panel.footer.querySelector<HTMLDivElement>('.pr-link')!;

  function refresh() {
    const active = a.status === 'running' || a.status === 'preparing';
    sub.innerHTML = `<span class="tag ${a.status === 'running' ? 'open' : a.status === 'error' ? 'closed' : ''}">${esc(a.status)}</span><span class="tag">${esc(a.repo)}</span><span class="tag">${esc(a.branch)}</span><span class="tag">${a.filesChanged.length} files</span>`;
    stopBtn.classList.toggle('hidden', !active);
    prBtn.classList.toggle('hidden', active || !!a.prUrl || a.filesChanged.length === 0);
    prLink.innerHTML = a.prUrl ? `<a href="${esc(a.prUrl)}" target="_blank" rel="noopener">Pull request ↗</a>` : '';
  }

  function append(ev: AgentEvent) {
    if (ev.kind === 'diff') { lastDiff = ev.diff; diffEl.innerHTML = renderDiff(ev.diff); }
    const atBottom = panel.body.scrollTop + panel.body.clientHeight >= panel.body.scrollHeight - 40;
    logEl.insertAdjacentHTML('beforeend', renderEvent(ev));
    if (atBottom) panel.body.scrollTop = panel.body.scrollHeight;
  }

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    try { a = await api.stopAgent(a.id); ctx.agents.set(a.id, a); } catch (e) { toast(`Stop failed: ${esc((e as Error).message)}`); }
    stopBtn.disabled = false;
    refresh();
  });
  prBtn.addEventListener('click', async () => {
    if (!confirm(`Push branch "${a.branch}" to GitHub and open a pull request on ${a.repo}?`)) return;
    prBtn.disabled = true;
    prBtn.textContent = 'Opening PR…';
    try {
      a = await api.openPr(a.id);
      ctx.agents.set(a.id, a);
      track('agent_pr_opened', { repo: a.repo });
      toast(`PR opened for <b>${esc(a.repo)}</b>`);
    } catch (e) { toast(`PR failed: ${esc((e as Error).message)}`, 8000); }
    prBtn.disabled = false;
    prBtn.textContent = 'Open pull request';
    refresh();
  });

  refresh();
  diffEl.innerHTML = renderDiff('');
  api.agentLog(a.id).then(({ events }) => {
    logEl.innerHTML = '';
    events.forEach((e) => append(e.event));
    panel.body.scrollTop = panel.body.scrollHeight;
  }).catch(() => { logEl.innerHTML = '<div class="ev err">Could not load the log.</div>'; });

  const off = onLive((msg) => {
    if (msg.type === 'agent:update' && msg.agent.id === a.id) { a = msg.agent; refresh(); }
    if (msg.type === 'agent:event' && msg.agentId === a.id) append(msg.event);
  });
  panel.onClose(() => { off(); void lastDiff; });
  return panel;
}
