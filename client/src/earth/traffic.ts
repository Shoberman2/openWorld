// Cars and pedestrians on the streamed road network: lanes, one-ways, signals, hills, bridges.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeTypes, pickType, type CarType, type TypeId } from '../traffic.ts';
import { quality, shared } from '../engine.ts';
import { carPaintMaterial } from '../carPaint.ts';
import { Crowd, type CrowdMember } from './crowd.ts';
import { along, approachGroup, signalState, type NEdge, type NNode, type RoadNet } from './net.ts';

// Paint like the game's procedural cars: real-world whites, greys and blacks, plus the dusty reds,
// teals, beiges and sage greens its pickups and jeeps wear.
const PAINT: [number, number][] = [
  [0xe9eaea, 18], [0x1c1e21, 14], [0x6a6e73, 12], [0xa7abaf, 10], [0x2a4a6b, 7], [0x9a2f2a, 8], [0x2f6f6a, 7], [0xc9b79a, 7], [0x7d8f6e, 5], [0x6b4a3a, 3], [0xd8cbb4, 4],
];
const PAINT_SUM = PAINT.reduce((a, p) => a + p[1], 0);
function paint() {
  let r = Math.random() * PAINT_SUM;
  for (const [c, w] of PAINT) { r -= w; if (r <= 0) return c; }
  return PAINT[0][0];
}

/** A car type, or the bicycle (with its rider), which shares the lanes with them. */
type VType = Omit<CarType, 'id'> & { id: TypeId | 'bike' };

/** Paint a piece one color (vertex colors; the instance color stays white for bikes). */
function tint(g: THREE.BufferGeometry, c: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c), arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

/** A city bike with a cyclist riding it (jacket, jeans, a helmet), facing +Z, wheels on y = 0. */
function bikeType(): VType {
  const frame = [0x2f6f6a, 0x9a2f2a, 0x1c1e21, 0xd8cbb4][Math.floor(Math.random() * 4)];
  const tube = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, c: number) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1)));
    return tint(g, c);
  };
  const R = 0.34, D = 0x2a2d32;
  const jacket = [0x2b3a55, 0x3d5a3d, 0x6b2e2e, 0x1f1f24, 0x8a7a5c][Math.floor(Math.random() * 5)];
  const jeans = 0x2f4466, skin = [0xe8bf9c, 0xc89068, 0x8d5a3b, 0x6d4229][Math.floor(Math.random() * 4)], helmet = [0xf2f1ee, 0x1c1e21, 0xd8452f][Math.floor(Math.random() * 3)];
  const parts = [
    tint(new THREE.TorusGeometry(R, 0.03, 6, 18).rotateY(Math.PI / 2).translate(0, R, -0.52), D),
    tint(new THREE.TorusGeometry(R, 0.03, 6, 18).rotateY(Math.PI / 2).translate(0, R, 0.52), D),
    tube(0, R, -0.52, 0, 0.32, 0, 0.025, frame), tube(0, R, -0.52, 0, 0.85, -0.18, 0.022, frame), tube(0, 0.32, 0, 0, 0.86, -0.16, 0.028, frame),
    tube(0, 0.32, 0, 0, 0.8, 0.36, 0.028, frame), tube(0, 0.86, -0.16, 0, 0.88, 0.34, 0.024, frame), tube(0, 0.8, 0.36, 0, R, 0.52, 0.02, D),
    tube(-0.25, 1.04, 0.42, 0.25, 1.04, 0.42, 0.018, D), tube(0, 0.8, 0.36, 0, 1.04, 0.4, 0.02, D),
    tint(new THREE.BoxGeometry(0.12, 0.05, 0.24).translate(0, 0.98, -0.2), D),
    // The rider, leaning onto the bars.
    tint(new THREE.CapsuleGeometry(0.15, 0.36, 3, 8).scale(1.05, 1, 0.75).rotateX(0.45).translate(0, 1.3, -0.05), jacket),
    tint(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 1.56, 0.06), skin),
    tint(new THREE.SphereGeometry(0.1, 10, 8).scale(0.9, 1.15, 1).translate(0, 1.66, 0.11), skin),
    tint(new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.85, 1.15).translate(0, 1.69, 0.1), helmet),
    tube(0.17, 1.48, 0.05, 0.22, 1.06, 0.4, 0.045, jacket), tube(-0.17, 1.48, 0.05, -0.22, 1.06, 0.4, 0.045, jacket),
    tint(new THREE.SphereGeometry(0.04, 6, 4).translate(0.22, 1.05, 0.41), skin), tint(new THREE.SphereGeometry(0.04, 6, 4).translate(-0.22, 1.05, 0.41), skin),
    tube(0.1, 1.0, -0.18, 0.1, 0.62, 0.12, 0.065, jeans), tube(0.1, 0.62, 0.12, 0.08, 0.32, 0.05, 0.05, jeans),
    tube(-0.1, 1.0, -0.18, -0.1, 0.72, -0.1, 0.065, jeans), tube(-0.1, 0.72, -0.1, -0.08, 0.32, -0.08, 0.05, jeans),
    tint(new THREE.BoxGeometry(0.09, 0.07, 0.24).translate(0.08, 0.3, 0.09), D), tint(new THREE.BoxGeometry(0.09, 0.07, 0.24).translate(-0.08, 0.3, -0.04), D),
  ];
  for (const g of parts) if (!g.attributes.normal) g.computeVertexNormals();
  const lamp = tint(new THREE.SphereGeometry(0.045, 6, 4).translate(0, 0.9, 0.48), 0xfff2c8);
  const tail = tint(new THREE.SphereGeometry(0.035, 6, 4).translate(0, 0.86, -0.45), 0xff2a1a);
  return { id: 'bike', length: 1.8, speed: 5.5, body: mergeGeometries(parts)!, lights: mergeGeometries([lamp, tail])! };
}

