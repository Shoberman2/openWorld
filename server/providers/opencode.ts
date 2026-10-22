// OpenCode (`opencode run --format json`): the open-source coding agent that runs on almost any model. It gets the
// model the user connected under "Any other model" (OpenRouter, Ollama, DeepSeek…), the keys already saved for the
// other agents, or its own login (`opencode auth login`), so whatever model someone has can take coding tasks.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type AgentRunner, type Parsed, type ParsedEvent, type KeySlot, summarizeTool, versionOf } from './common.ts';
import { SYSTEM_PROMPT } from './claude.ts';
import { compatConfig } from './compat.ts';

/** OpenCode's tool ids, mapped onto the names the office already knows how to describe. */
const TOOL_NAMES: Record<string, string> = {
  read: 'Read', edit: 'Edit', write: 'Write', apply_patch: 'Edit', patch: 'Edit', multiedit: 'Edit',
  bash: 'Bash', shell: 'Bash', grep: 'Grep', glob: 'Glob', list: 'Glob',
  webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite', todoread: 'TodoWrite',
};

/**
 * Same house rules as Claude Code: edits run, a short list of commands runs, anything else is refused. "deny", not
 * "ask": a headless run turns "ask" into a rejection that ends the whole task, while a denial lets it carry on.
 * The last matching rule wins, so the catch-all comes first.
 */
const SHELL = {
  '*': 'deny',
  'git status*': 'allow', 'git diff*': 'allow', 'git log*': 'allow', 'git show*': 'allow', 'git branch*': 'allow',
  'ls*': 'allow', 'cat *': 'allow', 'head *': 'allow', 'tail *': 'allow', 'wc *': 'allow', 'grep *': 'allow', 'rg *': 'allow', 'pwd': 'allow',
  'npm test*': 'allow', 'npm run*': 'allow', 'npx tsc*': 'allow',
  'git push*': 'deny',
};
// "bash" is the key in OpenCode 1.x; its docs already call it "shell" for 2.0, so both are set.
const PERMISSION = { edit: 'allow', bash: SHELL, shell: SHELL, external_directory: 'deny', question: 'deny', doom_loop: 'deny' };

/** Our saved keys under the env names OpenCode's built-in providers read. */
const KEY_ENV: [KeySlot, string][] = [
  ['anthropic', 'ANTHROPIC_API_KEY'], ['openai', 'OPENAI_API_KEY'], ['gemini', 'GOOGLE_GENERATIVE_AI_API_KEY'], ['xai', 'XAI_API_KEY'],
];

/** OpenCode keeps provider logins in its data dir once you've run `opencode auth login`. */
function opencodeSignedIn() {
  const data = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return existsSync(join(data, 'opencode', 'auth.json'));
}

function toolInput(p: any) {
  return { file_path: p?.filePath ?? p?.path, pattern: p?.pattern ?? p?.path ?? '.', command: p?.command, url: p?.url, query: p?.query };
}

/** "*** Update File: src/a.ts" lines of an apply_patch, for the summary. */
const patchFiles = (text: unknown) => [...String(text ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());

/**
 * Parse one line of `--format json`: {type, sessionID, part}. step_start, text {part.text},
 * tool_use {part.tool, part.callID, part.state: {status completed|error, input, output, error}},
 * step_finish {part.cost, part.tokens, part.reason}, reasoning, error {error: {name, data.message}}.
 * A tool only shows up once it has finished, so it's reported as the call and its result together.
 */
export function opencodeParser(dir: string) {
  let said = '';
  let cost = 0;
  let reported = 0;
  return (msg: any): Parsed => {
    const events: ParsedEvent[] = [];
    const sessionId = typeof msg?.sessionID === 'string' && msg.sessionID ? msg.sessionID : undefined;
    const part = msg?.part;
    switch (msg?.type) {
      case 'text':
        if (part?.text?.trim()) {
          said = part.text;
          events.push({ kind: 'text', text: part.text.trim() });
        }
        break;
      case 'tool_use': {
        const id = String(part?.tool ?? 'tool');
        const name = TOOL_NAMES[id] ?? id;
        const input = part?.state?.input ?? {};
        const files = id === 'apply_patch' ? patchFiles(input.patchText) : [];
        const summary = files.length ? `Editing ${files.map((f) => f.replace(dir + '/', '')).join(', ').slice(0, 120)}` : summarizeTool(name, toolInput(input), dir);
        const failed = part?.state?.status === 'error';
        events.push({ kind: 'tool', tool: name, summary, input });
        events.push({ kind: 'tool_result', summary: String((failed ? part?.state?.error : part?.state?.output) ?? '').trim().slice(0, 200), isError: failed, toolName: name });
        said = '';
        break;
      }
      case 'step_finish':
        if (typeof part?.cost === 'number') cost += part.cost;
        // The last step ends with "stop"; earlier ones end on tool calls. Cost is reported once, as what's new since last time.
        if (part?.reason && part.reason !== 'tool-calls') {
          events.push({ kind: 'result', text: said, costUsd: cost > reported ? cost - reported : null });
          reported = cost;
        }
        break;
      case 'error': {
        const e = msg.error;
        events.push({ kind: 'tool_result', summary: String(e?.data?.message ?? e?.message ?? e?.name ?? 'Error').slice(0, 200), isError: true });
        break;
      }
    }
    return { events, sessionId };
  };
}

export const opencode: AgentRunner = {
  id: 'opencode',
  label: 'OpenCode',
  vendor: 'Any model',
  bin: 'opencode',
  installCmd: 'npm i -g opencode-ai',
  keyUrl: 'https://opencode.ai/docs/providers',
  keyPrefix: '',
  keySlot: null,
  keyEnv: [],
  async detect() {
    const version = await versionOf('opencode');
    return { installed: !!version, version, signedIn: !!version && opencodeSignedIn() };
  },
  hasModel(keyOf) {
    return !!compatConfig()?.model || KEY_ENV.some(([slot]) => !!keyOf(slot));
  },
  env(keyOf) {
    const env: Record<string, string> = { OPENCODE_DISABLE_AUTOUPDATE: '1' };
    for (const [slot, name] of KEY_ENV) {
      const key = keyOf(slot);
      if (key) env[name] = key;
    }
    const c = compatConfig();
    const config: Record<string, unknown> = { permission: PERMISSION };
    // The model from "Any other model" wins: that's the one this user picked to talk to.
    if (c?.model) {
      config.provider = {
        openworld: {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenWorld model',
          options: { baseURL: c.baseUrl, ...(c.key ? { apiKey: c.key } : {}) },
          models: { [c.model]: { name: c.model } },
        },
      };
      config.model = `openworld/${c.model}`;
    }
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    return env;
  },
  command(prompt, sessionId, dir) {
    // --dir: OpenCode goes by $PWD rather than the process's working directory, so name the worktree outright.
    const args = ['run', '--format', 'json', '--dir', dir, ...(sessionId ? ['--session', sessionId] : [])];
    // The prompt is an argument, so it must not look like a flag.
    return { args: [...args, sessionId ? prompt.replace(/^-/, ' -') : `${SYSTEM_PROMPT}\n\nTask:\n${prompt}`], stdin: null };
  },
  parser: opencodeParser,
};
