import * as THREE from 'three';
import type { AgentInfo, CityId, GeoPlace, Repo } from '../../shared/types.ts';
import { api, connectLive, onLive, track } from './api.ts';
import { Engine, DayNight, quality } from './engine.ts';
import { makeCityView } from './rooms/cityView.ts';
import { Input } from './input.ts';
import { loadCharacters, setNpcFocus } from './characters.ts';
import { HomeBase, HOME, buildHomeInterior } from './home.ts';
import { makeRobot } from './robot.ts';
import { Player } from './player.ts';
import { Autopilot } from './autopilot.ts';
import { installFlightHud } from './ui/flightHud.ts';
import { Interactions, Labels, esc } from './interact.ts';
import { buildPresetPlace, type Place, type Site } from './place.ts';
import { buildEarthPlace, searchPlaces, type EarthApi } from './earth/index.ts';
import { haversine } from './earth/frame.ts';
import { Aircraft } from './aircraft.ts';
import { Ambience } from './audio.ts';
import { Minimap } from './ui/minimap.ts';
import { TileMap } from './ui/tilemap.ts';
import { EarthMinimap, type MapMarker } from './ui/earthMinimap.ts';
import { openWorldMap, worldMapOpen, FAMOUS_PLACES } from './ui/worldmap.ts';
import { installHud, lookLabels, type Hud } from './ui/hud.ts';
import { openDirectory } from './ui/directory.ts';
import { bindPanelInput, closePanel, panelOpen, toast } from './ui/panel.ts';
import { buildInterior, type Interior } from './interior.ts';
import { installPhone } from './ui/phone.ts';
import { PhotoMode } from './ui/photo.ts';
import type { VehicleId } from './vehicles/index.ts';
import { buildGenericInterior, guessKind, type GenericInterior } from './rooms/index.ts';
import { updateEntrances } from './city/entrance.ts';
import type { BuildingHit } from './earth/chunks.ts';
import type { GameCtx } from './ctx.ts';
import { installLanding } from './landing/index.ts';
import { installXR, apiPhoneSource, xrSettings } from './xr/index.ts';
import { currentBriefing, maybePromptBriefing, openBriefingPanel, waiting, type BriefingHooks } from './ui/briefing.ts';
import { saveSession, takeResume, type SavedSession } from './session.ts';
import { installCityPulse } from './city/signals.ts';
import { openReview } from './ui/review.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ landing page
installLanding({
  onStart: (where) => start(where).catch((e) => {
    console.error(e);
    $('loading-text').textContent = `Something went wrong: ${(e as Error).message}`;
  }),
});