/** Bikes keep off the fast roads. */
const NO_BIKES = new Set(['motorway', 'trunk']);

interface Leg { e: NEdge; dir: 1 | -1 }
interface Car {
  type: VType; idx: number;
  leg: Leg; next: Leg | null;
  lane: number; s: number; speed: number; max: number;
  pos: THREE.Vector3; heading: number; pitch: number;
  live: boolean;
  paint: THREE.Color;
}

const endNode = (l: Leg) => (l.dir > 0 ? l.e.b : l.e.a);
const lanesOf = (l: Leg) => (l.dir > 0 ? l.e.lanesF : l.e.lanesB);

export class EarthTraffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private types: VType[] = [...makeTypes(), bikeType()];
  private bodies = new Map<VType['id'], THREE.InstancedMesh>();
  private lights = new Map<VType['id'], THREE.InstancedMesh>();
  private lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);
  private tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
  private time = 0;
  private nearEdges: NEdge[] = [];
  private nearAt = -1;
  private nearV = -1;
  /** How many of the cars are on the road (the rest wait hidden): lowered for slow GPUs and VR. */
  budget: number;
  /** How many of the bikes ride here (by country: lots in Amsterdam); the rest wait hidden. */
  bikesWanted = Infinity;

  /** `bikes` more ride with the cars (Amsterdam gets lots), in the curb lane at bike speed. */
  constructor(public net: RoadNet, count: number, public driveLeft: boolean, taxiShare: number, bikes = 0) {
    this.budget = count + bikes;
    const want = this.mix();
    const pick = (): TypeId => (Math.random() < taxiShare ? 'taxi' : pickType(Math.random()));
    // Bikes interleaved through the plan, so a lower budget (VR, ?q=low) keeps some of each.
    const plan: VType['id'][] = Array.from({ length: count }, pick);
    for (let i = 0; i < bikes; i++) plan.splice(Math.floor(((i + 0.5) / bikes) * plan.length), 0, 'bike');
    plan.forEach((t) => want[t]++);
    // Glossy automotive paint: metallic flake under a clear coat, reflecting the sky.
    const bodyMat = carPaintMaterial(quality.low);
    for (const t of this.types) {
      const n = Math.max(1, want[t.id]);
      const b = new THREE.InstancedMesh(t.body, bodyMat, n), li = new THREE.InstancedMesh(t.lights, this.lightMat, n);
      b.count = li.count = want[t.id];
      b.castShadow = true;
      b.frustumCulled = li.frustumCulled = false;
      this.bodies.set(t.id, b); this.lights.set(t.id, li);
      this.group.add(b, li);
    }
    const used = this.mix();
    for (const tid of plan) {
      const type = this.types.find((t) => t.id === tid)!;
      const idx = used[tid]++;
      const color = new THREE.Color(tid === 'taxi' || tid === 'bus' || tid === 'bike' ? 0xffffff : paint());
      this.cars.push({ type, idx, leg: null!, next: null, lane: 0, s: 0, speed: 0, max: type.speed * (0.75 + Math.random() * 0.35), pos: new THREE.Vector3(), heading: 0, pitch: 0, live: false, paint: color });
      this.bodies.get(tid)!.setColorAt(idx, color);
    }
  }

  private mix() { return Object.fromEntries(this.types.map((t) => [t.id, 0])) as Record<VType['id'], number>; }

  private spawn(c: Car, around: THREE.Vector3, rMin: number, rMax: number) {
    c.live = false;
    // Candidates come from a spatial index; refreshed a few times a second, not per car.
    if (this.time - this.nearAt > 0.5 || this.nearV !== this.net.version) {
      this.nearEdges = this.net.near(around.x, around.z, 360, 'drive');
      this.nearAt = this.time; this.nearV = this.net.version;
    }
    const edges = this.nearEdges;
    if (!edges.length) return;
    for (let tries = 0; tries < 30; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      if (c.type.id === 'bike' && NO_BIKES.has(e.cls)) continue;
      const s = Math.random() * e.len;
      along(e, s, this.tmp);
      const d = Math.hypot(this.tmp.x - around.x, this.tmp.z - around.z);
      if (d < rMin || d > rMax) continue;
      const dirs: (1 | -1)[] = [];
      if (e.lanesF > 0) dirs.push(1);
      if (e.lanesB > 0) dirs.push(-1);
      if (!dirs.length) continue;
      c.leg = { e, dir: dirs[Math.floor(Math.random() * dirs.length)] };
      c.lane = c.type.id === 'bike' ? lanesOf(c.leg) - 1 : Math.floor(Math.random() * lanesOf(c.leg));
      c.s = c.leg.dir > 0 ? s : e.len - s;
      c.next = this.choose(c.leg, c.type.id === 'bike');
      c.speed = c.max * 0.6;
      this.target(c, c.pos);
      c.heading = this.headingOf(c);
      c.live = true;
      return;
    }
  }

  private choose(l: Leg, bike = false): Leg | null {
    const n = endNode(l);
    const arrive = this.travelTangent(l, l.e.len - 0.1);
    const opts: { leg: Leg; w: number }[] = [];
    for (const e of n.edges) {
      if (!e.drive || !e.alive || (e === l.e && n.edges.length > 1)) continue;
      const dir: 1 | -1 = e.a === n ? 1 : -1;
      if ((dir > 0 ? e.lanesF : e.lanesB) <= 0) continue;
      if (e.cls === 'service' && Math.random() < 0.85) continue;
      if (bike && NO_BIKES.has(e.cls)) continue;
      const leg = { e, dir };
      const t = this.travelTangent(leg, 0.1);
      const dot = arrive.x * t.x + arrive.z * t.z;
      opts.push({ leg, w: 0.15 + Math.max(0, dot) ** 2 * 2.5 });
    }
    if (!opts.length) return null;
    let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
    for (const o of opts) { r -= o.w; if (r <= 0) return o.leg; }
    return opts[opts.length - 1].leg;
  }

  private travelTangent(l: Leg, s: number) {
    along(l.e, l.dir > 0 ? s : l.e.len - s, this.tmp);
    return { x: this.tmp.tx * l.dir, z: this.tmp.tz * l.dir };
  }

  private lateral(c: Car) {
    const e = c.leg.e, lanes = lanesOf(c.leg);
    const laneW = Math.min(3.3, e.width / Math.max(1, e.lanesF + e.lanesB));
    // Bikes hug the curb side of their lane.
    const curb = c.type.id === 'bike' ? laneW * 0.32 : 0;
    if (e.lanesB === 0 || e.lanesF === 0) return (c.lane - (lanes - 1) / 2) * laneW + (this.driveLeft ? -curb : curb);
    return (this.driveLeft ? -1 : 1) * (laneW * (c.lane + 0.5) + curb);
  }

  private target(c: Car, out: THREE.Vector3) {
    const l = c.leg;
    along(l.e, l.dir > 0 ? c.s : l.e.len - c.s, this.tmp);
    const tx = this.tmp.tx * l.dir, tz = this.tmp.tz * l.dir;
    const off = this.lateral(c);
    return out.set(this.tmp.x - tz * off, this.tmp.y, this.tmp.z + tx * off);
  }

  private headingOf(c: Car) {
    const t = this.travelTangent(c.leg, c.s);
    return Math.atan2(t.x, t.z);
  }

  update(dt: number, player: THREE.Vector3) {
    this.time += dt;
    const lanes = new Map<string, Car[]>();
    const key = (l: Leg, lane: number) => `${l.e.id}:${l.dir}:${lane}`;
    let bikes = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (i >= this.budget || (c.type.id === 'bike' && bikes++ >= this.bikesWanted)) { c.live = false; continue; }
      if (c.live && !c.leg.e.alive) c.live = false;
      if (!c.live) { this.spawn(c, player, 50, 330); continue; }
      const k = key(c.leg, c.lane);
      let a = lanes.get(k); if (!a) lanes.set(k, (a = [])); a.push(c);
    }
    for (const list of lanes.values()) list.sort((a, b) => a.s - b.s);
    const tv = new THREE.Vector3();
    for (const list of lanes.values()) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const len = c.leg.e.len;
        let limit = c.max;
        if (c.leg.e.cls === 'minor' || c.leg.e.cls === 'service') limit = Math.min(limit, 9);
        const ahead = list[i + 1];
        let gap = Infinity;
        if (ahead) gap = ahead.s - c.s - (ahead.type.length + c.type.length) / 2;
        else if (c.next) {
          const nl = lanes.get(key(c.next, Math.min(c.lane, lanesOf(c.next) - 1)));
          if (nl?.length) gap = len - c.s + nl[0].s - (nl[0].type.length + c.type.length) / 2;
        }
        if (gap < 20) limit = Math.min(limit, Math.max(0, (gap - 2.5) * 0.9));
        const n: NNode = endNode(c.leg);
        const toEnd = len - c.s;
        if (n.signal && toEnd < 45) {
          const st = signalState(n.phase, approachGroup(n, c.leg.e), this.time);
          const stop = toEnd - (n.maxW / 2 + 3) - c.type.length / 2;
          if ((st === 'r' || (st === 'y' && stop > 9)) && stop > -0.5) limit = Math.min(limit, Math.max(0, stop * 0.6));
        } else if (n.edges.length >= 3 && toEnd < 16 && c.next && c.next.e !== c.leg.e) {
          const a = this.travelTangent(c.leg, len - 0.1), b = this.travelTangent(c.next, 0.1);
          if (a.x * b.x + a.z * b.z < 0.7) limit = Math.min(limit, 5.5);
        }
        if (!c.next && toEnd < 12) limit = Math.min(limit, toEnd * 0.5);
        this.target(c, tv);
        const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
        const dx = player.x - tv.x, dz = player.z - tv.z;
        const fwd = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        if (fwd > 0 && fwd < 12 + c.type.length / 2 && side < 1.8 && Math.abs(player.y - tv.y) < 2) limit = Math.min(limit, Math.max(0, fwd - c.type.length / 2 - 2));
        const accel = limit > c.speed ? 3 : 9;
        c.speed += THREE.MathUtils.clamp(limit - c.speed, -accel * dt, accel * dt);
        c.s += c.speed * dt;
        if (c.s >= len) {
          if (!c.next || !c.next.e.alive) { c.live = false; continue; }
          c.s -= len;
          c.leg = c.next;
          c.lane = c.type.id === 'bike' ? lanesOf(c.leg) - 1 : Math.min(c.lane, lanesOf(c.leg) - 1);
          c.next = this.choose(c.leg, c.type.id === 'bike');
        }
      }
    }
    // Cars on the road are packed at the front of each type's instances and only those are drawn.
    const slot = this.mix();
    for (const c of this.cars) {
      const body = this.bodies.get(c.type.id)!, li = this.lights.get(c.type.id)!;
      if (c.live && Math.hypot(c.pos.x - player.x, c.pos.z - player.z) > 400) this.spawn(c, player, 140, 330);
      if (!c.live) continue;
      this.target(c, tv);
      if (c.pos.distanceToSquared(tv) > 400) c.pos.copy(tv);
      c.pos.x = THREE.MathUtils.damp(c.pos.x, tv.x, 6, dt);
      c.pos.z = THREE.MathUtils.damp(c.pos.z, tv.z, 6, dt);
      c.pos.y = THREE.MathUtils.damp(c.pos.y, tv.y - 0.08, 10, dt);
      const want = this.headingOf(c);
      let dh = want - c.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.heading += dh * Math.min(1, dt * 5);
      // Pitch with the road (SF hills).
      const l = c.leg, half = c.type.length / 2;
      along(l.e, THREE.MathUtils.clamp(l.dir > 0 ? c.s + half : l.e.len - c.s - half, 0, l.e.len), this.tmp);
      const yf = this.tmp.y;
      along(l.e, THREE.MathUtils.clamp(l.dir > 0 ? c.s - half : l.e.len - c.s + half, 0, l.e.len), this.tmp);
      const pitch = Math.atan2(yf - this.tmp.y, c.type.length);
      c.pitch = THREE.MathUtils.damp(c.pitch, pitch, 8, dt);
      this.q.setFromEuler(this.eu.set(-c.pitch, c.heading, 0, 'YXZ'));
      this.m4.compose(c.pos, this.q, this.one);
      const n = slot[c.type.id]++;
      body.setMatrixAt(n, this.m4);
      body.setColorAt(n, c.paint);
      li.setMatrixAt(n, this.m4);
    }
    for (const id of this.bodies.keys()) {
      const b = this.bodies.get(id)!, li = this.lights.get(id)!;
      b.count = li.count = slot[id];
      b.instanceMatrix.needsUpdate = li.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
    const k = 0.7 + shared.uNight.value * 2.6;
    this.lightMat.color.setRGB(k, k, k);
  }
}

