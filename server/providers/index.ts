// Which coding agents this machine can run, and the user's own keys for them.
// Keys are read from ~/.openworld/config.json (mode 0600) or the usual env vars, passed only to the agent's child
// process or the vendor's API, and never sent to the browser: the client only ever sees the last 4 characters.
import type { Express, Request } from 'express';
import type { AgentProviderId, ChatProviderId, ProviderStatus, ProvidersState } from '../../shared/types.ts';
import { readConfig, writeConfig, logEvent, type Config } from '../config.ts';
import type { AgentRunner, KeySlot } from './common.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';
import { gemini } from './gemini.ts';
import { compatConfig, compatModels, compatStatus, normalizeBaseUrl, testCompat } from './compat.ts';

export const RUNNERS: AgentRunner[] = [claude, codex, gemini];
export const runner = (id: AgentProviderId | string | null | undefined) => RUNNERS.find((r) => r.id === id) ?? null;

const ENV_KEYS: Record<KeySlot, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

/** The key for a vendor: env wins over the stored one. */
export function keyFor(slot: KeySlot): { key: string | null; fromEnv: boolean } {
  for (const name of ENV_KEYS[slot]) if (process.env[name]) return { key: process.env[name]!, fromEnv: true };
  return { key: readConfig().keys?.[slot] || null, fromEnv: false };
}

/** Env for an agent's child process: the user's key under every name that CLI reads, nothing else added. */
export function runnerEnv(r: AgentRunner): Record<string, string> {
  const { key } = keyFor(r.keySlot);
  return key ? Object.fromEntries(r.keyEnv.map((n) => [n, key])) : {};
}

// detect() shells out to `--version`; cache it briefly so status polls stay cheap.
let detected: { at: number; out: Map<AgentProviderId, Awaited<ReturnType<AgentRunner['detect']>>> } | null = null;
async function detectAll(force = false) {
  if (!force && detected && Date.now() - detected.at < 60_000) return detected.out;
  const out = new Map(await Promise.all(RUNNERS.map(async (r) => [r.id, await r.detect()] as const)));
  detected = { at: Date.now(), out };
  return out;
}

export async function providerStatuses(force = false): Promise<ProviderStatus[]> {
  const found = await detectAll(force);
  return RUNNERS.map((r) => {
    const d = found.get(r.id)!;
    const { key, fromEnv } = keyFor(r.keySlot);
    const ready = d.installed && (d.signedIn || !!key);
    const hint = ready ? null
      : d.hint ?? (!d.installed ? `Install ${r.label}: ${r.installCmd}` : `Sign in with \`${r.bin}\` once, or add your ${r.vendor} key`);
    return {
      id: r.id, label: r.label, vendor: r.vendor, installed: d.installed, version: d.version, signedIn: d.signedIn,
      key: { set: !!key, last4: key ? key.slice(-4) : null, fromEnv }, ready, hint,
      installCmd: r.installCmd, keyUrl: r.keyUrl, keyPrefix: r.keyPrefix,
    };
  });
}

/** The agent a new task goes to: the requested one if ready, else the user's default, else the first ready one. */
export async function pickProvider(requested?: string | null): Promise<AgentProviderId | null> {
  const ready = (await providerStatuses()).filter((p) => p.ready).map((p) => p.id);
  if (requested && ready.includes(requested as AgentProviderId)) return requested as AgentProviderId;
  if (requested && runner(requested)) {
    const st = (await providerStatuses()).find((p) => p.id === requested)!;
    throw Object.assign(new Error(`${st.label} isn't ready. ${st.hint ?? ''}`.trim()), { status: 400 });
  }
  const def = readConfig().defaultProvider;
  if (def && ready.includes(def)) return def;
  return ready[0] ?? null;
}

// ---------- Chat (HQ, project leads, desk talk) ----------

const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const CLI_MODELS = ['sonnet', 'opus', 'haiku'];
/** Used until the key has been checked and the vendor's own model list is known. */
export const FALLBACK_MODEL: Record<ChatProviderId, string> = {
  anthropic: 'claude-sonnet-5-5',
  'claude-cli': 'sonnet',
  'codex-cli': '',
  openai: 'gpt-5.6-terra',
  gemini: 'gemini-3.6-flash',
  compat: '',
};
let compatListed: string[] = [];
const listed = new Map<KeySlot, string[]>();

const version = (id: string) => (id.match(/\d+(\.\d+)?/g) ?? ['0']).map(Number).reduce((a, n, i) => a + n / 1000 ** i, 0);
const newestFirst = (ids: string[]) => [...ids].sort((a, b) => version(b) - version(a) || a.localeCompare(b));

