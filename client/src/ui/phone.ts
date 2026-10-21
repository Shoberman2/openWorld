import type { AgentEvent, AgentInfo, MasterMessage, MasterThreadSummary, OfficeChannel, OfficeMessage, Repo } from '../../../shared/types.ts';
import { api, office, masters, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { openReview } from './review.ts';
import { installRing } from './ring.ts';
import { briefingHtml, bindBriefing, currentBriefing, loadBriefing, waiting } from './briefing.ts';
import { renderSchedulesApp } from './schedules.ts';
import type { GameCtx } from '../ctx.ts';

/** What the phone needs from the game world (main.ts provides these). */
export interface PhoneHooks {
  /** Every project building in the current place. */
  sites(): { repo: Repo }[];
  setWaypoint(repoName: string): void;
  travelTo(repoName: string): void | Promise<void>;
  /** e.g. "Midtown Manhattan, New York City" — shown in Maps. */
  placeName?(): string;
  /** Your apartment: Maps' first row, reachable from anywhere. */
  home?: { address: string; go(): void | Promise<void>; pin(): void };
}

/**
 * A renderer-neutral view of the phone's conversations, for UIs other than the DOM phone (the VR wrist
 * phone). Thread ids: 'hq' for the office, 'repo:<name>' for a project's lead.
 */
export interface PhoneThread {
  id: string;
  title: string;
  subtitle: string;
  unread: number;
  typing: boolean;
  last: { from: 'me' | 'them' | 'hq'; text: string; ts: string } | null;
}
export interface PhoneMessage {
  id: string;
  /** 'them' is whoever owns the thread (HQ, or the project lead); 'hq' is HQ delegating into a lead's thread. */
  from: 'me' | 'them' | 'hq';
  text: string;
  ts: string;
  /** Text still streaming in. */
  streaming?: boolean;
}

export interface Phone {
  open(app?: AppId): void;
  /** Open one project lead's thread. */
  openThread(repo: string): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** The app on screen while the phone is out (null when put away), for saving the session. */
  app(): string | null;
  /** HQ first, then project leads with recent messages, then every other repo. */
  threads(): PhoneThread[];
  messages(threadId: string): Promise<PhoneMessage[]>;
  send(threadId: string, text: string): Promise<void>;
  markRead(threadId: string): void;
  /** Called whenever threads, messages, typing, unread counts or agents change. Returns an unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** Every agent this session knows about, working ones first. */
  agents(): AgentInfo[];
  /** Put a new agent to work in a repo (never opens a PR on its own). */
  hire(repo: string, task: string): Promise<AgentInfo>;
  stopAgent(id: string): Promise<void>;
  /** Opens a pull request for a finished agent's work. Only call on an explicit user action. */
  openPr(id: string): Promise<AgentInfo>;
}

type AppId = 'home' | 'messages' | 'mail' | 'team' | 'agents' | 'maps' | 'hire' | 'today' | 'schedules' | 'review';
type View =
  | { app: 'home' }
  | { app: 'hire'; repo?: string }
  | { app: 'messages' }
  | { app: 'mail'; open?: string; compose?: boolean }
  | { app: 'team'; open?: string }
  | { app: 'agents'; open?: string }
  | { app: 'maps' }
  | { app: 'today' }
  | { app: 'schedules'; repo?: string }
  | { app: 'review' };

const LIVE = new Set(['running', 'preparing']);
const STATUS_LABEL: Record<string, string> = { preparing: 'Setting up', running: 'Working', needs_input: 'Needs you', done: 'Done', error: 'Error', stopped: 'Stopped' };
const LEAD_SUGGESTIONS = [
  "What's the latest here?",
  "What's unfinished or risky right now?",
  'Send someone to look for bugs. Read-only, no changes.',
];
const SUGGESTIONS = [
  "What's everyone working on?",
  'Send someone to review the README of my biggest project. Read-only, no changes.',
  'Any agents need my attention?',
];

/**
 * The player's phone (P), reachable from anywhere: outdoors, inside buildings, on any vehicle, in any
 * city. Text or email the office ("HQ"), the one agent that runs every building; text any project's
 * lead (its master agent) in Projects. Also: live agent roster, and a map of project buildings.
 */
export function installPhone(ctx: GameCtx, hooks: PhoneHooks): Phone {
  let messages: OfficeMessage[] = [];
  let view: View = { app: 'home' };
  let isOpen = false;
  const typing: Record<OfficeChannel, boolean> = { text: false, email: false };
  const drafts: Partial<Record<OfficeChannel, string>> = {};
  const sending: Record<OfficeChannel, boolean> = { text: false, email: false };
  // Project leads: summaries for every thread, full messages loaded when a thread is opened.
  const leadSummary = new Map<string, MasterThreadSummary>();
  const leadMsgs = new Map<string, MasterMessage[]>();
  const leadTyping = new Set<string>();
  const leadSending = new Set<string>();
  const leadDraft = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const fn of listeners) fn(); };

  // ---------------------------------------------------------------- DOM
  // Docked on the left edge: a slim tab when put away, a phone that slides out when opened.
  const btn = document.createElement('button');
  btn.id = 'phone-tab';
  btn.title = 'Phone (P) · click or swipe right';
  btn.innerHTML = `<span class="pt-grip"></span>${ICON.phone}<span class="phone-badge hidden"></span>
    <span class="pt-live hidden"><i></i><b>0</b></span><kbd>P</kbd>`;
  document.body.appendChild(btn);
  const liveEl = btn.querySelector<HTMLSpanElement>('.pt-live')!;

  const root = document.createElement('div');
  root.id = 'phone';
  root.className = 'phone';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <button class="phone-stow" title="Put the phone away (P)">${ICON.left}</button>
    <div class="phone-frame">
      <i class="pf-btn pf-action"></i><i class="pf-btn pf-vol1"></i><i class="pf-btn pf-vol2"></i><i class="pf-btn pf-power"></i>
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

  root.querySelector('.phone-homebar')!.addEventListener('click', () => go({ app: 'home' }));
  root.querySelector('.phone-stow')!.addEventListener('click', () => close());

  // Swipe: drag the tab right to pull the phone out, drag the phone's edge or status bar left to put it away.
  let drag: { x: number; moved: boolean; opening: boolean } | null = null;
  const width = () => root.getBoundingClientRect().width + 24;
  const startDrag = (e: PointerEvent, opening: boolean) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, moved: false, opening };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (!drag.moved) return;
    root.classList.add('dragging');
    if (drag.opening) { root.classList.add('peek'); root.style.transform = `translateX(${Math.min(0, -width() + Math.max(0, dx))}px)`; }
    else root.style.transform = `translateX(${Math.min(0, dx)}px)`;
  };
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const dx = e.clientX - d.x;
    root.classList.remove('dragging', 'peek');
    root.style.transform = '';
    if (!d.moved) { if (d.opening) toggle(); return; }
    if (d.opening && dx > 50) open();
    else if (!d.opening && dx < -60) close();
  };
  btn.addEventListener('pointerdown', (e) => startDrag(e, true));
  btn.addEventListener('pointermove', moveDrag);
  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', endDrag);
  for (const el of [root.querySelector<HTMLElement>('.phone-status')!, root.querySelector<HTMLElement>('.phone-stow')!]) {
    el.addEventListener('pointerdown', (e) => startDrag(e, false));
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }

  // Esc that only released the mouse (pointer lock) shouldn't also put the phone away.
  let unlockedAt = 0;
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) unlockedAt = performance.now(); });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typingInField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.code === 'Escape' && isOpen) {
      if (!typingInField && performance.now() - unlockedAt < 300) return;
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

  // Status bar clock follows the game's day/night clock; the tab shows how many agents are working.
  const tick = () => {
    timeEl.textContent = (ctx.dayNight?.label() ?? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })).replace(/\s?[AP]M$/, '');
    const live = [...ctx.agents.values()].filter((a) => LIVE.has(a.status)).length;
    liveEl.classList.toggle('hidden', live === 0);
    liveEl.querySelector('b')!.textContent = String(live);
    btn.title = `Phone (P)${live ? ` · ${live} agent${live === 1 ? '' : 's'} working` : ''}`;
  };
  tick();
  setInterval(tick, 1000);

  // ---------------------------------------------------------------- state
  const unread = (ch?: OfficeChannel) => messages.filter((m) => m.from === 'hq' && !m.read && (!ch || m.channel === ch)).length;
  const leadUnread = (repo?: string) => {
    if (repo) return leadSummary.get(repo)?.unread ?? 0;
    let n = 0;
    for (const t of leadSummary.values()) n += t.unread;
    return n;
  };

  function upsert(m: OfficeMessage) {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i >= 0) messages[i] = { ...messages[i], ...m, read: messages[i].read || m.read };
    else messages.push(m);
  }

  function updateBadge() {
    const n = unread() + leadUnread();
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    changed();
  }

  function upsertLead(repo: string, m: MasterMessage) {
    const list = leadMsgs.get(repo);
    if (list) {
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) list[i] = { ...list[i], ...m, read: list[i].read || m.read };
      else list.push(m);
    }
    const sum = leadSummary.get(repo) ?? { repo, unread: 0, last: null };
    const isNew = sum.last?.id !== m.id;
    if (!sum.last || sum.last.ts <= m.ts) sum.last = m;
    if (list) sum.unread = list.filter((x) => x.from === 'master' && !x.read).length;
    else if (isNew && m.from === 'master' && !m.read) sum.unread++;
    leadSummary.set(repo, sum);
  }

  function markLeadSeen(repo: string) {
    const sum = leadSummary.get(repo);
    for (const m of leadMsgs.get(repo) ?? []) m.read = true;
    if (!sum?.unread) return;
    sum.unread = 0;
    masters.markRead(repo).catch(() => {});
    updateBadge();
  }

  function loadLead(repo: string) {
    return masters.thread(repo).then((t) => {
      leadMsgs.set(repo, t.messages);
      changed();
      return t.messages;
    });
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
  masters.list().then((t) => {
    for (const x of t.threads) leadSummary.set(x.repo, x);
    updateBadge();
    if (isOpen) refresh();
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
      changed();
    } else if (msg.type === 'office:typing') {
      typing[msg.channel] = msg.on;
      changed();
      if (isOpen) refresh();
    } else if (msg.type === 'master:message') {
      const m = msg.message;
      const known = (leadMsgs.get(msg.repo) ?? []).some((x) => x.id === m.id) || leadSummary.get(msg.repo)?.last?.id === m.id;
      upsertLead(msg.repo, m);
      const viewing = isOpen && view.app === 'team' && view.open === msg.repo;
      if (m.from === 'master' && viewing) markLeadSeen(msg.repo);
      if (m.from === 'master' && !known && !viewing && !m.read) notifyLead(msg.repo, m);
      updateBadge();
      if (isOpen && view.app !== 'agents') refresh();
    } else if (msg.type === 'master:typing') {
      if (msg.on) leadTyping.add(msg.repo); else leadTyping.delete(msg.repo);
      changed();
      if (isOpen && view.app === 'team') refresh();
    } else if (msg.type === 'agent:update') {
      ctx.agents.set(msg.agent.id, msg.agent);
      tick();
      changed();
      if (isOpen && (view.app === 'agents' || view.app === 'messages' || view.app === 'home' || view.app === 'review')) refresh();
    } else if (msg.type === 'agent:event') {
      if (isOpen && view.app === 'agents' && view.open === msg.agentId) appendLog(msg.event, msg.ts);
    }
  });

  // ---------------------------------------------------------------- open / close
  // The phone doesn't pause the game: keys still drive the robot (except while typing in a field), it
  // only frees the mouse so you can tap. Click the world to look around again; the phone stays out.
  function open(app?: AppId) {
    if (!isOpen) {
      isOpen = true;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      btn.classList.add('active');
      document.body.classList.add('phone-docked');
      if (document.pointerLockElement) document.exitPointerLock();
      track('phone_opened', { app: app ?? view.app });
    }
    if (app && (app !== view.app || app === 'home')) go(app === 'home' ? { app: 'home' } : ({ app } as View));
    else render(false);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    btn.classList.remove('active');
    document.body.classList.remove('phone-docked');
    if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
  function toggle() { if (isOpen) close(); else open(); }

  function go(v: View) {
    if (v.app !== view.app && v.app !== 'home') track('phone_app', { app: v.app });
    view = v;
    render();
  }

  function openThread(repo: string) {
    open('team');
    go({ app: 'team', open: repo });
  }

  // ---------------------------------------------------------------- notifications
  let bannerTimer = 0;
  function notifyLead(repo: string, m: MasterMessage) {
    const html = `<div class="pn-app lead">${ICON.team}<span>PROJECTS</span><time>now</time></div>
      <b>${esc(repo)} lead</b><p>${esc(m.text.slice(0, 160))}</p>`;
    const el = isOpen ? bannerIn : bannerOut;
    el.innerHTML = html;
    el.classList.add('show');
    el.onclick = () => { el.classList.remove('show'); openThread(repo); };
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { bannerIn.classList.remove('show'); bannerOut.classList.remove('show'); }, 7000);
  }
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
    const chat = view.app === 'messages' || (view.app === 'team' && !!view.open);
    if (s) s.scrollTop = atBottom && chat ? s.scrollHeight : prevTop;
  }

  function render(fresh = true) {
    viewEl.className = `phone-view app-${view.app}`;
    if (view.app === 'home') renderHome();
    else if (view.app === 'hire') renderHire(fresh);
    else if (view.app === 'messages') renderMessages(fresh);
    else if (view.app === 'mail') renderMail();
    else if (view.app === 'team') renderTeam(fresh);
    else if (view.app === 'agents') renderAgents();
    else if (view.app === 'today') renderToday();
    else if (view.app === 'schedules') renderSchedules();
    else if (view.app === 'review') renderReview();
    else renderMaps();
  }

  const header = (title: string, sub = '', right = '') => `
    <div class="pv-head"><button class="pv-back" data-home>‹</button><div class="pv-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div><div class="pv-right">${right}</div></div>`;

  function bindCommon() {
    viewEl.querySelectorAll<HTMLElement>('[data-home]').forEach((b) => b.addEventListener('click', () => {
      if (view.app === 'schedules' && schedulesBack?.()) return;
      if (view.app === 'mail' && (view.open || view.compose)) go({ app: 'mail' });
      else if (view.app === 'agents' && view.open) go({ app: 'agents' });
      else if (view.app === 'team' && view.open) go({ app: 'team' });
      else if (view.app === 'hire' && view.repo && hireFrom === 'team') go({ app: 'team', open: view.repo });
      else go({ app: 'home' });
    }));
  }

  // ---- Home: agent control at a glance ----
  const DOCK: { id: AppId; name: string; icon: string; bg: string }[] = [
    { id: 'messages', name: 'Messages', icon: ICON.messages, bg: 'linear-gradient(180deg,#5af07a,#18c24a)' },
    { id: 'mail', name: 'Mail', icon: ICON.mail, bg: 'linear-gradient(180deg,#4fb2ff,#1a6dff)' },
    { id: 'team', name: 'Projects', icon: ICON.team, bg: 'linear-gradient(180deg,#c48bff,#7a3dff)' },
    { id: 'agents', name: 'Agents', icon: ICON.gear, bg: 'linear-gradient(180deg,#ffb347,#ff7a18)' },
    { id: 'maps', name: 'Maps', icon: ICON.map, bg: 'linear-gradient(180deg,#9be7a0,#3fb6a8)' },
    { id: 'schedules', name: 'Schedules', icon: ICON.clock, bg: 'linear-gradient(180deg,#7fb2ff,#3a5bd9)' },
    { id: 'review', name: 'Review', icon: ICON.check, bg: 'linear-gradient(180deg,#5af0b4,#16a874)' },
  ];
  /** Finished with changes and no PR yet: waiting on the user at the review station. */
  const needsReview = (a: AgentInfo) => a.review === 'pending' || (a.review == null && a.status === 'done' && a.filesChanged.length > 0 && !a.prUrl);
  const needsInput = (a: AgentInfo) => a.status === 'needs_input';
  /** Everything waiting on you: questions first, then finished work to review. */
  const inbox = () => sortedAgents().filter((a) => needsInput(a) || needsReview(a)).sort((a, b) => Number(needsInput(b)) - Number(needsInput(a)));
  const dockBadge = (id: AppId) => id === 'messages' ? unread('text') : id === 'mail' ? unread('email') : id === 'team' ? leadUnread() : id === 'review' ? inbox().length : 0;

  function renderHome() {
    const agents = sortedAgents();
    const live = agents.filter((a) => LIVE.has(a.status));
    const review = agents.filter(needsReview);
    const recent = agents.filter((a) => !LIVE.has(a.status) && !needsReview(a) && !needsInput(a)).slice(0, 4);
    const spent = agents.reduce((n, a) => n + (a.costUsd ?? 0), 0);
    const files = live.reduce((n, a) => n + a.filesChanged.length, 0);
    const last = [...messages].reverse().find((m) => m.from === 'hq');
    const today = currentBriefing();
    let html = `<div class="pv-scroll home-scroll">
      <button class="today-widget" data-app="today"><div class="tw-top">☀ Today${today && waiting(today) ? `<i>${waiting(today)}</i>` : ''}</div><p>${esc(today?.headline ?? 'What happened while you were away.')}</p></button>
      <div class="home-widget">
        <div class="hw-top"><span class="hw-logo">HQ</span><b>Agents</b><span class="hw-dot ${live.length ? 'on' : ''}"></span><small>${esc(ctx.repos.length + ' projects')}</small></div>
        <div class="hw-stats">
          <div><b>${live.length}</b><small>working</small></div>
          <div class="hw-review" data-app="review"><b>${review.length}</b><small>to review</small></div>
          <div><b>${files}</b><small>files</small></div>
          <div><b>$${spent.toFixed(2)}</b><small>spent</small></div>
        </div>
        <button class="hw-hire" data-hire>${ICON.plus}<span>Hire an agent</span></button>
      </div>`;
    const asking = agents.filter(needsInput);
    if (asking.length) html += `<h5 class="home-h">Needs you</h5>${asking.map(agentCard).join('')}`;
    if (live.length) html += `<h5 class="home-h">Working now</h5>${live.map(agentCard).join('')}`;
    if (review.length) html += `<h5 class="home-h">Ready for you</h5>${review.map(agentCard).join('')}`;
    if (!live.length && !review.length && !asking.length) {
      html += `<div class="home-idle"><b>No one's working right now.</b><p>Hire an agent in any project, or text HQ and it'll send people into the right buildings.</p></div>`;
    }
    if (recent.length) html += `<h5 class="home-h">Recent</h5><div class="home-recent">${recent.map((a) => `<button class="hr-row" data-open="${esc(a.id)}"><span class="ar-av ${a.status}">${esc(initials(a.name))}</span><div><b>${esc(a.name)}</b><small>${esc(a.repo)} · ${STATUS_LABEL[a.status]}${a.costUsd != null ? ` · $${a.costUsd.toFixed(2)}` : ''}</small></div><time>${esc(shortTime(a.endedAt ?? a.startedAt))}</time></button>`).join('')}</div>`;
    html += `<button class="home-hq" data-app="messages"><span class="pv-avatar">HQ</span><div><b>HQ</b><p>${last ? esc(last.text.replace(/\s+/g, ' ').slice(0, 90)) : 'Text the office what you need.'}</p></div>${unread('text') ? `<i class="lead-badge">${unread('text')}</i>` : ''}</button>`;
    html += `</div>
      <div class="home-dock">${DOCK.map((a) => { const n = dockBadge(a.id); return `<button class="app-icon" data-app="${a.id}" title="${a.name}"><span class="ai-tile" style="background:${a.bg}">${a.icon}${n ? `<i>${n}</i>` : ''}</span><span class="ai-name">${a.name}</span></button>`; }).join('')}</div>`;
    viewEl.innerHTML = html;
    viewEl.querySelectorAll<HTMLElement>('[data-app]').forEach((b) => b.addEventListener('click', () => go({ app: b.dataset.app as 'messages' })));
    viewEl.querySelector('[data-hire]')!.addEventListener('click', () => { hireFrom = 'home'; go({ app: 'hire' }); });
    bindAgentCards();
  }

  function sortedAgents() {
    return [...ctx.agents.values()].sort((a, b) => (LIVE.has(b.status) ? 1 : 0) - (LIVE.has(a.status) ? 1 : 0) || b.startedAt.localeCompare(a.startedAt));
  }

  /** One agent with its controls: Stop while working, Open PR once it has changes (two taps), Log, Go. */
  function agentCard(a: AgentInfo) {
    const working = LIVE.has(a.status);
    const here = hooks.sites().some((s) => s.repo.name === a.repo);
    return `<div class="agent-card ${a.status}" data-card="${esc(a.id)}">
      <button class="ac-top" data-open="${esc(a.id)}"><span class="ar-av ${a.status}">${esc(initials(a.name))}</span>
        <div><b>${esc(a.name)}</b><small>${esc(a.repo)} · ${esc(since(a.startedAt, a.endedAt))}</small></div><em class="chip ${a.status}">${STATUS_LABEL[a.status] ?? a.status}</em></button>
      ${needsInput(a) ? `<p class="ac-doing ac-ask"><b>Asks:</b> ${esc((a.question ?? '').slice(0, 160))}</p>` : `<p class="ac-doing">${working ? '<i class="ac-pulse"></i>' : ''}${esc((working ? a.lastAction : a.task.split('\n')[0]).slice(0, 120))}</p>`}
      <div class="ac-meta"><span>${a.filesChanged.length} file${a.filesChanged.length === 1 ? '' : 's'}</span>${a.costUsd != null ? `<span>$${a.costUsd.toFixed(2)}</span>` : ''}${a.prUrl ? `<a href="${esc(a.prUrl)}" target="_blank" rel="noopener">PR ↗</a>` : ''}</div>
      <div class="ac-actions">
        ${working ? `<button class="pbtn sm danger" data-stop="${esc(a.id)}">Stop</button>` : ''}
        ${needsInput(a) ? `<button class="pbtn sm" data-review="${esc(a.id)}">Answer</button>` : ''}
        ${needsReview(a) ? `<button class="pbtn sm" data-review="${esc(a.id)}">Review</button>` : ''}
        <button class="pbtn sm ghost" data-open="${esc(a.id)}">Log</button>
        <button class="pbtn sm ghost" data-go="${esc(a.repo)}" title="${here ? 'Walk me there' : 'Fly home to the building'}">Go</button>
      </div>
    </div>`;
  }

  const prArmed = new Map<string, number>();
  function bindAgentCards() {
    viewEl.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => go({ app: 'agents', open: b.dataset.open })));
    viewEl.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { close(); void hooks.travelTo(b.dataset.go!); }));
    viewEl.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Stopping…';
      await stopAgent(b.dataset.stop!);
    }));
    viewEl.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((b) => b.addEventListener('click', () => {
      track('phone_review', { agent: b.dataset.review });
      openReview(b.dataset.review!);
    }));
    viewEl.querySelectorAll<HTMLButtonElement>('[data-pr]').forEach((b) => {
      const id = b.dataset.pr!;
      if ((prArmed.get(id) ?? 0) > Date.now()) { b.textContent = 'Tap to confirm'; b.classList.add('armed'); }
      b.addEventListener('click', async () => {
        // Opening a PR is public: it takes a second, deliberate tap.
        if ((prArmed.get(id) ?? 0) < Date.now()) {
          prArmed.set(id, Date.now() + 4000);
          b.textContent = 'Tap to confirm';
          b.classList.add('armed');
          setTimeout(() => { if (b.isConnected && b.classList.contains('armed')) { b.textContent = 'Open PR'; b.classList.remove('armed'); } }, 4000);
          return;
        }
        prArmed.delete(id);
        b.disabled = true;
        b.textContent = 'Opening…';
        try { await openPr(id); toastIn('Pull request opened'); }
        catch (e) { toastIn(`Couldn't open the PR: ${(e as Error).message}`); }
        refresh();
      });
    });
  }

  async function stopAgent(id: string) {
    try { ctx.agents.set(id, await api.stopAgent(id)); } catch { /* the socket will tell us */ }
    changed();
    refresh();
  }
  async function openPr(id: string) {
    const a = await api.openPr(id);
    ctx.agents.set(a.id, a);
    track('agent_pr_opened', { repo: a.repo, via: 'phone' });
    changed();
    return a;
  }
  async function hire(repo: string, task: string) {
    const a = await api.startAgent(repo, task);
    ctx.agents.set(a.id, a);
    track('agent_started', { repo, via: 'phone' });
    tick();
    changed();
    return a;
  }

  /** A small in-phone banner for results of taps. */
  function toastIn(text: string) {
    bannerIn.innerHTML = `<div class="pn-app">${ICON.gear}<span>AGENTS</span><time>now</time></div><p>${esc(text)}</p>`;
    bannerIn.onclick = () => bannerIn.classList.remove('show');
    bannerIn.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => bannerIn.classList.remove('show'), 4000);
  }

  // ---- Hire: pick a project, describe the task ----
  let hireFrom: 'home' | 'agents' | 'team' = 'home';
  let hireQuery = '';
  let hiring = false;
  function renderHire(fresh: boolean) {
    const v = view as Extract<View, { app: 'hire' }>;
    const picked = v.repo ? ctx.repos.find((r) => r.name === v.repo) : undefined;
    viewEl.innerHTML = `${header('Hire an agent', picked ? `in ${esc(picked.name)}` : 'Pick a project')}
      <div class="pv-scroll hire">
        ${picked ? `<button class="hire-picked" data-repick>${leadAvatar(picked, picked.name)}<div><b>${esc(picked.name)}</b><small>${esc(picked.description || TIER[picked.tier])}</small></div><span>Change</span></button>`
          : `<div class="maps-search"><input data-keep="hire-q" placeholder="Search projects" autocomplete="off" value="${esc(hireQuery)}" /></div><div class="hire-list"></div>`}
        <label class="hire-task"><span>Task</span><textarea data-keep="hire-task" placeholder="e.g. Add tests for the date parser. Don't open a PR." ${picked ? '' : 'disabled'}></textarea></label>
        <p class="hire-note">The agent works in its own copy of the repo. Nothing is pushed and no PR is opened until you tap Open PR.</p>
        <button class="pbtn hire-go" data-go-hire ${picked && !hiring ? '' : 'disabled'}>${hiring ? 'Hiring…' : 'Hire'}</button>
      </div>`;
    bindCommon();
    const task = viewEl.querySelector<HTMLTextAreaElement>('textarea')!;
    const goBtn = viewEl.querySelector<HTMLButtonElement>('[data-go-hire]')!;
    viewEl.querySelector('[data-repick]')?.addEventListener('click', () => go({ app: 'hire' }));
    const list = viewEl.querySelector<HTMLElement>('.hire-list');
    const q = viewEl.querySelector<HTMLInputElement>('[data-keep="hire-q"]');
    if (list && q) {
      const busy = liveByRepo();
      const draw = () => {
        hireQuery = q.value;
        const s = q.value.toLowerCase();
        const rows = [...ctx.repos].sort((a, b) => b.score - a.score).filter((r) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s)).slice(0, 40);
        list.innerHTML = rows.map((r) => `<button class="lead-row" data-pick="${esc(r.name)}">${leadAvatar(r, r.name)}<div><div class="mi-row"><b>${esc(r.name)}</b></div><span class="mi-subj">${TIER[r.tier]}${busy.get(r.name) ? ` · <span class="good">${busy.get(r.name)} working</span>` : ''}</span><p>${esc(r.description || '')}</p></div></button>`).join('')
          || '<div class="msg-empty"><b>No projects</b><p>Connect GitHub to hire agents.</p></div>';
        list.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => go({ app: 'hire', repo: b.dataset.pick })));
      };
      q.addEventListener('input', draw);
      draw();
      if (fresh) setTimeout(() => q.focus(), 30);
    } else if (fresh) setTimeout(() => task.focus(), 30);
    const submit = async () => {
      const text = task.value.trim();
      if (!picked || !text || hiring) { task.focus(); return; }
      hiring = true;
      goBtn.disabled = true;
      goBtn.textContent = 'Hiring…';
      try {
        const a = await hire(picked.name, text);
        hiring = false;
        go({ app: 'agents', open: a.id });
      } catch (e) {
        hiring = false;
        goBtn.disabled = false;
        goBtn.textContent = 'Hire';
        toastIn(`Couldn't hire: ${(e as Error).message}`);
      }
    };
    goBtn.addEventListener('click', () => void submit());
    // One step: type the task, press Enter (Shift+Enter for a new line).
    task.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } });
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
      for (const r of m.delegated ?? []) html += `<button class="msg-sys handoff" data-lead="${esc(r)}">Handed to the <b>${esc(r)}</b> lead ›</button>`;
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
    viewEl.querySelectorAll<HTMLElement>('[data-lead]').forEach((b) => b.addEventListener('click', () => go({ app: 'team', open: b.dataset.lead })));
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
          changed();
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

  async function sendLead(repo: string, text: string) {
    leadSending.add(repo);
    leadDraft.set(repo, '');
    if (!leadMsgs.has(repo)) await loadLead(repo).catch(() => leadMsgs.set(repo, []));
    refresh();
    const fail = (err: string) => upsertLead(repo, { id: `err-${Date.now()}`, repo, from: 'master', text: `(Couldn't reach the ${repo} lead: ${err})`, ts: new Date().toISOString(), read: true });
    try {
      await masters.send(repo, text, (d) => {
        if (d.type === 'me' && d.message) { upsertLead(repo, d.message); changed(); refresh(); }
        else if (d.type === 'delta' && d.delta) {
          leadDraft.set(repo, (leadDraft.get(repo) ?? '') + d.delta);
          changed();
          const el = viewEl.querySelector<HTMLElement>('.bubble.streaming');
          if (el && view.app === 'team' && view.open === repo) {
            el.innerHTML = fmt(leadDraft.get(repo)!);
            const s = viewEl.querySelector<HTMLElement>('.pv-scroll');
            if (s) s.scrollTop = s.scrollHeight;
          } else if (isOpen) refresh();
        } else if (d.type === 'message' && d.message) {
          leadDraft.delete(repo);
          upsertLead(repo, { ...d.message, read: true });
        } else if (d.type === 'error') fail(d.error ?? 'unknown error');
      });
    } catch (e) {
      fail((e as Error).message);
    }
    leadSending.delete(repo);
    leadDraft.delete(repo);
    updateBadge();
    if (isOpen) refresh();
  }

  // ---- Projects (each repo's lead agent) ----
  let teamQuery = '';
  function leadOrder(): Repo[] {
    const busy = liveByRepo();
    return [...ctx.repos].sort((a, b) =>
      (leadSummary.get(b.name)?.last?.ts ?? '').localeCompare(leadSummary.get(a.name)?.last?.ts ?? '')
      || (busy.get(b.name) ?? 0) - (busy.get(a.name) ?? 0)
      || b.score - a.score);
  }
  function liveByRepo() {
    const busy = new Map<string, number>();
    for (const a of ctx.agents.values()) if (LIVE.has(a.status)) busy.set(a.repo, (busy.get(a.repo) ?? 0) + 1);
    return busy;
  }
  const leadAvatar = (r: Repo | undefined, name: string) => r?.hasLogo
    ? `<span class="lead-av" style="background:${esc(r.brandColor)}"><img src="/api/repos/${encodeURIComponent(name)}/logo" alt="" /></span>`
    : `<span class="lead-av" style="background:${esc(r?.brandColor || '#7a3dff')}">${esc(name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?')}</span>`;

  function renderTeam(fresh: boolean) {
    const v = view as Extract<View, { app: 'team' }>;
    if (v.open) return renderLead(v.open, fresh);
    const busy = liveByRepo();
    viewEl.innerHTML = `${header('Projects', `${ctx.repos.length} leads · text any of them, anywhere`)}
      <div class="maps-search"><input data-keep="team" placeholder="Search projects" autocomplete="off" value="${esc(teamQuery)}" /></div>
      <div class="pv-scroll lead-list"></div>`;
    bindCommon();
    const list = viewEl.querySelector<HTMLElement>('.lead-list')!;
    const q = viewEl.querySelector<HTMLInputElement>('input')!;
    const draw = () => {
      teamQuery = q.value;
      const s = q.value.toLowerCase();
      const rows = leadOrder().filter((r) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s));
      list.innerHTML = rows.length ? rows.map((r) => {
        const t = leadSummary.get(r.name);
        const n = busy.get(r.name) ?? 0;
        const preview = leadTyping.has(r.name) ? '<span class="good">typing…</span>'
          : t?.last ? esc(`${t.last.from === 'me' ? 'You: ' : t.last.from === 'hq' ? 'HQ: ' : ''}${t.last.text.replace(/\s+/g, ' ')}`.slice(0, 110))
          : esc(r.description || 'Text the lead about this project.');
        return `<button class="lead-row ${t?.unread ? 'unread' : ''}" data-repo="${esc(r.name)}">
          ${leadAvatar(r, r.name)}
          <div><div class="mi-row"><b>${esc(r.name)}</b><time>${t?.last ? esc(shortTime(t.last.ts)) : ''}</time></div>
          <span class="mi-subj">Lead${n ? ` · <span class="good">${n} working</span>` : ''}</span>
          <p>${preview}</p></div>${t?.unread ? `<i class="lead-badge">${t.unread}</i>` : ''}</button>`;
      }).join('') : '<div class="msg-empty"><b>No projects</b><p>Connect GitHub to meet your project leads.</p></div>';
      list.querySelectorAll<HTMLElement>('[data-repo]').forEach((b) => b.addEventListener('click', () => go({ app: 'team', open: b.dataset.repo })));
    };
    q.addEventListener('input', draw);
    draw();
    if (fresh && !leadSummary.size) masters.list().then((t) => { for (const x of t.threads) leadSummary.set(x.repo, x); if (view.app === 'team' && !view.open) draw(); }).catch(() => {});
  }

  function renderLead(repo: string, fresh: boolean) {
    const r = ctx.repos.find((x) => x.name === repo);
    const list = leadMsgs.get(repo);
    if (!list) {
      viewEl.innerHTML = `${header(esc(repo), 'Project lead')}<div class="pv-scroll msgs"><div class="msg-empty"><small>Loading…</small></div></div>`;
      bindCommon();
      loadLead(repo).then(() => { if (view.app === 'team' && view.open === repo) render(); }).catch(() => {
        leadMsgs.set(repo, []);
        if (view.app === 'team' && view.open === repo) render();
      });
      return;
    }
    markLeadSeen(repo);
    const n = liveByRepo().get(repo) ?? 0;
    const here = hooks.sites().some((s) => s.repo.name === repo);
    let html = header(esc(repo), n ? `Lead · ${n} agent${n === 1 ? '' : 's'} working` : 'Project lead',
      `<button class="pv-icon" data-hire title="Hire an agent here">${ICON.plus}</button>${here ? `<button class="pv-icon" data-go-building title="Go to the building">${ICON.map}</button>` : ''}`);
    html += `<div class="pv-scroll msgs">`;
    if (!list.length) {
      html += `<div class="msg-empty">${leadAvatar(r, repo).replace('lead-av', 'lead-av big')}<b>${esc(repo)} lead</b><p>The master agent for this project. It knows the code, the recent PRs and who's working in the building, and can send agents in. Text it from anywhere.</p></div>`;
    }
    let lastDay = '';
    for (const m of list) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDay) { html += `<div class="msg-day">${dayLabel(m.ts)}</div>`; lastDay = day; }
      const report = m.refs?.find((x) => x.action === 'report');
      if (report) html += `<div class="msg-sys">${esc(agentName(report.agentId))} reported back</div>`;
      if (m.from === 'hq') html += `<div class="msg-sys">HQ handed this over</div><div class="bubble delegated" title="${esc(clock(m.ts))}">${fmt(m.text.split('\n\n(The boss asked HQ')[0])}</div>`;
      else html += `<div class="bubble ${m.from === 'me' ? 'me' : 'hq'}" title="${esc(clock(m.ts))}">${fmt(m.text)}</div>`;
      for (const d of m.dispatched ?? []) html += dispatchCard(d.agentId, d.agentName, d.repo, d.task);
    }
    const draft = leadDraft.get(repo);
    if (draft) html += `<div class="bubble hq streaming">${fmt(draft)}</div>`;
    else if (leadTyping.has(repo) || leadSending.has(repo)) html += `<div class="bubble hq typing"><i></i><i></i><i></i></div>`;
    html += `</div>`;
    if (!list.length) html += `<div class="msg-suggest">${LEAD_SUGGESTIONS.map((x) => `<button>${esc(x)}</button>`).join('')}</div>`;
    html += `<form class="composer"><input data-keep="lead-${esc(repo)}" placeholder="Text the ${esc(repo)} lead" autocomplete="off" /><button class="send" ${leadSending.has(repo) ? 'disabled' : ''}>${ICON.up}</button></form>`;
    viewEl.innerHTML = html;
    bindCommon();
    bindDispatchCards();
    viewEl.querySelector('[data-go-building]')?.addEventListener('click', () => { close(); void hooks.travelTo(repo); });
    viewEl.querySelector('[data-hire]')!.addEventListener('click', () => { hireFrom = 'team'; go({ app: 'hire', repo }); });
    const form = viewEl.querySelector('form')!;
    const input = form.querySelector('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || leadSending.has(repo)) return;
      input.value = '';
      void sendLead(repo, text);
    });
    viewEl.querySelectorAll<HTMLButtonElement>('.msg-suggest button').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent ?? ''; input.focus(); }));
    const s = viewEl.querySelector<HTMLElement>('.pv-scroll')!;
    s.scrollTop = s.scrollHeight;
    if (fresh) setTimeout(() => input.focus(), 30);
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

  // ---- Review: everything waiting on you (questions, then finished work) ----
  function renderReview() {
    const list = inbox();
    let html = header('Review', list.length ? `${list.length} waiting on you` : 'All caught up');
    html += `<div class="pv-scroll review-inbox">`;
    if (!list.length) html += `<div class="msg-empty"><b>Nothing to review</b><p>When an agent finishes, its work lands here and in the lobby of its building. Agents with a question will call you.</p></div>`;
    for (const a of list) {
      const asking = needsInput(a);
      html += `<button class="lead-row rv-row-item" data-review="${esc(a.id)}">
        <span class="ar-av ${a.status}">${esc(initials(a.name))}</span>
        <div><div class="mi-row"><b>${esc(a.name)}</b><em class="chip ${asking ? 'needs_input' : 'done'}">${asking ? 'Question' : 'Review'}</em></div>
        <span class="mi-subj">${esc(a.repo)}${a.diffStat ? ` · ${esc(a.diffStat)}` : ''}</span>
        <p>${esc((asking ? a.question ?? '' : a.summary || a.task.split('\n')[0]).slice(0, 140))}</p></div></button>`;
    }
    html += `</div>`;
    viewEl.innerHTML = html;
    bindCommon();
    viewEl.querySelectorAll<HTMLElement>('[data-review]').forEach((b) => b.addEventListener('click', () => {
      track('phone_review', { agent: b.dataset.review });
      openReview(b.dataset.review!);
    }));
  }

  // ---- Agents ----
  let logEl: HTMLElement | null = null;
  function renderAgents() {
    const v = view as Extract<View, { app: 'agents' }>;
    const all = sortedAgents();
    const a = v.open ? ctx.agents.get(v.open) : undefined;
    if (a) return renderAgent(a);
    const live = all.filter((x) => LIVE.has(x.status)).length;
    let html = header('Agents', `${live} working · ${all.length} total`, `<button class="pv-icon" data-hire title="Hire an agent">${ICON.plus}</button>`);
    html += `<div class="pv-scroll agent-list">`;
    if (!all.length) html += `<div class="msg-empty"><b>No agents yet</b><p>Tap + to hire one in any project, or text HQ a task.</p></div>`;
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
    viewEl.querySelector('[data-hire]')!.addEventListener('click', () => { hireFrom = 'agents'; go({ app: 'hire' }); });
  }

  function renderAgent(a: AgentInfo) {
    const working = LIVE.has(a.status);
    viewEl.innerHTML = `${header(esc(a.name), esc(a.repo))}
      <div class="pv-scroll agent-detail">
        <div class="ad-card">
          <div class="mi-row"><em class="chip ${a.status}">${STATUS_LABEL[a.status]}</em><time>${esc(since(a.startedAt, a.endedAt))}</time></div>
          <p class="ad-task">${fmt(a.task.split('\n\n(Dispatched by HQ')[0])}</p>
          ${needsInput(a) ? `<p class="ac-ask"><b>Asks:</b> ${esc(a.question ?? '')}</p>` : ''}
          <dl>
            <dt>Doing</dt><dd>${esc(a.lastAction)}</dd>
            <dt>Files</dt><dd>${a.filesChanged.length ? a.filesChanged.slice(0, 8).map((f) => `<code>${esc(f)}</code>`).join(' ') : 'none yet'}</dd>
            <dt>Branch</dt><dd><code>${esc(a.branch)}</code></dd>
            ${a.costUsd != null ? `<dt>Cost</dt><dd>$${a.costUsd.toFixed(2)}</dd>` : ''}
            ${a.prUrl ? `<dt>PR</dt><dd><a href="${esc(a.prUrl)}" target="_blank" rel="noopener">${esc(a.prUrl.replace(/^https:\/\/github.com\//, ''))}</a></dd>` : ''}
          </dl>
        </div>
        <div class="ad-actions">
          <button class="pbtn" data-go="${esc(a.repo)}">Go to building</button>
          <button class="pbtn ghost" data-wp>Waypoint</button>
          ${working ? `<button class="pbtn danger" data-stop="${esc(a.id)}">Stop</button>` : ''}
          ${needsReview(a) ? `<button class="pbtn" data-review="${esc(a.id)}">Review changes</button>` : ''}
          ${needsInput(a) ? `<button class="pbtn" data-review="${esc(a.id)}">Answer</button>` : ''}
        </div>
        <h5>Live log</h5>
        <div class="ad-log"><small>Loading…</small></div>
      </div>`;
    bindCommon();
    viewEl.querySelector('[data-wp]')!.addEventListener('click', () => { hooks.setWaypoint(a.repo); close(); });
    bindAgentCards();
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
  // ---------------------------------------------------------------- Today (the briefing) & Schedules
  let schedulesBack: (() => boolean) | null = null;
  let schedulesOff: (() => void) | null = null;
  function renderToday() {
    const b = currentBriefing();
    viewEl.innerHTML = `${header('Today', 'While you were away', `<button class="pbtn sm ghost" data-sched>Schedules</button>`)}
      <div class="pv-scroll"><div class="bf">${b ? briefingHtml(b) : '<p class="bf-since">Loading…</p>'}</div></div>`;
    bindCommon();
    viewEl.querySelector('[data-sched]')!.addEventListener('click', () => go({ app: 'schedules' }));
    if (b) bindBriefing(viewEl, {
      travelTo: (repo) => { close(); void hooks.travelTo(repo); },
      openAgent: (id) => go({ app: 'agents', open: id }),
    });
  }
  function renderSchedules() {
    schedulesOff?.();
    schedulesOff = renderSchedulesApp(viewEl, {
      header: (t, sub) => header(esc(t), sub ? esc(sub) : ''),
      bindCommon,
      repos: () => ctx.repos.map((r) => r.name),
      setBackHandler: (fn) => { schedulesBack = fn; },
    }, { repo: view.app === 'schedules' ? view.repo : undefined });
  }
  // The briefing changes as agents finish and schedules run: keep Today and the home widget current.
  loadBriefing().then(() => { if (isOpen && (view.app === 'home' || view.app === 'today')) refresh(); }).catch(() => {});
  onLive((msg) => {
    if (msg.type !== 'agent:update' && msg.type !== 'pulse:update' && msg.type !== 'schedule:update') return;
    setTimeout(() => { if (isOpen && (view.app === 'home' || view.app === 'today')) refresh(); }, 2200);
  });

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
      const home = hooks.home && (!s || `home ${hooks.home.address}`.toLowerCase().includes(s)) ? `<div class="map-row">
          <span class="mr-pin" style="background:#3ddc97"></span>
          <div><b>Home</b><small>${esc(hooks.home.address)}</small></div>
          <button class="pbtn ghost sm" data-home="pin">Pin</button><button class="pbtn sm" data-home="go">Go</button></div>` : '';
      list.innerHTML = home + sites
        .filter(({ repo: r }) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s))
        .map(({ repo: r }) => `<div class="map-row">
          <span class="mr-pin" style="background:${esc(r.brandColor)}"></span>
          <div><b>${esc(r.name)}</b><small>${TIER[r.tier]}${busy.get(r.name) ? ` · <span class="good">${busy.get(r.name)} working</span>` : ''}</small></div>
          <button class="pbtn ghost sm" data-wp="${esc(r.name)}">Pin</button><button class="pbtn sm" data-go="${esc(r.name)}">Go</button></div>`).join('');
      list.querySelector<HTMLElement>('[data-home=pin]')?.addEventListener('click', () => { hooks.home!.pin(); close(); });
      list.querySelector<HTMLElement>('[data-home=go]')?.addEventListener('click', () => { close(); void hooks.home!.go(); });
      list.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => b.addEventListener('click', () => { hooks.setWaypoint(b.dataset.wp!); close(); }));
      list.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { close(); void hooks.travelTo(b.dataset.go!); }));
    };
    q.addEventListener('input', draw);
    draw();
  }

  // ---------------------------------------------------------------- state API (VR wrist phone etc.)
  function threads(): PhoneThread[] {
    const hqText = messages.filter((m) => m.channel === 'text');
    const lastHq = hqText[hqText.length - 1];
    const hqDraft = drafts.text;
    const live = liveByRepo();
    const out: PhoneThread[] = [{
      id: 'hq', title: 'HQ', subtitle: 'The Office', unread: unread('text'),
      typing: typing.text || sending.text,
      last: hqDraft ? { from: 'them', text: hqDraft, ts: new Date().toISOString() } : lastHq ? { from: lastHq.from === 'me' ? 'me' : 'them', text: lastHq.text, ts: lastHq.ts } : null,
    }];
    for (const r of leadOrder()) {
      const t = leadSummary.get(r.name);
      const n = live.get(r.name) ?? 0;
      out.push({
        id: `repo:${r.name}`, title: r.name, subtitle: n ? `Lead · ${n} working` : 'Project lead',
        unread: t?.unread ?? 0, typing: leadTyping.has(r.name) || leadSending.has(r.name),
        last: t?.last ? { from: t.last.from === 'master' ? 'them' : t.last.from, text: t.last.text, ts: t.last.ts } : null,
      });
    }
    return out;
  }

  async function threadMessages(id: string): Promise<PhoneMessage[]> {
    if (id === 'hq') {
      const list: PhoneMessage[] = messages.filter((m) => m.channel === 'text').map((m) => ({ id: m.id, from: m.from === 'me' ? 'me' : 'them', text: m.text, ts: m.ts }));
      if (drafts.text) list.push({ id: 'draft', from: 'them', text: drafts.text, ts: new Date().toISOString(), streaming: true });
      return list;
    }
    const repo = id.replace(/^repo:/, '');
    const raw = leadMsgs.get(repo) ?? await loadLead(repo);
    const list: PhoneMessage[] = raw.map((m) => ({ id: m.id, from: m.from === 'master' ? 'them' : m.from, text: m.text, ts: m.ts }));
    const d = leadDraft.get(repo);
    if (d) list.push({ id: 'draft', from: 'them', text: d, ts: new Date().toISOString(), streaming: true });
    return list;
  }

  // Agents with a question call you, wherever you are.
  installRing(ctx, { onChange: () => { changed(); if (isOpen) refresh(); } });

  updateBadge();
  return {
    open, openThread, close, toggle, isOpen: () => isOpen, app: () => (isOpen ? view.app : null),
    threads,
    messages: threadMessages,
    send: (id, text) => (id === 'hq' ? send('text', text) : sendLead(id.replace(/^repo:/, ''), text)),
    markRead: (id) => (id === 'hq' ? markSeen('text') : markLeadSeen(id.replace(/^repo:/, ''))),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    agents: sortedAgents,
    hire,
    stopAgent,
    openPr,
  };

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
function initials(name: string) {
  return name.replace(/^Agent\s+/, '').slice(0, 2);
}
function since(start: string, end: string | null) {
  const s = Math.max(0, ((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000);
  const dur = s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
  return end ? `took ${dur}` : `${dur} so far`;
}

const svg = (d: string, fill = false) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const ICON = {
  check: svg('<path d="M4 12.5l5 5L20 6.5"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10.5 18.5h3"/>'),
  messages: svg('<path d="M12 3C6.5 3 2 6.7 2 11.2c0 2.6 1.5 4.9 3.8 6.4L5 21l4-2.2c1 .3 2 .4 3 .4 5.5 0 10-3.7 10-8.2S17.5 3 12 3z"/>', true),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  team: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  map: svg('<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  left: svg('<path d="M15 18l-6-6 6-6"/>'),
  compose: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  reply: svg('<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  signal: svg('<rect x="2" y="15" width="3" height="5" rx="1"/><rect x="7.5" y="11" width="3" height="9" rx="1"/><rect x="13" y="7" width="3" height="13" rx="1"/><rect x="18.5" y="3" width="3" height="17" rx="1"/>', true),
  battery: '<svg viewBox="0 0 28 14"><rect x="1" y="1" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".45"/><rect x="3" y="3" width="17" height="8" rx="2" fill="currentColor"/><rect x="25.5" y="5" width="1.8" height="4" rx=".9" fill="currentColor" fill-opacity=".45"/></svg>',
};
