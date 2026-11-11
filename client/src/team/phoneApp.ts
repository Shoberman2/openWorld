// The Team app on the phone: who is online, where they are and what they're on, with Teleport and
// Waypoint per person; the team chat; and the invite, your name and what you share. phone.ts gives it
// the screen to draw into and asks it for the unread count. All teammate text is escaped here.
import type { TeamMember } from '../../../shared/types.ts';
import { track } from '../api.ts';
import { esc } from '../interact.ts';
import { initials, safeColor, teamApi, whereLine, workLine, type TeamStore } from './store.ts';

export interface PhoneTeam {
  /** Draw the app into the phone's screen. */
  render(el: HTMLElement, fresh: boolean): void;
  /** Unread chat messages, for the tab and the phone's badge. */
  unread(): number;
  /** Called when the roster or chat changed (the phone redraws its badges). */
  onChange(fn: () => void): void;
  /** Is the chat on screen right now? (Then a new message needs no toast.) */
  chatOnScreen(): boolean;
}

interface Actions {
  teleportTo(id: string): Promise<void>;
  waypointTo(id: string): void;
  callHere(): Promise<void>;
  wave(): void;
  /** False in the classic cities: there are no real positions to share there. */
  hasWorld: boolean;
}

type Seg = 'people' | 'chat' | 'invite';
const UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older browsers, or no permission */ }
  const t = document.createElement('textarea');
  t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nothing else to try */ }
  t.remove();
  return ok;
}

