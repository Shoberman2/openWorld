import * as THREE from 'three';
import type { CityId, Repo } from '../../shared/types.ts';
import type { SkyLook } from './engine.ts';
import type { Colliders, PlayerWorld } from './player.ts';
import { CITIES } from './city/profiles.ts';
import { buildCity } from './city/index.ts';
import { locationName } from './city/layout.ts';
import { Traffic } from './traffic.ts';
import { Pedestrians } from './pedestrians.ts';

/** A project HQ in the world: where its door is and how tall it stands. */
export interface Site {
  repo: Repo;
  door: THREE.Vector3;
  doorOut: THREE.Vector3; // unit, pointing out of the door
  approach: THREE.Vector3; // where the player stands to enter
  top: THREE.Vector3; // roof center (for labels)
  center: { x: number; z: number };
  height: number;
  footprint?: number[];
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/** What the minimap needs: world bounds and a painter for the static base layer. */
export interface MapSource {
  bounds: Rect;
  /** +1 when +z is south (real places), -1 when +z is north (preset cities). */
  zSouth: 1 | -1;
  background: string;
  draw(g: CanvasRenderingContext2D, tx: (x: number) => number, tz: (z: number) => number, scale: number): void;
}

/** Anywhere the player can walk around: a preset city or a real place from OpenStreetMap. */
export interface Place {
  title: string; // "New York City" / "Shibuya"
  subtitle: string; // "Midtown Manhattan" / "Tokyo, Japan"
  group: THREE.Object3D;
  colliders: Colliders;
  world: PlayerWorld;
  sites: Site[];
  spawn: THREE.Vector3;
  spawnFacing: number;
  sky: SkyLook;
  /** Local time of day to start at, when known. */
  startHour: number | null;
  map: MapSource;
  airspace: Rect;
  locationName(x: number, z: number): string;
  update(dt: number, time: number, player: THREE.Vector3): void;
  debug: Record<string, unknown>;
}

export async function buildPresetPlace(id: CityId, repos: Repo[], say: (m: string) => void): Promise<Place> {
  const p = CITIES[id];
  const c = await buildCity(id, repos, say);
  say('Filling the streets…');
  const traffic = new Traffic(c.layout, c.streets, id === 'nyc' ? 240 : 170);
  const peds = new Pedestrians(c.layout, 64, c.layout.spawn);
  const group = new THREE.Group();
  group.add(c.group, traffic.group, peds.group);
  const L = c.layout;
  const topByRepo = new Map(c.buildings.map((b) => [b.site.repo.name, b.top]));
  const sites: Site[] = L.sites.map((s) => ({
    repo: s.repo, door: s.door, doorOut: s.doorOut, approach: s.approach,
    top: topByRepo.get(s.repo.name) ?? new THREE.Vector3((s.lot.x0 + s.lot.x1) / 2, s.height, (s.lot.z0 + s.lot.z1) / 2),
    center: { x: (s.lot.x0 + s.lot.x1) / 2, z: (s.lot.z0 + s.lot.z1) / 2 }, height: s.height,
  }));
  const shrink = (b: Rect, by: number) => ({ minX: b.minX + by, maxX: b.maxX - by, minZ: b.minZ + by, maxZ: b.maxZ - by });
  /** Curb height when standing on a sidewalk or promenade. */
  const onSidewalk = (x: number, z: number) => {
    for (const b of L.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return 0.18;
    const g = L.grid;
    if (x < g.minX - p.avenueW / 2 || x > g.maxX + p.avenueW / 2 || z < g.minZ - p.streetW / 2 || z > g.maxZ + p.streetW / 2) return 0.18;
    return 0;
  };
  return {
    title: p.name, subtitle: p.district,
    group, colliders: c.colliders, sites,
    world: {
      colliders: c.colliders, groundY: (x, z) => L.groundY(x, z) + onSidewalk(x, z), bounds: shrink(L.land, 1.2),
      support: (x, z) => L.groundY(x, z) + onSidewalk(x, z), canFly: true,
    },
    spawn: L.spawn, spawnFacing: L.spawnFacing,
    sky: { ...p.sky, envLight: 0.3, ambient: 2.4 }, startHour: null,
    airspace: L.land,
    map: {
      bounds: L.land, zSouth: -1, background: p.water.length ? '#16324a' : '#1a1e26',
      draw(g, tx, tz, k) {
        const B = L.land;
        g.fillStyle = '#2c313b';
        g.fillRect(tx(B.minX), tz(B.maxZ), (B.maxX - B.minX) * k, (B.maxZ - B.minZ) * k);
        for (const b of L.blocks) {
          g.fillStyle = b.park ? '#2f5a34' : '#4a505c';
          g.fillRect(tx(b.x0), tz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
        }
        for (const lot of L.lots) {
          g.fillStyle = lot.repo ? lot.repo.brandColor || '#ffcc33' : `rgba(110,118,132,${0.4 + Math.min(lot.height, 200) / 400})`;
          g.fillRect(tx(lot.x0) + 1, tz(lot.z1) + 1, (lot.x1 - lot.x0) * k - 2, (lot.z1 - lot.z0) * k - 2);
        }
      },
    },
    locationName: (x, z) => locationName(L, x, z),
    update(dt, time, player) {
      c.update(dt, time);
      traffic.update(dt, player);
      peds.update(dt, player);
    },
    debug: { c, traffic, layout: L },
  };
}