// ---------------------------------------------------------------------------------------------

type Job = 'walk' | 'sit' | 'clean' | 'sweep' | 'enter' | 'exit';
interface Ped {
  m: CrowdMember; leg: Leg | null; s: number; off: number; side: number; speed: number;
  wait: number; cooldown: number;
  job: Job; jobT: number;
  /** Sideways step toward or away from a building (doors, windows), meters off the walking line. */
  lean: number;
  /** In a group: walks next to its leader. */
  lead: Ped | null; gap: number; beside: number;
  bench: number; // index into the bench list while sitting
}

/**
 * The people on every sidewalk. Most walk (some in twos and threes, some carrying packages), wait
 * at signals, step in and out of doors; others sit on benches, wipe shop windows or sweep the pavement.
 */
export class EarthPedestrians {
  group = new THREE.Group();
  private peds: Ped[] = [];
  private crowd: Crowd;
  private tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
  private nearEdges: NEdge[] = [];
  private nearAt = -1;
  private nearV = -1;
  private clock = 0;
  private seated = new Set<number>();
  /** How many people are out (the rest stay hidden): lowered for slow GPUs and VR. */
  budget: number;

  constructor(
    public net: RoadNet, count: number, private solid: (x: number, z: number) => boolean,
    private curb: (x: number, z: number) => number = () => 0,
    private benches: (x: number, z: number, r: number) => number[] = () => [],
  ) {
    this.budget = count;
    this.crowd = new Crowd(count);
    this.group.add(this.crowd.group);
    for (const m of this.crowd.members) {
      m.scale = 0.95 + Math.random() * 0.1;
      this.peds.push({ m, leg: null, s: 0, off: 0, side: Math.random() < 0.5 ? 1 : -1, speed: 1.15 + Math.random() * 0.45, wait: 0, cooldown: 5 + Math.random() * 20, job: 'walk', jobT: 0, lean: 0, lead: null, gap: 0, beside: 0, bench: -1 });
    }
  }

