// Teammates in the world: each one is the same robot as the player in their own suit color, drawn
// where they really are (lat/lon/altitude turned into this scene's local meters every frame, so a
// world re-center moves them too), or inside the same project HQ when you're both in it. Poses arrive
// about ten times a second and are played back a moment late, blended between the two nearest ones.
// Kept cheap, because the game is bound by draw calls: a teammate's robot has its ~100 meshes merged per
// joint and material once (about a fifth of the draws, same animation); beyond 120 m it's a one-draw
// stand-in under the name tag; shadows only within 40 m; no animation off screen; nothing past the cull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TeamMember, TeamPing, TeamPose } from '../../../shared/types.ts';
import type { EarthApi } from '../earth/index.ts';
import type { Labels } from '../interact.ts';
import { esc } from '../interact.ts';
import { makeRobot, type Robot, type RobotState } from '../robot.ts';
import { makeVehicle, type Vehicle, type VehicleId } from '../vehicles/index.ts';
import { PING_MS, safeColor, workLine, type Snap, type TeamStore } from './store.ts';

/** Play poses back this far behind (ms): long enough that there are usually two to blend between. */
const DELAY = 210;
const HEAD = 2.02;
/** Full robot within this many meters; a simple stand-in beyond; shadows only up close. */
const NEAR = 120, SHADOW = 40;
const STATES = new Set<string>(['idle', 'walk', 'run', 'jump', 'fall', 'fly', 'land', 'roll', 'sit', 'wave', 'crouch', 'sprawl', 'skate', 'bike', 'drive', 'pilot', 'paddle']);
const RIDES = new Set<string>(['skate', 'bike', 'jeep', 'plane', 'kayak', 'boat', 'shuttle']);

export interface AvatarDeps {
  earth: EarthApi | null;
  labels: Labels;
  /** Where the player is, in the scene being drawn. */
  me: () => THREE.Vector3;
  /** The scene to draw teammates into right now (the city, or the HQ interior you're in); null hides everyone. */
  scene: () => THREE.Scene | null;
  /** True when that scene is the outdoors. */
  outdoors: () => boolean;
  /** Is this teammate inside the same project HQ as you? */
  sameInterior: (m: TeamMember) => boolean;
  /** Slow GPU or VR: fewer, simpler avatars. */
  lite: () => boolean;
  camera: () => THREE.Camera;
}

interface Avatar {
  id: string;
  robot: Robot;
  color: string;
  vehicle: Vehicle | null;
  vehicleId: string;
  exhaust: THREE.Object3D | null;
  /** Merged geometry made for this robot (ours to dispose). */
  merged: THREE.BufferGeometry[];
  /** The far stand-in: one mesh. */
  far: THREE.Mesh;
  shadows: boolean;
  netState: string;
  shown: boolean;
  dist: number;
  label: string;
  labelAt: number;
  say: { html: string; until: number } | null;
  skip: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const fin = (n: number | undefined, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);

/** The pose to draw now: blended between the two received either side of (now - DELAY). */
function sample(list: Snap[], now: number): TeamPose {
  const t = now - DELAY;
  let i = list.findIndex((s) => s.t > t);
  if (i < 0) return list[list.length - 1].p;
  if (i === 0) return list[0].p;
  const a = list[i - 1], b = list[i];
  const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, b.t - a.t)));
  const p = a.p, q = b.p;
  // Walking through a door, or location sharing switching: no blend across it.
  if (p.in !== q.in || (p.lat == null) !== (q.lat == null)) return q;
  const out: TeamPose = { ...q, rot: [lerpAngle(fin(p.rot[0]), fin(q.rot[0]), k), lerpAngle(fin(p.rot[1]), fin(q.rot[1]), k), lerpAngle(fin(p.rot[2]), fin(q.rot[2]), k)], sp: lerp(fin(p.sp), fin(q.sp), k), rk: lerp(fin(p.rk), fin(q.rk), k) };
  if (q.lat != null && p.lat != null) {
    out.lat = lerp(p.lat, q.lat, k); out.lon = lerp(fin(p.lon), fin(q.lon), k);
    out.alt = lerp(fin(p.alt), fin(q.alt), k); out.agl = lerp(fin(p.agl), fin(q.agl), k);
  }
  if (q.in === 'hq') { out.x = lerp(fin(p.x), fin(q.x), k); out.y = lerp(fin(p.y), fin(q.y), k); out.z = lerp(fin(p.z), fin(q.z), k); }
  return out;
}

