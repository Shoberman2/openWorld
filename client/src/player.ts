import * as THREE from 'three';
import type { Robot } from './robot.ts';
import type { Input } from './input.ts';
import { makeVehicle, Plane, type Vehicle, type VehicleId, type VehicleWorld } from './vehicles/index.ts';

export interface Box {
  minX: number; maxX: number; minZ: number; maxZ: number; maxY: number;
  /** Optional footprint polygon [x0,z0,x1,z1,...] inside the bounding box (real-world buildings). */
  poly?: number[];
  minY?: number;
  /** Set by Colliders.add(box, owner) so a streamed-out chunk can take its boxes with it. */
  owner?: string;
}

/** Point-in-polygon (even-odd) for a flat [x,z,...] ring. */
export function inPoly(poly: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on a polygon's boundary to (x,z). */
function closestOnPoly(poly: number[], x: number, z: number) {
  let bx = 0, bz = 0, bd = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j], az = poly[j + 1], ex = poly[i] - ax, ez = poly[i + 1] - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? THREE.MathUtils.clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1) : 0;
    const px = ax + ex * t, pz = az + ez * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  return { x: bx, z: bz, d: Math.sqrt(bd) };
}

/** 2D spatial hash of boxes: building footprints, desks, walls, poles, trees. */
export class Colliders {
  private cells = new Map<string, Box[]>();
  private owners = new Map<string, Box[]>();
  constructor(private cell = 32) {}

  add(b: Box, owner?: string) {
    const c = this.cell;
    for (let x = Math.floor(b.minX / c); x <= Math.floor(b.maxX / c); x++)
      for (let z = Math.floor(b.minZ / c); z <= Math.floor(b.maxZ / c); z++) {
        const k = `${x},${z}`;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
    if (owner) {
      b.owner = owner;
      let l = this.owners.get(owner);
      if (!l) this.owners.set(owner, (l = []));
      l.push(b);
    }
  }

  removeOwner(owner: string) {
    const list = this.owners.get(owner);
    if (!list) return;
    const c = this.cell;
    const touched = new Set<string>();
    for (const b of list)
      for (let x = Math.floor(b.minX / c); x <= Math.floor(b.maxX / c); x++)
        for (let z = Math.floor(b.minZ / c); z <= Math.floor(b.maxZ / c); z++) touched.add(`${x},${z}`);
    for (const k of touched) {
      const l = this.cells.get(k);
      if (!l) continue;
      const kept = l.filter((b) => b.owner !== owner);
      if (kept.length) this.cells.set(k, kept); else this.cells.delete(k);
    }
    this.owners.delete(owner);
  }

  clear() { this.cells.clear(); this.owners.clear(); }

  near(x: number, z: number): Box[] {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    const out = new Set<Box>();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.cells.get(`${cx + i},${cz + j}`)?.forEach((b) => out.add(b));
    return [...out];
  }

  private inside(b: Box, x: number, z: number) {
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && (!b.poly || inPoly(b.poly, x, z));
  }

  /** Highest box top at (x,z) that a body at height y could stand on (step up to `step`). */
  topBelow(x: number, z: number, y: number, step = 0.6) {
    let best = -Infinity;
    const l = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    if (!l) return best;
    for (const b of l) if (b.maxY <= y + step && b.maxY > best && this.inside(b, x, z)) best = b.maxY;
    return best;
  }

  /** Push a circle at (p.x,p.z) out of any box it overlaps (boxes it stands on top of don't count). */
  resolve(p: THREE.Vector3, r: number) {
    for (const b of this.near(p.x, p.z)) {
      if (p.y >= b.maxY - 0.05 || (b.minY !== undefined && p.y + 1.6 < b.minY)) continue;
      if (b.poly) {
        if (p.x < b.minX - r || p.x > b.maxX + r || p.z < b.minZ - r || p.z > b.maxZ + r) continue;
        const inside = inPoly(b.poly, p.x, p.z);
        const c = closestOnPoly(b.poly, p.x, p.z);
        if (!inside && c.d >= r) continue;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.max(c.d, 1e-4);
        const k = inside ? -1 : 1;
        p.x = c.x + (dx / d) * r * k;
        p.z = c.z + (dz / d) * r * k;
        continue;
      }
      const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        const opts = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z];
        const m = Math.min(...opts);
        if (m === opts[0]) p.x = b.minX - r; else if (m === opts[1]) p.x = b.maxX + r;
        else if (m === opts[2]) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
    }
  }

