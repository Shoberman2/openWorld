// Cars and robot pedestrians on the streamed road network: lanes, one-ways, signals, hills, bridges.
import * as THREE from 'three';
import { makeTypes, type CarType, type TypeId } from '../traffic.ts';
import { shared } from '../engine.ts';
import { Crowd, type CrowdMember } from './crowd.ts';
import { along, approachGroup, signalState, type NEdge, type NNode, type RoadNet } from './net.ts';

/** Soft, slightly toy-like car colors, like the game's procedural cars. */
const PASTEL = [0x6fb3b8, 0xd98c7a, 0xe8dcc0, 0x5b6c80, 0xa9c4dc, 0xf2f0ea, 0x3f6f5a, 0xc9b27c, 0x8d5f6e, 0x9aa3ab, 0x2f3b4c, 0xb4413a, 0x7e9c6a, 0xe2a64f];

interface Leg { e: NEdge; dir: 1 | -1 }
interface Car {
  type: CarType; idx: number;
  leg: Leg; next: Leg | null;
  lane: number; s: number; speed: number; max: number;
  pos: THREE.Vector3; heading: number; pitch: number;
  live: boolean;
}

const endNode = (l: Leg) => (l.dir > 0 ? l.e.b : l.e.a);
const lanesOf = (l: Leg) => (l.dir > 0 ? l.e.lanesF : l.e.lanesB);

