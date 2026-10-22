// Downloads the two character rigs the game animates (Xbot and Soldier from the three.js examples).
// They are Mixamo characters: free to use in a game, but Adobe's terms don't allow redistributing the
// raw files, so they aren't in this repository (or under its MIT license). Runs after `npm install`;
// run it again with `npm run models`. Checksums pin the exact files.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/models/gltf/';
const MODELS = {
  'Xbot.glb': '002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5',
  'Soldier.glb': 'dfb230fc1f942f259dd00281a1186953ad602fc5d69067ce63e24b2aa439736b',
};
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'models');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(dir, { recursive: true });
let failed = false;
for (const [name, want] of Object.entries(MODELS)) {
  const file = join(dir, name);
  if (existsSync(file) && sha(readFileSync(file)) === want) continue;
  try {
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== want) throw new Error('checksum mismatch');
    writeFileSync(file, buf);
    console.log(`models: fetched ${name}`);
  } catch (e) {
    failed = true;
    console.warn(`models: couldn't fetch ${name} (${e.message}). Run \`npm run models\` when you're online.`);
  }
}
// Never fail `npm install` over this; the game falls back to loading the rigs from the same CDN.
if (failed) process.exitCode = 0;
