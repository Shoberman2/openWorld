import { createInterface } from 'node:readline';
import { PATHS, MODEL, hasClaude, spawnProc } from './config.ts';

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

export async function streamClaude(opts: StreamOpts): Promise<string> {
  const model = opts.model || MODEL;
  if (process.env.ANTHROPIC_API_KEY) return streamApi({ ...opts, model });
  if (await hasClaude()) return streamCli({ ...opts, model });
  const text = opts.fallback || '(No AI available — install Claude Code to bring the office to life.)';
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

async function streamApi(opts: StreamOpts & { model: string }): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
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
  let full = '';
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          full += ev.delta.text;
          opts.onDelta?.(ev.delta.text);
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