export class EarthTraffic {
  group = new THREE.Group();
  cars: Car[] = [];
  private types = makeTypes();
  private bodies = new Map<TypeId, THREE.InstancedMesh>();
  private lights = new Map<TypeId, THREE.InstancedMesh>();
  private lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);
  private tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
  private time = 0;
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private nearEdges: NEdge[] = [];
  private nearAt = -1;
  private nearV = -1;

  constructor(public net: RoadNet, count: number, private driveLeft: boolean, taxiShare: number) {
    const want: Record<TypeId, number> = { taxi: 0, sedan: 0, suv: 0, bus: 0, truck: 0 };
    const pick = (): TypeId => {
      if (Math.random() < taxiShare) return 'taxi';
      const r = Math.random();
      return r < 0.5 ? 'sedan' : r < 0.84 ? 'suv' : r < 0.9 ? 'bus' : 'truck';
    };
    const plan = Array.from({ length: count }, pick);
    plan.forEach((t) => want[t]++);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25 });
    for (const t of this.types) {
      const n = Math.max(1, want[t.id]);
      const b = new THREE.InstancedMesh(t.body, bodyMat, n), li = new THREE.InstancedMesh(t.lights, this.lightMat, n);
      b.count = li.count = want[t.id];
      b.castShadow = true;
      b.frustumCulled = li.frustumCulled = false;
      this.bodies.set(t.id, b); this.lights.set(t.id, li);
      this.group.add(b, li);
    }
    const used: Record<TypeId, number> = { taxi: 0, sedan: 0, suv: 0, bus: 0, truck: 0 };
    for (const tid of plan) {
      const type = this.types.find((t) => t.id === tid)!;
      const idx = used[tid]++;
      this.cars.push({ type, idx, leg: null!, next: null, lane: 0, s: 0, speed: 0, max: type.speed * (0.75 + Math.random() * 0.35), pos: new THREE.Vector3(), heading: 0, pitch: 0, live: false });
      const body = this.bodies.get(tid)!;
      body.setColorAt(idx, new THREE.Color(tid === 'taxi' || tid === 'bus' ? 0xffffff : PASTEL[Math.floor(Math.random() * PASTEL.length)]));
      body.setMatrixAt(idx, this.hidden);
      this.lights.get(tid)!.setMatrixAt(idx, this.hidden);
    }
    for (const b of this.bodies.values()) if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }

  private spawn(c: Car, around: THREE.Vector3, rMin: number, rMax: number) {
    c.live = false;
    // Candidates come from a spatial index; refreshed a few times a second, not per car.
    if (this.time - this.nearAt > 0.5 || this.nearV !== this.net.version) {
      this.nearEdges = this.net.near(around.x, around.z, 450, 'drive');
      this.nearAt = this.time; this.nearV = this.net.version;
    }
    const edges = this.nearEdges;
    if (!edges.length) return;
    for (let tries = 0; tries < 30; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      const s = Math.random() * e.len;
      along(e, s, this.tmp);
      const d = Math.hypot(this.tmp.x - around.x, this.tmp.z - around.z);
      if (d < rMin || d > rMax) continue;
      const dirs: (1 | -1)[] = [];
      if (e.lanesF > 0) dirs.push(1);
      if (e.lanesB > 0) dirs.push(-1);
      if (!dirs.length) continue;
      c.leg = { e, dir: dirs[Math.floor(Math.random() * dirs.length)] };
      c.lane = Math.floor(Math.random() * lanesOf(c.leg));
      c.s = c.leg.dir > 0 ? s : e.len - s;
      c.next = this.choose(c.leg);
      c.speed = c.max * 0.6;
      this.target(c, c.pos);
      c.heading = this.headingOf(c);
      c.live = true;
      return;
    }
  }

  private choose(l: Leg): Leg | null {
    const n = endNode(l);
    const arrive = this.travelTangent(l, l.e.len - 0.1);
    const opts: { leg: Leg; w: number }[] = [];
    for (const e of n.edges) {
      if (!e.drive || !e.alive || (e === l.e && n.edges.length > 1)) continue;
      const dir: 1 | -1 = e.a === n ? 1 : -1;
      if ((dir > 0 ? e.lanesF : e.lanesB) <= 0) continue;
      if (e.cls === 'service' && Math.random() < 0.85) continue;
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
    if (e.lanesB === 0 || e.lanesF === 0) return (c.lane - (lanes - 1) / 2) * laneW;
    return (this.driveLeft ? -1 : 1) * laneW * (c.lane + 0.5);
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
    for (const c of this.cars) {
      if (c.live && !c.leg.e.alive) c.live = false;
      if (!c.live) { this.spawn(c, player, 60, 420); continue; }
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
          c.lane = Math.min(c.lane, lanesOf(c.leg) - 1);
          c.next = this.choose(c.leg);
        }
      }
    }
    for (const c of this.cars) {
      const body = this.bodies.get(c.type.id)!, li = this.lights.get(c.type.id)!;
      if (c.live && Math.hypot(c.pos.x - player.x, c.pos.z - player.z) > 520) this.spawn(c, player, 150, 420);
      if (!c.live) { body.setMatrixAt(c.idx, this.hidden); li.setMatrixAt(c.idx, this.hidden); continue; }
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
      body.setMatrixAt(c.idx, this.m4);
      li.setMatrixAt(c.idx, this.m4);
    }
    for (const id of this.bodies.keys()) {
      this.bodies.get(id)!.instanceMatrix.needsUpdate = true;
      this.lights.get(id)!.instanceMatrix.needsUpdate = true;
    }
    const k = 0.7 + shared.uNight.value * 2.6;
    this.lightMat.color.setRGB(k, k, k);
  }
}

// ---------------------------------------------------------------------------------------------

interface Ped { m: CrowdMember; leg: Leg | null; s: number; off: number; side: number; speed: number; wait: number; cooldown: number }

/** The city's caretakers: white robots walking the sidewalks and paths (some carrying packages). */
export class EarthPedestrians {
  group = new THREE.Group();
  private peds: Ped[] = [];
  private crowd: Crowd;
  private tmp = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
  private nearEdges: NEdge[] = [];
  private nearAt = -1;
  private nearV = -1;
  private clock = 0;

