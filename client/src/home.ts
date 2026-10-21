// Your home: an apartment high up in a real building on Central Park South, looking north over the
// park. Outside, the building gets a New York doorman canopy (and a doorman); inside is a lived-in
// apartment — living room, bedroom, kitchen, a desk whose monitor shows your morning briefing — and the
// windows show the real city, captured live from that height with a cube camera.
import * as THREE from 'three';
import type { AgentInfo, Briefing } from '../../shared/types.ts';
import { drawBriefingMonitor } from './ui/briefing.ts';
import type { EarthApi } from './earth/index.ts';
import type { BuildingHit, Chunk } from './earth/chunks.ts';
import type { FootprintData } from './earth/build/types.ts';
import type { GenericInterior, RoomInteraction } from './rooms/index.ts';
import { Colliders, type PlayerWorld, type MoveMode } from './player.ts';
import { makeNpc, type Character } from './characters.ts';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DayNight } from './engine.ts';
import type { Robot } from './robot.ts';

/** 150 Central Park South (Hampshire House), between 6th and 7th Avenues, facing the park. */
export const HOME = { lat: 40.76612, lon: -73.9779, name: 'Home', address: '150 Central Park South' };
/** On the Central Park South sidewalk in front of it: where fast travel drops you. */
const HOME_STREET = { lat: 40.76652, lon: -73.97796 };

interface Resolved {
  fp: FootprintData; chunk: string; ring: number[]; wall: number;
  door: THREE.Vector3; out: THREE.Vector3; approach: THREE.Vector3;
  /** Where HOME was in world coordinates when this was resolved (the frame can rebase or shift). */
  at: { x: number; z: number };
  floor: number;
  /** Roof of the tower the apartment is in (the door may be on a lower wing). */
  top: number;
  towerKey: number;
  /** The tower's north face (ground level), where the apartment's windows look out. */
  view: { x: number; z: number; y: number; out: THREE.Vector3 };
}

interface Hooks {
  interactions: { add(i: { id: string; position: THREE.Vector3; radius: number; label: string; sub?: string; action: () => void }): void; remove(id: string): void };
  labels: { set(id: string, pos: THREE.Vector3, html: string, opts?: { cls?: string; maxDist?: number; minDist?: number }): void; remove(id: string): void };
  enter(): void;
}

// ------------------------------------------------------------------ outside

export class HomeBase {
  readonly group = new THREE.Group();
  private res: Resolved | null = null;
  private timer = 0;
  private doorman: Character | null = null;

  constructor(private earth: EarthApi, private taken: () => Set<number>) {
    this.group.name = 'home';
  }

  get resolved() { return this.res; }
  get geo() { return { lat: HOME.lat, lon: HOME.lon }; }
  get street() { return HOME_STREET; }

  /** The BuildingHit the generic interior flow uses for entering and leaving. */
  hit(): BuildingHit | null {
    const r = this.res;
    if (!r) return null;
    // Only the footprint, wall, door point and normal are read on the way in and out.
    return { chunk: { key: r.chunk } as unknown as Chunk, fp: r.fp, ring: r.ring, wall: r.wall, point: r.door.clone(), out: r.out.clone(), dist: 0 };
  }

