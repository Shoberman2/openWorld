import * as THREE from 'three';
import type { AgentInfo, CityId, GeoPlace, Me, Repo } from '../../shared/types.ts';
import { api, connectLive, onLive, track } from './api.ts';
import { Engine, DayNight } from './engine.ts';
import { Input } from './input.ts';
import { loadCharacters } from './characters.ts';
import { makeRobot } from './robot.ts';
import { Player } from './player.ts';
import { Interactions, Labels, esc } from './interact.ts';
import { CITIES } from './city/profiles.ts';
import { buildPresetPlace, type Place, type Site } from './place.ts';
import { buildEarthPlace, searchPlaces, type EarthApi } from './earth/index.ts';
import { haversine } from './earth/frame.ts';
import { Aircraft } from './aircraft.ts';
import { Ambience } from './audio.ts';
import { Minimap } from './ui/minimap.ts';
import { TileMap } from './ui/tilemap.ts';
import { EarthMinimap, type MapMarker } from './ui/earthMinimap.ts';
import { openWorldMap, worldMapOpen, FAMOUS_PLACES } from './ui/worldmap.ts';
import { installHud, type Hud } from './ui/hud.ts';
import { openDirectory } from './ui/directory.ts';
import { bindPanelInput, panelOpen, toast } from './ui/panel.ts';
import { buildInterior, type Interior } from './interior.ts';
import { installPhone } from './ui/phone.ts';
import { PhotoMode } from './ui/photo.ts';
import type { VehicleId } from './vehicles/index.ts';
import { buildGenericInterior, guessKind, type GenericInterior } from './rooms/index.ts';
import type { BuildingHit } from './earth/chunks.ts';
import type { GameCtx } from './ctx.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CITY_KEY = 'openworld.city';

// ------------------------------------------------------------------ title screen
const WORLD_KEY = 'openworld.place';
let me: Me | null = null;
let city: CityId = 'nyc';

const QUICK: GeoPlace[] = [
  { name: 'Times Square', label: 'Times Square, New York, United States', lat: 40.758, lon: -73.9855, countryCode: 'us', kind: 'square' },
  { name: 'Russian Hill', label: 'Russian Hill, San Francisco, United States', lat: 37.8011, lon: -122.4181, countryCode: 'us', kind: 'quarter' },
  { name: 'Financial District', label: 'Financial District, San Francisco, United States', lat: 37.7936, lon: -122.3989, countryCode: 'us', kind: 'quarter' },
  { name: 'Brickell', label: 'Brickell, Miami, United States', lat: 25.7663, lon: -80.1925, countryCode: 'us', kind: 'quarter' },
  { name: 'Back Bay', label: 'Back Bay, Boston, United States', lat: 42.3503, lon: -71.0810, countryCode: 'us', kind: 'quarter' },
  { name: 'Jordaan', label: 'Jordaan, Amsterdam, Netherlands', lat: 52.3752, lon: 4.8820, countryCode: 'nl', kind: 'quarter' },
  { name: 'Le Marais', label: 'Le Marais, Paris, France', lat: 48.8579, lon: 2.3590, countryCode: 'fr', kind: 'quarter' },
  { name: 'Shibuya Crossing', label: 'Shibuya Crossing, Tokyo, Japan', lat: 35.6595, lon: 139.7005, countryCode: 'jp', kind: 'square' },
  { name: 'The City', label: 'Bank, City of London, United Kingdom', lat: 51.5134, lon: -0.0890, countryCode: 'gb', kind: 'quarter' },
  { name: 'Downtown Dubai', label: 'Downtown Dubai, Dubai, United Arab Emirates', lat: 25.1972, lon: 55.2744, countryCode: 'ae', kind: 'quarter' },
  { name: 'Marina Bay', label: 'Marina Bay, Singapore', lat: 1.2834, lon: 103.8607, countryCode: 'sg', kind: 'quarter' },
  { name: 'Central', label: 'Central, Hong Kong', lat: 22.2820, lon: 114.1588, countryCode: 'hk', kind: 'quarter' },
];

/** Where the game starts: a real place (the default), or one of the classic procedural cities. */
let realPlace: GeoPlace | null = QUICK[0];
try {
  city = (localStorage.getItem(CITY_KEY) as CityId) || 'nyc';
  if (!CITIES[city]) city = 'nyc';
  const saved = localStorage.getItem(WORLD_KEY);
  if (saved === 'classic') realPlace = null;
  else if (saved) realPlace = JSON.parse(saved) as GeoPlace;
} catch { city = 'nyc'; }
const store = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

