// Interiors for any building on Earth, generated from its real footprint: churches with pews,
// malls with shopfronts, apartments, offices, shops, storage rooms. Stairs between floors, a lift in
// every building (up to the roof, too), and you can always jump out of a window.
import * as THREE from 'three';
import { Colliders, type MoveMode, type PlayerWorld } from '../player.ts';
import { Lift, type LiftStop } from './lift.ts';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FloorViews, type CityViewPlacement } from './cityView.ts';
import { planarUV, plasterDetail, surfaceMaterial, type SurfaceName } from './surfaces.ts';
import { quality } from '../engine.ts';
import { Buf, Frame, backdropTexture, edgeDist, hex, inRing, insetRing, rng, signedArea, slab, wall, type Opening, type RGB } from './kit.ts';

export type Kind = 'house' | 'apartments' | 'office' | 'shop' | 'mall' | 'church' | 'warehouse' | 'tower';

export interface BuildingInfo {
  key: number;
  ring: number[]; // footprint x,z pairs, clockwise, local meters around (0,0) = centroid
  height: number;
  floors?: number;
  kind?: Kind;
  name?: string;
  doorWall: number; // index of the ring edge the player came through
  seed: number;
  country?: string;
  /** Where it stands in the world, so its windows can look out at the real city. */
  view?: CityViewPlacement;
  /** For image-based light (a soft studio room before the city view is captured). */
  pmrem?: THREE.PMREMGenerator;
  /** The outdoor sun (or moon): its direction and color light the rooms through the windows. */
  sun?: THREE.DirectionalLight;
  /** Cheaper surfaces and no shadows (VR). */
  lite?: boolean;
}

export interface RoomInteraction { id: string; position: THREE.Vector3; radius: number; label: string; sub?: string; action: () => void }

export interface GenericInterior {
  scene: THREE.Scene;
  world: PlayerWorld;
  spawn: THREE.Vector3;
  spawnFacing: number;
  floor: number;
  floors: number;
  kind: Kind;
  title: string;
  update(dt: number, player: { position: THREE.Vector3; vel: THREE.Vector3; mode: MoveMode }): void;
  dispose(): void;
  /** Interactions for the floor you're on (they change when you change floors). */
  interactions(): RoomInteraction[];
  /** Called when interactions() changes (new floor): re-read it. */
  onInteractionsChanged: (() => void) | null;
  onExit: ((how: 'door' | 'window' | 'roof', floor: number) => void) | null;
}

export function guessKind(info: { height: number; area: number; country?: string; landuse?: string; name?: string }): Kind {
  const { height: h, area: a } = info;
  const lu = info.landuse ?? '';
  const nm = (info.name ?? '').toLowerCase();
  if (/church|cathedral|chapel|basilica|kirk|kerk|église|iglesia|chiesa|temple|mosque|synagogue/.test(nm)) return 'church';
  if (/mall|galleria|shopping|plaza|centre|center/.test(nm) && a > 3000) return 'mall';
  if (h <= 9.5 && a < 260) return 'house';
  if ((lu === 'retail' || lu === 'commercial') && a > 6000) return 'mall';
  if (a > 9000 && h < 30) return 'mall';
  if (lu === 'industrial' || (h < 13 && a > 1500)) return 'warehouse';
  if (h > 60) return 'tower';
  if (lu === 'retail' || (h < 14 && a < 700)) return 'shop';
  if (lu === 'residential') return h > 12 ? 'apartments' : 'house';
  return h > 20 ? 'office' : (Math.round(a + h) % 2 ? 'apartments' : 'office');
}

interface Spec { H: number; maxFloors: number; floor: number; wall: number; sill: number; head: number; bay: number; win: number }
const SPECS: Record<Kind, Spec> = {
  house: { H: 2.9, maxFloors: 3, floor: 0xb98e63, wall: 0xefe6d6, sill: 0.9, head: 2.2, bay: 3.2, win: 1.3 },
  apartments: { H: 3.0, maxFloors: 60, floor: 0xc9a27a, wall: 0xe9e4da, sill: 0.9, head: 2.3, bay: 3.0, win: 1.4 },
  office: { H: 3.6, maxFloors: 80, floor: 0x9aa4b0, wall: 0xe4e6e8, sill: 0.6, head: 3.0, bay: 2.4, win: 1.9 },
  tower: { H: 3.8, maxFloors: 140, floor: 0x8e9aa8, wall: 0xe2e5e9, sill: 0.3, head: 3.4, bay: 2.0, win: 1.8 },
  shop: { H: 3.8, maxFloors: 3, floor: 0xdcd6cc, wall: 0xf1ede6, sill: 0.4, head: 3.0, bay: 3.6, win: 2.6 },
  mall: { H: 5.2, maxFloors: 3, floor: 0xe3ded6, wall: 0xf3f0ea, sill: 0.3, head: 4.4, bay: 4.0, win: 3.2 },
  church: { H: 14, maxFloors: 1, floor: 0xcfc6b8, wall: 0xe8dfcc, sill: 3.0, head: 10.5, bay: 4.5, win: 1.8 },
  warehouse: { H: 8, maxFloors: 1, floor: 0xa9a7a2, wall: 0xc9ccd0, sill: 5.6, head: 7.0, bay: 6.0, win: 3.5 },
};
const KIND_NAME: Record<Kind, string> = { house: 'House', apartments: 'Apartments', office: 'Offices', tower: 'Office tower', shop: 'Shop', mall: 'Shopping mall', church: 'Church', warehouse: 'Storage warehouse' };

/** Furniture palette: real-world materials (oak, walnut, linen, leather, steel), muted upholstery. */
const PAL = {
  wood: hex(0x9a6e48), woodLight: hex(0xc49a6c), walnut: hex(0x5a3c28), white: hex(0xf2f1ee), grey: hex(0x8d939b), dark: hex(0x3d434b), black: hex(0x1f2226),
  sofa: [hex(0x8a8178), hex(0x4b5157), hex(0x6e7560), hex(0x9b6a4f), hex(0x3f4a5c), hex(0xb7ab98)], rug: [hex(0xb8ab98), hex(0x6f7a83), hex(0x9a8471), hex(0xd6cfc3)],
  plant: hex(0x3f6d34), plant2: hex(0x2f5a2c), pot: hex(0xb8b2a8), potDark: hex(0x3a3c3f), metal: hex(0xb8bec6), steel: hex(0xc9cdd2), screen: hex(0x1d2733), glass: hex(0x9cc7de),
  frame: hex(0x2c3036), linen: hex(0xe9e4da), duvet: [hex(0xe8e3d9), hex(0xc9cfd4), hex(0xb9a58c), hex(0x8b9a8a)], leather: hex(0x6a4630), counter: hex(0xe6e2dc), cabinet: [hex(0xeeeae4), hex(0x4a5560), hex(0x7d8a74)],
  books: [hex(0x8f3b2f), hex(0x2f4f6f), hex(0xc9a35a), hex(0x3f6b4f), hex(0xd8d2c4), hex(0x5a4a6a), hex(0x222222)],
  signs: [hex(0xc8452f), hex(0x2a72b0), hex(0x3a8a5a), hex(0xd8a22c), hex(0x7a4ea8), hex(0xd06a8c), hex(0x1f8a8a)],
  boxes: [hex(0xc89a5c), hex(0xb88a52), hex(0xd8b07a)],
  stained: [hex(0xc23a33), hex(0x2a5fb8), hex(0xd8a828), hex(0x3a8a5a), hex(0x7a45b0)],
  stone: hex(0xd9d1c2), brass: hex(0xc9a46a), lamp: hex(0xfff1d6),
};

interface Rect { u0: number; u1: number; v0: number; v1: number }

