// Settings › Agents & keys: which coding agents this computer can run, the user's own keys for them,
// the default agent for new tasks, who voices the office, and the GitHub connection.
// Keys go straight to the local server and are never shown again (only the last 4 characters).
import type { CompatTest, Me, ProvidersState, ProviderStatus } from '../../../shared/types.ts';
import { api, providers } from '../api.ts';
import { esc } from '../interact.ts';
import { refreshProviders } from './agentPick.ts';

const CHAT_LABEL: Record<string, string> = {
  anthropic: 'Claude (Anthropic key)', 'claude-cli': 'Claude Code login', 'codex-cli': 'ChatGPT login (Codex)', openai: 'ChatGPT (OpenAI key)', gemini: 'Gemini key', xai: 'Grok (xAI key)', 'grok-cli': 'Grok login', compat: 'Other model',
};

/** OpenAI-compatible servers people actually use. Local ones need no key. */
const PRESETS: { id: string; label: string; url: string; key: boolean; keyUrl?: string; model?: string; note: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', key: true, keyUrl: 'https://openrouter.ai/keys', note: 'One key for hundreds of models: Claude, GPT, Gemini, Llama, DeepSeek, Qwen…' },
  { id: 'ollama', label: 'Ollama (this computer)', url: 'http://localhost:11434/v1', key: false, note: 'Free and private. Install from ollama.com, then run `ollama pull llama3.2`.' },
  { id: 'lmstudio', label: 'LM Studio (this computer)', url: 'http://localhost:1234/v1', key: false, note: 'Load a model, then start the server in the Developer tab.' },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', key: true, keyUrl: 'https://console.groq.com/keys', note: 'Very fast open models.' },
  { id: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1', key: true, keyUrl: 'https://console.mistral.ai/api-keys', note: '' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', key: true, keyUrl: 'https://platform.deepseek.com/api_keys', model: 'deepseek-chat', note: '' },
  { id: 'xai', label: 'xAI (Grok)', url: 'https://api.x.ai/v1', key: true, keyUrl: 'https://console.x.ai', note: '' },
  { id: 'together', label: 'Together AI', url: 'https://api.together.xyz/v1', key: true, keyUrl: 'https://api.together.ai/settings/api-keys', note: '' },
  { id: 'custom', label: 'Custom URL', url: '', key: true, note: 'Any server that speaks the OpenAI chat API (llama.cpp, vLLM, LiteLLM, Azure…).' },
];
const presetOf = (id: string | null | undefined) => PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
/** "Ollama", "OpenRouter", or the host of a custom server. */
const compatName = (c: { preset: string | null; baseUrl: string }) => {
  if (c.preset && c.preset !== 'custom') return presetOf(c.preset).label.replace(' (this computer)', '');
  try { return new URL(c.baseUrl).host; } catch { return CHAT_LABEL.compat; }
};

export function agentsTab(page: HTMLElement) {
  let st: ProvidersState | null = null;
  let me: Me | null = null;
  let busy: string | null = null;
  const notes = new Map<string, { ok: boolean; text: string }>();
  // The "other model" form keeps what you typed across re-renders.
  const cf = { preset: 'openrouter', baseUrl: PRESETS[0].url, key: '', model: '', models: [] as string[], init: false };

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
      ${!p.keyPrefix
        ? `<p class="ak-hint">Runs on ${st!.compat ? `<b>${esc(st!.compat.model)}</b> from Any other model` : 'any model'}: it uses the model you connect under <b>Any other model</b> (OpenRouter, Ollama, DeepSeek…), or any key saved above. Or run <code>opencode auth login</code> once.</p>
          <p class="ak-get"><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Models OpenCode supports ↗</a></p>`
        : p.key.fromEnv
        ? `<p class="ak-hint">Using the key from your environment (••••${esc(p.key.last4 ?? '')}).</p>`
        : `<form class="ak-key" data-key="${p.id}">
            <input type="password" autocomplete="off" spellcheck="false" placeholder="${p.key.set ? `Key saved ••••${esc(p.key.last4 ?? '')} · paste to replace` : `Paste your ${esc(p.vendor)} key (${esc(p.keyPrefix)}…)`}" ${edit ? '' : 'disabled'} />
            <button class="st-btn" type="submit" ${edit && busy !== p.id ? '' : 'disabled'}>${busy === p.id ? 'Checking…' : 'Save'}</button>
            ${p.key.set && edit ? `<button class="st-btn ghost" type="button" data-remove="${p.id}">Remove</button>` : ''}
          </form>
          <p class="ak-get"><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Get an API key from ${esc(p.vendor)} ↗</a>${p.installed && !p.signedIn ? ` · or sign in by running <code>${esc(p.id === 'codex' ? 'codex login' : p.id === 'grok' ? 'grok login' : p.id)}</code> once` : ''}</p>
          ${p.id === 'codex' && !p.signedIn ? `<p class="ak-hint">Have ChatGPT Plus, Pro or Team? Run <code>codex login</code> and choose <b>Sign in with ChatGPT</b>: no API key needed, for coding agents or for the office’s conversations.</p>` : ''}
          ${p.id === 'grok' && p.installed && !p.signedIn ? `<p class="ak-hint">Have SuperGrok or X Premium+? Run <code>grok login</code> once: no API key needed, for coding agents or for the office’s conversations.</p>` : ''}`}
      ${note ? `<p class="ak-note ${note.ok ? 'ok' : 'bad'}">${esc(note.text)}</p>` : ''}
      ${p.ready ? `<div class="ak-def">${isDefault ? '<span class="ak-chip ok">Default for new tasks</span>' : `<button class="st-btn" data-default="${p.id}" ${edit ? '' : 'disabled'}>Make default</button>`}</div>` : ''}
    </div>`;
  };

  const chat = () => {
    const c = st!.chat;
    if (!c.options.length) return `<p class="ak-hint">Add any key above, sign in to Claude Code, or connect another model below, and the receptionist, project leads and HQ will talk back. Until then they read from a script.</p>`;
    return `<div class="st-row">
        <div class="st-act"><b>Voice of the office</b><span>Who answers at the desks, the project leads and HQ. Uses your key; it costs a little per message.</span></div>
        <div class="st-seg" role="radiogroup">${c.options.map((o) => `<button data-chat="${o}" aria-checked="${o === c.provider}" ${st!.canEdit ? '' : 'disabled'}>${esc(o === 'compat' && st!.compat ? compatName(st!.compat) : CHAT_LABEL[o] ?? o)}</button>`).join('')}</div>
      </div>
      ${c.models.length ? `<div class="st-row"><div class="st-act"><b>Model</b><span>Any model your key can use.</span></div>
        <select class="ak-model" data-model ${st!.canEdit ? '' : 'disabled'}>${(c.model && !c.models.includes(c.model) ? [c.model, ...c.models] : c.models).map((m) => `<option ${m === c.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>` : ''}`;
  };

  const compat = () => {
    const c = st!.compat;
    if (!cf.init) {
      cf.init = true;
      if (c) Object.assign(cf, { preset: c.preset ?? 'custom', baseUrl: c.baseUrl, model: c.model });
    }
    const pr = presetOf(cf.preset);
    const edit = st!.canEdit && !c?.fromEnv;
    const note = notes.get('compat');
    return `<div class="ak-card ${c ? 'ready' : ''}">
      <div class="ak-head"><div><b>Any other model</b><small>OpenRouter, Ollama, LM Studio, Groq, Mistral, DeepSeek, xAI or any OpenAI-compatible server</small></div>
        ${c ? `<em class="ak-chip ok">Ready · ${esc(c.model)}</em>` : ''}</div>
      ${c?.fromEnv ? `<p class="ak-hint">Set by <code>OPENWORLD_LLM_BASE_URL</code> in your environment: ${esc(c.baseUrl)}</p>` : `
      <form class="ak-compat" data-compat>
        <label>Service<select data-cf="preset" ${edit ? '' : 'disabled'}>${PRESETS.map((p) => `<option value="${p.id}" ${p.id === cf.preset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label>Server URL<input data-cf="baseUrl" spellcheck="false" autocomplete="off" placeholder="https://…/v1" value="${esc(cf.baseUrl)}" ${edit ? '' : 'disabled'} /></label>
        ${pr.key ? `<label>API key${cf.preset === 'custom' ? ' (if it needs one)' : ''}<input data-cf="key" type="password" spellcheck="false" autocomplete="off" placeholder="${c?.key.set && c.baseUrl === cf.baseUrl ? `Saved ••••${esc(c.key.last4 ?? '')} · paste to replace` : 'Paste your key'}" value="${esc(cf.key)}" ${edit ? '' : 'disabled'} /></label>` : ''}
        <label>Model<input data-cf="model" list="ak-compat-models" spellcheck="false" autocomplete="off" placeholder="${cf.models.length ? 'Pick or type a model' : 'Test to list models, or type one'}" value="${esc(cf.model)}" ${edit ? '' : 'disabled'} />
          <datalist id="ak-compat-models">${cf.models.slice(0, 400).map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist></label>
        <div class="ak-compat-btns">
          <button class="st-btn" type="button" data-cf-test ${edit && !busy ? '' : 'disabled'}>${busy === 'compat-test' ? 'Testing…' : 'Test connection'}</button>
          <button class="st-btn" type="submit" ${edit && !busy ? '' : 'disabled'}>${busy === 'compat' ? 'Saving…' : 'Save and use'}</button>
          ${c && edit ? `<button class="st-btn ghost" type="button" data-cf-remove>Remove</button>` : ''}
        </div>
      </form>
      ${pr.note ? `<p class="ak-hint">${esc(pr.note).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` : ''}
      ${pr.keyUrl ? `<p class="ak-get"><a href="${esc(pr.keyUrl)}" target="_blank" rel="noopener">Get a ${esc(pr.label)} key ↗</a></p>` : ''}`}
      ${note ? `<p class="ak-note ${note.ok ? 'ok' : 'bad'}">${esc(note.text)}</p>` : ''}
      <p class="ak-hint">Used for conversations (HQ, the leads, the desks). For coding tasks with this model too, install OpenCode above.</p>
    </div>`;
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
      <section class="st-group"><h4>Conversations</h4>${chat()}${compat()}</section>`;
  };

  const apply = (next: ProvidersState) => { st = next; void refreshProviders(next); render(); };
  const fail = (id: string, e: unknown) => { notes.set(id, { ok: false, text: (e as Error).message }); render(); };

  const onSubmit = async (e: Event) => {
    const form = (e.target as HTMLElement).closest('form');
    if (!form) return;
    e.preventDefault();
    if (form.hasAttribute('data-compat')) { void compatSave(); return; }
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
  const compatBody = () => ({ preset: cf.preset === 'custom' ? undefined : cf.preset, baseUrl: cf.baseUrl.trim(), key: cf.key.trim() || undefined, model: cf.model.trim() });
  const compatTest = async () => {
    busy = 'compat-test'; notes.delete('compat'); render();
    try {
      const r: CompatTest = await providers.testCompat(compatBody());
      cf.models = r.models;
      if (!cf.model && r.models.length === 1) cf.model = r.models[0];
      notes.set('compat', { ok: r.ok, text: r.message });
    } catch (err) { notes.set('compat', { ok: false, text: (err as Error).message }); }
    busy = null; render();
  };
  const compatSave = async () => {
    if (!cf.model.trim()) { notes.set('compat', { ok: false, text: 'Pick a model first (Test connection lists them).' }); render(); return; }
    busy = 'compat'; notes.delete('compat'); render();
    try {
      const next = await providers.saveCompat(compatBody());
      cf.key = '';
      notes.set('compat', { ok: true, text: `Saved. The office now talks with ${cf.model}.` });
      busy = null; apply(next);
    } catch (err) { busy = null; fail('compat', err); }
  };
  const onInput = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>('[data-cf]');
    if (!el) return;
    const k = el.dataset.cf as 'preset' | 'baseUrl' | 'key' | 'model';
    if (k === 'preset') {
      if (e.type !== 'change') return;
      const pr = presetOf(el.value);
      Object.assign(cf, { preset: pr.id, baseUrl: pr.url || cf.baseUrl, model: pr.model ?? '', models: [], key: '' });
      notes.delete('compat');
      render();
    } else cf[k] = el.value;
  };

  const onClick = async (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-cf-test]')) { void compatTest(); return; }
    if (t.closest('[data-cf-remove]')) {
      try { const next = await providers.removeCompat(); notes.set('compat', { ok: true, text: 'Removed.' }); cf.init = false; apply(next); } catch (err) { fail('compat', err); }
      return;
    }
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
    if ((e.target as HTMLElement).closest('[data-cf]')) { onInput(e); return; }
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-model]');
    if (!sel || !st?.chat.provider) return;
    try { apply(await providers.setChat(st.chat.provider, sel.value)); } catch (err) { fail('chat', err); }
  };
  // Typing a key mustn't steer the robot.
  const stopKeys = (e: KeyboardEvent) => { if ((e.target as HTMLElement).matches('input, select')) e.stopPropagation(); };

  page.addEventListener('submit', onSubmit);
  page.addEventListener('click', onClick);
  page.addEventListener('change', onChange);
  page.addEventListener('input', onInput);
  page.addEventListener('keydown', stopKeys);
  render();
  void Promise.all([providers.state(), api.me().catch(() => null)]).then(([s, m]) => { me = m; apply(s); }, (err) => {
    page.innerHTML = `<div class="st-empty">Couldn't reach the OpenWorld server: ${esc((err as Error).message)}</div>`;
  });
  return () => {
    page.removeEventListener('submit', onSubmit);
    page.removeEventListener('click', onClick);
    page.removeEventListener('change', onChange);
    page.removeEventListener('input', onInput);
    page.removeEventListener('keydown', stopKeys);
  };
}