// ------------------------------------------------------------------ the game
const HINTS = {
  walk: ['[W][A][S][D] Move · [Shift] Run · [Space] Jump', '[Space] in the air: rocket shoes', '[E] Interact · [P] Phone · [M] Map', '[Tab] Directory · [F] Photo mode · [L] Time-lapse · [G] Wave'],
  fly: ['[Space] Burn the rockets · let go to fall', '[W][A][S][D] Fly where you look · [Shift] Afterburner', '[C] Cut the rockets · land hard to roll', '[M] Map · [P] Phone'],
  indoors: ['[W][A][S][D] Move · [E] Talk / use', '[P] Phone · [Esc] Release mouse'],
  skate: ['[W] Push · [S] Brake · [A][D] Carve', '[Space] Ollie · [Shift] Faster', '[1] Get off · [2]–[8] Switch'],
  bike: ['[W] Pedal · [S] Brake · [A][D] Steer', '[Space] Bunny hop · [Shift] Sprint', '[1] Get off · [2]–[8] Switch'],
  jeep: ['[W] Gas · [S] Brake / reverse · [A][D] Steer', '[Space] Handbrake · [Shift] Boost', '[1] Get out · [2]–[8] Switch'],
  plane: ['[W][S] Throttle · [A][D] Bank / taxi', '[Space] Pull up · [C] Push down · [Shift] Thrust', 'Take off past 32 mph · [O] Autopilot to waypoint · [1] Bail out'],
  shuttle: ['[W][S] Throttle · [A][D] Bank · [Space] Pull up · [C] Push down', '[Shift] Boosters · [O] Autopilot to waypoint (40×)', '[M] Map: pick a place, Autopilot · [1] Bail out, then [Q] wingsuit'],
  wingsuit: ['[W] Dive · [S] Flare · [A][D] Bank · steer with the mouse', '[Space] Rockets · [Shift] Burst', '[Q] Stow the wingsuit · land fast to roll'],
  kayak: ['[W][S] Paddle · [A][D] Turn', '[1] Get out · [7] Motorboat'],
  boat: ['[W][S] Throttle · [A][D] Rudder · [Shift] Faster', '[1] Get out · [6] Kayak'],
};
const VEHICLES: { key: string; id: VehicleId; label: string; icon: string }[] = [
  { key: 'Digit1', id: 'foot', label: 'On foot', icon: '🚶' }, { key: 'Digit2', id: 'skate', label: 'Skate', icon: '🛹' },
  { key: 'Digit3', id: 'bike', label: 'Bike', icon: '🚲' }, { key: 'Digit4', id: 'jeep', label: 'Jeep', icon: '🚙' },
  { key: 'Digit5', id: 'plane', label: 'Plane', icon: '🛩️' }, { key: 'Digit6', id: 'kayak', label: 'Kayak', icon: '🛶' },
  { key: 'Digit7', id: 'boat', label: 'Boat', icon: '🚤' }, { key: 'Digit8', id: 'shuttle', label: 'Shuttle', icon: '🚀' },
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
  let streetSigns = true;
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

  // Windows look out at the real city: interiors capture it into a cube map from inside the building.
  const cityView = makeCityView({
    renderer: engine.renderer, pmrem: engine.pmrem, scene: cityScene,
    hide: () => [robot.root, player.vehicleGroup],
    follow: () => [dayNight.dome.mesh, dayNight.stars],
    size: () => (engine.renderer.xr.isPresenting ? 256 : quality.low ? 256 : 512),
  });
  const ctx: GameCtx = {
    engine, input, player, interactions, labels, dayNight, repos, cityView,
    agents: new Map(agents.map((a) => [a.id, a])),
    enterBuilding: (r) => enterBuilding(r),
    exitBuilding: (how) => exitBuilding(how),
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
  // Long flights re-center the world under you: carry the player (and their ride) across.
  if (earth) earth.onShift = (map) => { player.shift(map); xrShift?.(map); };
  let xrShift: ((map: (v: THREE.Vector3) => void) => void) | null = null;
  // The state of the work on the buildings: CI beacons, lit floors, releases, commits, walk-by news.
  const cityPulse = installCityPulse({ sites: place.sites, scene: cityScene, camera: engine.camera, agents: () => ctx.agents, visible: sitesHere, night: () => dayNight.night,
    partsNear: earth ? (x, z, r) => earth.footprintsNear(x, z, r).map((n) => ({ ring: n.ring, base: n.fp.base, top: n.fp.top, cx: n.cx, cz: n.cz })) : undefined });

  // ---- Live agents ----
  connectLive();
  onLive((msg) => {
    if (msg.type !== 'agent:update') return;
    const prev = ctx.agents.get(msg.agent.id);
    ctx.agents.set(msg.agent.id, msg.agent);
    if (prev?.status !== msg.agent.status) {
      if (msg.agent.status === 'done') toast(`<b>${esc(msg.agent.name)}</b> finished in <b>${esc(msg.agent.repo)}</b> · ${msg.agent.filesChanged.length} files changed`, 8000);
      if (msg.agent.status === 'error') toast(`<b>${esc(msg.agent.name)}</b> hit an error in ${esc(msg.agent.repo)}`, 8000);
      // Not while a door is opening either: the city's labels would follow you inside.
      if (!interior && !generic && !busy) refreshCityLabels();
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
      const s = lastDoor;
      const it = await buildInterior(ctx, repo, s ? { capture: cityView, origin: s.door.clone(), yaw: Math.atan2(-s.doorOut.x, -s.doorOut.z), footprint: (s as Site & { fp?: { ring: number[] } }).fp?.ring } : undefined);
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
  async function exitBuilding(how: 'door' | 'roof' = 'door') {
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
    if (how === 'roof' && s) {
      // Out of the lift onto the roof of the tower.
      player.position.set(s.top.x, s.top.y + 0.6, s.top.z);
      player.mode = 'air';
      player.vel.set(0, 0, 0);
    }
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
  async function enterGeneric(hit: BuildingHit, kindOverride?: ReturnType<typeof kindOf>, make?: () => GenericInterior) {
    if (busy || interior || generic) return;
    busy = true;
    await fade(true);
    try {
      const f = hit.fp;
      const ring = f.ring.map((v, i) => v - (i % 2 ? f.cz : f.cx));
      const it = make ? make() : buildGenericInterior({ key: f.key, ring, height: f.h, kind: kindOverride ?? kindOf(hit), name: f.poi?.name, doorWall: hit.wall, seed: f.key, country: earth?.country, view: { capture: cityView, origin: new THREE.Vector3(f.cx, hit.point.y, f.cz), yaw: 0, footprint: hit.ring }, pmrem: engine.pmrem, sun: dayNight.sun, lite: engine.renderer.xr.isPresenting });
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
  async function exitGeneric(how: 'door' | 'window' | 'roof', floor: number) {
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
    if (how === 'roof') {
      // Up the lift and out onto the roof.
      let sx = 0, sz = 0;
      for (let i = 0; i < hit.ring.length; i += 2) { sx += hit.ring[i]; sz += hit.ring[i + 1]; }
      const k = hit.ring.length / 2;
      player.position.set(sx / k, hit.fp.top + 0.6, sz / k);
      player.mode = 'air';
      player.vel.set(0, 0, 0);
    } else if (how === 'window' && floor > 0) {
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

  // ---- Home: your apartment on Central Park South, reachable from anywhere on Earth ----
  const home = earth ? new HomeBase(earth, () => new Set(place.sites.map((s) => (s as Site & { fp?: { key: number } }).fp?.key).filter((k): k is number => k != null))) : null;
  if (home) cityScene.add(home.group);
  const enterHome = async () => {
    const hit = home?.hit(), r = home?.resolved;
    if (!hit || !r) return;
    await enterGeneric(hit, 'apartments', () => buildHomeInterior({
      renderer: engine.renderer, city: cityScene, dayNight, robot, hit, floor: r.floor, view: r.view,
      agents: () => [...ctx.agents.values()].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt.localeCompare(a.startedAt)),
      openAgents: () => phone.open('agents'),
      briefing: currentBriefing,
      openBriefing: () => openBriefingPanel(briefingHooks, 'desk'),
    }));
    // Back home: the briefing is on the desk.
    const b = currentBriefing();
    if (generic && b && waiting(b)) toast(`<b>Your briefing is on the desk.</b> ${esc(b.headline)}`, 8000);
  };
  const goHome = async () => {
    if (!earth || !home) { toast(`Home is at <b>${esc(HOME.address)}</b>, New York. Start anywhere on Earth to visit it.`); return; }
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    const L = earth.frame.toLocal(HOME.lat, HOME.lon);
    if (Math.hypot(player.position.x - L.x, player.position.z - L.z) > 600) await dropAt(home.street.lat, home.street.lon, 'Home');
    const r = home.resolveNow();
    await fade(true);
    if (r) player.setWorld(player.world, r.approach.clone().addScaledVector(r.out, 2.5), Math.atan2(-r.out.x, -r.out.z));
    waypoint = null;
    await fade(false);
  };
  const waypointHome = () => {
    if (!earth) return;
    waypoint = { lat: HOME.lat, lon: HOME.lon, name: 'Home' };
    toast(`Waypoint set: <b>Home</b> · ${esc(HOME.address)}`);
  };

  // ---- Phone (P): text or email HQ, the office agent that runs every other agent ----
  const phone = installPhone(ctx, {
    sites: () => place.sites,
    setWaypoint: (name) => { const s = siteByRepo.get(name); if (s) setWaypoint(s); },
    travelTo: async (name) => { const s = siteByRepo.get(name); if (s) await travelTo(s); },
    placeName: () => `${place.title}${place.subtitle ? `, ${place.subtitle}` : ''}`,
    home: { address: HOME.address, go: goHome, pin: waypointHome },
  });
  const briefingHooks: BriefingHooks = {
    travelTo: (repo) => { const s = siteByRepo.get(repo); if (s) void travelTo(s); },
    openAgent: () => phone.open('agents'),
    goHome: earth ? () => { void goHome().then(() => enterHome()); } : undefined,
  };

  // ---- The map screen (M) ----
  const markers = (): MapMarker[] => [
    ...(earth && earth.atHome ? place.sites.map((s) => ({ ...earth.frame.toGeo(s.center.x, s.center.z), color: s.repo.brandColor || '#ffcc33', label: s.repo.name, big: s.repo.tier === 'landmark' || s.repo.tier === 'tower' })) : []),
    ...(earth ? [{ lat: HOME.lat, lon: HOME.lon, color: '#3ddc97', label: 'Home', big: true }] : []),
  ];
  const openMap = () => {
    if (!earth || !tileMap) return;
    hud?.setMode('map');
    openWorldMap({
      map: tileMap,
      here: () => ({ ...earth.frame.toGeo(player.position.x, player.position.z), heading: headingDeg() }),
      markers,
      places: [
        { name: 'Home', sub: HOME.address, lat: HOME.lat, lon: HOME.lon },
        ...place.sites.slice(0, 12).map((s) => ({ name: `${s.repo.name} HQ`, sub: tierWord(s.repo), ...(earth.atHome ? siteGeo(s) : earth.home) })),
        ...FAMOUS_PLACES,
      ],
      search: searchPlaces,
      onDrop: (lat, lon, name) => { void dropAt(lat, lon, name); },
      onNavigate: (lat, lon, name) => { waypoint = { lat, lon, name }; toast(`Waypoint set: <b>${esc(name)}</b>`); },
      onAutopilot: (lat, lon, name) => { waypoint = { lat, lon, name }; startAutopilot(); },
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
        { label: 'Building names', value: () => (lookLabels.on ? 'On' : 'Off'), next: () => { lookLabels.on = !lookLabels.on; } },
        { label: 'Street signs', value: () => (streetSigns ? 'On' : 'Off'), next: () => { streetSigns = !streetSigns; earth?.setStreetSigns(streetSigns); } },
        { label: 'VR headset', value: () => (xrSettings.get().enabled ? 'On' : 'Off'), next: () => xrSettings.set({ enabled: !xrSettings.get().enabled }) },
        { label: 'VR view', value: () => (xrSettings.get().view === 'first' ? 'First person' : 'Behind robot'), next: () => xrSettings.set({ view: xrSettings.get().view === 'first' ? 'third' : 'first' }) },
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
      const why: Partial<Record<VehicleId, string>> = { kayak: 'No water nearby for the kayak.', boat: 'No water nearby for the boat.', plane: 'Not enough clear, flat ground to take off here. Try a park, a wide road or the air.', shuttle: 'Get out of the water first.' };
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
  // Wingsuit (Q, in the air) and autopilot (O, in the shuttle or plane, to the waypoint).
  input.onPress('KeyQ', () => {
    if (panelOpen() || busy || interior || generic) return;
    if (!player.toggleWingsuit()) toast(player.flying ? 'Too close to the ground for the wingsuit.' : 'Jump off something high (or bail out of a plane) first, then <b>Q</b>.', 3000);
  });
  const autopilot = new Autopilot({
    earth: earth!, player, input, dayNight,
    onArrive: (t) => toast(`Arrived over <b>${esc(t.name)}</b>. You have the controls.`, 6000),
    onCancel: (why) => toast(why, 3000),
  });
  function startAutopilot() {
    if (!earth || interior || generic) return;
    if (!waypoint) { toast('Set a destination first: <b>M</b> for the map, pick a place, <b>Autopilot</b>.', 4000); return; }
    // Not in an aircraft? The shuttle it is (it launches from anywhere dry).
    if (player.vehicle !== 'shuttle' && player.vehicle !== 'plane') ride('shuttle');
    if (autopilot.engage(waypoint)) { toast(`Autopilot to <b>${esc(waypoint.name)}</b>: climbing out.`, 3500); track('autopilot', { km: Math.round(haversine(earth.frame.toGeo(player.position.x, player.position.z), waypoint) / 1000) }); }
  }
  input.onPress('KeyO', () => {
    if (panelOpen() || busy) return;
    if (autopilot.active) autopilot.disengage('Autopilot off.'); else startAutopilot();
  });
  const flightHud = earth ? installFlightHud() : null;
  input.onPress('KeyX', () => { if (!panelOpen() && player.mode === 'walk' && player.speed < 0.5) robot.play(robot.state === 'sit' ? 'idle' : 'sit'); });
  input.onPress('Tab', () => {
    if (panelOpen() || interior) return;
    openDirectory(place.sites, agentsByRepo(), place.title, { waypoint: setWaypoint, travel: travelTo, home: earth ? { address: HOME.address, waypoint: waypointHome, travel: () => { void goHome(); } } : undefined });
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

  (window as unknown as { __ow: unknown }).__ow = { THREE, player, robot, dayNight, place, earth, ctx, enterBuilding, exitBuilding, engine, phone, dropAt, photo, ride, get generic() { return generic; }, get interior() { return interior; }, enterGeneric, exitGeneric, get waypoint() { return waypoint; }, setWaypointAt: (lat: number, lon: number, name: string) => { waypoint = { lat, lon, name }; }, autopilot, goHome, pulse: cityPulse.debug, openReview };

  // ---- VR (Meta Quest, WebXR): Enter VR button, controllers, wrist phone ----
  const xr = installXR({
    engine, input, player, robot, earth,
    sun: () => dayNight.sun,
    vehicles: VEHICLES,
    phone: apiPhoneSource(() => repos.map((r) => r.name), () => ctx.agents),
    status: () => ({
      place: generic ? generic.it.title : interior ? `${interior.repo.name} HQ` : place.locationName(player.position.x, player.position.z),
      time: dayNight.label(),
    }),
    skipTime: () => { dayNight.hour = (dayNight.hour + 3) % 24; },
    panelOpen, closePanel,
  });
  xrShift = xr.shift;

  // ---- Loop ----
  // ?hold=1 (debugging): don't draw until window.__owRender is set.
  const holdRender = new URLSearchParams(location.search).get('hold') === '1';
  const timer = new THREE.Timer();
  let time = 0;
  function loop() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    xr.beforePlayer(dt);
    if (photo.active) { photo.update(dt); robot.update(dt); } else player.update(dt);
    xr.afterPlayer(dt);
    if (interior) {
      interior.update(dt);
    } else if (generic) {
      generic.it.update(dt, player);
    } else {
      updateGenericDoor(dt);
      dayNight.update(dt, player.position);
      place.update(dt, time, player.position);
      cityPulse.update(dt, player.position, player.agl);
      updateEntrances(dt, player.position);
      air.update(dt);
      if (minimap?.waypoint && Math.hypot(minimap.waypoint.x - player.position.x, minimap.waypoint.z - player.position.z) < 8) {
        toast(`Arrived at <b>${esc(minimap.waypoint.name)}</b>. Press <b>E</b> at the door.`);
        minimap.waypoint = null;
      }
    }
    home?.update(dt, player.position, !interior && !generic && !busy ? { interactions, labels, enter: enterHome } : null);
    setNpcFocus(player.position);
    interactions.update(player.position, player.facing, !panelOpen() && !busy);
    labels.update(engine.camera);
    ambience.update(dt, interior ? Infinity : air.nearest(player.position), dayNight.night);
    if (!holdRender || (window as unknown as { __owRender?: boolean }).__owRender) engine.render();

    if (earth && hud && earthMini) {
      // Indoors the player stands in the interior's own space; report where the building really is.
      const anchor = interior && lastDoor ? lastDoor.door : generic ? generic.hit.point : player.position;
      const g = earth.frame.toGeo(anchor.x, anchor.z);
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
        const area = earth.area(anchor.x, anchor.z);
        wxTimer -= 0.1;
        if (wxTimer < 0) { wxTimer = 2; dayNight.setLocation(g.lat, g.lon); }
        hud.update({
          lat: g.lat, lon: g.lon,
          altitude: player.position.y + earth.e0,
          agl: player.agl, heading, pitch: -player.pitch * 57.3, speed: player.vehicle !== 'foot' ? player.vehicleSpeed : player.speed,
          localTime: dayNight.label(),
          place: interior ? `${interior.repo.name} HQ` : generic ? generic.it.title : place.locationName(player.position.x, player.position.z),
          sub: interior || generic ? [place.locationName(anchor.x, anchor.z), area.sub].filter(Boolean).join(' · ') : [area.place, area.sub].filter(Boolean).join(', '),
          mode: interior || generic ? 'indoors' : player.flying ? 'fly' : 'walk',
          waypoint, imperial: imperial(),
          surface: player.mode === 'swim' ? 'swimming' : player.agl > 3 ? 'in the air' : '',
          weather: dayNight.weather.summary(imperial(), dayNight.hour),
          looking: interior || generic || photo.active ? null : earth.lookingAt(),
        });
        if (!worldMapOpen() && !photo.active) hud.setMode(interior ? 'walk' : player.vehicle !== 'foot' ? player.vehicle : player.flying ? 'fly' : 'walk');
        if (!interior && !generic) hud.setHints(player.vehicle !== 'foot' ? player.vehicle : player.wingsuit ? 'wingsuit' : player.flying ? 'fly' : 'walk');
        earthMini.setVisible(!interior && !generic);
        const veh = player.vehicleObj;
        const kind = interior || generic || photo.active ? null : player.vehicle === 'shuttle' ? 'shuttle' : player.vehicle === 'plane' ? 'plane' : player.wingsuit ? 'wingsuit' : player.flying && player.agl > 3 ? 'rockets' : null;
        flightHud?.update({
          kind, speed: veh ? veh.speed : Math.hypot(player.vel.x, player.vel.y, player.vel.z),
          altitude: player.position.y + earth.e0, climb: veh ? veh.vy : player.vel.y,
          throttle: player.throttle, burst: input.down('ShiftLeft') || input.down('ShiftRight'), burning: input.down('Space') || robot.rockets > 0.3,
          g: veh && 'g' in veh ? (veh as { g: number }).g : undefined, imperial: imperial(),
          autopilot: autopilot.active ? { scale: autopilot.scale, limited: autopilot.limited, name: autopilot.target!.name, distance: autopilot.distance, eta: autopilot.eta() } : null,
        });
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
  // The renderer's loop (not requestAnimationFrame) keeps running inside a VR session.
  engine.renderer.setAnimationLoop(loop);

  // ---- Where you left off: saved every few seconds and on the way out; resumed when the landing asks ----
  const atHomeInside = () => !!generic && !!home && generic.hit.fp.key === home.hit()?.fp.key;
  const snapshot = () => {
    if (busy) return;
    const hq = interior && lastDoor ? lastDoor : null;
    const anchor = hq ? hq.door : generic ? generic.hit.point : player.position;
    const g = earth ? earth.frame.toGeo(anchor.x, anchor.z) : null;
    // HQ floors are FH apart (see interior.ts): lobby 0, work floor 1, Agent Lab 2, boardroom 3.
    const floor = interior ? Math.max(0, Math.min(3, Math.round(player.position.y / ((interior.repo.tier === 'landmark' ? 5 : 4.2) + 2.6)))) : 0;
    const inside: SavedSession['inside'] = hq ? { kind: 'hq', repo: hq.repo.name, floor } : atHomeInside() ? { kind: 'home' } : null;
    const outside = earth ? [earth.area(anchor.x, anchor.z).place, earth.area(anchor.x, anchor.z).sub].filter(Boolean).join(', ') : `${place.locationName(anchor.x, anchor.z)}, ${place.title}`;
    saveSession({
      start: where,
      ...(g ? { lat: g.lat, lon: g.lon } : { x: anchor.x, z: anchor.z }),
      agl: interior || generic ? 0 : Math.max(0, player.agl),
      facing: generic && !inside ? Math.atan2(generic.hit.out.x, generic.hit.out.z) : player.facing,
      inside,
      hour: dayNight.hour,
      phoneApp: phone.app(),
      label: hq ? `Inside ${hq.repo.name} HQ${floor ? `, floor ${floor + 1}` : ''}` : inside?.kind === 'home' ? `Home, ${HOME.address}` : outside || place.title,
    });
  };
  setInterval(snapshot, 4000);
  window.addEventListener('pagehide', snapshot);

  async function resumeSession(s: SavedSession) {
    const away = Math.round((Date.now() - s.savedAt) / 3600_000);
    if (earth && s.lat != null && s.lon != null) {
      const here = earth.frame.toGeo(player.position.x, player.position.z);
      if (haversine(here, { lat: s.lat, lon: s.lon }) > 30) await dropAt(s.lat, s.lon, s.label);
    } else if (!earth && s.x != null && s.z != null) player.setWorld(place.world, new THREE.Vector3(s.x, 0, s.z), s.facing);
    player.facing = player.yaw = s.facing;
    if (!s.inside && s.agl > 4) { player.position.y += s.agl; player.mode = 'air'; player.vel.set(0, 0, 0); }
    dayNight.hour = s.hour;
    if (s.inside?.kind === 'hq') {
      const site = siteByRepo.get(s.inside.repo);
      if (site && sitesHere()) {
        await enterBuilding(site.repo);
        if (s.inside.floor) interior?.debugFloor?.(s.inside.floor);
      }
    } else if (s.inside?.kind === 'home' && home) {
      await goHome();
      await enterHome();
    }
    if (s.phoneApp) phone.open(s.phoneApp as Parameters<typeof phone.open>[0]);
    track('session_resumed', { inside: s.inside?.kind ?? 'outside', hoursAway: away });
    toast(`Welcome back. You're where you left off: <b>${esc(s.label)}</b>.`, 6000);
  }
  const resume = takeResume();
  if (resume) await resumeSession(resume).catch((e) => console.warn('Resume failed', e));
  // Once a day, when something happened while you were away: a gentle nudge toward the briefing.
  setTimeout(() => void maybePromptBriefing(briefingHooks), resume ? 2500 : 9000);
}

function tierWord(r: Repo) {
  return { landmark: 'Skyscraper HQ', tower: 'Tower', midrise: 'Office building', small: 'Storefront studio' }[r.tier];
}
