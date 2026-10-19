// Interiors for any building on Earth, generated from its real footprint: churches with pews,
// malls with shopfronts, apartments, offices, shops, storage rooms. Stairs between floors, a lift
// in anything over three floors, and you can always jump out of a window.
import * as THREE from 'three';
import { Colliders, type PlayerWorld } from '../player.ts';
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
  update(dt: number, player: { position: THREE.Vector3; facing: number }): void;
  dispose(): void;
  /** Interactions for the floor you're on (they change when you change floors). */
  interactions(): RoomInteraction[];
  /** Called when interactions() changes (new floor): re-read it. */
  onInteractionsChanged: (() => void) | null;
  onExit: ((how: 'door' | 'window', floor: number) => void) | null;
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

/** Pastel furniture palette, like the game's soft toy look. */
const PAL = {
  wood: hex(0xa8794f), woodLight: hex(0xc99d6b), white: hex(0xf2f1ee), grey: hex(0x8d939b), dark: hex(0x3d434b), black: hex(0x24272c),
  sofa: [hex(0x6f9fc4), hex(0xd98c7a), hex(0x7ea870), hex(0xe2c27a), hex(0x9a86b8)], rug: [hex(0xc96f5b), hex(0x5f8db0), hex(0xd9b26a)],
  plant: hex(0x5f9e4a), pot: hex(0xc4774e), metal: hex(0xb8bec6), screen: hex(0x2b3a4a), glass: hex(0x9cc7de),
  signs: [hex(0xe0533d), hex(0x2f8fd0), hex(0x3fa66a), hex(0xf0b43c), hex(0x9a5bc4), hex(0xec7aa8), hex(0x24a5a5)],
  boxes: [hex(0xc89a5c), hex(0xb88a52), hex(0xd8b07a)],
  stained: [hex(0xd8413a), hex(0x2f6fd0), hex(0xe8b830), hex(0x3fa66a), hex(0x8a4fc4)],
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

  // ---- Core: switchback stairs (two lanes) and a lift ----
  const hasLift = floors > 3;
  type Core = { cu: number; cv: number; len: number; lane: number };
  let core = null as Core | null;
  if (floors > 1) {
    const cu0 = F.u(0, 0), cv0 = F.v(0, 0);
    for (const len of [Math.min(7, H * 1.9), 4.6, 3.6]) {
      let best = null as Core | null, bs = Infinity;
      for (let u = uMin; u <= uMax; u += 0.75) for (let v = vMin; v <= vMax; v += 0.75) {
        const r: Rect = { u0: u - len / 2 - 1.3, u1: u + len / 2 + 1.3, v0: v - 1.7, v1: v + (hasLift ? 5.2 : 1.7) };
        if (overlap(r, doorZone) || !fits(r, 0.2)) continue;
        const s = Math.hypot(u - cu0, v - cv0) * (kind === 'house' ? -0.3 : 1);
        if (s < bs) { bs = s; best = { cu: u, cv: v, len, lane: 1.3 }; }
      }
      if (best) { core = best; break; }
    }
    if (!core) floors = 1;
  }
  const coreRect: Rect | null = core ? { u0: core.cu - core.len / 2 - 1.3, u1: core.cu + core.len / 2 + 1.3, v0: core.cv - 1.7, v1: core.cv + (hasLift ? 5.2 : 1.7) } : null;
  /** Lane rect (u,v) for lane 0/1. Lane 0 climbs toward +u, lane 1 toward -u. */
  const laneRect = (lane: number): Rect => {
    const c = core!;
    return { u0: c.cu - c.len / 2, u1: c.cu + c.len / 2, v0: lane === 0 ? c.cv - c.lane : c.cv, v1: lane === 0 ? c.cv : c.cv + c.lane };
  };
  const rectXZ = (r: Rect) => [F.x(r.u0, r.v0), F.z(r.u0, r.v0), F.x(r.u1, r.v0), F.z(r.u1, r.v0), F.x(r.u1, r.v1), F.z(r.u1, r.v1), F.x(r.u0, r.v1), F.z(r.u0, r.v1)];
  const inRect = (r: Rect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
  const liftDoor = core ? { u: core.cu, v: core.cv + 1.7 + 2.3 + 0.1 } : null; // just outside the lift's door face
  const liftExit = core ? { x: F.x(core.cu, core.cv + 4.6), z: F.z(core.cu, core.cv + 4.6) } : null;

  // ---- Scene ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe9f1);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x9a8f80, 2.1));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.1);
  sun.position.set(30, 80, 20);
  scene.add(sun);
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // Ceilings face down only: when the camera rises above one you look into the room (a cutaway).
  const ceilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.FrontSide });
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
    const solid = new Buf(), glow = new Buf(), ceil = new Buf();
    const view: number[] = [], viewUv: number[] = [];
    const inter: RoomInteraction[] = [];
    const R = rng(info.seed * 31 + f * 7 + 1);
    const floorCol = hex(S.floor), wallCol = hex(S.wall);

    // Floor and ceiling (with stair openings).
    const holeBelow = core && f >= 1 ? [rectXZ(laneRect((f - 1) % 2))] : [];
    const holeAbove = core && f < floors - 1 ? [rectXZ(laneRect(f % 2))] : [];
    slab(solid, outer, holeBelow.map(orient), y, true, floorCol);
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
          // Stained glass: a few colored panes.
          const cols = PAL.stained;
          const rows = 4;
          for (let k = 0; k < rows; k++) {
            const ya = p0[1] + ((p3[1] - p0[1]) * k) / rows, yb = p0[1] + ((p3[1] - p0[1]) * (k + 1)) / rows;
            glow.quad([p0[0], ya, p0[2]], [p1[0], ya, p1[2]], [p1[0], yb, p1[2]], [p0[0], yb, p0[2]], cols[(b + k + i) % cols.length]);
          }
        } else {
          const u0 = ((b + i * 3) % 7) / 7, u1 = u0 + 0.14, vv0 = 0.15 + Math.min(0.35, f * 0.01), vv1 = Math.min(1, vv0 + 0.6);
          pushView(view, viewUv, p0, p1, p2, p3, [u0, vv0, u1, vv0, u1, vv1, u0, vv1], nin);
        }
        // Window sill + frame.
        const sx = ax + ux * c + nin.x * 0.12, sz = az + uz * c + nin.z * 0.12;
        solid.box(sx, o.y0 - 0.06, sz, S.win + 0.2, 0.06, 0.3, Math.atan2(nin.x, nin.z), PAL.white);
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
      pushView(view, viewUv, q0, q1, [q1[0], y + dh, q1[2]], [q0[0], y + dh, q0[2]], [0.4, 0, 0.55, 0, 0.55, 0.75, 0.4, 0.75], din);
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
      // Lift shaft with doors and a call button.
      if (hasLift && liftDoor) {
        const lv0 = c.cv + c.lane + 0.05, lv1 = lv0 + 2.3, lu = c.cu;
        fbox(solid, owner, lu, (lv0 + lv1) / 2, y, 2.4, H, 2.3, hex(0xcfd3d8), 0, 1);
        const face = lv1 + 0.02;
        for (const s of [-0.48, 0.48]) fbox(solid, null, lu + s, face, y, 0.94, 2.2, 0.04, PAL.metal, 0, 1);
        fbox(glow, null, lu + 1.0, face, y + 1.2, 0.12, 0.16, 0.03, hex(0xffb347), 0, 1);
        fbox(glow, null, lu, face, y + 2.45, 0.6, 0.18, 0.03, hex(0x9fe0ff), 0, 1);
        const at = new THREE.Vector3(F.x(lu, liftDoor.v + 0.6), y, F.z(lu, liftDoor.v + 0.6));
        const go = (to: number, label: string, sub: string, id: string) => inter.push({ id, position: at.clone(), radius: 1.8, label, sub, action: () => travel(to) });
        if (f < floors - 1) go(f + 1, 'Lift up', `to floor ${f + 2}`, 'room:lift:up');
        if (f > 0) go(f - 1, 'Lift down', f - 1 === 0 ? 'to the lobby' : `to floor ${f}`, 'room:lift:down');
        if (floors > 8 && f < floors - 2) go(floors - 1, 'Lift to the top', `floor ${floors}`, 'room:lift:top');
        if (floors > 8 && f > 1) go(0, 'Lift to the lobby', 'ground floor', 'room:lift:lobby');
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
    const plant = (u: number, v: number) => {
      fbox(solid, owner, u, v, y, 0.5, 0.45, 0.5, PAL.pot);
      fbox(solid, null, u, v, y + 0.45, 0.8, 0.9, 0.8, PAL.plant);
      fbox(solid, null, u, v, y + 1.1, 0.55, 0.45, 0.55, [PAL.plant[0] * 1.15, PAL.plant[1] * 1.15, PAL.plant[2] * 1.1]);
    };
    const robot = (u: number, v: number, fu: number, fv: number) => {
      // A white caretaker robot standing about.
      fbox(solid, owner, u, v, y, 0.35, 0.85, 0.22, PAL.white, fu, fv);
      fbox(solid, null, u, v, y + 0.85, 0.45, 0.6, 0.28, PAL.white, fu, fv);
      fbox(solid, null, u, v, y + 1.5, 0.3, 0.32, 0.3, PAL.white, fu, fv);
      fbox(glow, null, u + fu * 0.16, v + fv * 0.16, y + 1.6, 0.22, 0.07, 0.02, hex(0x40c8ff), fu, fv);
    };
    const lightGrid = (sp: number, ly: number) => {
      for (let u = uMin + sp / 2; u < uMax; u += sp) for (let v = vMin + sp / 2; v < vMax; v += sp) {
        const x = F.x(u, v), z = F.z(u, v);
        if (!inRing(outer, x, z) || edgeDist(outer, x, z) < 0.8) continue;
        if (core && coreRect && inRect(coreRect, u, v)) continue;
        fbox(glow, null, u, v, ly, 1.2, 0.04, 0.6, hex(0xfff6e0));
      }
    };
    const sofaCol = () => PAL.sofa[Math.floor(R() * PAL.sofa.length)];

    if (kind === 'office' || kind === 'tower') {
      lightGrid(3.6, y + H - 0.06);
      if (f === 0) {
        // Lobby: reception desk facing the door, sofas, plants.
        const ru = du + (F.u(din.x, din.z)) * 5, rv = dv + (F.v(din.x, din.z)) * 5;
        const fu = -F.u(din.x, din.z), fv = -F.v(din.x, din.z);
        const r: Rect = { u0: ru - 2, u1: ru + 2, v0: rv - 2, v1: rv + 2 };
        if (fits(r, 0.3) && !occupied.some((o) => o !== doorZone && overlap(o, r))) {
          occupied.push(r);
          fbox(solid, owner, ru, rv, y, 3.2, 1.05, 0.9, PAL.white, fu, fv, PAL.wood);
          robot(ru - fu * 1.0, rv - fv * 1.0, fu, fv);
        }
        placeGrid(2.2, 0.9, 5, 4, 1, 6, (u, v) => { const c = sofaCol(); fbox(solid, owner, u, v, y, 2.2, 0.45, 0.9, c); fbox(solid, null, u, v - 0.35, y + 0.45, 2.2, 0.4, 0.2, c); });
        placeGrid(0.8, 0.8, 7, 6, 0.8, 8, (u, v) => plant(u, v));
      } else {
        placeGrid(3.2, 1.7, 3.6, 3.4, 1.0, 120, (u, v, k) => {
          if (R() < 0.12) { // meeting table
            fbox(solid, owner, u, v, y, 3.0, 0.75, 1.4, PAL.woodLight);
            for (const s of [-1, 0, 1]) for (const t of [-1, 1]) fbox(solid, null, u + s * 0.9, v + t * 1.0, y, 0.5, 0.48, 0.5, PAL.dark);
            return;
          }
          // Two desks back to back, monitors, chairs.
          for (const t of [-1, 1]) {
            for (const s of [-0.8, 0.8]) {
              fbox(solid, owner, u + s, v + t * 0.4, y, 1.5, 0.74, 0.78, PAL.white);
              fbox(glow, null, u + s, v + t * 0.12, y + 0.95, 0.62, 0.38, 0.03, PAL.screen, 0, t);
              fbox(solid, null, u + s, v + t * 0.1, y + 0.74, 0.08, 0.2, 0.08, PAL.dark);
              fbox(solid, null, u + s, v + t * 1.15, y, 0.55, 0.5, 0.55, k % 3 ? PAL.dark : PAL.sofa[k % 5]);
            }
          }
          if (k % 7 === 3) robot(u + 2, v, 0, 1);
        });
        placeGrid(0.8, 0.8, 9, 8, 0.7, 10, (u, v) => plant(u, v));
      }
    } else if (kind === 'apartments' || kind === 'house') {
      lightGrid(4.5, y + H - 0.06);
      if (f === 0 && kind === 'apartments') {
        // Lobby: mailboxes, a bench, plants.
        placeGrid(2.4, 0.4, 6, 6, 0.4, 2, (u, v) => { fbox(solid, owner, u, v, y + 0.8, 2.4, 1.2, 0.4, PAL.metal); for (let k = 0; k < 6; k++) fbox(solid, null, u - 1 + k * 0.4, v + 0.21, y + 1.0, 0.3, 0.2, 0.02, PAL.grey); });
        placeGrid(1.8, 0.5, 6, 5, 0.6, 3, (u, v) => fbox(solid, owner, u, v, y, 1.8, 0.45, 0.5, PAL.wood));
        placeGrid(0.8, 0.8, 5, 5, 0.6, 6, (u, v) => plant(u, v));
      } else {
        // A home: living, dining, kitchen, bedroom clusters, spread over the floor.
        const clusters = ['living', 'dining', 'kitchen', 'bed', 'bed', 'living', 'study'];
        placeGrid(3.6, 3.0, 5.2, 4.6, 0.5, kind === 'house' ? 4 : 40, (u, v, k) => {
          const what = clusters[(k + f) % clusters.length];
          if (what === 'living') {
            fbox(solid, null, u, v, y, 3.0, 0.02, 2.2, PAL.rug[k % 3]);
            const c = sofaCol();
            fbox(solid, owner, u, v - 0.9, y, 2.2, 0.45, 0.85, c); fbox(solid, null, u, v - 1.25, y + 0.45, 2.2, 0.45, 0.2, c);
            fbox(solid, owner, u, v + 0.1, y, 1.1, 0.4, 0.6, PAL.woodLight);
            fbox(solid, owner, u, v + 1.3, y, 1.6, 0.5, 0.4, PAL.dark); fbox(glow, null, u, v + 1.32, y + 0.55, 1.3, 0.75, 0.04, PAL.screen, 0, -1);
          } else if (what === 'dining') {
            fbox(solid, owner, u, v, y, 1.8, 0.75, 1.0, PAL.wood);
            for (const s of [-0.5, 0.5]) for (const t of [-1, 1]) fbox(solid, null, u + s, v + t * 0.75, y, 0.45, 0.47, 0.45, PAL.woodLight);
          } else if (what === 'kitchen') {
            fbox(solid, owner, u, v, y, 3.2, 0.9, 0.65, PAL.white, 0, 1, hex(0x7f8790));
            fbox(solid, null, u + 1.0, v - 0.1, y + 0.9, 0.5, 0.02, 0.4, PAL.metal);
            fbox(solid, owner, u - 1.9, v, y, 0.75, 1.8, 0.7, PAL.metal);
          } else if (what === 'bed') {
            const c = sofaCol();
            fbox(solid, owner, u, v, y, 1.6, 0.45, 2.1, PAL.wood);
            fbox(solid, null, u, v + 0.15, y + 0.45, 1.5, 0.15, 1.7, c);
            fbox(solid, null, u, v - 0.85, y + 0.45, 1.3, 0.14, 0.35, PAL.white);
            fbox(solid, owner, u + 1.1, v - 0.8, y, 0.45, 0.5, 0.45, PAL.woodLight);
          } else {
            fbox(solid, owner, u, v, y, 1.4, 0.75, 0.7, PAL.woodLight);
            fbox(glow, null, u, v + 0.2, y + 0.95, 0.55, 0.35, 0.03, PAL.screen, 0, -1);
            fbox(solid, owner, u + 1.3, v + 0.9, y, 1.0, 2.0, 0.4, PAL.wood);
          }
        });
        placeGrid(0.8, 0.8, 6, 6, 0.5, 6, (u, v) => plant(u, v));
      }
    } else if (kind === 'shop') {
      lightGrid(3, y + H - 0.06);
      if (f === 0) {
        const ru = du + F.u(din.x, din.z) * 3.2, rv = dv + F.v(din.x, din.z) * 3.2;
        fbox(solid, owner, ru + 2.4, rv, y, 1.8, 1.0, 0.7, PAL.wood, -F.u(din.x, din.z), -F.v(din.x, din.z));
        fbox(glow, null, ru + 2.4, rv, y + 1.05, 0.4, 0.25, 0.3, hex(0x7fd0ff));
        placeGrid(3.6, 0.7, 4.2, 2.3, 0.8, 30, (u, v, k) => {
          fbox(solid, owner, u, v, y, 3.6, 1.7, 0.7, PAL.white);
          for (let s = 0; s < 3; s++) for (let q = 0; q < 6; q++) {
            const col = PAL.signs[(q + s + k) % PAL.signs.length];
            fbox(solid, null, u - 1.5 + q * 0.6, v + 0.38, y + 0.2 + s * 0.55, 0.45, 0.32, 0.06, col);
            fbox(solid, null, u - 1.5 + q * 0.6, v - 0.38, y + 0.2 + s * 0.55, 0.45, 0.32, 0.06, col);
          }
        });
        placeGrid(1.0, 0.8, 8, 8, 0.4, 3, (u, v) => { fbox(solid, owner, u, v, y, 1.0, 2.0, 0.8, hex(0xdfe7ee)); fbox(glow, null, u, v + 0.41, y + 0.2, 0.8, 1.6, 0.02, hex(0xbfe6ff)); });
        placeGrid(0.6, 0.6, 9, 9, 1.5, 2, (u, v) => robot(u, v, 0, 1));
      } else storage(placeGrid, fbox, solid, owner, y, R);
    } else if (kind === 'warehouse') {
      lightGrid(6, y + H - 0.08);
      storage(placeGrid, fbox, solid, owner, y, R, true);
    } else if (kind === 'mall') {
      lightGrid(5, y + H - 0.08);
      // Store pods with glass fronts and big colored signs, benches and planters between them.
      placeGrid(7, 5, 11, 10, 1.0, 40, (u, v, k) => {
        const col = PAL.signs[(k + f * 3) % PAL.signs.length];
        fbox(solid, owner, u, v, y, 7, 3.4, 5, PAL.white, 0, 1);
        fbox(glow, null, u, v + 2.52, y + 0.3, 5.6, 2.4, 0.04, PAL.glass, 0, 1);
        fbox(glow, null, u, v + 2.56, y + 2.85, 4.2, 0.5, 0.05, col, 0, 1);
        fbox(solid, null, u, v + 2.6, y + 3.4, 7.2, 0.25, 0.5, col, 0, 1);
      });
      placeGrid(2.2, 0.6, 7, 6, 1.0, 20, (u, v) => fbox(solid, owner, u, v, y, 2.2, 0.45, 0.6, PAL.wood));
      placeGrid(1.4, 1.4, 9, 9, 1.0, 16, (u, v) => { fbox(solid, owner, u, v, y, 1.4, 0.6, 1.4, hex(0xd9d3c7)); fbox(solid, null, u, v, y + 0.6, 1.1, 0.9, 1.1, PAL.plant); });
      placeGrid(0.6, 0.6, 12, 10, 2, 5, (u, v) => robot(u, v, 1, 0));
    } else if (kind === 'church') {
      // Nave along the long axis: altar at the end away from the door, pews facing it.
      const dirU = Math.sign(F.u(din.x, din.z)) || 1; // from the door into the nave
      const altarU = dirU > 0 ? uMax - 3 : uMin + 3;
      const cv = (vMin + vMax) / 2;
      fbox(solid, owner, altarU, cv, y, 3.2, 1.0, 1.4, PAL.white, -dirU, 0, hex(0xd9b26a));
      fbox(solid, null, altarU - dirU * 6, cv, y, 1.8, 0.02, 9, hex(0x9a3b3b), -dirU, 0);
      fbox(glow, null, altarU + dirU * 1.6, cv, y + 3.5, 0.15, 3.2, 0.15, hex(0xe8c35a));
      fbox(glow, null, altarU + dirU * 1.6, cv, y + 5.6, 0.15, 0.15, 1.6, hex(0xe8c35a));
      for (const s of [-0.6, 0.6]) fbox(glow, null, altarU, cv + s, y + 1.0, 0.08, 0.35, 0.08, hex(0xfff0b0));
      const halfW = (vMax - vMin) / 2 - 1.2;
      for (let u = (dirU > 0 ? uMin + 5 : uMax - 5); dirU > 0 ? u < altarU - 3 : u > altarU + 3; u += dirU * 1.3) {
        for (const side of [-1, 1]) {
          const pw = Math.max(1.5, halfW - 1.2), pv = cv + side * (0.9 + pw / 2);
          const r: Rect = { u0: u - 0.3, u1: u + 0.3, v0: pv - pw / 2, v1: pv + pw / 2 };
          if (!fits(r, 0.4) || occupied.some((o) => overlap(o, r))) continue;
          fbox(solid, owner, u, pv, y, pw, 0.45, 0.45, PAL.wood, dirU, 0);
          fbox(solid, null, u - dirU * 0.25, pv, y + 0.45, pw, 0.5, 0.08, PAL.wood, dirU, 0);
        }
      }
      // Columns down both sides.
      for (let u = uMin + 3; u < uMax - 2; u += 4.5) for (const side of [-1, 1]) {
        const v = cv + side * (halfW - 0.4);
        if (fits({ u0: u - 0.4, u1: u + 0.4, v0: v - 0.4, v1: v + 0.4 }, 0.2)) fbox(solid, owner, u, v, y, 0.7, H, 0.7, hex(0xded5c2));
      }
      lightGrid(6, y + H - 0.1);
    }

    // Build meshes.
    const group = new THREE.Group();
    group.name = owner;
    for (const m of [solid.mesh(solidMat), glow.mesh(glowMat), ceil.mesh(ceilMat)]) if (m) group.add(m);
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
    // A query from far above (Player.setWorld drops you from +400 m) means "the floor you're on".
    const y = y0 > (cur + 1) * H + 2 ? cur * H + 0.1 : y0;
    let best = -Infinity;
    for (let k = cur - 1; k <= cur + 1; k++) {
      for (const s of [slabY(k, x, z), rampY(k, x, z)]) if (s <= y + 0.6 && s > best) best = s;
    }
    return best === -Infinity ? cur * H : best;
  };

  // ---- Lift rides ----
  let player: { position: THREE.Vector3; facing: number } | null = null;
  const fadeEl = document.createElement('div');
  fadeEl.style.cssText = 'position:fixed;inset:0;background:#0d1117;opacity:0;pointer-events:none;transition:opacity .3s;z-index:60';
  document.body.appendChild(fadeEl);
  let riding = false;
  function travel(to: number) {
    if (riding || !liftExit) return;
    riding = true;
    fadeEl.style.opacity = '1';
    setTimeout(() => {
      setFloor(to);
      if (player) player.position.set(liftExit.x, to * H + 0.01, liftExit.z);
      setTimeout(() => { fadeEl.style.opacity = '0'; riding = false; }, 250);
    }, 330);
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
    update(_dt, p) {
      player = p;
      if (riding) return;
      const f = Math.max(0, Math.min(floors - 1, Math.floor((p.position.y + 0.8) / H)));
      if (f !== cur) setFloor(f);
    },
    interactions() { return floorsLoaded.get(cur)?.inter ?? []; },
    dispose() {
      for (const fl of floorsLoaded.values()) fl.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      floorsLoaded.clear();
      colliders.clear();
      solidMat.dispose(); glowMat.dispose(); viewMat.dispose(); ceilMat.dispose();
      fadeEl.remove();
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
