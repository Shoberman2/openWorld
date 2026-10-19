import type { AgentEvent, AgentInfo, OfficeChannel, OfficeMessage, Repo } from '../../../shared/types.ts';
import { api, office, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { setOverlayOpen } from './panel.ts';
import type { GameCtx } from '../ctx.ts';

/** What the phone needs from the game world (main.ts provides these). */
export interface PhoneHooks {
  /** Every project building in the current place. */
  sites(): { repo: Repo }[];
  setWaypoint(repoName: string): void;
  travelTo(repoName: string): void | Promise<void>;
  /** e.g. "Midtown Manhattan, New York City" — shown in Maps. */
  placeName?(): string;
}

export interface Phone {
  open(app?: AppId): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

type AppId = 'home' | 'messages' | 'mail' | 'agents' | 'maps';
type View =
  | { app: 'home' }
  | { app: 'messages' }
  | { app: 'mail'; open?: string; compose?: boolean }
  | { app: 'agents'; open?: string }
  | { app: 'maps' };

const LIVE = new Set(['running', 'preparing']);
const STATUS_LABEL: Record<string, string> = { preparing: 'Setting up', running: 'Working', done: 'Done', error: 'Error', stopped: 'Stopped' };
const SUGGESTIONS = [
  "What's everyone working on?",
  'Send someone to review the README of my biggest project. Read-only, no changes.',
  'Any agents need my attention?',
];

/**
 * The player's phone (P). Text or email the office ("HQ"), the one agent that runs every building
 * and dispatches worker agents. Also: live agent roster, and a map of project buildings.
 */
export function installPhone(ctx: GameCtx, hooks: PhoneHooks): Phone {
  let messages: OfficeMessage[] = [];
  let view: View = { app: 'home' };
  let isOpen = false;
  const typing: Record<OfficeChannel, boolean> = { text: false, email: false };
  const drafts: Partial<Record<OfficeChannel, string>> = {};
  const sending: Record<OfficeChannel, boolean> = { text: false, email: false };

  // ---------------------------------------------------------------- DOM
  const btn = document.createElement('button');
  btn.id = 'phone-btn';
  btn.title = 'Phone (P)';
  btn.innerHTML = `${ICON.phone}<span class="phone-badge hidden"></span><kbd>P</kbd>`;
  document.body.appendChild(btn);

  const root = document.createElement('div');
  root.id = 'phone';
  root.className = 'phone hidden';
  root.innerHTML = `
    <div class="phone-frame">
      <div class="phone-screen">
        <div class="phone-status"><span class="ps-time"></span><span class="ps-island"></span><span class="ps-right">${ICON.signal}<b>5G</b>${ICON.battery}</span></div>
        <div class="phone-banner"></div>
        <div class="phone-view"></div>
        <div class="phone-homebar" title="Home"></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const viewEl = root.querySelector<HTMLDivElement>('.phone-view')!;
  const timeEl = root.querySelector<HTMLSpanElement>('.ps-time')!;
  const bannerIn = root.querySelector<HTMLDivElement>('.phone-banner')!;
  const badge = btn.querySelector<HTMLSpanElement>('.phone-badge')!;

  const bannerOut = document.createElement('div');
  bannerOut.className = 'phone-notif';
  document.body.appendChild(bannerOut);

  btn.addEventListener('click', () => toggle());
  root.querySelector('.phone-homebar')!.addEventListener('click', () => go({ app: 'home' }));

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typingInField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.code === 'Escape' && isOpen) {
      e.preventDefault();
      if (typingInField) (t as HTMLElement).blur();
      close();
      return;
    }
    if (e.code === 'KeyP' && !typingInField && !e.repeat && !e.metaKey && !e.ctrlKey) {
      // Don't open over the title / loading screens.
      if (document.getElementById('hud')?.classList.contains('hidden')) return;
      e.preventDefault();
      toggle();
    }
  });

  // Status bar clock follows the game's day/night clock.
  const tick = () => {
    timeEl.textContent = (ctx.dayNight?.label() ?? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })).replace(/\s?[AP]M$/, '');
  };
  tick();
  setInterval(tick, 1000);

  // ---------------------------------------------------------------- state
  const unread = (ch?: OfficeChannel) => messages.filter((m) => m.from === 'hq' && !m.read && (!ch || m.channel === ch)).length;

  function upsert(m: OfficeMessage) {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i >= 0) messages[i] = { ...messages[i], ...m, read: messages[i].read || m.read };
    else messages.push(m);
  }

  function updateBadge() {
    const n = unread();
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  function markSeen(ch: OfficeChannel) {
    if (!unread(ch)) return;
    for (const m of messages) if (m.channel === ch) m.read = true;
    office.markRead(ch).catch(() => {});
    updateBadge();
  }

  office.thread().then((t) => {
    messages = t.messages;
    updateBadge();
    if (isOpen) render();
  }).catch(() => {});

  onLive((msg) => {
    if (msg.type === 'office:message') {
      const known = messages.some((m) => m.id === msg.message.id);
      upsert(msg.message);
      const viewing = isOpen && (view.app === 'messages' ? msg.message.channel === 'text' : view.app === 'mail' && msg.message.channel === 'email');
      if (msg.message.from === 'hq' && viewing) markSeen(msg.message.channel);
      if (msg.message.from === 'hq' && !known && !viewing && !msg.message.read) notify(msg.message);
      updateBadge();
      if (isOpen) refresh();
    } else if (msg.type === 'office:typing') {
      typing[msg.channel] = msg.on;
      if (isOpen) refresh();
    } else if (msg.type === 'agent:update') {
      ctx.agents.set(msg.agent.id, msg.agent);
      if (isOpen && (view.app === 'agents' || view.app === 'messages' || view.app === 'home')) refresh();
    } else if (msg.type === 'agent:event') {
      if (isOpen && view.app === 'agents' && view.open === msg.agentId) appendLog(msg.event, msg.ts);
    }
  });

  // ---------------------------------------------------------------- open / close
  function open(app: AppId = view.app) {
    if (!isOpen) {
      isOpen = true;
      root.classList.remove('hidden');
      btn.classList.add('active');
      setOverlayOpen(true);
      track('phone_opened', { app });
    }
    if (app !== view.app || app === 'home') go(app === 'home' ? { app: 'home' } : ({ app } as View));
    else render();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.add('hidden');
    btn.classList.remove('active');
    (document.activeElement as HTMLElement | null)?.blur?.();
    setOverlayOpen(false);
  }
  function toggle() { if (isOpen) close(); else open(); }

  function go(v: View) {
    if (v.app !== view.app && v.app !== 'home') track('phone_app', { app: v.app });
    view = v;
    render();
  }

  // ---------------------------------------------------------------- notifications
  let bannerTimer = 0;
  function notify(m: OfficeMessage) {
    const app: AppId = m.channel === 'email' ? 'mail' : 'messages';
    const html = `<div class="pn-app ${m.channel}">${m.channel === 'email' ? ICON.mail : ICON.messages}<span>${m.channel === 'email' ? 'MAIL' : 'MESSAGES'}</span><time>now</time></div>
      <b>HQ${m.subject ? ` · ${esc(m.subject)}` : ''}</b><p>${esc(m.text.slice(0, 160))}</p>`;
    const el = isOpen ? bannerIn : bannerOut;
    el.innerHTML = html;
    el.classList.add('show');
    el.onclick = () => {
      el.classList.remove('show');
      open(app);
      if (app === 'mail') go({ app: 'mail', open: m.id });
    };
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { bannerIn.classList.remove('show'); bannerOut.classList.remove('show'); }, 7000);
  }

  // ---------------------------------------------------------------- render
  /** Re-render while keeping whatever the user is typing. */
  function refresh() {
    const field = viewEl.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-keep]');
    const keep = field ? { key: field.dataset.keep!, value: field.value, focused: document.activeElement === field } : null;
    const scroller = viewEl.querySelector<HTMLElement>('.pv-scroll');
    const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const prevTop = scroller?.scrollTop ?? 0;
    render(false);
    if (keep) {
      const f = viewEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-keep="${keep.key}"]`);
      if (f) { f.value = keep.value; if (keep.focused) f.focus(); }
    }
    const s = viewEl.querySelector<HTMLElement>('.pv-scroll');
    if (s) s.scrollTop = atBottom && view.app === 'messages' ? s.scrollHeight : prevTop;
  }

  function render(fresh = true) {
    viewEl.className = `phone-view app-${view.app}`;
    if (view.app === 'home') renderHome();
    else if (view.app === 'messages') renderMessages(fresh);
    else if (view.app === 'mail') renderMail();
    else if (view.app === 'agents') renderAgents();
    else renderMaps();
  }

  const header = (title: string, sub = '', right = '') => `
    <div class="pv-head"><button class="pv-back" data-home>‹</button><div class="pv-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div><div class="pv-right">${right}</div></div>`;

  function bindCommon() {
    viewEl.querySelectorAll<HTMLElement>('[data-home]').forEach((b) => b.addEventListener('click', () => {
      if (view.app === 'mail' && (view.open || view.compose)) go({ app: 'mail' });
      else if (view.app === 'agents' && view.open) go({ app: 'agents' });
      else go({ app: 'home' });
    }));
  }

  // ---- Home ----
  function renderHome() {
    const agents = [...ctx.agents.values()];
    const live = agents.filter((a) => LIVE.has(a.status)).length;
    const apps: { id: AppId; name: string; icon: string; badge: number; bg: string }[] = [
      { id: 'messages', name: 'Messages', icon: ICON.messages, badge: unread('text'), bg: 'linear-gradient(180deg,#5af07a,#18c24a)' },
      { id: 'mail', name: 'Mail', icon: ICON.mail, badge: unread('email'), bg: 'linear-gradient(180deg,#4fb2ff,#1a6dff)' },
      { id: 'agents', name: 'Agents', icon: ICON.gear, badge: live, bg: 'linear-gradient(180deg,#ffb347,#ff7a18)' },
      { id: 'maps', name: 'Maps', icon: ICON.map, badge: 0, bg: 'linear-gradient(180deg,#9be7a0,#3fb6a8)' },
    ];
    const last = [...messages].reverse().find((m) => m.from === 'hq');
    viewEl.innerHTML = `
      <div class="home-widget">
        <div class="hw-top"><span class="hw-logo">HQ</span><b>The Office</b><span class="hw-dot ${live ? 'on' : ''}"></span></div>
        <div class="hw-big">${live}<small>agent${live === 1 ? '' : 's'} working</small></div>
        <div class="hw-sub">${agents.length} hired · ${ctx.repos.length} buildings</div>
        ${last ? `<div class="hw-last">“${esc(last.text.slice(0, 90))}${last.text.length > 90 ? '…' : ''}”</div>` : '<div class="hw-last">Text HQ to put agents to work.</div>'}
      </div>
      <div class="home-grid">
        ${apps.map((a) => `<button class="app-icon" data-app="${a.id}"><span class="ai-tile" style="background:${a.bg}">${a.icon}${a.badge ? `<i>${a.badge}</i>` : ''}</span><span class="ai-name">${a.name}</span></button>`).join('')}
      </div>
      <div class="home-dock">
        <button class="app-icon" data-app="messages"><span class="ai-tile" style="background:linear-gradient(180deg,#5af07a,#18c24a)">${ICON.messages}</span></button>
        <button class="app-icon" data-app="mail"><span class="ai-tile" style="background:linear-gradient(180deg,#4fb2ff,#1a6dff)">${ICON.mail}</span></button>
        <button class="app-icon" data-app="agents"><span class="ai-tile" style="background:linear-gradient(180deg,#ffb347,#ff7a18)">${ICON.gear}</span></button>
      </div>`;
    viewEl.querySelectorAll<HTMLElement>('[data-app]').forEach((b) => b.addEventListener('click', () => go({ app: b.dataset.app as 'messages' })));
  }

  // ---- Messages (texts with HQ) ----
  function renderMessages(fresh: boolean) {
    markSeen('text');
    const thread = messages.filter((m) => m.channel === 'text');
    const live = [...ctx.agents.values()].filter((a) => LIVE.has(a.status)).length;
    let html = header('HQ', live ? `${live} agent${live === 1 ? '' : 's'} on the clock` : 'The Office · one agent, many hands', `<span class="pv-avatar">HQ</span>`);
    html += `<div class="pv-scroll msgs">`;
    if (!thread.length) {
      html += `<div class="msg-empty"><span class="pv-avatar big">HQ</span><b>HQ</b><p>The office is one agent connected to all your others. Text it what you need and it sends agents into the right buildings.</p></div>`;
    }
    let lastDay = '';
    for (const m of thread) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDay) { html += `<div class="msg-day">${dayLabel(m.ts)}</div>`; lastDay = day; }
      const report = m.refs?.find((r) => r.action === 'report');
      if (report) html += `<div class="msg-sys">${esc(agentName(report.agentId))} reported back</div>`;
      html += `<div class="bubble ${m.from}" title="${esc(clock(m.ts))}">${fmt(m.text)}</div>`;
      for (const d of m.dispatched ?? []) html += dispatchCard(d.agentId, d.agentName, d.repo, d.task);
    }
    if (drafts.text !== undefined && drafts.text !== '') html += `<div class="bubble hq streaming">${fmt(drafts.text)}</div>`;
    else if (typing.text || sending.text) html += `<div class="bubble hq typing"><i></i><i></i><i></i></div>`;
    html += `</div>`;
    if (!thread.length) html += `<div class="msg-suggest">${SUGGESTIONS.map((s) => `<button>${esc(s)}</button>`).join('')}</div>`;
    html += `<form class="composer"><input data-keep="text" placeholder="Text HQ" autocomplete="off" /><button class="send" ${sending.text ? 'disabled' : ''}>${ICON.up}</button></form>`;
    viewEl.innerHTML = html;
    bindCommon();
    bindDispatchCards();
    const form = viewEl.querySelector('form')!;
    const input = form.querySelector('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || sending.text) return;
      input.value = '';
      void send('text', text);
    });
    viewEl.querySelectorAll<HTMLButtonElement>('.msg-suggest button').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent ?? ''; input.focus(); }));
    const s = viewEl.querySelector<HTMLElement>('.pv-scroll')!;
    s.scrollTop = s.scrollHeight;
    if (fresh) setTimeout(() => input.focus(), 30);
  }

  function dispatchCard(id: string, name: string, repo: string, task: string) {
    const a = ctx.agents.get(id);
    const st = a?.status ?? 'preparing';
    return `<button class="dispatch-card" data-agent="${esc(id)}">
      <div class="dc-top">${ICON.gear}<b>${esc(name)}</b><span>→ ${esc(repo)}</span><em class="chip ${st}">${STATUS_LABEL[st] ?? st}</em></div>
      <p>${esc(task.slice(0, 140))}${task.length > 140 ? '…' : ''}</p>
      ${a && LIVE.has(a.status) ? `<small>${esc(a.lastAction.slice(0, 80))}</small>` : a ? `<small>${a.filesChanged.length} file${a.filesChanged.length === 1 ? '' : 's'} changed${a.costUsd != null ? ` · $${a.costUsd.toFixed(2)}` : ''}</small>` : ''}
    </button>`;
  }
  function bindDispatchCards() {
    viewEl.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => b.addEventListener('click', () => go({ app: 'agents', open: b.dataset.agent })));
  }

  async function send(channel: OfficeChannel, text: string, subject?: string) {
    sending[channel] = true;
    drafts[channel] = '';
    refresh();
    try {
      await office.send({ channel, text, subject }, (d) => {
        if (d.type === 'me' && d.message) { upsert(d.message); refresh(); }
        else if (d.type === 'delta' && d.delta) {
          drafts[channel] = (drafts[channel] ?? '') + d.delta;
          const el = viewEl.querySelector<HTMLElement>('.bubble.streaming, .mail-writing p');
          if (el && view.app === (channel === 'text' ? 'messages' : 'mail')) {
            el.innerHTML = fmt(drafts[channel]!);
            const s = viewEl.querySelector<HTMLElement>('.pv-scroll');
            if (s && channel === 'text') s.scrollTop = s.scrollHeight;
          } else if (isOpen) refresh();
        } else if (d.type === 'message' && d.message) {
          drafts[channel] = undefined;
          upsert({ ...d.message, read: true });
        } else if (d.type === 'error') {
          upsert({ id: `err-${Date.now()}`, from: 'hq', channel, text: `(Couldn't reach HQ: ${d.error})`, ts: new Date().toISOString(), read: true });
        }
      });
    } catch (e) {
      upsert({ id: `err-${Date.now()}`, from: 'hq', channel, text: `(Couldn't reach HQ: ${(e as Error).message})`, ts: new Date().toISOString(), read: true });
    }
    sending[channel] = false;
    drafts[channel] = undefined;
    updateBadge();
    if (isOpen) refresh();
  }

  // ---- Mail ----
  function renderMail() {
    const v = view as Extract<View, { app: 'mail' }>;
    markSeen('email');
    if (v.compose) return renderCompose();
    if (v.open) {
      const m = messages.find((x) => x.id === v.open);
      if (m) {
        viewEl.innerHTML = `${header('Inbox', '', `<button class="pv-icon" data-reply title="Reply">${ICON.reply}</button>`)}
          <div class="pv-scroll mail-read">
            <h4>${esc(m.subject || '(no subject)')}</h4>
            <div class="mr-from"><span class="pv-avatar ${m.from}">${m.from === 'hq' ? 'HQ' : 'Me'}</span><div><b>${m.from === 'hq' ? 'HQ' : 'You'}</b><small>${m.from === 'hq' ? 'office@hq.openworld → you' : 'you → office@hq.openworld'}</small></div><time>${esc(clock(m.ts))}</time></div>
            <div class="mr-body">${fmt(m.text)}</div>
            ${(m.dispatched ?? []).map((d) => dispatchCard(d.agentId, d.agentName, d.repo, d.task)).join('')}
          </div>`;
        bindCommon();
        bindDispatchCards();
        viewEl.querySelector('[data-reply]')!.addEventListener('click', () => {
          replySubject = m.subject ? (m.subject.toLowerCase().startsWith('re:') ? m.subject : `Re: ${m.subject}`) : '';
          go({ app: 'mail', compose: true });
        });
        return;
      }
    }
    const mails = messages.filter((m) => m.channel === 'email').slice().reverse();
    let html = header('Mail', 'office@hq.openworld', `<button class="pv-icon" data-compose title="Compose">${ICON.compose}</button>`);
    html += `<div class="pv-scroll mail-list">`;
    if (drafts.email !== undefined || typing.email || sending.email) {
      html += `<div class="mail-item mail-writing"><span class="mi-dot"></span><div><b>HQ</b><small>Writing a reply…</small><p>${fmt((drafts.email ?? '').slice(-140))}</p></div></div>`;
    }
    if (!mails.length && !sending.email) html += `<div class="msg-empty"><b>No mail yet</b><p>Email the office for bigger asks. HQ replies here and emails you a report when each agent finishes.</p></div>`;
    for (const m of mails) {
      html += `<button class="mail-item ${m.from === 'hq' && !m.read ? 'unread' : ''}" data-mail="${esc(m.id)}">
        <span class="mi-dot"></span>
        <div><div class="mi-row"><b>${m.from === 'hq' ? 'HQ' : 'To: HQ'}</b><time>${esc(shortTime(m.ts))}</time></div>
        <span class="mi-subj">${esc(m.subject || '(no subject)')}</span>
        <p>${esc(m.text.replace(/\s+/g, ' ').slice(0, 110))}</p></div></button>`;
    }
    html += `</div>`;
    viewEl.innerHTML = html;
    bindCommon();
    viewEl.querySelector('[data-compose]')!.addEventListener('click', () => { replySubject = ''; go({ app: 'mail', compose: true }); });
    viewEl.querySelectorAll<HTMLElement>('[data-mail]').forEach((b) => b.addEventListener('click', () => go({ app: 'mail', open: b.dataset.mail })));
  }

  let replySubject = '';
  function renderCompose() {
    viewEl.innerHTML = `${header('New Message', '', `<button class="pv-send" data-send>Send</button>`)}
      <form class="pv-scroll compose">
        <label><span>To:</span><input value="HQ &lt;office@hq.openworld&gt;" readonly tabindex="-1" /></label>
        <label><span>Subject:</span><input data-keep="subject" name="subject" placeholder="What do you need?" value="${esc(replySubject)}" /></label>
        <textarea data-keep="body" name="body" placeholder="Brief the office. HQ will split the work across agents and report back by email."></textarea>
      </form>`;
    bindCommon();
    const form = viewEl.querySelector<HTMLFormElement>('form')!;
    const subj = form.querySelector<HTMLInputElement>('[name=subject]')!;
    const body = form.querySelector<HTMLTextAreaElement>('[name=body]')!;
    const submit = () => {
      const text = body.value.trim();
      if (!text || sending.email) { body.focus(); return; }
      const subject = subj.value.trim() || 'Note from the field';
      go({ app: 'mail' });
      void send('email', text, subject);
    };
    viewEl.querySelector('[data-send]')!.addEventListener('click', submit);
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
    setTimeout(() => (replySubject ? body : subj).focus(), 30);
  }

  // ---- Agents ----
  let logEl: HTMLElement | null = null;
  function renderAgents() {
    const v = view as Extract<View, { app: 'agents' }>;
    const all = [...ctx.agents.values()].sort((a, b) => (LIVE.has(b.status) ? 1 : 0) - (LIVE.has(a.status) ? 1 : 0) || b.startedAt.localeCompare(a.startedAt));
    const a = v.open ? ctx.agents.get(v.open) : undefined;
    if (a) return renderAgent(a);
    const live = all.filter((x) => LIVE.has(x.status)).length;
    let html = header('Agents', `${live} working · ${all.length} total`);
    html += `<div class="pv-scroll agent-list">`;
    if (!all.length) html += `<div class="msg-empty"><b>No agents yet</b><p>Text HQ a task, or hire one in a building's Agent Lab.</p></div>`;
    for (const x of all) {
      html += `<button class="agent-row" data-open="${esc(x.id)}">
        <span class="ar-av ${x.status}">${esc(x.name.replace(/^Agent\s+/, '').slice(0, 2))}</span>
        <div><div class="mi-row"><b>${esc(x.name)}</b><em class="chip ${x.status}">${STATUS_LABEL[x.status]}</em></div>
        <span class="mi-subj">${esc(x.repo)}</span>
        <p>${esc(LIVE.has(x.status) ? x.lastAction : x.task).slice(0, 90)}</p></div></button>`;
    }
    html += `</div>`;
    viewEl.innerHTML = html;
    bindCommon();
    viewEl.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => go({ app: 'agents', open: b.dataset.open })));
  }

  function renderAgent(a: AgentInfo) {
    const working = LIVE.has(a.status);
    viewEl.innerHTML = `${header(esc(a.name), esc(a.repo))}
      <div class="pv-scroll agent-detail">
        <div class="ad-card">
          <div class="mi-row"><em class="chip ${a.status}">${STATUS_LABEL[a.status]}</em><time>${esc(since(a.startedAt, a.endedAt))}</time></div>
          <p class="ad-task">${fmt(a.task.split('\n\n(Dispatched by HQ')[0])}</p>
          <dl>
            <dt>Doing</dt><dd>${esc(a.lastAction)}</dd>
            <dt>Files</dt><dd>${a.filesChanged.length ? a.filesChanged.slice(0, 8).map((f) => `<code>${esc(f)}</code>`).join(' ') : 'none yet'}</dd>
            <dt>Branch</dt><dd><code>${esc(a.branch)}</code></dd>
            ${a.costUsd != null ? `<dt>Cost</dt><dd>$${a.costUsd.toFixed(2)}</dd>` : ''}
            ${a.prUrl ? `<dt>PR</dt><dd><a href="${esc(a.prUrl)}" target="_blank" rel="noopener">${esc(a.prUrl.replace(/^https:\/\/github.com\//, ''))}</a></dd>` : ''}
          </dl>
        </div>
        <div class="ad-actions">
          <button class="pbtn" data-go>Go to building</button>
          <button class="pbtn ghost" data-wp>Waypoint</button>
          ${working ? '<button class="pbtn danger" data-stop>Stop</button>' : ''}
        </div>
        <h5>Live log</h5>
        <div class="ad-log"><small>Loading…</small></div>
      </div>`;
    bindCommon();
    viewEl.querySelector('[data-go]')!.addEventListener('click', () => { close(); void hooks.travelTo(a.repo); });
    viewEl.querySelector('[data-wp]')!.addEventListener('click', () => { hooks.setWaypoint(a.repo); close(); });
    viewEl.querySelector('[data-stop]')?.addEventListener('click', async (e) => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      try { ctx.agents.set(a.id, await api.stopAgent(a.id)); } catch { /* ws will tell us */ }
      refresh();
    });
    logEl = viewEl.querySelector('.ad-log');
    const id = a.id;
    api.agentLog(id).then(({ events }) => {
      if (!(view.app === 'agents' && view.open === id) || !logEl) return;
      logEl.innerHTML = '';
      const shown = events.filter((e) => e.event.kind !== 'diff').slice(-40);
      if (!shown.length) logEl.innerHTML = '<small>No activity recorded (the log resets when the server restarts).</small>';
      for (const e of shown) appendLog(e.event, e.ts, false);
    }).catch(() => { if (logEl) logEl.innerHTML = '<small>Log unavailable.</small>'; });
  }

  function appendLog(ev: AgentEvent, ts: number, live = true) {
    if (!logEl || !logEl.isConnected || ev.kind === 'diff') return;
    if (logEl.querySelector('small')) logEl.innerHTML = '';
    const line = document.createElement('div');
    line.className = `log-line ${ev.kind}`;
    const t = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = ev.kind === 'text' ? ev.text : ev.kind === 'tool' ? `${ev.tool} · ${ev.summary}` : ev.kind === 'tool_result' ? (ev.isError ? `✗ ${ev.summary}` : '') : ev.kind === 'status' ? `● ${STATUS_LABEL[ev.status] ?? ev.status}${ev.message ? ` · ${ev.message}` : ''}` : ev.kind === 'result' ? `✓ ${ev.text}` : '';
    if (!text) return;
    // The final result usually repeats the agent's last message.
    if (ev.kind === 'result' && logEl.lastElementChild?.classList.contains('text') && ev.text.trim() && logEl.lastElementChild.textContent?.includes(ev.text.trim().slice(0, 60))) {
      line.innerHTML = `<time>${t}</time><span>✓ Finished</span>`;
      logEl.appendChild(line);
      return;
    }
    line.innerHTML = `<time>${t}</time><span>${esc(text.slice(0, 400))}</span>`;
    logEl.appendChild(line);
    while (logEl.children.length > 60) logEl.firstChild?.remove();
    if (live) {
      const s = viewEl.querySelector<HTMLElement>('.pv-scroll');
      if (s && s.scrollHeight - s.scrollTop - s.clientHeight < 120) s.scrollTop = s.scrollHeight;
    }
  }

  // ---- Maps ----
  function renderMaps() {
    const sites = hooks.sites();
    const busy = new Map<string, number>();
    for (const a of ctx.agents.values()) if (LIVE.has(a.status)) busy.set(a.repo, (busy.get(a.repo) ?? 0) + 1);
    viewEl.innerHTML = `${header('Maps', esc(hooks.placeName?.() ?? `${sites.length} buildings`))}
      <div class="maps-search"><input data-keep="maps" placeholder="Search projects" autocomplete="off" /></div>
      <div class="pv-scroll maps-list"></div>`;
    bindCommon();
    const list = viewEl.querySelector<HTMLElement>('.maps-list')!;
    const q = viewEl.querySelector<HTMLInputElement>('input')!;
    const draw = () => {
      const s = q.value.toLowerCase();
      list.innerHTML = sites
        .filter(({ repo: r }) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s))
        .map(({ repo: r }) => `<div class="map-row">
          <span class="mr-pin" style="background:${esc(r.brandColor)}"></span>
          <div><b>${esc(r.name)}</b><small>${TIER[r.tier]}${busy.get(r.name) ? ` · <span class="good">${busy.get(r.name)} working</span>` : ''}</small></div>
          <button class="pbtn ghost sm" data-wp="${esc(r.name)}">Pin</button><button class="pbtn sm" data-go="${esc(r.name)}">Go</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => b.addEventListener('click', () => { hooks.setWaypoint(b.dataset.wp!); close(); }));
      list.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { close(); void hooks.travelTo(b.dataset.go!); }));
    };
    q.addEventListener('input', draw);
    draw();
  }

  updateBadge();
  return { open, close, toggle, isOpen: () => isOpen };

  function agentName(id: string) {
    return ctx.agents.get(id)?.name ?? messages.flatMap((m) => m.dispatched ?? []).find((d) => d.agentId === id)?.agentName ?? 'An agent';
  }
}

