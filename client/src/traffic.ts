import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout } from './city/layout.ts';
import { mulberry32 } from './city/layout.ts';
import { laneOffsets, type Streets } from './city/streets.ts';
import { shared } from './engine.ts';

type TypeId = 'sedan' | 'suv' | 'taxi' | 'bus' | 'truck';

interface CarType { id: TypeId; length: number; speed: number; body: THREE.BufferGeometry; lights: THREE.BufferGeometry }

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
    out.push(paint(new THREE.CylinderGeometry(r, r, 0.28, 14).rotateZ(Math.PI / 2).translate(s * (width / 2 - 0.1), r, z * len), 0x111111));
    out.push(paint(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.3, 10).rotateZ(Math.PI / 2).translate(s * (width / 2 - 0.08), r, z * len), 0x8a8d91));
  }
  return out;
}

function car(len: number, w: number, h: number, cabinLen: number, cabinH: number, color: number, glass = 0x161b22): THREE.BufferGeometry[] {
  return [
    paint(new RoundedBoxGeometry(w, h * 0.55, len, 3, 0.18).translate(0, 0.35 + h * 0.275, 0), color),
    paint(new RoundedBoxGeometry(w * 0.86, cabinH, cabinLen, 3, 0.22).translate(0, 0.35 + h * 0.55 + cabinH / 2 - 0.06, -len * 0.04), glass),
    paint(new THREE.BoxGeometry(w * 0.88, 0.05, cabinLen * 0.7).translate(0, 0.35 + h * 0.55 + cabinH - 0.06, -len * 0.04), color),
    paint(new THREE.BoxGeometry(w * 1.01, 0.18, 0.2).translate(0, 0.5, len / 2), 0x1a1a1a),
    paint(new THREE.BoxGeometry(w * 1.01, 0.18, 0.2).translate(0, 0.5, -len / 2), 0x1a1a1a),
    ...wheels(len, w, 0.34, [0.32, -0.32]),
  ];
}

function lightsFor(len: number, w: number, y: number, extra: THREE.BufferGeometry[] = []) {
  const head = 0xfff4dc, tail = 0xff1a10;
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.42, 0.14, 0.05).translate(-w / 2 + 0.32, y, len / 2 + 0.01), head),
    paint(new THREE.BoxGeometry(0.42, 0.14, 0.05).translate(w / 2 - 0.32, y, len / 2 + 0.01), head),
    paint(new THREE.BoxGeometry(0.38, 0.14, 0.05).translate(-w / 2 + 0.3, y, -len / 2 - 0.01), tail),
    paint(new THREE.BoxGeometry(0.38, 0.14, 0.05).translate(w / 2 - 0.3, y, -len / 2 - 0.01), tail),
    ...extra,
  ]);
}

function makeTypes(): CarType[] {
  const sedan: CarType = { id: 'sedan', length: 4.7, speed: 12, body: mergeGeometries(car(4.7, 1.85, 1.3, 2.4, 0.62, 0xffffff)), lights: lightsFor(4.7, 1.85, 0.85) };
  const suv: CarType = { id: 'suv', length: 4.95, speed: 11.5, body: mergeGeometries(car(4.95, 2.0, 1.65, 3.2, 0.78, 0xffffff)), lights: lightsFor(4.95, 2.0, 1.0) };
  const roofSign = paint(new THREE.BoxGeometry(0.9, 0.32, 0.3).translate(0, 2.05, -0.2), 0xfff2b0);
  const taxi: CarType = {
    id: 'taxi', length: 4.9, speed: 13,
    body: mergeGeometries([
      ...car(4.9, 1.88, 1.32, 2.5, 0.62, 0xf2b705),
      paint(new THREE.BoxGeometry(1.9, 0.12, 4.0).translate(0, 0.75, 0), 0x1a1a1a), // checker stripe
    ]),
    lights: lightsFor(4.9, 1.88, 0.86, [roofSign]),
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
  return [sedan, suv, taxi, bus, truck];
}

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

const BODY_COLORS = [0x1c1c1e, 0xe9eaec, 0x8a8f96, 0x3b4a5c, 0x7a1f1f, 0x23395d, 0x4b4f54, 0xc9c5bd, 0x0f3d2e, 0x5a5a5a, 0xa3a7ad, 0x612a2a];

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
    const want: Record<TypeId, number> = { taxi: 0, sedan: 0, suv: 0, bus: 0, truck: 0 };
    const pick = (): TypeId => {
      const r = rand();
      if (r < p.taxiShare) return 'taxi';
      const r2 = rand();
      return r2 < 0.5 ? 'sedan' : r2 < 0.82 ? 'suv' : r2 < 0.9 ? 'bus' : 'truck';
    };
    const plan: TypeId[] = Array.from({ length: count }, pick);
    plan.forEach((t) => want[t]++);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.55 });
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
    const used: Record<TypeId, number> = { taxi: 0, sedan: 0, suv: 0, bus: 0, truck: 0 };
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