  private setOffset(p: Ped) {
    const e = p.leg!.e;
    p.off = e.drive ? p.side * (e.width / 2 + 0.9 + Math.random() * 1.4) : (Math.random() - 0.5) * e.width * 0.5;
    along(e, e.len / 2, this.tmp);
    const test = (o: number) => this.solid(this.tmp.x - this.tmp.tz * o, this.tmp.z + this.tmp.tx * o);
    if (test(p.off)) { p.off = -p.off; if (test(p.off)) p.off = 0; }
  }

  /** World position on the walking line (plus a sideways step) and the travel tangent. */
  private at(p: Ped, s: number, extra = 0) {
    const l = p.leg!, e = l.e;
    along(e, THREE.MathUtils.clamp(l.dir > 0 ? s : e.len - s, 0, e.len), this.tmp);
    const side = Math.sign(p.off || 1), o = p.off + side * extra;
    return {
      x: this.tmp.x - this.tmp.tz * o, z: this.tmp.z + this.tmp.tx * o, y: this.tmp.y,
      tx: this.tmp.tx * l.dir, tz: this.tmp.tz * l.dir,
      nx: -this.tmp.tz * side, nz: this.tmp.tx * side, // toward the buildings
    };
  }

  /** Is there a building wall right beside this sidewalk spot (door / shop window)? Returns its distance. */
  private wallBeside(p: Ped) {
    if (!p.leg?.e.drive || !p.off) return 0;
    for (const d of [1.2, 2.2, 3.4, 4.8]) {
      const q = this.at(p, p.s, d);
      if (this.solid(q.x, q.z)) return d;
    }
    return 0;
  }

