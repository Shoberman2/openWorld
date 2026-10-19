// Project HQs in the streaming world: every repo moves into a real building (the biggest ones into
// the tallest towers near where you started), or into a new one built on an empty lot.
import * as THREE from 'three';
import type { Repo, Tier } from '../../../shared/types.ts';
import { doorTexture, glow, glowMaterials, loadLogo, logoTexture, nameTexture } from '../city/buildings.ts';
import { hashStr } from '../city/layout.ts';
import type { Site } from '../place.ts';
import type { NEdge } from './net.ts';
import { buildingMaterial } from './style.ts';

/** A building footprint in world coordinates (from a loaded chunk, or newly built). */
export interface HostFp {
  key: number;
  chunk: string | null; // null = built for a project
  ring: number[];
  area: number;
  cx: number; cz: number;
  base: number; top: number; h: number;
  glass: boolean;
  color: number;
}

export interface EarthSite extends Site { fp: HostFp }

const TIER_HEIGHT: Record<Tier, [number, number]> = { landmark: [190, 300], tower: [95, 160], midrise: [30, 60], small: [9, 16] };

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
): { sites: EarthSite[]; added: HostFp[] } {
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
  const onStreet = (x: number, z: number) => {
    for (const s of segs.query(x, z, 2)) if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.w / 2 + 0.5) return true;
    return false;
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

  const usable = fps.filter((f) => f.area >= 60 && Math.hypot(f.cx, f.cz) < radius * 0.9);
  const dist0 = (f: HostFp, x = 0, z = 0) => Math.hypot(f.cx - x, f.cz - z);
  const sorted = [...repos].sort((a, b) => b.score - a.score);
  const sites: EarthSite[] = [];
  const taken = new Set<HostFp>();
  const added: HostFp[] = [];
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
    if (!claim(repo, tallPool.filter((f) => f.h >= minH).slice(0, 80))) leftovers.push(repo);
  }
  const hub = sites[0]?.fp ?? null;
  const hx = hub?.cx ?? 0, hz = hub?.cz ?? 0;
  for (const repo of rest) {
    const [lo, hi] = repo.tier === 'midrise' ? [12, 70] : [3, 22];
    const pool = usable.filter((f) => f.h >= lo && f.h <= hi && (repo.tier === 'small' ? f.area < 1500 : f.area > 150)).sort((a, b) => dist0(a, hx, hz) - dist0(b, hx, hz));
    if (!claim(repo, pool.slice(0, 160))) leftovers.push(repo);
  }

  if (leftovers.length) {
    const cands = edges.filter((e) => e.drive || e.width >= 5).sort((a, b) => {
      const ma = (a.pts.length / 4 | 0) * 2, mb = (b.pts.length / 4 | 0) * 2;
      return Math.hypot(a.pts[ma], a.pts[ma + 1]) - Math.hypot(b.pts[mb], b.pts[mb + 1]);
    });
    let k = 0;
    outer: for (const repo of leftovers) {
      const [lo, hi] = TIER_HEIGHT[repo.tier];
      const size = repo.tier === 'landmark' ? 40 : repo.tier === 'tower' ? 30 : repo.tier === 'midrise' ? 22 : 14;
      const depth = repo.tier === 'small' ? 12 : size;
      for (const e of cands) {
        for (let s = size / 2 + 6; s < e.len - size / 2 - 6; s += size * 0.6) {
          const p = pointAlong(e, s);
          for (const side of [1, -1]) {
            const nx = -p.tz * side, nz = p.tx * side;
            const set = e.width / 2 + 4.5;
            const cx = p.x + nx * (set + depth / 2), cz = p.z + nz * (set + depth / 2);
            const ring = rect(cx, cz, p.tx, p.tz, size, depth);
            if (!clearLot(ring, cx, cz, solid, wet, onStreet) || added.some((f) => Math.hypot(f.cx - cx, f.cz - cz) < (size + Math.sqrt(f.area)) / 2 + 4)) continue;
            let base = Infinity;
            for (let i = 0; i < ring.length; i += 2) base = Math.min(base, ground(ring[i], ring[i + 1]));
            const h = Math.round(lo + (hi - lo) * ((hashStr(repo.name) % 1000) / 1000));
            const fp: HostFp = { key: -(++k), chunk: null, ring, area: size * depth, cx, cz, base, top: base + h, h, glass: repo.tier !== 'small', color: repo.tier !== 'small' ? 0x6f9fc4 : 0xd9cfbd };
            added.push(fp);
            const dx = p.x + nx * set, dz = p.z + nz * set, gy = ground(dx, dz);
            const doorPos = new THREE.Vector3(dx, gy, dz);
            const out = new THREE.Vector3(-nx, 0, -nz);
            sites.push(makeSite(repo, fp, { door: doorPos, out, approach: doorPos.clone().addScaledVector(out, 2.4), wallLen: size }));
            continue outer;
          }
        }
      }
    }
  }
  const rank = new Map(sorted.map((r, i) => [r.name, i]));
  sites.sort((a, b) => rank.get(a.repo.name)! - rank.get(b.repo.name)!);
  return { sites, added };
}

