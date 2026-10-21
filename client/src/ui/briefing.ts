// The briefing: what happened while you were away. One source of data for three places: the
// apartment desk (a monitor you can read across the room, and a panel when you sit down), the
// phone's Today app, and a gentle once-a-day prompt.
import type { AgentInfo, Briefing } from '../../../shared/types.ts';
import { briefing as briefingApi, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { openPanel, toast } from './panel.ts';
import { openReview } from './review.ts';
import './briefing.css';

export interface BriefingHooks {
  /** Walk/fly to a repo's building. */
  travelTo(repo: string): void;
  /** Open the phone on an agent's log (fallback for answering a question). */
  openAgent(id: string): void;
  goHome?(): void;
}

let current: Briefing | null = null;
let loading: Promise<Briefing> | null = null;
const listeners = new Set<(b: Briefing) => void>();

export function currentBriefing() { return current; }

export function loadBriefing(): Promise<Briefing> {
  loading ??= briefingApi.get().then((b) => {
    current = b;
    for (const fn of listeners) fn(b);
    return b;
  }).finally(() => { loading = null; });
  return loading;
}

/** Called with fresh data whenever the briefing reloads. */
export function onBriefing(fn: (b: Briefing) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Anything that changes the briefing reloads it (debounced; agent events are chatty).
let reloadTimer = 0;
onLive((msg) => {
  if (msg.type !== 'agent:update' && msg.type !== 'pulse:update' && msg.type !== 'schedule:update') return;
  clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void loadBriefing().catch(() => {}), 1500);
});

export function markBriefingSeen() {
  briefingApi.seen().catch(() => {});
}

/** How many things are waiting on you. */
export const waiting = (b: Briefing) => b.needsReview.length + b.needsInput.length + b.failingCi.length;

function ago(iso: string) {
  const m = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today ${t}`;
  if (d.getTime() - now.getTime() < 2 * 86400_000 && d.getDate() === new Date(now.getTime() + 86400_000).getDate()) return `tomorrow ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

const firstLine = (s: string) => s.split('\n')[0].replace(/^\(.*\)$/, '').trim();

function runRow(a: AgentInfo, action: string) {
  return `<li class="bf-row">
    <span class="bf-dot ${a.status}"></span>
    <div><b>${esc(a.name)} · ${esc(a.repo)}</b><small>${esc((a.summary || firstLine(a.task)).slice(0, 140))}</small>
      <em>${a.diffStat ? esc(a.diffStat) : `${a.filesChanged.length} file${a.filesChanged.length === 1 ? '' : 's'}`}${a.endedAt ? ` · ${ago(a.endedAt)}` : ''}${a.scheduleId ? ' · scheduled' : ''}</em></div>
    ${action}
  </li>`;
}

/** The briefing as HTML: used by the desk panel and the phone's Today app. */
export function briefingHtml(b: Briefing) {
  const reviewIds = new Set(b.needsReview.map((a) => a.id));
  const inputIds = new Set(b.needsInput.map((a) => a.id));
  const otherDone = b.finished.filter((a) => !reviewIds.has(a.id) && !inputIds.has(a.id));
  let html = `<p class="bf-headline">${esc(b.headline)}</p><p class="bf-since">Since ${esc(when(b.since))}</p>`;
  if (b.needsInput.length) {
    html += `<h5 class="bf-h">Questions for you</h5><ul class="bf-list">${b.needsInput.map((a) => `<li class="bf-row bf-q">
      <span class="bf-dot needs_input"></span>
      <div><b>${esc(a.name)} · ${esc(a.repo)}</b><p class="bf-question">${esc(a.question || 'Needs your input to continue.')}</p>
        <form class="bf-answer" data-answer="${esc(a.id)}"><input data-keep="answer-${esc(a.id)}" placeholder="Answer ${esc(a.name)}…" autocomplete="off" /><button class="bf-btn">Send</button></form></div>
    </li>`).join('')}</ul>`;
  }
  if (b.needsReview.length) {
    html += `<h5 class="bf-h">Ready for your review</h5><ul class="bf-list">${b.needsReview.map((a) => runRow(a, `<button class="bf-btn" data-review="${esc(a.id)}">Review</button>`)).join('')}</ul>`;
  }
  if (b.failingCi.length) {
    html += `<h5 class="bf-h">CI is red</h5><ul class="bf-list">${b.failingCi.map((f) => `<li class="bf-row">
      <span class="bf-dot error"></span><div><b>${esc(f.repo)}</b><small>Failing${f.since ? ` since ${esc(ago(f.since))}` : ''}</small></div>
      <button class="bf-btn ghost" data-go="${esc(f.repo)}">Go</button></li>`).join('')}</ul>`;
  }
  if (otherDone.length) {
    html += `<h5 class="bf-h">Finished</h5><ul class="bf-list">${otherDone.slice(0, 8).map((a) => runRow(a, `<button class="bf-btn ghost" data-agent="${esc(a.id)}">Log</button>`)).join('')}</ul>`;
  }
  if (b.newPrs.length) {
    html += `<h5 class="bf-h">New pull requests</h5><ul class="bf-list">${b.newPrs.slice(0, 8).map((p) => `<li class="bf-row">
      <span class="bf-dot pr"></span><div><b>${esc(p.repo)} #${p.number}</b><small>${esc(p.title)}</small><em>${esc(p.author)}${p.isAgent ? ' (agent)' : ''} · ${ago(p.createdAt)}</em></div>
      <a class="bf-btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Open ↗</a></li>`).join('')}</ul>`;
  }
  html += `<h5 class="bf-h">Coming up</h5>`;
  html += b.scheduled.length
    ? `<ul class="bf-list">${b.scheduled.slice(0, 5).map((s) => `<li class="bf-row"><span class="bf-dot sched"></span><div><b>${esc(s.repo)}</b><small>${esc(firstLine(s.task).slice(0, 110))}</small><em>${esc(when(s.nextRunAt!))} · ${s.cadence}</em></div></li>`).join('')}</ul>`
    : `<p class="bf-empty">No scheduled work. Set a lead to run nightly from the phone's <b>Schedules</b> app.</p>`;
  return html;
}

/** Wire up the buttons briefingHtml() draws. */
export function bindBriefing(el: HTMLElement, hooks: BriefingHooks, after?: () => void) {
  el.querySelectorAll<HTMLElement>('[data-review]').forEach((b) => b.addEventListener('click', () => { after?.(); openReview(b.dataset.review!); }));
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { after?.(); hooks.travelTo(b.dataset.go!); }));
  el.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => b.addEventListener('click', () => { after?.(); hooks.openAgent(b.dataset.agent!); }));
  el.querySelectorAll<HTMLFormElement>('[data-answer]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = f.dataset.answer!, input = f.querySelector('input')!, text = input.value.trim();
    if (!text) return;
    const btn = f.querySelector('button')!;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `${res.status}`);
      track('briefing_answered', {});
      f.outerHTML = `<p class="bf-sent">Sent. Back to work.</p>`;
      void loadBriefing().catch(() => {});
    } catch (err) {
      btn.disabled = false;
      toast(`Couldn't send that: ${esc((err as Error).message)}. Opening the agent on your phone.`, 4000);
      after?.();
      hooks.openAgent(id);
    }
  }));
}

