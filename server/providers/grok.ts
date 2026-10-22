// xAI Grok Build (`grok -p … --output-format streaming-json`), signed in with the user's xAI login or their xAI key.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../config.ts';
import { type AgentRunner, type Parsed, type ParsedEvent, summarizeTool, versionOf } from './common.ts';
import { SYSTEM_PROMPT } from './claude.ts';

/** Grok's built-in tools, mapped onto the names the office already knows how to describe. */
const TOOL_NAMES: Record<string, string> = {
  read_file: 'Read', search_replace: 'Edit', edit_file: 'Edit', write_file: 'Write', write: 'Write',
  run_terminal_cmd: 'Bash', grep: 'Grep', list_dir: 'Glob', glob: 'Glob', file_search: 'Glob',
  web_fetch: 'WebFetch', web_search: 'WebSearch', todo_write: 'TodoWrite',
};
/** Fallback from the ACP tool `kind` when the tool id isn't one we know. */
const KIND_NAMES: Record<string, string> = {
  read: 'Read', edit: 'Edit', delete: 'Edit', move: 'Edit', search: 'Grep', execute: 'Bash', fetch: 'WebFetch', think: 'TodoWrite',
};

/** Commands it may run without asking, as in Claude Code's allowlist. Headless runs can't ask, so anything else is refused. */
const ALLOW = [
  'Read', 'Edit', 'Write', 'Grep',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(ls*)',
  'Bash(npm test*)', 'Bash(npm run*)', 'Bash(npx tsc*)',
];
const DENY = ['Bash(git push*)'];

function toolInput(p: any) {
  return {
    file_path: p?.target_file ?? p?.file_path ?? p?.path,
    pattern: p?.pattern ?? p?.query ?? p?.glob_pattern ?? p?.path ?? '.',
    command: p?.command,
    url: p?.url,
    query: p?.query,
  };
}

function outputText(msg: any): string {
  const raw = msg?.rawOutput;
  if (typeof raw === 'string') return raw;
  const fromContent = (msg?.content ?? []).map((c: any) => c?.content?.text ?? c?.text ?? '').join('\n');
  if (fromContent.trim()) return fromContent;
  if (raw && typeof raw === 'object') return String(raw.output ?? raw.stdout ?? raw.error ?? raw.message ?? '');
  return '';
}

/**
 * Parse one line of `--output-format streaming-json` (ACP session updates): text {data}, thought {data},
 * tool_call {toolCallId, toolName, kind, status, rawInput}, tool_call_update {toolCallId, status, rawOutput, content},
 * plan, usage, end {stopReason, sessionId, total_cost_usd?}, error {message}.
 */
export function grokParser(dir: string) {
  const pending = new Map<string, string>();
  let said = '';
  let unsent = '';
  const flush = (out: ParsedEvent[]) => {
    if (unsent.trim()) out.push({ kind: 'text', text: unsent.trim() });
    unsent = '';
  };
  return (msg: any): Parsed => {
    const events: ParsedEvent[] = [];
    let sessionId: string | undefined;
    switch (msg?.type) {
      case 'text':
        if (typeof msg.data === 'string') { said += msg.data; unsent += msg.data; }
        break;
      case 'tool_call': {
        flush(events);
        const name = TOOL_NAMES[msg.toolName] ?? KIND_NAMES[msg.kind] ?? String(msg.toolName ?? msg.title ?? 'tool');
        pending.set(msg.toolCallId, name);
        events.push({ kind: 'tool', tool: name, summary: summarizeTool(name, toolInput(msg.rawInput), dir), input: msg.rawInput });
        said = '';
        break;
      }
      case 'tool_call_update':
        if (msg.status !== 'completed' && msg.status !== 'failed') break;
        events.push({
          kind: 'tool_result',
          summary: outputText(msg).trim().slice(0, 200),
          isError: msg.status === 'failed',
          toolName: pending.get(msg.toolCallId),
        });
        pending.delete(msg.toolCallId);
        break;
      case 'plan':
        events.push({ kind: 'tool', tool: 'TodoWrite', summary: 'Planning next steps' });
        break;
      case 'error':
        events.push({ kind: 'tool_result', summary: String(msg.message ?? 'Error').slice(0, 200), isError: true });
        break;
      case 'end':
        if (typeof msg.sessionId === 'string' && msg.sessionId) sessionId = msg.sessionId;
        flush(events);
        events.push({ kind: 'result', text: said, costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null });
        break;
    }
    return { events, sessionId };
  };
}

/** Another program can be called `grok` too; only xAI's Grok Build has the streaming-json headless mode. */
let isGrokBuild: boolean | null = null;
async function supportsStreamingJson() {
  if (isGrokBuild != null) return isGrokBuild;
  isGrokBuild = await run('grok', ['--help'], { timeoutMs: 15_000 }).then((h) => h.includes('streaming-json'), () => false);
  return isGrokBuild;
}

export const grokHome = () => process.env.GROK_HOME || join(homedir(), '.grok');
export const grokSignedIn = () => existsSync(join(grokHome(), 'auth.json'));

export const grok: AgentRunner = {
  id: 'grok',
  label: 'Grok Build',
  vendor: 'xAI',
  bin: 'grok',
  installCmd: 'curl -fsSL https://x.ai/cli/install.sh | bash',
  keyUrl: 'https://console.x.ai',
  keyPrefix: 'xai-',
  keySlot: 'xai',
  keyEnv: ['XAI_API_KEY'],
  async detect() {
    const version = await versionOf('grok');
    if (!version) return { installed: false, version: null, signedIn: false };
    if (!(await supportsStreamingJson())) {
      return { installed: false, version, signedIn: false, hint: `The \`grok\` on your PATH isn't xAI's Grok Build (or is too old). Install it: curl -fsSL https://x.ai/cli/install.sh | bash` };
    }
    return { installed: true, version, signedIn: grokSignedIn() };
  },
  command(prompt, sessionId) {
    // acceptEdits + an allowlist: file edits and the listed commands run, anything else is refused (headless can't ask).
    const args = [
      '-p', prompt,
      ...(sessionId ? ['--resume', sessionId] : []),
      '--output-format', 'streaming-json',
      '--permission-mode', 'acceptEdits',
      ...ALLOW.flatMap((r) => ['--allow', r]),
      ...DENY.flatMap((r) => ['--deny', r]),
      '--rules', SYSTEM_PROMPT,
      '--no-auto-update',
    ];
    return { args, stdin: null };
  },
  parser: grokParser,
};