// ---------------------------------------------------------------- helpers
const TIER = { landmark: 'Skyscraper HQ', tower: 'Tower', midrise: 'Office building', small: 'Storefront' } as const;

/** Escape, linkify URLs, keep line breaks (CSS pre-wrap). */
function fmt(text: string) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https:\/\/(www\.)?/, '')}</a>`);
}
function clock(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function shortTime(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function since(start: string, end: string | null) {
  const s = Math.max(0, ((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000);
  const dur = s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
  return end ? `took ${dur}` : `${dur} so far`;
}

const svg = (d: string, fill = false) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const ICON = {
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10.5 18.5h3"/>'),
  messages: svg('<path d="M12 3C6.5 3 2 6.7 2 11.2c0 2.6 1.5 4.9 3.8 6.4L5 21l4-2.2c1 .3 2 .4 3 .4 5.5 0 10-3.7 10-8.2S17.5 3 12 3z"/>', true),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  map: svg('<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  compose: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  reply: svg('<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  signal: svg('<rect x="2" y="15" width="3" height="5" rx="1"/><rect x="7.5" y="11" width="3" height="9" rx="1"/><rect x="13" y="7" width="3" height="13" rx="1"/><rect x="18.5" y="3" width="3" height="17" rx="1"/>', true),
  battery: '<svg viewBox="0 0 28 14"><rect x="1" y="1" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".45"/><rect x="3" y="3" width="17" height="8" rx="2" fill="currentColor"/><rect x="25.5" y="5" width="1.8" height="4" rx=".9" fill="currentColor" fill-opacity=".45"/></svg>',
};