  private place(p: Ped, around: THREE.Vector3, rMin: number, rMax: number) {
    p.leg = null; p.lead = null; p.job = 'walk'; p.lean = 0; p.m.pose = 'stand'; p.m.fade = 1; p.m.carry = Math.random() < 0.14;
    if (p.bench >= 0) { this.seated.delete(p.bench); p.bench = -1; }
    if (this.clock - this.nearAt > 0.5 || this.nearV !== this.net.version) {
      this.nearEdges = this.net.near(around.x, around.z, 200, 'walk');
      this.nearAt = this.clock; this.nearV = this.net.version;
    }
    const edges = this.nearEdges;
    if (!edges.length) return;
    for (let tries = 0; tries < 30; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      if (e.bridge && e.drive) continue;
      const s = Math.random() * e.len;
      along(e, s, this.tmp);
      const d = Math.hypot(this.tmp.x - around.x, this.tmp.z - around.z);
      if (d < rMin || d > rMax) continue;
      p.leg = { e, dir: Math.random() < 0.5 ? 1 : -1 };
      p.s = p.leg.dir > 0 ? s : e.len - s;
      this.setOffset(p);
      const q = this.at(p, p.s);
      p.m.pos.set(q.x, q.y, q.z);
      // A job for some: wipe a window or sweep; others just came out of a door.
      const r = Math.random();
      const wall = this.wallBeside(p);
      if (wall && r < 0.1) { p.job = 'clean'; p.jobT = 12 + Math.random() * 25; p.lean = wall - 0.75; p.m.carry = false; }
      else if (r < 0.17) { p.job = 'sweep'; p.jobT = 15 + Math.random() * 30; p.speed = 0.35; p.m.carry = false; }
      else if (wall && r < 0.27) { p.job = 'exit'; p.jobT = 0; p.lean = wall - 0.2; p.m.fade = 0; }
      return;
    }
  }