export function buildGenericInterior(info: BuildingInfo): GenericInterior {
  const area = Math.abs(signedArea(info.ring));
  const kind: Kind = info.kind ?? guessKind({ height: info.height, area, country: info.country, name: info.name });
  const S = SPECS[kind];
  const H = kind === 'church' ? Math.max(7, Math.min(info.height * 0.85, 16)) : kind === 'warehouse' ? Math.max(5, Math.min(info.height, 9)) : S.H;
  let floors = Math.max(1, Math.min(info.floors ?? Math.floor(info.height / H), S.maxFloors));
  if (kind === 'house') floors = Math.max(1, Math.min(floors, info.height >= 5.5 ? 2 : 1));

  const outer = insetRing(info.ring, 0.3);
  const n = outer.length / 2;
  const F = new Frame(outer);
  const ccw = signedArea(outer) > 0;
  const inward = (i: number) => {
    const j = (i + 1) % n;
    const dx = outer[j * 2] - outer[i * 2], dz = outer[j * 2 + 1] - outer[i * 2 + 1], l = Math.hypot(dx, dz) || 1;
    return ccw ? { x: -dz / l, z: dx / l } : { x: dz / l, z: -dx / l };
  };

  // Door: middle of the wall we came through.
  const dw = ((info.doorWall % n) + n) % n;
  const dj = (dw + 1) % n;
  const dLen = Math.hypot(outer[dj * 2] - outer[dw * 2], outer[dj * 2 + 1] - outer[dw * 2 + 1]);
  const doorX = (outer[dw * 2] + outer[dj * 2]) / 2, doorZ = (outer[dw * 2 + 1] + outer[dj * 2 + 1]) / 2;
  const din = inward(dw);
  const doorW = Math.min(kind === 'mall' || kind === 'church' ? 3.2 : 1.8, Math.max(1.1, dLen - 0.6));

  // Bounds in the building frame.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    const u = F.u(outer[i], outer[i + 1]), v = F.v(outer[i], outer[i + 1]);
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  const fits = (r: Rect, margin: number) => {
    for (const u of [r.u0, (r.u0 + r.u1) / 2, r.u1]) for (const v of [r.v0, (r.v0 + r.v1) / 2, r.v1]) {
      const x = F.x(u, v), z = F.z(u, v);
      if (!inRing(outer, x, z) || edgeDist(outer, x, z) < margin) return false;
    }
    return true;
  };
  const du = F.u(doorX, doorZ), dv = F.v(doorX, doorZ);
  const doorZone: Rect = { u0: du - 3.2, u1: du + 3.2, v0: dv - 3.2, v1: dv + 3.2 };
  const overlap = (a: Rect, b: Rect) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;

  // ---- Core: switchback stairs (two lanes) with a lift shaft behind them ----
  let hasLift = true;
  type Core = { cu: number; cv: number; len: number; lane: number };
  let core = null as Core | null;
  const coreAt = (u: number, v: number, len: number, lift: boolean): Rect => ({ u0: u - len / 2 - 1.3, u1: u + len / 2 + 1.3, v0: v - 1.7, v1: v + (lift ? 5.2 : 1.7) });
  if (floors > 1) {
    const cu0 = F.u(0, 0), cv0 = F.v(0, 0);
    search: for (const lift of [true, false]) for (const len of [Math.min(7, H * 1.9), 4.6, 3.6]) {
      let best = null as Core | null, bs = Infinity;
      for (let u = uMin; u <= uMax; u += 0.75) for (let v = vMin; v <= vMax; v += 0.75) {
        const r = coreAt(u, v, len, lift);
        if (overlap(r, doorZone) || !fits(r, 0.2)) continue;
        const s = Math.hypot(u - cu0, v - cv0) * (kind === 'house' ? -0.3 : 1);
        if (s < bs) { bs = s; best = { cu: u, cv: v, len, lane: 1.3 }; }
      }
      if (best) { core = best; hasLift = lift; break search; }
    }
    if (!core) floors = 1;
  }
  // The lift shaft: behind the stairs, or on its own (one-storey buildings, or no room by the stairs).
  const LIFT_W = 1.9, LIFT_D = 1.75, SHAFT_D = LIFT_D + 0.46;
  let liftBase = core && hasLift ? { u: core.cu, v0: core.cv + core.lane + 0.05 } : null; // v0 = back of the shaft
  let liftRect: Rect | null = null;
  if (!liftBase) {
    const cu0 = F.u(0, 0), cv0 = F.v(0, 0);
    // Only the doorway itself has to stay clear here (small homes have no room for the full door zone).
    const doorway: Rect = { u0: du - 1.6, u1: du + 1.6, v0: dv - 2.2, v1: dv + 2.2 };
    let bs = Infinity;
    for (const landing of [1.5, 1.1]) {
      const step = Math.max(0.25, Math.max(uMax - uMin, vMax - vMin) / 90);
      for (let u = uMin; u <= uMax; u += step) for (let v = vMin; v <= vMax; v += step) {
        const r: Rect = { u0: u - 1.3, u1: u + 1.3, v0: v, v1: v + SHAFT_D + landing };
        if (overlap(r, doorway) || !fits(r, 0.1) || (core && overlap(r, coreAt(core.cu, core.cv, core.len, false)))) continue;
        const sc = Math.hypot(u - cu0, v + SHAFT_D / 2 - cv0);
        if (sc < bs) { bs = sc; liftBase = { u, v0: v }; liftRect = r; }
      }
      if (liftBase) break;
    }
  }
  const coreRect: Rect | null = core ? coreAt(core.cu, core.cv, core.len, hasLift) : null;
  /** Lane rect (u,v) for lane 0/1. Lane 0 climbs toward +u, lane 1 toward -u. */
  const laneRect = (lane: number): Rect => {
    const c = core!;
    return { u0: c.cu - c.len / 2, u1: c.cu + c.len / 2, v0: lane === 0 ? c.cv - c.lane : c.cv, v1: lane === 0 ? c.cv : c.cv + c.lane };
  };
  const rectXZ = (r: Rect) => [F.x(r.u0, r.v0), F.z(r.u0, r.v0), F.x(r.u1, r.v0), F.z(r.u1, r.v0), F.x(r.u1, r.v1), F.z(r.u1, r.v1), F.x(r.u0, r.v1), F.z(r.u0, r.v1)];
  const inRect = (r: Rect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
  const shaftRect: Rect | null = liftBase ? { u0: liftBase.u - LIFT_W / 2 - 0.2, u1: liftBase.u + LIFT_W / 2 + 0.2, v0: liftBase.v0, v1: liftBase.v0 + SHAFT_D } : null;

  // ---- Scene ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe9f1);
  const lite = quality.low || !!info.lite;
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0xa49a8c, 1.5);
  scene.add(hemi);
  // The real sun, through the windows (walls and ceilings cast shadows, so light lands in patches).
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.1);
  sun.castShadow = !lite;
  sun.shadow.mapSize.set(2048, 2048);
  {
    const r = Math.max(uMax - uMin, vMax - vMin) * 0.75 + 4;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 160 });
  }
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.35, 0.8, 0.25).normalize();
  // Image-based light: a soft studio room until the city view (captured per floor) replaces it.
  const pmrem = info.pmrem ?? null;
  const roomEnv = pmrem ? pmrem.fromScene(new RoomEnvironment(), 0.04) : null;
  if (roomEnv) { scene.environment = roomEnv.texture; scene.environmentIntensity = 0.45; }
  const surfs: THREE.Material[] = [];
  const surf = (name: SurfaceName, opts: Parameters<typeof surfaceMaterial>[1] = {}) => { const m = surfaceMaterial(name, { lite, ...opts }); surfs.push(m); return m; };
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  plasterDetail(solidMat);
  const glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.15, side: THREE.DoubleSide });
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xd4e6ee, roughness: 0.03, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  // Ceilings face down only: when the camera rises above one you look into the room (a cutaway).
  const FLOOR_SURF: Record<Kind, SurfaceName> = { house: 'oak', apartments: 'oak', office: 'carpet', tower: 'carpet', shop: 'tile', mall: 'terrazzo', church: 'stone', warehouse: 'epoxy' };
  const floorMats = new Map<SurfaceName, THREE.Material>();
  const floorMat = (f: number): THREE.Material => {
    const name: SurfaceName = f === 0 && (kind === 'office' || kind === 'tower') ? 'marble' : f === 0 && kind === 'apartments' ? 'terrazzo' : FLOOR_SURF[kind];
    let m = floorMats.get(name);
    if (!m) { m = surf(name); floorMats.set(name, m); }
    return m as THREE.Material;
  };
  const ceilMat = kind === 'office' || kind === 'tower' ? surf('acoustic') : surf('plaster', { tint: 0xf4f2ee, ceiling: true });
  const views = new FloorViews(scene, info.view, (f) => new THREE.Vector3(0, f * H + 1.7, 0), 0.6);
  const viewTex = backdropTexture();
  // One-sided, facing in: from outside (the camera can poke out of the door) it's invisible.
  const viewMat = new THREE.MeshBasicMaterial({ map: viewTex, side: THREE.FrontSide });

  const colliders = new Colliders(8);
  const floorsLoaded = new Map<number, { group: THREE.Group; inter: RoomInteraction[] }>();
  let cur = 0;

  const addCol = (owner: string, pts: number[], y0: number, y1: number) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]); }
    colliders.add({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1, poly: pts }, owner);
  };
  /**
   * Collider for a wall segment a->b. Thick on purpose: the game camera's collision samples its ray
   * every ~0.8 m, and thin walls let it slip outside.
   */
  const segCol = (owner: string, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, th = 0.5) => {
    const l = Math.hypot(bx - ax, bz - az) || 1, ox = (-(bz - az) / l) * th, oz = ((bx - ax) / l) * th;
    addCol(owner, [ax - ox, az - oz, bx - ox, bz - oz, bx + ox, bz + oz, ax + ox, az + oz], y0, y1);
  };
  /** Box in frame coordinates, drawn and (optionally) solid. */
  const fbox = (buf: Buf, owner: string | null, u: number, v: number, y0: number, w: number, h: number, d: number, col: RGB, faceDu = 0, faceDv = 1, top?: RGB) => {
    const x = F.x(u, v), z = F.z(u, v), yaw = F.yaw(faceDu, faceDv);
    buf.box(x, y0, z, w, h, d, yaw, col, top);
    if (owner && h > 0.45) {
      const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
      const P = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c];
      addCol(owner, [...P(-hw, -hd), ...P(hw, -hd), ...P(hw, hd), ...P(-hw, hd)], y0, y0 + h);
    }
  };

  function buildFloor(f: number) {
    const y = f * H;
    const owner = `floor:${f}`;
    const solid = new Buf(), glow = new Buf(), ceil = new Buf(), floorB = new Buf(), gloss = new Buf(), metal = new Buf(), glass = new Buf(), leaves = new Buf();
    const cityOut = views.available;
    const view: number[] = [], viewUv: number[] = [];
    const inter: RoomInteraction[] = [];
    const R = rng(info.seed * 31 + f * 7 + 1);
    const floorCol = hex(S.floor), wallCol = hex(S.wall);

    // Floor and ceiling (with stair openings).
    const shaftHole = shaftRect ? [rectXZ(shaftRect)] : [];
    const holeBelow = [...(core && f >= 1 ? [rectXZ(laneRect((f - 1) % 2))] : []), ...shaftHole];
    const holeAbove = [...(core && f < floors - 1 ? [rectXZ(laneRect(f % 2))] : []), ...shaftHole];
    slab(floorB, outer, holeBelow.map(orient), y, true, [1, 1, 1]);
    slab(ceil, outer, holeAbove.map(orient), y + H - 0.02, false, hex(0xf3f1ec));

    // Exterior walls with windows (and the front door on the ground floor).
    const windows: { x: number; z: number; nx: number; nz: number }[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = outer[i * 2], az = outer[i * 2 + 1], bx = outer[j * 2], bz = outer[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nin = inward(i);
      const open: Opening[] = [];
      const doorHere = f === 0 && i === dw;
      const dt0 = len / 2 - doorW / 2, dt1 = len / 2 + doorW / 2;
      if (doorHere) open.push({ t0: dt0, t1: dt1, y0: y, y1: y + Math.min(H - 0.3, kind === 'church' ? 5 : 2.4) });
      const bays = Math.floor(len / S.bay);
      for (let b = 0; b < bays; b++) {
        const c = (len - bays * S.bay) / 2 + (b + 0.5) * S.bay;
        const t0 = c - S.win / 2, t1 = c + S.win / 2;
        if (doorHere && t1 > dt0 - 0.3 && t0 < dt1 + 0.3) continue;
        const o = { t0, t1, y0: y + S.sill, y1: y + Math.min(S.head, H - 0.25) };
        open.push(o);
        const mx = ax + ((bx - ax) * c) / len, mz = az + ((bz - az) * c) / len;
        windows.push({ x: mx, z: mz, nx: nin.x, nz: nin.z });
        // Glass/view just outside the opening.
        const ux = (bx - ax) / len, uz = (bz - az) / len, out = -0.35;
        const p0 = [ax + ux * (t0 - 0.05) + nin.x * out, o.y0 - 0.05, az + uz * (t0 - 0.05) + nin.z * out];
        const p1 = [ax + ux * (t1 + 0.05) + nin.x * out, o.y0 - 0.05, az + uz * (t1 + 0.05) + nin.z * out];
        const p2 = [p1[0], o.y1 + 0.05, p1[2]], p3 = [p0[0], o.y1 + 0.05, p0[2]];
        if (kind === 'church') {
          // Stained glass: small leaded panes in jewel colors, a bright medallion in the middle.
          const cols = PAL.stained;
          const rows = 10, cn = 3;
          const lerp3 = (t: number, yy: number) => [p0[0] + (p1[0] - p0[0]) * t, yy, p0[2] + (p1[2] - p0[2]) * t];
          for (let k = 0; k < rows; k++) for (let q = 0; q < cn; q++) {
            const ya = p0[1] + ((p3[1] - p0[1]) * k) / rows + 0.025, yb = p0[1] + ((p3[1] - p0[1]) * (k + 1)) / rows - 0.025;
            const ta = q / cn + 0.012, tb = (q + 1) / cn - 0.012;
            const mid = Math.abs(k - rows * 0.55) < 1.6 && q === 1;
            const h = ((b * 7 + k * 13 + q * 5 + i * 3) * 2654435761) >>> 0;
            const c = mid ? hex(0xf2d27a) : cols[h % cols.length];
            const dim = mid ? 1 : 0.75 + ((h >>> 8) % 25) / 100;
            glow.quad(lerp3(ta, ya), lerp3(tb, ya), lerp3(tb, yb), lerp3(ta, yb), [c[0] * dim, c[1] * dim, c[2] * dim]);
          }
          const sh = (q: number[]) => [q[0] - nin.x * 0.03, q[1], q[2] - nin.z * 0.03];
          glow.quad(sh(p0), sh(p1), sh(p2), sh(p3), hex(0x15161a)); // the lead between panes
        } else if (cityOut) {
          // Real glass, with the city beyond it (the scene background is the view from in here).
          const g0 = [ax + ux * t0 + nin.x * -0.12, o.y0, az + uz * t0 + nin.z * -0.12], g1 = [ax + ux * t1 + nin.x * -0.12, o.y0, az + uz * t1 + nin.z * -0.12];
          glass.quad(g0, g1, [g1[0], o.y1, g1[2]], [g0[0], o.y1, g0[2]], [1, 1, 1]);
        } else {
          const u0 = ((b + i * 3) % 7) / 7, u1 = u0 + 0.14, vv0 = 0.15 + Math.min(0.35, f * 0.01), vv1 = Math.min(1, vv0 + 0.6);
          pushView(view, viewUv, p0, p1, p2, p3, [u0, vv0, u1, vv0, u1, vv1, u0, vv1], nin);
        }
        // Window sill and frame (jambs, head, a mullion on wide windows).
        const wy = Math.atan2(nin.x, nin.z);
        const sx = ax + ux * c + nin.x * 0.12, sz = az + uz * c + nin.z * 0.12;
        solid.box(sx, o.y0 - 0.05, sz, S.win + 0.16, 0.05, 0.26, wy, PAL.white);
        if (kind !== 'church') {
          const fx = ax + ux * c - nin.x * 0.1, fz = az + uz * c - nin.z * 0.1, fh = o.y1 - o.y0, fc = PAL.frame;
          for (const e of [-1, 1]) metal.box(fx + ux * e * (S.win / 2 - 0.025), o.y0, fz + uz * e * (S.win / 2 - 0.025), 0.05, fh, 0.08, wy, fc);
          metal.box(fx, o.y1 - 0.05, fz, S.win, 0.05, 0.08, wy, fc);
          metal.box(fx, o.y0, fz, S.win, 0.04, 0.08, wy, fc);
          if (S.win > 1.6) metal.box(fx, o.y0, fz, 0.04, fh, 0.07, wy, fc);
          if (fh > 2.2) metal.box(fx, o.y0 + fh * 0.72, fz, S.win, 0.04, 0.07, wy, fc);
        }
      }
      wall(solid, ax, az, bx, bz, y, y + H, open, wallCol);
      // Skirting.
      const sk: RGB = [wallCol[0] * 0.75, wallCol[1] * 0.75, wallCol[2] * 0.75];
      wall(solid, ax + nin.x * 0.02, az + nin.z * 0.02, bx + nin.x * 0.02, bz + nin.z * 0.02, y, y + 0.12, doorHere ? [{ t0: dt0, t1: dt1, y0: y, y1: y + 1 }] : [], sk);
      // Collision (gap at the door).
      if (doorHere) {
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        segCol(owner, ax, az, ax + ux * dt0, az + uz * dt0, y, y + H);
        segCol(owner, ax + ux * dt1, az + uz * dt1, bx, bz, y, y + H);
        // The doorway itself is closed to walking (and the camera): leaving is the "Go outside" action.
        segCol(owner, ax + ux * dt0, az + uz * dt0, ax + ux * dt1, az + uz * dt1, y, y + H, 0.5);
      } else segCol(owner, ax, az, bx, bz, y, y + H);
    }
    // Door: frame and a way out (an invisible exit plane leads back outside).
    if (f === 0) {
      const ux = (outer[dj * 2] - outer[dw * 2]) / dLen, uz = (outer[dj * 2 + 1] - outer[dw * 2 + 1]) / dLen;
      const dh = Math.min(H - 0.3, kind === 'church' ? 5 : 2.4);
      for (const s of [-1, 1]) solid.box(doorX + ux * s * (doorW / 2 + 0.06), y, doorZ + uz * s * (doorW / 2 + 0.06), 0.12, dh, 0.3, Math.atan2(din.x, din.z), PAL.wood);
      solid.box(doorX, y + dh, doorZ, doorW + 0.24, 0.12, 0.3, Math.atan2(din.x, din.z), PAL.wood);
      // Daylight through the open door.
      const o = -0.4;
      const q0 = [doorX - ux * doorW / 2 + din.x * o, y, doorZ - uz * doorW / 2 + din.z * o], q1 = [doorX + ux * doorW / 2 + din.x * o, y, doorZ + uz * doorW / 2 + din.z * o];
      if (!cityOut) pushView(view, viewUv, q0, q1, [q1[0], y + dh, q1[2]], [q0[0], y + dh, q0[2]], [0.4, 0, 0.55, 0, 0.55, 0.75, 0.4, 0.75], din);
      inter.push({ id: 'room:door', position: new THREE.Vector3(doorX + din.x * 0.9, y, doorZ + din.z * 0.9), radius: 1.8, label: 'Go outside', sub: info.name ?? KIND_NAME[kind], action: () => api.onExit?.('door', 0) });
    }
    // Jump-out windows: a handful spread around the floor.
    const step = Math.max(1, Math.floor(windows.length / 6));
    for (let k = 0; k < windows.length; k += step) {
      const w = windows[k];
      inter.push({ id: `room:win:${k}`, position: new THREE.Vector3(w.x + w.nx * 0.7, y, w.z + w.nz * 0.7), radius: 1.3, label: 'Jump out the window', sub: f > 0 ? `Floor ${f + 1} · rocket shoes ready` : 'Back to the street', action: () => api.onExit?.('window', f) });
    }

    // ---- Core ----
    const occupied: Rect[] = [doorZone];
    if (liftRect) occupied.push({ u0: liftRect.u0 - 0.4, u1: liftRect.u1 + 0.4, v0: liftRect.v0 - 0.4, v1: liftRect.v1 + 0.2 });
    if (lift) inter.push(...lift.interactions(f));
    if (core && coreRect) {
      occupied.push({ u0: coreRect.u0 - 0.6, u1: coreRect.u1 + 0.6, v0: coreRect.v0 - 0.6, v1: coreRect.v1 + 0.6 });
      const c = core;
      const u0 = c.cu - c.len / 2, u1 = c.cu + c.len / 2;
      // Up-flight from this floor.
      if (f < floors - 1) {
        const lane = f % 2, r = laneRect(lane), steps = Math.max(10, Math.round(H / 0.18));
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps, su = lane === 0 ? u0 + t * c.len : u1 - t * c.len;
          fbox(solid, null, su, (r.v0 + r.v1) / 2, y, c.len / steps + 0.02, ((k + 1) / steps) * H, c.lane - 0.05, k % 2 ? PAL.woodLight : PAL.wood);
        }
      }
      // Core walls (outer sides of both lanes), rails around the opening from below.
      const wallAt = (v: number, ya: number, yb: number) => {
        wall(solid, F.x(u0 - 1.3, v), F.z(u0 - 1.3, v), F.x(u1 + 1.3, v), F.z(u1 + 1.3, v), ya, yb, [], hex(0xd9d6cf));
        segCol(owner, F.x(u0 - 1.3, v), F.z(u0 - 1.3, v), F.x(u1 + 1.3, v), F.z(u1 + 1.3, v), ya, yb, 0.15);
      };
      wallAt(c.cv - c.lane - 0.05, y, y + H);
      if (!hasLift) wallAt(c.cv + c.lane + 0.05, y, y + H);
      if (f >= 1) {
        const lane = (f - 1) % 2, r = laneRect(lane);
        const rail = (au: number, av: number, bu: number, bv: number) => {
          solid.box(F.x((au + bu) / 2, (av + bv) / 2), y, F.z((au + bu) / 2, (av + bv) / 2), Math.hypot(bu - au, bv - av) || 0.06, 1.0, 0.06, F.yaw(bv - av, -(bu - au)), PAL.metal);
          segCol(owner, F.x(au, av), F.z(au, av), F.x(bu, bv), F.z(bu, bv), y, y + 1.0, 0.08);
        };
        // The end you arrive at stays open.
        const closedU = lane === 0 ? r.u0 : r.u1;
        rail(closedU, r.v0, closedU, r.v1);
        const midV = lane === 0 ? r.v1 : r.v0, outV = lane === 0 ? r.v0 : r.v1;
        rail(r.u0, midV, r.u1, midV);
        rail(r.u0, outV, r.u1, outV);
      }
    }

    // ---- Furniture ----
    const placeGrid = (w: number, d: number, su: number, sv: number, margin: number, max: number, fn: (u: number, v: number, k: number) => void, jitter = 0) => {
      let k = 0;
      for (let u = uMin + w / 2 + margin; u <= uMax - w / 2 - margin && k < max; u += su) for (let v = vMin + d / 2 + margin; v <= vMax - d / 2 - margin && k < max; v += sv) {
        const ju = jitter ? (R() - 0.5) * jitter : 0, jv = jitter ? (R() - 0.5) * jitter : 0;
        const r: Rect = { u0: u + ju - w / 2, u1: u + ju + w / 2, v0: v + jv - d / 2, v1: v + jv + d / 2 };
        if (occupied.some((o) => overlap(o, r)) || !fits(r, margin)) continue;
        occupied.push(r);
        fn(u + ju, v + jv, k++);
      }
    };
    /**
     * A furniture piece in its own frame: centered at (u, v), facing (fu, fv) (its front, +z), `lx`
     * across and `lz` along the facing. Boxes are w across, d deep, h tall from height ly.
     */
    type Piece = (lx: number, lz: number, ly: number, w: number, h: number, d: number, col: RGB, buf?: Buf, solidOwner?: boolean) => void;
    const at = (u: number, v: number, fu: number, fv: number): Piece => (lx, lz, ly, w, h, d, col, buf = solid, so = false) => {
      const ru = fv, rv = -fu; // right of the facing
      fbox(buf, so ? owner : null, u + ru * lx + fu * lz, v + rv * lx + fv * lz, y + ly, w, h, d, col, fu, fv);
    };
    /** Arbitrary geometry (cylinders, leaves) at frame (u, v) and height ly, in a buffer. */
    const shape = (buf: Buf, g: THREE.BufferGeometry, u: number, v: number, ly: number, col: RGB, rot = new THREE.Euler()) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(F.x(u, v), y + ly, F.z(u, v)), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
      buf.geom(g, m, col);
      g.dispose();
    };
    const cyl = (buf: Buf, u: number, v: number, ly: number, rt: number, rb: number, h: number, col: RGB, seg = 14) =>
      shape(buf, new THREE.CylinderGeometry(rt, rb, h, seg), u, v, ly + h / 2, col);
    const collide = (u: number, v: number, w: number, d: number, fu: number, fv: number, h: number) => {
      const x = F.x(u, v), z = F.z(u, v), yaw = F.yaw(fu, fv), c = Math.cos(yaw), sn = Math.sin(yaw), hw = w / 2, hd = d / 2;
      const P = (lx: number, lz: number) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      addCol(owner, [...P(-hw, -hd), ...P(hw, -hd), ...P(hw, hd), ...P(-hw, hd)], y, y + h);
    };
    const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];

    // Plants: a pot, soil and a crown of real leaves.
    const plant = (u: number, v: number, s = 1) => {
      const dark = R() < 0.5;
      cyl(gloss, u, v, 0, 0.28 * s, 0.22 * s, 0.5 * s, dark ? PAL.potDark : PAL.pot, 20);
      cyl(solid, u, v, 0.47 * s, 0.25 * s, 0.25 * s, 0.02, hex(0x2f2620), 16);
      const n = 16 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, rr = R() * 0.22 * s, hh = (0.6 + R() * 0.9) * s;
        const g = new THREE.SphereGeometry(1, 7, 3);
        g.scale((0.06 + R() * 0.04) * s, 0.01, (0.16 + R() * 0.1) * s);
        g.translate(0, 0, 0.12 * s);
        shape(leaves, g, u + Math.cos(a) * rr, v + Math.sin(a) * rr, 0.5 * s + hh * 0.7, R() < 0.5 ? PAL.plant : PAL.plant2, new THREE.Euler(-0.3 - R() * 0.8, a, 0, 'YXZ'));
      }
      collide(u, v, 0.6 * s, 0.6 * s, 0, 1, 1.2);
    };
    const robot = (u: number, v: number, fu: number, fv: number) => {
      // A white caretaker robot standing about: rounded body, head with a visor and ear discs.
      const p = at(u, v, fu, fv);
      for (const sx of [-0.1, 0.1]) { p(sx, 0, 0, 0.11, 0.78, 0.13, PAL.white); p(sx, 0, 0.42, 0.13, 0.08, 0.15, PAL.dark); }
      p(0, 0, 0.8, 0.42, 0.62, 0.24, PAL.white);
      for (const sx of [-0.27, 0.27]) p(sx, 0, 0.85, 0.09, 0.55, 0.1, PAL.white);
      p(0, 0, 1.44, 0.07, 0.08, 0.07, PAL.dark);
      shape(solid, new THREE.SphereGeometry(0.16, 16, 12), u, v, 1.66, PAL.white);
      p(0, 0.13, 1.62, 0.22, 0.06, 0.04, hex(0x40c8ff), glow);
      collide(u, v, 0.5, 0.35, fu, fv, 1.8);
    };
    const lightGrid = (sp: number, ly: number) => {
      for (let u = uMin + sp / 2; u < uMax; u += sp) for (let v = vMin + sp / 2; v < vMax; v += sp) {
        const x = F.x(u, v), z = F.z(u, v);
        if (!inRing(outer, x, z) || edgeDist(outer, x, z) < 0.8) continue;
        if (core && coreRect && inRect(coreRect, u, v)) continue;
        fbox(metal, null, u, v, ly - 0.01, 1.3, 0.035, 0.36, PAL.steel);
        fbox(glow, null, u, v, ly - 0.025, 1.2, 0.02, 0.26, hex(0xfff6e6));
      }
    };
    const downlights = (sp: number, ly: number) => {
      for (let u = uMin + sp / 2; u < uMax; u += sp) for (let v = vMin + sp / 2; v < vMax; v += sp) {
        const x = F.x(u, v), z = F.z(u, v);
        if (!inRing(outer, x, z) || edgeDist(outer, x, z) < 0.8) continue;
        if (core && coreRect && inRect(coreRect, u, v)) continue;
        cyl(metal, u, v, ly - 0.02, 0.1, 0.1, 0.02, PAL.white, 14);
        cyl(glow, u, v, ly - 0.03, 0.07, 0.07, 0.01, PAL.lamp, 14);
      }
    };
    const sofaCol = () => pick(PAL.sofa);

    // ---- Furniture pieces ----
    const sofa = (u: number, v: number, fu: number, fv: number, col: RGB, w = 2.2) => {
      const p = at(u, v, fu, fv);
      p(0, 0, 0.1, w, 0.24, 0.9, col);
      const n = w > 1.4 ? 3 : 1, sw = (w - 0.34) / n;
      for (let i = 0; i < n; i++) {
        const lx = -w / 2 + 0.17 + sw * (i + 0.5);
        p(lx, 0.06, 0.34, sw - 0.03, 0.13, 0.66, col);
        p(lx, -0.28, 0.4, sw - 0.03, 0.42, 0.2, [col[0] * 1.04, col[1] * 1.04, col[2] * 1.04]);
      }
      p(0, -0.37, 0.1, w, 0.62, 0.16, col);
      for (const sx of [-1, 1]) p(sx * (w / 2 - 0.08), 0, 0.1, 0.16, 0.5, 0.9, col);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(sx * (w / 2 - 0.1), sz * 0.36, 0, 0.05, 0.1, 0.05, PAL.walnut);
      collide(u, v, w, 0.9, fu, fv, 0.8);
    };
    const chair = (u: number, v: number, fu: number, fv: number, col: RGB, seat: RGB = col) => {
      const p = at(u, v, fu, fv);
      for (const sx of [-0.19, 0.19]) for (const sz of [-0.19, 0.19]) p(sx, sz, 0, 0.035, 0.45, 0.035, col);
      p(0, 0, 0.45, 0.46, 0.05, 0.46, seat);
      p(0, -0.21, 0.5, 0.44, 0.4, 0.04, col);
    };
    const officeChair = (u: number, v: number, fu: number, fv: number) => {
      const p = at(u, v, fu, fv);
      p(0, 0, 0.04, 0.6, 0.03, 0.06, PAL.black); p(0, 0, 0.04, 0.06, 0.03, 0.6, PAL.black);
      cyl(metal, u, v, 0.06, 0.025, 0.025, 0.38, PAL.steel, 8);
      p(0, 0, 0.44, 0.5, 0.08, 0.48, PAL.dark);
      p(0, -0.24, 0.56, 0.46, 0.55, 0.05, PAL.black);
      for (const sx of [-0.25, 0.25]) p(sx, 0, 0.6, 0.05, 0.04, 0.26, PAL.black);
    };
    const table = (u: number, v: number, w: number, d: number, fu: number, fv: number, top: RGB, legs: RGB = PAL.black, h = 0.74) => {
      const p = at(u, v, fu, fv);
      p(0, 0, h - 0.035, w, 0.035, d, top, gloss);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0, 0.045, h - 0.035, 0.045, legs, metal);
      collide(u, v, w, d, fu, fv, h);
    };
    const lamp = (u: number, v: number, h = 1.55) => {
      cyl(metal, u, v, 0, 0.14, 0.14, 0.02, PAL.black, 16);
      cyl(metal, u, v, 0.02, 0.012, 0.012, h - 0.3, PAL.brass, 6);
      cyl(glow, u, v, h - 0.32, 0.12, 0.17, 0.26, PAL.lamp, 18);
    };
    const shelf = (u: number, v: number, fu: number, fv: number, w = 1.6, h = 2.0) => {
      const p = at(u, v, fu, fv);
      p(0, -0.15, 0, w, h, 0.02, PAL.woodLight);
      for (const sx of [-1, 1]) p(sx * (w / 2 - 0.01), 0, 0, 0.02, h, 0.32, PAL.woodLight);
      const levels = Math.round(h / 0.38);
      for (let l = 0; l <= levels; l++) {
        const ly = (l / levels) * (h - 0.02);
        p(0, 0, ly, w, 0.02, 0.32, PAL.woodLight);
        if (l === levels) break;
        let x = -w / 2 + 0.05;
        while (x < w / 2 - 0.08) {
          const bw = 0.025 + R() * 0.035, bh = 0.2 + R() * 0.1;
          if (R() < 0.85) p(x + bw / 2, 0, ly + 0.02, bw, bh, 0.22, pick(PAL.books));
          x += bw + (R() < 0.1 ? 0.12 : 0.003);
        }
      }
      collide(u, v, w, 0.34, fu, fv, h);
    };
    const kitchenRun = (u: number, v: number, fu: number, fv: number, w: number) => {
      const p = at(u, v, fu, fv), cab = pick(PAL.cabinet);
      p(0, 0, 0.1, w, 0.78, 0.6, cab);
      p(0, 0.02, 0, w - 0.04, 0.1, 0.52, PAL.black);
      for (let x = -w / 2 + 0.6; x < w / 2 - 0.1; x += 0.6) p(x, 0.301, 0.14, 0.008, 0.7, 0.01, PAL.black);
      p(0, 0, 0.88, w + 0.03, 0.04, 0.64, PAL.counter, gloss);
      p(-w * 0.18, 0.02, 0.905, 0.55, 0.01, 0.4, PAL.steel, metal); // sink
      cyl(metal, u + fu * -0.22 + fv * (-w * 0.18), v + fv * -0.22 - fu * (-w * 0.18), 0.92, 0.012, 0.012, 0.3, PAL.steel, 8);
      p(w * 0.22, 0, 0.905, 0.6, 0.012, 0.52, PAL.black, gloss); // cooktop
      p(0, -0.12, 1.45, w, 0.72, 0.36, cab); // uppers
      p(0, -0.3, 0.92, w, 0.53, 0.02, hex(0xdedbd5), gloss); // backsplash
      p(w / 2 + 0.42, 0, 0, 0.8, 2.05, 0.66, PAL.steel, metal); // fridge
      collide(u, v, w + 1.7, 0.66, fu, fv, 2.1);
    };
    const bed = (u: number, v: number, fu: number, fv: number) => {
      const p = at(u, v, fu, fv), duvet = pick(PAL.duvet);
      p(0, 0, 0.12, 1.65, 0.2, 2.1, PAL.wood);
      p(0, 0.02, 0.32, 1.55, 0.2, 2.0, PAL.white);
      p(0, 0.25, 0.52, 1.6, 0.06, 1.45, duvet);
      p(0, 0.98, 0.42, 1.6, 0.12, 0.08, duvet);
      for (const sx of [-0.4, 0.4]) p(sx, -0.78, 0.52, 0.62, 0.14, 0.38, PAL.linen);
      p(0, -1.08, 0, 1.75, 1.1, 0.08, PAL.wood);
      for (const sx of [-1.12, 1.12]) {
        p(sx, -0.8, 0, 0.48, 0.5, 0.42, PAL.walnut);
        const lu = u + fv * sx + fu * -0.8, lv = v - fu * sx + fv * -0.8;
        cyl(glow, lu, lv, 0.5, 0.09, 0.12, 0.22, PAL.lamp, 14);
      }
      collide(u, v, 2.6, 2.2, fu, fv, 1.1);
    };
    const tv = (u: number, v: number, fu: number, fv: number) => {
      const p = at(u, v, fu, fv);
      p(0, 0, 0.08, 1.8, 0.42, 0.42, PAL.walnut);
      for (const sx of [-0.8, 0.8]) p(sx, 0, 0, 0.04, 0.08, 0.36, PAL.black, metal);
      p(0, -0.05, 0.62, 1.45, 0.84, 0.04, PAL.black, gloss);
      p(0, -0.025, 0.66, 1.4, 0.78, 0.01, PAL.screen, glow);
      collide(u, v, 1.8, 0.45, fu, fv, 1.5);
    };
    const deskSet = (u: number, v: number, fu: number, fv: number) => {
      const p = at(u, v, fu, fv);
      p(0, 0, 0.72, 1.5, 0.03, 0.75, PAL.woodLight, gloss);
      for (const sx of [-0.7, 0.7]) { p(sx, 0, 0, 0.05, 0.72, 0.65, PAL.white, metal); }
      p(0, 0.2, 0.75, 0.04, 0.22, 0.04, PAL.dark, metal);
      p(0, 0.2, 0.95, 0.6, 0.36, 0.025, PAL.black, gloss);
      p(0, 0.187, 0.97, 0.56, 0.32, 0.005, PAL.screen, glow);
      p(0, -0.12, 0.755, 0.42, 0.012, 0.13, PAL.white);
      officeChair(u - fu * 0.65, v - fv * 0.65, fu, fv);
      collide(u, v, 1.5, 0.75, fu, fv, 1.1);
    };
    const rug = (u: number, v: number, w: number, d: number, fu: number, fv: number) => at(u, v, fu, fv)(0, 0, 0.002, w, 0.012, d, pick(PAL.rug));

    if (kind === 'office' || kind === 'tower') {
      lightGrid(3.6, y + H - 0.02);
      if (f === 0) {
        // Lobby: a stone reception desk facing the door, a lounge, plants.
        const ru = du + (F.u(din.x, din.z)) * 5, rv = dv + (F.v(din.x, din.z)) * 5;
        const fu = -F.u(din.x, din.z), fv = -F.v(din.x, din.z);
        const r: Rect = { u0: ru - 2, u1: ru + 2, v0: rv - 2, v1: rv + 2 };
        if (fits(r, 0.3) && !occupied.some((o) => o !== doorZone && overlap(o, r))) {
          occupied.push(r);
          const p = at(ru, rv, fu, fv);
          p(0, 0, 0.06, 3.2, 1.0, 0.8, PAL.stone);
          p(0, 0, 0, 3.0, 0.06, 0.7, PAL.black);
          p(0, -0.05, 1.06, 3.4, 0.05, 0.95, PAL.walnut, gloss);
          p(0.7, -0.25, 1.11, 0.5, 0.32, 0.02, PAL.black, gloss);
          collide(ru, rv, 3.4, 0.95, fu, fv, 1.1);
          robot(ru - fu * 1.0, rv - fv * 1.0, fu, fv);
        }
        placeGrid(3.6, 3.0, 6, 5, 1, 3, (u, v) => { rug(u, v, 3.4, 2.6, 0, 1); sofa(u, v - 0.8, 0, 1, sofaCol()); table(u, v + 0.4, 1.1, 0.6, 0, 1, PAL.walnut, PAL.black, 0.4); });
        placeGrid(0.8, 0.8, 7, 6, 0.8, 8, (u, v) => plant(u, v, 1.3));
      } else {
        placeGrid(3.2, 1.7, 3.6, 3.4, 1.0, 120, (u, v, k) => {
          if (R() < 0.12) { // meeting table
            table(u, v, 3.0, 1.3, 0, 1, PAL.woodLight, PAL.dark);
            for (const s of [-1, 0, 1]) for (const t of [-1, 1]) officeChair(u + s * 0.9, v + t * 0.95, 0, -t);
            return;
          }
          // Benching: two desks each side of a felt divider, monitors, task chairs.
          for (const t of [-1, 1]) {
            for (const s of [-0.8, 0.8]) {
              const p = at(u + s, v + t * 0.4, 0, -t);
              p(0, 0, 0.72, 1.5, 0.03, 0.76, PAL.white, gloss);
              p(-0.7, 0, 0, 0.05, 0.72, 0.6, PAL.steel, metal); p(0.7, 0, 0, 0.05, 0.72, 0.6, PAL.steel, metal);
              p(0, 0.2, 0.75, 0.04, 0.2, 0.04, PAL.dark, metal);
              p(0, 0.2, 0.93, 0.62, 0.38, 0.025, PAL.black, gloss);
              p(0, 0.187, 0.95, 0.58, 0.34, 0.005, PAL.screen, glow);
              p(0, -0.1, 0.755, 0.42, 0.012, 0.13, PAL.white);
              if (R() < 0.3) cyl(gloss, u + s + 0.45, v + t * 0.35, 0.75, 0.04, 0.035, 0.1, PAL.white, 10);
              officeChair(u + s, v + t * 1.1, 0, t);
            }
            fbox(solid, null, u, v, y + 0.72, 3.2, 0.42, 0.04, hex(0x7f8a95));
          }
          collide(u, v, 3.2, 1.6, 0, 1, 1.2);
          if (k % 9 === 4) robot(u + 2, v, 0, 1);
        });
        placeGrid(0.8, 0.8, 9, 8, 0.7, 10, (u, v) => plant(u, v, 1.2));
      }
    } else if (kind === 'apartments' || kind === 'house') {
      downlights(2.4, y + H);
      if (f === 0 && kind === 'apartments') {
        // Lobby: brass mailboxes, a bench, plants, a pendant.
        placeGrid(2.4, 0.4, 6, 6, 0.4, 2, (u, v) => {
          const p = at(u, v, 0, 1);
          p(0, 0, 0.8, 2.4, 1.2, 0.36, PAL.walnut);
          for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) p(-1.0 + c * 0.4, 0.185, 0.9 + r * 0.28, 0.34, 0.22, 0.01, PAL.brass, metal);
          collide(u, v, 2.4, 0.4, 0, 1, 2);
        });
        placeGrid(1.8, 0.5, 6, 5, 0.6, 3, (u, v) => { const p = at(u, v, 0, 1); p(0, 0, 0.4, 1.8, 0.06, 0.45, PAL.woodLight, gloss); for (const sx of [-0.8, 0.8]) p(sx, 0, 0, 0.06, 0.4, 0.4, PAL.black, metal); collide(u, v, 1.8, 0.5, 0, 1, 0.5); });
        placeGrid(0.8, 0.8, 5, 5, 0.6, 6, (u, v) => plant(u, v, 1.2));
      } else {
        // A home: living, dining, kitchen, bedroom and study, spread over the floor.
        const clusters = ['living', 'dining', 'kitchen', 'bed', 'bed', 'living', 'study'];
        placeGrid(3.8, 3.2, 5.2, 4.6, 0.5, kind === 'house' ? 4 : 40, (u, v, k) => {
          const what = clusters[(k + f) % clusters.length];
          if (what === 'living') {
            rug(u, v, 3.0, 2.3, 0, 1);
            sofa(u, v - 0.95, 0, 1, sofaCol());
            table(u, v + 0.05, 1.1, 0.6, 0, 1, PAL.walnut, PAL.black, 0.4);
            tv(u, v + 1.35, 0, -1);
            lamp(u + 1.55, v - 1.1);
            if (R() < 0.6) { const p = at(u - 1.5, v, 1, 0); p(0, 0, 0.1, 0.8, 0.3, 0.8, sofaCol()); p(0, -0.32, 0.1, 0.8, 0.65, 0.16, PAL.sofa[0]); }
          } else if (what === 'dining') {
            table(u, v, 1.8, 0.95, 0, 1, PAL.wood, PAL.walnut);
            for (const s of [-0.45, 0.45]) for (const t of [-1, 1]) chair(u + s, v + t * 0.75, 0, -t, PAL.walnut, PAL.linen);
            fbox(glow, null, u, v, y + H - 0.9, 0.5, 0.18, 0.5, PAL.lamp);
            fbox(metal, null, u, v, y + H - 0.72, 0.012, 0.7, 0.012, PAL.black);
          } else if (what === 'kitchen') {
            kitchenRun(u - 0.4, v - 0.9, 0, 1, 2.6);
            const p = at(u, v + 0.7, 0, 1);
            p(0, 0, 0, 1.8, 0.9, 0.8, PAL.white); p(0, 0, 0.9, 1.9, 0.04, 0.9, PAL.counter, gloss);
            for (const s of [-0.5, 0.5]) { cyl(metal, u + s, v + 1.45, 0, 0.012, 0.012, 0.65, PAL.black, 6); cyl(solid, u + s, v + 1.45, 0.65, 0.18, 0.18, 0.05, PAL.leather, 14); }
            collide(u, v + 0.7, 1.9, 0.9, 0, 1, 1);
          } else if (what === 'bed') {
            rug(u, v + 0.2, 2.6, 2.6, 0, 1);
            bed(u, v, 0, 1);
          } else {
            deskSet(u - 0.5, v, 0, -1);
            shelf(u + 1.2, v + 0.9, -1, 0, 1.2, 1.9);
            lamp(u - 1.4, v - 0.8, 1.4);
          }
        });
        placeGrid(0.8, 0.8, 6, 6, 0.5, 6, (u, v) => plant(u, v, 1.1));
      }
    } else if (kind === 'shop') {
      lightGrid(3, y + H - 0.02);
      if (f === 0) {
        const ru = du + F.u(din.x, din.z) * 3.2, rv = dv + F.v(din.x, din.z) * 3.2;
        const fu = -F.u(din.x, din.z), fv = -F.v(din.x, din.z);
        const p = at(ru + 2.4 * fv, rv - 2.4 * fu, fu, fv);
        p(0, 0, 0, 1.8, 1.0, 0.7, PAL.walnut); p(0, 0, 1.0, 1.9, 0.04, 0.75, PAL.counter, gloss);
        p(0.4, 0.1, 1.04, 0.32, 0.24, 0.28, PAL.black, gloss); p(0.4, 0.04, 1.1, 0.26, 0.16, 0.005, hex(0x7fd0ff), glow);
        collide(ru + 2.4 * fv, rv - 2.4 * fu, 1.9, 0.75, fu, fv, 1.1);
        // Gondola shelving stocked with goods.
        placeGrid(3.6, 0.9, 4.2, 2.4, 0.8, 30, (u, v) => {
          const q = at(u, v, 0, 1);
          q(0, 0, 0, 3.6, 0.12, 0.9, PAL.black);
          q(0, 0, 0.12, 3.6, 1.55, 0.06, PAL.steel, metal);
          for (let sl = 0; sl < 4; sl++) {
            const ly = 0.2 + sl * 0.42;
            for (const side of [-1, 1]) {
              q(0, side * 0.22, ly, 3.6, 0.02, 0.4, PAL.steel, metal);
              let x = -1.72;
              while (x < 1.7) { const bw = 0.12 + R() * 0.18; q(x + bw / 2, side * 0.24, ly + 0.02, bw - 0.01, 0.14 + R() * 0.2, 0.26, pick(PAL.signs)); x += bw; }
            }
          }
          collide(u, v, 3.6, 0.9, 0, 1, 1.8);
        });
        placeGrid(1.0, 0.8, 8, 8, 0.4, 3, (u, v) => {
          const q = at(u, v, 0, 1);
          q(0, 0, 0, 1.0, 2.0, 0.8, PAL.steel, metal); q(0, 0.405, 0.15, 0.85, 1.7, 0.01, hex(0xdff3ff), glow);
          for (let sl = 0; sl < 4; sl++) for (let c = 0; c < 5; c++) q(-0.34 + c * 0.17, 0.25, 0.2 + sl * 0.42, 0.1, 0.24, 0.1, pick(PAL.signs));
          collide(u, v, 1.0, 0.8, 0, 1, 2);
        });
        placeGrid(0.6, 0.6, 9, 9, 1.5, 2, (u, v) => robot(u, v, 0, 1));
      } else storage(placeGrid, fbox, solid, owner, y, R);
    } else if (kind === 'warehouse') {
      // High-bay lights and yellow safety lines on the epoxy floor.
      for (let u = uMin + 3; u < uMax - 2; u += 6) for (let v = vMin + 3; v < vMax - 2; v += 6) {
        if (!fits({ u0: u - 0.5, u1: u + 0.5, v0: v - 0.5, v1: v + 0.5 }, 0.3)) continue;
        cyl(metal, u, v, H - 0.9, 0.3, 0.38, 0.35, PAL.steel, 18);
        cyl(glow, u, v, H - 0.92, 0.3, 0.3, 0.02, PAL.lamp, 18);
        fbox(metal, null, u, v, y + H - 0.55, 0.01, 0.55, 0.01, PAL.black);
      }
      for (let v = vMin + 2.5; v < vMax - 2; v += 7) fbox(solid, null, (uMin + uMax) / 2, v, y + 0.003, uMax - uMin - 2, 0.004, 0.1, hex(0xe0b420));
      storage(placeGrid, fbox, solid, owner, y, R, true);
    } else if (kind === 'mall') {
      downlights(3, y + H);
      // Shopfronts: glass, a lit interior, a big sign band; benches and planters with trees between.
      placeGrid(7, 5, 11, 10, 1.0, 40, (u, v, k) => {
        const col = PAL.signs[(k + f * 3) % PAL.signs.length];
        const p = at(u, v, 0, 1);
        p(0, 0, 0, 7, 3.4, 5, PAL.white);
        p(0, 2.505, 0.05, 6.6, 2.5, 0.02, hex(0xfff3dc), glow);
        p(0, 2.53, 0, 6.8, 3.0, 0.03, PAL.glass, glass);
        for (const sx of [-3.4, -1.1, 1.1, 3.4]) p(sx, 2.56, 0, 0.06, 3.0, 0.08, PAL.frame, metal);
        p(0, 2.6, 3.0, 7.2, 0.5, 0.2, PAL.dark);
        p(0, 2.71, 3.08, 3.6, 0.32, 0.02, col, glow);
        collide(u, v, 7, 5, 0, 1, 3.5);
      });
      placeGrid(2.2, 0.6, 7, 6, 1.0, 20, (u, v) => { const p = at(u, v, 0, 1); p(0, 0, 0.4, 2.2, 0.06, 0.55, PAL.woodLight, gloss); for (const sx of [-1, 1]) p(sx, 0, 0, 0.08, 0.4, 0.5, PAL.steel, metal); collide(u, v, 2.2, 0.6, 0, 1, 0.5); });
      placeGrid(1.6, 1.6, 9, 9, 1.0, 16, (u, v) => {
        const p = at(u, v, 0, 1);
        p(0, 0, 0, 1.6, 0.55, 1.6, PAL.stone); p(0, 0, 0.55, 1.45, 0.02, 1.45, hex(0x2f2620));
        cyl(solid, u, v, 0.55, 0.06, 0.09, 1.6, PAL.wood, 8);
        for (let i = 0; i < 40; i++) {
          const a = R() * 6.28, rr = Math.sqrt(R()) * 0.75, hh = 1.7 + R() * 1.0;
          const g = new THREE.SphereGeometry(1, 6, 3); g.scale(0.07, 0.01, 0.14);
          shape(leaves, g, u + Math.cos(a) * rr, v + Math.sin(a) * rr, hh, R() < 0.5 ? PAL.plant : PAL.plant2, new THREE.Euler(-0.4 - R(), R() * 6.28, 0, 'YXZ'));
        }
        collide(u, v, 1.6, 1.6, 0, 1, 0.6);
      });
      placeGrid(0.6, 0.6, 12, 10, 2, 5, (u, v) => robot(u, v, 1, 0));
    } else if (kind === 'church') {
      // Nave along the long axis: altar at the end away from the door, pews facing it.
      const dirU = Math.sign(F.u(din.x, din.z)) || 1; // from the door into the nave
      const altarU = dirU > 0 ? uMax - 3 : uMin + 3;
      const cv = (vMin + vMax) / 2;
      const alt = at(altarU, cv, -dirU, 0);
      alt(0, 0, 0, 1.4, 0.3, 3.4, PAL.stone);
      alt(0, 0, 0.3, 1.2, 0.95, 3.0, PAL.white);
      alt(0, 0.01, 1.25, 1.3, 0.04, 3.1, PAL.linen);
      collide(altarU, cv, 1.4, 3.4, -dirU, 0, 1.3);
      fbox(solid, null, altarU - dirU * 6, cv, y, 9, 0.012, 1.8, hex(0x8a2f2f), -dirU, 0);
      fbox(glow, null, altarU + dirU * 1.6, cv, y + 3.5, 0.15, 3.2, 0.15, hex(0xe8c35a));
      fbox(glow, null, altarU + dirU * 1.6, cv, y + 5.6, 0.15, 0.15, 1.6, hex(0xe8c35a));
      for (const sv of [-1.1, -0.6, 0.6, 1.1]) { cyl(metal, altarU, cv + sv, 1.29, 0.04, 0.05, 0.08, PAL.brass, 10); cyl(gloss, altarU, cv + sv, 1.37, 0.025, 0.025, 0.3, PAL.white, 8); fbox(glow, null, altarU, cv + sv, y + 1.68, 0.02, 0.05, 0.02, PAL.lamp); }
      const halfW = (vMax - vMin) / 2 - 1.2;
      for (let u = (dirU > 0 ? uMin + 5 : uMax - 5); dirU > 0 ? u < altarU - 3 : u > altarU + 3; u += dirU * 1.1) {
        for (const side of [-1, 1]) {
          const pw = Math.max(1.5, halfW - 1.2), pv = cv + side * (0.9 + pw / 2);
          const r: Rect = { u0: u - 0.35, u1: u + 0.35, v0: pv - pw / 2, v1: pv + pw / 2 };
          if (!fits(r, 0.4) || occupied.some((o) => overlap(o, r))) continue;
          const p = at(u, pv, dirU, 0);
          p(0, 0, 0.42, pw, 0.05, 0.42, PAL.walnut, gloss);
          p(0, -0.22, 0.42, pw, 0.52, 0.05, PAL.walnut, gloss);
          p(0, 0.3, 0.12, pw, 0.06, 0.18, PAL.walnut); // kneeler
          for (const sx of [-1, 1]) p(sx * (pw / 2 - 0.03), -0.02, 0, 0.06, 0.95, 0.5, PAL.walnut, gloss);
          collide(u, pv, pw, 0.5, dirU, 0, 1);
        }
      }
      // Stone columns and arches down both sides, timber beams across the roof.
      for (let u = uMin + 3; u < uMax - 2; u += 4.5) for (const side of [-1, 1]) {
        const v = cv + side * (halfW - 0.4);
        if (!fits({ u0: u - 0.4, u1: u + 0.4, v0: v - 0.4, v1: v + 0.4 }, 0.2)) continue;
        cyl(solid, u, v, 0, 0.42, 0.42, 0.4, PAL.stone, 16);
        cyl(solid, u, v, 0.4, 0.32, 0.32, H * 0.62, PAL.stone, 16);
        cyl(solid, u, v, 0.4 + H * 0.62, 0.42, 0.32, 0.4, PAL.stone, 16);
        collide(u, v, 0.8, 0.8, 0, 1, H);
      }
      for (let u = uMin + 3; u < uMax - 2; u += 4.5) fbox(solid, null, u, cv, y + H - 0.6, 0.3, 0.35, vMax - vMin - 0.6, PAL.walnut);
      // Chandeliers.
      for (let u = uMin + 5; u < uMax - 4; u += 9) {
        fbox(metal, null, u, cv, y + H * 0.55, 0.012, H * 0.45, 0.012, PAL.black);
        cyl(metal, u, cv, H * 0.55 - 0.05, 0.6, 0.6, 0.04, PAL.brass, 20);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; fbox(glow, null, u + Math.cos(a) * 0.58, cv + Math.sin(a) * 0.58, y + H * 0.55, 0.04, 0.12, 0.04, PAL.lamp); }
      }
      downlights(5, y + H - 0.05);
    }

    // Build meshes.
    const group = new THREE.Group();
    group.name = owner;
    const add = (m: THREE.Mesh | null, opts: { uv?: boolean; cast?: boolean; receive?: boolean } = {}) => {
      if (!m) return;
      if (opts.uv) planarUV(m.geometry);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      group.add(m);
    };
    add(floorB.mesh(floorMat(f)), { uv: true });
    add(solid.mesh(solidMat), { cast: true });
    add(gloss.mesh(glossMat), { cast: true });
    add(metal.mesh(metalMat), { cast: true });
    add(leaves.mesh(leafMat), { cast: true });
    add(glow.mesh(glowMat), { receive: false });
    add(ceil.mesh(ceilMat), { uv: true, cast: true });
    add(glass.mesh(glassMat), { receive: false });
    if (view.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(view, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(viewUv, 2));
      const m = new THREE.Mesh(g, viewMat);
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    return { group, inter };
  }

  // Make hole rings wind opposite to the contour (ShapeUtils is tolerant, but be tidy).
  function orient(r: number[]) { return (signedArea(r) > 0) === ccw ? [r[6], r[7], r[4], r[5], r[2], r[3], r[0], r[1]] : r; }

  /** Point the sun light the way the real sun shines, centered on the floor you're on. */
  function aimSun() {
    const out = info.sun;
    if (out) {
      sunDir.subVectors(out.position, out.target.position).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -(info.view?.yaw ?? 0));
      sun.color.copy(out.color);
      sun.intensity = sunDir.y > 0.02 ? out.intensity * 0.9 : 0;
    }
    const cy = cur * H + H / 2;
    sun.target.position.set(0, cy, 0);
    sun.position.set(sunDir.x * 80, cy + sunDir.y * 80, sunDir.z * 80);
  }
  function setFloor(f: number) {
    cur = f;
    for (const [k, fl] of floorsLoaded) if (Math.abs(k - f) > 1) {
      scene.remove(fl.group);
      fl.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      colliders.removeOwner(`floor:${k}`);
      floorsLoaded.delete(k);
    }
    for (let k = f - 1; k <= f + 1; k++) {
      if (k < 0 || k >= floors || floorsLoaded.has(k)) continue;
      const fl = buildFloor(k);
      floorsLoaded.set(k, fl);
      scene.add(fl.group);
    }
    // Floors above you are hidden, so a high camera sees down into this one.
    for (const [k, fl] of floorsLoaded) fl.group.visible = k <= f;
    lift?.view(f);
    if (views.show(f)) hemi.intensity = 0.9;
    aimSun();
    api.floor = f;
    api.title = `${info.name ?? KIND_NAME[kind]}${floors > 1 ? ` · ${f === 0 ? 'ground floor' : `floor ${f + 1}`}` : ''}`;
    api.onInteractionsChanged?.();
  }

  // ---- Walking: floors, and the stair ramps between them ----
  const rampY = (k: number, x: number, z: number) => {
    if (!core || k < 0 || k >= floors - 1) return -Infinity;
    const lane = k % 2, r = laneRect(lane), u = F.u(x, z), v = F.v(x, z);
    if (!inRect(r, u, v)) return -Infinity;
    const t = lane === 0 ? (u - r.u0) / core.len : (r.u1 - u) / core.len;
    return k * H + Math.max(0, Math.min(1, t)) * H;
  };
  const slabY = (k: number, x: number, z: number) => {
    if (k < 0 || k >= floors) return -Infinity;
    if (core && k >= 1 && inRect(laneRect((k - 1) % 2), F.u(x, z), F.v(x, z))) return -Infinity;
    return k * H;
  };
  const support = (x: number, z: number, y0: number) => {
    // Outside the walls (just out of the door): street level.
    if (!inRing(outer, x, z)) return 0;
    const car = lift?.floorAt(x, z);
    if (car != null) return car;
    // A query from far above (Player.setWorld drops you from +400 m) means "the floor you're on".
    const y = y0 > (cur + 1) * H + 2 ? cur * H + 0.1 : y0;
    let best = -Infinity;
    for (let k = cur - 1; k <= cur + 1; k++) {
      for (const s of [slabY(k, x, z), rampY(k, x, z)]) if (s <= y + 0.6 && s > best) best = s;
    }
    return best === -Infinity ? cur * H : best;
  };

  // ---- The lift: every floor, and the roof ----
  let lift: Lift | null = null;
  if (liftBase) {
    const stops: LiftStop[] = Array.from({ length: floors }, (_, f) => ({
      y: f * H, label: f === 0 ? 'G' : String(f + 1), title: f === 0 ? (floors > 1 ? 'Ground floor · lobby' : 'Ground floor') : `Floor ${f + 1}`,
    }));
    stops.push({ y: floors * H, label: 'R', title: 'Roof · step out on top' });
    const vc = liftBase.v0 + 0.2 + LIFT_D / 2;
    lift = new Lift({
      parent: scene, colliders, x: F.x(liftBase.u, vc), z: F.z(liftBase.u, vc), yaw: F.yaw(0, 1),
      w: LIFT_W, d: LIFT_D, stops, wallColor: 0xd9d6cf, id: `b${info.key}`,
      onDepart: (to) => { if (to < floors) setFloor(to); },
      onArrive: (to) => { if (to === floors) api.onExit?.('roof', floors); },
    });
  }

  const world: PlayerWorld = {
    colliders,
    groundY: (x, z) => support(x, z, cur * H + 0.5),
    support,
    canFly: false,
  };
  // Inside the door zone (kept clear of the core and furniture), deep enough for the camera.
  const inDepth = Math.min(2.9, Math.max(1.8, (Math.min(uMax - uMin, vMax - vMin)) / 2 - 1));
  const spawn = new THREE.Vector3(doorX + din.x * inDepth, 0, doorZ + din.z * inDepth);
  const api: GenericInterior = {
    scene, world, spawn, spawnFacing: Math.atan2(din.x, din.z), floor: 0, floors, kind, title: '',
    onExit: null, onInteractionsChanged: null,
    update(dt, p) {
      lift?.update(dt, p);
      aimSun();
      if (lift?.moving) return;
      const f = Math.max(0, Math.min(floors - 1, Math.floor((p.position.y + 0.8) / H)));
      if (f !== cur) setFloor(f);
    },
    interactions() { return floorsLoaded.get(cur)?.inter ?? []; },
    dispose() {
      for (const fl of floorsLoaded.values()) fl.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      floorsLoaded.clear();
      colliders.clear();
      solidMat.dispose(); glowMat.dispose(); viewMat.dispose(); glossMat.dispose(); metalMat.dispose(); glassMat.dispose(); leafMat.dispose();
      for (const m of surfs) { const sm = m as THREE.MeshStandardMaterial; sm.map?.dispose(); sm.normalMap?.dispose(); sm.roughnessMap?.dispose(); m.dispose(); }
      views.dispose();
      roomEnv?.dispose();
      lift?.dispose();
    },
  };
  setFloor(0);
  return api;
}