/** The invite with most of the code hidden, for showing on screen. */
export const maskInvite = (url: string) => url.replace(/#(.{4}).*$/, '#$1…');

export function makePhoneTeam(store: TeamStore, act: Actions): PhoneTeam {
  let seg: Seg = 'people';
  let host: HTMLElement | null = null;
  let note = '';
  let busy = false;
  let leaveArmed = false;
  let teleporting: string | null = null;
  let copied = -1;
  const outside = new Set<() => void>();

  const onScreen = () => !!host && host.isConnected && host.classList.contains('app-teammates') && !!host.closest('.phone.open');
  const redraw = () => { if (onScreen()) draw(host!, false); };
  store.subscribe(() => { redraw(); for (const fn of outside) fn(); });
  // "Last seen 3m ago" keeps counting.
  setInterval(() => { if (onScreen() && seg === 'people') redraw(); }, 30_000);

  /** Run a settings call, show what went wrong in plain words. */
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    busy = true; note = '';
    redraw();
    try { await fn(); } catch (e) { note = (e as Error).message; }
    busy = false;
    redraw();
  }

  const head = (right = '') => `<div class="pv-tabhead"><h3>Team</h3><div class="pv-right tm-right">${right}</div></div>`;

  function setup(canEdit: boolean) {
    if (!canEdit) return `${head()}<div class="pv-scroll tm"><div class="msg-empty"><b>Play with your team</b><p>See teammates in the world, what they're working on, and chat. Set it up on the computer running OpenWorld.</p></div></div>`;
    return `${head()}<div class="pv-scroll tm">
      <p class="tm-lead">See teammates in the world, what they're working on, and chat with them.</p>
      <label class="tm-field"><span>Your name</span><input data-keep="tm-name" maxlength="32" autocomplete="off" placeholder="${esc(store.state?.me?.name ?? 'Shown to teammates')}" /></label>
      <div class="tm-card"><b>Join a team</b><p>Paste the invite a teammate sent you.</p>
        <input data-keep="tm-invite" autocomplete="off" spellcheck="false" placeholder="ws://…" />
        <button class="pbtn" data-join ${busy ? 'disabled' : ''}>Join</button></div>
      <div class="tm-card"><b>Start a team</b><p>This computer hosts it. Teammates join with an invite you send them.</p>
        <button class="pbtn ghost" data-host ${busy ? 'disabled' : ''}>Host a team</button></div>
      ${note ? `<p class="tm-note bad">${esc(note)}</p>` : ''}
    </div>`;
  }

  function person(m: TeamMember) {
    const work = workLine(m);
    const canGo = m.online && !m.idle && (!!store.geo(m.id) || m.inside?.kind === 'hq');
    return `<div class="tv-card tm-person ${m.online ? '' : 'off'}">
      <span class="tv-ic tm-av" style="background:${safeColor(m.color)}">${esc(initials(m.name))}</span>
      <div class="tv-txt"><b>${esc(m.name)}</b><small>${esc(whereLine(m))}</small>
        ${work ? `<small class="tm-work">${esc(work)}</small>` : ''}
        ${(m.online ? m.work?.agents ?? [] : []).slice(0, 3).map((a) => `<small class="tm-agent"><i class="ac-pulse"></i>${esc(a.name)}: ${esc(a.task)}</small>`).join('')}
      </div>
      ${canGo ? `<div class="tv-acts"><button class="pbtn sm" data-tp="${esc(m.id)}" ${teleporting ? 'disabled' : ''}>${teleporting === m.id ? 'Going…' : 'Teleport'}</button><button class="pbtn ghost sm" data-wp="${esc(m.id)}" ${store.geo(m.id) && act.hasWorld ? '' : 'disabled'}>Waypoint</button></div>` : ''}
    </div>`;
  }

  function people() {
    const st = store.state!;
    const here = st.members.filter((m) => m.online), away = st.members.filter((m) => !m.online);
    let html = '<div class="pv-scroll tm">';
    if (st.status === 'online' && here.length) html += `<div class="tm-quick"><button class="pbtn ghost sm" data-wave>Wave</button><button class="pbtn ghost sm" data-call ${act.hasWorld && st.shareLocation ? '' : 'disabled'}>Call everyone here</button></div>`;
    if (here.length) html += `<h5 class="home-h">Online · ${here.length}</h5>${here.map(person).join('')}`;
    else html += `<div class="msg-empty"><b>${st.status === 'online' ? 'Nobody else is here yet' : 'Not connected'}</b><p>${st.status === 'online' ? 'Send a teammate the invite. They show up here, and in the world, when they join.' : esc(st.error ?? 'Trying to reach the team…')}</p>${st.status === 'online' && st.canEdit ? '<button class="pbtn sm" data-seg="invite">Get the invite</button>' : ''}</div>`;
    if (away.length) html += `<h5 class="home-h">Away</h5>${away.map(person).join('')}`;
    return `${html}</div>`;
  }

  function chat() {
    const st = store.state!;
    let html = '<div class="pv-scroll msgs tm-chat">';
    if (!store.chat.length) html += `<div class="msg-empty"><b>Team chat</b><p>Messages reach whoever is online. They also show over your robot's head.</p></div>`;
    let last = '';
    for (const m of store.chat) {
      const color = m.mine ? '' : safeColor(store.member(m.from)?.color ?? '');
      if (!m.mine && m.from !== last) html += `<div class="tm-from" style="color:${color}">${esc(m.name)}</div>`;
      html += `<div class="bubble ${m.mine ? 'me' : 'hq'}" title="${esc(new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}">${esc(m.text)}</div>`;
      last = m.mine ? '' : m.from;
    }
    html += `</div>${note ? `<p class="tm-note bad">${esc(note)}</p>` : ''}
      <form class="composer" data-say><input data-keep="tm-chat" maxlength="500" placeholder="${st.status === 'online' ? 'Message your team' : 'Not connected'}" autocomplete="off" ${st.status === 'online' ? '' : 'disabled'} /><button class="send" aria-label="Send" title="Send" ${st.status === 'online' ? '' : 'disabled'}>${UP}</button></form>`;
    return html;
  }

  const toggle = (id: string, label: string, sub: string, on: boolean, enabled: boolean) => `
    <div class="tm-toggle"><div><b>${label}</b><small>${sub}</small></div>
      <button class="st-switch" role="switch" aria-checked="${on}" aria-label="${label}" data-share="${id}" ${enabled ? '' : 'disabled'}><i></i></button></div>`;

  function invite() {
    const st = store.state!;
    let html = '<div class="pv-scroll tm">';
    if (st.canEdit) {
      html += `<h5 class="home-h">Invite</h5>${st.invites.map((v, i) => `<div class="tm-inv"><div><small>${esc(v.label)}</small><code>${esc(maskInvite(v.url))}</code></div><button class="pbtn sm" data-copy="${i}">${copied === i ? 'Copied' : 'Copy'}</button></div>`).join('')}
        <p class="tm-hint">${st.hosting ? 'This computer hosts the team, so teammates must be able to reach it: the same network, Tailscale, or a forwarded port. ' : ''}Anyone with the invite can join, so share it like a password.</p>`;
    } else html += `<p class="tm-hint">Team settings can be changed on the computer running OpenWorld.</p>`;
    html += `<h5 class="home-h">You</h5>
      <form class="tm-name" data-name><input data-keep="tm-myname" maxlength="32" autocomplete="off" value="${esc(st.me?.name ?? '')}" ${st.canEdit ? '' : 'disabled'} /><button class="pbtn ghost sm" ${st.canEdit && !busy ? '' : 'disabled'}>Save</button></form>
      <h5 class="home-h">What teammates see</h5>
      ${toggle('shareLocation', 'Where I am', 'Your robot in their world, your place, and teleport to you.', st.shareLocation, st.canEdit)}
      ${toggle('shareWork', "What I'm working on", "The project you're in, its branch, the file you changed last, and your agents there.", st.shareWork, st.canEdit)}
      ${toggle('sharePrivate', 'Details of private projects', st.hidePrivate ? 'Off while private repos are hidden.' : 'Off: teammates only learn that you are in a private project.', st.sharePrivate, st.canEdit && !st.hidePrivate && st.shareWork)}
      ${note ? `<p class="tm-note bad">${esc(note)}</p>` : ''}
      ${st.canEdit ? `<button class="pbtn danger tm-leave ${leaveArmed ? 'armed' : ''}" data-leave ${busy ? 'disabled' : ''}>${leaveArmed ? (st.hosting ? 'Tap again to end the team' : 'Tap again to leave') : st.hosting ? 'Stop hosting' : 'Leave team'}</button>` : ''}`;
    return `${html}</div>`;
  }

  function draw(el: HTMLElement, fresh: boolean) {
    host = el;
    const st = store.state;
    // Keep what's being typed, the focus, and the place in the scroll.
    const kept = [...el.querySelectorAll<HTMLInputElement>('[data-keep]')].map((f) => ({ key: f.dataset.keep!, value: f.value, focus: document.activeElement === f, at: f.selectionStart }));
    const sc = el.querySelector<HTMLElement>('.pv-scroll');
    const atBottom = !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40;
    const top = sc?.scrollTop ?? 0;
    const wasChat = !!el.querySelector('.tm-chat');

    if (!st) el.innerHTML = `${head()}<div class="pv-scroll tm"><p class="pj-empty">Loading…</p></div>`;
    else if (!st.configured) el.innerHTML = setup(st.canEdit);
    else {
      const n = store.unread();
      const dot = st.status === 'online' ? 'on' : st.status === 'error' ? 'bad' : '';
      const sub = st.status === 'online' ? `${st.members.filter((m) => m.online).length + 1} online${st.hosting ? ' · hosted here' : ''}` : st.status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
      el.innerHTML = `${head(`<i class="tm-status ${dot}"></i>`)}<p class="pv-tabsub">${esc(sub)}</p>
        <div class="tm-seg" role="tablist">${(['people', 'chat', 'invite'] as Seg[]).map((s) => `<button role="tab" data-seg="${s}" aria-selected="${s === seg}">${s === 'people' ? 'People' : s === 'chat' ? 'Chat' : 'Invite'}${s === 'chat' && n && seg !== 'chat' ? `<i>${n}</i>` : ''}</button>`).join('')}</div>
        ${seg === 'people' ? people() : seg === 'chat' ? chat() : invite()}`;
    }

    if (!fresh) for (const k of kept) {
      const f = el.querySelector<HTMLInputElement>(`[data-keep="${k.key}"]`);
      if (!f || f.disabled) continue;
      f.value = k.value;
      if (k.focus) { f.focus(); try { f.setSelectionRange(k.at, k.at); } catch { /* not a text field */ } }
    }
    const sc2 = el.querySelector<HTMLElement>('.pv-scroll');
    if (sc2) sc2.scrollTop = el.querySelector('.tm-chat') ? (atBottom || !wasChat || fresh ? sc2.scrollHeight : top) : fresh ? 0 : top;
    if (st?.configured && seg === 'chat' && onScreen()) store.markRead();
    bind(el);
  }

  function bind(el: HTMLElement) {
    const val = (key: string) => el.querySelector<HTMLInputElement>(`[data-keep="${key}"]`)?.value.trim() ?? '';
    el.querySelectorAll<HTMLElement>('[data-seg]').forEach((b) => b.addEventListener('click', () => { seg = b.dataset.seg as Seg; note = ''; leaveArmed = false; draw(el, true); }));
    el.querySelector('[data-host]')?.addEventListener('click', () => void run(async () => { store.adopt(await teamApi.host(val('tm-name') || undefined)); track('team_hosted', {}); seg = 'invite'; }));
    el.querySelector('[data-join]')?.addEventListener('click', () => void run(async () => {
      if (!val('tm-invite')) throw new Error('Paste the invite first.');
      store.adopt(await teamApi.join(val('tm-invite'), val('tm-name') || undefined));
      track('team_joined', {});
      seg = 'people';
    }));
    el.querySelectorAll<HTMLElement>('[data-tp]').forEach((b) => b.addEventListener('click', async () => {
      if (teleporting) return;
      teleporting = b.dataset.tp!;
      redraw();
      try { await act.teleportTo(teleporting); } finally { teleporting = null; redraw(); }
    }));
    el.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => b.addEventListener('click', () => act.waypointTo(b.dataset.wp!)));
    el.querySelector('[data-wave]')?.addEventListener('click', () => act.wave());
    el.querySelector('[data-call]')?.addEventListener('click', () => void act.callHere());
    el.querySelector<HTMLFormElement>('[data-say]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = el.querySelector<HTMLInputElement>('[data-keep="tm-chat"]')!;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      note = '';
      teamApi.say(text).then(() => track('team_message_sent', { chars: text.length }), (err) => { note = (err as Error).message; input.value = text; redraw(); });
    });
    el.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const v = store.state?.invites[Number(b.dataset.copy)];
      if (v && await copyText(v.url)) { copied = Number(b.dataset.copy); redraw(); setTimeout(() => { copied = -1; redraw(); }, 2000); }
    }));
    el.querySelector<HTMLFormElement>('[data-name]')?.addEventListener('submit', (e) => { e.preventDefault(); void run(async () => { store.adopt(await teamApi.settings({ name: val('tm-myname') })); }); });
    el.querySelectorAll<HTMLElement>('[data-share]').forEach((b) => b.addEventListener('click', () => void run(async () => {
      const k = b.dataset.share as 'shareLocation' | 'shareWork' | 'sharePrivate';
      store.adopt(await teamApi.settings({ [k]: b.getAttribute('aria-checked') !== 'true' }));
    })));
    el.querySelector('[data-leave]')?.addEventListener('click', () => {
      if (!leaveArmed) { leaveArmed = true; redraw(); setTimeout(() => { if (leaveArmed) { leaveArmed = false; redraw(); } }, 4000); return; }
      leaveArmed = false;
      void run(async () => { store.adopt(await teamApi.leave()); seg = 'people'; });
    });
  }

  return {
    render: draw,
    unread: () => (store.state?.configured ? store.unread() : 0),
    onChange: (fn) => { outside.add(fn); },
    chatOnScreen: () => onScreen() && seg === 'chat',
  };
}