  /** Sit down on a free bench near the player. */
  private sit(p: Ped, around: THREE.Vector3) {
    const b = this.benches(around.x, around.z, 150);
    for (let tries = 0; tries < 6 && b.length; tries++) {
      const i = Math.floor(Math.random() * (b.length / 4)) * 4;
      const key = Math.round(b[i] * 10) * 100003 + Math.round(b[i + 2] * 10);
      if (this.seated.has(key)) continue;
      const d = Math.hypot(b[i] - around.x, b[i + 2] - around.z);
      if (d < 30) continue; // don't pop in right next to the player
      this.seated.add(key);
      p.bench = key; p.leg = null; p.lead = null; p.job = 'sit'; p.jobT = 20 + Math.random() * 60;
      const rot = b[i + 3], seat = (Math.random() - 0.5) * 1.1;
      p.m.pos.set(b[i] + Math.cos(rot) * seat + Math.sin(rot) * 0.05, b[i + 1], b[i + 2] - Math.sin(rot) * seat + Math.cos(rot) * 0.05);
      p.m.yaw = rot; p.m.pose = 'sit'; p.m.speed = 0; p.m.carry = false; p.m.fade = 1;
      return true;
    }
    return false;
  }

  /** A few walkers bring company: followers join a leader on the same sidewalk. */
  private joinGroup(p: Ped) {
    const leaders = this.peds.filter((q) => q !== p && q.leg && !q.lead && q.job === 'walk' && q.m.visible && q.leg.e.drive);
    if (!leaders.length) return false;
    const lead = leaders[Math.floor(Math.random() * leaders.length)];
    const mates = this.peds.filter((q) => q.lead === lead).length;
    if (mates >= 2) return false;
    p.lead = lead; p.leg = lead.leg; p.job = 'walk'; p.m.pose = 'stand'; p.m.fade = 1; p.m.carry = false;
    p.gap = mates ? -1.1 : 0.15; p.beside = (mates ? 0 : 0.75) * (Math.random() < 0.5 ? 1 : -1);
    return true;
  }

  private next(p: Ped) {
    const l = p.leg!;
    const n: NNode = endNode(l);
    const opts = n.edges.filter((e) => e !== l.e && e.walk && e.alive);
    if (!opts.length) { p.leg = { e: l.e, dir: (l.dir * -1) as 1 | -1 }; p.s = 0; p.off = -p.off; return; }
    // At a signalled corner some wait for the light before crossing.
    if (n.signal && Math.random() < 0.6) p.wait = 2 + Math.random() * 7;
    const e = opts[Math.floor(Math.random() * opts.length)];
    p.leg = { e, dir: e.a === n ? 1 : -1 };
    p.s = 0;
    this.setOffset(p);
  }

  update(dt: number, player: THREE.Vector3) {
    this.clock += dt;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i], m = p.m;
      if (i >= this.budget) { m.visible = false; p.leg = null; continue; }
      const dist = Math.hypot(m.pos.x - player.x, m.pos.z - player.z);

      if (p.job === 'sit') {
        p.jobT -= dt;
        m.visible = dist < 200;
        if (p.jobT < 0 || dist > 230) { m.pose = 'stand'; this.place(p, player, 60, 190); }
        continue;
      }
      if (p.lead) {
        // Follow the leader: same sidewalk, a step behind or beside.
        const L = p.lead;
        if (!L.leg || L.job !== 'walk' || !L.m.visible) { p.lead = null; p.leg = null; }
        else {
          p.leg = L.leg; p.off = L.off; p.s = L.s + p.gap;
          const q = this.at(p, p.s, p.beside);
          m.pos.x = THREE.MathUtils.damp(m.pos.x, q.x, 8, dt); m.pos.z = THREE.MathUtils.damp(m.pos.z, q.z, 8, dt);
          m.pos.y = THREE.MathUtils.damp(m.pos.y, q.y - 0.06 + this.curb(q.x, q.z), 10, dt);
          m.yaw = L.m.yaw; m.speed = L.m.speed; m.visible = L.m.visible;
          continue;
        }
      }
      if (p.leg && !p.leg.e.alive) p.leg = null;
      if (!p.leg || dist > 240) {
        const start = !m.visible && this.clock < 1;
        const r = Math.random();
        if (r < 0.08 && this.sit(p, player)) continue;
        if (r < 0.22 && this.joinGroup(p)) continue;
        // Most come in close, so the street you're on is busy; the rest fill the blocks around.
        this.place(p, player, start ? 4 : 45, Math.random() < 0.6 ? 110 : 190);
        if (!p.leg) { m.visible = false; continue; }
      }

