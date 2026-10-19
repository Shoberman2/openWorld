#!/usr/bin/env node
// Launches the OpenWorld server (building the client first if needed) and opens the game.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || '4317';
const url = `http://localhost:${port}`;

if (!existsSync(join(root, 'client', 'dist', 'index.html'))) {
  console.log('Building the city (first run)...');
  const b = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli', { paths: [root] });
const server = spawn(process.execPath, [tsxCli, join(root, 'server', 'index.ts')], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, NODE_ENV: 'production', PORT: port },
});

let opened = false;
server.stdout.on('data', async (chunk) => {
  process.stdout.write(chunk);
  if (!opened && String(chunk).includes('OpenWorld server on')) {
    opened = true;
    const { default: open } = await import(pathToFileURL(require.resolve('open', { paths: [root] })).href);
    await open(url);
  }
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
