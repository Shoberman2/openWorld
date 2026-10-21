// Claude Code (`claude -p --output-format stream-json`), signed in with the user's Claude login or their Anthropic key.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type AgentRunner, type Parsed, type ParsedEvent, summarizeTool, versionOf } from './common.ts';

const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(ls:*)',
  'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx tsc:*)',
];

export const SYSTEM_PROMPT = [
  'You are an agent working inside the OpenWorld game office for this repo. Make focused changes for the task.',
  'Do not push or open PRs; the user reviews your work in the game and opens the PR.',
  'If you are genuinely blocked on a decision only the user can make (not something you can look up or reasonably choose), stop and end your reply with one line: `QUESTION: <your question>`. The user will answer and you will continue in this same session. Otherwise finish the task without asking.',
  'End with a short plain summary of what you changed and why.',
].join(' ');

/** Claude Code keeps its login in ~/.claude.json (oauthAccount) once you've signed in. */
function claudeSignedIn() {
  try {
    const p = join(homedir(), '.claude.json');
    return existsSync(p) && readFileSync(p, 'utf8').includes('"oauthAccount"');
  } catch {
    return false;
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  return '';
}

/** Turn one stream-json line from `claude -p` into game events. Exported for testing. */
export function parseStreamLine(msg: any, dir: string, pendingTools: Map<string, string>): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text?.trim()) out.push({ kind: 'text', text: block.text });
      if (block.type === 'tool_use') {
        pendingTools.set(block.id, block.name);
        out.push({ kind: 'tool', tool: block.name, summary: summarizeTool(block.name, block.input, dir), input: block.input });
      }
    }
  } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      const text = resultText(block.content).trim();
      out.push({
        kind: 'tool_result',
        summary: text.slice(0, 200),
        isError: !!block.is_error,
        toolName: pendingTools.get(block.tool_use_id),
      });
    }
  } else if (msg.type === 'result') {
    out.push({ kind: 'result', text: typeof msg.result === 'string' ? msg.result : '', costUsd: msg.total_cost_usd ?? null });
  }
  return out;
}

/** session_id appears on the init line and on every later message of `--output-format stream-json`. */
export function sessionIdOf(msg: any): string | null {
  return typeof msg?.session_id === 'string' && msg.session_id ? msg.session_id : null;
}

export const claude: AgentRunner = {
  id: 'claude',
  label: 'Claude Code',
  vendor: 'Anthropic',
  bin: 'claude',
  installCmd: 'npm i -g @anthropic-ai/claude-code',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyPrefix: 'sk-ant-',
  keySlot: 'anthropic',
  keyEnv: ['ANTHROPIC_API_KEY'],
  async detect() {
    const version = await versionOf('claude');
    return { installed: !!version, version, signedIn: !!version && claudeSignedIn() };
  },
  command(prompt, sessionId) {
    return {
      args: [
        '-p',
        ...(sessionId ? ['--resume', sessionId] : []),
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', ALLOWED_TOOLS.join(' '),
        '--append-system-prompt', SYSTEM_PROMPT,
      ],
      stdin: prompt,
    };
  },
  parser(dir) {
    const pending = new Map<string, string>();
    return (msg): Parsed => ({ events: parseStreamLine(msg, dir, pending), sessionId: sessionIdOf(msg) ?? undefined });
  },
};
