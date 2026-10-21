import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout } from './city/layout.ts';
import { mulberry32 } from './city/layout.ts';
import { laneOffsets, type Streets } from './city/streets.ts';
import { quality, shared } from './engine.ts';
import { carPaintMaterial } from './carPaint.ts';

export type TypeId = 'sedan' | 'suv' | 'taxi' | 'pickup' | 'van' | 'bus' | 'truck';

export interface CarType { id: TypeId; length: number; speed: number; body: THREE.BufferGeometry; lights: THREE.BufferGeometry }

function paint(g: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

function wheels(len: number, width: number, r: number, axles: number[]) {
  const out: THREE.BufferGeometry[] = [];
  for (const z of axles) for (const s of [-1, 1]) {
    out.push(paint(new THREE.CylinderGeometry(r, r, 0.26, 16).rotateZ(Math.PI / 2).translate(s * (width / 2 - 0.12), r, z * len), 0x141414));
    out.push(paint(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.28, 12).rotateZ(Math.PI / 2).translate(s * (width / 2 - 0.1), r, z * len), 0x9a9da1));
  }
  return out;
}

/**
 * A car side profile (front at -len/2, y up from the ground) extruded across the car's width, with
 * softly beveled edges: reads as a real, well-proportioned vehicle instead of stacked boxes.
 */
function profile(pts: [number, number][], w: number, color: number, bevel = 0.05) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  // Body panels get a fuller, rounder edge (pressed steel, not a slab); glass keeps a tight one.
  const round = bevel > 0.04;
  if (round) bevel *= 1.6;
  const g = new THREE.ExtrudeGeometry(shape, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: round ? bevel * 0.5 : bevel, bevelOffset: round ? -bevel * 0.5 : 0, bevelSegments: round ? 4 : 2, curveSegments: 1 });
  g.translate(0, 0, -(w - bevel * 2) / 2).rotateY(Math.PI / 2);
  return paint(g, color);
}

const GLASS = 0x1b232c;

/** Glass around the cabin: a slightly wider slab of the greenhouse, so side windows, windshield and rear window show dark. */
function glass(pts: [number, number][], w: number) {
  return profile(pts, w + 0.03, GLASS, 0.02);
}

/** Thin body-colored pillar dividing the side windows. */
function pillar(z: number, y0: number, y1: number, w: number, color: number) {
  return paint(new THREE.BoxGeometry(w + 0.06, y1 - y0, 0.12).translate(0, (y0 + y1) / 2, z), color);
}

function bumpers(len: number, w: number, y: number) {
  return [
    paint(new THREE.BoxGeometry(w + 0.04, 0.2, 0.16).translate(0, y, len / 2), 0x2a2c2f),
    paint(new THREE.BoxGeometry(w + 0.04, 0.2, 0.16).translate(0, y, -len / 2), 0x2a2c2f),
  ];
}

function lightsFor(len: number, w: number, y: number, extra: THREE.BufferGeometry[] = []) {
  const head = 0xfff4dc, tail = 0xff1a10;
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.4, 0.16, 0.05).translate(-w / 2 + 0.34, y, len / 2 + 0.02), head),
    paint(new THREE.BoxGeometry(0.4, 0.16, 0.05).translate(w / 2 - 0.34, y, len / 2 + 0.02), head),
    paint(new THREE.BoxGeometry(0.34, 0.18, 0.05).translate(-w / 2 + 0.3, y, -len / 2 - 0.02), tail),
    paint(new THREE.BoxGeometry(0.34, 0.18, 0.05).translate(w / 2 - 0.3, y, -len / 2 - 0.02), tail),
    ...extra,
  ]);
}

/** A three-box sedan (the taxi is the boxy '80s version, in yellow). */
function sedanBody(L: number, w: number, color: number, boxy: boolean) {
  const f = -L / 2, b = L / 2;
  const belt = boxy ? 0.98 : 0.95, roof = boxy ? 1.42 : 1.4;
  const ws0 = f + (boxy ? 1.35 : 1.25), ws1 = f + (boxy ? 1.85 : 1.95), rw0 = b - (boxy ? 1.25 : 1.45), rw1 = b - (boxy ? 0.85 : 0.95);
  const body: [number, number][] = [
    [f + 0.06, 0.3], [f, 0.42], [f, 0.74], [f + 0.12, boxy ? 0.86 : 0.83], [ws0, belt], [ws1, roof], [rw0, roof], [rw1, belt], [b - 0.08, belt - 0.03], [b, 0.82], [b, 0.42], [b - 0.06, 0.3],
  ];
  const win: [number, number][] = [[ws0 + 0.03, belt + 0.01], [ws1 + 0.01, roof - 0.06], [rw0 - 0.01, roof - 0.06], [rw1 - 0.03, belt + 0.01]];
  return [profile(body, w, color), glass(win, w), pillar((ws1 + rw0) / 2, belt, roof - 0.04, w, color), ...bumpers(L, w, 0.45), ...wheels(L, w, 0.34, [0.31, -0.31])];
}

