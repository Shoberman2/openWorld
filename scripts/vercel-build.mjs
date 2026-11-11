// Builds the public web demo for Vercel (Build Output API): the game client built with the demo flag
// as static files, and the demo server (server/demo.ts: map tiles, place search, weather and the
// showcase city, nothing else) bundled into one function that answers /api/*.
// Then: `vercel deploy --prebuilt` (add --prod for the live site).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel', 'output');
rmSync(out, { recursive: true, force: true });

console.log('Building the client (web demo)…');
execFileSync('npx', ['vite', 'build', '--config', 'client/vite.config.ts', '--outDir', join(out, 'static'), '--emptyOutDir'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, OPENWORLD_DEMO_BUILD: '1' },
});

console.log('Bundling the demo server…');
const fn = join(out, 'functions', 'api.func');
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [join(root, 'server', 'demo.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, legalComments: 'none',
  // Express and friends are CommonJS: give the bundle a `require` of its own.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Optional native speed-ups of ws, never needed here.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});
writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false,
  supportsResponseStreaming: true, maxDuration: 30,
}, null, 2));

writeFileSync(join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    // Hashed build files never change.
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api/(.*)$', dest: '/api' },
    // One page: anything else is the game.
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log(`Web demo built in ${out}`);