      let extra = p.lean;
      if (p.job === 'clean') {
        p.jobT -= dt; m.speed = 0; m.pose = 'clean';
        if (p.jobT < 0) { p.job = 'walk'; p.lean = 0; m.pose = 'stand'; }
      } else if (p.job === 'enter') {
        // Step up to the door and go in.
        p.jobT += dt; m.speed = 1.0;
        extra = p.lean * Math.min(1, p.jobT / 1.6);
        m.fade = Math.max(0, 1 - (p.jobT - 1.2) / 0.5);
        if (p.jobT > 1.8) { m.visible = false; p.leg = null; continue; }
      } else if (p.job === 'exit') {
        // Come out of a door onto the sidewalk.
        p.jobT += dt; m.speed = 1.0;
        extra = p.lean * Math.max(0, 1 - p.jobT / 1.6);
        m.fade = Math.min(1, p.jobT / 0.5);
        if (p.jobT > 1.6) { p.job = 'walk'; p.lean = 0; }
      } else if (p.wait > 0) {
        p.wait -= dt;
        m.speed = 0;
      } else {
        if (p.job === 'sweep') { m.pose = 'sweep'; p.jobT -= dt; if (p.jobT < 0) { p.job = 'walk'; m.pose = 'stand'; p.speed = 1.15 + Math.random() * 0.45; } }
        p.cooldown -= dt;
        if (p.cooldown < 0) {
          p.cooldown = 12 + Math.random() * 30;
          const wall = p.job === 'walk' && !m.carry ? this.wallBeside(p) : 0;
          if (wall && Math.random() < 0.35) { p.job = 'enter'; p.jobT = 0; p.lean = wall - 0.2; continue; }
          p.wait = 2 + Math.random() * 6;
        }
        p.s += p.speed * dt;
        m.speed = p.speed;
        if (p.s >= p.leg!.e.len) this.next(p);
      }
      const q = this.at(p, p.s, extra);
      let x = q.x, z = q.z;
      const e = p.leg!.e;
      const y = q.y - 0.06 + (e.drive && !e.bridge ? this.curb(x, z) : 0);
      const dx = x - player.x, dz = z - player.z, dd = Math.hypot(dx, dz);
      if (dd < 1.2 && dd > 0.01) { x += (dx / dd) * (1.2 - dd); z += (dz / dd) * (1.2 - dd); }
      if (Math.hypot(m.pos.x - x, m.pos.z - z) > 6) m.pos.set(x, y, z);
      else { m.pos.x = THREE.MathUtils.damp(m.pos.x, x, 8, dt); m.pos.z = THREE.MathUtils.damp(m.pos.z, z, 8, dt); m.pos.y = THREE.MathUtils.damp(m.pos.y, y, 10, dt); }
      // Face the way they walk; window cleaners and door-goers face the building.
      const faceWall = p.job === 'clean' || (p.job === 'enter' && p.jobT > 0.3);
      const heading = faceWall ? Math.atan2(q.nx, q.nz) : p.job === 'exit' && p.jobT < 1.2 ? Math.atan2(-q.nx, -q.nz) : Math.atan2(q.tx, q.tz);
      let dh = heading - m.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.yaw += dh * Math.min(1, dt * 8);
      m.visible = dist < 200;
    }
    this.crowd.update(dt);
  }
}

// ---------------------------------------------------------------------------------------------

/** A container ship, 180 m long, facing +Z, waterline at y = 0. One merged mesh with vertex colors. */
function cargoShip(seed: number) {
  const rnd = (i: number) => { const x = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, c: number) => parts.push(tint(new THREE.BoxGeometry(w, h, l).translate(x, y, z), c));
  const L = 180, W = 28;
  // Hull: dark red below the waterline band, black above, a pointed bow.
  box(W, 6, L - 20, 0, -2, -5, 0x7a2a22);
  box(W, 9, L - 20, 0, 5.5, -5, 0x1f2226);
  const bow = new THREE.CylinderGeometry(W / 2, W / 2, 15, 3, 1).rotateY(Math.PI / 6).scale(1, 1, 1.4).translate(0, 2.5, L / 2 - 14);
  parts.push(tint(bow, 0x1f2226));
  box(W - 1, 0.6, L - 22, 0, 10.2, -5, 0x8a3a2e); // deck
  // Containers, six tiers across, in bays along the deck.
  const COL = [0xc23b2b, 0x2a5aa6, 0x2f8a5a, 0xe0a33a, 0xdedcd5, 0x6b6f75, 0xb85d2a, 0x3b7f9a];
  for (let bay = 0; bay < 11; bay++) for (let row = 0; row < 9; row++) {
    const h = 2 + Math.floor(rnd(bay * 31 + row) * 4);
    for (let k = 0; k < h; k++) box(2.4, 2.55, 12, -9.6 + row * 2.4, 11.8 + k * 2.6, -60 + bay * 12.6, COL[Math.floor(rnd(bay * 97 + row * 7 + k) * COL.length)]);
  }
  // Bridge house and funnel at the stern.
  box(W - 4, 16, 12, 0, 18, -L / 2 + 16, 0xeeeae2);
  box(W + 4, 1.2, 6, 0, 25.6, -L / 2 + 19, 0xeeeae2);
  for (let k = 0; k < 4; k++) box(W - 5, 1.1, 0.2, 0, 13 + k * 3.6, -L / 2 + 22.1, 0x2a3540); // windows
  box(5, 9, 6, 0, 30, -L / 2 + 10, 0x2a2d32);
  box(5.2, 2, 6.2, 0, 32, -L / 2 + 10, 0xc23b2b);
  for (const g of parts) if (!g.attributes.normal) g.computeVertexNormals();
  return mergeGeometries(parts)!;
}

