// Project HQs in the streaming world: every repo moves into a real building near where you started
// (the biggest into the tallest real towers), keeping its real shape and height. Famous landmarks are
// left alone so the city stays recognizable; a project only adds its entrance, signage and logos.
import * as THREE from 'three';
import type { Repo } from '../../../shared/types.ts';
import { loadLogo, logoTexture } from '../city/buildings.ts';
import { buildEntrance, entranceDepth } from '../city/entrance.ts';
import { hashStr } from '../city/layout.ts';
import type { Site } from '../place.ts';
import type { NEdge } from './net.ts';

/** A real building footprint in world coordinates (from a loaded chunk). */
export interface HostFp {
  key: number;
  chunk: string;
  ring: number[];
  area: number;
  cx: number; cz: number;
  base: number; top: number; h: number;
  glass: boolean;
  color: number;
  /** A named place inside (museum, church, attraction…): never taken over. */
  landmark?: boolean;
}

export interface EarthSite extends Site { fp: HostFp }

interface Door { door: THREE.Vector3; out: THREE.Vector3; approach: THREE.Vector3; wallLen: number }

class SegGrid<T> {
  private cells = new Map<string, T[]>();
  constructor(private s = 40) {}
  add(t: T, x0: number, z0: number, x1: number, z1: number) {
    for (let i = Math.floor(x0 / this.s); i <= Math.floor(x1 / this.s); i++) for (let j = Math.floor(z0 / this.s); j <= Math.floor(z1 / this.s); j++) {
      const k = `${i},${j}`; let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(t);
    }
  }
  query(x: number, z: number, r: number) {
    const out = new Set<T>();
    for (let i = Math.floor((x - r) / this.s); i <= Math.floor((x + r) / this.s); i++) for (let j = Math.floor((z - r) / this.s); j <= Math.floor((z + r) / this.s); j++) this.cells.get(`${i},${j}`)?.forEach((t) => out.add(t));
    return out;
  }
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
  return Math.hypot(x - (ax + ex * t), z - (az + ez * t));
}

export function chooseEarthSites(
  repos: Repo[], fps: HostFp[], edges: NEdge[],
  solid: (x: number, z: number) => boolean, wet: (x: number, z: number) => boolean, ground: (x: number, z: number) => number,
  radius: number,
): { sites: EarthSite[]; leftovers: Repo[] } {
  const segs = new SegGrid<{ ax: number; az: number; bx: number; bz: number; w: number; drive: boolean }>();
  for (const e of edges) for (let i = 0; i + 3 < e.pts.length; i += 2) {
    const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
    segs.add({ ax, az, bx, bz, w: e.width, drive: e.drive }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  }
  const nearestStreet = (x: number, z: number, r: number) => {
    let best = Infinity;
    for (const s of segs.query(x, z, r)) best = Math.min(best, segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.w / 2 + (s.drive ? 0 : 2));
    return best;
  };
  const findDoor = (f: HostFp, minLen: number): Door | null => {
    const r = f.ring, n = r.length / 2;
    let best: Door | null = null, bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < minLen) continue;
      const ox = -(bz - az) / len, oz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const px = mx + ox * 2.4, pz = mz + oz * 2.4;
      if (solid(px, pz) || wet(px, pz) || solid(mx + ox * 0.6, mz + oz * 0.6)) continue;
      const d = nearestStreet(mx + ox * 3, mz + oz * 3, 30);
      if (d > 28) continue;
      const score = d - Math.min(len, 30) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        const gy = ground(px, pz);
        best = { door: new THREE.Vector3(mx, gy, mz), out: new THREE.Vector3(ox, 0, oz), approach: new THREE.Vector3(px, gy, pz), wallLen: len };
      }
    }
    return best;
  };

  // Supertalls (300 m+) are the skyline everyone knows; they stay themselves too.
  const usable = fps.filter((f) => f.area >= 60 && !f.landmark && f.h < 300 && Math.hypot(f.cx, f.cz) < radius * 0.9);
  const dist0 = (f: HostFp, x = 0, z = 0) => Math.hypot(f.cx - x, f.cz - z);
  const sorted = [...repos].sort((a, b) => b.score - a.score);
  const sites: EarthSite[] = [];
  const taken = new Set<HostFp>();
  const spaced = (d: Door) => sites.every((s) => s.door.distanceTo(d.door) > 14);
  const claim = (repo: Repo, pool: HostFp[]) => {
    for (const f of pool) {
      if (taken.has(f)) continue;
      const door = findDoor(f, repo.tier === 'small' ? 3.5 : 6);
      if (!door || !spaced(door)) continue;
      taken.add(f);
      sites.push(makeSite(repo, f, door));
      return true;
    }
    return false;
  };
  const tallPool = usable.filter((f) => dist0(f) < radius * 0.7).sort((a, b) => (b.h - dist0(b) * 0.3) - (a.h - dist0(a) * 0.3));
  const big = sorted.filter((r) => r.tier === 'landmark' || r.tier === 'tower');
  const rest = sorted.filter((r) => r.tier === 'midrise' || r.tier === 'small');
  const leftovers: Repo[] = [];
  for (const repo of big) {
    const minH = repo.tier === 'landmark' ? 45 : 25;
    if (claim(repo, tallPool.filter((f) => f.h >= minH).slice(0, 80))) continue;
    // The tall ones nearby are spoken for: the nearest decent real building instead.
    if (!claim(repo, usable.filter((f) => f.h >= 15).sort((a, b) => dist0(a) - dist0(b)).slice(0, 400))) leftovers.push(repo);
  }
  const hub = sites[0]?.fp ?? null;
  const hx = hub?.cx ?? 0, hz = hub?.cz ?? 0;
  for (const repo of rest) {
    const [lo, hi] = repo.tier === 'midrise' ? [12, 70] : [3, 22];
    const pool = usable.filter((f) => f.h >= lo && f.h <= hi && (repo.tier === 'small' ? f.area < 1500 : f.area > 150)).sort((a, b) => dist0(a, hx, hz) - dist0(b, hx, hz));
    if (!claim(repo, pool.slice(0, 160))) leftovers.push(repo);
  }

  const rank = new Map(sorted.map((r, i) => [r.name, i]));
  sites.sort((a, b) => rank.get(a.repo.name)! - rank.get(b.repo.name)!);
  return { sites, leftovers };
}