function renderCities() {
  const root = $('cities');
  root.innerHTML = '';
  for (const p of Object.values(CITIES)) {
    const b = document.createElement('button');
    b.className = `city${p.id === city && !realPlace ? ' selected' : ''}`;
    b.innerHTML = `<canvas width="400" height="240"></canvas><div class="meta"><b>${p.name}</b><span>${p.district} · ${p.blurb}</span></div>`;
    drawThumb(b.querySelector('canvas')!, p.id);
    b.addEventListener('click', () => {
      city = p.id;
      realPlace = null;
      store(CITY_KEY, city); store(WORLD_KEY, 'classic');
      renderCities();
    });
    root.appendChild(b);
  }
  renderWorldPick();
}

/** "Anywhere on Earth": search any place and play it, streamed from OpenStreetMap map tiles. */
function renderWorldPick() {
  const root = $('world-pick');
  root.classList.toggle('selected', !!realPlace);
  root.innerHTML = `
    <div class="wp-head"><b>🌍 Anywhere on Earth</b><span>The whole planet streams in from OpenStreetMap with real terrain. Walk, or fly on rocket shoes, anywhere. Your projects move into real towers where you start.</span></div>
    <form><input type="text" placeholder="Search a place: Shibuya, Champs-Élysées, your hometown…" autocomplete="off" /><button type="submit">Search</button></form>
    <div class="wp-results"></div>
    <div class="wp-chips">${QUICK.map((q, i) => `<button type="button" class="wp-chip${realPlace && realPlace.lat === q.lat ? ' on' : ''}" data-i="${i}">${esc(q.label.split(',').slice(0, 2).join(','))}</button>`).join('')}</div>
    ${realPlace ? `<div class="wp-chosen">Starting at <b>${esc(realPlace.label || realPlace.name)}</b></div>` : '<div class="wp-chosen">Starting in a classic city. Pick a place above to start on the real map instead.</div>'}`;
  const choose = (p: GeoPlace) => {
    realPlace = p;
    store(WORLD_KEY, JSON.stringify(p));
    renderCities();
  };
  root.querySelectorAll<HTMLButtonElement>('.wp-chip').forEach((b) => b.addEventListener('click', () => choose(QUICK[Number(b.dataset.i)])));
  const form = root.querySelector('form')!, input = form.querySelector('input')!, results = root.querySelector('.wp-results')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    results.innerHTML = '<small style="color:var(--muted)">Searching…</small>';
    try {
      const hits = await searchPlaces(q);
      results.innerHTML = hits.length ? '' : '<small style="color:var(--muted)">No places found.</small>';
      for (const h of hits) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `${esc(h.name)}<small>${esc(h.label)}</small>`;
        b.addEventListener('click', () => choose(h));
        results.appendChild(b);
      }
    } catch (err) {
      results.innerHTML = `<small style="color:var(--bad)">${esc((err as Error).message)}</small>`;
    }
  });
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

$('play').addEventListener('click', () => start(realPlace ?? city).catch((e) => {
  console.error(e);
  $('loading-text').textContent = `Something went wrong: ${(e as Error).message}`;
}));
initTitle();

// ------------------------------------------------------------------ the game
const HINTS = {
  walk: ['[W][A][S][D] Move · [Shift] Run · [Space] Jump', '[Space] in the air: rocket shoes', '[E] Interact · [P] Phone · [M] Map', '[Tab] Directory · [F] Photo mode · [L] Time-lapse · [G] Wave'],
  fly: ['[Space] Climb · let go to hover', '[W][A][S][D] Steer · [Shift] Burst', '[C] Dive · land on roofs and bridges', '[M] Map · [P] Phone'],
  indoors: ['[W][A][S][D] Move · [E] Talk / use', '[P] Phone · [Esc] Release mouse'],
  skate: ['[W] Push · [S] Brake · [A][D] Carve', '[Space] Ollie · [Shift] Faster', '[1] Get off · [2]–[7] Switch'],
  bike: ['[W] Pedal · [S] Brake · [A][D] Steer', '[Space] Bunny hop · [Shift] Sprint', '[1] Get off · [2]–[7] Switch'],
  jeep: ['[W] Gas · [S] Brake / reverse · [A][D] Steer', '[Space] Handbrake · [Shift] Boost', '[1] Get out · [2]–[7] Switch'],
  plane: ['[W][S] Throttle · [A][D] Bank / taxi', '[Space] Pull up · [C] Push down · [Shift] Thrust', 'Take off past 32 mph · [1] Bail out'],
  kayak: ['[W][S] Paddle · [A][D] Turn', '[1] Get out · [7] Motorboat'],
  boat: ['[W][S] Throttle · [A][D] Rudder · [Shift] Faster', '[1] Get out · [6] Kayak'],
};
const VEHICLES: { key: string; id: VehicleId; label: string; icon: string }[] = [
  { key: 'Digit1', id: 'foot', label: 'On foot', icon: '🚶' }, { key: 'Digit2', id: 'skate', label: 'Skate', icon: '🛹' },
  { key: 'Digit3', id: 'bike', label: 'Bike', icon: '🚲' }, { key: 'Digit4', id: 'jeep', label: 'Jeep', icon: '🚙' },
  { key: 'Digit5', id: 'plane', label: 'Plane', icon: '🛩️' }, { key: 'Digit6', id: 'kayak', label: 'Kayak', icon: '🛶' },
  { key: 'Digit7', id: 'boat', label: 'Boat', icon: '🚤' },
];

