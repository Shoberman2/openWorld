// Project HQ entrances: a glass lobby pavilion on the front of the building, the way real office
// towers meet the street. Curtain wall with mullions, sliding (and on big towers revolving) doors that
// open as you walk up, a cantilevered canopy with downlights, halo-lit brushed-metal letters, a
// backlit logo, a street number on the glass, granite paving, planters and bollards, and a lit lobby
// you can see through the glass. Shared by the streaming world (earth/sites.ts) and the classic cities.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Tier } from '../../../shared/types.ts';
import { glowMaterials } from './buildings.ts';
import { shared } from '../engine.ts';
import { planarUV, surface, surfaceMaterial } from '../rooms/surfaces.ts';

export interface EntranceOpts {
  /** Middle of the front wall at ground level, and the unit normal pointing out of it. */
  door: THREE.Vector3;
  out: THREE.Vector3;
  /** Length of the wall the entrance sits on, and how much building there is above the door. */
  wallLen: number;
  maxH: number;
  tier: Tier;
  name: string;
  brand: string;
  /** The square logo plaque (repo logo, or a monogram). */
  logo: THREE.Texture;
  seed: number;
}

interface Dims { W: number; H: number; P: number; revolving: boolean; plinth: boolean; bollards: boolean }
const DIMS: Record<Tier, Dims> = {
  landmark: { W: 20, H: 7.2, P: 3.0, revolving: true, plinth: true, bollards: true },
  tower: { W: 15, H: 6.0, P: 2.6, revolving: true, plinth: true, bollards: true },
  midrise: { W: 10, H: 4.6, P: 2.0, revolving: false, plinth: false, bollards: true },
  small: { W: 6.2, H: 3.6, P: 1.4, revolving: false, plinth: false, bollards: false },
};

/** How far the lobby pavilion sticks out of the wall (stand beyond this to use the doors). */
export function entranceDepth(tier: Tier) { return DIMS[tier].P; }

// ---------- shared materials (one set for every entrance) ----------

let MAT: ReturnType<typeof makeMaterials> | null = null;
function glowMat(color: number, base: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, emissive: color, emissiveIntensity: base, roughness: 0.5 });
  m.userData = { base };
  glowMaterials.push(m);
  return m;
}
function makeMaterials() {
  // Walnut paneling, warmly lit (it glows a little more at night, through the glass).
  const walnut = surface('walnut').map.clone();
  walnut.repeat.set(1 / 1.6, 1 / 1.6);
  walnut.needsUpdate = true;
  const lobbyWall = new THREE.MeshStandardMaterial({ map: walnut, color: 0xd8c2a8, roughness: 0.5, emissive: 0x6b4a2c, emissiveIntensity: 0.5, emissiveMap: walnut });
  lobbyWall.userData = { base: 0.5 };
  glowMaterials.push(lobbyWall);
  return {
    frame: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.85, roughness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xa9bcc6, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.26, depthWrite: false,
      side: THREE.DoubleSide, envMapIntensity: 1.8, specularIntensity: 1,
    }),
    stone: new THREE.MeshStandardMaterial({ color: 0xbab4aa, roughness: 0.55, metalness: 0.02 }),
    darkStone: new THREE.MeshStandardMaterial({ color: 0x4d4a46, roughness: 0.35, metalness: 0.05 }),
    polished: new THREE.MeshStandardMaterial({ color: 0xd8d3ca, roughness: 0.12, metalness: 0.05 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 }),
    shrub: new THREE.MeshStandardMaterial({ color: 0x3d5631, roughness: 0.95, flatShading: true }),
    shrub2: new THREE.MeshStandardMaterial({ color: 0x4d6638, roughness: 0.95, flatShading: true }),
    white: new THREE.MeshStandardMaterial({ color: 0xece9e4, roughness: 0.4 }),
    lobbyWall,
    marble: surfaceMaterial('marble'),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3b6e33, roughness: 0.6, side: THREE.DoubleSide }),
    ceilingLight: glowMat(0xfff0d8, 1.6),
    downlight: glowMat(0xfff2dc, 2.4),
    uplight: glowMat(0xffe9c4, 1.4),
  };
}

