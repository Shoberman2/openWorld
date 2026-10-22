// Any OpenAI-compatible chat endpoint: OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, or a model running on
// this computer (Ollama, LM Studio, llama.cpp). Base URL + optional key + model, from Settings or env:
// OPENWORLD_LLM_BASE_URL, OPENWORLD_LLM_API_KEY, OPENWORLD_LLM_MODEL. The key never leaves the server.
import type { CompatStatus, CompatTest } from '../../shared/types.ts';
import { readConfig } from '../config.ts';

export interface Compat { preset?: string; baseUrl: string; key?: string; model: string; fromEnv: boolean }

/** The endpoint in use: env wins over the stored one. */
export function compatConfig(): Compat | null {
  const env = process.env.OPENWORLD_LLM_BASE_URL;
  if (env) return { baseUrl: env, key: process.env.OPENWORLD_LLM_API_KEY || undefined, model: process.env.OPENWORLD_LLM_MODEL || '', fromEnv: true };
  const c = readConfig().compat;
  return c?.baseUrl ? { ...c, fromEnv: false } : null;
}

export function compatStatus(): CompatStatus | null {
  const c = compatConfig();
  if (!c) return null;
  return { preset: c.preset ?? null, baseUrl: c.baseUrl, model: c.model, key: { set: !!c.key, last4: c.key ? c.key.slice(-4) : null }, fromEnv: c.fromEnv };
}

/** "https://openrouter.ai/api/v1/" -> "https://openrouter.ai/api/v1", or null if it isn't an http(s) URL. */
export function normalizeBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  } catch {
    return null;
  }
}

const headers = (key?: string) => ({ 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) });

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/;

/** Turn a fetch failure into something a person can act on. */
function explain(baseUrl: string, err: unknown): string {
  const code = (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
  const name = (err as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return `${baseUrl} didn't answer within 20 seconds.`;
  if (code === 'ECONNREFUSED') {
    if (/:11434/.test(baseUrl)) return `Nothing is answering at ${baseUrl}. Is Ollama running? Start it with \`ollama serve\`.`;
    if (/:1234/.test(baseUrl)) return `Nothing is answering at ${baseUrl}. In LM Studio, open the Developer tab and start the server.`;
    return `Nothing is answering at ${baseUrl}. Is the server running?`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Couldn't find ${new URL(baseUrl).host}. Check the URL and your internet connection.`;
  return `Couldn't reach ${baseUrl}: ${(err as Error)?.message ?? 'unknown error'}`;
}

async function errorText(res: globalThis.Response) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message ?? j?.error ?? j?.message ?? body).slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** List the models, then send a one-word message so the key, the URL and the model are all proven. */
export async function testCompat(c: { baseUrl: string; key?: string; model?: string }): Promise<CompatTest> {
  const timeout = () => AbortSignal.timeout(20_000);
  let models: string[] = [];
  try {
    const res = await fetch(`${c.baseUrl}/models`, { headers: headers(c.key), signal: timeout() });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, models, message: c.key ? `The server rejected that key (${res.status}). Copy it again, or create a new one.` : `This server needs an API key (${res.status}).` };
    }
    if (res.ok) {
      const body: any = await res.json().catch(() => null);
      models = (body?.data ?? body?.models ?? []).map((m: any) => String(m?.id ?? m?.name ?? m)).filter(Boolean).sort();
    }
  } catch (err) {
    return { ok: false, models, message: explain(c.baseUrl, err) };
  }
  const model = c.model?.trim();
  if (!model) {
    return models.length
      ? { ok: false, models, message: `Connected. Pick a model (${models.length} available) and test again.` }
      : { ok: false, models, message: LOCAL.test(c.baseUrl) ? 'Connected, but no models are installed. For Ollama, run `ollama pull llama3.2` first.' : 'Connected. Type the model name and test again.' };
  }
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(c.key),
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Say hi.' }] }),
      signal: timeout(),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, models, message: `The server rejected the key (${res.status}).` };
    if (res.status === 404 || (res.status === 400 && models.length && !models.includes(model))) {
      return { ok: false, models, message: `The model "${model}" wasn't found there.${models.length ? ' Pick one from the list.' : ''} (${await errorText(res)})` };
    }
    if (!res.ok) return { ok: false, models, message: `The server answered ${res.status}: ${await errorText(res)}` };
    const body: any = await res.json().catch(() => null);
    const said = String(body?.choices?.[0]?.message?.content ?? '').trim();
    return { ok: true, models, message: `It works. ${model} says: "${said.slice(0, 60) || '…'}"` };
  } catch (err) {
    return { ok: false, models, message: explain(c.baseUrl, err) };
  }
}

/** Model list for the picker (best effort, cached by the caller). */
export async function compatModels(c: Compat): Promise<string[]> {
  try {
    const res = await fetch(`${c.baseUrl}/models`, { headers: headers(c.key), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const body: any = await res.json();
    return (body?.data ?? body?.models ?? []).map((m: any) => String(m?.id ?? m?.name ?? m)).filter(Boolean).sort();
  } catch {
    return [];
  }
}

/** One streamed chat reply from the configured endpoint. */
export function compatRequest(c: Compat, model: string, system: string, prompt: string, signal?: AbortSignal) {
  return fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(c.key),
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 1500,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    signal,
  });
}
