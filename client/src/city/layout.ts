import * as THREE from 'three';
import type { Repo, Tier } from '../../../shared/types.ts';
import type { CityProfile, WaterSide } from './profiles.ts';

export const SIDEWALK = 4.5;
export const PROMENADE = 26;

export interface Block {
  c: number; r: number;
  x0: number; x1: number; z0: number; z1: number;
  park: boolean;
  outer: boolean; // padding blocks beyond the playable core
  s: number; // skyline strength 0..1
}

export type Face = 'n' | 's' | 'e' | 'w'; // n = +Z, s = -Z, e = +X, w = -X

export interface Lot {
  x0: number; x1: number; z0: number; z1: number;
  block: Block;
  front: Face;
  height: number;
  style: 'masonry' | 'glass';
  repo?: Repo;
}

export interface RepoSite {
  repo: Repo;
  lot: Lot;
  height: number;
  door: THREE.Vector3; // on the facade, at ground level
  doorOut: THREE.Vector3; // unit vector pointing out of the door
  approach: THREE.Vector3; // where the player stands to enter
  shape: 'setback' | 'obelisk' | 'crown' | 'cylinder' | 'slab' | 'box';
}

export interface Layout {
  profile: CityProfile;
  /** Road centerlines. avenues run along Z at these X; streets run along X at these Z. */
  avenuesX: number[];
  streetsZ: number[];
  blocks: Block[];
  lots: Lot[];
  sites: RepoSite[];
  land: { minX: number; maxX: number; minZ: number; maxZ: number };
  grid: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: THREE.Vector3;
  spawnFacing: number;
  groundY: (x: number, z: number) => number;
  rand: () => number;
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const TIER_HEIGHT: Record<Tier, [number, number]> = {
  landmark: [190, 320],
  tower: [95, 165],
  midrise: [30, 62],
  small: [9, 18],
};

export function buildLayout(p: CityProfile, repos: Repo[]): Layout {
  const rand = mulberry32(hashStr(p.id) ^ 0x9e3779b9);
  const pad = (side: WaterSide) => (p.water.includes(side) ? 0 : 2);
  const cMin = -pad('west'), cMax = p.cols - 1 + pad('east');
  const rMin = -pad('south'), rMax = p.rows - 1 + pad('north');

  const pitchX = p.blockW + p.avenueW, pitchZ = p.blockD + p.streetW;
  const offX = -(p.cols * pitchX) / 2, offZ = -(p.rows * pitchZ) / 2;
  const avenuesX: number[] = [], streetsZ: number[] = [];
  for (let i = cMin; i <= cMax + 1; i++) avenuesX.push(offX + i * pitchX);
  for (let j = rMin; j <= rMax + 1; j++) streetsZ.push(offZ + j * pitchZ);

  const grid = { minX: avenuesX[0], maxX: avenuesX[avenuesX.length - 1], minZ: streetsZ[0], maxZ: streetsZ[streetsZ.length - 1] };
  const land = {
    minX: grid.minX - (p.water.includes('west') ? PROMENADE : 0) - p.avenueW / 2,
    maxX: grid.maxX + (p.water.includes('east') ? PROMENADE : 0) + p.avenueW / 2,
    minZ: grid.minZ - (p.water.includes('south') ? PROMENADE : 0) - p.streetW / 2,
    maxZ: grid.maxZ + (p.water.includes('north') ? PROMENADE : 0) + p.streetW / 2,
  };

  const groundY = p.hills > 0
    ? (x: number, z: number) => {
        // Rolling SF hills that fade out toward the waterfront.
        const fx = THREE.MathUtils.smoothstep(land.maxX - x, 0, 220);
        const fz = THREE.MathUtils.smoothstep(land.maxZ - z, 0, 220);
        const h = 0.5 + 0.5 * Math.sin(x * 0.0062 + 0.8) * Math.cos(z * 0.0049 - 0.4) + 0.25 * Math.sin(x * 0.013 + z * 0.011);
        return Math.max(0, h) * p.hills * fx * fz;
      }
    : () => 0;

  const blocks: Block[] = [];
  for (let c = cMin; c <= cMax; c++) {
    for (let r = rMin; r <= rMax; r++) {
      const ci = c - cMin, ri = r - rMin;
      const x0 = avenuesX[ci] + p.avenueW / 2, x1 = avenuesX[ci + 1] - p.avenueW / 2;
      const z0 = streetsZ[ri] + p.streetW / 2, z1 = streetsZ[ri + 1] - p.streetW / 2;
      const park = p.parks.some(([a, b, c2, d]) => c >= a && c <= c2 && r >= b && r <= d);
      const outer = c < 0 || r < 0 || c >= p.cols || r >= p.rows;
      let s = 0;
      for (const [pc, pr, str, rad] of p.peaks) {
        const d = Math.hypot(c - pc, (r - pr) * (p.blockD / p.blockW));
        s = Math.max(s, str * Math.exp(-((d / rad) ** 2)));
      }
      if (outer) s *= 0.5;
      blocks.push({ c, r, x0, x1, z0, z1, park, outer, s });
    }
  }

  // ---- Place repo sites first ----
  const sorted = [...repos].sort((a, b) => b.score - a.score);
  const core = blocks.filter((b) => !b.park && !b.outer);
  const byStrength = [...core].sort((a, b) => b.s - a.s);
  const taken = new Set<Block>();
  const lots: Lot[] = [];
  const sites: RepoSite[] = [];

  const facingRoad = (b: Block, x0: number, x1: number, z0: number, z1: number): Face => {
    // Prefer the face that touches the block edge (a street).
    const opts: [Face, number][] = [
      ['s', Math.abs(z0 - (b.z0 + SIDEWALK))],
      ['n', Math.abs(z1 - (b.z1 - SIDEWALK))],
      ['w', Math.abs(x0 - (b.x0 + SIDEWALK))],
      ['e', Math.abs(x1 - (b.x1 - SIDEWALK))],
    ];
    opts.sort((a, b2) => a[1] - b2[1]);
    // Avenues are grander: prefer east/west when tied.
    return opts[0][0];
  };

  const addSite = (repo: Repo, lot: Lot, rank: number) => {
    const [lo, hi] = TIER_HEIGHT[repo.tier];
    const t = THREE.MathUtils.clamp(repo.score / (sorted[0]?.score || 1), 0, 1);
    const height = Math.round(lo + (hi - lo) * (0.35 + 0.65 * t) * (0.9 + 0.2 * rand()));
    lot.height = height;
    lot.repo = repo;
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const out = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[lot.front];
    const door = new THREE.Vector3(
      out[0] === 0 ? cx : out[0] > 0 ? lot.x1 : lot.x0, 0,
      out[1] === 0 ? cz : out[1] > 0 ? lot.z1 : lot.z0,
    );
    const doorOut = new THREE.Vector3(out[0], 0, out[1]);
    door.y = groundY(door.x, door.z);
    const approach = door.clone().addScaledVector(doorOut, 2.2);
    const shapes: RepoSite['shape'][] = repo.tier === 'landmark'
      ? ['setback', 'obelisk', 'crown', 'cylinder']
      : repo.tier === 'tower' ? ['slab', 'setback', 'obelisk', 'slab'] : ['box'];
    const shape = shapes[(hashStr(repo.name) + rank) % shapes.length];
    sites.push({ repo, lot, height, door, doorOut, approach, shape });
  };

  let bi = 0;
  const landmarks = sorted.filter((r) => r.tier === 'landmark');
  const towers = sorted.filter((r) => r.tier === 'tower');
  const rest = sorted.filter((r) => r.tier === 'midrise' || r.tier === 'small');

  for (const repo of landmarks) {
    const b = byStrength[bi++];
    if (!b) break;
    taken.add(b);
    // Plaza around the tower: the footprint is ~70% of the block.
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const fw = Math.min(w - 2 * SIDEWALK - 10, 58), fd = Math.min(d - 2 * SIDEWALK - 8, 52);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const lot: Lot = { x0: cx - fw / 2, x1: cx + fw / 2, z0: cz - fd / 2, z1: cz + fd / 2, block: b, front: rand() < 0.5 ? 'w' : 'e', height: 0, style: 'glass' };
    lots.push(lot);
    addSite(repo, lot, sites.length);
  }

  for (const repo of towers) {
    const b = byStrength[bi++];
    if (!b) break;
    taken.add(b);
    const mid = (b.x0 + b.x1) / 2;
    const westHalf = rand() < 0.5;
    const x0 = westHalf ? b.x0 + SIDEWALK : mid + 1, x1 = westHalf ? mid - 1 : b.x1 - SIDEWALK;
    const lot: Lot = { x0, x1, z0: b.z0 + SIDEWALK, z1: b.z1 - SIDEWALK, block: b, front: westHalf ? 'w' : 'e', height: 0, style: 'glass' };
    lots.push(lot);
    addSite(repo, lot, sites.length);
    // Filler on the other half.
    subdivide(b, westHalf ? mid + 1 : b.x0 + SIDEWALK, westHalf ? b.x1 - SIDEWALK : mid - 1, b.z0 + SIDEWALK, b.z1 - SIDEWALK);
  }

  // Remaining blocks: subdivide into lots.
  function subdivide(b: Block, x0: number, x1: number, z0: number, z1: number) {
    const w = x1 - x0, d = z1 - z0;
    const alongX = w >= d;
    const len = alongX ? w : d, depth = alongX ? d : w;
    const rows = depth > 44 ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      let pos = 0;
      while (pos < len - 6) {
        let seg = 14 + rand() * 26;
        if (len - pos - seg < 12) seg = len - pos;
        const a = pos, e = Math.min(len, pos + seg);
        pos = e;
        const dd = depth / rows;
        const lot: Lot = alongX
          ? { x0: x0 + a, x1: x0 + e, z0: z0 + row * dd, z1: z0 + (row + 1) * dd, block: b, front: row === 0 ? 's' : 'n', height: 0, style: 'masonry' }
          : { x0: x0 + row * dd, x1: x0 + (row + 1) * dd, z0: z0 + a, z1: z0 + e, block: b, front: row === 0 ? 'w' : 'e', height: 0, style: 'masonry' };
        if (rows === 1) lot.front = facingRoad(b, lot.x0, lot.x1, lot.z0, lot.z1);
        lots.push(lot);
      }
    }
  }

