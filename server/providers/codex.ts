// OpenAI Codex CLI (`codex exec --json`), signed in with the user's ChatGPT/Codex login or their OpenAI key.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type AgentRunner, type Parsed, type ParsedEvent, rel, versionOf } from './common.ts';
import { SYSTEM_PROMPT } from './claude.ts';

/**
 * Parse one line of `codex exec --json` (JSON Lines: thread.started, turn.*, item.started/updated/completed, error).
 * Item types: agent_message {text}, reasoning {text}, command_execution {command, aggregated_output, exit_code, status},
 * file_change {changes:[{path, kind}], status}, mcp_tool_call, web_search {query}, todo_list, error {message}.
 */
export function codexParser(dir: string) {
  let lastMessage = '';
  return (msg: any): Parsed => {
    const events: ParsedEvent[] = [];
    let sessionId: string | undefined;
    const item = msg?.item;
    switch (msg?.type) {
      case 'thread.started':
        if (typeof msg.thread_id === 'string') sessionId = msg.thread_id;
        break;
      case 'item.started':
        if (item?.type === 'command_execution') events.push({ kind: 'tool', tool: 'Bash', summary: `Running ${String(item.command ?? '').replace(/^bash -lc /, '').slice(0, 80)}`, input: { command: item.command } });
        else if (item?.type === 'web_search') events.push({ kind: 'tool', tool: 'WebSearch', summary: `Searching the web for ${item.query ?? ''}` });
        else if (item?.type === 'mcp_tool_call') events.push({ kind: 'tool', tool: String(item.tool ?? 'tool'), summary: `Using ${item.server ?? ''} ${item.tool ?? ''}`.trim() });
        break;
      case 'item.completed':
        if (item?.type === 'agent_message' && item.text?.trim()) {
          lastMessage = item.text;
          events.push({ kind: 'text', text: item.text });
        } else if (item?.type === 'command_execution') {
          events.push({ kind: 'tool_result', summary: String(item.aggregated_output ?? '').trim().slice(0, 200), isError: item.status === 'failed' || (item.exit_code ?? 0) !== 0, toolName: 'Bash' });
        } else if (item?.type === 'file_change') {
          const files = (item.changes ?? []).map((c: any) => rel(dir, c.path));
          const verb = item.changes?.every((c: any) => c.kind === 'add') ? 'Writing' : 'Editing';
          events.push({ kind: 'tool', tool: 'Edit', summary: `${verb} ${files.join(', ').slice(0, 120)}`, input: { files } });
          events.push({ kind: 'tool_result', summary: item.status === 'failed' ? 'Patch failed' : `${files.length} file(s) updated`, isError: item.status === 'failed', toolName: 'Edit' });
        } else if (item?.type === 'todo_list') {
          events.push({ kind: 'tool', tool: 'TodoWrite', summary: 'Planning next steps' });
        } else if (item?.type === 'error' && item.message) {
          events.push({ kind: 'tool_result', summary: String(item.message).slice(0, 200), isError: true });
        }
        break;
      case 'turn.completed':
        events.push({ kind: 'result', text: lastMessage, costUsd: null });
        break;
      case 'turn.failed':
        events.push({ kind: 'tool_result', summary: String(msg.error?.message ?? 'Turn failed').slice(0, 200), isError: true });
        break;
      case 'error':
        events.push({ kind: 'tool_result', summary: String(msg.message ?? 'Error').slice(0, 200), isError: true });
        break;
    }
    return { events, sessionId };
  };
}

export const codex: AgentRunner = {
  id: 'codex',
  label: 'Codex',
  vendor: 'OpenAI',
  bin: 'codex',
  installCmd: 'npm i -g @openai/codex',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPrefix: 'sk-',
  keySlot: 'openai',
  keyEnv: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
  async detect() {
    const version = await versionOf('codex');
    const home = process.env.CODEX_HOME || join(homedir(), '.codex');
    return { installed: !!version, version, signedIn: !!version && existsSync(join(home, 'auth.json')) };
  },
  command(prompt, sessionId) {
    // Codex has no separate system prompt flag in exec mode, so the house rules lead the task.
    const flags = ['--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
    return sessionId
      ? { args: ['exec', 'resume', sessionId, ...flags, '-'], stdin: prompt }
      : { args: ['exec', ...flags, '-'], stdin: `${SYSTEM_PROMPT}\n\nTask:\n${prompt}` };
  },
  parser: codexParser,
};