  /** Fraction (0..1) along from→to before hitting a box (for the camera). */
  rayFraction(from: THREE.Vector3, to: THREE.Vector3): number {
    const steps = THREE.MathUtils.clamp(Math.ceil(from.distanceTo(to) / 5), 8, 160);
    const p = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      p.lerpVectors(from, to, f);
      for (const b of this.near(p.x, p.z)) {
        if (p.y < b.maxY && p.x > b.minX - 0.25 && p.x < b.maxX + 0.25 && p.z > b.minZ - 0.25 && p.z < b.maxZ + 0.25
          && (b.minY === undefined || p.y > b.minY) && (!b.poly || inPoly(b.poly, p.x, p.z))) {
          return Math.max(0.08, (i - 1) / steps);
        }
      }
    }
    return 1;
  }
}

export interface PlayerWorld {
  colliders: Colliders;
  groundY(x: number, z: number): number;
  /** Highest walkable surface at (x,z) at or below y (+ a step): terrain, bridge decks, roofs. Defaults to groundY. */
  support?(x: number, z: number, y: number): number;
  /** Water surface height at (x,z), or NaN when dry. */
  water?(x: number, z: number): number;
  /** Rocket boots allowed (outdoors). */
  canFly?: boolean;
  /** Optional bounds; the player is clamped inside. */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Optional no-go test; the player slides back out. */
  blocked?(x: number, z: number): boolean;
}

export type MoveMode = 'walk' | 'air' | 'fly' | 'swim';

const GRAVITY = 24;
const JUMP = 7.2;

/**
 * The player: walk, run, jump, and fly on rocket shoes (hold Space in the air; Shift for a burst).
 * Land on roofs and bridges; swim when you come down in water.
 */
export class Player {
  position = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; // camera yaw
  pitch = 0.18;
  facing = 0; // character yaw
  distance = 4.4;
  speed = 0; // horizontal speed, m/s
  mode: MoveMode = 'walk';
  camCollide = true;
  world!: PlayerWorld;
  /** Height above the ground under the player (for the HUD). */
  agl = 0;
  private camPos = new THREE.Vector3();
  private zoom = 0;
  private rocketHold = 0;
  private shake = 0;
  private spaceWas = false;
  /** What you're riding ('foot' when walking). */
  vehicle: VehicleId = 'foot';
  /** Vehicle meshes live here (world space): add it to the scene next to the robot's root. */
  vehicleGroup = new THREE.Group();
  private ride: Vehicle | null = null;
  private clock = 0;
  private lastMouse = -10;
  private vw: VehicleWorld = {
    surface: (x, z, y) => this.surface(x, z, y),
    water: (x, z) => (this.world.water ? this.world.water(x, z) : NaN),
    colliders: null as unknown as Colliders,
  };

  /** Speed of whatever carries you (m/s), for the HUD. */
  get vehicleSpeed() { return this.ride ? Math.abs(this.ride.speed) : this.speed; }
  /** The prop plane's throttle 0..1 (null when not flying one). */
  get throttle() { return this.ride instanceof Plane ? this.ride.throttle : null; }