  update(dt: number, player: THREE.Vector3, hooks: Hooks | null) {
    if (this.doorman && this.res && this.res.door.distanceTo(player) < 90) this.doorman.mixer.update(dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const L = this.earth.frame.toLocal(HOME.lat, HOME.lon);
    if (this.res && Math.hypot(this.res.at.x - L.x, this.res.at.z - L.z) > 0.5) this.clear(hooks);
    if (!this.res && Math.hypot(player.x - L.x, player.z - L.z) < 1500) this.resolve(L);
    if (!this.res || !hooks) return;
    const r = this.res;
    hooks.interactions.add({ id: 'door:home', position: r.approach, radius: 3.2, label: 'Go home', sub: `${HOME.address} · floor ${r.floor}`, action: hooks.enter });
    hooks.labels.set('home-door', r.door.clone().add(new THREE.Vector3(0, 4.6, 0)).addScaledVector(r.out, 3.5), `Home<small>${HOME.address}</small>`, { maxDist: 260, minDist: 4 });
    hooks.labels.set('home-top', new THREE.Vector3(r.door.x, r.top + 12, r.door.z), 'Home', { maxDist: 3000, minDist: 200 });
  }

  /** Forget the building (moved far away, or the world rebased): it's found again when you're back. */
  clear(hooks: Hooks | null) {
    this.res = null;
    hooks?.interactions.remove('door:home');
    hooks?.labels.remove('home-door');
    hooks?.labels.remove('home-top');
    for (const c of [...this.group.children]) c.removeFromParent();
    this.doorman = null;
  }

  /** Try now (after fast travel), instead of waiting for the next tick. */
  resolveNow() {
    this.timer = 0;
    const L = this.earth.frame.toLocal(HOME.lat, HOME.lon);
    if (this.res && Math.hypot(this.res.at.x - L.x, this.res.at.z - L.z) > 0.5) this.clear(null);
    if (!this.res) this.resolve(L);
    return this.res;
  }

  private resolve(L: { x: number; z: number }) {
    const taken = this.taken();
    const near = this.earth.footprintsNear(L.x, L.z, 140);
    const inside = (ring: number[], x: number, z: number) => {
      let c = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) if ((ring[i + 1] > z) !== (ring[j + 1] > z) && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) c = !c;
      return c;
    };
    const solid = (x: number, z: number) => near.some((n) => inside(n.ring, x, z));
    // A real residential tower right at the address (not a project HQ, not a hotel), and its street
    // door: the open wall of the complex that faces the park (north), nearest the address.
    const ok = near.filter((n) => !taken.has(n.fp.key) && n.fp.h >= 8 && !(n.fp.poi && /hotel|plaza/i.test(`${n.fp.poi.name} ${n.fp.poi.cls} ${n.fp.poi.sub}`)));
    const tower = ok.filter((n) => n.fp.h >= 40 && Math.hypot(n.cx - L.x, n.cz - L.z) < 50).sort((a, b) => b.fp.h - a.fp.h)[0];
    if (!tower) return;
    let best: { c: typeof ok[number]; wall: number; out: THREE.Vector3; mid: THREE.Vector3 } | null = null, bestS = -Infinity;
    for (const c of ok) {
      if (Math.hypot(c.cx - L.x, c.cz - L.z) > 60) continue;
      const r = c.ring, n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 4) continue;
        const ox = -(bz - az) / len, oz = (bx - ax) / len;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (solid(mx + ox * 3, mz + oz * 3) || solid(mx + ox * 1, mz + oz * 1)) continue;
        // Central Park South is the block's northern edge: the most northerly open wall, facing north.
        const s = -oz * 3 + Math.min(len, 20) * 0.04 - (mz - L.z) * 0.15 - Math.abs(mx - L.x) * 0.03;
        if (s > bestS) { bestS = s; best = { c, wall: i, out: new THREE.Vector3(ox, 0, oz), mid: new THREE.Vector3(mx, c.fp.base, mz) }; }
      }
    }
    if (!best || -best.out.z < 0.5) return;
    const floor = THREE.MathUtils.clamp(Math.round((tower.fp.h * 0.8) / 3.3), 3, 60);
    // The windows look out of the tower's own north face.
    let vS = -Infinity, view = { x: tower.cx, z: tower.cz, out: new THREE.Vector3(0, 0, -1) };
    for (let i = 0, n = tower.ring.length / 2; i < n; i++) {
      const j = (i + 1) % n, r = tower.ring;
      const len = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]);
      if (len < 3) continue;
      const ox = -(r[j * 2 + 1] - r[i * 2 + 1]) / len, oz = (r[j * 2] - r[i * 2]) / len;
      const sc = -oz * Math.min(len, 30);
      if (sc > vS) { vS = sc; view = { x: (r[i * 2] + r[j * 2]) / 2, z: (r[i * 2 + 1] + r[j * 2 + 1]) / 2, out: new THREE.Vector3(ox, 0, oz) }; }
    }
    this.res = {
      fp: best.c.fp, chunk: best.c.chunk, ring: best.c.ring, wall: best.wall, door: best.mid, out: best.out,
      approach: best.mid.clone().addScaledVector(best.out, 2.4), at: { x: L.x, z: L.z }, floor, top: tower.fp.top, towerKey: tower.fp.key,
      view: { x: view.x, z: view.z, y: tower.fp.base, out: view.out },
    };
    this.buildEntrance();
  }

  private buildEntrance() {
    const r = this.res!;
    const g = new THREE.Group();
    g.position.copy(r.door);
    g.rotation.y = Math.atan2(r.out.x, r.out.z); // local +z = out of the building
    const green = new THREE.MeshStandardMaterial({ color: 0x1d3a2c, roughness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.32, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2c3a40, roughness: 0.08, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0.25 });
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.8 });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x5a1f22, roughness: 0.95 });
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b;
    };
    const L = 5.2, Wd = 2.7, H0 = 3.15, H1 = 2.85;
    // The awning: a long green canopy out to the curb on brass poles, the address on its valance.
    const roof = box(green, Wd, 0.08, L, 0, (H0 + H1) / 2, L / 2);
    roof.rotation.x = Math.atan2(H0 - H1, L);
    for (const s of [-1, 1]) box(green, 0.04, 0.32, L, s * Wd / 2, (H0 + H1) / 2 - 0.14, L / 2).rotation.x = roof.rotation.x;
    const val = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.34, 0.04), [green, green, green, green, signMaterial(HOME.address.split(' ')[0], 'CENTRAL PARK SOUTH'), green]);
    val.position.set(0, H1 - 0.14, L);
    g.add(val);
    for (const s of [-1, 1]) {
      box(brass, 0.06, H1, 0.06, s * (Wd / 2 - 0.05), H1 / 2, L - 0.05);
      box(brass, 0.05, 0.05, L, s * (Wd / 2 - 0.05), H1 - 0.02, L / 2);
    }
    // Lights under the canopy.
    const bulb = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 2.2 });
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), bulb); b.position.set(0, H0 - 0.12 - (k / 2) * (H0 - H1) * 0.8, 0.9 + k * 1.6); g.add(b); }
    // Runner, doors, surround, planters, house number.
    box(carpet, 1.6, 0.02, L, 0, 0.01, L / 2);
    box(stone, 3.4, 3.6, 0.3, 0, 1.8, 0.08);
    box(dark, 2.2, 2.8, 0.1, 0, 1.4, 0.26);
    for (const s of [-1, 1]) {
      box(glass, 0.86, 2.5, 0.04, s * 0.48, 1.3, 0.32);
      box(brass, 0.04, 0.5, 0.05, s * 0.1, 1.15, 0.36);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.7, 16), stone);
      pot.position.set(s * 1.9, 0.35, 0.6); pot.castShadow = true; g.add(pot);
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9 }));
      shrub.scale.set(1, 1.25, 1); shrub.position.set(s * 1.9, 1.15, 0.6); shrub.castShadow = true; g.add(shrub);
    }
    box(brass, 0.6, 0.18, 0.02, 1.25, 2.1, 0.25);
    // The doorman.
    const dm = makeNpc(0x1d3a2c, 0xc9a24a, { role: 'doorman', seed: 7 });
    dm.root.position.set(-1.7, 0, 0.7);
    dm.root.rotation.y = 0.35;
    g.add(dm.root);
    this.doorman = dm;
    this.group.add(g);
  }
}