export function makeTypes(): CarType[] {
  const W = 0xffffff; // body vertices stay white so each instance's paint shows through
  const sedan: CarType = { id: 'sedan', length: 4.7, speed: 12, body: mergeGeometries(sedanBody(4.7, 1.84, W, false)), lights: lightsFor(4.7, 1.84, 0.72) };
  const taxi: CarType = {
    id: 'taxi', length: 5.1, speed: 13,
    body: mergeGeometries([...sedanBody(5.1, 1.9, 0xf2b90c, true), paint(new THREE.BoxGeometry(0.75, 0.26, 0.32).translate(0, 1.55, -0.15), 0x1c1c1c)]),
    lights: lightsFor(5.1, 1.9, 0.72, [paint(new THREE.BoxGeometry(0.72, 0.2, 0.34).translate(0, 1.56, -0.15), 0xfff2b0)]),
  };

  // Boxy off-roader with a spare wheel on the tailgate.
  const sL = 4.6, sw = 1.95, sf = -sL / 2, sb = sL / 2;
  const suv: CarType = {
    id: 'suv', length: sL, speed: 11.5,
    body: mergeGeometries([
      profile([[sf + 0.05, 0.38], [sf, 0.5], [sf, 1.05], [sf + 0.1, 1.12], [sf + 1.15, 1.16], [sf + 1.5, 1.8], [sb - 0.05, 1.82], [sb, 1.7], [sb, 0.5], [sb - 0.05, 0.38]], sw, W, 0.07),
      glass([[sf + 1.18, 1.19], [sf + 1.49, 1.75], [sb + 0.02, 1.75], [sb + 0.02, 1.2]], sw),
      pillar(sf + 2.45, 1.16, 1.78, sw, W), pillar(sb - 0.6, 1.16, 1.78, sw, W),
      paint(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16).rotateX(Math.PI / 2).translate(0, 1.0, sb + 0.14), 0x141414),
      ...bumpers(sL, sw, 0.55), ...wheels(sL, sw, 0.4, [0.3, -0.3]),
    ]),
    lights: lightsFor(sL, sw, 0.9),
  };

  // Pickup: cab, open bed with walls and a tailgate.
  const pL = 5.4, pw = 1.98, pf = -pL / 2, pb = pL / 2, cabEnd = pf + 2.75;
  const pickup: CarType = {
    id: 'pickup', length: pL, speed: 11.5,
    body: mergeGeometries([
      profile([[pf + 0.05, 0.4], [pf, 0.52], [pf, 1.05], [pf + 0.12, 1.15], [pf + 1.3, 1.18], [pf + 1.78, 1.8], [cabEnd - 0.08, 1.82], [cabEnd, 1.74], [cabEnd, 0.8], [pb, 0.8], [pb, 0.52], [pb - 0.05, 0.4]], pw, W, 0.06),
      glass([[pf + 1.33, 1.21], [pf + 1.77, 1.76], [cabEnd + 0.02, 1.76], [cabEnd + 0.02, 1.22]], pw),
      paint(new THREE.BoxGeometry(0.1, 0.4, pb - cabEnd).translate(pw / 2 - 0.05, 1.0, (pb + cabEnd) / 2), W),
      paint(new THREE.BoxGeometry(0.1, 0.4, pb - cabEnd).translate(-pw / 2 + 0.05, 1.0, (pb + cabEnd) / 2), W),
      paint(new THREE.BoxGeometry(pw, 0.4, 0.1).translate(0, 1.0, pb - 0.05), W),
      paint(new THREE.BoxGeometry(pw - 0.2, 0.02, pb - cabEnd - 0.1).translate(0, 0.81, (pb + cabEnd) / 2), 0x26282b),
      ...bumpers(pL, pw, 0.55), ...wheels(pL, pw, 0.4, [0.33, -0.3]),
    ]),
    lights: lightsFor(pL, pw, 0.92),
  };

  // Delivery van: short hood, tall box, cab windows only.
  const vL = 5.9, vw = 2.05, vf = -vL / 2, vb = vL / 2;
  const van: CarType = {
    id: 'van', length: vL, speed: 10.5,
    body: mergeGeometries([
      profile([[vf + 0.05, 0.38], [vf, 0.5], [vf, 1.0], [vf + 0.15, 1.1], [vf + 0.7, 1.18], [vf + 1.3, 2.05], [vf + 1.55, 2.6], [vb - 0.05, 2.62], [vb, 2.55], [vb, 0.5], [vb - 0.05, 0.38]], vw, W, 0.06),
      glass([[vf + 0.72, 1.21], [vf + 1.28, 2.0], [vf + 1.95, 2.0], [vf + 1.95, 1.22]], vw),
      paint(new THREE.BoxGeometry(vw + 0.02, 0.28, vL - 2.3).translate(0, 1.15, vb - (vL - 2.3) / 2 - 0.1), 0x2f6fbf),
      ...bumpers(vL, vw, 0.5), ...wheels(vL, vw, 0.38, [0.33, -0.3]),
    ]),
    lights: lightsFor(vL, vw, 0.85),
  };

  const bus: CarType = {
    id: 'bus', length: 12, speed: 9,
    body: mergeGeometries([
      paint(new RoundedBoxGeometry(2.55, 2.6, 12, 3, 0.2).translate(0, 1.75, 0), 0xf3f5f7),
      paint(new THREE.BoxGeometry(2.58, 0.95, 10.8).translate(0, 2.25, -0.2), 0x161b22),
      paint(new THREE.BoxGeometry(2.6, 0.3, 12.02).translate(0, 1.2, 0), 0x1f5fbf),
      ...wheels(12, 2.55, 0.5, [0.33, -0.3]),
    ]),
    lights: lightsFor(12, 2.55, 0.9, [paint(new THREE.BoxGeometry(1.6, 0.25, 0.05).translate(0, 2.85, 6.02), 0xffb020)]),
  };
  const truck: CarType = {
    id: 'truck', length: 7.5, speed: 10,
    body: mergeGeometries([
      paint(new RoundedBoxGeometry(2.4, 2.0, 2.2, 2, 0.15).translate(0, 1.35, 2.6), 0xffffff),
      paint(new THREE.BoxGeometry(2.3, 0.7, 0.08).translate(0, 1.8, 3.71), 0x161b22),
      paint(new THREE.BoxGeometry(2.5, 2.9, 5.2).translate(0, 1.95, -1.1), 0xe8e8e4),
      ...wheels(7.5, 2.4, 0.46, [0.33, -0.28]),
    ]),
    lights: lightsFor(7.5, 2.4, 0.9),
  };
  return [sedan, suv, taxi, pickup, van, bus, truck];
}