  constructor(public net: RoadNet, count: number, private solid: (x: number, z: number) => boolean) {
    this.crowd = new Crowd(count);
    this.group.add(this.crowd.group);
    for (const m of this.crowd.members) {
      m.scale = 0.92 + Math.random() * 0.14;
      this.peds.push({ m, leg: null, s: 0, off: 0, side: Math.random() < 0.5 ? 1 : -1, speed: 1.1 + Math.random() * 0.5, wait: 0, cooldown: 5 + Math.random() * 20 });
    }
  }

  private setOffset(p: Ped) {
    const e = p.leg!.e;
    p.off = e.drive ? p.side * (e.width / 2 + 0.9 + Math.random() * 1.4) : (Math.random() - 0.5) * e.width * 0.5;
    along(e, e.len / 2, this.tmp);
    const test = (o: number) => this.solid(this.tmp.x - this.tmp.tz * o, this.tmp.z + this.tmp.tx * o);
    if (test(p.off)) { p.off = -p.off; if (test(p.off)) p.off = 0; }
  }

  private place(p: Ped, around: THREE.Vector3, rMin: number, rMax: number) {
    p.leg = null;
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
      along(e, s, this.tmp);
      p.m.pos.set(this.tmp.x - this.tmp.tz * p.off, this.tmp.y, this.tmp.z + this.tmp.tx * p.off);
      return;
    }
  }

  private next(p: Ped) {
    const l = p.leg!;
    const n: NNode = endNode(l);
    const opts = n.edges.filter((e) => e !== l.e && e.walk && e.alive);
    if (!opts.length) { p.leg = { e: l.e, dir: (l.dir * -1) as 1 | -1 }; p.s = 0; p.off = -p.off; return; }
    const e = opts[Math.floor(Math.random() * opts.length)];
    p.leg = { e, dir: e.a === n ? 1 : -1 };
    p.s = 0;
    this.setOffset(p);
  }

  update(dt: number, player: THREE.Vector3) {
    this.clock += dt;
    for (const p of this.peds) {
      const m = p.m;
      if (p.leg && !p.leg.e.alive) p.leg = null;
      const dist = Math.hypot(m.pos.x - player.x, m.pos.z - player.z);
      if (!p.leg || dist > 240) { this.place(p, player, 40, 190); if (!p.leg) { m.visible = false; continue; } }
      if (p.wait > 0) {
        p.wait -= dt;
        m.speed = 0;
      } else {
        p.cooldown -= dt;
        if (p.cooldown < 0) { p.wait = 2 + Math.random() * 6; p.cooldown = 12 + Math.random() * 30; }
        p.s += p.speed * dt;
        m.speed = p.speed;
        if (p.s >= p.leg!.e.len) this.next(p);
      }
      const l = p.leg!, e = l.e;
      along(e, l.dir > 0 ? p.s : e.len - p.s, this.tmp);
      const tx = this.tmp.tx * l.dir, tz = this.tmp.tz * l.dir;
      let x = this.tmp.x - this.tmp.tz * p.off, z = this.tmp.z + this.tmp.tx * p.off;
      const y = this.tmp.y - 0.06;
      const dx = x - player.x, dz = z - player.z, dd = Math.hypot(dx, dz);
      if (dd < 1.2 && dd > 0.01) { x += (dx / dd) * (1.2 - dd); z += (dz / dd) * (1.2 - dd); }
      if (Math.hypot(m.pos.x - x, m.pos.z - z) > 6) m.pos.set(x, y, z);
      else { m.pos.x = THREE.MathUtils.damp(m.pos.x, x, 8, dt); m.pos.z = THREE.MathUtils.damp(m.pos.z, z, 8, dt); m.pos.y = THREE.MathUtils.damp(m.pos.y, y, 10, dt); }
      const heading = Math.atan2(tx, tz);
      let dh = heading - m.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.yaw += dh * Math.min(1, dt * 8);
      m.visible = dist < 200;
    }
    this.crowd.update(dt);
  }
}
