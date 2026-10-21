// Google Gemini CLI (`gemini -p … --output-format stream-json`), signed in with the user's Google login or their Gemini key.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../config.ts';
import { type AgentRunner, type Parsed, type ParsedEvent, summarizeTool, versionOf } from './common.ts';
import { SYSTEM_PROMPT } from './claude.ts';

/** Gemini's built-in tools, mapped onto the names the office already knows how to describe. */
const TOOL_NAMES: Record<string, string> = {
  read_file: 'Read', read_many_files: 'Read', write_file: 'Write', replace: 'Edit',
  run_shell_command: 'Bash', glob: 'Glob', search_file_content: 'Grep', list_directory: 'Glob',
  web_fetch: 'WebFetch', google_web_search: 'WebSearch', write_todos: 'TodoWrite',
};

function toolInput(name: string, p: any) {
  return {
    file_path: p?.file_path ?? p?.absolute_path ?? p?.path,
    pattern: p?.pattern ?? p?.dir_path ?? p?.path,
    command: p?.command,
    url: p?.url ?? p?.prompt,
    query: p?.query,
    ...(name === 'list_directory' ? { pattern: p?.dir_path ?? p?.path ?? '.' } : {}),
  };
}

/**
 * Parse one line of `--output-format stream-json`: init {session_id, model}, message {role, content, delta?},
 * tool_use {tool_name, tool_id, parameters}, tool_result {tool_id, status, output?, error?}, error {severity, message},
 * result {status, error?, stats?}.
 */
export function geminiParser(dir: string) {
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
      case 'init':
        if (typeof msg.session_id === 'string') sessionId = msg.session_id;
        break;
      case 'message':
        if (msg.role === 'assistant' && typeof msg.content === 'string') {
          if (!msg.delta) { said = ''; unsent = ''; }
          said += msg.content;
          unsent += msg.content;
        }
        break;
      case 'tool_use': {
        flush(events);
        const name = TOOL_NAMES[msg.tool_name] ?? String(msg.tool_name ?? 'tool');
        pending.set(msg.tool_id, name);
        events.push({ kind: 'tool', tool: name, summary: summarizeTool(name, toolInput(msg.tool_name, msg.parameters), dir), input: msg.parameters });
        said = '';
        break;
      }
      case 'tool_result':
        events.push({
          kind: 'tool_result',
          summary: String(msg.output ?? msg.error?.message ?? '').trim().slice(0, 200),
          isError: msg.status === 'error',
          toolName: pending.get(msg.tool_id),
        });
        break;
      case 'error':
        if (msg.severity === 'error') events.push({ kind: 'tool_result', summary: String(msg.message ?? '').slice(0, 200), isError: true });
        break;
      case 'result':
        flush(events);
        events.push({ kind: 'result', text: msg.status === 'error' && !said ? String(msg.error?.message ?? 'Gemini stopped with an error') : said, costUsd: null });
        break;
    }
    return { events, sessionId };
  };
}

let streams: boolean | null = null;
/** stream-json arrived in later Gemini CLI releases; older ones can't report progress, so they don't count as installed. */
async function supportsStreamJson() {
  if (streams != null) return streams;
  streams = await run('gemini', ['--help'], { timeoutMs: 15_000 }).then((h) => h.includes('stream-json'), () => false);
  return streams;
}

export const gemini: AgentRunner = {
  id: 'gemini',
  label: 'Gemini CLI',
  vendor: 'Google',
  bin: 'gemini',
  installCmd: 'npm i -g @google/gemini-cli',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyPrefix: 'AIza',
  keySlot: 'gemini',
  keyEnv: ['GEMINI_API_KEY'],
  async detect() {
    const version = await versionOf('gemini');
    if (!version) return { installed: false, version: null, signedIn: false };
    if (!(await supportsStreamJson())) return { installed: false, version, signedIn: false, hint: `Gemini CLI ${version} is too old. Update: npm i -g @google/gemini-cli` };
    const home = join(homedir(), '.gemini');
    return { installed: true, version, signedIn: existsSync(join(home, 'oauth_creds.json')) || existsSync(join(home, 'google_accounts.json')) };
  },
  command(prompt, sessionId) {
    // auto_edit: file edits are approved, shell commands are not (headless runs can't ask).
    const args = ['--output-format', 'stream-json', '--approval-mode', 'auto_edit', ...(sessionId ? ['--resume', sessionId] : [])];
    return { args: [...args, '-p', sessionId ? prompt : `${SYSTEM_PROMPT}\n\nTask:\n${prompt}`], stdin: null };
  },
  parser: geminiParser,
};
