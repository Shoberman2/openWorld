#!/usr/bin/env node
// Opens OpenWorld in the boardroom of the project you're working on: finds the repo from the folder
// you run it in, starts the game's server if it isn't running, and opens the browser on a link that
// walks you into that project's building, to the head of the board table, with the board convened.
// Usage: node bin/boardroom.mjs ["a question for the board"]   (run from inside any of your repos)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
// "git@github.com:me/my-api.git" or "https://github.com/me/my-api" -> "my-api"; no remote: the folder's name.
const remote = git('remote', 'get-url', 'origin');
const repo = remote ? basename(remote).replace(/\.git$/, '') : basename(git('rev-parse', '--show-toplevel') || process.cwd());
const ask = process.argv.slice(2).join(' ').trim();

const up = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
// A dev server (npm run dev) if one is up, else the built game on the server's own port.
const DEV = 'http://localhost:5317', APP = `http://localhost:${process.env.PORT || 4317}`;
let base = (await up(DEV)) ? DEV : (await up(APP)) ? APP : null;
if (!base) {
  console.log('Starting OpenWorld (the first start builds the city, about a minute)…');
  const dir = process.env.OPENWORLD_HOME || join(homedir(), '.openworld');
  mkdirSync(dir, { recursive: true });
  const log = openSync(join(dir, 'server.log'), 'a');
  spawn('npm', ['start'], { cwd: root, detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 180 && !(await up(APP)); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up(APP))) { console.error(`OpenWorld didn't come up. See ${join(dir, 'server.log')}`); process.exit(1); }
  base = APP;
}
const url = `${base}/?repo=${encodeURIComponent(repo)}&room=boardroom${ask ? `&ask=${encodeURIComponent(ask)}` : ''}`;
const opener = process.platform === 'darwin' ? ['open', ['-a', process.env.OPENWORLD_BROWSER || 'Safari', url]]
  : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
console.log(`Opening the ${repo} boardroom: ${url}`);