/** Recolor the suit. Each robot owns its materials, so this only touches this one. */
function tailor(robot: Robot, hex: string) {
  const suit = new THREE.Color(hex);
  const shade = (k: number) => suit.clone().multiplyScalar(k);
  robot.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as (THREE.MeshPhysicalMaterial & { sheenColor?: THREE.Color }) | undefined;
    if (!m || Array.isArray(m) || !m.color) return;
    const c = m.color.getHex();
    if (c === 0x1c2740) { m.color.copy(shade(0.72)); m.sheenColor?.copy(suit).lerp(new THREE.Color(0xffffff), 0.25); }
    else if (c === 0x131b2d) m.color.copy(shade(0.45));
    else if (c === 0x151d31) { m.color.copy(shade(0.55)); m.sheenColor?.copy(suit); }
  });
}

// Every teammate is drawn with this one material; the colors live on the vertices.
const BODY = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.25 });

/**
 * Merge a robot's static meshes: everything on a joint becomes one mesh, with each part's color baked
 * onto its vertices. The joints stay, so it animates exactly as before, in under a fifth of the draw
 * calls (about 100 down to 18). Left alone: what the robot shows, hides or reshapes itself (the eyes,
 * flames, wingsuit and board). Dropped: the tiny lapel pin and sole lights, a draw call each.
 */
function slim(root: THREE.Object3D): THREE.BufferGeometry[] {
  const made: THREE.BufferGeometry[] = [];
  const walk = (g: THREE.Object3D) => {
    if (!g.visible) return;
    const groups = new Map<THREE.Material, THREE.Mesh[]>([[BODY, []]]);
    for (const c of [...g.children]) {
      const m = c as THREE.Mesh;
      if (!m.isMesh) { walk(c); continue; }
      const mat = m.material as THREE.MeshPhysicalMaterial & { isMeshBasicMaterial?: boolean };
      if (!m.visible || m.children.length || Array.isArray(mat) || !mat.color || !m.geometry.attributes.position?.count) continue;
      // The lapel pin (textured) and the lights in the soles (flat blue): too small to be worth a draw call each from across the street.
      if (mat.map || (mat.isMeshBasicMaterial && mat.color.getHex() === 0x6cc6ff)) { m.visible = false; continue; }
      if (mat.isMeshBasicMaterial || mat.transparent) continue;
      m.updateMatrix();
      if (m.matrix.determinant() <= 0) continue;
      groups.get(BODY)!.push(m);
    }
    for (const [mat, meshes] of groups) {
      if (!meshes.length) continue;
      const parts = meshes.map((m) => {
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.morphAttributes = {};
        const c = (m.material as THREE.MeshStandardMaterial).color;
        const col = new Float32Array(geo.attributes.position.count * 3);
        for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return geo.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(parts, false);
      parts.forEach((x) => x.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      for (const m of meshes) g.remove(m);
      g.add(mesh);
      made.push(merged);
    }
  };
  walk(root);
  return made;
}

let farGeo: THREE.BufferGeometry | null = null;
/** A body-sized capsule in the suit color with a pale head: what a teammate looks like from far away. */
function standIn(hex: string) {
  if (!farGeo) {
    const body = new THREE.CapsuleGeometry(0.2, 0.95, 3, 8).translate(0, 0.68, 0).toNonIndexed();
    const head = new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.5, 0).toNonIndexed();
    const paint = (g: THREE.BufferGeometry, v: number) => g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(v), 3));
    paint(body, 0.7); paint(head, 1.5);
    farGeo = mergeGeometries([body, head], false)!;
    body.dispose(); head.dispose();
  }
  const m = new THREE.Mesh(farGeo, new THREE.MeshLambertMaterial({ color: hex, vertexColors: true }));
  m.name = 'teammate-far';
  return m;
}