/** Vendor model lists, trimmed to models that make sense for a chatty character. */
async function fetchModels(slot: KeySlot, key: string): Promise<{ ok: boolean; status: number; models: string[] }> {
  const ctrl = AbortSignal.timeout(10_000);
  if (slot === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: ctrl });
    const body: any = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, models: newestFirst((body?.data ?? []).map((m: any) => m.id).filter((id: string) => id.startsWith('claude-'))) };
  }
  if (slot === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, signal: ctrl });
    const body: any = res.ok ? await res.json() : null;
    const ids = (body?.data ?? []).map((m: any) => String(m.id))
      .filter((id: string) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|image|embedding|search|instruct|codex|\d{4}-\d{2}-\d{2})/.test(id));
    return { ok: res.ok, status: res.status, models: newestFirst(ids) };
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal: ctrl });
  const body: any = res.ok ? await res.json() : null;
  const ids = (body?.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''))
    .filter((id: string) => id.startsWith('gemini-') && !/(embedding|tts|image|live|audio|exp|preview)/.test(id));
  return { ok: res.ok, status: res.status, models: newestFirst(ids) };
}

function modelsFor(p: ChatProviderId): string[] {
  if (p === 'claude-cli') return CLI_MODELS;
  if (p === 'codex-cli') return [];
  if (p === 'compat') return compatListed;
  if (p === 'anthropic') return listed.get('anthropic')?.length ? [...new Set([...ANTHROPIC_MODELS, ...listed.get('anthropic')!])] : ANTHROPIC_MODELS;
  return listed.get(p) ?? [];
}

/** A sensible default per vendor: Sonnet, or the newest everyday (non-mini/pro) model the key can use. */
function defaultModel(p: ChatProviderId): string {
  const list = modelsFor(p);
  if (p === 'openai') return list.find((m) => /^gpt-\d/.test(m) && !/(mini|nano|pro|cyber)/.test(m)) ?? list[0] ?? FALLBACK_MODEL.openai;
  if (p === 'gemini') return list.find((m) => /flash/.test(m) && !/lite/.test(m)) ?? list[0] ?? FALLBACK_MODEL.gemini;
  if (p === 'compat') return compatConfig()?.model || list[0] || '';
  return FALLBACK_MODEL[p];
}

async function chatOptions(): Promise<ChatProviderId[]> {
  const st = await providerStatuses();
  const opts: ChatProviderId[] = [];
  if (keyFor('anthropic').key) opts.push('anthropic');
  if (st.find((p) => p.id === 'claude')?.installed && st.find((p) => p.id === 'claude')?.signedIn) opts.push('claude-cli');
  // Signed in to Codex with a ChatGPT account: the office can talk through it with no API key.
  if (st.find((p) => p.id === 'codex')?.installed && st.find((p) => p.id === 'codex')?.signedIn) opts.push('codex-cli');
  if (keyFor('openai').key) opts.push('openai');
  if (keyFor('gemini').key) opts.push('gemini');
  if (compatConfig()?.model) opts.push('compat');
  return opts;
}

/** Who voices the office: the user's pick if still usable, else the first that works. null = scripted lines only. */
export async function chatProvider(): Promise<{ provider: ChatProviderId; model: string } | null> {
  const opts = await chatOptions();
  const want = readConfig().chat;
  const provider = want?.provider && opts.includes(want.provider) ? want.provider : opts[0];
  if (!provider) return null;
  const model = want?.provider === provider && want.model ? want.model : defaultModel(provider);
  return { provider, model };
}

export async function providersState(req?: Request): Promise<ProvidersState> {
  const [providers, chat, options] = await Promise.all([providerStatuses(), chatProvider(), chatOptions()]);
  const def = readConfig().defaultProvider;
  const ready = providers.filter((p) => p.ready).map((p) => p.id);
  return {
    providers,
    defaultProvider: def && ready.includes(def) ? def : ready[0] ?? null,
    chat: { provider: chat?.provider ?? null, model: chat?.model ?? null, models: chat ? modelsFor(chat.provider) : [], options },
    compat: compatStatus(),
    canEdit: !req || isLocal(req),
  };
}

// ---------- Routes ----------

const isLocal = (req: Request) => {
  const a = req.socket.remoteAddress;
  return !a || a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};
const SLOT: Record<AgentProviderId, KeySlot> = { claude: 'anthropic', codex: 'openai', gemini: 'gemini' };

function checkFormat(r: AgentRunner, key: string) {
  if (!key) return 'Paste a key first';
  if (/\s/.test(key)) return 'That key has spaces in it. Copy it again';
  if (key.length < 20 || key.length > 400) return `That doesn't look like an API key from ${r.vendor}`;
  if (!key.startsWith(r.keyPrefix)) return `${r.vendor} keys start with "${r.keyPrefix}"`;
  return null;
}

