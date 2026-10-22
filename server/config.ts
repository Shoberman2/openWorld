import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn, type SpawnOptions } from 'node:child_process';

export const HOME = process.env.OPENWORLD_HOME || join(homedir(), '.openworld');
export const PATHS = {
  home: HOME,
  config: join(HOME, 'config.json'),
  cache: join(HOME, 'cache'),
  logos: join(HOME, 'cache', 'logos'),
  workspaces: join(HOME, 'workspaces'),
  boardroom: join(HOME, 'boardroom'),
  events: join(HOME, 'events.jsonl'),
  agents: join(HOME, 'agents.json'),
};

// Private to you: it holds your agents' work, chats and (in config.json) keys.
mkdirSync(PATHS.home, { recursive: true, mode: 0o700 });
for (const dir of [PATHS.cache, PATHS.logos, PATHS.workspaces, PATHS.boardroom]) {
  mkdirSync(dir, { recursive: true });
}

export const MODEL = process.env.OPENWORLD_MODEL || 'sonnet';

export interface Config {
  token?: string;
  /** The user's own API keys, by vendor. Only ever read on the server. */
  keys?: { anthropic?: string; openai?: string; gemini?: string };
  defaultProvider?: 'claude' | 'codex' | 'gemini';
  chat?: { provider?: 'anthropic' | 'claude-cli' | 'codex-cli' | 'openai' | 'gemini' | 'compat'; model?: string };
  /** Any OpenAI-compatible chat endpoint (OpenRouter, Ollama, LM Studio, Groq…). The key is optional for local servers. */
  compat?: { preset?: string; baseUrl: string; key?: string; model: string };
}

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(PATHS.config, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>) {
  const next = { ...readConfig(), ...patch };
  writeFileSync(PATHS.config, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(PATHS.config, 0o600); // the mode above only applies when the file is new; it holds tokens and keys

}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function logEvent(name: string, props: Record<string, unknown> = {}) {
  appendFileSync(PATHS.events, JSON.stringify({ ts: new Date().toISOString(), name, props }) + '\n');
}

/** Run a command and resolve with stdout (rejects with stderr on non-zero exit). */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim()));
        else resolve(stdout.toString());
      },
    );
    if (opts.input != null) {
      child.stdin?.end(opts.input);
    }
  });
}

let claudeAvailable: boolean | null = null;
export async function hasClaude(): Promise<boolean> {
  if (claudeAvailable != null) return claudeAvailable;
  try {
    await run('claude', ['--version'], { timeoutMs: 15_000 });
    claudeAvailable = true;
  } catch {
    claudeAvailable = false;
  }
  return claudeAvailable;
}

export function spawnProc(cmd: string, args: string[], opts: SpawnOptions) {
  return spawn(cmd, args, { ...opts, env: { ...process.env, ...(opts.env || {}) } });
}
