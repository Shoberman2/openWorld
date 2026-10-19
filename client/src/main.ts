import * as THREE from 'three';
import type { AgentInfo, CityId, Me, Repo } from '../../shared/types.ts';
import { api, connectLive, onLive, track } from './api.ts';
import { Engine, DayNight } from './engine.ts';
import { Input } from './input.ts';
import { loadCharacters, makePlayer } from './characters.ts';
import { Player } from './player.ts';
import { Interactions, Labels, esc } from './interact.ts';
import { CITIES } from './city/profiles.ts';
import { buildCity, type City } from './city/index.ts';
import { locationName, type RepoSite } from './city/layout.ts';
import { Traffic } from './traffic.ts';
import { Pedestrians } from './pedestrians.ts';
import { Aircraft } from './aircraft.ts';
import { Ambience } from './audio.ts';
import { Minimap } from './ui/minimap.ts';
import { openDirectory } from './ui/directory.ts';
import { bindPanelInput, panelOpen, toast } from './ui/panel.ts';
import { buildInterior, type Interior } from './interior.ts';
import type { GameCtx } from './ctx.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CITY_KEY = 'openworld.city';

// ------------------------------------------------------------------ title screen
let me: Me | null = null;
let city: CityId = (localStorage.getItem(CITY_KEY) as CityId) || 'nyc';
try { if (!CITIES[city]) city = 'nyc'; } catch { city = 'nyc'; }

function renderCities() {
  const root = $('cities');
  root.innerHTML = '';
  for (const p of Object.values(CITIES)) {
    const b = document.createElement('button');
    b.className = `city${p.id === city ? ' selected' : ''}`;
    b.innerHTML = `<canvas width="400" height="240"></canvas><div class="meta"><b>${p.name}</b><span>${p.district} · ${p.blurb}</span></div>`;
    drawThumb(b.querySelector('canvas')!, p.id);
    b.addEventListener('click', () => {
      city = p.id;
      try { localStorage.setItem(CITY_KEY, city); } catch { /* private mode */ }
      renderCities();
    });
    root.appendChild(b);
  }
}