function pointAlong(e: NEdge, s: number) {
  let k = 1;
  while (k < e.cum.length - 1 && e.cum[k] < s) k++;
  const s0 = e.cum[k - 1], s1 = e.cum[k], f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const ax = e.pts[(k - 1) * 2], az = e.pts[(k - 1) * 2 + 1], bx = e.pts[k * 2], bz = e.pts[k * 2 + 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, tx: (bx - ax) / l, tz: (bz - az) / l };
}

function rect(cx: number, cz: number, tx: number, tz: number, w: number, d: number) {
  const rx = -tz, rz = tx;
  const pts: number[] = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(cx + tx * (a * w) / 2 + rx * (b * d) / 2, cz + tz * (a * w) / 2 + rz * (b * d) / 2);
  let area = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) area += pts[j] * pts[i + 1] - pts[i] * pts[j + 1];
  return area > 0 ? [pts[6], pts[7], pts[4], pts[5], pts[2], pts[3], pts[0], pts[1]] : pts;
}

function clearLot(ring: number[], cx: number, cz: number, solid: (x: number, z: number) => boolean, wet: (x: number, z: number) => boolean, onStreet: (x: number, z: number) => boolean) {
  const probes: [number, number][] = [[cx, cz]];
  for (let i = 0; i < ring.length; i += 2) {
    probes.push([ring[i], ring[i + 1]], [(ring[i] + cx) / 2, (ring[i + 1] + cz) / 2]);
    const j = (i + 2) % ring.length;
    probes.push([(ring[i] + ring[j]) / 2, (ring[i + 1] + ring[j + 1]) / 2]);
  }
  return probes.every(([x, z]) => !solid(x, z) && !wet(x, z) && !onStreet(x, z));
}

function makeSite(repo: Repo, fp: HostFp, d: Door): EarthSite {
  return {
    repo, fp, door: d.door, doorOut: d.out, approach: d.approach,
    top: new THREE.Vector3(fp.cx, fp.top, fp.cz),
    center: { x: fp.cx, z: fp.cz }, height: fp.h,
    footprint: fp.ring,
  };
}

// ---------------------------------------------------------------------------------------------

