// Settings › Team: host a team on this computer or join one with an invite, copy the invite, set the
// name teammates see, choose what you share, and leave. Works from the landing page too. The team code
// is a secret: it only comes back to the computer running OpenWorld, and is shown mostly hidden.
import type { TeamState } from '../../../shared/types.ts';
import { track } from '../api.ts';
import { esc } from '../interact.ts';
import { copyText, maskInvite } from './phoneApp.ts';
import { teamApi, teamStore, whereLine } from './store.ts';
import './team.css';

export function teamTab(page: HTMLElement) {
  const store = teamStore();
  let st: TeamState | null = store.state;
  let note: { ok: boolean; text: string } | null = null;
  let busy = false;
  let copied = -1;
  let leaveArmed = false;

  const switchRow = (id: string, label: string, sub: string, on: boolean, enabled: boolean) => `
    <div class="st-row">
      <div class="st-act"><b>${label}</b><span>${sub}</span></div>
      <button class="st-switch" role="switch" aria-checked="${on}" data-share="${id}" aria-label="${label}" ${enabled ? '' : 'disabled'}><i></i></button>
    </div>`;

  const statusChip = (s: TeamState) =>
    s.status === 'online' ? `<em class="ak-chip ok">Connected · ${s.members.filter((m) => m.online).length + 1} online</em>`
    : s.status === 'connecting' ? '<em class="ak-chip">Connecting…</em>'
    : '<em class="ak-chip warn">Not connected · retrying</em>';

  const render = () => {
    // Don't wipe a field someone is typing in.
    const kept = [...page.querySelectorAll<HTMLInputElement>('input[name]')].map((f) => ({ name: f.name, value: f.value, focus: document.activeElement === f }));
    if (!st) { page.innerHTML = '<div class="st-empty">Loading…</div>'; return; }
    const edit = st.canEdit;
    const noteHtml = note ? `<div class="st-note ${note.ok ? '' : 'tm-bad'}">${esc(note.text)}</div>` : '';
    if (!st.configured) {
      page.innerHTML = `
        <div class="st-intro"><p>Teammates see each other in the world as robots, see where each person is and what they're working on, chat, and can jump to each other. Nothing goes through a hosted service: a small relay that one of you runs passes presence and chat, and never sees your GitHub token, your AI keys or your agents.</p></div>
        ${noteHtml}
        ${edit ? `
        <section class="st-group"><h4>You</h4>
          <div class="st-row"><div class="st-act"><b>Display name</b><span>What teammates see over your robot. Leave empty to use your GitHub name.</span></div>
            <input class="tm-input" name="name" maxlength="32" autocomplete="off" placeholder="${esc(st.me?.name ?? 'Your name')}" /></div>
        </section>
        <section class="st-group"><h4>Join a team</h4>
          <form class="st-row" data-join><div class="st-act"><b>Paste an invite</b><span>A teammate copies it from their Team settings. It looks like <code>ws://host:4319/#code</code>.</span></div>
            <input class="tm-input wide" name="invite" autocomplete="off" spellcheck="false" placeholder="ws://…" /><button class="st-btn" ${busy ? 'disabled' : ''}>Join</button></form>
        </section>
        <section class="st-group"><h4>Start a team</h4>
          <div class="st-row"><div class="st-act"><b>Host a team on this computer</b><span>Runs the relay here on port 4319 while OpenWorld is open. Teammates must be able to reach this computer: the same network, Tailscale, or a forwarded port. For a team that is always up, run <code>npm run team-relay</code> on a server and join its invite instead.</span></div>
            <button class="st-btn" data-host ${busy ? 'disabled' : ''}>Host a team</button></div>
        </section>` : '<div class="st-empty">Set up your team on the computer running OpenWorld.</div>'}`;
    } else {
      const here = st.members.filter((m) => m.online);
      page.innerHTML = `
        <div class="ak-card ${st.status === 'online' ? 'ready' : ''}">
          <div class="ak-head"><div><b>${st.hosting ? 'Hosting a team on this computer' : 'On a team'}</b><small>Relay ${esc(st.relay ?? '')}${st.hosting ? ' · stops when OpenWorld stops' : ''}</small></div>${statusChip(st)}</div>
          ${st.error && st.status !== 'online' ? `<p class="ak-hint">${esc(st.error)}</p>` : ''}
          ${here.length ? `<p class="ak-hint">${here.map((m) => `<b>${esc(m.name)}</b> · ${esc(whereLine(m))}`).join('<br>')}</p>` : st.status === 'online' ? '<p class="ak-hint">Nobody else is online yet. Send a teammate the invite below.</p>' : ''}
        </div>
        ${noteHtml}
        ${edit ? `<section class="st-group"><h4>Invite</h4>
          ${st.invites.map((v, i) => `<div class="st-row"><div class="st-act"><b>${esc(v.label)}</b><span><code>${esc(maskInvite(v.url))}</code></span></div><button class="st-btn" data-copy="${i}">${copied === i ? 'Copied' : 'Copy invite'}</button></div>`).join('')}
          <p class="ak-hint">${st.hosting && st.invites.length > 1 ? 'Send the one your teammate can reach. ' : ''}Anyone with the invite can join the team and see what its members share, so send it like a password.</p>
        </section>` : '<div class="st-note">Team settings can be changed on the computer running OpenWorld.</div>'}
        <section class="st-group"><h4>You</h4>
          <form class="st-row" data-name><div class="st-act"><b>Display name</b><span>What teammates see over your robot.</span></div>
            <input class="tm-input" name="name" maxlength="32" autocomplete="off" value="${esc(st.me?.name ?? '')}" ${edit ? '' : 'disabled'} /><button class="st-btn" ${edit && !busy ? '' : 'disabled'}>Save</button></form>
        </section>
        <section class="st-group"><h4>What teammates see</h4>
          ${switchRow('shareLocation', 'Where I am', 'Your robot in their world, the name of the place, and teleport to you. Off: you are on the roster and in chat only.', st.shareLocation, edit)}
          ${switchRow('shareWork', "What I'm working on", "The project whose building you're in, your running agents there (name, task, status), and, when this computer has a clone of it, its branch and the file you changed last.", st.shareWork, edit)}
          ${switchRow('sharePrivate', 'Share details of private projects', st.hidePrivate ? 'Off while private repos are hidden (Agents & keys).' : 'A private project is only ever sent as a scrambled id that teammates who have the same repo can match. On: its branch, file and agent tasks are sent too. Off: others see "A private project".', st.sharePrivate, edit && !st.hidePrivate && st.shareWork)}
        </section>
        ${edit ? `<section class="st-group"><h4>Leave</h4>
          <div class="st-row"><div class="st-act"><b>${st.hosting ? 'Stop hosting' : 'Leave this team'}</b><span>${st.hosting ? 'Ends the team for everyone connected through this computer. Hosting again makes a new invite.' : 'You disappear from their world. Join again any time with an invite.'}</span></div>
            <button class="st-btn ${leaveArmed ? 'tm-armed' : ''}" data-leave ${busy ? 'disabled' : ''}>${leaveArmed ? 'Click again to confirm' : st.hosting ? 'Stop hosting' : 'Leave team'}</button></div>
        </section>` : ''}`;
    }
    for (const k of kept) {
      const f = page.querySelector<HTMLInputElement>(`input[name="${k.name}"]`);
      if (f && !f.disabled && (k.focus || (k.value && !st.configured))) { f.value = k.value; if (k.focus) f.focus(); }
    }
  };

  const adopt = (s: TeamState) => { st = s; store.adopt(s); };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true; note = null;
    render();
    try { await fn(); } catch (e) { note = { ok: false, text: (e as Error).message }; }
    busy = false;
    render();
  };
  const field = (name: string) => page.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? '';

  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-host],[data-copy],[data-share],[data-leave]');
    if (!t || (t as HTMLButtonElement).disabled) return;
    if (t.dataset.host !== undefined) void run(async () => { adopt(await teamApi.host(field('name') || undefined)); track('team_hosted', {}); note = { ok: true, text: 'Your team is up. Copy an invite and send it to a teammate.' }; });
    else if (t.dataset.copy !== undefined) {
      const i = Number(t.dataset.copy), v = st?.invites[i];
      if (v) void copyText(v.url).then((ok) => { copied = ok ? i : -1; note = ok ? null : { ok: false, text: "Couldn't copy. Select the invite on the phone's Team app instead." }; render(); setTimeout(() => { copied = -1; render(); }, 2000); });
    } else if (t.dataset.share) {
      const k = t.dataset.share as 'shareLocation' | 'shareWork' | 'sharePrivate';
      void run(async () => { adopt(await teamApi.settings({ [k]: t.getAttribute('aria-checked') !== 'true' })); });
    } else if (t.dataset.leave !== undefined) {
      if (!leaveArmed) { leaveArmed = true; render(); return; }
      leaveArmed = false;
      void run(async () => { adopt(await teamApi.leave()); });
    }
  };
  const onSubmit = (e: SubmitEvent) => {
    const f = e.target as HTMLFormElement;
    e.preventDefault();
    if (f.dataset.join !== undefined) void run(async () => {
      if (!field('invite')) throw new Error('Paste the invite first.');
      adopt(await teamApi.join(field('invite'), field('name') || undefined));
      track('team_joined', {});
      void store.reload();
    });
    else if (f.dataset.name !== undefined) void run(async () => { adopt(await teamApi.settings({ name: field('name') })); note = { ok: true, text: 'Name saved.' }; });
  };

  page.classList.add('tm-settings');
  page.addEventListener('click', onClick);
  page.addEventListener('submit', onSubmit);
  const off = store.subscribe((what) => { if (what === 'state' && store.state && !busy) { st = store.state; if (!page.contains(document.activeElement) || document.activeElement?.tagName !== 'INPUT') render(); } });
  // On the landing page there is no live socket: ask now and then while the tab is open.
  const poll = window.setInterval(() => { void store.reload(); }, 4000);
  void store.reload().then((s) => { st = s ?? st; render(); });
  render();
  return () => { page.classList.remove('tm-settings'); page.removeEventListener('click', onClick); page.removeEventListener('submit', onSubmit); off(); clearInterval(poll); };
}
