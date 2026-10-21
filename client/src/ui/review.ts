// Lobby review station: diff + summary for a finished agent run, with Approve / Ask for changes / Discard.
// Opened from the lobby crates, the phone's Review inbox and the apartment briefing. It also answers an
// agent's question when the run is waiting on one. A DOM panel, so the VR panel mirror shows it too.
import type { AgentInfo } from '../../../shared/types.ts';
import { api, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { openPanel, toast } from './panel.ts';
import './work.css';

const LIVE = new Set(['preparing', 'running']);

/** Split a unified diff into one chunk per file. */
export function splitDiff(diff: string): { file: string; lines: string[]; add: number; del: number; isNew: boolean }[] {
  const out: { file: string; lines: string[]; add: number; del: number; isNew: boolean }[] = [];
  let cur: (typeof out)[number] | null = null;
  for (const l of diff.split('\n')) {
    const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) { cur = { file: m[2], lines: [], add: 0, del: 0, isNew: false }; out.push(cur); continue; }
    if (!cur) continue;
    if (l.startsWith('new file mode')) { cur.isNew = true; continue; }
    if (/^(index |--- |\+\+\+ |similarity |rename |deleted file mode|old mode|new mode)/.test(l)) continue;
    if (l.startsWith('+')) cur.add++;
    else if (l.startsWith('-')) cur.del++;
    cur.lines.push(l);
  }
  return out;
}

const KW = /\b(import|from|export|default|const|let|var|function|return|if|else|for|while|of|in|new|class|extends|async|await|try|catch|throw|type|interface|def|self|None|True|False|null|undefined|true|false|public|private|struct|func|guard|fn|pub|impl|use)\b/g;