/** Share of each type in ordinary traffic (taxis come on top of this, by city). */
export const MIX: [TypeId, number][] = [['sedan', 40], ['suv', 22], ['pickup', 12], ['van', 12], ['bus', 6], ['truck', 8]];
export function pickType(r: number): TypeId {
  let t = r * MIX.reduce((a, m) => a + m[1], 0);
  for (const [id, w] of MIX) { t -= w; if (t <= 0) return id; }
  return 'sedan';
}
export const emptyMix = (): Record<TypeId, number> => ({ taxi: 0, sedan: 0, suv: 0, pickup: 0, van: 0, bus: 0, truck: 0 });

interface Car {
  type: CarType;
  idx: number; // instance index within its type
  axis: 'x' | 'z';
  road: number; // index into avenuesX (axis z) or streetsZ (axis x)
  dir: 1 | -1;
  lane: number;
  s: number;
  speed: number;
  max: number;
  pos: THREE.Vector3;
  heading: number;
  lastCross: number;
}

export const BODY_COLORS = [0x1c1c1e, 0xe9eaec, 0x8a8f96, 0x3b4a5c, 0x7a1f1f, 0x23395d, 0x4b4f54, 0xc9c5bd, 0x0f3d2e, 0x5a5a5a, 0xa3a7ad, 0x612a2a];

