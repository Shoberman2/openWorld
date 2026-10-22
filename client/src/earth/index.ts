// The streaming Earth: start anywhere, walk or fly anywhere, the world loads around you from
// OpenMapTiles vector tiles, terrain tiles and satellite imagery. Your projects live at home.
import * as THREE from 'three';
import type { GeoPlace, Repo } from '../../../shared/types.ts';
import { Colliders } from '../player.ts';
import { updateGlow } from '../city/buildings.ts';
import type { Place } from '../place.ts';
import { GeoFrame, WORLD, haversine, type LatLon } from './frame.ts';
import { Pool } from './pool.ts';
import { Chunks, type BuildingHit } from './chunks.ts';
import { LandmarkLayer } from './landmarks/index.ts';
import { FarTerrain } from './far.ts';
import { EarthTraffic, EarthPedestrians, EarthShips } from './traffic.ts';
import { buildEarthRepo, chooseEarthSites, type EarthSite, type HostFp } from './sites.ts';
import { updateWater } from './style.ts';
import { OceanWaves } from './ocean.ts';
import { SkylineRing } from '../sky.ts';
import type { DayNight } from '../engine.ts';
import { driveLeft } from './build/chunk.ts';
// ---- Europe & Middle East
import { EU_TAXI_SHARE, euVehicles } from './cities/eu-vehicles.ts';
import { cityTaxiShare, tintCityTaxis } from './apac-traffic.ts';
import type { FootprintData } from './build/types.ts';

const HOME_R = 850;

export interface EarthApi {
  frame: GeoFrame;
  /** Ground elevation at the frame origin (y = elevation - e0). */
  e0: number;
  home: LatLon;
  atHome: boolean;
  country: string;
  /** Move to a spot on Earth (streams it in first). Returns where the player should stand. */
  teleport(lat: number, lon: number, say?: (m: string) => void): Promise<THREE.Vector3>;
  heightAt(x: number, z: number): number;
  /** "Midtown, New York" style names for the HUD. */
  area(x: number, z: number): { place: string; sub: string };
  onRebase: (() => void) | null;
  /** Give the world the camera and sky (for ocean waves that follow the camera and the storm). */
  attach(camera: THREE.Camera, sky: DayNight): void;
  /** An ordinary building you're standing at (not a project HQ), for walking inside. */
  buildingNear(x: number, z: number, maxDist?: number): BuildingHit | null;
  /** Ordinary buildings whose center is within r meters of (x, z), in world coordinates (detailed chunks only). */
  footprintsNear(x: number, z: number, r: number): { fp: FootprintData; chunk: string; ring: number[]; cx: number; cz: number }[];
  stats(): { chunks: number; loading: number; buildings: number; cars: number; far: number; queued: number; ghosts: number; rebases: number };
  /** Lighter streaming (smaller radius), for VR. */
  setLite(on: boolean): void;
  /**
   * Flying far, the world quietly re-centers on you (keeping coordinates small and the map true to
   * scale). Everything that holds a position in the old frame gets moved by `map` (in place).
   */
  onShift: ((map: (v: THREE.Vector3) => void) => void) | null;
  /** The building in the middle of the view, after a short look (name or address, and neighborhood). */
  lookingAt(): { title: string; sub: string } | null;
  /** Street name signs at intersections on or off. */
  setStreetSigns(on: boolean): void;
}

/** Re-center the world once you're this far from its origin (more when you're going fast). */
const REBASE_M = 20_000;

