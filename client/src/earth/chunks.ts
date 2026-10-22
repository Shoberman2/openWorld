// Streams map tiles around the player: detailed chunks nearby (walkable, with traffic), lighter ones
// further out (buildings and painted ground), swapped as you move. Meshes come from the workers.
import * as THREE from 'three';
import type { Colliders } from '../player.ts';
import { radialTex } from '../city/streets.ts';
import { quality, shared } from '../engine.ts';
import type { GeoFrame } from './frame.ts';
import type { Pool } from './pool.ts';
import type { ChunkOut, FootprintData, MeshData } from './build/types.ts';
import { RoadNet, signalState } from './net.ts';
import { MATS, buildingMaterial, coniferTree, farMask, groundMaterial, ironMaterial, lampGeometries, lampPoolTexture, lollipopTree, palmTree, fanPalmTree, PROP_COLLIDE, propGeometries, propMat, shoreMaterial, treeMat, waterMaterial } from './style.ts';
import { ParkLayer, setParkViewer } from './parks.ts';
import { LandmarkLayer } from './landmarks/index.ts';

export const Z = 14;
/** Raised sidewalks stand this far above the road (matches the chunk builder). */
export const CURB = 0.14;

export interface Chunk {
  key: string; tx: number; ty: number; lod: 0 | 1;
  x0: number; z0: number; size: number;
  group: THREE.Group;
  n: number; heights: Float32Array;
  wetN: number; wet: Float32Array;
  footprints: FootprintData[];
  buildings: (THREE.Mesh | null)[];
  names: { name: string; pts: number[]; w: number }[];
  places: { name: string; cls: string; x: number; z: number; rank: number }[];
  signals: { phase: number }[];
  bulbs: THREE.InstancedMesh | null;
  bulbInfo: { sig: number; group: number }[];
  decks: { pts: number[]; ys: number[]; w: number }[];
  stats: ChunkOut['stats'];
  /** Raised sidewalk stretches (chunk-local, 6 per segment), bucketed by 25 m cell. */
  curbGrid?: Map<string, number[]>;
  /** Trees and street furniture, split by distance from the viewer. */
  scatters: Scatter[];
  /** Park and wood trees in tiers, boulders, park walls (parks.ts). */
  parks?: ParkLayer;
  /** Footprints by 40 m cell (chunk-local), for "which building am I standing at". */
  fpGrid?: Map<string, FootprintData[]>;
  /** Benches in world space [x, y, z, rotY, …], for robots taking a break. */
  benches: number[];
}

export interface BuildingHit {
  chunk: Chunk; fp: FootprintData;
  /** World-space footprint ring. */
  ring: number[];
  wall: number; // index of the nearest edge
  point: THREE.Vector3; // on the wall, at ground height
  out: THREE.Vector3; // outward normal of that wall
  dist: number;
}

/** Drop the CPU copy of each attribute once it's on the GPU (chunks are big; we never read them back). */
function freeOnUpload(g: THREE.BufferGeometry) {
  const free = function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; };
  for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(free);
  g.index?.onUpload(free);
  return g;
}

export function meshGeometry(m: MeshData, keepCpu = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  if (m.nrm) g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3, true));
  if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  if (m.col) g.setAttribute('color', new THREE.BufferAttribute(m.col, 3, true));
  if (m.fac) g.setAttribute('aFac', new THREE.BufferAttribute(m.fac, 4));
  if (m.seed) g.setAttribute('aSeed', new THREE.BufferAttribute(m.seed, 1));
  if (m.idx) g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.computeBoundingSphere();
  return keepCpu ? g : freeOnUpload(g);
}

const LAMP = new THREE.Color(1.0, 0.72, 0.42);
const RED = new THREE.Color(0xff3020), AMB = new THREE.Color(0xffb020), GRN = new THREE.Color(0x30ff7a), OFF = new THREE.Color(0x1a1a1a);

/**
 * Lamp light on the ground: multiplies what's there (dst * (1 + light)), so it lights the asphalt and
 * paint instead of laying a glow over them. Fades with distance, or it would brighten the haze too.
 */
function litPoolMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000, map: lampPoolTexture(), transparent: true, depthWrite: false, fog: true, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        gl_FragColor.rgb *= exp(-vFogDepth / 140.0);
      #endif`);
  };
  m.customProgramCacheKey = () => 'earth-lamp-pool';
  return m;
}

let shared3: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const lamp = lampGeometries();
  return {
    trees: [lollipopTree(), coniferTree(), palmTree(), fanPalmTree()], // ---- West Coast: 3 = fan palm
    treesFar: [lollipopTree(true), coniferTree(true), null, null],
    lampPole: lamp.pole, lampHead: lamp.head,
    poleMat: new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.5, roughness: 0.5 }),
    headMat: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffd9a0, emissiveIntensity: 0 }),
    poolMat: new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTex(), polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }),
    pool: new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2),
    litMat: litPoolMaterial(),
    litPool: new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
    props: propGeometries(),
    sigPole: new THREE.CylinderGeometry(0.1, 0.12, 4.4, 8).translate(0, 2.2, 0).toNonIndexed(),
    sigBox: new THREE.BoxGeometry(0.42, 1.25, 0.34).translate(0, 4.5, 0),
    sigMat: new THREE.MeshStandardMaterial({ color: 0x2b3530, roughness: 0.6, metalness: 0.3 }),
    bulb: new THREE.OctahedronGeometry(0.14, 1),
    bulbMat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    pillar: new THREE.CylinderGeometry(0.85, 1.05, 1, 10).translate(0, 0.5, 0),
  };
}

