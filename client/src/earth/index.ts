// The streaming Earth: start anywhere, walk or fly anywhere, the world loads around you from
// OpenMapTiles vector tiles, terrain tiles and satellite imagery. Your projects live at home.
import * as THREE from 'three';
import type { GeoPlace, Repo } from '../../../shared/types.ts';
import { Colliders } from '../player.ts';
import { updateGlow } from '../city/buildings.ts';
import type { Place } from '../place.ts';
import { GeoFrame, haversine, type LatLon } from './frame.ts';
import { Pool } from './pool.ts';
import { Chunks, type BuildingHit } from './chunks.ts';
import { FarTerrain } from './far.ts';
import { EarthTraffic, EarthPedestrians } from './traffic.ts';
import { buildEarthRepo, chooseEarthSites, type EarthSite, type HostFp } from './sites.ts';
import { updateWater } from './style.ts';
import { OceanWaves } from './ocean.ts';
import type { DayNight } from '../engine.ts';
import { driveLeft } from './build/chunk.ts';

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
  stats(): { chunks: number; loading: number; buildings: number; cars: number };
}

export async function searchPlaces(q: string): Promise<GeoPlace[]> {
  const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Search failed (${res.status})`);
  return res.json();
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
  const tune = () => { if (low) { chunks.radius0 = 450; chunks.radius1 = 1300; far.radius = 1; } };
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
  const fps: HostFp[] = [];
  for (const ch of chunks.chunks.values()) {
    if (ch.lod !== 0) continue;
    for (const f of ch.footprints) {
      const ring = f.ring.map((v, i) => v + (i % 2 ? ch.z0 : ch.x0));
      fps.push({ key: f.key, chunk: ch.key, ring, area: f.area, cx: f.cx + ch.x0, cz: f.cz + ch.z0, base: f.base, top: f.top, h: f.h, glass: f.glass, color: f.color });
    }
  }
  const fpGrid = new Map<string, HostFp[]>();
  for (const f of fps) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < f.ring.length; i += 2) { minX = Math.min(minX, f.ring[i]); maxX = Math.max(maxX, f.ring[i]); minZ = Math.min(minZ, f.ring[i + 1]); maxZ = Math.max(maxZ, f.ring[i + 1]); }
    for (let i = Math.floor(minX / 40); i <= Math.floor(maxX / 40); i++) for (let j = Math.floor(minZ / 40); j <= Math.floor(maxZ / 40); j++) {
      const k = `${i},${j}`; let l = fpGrid.get(k); if (!l) fpGrid.set(k, (l = [])); l.push(f);
    }
  }
  const inRing = (p: number[], x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
    return inside;
  };
  const solid = (x: number, z: number) => (fpGrid.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`) ?? []).some((f) => inRing(f.ring, x, z));
  const wet = (x: number, z: number) => !Number.isNaN(chunks.waterAt(x, z));
  const edges = [...chunks.net.drive, ...chunks.net.walk.filter((e) => !e.drive)];
  const { sites, added } = chooseEarthSites(repos, fps, edges, solid, wet, heightAt, HOME_R);
  for (const s of sites) if (s.fp.chunk) chunks.hide(s.fp.chunk, s.fp.key);
  chunks.keepCpu = false;
  const addSiteColliders = () => {
    for (const f of added) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < f.ring.length; i += 2) { minX = Math.min(minX, f.ring[i]); maxX = Math.max(maxX, f.ring[i]); minZ = Math.min(minZ, f.ring[i + 1]); maxZ = Math.max(maxZ, f.ring[i + 1]); }
      colliders.add({ minX, maxX, minZ, maxZ, maxY: f.top, poly: f.ring }, 'sites');
    }
  };
  addSiteColliders();
  const sitesGroup = new THREE.Group();
  for (const g of await Promise.all(sites.map((s: EarthSite) => buildEarthRepo(s)))) sitesGroup.add(g);
  sitesGroup.traverse((obj) => { obj.matrixAutoUpdate = false; obj.updateMatrix(); });
  root.add(sitesGroup);

  // ---- Life ----
  say('Filling the streets…');
  const top = sites[0];
  const spawn = top ? top.approach.clone().addScaledVector(top.doorOut, 9) : new THREE.Vector3(0, 0, 0);
  if (solid(spawn.x, spawn.z) || wet(spawn.x, spawn.z)) spawn.copy(top ? top.approach : new THREE.Vector3());
  spawn.y = heightAt(spawn.x, spawn.z);
  const spawnFacing = top ? Math.atan2(-top.doorOut.x, -top.doorOut.z) : 0;
  const nyc = Math.abs(home.lat - 40.75) < 0.25 && Math.abs(home.lon + 73.98) < 0.3;
  const traffic = new EarthTraffic(chunks.net, 150, driveLeft(country), nyc ? 0.4 : 0);
  const peds = new EarthPedestrians(chunks.net, 64, solid);
  root.add(traffic.group, peds.group);

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
      atHome = goingHome;
      sitesGroup.visible = atHome;
      colliders.removeOwner('sites');
      if (atHome) addSiteColliders();
      Object.assign(earth, { frame, e0, atHome, country });
      earth.onRebase?.();
    }
    const p = frame.toLocal(lat, lon);
    sayT?.('Streaming the map…');
    await chunks.loadAround(p.x, p.z, 300, (d, t) => sayT?.(`Streaming the map: tiles ${d}/${t}…`));
    chunks.updateMask(frame.tileAt(14, p.x, p.z));
    return new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
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

  // Away from home, ask the geocoder which city we're in (at most every 20 s, after moving 1.5 km).
  let revCity = '', revAt: LatLon | null = null, revTime = -1e9;
  const refreshCity = (g: LatLon) => {
    if (performance.now() - revTime < 20000 || (revAt && haversine(revAt, g) < 1500)) return;
    revTime = performance.now(); revAt = g;
    void reverseGeo(g.lat, g.lon).then((r) => {
      const parts = (r?.label ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      revCity = parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : '';
    });
  };

  let atHome = true;
  /** While dropping in somewhere, don't stream around the player's old (now meaningless) position. */
  let teleporting = false;
  const earth: EarthApi = {
    frame, e0, home, atHome, country,
    onRebase: null,
    heightAt,
    attach(camera, sky) { cam = camera; dn = sky; },
    buildingNear(x, z, maxDist = 1.6) {
      const hit = chunks.buildingNear(x, z, maxDist);
      if (!hit || chunks.hidden.get(hit.chunk.key)?.has(hit.fp.key) || hit.fp.h < 3) return null;
      return hit;
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
      const placeName = hood?.name ?? (cityLabel || (atHome ? title : ''));
      const sub = hood ? cityLabel : '';
      return { place: placeName, sub };
    },
    stats() {
      let b = 0;
      for (const ch of chunks.chunks.values()) b += ch.stats.buildings;
      return { chunks: chunks.chunks.size, loading: chunks.pending, buildings: b, cars: traffic.cars.filter((c) => c.live).length };
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
      support: (x, z, y) => Math.max(heightAt(x, z), chunks.deckAt(x, z, y)),
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
      if (!names.length) return earth.area(x, z).place || title;
      if (names[0].d > 40) return `Near ${names[0].name}`;
      return names.length > 1 && names[1].d < 30 ? `${names[0].name} & ${names[1].name}` : names[0].name;
    },
    update(dt, time, player) {
      const agl = player.y - heightAt(player.x, player.z);
      if (!teleporting) {
        chunks.update(player, agl, time);
        far.update(player, agl);
      }
      traffic.update(dt, player);
      peds.update(dt, player);
      updateWater(time);
      updateGlow(time);
      if (cam && dn) {
        oceanCheck -= dt;
        if (oceanCheck < 0) { oceanCheck = 1; oceanNear = checkOcean(cam.position.x, cam.position.z); }
        const w = dn.weather;
        waves.update(dt, cam, oceanNear ? -e0 : null, Math.max(w.storm, (w.windSpeed - 15) / 50));
      }
    },
    debug: { get chunks() { return chunks; }, get far() { return far; }, pool, traffic, peds, sites, get frame() { return frame; }, colliders },
    earth,
  };
}