export async function searchPlaces(q: string): Promise<GeoPlace[]> {
  const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Search failed (${res.status})`);
  // Nominatim returns the district, its stations and its exits as separate hits with the same name and
  // label ("Shibuya, Japan" six times): keep the best-ranked one of each within a few kilometres.
  const out: GeoPlace[] = [];
  for (const p of (await res.json()) as GeoPlace[]) {
    const same = out.some((o) => o.name === p.name && o.label === p.label && Math.abs(o.lat - p.lat) < 0.03 && Math.abs(o.lon - p.lon) < 0.03);
    if (!same) out.push(p);
  }
  return out;
}

export async function reverseGeo(lat: number, lon: number): Promise<GeoPlace | null> {
  try {
    const res = await fetch(`/api/geo/reverse?lat=${lat}&lon=${lon}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function buildEarthPlace(place: GeoPlace, repos: Repo[], say: (m: string) => void): Promise<Place & { earth: EarthApi }> {
  const pool = new Pool();
  const home: LatLon = { lat: place.lat, lon: place.lon };
  let country = place.countryCode || '';
  let frame = new GeoFrame(home.lat, home.lon);
  say(`Finding ${place.name} on the map…`);
  let e0 = await pool.elev(frame.mx0, frame.my0).catch(() => 0);
  const colliders = new Colliders(32);
  const root = new THREE.Group();
  let chunks = new Chunks(frame, e0, pool, colliders, country);
  let far = new FarTerrain(frame, e0, pool);
  root.add(far.group, chunks.group);
  // ?q=low: a lighter world for slow GPUs (and headless tests): smaller streaming radius.
  const low = new URLSearchParams(location.search).get('q') === 'low';
  // VR (setLite) streams less too: every frame is drawn twice on a headset GPU.
  let lite = false, base: [number, number, number] | null = null;
  const tune = () => {
    base ??= [chunks.radius0, chunks.radius1, far.radius];
    [chunks.radius0, chunks.radius1, far.radius] = low ? [450, 1300, 1] : lite ? [500, 1800, 1] : base;
  };
  tune();

  let lastGround = 0;
  const heightAt = (x: number, z: number) => {
    const h = chunks.heightAt(x, z);
    if (h !== null) lastGround = h;
    return h ?? lastGround;
  };

  say(`Streaming ${place.name} from OpenStreetMap…`);
  const t0 = performance.now();
  chunks.keepCpu = true;
  await chunks.loadAround(0, 0, HOME_R, (d, t) => say(`Streaming ${place.name}: map tiles ${d}/${t}…`));
  chunks.updateMask(frame.tileAt(14, 0, 0));
  console.info(`[earth] home tiles in ${Math.round(performance.now() - t0)} ms`);

  // ---- Projects move in ----
  say(`Moving ${repos.length} projects into the neighborhood…`);
  // Projects take over real buildings and leave them as they are; landmarks stay landmarks.
  const LANDMARK = /^(place_of_worship|museum|attraction|monument|historic|castle|town_hall|theatre|library|art_gallery|stadium|college|university|government|embassy|courthouse|zoo|aquarium)$/;
  const fps: HostFp[] = [];
  const fpGrid = new Map<string, HostFp[]>();
  const collect = () => {
    fps.length = 0; fpGrid.clear();
    for (const ch of chunks.chunks.values()) {
      if (ch.lod !== 0) continue;
      for (const f of ch.footprints) {
        const ring = f.ring.map((v, i) => v + (i % 2 ? ch.z0 : ch.x0));
        const landmark = !!f.poi && (LANDMARK.test(f.poi.cls) || LANDMARK.test(f.poi.sub));
        fps.push({ key: f.key, chunk: ch.key, ring, area: f.area, cx: f.cx + ch.x0, cz: f.cz + ch.z0, base: f.base, top: f.top, h: f.h, glass: f.glass, color: f.color, landmark });
      }
    }
    for (const f of fps) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < f.ring.length; i += 2) { minX = Math.min(minX, f.ring[i]); maxX = Math.max(maxX, f.ring[i]); minZ = Math.min(minZ, f.ring[i + 1]); maxZ = Math.max(maxZ, f.ring[i + 1]); }
      for (let i = Math.floor(minX / 40); i <= Math.floor(maxX / 40); i++) for (let j = Math.floor(minZ / 40); j <= Math.floor(maxZ / 40); j++) {
        const k = `${i},${j}`; let l = fpGrid.get(k); if (!l) fpGrid.set(k, (l = [])); l.push(f);
      }
    }
  };
  const inRing = (p: number[], x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
    return inside;
  };
  const solid = (x: number, z: number) => (fpGrid.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`) ?? []).some((f) => inRing(f.ring, x, z));
  const wet = (x: number, z: number) => !Number.isNaN(chunks.waterAt(x, z));
  // Not enough real buildings near home (a small town)? Look farther out rather than invent any.
  let sites: EarthSite[] = [];
  for (const r of [HOME_R, HOME_R * 1.6, HOME_R * 2.4]) {
    if (r > HOME_R) {
      say(`Looking farther out for buildings (${Math.round(r)} m)…`);
      await chunks.loadAround(0, 0, r);
    }
    collect();
    const edges = [...chunks.net.drive, ...chunks.net.walk.filter((e) => !e.drive)];
    const pick = chooseEarthSites(repos, fps, edges, solid, wet, heightAt, r);
    sites = pick.sites;
    if (!pick.leftovers.length) break;
    console.info(`[earth] ${pick.leftovers.length} projects found no building within ${Math.round(r)} m: ${pick.leftovers.map((p) => `${p.name} (${p.tier})`).join(", ")}`);
  }
  chunks.keepCpu = false;
  const sitesGroup = new THREE.Group();
  for (const g of await Promise.all(sites.map((s: EarthSite) => buildEarthRepo(s)))) sitesGroup.add(g);
  sitesGroup.traverse((obj) => { obj.matrixAutoUpdate = false; obj.updateMatrix(); });
  root.add(sitesGroup);

  // ---- Life ----
  say('Filling the streets…');
  const top = sites[0];
  // Start in the open near your top HQ's door, facing it: 9 m out when that's clear, otherwise the nearest
  // spot with room around it (doors can face an alley or a sidewalk shed hard against the next building).
  const roomy = (x: number, z: number, r: number) => {
    if (solid(x, z) || wet(x, z)) return false;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (solid(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  };
  const door = top ? top.approach : new THREE.Vector3();
  const spawn = top ? door.clone().addScaledVector(top.doorOut, 9) : new THREE.Vector3(0, 0, 0);
  if (!roomy(spawn.x, spawn.z, 4)) {
    let best: { x: number; z: number; s: number } | null = null;
    for (let x = -30; x <= 30; x += 1.5) for (let z = -30; z <= 30; z += 1.5) {
      const px = door.x + x, pz = door.z + z, d = Math.hypot(x, z);
      if (d < 4 || d > 30 || !roomy(px, pz, 4)) continue;
      // Prefer close to the door and out in front of it rather than round the side.
      const front = top ? (x * top.doorOut.x + z * top.doorOut.z) / d : 1;
      const s = d - front * 4;
      if (!best || s < best.s) best = { x: px, z: pz, s };
    }
    if (best) spawn.set(best.x, 0, best.z);
    else if (solid(spawn.x, spawn.z) || wet(spawn.x, spawn.z)) spawn.copy(door);
  }
  spawn.y = heightAt(spawn.x, spawn.z);
  const toDoor = new THREE.Vector3(door.x - spawn.x, 0, door.z - spawn.z);
  const spawnFacing = top ? (toDoor.lengthSq() > 1 ? Math.atan2(toDoor.x, toDoor.z) : Math.atan2(-top.doorOut.x, -top.doorOut.z)) : 0;
  const nyc = Math.abs(home.lat - 40.75) < 0.25 && Math.abs(home.lon + 73.98) < 0.3;
  // Busy streets: lots of cars and caretakers, all instanced; fewer on slow GPUs (?q=low) and in VR.
  const CARS = 320, BOTS = 300;
  // Bikes ride with the traffic: everywhere a few couriers, in the Netherlands and Denmark a lot.
  const BIKES = 110;
  const bikesFor = (cc: string) => (['nl', 'dk'].includes(cc) ? 110 : ['de', 'be', 'jp', 'cn'].includes(cc) ? 40 : 16);
  const traffic = new EarthTraffic(chunks.net, CARS, driveLeft(country), nyc ? 0.32 : cityTaxiShare(home.lat, home.lon) || (EU_TAXI_SHARE[country] ?? 0), BIKES);
  tintCityTaxis(traffic, home.lat, home.lon); // ---- Asia-Pacific & Latin America
  traffic.bikesWanted = bikesFor(country); traffic.driveLeft = driveLeft(country);
  traffic.restyle(euVehicles(country)); // ---- Europe & Middle East
  // Container ships out on the open sea.
  const ships = new EarthShips(low ? 3 : 6, (x, z) => chunks.waterAt(x, z), () => -e0);
  const benchesNear = (x: number, z: number, r: number) => {
    const out: number[] = [];
    for (const ch of chunks.chunks.values()) {
      if (ch.lod !== 0 || ch.x0 > x + r || ch.x0 + ch.size < x - r || ch.z0 > z + r || ch.z0 + ch.size < z - r) continue;
      out.push(...ch.benches);
    }
    return out;
  };
  const peds = new EarthPedestrians(chunks.net, BOTS, solid, (x, z) => chunks.curbAt(x, z), benchesNear);
  const crowdBudget = () => {
    traffic.budget = low ? 110 + Math.round(BIKES / 3) : lite ? 140 + Math.round(BIKES / 3) : CARS + BIKES;
    peds.budget = low ? 90 : lite ? 120 : BOTS;
  };
  crowdBudget();
  root.add(traffic.group, peds.group, ships.group);

  // Sun for this latitude; local solar time from longitude.
  const maxElevation = THREE.MathUtils.clamp(90 - Math.abs(home.lat) + 8, 18, 82);
  const utc = new Date();
  const startHour = (utc.getUTCHours() + utc.getUTCMinutes() / 60 + home.lon / 15 + 48) % 24;
  const tropical = Math.abs(home.lat) < 28;

  // Neighborhood and city names seen so far (place points live in the tile that holds them).
  const seenPlaces = new Map<string, { name: string; cls: string; lat: number; lon: number; rank: number }>();
  const harvest = () => {
    for (const ch of chunks.chunks.values()) for (const p of ch.places) {
      const k = `${p.cls}:${p.name}`;
      if (!seenPlaces.has(k)) seenPlaces.set(k, { name: p.name, cls: p.cls, ...frame.toGeo(p.x, p.z), rank: p.rank });
    }
  };
  chunks.onChange = harvest;
  harvest();
  const cityName = place.label.split(',').map((s) => s.trim()).filter((s) => s && s !== place.name)[0] ?? '';

  const parts = (place.label || '').split(',').map((s) => s.trim()).filter(Boolean);
  const title = place.name;
  const subtitle = [...new Set(parts.filter((p) => p !== title))].slice(-2).join(', ');

  /** Move to (lat, lon), rebasing the world frame when it's far from the current origin. */
  async function go(lat: number, lon: number, sayT?: (m: string) => void): Promise<THREE.Vector3> {
    const far2 = haversine(frame.toGeo(0, 0), { lat, lon });
    const goingHome = haversine(home, { lat, lon }) < HOME_R;
    if (far2 > 60_000 || (goingHome && !atHome)) {
      // Rebase the world frame at the destination (keeps coordinates small and the map square).
      sayT?.('Flying there…');
      chunks.dispose(); far.dispose();
      for (const g of ghosts.splice(0)) { g.chunks.dispose(); g.holder.removeFromParent(); }
      haveLast = false;
      const base = goingHome ? home : { lat, lon };
      frame = new GeoFrame(base.lat, base.lon);
      const [h0, g] = await Promise.all([pool.elev(frame.mx0, frame.my0).catch(() => 0), goingHome ? null : reverseGeo(lat, lon)]);
      e0 = h0;
      country = goingHome ? place.countryCode || country : g?.countryCode || country;
      chunks.group.removeFromParent(); far.group.removeFromParent();
      chunks = new Chunks(frame, e0, pool, colliders, country);
      chunks.hidden = hiddenAtHome;
      chunks.onChange = harvest;
      far = new FarTerrain(frame, e0, pool);
      root.add(far.group, chunks.group);
      tune();
      // Traffic and people follow the new network.
      traffic.net = chunks.net;
      peds.net = chunks.net;
      traffic.bikesWanted = bikesFor(country); traffic.driveLeft = driveLeft(country);
      traffic.restyle(euVehicles(country)); // ---- Europe & Middle East
      atHome = goingHome;
      sitesGroup.visible = atHome;
      Object.assign(earth, { frame, e0, atHome, country });
      earth.onRebase?.();
    }
    const p = frame.toLocal(lat, lon);
    sayT?.('Streaming the map…');
    await chunks.loadAround(p.x, p.z, 300, (d, t) => sayT?.(`Streaming the map: tiles ${d}/${t}…`));
    chunks.updateMask(frame.tileAt(14, p.x, p.z));
    return new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
  }

  // ---- Seamless travel: re-centering without a loading screen ----
  // The old world stays on screen as scenery (moved into the new frame) until the new one covers it.
  const ghosts: { chunks: Chunks; holder: THREE.Group; at: number }[] = [];
  let rebases = 0;
  const lastP = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let haveLast = false;
  /** Re-center on (lat, lon) mid-flight: a pure change of coordinates, nothing reloads behind a fade. */
  function rebase(base: LatLon, toHome: boolean) {
    const old = frame;
    const next = new GeoFrame(base.lat, base.lon);
    // Local coordinates are linear in mercator meters, so old → new is an exact scale + offset.
    const s = next.k / old.k;
    let dmx = old.mx0 - next.mx0;
    if (dmx > WORLD / 2) dmx -= WORLD; else if (dmx < -WORLD / 2) dmx += WORLD; // across the antimeridian
    const ox = dmx * next.k, oz = -(old.my0 - next.my0) * next.k;
    const A = new THREE.Matrix4().set(s, 0, 0, ox, 0, 1, 0, 0, 0, 0, s, oz, 0, 0, 0, 1);
    const map = (v: THREE.Vector3) => { v.set(v.x * s + ox, v.y, v.z * s + oz); };
    // Older ghosts ride along.
    for (const g of ghosts) { g.holder.matrix.premultiply(A); g.holder.matrixWorldNeedsUpdate = true; }
    // The current detailed world becomes a ghost: still drawn, no longer solid.
    chunks.freeze();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(A);
    holder.add(chunks.group);
    root.add(holder);
    ghosts.push({ chunks, holder, at: performance.now() });
    // The horizon just moves across (exact: the local frame is linear in mercator).
    far.rebase(next, map, s);

    frame = next;
    chunks = new Chunks(frame, e0, pool, colliders, country);
    chunks.hidden = toHome ? hiddenAtHome : new Map();
    chunks.onChange = harvest;
    root.add(chunks.group);
    tune();
    traffic.net = chunks.net;
    peds.net = chunks.net;
    ships.reset();
    atHome = toHome;
    sitesGroup.visible = atHome;
    Object.assign(earth, { frame, atHome });
    lastP.set(lastP.x * s + ox, lastP.y, lastP.z * s + oz);
    rebases++;
    earth.onShift?.(map);
    earth.onRebase?.();
    // Ask which country we're over now (driving side, regional styles).
    void reverseGeo(base.lat, base.lon).then((g) => { if (g?.countryCode && frame === next) { country = g.countryCode; earth.country = country; traffic.bikesWanted = bikesFor(country); traffic.driveLeft = driveLeft(country); traffic.restyle(euVehicles(country)); } });
  }
  /** Retire ghost chunks the new world has covered, and whole ghosts once they're empty (or old). */
  function pruneGhosts() {
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      g.chunks.pruneUnder((key) => chunks.chunks.has(key));
      const age = performance.now() - g.at;
      if (g.chunks.chunks.size === 0 || age > 30_000 || ghosts.length - i > 3) {
        g.chunks.dispose();
        g.holder.removeFromParent();
        ghosts.splice(i, 1);
      }
    }
  }

  // Open-sea waves near the coast, following the camera.
  const waves = new OceanWaves(root);
  let cam: THREE.Camera | null = null, dn: DayNight | null = null;
  let oceanNear = false, oceanCheck = 0;
  const checkOcean = (x: number, z: number) => {
    // Any sea-level water within ~500 m? (Lakes and rivers sit higher and stay flat.)
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const w = chunks.waterAt(x + i * 250, z + j * 250);
      if (!Number.isNaN(w) && Math.abs(w + e0) < 1.5) return true;
    }
    return false;
  };

  // The skyline around the camera, for reflections: per compass sector, the angles up to the roofs
  // and down to the street of the building that fills most of the sky there, and its distance.
  const skyAt = new THREE.Vector3(1e9, 0, 0);
  let skyT = 0, skySig = -1;
  const skyline = (p: THREE.Vector3, ring: SkylineRing) => {
    const N = SkylineRing.SECTORS, data = ring.data, R = 700, TAU = Math.PI * 2;
    for (let i = 0; i < N; i++) { data[i * 4] = -2; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 0; }
    for (const ch of chunks.chunks.values()) {
      if (Math.abs(ch.x0 + ch.size / 2 - p.x) > ch.size / 2 + R || Math.abs(ch.z0 + ch.size / 2 - p.z) > ch.size / 2 + R) continue;
      const hid = chunks.hidden.get(ch.key);
      for (const f of ch.footprints) {
        if (f.h < 4 || hid?.has(f.key)) continue;
        const dx = f.cx + ch.x0 - p.x, dz = f.cz + ch.z0 - p.z, dc = Math.hypot(dx, dz);
        const rad = Math.sqrt(f.area) * 0.5;
        if (dc > R || dc < rad * 0.8) continue;
        const d = Math.max(4, dc - rad);
        const top = Math.atan2(f.top - p.y, d), bot = Math.atan2(f.base - p.y, d);
        const az = Math.atan2(dx, dz), half = Math.atan2(rad, dc);
        const i0 = Math.floor(((az - half) / TAU + 0.5) * N), i1 = Math.floor(((az + half) / TAU + 0.5) * N);
        for (let i = i0; i <= i1; i++) {
          const k = (((i % N) + N) % N) * 4;
          if (top > data[k]) { data[k] = top; data[k + 1] = bot; data[k + 2] = d; data[k + 3] = 1; }
        }
      }
    }
    ring.tex.needsUpdate = true;
  };

  // Away from home, ask the geocoder which city we're in (at most every 20 s, after moving 1.5 km).
  let revCity = '', revAt: LatLon | null = null, revTime = -1e9;
  /** The geocoder found no address under us last time: open sea (or the middle of nowhere). */
  let revNothing = false;
  const refreshCity = (g: LatLon) => {
    if (performance.now() - revTime < 20000 || (revAt && haversine(revAt, g) < 1500)) return;
    revTime = performance.now(); revAt = g;
    void reverseGeo(g.lat, g.lon).then((r) => {
      const parts = (r?.label ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      revCity = parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : '';
      revNothing = !r;
    });
  };

  let atHome = true;
  /** While dropping in somewhere, don't stream around the player's old (now meaningless) position. */
  let teleporting = false;
  const earth: EarthApi = {
    frame, e0, home, atHome, country,
    onRebase: null,
    heightAt,
    onShift: null,
    attach(camera, sky) { cam = camera; dn = sky; },
    setLite(on) { lite = on; tune(); crowdBudget(); },
    lookingAt() {
      if (!cam) return null;
      const streetNear = (x: number, z: number) => { const n = namesNear(x, z); return n.length && n[0].d < 45 ? n[0].name : null; };
      const hit = chunks.landmarks.look(cam, performance.now() / 1000, streetNear);
      if (!hit) return null;
      const hood = earth.area(hit.x, hit.z).place;
      return { title: hit.title, sub: [hit.sub, hood].filter((t) => t && t !== hit.title).join(' · ') };
    },
    setStreetSigns(on) { LandmarkLayer.signsOn = on; chunks.landmarks.setSigns(on); },
    buildingNear(x, z, maxDist = 1.6) {
      const hit = chunks.buildingNear(x, z, maxDist);
      if (!hit || chunks.hidden.get(hit.chunk.key)?.has(hit.fp.key) || hit.fp.h < 3) return null;
      return hit;
    },
    footprintsNear(x, z, r) {
      const out: { fp: FootprintData; chunk: string; ring: number[]; cx: number; cz: number }[] = [];
      for (const ch of chunks.chunks.values()) {
        if (ch.lod !== 0 || Math.abs(ch.x0 + ch.size / 2 - x) > ch.size / 2 + r || Math.abs(ch.z0 + ch.size / 2 - z) > ch.size / 2 + r) continue;
        for (const f of ch.footprints) {
          const cx = f.cx + ch.x0, cz = f.cz + ch.z0;
          if (Math.hypot(cx - x, cz - z) > r || chunks.hidden.get(ch.key)?.has(f.key)) continue;
          out.push({ fp: f, chunk: ch.key, ring: f.ring.map((v, i) => v + (i % 2 ? ch.z0 : ch.x0)), cx, cz });
        }
      }
      return out;
    },
    async teleport(lat, lon, sayT) {
      teleporting = true;
      try { return await go(lat, lon, sayT); } finally { teleporting = false; }
    },
    area(x, z) {
      const g = frame.toGeo(x, z);
      if (!(atHome && haversine(g, home) < 6000)) refreshCity(g);
      let hood: { name: string; d: number } | null = null, city: { name: string; d: number } | null = null;
      for (const p of seenPlaces.values()) {
        const d = haversine(g, p);
        if (['neighbourhood', 'quarter', 'suburb'].includes(p.cls) && d < 2500 && (!hood || d < hood.d)) hood = { name: p.name, d };
        // A big city a bit further away beats a small town next door (Midtown is in New York, not Weehawken).
        const w = d * (p.cls === 'city' ? 0.3 : p.cls === 'town' ? 1 : 2.5);
        if (['city', 'town', 'village'].includes(p.cls) && d < 30000 && (!city || w < city.d)) city = { name: p.name, d: w };
      }
      // Near home, the geocoder's city ("New York") beats whatever town point happens to be loaded.
      const nearHome = atHome && haversine(g, home) < 6000 && cityName;
      const cityLabel = nearHome ? cityName : revCity || city?.name || '';
      const away = !(atHome && haversine(g, home) < 6000);
      const placeName = hood?.name ?? (cityLabel || (!away ? title : revNothing ? 'Over open water' : ''));
      const sub = hood ? cityLabel : '';
      return { place: placeName, sub };
    },
    stats() {
      let b = 0;
      for (const ch of chunks.chunks.values()) b += ch.stats.buildings;
      return { chunks: chunks.chunks.size, loading: chunks.pending, buildings: b, cars: traffic.cars.filter((c) => c.live).length, far: far.pending, queued: pool.queued, ghosts: ghosts.length, rebases };
    },
  };
  const hiddenAtHome = chunks.hidden;

  const namesNear = (x: number, z: number) => {
    const best = new Map<string, number>();
    const t = frame.tileAt(14, x, z);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ch = chunks.chunks.get(`${t.tx + dx},${t.ty + dy}`);
      if (!ch) continue;
      for (const r of ch.names) {
        let d = Infinity;
        for (let i = 0; i + 3 < r.pts.length; i += 2) {
          const ax = r.pts[i], az = r.pts[i + 1], ex = r.pts[i + 2] - ax, ez = r.pts[i + 3] - az, l2 = ex * ex + ez * ez;
          const tt = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
          d = Math.min(d, Math.hypot(x - ax - ex * tt, z - az - ez * tt));
        }
        d -= r.w / 2;
        if (d < 160 && d < (best.get(r.name) ?? Infinity)) best.set(r.name, d);
      }
    }
    return [...best.entries()].sort((a, b) => a[1] - b[1]).map(([name, d]) => ({ name, d }));
  };

  return {
    title, subtitle,
    group: root, colliders, sites, spawn, spawnFacing,
    world: {
      colliders, canFly: true,
      groundY: heightAt,
      support: (x, z, y) => Math.max(heightAt(x, z) + chunks.curbAt(x, z), chunks.deckAt(x, z, y)),
      water: (x, z) => chunks.waterAt(x, z),
    },
    sky: {
      turbidity: tropical ? 4 : 6, rayleigh: tropical ? 2 : 1.4,
      fogColorDay: new THREE.Color(tropical ? 0xbfe0f0 : 0xbcd3e6), fogColorNight: new THREE.Color(0x14203a),
      fogDensity: 0.00055, sunAzimuth: home.lat >= 0 ? 180 : 0, maxElevation,
    },
    startHour,
    airspace: { minX: -2500, maxX: 2500, minZ: -2500, maxZ: 2500 },
    map: { bounds: { minX: -HOME_R, maxX: HOME_R, minZ: -HOME_R, maxZ: HOME_R }, zSouth: 1, background: '#262a31', draw() { /* the Earth uses the tile minimap */ } },
    locationName(x, z) {
      const names = namesNear(x, z);
      if (!names.length) return earth.area(x, z).place || (atHome ? title : 'In the air');
      if (names[0].d > 40) return `Near ${names[0].name}`;
      return names.length > 1 && names[1].d < 30 ? `${names[0].name} & ${names[1].name}` : names[0].name;
    },
    update(dt, time, player) {
      const agl = player.y - heightAt(player.x, player.z);
      // Sun shadows reach farther the higher you fly, so the city below keeps its depth.
      if (dn) dn.shadowReach = THREE.MathUtils.clamp(140 + Math.max(0, agl) * 1.6, 140, 1000);
      if (!teleporting) {
        // How fast we're going (from the position track), and where we'll be shortly.
        if (haveLast && dt > 0) vel.lerp(new THREE.Vector3().subVectors(player, lastP).divideScalar(dt), 1 - Math.exp(-dt * 3));
        else vel.set(0, 0, 0);
        lastP.copy(player); haveLast = true;
        const speed = Math.hypot(vel.x, vel.z);
        const lead = (secs: number, max: number) => {
          const d = Math.min(speed * secs, max), k = speed > 0.5 ? d / speed : 0;
          return { x: player.x + vel.x * k, z: player.z + vel.z * k };
        };
        // Far from the origin (or racing away from it): re-center, without a loading screen.
        const fromOrigin = Math.hypot(player.x, player.z);
        const here = frame.toGeo(player.x, player.z);
        const nearHome = haversine(here, home) < 12_000;
        if (!atHome && nearHome && fromOrigin > 1500) rebase(home, true);
        else if (fromOrigin > Math.max(REBASE_M, Math.min(300_000, speed * 10))) rebase(here, false);
        chunks.update(player, agl, time, lead(5, 2500), speed);
        far.update(player, agl, lead(12, 40_000), speed);
        if (ghosts.length) pruneGhosts();
        // See as far as you can from up there: the far plane follows altitude (not in VR, it owns the camera).
        if (cam instanceof THREE.PerspectiveCamera && !lite) {
          const nf = THREE.MathUtils.clamp(30_000 + Math.max(0, agl) * 18, 30_000, 260_000);
          const nn = THREE.MathUtils.clamp(Math.max(0, agl) / 2500, 0.25, 4);
          if (Math.abs(nf - cam.far) > 2000 || Math.abs(nn - cam.near) > 0.05) { cam.far = nf; cam.near = nn; cam.updateProjectionMatrix(); }
        }
      }
      traffic.update(dt, player);
      peds.update(dt, player);
      ships.update(dt, player);
      updateWater(time);
      updateGlow(time);
      if (cam && dn) {
        oceanCheck -= dt;
        if (oceanCheck < 0) { oceanCheck = 1; oceanNear = checkOcean(cam.position.x, cam.position.z); }
        const w = dn.weather;
        waves.update(dt, cam, oceanNear ? -e0 : null, Math.max(w.storm, (w.windSpeed - 15) / 50));
        // Refresh the reflected skyline after moving a little (or as chunks stream in).
        skyT -= dt;
        if (skyT < 0 && (skyAt.distanceToSquared(cam.position) > 30 * 30 || (skyT < -8 && chunks.chunks.size !== skySig))) {
          skyT = lite ? 6 : 1; skyAt.copy(cam.position); skySig = chunks.chunks.size;
          skyline(cam.position, dn.skyline);
          dn.skyline.uniforms.uOn.value = 1;
          dn.skylineChanged();
        }
      }
    },
    debug: { get chunks() { return chunks; }, get far() { return far; }, pool, traffic, peds, ships, sites, get frame() { return frame; }, colliders },
    earth,
  };
}