interface Ship { pos: THREE.Vector3; heading: number; speed: number; live: boolean; turn: number; bob: number }

/**
 * Container ships on the open sea: they appear a few kilometers out wherever there's ocean, steam
 * along in straight lines at 15–20 knots and turn away from land they can see ahead.
 */
export class EarthShips {
  group = new THREE.Group();
  private ships: Ship[] = [];
  private mesh: THREE.InstancedMesh;
  private wake: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private t = 0;
  private wakeScale = new THREE.Vector3(1, 1, 1);

  constructor(count: number, private waterAt: (x: number, z: number) => number, private seaY: () => number) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(cargoShip(1), mat, count);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    const wakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    // Foam that fades along its length and at its edges, drawn over the waves (which would otherwise
    // cut it into patches as they roll through it).
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 256;
    const g = cv.getContext('2d')!;
    for (let y = 0; y < 256; y++) {
      // Canvas bottom (v = 0) is the stern end of the plane: brightest there.
      const along = y / 255;
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${(along ** 1.6 * 0.9).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, y, 64, 1);
    }
    const tex = new THREE.CanvasTexture(cv);
    this.wake = new THREE.InstancedMesh(wakeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }), count);
    this.wake.renderOrder = 2;
    this.wake.frustumCulled = false;
    this.mesh.count = this.wake.count = 0;
    this.group.add(this.mesh, this.wake);
    for (let i = 0; i < count; i++) this.ships.push({ pos: new THREE.Vector3(), heading: 0, speed: 0, live: false, turn: 0, bob: Math.random() * 10 });
  }

  /** Is (x, z) open sea (sea-level water, not a lake or river)? NaN-safe: unknown is "no". */
  private sea(x: number, z: number) {
    const w = this.waterAt(x, z);
    return !Number.isNaN(w) && Math.abs(w - this.seaY()) < 1.5;
  }

  /** The world re-centered: start over around the player. */
  reset() { for (const s of this.ships) s.live = false; }

  update(dt: number, player: THREE.Vector3) {
    this.t += dt;
    let n = 0;
    for (const s of this.ships) {
      const d = Math.hypot(s.pos.x - player.x, s.pos.z - player.z);
      if (s.live && d > 9000) s.live = false;
      if (!s.live) {
        // A few tries a frame at a random spot 1.2–6 km out, with sea under the whole hull.
        for (let k = 0; k < 3 && !s.live; k++) {
          const a = Math.random() * Math.PI * 2, r = 1200 + Math.random() * 4800;
          const x = player.x + Math.sin(a) * r, z = player.z + Math.cos(a) * r, h = Math.random() * Math.PI * 2;
          const fx = Math.sin(h), fz = Math.cos(h);
          if (this.sea(x, z) && this.sea(x + fx * 120, z + fz * 120) && this.sea(x - fx * 100, z - fz * 100) && this.sea(x + fz * 40, z - fx * 40) && this.sea(x - fz * 40, z + fx * 40)) {
            s.pos.set(x, this.seaY(), z); s.heading = h; s.speed = 7.5 + Math.random() * 3; s.live = true; s.turn = 0;
          }
        }
        if (!s.live) continue;
      }
      // Land ahead (within ~600 m)? Turn, and keep turning until the way is clear.
      const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
      const aheadKnown = !Number.isNaN(this.waterAt(s.pos.x + fx * 600, s.pos.z + fz * 600));
      if (aheadKnown && !this.sea(s.pos.x + fx * 600, s.pos.z + fz * 600)) s.turn = s.turn || (Math.random() < 0.5 ? -1 : 1);
      else if (s.turn && this.sea(s.pos.x + fx * 900, s.pos.z + fz * 900)) s.turn = 0;
      s.heading += s.turn * 0.04 * dt;
      s.pos.x += fx * s.speed * dt; s.pos.z += fz * s.speed * dt;
      s.pos.y = this.seaY() + Math.sin(this.t * 0.5 + s.bob) * 0.4;
      this.q.setFromEuler(this.eu.set(Math.sin(this.t * 0.37 + s.bob) * 0.01, s.heading, Math.sin(this.t * 0.29 + s.bob) * 0.015, 'YXZ'));
      this.m4.compose(s.pos, this.q, this.wakeScale.set(1, 1, 1));
      this.mesh.setMatrixAt(n, this.m4);
      // A long white wake trailing from the stern.
      this.m4.compose(new THREE.Vector3(s.pos.x - fx * 88, this.seaY() + 0.15, s.pos.z - fz * 88), this.q.setFromEuler(this.eu.set(0, s.heading, 0)), this.wakeScale.set(26, 1, 420));
      this.wake.setMatrixAt(n, this.m4);
      n++;
    }
    this.mesh.count = this.wake.count = n;
    this.mesh.instanceMatrix.needsUpdate = this.wake.instanceMatrix.needsUpdate = true;
  }
}
