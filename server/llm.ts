import { createInterface } from 'node:readline';
import { PATHS, spawnProc } from './config.ts';
import { chatProvider, keyFor } from './providers/index.ts';
import { compatConfig, compatRequest } from './providers/compat.ts';

export interface StreamOpts {
  system: string;
  prompt: string;
  model?: string;
  onDelta?: (text: string) => void;
  /** Used when no LLM is available, so the game keeps working offline. */
  fallback?: string;
  signal?: AbortSignal;
}

const API_MODELS: Record<string, string> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-5-5',
};

/**
 * One reply for HQ, a project lead or a desk, from whichever chat the user set up in Settings → Agents & keys:
 * their Anthropic, OpenAI or Gemini key, a signed-in Claude Code, or any OpenAI-compatible server (OpenRouter, Ollama…). OPENWORLD_MODEL still overrides the model.
 */
export async function streamClaude(opts: StreamOpts): Promise<string> {
  const chat = await chatProvider();
  const model = opts.model || process.env.OPENWORLD_MODEL || chat?.model || '';
  if (chat?.provider === 'anthropic') return streamApi({ ...opts, model });
  if (chat?.provider === 'claude-cli') return streamCli({ ...opts, model });
  if (chat?.provider === 'codex-cli') return streamCodex({ ...opts, model });
  if (chat?.provider === 'openai') return streamOpenAi({ ...opts, model });
  if (chat?.provider === 'gemini') return streamGemini({ ...opts, model });
  if (chat?.provider === 'compat') return streamCompat({ ...opts, model });
  const text = opts.fallback || '(No AI set up yet. Add a key in Settings → Agents & keys to bring the office to life.)';
  // emit in small chunks so the UI still "types"
  for (const chunk of text.match(/.{1,24}(\s|$)|.+/g) || [text]) {
    opts.onDelta?.(chunk);
    await new Promise((r) => setTimeout(r, 15));
  }
  return text;
}

function streamCli(opts: StreamOpts & { model: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnProc(
      'claude',
      [
        '-p',
        '--model', opts.model,
        '--tools', '',
        '--system-prompt', opts.system,
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--setting-sources', '',
      ],
      { cwd: PATHS.home, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let full = '';
    let resultText = '';
    let stderr = '';
    opts.signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stderr!.on('data', (d) => (stderr += d));
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
        full += msg.event.delta.text;
        opts.onDelta?.(msg.event.delta.text);
      } else if (msg.type === 'result') {
        resultText = typeof msg.result === 'string' ? msg.result : '';
        if (msg.is_error && !full) stderr += resultText;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!full && resultText) {
        full = resultText;
        opts.onDelta?.(resultText);
      }
      if (!full && code !== 0) reject(new Error(stderr.trim() || `claude exited with ${code}`));
      else resolve(full);
    });
    child.stdin!.end(opts.prompt);
  });
}

/** One reply through `codex exec` (the user's ChatGPT login): read-only sandbox, no streaming, the final message. */
function streamCodex(opts: StreamOpts & { model: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', ...(opts.model ? ['--model', opts.model] : []), '-'];
    const child = spawnProc('codex', args, { cwd: PATHS.home, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    let stderr = '';
    opts.signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stderr!.on('data', (d) => (stderr += d));
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'item.completed' && msg.item?.type === 'agent_message' && msg.item.text) text = String(msg.item.text);
        else if (msg.type === 'error' || msg.type === 'turn.failed') stderr += String(msg.message ?? msg.error?.message ?? '');
      } catch {
        /* not JSON */
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!text) return reject(new Error(stderr.trim().slice(0, 300) || `codex exited with ${code}`));
      opts.onDelta?.(text);
      resolve(text);
    });
    child.stdin!.end(`${opts.system}\n\nReply in character. Do not run commands or edit files.\n\n${opts.prompt}`);
  });
}

async function streamApi(opts: StreamOpts & { model: string }): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': keyFor('anthropic').key!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: API_MODELS[opts.model] || opts.model,
      max_tokens: 1500,
      system: opts.system,
      stream: true,
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return readSse(res, opts, (ev) => (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : ''));
}

async function streamOpenAi(opts: StreamOpts & { model: string }): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${keyFor('openai').key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_completion_tokens: 1500,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.prompt }],
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return readSse(res, opts, (ev) => ev.choices?.[0]?.delta?.content ?? '');
}

async function streamCompat(opts: StreamOpts & { model: string }): Promise<string> {
  const c = compatConfig();
  if (!c) throw new Error('No OpenAI-compatible server is set up');
  const res = await compatRequest(c, opts.model, opts.system, opts.prompt, opts.signal);
  if (!res.ok || !res.body) throw new Error(`${new URL(c.baseUrl).host} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return readSse(res, opts, (ev) => ev.choices?.[0]?.delta?.content ?? '');
}

async function streamGemini(opts: StreamOpts & { model: string }): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': keyFor('gemini').key!, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: { maxOutputTokens: 1500 },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return readSse(res, opts, (ev) => (ev.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join(''));
}

/** Read a `data: {...}` event stream, pulling the new text out of each event. */
async function readSse(res: globalThis.Response, opts: StreamOpts, textOf: (ev: any) => string): Promise<string> {
  let full = '';
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      try {
        const text = textOf(JSON.parse(line.slice(5)));
        if (text) {
          full += text;
          opts.onDelta?.(text);
        }
      } catch {
        /* keep-alive */
      }
    }
  }
  return full;
}

/** Render a chat transcript into a single prompt for a one-shot call. */
export function transcriptPrompt(messages: { role: 'user' | 'assistant'; content: string }[], opener: string) {
  if (!messages.length) return opener;
  const lines = messages.map((m) => `${m.role === 'user' ? 'Visitor' : 'You'}: ${m.content}`);
  return `Conversation so far:\n\n${lines.join('\n\n')}\n\nReply as yourself to the visitor's last message. Output only your spoken reply.`;
}