function signMaterial(num: string, street: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1d3a2c'; x.fillRect(0, 0, 1024, 128);
  x.strokeStyle = '#b8913f'; x.lineWidth = 4; x.strokeRect(10, 10, 1004, 108);
  x.fillStyle = '#d9b45a';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 64px Georgia, "Times New Roman", serif';
  x.fillText(`${num}   ${street}`, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
}

// ------------------------------------------------------------------ inside

export interface HomeOpts {
  renderer: THREE.WebGLRenderer;
  city: THREE.Scene;
  dayNight: DayNight;
  robot: Robot;
  hit: BuildingHit;
  floor: number;
  /** The tower's north face at ground level: where the windows are, and which way they look. */
  view: { x: number; z: number; y: number; out: THREE.Vector3 };
  agents(): AgentInfo[];
  openAgents(): void;
  /** The morning briefing, for the desk monitor (null until it loads). */
  briefing(): Briefing | null;
  /** Sit down at the desk: the briefing panel. */
  openBriefing(): void;
}

/** Canvas textures for the apartment: herringbone oak, stone tile, subway tile, a wool rug, paintings. */
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

/** Wide-plank oak, staggered, with grain and the odd darker board. 1024px = 2.4 m. */
function oakPlanks(x: CanvasRenderingContext2D) {
  const S = 1024, rows = 13, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let px = -rnd() * 400;
    while (px < S) {
      const len = 380 + rnd() * 520, tone = 0.84 + rnd() * 0.24;
      x.fillStyle = `rgb(${Math.round(168 * tone)},${Math.round(124 * tone)},${Math.round(84 * tone)})`;
      x.fillRect(px, r * rh, len, rh);
      x.strokeStyle = `rgba(90,58,30,${0.1 + rnd() * 0.12})`; x.lineWidth = 1.2;
      for (let g = 0; g < 6; g++) {
        const yy = r * rh + 4 + rnd() * (rh - 8);
        x.beginPath(); x.moveTo(px, yy);
        x.bezierCurveTo(px + len * 0.3, yy + rnd() * 8 - 4, px + len * 0.7, yy + rnd() * 8 - 4, px + len, yy + rnd() * 4 - 2);
        x.stroke();
      }
      if (rnd() < 0.25) { x.fillStyle = 'rgba(70,40,20,0.35)'; x.beginPath(); x.ellipse(px + rnd() * len, r * rh + rh / 2, 6, 3, 0, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = 'rgba(55,35,18,0.7)'; x.fillRect(px, r * rh, 2, rh);
      px += len;
    }
    x.fillStyle = 'rgba(55,35,18,0.6)'; x.fillRect(0, r * rh, S, 2);
  }
}

function stoneTile(x: CanvasRenderingContext2D) {
  const S = 512, n = 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = 0.92 + rnd() * 0.08;
    x.fillStyle = `rgb(${Math.round(214 * t)},${Math.round(208 * t)},${Math.round(198 * t)})`;
    x.fillRect(i * S / n, j * S / n, S / n, S / n);
    for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(120,110,100,${rnd() * 0.08})`; x.fillRect(i * S / n + rnd() * S / n, j * S / n + rnd() * S / n, 2 + rnd() * 5, 2 + rnd() * 5); }
  }
  x.strokeStyle = '#b6aea2'; x.lineWidth = 4;
  for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * S / n, 0); x.lineTo(i * S / n, S); x.stroke(); x.beginPath(); x.moveTo(0, i * S / n); x.lineTo(S, i * S / n); x.stroke(); }
}

function subway(x: CanvasRenderingContext2D) {
  x.fillStyle = '#d9d6cf'; x.fillRect(0, 0, 512, 256);
  for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
    const ox = (r % 2) * 64;
    x.fillStyle = `rgb(${244 - rnd() * 8},${242 - rnd() * 8},${236 - rnd() * 8})`;
    x.fillRect(c * 128 + ox + 2, r * 32 + 2, 124, 28);
  }
}

function rugTex(x: CanvasRenderingContext2D) {
  x.fillStyle = '#c9bfae'; x.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 9000; k++) { x.fillStyle = `rgba(${90 + rnd() * 60},${80 + rnd() * 50},${70 + rnd() * 40},0.06)`; x.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
  x.strokeStyle = '#3d4a5a'; x.lineWidth = 14; x.strokeRect(26, 26, 460, 460);
  x.strokeStyle = '#9a6a4a'; x.lineWidth = 4; x.strokeRect(48, 48, 416, 416);
  x.strokeStyle = 'rgba(61,74,90,0.5)'; x.lineWidth = 3;
  for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(256, 256, 40 + i * 30, 0, Math.PI * 2); x.stroke(); }
}

function painting(seed: number) {
  return canvasTex(512, 384, (x) => {
    const pal = [['#e9e1d3', '#c96f4a', '#2f4858', '#d9b45a', '#86a397'], ['#f1ece4', '#1f3a5f', '#e07a5f', '#3d405b', '#81b29a'], ['#ede6da', '#5b7f6b', '#c8a26b', '#2d2a26', '#b85c38']][seed % 3];
    x.fillStyle = pal[0]; x.fillRect(0, 0, 512, 384);
    for (let k = 0; k < 7; k++) {
      x.fillStyle = pal[1 + ((k + seed) % 4)];
      x.globalAlpha = 0.85;
      if (k % 2) { x.beginPath(); x.arc(80 + rnd() * 350, 60 + rnd() * 260, 30 + rnd() * 90, 0, Math.PI * 2); x.fill(); }
      else x.fillRect(rnd() * 380, rnd() * 300, 60 + rnd() * 180, 20 + rnd() * 120);
    }
    x.globalAlpha = 1;
  });
}

/** Merges boxes, cylinders and the like per material: a furnished apartment in a handful of draw calls. */
class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(private parent: THREE.Object3D) {}
  add(m: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0) {
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1)));
    (this.parts.get(m) ?? this.parts.set(m, []).get(m)!).push(g);
  }
  /** Box by its bottom-center. */
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    this.add(m, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
  }
  /** Soft-edged box (upholstery, mattresses) by its bottom-center. */
  soft(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, r = 0.06) {
    this.add(m, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), x, y + h / 2, z, ry);
  }
  cyl(m: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 18) {
    this.add(m, new THREE.CylinderGeometry(r1, r0, h, seg), x, y + h / 2, z);
  }
  flush() {
    for (const [m, list] of this.parts) {
      const g = mergeAll(list);
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      mesh.castShadow = !(m as THREE.MeshStandardMaterial).transparent;
      this.parent.add(mesh);
    }
    this.parts.clear();
  }
}
function mergeAll(list: THREE.BufferGeometry[]) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** The view out of the windows: the city cube map, sampled by view direction, turned to the building's real heading. */
function windowMaterial(cube: THREE.Texture, turn: THREE.Matrix3) {
  return new THREE.ShaderMaterial({
    uniforms: { tCity: { value: cube }, uTurn: { value: turn }, uNight: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube tCity; uniform mat3 uTurn; uniform float uNight;
      varying vec3 vWorld;
      void main() {
        vec3 d = normalize(uTurn * normalize(vWorld - cameraPosition));
        vec3 c = textureCube(tCity, d).rgb;
        // Glass: a touch of green-grey tint, and at night a faint reflection of the warm room.
        c = c * vec3(0.9, 0.93, 0.92) + vec3(0.05, 0.04, 0.03) * uNight;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function buildHomeInterior(o: HomeOpts): GenericInterior & { refreshView(): void } {
  const W = 15, D = 11, H = 3.1;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const colliders = new Colliders(8);
  const solid = (ax: number, az: number, bx: number, bz: number, h = 2.6) =>
    colliders.add({ minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz), maxY: h });

  // ---- materials
  const oak = new THREE.MeshStandardMaterial({ map: canvasTex(1024, 1024, oakPlanks, [W / 2.4, D / 2.4]), roughness: 0.38, metalness: 0 });
  const tile = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, stoneTile, [5 / 1.2, 4 / 1.2]), roughness: 0.3 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0xefebe4, roughness: 0.92 });
  const ceilM = new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 0.95, emissive: 0xfff6ea, emissiveIntensity: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.6 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.45 });
  const lightWood = new THREE.MeshStandardMaterial({ color: 0xb48a5e, roughness: 0.5 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.97 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x5f6f68, roughness: 0.97 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xece7de, roughness: 0.95 });
  const blanket = new THREE.MeshStandardMaterial({ color: 0x3e5568, roughness: 0.97 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xeeebe6, roughness: 0.18 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x2f3a3c, roughness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.25, metalness: 0.85 });
  const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.3, metalness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.85 });
  const pot = new THREE.MeshStandardMaterial({ color: 0xb06a48, roughness: 0.8 });
  const rugM = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, rugTex), roughness: 1 });
  const splash = new THREE.MeshStandardMaterial({ map: canvasTex(512, 256, subway, [4, 1]), roughness: 0.25 });
  const lampShade = new THREE.MeshStandardMaterial({ color: 0xf3e8d2, roughness: 0.9, emissive: 0xffd7a0, emissiveIntensity: 0 });
  const recessed = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0.4 });

  const books0 = new THREE.MeshStandardMaterial({ color: 0x2a3d4f, roughness: 0.6 });
  const k = new Kit(scene);
  // ---- shell: floor (oak, stone in the kitchen), ceiling, walls, trim
  k.add(oak, new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), 0, 0, 0);
  k.add(tile, new THREE.PlaneGeometry(5, 4).rotateX(-Math.PI / 2), 5, 0.004, 3.5);
  k.add(ceilM, new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), 0, H, 0);
  const wallAt = (ax: number, az: number, bx: number, bz: number, hFrom = 0, hTo = H, m: THREE.Material = wallM) => {
    const len = Math.hypot(bx - ax, bz - az);
    const g = new THREE.PlaneGeometry(len, hTo - hFrom);
    // Face into the room: the normal points left of the direction a→b.
    const ry = Math.atan2(bz - az, -(bx - ax)) + Math.PI;
    k.add(m, g, (ax + bx) / 2, (hFrom + hTo) / 2, (az + bz) / 2, ry);
  };
  // West, east, south (door) walls; the north wall is glass.
  wallAt(x0, z1, x0, z0); wallAt(x1, z0, x1, z1); wallAt(x1, z1, x0, z1);
  solid(x0 - 0.3, z0, x0 + 0.05, z1, 3); solid(x1 - 0.05, z0, x1 + 0.3, z1, 3); solid(x0, z1 - 0.05, x1, z1 + 0.3, 3); solid(x0, z0 - 0.3, x1, z0 + 0.08, 3);
  // Bedroom partition (with a doorway) and the bedroom's south wall.
  const px = -2.5;
  for (const [a, b] of [[z0, -0.45], [0.55, 1.0]] as const) { k.box(wallM, 0.14, H, b - a, px, 0, (a + b) / 2); solid(px - 0.07, a, px + 0.07, b, 3); }
  k.box(wallM, 0.14, H - 2.15, 1.0, px, 2.15, 0.05);
  k.box(wallM, px - x0, H, 0.14, (x0 + px) / 2, 0, 1.0);
  solid(x0, 0.93, px, 1.07, 3);
  // Baseboards and crown.
  for (const [ax, az, bx, bz] of [[x0, z1 - 0.02, x1, z1 - 0.02], [x0 + 0.02, z0, x0 + 0.02, z1], [x1 - 0.02, z0, x1 - 0.02, z1]]) {
    const len = Math.hypot(bx - ax, bz - az), alongX = Math.abs(bx - ax) > 0.1;
    k.box(trim, alongX ? len : 0.03, 0.12, alongX ? 0.03 : len, (ax + bx) / 2, 0, (az + bz) / 2);
    k.box(trim, alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, (ax + bx) / 2, H - 0.08, (az + bz) / 2);
  }
  // Recessed ceiling lights.
  for (let ix = -6; ix <= 6; ix += 3) for (const iz of [-3, 0.5, 3.5]) k.add(recessed, new THREE.CircleGeometry(0.09, 16).rotateX(Math.PI / 2), ix, H - 0.005, iz);

  // ---- window wall: floor-to-ceiling glass bays between slim mullions
  const turn = new THREE.Matrix3();
  {
    const out = o.view.out; // the tower's real outward direction (north-ish)
    const a = Math.atan2(-out.x, -out.z);
    turn.setFromMatrix4(new THREE.Matrix4().makeRotationY(a));
  }
  const cube = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const winMat = windowMaterial(cube.texture, turn);
  const glassPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H - 0.1), winMat);
  glassPlane.position.set(0, (H - 0.1) / 2 + 0.05, z0 + 0.02);
  scene.add(glassPlane);
  for (let x = x0; x <= x1 + 0.01; x += W / 10) k.box(black, 0.07, H, 0.1, x, 0, z0 + 0.05);
  k.box(black, W, 0.08, 0.12, 0, 0, z0 + 0.06);
  k.box(black, W, 0.1, 0.12, 0, H - 0.1, z0 + 0.06);
  k.box(black, W, 0.05, 0.08, 0, 2.35, z0 + 0.05);
  // Sheer curtains bunched at the bay edges.
  const sheer = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1, transparent: true, opacity: 0.75 });
  for (const cx of [x0 + 0.35, px - 0.3, px + 0.3, x1 - 0.35]) k.box(sheer, 0.45, H - 0.2, 0.12, cx, 0.02, z0 + 0.22);

  // ---- living room
  const sofaX = 3.0, sofaZ = -1.15;
  k.soft(fabric, 2.7, 0.36, 0.95, sofaX, 0.08, sofaZ, 0, 0.05); // base
  k.box(black, 2.5, 0.08, 0.8, sofaX, 0, sofaZ); // plinth
  for (const s of [-0.82, 0, 0.82]) k.soft(cushion, 0.8, 0.16, 0.78, sofaX + s, 0.42, sofaZ - 0.06, 0, 0.06);
  k.soft(fabric, 2.7, 0.5, 0.24, sofaX, 0.42, sofaZ + 0.36, 0, 0.08); // back
  for (const s of [-0.82, 0, 0.82]) k.soft(cushion, 0.78, 0.42, 0.16, sofaX + s, 0.56, sofaZ + 0.2, 0, 0.07);
  for (const s of [-1, 1]) k.soft(fabric, 0.22, 0.62, 0.95, sofaX + s * 1.25, 0.06, sofaZ, 0, 0.08);
  const pillow = new THREE.MeshStandardMaterial({ color: 0xd8c3a0, roughness: 0.95 });
  for (const s of [-1.0, 1.0]) k.soft(pillow, 0.45, 0.42, 0.14, sofaX + s, 0.6, sofaZ + 0.05, s * 0.25, 0.07);
  solid(sofaX - 1.35, sofaZ + 0.26, sofaX + 1.35, sofaZ + 0.48, 0.95);
  for (const s of [-1, 1]) solid(sofaX + s * 1.25 - 0.1, sofaZ - 0.47, sofaX + s * 1.25 + 0.1, sofaZ + 0.47, 0.68);
  solid(sofaX - 1.15, sofaZ - 0.47, sofaX + 1.15, sofaZ + 0.26, 0.44);
  k.add(rugM, new THREE.PlaneGeometry(3.8, 3.0).rotateX(-Math.PI / 2), sofaX, 0.006, -2.4);
  k.box(marble, 1.3, 0.04, 0.7, sofaX, 0.38, -2.55);
  for (const [dx, dz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) k.box(black, 0.04, 0.38, 0.04, sofaX + dx, 0, -2.55 + dz);
  solid(sofaX - 0.65, -2.9, sofaX + 0.65, -2.2, 0.42);
  k.box(books0, 0.22, 0.03, 0.3, sofaX + 0.3, 0.42, -2.6); // book
  k.cyl(new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.3 }), 0.07, 0.05, 0.18, sofaX - 0.35, 0.42, -2.5); // vase
  // Armchair, side table with a lamp, floor lamp.
  const ac = { x: 5.9, z: -2.3 };
  k.soft(cushion, 0.85, 0.42, 0.85, ac.x, 0.08, ac.z, -0.6, 0.08); k.soft(cushion, 0.85, 0.48, 0.2, ac.x + 0.19, 0.46, ac.z + 0.3, -0.6, 0.08);
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) k.cyl(walnut, 0.02, 0.02, 0.08, ac.x + dx, 0, ac.z + dz);
  solid(ac.x - 0.45, ac.z - 0.45, ac.x + 0.45, ac.z + 0.45, 0.9);
  k.cyl(walnut, 0.25, 0.25, 0.55, 1.35, 0, -1.1); solid(1.1, -1.35, 1.6, -0.85, 0.56);
  k.cyl(brass, 0.08, 0.06, 0.32, 1.35, 0.55, -1.1);
  k.cyl(lampShade, 0.2, 0.15, 0.26, 1.35, 0.87, -1.1);
  k.cyl(black, 0.16, 0.16, 0.03, 6.8, 0, -0.6); k.cyl(brass, 0.015, 0.015, 1.5, 6.8, 0.03, -0.6); k.cyl(lampShade, 0.24, 0.18, 0.32, 6.8, 1.5, -0.6);
  // Plants by the glass.
  for (const [px2, pz2, s] of [[7.0, -4.8, 1.2], [-2.0, -4.85, 0.9], [-7.0, -4.8, 0.8]] as const) {
    k.cyl(pot, 0.24 * s, 0.2 * s, 0.45 * s, px2, 0, pz2);
    for (let q = 0; q < 6; q++) k.add(leaf, new THREE.SphereGeometry(0.28 * s, 10, 8).scale(1, 1.4, 1), px2 + Math.sin(q * 2.1) * 0.18 * s, 0.75 * s + q * 0.18 * s, pz2 + Math.cos(q * 2.1) * 0.18 * s);
    solid(px2 - 0.3, pz2 - 0.3, px2 + 0.3, pz2 + 0.3, 1.5);
  }
  // Dining: a round table by the window with four chairs.
  const dt = { x: 0.1, z: -3.3 };
  k.cyl(walnut, 0.65, 0.65, 0.04, dt.x, 0.72, dt.z, 28); k.cyl(walnut, 0.08, 0.08, 0.72, dt.x, 0, dt.z); k.cyl(walnut, 0.35, 0.35, 0.03, dt.x, 0, dt.z);
  solid(dt.x - 0.6, dt.z - 0.6, dt.x + 0.6, dt.z + 0.6, 0.76);
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2 + Math.PI / 4, cx = dt.x + Math.sin(a) * 0.85, cz = dt.z + Math.cos(a) * 0.85;
    k.box(lightWood, 0.45, 0.04, 0.45, cx, 0.45, cz, a); k.box(lightWood, 0.45, 0.45, 0.04, cx + Math.sin(a) * 0.2, 0.49, cz + Math.cos(a) * 0.2, a);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) k.box(lightWood, 0.035, 0.45, 0.035, cx + lx, 0, cz + lz);
  }
  // Art on the east wall.
  k.add(new THREE.MeshStandardMaterial({ map: painting(1), roughness: 0.8 }), new THREE.PlaneGeometry(1.6, 1.2), x1 - 0.03, 1.65, -2.4, -Math.PI / 2);
  k.box(black, 0.02, 1.26, 1.66, x1 - 0.012, 1.02, -2.4);

  // ---- bedroom
  const bed = { x: -6.2, z: -2.05 };
  k.box(walnut, 2.15, 0.3, 1.85, bed.x, 0.05, bed.z);
  k.soft(linen, 2.05, 0.26, 1.75, bed.x, 0.35, bed.z, 0, 0.08);
  k.soft(blanket, 1.25, 0.06, 1.82, bed.x + 0.42, 0.58, bed.z, 0, 0.03);
  for (const s of [-0.45, 0.45]) k.soft(linen, 0.42, 0.16, 0.68, bed.x - 0.78, 0.58, bed.z + s, 0, 0.07);
  k.soft(fabric, 0.14, 1.25, 1.95, -7.38, 0, bed.z, 0, 0.05);
  solid(-7.45, bed.z - 0.95, bed.x + 1.08, bed.z + 0.95, 0.6);
  for (const s of [-1.3, 1.3]) { k.box(walnut, 0.5, 0.5, 0.45, -7.15, 0, bed.z + s); k.cyl(brass, 0.06, 0.05, 0.3, -7.15, 0.5, bed.z + s); k.cyl(lampShade, 0.15, 0.11, 0.2, -7.15, 0.8, bed.z + s); solid(-7.4, bed.z + s - 0.25, -6.9, bed.z + s + 0.25, 0.5); }
  k.box(lacquer, 2.4, 2.4, 0.6, -5.9, 0, 0.6); solid(-7.1, 0.3, -4.7, 0.93, 2.4);
  for (const s of [-0.6, 0.6]) k.box(brass, 0.02, 0.3, 0.03, -5.9 + s * 0.08, 1.1, 0.28);
  k.add(rugM, new THREE.PlaneGeometry(2.8, 2.6).rotateX(-Math.PI / 2), -5.8, 0.006, bed.z);
  k.add(new THREE.MeshStandardMaterial({ map: painting(2), roughness: 0.8 }), new THREE.PlaneGeometry(1.4, 1.0), x0 + 0.03, 1.85, bed.z, Math.PI / 2);
  k.box(black, 0.02, 1.06, 1.46, x0 + 0.012, 1.32, bed.z);

  // ---- entry hall: the front door (your private lift lobby beyond), console, mirror, coat hooks
  const doorX = -5.0;
  k.box(walnut, 1.1, 2.3, 0.08, doorX, 0, z1 - 0.06);
  k.box(trim, 1.3, 0.08, 0.1, doorX, 2.3, z1 - 0.05);
  for (const s of [-1, 1]) k.box(trim, 0.08, 2.38, 0.1, doorX + s * 0.6, 0, z1 - 0.05);
  k.box(brass, 0.04, 0.2, 0.06, doorX + 0.42, 1.0, z1 - 0.12);
  k.box(walnut, 1.4, 0.06, 0.4, x0 + 0.2, 0.86, 3.2); k.box(walnut, 0.05, 0.86, 0.36, x0 + 0.2, 0, 2.6); k.box(walnut, 0.05, 0.86, 0.36, x0 + 0.2, 0, 3.8);
  solid(x0, 2.5, x0 + 0.42, 3.9, 0.9);
  k.add(new THREE.MeshStandardMaterial({ map: painting(0), roughness: 0.8 }), new THREE.PlaneGeometry(0.9, 1.15), x0 + 0.03, 1.6, 3.2, Math.PI / 2);
  k.box(brass, 0.02, 1.21, 0.96, x0 + 0.012, 1.0, 3.2);
  for (let q = 0; q < 4; q++) k.box(brass, 0.06, 0.03, 0.03, x0 + 0.05, 1.7, 4.4 + q * 0.2);

  // ---- kitchen: counters and uppers along the south wall, a fridge, an island with stools
  k.box(lacquer, 4.0, 0.88, 0.62, 4.6, 0, z1 - 0.32); k.box(marble, 4.05, 0.04, 0.66, 4.6, 0.88, z1 - 0.33);
  k.add(splash, new THREE.PlaneGeometry(4.0, 0.62), 4.6, 1.23, z1 - 0.01, Math.PI);
  k.box(lacquer, 4.0, 0.75, 0.36, 4.6, 1.55, z1 - 0.19);
  k.box(steel, 0.9, 2.15, 0.66, 7.05, 0, z1 - 0.34);
  k.box(black, 0.62, 0.012, 0.5, 5.2, 0.92, z1 - 0.35); // cooktop
  k.box(steel, 0.6, 0.01, 0.42, 3.6, 0.925, z1 - 0.35); // sink
  k.add(steel, new THREE.TorusGeometry(0.14, 0.012, 6, 16, Math.PI), 3.6, 1.06, z1 - 0.2);
  solid(2.55, z1 - 0.7, 7.5, z1, 2.2);
  const isl = { x: 4.6, z: 2.6 };
  k.box(lacquer, 2.6, 0.88, 0.95, isl.x, 0, isl.z); k.box(marble, 2.7, 0.05, 1.05, isl.x, 0.88, isl.z);
  solid(isl.x - 1.35, isl.z - 0.53, isl.x + 1.35, isl.z + 0.53, 0.94);
  for (const s of [-0.8, 0, 0.8]) { k.cyl(black, 0.19, 0.19, 0.05, isl.x + s, 0.66, isl.z - 0.8); k.cyl(black, 0.02, 0.02, 0.66, isl.x + s, 0, isl.z - 0.8); k.cyl(black, 0.2, 0.2, 0.02, isl.x + s, 0, isl.z - 0.8); }
  for (const s of [-0.9, 0, 0.9]) { k.cyl(black, 0.006, 0.006, 0.8, isl.x + s, H - 0.8, isl.z); k.cyl(lampShade, 0.16, 0.06, 0.22, isl.x + s, H - 1.0, isl.z); }
  k.cyl(new THREE.MeshStandardMaterial({ color: 0xd8a14a, roughness: 0.6 }), 0.16, 0.12, 0.1, isl.x - 0.4, 0.93, isl.z); // fruit bowl

  // ---- desk nook: a walnut desk on the south wall; the monitor shows your agents
  const desk = { x: -0.4, z: z1 - 0.4 };
  k.box(walnut, 2.0, 0.04, 0.7, desk.x, 0.74, desk.z);
  for (const s of [-0.95, 0.95]) k.box(black, 0.05, 0.74, 0.65, desk.x + s, 0, desk.z);
  solid(desk.x - 1.0, desk.z - 0.36, desk.x + 1.0, desk.z + 0.36, 0.78);
  k.box(black, 0.05, 0.25, 0.05, desk.x, 0.78, desk.z + 0.12); k.box(black, 0.25, 0.02, 0.18, desk.x, 0.78, desk.z + 0.12);
  k.box(black, 0.9, 0.04, 0.3, desk.x, 0.78, desk.z - 0.12); // keyboard area
  k.box(black, 0.92, 0.54, 0.03, desk.x, 0.98, desk.z + 0.18);
  const monC = document.createElement('canvas'); monC.width = 1024; monC.height = 600;
  const monT = new THREE.CanvasTexture(monC); monT.colorSpace = THREE.SRGBColorSpace;
  const monitor = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.5), new THREE.MeshBasicMaterial({ map: monT, toneMapped: false }));
  monitor.position.set(desk.x, 1.25, desk.z + 0.16); monitor.rotation.y = Math.PI;
  scene.add(monitor);
  // Desk chair.
  k.cyl(black, 0.3, 0.3, 0.04, desk.x, 0.03, desk.z - 0.8, 5); k.cyl(steel, 0.025, 0.025, 0.42, desk.x, 0.05, desk.z - 0.8); k.soft(black, 0.52, 0.08, 0.5, desk.x, 0.47, desk.z - 0.8, 0, 0.03); k.soft(black, 0.5, 0.55, 0.06, desk.x, 0.58, desk.z - 1.05, 0, 0.025);
  solid(desk.x - 0.3, desk.z - 1.1, desk.x + 0.3, desk.z - 0.55, 0.6);
  // Bookshelf beside the desk.
  k.box(walnut, 1.2, 2.2, 0.35, 1.6, 0, z1 - 0.2); solid(1.0, z1 - 0.4, 2.2, z1, 2.2);
  const books = [0x7a2e2e, 0x2e4a7a, 0xd9c7a0, 0x3d5a3d, 0x222222].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  for (let sh = 0; sh < 5; sh++) for (let b2 = 0; b2 < 8; b2++) if (rnd() < 0.8) k.box(books[(sh + b2) % 5], 0.09, 0.22 + rnd() * 0.08, 0.24, 1.15 + b2 * 0.12, 0.08 + sh * 0.43, z1 - 0.38);

  k.flush();

  // ---- light: the city's own sky through the glass (image-based), lamps at night
  scene.environment = cube.texture;
  scene.environmentIntensity = 0.9;
  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0xb09a80, 0.6);
  scene.add(hemi);
  const sunIn = new THREE.DirectionalLight(0xfff3e2, 1.0);
  sunIn.position.set(2, 6, -10);
  scene.add(sunIn);
  const lamps: THREE.PointLight[] = [];
  for (const [lx, ly, lz] of [[1.35, 1.1, -1.1], [6.8, 1.75, -0.6], [-7.15, 1.0, bed.z - 1.3], [-7.15, 1.0, bed.z + 1.3], [isl.x, 2.0, isl.z], [-1.5, 2.6, 2.6]] as const) {
    const L = new THREE.PointLight(0xffd6a0, 0, 7, 1.6);
    L.position.set(lx, ly, lz);
    scene.add(L);
    lamps.push(L);
  }

  // ---- the view: render the real city around the apartment's windows into the cube
  const r = o.hit;
  const viewPos = new THREE.Vector3(o.view.x, o.view.y + o.floor * 3.3 + 1.6, o.view.z).addScaledVector(o.view.out, 3);
  const cubeCam = new THREE.CubeCamera(1, 30000, cube);
  cubeCam.position.copy(viewPos);
  let viewTimer = 0;
  function refreshView() {
    const dn = o.dayNight;
    const dome = dn.dome.mesh, stars = dn.stars;
    const pd = dome.position.clone(), ps = stars.position.clone();
    // Stars are point sprites sized for the screen: in a 512px cube face they'd come out as big squares.
    const starsOn = stars.visible;
    dome.position.copy(viewPos); stars.visible = false;
    o.city.updateMatrixWorld();
    cubeCam.update(o.renderer, o.city);
    dome.position.copy(pd); stars.position.copy(ps); stars.visible = starsOn;
    (cube.texture as THREE.Texture & { needsPMREMUpdate?: boolean }).needsPMREMUpdate = true;
    viewTimer = 0;
  }
  refreshView();

  // ---- the monitor: the morning briefing (what your agents did while you were away)
  let monTimer = 0;
  function drawMonitor() {
    const h = Math.floor(o.dayNight.hour), m = Math.floor((o.dayNight.hour - h) * 60);
    const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} · Central Park South`;
    drawBriefingMonitor(monC.getContext('2d')!, o.briefing(), clock, o.agents());
    monT.needsUpdate = true;
  }
  drawMonitor();

  // ---- interactions
  let sitting: { until: number | null; at: THREE.Vector3 } | null = null;
  let playerRef: { position: THREE.Vector3; vel: THREE.Vector3; mode: MoveMode } | null = null;
  const sitAt = (p: THREE.Vector3, facing: number, untilHour: number | null) => {
    if (!playerRef) return;
    playerRef.position.copy(p);
    playerRef.vel.set(0, 0, 0);
    (playerRef as unknown as { facing: number }).facing = facing;
    o.robot.play('sit');
    o.dayNight.timelapse(true);
    sitting = { until: untilHour, at: p.clone() };
  };
  const inter: RoomInteraction[] = [
    { id: 'home:door', position: new THREE.Vector3(doorX, 0, z1 - 0.9), radius: 1.6, label: 'Take the lift down', sub: 'Out to Central Park South', action: () => api.onExit?.('door', 0) },
    { id: 'home:sofa', position: new THREE.Vector3(sofaX, 0, sofaZ - 0.9), radius: 1.6, label: 'Sit on the sofa', sub: 'Watch the park (time-lapse)', action: () => sitAt(new THREE.Vector3(sofaX, 0.47, sofaZ - 0.1), Math.PI, null) },
    { id: 'home:bed', position: new THREE.Vector3(bed.x + 1.5, 0, bed.z), radius: 1.6, label: 'Go to sleep', sub: 'Until morning', action: () => sitAt(new THREE.Vector3(bed.x + 0.6, 0.62, bed.z), Math.PI / 2, 7.5) },
    { id: 'home:desk', position: new THREE.Vector3(desk.x, 0, desk.z - 1.3), radius: 1.5, label: 'Read your briefing', sub: 'What your agents did while you were away', action: () => o.openBriefing() },
    { id: 'home:window', position: new THREE.Vector3(5.2, 0, z0 + 0.9), radius: 1.4, label: 'Open the window', sub: `Jump out from floor ${o.floor} (thrusters ready)`, action: () => api.onExit?.('window', o.floor) },
  ];

  const seats = [
    { x0: sofaX - 1.15, x1: sofaX + 1.15, z0: sofaZ - 0.47, z1: sofaZ + 0.26, y: 0.47 },
    { x0: -7.3, x1: bed.x + 1.05, z0: bed.z - 0.9, z1: bed.z + 0.9, y: 0.62 },
  ];
  const support = (x: number, z: number, y: number) => {
    for (const s of seats) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && y + 0.55 >= s.y) return s.y;
    return 0;
  };
  const world: PlayerWorld = { colliders, groundY: () => 0, support, canFly: false, bounds: { minX: x0 + 0.3, maxX: x1 - 0.3, minZ: z0 + 0.3, maxZ: z1 - 0.3 } };

  const api: GenericInterior & { refreshView(): void } = {
    scene, world,
    spawn: new THREE.Vector3(doorX, 0, z1 - 1.3),
    spawnFacing: Math.PI,
    floor: o.floor, floors: Math.max(o.floor + 1, Math.round(r.fp.h / 3.3)),
    kind: 'apartments',
    title: `Home · ${HOME.address}, floor ${o.floor}`,
    onExit: null, onInteractionsChanged: null,
    interactions: () => inter,
    refreshView,
    update(dt, p) {
      playerRef = p;
      // The game only runs the clock outdoors; at home it keeps going (the sofa and bed time-lapse), centered on the apartment.
      o.dayNight.update(dt, viewPos);
      const night = o.dayNight.night;
      for (const L of lamps) L.intensity = 2.2 * night + 0.2;
      lampShade.emissiveIntensity = 0.2 + 1.6 * night;
      recessed.emissiveIntensity = 0.3 + 1.2 * night;
      hemi.intensity = 0.15 + 0.55 * (1 - night);
      sunIn.intensity = 1.0 * (1 - night);
      winMat.uniforms.uNight.value = night;
      // Keep the view current: often while time races, otherwise now and then.
      viewTimer += dt;
      if (viewTimer > (o.dayNight.timelapsing ? 1.2 : 20)) refreshView();
      monTimer -= dt;
      if (monTimer <= 0) { monTimer = 2; drawMonitor(); }
      if (sitting) {
        const moved = p.position.distanceTo(sitting.at) > 0.25;
        const h = o.dayNight.hour;
        const woke = sitting.until !== null && h > sitting.until && h < sitting.until + 1;
        if (moved || woke) {
          o.dayNight.timelapse(false);
          if (o.robot.state === 'sit') o.robot.play('idle');
          sitting = null;
        }
      }
    },
    dispose() {
      if (sitting) { o.dayNight.timelapse(false); sitting = null; }
      scene.traverse((m) => { const mesh = m as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); const mm = mesh.material as THREE.Material & { map?: THREE.Texture }; mm.map?.dispose(); mm.dispose(); } });
      cube.dispose();
    },
  };
  return api;
}
