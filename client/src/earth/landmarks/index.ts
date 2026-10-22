// The landmark layer: places the hand-built landmarks where the map's own buildings were handed
// over (or at their coordinates), swaps detail by distance, gives them collisions up close, lights
// them at night, and adds Times Square's screens and the street-name signs to detailed chunks. It
// also answers "what am I looking at" for the HUD.
import * as THREE from 'three';
import type { Colliders } from '../../player.ts';
import { shared } from '../../engine.ts';
import type { ChunkOut, FootprintData } from '../build/types.ts';
import type { Chunk } from '../chunks.ts';
import type { GeoFrame } from '../frame.ts';
import { haversine } from '../frame.ts';
import { LANDMARKS, type Landmark } from './catalog.ts';
import { nightMats, type Built } from './kit.ts';
import { BUILDERS, latticeNight } from './models.ts';
import { buildSigns, signStyleKey, type StreetSigns } from './signs.ts';
import { TKTS, buildScreens, screenTime, tktsSteps } from './timessq.ts';

/** What the chunk manager exposes to the layer. */
interface Host {
  frame: GeoFrame;
  heightAt(x: number, z: number): number | null;
  waterAt(x: number, z: number): number;
  chunkAt(x: number, z: number): Chunk | undefined;
}

interface Placed {
  l: Landmark;
  built: Built | null;
  /** World claims per chunk key. */
  claims: Map<string, { ring: number[]; holes: number[][]; base: number; top: number; minH: number }[]>;
  sig: string;
  x: number; z: number; y: number; rot: number;
  /** World-space solids (rings) for collisions and look-at. */
  solids: { ring: number[]; y0: number; y1: number }[];
  radius: number;
  collide: boolean;
  dirty: boolean;
}

const DETAIL = 1500, DRAW = 9000, COLLIDE = 700;
const NYC = { lat0: 40.49, lat1: 40.92, lon0: -74.27, lon1: -73.68 };

export interface LookHit { title: string; sub: string; x: number; z: number }