/** Light syntax tint for one code line (already HTML-escaped is done here). */
function tint(code: string) {
  // A comment starts at `//` outside a string (not a URL's `://`), or at a leading `#`.
  let cut = /^\s*#/.test(code) ? code.indexOf('#') : -1;
  for (let i = code.indexOf('//'); cut < 0 && i >= 0; i = code.indexOf('//', i + 2)) {
    const before = code.slice(0, i);
    if (code[i - 1] !== ':' && (before.match(/['"`]/g)?.length ?? 0) % 2 === 0) cut = i;
  }
  const [body, rest] = cut >= 0 ? [code.slice(0, cut), code.slice(cut)] : [code, ''];
  const parts = body.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/);
  const html = parts.map((p, i) => (i % 2 ? `<span class="tk-s">${esc(p)}</span>` : esc(p).replace(KW, '<span class="tk-k">$1</span>').replace(/(?<!&#)\b(\d+(?:\.\d+)?)\b/g, '<span class="tk-n">$1</span>'))).join('');
  return html + (rest ? `<span class="tk-c">${esc(rest)}</span>` : '');
}

function renderFile(f: ReturnType<typeof splitDiff>[number], open: boolean) {
  let oldN = 0, newN = 0;
  const rows = f.lines.map((l) => {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) {
      oldN = +h[1]; newN = +h[2];
      return `<tr class="rv-hunk"><td></td><td></td><td>${esc(l)}</td></tr>`;
    }
    const kind = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx';
    const a = kind === 'add' ? '' : oldN++;
    const b = kind === 'del' ? '' : newN++;
    return `<tr class="rv-${kind}"><td>${a}</td><td>${b}</td><td><i>${kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}</i>${tint(l.slice(1))}</td></tr>`;
  }).join('');
  return `<details class="rv-file"${open ? ' open' : ''}>
    <summary><span class="rv-fname">${esc(f.file)}</span>${f.isNew ? '<em>new</em>' : ''}<span class="rv-n"><b class="g">+${f.add}</b> <b class="r">−${f.del}</b></span></summary>
    <div class="rv-code"><table>${rows}</table></div>
  </details>`;
}

export function openReview(agentId: string): void {
  const panel = openPanel({ title: 'Review', avatar: '✓', color: '#3ddc97', wide: true });
  panel.el.classList.add('review-panel');
  let a: AgentInfo | null = null;
  let diff: { stat: string; diff: string; files: string[] } | null = null;
  let mode: 'idle' | 'approve' | 'changes' | 'discard' | 'busy' = 'idle';
  let err = '';
  const head = panel.el.querySelector<HTMLElement>('.panel-header h3')!;
  const sub = (() => {
    let p = panel.el.querySelector<HTMLElement>('.panel-header p');
    if (!p) { p = document.createElement('p'); head.parentElement!.appendChild(p); }
    return p;
  })();
  panel.body.innerHTML = '<div class="rv-loading">Opening the review…</div>';
  track('review_opened', { agent: agentId });

  async function load() {
    try {
      const list = await api.agents();
      a = list.find((x) => x.id === agentId) ?? null;
      if (!a) { panel.body.innerHTML = '<div class="rv-empty"><b>That run is gone.</b><p>It may have been cleaned up on the server.</p></div>'; return; }
      if (!LIVE.has(a.status)) diff = await api.agentDiff(agentId).catch(() => null);
      render();
    } catch (e) {
      panel.body.innerHTML = `<div class="rv-empty"><b>Couldn't load the review.</b><p>${esc((e as Error).message)}</p></div>`;
    }
  }

  function render() {
    if (!a) return;
    head.textContent = `Review · ${a.name}`;
    const task = a.task.split('\n\n(')[0];
    sub.innerHTML = `<span class="tag">${esc(a.repo)}</span>${a.diffStat ? `<span class="tag">${esc(a.diffStat)}</span>` : ''}${a.costUsd != null ? `<span class="tag">$${a.costUsd.toFixed(2)}</span>` : ''}<span class="tag">${esc(a.branch)}</span>`;
    const files = diff ? splitDiff(diff.diff) : [];
    let html = `<div class="rv-task"><small>Task</small><p>${esc(task)}</p></div>`;
    if (a.prUrl) html += `<div class="rv-banner ok">Pull request opened · <a href="${esc(a.prUrl)}" target="_blank" rel="noopener">${esc(a.prUrl.replace(/^https:\/\/github.com\//, ''))} ↗</a></div>`;
    else if (a.review === 'discarded') html += `<div class="rv-banner muted">Discarded. The branch and its workspace were removed.</div>`;
    if (a.status === 'needs_input') {
      html += `<div class="rv-question"><small>${esc(a.name)} asks</small><p>${esc(a.question ?? '')}</p></div>`;
    } else if (LIVE.has(a.status)) {
      html += `<div class="rv-working"><i class="rv-pulse"></i><div><b>${esc(a.name)} is still working</b><p>${esc(a.lastAction)}</p></div></div>`;
    }
    if (a.summary && !LIVE.has(a.status)) html += `<div class="rv-summary"><small>What ${esc(a.name.replace(/^Agent /, ''))} did</small><p>${esc(a.summary)}</p></div>`;
    if (!LIVE.has(a.status)) {
      if (files.length) html += `<div class="rv-files-h"><b>${files.length} file${files.length === 1 ? '' : 's'}</b><span>${esc(diff?.stat.split('\n').pop()?.trim() || a.diffStat || '')}</span><button class="rv-toggle" data-all>Collapse all</button></div>${files.map((f, i) => renderFile(f, files.length <= 4 || i < 2)).join('')}`;
      else if (a.status !== 'needs_input') html += `<div class="rv-empty"><b>No file changes.</b><p>${a.review === 'discarded' ? '' : 'Nothing to ship. Read the summary above, or ask for changes.'}</p></div>`;
    }
    panel.body.innerHTML = html;
    const all = panel.body.querySelector<HTMLButtonElement>('[data-all]');
    all?.addEventListener('click', () => {
      const ds = [...panel.body.querySelectorAll<HTMLDetailsElement>('details.rv-file')];
      const anyOpen = ds.some((d) => d.open);
      ds.forEach((d) => (d.open = !anyOpen));
      all.textContent = anyOpen ? 'Expand all' : 'Collapse all';
    });
    renderFooter();
  }

  function renderFooter() {
    if (!a) return;
    const f = panel.footer;
    const canReview = a.status === 'done' && !a.prUrl && a.review !== 'discarded';
    const hasFiles = a.filesChanged.length > 0;
    const errHtml = err ? `<div class="rv-err">${esc(err)}</div>` : '';
    if (a.status === 'needs_input') {
      f.innerHTML = `${errHtml}<textarea class="rv-note" data-answer placeholder="Your answer to ${esc(a.name)}…"></textarea>
        <div class="rv-row"><button class="btn danger" data-stop>Stop the run</button><div style="flex:1"></div><button class="btn primary big" data-send-answer>Answer</button></div>`;
      const ta = f.querySelector<HTMLTextAreaElement>('textarea')!;
      const send = async () => {
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        mode = 'busy'; err = '';
        f.querySelector<HTMLButtonElement>('[data-send-answer]')!.disabled = true;
        try { a = await api.answerAgent(a!.id, text); track('question_answered', { repo: a.repo, via: 'review' }); toast(`<b>${esc(a.name)}</b> got your answer and is back at it`); }
        catch (e) { err = (e as Error).message; }
        mode = 'idle';
        render();
      };
      f.querySelector('[data-send-answer]')!.addEventListener('click', () => void send());
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } });
      f.querySelector('[data-stop]')!.addEventListener('click', async () => { a = await api.stopAgent(a!.id).catch(() => a); render(); });
      setTimeout(() => ta.focus(), 40);
      return;
    }
    if (!canReview) {
      f.innerHTML = `${errHtml}<div class="rv-row"><div style="flex:1"></div><button class="btn" data-close>Close</button></div>`;
      f.querySelector('[data-close]')!.addEventListener('click', () => panel.close());
      return;
    }
    if (mode === 'changes') {
      f.innerHTML = `${errHtml}<textarea class="rv-note" placeholder="What should ${esc(a.name)} change? e.g. Keep the old behavior behind a flag."></textarea>
        <div class="rv-row"><button class="btn" data-back>Back</button><div style="flex:1"></div><button class="btn primary big" data-send>Send to ${esc(a.name.replace(/^Agent /, ''))}</button></div>`;
      const ta = f.querySelector<HTMLTextAreaElement>('textarea')!;
      const send = () => act('changes', ta.value.trim(), ta);
      f.querySelector('[data-send]')!.addEventListener('click', send);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      f.querySelector('[data-back]')!.addEventListener('click', () => { mode = 'idle'; err = ''; renderFooter(); });
      setTimeout(() => ta.focus(), 40);
      return;
    }
    if (mode === 'discard') {
      f.innerHTML = `${errHtml}<div class="rv-confirm">Throw away ${esc(a.name)}'s work? The branch and its workspace are deleted. This can't be undone.</div>
        <div class="rv-row"><button class="btn" data-back>Keep it</button><div style="flex:1"></div><button class="btn danger big solid" data-yes>Discard</button></div>`;
      f.querySelector('[data-yes]')!.addEventListener('click', () => act('discard'));
      f.querySelector('[data-back]')!.addEventListener('click', () => { mode = 'idle'; renderFooter(); });
      return;
    }
    if (mode === 'approve') {
      f.innerHTML = `${errHtml}<div class="rv-confirm">This commits the changes, pushes <code>${esc(a.branch)}</code> to GitHub and opens a pull request on <b>${esc(a.repo)}</b>.</div>
        <div class="rv-row"><button class="btn" data-back>Back</button><div style="flex:1"></div><button class="btn primary big" data-yes>Push &amp; open PR</button></div>`;
      f.querySelector('[data-yes]')!.addEventListener('click', () => act('approve'));
      f.querySelector('[data-back]')!.addEventListener('click', () => { mode = 'idle'; renderFooter(); });
      return;
    }
    if (mode === 'busy') {
      f.innerHTML = `<div class="rv-row"><div style="flex:1"></div><button class="btn primary big" disabled>Working…</button></div>`;
      return;
    }
    f.innerHTML = `${errHtml}<div class="rv-row">
      <button class="btn danger big" data-discard>Discard</button>
      <button class="btn big" data-changes>Ask for changes</button>
      <div style="flex:1"></div>
      <button class="btn primary big" data-approve ${hasFiles ? '' : 'disabled title="No changes to ship"'}>Approve → open PR</button></div>`;
    f.querySelector('[data-discard]')!.addEventListener('click', () => { mode = 'discard'; err = ''; renderFooter(); });
    f.querySelector('[data-changes]')!.addEventListener('click', () => { mode = 'changes'; err = ''; renderFooter(); });
    f.querySelector('[data-approve]')!.addEventListener('click', () => { mode = 'approve'; err = ''; renderFooter(); });
  }

  async function act(action: 'approve' | 'changes' | 'discard', note = '', field?: HTMLTextAreaElement) {
    if (!a) return;
    if (action === 'changes' && !note) { field?.focus(); return; }
    const prev = mode;
    mode = 'busy'; err = '';
    renderFooter();
    try {
      a = await api.reviewAgent(a.id, action, note);
      track('review_action', { action, repo: a.repo });
      if (action === 'approve') toast(`PR opened for <b>${esc(a.repo)}</b>`);
      if (action === 'changes') toast(`<b>${esc(a.name)}</b> is making your changes`);
      if (action === 'discard') toast(`Discarded ${esc(a.name)}'s run`);
      mode = 'idle';
      if (action === 'changes') diff = null;
      render();
    } catch (e) {
      err = (e as Error).message;
      mode = prev === 'busy' ? 'idle' : prev;
      renderFooter();
    }
  }

  const off = onLive((msg) => {
    if (msg.type !== 'agent:update' || msg.agent.id !== agentId || mode === 'busy') return;
    const was = a?.status;
    a = msg.agent;
    if (was && LIVE.has(was) && !LIVE.has(a.status)) {
      void api.agentDiff(agentId).then((d) => { diff = d; render(); }).catch(() => render());
    } else if (mode === 'idle') render();
  });
  panel.onClose(off);
  void load();
}
