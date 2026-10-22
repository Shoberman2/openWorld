// What every coding-agent CLI (Claude Code, Codex, Gemini, Grok, OpenCode) has to provide so a run can happen at a desk.
import type { AgentEvent, AgentProviderId } from '../../shared/types.ts';
import { run } from '../config.ts';

export type ParsedEvent = AgentEvent & { toolName?: string };

/** One line of the CLI's JSON stream, turned into game events. */
export interface Parsed {
  events: ParsedEvent[];
  sessionId?: string;
}

export type KeySlot = 'anthropic' | 'openai' | 'gemini' | 'xai';

export interface AgentRunner {
  id: AgentProviderId;
  label: string;
  vendor: string;
  bin: string;
  installCmd: string;
  keyUrl: string;
  keyPrefix: string;
  /** null for an agent with no vendor key of its own (OpenCode borrows the others'). */
  keySlot: KeySlot | null;
  /** Env var(s) the CLI reads its key from; the stored key is passed to the child process only. */
  keyEnv: string[];
  /** For agents without a key slot: whether a model is available to it some other way. */
  hasModel?(keyOf: (slot: KeySlot) => string | null): boolean;
  /** Extra env for the child process (built fresh for every run, never sent to the browser). */
  env?(keyOf: (slot: KeySlot) => string | null): Record<string, string>;
  /** Installed, new enough, and signed in through the CLI's own login. */
  detect(): Promise<{ installed: boolean; version: string | null; signedIn: boolean; hint?: string }>;
  /** argv for a fresh run (sessionId null) or a resumed one in `dir`; the prompt is written to stdin when `stdin` is set. */
  command(prompt: string, sessionId: string | null, dir: string): { args: string[]; stdin: string | null };
  /** Per-run parser (keeps state such as pending tool calls and the last message). */
  parser(dir: string): (msg: any) => Parsed;
}

/** `<bin> --version`, or null when the CLI isn't on PATH. */
export async function versionOf(bin: string): Promise<string | null> {
  try {
    const out = await run(bin, ['--version'], { timeoutMs: 15_000 });
    return out.match(/\d+(\.\d+)+/)?.[0] ?? 'installed';
  } catch {
    return null;
  }
}

export function rel(dir: string, p: unknown) {
  const s = String(p ?? '');
  return dir && s.startsWith(dir + '/') ? s.slice(dir.length + 1) : s;
}

export function summarizeTool(name: string, input: any, dir: string): string {
  switch (name) {
    case 'Read': return `Reading ${rel(dir, input?.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${rel(dir, input?.file_path)}`;
    case 'Write': return `Writing ${rel(dir, input?.file_path)}`;
    case 'Glob': return `Looking for ${input?.pattern}`;
    case 'Grep': return `Searching for "${input?.pattern}"`;
    case 'Bash': return `Running ${String(input?.command ?? '').slice(0, 80)}`;
    case 'TodoWrite': return 'Planning next steps';
    case 'WebFetch': return `Reading ${input?.url}`;
    case 'WebSearch': return `Searching the web for ${input?.query}`;
    default: return `Using ${name}`;
  }
}