export class Avatars {
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private ball = new THREE.Sphere(new THREE.Vector3(), 2.5);
  private list = new Map<string, Avatar>();
  private beacons = new Map<string, { group: THREE.Group; ping: TeamPing }>();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private frame = 0;

  constructor(private deps: AvatarDeps, private store: TeamStore) {}

  /** How far a teammate is from you in the scene (Infinity when they aren't drawn). */
  distance(id: string) { const a = this.list.get(id); return a?.shown ? a.dist : Infinity; }
  /** Robots on screen, for tests and debugging. */
  debug() {
    return [...this.list.values()].map((a) => {
      let meshes = 0;
      a.robot.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes++; });
      return { id: a.id, shown: a.shown, dist: a.dist, state: a.robot.state, vehicle: a.vehicleId, pos: a.robot.root.position.toArray(), far: !!a.far.parent, meshes };
    });
  }

  /** A speech bubble over their head for a few seconds. */
  say(id: string, text: string) {
    const a = this.list.get(id);
    if (a) a.say = { html: esc(text.length > 140 ? `${text.slice(0, 139)}…` : text), until: performance.now() + 7000 };
  }

  private make(m: TeamMember): Avatar {
    const robot = makeRobot();
    robot.root.name = 'teammate';
    robot.root.rotation.order = 'YXZ';
    tailor(robot, safeColor(m.color));
    // The thruster glow is a real light; a new light in the scene makes three recompile every material.
    for (const c of [...robot.root.children]) if ((c as THREE.PointLight).isLight) c.removeFromParent();
    const merged = slim(robot.root);
    robot.root.traverse((o) => { o.castShadow = false; });
    const a: Avatar = { id: m.id, robot, color: m.color, vehicle: null, vehicleId: 'foot', exhaust: null, merged, far: standIn(safeColor(m.color)), shadows: false, netState: '', shown: false, dist: Infinity, label: '', labelAt: 0, say: null, skip: 0 };
    this.list.set(m.id, a);
    return a;
  }

  private hide(a: Avatar) {
    if (!a.shown) return;
    a.shown = false;
    a.dist = Infinity;
    a.robot.root.removeFromParent();
    a.far.removeFromParent();
    a.exhaust?.removeFromParent();
    a.vehicle?.group.removeFromParent();
    this.deps.labels.remove(`tm:${a.id}`);
    a.label = '';
  }

  private drop(a: Avatar) {
    this.hide(a);
    a.vehicle?.dispose();
    a.robot.dispose();
    a.merged.forEach((g) => g.dispose());
    (a.far.material as THREE.Material).dispose();
    this.list.delete(a.id);
  }

  private ride(a: Avatar, id: string, scene: THREE.Scene) {
    if (a.vehicleId !== id) {
      a.vehicle?.dispose();
      a.vehicle = RIDES.has(id) ? makeVehicle(id as Exclude<VehicleId, 'foot'>) : null;
      a.vehicleId = id;
      a.vehicle?.group.traverse((o) => { o.castShadow = a.shadows; });
    }
    if (a.vehicle && a.vehicle.group.parent !== scene) scene.add(a.vehicle.group);
  }

  update(dt: number) {
    const { deps, store } = this;
    const now = performance.now();
    const scene = deps.scene();
    const outdoors = deps.outdoors();
    const me = deps.me();
    const far = deps.lite() ? 350 : 900;
    this.frame++;
    const live = new Set<string>();
    const cam = deps.camera();
    this.frustum.setFromProjectionMatrix(this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));

    for (const m of store.here()) {
      const snaps = store.snaps.get(m.id);
      if (m.idle || !snaps?.length || now - snaps[snaps.length - 1].t > 6000) continue;
      live.add(m.id);
      // A new suit color (rare: the roster was renumbered) means a new robot: the color is baked in.
      const old = this.list.get(m.id);
      if (old && old.color !== m.color) this.drop(old);
      const a = this.list.get(m.id) ?? this.make(m);
      const p = sample(snaps, now);
      const root = a.robot.root;

      // Where they are in the scene being drawn, if anywhere.
      let ok = false;
      if (scene && p.in === 'hq') {
        if (!outdoors && deps.sameInterior(m)) { this.v.set(fin(p.x), fin(p.y), fin(p.z)); ok = true; }
      } else if (scene && !p.in && outdoors && deps.earth && p.lat != null && p.lon != null) {
        const L = deps.earth.frame.toLocal(p.lat, p.lon);
        let y = fin(p.alt) - deps.earth.e0;
        // On the ground, stand on this world's ground (the two terrains can differ by a few centimeters).
        if (fin(p.agl) < 0.6 && p.veh === 'foot') { const h = deps.earth.heightAt(L.x, L.z); if (Math.abs(h - y) < 3) y = h + fin(p.agl); }
        this.v.set(L.x, y, L.z);
        ok = Number.isFinite(L.x) && Number.isFinite(L.z);
      }
      const d = ok ? this.v.distanceTo(me) : Infinity;
      if (!ok || d > far) { this.hide(a); continue; }

      a.dist = d;
      if (!a.shown) { a.shown = true; a.labelAt = 0; }
      const near = d <= NEAR;
      const body = near ? root : a.far, other = near ? a.far : root;
      if (other.parent) { other.removeFromParent(); if (!near) { a.exhaust?.removeFromParent(); a.vehicle?.group.removeFromParent(); } }
      if (body.parent !== scene) { scene!.add(body); a.labelAt = 0; }
      root.position.copy(this.v);
      root.rotation.set(fin(p.rot[0]), fin(p.rot[1]), fin(p.rot[2]));
      a.far.position.copy(this.v);
      const head = this.v.clone();
      this.ball.center.copy(head); this.ball.center.y += 1;
      const seen = this.frustum.intersectsSphere(this.ball);
      // Shadows only up close (and never on a slow GPU or in VR).
      const shadows = d < SHADOW && !deps.lite();
      if (shadows !== a.shadows) {
        a.shadows = shadows;
        root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !((o as THREE.Mesh).material as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) o.castShadow = shadows; });
        a.vehicle?.group.traverse((o) => { o.castShadow = shadows; });
      }
      const r = a.robot;
      const st = STATES.has(p.st) ? (p.st as RobotState) : 'idle';
      if (near) {
      if (st !== a.netState) { a.netState = st; r.play(st); }
      r.speed = fin(p.sp);
      r.rockets = Math.min(1.6, Math.max(0, fin(p.rk)));
      r.lean.x = fin(p.lx); r.lean.z = fin(p.lz);
      r.wings = fin(p.wg);
      r.ride.cadence = fin(p.cad);
      r.airspeed = st === 'fall' ? 30 : 0;

      // Whatever they're riding sits under them, placed from where the robot's seat is.
      this.ride(a, p.veh, scene!);
      if (a.vehicle) {
        const v = a.vehicle;
        v.heading = fin(p.rot[1]); v.pitch = -fin(p.rot[0]); v.roll = fin(p.rot[2]);
        this.q.setFromEuler(this.e.set(fin(p.rot[0]), fin(p.rot[1]), fin(p.rot[2]), 'YXZ'));
        v.pos.copy(root.position).sub(this.v.copy(v.seat).applyQuaternion(this.q));
        v.speed = fin(p.sp);
        v.sync(dt);
      }

      // Animate only what's on screen: every frame nearby, every third frame further out.
      a.skip += dt;
      if (seen && (d < 60 || (this.frame + a.id.charCodeAt(0)) % 3 === 0)) {
        const before = scene!.children.length;
        r.update(Math.min(0.1, a.skip));
        a.skip = 0;
        // The robot parks its exhaust trail in the scene on its first update there; remember it so it leaves with the robot.
        if (scene!.children.length > before) a.exhaust = scene!.children[scene!.children.length - 1];
        else if (a.exhaust && a.exhaust.parent !== scene) a.exhaust = null;
      }
      }

      // Name tag (and what they're doing), and anything they just said.
      // While they're talking, the tag becomes the speech bubble (two labels on one head would hide each other).
      if (a.say && now >= a.say.until) a.say = null;
      const doing = workLine(m) || (st === 'wave' ? 'Waving' : '');
      const dot = `<i class="tm-dot" style="background:${safeColor(m.color)}"></i>`;
      const html = a.say ? `<b>${dot}${esc(m.name)}</b>${a.say.html}` : `${dot}${esc(m.name)}${doing ? `<small>${esc(doing)}</small>` : ''}`;
      head.y += HEAD + (a.vehicle && near ? 0.25 : 0);
      if (html !== a.label || now - a.labelAt > 500) { deps.labels.set(`tm:${a.id}`, head, html, { cls: a.say ? 'speech team-say' : 'team', maxDist: Math.min(far, a.say ? 200 : 420) }); a.label = html; a.labelAt = now; }
      else deps.labels.move(`tm:${a.id}`, head);
    }
    for (const a of [...this.list.values()]) if (!live.has(a.id)) this.drop(a);
    this.updateBeacons(now, outdoors ? scene : null);
  }

  // ---- "come here" markers: a tall beam and a ring on the ground where a teammate called from ----
  private updateBeacons(now: number, scene: THREE.Scene | null) {
    const earth = this.deps.earth;
    const pings = earth ? this.store.livePings() : [];
    for (const [key, b] of [...this.beacons]) {
      if (pings.includes(b.ping) && scene) continue;
      b.group.removeFromParent();
      b.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
      this.deps.labels.remove(`tm-ping:${key}`);
      this.beacons.delete(key);
    }
    if (!scene || !earth) return;
    for (const p of pings) {
      const key = `${p.from}:${p.ts}`;
      let b = this.beacons.get(key);
      if (!b) {
        const color = new THREE.Color(safeColor(this.store.member(p.from)?.color ?? '#ff5a1f'));
        const group = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 260, 10, 1, true).translate(0, 130, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.16, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
        ring.name = 'ring';
        group.add(beam, ring);
        this.beacons.set(key, (b = { group, ping: p }));
      }
      if (b.group.parent !== scene) scene.add(b.group);
      const L = earth.frame.toLocal(p.lat, p.lon);
      const y = Math.max(earth.heightAt(L.x, L.z), fin(p.alt) - earth.e0 - 1);
      b.group.position.set(L.x, Math.abs(y - (fin(p.alt) - earth.e0)) < 400 ? y : fin(p.alt) - earth.e0, L.z);
      const age = (now % 1600) / 1600;
      const ring = b.group.getObjectByName('ring')!;
      ring.scale.setScalar(0.6 + age * 1.4);
      ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age);
      b.group.visible = Date.now() - p.ts < PING_MS;
      this.v.copy(b.group.position); this.v.y += 4;
      if (this.frame % 30 === 0) this.deps.labels.set(`tm-ping:${key}`, this.v, `${esc(p.name)}<small>${p.mine ? 'Your marker' : 'Come here'}</small>`, { cls: 'team ping', maxDist: 2500 });
    }
  }

  dispose() {
    for (const a of [...this.list.values()]) this.drop(a);
    this.updateBeacons(0, null);
  }
}