export class LandmarkLayer {
  group = new THREE.Group();
  private placed: Placed[] = [];
  private poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.72, 8).translate(0, 1.86, 0);
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x1d3b2a, roughness: 0.6, metalness: 0.4 });
  private styleKey: string;
  private tkts: THREE.Group | null = null;
  private lastCheck = -1;
  /** Detailed chunks' footprints in world space, bucketed by 40 m, for look-at. */
  private fpGrid = new Map<string, { f: FootprintData; ring: number[]; chunk: string }[]>();
  private fpOwners = new Map<string, string[]>();
  /** Street signs on or off (survives the world re-centering, which makes a new layer). */
  static signsOn = true;
  showSigns = LandmarkLayer.signsOn;
  /** Each detailed chunk's street signs (blades are built near the player). */
  private signs = new Map<string, { s: StreetSigns; x0: number; z0: number }>();

  constructor(private host: Host, private colliders: Colliders, country: string) {
    this.group.name = 'landmarks';
    const o = host.frame.toGeo(0, 0);
    const nyc = country === 'us' && o.lat > NYC.lat0 && o.lat < NYC.lat1 && o.lon > NYC.lon0 && o.lon < NYC.lon1;
    this.styleKey = signStyleKey(country, nyc);
    // Only landmarks within reach of this frame (it's rebased on long trips).
    for (const l of LANDMARKS) {
      if (haversine(o, l) > 60_000) continue;
      const p = host.frame.toLocal(l.lat, l.lon);
      this.placed.push({ l, built: null, claims: new Map(), sig: '', x: p.x, z: p.z, y: 0, rot: l.road ? Math.PI / 2 - (l.bearing * Math.PI) / 180 : (-l.bearing * Math.PI) / 180, solids: [], radius: l.height, collide: false, dirty: true });
    }
    if (haversine(o, TKTS) < 60_000) {
      const p = host.frame.toLocal(TKTS.lat, TKTS.lon);
      this.tkts = tktsSteps();
      this.tkts.position.set(p.x, 0, p.z);
      this.tkts.rotation.y = (-TKTS.bearing * Math.PI) / 180;
      this.tkts.visible = false;
      this.group.add(this.tkts);
    }
  }

  /** A chunk arrived: take its landmark claims, and dress detailed chunks (signs, screens). */
  install(o: ChunkOut, ch: Chunk) {
    for (const p of this.placed) if (p.claims.delete(ch.key)) p.dirty = true;
    for (const c of o.landmarks ?? []) {
      const p = this.placed.find((q) => q.l.id === c.id);
      if (!p) continue;
      const off = (r: number[]) => r.map((v, i) => v + (i % 2 ? ch.z0 : ch.x0));
      let list = p.claims.get(ch.key);
      if (!list) p.claims.set(ch.key, (list = []));
      list.push({ ring: off(c.ring), holes: c.holes.map(off), base: c.base, top: c.top, minH: c.minH });
      p.dirty = true;
    }
    if (o.lod !== 0) return;
    const signs = buildSigns(o.edges, o.size, this.styleKey, this.poleGeo, this.poleMat, o.poles, o.footprints);
    if (signs) { signs.group.visible = this.showSigns; ch.group.add(signs.group); this.signs.set(ch.key, { s: signs, x0: ch.x0, z0: ch.z0 }); }
    const screens = buildScreens(this.host.frame, o.footprints, ch.x0, ch.z0);
    if (screens) ch.group.add(screens);
    // Footprints for look-at.
    const keys: string[] = [];
    for (const f of o.footprints) {
      const ring = f.ring.map((v, i) => v + (i % 2 ? ch.z0 : ch.x0));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
      for (let i = Math.floor(x0 / 40); i <= Math.floor(x1 / 40); i++) for (let j = Math.floor(z0 / 40); j <= Math.floor(z1 / 40); j++) {
        const k = `${i},${j}`;
        let l = this.fpGrid.get(k);
        if (!l) { this.fpGrid.set(k, (l = [])); keys.push(k); }
        l.push({ f, ring, chunk: ch.key });
      }
    }
    this.fpOwners.set(ch.key, keys);
  }

  remove(chunkKey: string) {
    // The chunk disposes the blades still in its group; this drops the rest of the bookkeeping.
    this.signs.delete(chunkKey);
    for (const p of this.placed) if (p.claims.delete(chunkKey)) p.dirty = true;
    for (const k of this.fpOwners.get(chunkKey) ?? []) {
      const l = this.fpGrid.get(k);
      if (!l) continue;
      const kept = l.filter((e) => e.chunk !== chunkKey);
      if (kept.length) this.fpGrid.set(k, kept); else this.fpGrid.delete(k);
    }
    this.fpOwners.delete(chunkKey);
  }

  private build(p: Placed) {
    p.dirty = false;
    const claims = [...p.claims.values()].flat();
    const sig = claims.map((c) => `${c.ring.length}:${Math.round(c.ring[0])}`).sort().join('|');
    if (p.built && sig === p.sig) return;
    p.sig = sig;
    let span: number | undefined;
    // Bridges: the map's tower parts fall into two clusters; the model spans between them.
    if (p.l.road && claims.length >= 2) {
      const cs = claims.map((c) => ringCenter(c.ring));
      let a = cs[0], b = cs[0], far = 0;
      for (const c of cs) { const d = Math.hypot(c.x - cs[0].x, c.z - cs[0].z); if (d > far) { far = d; b = c; } }
      far = 0;
      for (const c of cs) { const d = Math.hypot(c.x - b.x, c.z - b.z); if (d > far) { far = d; a = c; } }
      const A = { x: 0, z: 0, n: 0 }, B = { x: 0, z: 0, n: 0 };
      for (const c of cs) { const t = Math.hypot(c.x - a.x, c.z - a.z) < Math.hypot(c.x - b.x, c.z - b.z) ? A : B; t.x += c.x; t.z += c.z; t.n++; }
      if (far > 150 && A.n && B.n) {
        const ax = A.x / A.n, az = A.z / A.n, bx = B.x / B.n, bz = B.z / B.n;
        span = Math.hypot(bx - ax, bz - az);
        p.x = (ax + bx) / 2; p.z = (az + bz) / 2;
        p.rot = Math.atan2(-(bz - az), bx - ax);
      }
    }
    // Anchor: the claimed footprints' area-weighted center (the map knows where the building is).
    if (claims.length && !p.l.road) {
      let ax = 0, az = 0, aw = 0, base = Infinity;
      for (const c of claims) {
        const a = Math.abs(ringArea(c.ring)), m = ringCenter(c.ring);
        ax += m.x * a; az += m.z * a; aw += a; base = Math.min(base, c.base);
      }
      if (aw > 0) { p.x = ax / aw; p.z = az / aw; }
      p.y = base;
    }
    if (p.built) { this.group.remove(p.built.group); dispose(p.built.group); }
    const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
    // World → model frame (undo the placement rotation: three's y-rotation maps (x, z) to (x·c + z·s, −x·s + z·c)).
    const toModel = (r: number[]) => {
      const out: number[] = [];
      for (let i = 0; i < r.length; i += 2) {
        const dx = r[i] - p.x, dz = r[i + 1] - p.z;
        out.push(dx * cos - dz * sin, dx * sin + dz * cos);
      }
      return out;
    };
    const rings = claims.map((c) => ({ ring: toModel(c.ring), holes: c.holes.map(toModel), y0: (c.minH > 0.5 ? c.base + c.minH : c.base - 1.6) - p.y, y1: c.top - p.y }));
    const minY = claims.length ? Math.min(...claims.map((c) => c.minH)) : 0;
    const b = BUILDERS[p.l.model]({ rings, minY, span });
    b.group.name = `landmark:${p.l.id}`;
    b.group.position.set(p.x, p.y, p.z);
    b.group.rotation.y = p.rot;
    b.group.updateMatrixWorld(true);
    // Solids in world space.
    const c2 = Math.cos(p.rot), s2 = Math.sin(p.rot);
    p.solids = b.solids.map((s) => {
      const ring: number[] = [];
      for (let i = 0; i < s.ring.length; i += 2) {
        const x = s.ring[i], z = s.ring[i + 1];
        ring.push(p.x + x * c2 + z * s2, p.z - x * s2 + z * c2);
      }
      return { ring, y0: p.y + s.y0, y1: p.y + s.y1 };
    });
    const box = new THREE.Box3().setFromObject(b.group);
    p.radius = Math.max(20, box.getSize(new THREE.Vector3()).length() / 2);
    if (p.collide) { this.colliders.removeOwner(`lm:${p.l.id}`); p.collide = false; }
    p.built = b;
    this.group.add(b.group);
  }

  update(player: THREE.Vector3, time: number) {
    screenTime.value = time;
    // Night: windows, crowns and screens.
    const night = shared.uNight.value;
    for (const m of nightMats) m.emissiveIntensity = (m.userData.day ?? 0) + night * (m.userData.glow ?? 1);
    for (const m of latticeNight) m.emissiveIntensity = night * (m.userData.glow ?? 1);
    for (const m of (this.tkts?.userData.glowMats ?? []) as THREE.MeshStandardMaterial[]) m.emissiveIntensity = m.userData.day + night * m.userData.glow;
    const crown = nightMats.find((m) => m.userData.cycle);
    if (crown) crown.emissive.setHSL((time / 40) % 1, 0.75, 0.6);

    if (time - this.lastCheck < 0.5) return;
    this.lastCheck = time;
    for (const { s, x0, z0 } of this.signs.values()) s.update(player.x - x0, player.z - z0);
    for (const p of this.placed) {
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      // Only where the map is loaded (otherwise there's no ground, or the old building is still there).
      let ground = this.host.heightAt(p.x, p.z);
      if (ground === null || d > DRAW + p.l.height * 4) {
        if (p.built) p.built.group.visible = false;
        if (p.collide) { this.colliders.removeOwner(`lm:${p.l.id}`); p.collide = false; }
        continue;
      }
      // Bridges stand in the water: their y is the water surface.
      if (p.l.road) { const w = this.host.waterAt(p.x, p.z); if (!Number.isNaN(w)) ground = w; }
      const free = !p.claims.size || !!p.l.road;
      if (free) p.y = ground;
      if (p.dirty || !p.built) this.build(p);
      const b = p.built!;
      if (free && Math.abs(b.group.position.y - p.y) > 0.05) { b.group.position.y = p.y; b.group.updateMatrixWorld(true); this.rebuildSolidsY(p); }
      b.group.visible = true;
      const near = d < DETAIL + p.radius;
      for (const o of b.detail) o.visible = near;
      const want = d < COLLIDE + p.radius;
      if (want && !p.collide) {
        for (const s of p.solids) {
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (let i = 0; i < s.ring.length; i += 2) { minX = Math.min(minX, s.ring[i]); maxX = Math.max(maxX, s.ring[i]); minZ = Math.min(minZ, s.ring[i + 1]); maxZ = Math.max(maxZ, s.ring[i + 1]); }
          this.colliders.add({ minX, maxX, minZ, maxZ, maxY: s.y1, minY: s.y0 > p.y + 2 ? s.y0 : undefined, poly: s.ring }, `lm:${p.l.id}`);
        }
        p.collide = true;
      } else if (!want && p.collide) { this.colliders.removeOwner(`lm:${p.l.id}`); p.collide = false; }
    }
    if (this.tkts) {
      const g = this.host.heightAt(this.tkts.position.x, this.tkts.position.z);
      const d = Math.hypot(player.x - this.tkts.position.x, player.z - this.tkts.position.z);
      this.tkts.visible = g !== null && d < 1500;
      if (g !== null) this.tkts.position.y = g + 0.15;
    }
  }

  private rebuildSolidsY(p: Placed) {
    const b = p.built!;
    p.solids = b.solids.map((s, i) => ({ ring: p.solids[i]?.ring ?? s.ring, y0: p.y + s.y0, y1: p.y + s.y1 }));
    if (p.collide) { this.colliders.removeOwner(`lm:${p.l.id}`); p.collide = false; }
  }

  setSigns(on: boolean) {
    this.showSigns = on;
    this.group.parent?.traverse((o) => { if (o.name === 'street-signs') o.visible = on; });
  }

  // ---------------------------------------------------------------- look-at

  private lookKey = '';
  private lookSince = 0;
  private shown: LookHit | null = null;
  private lostAt = 0;

  /** The building in the middle of the view, after a short dwell (null when nothing / not yet). */
  look(cam: THREE.Camera, now: number, streetNear: (x: number, z: number) => string | null): LookHit | null {
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const hit = this.raycast(o, d, streetNear);
    const key = hit ? hit.title + hit.sub : '';
    if (key !== this.lookKey) { this.lookKey = key; this.lookSince = now; }
    if (hit && now - this.lookSince > 0.6) { this.shown = hit; this.lostAt = now; }
    else if (!hit && this.shown && now - this.lostAt > 1.5) this.shown = null;
    else if (hit && this.shown && this.shown.title === hit.title) this.lostAt = now;
    return this.shown;
  }

  private raycast(o: THREE.Vector3, d: THREE.Vector3, streetNear: (x: number, z: number) => string | null): LookHit | null {
    const cand = this.placed.filter((p) => p.built?.group.visible);
    const p = new THREE.Vector3();
    for (let t = 6; t < 3000; t += t < 400 ? 2.5 : 12) {
      p.copy(o).addScaledVector(d, t);
      for (const lm of cand) {
        if (Math.abs(p.x - lm.x) > lm.radius || Math.abs(p.z - lm.z) > lm.radius) continue;
        for (const s of lm.solids) if (p.y >= s.y0 && p.y <= s.y1 && inPoly(s.ring, p.x, p.z)) return { title: lm.l.name, sub: lm.l.addr, x: lm.x, z: lm.z };
      }
      if (t > 420) continue;
      for (const e of this.fpGrid.get(`${Math.floor(p.x / 40)},${Math.floor(p.z / 40)}`) ?? []) {
        if (p.y > e.f.top || p.y < e.f.base - 2 || !inPoly(e.ring, p.x, p.z)) continue;
        const cx = e.f.cx + (e.ring[0] - e.f.ring[0]), cz = e.f.cz + (e.ring[1] - e.f.ring[1]);
        // The wall you're looking at decides the street (a corner building has a number on one of two).
        const street = this.streetAlong(e.ring, p.x, p.z) ?? streetNear(cx, cz);
        const floors = Math.max(1, Math.round(e.f.h / 3.6));
        const addr = e.f.num && street ? `${e.f.num} ${street}` : null;
        const title = e.f.poi?.name ?? addr ?? (street ? `Building on ${street}` : 'Building');
        const sub = [e.f.poi && addr ? addr : null, `${floors} floor${floors === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
        return { title, sub, x: cx, z: cz };
      }
    }
    return null;
  }

  /** The named street running along the footprint wall nearest to (x, z). */
  private streetAlong(ring: number[], x: number, z: number): string | null {
    let wd = Infinity, dx = 1, dz = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const ax = ring[j], az = ring[j + 1], ex = ring[i] - ax, ez = ring[i + 1] - az, l2 = ex * ex + ez * ez;
      if (l2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d < wd) { wd = d; const l = Math.sqrt(l2); dx = ex / l; dz = ez / l; }
    }
    let best: string | null = null, bd = 45;
    const seen = new Set<Chunk>();
    for (const [ox, oz] of [[0, 0], [50, 0], [-50, 0], [0, 50], [0, -50]]) {
      const ch = this.host.chunkAt(x + ox, z + oz);
      if (!ch || seen.has(ch)) continue;
      seen.add(ch);
      for (const n of ch.names) for (let i = 0; i + 3 < n.pts.length; i += 2) {
        const ax = n.pts[i], az = n.pts[i + 1], ex = n.pts[i + 2] - ax, ez = n.pts[i + 3] - az, l2 = ex * ex + ez * ez;
        if (l2 < 1 || Math.abs((ex * dx + ez * dz) / Math.sqrt(l2)) < 0.8) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - n.w / 2;
        if (d < bd) { bd = d; best = n.name; }
      }
    }
    return best;
  }

  dispose() {
    for (const { s } of this.signs.values()) s.dispose();
    this.signs.clear();
    for (const p of this.placed) {
      if (p.collide) this.colliders.removeOwner(`lm:${p.l.id}`);
      if (p.built) dispose(p.built.group);
    }
    this.placed = [];
    this.group.removeFromParent();
  }
}

function inPoly(poly: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(r: number[]) { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1]); return a / 2; }
function ringCenter(r: number[]) { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return { x: x / (r.length / 2), z: z / (r.length / 2) }; }
function dispose(g: THREE.Object3D) {
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
}
