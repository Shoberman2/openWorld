// Settings › Agents & keys: which coding agents this computer can run, the user's own keys for them,
// the default agent for new tasks, who voices the office, and the GitHub connection.
// Keys go straight to the local server and are never shown again (only the last 4 characters).
import type { Me, ProvidersState, ProviderStatus } from '../../../shared/types.ts';
import { api, providers } from '../api.ts';
import { esc } from '../interact.ts';
import { refreshProviders } from './agentPick.ts';

const CHAT_LABEL: Record<string, string> = {
  anthropic: 'Anthropic key', 'claude-cli': 'Claude Code login', openai: 'OpenAI key', gemini: 'Gemini key',
};

export function agentsTab(page: HTMLElement) {
  let st: ProvidersState | null = null;
  let me: Me | null = null;
  let busy: string | null = null;
  const notes = new Map<string, { ok: boolean; text: string }>();

  const status = (p: ProviderStatus) => {
    if (p.ready && p.signedIn && !p.key.set) return `<em class="ak-chip ok">Ready · signed in</em>`;
    if (p.ready) return `<em class="ak-chip ok">Ready · key ••••${esc(p.key.last4 ?? '')}</em>`;
    if (!p.installed) return p.version ? `<em class="ak-chip warn">Update needed</em>` : `<em class="ak-chip">Not installed</em>`;
    return `<em class="ak-chip warn">Needs a key or sign-in</em>`;
  };

  const card = (p: ProviderStatus) => {
    const note = notes.get(p.id);
    const edit = st!.canEdit;
    const isDefault = st!.defaultProvider === p.id;
    return `<div class="ak-card ${p.ready ? 'ready' : ''}" data-p="${p.id}">
      <div class="ak-head">
        <div><b>${esc(p.label)}</b><small>${esc(p.vendor)}${p.version ? ` · v${esc(p.version)}` : ''}</small></div>
        ${status(p)}
      </div>
      ${!p.installed ? `<p class="ak-hint">${p.version ? esc(p.hint ?? '') : 'Not on this computer yet. Install it in a terminal:'}</p><code class="ak-cmd">${esc(p.installCmd)}</code>` : !p.ready ? `<p class="ak-hint">${esc(p.hint ?? '')}</p>` : ''}
      ${p.key.fromEnv
        ? `<p class="ak-hint">Using the key from your environment (••••${esc(p.key.last4 ?? '')}).</p>`
        : `<form class="ak-key" data-key="${p.id}">
            <input type="password" autocomplete="off" spellcheck="false" placeholder="${p.key.set ? `Key saved ••••${esc(p.key.last4 ?? '')} · paste to replace` : `Paste your ${esc(p.vendor)} key (${esc(p.keyPrefix)}…)`}" ${edit ? '' : 'disabled'} />
            <button class="st-btn" type="submit" ${edit && busy !== p.id ? '' : 'disabled'}>${busy === p.id ? 'Checking…' : 'Save'}</button>
            ${p.key.set && edit ? `<button class="st-btn ghost" type="button" data-remove="${p.id}">Remove</button>` : ''}
          </form>
          <p class="ak-get"><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Get an API key from ${esc(p.vendor)} ↗</a>${p.installed && !p.signedIn ? ` · or sign in by running <code>${esc(p.id === 'claude' ? 'claude' : p.id)}</code> once` : ''}</p>`}
      ${note ? `<p class="ak-note ${note.ok ? 'ok' : 'bad'}">${esc(note.text)}</p>` : ''}
      ${p.ready ? `<div class="ak-def">${isDefault ? '<span class="ak-chip ok">Default for new tasks</span>' : `<button class="st-btn" data-default="${p.id}" ${edit ? '' : 'disabled'}>Make default</button>`}</div>` : ''}
    </div>`;
  };

  const chat = () => {
    const c = st!.chat;
    if (!c.options.length) return `<p class="ak-hint">Add any key above (or sign in to Claude Code) and the receptionist, project leads and HQ will talk back. Until then they read from a script.</p>`;
    return `<div class="st-row">
        <div class="st-act"><b>Voice of the office</b><span>Who answers at the desks, the project leads and HQ. Uses your key; it costs a little per message.</span></div>
        <div class="st-seg" role="radiogroup">${c.options.map((o) => `<button data-chat="${o}" aria-checked="${o === c.provider}" ${st!.canEdit ? '' : 'disabled'}>${esc(CHAT_LABEL[o] ?? o)}</button>`).join('')}</div>
      </div>
      ${c.models.length ? `<div class="st-row"><div class="st-act"><b>Model</b><span>Any model your key can use.</span></div>
        <select class="ak-model" data-model ${st!.canEdit ? '' : 'disabled'}>${(c.model && !c.models.includes(c.model) ? [c.model, ...c.models] : c.models).map((m) => `<option ${m === c.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>` : ''}`;
  };

  const render = () => {
    if (!st) { page.innerHTML = `<div class="st-empty">Checking which agents this computer can run…</div>`; return; }
    const anyReady = st.providers.some((p) => p.ready);
    page.innerHTML = `
      <div class="st-intro"><p>Use <b>your own</b> agents. Keys are saved only on this computer (in <code>~/.openworld/config.json</code>), sent only to the company that made the agent, and never shown again here.</p></div>
      ${st.canEdit ? '' : `<p class="st-note">Keys can only be changed on the computer running OpenWorld, not from a headset or another device.</p>`}
      ${anyReady ? '' : `<p class="st-note">No coding agent is ready yet. Set up one below. The world and your repos work without one.</p>`}
      <section class="st-group"><h4>GitHub</h4>
        <div class="st-row"><div class="st-act">${me?.connected
          ? `<b>Connected as ${esc(me.login ?? '')}</b><span>${me.tokenSource === 'gh' ? 'Using your GitHub CLI login (gh).' : me.tokenSource === 'env' ? 'Using GITHUB_TOKEN from your environment.' : 'Using the token you pasted.'}</span>`
          : `<b>Not connected</b><span>Run <code>gh auth login</code>, or paste a token with repo access.</span>`}</div>
          ${me?.connected ? '<em class="ak-chip ok">Connected</em>' : ''}</div>
        ${me && !me.connected && st.canEdit ? `<form class="ak-key" data-gh><input type="password" autocomplete="off" placeholder="GitHub token (repo scope)" /><button class="st-btn" type="submit">Connect</button></form>
          <p class="ak-get"><a href="https://github.com/settings/tokens/new?scopes=repo&description=OpenWorld" target="_blank" rel="noopener">Create a token ↗</a></p>` : ''}
        ${notes.get('gh') ? `<p class="ak-note ${notes.get('gh')!.ok ? 'ok' : 'bad'}">${esc(notes.get('gh')!.text)}</p>` : ''}
      </section>
      <section class="st-group"><h4>Coding agents</h4>${st.providers.map(card).join('')}</section>
      <section class="st-group"><h4>Conversations</h4>${chat()}</section>`;
  };

  const apply = (next: ProvidersState) => { st = next; void refreshProviders(next); render(); };
  const fail = (id: string, e: unknown) => { notes.set(id, { ok: false, text: (e as Error).message }); render(); };

  const onSubmit = async (e: Event) => {
    const form = (e.target as HTMLElement).closest('form');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input')!;
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    if (form.hasAttribute('data-gh')) {
      try { me = await api.saveToken(value); notes.set('gh', { ok: true, text: `Connected as ${me.login}. Reload to load your repos.` }); }
      catch (err) { notes.set('gh', { ok: false, text: (err as Error).message }); }
      render();
      return;
    }
    const id = form.dataset.key!;
    busy = id;
    notes.delete(id);
    render();
    try {
      const next = await providers.saveKey(id, value);
      notes.set(id, { ok: true, text: 'Saved. The key works.' });
      busy = null;
      apply(next);
    } catch (err) { busy = null; fail(id, err); }
  };
  const onClick = async (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const rm = t.closest<HTMLElement>('[data-remove]');
    const def = t.closest<HTMLElement>('[data-default]');
    const ch = t.closest<HTMLElement>('[data-chat]');
    try {
      if (rm) { notes.set(rm.dataset.remove!, { ok: true, text: 'Key removed from this computer.' }); apply(await providers.removeKey(rm.dataset.remove!)); }
      else if (def) apply(await providers.setDefault(def.dataset.default!));
      else if (ch) apply(await providers.setChat(ch.dataset.chat!));
    } catch (err) { fail(rm?.dataset.remove ?? def?.dataset.default ?? 'chat', err); }
  };
  const onChange = async (e: Event) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-model]');
    if (!sel || !st?.chat.provider) return;
    try { apply(await providers.setChat(st.chat.provider, sel.value)); } catch (err) { fail('chat', err); }
  };
  // Typing a key mustn't steer the robot.
  const stopKeys = (e: KeyboardEvent) => { if ((e.target as HTMLElement).matches('input, select')) e.stopPropagation(); };

  page.addEventListener('submit', onSubmit);
  page.addEventListener('click', onClick);
  page.addEventListener('change', onChange);
  page.addEventListener('keydown', stopKeys);
  render();
  void Promise.all([providers.state(), api.me().catch(() => null)]).then(([s, m]) => { me = m; apply(s); }, (err) => {
    page.innerHTML = `<div class="st-empty">Couldn't reach the OpenWorld server: ${esc((err as Error).message)}</div>`;
  });
  return () => {
    page.removeEventListener('submit', onSubmit);
    page.removeEventListener('click', onClick);
    page.removeEventListener('change', onChange);
    page.removeEventListener('keydown', stopKeys);
  };
}
