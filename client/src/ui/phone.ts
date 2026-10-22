import type { AgentEvent, AgentInfo, MasterMessage, MasterThreadSummary, OfficeChannel, OfficeMessage, Repo } from '../../../shared/types.ts';
import { api, office, masters, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { kbd, keymap } from '../keymap.ts';
import { openReview } from './review.ts';
import { installRing } from './ring.ts';
import { currentBriefing, loadBriefing, openBriefingPanel } from './briefing.ts';
import { onSchedules } from './schedules.ts';
import { ago, renderProject, projectStatusHtml, type ProjectDeps, type ProjectView } from './phoneProject.ts';
import { pulse } from '../pulse.ts';
import { agentPicker, pickedAgent } from './agentPick.ts';
import type { GameCtx } from '../ctx.ts';

/** Alt frees the cursor while held (input.ts); Macs call it Option. */
const ALT_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥ Option' : 'Alt';

/** What the phone needs from the game world (main.ts provides these). */
export interface PhoneHooks {
  /** Every project building in the current place. */
  sites(): { repo: Repo }[];
  setWaypoint(repoName: string): void;
  /** Teleport to the street outside a project's front door, facing it. */
  travelTo(repoName: string): void | Promise<void>;
  /** Teleport there and walk straight in. */
  enter?(repoName: string): void | Promise<void>;
  /** e.g. "Midtown Manhattan, New York City" — shown in Travel. */
  placeName?(): string;
  /** Your apartment: Travel's first row, reachable from anywhere. */
  home?: { address: string; go(): void | Promise<void>; pin(): void; enter?(): void | Promise<void> };
  /** The project whose building you're in (or last walked into), to preselect it for new tasks. */
  currentRepo?(): string | null;
  /** Opens the game's settings, if there is a settings screen. */
  openSettings?(): void;
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
  /** Open on a tab ('home' | 'projects' | 'chat' | 'map'); older app names still work. */
  open(app?: string): void;
  /** Open one project lead's thread. */
  openThread(repo: string): void;
  /** Open a project's control page. */
  openProject(repo: string): void;
  /** Open one agent's live log. */
  openAgent(id: string): void;
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

/** Four tabs; everything else is a screen pushed on top of one. */
type Tab = 'home' | 'projects' | 'chat' | 'map';
type View =
  | { app: 'home' }
  | { app: 'projects' }
  | ProjectView
  | { app: 'agent'; id: string }
  | { app: 'chat' }
  | { app: 'thread'; id: string } // 'hq' or a repo name (its lead)
  | { app: 'mail'; open?: string; compose?: boolean }
  | { app: 'map' };
const TAB_OF: Record<View['app'], Tab> = { home: 'home', projects: 'projects', project: 'projects', agent: 'home', chat: 'chat', thread: 'chat', mail: 'chat', map: 'map' };
/** Session restore and older callers used app names from before the four tabs. */
const LEGACY: Record<string, View> = {
  messages: { app: 'thread', id: 'hq' }, team: { app: 'projects' }, agents: { app: 'home' }, review: { app: 'home' },
  today: { app: 'home' }, hire: { app: 'home' }, schedules: { app: 'projects' }, maps: { app: 'map' },
};

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
  // Docked on the left edge: a labelled "Phone" tab when minimized, a phone that slides out when opened.
  const btn = document.createElement('button');
  btn.id = 'phone-tab';
  btn.title = 'Open your phone (P): agents, projects, chat, and teleport to work';
  btn.setAttribute('aria-label', 'Open phone');
  btn.innerHTML = `<span class="pt-grip"></span>${ICON.phone}<span class="pt-word">Phone</span><span class="phone-badge hidden"></span>
    <span class="pt-live hidden"><i></i><b>0</b></span>${kbd('phone')}`;
  document.body.appendChild(btn);
  keymap.onChange(() => { btn.querySelector('kbd')!.textContent = keymap.label('phone'); });
  const liveEl = btn.querySelector<HTMLSpanElement>('.pt-live')!;

  const root = document.createElement('div');
  root.id = 'phone';
  root.className = 'phone';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <button class="phone-stow" title="Minimize the phone (P or Esc). It stays on the left edge." aria-label="Minimize phone">${ICON.left}<span>Minimize</span></button>
    <div class="phone-frame">
      <i class="pf-key pf-key-a"></i><i class="pf-key pf-key-b"></i>
      <div class="pf-top"><i class="pf-lens"></i><i class="pf-grille"></i><i class="pf-led"></i></div>
      <div class="phone-screen">
        <div class="phone-status"><span class="ps-time"></span><span class="ps-right"><b>OW</b>${ICON.signal}${ICON.battery}</span></div>
        <div class="phone-banner"></div>
        <div class="phone-view"></div>
        <nav class="phone-tabs"></nav>
      </div>
      <div class="pf-chin"><button class="phone-homebar" title="Home" aria-label="Home"><span>OW</span></button></div>
    </div>
    <div class="phone-lockhint" aria-hidden="true">Hold <kbd>${ALT_KEY}</kbd> or press ${kbd('phone')} to use your phone</div>`;
  document.body.appendChild(root);
  const viewEl = root.querySelector<HTMLDivElement>('.phone-view')!;
  const timeEl = root.querySelector<HTMLSpanElement>('.ps-time')!;
  const bannerIn = root.querySelector<HTMLDivElement>('.phone-banner')!;
  const badge = btn.querySelector<HTMLSpanElement>('.phone-badge')!;
  const tabsEl = root.querySelector<HTMLElement>('.phone-tabs')!;

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
    if (keymap.translate(e.code) === 'KeyP' && !typingInField && !e.repeat && !e.metaKey && !e.ctrlKey) {
      // Don't open over the title / loading screens.
      if (document.getElementById('hud')?.classList.contains('hidden')) return;
      e.preventDefault();
      // Open while you're looking around with the mouse: P hands you the cursor for the phone (it doesn't
      // put it away). Pressed again with the cursor free, it minimizes.
      if (isOpen && document.pointerLockElement) { document.exitPointerLock(); return; }
      toggle();
    }
  });

  /** Home's greeting follows the game clock, like the status bar. */
  const greeting = () => {
    const hour = ctx.dayNight?.hour ?? new Date().getHours();
    return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  };

  // Status bar clock follows the game's day/night clock; the tab shows how many agents are working.
  const tick = () => {
    const hello = viewEl.querySelector('[data-hello]');
    if (hello && hello.textContent !== greeting()) hello.textContent = greeting();
    timeEl.textContent = (ctx.dayNight?.label() ?? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })).replace(/\s?[AP]M$/, '');
    const live = [...ctx.agents.values()].filter((a) => LIVE.has(a.status)).length;
    liveEl.classList.toggle('hidden', live === 0);
    liveEl.querySelector('b')!.textContent = String(live);
    btn.title = `Open your phone (P)${live ? ` · ${live} agent${live === 1 ? '' : 's'} working` : ': agents, projects, chat, and teleport to work'}`;
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
      const viewing = isOpen && (view.app === 'thread' && view.id === 'hq' ? msg.message.channel === 'text' : view.app === 'mail' && msg.message.channel === 'email');
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
      const viewing = isOpen && view.app === 'thread' && view.id === msg.repo;
      if (m.from === 'master' && viewing) markLeadSeen(msg.repo);
      if (m.from === 'master' && !known && !viewing && !m.read) notifyLead(msg.repo, m);
      updateBadge();
      if (isOpen && view.app !== 'agent') refresh();
    } else if (msg.type === 'master:typing') {
      if (msg.on) leadTyping.add(msg.repo); else leadTyping.delete(msg.repo);
      changed();
      if (isOpen && (view.app === 'thread' || view.app === 'chat')) refresh();
    } else if (msg.type === 'agent:update') {
      ctx.agents.set(msg.agent.id, msg.agent);
      tick();
      changed();
      if (isOpen && view.app !== 'mail' && !(view.app === 'project' && view.sub)) refresh();
    } else if (msg.type === 'agent:event') {
      if (isOpen && view.app === 'agent' && view.id === msg.agentId) appendLog(msg.event, msg.ts);
    }
  });

  // ---------------------------------------------------------------- open / minimize
  // The phone doesn't pause the game: keys still drive the robot (except while typing in a field), it
  // only frees the mouse so you can tap. Click the world to look around again; the phone stays out.
  // It stays out until you minimize it (P, Esc or the Minimize handle), and remembers which you chose.
  function open(app?: string, quiet = false) {
    if (!isOpen) {
      isOpen = true;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      btn.classList.add('active');
      document.body.classList.add('phone-docked');
      if (!quiet && document.pointerLockElement) document.exitPointerLock();
      if (!quiet) { rememberDock('open'); track('phone_opened', { app: app ?? view.app }); }
    }
    const target: View | undefined = !app ? undefined : LEGACY[app] ?? (app in TAB_OF ? ({ app } as View) : undefined);
    if (target && (target.app !== view.app || target.app === 'home')) tab(target);
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
    rememberDock('min');
  }
  function toggle() { if (isOpen) close(); else open(); }

  // Screens stack within a tab: back pops, switching tabs starts over.
  const stack: View[] = [];
  let subBack: (() => boolean) | null = null;
  function go(v: View) {
    if (v.app !== view.app && v.app !== 'home') track('phone_app', { app: v.app });
    if (TAB_OF[v.app] === TAB_OF[view.app] && JSON.stringify(v) !== JSON.stringify(view)) stack.push(view);
    else if (TAB_OF[v.app] !== TAB_OF[view.app]) stack.length = 0;
    subBack = null;
    view = v;
    render();
  }
  function tab(v: View) {
    stack.length = 0;
    subBack = null;
    if (v.app !== view.app) track('phone_app', { app: v.app });
    view = v;
    render();
  }
  function back() {
    if (subBack?.()) return;
    const prev = stack.pop();
    subBack = null;
    view = prev ?? { app: TAB_OF[view.app] } as View;
    if (view.app === 'project' && !prev) view = { app: 'projects' };
    render();
  }

  function openThread(repo: string) {
    open();
    tab({ app: 'chat' });
    go({ app: 'thread', id: repo });
  }
  function openProject(repo: string) {
    open();
    tab({ app: 'projects' });
    go({ app: 'project', repo });
  }
  function openAgent(id: string) {
    open();
    tab({ app: 'home' });
    go({ app: 'agent', id });
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
    const app = m.channel === 'email' ? 'mail' : 'messages';
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
    const fields = [...viewEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-keep]')].map((f) => ({ key: f.dataset.keep!, value: f.value, focused: document.activeElement === f }));
    const sel = viewEl.querySelector<HTMLSelectElement>('select[data-keep-sel]');
    const selValue = sel?.value;
    const scroller = viewEl.querySelector<HTMLElement>('.pv-scroll');
    const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const prevTop = scroller?.scrollTop ?? 0;
    render(false);
    for (const k of fields) {
      const f = viewEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-keep="${k.key}"]`);
      if (f) { f.value = k.value; if (k.focused) f.focus(); }
    }
    const sel2 = viewEl.querySelector<HTMLSelectElement>('select[data-keep-sel]');
    if (sel2 && selValue) sel2.value = selValue;
    const s = viewEl.querySelector<HTMLElement>('.pv-scroll');
    const chat = view.app === 'thread';
    if (s) s.scrollTop = atBottom && chat ? s.scrollHeight : prevTop;
  }

  function render(fresh = true) {
    viewEl.className = `phone-view app-${view.app}`;
    if (view.app === 'home') renderHome(fresh);
    else if (view.app === 'projects') renderProjects(fresh);
    else if (view.app === 'project') renderProject(projectDeps, view, fresh);
    else if (view.app === 'agent') { const a = ctx.agents.get(view.id); if (a) renderAgent(a); else back(); }
    else if (view.app === 'chat') renderChats(fresh);
    else if (view.app === 'thread') { if (view.id === 'hq') renderMessages(fresh); else renderLead(view.id, fresh); }
    else if (view.app === 'mail') renderMail();
    else renderMaps();
    renderTabs();
  }

  const header = (title: string, sub = '', right = '') => `
    <div class="pv-head"><button class="pv-back" data-back>‹</button><div class="pv-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div><div class="pv-right">${right}</div></div>`;
  /** Top of a tab's first screen: a big title instead of a back button. */
  const tabHeader = (title: string, right = '') => `<div class="pv-tabhead"><h3>${title}</h3><div class="pv-right">${right}</div></div>`;

  function bindCommon() {
    viewEl.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', back));
  }

  // ---- Tab bar ----
  const TABS: { id: Tab; name: string; icon: string }[] = [
    { id: 'home', name: 'Home', icon: ICON.home },
    { id: 'projects', name: 'Projects', icon: ICON.grid },
    { id: 'chat', name: 'Chat', icon: ICON.messages },
    { id: 'map', name: 'Travel', icon: ICON.pin },
  ];
  function renderTabs() {
    const cur = TAB_OF[view.app];
    const badgeOf = (t: Tab) => t === 'home' ? inbox().length : t === 'chat' ? unread() + leadUnread() : 0;
    tabsEl.innerHTML = TABS.map((t) => { const n = badgeOf(t.id); return `<button class="${t.id === cur ? 'on' : ''}" data-tab="${t.id}">${t.icon}<span>${t.name}</span>${n ? `<i>${n}</i>` : ''}</button>`; }).join('');
    tabsEl.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => tab({ app: b.dataset.tab as Tab } as View)));
  }

  /** Finished with changes and no PR yet: waiting on the user at the review station. */
  const needsReview = (a: AgentInfo) => a.review === 'pending' || (a.review == null && a.status === 'done' && a.filesChanged.length > 0 && !a.prUrl);
  const needsInput = (a: AgentInfo) => a.status === 'needs_input';
  /** Everything waiting on you: questions first, then finished work to review. */
  const inbox = () => sortedAgents().filter((a) => needsInput(a) || needsReview(a)).sort((a, b) => Number(needsInput(b)) - Number(needsInput(a)));

  // ---- Home: what needs you, a task box, what's happening ----
  let taskRepo = '';
  function renderHome(fresh: boolean) {
    const agents = sortedAgents();
    const live = agents.filter((a) => LIVE.has(a.status));
    const waitingOnYou = inbox();
    // Red CI on a project nobody has touched in a month isn't news; on an active one it is.
    const red = pulse.all().filter((p) => p.ci === 'failing' && !p.stale).sort((a, b) => (b.ciSince ?? '').localeCompare(a.ciSince ?? ''));
    const agentPrs = pulse.all().flatMap((p) => p.openPrs.filter((x) => x.isAgent && !x.isDraft).map((x) => ({ ...x, repo: p.repo }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const today = currentBriefing();
    const repos = projectOrder();
    const here = hooks.currentRepo?.() ?? null;
    if (!taskRepo || !ctx.repos.some((r) => r.name === taskRepo)) taskRepo = here ?? repos[0]?.name ?? '';
    let html = tabHeader(`<span data-hello>${greeting()}</span>`, hooks.openSettings ? `<button class="pv-icon" data-settings title="Settings">${ICON.gear}</button>` : '');
    html += `<div class="pv-scroll home-scroll">`;
    if (today) html += `<button class="hm-brief" data-brief><b>☀ Briefing</b><span>${esc(today.headline)}</span></button>`;

    html += `<form class="hm-task" data-task>
      <label>Give a task</label>
      <select data-keep-sel>${repos.map((r) => `<option value="${esc(r.name)}" ${r.name === taskRepo ? 'selected' : ''}>${esc(r.name)}${r.name === here ? ' (here)' : ''}</option>`).join('')}</select>
      <div class="hm-row"><input data-keep="home-task" placeholder="What should get done?" autocomplete="off" /><button class="pbtn" type="submit">Start</button></div>
    </form>`;

    // One tap to any work building (the full list is in Travel).
    const dests = destinations();
    if (dests.length || hooks.home) {
      html += `<h5 class="home-h">Teleport to work</h5><div class="hm-go">
        ${dests.slice(0, 4).map(({ repo: r, busy }) => `<button class="hm-dest" data-go="${esc(r.name)}" title="Teleport to ${esc(r.name)}'s front door"><i style="background:${esc(r.brandColor || '#7a3dff')}"></i><span>${esc(r.name)}</span>${busy ? `<em>${busy}</em>` : ''}</button>`).join('')}
        <button class="hm-dest more" data-tab-travel>${ICON.pin}<span>All places</span></button></div>`;
    }

    const needs = waitingOnYou.length + red.length + agentPrs.length;
    html += `<h5 class="home-h">Needs you${needs ? ` · ${needs}` : ''}</h5>`;
    if (!needs) html += `<div class="home-idle"><b>You're all caught up.</b><p>Questions from agents, work to review, red CI and PRs from agents show up here.</p></div>`;
    html += waitingOnYou.map(agentCard).join('');
    if (red.length) html += `<div class="pj-list">${red.slice(0, 4).map((p) => `<button class="pj-row" data-project="${esc(p.repo)}"><span class="pj-ci failing"></span><div><b>${esc(p.repo)}: CI is red</b><small>Failing${p.ciSince ? ` since ${esc(ago(p.ciSince))}` : ''} · tap to re-run or fix</small></div><span class="pj-chev">›</span></button>`).join('')}${red.length > 4 ? `<button class="pj-row more" data-tab-projects><div><small>+${red.length - 4} more red projects</small></div><span class="pj-chev">›</span></button>` : ''}</div>`;
    if (agentPrs.length) html += `<div class="pj-list">${agentPrs.slice(0, 3).map((x) => `<button class="pj-row" data-pr-repo="${esc(x.repo)}" data-pr-n="${x.number}"><span class="pj-num">#${x.number}</span><div><b>${esc(x.title)}</b><small>${esc(x.repo)} · PR by ${esc(x.author)} (agent) · ${esc(ago(x.createdAt))}</small></div><span class="pj-chev">›</span></button>`).join('')}</div>`;

    html += `<h5 class="home-h">Working now${live.length ? ` · ${live.length}` : ''}</h5>`;
    html += live.length ? live.filter((a) => !needsInput(a)).map(agentCard).join('') : `<p class="pj-empty">No agents are working. Give one a task above.</p>`;

    const recent = agents.filter((a) => !LIVE.has(a.status) && !needsReview(a) && !needsInput(a)).slice(0, 3);
    if (recent.length) html += `<h5 class="home-h">Recently finished</h5><div class="home-recent">${recent.map((a) => `<button class="hr-row" data-open="${esc(a.id)}"><span class="ar-av ${a.status}">${esc(initials(a.name))}</span><div><b>${esc(a.name)}</b><small>${esc(a.repo)} · ${STATUS_LABEL[a.status]}${a.prUrl ? ' · PR opened' : ''}</small></div><time>${esc(shortTime(a.endedAt ?? a.startedAt))}</time></button>`).join('')}</div>`;
    html += `</div>`;
    viewEl.innerHTML = html;

    viewEl.querySelector('[data-settings]')?.addEventListener('click', () => hooks.openSettings?.());
    viewEl.querySelector('[data-brief]')?.addEventListener('click', () => {
      openBriefingPanel({ travelTo: (r) => teleport(r), openAgent: (id) => openAgent(id) }, 'phone');
    });
    viewEl.querySelector('[data-tab-projects]')?.addEventListener('click', () => tab({ app: 'projects' }));
    viewEl.querySelector('[data-tab-travel]')?.addEventListener('click', () => tab({ app: 'map' }));
    viewEl.querySelectorAll<HTMLElement>('[data-project]').forEach((b) => b.addEventListener('click', () => { tab({ app: 'projects' }); go({ app: 'project', repo: b.dataset.project! }); }));
    viewEl.querySelectorAll<HTMLElement>('[data-pr-repo]').forEach((b) => b.addEventListener('click', () => {
      tab({ app: 'projects' });
      go({ app: 'project', repo: b.dataset.prRepo! });
      go({ app: 'project', repo: b.dataset.prRepo!, sub: 'pr', n: Number(b.dataset.prN) });
    }));
    const form = viewEl.querySelector<HTMLFormElement>('[data-task]')!;
    form.append(agentPicker({ onSettings: () => hooks.openSettings?.() }));
    const sel = form.querySelector('select')!;
    sel.addEventListener('change', () => { taskRepo = sel.value; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input')!;
      const text = input.value.trim();
      if (!text || !sel.value) { input.focus(); return; }
      const b = form.querySelector<HTMLButtonElement>('button')!;
      b.disabled = true;
      b.textContent = 'Starting…';
      try {
        const a = await hire(sel.value, text);
        input.value = '';
        track('agent_assigned', { from: 'phone_home' });
        toastIn(`${a.name} is on it in ${a.repo}`);
      } catch (err) { toastIn(`Couldn't start an agent: ${(err as Error).message}`); }
      if (b.isConnected) { b.disabled = false; b.textContent = 'Start'; }
      refresh();
    });
    bindAgentCards();
    if (fresh && !currentBriefing()) loadBriefing().then(() => { if (isOpen && view.app === 'home') refresh(); }).catch(() => {});
  }

  function sortedAgents() {
    return [...ctx.agents.values()].sort((a, b) => (LIVE.has(b.status) ? 1 : 0) - (LIVE.has(a.status) ? 1 : 0) || b.startedAt.localeCompare(a.startedAt));
  }

  /** One agent with its controls: Answer / Review when it needs you, Stop while working, Log, Go. */
  function agentCard(a: AgentInfo) {
    const working = LIVE.has(a.status) && !needsInput(a);
    const here = hooks.sites().some((s) => s.repo.name === a.repo);
    return `<div class="agent-card ${a.status}" data-card="${esc(a.id)}">
      <button class="ac-top" data-open="${esc(a.id)}"><span class="ar-av ${a.status}">${esc(initials(a.name))}</span>
        <div><b>${esc(a.name)}</b><small>${esc(a.repo)} · ${esc(since(a.startedAt, a.endedAt))}</small></div><em class="chip ${a.status}">${needsReview(a) ? 'Review' : STATUS_LABEL[a.status] ?? a.status}</em></button>
      ${needsInput(a) ? `<p class="ac-doing ac-ask"><b>Asks:</b> ${esc((a.question ?? '').slice(0, 160))}</p>` : `<p class="ac-doing">${working ? '<i class="ac-pulse"></i>' : ''}${esc((working ? a.lastAction : a.summary || a.task.split('\n')[0]).slice(0, 120))}</p>`}
      <div class="ac-actions">
        ${needsInput(a) ? `<button class="pbtn sm" data-review="${esc(a.id)}">Answer</button>` : ''}
        ${needsReview(a) ? `<button class="pbtn sm" data-review="${esc(a.id)}">Review${a.diffStat ? ` · ${esc(a.diffStat.replace(/ files? changed,?/, ' files'))}` : ''}</button>` : ''}
        ${working ? `<button class="pbtn sm danger" data-stop="${esc(a.id)}">Stop</button>` : ''}
        <button class="pbtn sm ghost" data-open="${esc(a.id)}">Log</button>
        ${here ? `<button class="pbtn sm ghost" data-go="${esc(a.repo)}" title="Teleport to its building">Teleport</button>` : ''}
        ${a.prUrl ? `<a class="pbtn sm ghost" href="${esc(a.prUrl)}" target="_blank" rel="noopener">PR ↗</a>` : ''}
      </div>
    </div>`;
  }

  function bindAgentCards() {
    viewEl.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => go({ app: 'agent', id: b.dataset.open! })));
    viewEl.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => teleport(b.dataset.go!)));
    viewEl.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((b) => b.addEventListener('click', async () => {
      // Stopping throws away work in progress: a second tap makes sure.
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = 'Tap to stop';
        b.classList.add('armed');
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Stop'; b.classList.remove('armed'); } }, 4000);
        return;
      }
      b.disabled = true;
      b.textContent = 'Stopping…';
      await stopAgent(b.dataset.stop!);
    }));
    viewEl.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((b) => b.addEventListener('click', () => {
      track('phone_review', { agent: b.dataset.review });
      openReview(b.dataset.review!);
    }));
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
    const a = await api.startAgent(repo, task, pickedAgent());
    ctx.agents.set(a.id, a);
    track('agent_started', { repo, via: 'phone', provider: a.provider });
    tick();
    changed();
    return a;
  }

  /** A small in-phone banner for results of taps. */
  function toastIn(text: string) {
    bannerIn.innerHTML = `<div class="pn-app">${ICON.check}<span>OPENWORLD</span><time>now</time></div><p>${esc(text)}</p>`;
    bannerIn.onclick = () => bannerIn.classList.remove('show');
    bannerIn.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => bannerIn.classList.remove('show'), /^Couldn't/.test(text) ? 5000 : 2800);
  }

  // ---- Projects: every repo, what's going on in it; tap for its control page ----
  let projectQuery = '';
  /** Projects that need you first, then busy ones, then red CI, then most recently pushed. */
  function projectOrder(): Repo[] {
    const busy = liveByRepo();
    const waitingIn = new Map<string, number>();
    for (const a of inbox()) waitingIn.set(a.repo, (waitingIn.get(a.repo) ?? 0) + 1);
    const pushed = (r: Repo) => pulse.get(r.name)?.pushedAt ?? r.pushedAt;
    return [...ctx.repos].sort((a, b) =>
      (waitingIn.get(b.name) ?? 0) - (waitingIn.get(a.name) ?? 0)
      || (busy.get(b.name) ?? 0) - (busy.get(a.name) ?? 0)
      || Number(pulse.get(b.name)?.ci === 'failing') - Number(pulse.get(a.name)?.ci === 'failing')
      || pushed(b).localeCompare(pushed(a)));
  }
  function renderProjects(fresh: boolean) {
    viewEl.innerHTML = `${tabHeader('Projects')}
      <div class="maps-search"><input data-keep="projects" placeholder="Search ${ctx.repos.length} projects" autocomplete="off" value="${esc(projectQuery)}" /></div>
      <div class="pv-scroll lead-list"></div>`;
    const list = viewEl.querySelector<HTMLElement>('.lead-list')!;
    const q = viewEl.querySelector<HTMLInputElement>('input')!;
    const draw = () => {
      projectQuery = q.value;
      const s = q.value.toLowerCase();
      const busy = liveByRepo();
      const rows = projectOrder().filter((r) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s));
      list.innerHTML = rows.length ? rows.map((r) => `<button class="lead-row pj-proj" data-repo="${esc(r.name)}">
          ${leadAvatar(r, r.name)}
          <div><div class="mi-row"><b>${esc(r.name)}</b></div><span class="mi-subj">${projectStatusHtml(pulse.get(r.name), busy.get(r.name) ?? 0)}</span>
          ${r.description ? `<p>${esc(r.description)}</p>` : ''}</div><span class="pj-chev">›</span></button>`).join('')
        : `<div class="msg-empty"><b>${ctx.repos.length ? 'No matches' : 'No projects'}</b><p>${ctx.repos.length ? 'Try another name.' : 'Connect GitHub to see your projects.'}</p></div>`;
      list.querySelectorAll<HTMLElement>('[data-repo]').forEach((b) => b.addEventListener('click', () => go({ app: 'project', repo: b.dataset.repo! })));
    };
    q.addEventListener('input', draw);
    draw();
    if (fresh) pulse.start();
  }

  const projectDeps: ProjectDeps = {
    el: viewEl,
    header,
    bindCommon,
    go: (v) => go(v as View),
    showing: (v) => isOpen && view.app === 'project' && view.repo === v.repo && view.sub === v.sub && view.n === v.n,
    repo: (name) => ctx.repos.find((r) => r.name === name),
    agents: sortedAgents,
    agentCard,
    bindAgentCards,
    hire,
    travelTo: (repo) => teleport(repo),
    canTravel: (repo) => hooks.sites().some((s) => s.repo.name === repo),
    leadAvatar: (r, name) => leadAvatar(r, name),
    toast: toastIn,
    setBack: (fn) => { subBack = fn; },
  };
  // The project page and the lists follow the live pulse and schedules.
  let pulseTimer = 0;
  pulse.onChange(() => {
    clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => { if (isOpen && (view.app === 'home' || view.app === 'projects' || (view.app === 'project' && !view.sub))) refresh(); }, 400);
  });
  onSchedules(() => { if (isOpen && view.app === 'project' && !view.sub) refresh(); });

  // ---- Chat: HQ, mail, and every project's lead ----
  let chatQuery = '';
  function renderChats(fresh: boolean) {
    const hqText = messages.filter((m) => m.channel === 'text');
    const last = hqText[hqText.length - 1];
    const lastMail = [...messages].reverse().find((m) => m.channel === 'email');
    viewEl.innerHTML = `${tabHeader('Chat')}
      <div class="maps-search"><input data-keep="chat" placeholder="Text any project's lead…" autocomplete="off" value="${esc(chatQuery)}" /></div>
      <div class="pv-scroll lead-list"></div>`;
    const list = viewEl.querySelector<HTMLElement>('.lead-list')!;
    const q = viewEl.querySelector<HTMLInputElement>('input')!;
    const draw = () => {
      chatQuery = q.value;
      const s = q.value.toLowerCase();
      let html = '';
      if (!s) {
        html += `<button class="lead-row ${unread('text') ? 'unread' : ''}" data-thread="hq"><span class="lead-av hq">HQ</span>
          <div><div class="mi-row"><b>HQ</b><time>${last ? esc(shortTime(last.ts)) : ''}</time></div><span class="mi-subj">The office · sends agents anywhere</span>
          <p>${typing.text || sending.text ? '<span class="good">typing…</span>' : esc(last ? `${last.from === 'me' ? 'You: ' : ''}${last.text.replace(/\s+/g, ' ')}`.slice(0, 110) : 'Text the office what you need.')}</p></div>${unread('text') ? `<i class="lead-badge">${unread('text')}</i>` : ''}</button>
          <button class="lead-row ${unread('email') ? 'unread' : ''}" data-mail><span class="lead-av mail">${ICON.mail}</span>
          <div><div class="mi-row"><b>Mail</b><time>${lastMail ? esc(shortTime(lastMail.ts)) : ''}</time></div><span class="mi-subj">${esc(lastMail?.subject || 'Email HQ for bigger asks')}</span>
          <p>${lastMail ? esc(lastMail.text.replace(/\s+/g, ' ').slice(0, 110)) : 'Reports from finished agents arrive here.'}</p></div>${unread('email') ? `<i class="lead-badge">${unread('email')}</i>` : ''}</button>`;
      }
      const talked = leadOrder().filter((r) => leadSummary.get(r.name)?.last);
      const rows = s ? leadOrder().filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(s)) : talked;
      if (!s && talked.length) html += `<h5 class="home-h chat-h">Project leads</h5>`;
      html += rows.map((r) => {
        const t = leadSummary.get(r.name);
        const preview = leadTyping.has(r.name) ? '<span class="good">typing…</span>'
          : t?.last ? esc(`${t.last.from === 'me' ? 'You: ' : t.last.from === 'hq' ? 'HQ: ' : ''}${t.last.text.replace(/\s+/g, ' ')}`.slice(0, 110))
          : esc(r.description || 'Text the lead about this project.');
        return `<button class="lead-row ${t?.unread ? 'unread' : ''}" data-thread="${esc(r.name)}">${leadAvatar(r, r.name)}
          <div><div class="mi-row"><b>${esc(r.name)}</b><time>${t?.last ? esc(shortTime(t.last.ts)) : ''}</time></div>
          <p>${preview}</p></div>${t?.unread ? `<i class="lead-badge">${t.unread}</i>` : ''}</button>`;
      }).join('');
      if (!s && !talked.length) html += `<p class="pj-empty chat-tip">Every project has a lead agent who knows its code. Search above to text one.</p>`;
      list.innerHTML = html;
      list.querySelectorAll<HTMLElement>('[data-thread]').forEach((b) => b.addEventListener('click', () => go({ app: 'thread', id: b.dataset.thread! })));
      list.querySelector('[data-mail]')?.addEventListener('click', () => go({ app: 'mail' }));
    };
    q.addEventListener('input', draw);
    draw();
    if (fresh && !leadSummary.size) masters.list().then((t) => { for (const x of t.threads) leadSummary.set(x.repo, x); if (view.app === 'chat') draw(); }).catch(() => {});
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
    html += `<form class="composer"><input data-keep="text" placeholder="Text HQ" autocomplete="off" /><button class="send" aria-label="Send" title="Send" ${sending.text ? 'disabled' : ''}>${ICON.up}</button></form>`;
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
    viewEl.querySelectorAll<HTMLElement>('[data-agent]').forEach((b) => b.addEventListener('click', () => go({ app: 'agent', id: b.dataset.agent! })));
    viewEl.querySelectorAll<HTMLElement>('[data-lead]').forEach((b) => b.addEventListener('click', () => go({ app: 'thread', id: b.dataset.lead! })));
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
          if (el && (channel === 'text' ? view.app === 'thread' && view.id === 'hq' : view.app === 'mail')) {
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
          if (el && view.app === 'thread' && view.id === repo) {
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

  // ---- Project leads ----
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

  function renderLead(repo: string, fresh: boolean) {
    const r = ctx.repos.find((x) => x.name === repo);
    const list = leadMsgs.get(repo);
    if (!list) {
      viewEl.innerHTML = `${header(esc(repo), 'Project lead')}<div class="pv-scroll msgs"><div class="msg-empty"><small>Loading…</small></div></div>`;
      bindCommon();
      loadLead(repo).then(() => { if (view.app === 'thread' && view.id === repo) render(); }).catch(() => {
        leadMsgs.set(repo, []);
        if (view.app === 'thread' && view.id === repo) render();
      });
      return;
    }
    markLeadSeen(repo);
    const n = liveByRepo().get(repo) ?? 0;
    const here = hooks.sites().some((s) => s.repo.name === repo);
    let html = header(esc(repo), n ? `Lead · ${n} agent${n === 1 ? '' : 's'} working` : 'Project lead',
      `<button class="pbtn sm ghost" data-project-page title="Open the project">Project</button>${here ? `<button class="pv-icon" data-go-building title="Teleport to its building">${ICON.map}</button>` : ''}`);
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
    html += `<form class="composer"><input data-keep="lead-${esc(repo)}" placeholder="Text the ${esc(repo)} lead" autocomplete="off" /><button class="send" aria-label="Send" title="Send" ${leadSending.has(repo) ? 'disabled' : ''}>${ICON.up}</button></form>`;
    viewEl.innerHTML = html;
    bindCommon();
    bindDispatchCards();
    viewEl.querySelector('[data-go-building]')?.addEventListener('click', () => teleport(repo));
    viewEl.querySelector('[data-project-page]')!.addEventListener('click', () => { tab({ app: 'projects' }); go({ app: 'project', repo }); });
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
      back();
      void send('email', text, subject);
    };
    viewEl.querySelector('[data-send]')!.addEventListener('click', submit);
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
    setTimeout(() => (replySubject ? body : subj).focus(), 30);
  }

  // ---- One agent: what it's doing, its live log, and its controls ----
  let logEl: HTMLElement | null = null;
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
          <button class="pbtn ghost" data-project-page>Project ›</button>
          ${hooks.sites().some((s) => s.repo.name === a.repo) ? `<button class="pbtn ghost" data-go="${esc(a.repo)}">Teleport there</button>` : ''}
          ${working ? `<button class="pbtn danger" data-stop="${esc(a.id)}">Stop</button>` : ''}
          ${needsReview(a) ? `<button class="pbtn" data-review="${esc(a.id)}">Review changes</button>` : ''}
          ${needsInput(a) ? `<button class="pbtn" data-review="${esc(a.id)}">Answer</button>` : ''}
        </div>
        <h5>Live log</h5>
        <div class="ad-log"><small>Loading…</small></div>
      </div>`;
    bindCommon();
    viewEl.querySelector('[data-project-page]')!.addEventListener('click', () => { tab({ app: 'projects' }); go({ app: 'project', repo: a.repo }); });
    bindAgentCards();
    logEl = viewEl.querySelector('.ad-log');
    const id = a.id;
    api.agentLog(id).then(({ events }) => {
      if (!(view.app === 'agent' && view.id === id) || !logEl) return;
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

  // ---- Travel: teleport to any of your work buildings, or home. The phone stays out. ----
  let teleporting = false;
  /** Teleport to a project's front door (or inside), keeping the phone open on the same screen. */
  async function teleport(repo: string, inside = false) {
    if (teleporting) return;
    teleporting = true;
    renderBusy(repo);
    try {
      await (inside && hooks.enter ? hooks.enter(repo) : hooks.travelTo(repo));
      toastIn(inside ? `You're inside ${repo}` : `Teleported to ${repo}. The door is in front of you.`);
      track('phone_teleport', { inside });
    } catch (e) { toastIn(`Couldn't teleport: ${(e as Error).message}`); }
    teleporting = false;
    if (isOpen) refresh();
  }
  async function teleportHome(inside = false) {
    const h = hooks.home;
    if (!h || teleporting) return;
    teleporting = true;
    renderBusy('home');
    try {
      await (inside && h.enter ? h.enter() : h.go());
      toastIn(inside ? `You're home` : `Teleported home: ${h.address}`);
      track('phone_teleport', { inside, home: true });
    } catch (e) { toastIn(`Couldn't teleport: ${(e as Error).message}`); }
    teleporting = false;
    if (isOpen) refresh();
  }
  /** Grey out every teleport button and mark the one that's on its way. */
  function renderBusy(id: string) {
    viewEl.querySelectorAll<HTMLButtonElement>('[data-go], [data-in], [data-home]').forEach((b) => { b.disabled = true; });
    const b = viewEl.querySelector<HTMLButtonElement>(id === 'home' ? '[data-home=go]' : `[data-go="${CSS.escape(id)}"]`);
    if (b) b.textContent = 'Teleporting…';
  }

  /** Your work destinations: where agents are working first, then the biggest buildings. */
  function destinations() {
    const busy = liveByRepo();
    const waiting = new Map<string, number>();
    for (const a of inbox()) waiting.set(a.repo, (waiting.get(a.repo) ?? 0) + 1);
    const rank = { landmark: 0, tower: 1, midrise: 2, small: 3 } as const;
    return hooks.sites().map((s) => s.repo)
      .sort((a, b) => (waiting.get(b.name) ?? 0) - (waiting.get(a.name) ?? 0) || (busy.get(b.name) ?? 0) - (busy.get(a.name) ?? 0) || rank[a.tier] - rank[b.tier] || b.score - a.score)
      .map((r) => ({ repo: r, busy: busy.get(r.name) ?? 0, waiting: waiting.get(r.name) ?? 0 }));
  }

  function renderMaps() {
    const dests = destinations();
    viewEl.innerHTML = `${tabHeader('Travel')}<p class="pv-tabsub">Teleport to your work · ${esc(hooks.placeName?.() ?? `${dests.length} buildings`)}</p>
      <div class="maps-search"><input data-keep="maps" placeholder="Search your ${dests.length} work buildings" autocomplete="off" /></div>
      <div class="pv-scroll maps-list"></div>`;
    bindCommon();
    const list = viewEl.querySelector<HTMLElement>('.maps-list')!;
    const q = viewEl.querySelector<HTMLInputElement>('input')!;
    const draw = () => {
      const s = q.value.toLowerCase();
      const h = hooks.home;
      let html = '';
      if (h && (!s || `home ${h.address}`.toLowerCase().includes(s))) html += `<h5 class="home-h">Home</h5><div class="tv-card">
          <span class="tv-ic home">${ICON.home}</span>
          <div class="tv-txt"><b>Home</b><small>${esc(h.address)}</small></div>
          <div class="tv-acts"><button class="pbtn sm" data-home="go" title="Teleport to your front door">Teleport</button>${h.enter ? `<button class="pbtn ghost sm" data-home="in" title="Teleport and go inside">Go inside</button>` : ''}<button class="pbtn ghost sm tv-wp" data-home="pin" title="Set a waypoint on the map instead">${ICON.flag}</button></div></div>`;
      const rows = dests.filter(({ repo: r }) => !s || `${r.name} ${r.description}`.toLowerCase().includes(s));
      if (rows.length) html += `<h5 class="home-h">Your work${!s ? ` · ${rows.length}` : ''}</h5>`;
      html += rows.map(({ repo: r, busy, waiting }) => `<div class="tv-card">
          <span class="tv-ic" style="background:${esc(r.brandColor || '#7a3dff')}">${esc(r.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?')}</span>
          <div class="tv-txt"><b>${esc(r.name)}</b><small>${TIER[r.tier]}${waiting ? ` · <span class="warn">${waiting} need${waiting === 1 ? 's' : ''} you</span>` : ''}${busy ? ` · <span class="good">${busy} agent${busy === 1 ? '' : 's'} working</span>` : ''}</small></div>
          <div class="tv-acts"><button class="pbtn sm" data-go="${esc(r.name)}" title="Teleport to the front door">Teleport</button>${hooks.enter ? `<button class="pbtn ghost sm" data-in="${esc(r.name)}" title="Teleport and walk in">Go inside</button>` : ''}<button class="pbtn ghost sm tv-wp" data-wp="${esc(r.name)}" title="Set a waypoint on the map instead">${ICON.flag}</button></div></div>`).join('');
      if (!html) html = `<div class="msg-empty"><b>${dests.length ? 'No matches' : 'No work buildings here'}</b><p>${dests.length ? 'Try another name.' : 'Your projects get buildings once GitHub is connected.'}</p></div>`;
      list.innerHTML = html;
      list.querySelector<HTMLElement>('[data-home=pin]')?.addEventListener('click', () => hooks.home!.pin());
      list.querySelector<HTMLElement>('[data-home=go]')?.addEventListener('click', () => void teleportHome());
      list.querySelector<HTMLElement>('[data-home=in]')?.addEventListener('click', () => void teleportHome(true));
      list.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => b.addEventListener('click', () => hooks.setWaypoint(b.dataset.wp!)));
      list.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => void teleport(b.dataset.go!)));
      list.querySelectorAll<HTMLElement>('[data-in]').forEach((b) => b.addEventListener('click', () => void teleport(b.dataset.in!, true)));
      if (teleporting) viewEl.querySelectorAll<HTMLButtonElement>('[data-go], [data-in], [data-home]').forEach((b) => { b.disabled = true; });
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
  // The phone starts out (minimized only if you minimized it last time). On a small screen it would cover
  // the whole game, so there it starts minimized unless you left it open.
  const dock = loadDock();
  if (dock === 'open' || (dock === null && window.innerWidth > 720 && window.innerHeight > 560)) open(undefined, true);
  return {
    open, openThread, openProject, openAgent, close, toggle, isOpen: () => isOpen, app: () => (isOpen ? view.app : null),
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
const DOCK = 'openworld.phone';
function loadDock(): 'open' | 'min' | null {
  try { const v = localStorage.getItem(DOCK); return v === 'open' || v === 'min' ? v : null; } catch { return null; }
}
function rememberDock(v: 'open' | 'min') {
  try { localStorage.setItem(DOCK, v); } catch { /* private mode: default next time */ }
}

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
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
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
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  compose: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  reply: svg('<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  signal: svg('<rect x="2" y="15" width="3" height="5" rx="1"/><rect x="7.5" y="11" width="3" height="9" rx="1"/><rect x="13" y="7" width="3" height="13" rx="1"/><rect x="18.5" y="3" width="3" height="17" rx="1"/>', true),
  battery: '<svg viewBox="0 0 28 14"><rect x="1" y="1" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".45"/><rect x="3" y="3" width="17" height="8" rx="2" fill="currentColor"/><rect x="25.5" y="5" width="1.8" height="4" rx=".9" fill="currentColor" fill-opacity=".45"/></svg>',
};