/** Storage rooms and warehouses: shelving racks stacked with boxes, pallets. */
function storage(
  placeGrid: (w: number, d: number, su: number, sv: number, margin: number, max: number, fn: (u: number, v: number, k: number) => void) => void,
  fbox: (buf: Buf, owner: string | null, u: number, v: number, y0: number, w: number, h: number, d: number, col: RGB) => void,
  solid: Buf, owner: string, y: number, R: () => number, tall = false,
) {
  const levels = tall ? 4 : 3, lh = tall ? 1.6 : 0.8;
  placeGrid(6, 1.1, 7, 3.4, 0.6, 60, (u, v) => {
    for (const s of [-2.9, 0, 2.9]) for (const t of [-0.5, 0.5]) fbox(solid, null, u + s, v + t, y, 0.1, levels * lh + 0.2, 0.1, hex(0x3f6fb0));
    fbox(solid, owner, u, v, y, 6, 0.05, 1.1, hex(0xd96b2c));
    for (let l = 1; l <= levels; l++) {
      fbox(solid, null, u, v, y + l * lh, 6, 0.06, 1.1, hex(0xd96b2c));
      for (let b = 0; b < 5; b++) if (R() < 0.8) {
        const bw = 0.7 + R() * 0.4;
        fbox(solid, null, u - 2.4 + b * 1.2, v, y + (l - 1) * lh + 0.06, bw, Math.min(lh - 0.15, 0.4 + R() * 0.5), 0.8, PAL.boxes[Math.floor(R() * 3)]);
      }
    }
  });
  placeGrid(1.2, 1.0, 8, 6, 0.8, 12, (u, v) => {
    fbox(solid, owner, u, v, y, 1.2, 0.15, 1.0, PAL.woodLight);
    fbox(solid, null, u, v, y + 0.15, 1.0, 0.6 + R() * 0.6, 0.85, PAL.boxes[Math.floor(R() * 3)]);
  });
}

/** Window/door view quad wound to face into the room (normal = inward). */
function pushView(pos: number[], uv: number[], a: number[], b: number[], c: number[], d: number[], quv: number[], nin: { x: number; z: number }) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1], nz = e1[0] * e2[1] - e1[1] * e2[0];
  const P = [a, b, c, d], U = [[quv[0], quv[1]], [quv[2], quv[3]], [quv[4], quv[5]], [quv[6], quv[7]]];
  const order = nx * nin.x + nz * nin.z >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const i of order) { pos.push(...P[i]); uv.push(...U[i]); }
}