/** Collects boxes/cylinders per material and merges them into one mesh per material. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g = g.rotateY(ry).translate(x, y, z);
    const l = this.parts.get(mat) ?? [];
    l.push(g);
    this.parts.set(mat, l);
  }
  /** Box with its base at y. */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    this.add(mat, new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), x, y, z, ry);
  }
  cyl(mat: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 12) {
    this.add(mat, new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, h / 2, 0), x, y, z);
  }
  build(parent: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!g) continue;
      if (mat === MAT?.marble || mat === MAT?.lobbyWall) planarUV(g);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      const see = mat === MAT?.glass;
      m.castShadow = shadows && !see && mat !== MAT?.downlight && mat !== MAT?.ceilingLight;
      m.receiveShadow = !see;
      if (see) m.renderOrder = 2;
      parent.add(m);
    }
    this.parts.clear();
  }
}

// ---------- textures ----------

/** Brushed-metal letters on a transparent canvas, plus a soft halo version for the backlight. */
function letterTextures(text: string) {
  const W = 2048, Hh = 256;
  const make = (halo: boolean) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d')!;
    let size = 170;
    const font = (s: number) => `600 ${s}px Inter, "Helvetica Neue", Arial, sans-serif`;
    g.font = font(size);
    const label = text.toUpperCase();
    const spacing = () => size * 0.08;
    const width = () => g.measureText(label).width + spacing() * (label.length - 1);
    while (width() > W - 80 && size > 50) { size -= 6; g.font = font(size); }
    let x = (W - width()) / 2;
    g.textBaseline = 'middle';
    if (halo) {
      g.shadowColor = 'rgba(255,236,200,1)';
      g.shadowBlur = 26;
      g.fillStyle = 'rgba(255,236,200,0.6)';
    } else {
      const grd = g.createLinearGradient(0, Hh / 2 - size / 2, 0, Hh / 2 + size / 2);
      grd.addColorStop(0, '#f2f3f4'); grd.addColorStop(0.45, '#b9bdc1'); grd.addColorStop(0.55, '#d9dcdf'); grd.addColorStop(1, '#8d9196');
      g.fillStyle = grd;
    }
    for (const ch of label) {
      g.fillText(ch, x, Hh / 2 + 6);
      x += g.measureText(ch).width + spacing();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { metal: make(false), halo: make(true) };
}

/** White vinyl street number for the glass above the door. */
function numberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '500 72px Inter, "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- animated doors ----------

interface Leaf { mesh: THREE.Object3D; closedX: number; openX: number }
interface Entry {
  group: THREE.Group;
  at: THREE.Vector3; // world position of the doors
  leaves: Leaf[];
  halo: THREE.MeshBasicMaterial;
  wings: THREE.Object3D | null;
  open: number;
  spin: number;
  attached: boolean;
}
const entries: Entry[] = [];

/** Doors slide open when you're close, the revolving door turns; far entrances are hidden. */
export function updateEntrances(dt: number, player: THREE.Vector3) {
  const night = shared.uNight.value;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e.group.parent) { if (e.attached) entries.splice(i, 1); continue; }
    e.attached = true;
    const d = Math.hypot(player.x - e.at.x, player.z - e.at.z);
    e.group.visible = d < 420;
    if (!e.group.visible) continue;
    e.halo.opacity = night * 0.85;
    const want = d < 5 && Math.abs(player.y - e.at.y) < 4 ? 1 : 0;
    e.open += (want - e.open) * Math.min(1, dt * (want ? 3.2 : 1.6));
    for (const l of e.leaves) l.mesh.position.x = l.closedX + (l.openX - l.closedX) * e.open;
    if (e.wings) {
      e.spin += ((want ? 1.1 : 0.12) - e.spin) * Math.min(1, dt * 1.5);
      e.wings.rotation.y += e.spin * dt;
    }
  }
}

// ---------- the entrance ----------