async function start(where: CityId | GeoPlace) {
  $('title').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const say = (m: string) => ($('loading-text').textContent = m);
  const real = typeof where !== 'string';
  track('session_start', real ? { city: 'world', place: where.label || where.name } : { city: where });

  say('Reading your GitHub…');
  const [repos, agents] = await Promise.all([api.repos(), api.agents().catch(() => [] as AgentInfo[]), loadCharacters(say)]);
  const engine = new Engine($('game') as HTMLCanvasElement);
  const input = new Input($('game') as HTMLCanvasElement);
  bindPanelInput((on) => input.setEnabled(on));

  const place: Place & { earth?: EarthApi } = real ? await buildEarthPlace(where, repos, say) : await buildPresetPlace(where, repos, say);
  const earth = place.earth ?? null;
  const cityScene = new THREE.Scene();
  cityScene.add(place.group);
  engine.setScene(cityScene);
  const dayNight = new DayNight(engine, cityScene, place.sky);
  if (place.startHour != null) dayNight.hour = place.startHour;
  // Live weather where you are (Open-Meteo), and the sea follows the storm.
  if (earth) { dayNight.setLocation(earth.home.lat, earth.home.lon); earth.attach(engine.camera, dayNight); }

  const robot = makeRobot();
  const player = new Player(robot, input, engine.camera);
  cityScene.add(robot.root, player.vehicleGroup);
  player.setWorld(place.world, place.spawn, place.spawnFacing);
  const air = new Aircraft(place.airspace, 5);
  cityScene.add(air.group);
  const ambience = new Ambience();
  const interactions = new Interactions();
  const labels = new Labels();
  const cityOccluder = (a: THREE.Vector3, b: THREE.Vector3) => place.colliders.rayFraction(a, b) < 0.98;
  labels.occluder = cityOccluder;

  // Maps: the Earth gets the streaming tile map; classic cities keep their drawn minimap.
  const tileMap = earth ? new TileMap() : null;
  const earthMini = tileMap ? new EarthMinimap(tileMap) : null;
  const minimap = earth ? null : new Minimap(place.map, place.sites);
  const hud: Hud | null = earth ? installHud({
    modes: [{ id: 'walk', label: 'On foot', icon: '🚶' }, { id: 'fly', label: 'Rockets', icon: '🚀' }, ...VEHICLES.slice(1).map((v) => ({ id: v.id, label: v.label, icon: v.icon })), { id: 'map', label: 'Map', icon: '🗺️' }, { id: 'photo', label: 'Camera', icon: '📷' }],
    hints: HINTS,
    onMode: (id) => {
      if (id === 'map') openMap();
      else if (id === 'photo') { if (!photo.active) photo.toggle(player.yaw, player.pitch); }
      else if (id === 'walk' || id === 'fly') ride('foot');
      else ride(id as VehicleId);
    },
  }) : null;
  document.body.classList.toggle('earth-mode', !!earth);
  let waypoint: { lat: number; lon: number; name: string } | null = null;
  const imperial = () => !!earth && ['us', 'gb', 'lr', 'mm'].includes(earth.country);

  const ctx: GameCtx = {
    engine, input, player, interactions, labels, dayNight, repos,
    agents: new Map(agents.map((a) => [a.id, a])),
    enterBuilding: (r) => enterBuilding(r),
    exitBuilding: () => exitBuilding(),
  };

  // ---- Building doors & labels ----
  const siteByRepo = new Map<string, Site>(place.sites.map((s) => [s.repo.name, s]));
  const agentsByRepo = () => {
    const m = new Map<string, number>();
    for (const a of ctx.agents.values()) if (a.status === 'running' || a.status === 'preparing') m.set(a.repo, (m.get(a.repo) ?? 0) + 1);
    return m;
  };
  const sitesHere = () => !earth || earth.atHome;
  const LABEL_DIST = { landmark: 1400, tower: 800, midrise: 320, small: 160 } as const;
  function addCityInteractions() {
    interactions.clear();
    if (!sitesHere()) { labels.clear(); return; }
    for (const s of place.sites) {
      interactions.add({
        id: `door:${s.repo.name}`, position: s.approach, radius: s.repo.tier === 'landmark' ? 6 : 4.5,
        label: `Enter ${s.repo.name}`, sub: tierWord(s.repo),
        action: () => enterBuilding(s.repo),
      });
    }
    refreshCityLabels();
  }
  function refreshCityLabels() {
    labels.clear();
    if (!sitesHere()) return;
    const busy = agentsByRepo();
    for (const s of place.sites) {
      const n = busy.get(s.repo.name) ?? 0;
      labels.set(`b:${s.repo.name}`, new THREE.Vector3(s.top.x, s.top.y + 10, s.top.z),
        `${esc(s.repo.name)}${n ? `<small style="color:var(--good)">⚙ ${n} agent${n > 1 ? 's' : ''} working</small>` : ''}`,
        { maxDist: LABEL_DIST[s.repo.tier], minDist: 30, cls: n ? 'agent' : '' });
      labels.set(`d:${s.repo.name}`, s.door.clone().add(new THREE.Vector3(0, 7.2, 0)).addScaledVector(s.doorOut, 1), `${esc(s.repo.name)}<small>${tierWord(s.repo)}</small>`, { maxDist: 40 });
    }
  }
  addCityInteractions();
  if (earth) earth.onRebase = () => { if (!interior && !generic) addCityInteractions(); };

  // ---- Live agents ----
  connectLive();
  onLive((msg) => {
    if (msg.type !== 'agent:update') return;
    const prev = ctx.agents.get(msg.agent.id);
    ctx.agents.set(msg.agent.id, msg.agent);
    if (prev?.status !== msg.agent.status) {
      if (msg.agent.status === 'done') toast(`<b>${esc(msg.agent.name)}</b> finished in <b>${esc(msg.agent.repo)}</b> · ${msg.agent.filesChanged.length} files changed`, 8000);
      if (msg.agent.status === 'error') toast(`<b>${esc(msg.agent.name)}</b> hit an error in ${esc(msg.agent.repo)}`, 8000);
      if (!interior && !generic) refreshCityLabels();
    }
  });

  // ---- Interiors ----
  let interior: Interior | null = null;
  let lastDoor: Site | null = null;
  let busy = false;
  async function fade(on: boolean) {
    $('fade').classList.toggle('on', on);
    await new Promise((r) => setTimeout(r, 460));
  }
  async function enterBuilding(repo: Repo) {
    if (busy || interior) return;
    if (generic) await exitGeneric('door', 0);
    busy = true;
    lastDoor = siteByRepo.get(repo.name) ?? null;
    if (player.vehicle !== 'foot') player.setVehicle('foot');
    await fade(true);
    try {
      interactions.clear();
      labels.clear();
      const it = await buildInterior(ctx, repo);
      interior = it;
      cityScene.remove(robot.root);
      it.scene.add(robot.root);
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
    interior.scene.remove(robot.root);
    interior = null;
    cityScene.add(robot.root);
    engine.setScene(cityScene);
    labels.occluder = cityOccluder;
    const s = lastDoor;
    const at = s ? s.approach.clone().addScaledVector(s.doorOut, 2) : place.spawn;
    const facing = s ? Math.atan2(s.doorOut.x, s.doorOut.z) : 0;
    player.setWorld(place.world, at, facing);
    addCityInteractions();
    ambience.indoor = false;
    await fade(false);
    busy = false;
  }

  // ---- Every other building: walk up to a wall and press E ----
  let generic: { it: GenericInterior; hit: BuildingHit } | null = null;
  const KIND_WORD: Record<string, string> = { house: 'house', apartments: 'apartments', office: 'offices', shop: 'shop', mall: 'mall', church: 'church', warehouse: 'warehouse', tower: 'tower' };
  const kindOf = (hit: BuildingHit) => {
    const cls = hit.fp.poi?.cls ?? '';
    if (cls === 'place_of_worship') return 'church' as const;
    if (cls === 'mall' || cls === 'department_store') return 'mall' as const;
    if (['shop', 'grocery', 'clothing_store', 'bakery', 'books', 'convenience'].includes(cls)) return 'shop' as const;
    return guessKind({ height: hit.fp.h, area: hit.fp.area, country: earth?.country, name: hit.fp.poi?.name });
  };
  let doorHit: BuildingHit | null = null, doorTimer = 0;
  function updateGenericDoor(dt: number) {
    doorTimer -= dt;
    if (doorTimer > 0 || !earth) return;
    doorTimer = 0.25;
    const hit = !interior && !generic && !busy && player.vehicle === 'foot' && player.mode === 'walk' ? earth.buildingNear(player.position.x, player.position.z, 1.6) : null;
    // Only when you're facing the wall.
    const facingWall = hit && Math.sin(player.facing) * -hit.out.x + Math.cos(player.facing) * -hit.out.z > 0.35;
    if (!facingWall) { if (doorHit) { interactions.remove('door:generic'); doorHit = null; } return; }
    if (doorHit && doorHit.fp.key === hit.fp.key && doorHit.wall === hit.wall) return;
    doorHit = hit;
    const kind = kindOf(hit);
    interactions.add({
      id: 'door:generic', position: hit.point.clone().addScaledVector(hit.out, 0.8), radius: 2.4,
      label: `Go inside${hit.fp.poi ? ` ${hit.fp.poi.name}` : ''}`, sub: hit.fp.poi ? KIND_WORD[kind] : `${KIND_WORD[kind]} · ${Math.max(1, Math.round(hit.fp.h / 3.3))} floors`,
      action: () => { void enterGeneric(hit); },
    });
  }
  function genericInteractions() {
    interactions.clear();
    if (generic) for (const i of generic.it.interactions()) interactions.add(i);
  }
  async function enterGeneric(hit: BuildingHit) {
    if (busy || interior || generic) return;
    busy = true;
    await fade(true);
    try {
      const f = hit.fp;
      const ring = f.ring.map((v, i) => v - (i % 2 ? f.cz : f.cx));
      const it = buildGenericInterior({ key: f.key, ring, height: f.h, kind: kindOf(hit), name: f.poi?.name, doorWall: hit.wall, seed: f.key, country: earth?.country });
      generic = { it, hit };
      interactions.remove('door:generic'); doorHit = null;
      labels.clear();
      cityScene.remove(robot.root, player.vehicleGroup);
      it.scene.add(robot.root);
      engine.setScene(it.scene);
      labels.occluder = null;
      player.setWorld(it.world, it.spawn, it.spawnFacing);
      it.onInteractionsChanged = genericInteractions;
      it.onExit = (how, floor) => { void exitGeneric(how, floor); };
      genericInteractions();
      ambience.indoor = true;
      track('generic_entered', { kind: it.kind, floors: it.floors });
    } catch (e) {
      console.error(e);
      toast(`Couldn't go inside: ${esc((e as Error).message)}`);
      generic = null;
    }
    await fade(false);
    busy = false;
  }
  async function exitGeneric(how: 'door' | 'window', floor: number) {
    if (!generic || busy) return;
    busy = true;
    await fade(true);
    const { it, hit } = generic;
    const yInside = player.position.y; // the floor you're on, in the interior's coordinates (ground floor = 0)
    generic = null;
    it.scene.remove(robot.root);
    it.dispose();
    cityScene.add(robot.root, player.vehicleGroup);
    engine.setScene(cityScene);
    labels.occluder = cityOccluder;
    const out = hit.point.clone().addScaledVector(hit.out, 1.6);
    player.setWorld(place.world, out, Math.atan2(hit.out.x, hit.out.z));
    if (how === 'window' && floor > 0) {
      // Out the window: you're in the air outside that floor. Hold Space for the rocket shoes.
      player.position.y = hit.fp.base + Math.max(yInside, floor * 3) + 0.5;
      player.mode = 'air';
      player.vel.set(hit.out.x * 3, 2, hit.out.z * 3);
    }
    addCityInteractions();
    ambience.indoor = false;
    await fade(false);
    busy = false;
  }

  /** Drop into any spot on Earth (streams it in behind a fade). */
  async function dropAt(lat: number, lon: number, name: string) {
    if (!earth || busy) return;
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    busy = true;
    await fade(true);
    const t = toast(`Flying to <b>${esc(name)}</b>…`, 60000);
    try {
      const pos = await earth.teleport(lat, lon, (m) => { if (t) t.innerHTML = esc(m); });
      player.setWorld(place.world, pos, player.facing);
      if (haversine(earth.home, { lat, lon }) > 2000) track('explore_teleport', { km: Math.round(haversine(earth.home, { lat, lon }) / 1000) });
    } catch (e) {
      toast(`Couldn't get there: ${esc((e as Error).message)}`);
    }
    t?.remove();
    await fade(false);
    busy = false;
  }
  const siteGeo = (s: Site) => earth!.frame.toGeo(s.approach.x, s.approach.z);
  const setWaypoint = (s: Site) => {
    if (earth) {
      const g = earth.atHome ? siteGeo(s) : null;
      waypoint = g ? { ...g, name: s.repo.name } : null;
      if (!g) { toast(`<b>${esc(s.repo.name)}</b> is back home. Use <b>Go</b> to fly there.`); return; }
    } else minimap!.waypoint = { x: s.approach.x, z: s.approach.z, name: s.repo.name };
    toast(`Waypoint set: <b>${esc(s.repo.name)}</b>`);
  };
  const travelTo = async (s: Site) => {
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    if (earth && !earth.atHome) await dropAt(earth.home.lat, earth.home.lon, 'home');
    await fade(true);
    player.setWorld(player.world, s.approach.clone().addScaledVector(s.doorOut, 6), Math.atan2(-s.doorOut.x, -s.doorOut.z));
    waypoint = null;
    if (minimap) minimap.waypoint = null;
    await fade(false);
  };

  // ---- Phone (P): text or email HQ, the office agent that runs every other agent ----
  const phone = installPhone(ctx, {
    sites: () => place.sites,
    setWaypoint: (name) => { const s = siteByRepo.get(name); if (s) setWaypoint(s); },
    travelTo: async (name) => { const s = siteByRepo.get(name); if (s) await travelTo(s); },
    placeName: () => `${place.title}${place.subtitle ? `, ${place.subtitle}` : ''}`,
  });

  // ---- The map screen (M) ----
  const markers = (): MapMarker[] => (earth && earth.atHome ? place.sites.map((s) => ({ ...earth.frame.toGeo(s.center.x, s.center.z), color: s.repo.brandColor || '#ffcc33', label: s.repo.name, big: s.repo.tier === 'landmark' || s.repo.tier === 'tower' })) : []);
  const openMap = () => {
    if (!earth || !tileMap) return;
    hud?.setMode('map');
    openWorldMap({
      map: tileMap,
      here: () => ({ ...earth.frame.toGeo(player.position.x, player.position.z), heading: headingDeg() }),
      markers,
      places: [
        ...place.sites.slice(0, 12).map((s) => ({ name: `${s.repo.name} HQ`, sub: tierWord(s.repo), ...(earth.atHome ? siteGeo(s) : earth.home) })),
        ...FAMOUS_PLACES,
      ],
      search: searchPlaces,
      onDrop: (lat, lon, name) => { void dropAt(lat, lon, name); },
      onNavigate: (lat, lon, name) => { waypoint = { lat, lon, name }; toast(`Waypoint set: <b>${esc(name)}</b>`); },
      settings: [
        { label: 'Clouds', value: () => (dayNight.clouds ? 'On' : 'Off'), next: () => { dayNight.clouds = !dayNight.clouds; } },
        { label: 'Time of day', value: () => dayNight.label(), next: () => { dayNight.hour = (dayNight.hour + 3) % 24; } },
        { label: 'Time speed', value: () => (dayNight.speed > 0.05 ? 'Fast' : 'Normal'), next: () => { dayNight.speed = dayNight.speed > 0.05 ? 1 / 60 : 0.5; } },
        { label: 'Weather', value: () => (dayNight.weather.mode === 'live' ? 'Live' : dayNight.weather.kind[0].toUpperCase() + dayNight.weather.kind.slice(1)), next: () => {
          const order = ['live', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'dust'] as const;
          const cur = dayNight.weather.mode === 'live' ? 'live' : dayNight.weather.kind;
          dayNight.setWeather(order[(order.indexOf(cur as typeof order[number]) + 1) % order.length]);
        } },
        { label: 'Units', value: () => (imperial() ? 'Imperial' : 'Metric'), next: () => {} },
      ],
      imperial: imperial(),
      onClose: () => hud?.setMode(player.flying ? 'fly' : 'walk'),
    });
  };

  // ---- Vehicles (1–7): on foot, skateboard, bike, jeep, prop plane, kayak, motorboat ----
  function ride(id: VehicleId) {
    if (interior || busy || panelOpen() || photo.active) return;
    if (player.vehicle === id) id = 'foot';
    if (!player.setVehicle(id)) {
      const why: Partial<Record<VehicleId, string>> = { kayak: 'No water nearby for the kayak.', boat: 'No water nearby for the boat.', plane: 'Not enough clear, flat ground to take off here. Try a park, a wide road or the air.' };
      toast(why[id] ?? `Can't use that here.`, 3500);
      return;
    }
    track('vehicle', { id });
  }
  for (const v of VEHICLES) input.onPress(v.key, () => ride(v.id));

  // ---- Photo mode (F) ----
  const photo = new PhotoMode({
    engine, input, dayNight: () => dayNight, subject: () => player.position,
    onToggle: (on) => { document.body.classList.toggle('photo-mode', on); hud?.setMode(on ? 'photo' : player.flying ? 'fly' : 'walk'); if (on) track('photo_mode', {}); },
    where: () => {
      const g = earth ? earth.frame.toGeo(player.position.x, player.position.z) : undefined;
      return { place: interior ? `${interior.repo.name} HQ` : `${place.locationName(player.position.x, player.position.z)}, ${place.title}`, ...g };
    },
  });
  input.onPress('KeyF', () => { if (!panelOpen() && !busy && !photo.active) photo.toggle(player.yaw, player.pitch); });

  // ---- Keys ----
  input.onPress('KeyE', () => { if (!panelOpen() && !busy && !photo.active) interactions.trigger(); });
  input.onPress('KeyM', () => {
    if (interior || busy) return;
    if (earth) { if (!worldMapOpen() && !panelOpen()) openMap(); }
    else if (!panelOpen()) minimap!.toggle();
  });
  input.onPress('KeyT', () => { dayNight.hour = (dayNight.hour + 3) % 24; });
  // Time-lapse (L): clouds race and the day flies by, like sitting down in his game.
  input.onPress('KeyL', () => { dayNight.timelapse(!dayNight.timelapsing); toast(dayNight.timelapsing ? 'Time-lapse on (<b>L</b> to stop)' : 'Time-lapse off', 2500); });
  input.onPress('KeyG', () => { if (!panelOpen() && player.mode === 'walk') robot.play('wave'); });
  input.onPress('KeyX', () => { if (!panelOpen() && player.mode === 'walk' && player.speed < 0.5) robot.play(robot.state === 'sit' ? 'idle' : 'sit'); });
  input.onPress('Tab', () => {
    if (panelOpen() || interior) return;
    openDirectory(place.sites, agentsByRepo(), place.title, { waypoint: setWaypoint, travel: travelTo });
  });
  window.addEventListener('pointerdown', () => ambience.start(), { once: true });

  // ---- HUD ----
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  toast(earth
    ? `Welcome to <b>${esc(place.title)}</b>. Your ${repos.length} projects moved in; the tallest tower is <b>${esc(place.sites[0]?.repo.name ?? '')}</b>. Hold <b>Space</b> in the air to fly, <b>M</b> for the map of the world.`
    : `Welcome to <b>${esc(place.title)}</b>. Your ${repos.length} projects are here; the tallest tower is <b>${esc(place.sites[0]?.repo.name ?? '')}</b>. Press <b>Tab</b> for the directory.`, 10000);
  const locEl = $('hud-location'), timeEl = $('hud-time'), agentEl = $('hud-agents'), lookEl = $('click-to-look');
  let hudTimer = 0;
  let exploredFar = false;
  let wxTimer = 0;
  const headingDeg = () => ((Math.atan2(Math.sin(player.yaw), -Math.cos(player.yaw)) * 180) / Math.PI + 360) % 360;

  (window as unknown as { __ow: unknown }).__ow = { THREE, player, robot, dayNight, place, earth, ctx, enterBuilding, exitBuilding, engine, phone, dropAt, photo, ride, get generic() { return generic; }, enterGeneric, exitGeneric, get waypoint() { return waypoint; } };

  // ---- Loop ----
  // ?hold=1 (debugging): don't draw until window.__owRender is set.
  const holdRender = new URLSearchParams(location.search).get('hold') === '1';
  const timer = new THREE.Timer();
  let time = 0;
  function loop() {
    requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    if (photo.active) { photo.update(dt); robot.update(dt); } else player.update(dt);
    if (interior) {
      interior.update(dt);
    } else if (generic) {
      generic.it.update(dt, player);
    } else {
      updateGenericDoor(dt);
      dayNight.update(dt, player.position);
      place.update(dt, time, player.position);
      air.update(dt);
      if (minimap?.waypoint && Math.hypot(minimap.waypoint.x - player.position.x, minimap.waypoint.z - player.position.z) < 8) {
        toast(`Arrived at <b>${esc(minimap.waypoint.name)}</b>. Press <b>E</b> at the door.`);
        minimap.waypoint = null;
      }
    }
    interactions.update(player.position, player.facing, !panelOpen() && !busy);
    labels.update(engine.camera);
    ambience.update(dt, interior ? Infinity : air.nearest(player.position), dayNight.night);
    if (!holdRender || (window as unknown as { __owRender?: boolean }).__owRender) engine.render();

    if (earth && hud && earthMini) {
      const g = earth.frame.toGeo(player.position.x, player.position.z);
      const heading = headingDeg();
      if (!interior && !generic) {
        if (waypoint && haversine(g, waypoint) < 15) {
          toast(`Arrived at <b>${esc(waypoint.name)}</b>.`);
          waypoint = null;
        }
        if (!exploredFar && haversine(g, earth.home) > 2000) { exploredFar = true; track('explore_far', {}); }
        earthMini.zoom = THREE.MathUtils.clamp(16.6 - Math.log2(1 + Math.max(0, player.agl) / 60) - player.speed / 40, 10.5, 16.6);
        earthMini.draw(g.lat, g.lon, heading, markers(), waypoint);
      }
      hudTimer -= dt;
      if (hudTimer < 0) {
        hudTimer = 0.1;
        const area = earth.area(player.position.x, player.position.z);
        wxTimer -= 0.1;
        if (wxTimer < 0) { wxTimer = 2; dayNight.setLocation(g.lat, g.lon); }
        hud.update({
          lat: g.lat, lon: g.lon,
          altitude: player.position.y + earth.e0,
          agl: player.agl, heading, pitch: -player.pitch * 57.3, speed: player.vehicle !== 'foot' ? player.vehicleSpeed : player.speed,
          localTime: dayNight.label(),
          place: interior ? `${interior.repo.name} HQ` : generic ? generic.it.title : place.locationName(player.position.x, player.position.z),
          sub: interior ? interior.repo.description || 'Inside the building' : [area.place, area.sub].filter(Boolean).join(', '),
          mode: interior || generic ? 'indoors' : player.flying ? 'fly' : 'walk',
          waypoint, imperial: imperial(),
          surface: player.mode === 'swim' ? 'swimming' : player.agl > 3 ? 'in the air' : '',
          weather: dayNight.weather.summary(imperial(), dayNight.hour),
        });
        if (!worldMapOpen() && !photo.active) hud.setMode(interior ? 'walk' : player.vehicle !== 'foot' ? player.vehicle : player.flying ? 'fly' : 'walk');
        if (!interior && !generic) hud.setHints(player.vehicle !== 'foot' ? player.vehicle : player.flying ? 'fly' : 'walk');
        earthMini.setVisible(!interior && !generic);
        const n = [...ctx.agents.values()].filter((a) => a.status === 'running' || a.status === 'preparing').length;
        agentEl.classList.toggle('hidden', n === 0);
        agentEl.textContent = `⚙ ${n} agent${n === 1 ? '' : 's'} working`;
        lookEl.classList.toggle('hidden', input.locked || panelOpen());
      }
    } else {
      hudTimer -= dt;
      if (hudTimer < 0) {
        hudTimer = 0.25;
        locEl.innerHTML = interior
          ? `${esc(interior.repo.name)} HQ<small>${esc(interior.repo.description || 'Inside the building')}</small>`
          : `${esc(place.locationName(player.position.x, player.position.z))}<small>${esc(place.title)}${place.subtitle ? `, ${esc(place.subtitle)}` : ''}</small>`;
        timeEl.textContent = `${dayNight.label()}  ·  T to skip ahead`;
        const n = [...ctx.agents.values()].filter((a) => a.status === 'running' || a.status === 'preparing').length;
        agentEl.classList.toggle('hidden', n === 0);
        agentEl.textContent = `⚙ ${n} agent${n === 1 ? '' : 's'} working`;
        lookEl.classList.toggle('hidden', input.locked || panelOpen());
        $('minimap').classList.toggle('hidden', !!interior);
      }
      if (!interior) minimap!.draw(player.position, player.yaw);
    }
  }
  loop();
}

function tierWord(r: Repo) {
  return { landmark: 'Skyscraper HQ', tower: 'Tower', midrise: 'Office building', small: 'Storefront studio' }[r.tier];
}
