import * as THREE from 'three';
import type { Repo } from '../../../shared/types.ts';
import { CITIES } from './profiles.ts';
import type { CityId } from '../../../shared/types.ts';
import { buildLayout, type Layout } from './layout.ts';
import { buildFiller, buildRepoBuilding, updateGlow, type RepoBuilding } from './buildings.ts';
import { buildStreets, type Streets } from './streets.ts';
import { Colliders, type Box } from '../player.ts';

export interface City {
  layout: Layout;
  group: THREE.Group;
  colliders: Colliders;
  streets: Streets;
  buildings: RepoBuilding[];
  update(dt: number, time: number): void;
}

export async function buildCity(id: CityId, repos: Repo[], progress: (msg: string) => void): Promise<City> {
  const profile = CITIES[id];
  progress(`Surveying ${profile.district}…`);
  const layout = buildLayout(profile, repos);
  const boxes: Box[] = [];
  const group = new THREE.Group();

  progress('Paving streets…');
  await frame();
  const streets = buildStreets(layout, boxes);
  group.add(streets.group);

  progress('Raising the skyline…');
  await frame();
  group.add(buildFiller(layout, boxes));

  progress(`Constructing ${layout.sites.length} project headquarters…`);
  const buildings = await Promise.all(layout.sites.map((s) => buildRepoBuilding(layout, s, boxes)));
  for (const b of buildings) group.add(b.group);

  const colliders = new Colliders(32);
  boxes.forEach((b) => colliders.add(b));
  return {
    layout, group, colliders, streets, buildings,
    update(dt, time) {
      streets.update(dt);
      updateGlow(time);
    },
  };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