export function buildEntrance(o: EntranceOpts): THREE.Group {
  const M = (MAT ??= makeMaterials());
  const dims = DIMS[o.tier];
  const group = new THREE.Group();
  group.name = 'entrance';
  group.position.copy(o.door);
  group.rotation.y = Math.atan2(o.out.x, o.out.z);
  const b = new Batch();
  const rnd = mulberry(o.seed);

  const W = Math.max(4, Math.min(dims.W, o.wallLen - 1.2));
  const H = Math.max(3.2, Math.min(dims.H, o.maxH - 0.4));
  const P = dims.P;
  const head = Math.min(2.85, H - 0.45); // door head / transom
  const revolving = dims.revolving && W >= 6;
  const R = 1.25; // revolving drum radius
  const sideDoors = revolving && W >= 11;

  // Openings in the front glass: [center x, half width].
  const openings: [number, number][] = [];
  if (revolving) {
    openings.push([0, R + 0.08]);
    if (sideDoors) for (const s of [-1, 1]) openings.push([s * (R + 2.2), 1.05]);
  } else openings.push([0, W < 5 ? 0.9 : 1.05]);

  // ---- Paving: lobby floor, a granite apron with two shallow steps ----
  b.box(M.marble, W - 0.1, 0.05, P, 0, 0, P / 2);
  const apron = Math.min(W + 4, o.wallLen + 2);
  b.box(M.stone, apron, 0.04, 3.6, 0, 0, P + 1.8);
  const doorSpan = revolving ? (sideDoors ? 2 * (R + 3.3) : 2 * R + 0.6) : 2.6;
  b.box(M.stone, doorSpan + 1.2, 0.1, 0.55, 0, 0, P + 0.28);
  b.box(M.stone, doorSpan + 1.8, 0.05, 0.5, 0, 0, P + 0.8);

  // ---- The pavilion: glass front and sides, mullions, a stone cap ----
  const frontSegs = segmentsExcluding(-W / 2, W / 2, openings.map(([c, h]) => [c - h, c + h]));
  const mullionsAt = (x0: number, x1: number, step: number) => {
    const n = Math.max(1, Math.round((x1 - x0) / step));
    return Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
  };
  for (const [x0, x1] of frontSegs) {
    if (x1 - x0 < 0.05) continue;
    b.box(M.glass, x1 - x0, H - 0.12, 0.03, (x0 + x1) / 2, 0.06, P);
    for (const x of mullionsAt(x0, x1, 1.6)) b.box(M.frame, 0.07, H, 0.16, x, 0, P);
  }
  // Glass above the doors, a transom bar, a base rail and a head rail.
  for (const [c, h] of openings) {
    b.box(M.glass, 2 * h, H - head - 0.12, 0.03, c, head + 0.06, P);
    b.box(M.frame, 2 * h + 0.14, 0.14, 0.18, c, head - 0.07, P);
    for (const s of [-1, 1]) b.box(M.frame, 0.1, H, 0.18, c + s * h, 0, P);
  }
  b.box(M.frame, W + 0.1, 0.08, 0.16, 0, 0, P);
  b.box(M.frame, W + 0.2, 0.22, 0.24, 0, H - 0.22, P);
  for (const s of [-1, 1]) {
    b.add(M.glass, new THREE.BoxGeometry(P, H - 0.12, 0.03).translate(0, (H - 0.12) / 2, 0), s * W / 2, 0.06, P / 2, Math.PI / 2);
    for (const z of mullionsAt(0, P, 1.5)) b.box(M.frame, 0.16, H, 0.07, s * W / 2, 0, z);
  }
  b.box(M.darkStone, W + 0.5, 0.42, P + 0.3, 0, H, (P + 0.3) / 2);
  b.box(M.frame, W + 0.52, 0.06, P + 0.32, 0, H + 0.42, (P + 0.3) / 2);

  // ---- Inside: a warm lobby you can see through the glass ----
  b.box(M.lobbyWall, W - 0.3, H - 0.1, 0.06, 0, 0.05, 0.05);
  for (let x = -W / 2 + 0.9; x <= W / 2 - 0.9; x += 1.8) b.box(M.frame, 0.03, H - 0.1, 0.02, x, 0.05, 0.09); // panel joints
  b.box(M.white, W - 0.2, 0.04, P - 0.05, 0, H - 0.05, P / 2); // ceiling
  for (let x = -W / 2 + 1.2; x < W / 2 - 0.6; x += 2.2) b.box(M.ceilingLight, 0.9, 0.02, Math.max(0.3, P - 1.1), x, H - 0.08, P / 2);
  if (W >= 7 && P >= 2) {
    // Reception desk off to one side, a bench and a tall plant.
    const dx = W * 0.27;
    b.box(M.marble, 2.2, 1.0, 0.65, dx, 0.05, P * 0.42);
    b.box(M.darkStone, 2.3, 0.05, 0.75, dx, 1.05, P * 0.42);
    b.box(M.darkStone, 1.6, 0.42, 0.45, -dx, 0.05, P * 0.35);
    b.cyl(M.darkStone, 0.3, 0.24, 0.55, -W / 2 + 0.7, 0.05, 0.6, 20);
    // A fiddle-leaf fig: stems and big leaves.
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.25, h = 0.8 + rnd() * 1.1;
      const g = new THREE.SphereGeometry(1, 7, 3).scale(0.08, 0.012, 0.15).translate(0, 0, 0.12).rotateX(-0.3 - rnd() * 0.8).rotateY(a);
      b.add(M.leaf, g, -W / 2 + 0.7 + Math.cos(a) * r, 0.05 + h, 0.6 + Math.sin(a) * r);
    }
  }
  // Backlit logo on the lobby wall, behind the doors.
  const logoS = Math.min(1.6, H - head + 0.9, W * 0.18);
  const lobbyLogo = new THREE.Mesh(new THREE.PlaneGeometry(logoS, logoS), logoMaterial(o.logo));
  lobbyLogo.position.set(0, Math.min(head + 0.1, H - 0.25 - logoS / 2), 0.1);
  group.add(lobbyLogo);

  // ---- Doors ----
  const leaves: Leaf[] = [];
  const leaf = (cx: number, w: number, dir: number) => {
    const lb = new Batch();
    lb.box(M.glass, w - 0.08, head - 0.12, 0.025, 0, 0.06, 0);
    lb.box(M.frame, w, 0.06, 0.06, 0, 0, 0);
    lb.box(M.frame, w, 0.08, 0.06, 0, head - 0.08, 0);
    for (const s of [-1, 1]) lb.box(M.frame, 0.05, head, 0.06, s * (w / 2 - 0.025), 0, 0);
    lb.box(M.steel, 0.03, 1.1, 0.03, -dir * (w / 2 - 0.12), 0.55, 0.06); // pull bar
    const g = new THREE.Group();
    lb.build(g, false);
    g.position.set(cx, 0.05, P - 0.1);
    group.add(g);
    leaves.push({ mesh: g, closedX: cx, openX: cx + dir * (w - 0.1) });
  };
  for (const [c, h] of openings) {
    if (revolving && c === 0) continue;
    leaf(c - h / 2, h, -1);
    leaf(c + h / 2, h, 1);
  }
  let wings: THREE.Object3D | null = null;
  if (revolving) {
    // Drum: two curved glass walls (open to the front and back), a canopy disc and a floor disc.
    for (const a of [0, Math.PI]) {
      const arc = new THREE.CylinderGeometry(R, R, head - 0.1, 24, 1, true, a + Math.PI / 2 - 0.95, 1.9).translate(0, (head - 0.1) / 2 + 0.05, 0);
      b.add(M.glass, arc, 0, 0, P);
    }
    b.cyl(M.frame, R + 0.06, R + 0.06, 0.24, 0, head - 0.12, P, 32);
    b.cyl(M.downlight, R - 0.2, R - 0.2, 0.01, 0, head - 0.13, P, 24);
    b.cyl(M.darkStone, R + 0.04, R + 0.04, 0.05, 0, 0.0, P, 32);
    const wb = new Batch();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      wb.add(M.glass, new THREE.BoxGeometry(R - 0.08, head - 0.3, 0.03).translate((R - 0.08) / 2, (head - 0.3) / 2, 0), 0, 0.12, 0, a);
      wb.add(M.frame, new THREE.BoxGeometry(0.05, head - 0.3, 0.05).translate(R - 0.1, (head - 0.3) / 2, 0), 0, 0.12, 0, a);
    }
    wb.cyl(M.steel, 0.07, 0.07, head - 0.2, 0, 0.05, 0, 10);
    const w = new THREE.Group();
    wb.build(w, false);
    w.position.set(0, 0, P);
    group.add(w);
    wings = w;
  }

  // ---- Canopy: a thin steel blade on tension rods, with downlights ----
  const cY = Math.min(head + 0.75, H - 0.1);
  const cW = doorSpan + 2.4, cD = 2.6;
  b.box(M.frame, cW, 0.16, cD, 0, cY, P + cD / 2);
  b.box(M.steel, cW + 0.02, 0.05, 0.05, 0, cY + 0.16, P + cD);
  for (let x = -cW / 2 + 0.8; x <= cW / 2 - 0.7; x += 1.4) for (const z of [P + 0.8, P + cD - 0.6]) b.cyl(M.downlight, 0.11, 0.11, 0.02, x, cY - 0.015, z, 10);
  for (const s of [-1, 1]) {
    const x = s * (cW / 2 - 0.4), y0 = cY + 0.16, y1 = Math.min(H, cY + 1.8), z1 = P + cD - 0.2;
    const len = Math.hypot(y1 - y0, z1 - P);
    const rod = new THREE.CylinderGeometry(0.025, 0.025, len, 6).rotateX(Math.atan2(z1 - P, y1 - y0)).translate(0, (y0 + y1) / 2, (P + z1) / 2);
    b.add(M.steel, rod, x, 0, 0);
  }

  // ---- Name: halo-lit brushed-metal letters ----
  const tex = letterTextures(o.name);
  const above = o.maxH > H + 3.2; // room on the wall above the pavilion
  const letterW = Math.min(above ? W * 0.9 : cW - 0.4, Math.max(4, o.name.length * (o.tier === 'landmark' ? 1.0 : o.tier === 'tower' ? 0.85 : 0.6)));
  const letterH = letterW / 8;
  // A dark sign band standing off the wall (or on the canopy) with the letters pinned to it, so the
  // name reads against any facade.
  const lx = 0, ly = above ? H + 0.75 + letterH / 2 : cY + 0.3 + letterH / 2;
  const bandZ = above ? 0.35 : P + cD - 0.2;
  const bandW = letterW + 0.7, bandH = letterH + 0.45;
  b.box(M.frame, bandW, bandH, 0.16, lx, ly - bandH / 2, bandZ);
  if (above) for (const s of [-1, 1]) b.box(M.steel, 0.06, 0.06, bandZ, lx + s * (bandW / 2 - 0.4), ly, bandZ / 2); // stand-off brackets
  else b.box(M.frame, bandW, 0.05, 0.3, lx, cY + 0.16, bandZ); // sits on the canopy
  b.box(M.uplight, bandW - 0.1, 0.03, 0.05, lx, ly - bandH / 2 - 0.02, bandZ + 0.1); // wall-washer under the band
  const lz = bandZ + 0.1;
  // The halo only comes on after dark (updateEntrances fades it with the night).
  const halo = new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, depthWrite: false, alphaMap: tex.halo, opacity: 0 });
  const haloM = new THREE.Mesh(new THREE.PlaneGeometry(letterW * 1.04, letterH * 1.3), halo);
  haloM.position.set(lx, ly, lz - 0.015);
  const metal = new THREE.Mesh(new THREE.PlaneGeometry(letterW, letterH), new THREE.MeshStandardMaterial({ map: tex.metal, transparent: true, alphaTest: 0.4, metalness: 0.55, roughness: 0.35 }));
  metal.position.set(lx, ly, lz);
  group.add(haloM, metal);

  // Backlit logo plaque: on a stone monument at the curb (big towers) or on the wall by the letters.
  if (dims.plinth) {
    const mx = Math.min(W / 2 + 1.4, apron / 2 - 0.9) * (rnd() < 0.5 ? -1 : 1), mz = P + 3.0;
    b.box(M.darkStone, 1.7, 2.3, 0.5, mx, 0, mz);
    b.box(M.stone, 1.9, 0.12, 0.7, mx, 0, mz);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), logoMaterial(o.logo));
    plaque.position.set(mx, 1.45, mz + 0.26);
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5 / 8), new THREE.MeshStandardMaterial({ map: tex.metal, transparent: true, alphaTest: 0.4, metalness: 0.75, roughness: 0.32 }));
    nm.position.set(mx, 0.55, mz + 0.26);
    group.add(plaque, nm);
    b.box(M.uplight, 1.2, 0.03, 0.12, mx, 0.12, mz + 0.38);
  } else {
    const s = Math.min(1.3, letterH * 1.6);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(s, s), logoMaterial(o.logo));
    plaque.position.set(-W / 2 + s / 2 + 0.35, above ? ly : Math.min(head + 0.1, H - s / 2 - 0.3), above ? 0.13 : P + 0.05);
    group.add(plaque);
  }

  // Street number in white vinyl on the transom glass.
  const num = 10 + (o.seed % 880);
  const numM = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.28), new THREE.MeshBasicMaterial({ map: numberTexture(num), transparent: true, depthWrite: false }));
  numM.position.set(revolving ? 0 : openings[0][0], Math.min(head + 0.32, H - 0.3), P + 0.03);
  group.add(numM);

  // ---- Street furniture: planters with uplights, bollards ----
  const planter = (x: number, z: number) => {
    b.box(M.concrete, 1.7, 0.62, 0.85, x, 0, z);
    b.box(M.darkStone, 1.6, 0.04, 0.75, x, 0.6, z);
    for (let i = 0; i < 5; i++) b.add(i % 2 ? M.shrub : M.shrub2, new THREE.IcosahedronGeometry(0.28 + rnd() * 0.16, 1), x + (i - 2) * 0.3 + (rnd() - 0.5) * 0.1, 0.78 + rnd() * 0.2, z + (rnd() - 0.5) * 0.3, rnd() * 3);
    b.box(M.uplight, 0.12, 0.03, 0.12, x, 0.62, z + 0.36);
  };
  const px = doorSpan / 2 + 1.6;
  if (px + 0.9 < apron / 2) for (const s of [-1, 1]) planter(s * px, P + 1.5);
  if (dims.bollards) {
    for (let x = -apron / 2 + 0.6; x <= apron / 2 - 0.6; x += 1.5) {
      if (Math.abs(x) < 1.6) continue;
      b.cyl(M.steel, 0.1, 0.11, 0.95, x, 0, P + 3.9, 10);
      b.cyl(M.frame, 0.115, 0.115, 0.06, x, 0.7, P + 3.9, 10);
    }
  }

  b.build(group);
  const at = new THREE.Vector3(o.door.x + o.out.x * P, o.door.y, o.door.z + o.out.z * P);
  entries.push({ group, at, leaves, halo, wings, open: 0, spin: 0, attached: false });
  return group;
}

const logoMats = new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();
function logoMaterial(t: THREE.Texture) {
  let m = logoMats.get(t);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.35 });
    m.userData = { base: 0.55 };
    glowMaterials.push(m);
    logoMats.set(t, m);
  }
  return m;
}

function segmentsExcluding(x0: number, x1: number, holes: [number, number][]) {
  const out: [number, number][] = [];
  let x = x0;
  for (const [a, c] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (a > x) out.push([x, Math.min(a, x1)]);
    x = Math.max(x, c);
  }
  if (x < x1) out.push([x, x1]);
  return out;
}

function mulberry(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