export class Traffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private types = makeTypes();
  private bodies = new Map<TypeId, THREE.InstancedMesh>();
  private lights = new Map<TypeId, THREE.InstancedMesh>();
  private lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(private l: Layout, private streets: Streets, count: number) {
    const rand = mulberry32(1234);
    const p = l.profile;
    const want = emptyMix();
    const pick = (): TypeId => (rand() < p.taxiShare ? 'taxi' : pickType(rand()));
    const plan: TypeId[] = Array.from({ length: count }, pick);
    plan.forEach((t) => want[t]++);
    const bodyMat = carPaintMaterial(quality.low);
    for (const t of this.types) {
      const n = Math.max(1, want[t.id]);
      const b = new THREE.InstancedMesh(t.body, bodyMat, n);
      const li = new THREE.InstancedMesh(t.lights, this.lightMat, n);
      b.count = li.count = want[t.id];
      b.castShadow = true;
      b.frustumCulled = li.frustumCulled = false;
      this.bodies.set(t.id, b); this.lights.set(t.id, li);
      this.group.add(b, li);
    }
    const used = emptyMix();
    for (const tid of plan) {
      const type = this.types.find((t) => t.id === tid)!;
      const axis: 'x' | 'z' = rand() < 0.6 ? 'z' : 'x';
      const roads = axis === 'z' ? l.avenuesX : l.streetsZ;
      const road = Math.floor(rand() * roads.length);
      const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;
      const lanes = laneOffsets(axis === 'z' ? p.avenueW : p.streetW);
      const lane = Math.floor(rand() * lanes.length);
      const span = axis === 'z' ? [l.streetsZ[0], l.streetsZ[l.streetsZ.length - 1]] : [l.avenuesX[0], l.avenuesX[l.avenuesX.length - 1]];
      const s = span[0] + rand() * (span[1] - span[0]);
      const idx = used[tid]++;
      const c: Car = { type, idx, axis, road, dir, lane, s, speed: 0, max: type.speed * (0.8 + rand() * 0.35), pos: new THREE.Vector3(), heading: 0, lastCross: NaN };
      this.cars.push(c);
      const body = this.bodies.get(tid)!;
      body.setColorAt(idx, tid === 'taxi' ? new THREE.Color(0xffffff) : tid === 'bus' ? new THREE.Color(0xffffff) : new THREE.Color(BODY_COLORS[Math.floor(rand() * BODY_COLORS.length)]));
      this.place(c, true);
    }
    for (const b of this.bodies.values()) if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }

  private lateral(c: Car) {
    const p = this.l.profile;
    const center = c.axis === 'z' ? this.l.avenuesX[c.road] : this.l.streetsZ[c.road];
    const off = laneOffsets(c.axis === 'z' ? p.avenueW : p.streetW)[c.lane];
    return c.axis === 'z' ? center - c.dir * off : center + c.dir * off;
  }

  private target(c: Car, out: THREE.Vector3) {
    const lat = this.lateral(c);
    if (c.axis === 'z') out.set(lat, 0, c.s); else out.set(c.s, 0, lat);
    out.y = this.l.groundY(out.x, out.z);
    return out;
  }

  private place(c: Car, snap: boolean) {
    const t = this.target(c, new THREE.Vector3());
    const want = c.axis === 'z' ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (snap) { c.pos.copy(t); c.heading = want; }
  }

  /** Cross-road coordinates along this car's axis. */
  private crosses(c: Car) { return c.axis === 'z' ? this.l.streetsZ : this.l.avenuesX; }

  update(dt: number, player: THREE.Vector3) {
    const p = this.l.profile;
    const green = this.streets.green();
    // Group by lane for car-following.
    const lanes = new Map<string, Car[]>();
    for (const c of this.cars) {
      const k = `${c.axis}${c.road}${c.dir}${c.lane}`;
      let a = lanes.get(k); if (!a) lanes.set(k, (a = [])); a.push(c);
    }
    for (const list of lanes.values()) list.sort((a, b) => (a.s - b.s) * a.dir);

    const tmp = new THREE.Vector3();
    for (const list of lanes.values()) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const ahead = list[i + 1];
        let limit = c.max;
        // Follow the car ahead.
        if (ahead) {
          const gap = (ahead.s - c.s) * c.dir - (ahead.type.length + c.type.length) / 2;
          if (gap < 18) limit = Math.min(limit, Math.max(0, (gap - 2.5) * 0.9));
        }
        // Traffic light at the next intersection.
        const cs = this.crosses(c);
        const crossW = c.axis === 'z' ? p.streetW : p.avenueW;
        let next = NaN;
        for (const x of c.dir > 0 ? cs : [...cs].reverse()) if ((x - c.s) * c.dir > crossW / 2 - 1) { next = x; break; }
        if (!isNaN(next)) {
          const stop = (next - c.s) * c.dir - crossW / 2 - 2.6 - c.type.length / 2;
          if (green !== c.axis && stop > -0.5 && stop < 30) limit = Math.min(limit, Math.max(0, stop * 0.7));
        }
        // Don't run over the player.
        this.target(c, tmp);
        const fx = c.axis === 'x' ? c.dir : 0, fz = c.axis === 'z' ? c.dir : 0;
        const dx = player.x - tmp.x, dz = player.z - tmp.z;
        const fwd = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        if (fwd > 0 && fwd < 12 + c.type.length / 2 && side < 1.8 && Math.abs(player.y - tmp.y) < 2) limit = Math.min(limit, Math.max(0, fwd - c.type.length / 2 - 2));

        const accel = limit > c.speed ? 3.2 : 9;
        c.speed += THREE.MathUtils.clamp(limit - c.speed, -accel * dt, accel * dt);
        c.s += c.speed * dt * c.dir;

        // Turning / wrapping at intersections.
        for (let j = 0; j < cs.length; j++) {
          const x = cs[j];
          if (c.lastCross === x) continue;
          if ((c.s - x) * c.dir >= 0 && (c.s - x) * c.dir < 3) {
            c.lastCross = x;
            const atEnd = c.dir > 0 ? j === cs.length - 1 : j === 0;
            const r = Math.random();
            if (atEnd || r < 0.18) this.turn(c, j, atEnd);
            break;
          }
        }
      }
    }

    // Write instances.
    for (const c of this.cars) {
      this.target(c, tmp);
      c.pos.x = THREE.MathUtils.damp(c.pos.x, tmp.x, 5, dt);
      c.pos.z = THREE.MathUtils.damp(c.pos.z, tmp.z, 5, dt);
      c.pos.y = this.l.groundY(c.pos.x, c.pos.z);
      const want = c.axis === 'z' ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      let d = want - c.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.heading += d * Math.min(1, dt * 4);
      // Pitch on hills.
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const pitch = p.hills > 0 ? -Math.atan2(this.l.groundY(c.pos.x + fx * 2, c.pos.z + fz * 2) - this.l.groundY(c.pos.x - fx * 2, c.pos.z - fz * 2), 4) : 0;
      this.q.setFromEuler(this.e.set(pitch, c.heading, 0, 'YXZ'));
      this.m4.compose(c.pos, this.q, this.one);
      this.bodies.get(c.type.id)!.setMatrixAt(c.idx, this.m4);
      this.lights.get(c.type.id)!.setMatrixAt(c.idx, this.m4);
    }
    for (const id of this.bodies.keys()) {
      this.bodies.get(id)!.instanceMatrix.needsUpdate = true;
      this.lights.get(id)!.instanceMatrix.needsUpdate = true;
    }
    const k = 0.7 + shared.uNight.value * 2.6;
    this.lightMat.color.setRGB(k, k, k);
  }

  private turn(c: Car, crossIdx: number, forced: boolean) {
    const l = this.l, p = l.profile;
    const newAxis: 'x' | 'z' = c.axis === 'z' ? 'x' : 'z';
    // The road we're on now becomes our coordinate along the new axis; we can only head
    // toward roads that exist on that side (so cars on the outer ring turn inward).
    const curRoads = c.axis === 'z' ? l.avenuesX : l.streetsZ;
    const here = curRoads[c.road];
    const choices: (1 | -1)[] = [];
    if (c.road < curRoads.length - 1) choices.push(1);
    if (c.road > 0) choices.push(-1);
    if (!choices.length) { c.dir = (c.dir * -1) as 1 | -1; return; }
    if (!forced && Math.random() < 0.3) return; // went straight after all
    const dir = choices[Math.floor(Math.random() * choices.length)];
    c.axis = newAxis;
    c.road = crossIdx;
    c.dir = dir;
    c.s = here;
    c.lane = Math.min(c.lane, laneOffsets(newAxis === 'z' ? p.avenueW : p.streetW).length - 1);
    c.lastCross = here;
    c.speed *= 0.5;
  }
}