/** The desk panel: sit down at the apartment desk and read it properly. Marks the briefing seen on close. */
export function openBriefingPanel(hooks: BriefingHooks, from: 'desk' | 'prompt' | 'phone' = 'desk') {
  const panel = openPanel({ title: 'Morning briefing', subtitle: 'What happened while you were away', avatar: '☀', color: '#e8a33d', wide: true });
  panel.el.classList.add('briefing-panel');
  track('briefing_opened', { from });
  const draw = (b: Briefing) => {
    panel.body.innerHTML = `<div class="bf">${briefingHtml(b)}</div>`;
    bindBriefing(panel.body, hooks, () => panel.close());
  };
  if (current) draw(current); else panel.body.innerHTML = '<p class="bf-since">Reading the overnight reports…</p>';
  const off = onBriefing((b) => { if (!panel.body.querySelector('input:focus')) draw(b); });
  loadBriefing().catch((e) => { panel.body.innerHTML = `<p class="bf-empty">Couldn't load the briefing: ${esc((e as Error).message)}</p>`; });
  panel.footer.innerHTML = `<button class="bf-btn ghost" data-close>Done</button>`;
  panel.footer.querySelector('[data-close]')!.addEventListener('click', () => panel.close());
  panel.onClose(() => { off(); markBriefingSeen(); });
  return panel;
}

const DAY_KEY = 'ow.briefing.promptedDay';
/**
 * Once a day, when something happened, a gentle nudge: open the briefing here, or go home and read it
 * at the desk. Never on an empty briefing.
 */