export function registerProviders(app: Express, h: (fn: (req: Request, res: any) => Promise<unknown>) => any) {
  const localOnly = (req: Request) => {
    if (!isLocal(req)) throw Object.assign(new Error('Keys can only be changed on the computer running OpenWorld'), { status: 403 });
  };
  const known = (id: string) => {
    const r = runner(id);
    if (!r) throw Object.assign(new Error(`Unknown agent ${id}`), { status: 404 });
    return r;
  };

  app.get('/api/providers', h(async (req) => providersState(req)));

  app.post('/api/providers/:id/key', h(async (req) => {
    localOnly(req);
    const r = known(String(req.params.id));
    const key = String(req.body?.key ?? '').trim();
    const bad = checkFormat(r, key);
    if (bad) throw Object.assign(new Error(bad), { status: 400 });
    let check: Awaited<ReturnType<typeof fetchModels>> | null = null;
    try {
      check = await fetchModels(r.keySlot, key);
    } catch {
      /* offline: keep the key, it gets checked on first use */
    }
    // 4xx (Google answers a bad key with 400) means the key is wrong; 429 just means it's busy, so keep it.
    if (check && !check.ok && check.status >= 400 && check.status < 500 && check.status !== 429) throw Object.assign(new Error(`${r.vendor} rejected that key`), { status: 400 });
    if (check?.ok) listed.set(r.keySlot, check.models);
    const cfg = readConfig();
    writeConfig({ keys: { ...cfg.keys, [SLOT[r.id]]: key } });
    detected = null;
    logEvent('provider_key_saved', { provider: r.id, verified: !!check?.ok });
    return providersState(req);
  }));

  app.delete('/api/providers/:id/key', h(async (req) => {
    localOnly(req);
    const r = known(String(req.params.id));
    const keys = { ...readConfig().keys };
    delete keys[SLOT[r.id]];
    writeConfig({ keys });
    listed.delete(r.keySlot);
    logEvent('provider_key_removed', { provider: r.id });
    return providersState(req);
  }));

  app.post('/api/providers/default', h(async (req) => {
    localOnly(req);
    const r = known(String(req.body?.provider ?? ''));
    writeConfig({ defaultProvider: r.id });
    return providersState(req);
  }));

  app.post('/api/providers/chat', h(async (req) => {
    localOnly(req);
    const provider = String(req.body?.provider ?? '') as ChatProviderId;
    if (!(await chatOptions()).includes(provider)) throw Object.assign(new Error('That chat option needs a key or a signed-in CLI first'), { status: 400 });
    const model = String(req.body?.model ?? '').trim().slice(0, 80) || undefined;
    const chat: Config['chat'] = { provider, model };
    writeConfig({ chat });
    return providersState(req);
  }));

  // ---- Any OpenAI-compatible endpoint ----
  const compatBody = (req: Request) => {
    const baseUrl = normalizeBaseUrl(String(req.body?.baseUrl ?? ''));
    if (!baseUrl) throw Object.assign(new Error('Enter the server URL, e.g. http://localhost:11434/v1'), { status: 400 });
    let key = String(req.body?.key ?? '').trim() || undefined;
    if (key && /\s/.test(key)) throw Object.assign(new Error('That key has spaces in it. Copy it again'), { status: 400 });
    // Testing again without retyping the key: reuse the saved one, but only for the same server.
    const saved = readConfig().compat;
    if (!key && saved?.key && saved.baseUrl === baseUrl) key = saved.key;
    const preset = String(req.body?.preset ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 32) || undefined;
    const model = String(req.body?.model ?? '').trim().slice(0, 200);
    return { baseUrl, key, preset, model };
  };

  app.post('/api/providers/compat/test', h(async (req) => {
    localOnly(req);
    const c = compatBody(req);
    return testCompat(c);
  }));

  app.post('/api/providers/compat', h(async (req) => {
    localOnly(req);
    const c = compatBody(req);
    if (!c.model) throw Object.assign(new Error('Pick a model first'), { status: 400 });
    const t = await testCompat(c);
    if (!t.ok) throw Object.assign(new Error(t.message), { status: 400 });
    compatListed = t.models;
    writeConfig({ compat: { baseUrl: c.baseUrl, model: c.model, ...(c.key ? { key: c.key } : {}), ...(c.preset ? { preset: c.preset } : {}) }, chat: { provider: 'compat', model: c.model } });
    logEvent('provider_compat_saved', { preset: c.preset ?? 'custom', keyed: !!c.key });
    return providersState(req);
  }));

  app.delete('/api/providers/compat', h(async (req) => {
    localOnly(req);
    const cfg = readConfig();
    writeConfig({ compat: undefined, ...(cfg.chat?.provider === 'compat' ? { chat: undefined } : {}) });
    compatListed = [];
    logEvent('provider_compat_removed', {});
    return providersState(req);
  }));

  // Refresh model lists for stored keys in the background so the chat picker is filled after a restart.
  for (const slot of ['anthropic', 'openai', 'gemini'] as KeySlot[]) {
    const { key } = keyFor(slot);
    if (key) fetchModels(slot, key).then((m) => m.ok && listed.set(slot, m.models), () => {});
  }
  const cc = compatConfig();
  if (cc) compatModels(cc).then((m) => { compatListed = m; }, () => {});
}