/** Walls + roof with the same facade coordinates the chunk builder uses (so HQs match the city). */
function extrude(fp: HostFp, color: THREE.Color, seed: number) {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], fac: number[] = [], sd: number[] = [], idx: number[] = [];
  const r = fp.ring, n = r.length / 2;
  const y0 = fp.base - 1.6, y1 = fp.top;
  const roof = new THREE.Color(0xc9c6bf);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len, b = pos.length / 3;
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (const [u, y] of [[0, y0], [len, y0], [len, y1], [0, y1]]) { nrm.push(nx, 0, nz); col.push(color.r, color.g, color.b); fac.push(u, y - fp.base, len, fp.h); sd.push(seed); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) contour.push(new THREE.Vector2(r[i], r[i + 1]));
  const base = pos.length / 3;
  for (const v of contour) { pos.push(v.x, y1, v.y); nrm.push(0, 1, 0); col.push(roof.r, roof.g, roof.b); fac.push(0, fp.h, 0, fp.h); sd.push(seed); }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = contour[a], B = contour[b], C = contour[c];
    const ny = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
    if (ny >= 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(fac, 4));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, buildingMaterial());
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** The HQ itself: the real building tinted with the brand, a lit crown, logos, and a front door. */
export async function buildEarthRepo(site: EarthSite): Promise<THREE.Group> {
  const { repo, fp } = site;
  const group = new THREE.Group();
  group.name = `repo:${repo.name}`;
  const brand = new THREE.Color(repo.brandColor || '#6b7a8f');
  const wall = new THREE.Color(fp.color).lerp(brand, fp.glass ? 0.35 : 0.18);
  const seed = ((hashStr(repo.name) % 997) / 997) * 0.999 + (fp.glass ? 2 : 0);
  group.add(extrude(fp, wall, seed));

  const H = fp.top;
  const r = fp.ring, n = r.length / 2;
  if (fp.h > 12) {
    const band: number[] = [];
    const y0 = H - 1.6, y1 = H - 0.6;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      const ox = (-(bz - az) / len) * 0.12, oz = ((bx - ax) / len) * 0.12;
      band.push(ax + ox, y0, az + oz, bx + ox, y0, bz + oz, bx + ox, y1, bz + oz, ax + ox, y0, az + oz, bx + ox, y1, bz + oz, ax + ox, y1, az + oz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, glow(brand, 1.4)));
  }
  if (fp.h > 80) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), glow(0xff2a2a, 3, true));
    b.position.set(fp.cx, H + 2.5, fp.cz);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 5, 6).translate(0, 2.5, 0), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.3 }));
    mast.position.set(fp.cx, H, fp.cz);
    group.add(b, mast);
  }

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

  // Entrance.
  const ry = Math.atan2(out.x, out.z);
  const gy = site.door.y;
  const wallLen = wallLenAt(fp, site);
  const doorW = Math.min(repo.tier === 'landmark' ? 8 : repo.tier === 'tower' ? 6 : 3.6, Math.max(2.4, wallLen * 0.7));
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x0b1016, roughness: 0.08, metalness: 0.6, emissive: 0xffffff, emissiveMap: doorTexture(repo.brandColor), emissiveIntensity: 0.8 });
  doorMat.userData = { base: 0.8 };
  glowMaterials.push(doorMat);
  const door = new THREE.Mesh(plane, doorMat);
  door.position.copy(site.door).addScaledVector(out, 0.07); door.position.y = gy + 1.6;
  door.rotation.y = ry; door.scale.set(doorW, 3.2, 1);
  group.add(door);
  const brandMat = new THREE.MeshStandardMaterial({ color: brand, roughness: 0.4, metalness: 0.3 });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(doorW + 2, 0.35, 3), brandMat);
  canopy.position.copy(site.door).addScaledVector(out, 1.5); canopy.position.y = gy + 3.75; canopy.rotation.y = ry;
  canopy.castShadow = true;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(doorW + 2.05, 0.12, 3.05), glow(brand, 1.6));
  strip.position.copy(canopy.position); strip.position.y = gy + 3.58; strip.rotation.y = ry;
  group.add(canopy, strip);
  const nm = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: nameTexture(repo.name, repo.brandColor || '#ffcc33'), transparent: true }));
  const nameW = Math.min(Math.max(doorW + 4, 9), Math.max(6, wallLen * 0.92));
  nm.position.copy(site.door).addScaledVector(out, 0.09); nm.position.y = gy + Math.min(5.4, fp.top - gy - 1);
  nm.rotation.y = ry; nm.scale.set(nameW, nameW * 0.1875, 1);
  group.add(nm);
  if (fp.h <= 22) {
    const lg = new THREE.Mesh(plane, logoMat);
    const s = Math.min(6, Math.max(3, wallLen * 0.3));
    let y = gy + 6.4 + s / 2 + 0.6;
    if (y + s / 2 > fp.top - 0.5) y = fp.top + s / 2 + 0.9;
    lg.position.copy(site.door).addScaledVector(out, y > fp.top ? -1.5 : 0.09); lg.position.y = y;
    lg.rotation.y = ry; lg.scale.setScalar(s);
    group.add(lg);
  }
  const pillarGeo = new THREE.CylinderGeometry(0.18, 0.18, 3.6, 8).translate(0, 1.8, 0);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(site.door.x + out.z * side * (doorW / 2 + 0.6) + out.x * 2.6, gy - 0.05, site.door.z - out.x * side * (doorW / 2 + 0.6) + out.z * 2.6);
    p.castShadow = true;
    group.add(p);
  }
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