/** Little procedural skyline postcard for each city card. */
function drawThumb(c: HTMLCanvasElement, id: CityId) {
  const g = c.getContext('2d')!;
  const p = CITIES[id];
  const sky = g.createLinearGradient(0, 0, 0, 240);
  sky.addColorStop(0, '#0f1a2e'); sky.addColorStop(1, p.thumb[1]);
  g.fillStyle = sky; g.fillRect(0, 0, 400, 240);
  g.fillStyle = p.thumb[0]; g.globalAlpha = 0.85;
  g.beginPath(); g.arc(320, 70, 26, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  let seed = id.length * 977;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 400;) {
    const w = 14 + r() * 26;
    const peak = Math.exp(-(((x - 200) / 120) ** 2));
    const h = 30 + r() * 50 + peak * (p.maxHeight / 2.2) * r();
    g.fillStyle = `rgba(10,14,22,${0.85 + r() * 0.15})`;
    g.fillRect(x, 200 - h, w, h + 40);
    g.fillStyle = 'rgba(255,214,140,0.7)';
    for (let wy = 200 - h + 6; wy < 196; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (r() < 0.3) g.fillRect(wx, wy, 2, 3);
    x += w + 1;
  }
  g.fillStyle = id === 'miami' ? '#1f6f80' : '#16324a';
  g.fillRect(0, 200, 400, 40);
}

async function initTitle() {
  renderCities();
  const status = $('gh-status');
  try {
    me = await api.me();
  } catch {
    status.innerHTML = 'Local server is not running. Start it with <b>npm run dev</b>.';
    return;
  }
  const form = $('token-form');
  if (me.connected) {
    status.innerHTML = `${me.avatarUrl ? `<img src="${esc(me.avatarUrl)}">` : ''} Connected to GitHub as <b>${esc(me.login ?? '')}</b>${me.claudeAvailable ? ' · agents ready' : ' · <span style="color:var(--bad)">install Claude Code to hire agents</span>'}`;
    form.classList.add('hidden');
    ($('play') as HTMLButtonElement).disabled = false;
  } else {
    status.innerHTML = 'Not connected to GitHub. Run <b>gh auth login</b>, or paste a token:';
    form.classList.remove('hidden');
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const token = ($('token-input') as HTMLInputElement).value.trim();
    if (!token) return;
    try { me = await api.saveToken(token); } catch (err) { status.textContent = String((err as Error).message); return; }
    initTitle();
  };
}

$('play').addEventListener('click', () => start(city).catch((e) => {
  console.error(e);
  $('loading-text').textContent = `Something went wrong: ${(e as Error).message}`;
}));
initTitle();

// ------------------------------------------------------------------ the game
async function start(cityId: CityId) {
  $('title').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const say = (m: string) => ($('loading-text').textContent = m);
  track('session_start', { city: cityId });

  say('Reading your GitHub…');
  const [repos, agents] = await Promise.all([api.repos(), api.agents().catch(() => [] as AgentInfo[]), loadCharacters(say)]);
  const engine = new Engine($('game') as HTMLCanvasElement);
  const input = new Input($('game') as HTMLCanvasElement);
  bindPanelInput((on) => input.setEnabled(on));

  const c = await buildCity(cityId, repos, say);
  const cityScene = new THREE.Scene();
  cityScene.add(c.group);
  engine.setScene(cityScene);
  const dayNight = new DayNight(engine, cityScene, CITIES[cityId].sky);

  say('Filling the streets…');
  const traffic = new Traffic(c.layout, c.streets, cityId === 'nyc' ? 240 : 170);
  cityScene.add(traffic.group);
  const player = new Player(makePlayer(), input, engine.camera);
  cityScene.add(player.ch.root);
  player.setWorld({ colliders: c.colliders, groundY: (x, z) => c.layout.groundY(x, z) + onSidewalk(c, x, z), bounds: shrink(c.layout.land, 1.2) }, c.layout.spawn, c.layout.spawnFacing);
  const peds = new Pedestrians(c.layout, 64, player.position);
  cityScene.add(peds.group);
  const air = new Aircraft(c.layout, 5);
  cityScene.add(air.group);
  const ambience = new Ambience();
  const minimap = new Minimap(c.layout);
  const interactions = new Interactions();
  const labels = new Labels();
  const cityOccluder = (a: THREE.Vector3, b: THREE.Vector3) => c.colliders.rayFraction(a, b) < 0.98;
  labels.occluder = cityOccluder;

  const ctx: GameCtx = {
    engine, input, player, interactions, labels, dayNight, repos,
    agents: new Map(agents.map((a) => [a.id, a])),
    enterBuilding: (r) => enterBuilding(r),
    exitBuilding: () => exitBuilding(),
  };

  // ---- Building doors & labels ----
  const siteByRepo = new Map<string, RepoSite>(c.layout.sites.map((s) => [s.repo.name, s]));
  const topByRepo = new Map(c.buildings.map((b) => [b.site.repo.name, b.top]));
  const agentsByRepo = () => {
    const m = new Map<string, number>();
    for (const a of ctx.agents.values()) if (a.status === 'running' || a.status === 'preparing') m.set(a.repo, (m.get(a.repo) ?? 0) + 1);
    return m;
  };
  const LABEL_DIST = { landmark: 1400, tower: 800, midrise: 320, small: 160 } as const;
  function addCityInteractions() {
    for (const s of c.layout.sites) {
      interactions.add({
        id: `door:${s.repo.name}`, position: s.approach, radius: s.repo.tier === 'landmark' ? 6 : 4.5,
        label: `Enter ${s.repo.name}`, sub: tierWord(s.repo),
        action: () => enterBuilding(s.repo),
      });
    }
    refreshCityLabels();
  }
  function refreshCityLabels() {
    const busy = agentsByRepo();
    for (const s of c.layout.sites) {
      const top = topByRepo.get(s.repo.name)!;
      const n = busy.get(s.repo.name) ?? 0;
      labels.set(`b:${s.repo.name}`, new THREE.Vector3(top.x, top.y + 10, top.z),
        `${esc(s.repo.name)}${n ? `<small style="color:var(--good)">⚙ ${n} agent${n > 1 ? 's' : ''} working</small>` : ''}`,
        { maxDist: LABEL_DIST[s.repo.tier], minDist: 30, cls: n ? 'agent' : '' });
      labels.set(`d:${s.repo.name}`, s.door.clone().add(new THREE.Vector3(0, 7.2, 0)).addScaledVector(s.doorOut, 1), `${esc(s.repo.name)}<small>${tierWord(s.repo)}</small>`, { maxDist: 40 });
    }
  }
  addCityInteractions();

  // ---- Live agents ----
  connectLive();
  onLive((msg) => {
    if (msg.type !== 'agent:update') return;
    const prev = ctx.agents.get(msg.agent.id);
    ctx.agents.set(msg.agent.id, msg.agent);
    if (prev?.status !== msg.agent.status) {
      if (msg.agent.status === 'done') toast(`<b>${esc(msg.agent.name)}</b> finished in <b>${esc(msg.agent.repo)}</b> · ${msg.agent.filesChanged.length} files changed`, 8000);
      if (msg.agent.status === 'error') toast(`<b>${esc(msg.agent.name)}</b> hit an error in ${esc(msg.agent.repo)}`, 8000);
      if (!interior) refreshCityLabels();
    }
  });

  // ---- Interiors ----
  let interior: Interior | null = null;
  let lastDoor: RepoSite | null = null;
  let busy = false;
  async function fade(on: boolean) {
    $('fade').classList.toggle('on', on);
    await new Promise((r) => setTimeout(r, 460));
  }
  async function enterBuilding(repo: Repo) {
    if (busy || interior) return;
    busy = true;
    lastDoor = siteByRepo.get(repo.name) ?? null;
    await fade(true);
    try {
      interactions.clear();
      labels.clear();
      const it = await buildInterior(ctx, repo);
      interior = it;
      cityScene.remove(player.ch.root);
      it.scene.add(player.ch.root);
      engine.setScene(it.scene);
      labels.occluder = null;
      player.setWorld(it.world, it.spawn, it.spawnFacing);
      ambience.indoor = true;
    } catch (e) {
      console.error(e);
      toast(`Couldn't open ${esc(repo.name)}: ${esc((e as Error).message)}`);
      addCityInteractions();
    }
    await fade(false);
    busy = false;
  }
  async function exitBuilding() {
    if (busy || !interior) return;
    busy = true;
    await fade(true);
    interior.dispose();
    interior.scene.remove(player.ch.root);
    interior = null;
    interactions.clear();
    labels.clear();
    cityScene.add(player.ch.root);
    engine.setScene(cityScene);
    labels.occluder = cityOccluder;
    const s = lastDoor;
    const at = s ? s.approach.clone().addScaledVector(s.doorOut, 2) : c.layout.spawn;
    const facing = s ? Math.atan2(s.doorOut.x, s.doorOut.z) : 0;
    player.setWorld({ colliders: c.colliders, groundY: (x, z) => c.layout.groundY(x, z) + onSidewalk(c, x, z), bounds: shrink(c.layout.land, 1.2) }, at, facing);
    addCityInteractions();
    ambience.indoor = false;
    await fade(false);
    busy = false;
  }

  // ---- Keys ----
  input.onPress('KeyE', () => { if (!panelOpen() && !busy) interactions.trigger(); });
  input.onPress('KeyM', () => { if (!interior && !panelOpen()) minimap.toggle(); });
  input.onPress('KeyT', () => { dayNight.hour = (dayNight.hour + 3) % 24; });
  input.onPress('Tab', () => {
    if (panelOpen() || interior) return;
    openDirectory(c.layout.sites, agentsByRepo(), CITIES[cityId].name, {
      waypoint: (s) => { minimap.waypoint = { x: s.approach.x, z: s.approach.z, name: s.repo.name }; toast(`Waypoint set: <b>${esc(s.repo.name)}</b>`); },
      travel: async (s) => {
        await fade(true);
        player.setWorld(player.world, s.approach.clone().addScaledVector(s.doorOut, 6), Math.atan2(-s.doorOut.x, -s.doorOut.z));
        minimap.waypoint = null;
        await fade(false);
      },
    });
  });
  window.addEventListener('pointerdown', () => ambience.start(), { once: true });

  // ---- HUD ----
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  toast(`Welcome to <b>${esc(CITIES[cityId].name)}</b>. Your ${repos.length} projects are here; the tallest tower is <b>${esc(c.layout.sites[0]?.repo.name ?? '')}</b>. Press <b>Tab</b> for the directory.`, 9000);
  const locEl = $('hud-location'), timeEl = $('hud-time'), agentEl = $('hud-agents'), lookEl = $('click-to-look');
  let hudTimer = 0;

  // Debug handle for automated screenshots / console poking.
  (window as unknown as { __ow: unknown }).__ow = { player, dayNight, c, ctx, enterBuilding, exitBuilding, traffic };

  // ---- Loop ----
  const timer = new THREE.Timer();
  let time = 0;
  function loop() {
    requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    player.update(dt);
    if (interior) {
      interior.update(dt);
    } else {
      dayNight.update(dt, player.position);
      c.update(dt, time);
      traffic.update(dt, player.position);
      peds.update(dt, player.position);
      air.update(dt);
      if (minimap.waypoint && Math.hypot(minimap.waypoint.x - player.position.x, minimap.waypoint.z - player.position.z) < 8) {
        toast(`Arrived at <b>${esc(minimap.waypoint.name)}</b>. Press <b>E</b> at the door.`);
        minimap.waypoint = null;
      }
    }
    interactions.update(player.position, player.facing, !panelOpen() && !busy);
    labels.update(engine.camera);
    ambience.update(dt, interior ? Infinity : air.nearest(player.position), dayNight.night);
    engine.render();

    hudTimer -= dt;
    if (hudTimer < 0) {
      hudTimer = 0.25;
      locEl.innerHTML = interior
        ? `${esc(interior.repo.name)} HQ<small>${esc(interior.repo.description || 'Inside the building')}</small>`
        : `${esc(locationName(c.layout, player.position.x, player.position.z))}<small>${esc(CITIES[cityId].district)}, ${esc(CITIES[cityId].name)}</small>`;
      timeEl.textContent = `${dayNight.label()}  ·  T to skip ahead`;
      const n = [...ctx.agents.values()].filter((a) => a.status === 'running' || a.status === 'preparing').length;
      agentEl.classList.toggle('hidden', n === 0);
      agentEl.textContent = `⚙ ${n} agent${n === 1 ? '' : 's'} working`;
      lookEl.classList.toggle('hidden', input.locked || panelOpen());
      $('minimap').classList.toggle('hidden', !!interior);
    }
    if (!interior) minimap.draw(player.position, player.yaw);
  }
  loop();
}

function tierWord(r: Repo) {
  return { landmark: 'Skyscraper HQ', tower: 'Tower', midrise: 'Office building', small: 'Storefront studio' }[r.tier];
}

function shrink(b: { minX: number; maxX: number; minZ: number; maxZ: number }, by: number) {
  return { minX: b.minX + by, maxX: b.maxX - by, minZ: b.minZ + by, maxZ: b.maxZ - by };
}

/** Curb height when standing on a sidewalk or promenade. */
function onSidewalk(c: City, x: number, z: number) {
  const L = c.layout;
  for (const b of L.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return 0.18;
  const g = L.grid, p = L.profile;
  if (x < g.minX - p.avenueW / 2 || x > g.maxX + p.avenueW / 2 || z < g.minZ - p.streetW / 2 || z > g.maxZ + p.streetW / 2) return 0.18;
  return 0;
}