export async function maybePromptBriefing(hooks: BriefingHooks) {
  const today = new Date().toDateString();
  try { if (localStorage.getItem(DAY_KEY) === today) return; } catch { /* storage off: prompt every session */ }
  const b = await loadBriefing().catch(() => null);
  if (!b || (!b.finished.length && !waiting(b) && !b.newPrs.length)) return;
  try { localStorage.setItem(DAY_KEY, today); } catch { /* ignore */ }
  const el = toast(`<b>Your briefing</b> · ${esc(b.headline)}
    <span class="bf-toast-actions"><button class="bf-btn" data-open>Read it</button>${hooks.goHome ? '<button class="bf-btn ghost" data-home>At home</button>' : ''}</span>`, 14000);
  el.classList.add('bf-toast');
  el.querySelector('[data-open]')?.addEventListener('click', () => { el.remove(); openBriefingPanel(hooks, 'prompt'); });
  el.querySelector('[data-home]')?.addEventListener('click', () => { el.remove(); hooks.goHome?.(); });
}

// ------------------------------------------------------------------ desk monitor

/** Draw the briefing onto the apartment desk monitor's canvas (1024×600). */
export function drawBriefingMonitor(x: CanvasRenderingContext2D, b: Briefing | null, clock: string, fallback: AgentInfo[]) {
  const W = 1024, H = 600, F = '-apple-system, system-ui, sans-serif';
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16202b'); bg.addColorStop(1, '#0d1218');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e8a33d'; x.font = `600 22px ${F}`; x.fillText('MORNING BRIEFING', 40, 52);
  x.fillStyle = '#8a95a3'; x.font = `22px ${F}`; x.textAlign = 'right'; x.fillText(clock, W - 40, 52); x.textAlign = 'left';
  /** Word-wrap into at most maxLines lines; the last one gets an ellipsis if it runs over. */
  const wrap = (text: string, px: number, y: number, maxW: number, lh: number, maxLines: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const t = line ? `${line} ${words[i]}` : words[i];
      if (x.measureText(t).width <= maxW || !line) { line = t; continue; }
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) { line = words.slice(i).join(' '); break; }
    }
    if (line) {
      let last = line;
      while (x.measureText(last).width > maxW && last.length > 4) last = last.slice(0, -2);
      lines.push(last === line ? line : last + '…');
    }
    for (const l of lines) { x.fillText(l, px, y); y += lh; }
    return y;
  };
  if (!b) {
    x.fillStyle = '#e8e3da'; x.font = `600 34px ${F}`; x.fillText('Your agents', 40, 110);
    x.fillStyle = '#9aa5b3'; x.font = `24px ${F}`;
    fallback.slice(0, 6).forEach((a, i) => x.fillText(`${a.name} · ${a.repo} · ${a.status}`, 40, 160 + i * 40));
    return;
  }
  x.fillStyle = '#f2ede4'; x.font = `600 36px ${F}`;
  let y = wrap(b.headline, 40, 108, W - 80, 44, 2) + 6;
  const cols: { title: string; color: string; rows: string[] }[] = [
    { title: `Review · ${b.needsReview.length}`, color: '#3ddc97', rows: b.needsReview.map((a) => `${a.repo}: ${firstLine(a.summary || a.task)}`) },
    { title: `Questions · ${b.needsInput.length}`, color: '#ffb347', rows: b.needsInput.map((a) => `${a.name}: ${a.question || 'needs input'}`) },
    { title: `Finished · ${b.finished.length}`, color: '#7fb2ff', rows: b.finished.map((a) => `${a.repo}: ${firstLine(a.summary || a.task)}`) },
  ];
  if (b.failingCi.length) cols[2] = { title: `CI red · ${b.failingCi.length}`, color: '#ff6b6b', rows: b.failingCi.map((f) => f.repo) };
  const cw = (W - 80 - 40) / 3;
  cols.forEach((c, i) => {
    const cx = 40 + i * (cw + 20);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.beginPath(); x.roundRect(cx, y, cw, 300, 14); x.fill();
    x.fillStyle = c.color; x.font = `600 22px ${F}`; x.fillText(c.title, cx + 18, y + 38);
    x.fillStyle = '#c9d1db'; x.font = `20px ${F}`;
    if (!c.rows.length) { x.fillStyle = '#6b7685'; x.fillText('Nothing', cx + 18, y + 78); }
    c.rows.slice(0, 5).forEach((r, j) => {
      let t = r;
      while (x.measureText(t).width > cw - 36 && t.length > 4) t = t.slice(0, -2);
      x.fillText(t === r ? t : t + '…', cx + 18, y + 78 + j * 42);
    });
  });
  y += 330;
  const next = b.scheduled[0];
  x.fillStyle = '#8a95a3'; x.font = `22px ${F}`;
  x.fillText(next ? `Next scheduled: ${next.repo} · ${when(next.nextRunAt!)}` : 'No scheduled work · set some up in the phone’s Schedules app', 40, Math.min(y + 10, H - 30));
  x.fillStyle = '#e8a33d'; x.textAlign = 'right'; x.fillText('Press E at the desk to read it', W - 40, Math.min(y + 10, H - 30)); x.textAlign = 'left';
}
