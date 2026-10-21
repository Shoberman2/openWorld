#!/usr/bin/env node
/**
 * Captures the landing-page tutorial from the real game: stills and short looping clips for each step,
 * written to client/public/tutorial/ with a manifest.json the landing page reads.
 *
 * Usage (with the game running, e.g. `npm start` → http://localhost:4317, or `npm run dev` → :5317):
 *   node scripts/capture-tutorial.mjs [baseUrl] [--only=move,rocket,...]
 *
 * It drives the game through window.__ow in headless Chrome on the real GPU (Metal), so it needs
 * Google Chrome installed (override with CHROME=/path/to/chrome) and Playwright (PLAYWRIGHT=/path/to/
 * playwright/index.mjs, else the gstack copy, else `playwright` from node_modules) plus ffmpeg on PATH.
 * The VR step loads the IWER WebXR emulator (Meta Quest 3) from jsDelivr. Steps that fail keep their
 * previous media, so it's safe to re-run after the game changes. Nothing here talks to Claude or
 * starts an agent: panels are opened, never submitted.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'client/public/tutorial');
const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4317').replace(/\/$/, '');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const W = 1280, H = 720;

// Times Square: dense, recognizable, and where most people start.
const HOME = { name: 'Times Square', label: 'Times Square, New York, United States', lat: 40.758, lon: -73.9855, countryCode: 'us', kind: 'square' };
const DROP = { name: 'Shibuya Crossing', lat: 35.6595, lon: 139.7005 };

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.mjs'), 'playwright'].filter(Boolean);
  for (const t of tries) {
    try { return await import(t); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT=/path/to/playwright/index.mjs');
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { steps: {} };
manifest.steps ??= {};
const stamp = Date.now().toString(36);

// ---------------------------------------------------------------- media helpers

/** Screenshot the page as a JPEG into the tutorial folder. */
async function still(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  return `${name}.jpg`;
}

/**
 * Record `seconds` of the page while `during()` drives it, using the DevTools screencast (frames as
 * the compositor makes them), then encode a small looping H.264 MP4 and a poster frame.
 */