function makeSite(repo: Repo, fp: HostFp, d: Door): EarthSite {
  // Stand just outside the glass lobby pavilion, not inside it.
  const approach = d.door.clone().addScaledVector(d.out, entranceDepth(repo.tier) + 1.4);
  approach.y = d.approach.y;
  return {
    repo, fp, door: d.door, doorOut: d.out, approach,
    top: new THREE.Vector3(fp.cx, fp.top, fp.cz),
    center: { x: fp.cx, z: fp.cz }, height: fp.h,
    footprint: fp.ring,
  };
}

// ---------------------------------------------------------------------------------------------

/** The HQ itself: the real building, untouched, with the project's logo high on its walls and a front door. */
export async function buildEarthRepo(site: EarthSite): Promise<THREE.Group> {
  const { repo, fp } = site;
  const group = new THREE.Group();
  group.name = `repo:${repo.name}`;
  const H = fp.top;
  const r = fp.ring, n = r.length / 2;

  const img = await loadLogo(repo.name, repo.hasLogo);
  const logoMat = new THREE.MeshBasicMaterial({ map: logoTexture(site, img) });
  const plane = new THREE.PlaneGeometry(1, 1);
  const walls: { mx: number; mz: number; ox: number; oz: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len >= 4) walls.push({ mx: (ax + bx) / 2, mz: (az + bz) / 2, ox: -(bz - az) / len, oz: (bx - ax) / len, len });
  }
  const out = site.doorOut;
  if (fp.h > 22 && walls.length) {
    const score = (w: typeof walls[0]) => (w.ox * out.x + w.oz * out.z) * Math.min(w.len, 30);
    const front = [...walls].sort((a, b) => score(b) - score(a))[0];
    const back = [...walls].sort((a, b) => score(a) - score(b))[0];
    for (const w of front === back ? [front] : [front, back]) {
      const s = Math.min(w.len * 0.6, 22, fp.h * 0.3);
      if (s < 3.5) continue;
      const m = new THREE.Mesh(plane, logoMat);
      m.position.set(w.mx + w.ox * 0.35, H - s / 2 - 2.6, w.mz + w.oz * 0.35);
      m.rotation.y = Math.atan2(w.ox, w.oz);
      m.scale.setScalar(s);
      group.add(m);
    }
  }

  // Entrance: a glass lobby pavilion with doors, canopy, letters and a logo (city/entrance.ts).
  const logoTex = logoMat.map!;
  group.add(buildEntrance({
    door: site.door, out, wallLen: wallLenAt(fp, site), maxH: fp.top - site.door.y, tier: repo.tier,
    name: repo.name, brand: repo.brandColor || '#6b7a8f', logo: logoTex, seed: hashStr(repo.name),
  }));
  return group;
}

function wallLenAt(fp: HostFp, site: Site) {
  const r = fp.ring, n = r.length / 2;
  let best = 6, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = segDist(site.door.x, site.door.z, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1]);
    if (d < bd) { bd = d; best = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]); }
  }
  return best;
}
