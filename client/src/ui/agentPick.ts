// Which coding agent takes the next task (Claude Code, Codex, Gemini, Grok, OpenCode). One choice shared by every
// "give a task" box, remembered in this browser; the server falls back to the user's default when it's unset.
import type { ProvidersState, ProviderStatus } from '../../../shared/types.ts';
import { providers } from '../api.ts';
import { esc } from '../interact.ts';
import './agentPick.css';

const KEY = 'ow.agent';
let state: ProvidersState | null = null;
let loading: Promise<ProvidersState | null> | null = null;
const listeners = new Set<() => void>();

const SHORT: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', opencode: 'OpenCode' };
export const agentShort = (id?: string | null) => SHORT[id ?? 'claude'] ?? id ?? 'Claude';

export function providersState() { return state; }
export function onProviders(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

/** Fetch (or refetch after a key change) and tell every picker. */
export function refreshProviders(next?: ProvidersState): Promise<ProvidersState | null> {
  if (next) { state = next; listeners.forEach((l) => l()); return Promise.resolve(state); }
  loading = providers.state().then((s) => { state = s; listeners.forEach((l) => l()); return s; }, () => state).finally(() => { loading = null; });
  return loading;
}
const ensure = () => state ? Promise.resolve(state) : loading ?? refreshProviders();

export const readyAgents = (): ProviderStatus[] => state?.providers.filter((p) => p.ready) ?? [];

/** The agent a new task should go to: the last one picked here if it's still ready, else the default. */
export function pickedAgent(): string | null {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  const ready = readyAgents().map((p) => p.id);
  if (saved && ready.includes(saved as never)) return saved;
  return state?.defaultProvider ?? null;
}
function pick(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}

/**
 * A compact "who does it" control for task boxes: pills when more than one agent is ready, a quiet label for one,
 * and a pointer to Settings when none is (the task box still works in the fake/test modes the server allows).
 */
export function agentPicker(opts: { onSettings?: () => void } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'agent-pick';
  const render = () => {
    // A box that has left the page stops listening the next time anything changes.
    if (el.dataset.mounted && !el.isConnected) { off(); return; }
    if (el.isConnected) el.dataset.mounted = '1';
    const ready = readyAgents();
    const cur = pickedAgent();
    if (!state) { el.innerHTML = ''; return; }
    if (!ready.length) {
      el.innerHTML = `<span class="ap-none">No agent set up yet · <button type="button" class="ap-link" data-settings>Add one in Settings</button></span>`;
    } else if (ready.length === 1) {
      el.innerHTML = `<span class="ap-one" title="${esc(ready[0].label)} takes this task">${esc(ready[0].label)}</span>`;
    } else {
      el.innerHTML = `<span class="ap-label">Agent</span>${ready.map((p) => `<button type="button" class="ap-pill" data-agent="${p.id}" aria-pressed="${p.id === cur}" title="${esc(p.label)} (${esc(p.vendor)})">${esc(agentShort(p.id))}</button>`).join('')}`;
    }
  };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-agent]');
    if (b) { pick(b.dataset.agent!); return; }
    if (t.closest('[data-settings]')) opts.onSettings ? opts.onSettings() : void import('./settings.ts').then((m) => m.openSettings('agents'));
  });
  const off = onProviders(render);
  render();
  void ensure();
  return el;
}