  for (const b of blocks) {
    if (b.park || taken.has(b)) continue;
    subdivide(b, b.x0 + SIDEWALK, b.x1 - SIDEWALK, b.z0 + SIDEWALK, b.z1 - SIDEWALK);
  }

  // Midrise + small repos: spread through core lots, closest to the skyline center first, one per block.
  const centerBlock = byStrength[0] ?? core[0];
  const cx0 = (centerBlock.x0 + centerBlock.x1) / 2, cz0 = (centerBlock.z0 + centerBlock.z1) / 2;
  const free = lots.filter((l) => !l.repo && !l.block.outer && (l.x1 - l.x0) >= 13 && (l.z1 - l.z0) >= 13);
  free.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - cx0, (a.z0 + a.z1) / 2 - cz0) - Math.hypot((b.x0 + b.x1) / 2 - cx0, (b.z0 + b.z1) / 2 - cz0));
  const usedBlocks = new Map<Block, number>();
  let pass = 0;
  let queue = [...rest];
  while (queue.length && pass < 4) {
    const next: Repo[] = [];
    for (const repo of queue) {
      const lot = free.find((l) => !l.repo && (usedBlocks.get(l.block) ?? 0) <= pass);
      if (!lot) { next.push(repo); continue; }
      usedBlocks.set(lot.block, (usedBlocks.get(lot.block) ?? 0) + 1);
      lot.style = repo.tier === 'midrise' && rand() < 0.5 ? 'glass' : 'masonry';
      addSite(repo, lot, sites.length);
    }
    queue = next;
    pass++;
  }

  // ---- Filler heights ----
  for (const lot of lots) {
    if (lot.repo) continue;
    const s = lot.block.s;
    const base = 10 + rand() * 22;
    const tall = Math.pow(s, 1.35) * p.maxHeight * (0.35 + rand() * 0.75);
    let h = Math.max(base, tall * (rand() < 0.25 ? 0.4 : 1));
    if (lot.block.outer) h *= 0.8;
    lot.height = Math.round(h);
    lot.style = h > 70 && rand() < 0.75 ? 'glass' : h > 40 && rand() < 0.35 ? 'glass' : 'masonry';
  }

  // Spawn: in front of the most important building.
  const top = sites[0];
  const spawn = top ? top.approach.clone().addScaledVector(top.doorOut, 10) : new THREE.Vector3((grid.minX + grid.maxX) / 2, 0, (grid.minZ + grid.maxZ) / 2);
  const spawnFacing = top ? Math.atan2(-top.doorOut.x, -top.doorOut.z) : 0;
  spawn.y = groundY(spawn.x, spawn.z);

  return { profile: p, avenuesX, streetsZ, blocks, lots, sites, land, grid, spawn, spawnFacing, groundY, rand };
}

/** Nearest road names for the HUD ("5th Ave & 34th St"). */
export function locationName(l: Layout, x: number, z: number) {
  const p = l.profile;
  const ai = nearestIndex(l.avenuesX, x), si = nearestIndex(l.streetsZ, z);
  const padW = p.water.includes('west') ? 0 : 2, padS = p.water.includes('south') ? 0 : 2;
  const aName = p.avenueNames[THREE.MathUtils.clamp(ai - padW, 0, p.avenueNames.length - 1)];
  const sName = p.streetNames(Math.max(0, si - padS));
  return `${aName} & ${sName}`;
}

function nearestIndex(arr: number[], v: number) {
  let bi = 0, bd = Infinity;
  arr.forEach((a, i) => { const d = Math.abs(a - v); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