  constructor(public ch: Robot, private input: Input, private camera: THREE.PerspectiveCamera) {
    window.addEventListener('wheel', (e) => {
      if (!this.input.enabled) return;
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.004, -2, 10);
    }, { passive: true });
  }

  setWorld(world: PlayerWorld, pos: THREE.Vector3, facing = 0) {
    if (this.ride) this.dropRide();
    this.world = world;
    this.position.copy(pos);
    this.position.y = this.surface(pos.x, pos.z, pos.y + 400);
    this.vel.set(0, 0, 0);
    this.mode = 'walk';
    this.facing = facing;
    this.yaw = facing;
    this.ch.root.position.copy(this.position);
    this.ch.root.rotation.set(0, facing, 0);
    this.ch.rockets = 0;
    this.ch.play('idle');
    this.snapCamera();
  }

  /** Drop the player onto whatever is below (x, z), from above. */
  placeAt(x: number, z: number, facing = this.facing) {
    this.setWorld(this.world, new THREE.Vector3(x, 0, z), facing);
  }

  private surface(x: number, z: number, y: number) {
    const w = this.world;
    const s = w.support ? w.support(x, z, y) : w.groundY(x, z);
    return Math.max(s, w.colliders.topBelow(x, z, y));
  }

  /** Forward unit vector on the ground plane for the current camera yaw. */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get flying() { return this.mode === 'fly' || this.mode === 'air'; }

  update(dt: number) {
    const m = this.input.consumeMouse();
    this.yaw -= m.x * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch + m.y * 0.0022, -0.7, 1.35);
    this.clock += dt;
    if (m.x || m.y) this.lastMouse = this.clock;
    if (this.ride) { this.updateRide(dt); return; }

    const ax = this.input.axes();
    const moving = ax.x !== 0 || ax.y !== 0;
    const shift = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const space = this.input.down('Space');
    const dive = this.input.down('KeyC') || this.input.down('ControlLeft');
    const pressed = space && !this.spaceWas;
    this.spaceWas = space;
    const fwd = this.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3();
    // `right` is screen-right for the chase camera, so D (ax.x = +1) strafes right.
    if (moving) dir.copy(fwd).multiplyScalar(ax.y).addScaledVector(right, ax.x).normalize();

    const p = this.position, v = this.vel;
    const prevX = p.x, prevZ = p.z;
    const canFly = this.world.canFly !== false && !!this.world.support;
    const waterY = this.world.water ? this.world.water(p.x, p.z) : NaN;
    let ground = this.surface(p.x, p.z, p.y);
    const inWater = !Number.isNaN(waterY) && waterY > ground + 0.6;
    const swimY = waterY - 1.05;

    if (this.mode === 'walk' || this.mode === 'swim') {
      const swim = this.mode === 'swim';
      const target = moving ? (swim ? (shift ? 3.4 : 1.8) : shift ? 6.4 : 2.2) : 0;
      this.speed = THREE.MathUtils.damp(this.speed, target, swim ? 3 : 10, dt);
      if (moving) {
        this.turnToward(Math.atan2(dir.x, dir.z), dt, 12);
        v.x = dir.x * this.speed; v.z = dir.z * this.speed;
      } else { v.x *= Math.exp(-dt * 10); v.z *= Math.exp(-dt * 10); }
      p.x += v.x * dt; p.z += v.z * dt;
      ground = this.surface(p.x, p.z, p.y);
      const wy = this.world.water ? this.world.water(p.x, p.z) : NaN;
      const wet = !Number.isNaN(wy) && wy > ground + 0.6;
      if (wet) { this.mode = 'swim'; p.y = THREE.MathUtils.damp(p.y, wy - 1.05, 6, dt); }
      else {
        if (swim) this.mode = 'walk';
        if (ground < p.y - 1.2) { this.mode = 'air'; v.y = 0; } // walked off a ledge
        else p.y = ground;
      }
      if (pressed) {
        if (this.mode === 'swim' && canFly) { this.mode = 'fly'; v.y = 6; }
        else if (this.mode === 'walk') { this.mode = 'air'; v.y = JUMP; this.ch.play('jump'); this.rocketHold = 0; }
      }
    } else {
      // Airborne: gravity, air control, rockets while Space is held.
      // Rockets: once lit they hold you up (hover) until you land or dive with C.
      if (this.mode === 'air' && space) this.rocketHold += dt; else if (!space) this.rocketHold = 0;
      if (canFly && this.mode === 'air' && space && (pressed || this.rocketHold > 0.22) && v.y < 3) this.mode = 'fly';
      if (this.mode === 'fly' && dive) this.mode = 'air';
      const rockets = canFly && this.mode === 'fly';
      const fast = shift && this.mode === 'fly';
      const maxH = this.mode === 'fly' ? (fast ? 85 : 26) : 7;
      const acc = this.mode === 'fly' ? (fast ? 55 : 22) : 6;
      if (moving) {
        v.x += dir.x * acc * dt; v.z += dir.z * acc * dt;
        this.turnToward(Math.atan2(v.x, v.z), dt, 5);
      }
      const hs = Math.hypot(v.x, v.z);
      if (hs > maxH) { v.x *= maxH / hs; v.z *= maxH / hs; }
      const drag = this.mode === 'fly' ? (moving ? 0.35 : 1.6) : 0.15;
      v.x *= Math.exp(-dt * drag); v.z *= Math.exp(-dt * drag);
      if (this.mode === 'fly') {
        // Space climbs, letting go hovers (gently sinking), C dives.
        const want = space ? (fast ? 14 : 9) : -0.6;
        v.y = THREE.MathUtils.damp(v.y, want, space ? 2.5 : 1.8, dt);
      } else v.y -= GRAVITY * dt * (dive ? 1.8 : 1);
      v.y = Math.max(v.y, -60);
      p.addScaledVector(v, dt);
      this.speed = Math.hypot(v.x, v.z);
      ground = this.surface(p.x, p.z, p.y);
      const wy = this.world.water ? this.world.water(p.x, p.z) : NaN;
      if (!Number.isNaN(wy) && wy > ground + 0.6 && p.y <= wy - 1.05) {
        p.y = wy - 1.05; v.y = 0; this.mode = 'swim'; this.shake = 0.25;
      } else if (p.y <= ground) {
        const hard = v.y < -14;
        p.y = ground; v.y = 0;
        this.mode = 'walk';
        if (hard) { this.ch.play('land'); this.shake = Math.min(1, -v.y / 30 + 0.5); }
      }
      this.ch.rockets = THREE.MathUtils.damp(this.ch.rockets, rockets ? (fast ? 1 : space || moving ? 0.75 : 0.45) : 0, 10, dt);
      this.ch.lean.z = this.mode === 'fly' ? THREE.MathUtils.clamp(this.speed / 30, 0, 1) : 0;
      const side = moving ? -ax.x : 0;
      this.ch.lean.x = this.mode === 'fly' ? side * 0.6 : 0;
    }
    if (this.mode === 'walk' || this.mode === 'swim') { this.ch.rockets = THREE.MathUtils.damp(this.ch.rockets, 0, 12, dt); this.ch.lean.x = 0; this.ch.lean.z = 0; }
    void inWater; void swimY;

    this.world.colliders.resolve(p, 0.38);
    const b = this.world.bounds;
    if (b) {
      p.x = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
      p.z = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    }
    const no = this.world.blocked;
    if (no && no(p.x, p.z)) {
      if (!no(p.x, prevZ)) p.z = prevZ;
      else if (!no(prevX, p.z)) p.x = prevX;
      else { p.x = prevX; p.z = prevZ; }
      if (this.mode === 'walk') p.y = this.surface(p.x, p.z, p.y);
    }
    this.agl = p.y - (this.world.support ? this.world.support(p.x, p.z, p.y) : this.world.groundY(p.x, p.z));

    // Animation.
    const ch = this.ch;
    ch.speed = this.speed;
    if (this.mode === 'fly') ch.play('fly');
    else if (this.mode === 'air') ch.play(this.vel.y > 1 ? 'jump' : 'fall');
    else if (ch.state !== 'land' && ch.state !== 'wave' && ch.state !== 'sit') ch.play(this.speed > 3.6 ? 'run' : this.speed > 0.4 ? 'walk' : 'idle');
    else if (ch.state === 'sit' && moving) ch.play('walk');
    ch.root.position.copy(p);
    ch.root.rotation.y = this.facing;
    ch.update(dt);

    this.updateCamera(dt);
  }

  private turnToward(target: number, dt: number, rate: number) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * rate);
  }

  private desiredCamera(out: THREE.Vector3) {
    const r = this.ride;
    const head = this.position.clone().add(new THREE.Vector3(0, r ? r.cam.height : 1.3, 0));
    const flyBack = r ? Math.min(4, Math.abs(r.speed) / 15) : this.mode === 'fly' ? 3 + Math.min(4, this.speed / 15) : this.mode === 'air' ? 1.5 : 0;
    const dist = Math.max(1.6, (r ? r.cam.dist : this.distance) + flyBack + this.zoom);
    const back = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    out.copy(head).addScaledVector(back, dist);
    // Over-the-shoulder offset (on foot).
    const sh = r ? 0 : 0.4;
    out.x += Math.cos(this.yaw) * -sh;
    out.z += -Math.sin(this.yaw) * -sh;
    const f = this.camCollide ? this.world.colliders.rayFraction(head, out) : 1;
    out.lerpVectors(head, out, f);
    const w = this.world;
    const gy = (w.support ? w.support(out.x, out.z, out.y) : w.groundY(out.x, out.z)) + 0.35;
    if (out.y < gy) out.y = gy;
    return head;
  }

  private updateCamera(dt: number) {
    const want = new THREE.Vector3();
    const head = this.desiredCamera(want);
    this.camPos.lerp(want, 1 - Math.exp(-dt * (this.mode === 'fly' || this.ride ? 9 : 14)));
    this.camera.position.copy(this.camPos);
    const look = head.clone();
    const sh = this.ride ? 0 : 0.4;
    look.x += Math.cos(this.yaw) * -sh;
    look.z += -Math.sin(this.yaw) * -sh;
    look.addScaledVector(this.forward(), 0.6);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(look);
  }

  // ---------------------------------------------------------------------------------------------
  // Vehicles

  /**
   * Get on something (or 'foot' to get off). Returns false when it can't happen here: no boats away
   * from water (a kayak finds the nearest water within ~60 m), planes need ~45 m of clear ground
   * unless you're already in the air, nothing indoors.
   */
  setVehicle(id: VehicleId): boolean {
    if (id === this.vehicle) return true;
    if (this.ride) this.dismount();
    if (id === 'foot') return true;
    if (!this.world.support) return false;
    this.vw.colliders = this.world.colliders;
    const p = this.position;
    const airborne = this.agl > 4 && (this.mode === 'fly' || this.mode === 'air');
    let at = p.clone(), heading = this.facing;
    if (id === 'kayak' || id === 'boat') {
      const spot = this.findWater(p.x, p.z);
      if (!spot) return false;
      at = spot;
      if (spot.distanceTo(p) > 2) heading = Math.atan2(spot.x - p.x, spot.z - p.z);
    } else if (this.mode === 'swim') return false;
    if (id === 'plane' && !airborne) {
      const h = this.findRunway(p, this.facing);
      if (h === null) return false;
      heading = h;
    }
    const v = makeVehicle(id);
    v.pos.copy(at);
    if (!(id === 'kayak' || id === 'boat')) v.pos.y = airborne ? p.y : this.surface(at.x, at.z, p.y + 0.5);
    v.heading = heading;
    if (id === 'plane') (v as Plane).launch(airborne);
    else if (airborne) { v.grounded = false; v.vy = this.vel.y; }
    if (id !== 'plane' && id !== 'kayak' && id !== 'boat') v.speed = Math.max(0, this.vel.x * Math.sin(heading) + this.vel.z * Math.cos(heading));
    this.ride = v;
    this.vehicle = id;
    this.vehicleGroup.add(v.group);
    this.ch.boardOnBack = id !== 'skate';
    this.ch.rockets = 0;
    this.ch.lean.x = this.ch.lean.z = 0;
    this.mode = id === 'plane' && airborne ? 'fly' : 'walk';
    v.sync(0);
    this.yaw = heading;
    this.pitch = v.cam.pitch;
    return true;
  }

  private updateRide(dt: number) {
    const v = this.ride!;
    const ax = this.input.axes();
    const space = this.input.down('Space');
    const pressed = space && !this.spaceWas;
    this.spaceWas = space;
    const r = v.step(dt, {
      throttle: ax.y, steer: ax.x, space, spacePressed: pressed,
      shift: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      dive: this.input.down('KeyC') || this.input.down('ControlLeft'),
    }, this.vw);
    v.sync(dt);
    if (r === 'crash') { this.crash(); return; }
    this.position.copy(v.pos);
    this.facing = v.heading;
    this.speed = Math.abs(v.speed);
    this.mode = v instanceof Plane && !v.grounded ? 'fly' : 'walk';
    this.agl = v.pos.y - (this.world.support ? this.world.support(v.pos.x, v.pos.z, v.pos.y) : 0);
    // The robot rides along.
    const ch = this.ch;
    v.robotRoot(ch.root.position);
    ch.root.quaternion.copy(v.quaternion);
    ch.play(v.pose);
    ch.ride.cadence = v.cadence; ch.ride.steer = v.steerLook; ch.ride.air = v.air;
    ch.speed = this.speed;
    ch.rockets = THREE.MathUtils.damp(ch.rockets, 0, 12, dt);
    ch.update(dt);
    // Chase camera: swing in behind unless you've been looking around with the mouse.
    if (this.clock - this.lastMouse > 1.2) {
      let d = v.heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (v instanceof Plane ? 3 : 2.2));
      this.pitch = THREE.MathUtils.damp(this.pitch, v.cam.pitch + (v instanceof Plane ? -v.pitch * 0.5 : 0), 1.5, dt);
    }
    this.updateCamera(dt);
  }

  /** Step off: next to it on land, into the water from a boat, into free fall from a plane. */
  private dismount() {
    const v = this.ride!;
    const out = v.exitPoint(new THREE.Vector3());
    const f = v.forward;
    this.vel.set(f.x * v.speed * 0.5, v.grounded ? 0 : v.vy, f.z * v.speed * 0.5);
    const inAir = !v.grounded && (v.id === 'plane' || v.id === 'skate' || v.id === 'bike' || v.id === 'jeep');
    this.dropRide();
    const wy = this.world.water ? this.world.water(out.x, out.z) : NaN;
    const g = this.surface(out.x, out.z, out.y + 2);
    if (inAir) { this.position.set(out.x, v.pos.y, out.z); this.mode = 'air'; this.ch.play('fall'); }
    else if (!Number.isNaN(wy) && wy > g + 0.6) { this.position.set(out.x, wy - 1.05, out.z); this.mode = 'swim'; this.vel.set(0, 0, 0); }
    else { this.position.set(out.x, g, out.z); this.mode = 'walk'; this.vel.set(0, 0, 0); this.ch.play('idle'); }
    this.world.colliders.resolve(this.position, 0.38);
    this.ch.root.position.copy(this.position);
  }

  private crash() {
    const v = this.ride!;
    this.shake = 1;
    this.dismount();
    this.vel.y = Math.max(this.vel.y, 3);
    if (this.mode === 'walk') this.ch.play('land');
    void v;
  }

  private dropRide() {
    this.ride?.dispose();
    this.ride = null;
    this.vehicle = 'foot';
    this.ch.boardOnBack = true;
    this.ch.ride.cadence = 0; this.ch.ride.air = 0; this.ch.ride.steer = 0;
    this.ch.root.quaternion.identity();
    this.ch.root.rotation.y = this.facing;
  }

  /** Nearest open water within ~60 m (surface well above the bed), or null. */
  private findWater(x: number, z: number): THREE.Vector3 | null {
    const water = this.world.water;
    if (!water) return null;
    const wet = (px: number, pz: number) => {
      const wy = water(px, pz);
      return !Number.isNaN(wy) && this.surface(px, pz, wy) < wy - 0.5 ? wy : NaN;
    };
    for (let r = 0; r <= 60; r += 3) {
      const n = r === 0 ? 1 : Math.ceil((r * Math.PI * 2) / 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        // Two meters further out than the first wet cell, so the hull clears the bank.
        const px = x + Math.sin(a) * (r + (r ? 2 : 0)), pz = z + Math.cos(a) * (r + (r ? 2 : 0));
        const wy = wet(px, pz);
        if (!Number.isNaN(wy)) return new THREE.Vector3(px, wy, pz);
      }
    }
    return null;
  }

  /** A heading with ~45 m of flat, dry, unobstructed ground ahead (preferring the way you face). */
  private findRunway(p: THREE.Vector3, facing: number): number | null {
    const g0 = this.surface(p.x, p.z, p.y + 1);
    const test = new THREE.Vector3();
    for (let k = 0; k < 16; k++) {
      const h = facing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
      let ok = true;
      for (let d = 4; d <= 45 && ok; d += 4) {
        const x = p.x + Math.sin(h) * d, z = p.z + Math.cos(h) * d;
        const g = this.surface(x, z, g0 + 4);
        const wy = this.world.water ? this.world.water(x, z) : NaN;
        if (Math.abs(g - g0) > 2.5 || (!Number.isNaN(wy) && wy > g)) ok = false;
        // Check at wing height: trees and lamp posts don't block a take-off roll, buildings do.
        test.set(x, g + 4, z);
        this.world.colliders.resolve(test, 2.4);
        if (Math.hypot(test.x - x, test.z - z) > 0.05) ok = false;
      }
      if (ok) return h;
    }
    return null;
  }

  snapCamera() {
    const want = new THREE.Vector3();
    this.desiredCamera(want);
    this.camPos.copy(want);
    this.camera.position.copy(want);
  }
}