async function clip(page, name, seconds, during, posterAt = 0.6) {
  const dir = join(tmpdir(), `ow-clip-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  const drive = Promise.resolve().then(during);
  await sleep(seconds * 1000);
  await cdp.send('Page.stopScreencast').catch(() => {});
  await drive.catch((e) => console.warn(`  (${name}: ${e.message})`));
  await cdp.detach().catch(() => {});
  if (frames.length < 8) throw new Error(`only ${frames.length} frames`);
  // Resample to a steady 24 fps by timestamp, so slow frames hold rather than speed the clip up.
  const fps = 24, n = Math.round(seconds * fps), start = frames[0].t;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i / fps;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    writeFileSync(join(dir, `f_${String(i).padStart(4, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'));
  }
  const mp4 = `${name}.mp4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f_%04d.jpg'),
    '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', join(OUT, mp4)]);
  writeFileSync(join(OUT, `${name}.jpg`), readFileSync(join(dir, `f_${String(Math.floor(n * posterAt)).padStart(4, '0')}.jpg`)));
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ${mp4}: ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { clip: mp4, poster: `${name}.jpg` };
}

// ---------------------------------------------------------------- game helpers

const ow = (page, fn, arg) => page.evaluate(fn, arg);

/** Hide transient chrome (toasts, the "click to look" hint) so shots stay clean. */
async function clean(page, on = true) {
  await page.evaluate((on) => {
    let s = document.getElementById('tut-clean');
    if (!s) { s = document.createElement('style'); s.id = 'tut-clean'; document.head.appendChild(s); }
    s.textContent = on ? '#toasts, #click-to-look { display: none !important; }' : '';
  }, on);
}

async function key(page, code, ms = 120) {
  await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code);
}

/** Put the robot at (x, z) looking along yaw, camera settled. */
async function placeAt(page, x, z, yaw, opts = {}) {
  await ow(page, ({ x, z, yaw, pitch, zoom }) => {
    const { player } = window.__ow;
    player.placeAt(x, z, yaw);
    if (pitch != null) player.pitch = pitch;
    if (zoom != null) player.zoom = zoom;
  }, { x, z, yaw, ...opts });
  await sleep(opts.settle ?? 1200);
}

/**
 * Stand `back` metres from (tx, tz), facing it, from whichever direction leaves the chase camera the
 * most room (walls and trees push it into the robot's back). `dirs` limits the angles tried.
 */
async function standFacing(page, tx, tz, back, opts = {}) {
  const tries = opts.dirs ?? Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);
  let best = null;
  for (const a of tries) {
    const x = tx + Math.sin(a) * back, z = tz + Math.cos(a) * back;
    await placeAt(page, x, z, Math.atan2(tx - x, tz - z), { ...opts, settle: 450 });
    const room = await ow(page, () => {
      const { player, engine } = window.__ow;
      return engine.camera.position.distanceTo(player.position);
    });
    if (!best || room > best.room + 0.05) best = { x, z, room };
  }
  await placeAt(page, best.x, best.z, Math.atan2(tx - best.x, tz - best.z), { ...opts, settle: opts.settle ?? 1500 });
  return best;
}

/** Walk to an interactable inside the current building (by id or id pattern) and face it. */
async function goToInteractable(page, match, back = 2.2, opts = {}) {
  const at = await ow(page, (src) => {
    const re = new RegExp(src);
    const items = window.__ow.ctx.interactions.items;
    for (const it of items.values()) if (re.test(it.id)) return { id: it.id, x: it.position.x, z: it.position.z };
    return null;
  }, match);
  if (!at) return null;
  if (opts.fromHere) {
    // Approach from where the robot already is (the room's open side).
    const p = await ow(page, () => ({ x: window.__ow.player.position.x, z: window.__ow.player.position.z }));
    const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz) || 1;
    const sx = at.x + (dx / d) * back, sz = at.z + (dz / d) * back;
    await placeAt(page, sx, sz, Math.atan2(at.x - sx, at.z - sz), { pitch: opts.pitch ?? 0.12, settle: 1500 });
  } else await standFacing(page, at.x, at.z, back, { pitch: opts.pitch ?? 0.18 });
  return at.id;
}

/** Find an interactable's id and position by pattern. */
async function findInteractable(page, match) {
  return ow(page, (src) => {
    const re = new RegExp(src);
    for (const it of window.__ow.ctx.interactions.items.values()) if (re.test(it.id)) return { id: it.id, x: it.position.x, y: it.position.y, z: it.position.z };
    return null;
  }, match);
}

/**
 * Ride a building's lift from floor `from` to `to` the way a player does: call it, step into the car,
 * open the floor picker (optionally photographing it), press the button, wait to arrive.
 * Returns false if this building has no lift.
 */
async function rideLift(page, from, to, shot) {
  const call = await findInteractable(page, `:call:${from}$`);
  const car = await findInteractable(page, `:car:${from}$`);
  if (!call || !car) return false;
  await triggerInteractable(page, call.id);
  await sleep(3500); // car arrives, doors open
  // Step into the car, turned whichever way gives the camera the most room in there.
  let best = null;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const room = await ow(page, ({ c, yaw }) => {
      const p = window.__ow.player;
      p.position.set(c.x, c.y, c.z); p.vel.set(0, 0, 0);
      p.facing = p.yaw = yaw; p.pitch = 0.2;
      p.snapCamera();
      return window.__ow.engine.camera.position.distanceTo(p.position);
    }, { c: car, yaw });
    await sleep(300);
    if (!best || room > best.room + 0.05) best = { yaw, room };
  }
  await ow(page, ({ c, yaw }) => {
    const p = window.__ow.player;
    p.position.set(c.x, c.y, c.z); p.vel.set(0, 0, 0);
    p.facing = p.yaw = yaw; p.pitch = 0.2;
    p.snapCamera();
  }, { c: car, yaw: best.yaw });
  await sleep(1200);
  await triggerInteractable(page, car.id);
  let file = null;
  if (shot) file = await still(page, shot);
  await page.click(`button[data-stop="${to}"]`).catch(() => {});
  const dest = await findInteractable(page, `:car:${to}$`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const y = await ow(page, () => window.__ow.player.position.y);
    if (dest && Math.abs(y - dest.y) < 0.25) break;
  }
  await sleep(3000); // doors open
  return file ?? true;
}

async function triggerInteractable(page, id) {
  await ow(page, (id) => window.__ow.ctx.interactions.items.get(id)?.action(), id);
  await sleep(1500);
}

async function closePanels(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  await ow(page, () => { document.querySelectorAll('#panel-root .panel').forEach((p) => p.querySelector('.close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); });
  await sleep(400);
}

async function openGame(browser, { init } = {}) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.warn('  page error:', e.message));
  await page.addInitScript((home) => {
    try { localStorage.setItem('openworld.place', JSON.stringify(home)); } catch { /* private */ }
  }, HOME);
  if (init) await page.addInitScript(init);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#play:not([disabled])', { timeout: 60_000 });
  await page.click('#play');
  await page.waitForFunction(() => window.__ow && !document.getElementById('hud').classList.contains('hidden'), null, { timeout: 180_000 });
  await clean(page);
  await ow(page, () => { window.__ow.dayNight.hour = 16; });
  await sleep(9000); // let the GPU finish uploading the first chunks
  return page;
}

async function homeSpot(page) {
  // The tallest HQ's front door, seen from across the street.
  return ow(page, () => {
    const s = window.__ow.place.sites[0];
    return { name: s.repo.name, door: { x: s.door.x, z: s.door.z }, out: { x: s.doorOut.x, z: s.doorOut.z }, approach: { x: s.approach.x, z: s.approach.z } };
  });
}

// ---------------------------------------------------------------- the steps

const STEPS = {
  async drop(page) {
    // Drop into Shibuya, then fall in from the sky while the city streams in below.
    await ow(page, (d) => window.__ow.dropAt(d.lat, d.lon, d.name), DROP);
    await sleep(2500);
    await ow(page, () => {
      const p = window.__ow.player;
      p.yaw = p.facing; p.pitch = 0.75; p.zoom = 4;
      p.position.y += 70; p.vel.set(0, 0, 0); p.mode = 'air';
    });
    try {
      return await clip(page, 'drop', 6, async () => {});
    } finally {
      // Come back home for the rest.
      await ow(page, (h) => window.__ow.dropAt(h.lat, h.lon, h.name), HOME);
      await ow(page, () => { window.__ow.player.zoom = 0; });
      await sleep(6000);
    }
  },

  async move(page) {
    const h = await homeSpot(page);
    // Start down the street from the HQ, running along the sidewalk.
    const sx = h.approach.x + h.out.x * 3, sz = h.approach.z + h.out.z * 3;
    await placeAt(page, sx, sz, Math.atan2(-h.out.z, h.out.x), { pitch: 0.15, settle: 2500 });
    return clip(page, 'move', 5, async () => {
      await page.keyboard.down('KeyW');
      await sleep(2200);
      await page.keyboard.down('ShiftLeft');
      await sleep(2600);
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('KeyW');
    });
  },

  async rocket(page) {
    const h = await homeSpot(page);
    await placeAt(page, h.approach.x + h.out.x * 8, h.approach.z + h.out.z * 8, Math.atan2(-h.out.x, -h.out.z), { pitch: 0.1, settle: 2000 });
    const r = await clip(page, 'rocket', 6, async () => {
      await key(page, 'Space', 120);
      await sleep(250);
      await page.keyboard.down('Space');
      await sleep(2600);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('ShiftLeft');
      await sleep(2600);
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyW');
    });
    // Back down to the street.
    await placeAt(page, h.approach.x + h.out.x * 4, h.approach.z + h.out.z * 4, 0, { settle: 1500 });
    return r;
  },

  async vehicles(page) {
    const h = await homeSpot(page);
    const yaw = Math.atan2(-h.out.z, h.out.x);
    await placeAt(page, h.approach.x + h.out.x * 4, h.approach.z + h.out.z * 4, yaw, { pitch: 0.15, settle: 1500 });
    const r = await clip(page, 'vehicles', 7.5, async () => {
      for (const k of ['Digit2', 'Digit3', 'Digit4']) {
        await key(page, k);
        await sleep(200);
        await page.keyboard.down('KeyW');
        await sleep(2100);
        await page.keyboard.up('KeyW');
      }
    });
    await key(page, 'Digit1');
    await sleep(800);
    return r;
  },

  async travel(page) {
    const h = await homeSpot(page);
    await placeAt(page, h.approach.x + h.out.x * 10, h.approach.z + h.out.z * 10, Math.atan2(h.out.x, h.out.z), { pitch: 0.2, settle: 1500 });
    // Shuttle: stands on its tail, lights, launches; boosters on.
    const r = await clip(page, 'travel', 6, async () => {
      await key(page, 'Digit8');
      await sleep(700);
      await page.keyboard.down('Space');
      await sleep(1800);
      await page.keyboard.down('ShiftLeft');
      await sleep(3200);
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('Space');
    }, 0.7);
    // Autopilot to the Statue of Liberty: 40x time, the sky racing.
    await ow(page, () => window.__ow.setWaypointAt(40.6892, -74.0445, 'Statue of Liberty'));
    await key(page, 'KeyO');
    await sleep(9000);
    const ap = await still(page, 'travel-autopilot');
    await key(page, 'KeyO');
    await sleep(500);
    // Bail out and open the wingsuit.
    await key(page, 'Digit1');
    await sleep(700);
    await key(page, 'KeyQ');
    await sleep(2200);
    const ws = await still(page, 'travel-wingsuit');
    await ow(page, (hm) => window.__ow.dropAt(hm.lat, hm.lon, hm.name), HOME);
    await ow(page, () => { window.__ow.dayNight.hour = 16; }); // the autopilot ran the clock at 40x
    await sleep(8000);
    return { ...r, stills: [ap, ws] };
  },

  async map(page) {
    await key(page, 'KeyM');
    await sleep(4500);
    const s = await still(page, 'map');
    // Pick a spot: the card offers Drop here / Navigate here.
    await page.mouse.click(Math.round(W * 0.78), Math.round(H * 0.3));
    await sleep(2500);
    const pick = await still(page, 'map-pick');
    // Zoom all the way out: the map turns into the globe, with live clouds.
    await page.mouse.move(Math.round(W * 0.5), Math.round(H * 0.5));
    for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 600); await sleep(220); }
    await sleep(3500);
    const globe = await still(page, 'map-globe');
    for (let i = 0; i < 3 && await ow(page, () => !!document.querySelector('.ow-wmap')); i++) { await page.keyboard.press('Escape'); await sleep(500); }
    return { stills: [s, pick, globe] };
  },

  async landmarks(page) {
    // The Empire State from the air over Koreatown, then Times Square after dark.
    await ow(page, () => { window.__ow.dayNight.hour = 15.5; });
    await ow(page, () => {
      const { earth, player } = window.__ow;
      const L = earth.frame.toLocal(40.7437, -73.9905);
      player.placeAt(L.x, L.z, 0);
    });
    await sleep(6000); // let the blocks around the Empire State stream in
    // Hover there on the rocket shoes (held in place while we shoot).
    const hover = () => ow(page, () => {
      const { earth, player } = window.__ow;
      const L = earth.frame.toLocal(40.7437, -73.9905), T = earth.frame.toLocal(40.7484, -73.9857);
      const yaw = Math.atan2(T.x - L.x, T.z - L.z);
      player.position.set(L.x, 175, L.z); player.vel.set(0, 0, 0); player.mode = 'fly';
      player.facing = player.yaw = yaw; player.pitch = -0.1; player.zoom = 2;
      player.snapCamera?.();
    });
    for (let i = 0; i < 8; i++) { await hover(); await sleep(250); }
    await hover();
    const esb = await still(page, 'landmarks-esb');
    await ow(page, () => {
      const { earth, player, dayNight } = window.__ow;
      const L = earth.frame.toLocal(40.7577, -73.9857);
      player.placeAt(L.x, L.z, Math.PI); player.pitch = 0.05; player.zoom = 0;
      dayNight.hour = 21;
    });
    await sleep(6000);
    const tsq = await still(page, 'landmarks-tsq');
    await ow(page, () => { window.__ow.dayNight.hour = 16; });
    await sleep(1000);
    return { stills: [esb, tsq] };
  },

  async hq(page) {
    const h = await homeSpot(page);
    // Back across the street, looking up at the entrance and the tower.
    // Up on the rocket shoes, across from the tower, looking at its crown.
    const fp = await ow(page, () => { const f = window.__ow.place.sites[0].fp; return { h: f.h, base: f.base, cx: f.cx, cz: f.cz }; });
    const back = Math.max(45, fp.h * 0.9);
    const x = h.door.x + h.out.x * back, z = h.door.z + h.out.z * back;
    await placeAt(page, x, z, Math.atan2(fp.cx - x, fp.cz - z), { pitch: -0.15, zoom: 3, settle: 600 });
    await page.keyboard.down('Space');
    await ow(page, ({ y }) => {
      const p = window.__ow.player;
      p.position.y = y; p.vel.set(0, 0, 0); p.mode = 'fly';
      p.snapCamera();
    }, { y: fp.base + fp.h * 0.55 });
    await sleep(160);
    const wide = await still(page, 'hq-wide');
    await page.keyboard.up('Space');
    await sleep(3500);
    const nx = h.approach.x + h.out.x * 1.2, nz = h.approach.z + h.out.z * 1.2;
    await placeAt(page, nx, nz, Math.atan2(h.door.x - nx, h.door.z - nz), { pitch: 0.05, zoom: 0, settle: 2500 });
    const door = await still(page, 'hq-door'); // with the "Enter …" prompt showing
    return { stills: [wide, door], repo: h.name };
  },

  async inside(page) {
    const h = await homeSpot(page);
    await ow(page, (name) => window.__ow.enterBuilding(window.__ow.place.sites.find((s) => s.repo.name === name).repo), h.name);
    await sleep(6000);
    const stills = [];
    // Reception, as you walk in (settle on the spawn point, whatever the robot was doing outside).
    const sp = await ow(page, () => ({ x: window.__ow.player.position.x, z: window.__ow.player.position.z, yaw: window.__ow.player.yaw }));
    await placeAt(page, sp.x, sp.z, sp.yaw, { zoom: 0, settle: 1500 });
    stills.push(await still(page, 'inside-reception'));
    // The lift up to the work floor, with its floor picker open.
    const lift = await rideLift(page, 0, 1, 'inside-elevator');
    if (typeof lift === 'string') stills.push(lift);
    if (await goToInteractable(page, '^w-', 1.8)) stills.push(await still(page, 'inside-desk'));
    return { stills };
  },

  async lab(page) {
    await rideLift(page, 1, 2);
    const id = await goToInteractable(page, '^kiosk$', 2.4);
    if (!id) throw new Error('no Agent Lab kiosk');
    const room = await still(page, 'lab-room');
    await triggerInteractable(page, id);
    const panel = await still(page, 'lab-panel');
    await closePanels(page);
    return { stills: [room, panel] };
  },

  async board(page) {
    await rideLift(page, 2, 3);
    const head = await findInteractable(page, '^boardroom$');
    if (!head) throw new Error('no boardroom');
    const id = head.id;
    // Stand at the head of the table looking down it, the board around it.
    const c = await ow(page, () => {
      const pts = [...window.__ow.ctx.labels.items.entries()].filter(([k]) => k.startsWith('lbl-b-')).map(([, v]) => v.pos);
      return pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length } : null;
    });
    if (c) {
      // From beside the table, behind the chairs, whichever side the camera has room on.
      const a = Math.atan2(head.x - c.x, head.z - c.z);
      await standFacing(page, c.x, c.z, 3.1, { dirs: [a + Math.PI / 2, a - Math.PI / 2], pitch: 0.42, zoom: 1, settle: 1800 });
    } else await goToInteractable(page, '^boardroom$', 1.6);
    const room = await still(page, 'board-room');
    await triggerInteractable(page, id);
    const panel = await still(page, 'board-panel');
    await closePanels(page);
    await ow(page, () => window.__ow.exitBuilding());
    await sleep(5000);
    return { stills: [room, panel] };
  },

  async phone(page) {
    const h = await homeSpot(page);
    await placeAt(page, h.approach.x + h.out.x * 6, h.approach.z + h.out.z * 6, Math.atan2(-h.out.x, -h.out.z), { pitch: 0.1, settle: 2000 });
    await ow(page, () => window.__ow.phone.open('team'));
    await sleep(2000);
    const list = await still(page, 'phone-projects');
    const top = await ow(page, () => window.__ow.phone.threads?.().find((t) => t.id.startsWith('repo:') && t.last)?.id?.slice(5) ?? window.__ow.place.sites[0].repo.name);
    await ow(page, (r) => window.__ow.phone.openThread(r), top);
    await sleep(2000);
    const thread = await still(page, 'phone-thread');
    await ow(page, () => window.__ow.phone.open('agents'));
    await sleep(1500);
    const agents = await still(page, 'phone-agents');
    await ow(page, () => window.__ow.phone.close());
    await sleep(600);
    return { stills: [list, thread, agents] };
  },

  async home(page) {
    // Home: 150 Central Park South, from anywhere (the phone's Home button does this).
    await ow(page, () => window.__ow.goHome());
    await sleep(9000);
    const door = await findInteractable(page, '^door:home$');
    let street = null, inside = null;
    if (door) {
      await standFacing(page, door.x, door.z, 7, { pitch: 0.12 });
      street = await still(page, 'home-street');
      await triggerInteractable(page, door.id);
      await sleep(5000);
      // Into the living room, looking toward the park windows: whichever spot leaves the camera most room.
      const start = await ow(page, () => { const g = window.__ow.generic?.it; const p = window.__ow.player; return g ? { x: p.position.x, y: p.position.y, z: p.position.z, f: g.spawnFacing } : null; });
      if (start) {
        let best = null;
        for (const d of [2, 4, 6, 8]) for (const dy of [0, 0.5, -0.5]) {
          const room = await ow(page, ({ s, d, dy }) => {
            const p = window.__ow.player, f = s.f + dy;
            p.position.set(s.x + Math.sin(s.f) * d, s.y, s.z + Math.cos(s.f) * d); p.vel.set(0, 0, 0);
            p.facing = p.yaw = f; p.pitch = 0.15; p.snapCamera?.();
            return window.__ow.engine.camera.position.distanceTo(p.position);
          }, { s: start, d, dy });
          await sleep(150);
          if (!best || room > best.room + 0.05) best = { d, dy, room };
        }
        await ow(page, ({ s, b }) => {
          const p = window.__ow.player, f = s.f + b.dy;
          p.position.set(s.x + Math.sin(s.f) * b.d, s.y, s.z + Math.cos(s.f) * b.d); p.vel.set(0, 0, 0);
          p.facing = p.yaw = f; p.pitch = 0.15; p.snapCamera?.();
        }, { s: start, b: best });
      }
      await sleep(2500);
      inside = await still(page, 'home-inside');
      await ow(page, () => window.__ow.exitGeneric('door', 0));
      await sleep(2500);
    }
    await ow(page, (hm) => window.__ow.dropAt(hm.lat, hm.lon, hm.name), HOME);
    await sleep(8000);
    return { stills: [street, inside].filter(Boolean) };
  },

  async photo(page) {
    const h = await homeSpot(page);
    // Down the middle of the street, sky in frame, as the afternoon turns to night.
    const x = h.approach.x + h.out.x * 9, z = h.approach.z + h.out.z * 9;
    await placeAt(page, x, z, Math.atan2(-h.out.z, h.out.x), { pitch: -0.42, zoom: 2.5, settle: 2500 });
    await ow(page, () => { window.__ow.dayNight.hour = 16.5; });
    await sleep(800);
    const r = await clip(page, 'timelapse', 6, async () => {
      await key(page, 'KeyL');
    }, 0.35);
    await key(page, 'KeyL');
    // Photo mode at the HQ's front door in the evening light.
    const dx = h.approach.x + h.out.x * 3, dz = h.approach.z + h.out.z * 3;
    await placeAt(page, dx, dz, Math.atan2(h.door.x - dx, h.door.z - dz), { pitch: 0.05, zoom: 0, settle: 1500 });
    await ow(page, () => { window.__ow.dayNight.hour = 17.6; });
    await sleep(1500);
    await key(page, 'KeyF');
    await sleep(2500);
    const p = await still(page, 'photo-mode');
    await key(page, 'KeyF');
    await ow(page, () => { window.__ow.dayNight.hour = 16; window.__ow.player.zoom = 0; });
    await sleep(800);
    return { ...r, stills: [p] };
  },
};

/** VR runs in its own page with the IWER Quest 3 emulator installed before the game loads. */
async function captureVR(browser) {
  const cache = join(tmpdir(), 'iwer-2.6.0.min.js');
  if (!existsSync(cache)) {
    const res = await fetch('https://cdn.jsdelivr.net/npm/iwer@2.6.0/build/iwer.min.js');
    if (!res.ok) throw new Error(`IWER download failed (${res.status})`);
    writeFileSync(cache, await res.text());
  }
  // IWER 2.6 passes an XRRigidTransform where three.js expects a matrix when the play space moves.
  const init = readFileSync(cache, 'utf8') + `;window.__xrdev = new IWER.XRDevice(IWER.metaQuest3); window.__xrdev.installRuntime({ forceInstall: true });
    { const P = XRReferenceSpace.prototype, o = P.getOffsetReferenceSpace; P.getOffsetReferenceSpace = function (t) { return o.call(this, t.matrix ?? t); }; }`;
  const page = await openGame(browser, { init });
  const dev = (js) => page.evaluate(js);
  const h = await homeSpot(page);
  await placeAt(page, h.approach.x + h.out.x * 7, h.approach.z + h.out.z * 7, Math.atan2(-h.out.z, h.out.x), { settle: 1500 });
  await page.click('#vr-btn');
  await sleep(4000);
  await dev(`__xrdev.controllers.left.updateButtonValue('x-button', 1)`); await sleep(200);
  await dev(`__xrdev.controllers.left.updateButtonValue('x-button', 0)`); await sleep(300);
  await dev(`__xrdev.controllers.left.position.set(-0.02, 1.5, -0.32); __xrdev.controllers.left.quaternion.set(0, 0, 0, 1);`);
  await dev(`__xrdev.controllers.right.position.set(0.15, 1.3, -0.15); __xrdev.controllers.right.quaternion.set(0, 0, 0, 1);`);
  await sleep(2500);
  const s = await still(page, 'vr-phone');
  await page.evaluate(() => window.__ow.engine.renderer.xr.getSession()?.end());
  await page.close();
  return { stills: [s] };
}

// ---------------------------------------------------------------- run

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const want = (k) => !ONLY || ONLY.includes(k);
const results = {};
try {
  if (Object.keys(STEPS).some(want)) {
    console.log(`Capturing from ${BASE}`);
    const page = await openGame(browser);
    for (const [k, fn] of Object.entries(STEPS)) {
      if (!want(k)) continue;
      process.stdout.write(`${k}…\n`);
      try { results[k] = await fn(page); } catch (e) { console.warn(`  ${k} failed: ${e.message}`); }
    }
    await page.close();
  }
  if (want('vr')) {
    process.stdout.write('vr…\n');
    try { results.vr = await captureVR(browser); } catch (e) { console.warn(`  vr failed: ${e.message}`); }
  }
} finally {
  await browser.close();
}

for (const [k, r] of Object.entries(results)) if (r) manifest.steps[k] = { ...r, v: stamp };
manifest.capturedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${Object.keys(results).length} step(s) to ${OUT}`);