/** Trees (full leaf cards) within this distance of the viewer; cheaper trees beyond. */
const TREE_NEAR = 140;
function benchesOf(props: Float32Array, x0: number, z0: number) {
  const out: number[] = [];
  for (let i = 0; i < props.length; i += 5) if (props[i + 4] === 0) out.push(props[i] + x0, props[i + 1], props[i + 2] + z0, props[i + 3]);
  return out;
}

/** Street furniture is drawn within this distance. */
const PROP_NEAR = 220;

/**
 * Instances split by distance from the viewer into a detailed mesh near and a cheap one (or nothing)
 * beyond. Both keep the bounding sphere of all instances, so the chunk's frustum culling still works.
 */
class Scatter {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh | null;
  private allFar = false;
  constructor(private pos: Float32Array, private mats: Float32Array, private cols: Float32Array | null, nearGeo: THREE.BufferGeometry, farGeo: THREE.BufferGeometry | null, mat: THREE.Material, public radius: number, shadow: boolean) {
    const n = pos.length / 3;
    const make = (g: THREE.BufferGeometry) => {
      const im = new THREE.InstancedMesh(g, mat, n);
      (im.instanceMatrix.array as Float32Array).set(mats);
      if (cols) { im.instanceColor = new THREE.InstancedBufferAttribute(cols.slice(), 3); }
      im.computeBoundingSphere();
      im.castShadow = shadow; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return im;
    };
    this.near = make(nearGeo);
    this.far = farGeo ? make(farGeo) : null;
    this.near.count = 0;
  }
  /** Re-sort around the viewer (chunk-local coordinates). */
  split(x: number, y: number, z: number) {
    const r2 = this.radius * this.radius, P = this.pos, n = P.length / 3;
    const nm = this.near.instanceMatrix.array as Float32Array, fm = this.far?.instanceMatrix.array as Float32Array | undefined;
    const nc = this.near.instanceColor?.array as Float32Array | undefined, fc = this.far?.instanceColor?.array as Float32Array | undefined;
    let ni = 0, fi = 0;
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z;
      const m = this.mats.subarray(i * 16, i * 16 + 16), c = this.cols?.subarray(i * 3, i * 3 + 3);
      if (dx * dx + dy * dy + dz * dz < r2) { nm.set(m, ni * 16); if (nc && c) nc.set(c, ni * 3); ni++; }
      else if (fm) { fm.set(m, fi * 16); if (fc && c) fc.set(c, fi * 3); fi++; }
    }
    if (ni === 0 && this.allFar) return;
    this.allFar = ni === 0;
    this.near.count = ni;
    this.near.instanceMatrix.needsUpdate = true;
    if (this.near.instanceColor) this.near.instanceColor.needsUpdate = true;
    if (this.far) {
      this.far.count = fi;
      this.far.instanceMatrix.needsUpdate = true;
      if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
    }
  }
  add(g: THREE.Group) { g.add(this.near); if (this.far) g.add(this.far); }
}

export class Chunks {
  group = new THREE.Group();
  chunks = new Map<string, Chunk>();
  net = new RoadNet();
  /** Footprint keys (per chunk key) of buildings replaced by project HQs. */
  hidden = new Map<string, Set<number>>();
  private want = new Map<string, 0 | 1>();
  private loading = new Map<string, 0 | 1>();
  private decks: { ax: number; az: number; bx: number; bz: number; ya: number; yb: number; w: number; owner: string }[][] = [];
  private deckGrid = new Map<string, { ax: number; az: number; bx: number; bz: number; ya: number; yb: number; w: number; owner: string }[]>();
  private lastBulb = -1;
  private ready: { out: ChunkOut; done: () => void }[] = [];
  private disposed = false;
  /** Installs per frame (startup and teleports raise it while the screen is faded out). */
  installsPerFrame = 2;
  private maskDirty = true;
  /** Keep building vertices on the CPU (home chunks, until projects have picked their buildings). */
  keepCpu = false;
  onChange: (() => void) | null = null;
  /** Street-detail radius and the lighter far ring (Ultra draws more of the city in detail). */
  radius0 = quality.ultra ? 820 : 700;
  radius1 = quality.ultra ? 3900 : 3200;

  constructor(public frame: GeoFrame, public e0: number, private pool: Pool, private colliders: Colliders, private country: string) {
    shared3 ??= makeShared();
    const n = farMask.n;
    // One mask for the session (a long flight re-centers, and so rebuilds this, many times).
    if (!farMask.tex || farMask.tex.image.width !== n) {
      farMask.tex?.dispose();
      farMask.tex = new THREE.DataTexture(new Uint8Array(n * n * 4), n, n, THREE.RGBAFormat);
    }
    farMask.tex.magFilter = farMask.tex.minFilter = THREE.NearestFilter;
    farMask.uMask.value = farMask.tex;
    farMask.uN.value = n;
    this.landmarks = new LandmarkLayer(this, colliders, country);
    this.group.add(this.landmarks.group);
  }

  /** Hand-built landmarks, Times Square's screens, street signs, look-at (landmarks/). */
  landmarks: LandmarkLayer;

  key(tx: number, ty: number) { return `${tx},${ty}`; }

  chunkAt(x: number, z: number): Chunk | undefined {
    const t = this.frame.tileAt(Z, x, z);
    return this.chunks.get(this.key(t.tx, t.ty));
  }

  /** Ground height (water beds dipped) or null if nothing is loaded there. */
  heightAt(x: number, z: number): number | null {
    const c = this.chunkAt(x, z);
    if (!c) return null;
    const N = c.n, cell = c.size / N;
    const gx = Math.min(N - 1e-6, Math.max(0, (x - c.x0) / cell)), gz = Math.min(N - 1e-6, Math.max(0, (z - c.z0) / cell));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const r = N + 1, g = c.heights;
    const a = g[j * r + i], b = g[j * r + i + 1], cc = g[(j + 1) * r + i], d = g[(j + 1) * r + i + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (cc - a) * fz : d + (cc - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Water surface y, or NaN when dry (or unknown). */
  waterAt(x: number, z: number) {
    const c = this.chunkAt(x, z);
    if (!c) return NaN;
    const i = Math.floor(((x - c.x0) / c.size) * c.wetN), j = Math.floor(((z - c.z0) / c.size) * c.wetN);
    if (i < 0 || j < 0 || i >= c.wetN || j >= c.wetN) return NaN;
    return c.wet[j * c.wetN + i];
  }

  /** How far a raised sidewalk lifts the ground at (x, z) (0 off the sidewalks). */
  curbAt(x: number, z: number) {
    const c = this.chunkAt(x, z);
    if (!c?.curbGrid) return 0;
    const lx = x - c.x0, lz = z - c.z0;
    const l = c.curbGrid.get(`${Math.floor(lx / 25)},${Math.floor(lz / 25)}`);
    if (!l) return 0;
    for (let i = 0; i < l.length; i += 6) {
      const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? ((lx - ax) * ex + (lz - az) * ez) / l2 : 0;
      if (t < 0 || t > 1) continue;
      const d = Math.hypot(lx - (ax + ex * t), lz - (az + ez * t));
      if (d >= l[i + 4] && d <= l[i + 5]) return CURB;
    }
    return 0;
  }

  /** Highest bridge deck under (x,z) at or below y + step. */
  deckAt(x: number, z: number, y: number, step = 0.7) {
    let best = -Infinity;
    const l = this.deckGrid.get(`${Math.floor(x / 25)},${Math.floor(z / 25)}`);
    if (!l) return best;
    for (const s of l) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2)) : 0;
      const d = Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t));
      if (d > s.w / 2 + 0.2) continue;
      const dy = s.ya + (s.yb - s.ya) * t - 0.08;
      if (dy <= y + step && dy > best) best = dy;
    }
    return best;
  }

  /** Bring in the detailed chunks around (x, z) and wait for them (startup, teleports). */
  async loadAround(x: number, z: number, r: number, say?: (done: number, total: number) => void) {
    const s = this.frame.tileSize(Z);
    const c = this.frame.tileAt(Z, x, z);
    const R = Math.ceil(r / s) + 1;
    const jobs: Promise<void>[] = [];
    let done = 0;
    const need: [number, number][] = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const tx = c.tx + dx, ty = c.ty + dy;
      const rect = this.frame.tileRect(Z, tx, ty);
      if (this.distRect(x, z, rect) > r) continue;
      if (this.chunks.get(this.key(tx, ty))?.lod === 0) continue;
      need.push([tx, ty]);
    }
    for (const [tx, ty] of need) {
      this.want.set(this.key(tx, ty), 0);
      jobs.push(this.request(tx, ty, 0, () => 0).then(() => { done++; say?.(done, need.length); }));
    }
    // Nothing is being drawn meanwhile: install as soon as results land.
    const iv = setInterval(() => this.pump({ x, z }, 99), 30);
    try { await Promise.all(jobs); } finally { clearInterval(iv); }
  }

  private distRect(x: number, z: number, r: { x0: number; z0: number; size: number }) {
    const dx = Math.max(r.x0 - x, 0, x - (r.x0 + r.size)), dz = Math.max(r.z0 - z, 0, z - (r.z0 + r.size));
    return Math.hypot(dx, dz);
  }

  private request(tx: number, ty: number, lod: 0 | 1, prio: () => number) {
    const key = this.key(tx, ty);
    this.loading.set(key, lod);
    const rc = this.frame.tileRect(Z, tx, ty);
    const lat = this.frame.toGeo(rc.x0 + rc.size / 2, rc.z0 + rc.size / 2).lat;
    return this.pool.chunk({ z: Z, tx, ty, lod, k: this.frame.k, e0: this.e0, lat, country: this.country }, prio, () => this.want.get(key) === lod)
      .then((out) => {
        if (this.disposed) { out.tex?.close(); return; }
        if (this.want.get(key) !== lod) { if (this.loading.get(key) === lod) this.loading.delete(key); out.tex?.close(); return; }
        // Installed a couple per frame (in tick) so a burst of arrivals doesn't stall rendering.
        return new Promise<void>((done) => this.ready.push({ out, done }));
      })
      .catch((e: Error) => {
        if (this.loading.get(key) === lod) this.loading.delete(key);
        if (e.message !== 'cancelled') console.warn('chunk failed', key, e.message);
      });
  }

  /**
   * Decide what should be loaded for a player at p (with `agl` meters of altitude). `lead` is where
   * they'll be in a few seconds: the light ring centers there, so a fast flight streams ahead of
   * itself instead of behind; `speed` (m/s) thins it out when tiles can't keep up anyway.
   */
  update(p: THREE.Vector3, agl: number, time: number, lead: { x: number; z: number } = p, speed = 0) {
    const s = this.frame.tileSize(Z);
    const high = Math.max(0, agl);
    const r0 = this.radius0 + Math.min(high, 500) * 0.6;
    // Way up (or going like a rocket) the satellite horizon carries the view: fewer, nearer light chunks,
    // and none at all above ~6 km, where a building is a pixel.
    const fast = THREE.MathUtils.clamp((speed - 150) / 600, 0, 0.6);
    const r1 = high > 6000 ? 0 : (this.radius1 + Math.min(high, 1500) * 1.4) * (1 - fast) * (high > 3000 ? 0.6 : 1);
    const c = this.frame.tileAt(Z, (p.x + lead.x) / 2, (p.z + lead.z) / 2);
    const R = Math.ceil((r1 + Math.hypot(lead.x - p.x, lead.z - p.z)) / s) + 1;
    const next = new Map<string, 0 | 1>();
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const tx = c.tx + dx, ty = c.ty + dy;
      const key = this.key(tx, ty);
      const rect = this.frame.tileRect(Z, tx, ty);
      const d = this.distRect(p.x, p.z, rect);
      const dl = Math.min(d, this.distRect(lead.x, lead.z, rect));
      const cur = this.chunks.get(key);
      // Flying high: no need for street detail far below.
      const lod0 = high < 900 && (d < r0 || (cur?.lod === 0 && d < r0 + 400));
      if (lod0) next.set(key, 0);
      else if (dl < r1 || (cur && dl < r1 + 700)) next.set(key, 1);
    }
    this.want = next;
    for (const [key, lod] of next) {
      const cur = this.chunks.get(key);
      if (cur?.lod === lod || this.loading.get(key) === lod) continue;
      const [tx, ty] = key.split(',').map(Number);
      const rect = this.frame.tileRect(Z, tx, ty);
      // Nearest to where you're going first (the lead point), detail before scenery.
      this.request(tx, ty, lod, () => Math.min(this.distRect(p.x, p.z, rect), this.distRect(lead.x, lead.z, rect) * 0.8) + (lod === 1 ? 1500 : 0) + (this.chunks.has(key) ? 800 : 0));
    }
    for (const [key, ch] of this.chunks) if (!next.has(key)) this.remove(ch);
    this.pump(p);
    this.splitScatters(p);
    this.landmarks.update(p, time);
    this.tick(time);
  }

  get pending() { return this.loading.size; }

  private splitAt = new THREE.Vector3(1e9, 0, 0);
  private scattersDirty = true;
  /** Every 8 m of movement (or when chunks arrive), re-split trees and furniture around the viewer. */
  private splitScatters(p: THREE.Vector3) {
    if (!this.scattersDirty && this.splitAt.distanceToSquared(p) < 64) return;
    this.splitAt.copy(p);
    this.scattersDirty = false;
    setParkViewer(p);
    for (const ch of this.chunks.values()) {
      ch.parks?.split(p.x - ch.x0, p.y, p.z - ch.z0);
      if (!ch.scatters.length) continue;
      const near = this.distRect(p.x, p.z, ch) < Math.max(TREE_NEAR, PROP_NEAR) + 20;
      for (const s of ch.scatters) s.split(near ? p.x - ch.x0 : 1e9, p.y, near ? p.z - ch.z0 : 1e9);
    }
  }

  private install(o: ChunkOut) {
    const key = this.key(o.tx, o.ty);
    const old = this.chunks.get(key);
    const rect = this.frame.tileRect(o.z, o.tx, o.ty);
    const group = new THREE.Group();
    group.position.set(rect.x0, 0, rect.z0);
    group.name = `chunk:${key}:${o.lod}`;
    const sh = shared3!;

    let tex: THREE.Texture | null = null;
    if (o.tex) {
      tex = new THREE.Texture(o.tex as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
    const gmat = groundMaterial(tex);
    gmat.userData.perChunk = true;
    const ground = new THREE.Mesh(meshGeometry(o.ground), gmat);
    ground.receiveShadow = true;
    group.add(ground);
    if (o.water) {
      const w = new THREE.Mesh(meshGeometry(o.water), waterMaterial());
      w.receiveShadow = true;
      group.add(w);
    }
    if (o.shore) {
      const g = meshGeometry(o.shore);
      g.setAttribute('aShore', g.getAttribute('uv'));
      g.setAttribute('aStr', g.getAttribute('color'));
      const m = new THREE.Mesh(g, shoreMaterial());
      m.receiveShadow = true;
      m.renderOrder = 2;
      group.add(m);
    }
    const buildings = o.buildings.map((bm) => {
      if (!bm) return null;
      const m = new THREE.Mesh(meshGeometry(bm, this.keepCpu), buildingMaterial());
      m.castShadow = o.lod === 0;
      m.receiveShadow = true;
      group.add(m);
      return m;
    });
    if (o.iron) {
      const m = new THREE.Mesh(meshGeometry(o.iron), ironMaterial());
      m.receiveShadow = true;
      group.add(m);
    }
    const hide = this.hidden.get(key);
    if (hide) for (const f of o.footprints) if (hide.has(f.key) && buildings[f.cell]) collapse(buildings[f.cell]!, f.start, f.count);
    for (const [m, mat] of [[o.walk, MATS.walk], [o.road, MATS.road], [o.paintW, MATS.paintW], [o.paintY, MATS.paintY], [o.deck, MATS.deck]] as const) {
      if (!m) continue;
      const mesh = new THREE.Mesh(meshGeometry(m), mat);
      mesh.receiveShadow = true;
      if (mat === MATS.deck) mesh.castShadow = true;
      group.add(mesh);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    // Trees by kind: full leaf cards near the viewer, a light version further out.
    const scatters: Scatter[] = [];
    for (let kind = 0; kind < sh.trees.length; kind++) {
      const idx: number[] = [];
      for (let i = 0; i < o.trees.length; i += 6) if (o.trees[i + 5] === kind) idx.push(i);
      if (!idx.length) continue;
      const pos = new Float32Array(idx.length * 3), mats = new Float32Array(idx.length * 16), cols = new Float32Array(idx.length * 3);
      idx.forEach((i, n) => {
        const s = o.trees[i + 4];
        q.setFromAxisAngle(up, o.trees[i + 3]);
        m4.compose(v.set(o.trees[i], o.trees[i + 1] - 0.1, o.trees[i + 2]), q, sc.set(s, s * (0.9 + (n % 5) * 0.05), s));
        m4.toArray(mats, n * 16);
        pos.set([o.trees[i], o.trees[i + 1] + 4, o.trees[i + 2]], n * 3);
        const h = (n * 0.137) % 1;
        tint.setRGB(0.88 + h * 0.2, 0.92 + ((n * 0.31) % 1) * 0.16, 0.85 + h * 0.15).toArray(cols, n * 3);
      });
      const far = sh.treesFar[kind];
      const sct = new Scatter(pos, mats, cols, sh.trees[kind], far, treeMat, far ? TREE_NEAR : 1e9, o.lod === 0);
      sct.add(group);
      scatters.push(sct);
    }
    // Street lights.
    const nl = o.lamps.length / 4;
    if (nl) {
      const poles = new THREE.InstancedMesh(sh.lampPole, sh.poleMat, nl), heads = new THREE.InstancedMesh(sh.lampHead, sh.headMat, nl);
      const pools = new THREE.InstancedMesh(sh.pool, sh.poolMat, nl), lit = new THREE.InstancedMesh(sh.litPool, sh.litMat, nl);
      for (let i = 0; i < nl; i++) {
        const x = o.lamps[i * 4], y = o.lamps[i * 4 + 1], zz = o.lamps[i * 4 + 2], r = o.lamps[i * 4 + 3];
        m4.makeRotationY(r).setPosition(x, y, zz);
        poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
        m4.makeTranslation(x + Math.sin(r) * 2.1, y + 0.32, zz + Math.cos(r) * 2.1);
        pools.setMatrixAt(i, m4); lit.setMatrixAt(i, m4);
      }
      poles.castShadow = true;
      pools.renderOrder = 1; lit.renderOrder = 1;
      for (const im of [poles, heads, pools, lit]) { im.computeBoundingSphere(); group.add(im); }
    }
    // Traffic signals.
    let bulbs: THREE.InstancedMesh | null = null;
    const bulbInfo: { sig: number; group: number }[] = [];
    const np = o.poles.length / 6;
    if (np) {
      const pole = new THREE.InstancedMesh(sh.sigPole, sh.sigMat, np), box = new THREE.InstancedMesh(sh.sigBox, sh.sigMat, np);
      bulbs = new THREE.InstancedMesh(sh.bulb, sh.bulbMat, np * 3);
      for (let i = 0; i < np; i++) {
        const x = o.poles[i * 6], y = o.poles[i * 6 + 1], zz = o.poles[i * 6 + 2], r = o.poles[i * 6 + 3];
        m4.makeRotationY(r).setPosition(x, y, zz);
        pole.setMatrixAt(i, m4); box.setMatrixAt(i, m4);
        const fx = Math.sin(r), fz = Math.cos(r);
        for (let k = 0; k < 3; k++) {
          bulbs.setMatrixAt(i * 3 + k, m4.makeTranslation(x + fx * 0.19, y + 4.92 - k * 0.4, zz + fz * 0.19));
          bulbs.setColorAt(i * 3 + k, OFF);
        }
        bulbInfo.push({ sig: o.poles[i * 6 + 4], group: o.poles[i * 6 + 5] });
      }
      pole.castShadow = true;
      for (const im of [pole, box, bulbs]) { im.computeBoundingSphere(); group.add(im); }
    }
    // Bridge pillars.
    const npl = o.pillars.length / 4;
    if (npl) {
      const im = new THREE.InstancedMesh(sh.pillar, MATS.deck, npl);
      for (let i = 0; i < npl; i++) im.setMatrixAt(i, m4.makeScale(1, o.pillars[i * 4 + 3], 1).setPosition(o.pillars[i * 4], o.pillars[i * 4 + 1], o.pillars[i * 4 + 2]));
      im.castShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }

    // Street furniture, one instanced mesh per kind, drawn near the viewer only.
    for (let kind = 0; kind < sh.props.length; kind++) {
      const idx: number[] = [];
      for (let i = 0; i < o.props.length; i += 5) if (o.props[i + 4] === kind) idx.push(i);
      if (!idx.length) continue;
      const pos = new Float32Array(idx.length * 3), mats = new Float32Array(idx.length * 16);
      idx.forEach((i, n) => {
        m4.makeRotationY(o.props[i + 3]).setPosition(o.props[i], o.props[i + 1], o.props[i + 2]).toArray(mats, n * 16);
        pos.set([o.props[i], o.props[i + 1], o.props[i + 2]], n * 3);
      });
      const sct = new Scatter(pos, mats, null, sh.props[kind], null, propMat, PROP_NEAR, kind !== 3);
      sct.add(group);
      scatters.push(sct);
    }

    const parks = o.parks ? new ParkLayer(o.parks, group, o.lod) : undefined;
    const ch: Chunk = {
      key, tx: o.tx, ty: o.ty, lod: o.lod, x0: rect.x0, z0: rect.z0, size: rect.size, group,
      n: o.n, heights: o.heights, wetN: o.wetN, wet: o.wet, footprints: o.footprints, buildings,
      names: o.names.map((nm) => ({ ...nm, pts: nm.pts.map((val, i) => val + (i % 2 ? rect.z0 : rect.x0)) })),
      places: o.places.map((p) => ({ ...p, x: p.x + rect.x0, z: p.z + rect.z0 })),
      signals: o.signals.map((sg) => ({ phase: sg.phase })),
      bulbs, bulbInfo, scatters, parks,
      benches: benchesOf(o.props, rect.x0, rect.z0),
      decks: o.edges.filter((e) => e.bridge).map((e) => ({ pts: e.pts.map((val, i) => val + (i % 2 ? rect.z0 : rect.x0)), ys: e.ys, w: e.width })),
      stats: o.stats,
    };
    if (old) this.remove(old, true);
    this.chunks.set(key, ch);
    this.landmarks.install(o, ch);
    // Static: compute matrices once instead of every frame.
    group.traverse((obj) => { obj.matrixAutoUpdate = false; obj.updateMatrix(); });
    this.group.add(group);

    // Physics and traffic for detailed chunks.
    if (o.lod === 0) {
      for (const f of o.footprints) {
        const ring = f.ring.map((val, i) => val + (i % 2 ? rect.z0 : rect.x0));
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < ring.length; i += 2) { minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]); minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]); }
        this.colliders.add({ minX, maxX, minZ, maxZ, maxY: f.top, poly: ring }, key);
      }
      for (let i = 0; i < o.trees.length; i += 6) {
        const x = o.trees[i] + rect.x0, zz = o.trees[i + 2] + rect.z0;
        this.colliders.add({ minX: x - 0.3, maxX: x + 0.3, minZ: zz - 0.3, maxZ: zz + 0.3, maxY: o.trees[i + 1] + 2.5 }, key);
      }
      parks?.colliders(rect.x0, rect.z0, (b) => this.colliders.add(b, key));
      for (let i = 0; i < o.lamps.length; i += 4) {
        const x = o.lamps[i] + rect.x0, zz = o.lamps[i + 2] + rect.z0;
        this.colliders.add({ minX: x - 0.18, maxX: x + 0.18, minZ: zz - 0.18, maxZ: zz + 0.18, maxY: o.lamps[i + 1] + 7.5 }, key);
      }
      for (let i = 0; i < o.props.length; i += 5) {
        const [r, ht] = PROP_COLLIDE[o.props[i + 4]] ?? [0.28, 0.9];
        if (!r) continue;
        const x = o.props[i] + rect.x0, zz = o.props[i + 2] + rect.z0;
        this.colliders.add({ minX: x - r, maxX: x + r, minZ: zz - r, maxZ: zz + r, maxY: o.props[i + 1] + ht }, key);
      }
      if (o.curbs.length) {
        ch.curbGrid = new Map();
        for (let i = 0; i < o.curbs.length; i += 6) {
          const ax = o.curbs[i], az = o.curbs[i + 1], bx = o.curbs[i + 2], bz = o.curbs[i + 3], w = o.curbs[i + 5];
          for (let gx = Math.floor((Math.min(ax, bx) - w) / 25); gx <= Math.floor((Math.max(ax, bx) + w) / 25); gx++)
            for (let gz = Math.floor((Math.min(az, bz) - w) / 25); gz <= Math.floor((Math.max(az, bz) + w) / 25); gz++) {
              const k = `${gx},${gz}`;
              let l = ch.curbGrid.get(k);
              if (!l) ch.curbGrid.set(k, (l = []));
              for (let j = 0; j < 6; j++) l.push(o.curbs[i + j]);
            }
        }
      }
      for (let i = 0; i < o.pillars.length; i += 4) {
        const x = o.pillars[i] + rect.x0, zz = o.pillars[i + 2] + rect.z0;
        this.colliders.add({ minX: x - 1, maxX: x + 1, minZ: zz - 1, maxZ: zz + 1, maxY: o.pillars[i + 1] + o.pillars[i + 3] }, key);
      }
      this.net.add(key, o.edges, rect.x0, rect.z0, o.signals.map((sg) => ({ ...sg })));
      for (const d of ch.decks) for (let i = 0; i + 3 < d.pts.length; i += 2) {
        const seg = { ax: d.pts[i], az: d.pts[i + 1], bx: d.pts[i + 2], bz: d.pts[i + 3], ya: d.ys[i / 2], yb: d.ys[i / 2 + 1], w: d.w, owner: key };
        for (let gx = Math.floor((Math.min(seg.ax, seg.bx) - seg.w) / 25); gx <= Math.floor((Math.max(seg.ax, seg.bx) + seg.w) / 25); gx++)
          for (let gz = Math.floor((Math.min(seg.az, seg.bz) - seg.w) / 25); gz <= Math.floor((Math.max(seg.az, seg.bz) + seg.w) / 25); gz++) {
            const k = `${gx},${gz}`;
            let l = this.deckGrid.get(k);
            if (!l) this.deckGrid.set(k, (l = []));
            l.push(seg);
          }
      }
    }
    this.maskDirty = true;
    this.scattersDirty = true;
    this.onChange?.();
  }

  private remove(ch: Chunk, replacing = false) {
    this.group.remove(ch.group);
    this.landmarks.remove(ch.key);
    ch.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m instanceof THREE.InstancedMesh) m.dispose();
      else m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.userData.perChunk) { mat.map?.dispose(); mat.dispose(); }
    });
    if (ch.lod === 0 && !this.ghost) {
      this.colliders.removeOwner(ch.key);
      this.net.remove(ch.key);
      for (const [k, l] of this.deckGrid) {
        const kept = l.filter((s) => s.owner !== ch.key);
        if (kept.length) this.deckGrid.set(k, kept); else this.deckGrid.delete(k);
      }
    }
    if (!replacing) this.chunks.delete(ch.key);
    this.maskDirty = true;
  }

  /** The building whose wall is nearest to (x, z), within maxDist meters (detailed chunks only). */
  buildingNear(x: number, z: number, maxDist = 2): BuildingHit | null {
    const ch = this.chunkAt(x, z);
    if (!ch || ch.lod !== 0) return null;
    if (!ch.fpGrid) {
      ch.fpGrid = new Map();
      for (const f of ch.footprints) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let q = 0; q < f.ring.length; q += 2) { x0 = Math.min(x0, f.ring[q]); x1 = Math.max(x1, f.ring[q]); z0 = Math.min(z0, f.ring[q + 1]); z1 = Math.max(z1, f.ring[q + 1]); }
        for (let i = Math.floor((x0 - 3) / 40); i <= Math.floor((x1 + 3) / 40); i++) for (let j = Math.floor((z0 - 3) / 40); j <= Math.floor((z1 + 3) / 40); j++) {
          const k = `${i},${j}`; let l = ch.fpGrid.get(k); if (!l) ch.fpGrid.set(k, (l = [])); l.push(f);
        }
      }
    }
    const lx = x - ch.x0, lz = z - ch.z0;
    let best: BuildingHit | null = null;
    for (const f of ch.fpGrid.get(`${Math.floor(lx / 40)},${Math.floor(lz / 40)}`) ?? []) {
      const r = f.ring, n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], ex = r[j * 2] - ax, ez = r[j * 2 + 1] - az, l2 = ex * ex + ez * ez;
        if (l2 < 4) continue; // too short to have a door
        const t = Math.max(0.1, Math.min(0.9, ((lx - ax) * ex + (lz - az) * ez) / l2));
        const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(lx - px, lz - pz);
        if (d > maxDist || (best && d >= best.dist)) continue;
        const len = Math.sqrt(l2);
        best = {
          chunk: ch, fp: f, ring: r.map((v, k) => v + (k % 2 ? ch.z0 : ch.x0)), wall: i,
          point: new THREE.Vector3(px + ch.x0, f.base, pz + ch.z0), out: new THREE.Vector3(-ez / len, 0, ex / len), dist: d,
        };
      }
    }
    return best;
  }

  /** Hide a building (a project moved in and brings its own). */
  hide(chunkKey: string, fpKey: number) {
    let s = this.hidden.get(chunkKey);
    if (!s) this.hidden.set(chunkKey, (s = new Set()));
    s.add(fpKey);
    const ch = this.chunks.get(chunkKey);
    const f = ch?.footprints.find((fp) => fp.key === fpKey);
    const m = f ? ch?.buildings[f.cell] : null;
    if (m && f && (m.geometry.attributes.position as THREE.BufferAttribute).array) collapse(m, f.start, f.count);
  }

  /** Install finished chunks: detailed ones first, nearest first. */
  pump(p?: { x: number; z: number }, max = this.installsPerFrame) {
    if (!this.ready.length) return;
    if (p) this.ready.sort((a, b) => (a.out.lod - b.out.lod) * 1e7 + this.distTile(a.out, p) - this.distTile(b.out, p));
    for (let n = 0; n < max && this.ready.length; n++) {
      const { out, done } = this.ready.shift()!;
      const key = this.key(out.tx, out.ty);
      if (this.loading.get(key) === out.lod) this.loading.delete(key);
      if (this.want.get(key) === out.lod) this.install(out); else out.tex?.close();
      done();
    }
  }

  private distTile(o: ChunkOut, p: { x: number; z: number }) {
    return this.distRect(p.x, p.z, this.frame.tileRect(Z, o.tx, o.ty));
  }

  private tick(time: number) {
    const sh = shared3!;
    const n = shared.uNight.value;
    sh.headMat.emissiveIntensity = n * 3;
    sh.poolMat.opacity = n * 0.3;
    sh.litMat.color.copy(LAMP).multiplyScalar(n * 3);
    const tick = Math.floor(time * 4);
    if (tick !== this.lastBulb) {
      this.lastBulb = tick;
      for (const ch of this.chunks.values()) {
        if (!ch.bulbs) continue;
        ch.bulbInfo.forEach((b, i) => {
          const st = signalState(ch.signals[b.sig]?.phase ?? 0, b.group, time);
          ch.bulbs!.setColorAt(i * 3, st === 'r' ? RED : OFF);
          ch.bulbs!.setColorAt(i * 3 + 1, st === 'y' ? AMB : OFF);
          ch.bulbs!.setColorAt(i * 3 + 2, st === 'g' ? GRN : OFF);
        });
        if (ch.bulbs.instanceColor) ch.bulbs.instanceColor.needsUpdate = true;
      }
    }
    if (this.maskDirty) this.updateMask();
  }

  /** Tell the far terrain which tiles are covered by chunks (it discards fragments there). */
  updateMask(center?: { tx: number; ty: number }) {
    this.maskDirty = false;
    const n = farMask.n, data = farMask.tex!.image.data as Uint8Array;
    if (center) farMask.base = { tx: center.tx - n / 2, ty: center.ty - n / 2 };
    const b = farMask.base;
    data.fill(0);
    for (const ch of this.chunks.values()) {
      const i = ch.tx - b.tx, j = ch.ty - b.ty;
      if (i >= 0 && j >= 0 && i < n && j < n) data[(j * n + i) * 4] = 255;
    }
    farMask.tex!.needsUpdate = true;
    const r = this.frame.tileRect(Z, b.tx, b.ty);
    farMask.uOrigin.value.set(r.x0, r.z0);
    farMask.uCell.value = r.size;
  }

  /**
   * Stop being the world and become scenery: after a rebase the old chunks stay on screen (moved into
   * the new frame by the caller) until the new ones arrive, but they no longer collide, route traffic
   * or stream. Their tile keys are shared with the new world's, so removing them later must not touch
   * colliders or the road network.
   */
  private ghost = false;
  freeze() {
    for (const ch of this.chunks.values()) if (ch.lod === 0) { this.colliders.removeOwner(ch.key); this.net.remove(ch.key); }
    this.ghost = true;
    this.disposed = true;
    this.want.clear();
    for (const r of this.ready) { r.out.tex?.close(); r.done(); }
    this.ready = [];
  }

  /** Drop ghost chunks the new world has covered (any detail level), keeping the rest as stand-ins. */
  pruneUnder(cover: (key: string) => boolean) {
    for (const ch of [...this.chunks.values()]) if (cover(ch.key)) this.remove(ch);
  }

  dispose() {
    this.disposed = true;
    for (const ch of [...this.chunks.values()]) this.remove(ch);
    this.landmarks.dispose();
    this.want.clear();
    for (const r of this.ready) { r.out.tex?.close(); r.done(); }
    this.ready = [];
  }
}

/** Make a range of vertices degenerate (all at the first one) so those triangles vanish. */
function collapse(mesh: THREE.Mesh, start: number, count: number) {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const x = pos.getX(start), y = pos.getY(start) - 50, z = pos.getZ(start);
  for (let i = start; i < start + count; i++) pos.setXYZ(i, x, y, z);
  pos.needsUpdate = true;
}
