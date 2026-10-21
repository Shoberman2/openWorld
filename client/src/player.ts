import * as THREE from 'three';
import type { Robot } from './robot.ts';
import type { Input } from './input.ts';
import { makeVehicle, Plane, Shuttle, type Vehicle, type VehicleId, type VehicleWorld } from './vehicles/index.ts';

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
// Rocket shoes (m/s²). Thrust against quadratic drag gives the top speeds: ~38 m/s (85 mph)
// cruising, ~95 m/s (210 mph) on the afterburner, ~28 m/s straight up.
const LAUNCH_KICK = 13; // m/s added on ignition
const CLIMB = 12;
const THRUST = 22;
const BOOST = 3;
const DRAG = 0.0152;
const DRAG_BOOST = 0.0073;

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
  /** A VR headset drives the camera (client/src/xr): the chase camera stands down. */
  xrView = false;
  world!: PlayerWorld;
  /** Height above the ground under the player (for the HUD). */
  agl = 0;
  private camPos = new THREE.Vector3();
  /** Where the camera's subject was last frame: fast flights carry the camera along with it. */
  private lastHead = new THREE.Vector3();
  private haveHead = false;
  private zoom = 0;
  private rocketHold = 0;
  /** Ignition flash 1→0, afterburner 0..1, seconds left tumbling after a hard landing. */
  private kick = 0;
  private boost = 0;
  private stun = 0;
  private heading = 0;
  private bank = 0;
  private fovKick = 0;
  private shake = 0;
  private spaceWas = false;
  /** What you're riding ('foot' when walking). */
  vehicle: VehicleId = 'foot';
  /** Wingsuit out (Q in the air): glide, steer with the camera and A/D, rockets still burn. */
  wingsuit = false;
  /** Wingsuit glide path angle (rad, negative = descending) and bank, for the HUD and pose. */
  private glide = -0.3;
  private wingBank = 0;
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
  /** The prop plane's or shuttle's throttle 0..1 (null when not flying one). */
  get throttle() { return this.ride instanceof Plane || this.ride instanceof Shuttle ? this.ride.throttle : null; }
  /** What you're riding, for the flight readout and the autopilot. */
  get vehicleObj(): Vehicle | null { return this.ride; }
  /**
   * When set, flies the vehicle instead of its own physics (return true to take this frame). The
   * autopilot uses it; any of your own input should make it let go.
   */
  autopilot: ((v: Vehicle, dt: number) => boolean) | null = null;

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
    this.kick = 0; this.boost = 0; this.stun = 0;
    this.ch.play('idle');
    this.snapCamera();
  }

  /** The world re-centered under us (a long flight): move everything we hold by the same map. */
  shift(map: (v: THREE.Vector3) => void) {
    map(this.position);
    map(this.camPos);
    map(this.lastHead);
    map(this.camera.position);
    if (this.ride) { map(this.ride.pos); this.ride.sync(0); this.ride.robotRoot(this.ch.root.position); }
    else this.ch.root.position.copy(this.position);
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
      if (this.stun > 0) {
        // Rolling or stumbling out of a hard landing: momentum, no control.
        this.stun -= dt;
        this.speed = THREE.MathUtils.damp(this.speed, 0, 2.2, dt);
        v.x = Math.sin(this.facing) * this.speed; v.z = Math.cos(this.facing) * this.speed;
        p.x += v.x * dt; p.z += v.z * dt;
        ground = this.surface(p.x, p.z, p.y);
        if (ground < p.y - 1.2) { this.mode = 'air'; v.y = 0; } else p.y = ground;
      } else {
        const target = moving ? (swim ? (shift ? 3.4 : 2.1) : shift ? 7.2 : 3.2) : 0;
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
          if (this.mode === 'swim' && canFly) { this.mode = 'fly'; v.y = LAUNCH_KICK; this.kick = 1; } // blast out of the water
          else if (this.mode === 'walk') { this.mode = 'air'; v.y = JUMP; this.ch.play('jump'); this.rocketHold = 0; }
        }
      }
    } else {
      if (this.wingsuit && (this.mode === 'air' || this.mode === 'fly')) {
        this.updateWingsuit(dt, ax, space, shift, dive);
        ground = this.surface(p.x, p.z, p.y);
        const wy = this.world.water ? this.world.water(p.x, p.z) : NaN;
        if (!Number.isNaN(wy) && wy > ground + 0.6 && p.y <= wy - 1.05) {
          this.shake = Math.min(1, 0.25 + v.length() / 60);
          p.y = wy - 1.05; v.set(v.x * 0.3, 0, v.z * 0.3); this.mode = 'swim'; this.wingsuit = false;
        } else if (p.y <= ground) { this.wingsuit = false; this.touchDown(ground); }
      } else {
        // Airborne. Rocket shoes are real thrust, not a hover: Space burns them (a kick on ignition,
        // then lift that beats gravity, steered by where the camera looks while you move), Shift
        // is the afterburner, and letting go hands you back to gravity and your momentum.
        if (this.mode === 'air' && space) this.rocketHold += dt; else if (!space) this.rocketHold = 0;
        if (canFly && this.mode === 'air' && space && (pressed || this.rocketHold > 0.22)) {
          this.mode = 'fly';
          v.y = Math.max(v.y, 0) + LAUNCH_KICK; // ignition: you get thrown up, not lifted
          this.kick = 1; this.shake = Math.max(this.shake, 0.35);
        }
        if (this.mode === 'fly' && dive) this.mode = 'air';
        const fly = canFly && this.mode === 'fly';
        const burn = fly && space;
        const boost = fly && shift && (space || moving);
        this.boost = THREE.MathUtils.damp(this.boost, boost ? 1 : 0, boost ? 4 : 1.5, dt);
        const acc = new THREE.Vector3(0, -GRAVITY * (dive ? 1.8 : 1), 0);
        if (fly) {
          // Fly where you look: camera pitch aims the climb while you're moving.
          const aim = moving ? THREE.MathUtils.clamp(0.1 - (this.pitch - 0.18) * 2.4, -1, 1) : 1;
          if (burn) acc.y += GRAVITY + CLIMB * (1 + this.boost * 0.8) * aim;
          if (moving) acc.addScaledVector(dir, THRUST * (1 + this.boost * (BOOST - 1)));
          else if (burn) { v.x *= Math.exp(-dt * 1.2); v.z *= Math.exp(-dt * 1.2); } // hold to brake into a hover-climb
          // A body in a fast dive/glide makes a little lift, so a released burn is an arc, not a brick.
          const hs0 = Math.hypot(v.x, v.z);
          if (!burn) acc.y += Math.min(GRAVITY * 0.45, hs0 * hs0 * 0.008);
        } else if (moving) acc.addScaledVector(dir, 6); // air control on a jump
        // Quadratic air drag: speed builds and tops out instead of snapping to a fixed rate.
        const k = fly ? THREE.MathUtils.lerp(DRAG, DRAG_BOOST, this.boost) : 0.004;
        const vs = v.length();
        acc.addScaledVector(v, -k * vs);
        v.addScaledVector(acc, dt);
        if (moving && this.speed > 1) this.turnToward(Math.atan2(v.x, v.z), dt, fly ? 3.5 : 5);
        v.y = Math.max(v.y, -75);
        p.addScaledVector(v, dt);
        this.speed = Math.hypot(v.x, v.z);
        ground = this.surface(p.x, p.z, p.y);
        const wy = this.world.water ? this.world.water(p.x, p.z) : NaN;
        if (!Number.isNaN(wy) && wy > ground + 0.6 && p.y <= wy - 1.05) {
          this.shake = Math.min(1, 0.25 + v.length() / 60);
          p.y = wy - 1.05; v.set(v.x * 0.3, 0, v.z * 0.3); this.mode = 'swim';
        } else if (p.y <= ground) this.touchDown(ground);
        // Flames: idle pilot light when coasting, full burn on Space, long afterburner on boost.
        this.kick = Math.max(0, this.kick - dt * 2.5);
        const want = fly ? (burn || moving ? 0.75 + 0.75 * this.boost : 0.18) + this.kick * 0.6 : 0;
        this.ch.rockets = THREE.MathUtils.damp(this.ch.rockets, want, 12, dt);
        // Pose: pitch toward the velocity (Iron-Man flat at speed, upright on a vertical climb),
        // bank by how hard you're turning.
        const hs = this.speed, vy = v.y;
        const flat = fly ? THREE.MathUtils.clamp((hs - Math.max(0, vy) * 0.6) / 28, 0, 1) : 0;
        this.ch.lean.z = fly ? flat : 0;
        const turnRate = this.turnRate(Math.atan2(v.x, v.z), hs, dt);
        this.ch.lean.x = fly ? THREE.MathUtils.clamp((-turnRate * hs) / 18, -1, 1) : 0;
      }
    }
    if (!this.flying) this.wingsuit = false;
    this.ch.wings = THREE.MathUtils.damp(this.ch.wings, this.wingsuit ? 1 : 0, 6, dt);
    if (this.mode === 'walk' || this.mode === 'swim') { this.ch.rockets = THREE.MathUtils.damp(this.ch.rockets, 0, 12, dt); this.ch.lean.x = 0; this.ch.lean.z = 0; }
    void inWater; void swimY;

    const before = p.clone();
    this.world.colliders.resolve(p, 0.38);
    if (this.flying) this.hitWall(before, p);
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
    if (this.mode === 'fly' || (this.wingsuit && this.mode === 'air')) ch.play('fly');
    else if (this.mode === 'air') ch.play(this.vel.y > 1 ? 'jump' : 'fall');
    else if (ch.state !== 'land' && ch.state !== 'roll' && ch.state !== 'wave' && ch.state !== 'sit') ch.play(this.speed > 3.6 ? 'run' : this.speed > 0.4 ? 'walk' : 'idle');
    else if (ch.state === 'sit' && moving) ch.play('walk');
    ch.root.position.copy(p);
    ch.root.rotation.y = this.facing;
    ch.update(dt);

    this.updateCamera(dt);
  }

  /** Open or stow the wingsuit; only in the air, and not too close to the ground. */
  toggleWingsuit(): boolean {
    if (this.ride || !this.flying) { this.wingsuit = false; return false; }
    if (!this.wingsuit && this.agl < 8) return false;
    this.wingsuit = !this.wingsuit;
    if (this.wingsuit) {
      // Carry your speed into the glide.
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.glide = THREE.MathUtils.clamp(Math.atan2(this.vel.y, Math.max(hs, 1)), -0.9, 0.1);
      if (hs > 2) this.facing = Math.atan2(this.vel.x, this.vel.z);
    }
    return true;
  }

  /**
   * Wingsuit flight: a glider, not a rocket. The glide angle (W steeper and faster, S flatter and
   * slower) sets the speed the suit settles at, about 2.5:1; the camera and A/D turn you, banking;
   * Space burns the rocket shoes for thrust (a held burn can hold altitude), Shift is the burst.
   */
  private updateWingsuit(dt: number, ax: { x: number; y: number }, space: boolean, shift: boolean, dive: boolean) {
    const v = this.vel, p = this.position;
    const burn = space || shift;
    const want = THREE.MathUtils.clamp(-0.32 - ax.y * 0.4 - (dive ? 0.4 : 0) + (burn ? 0.32 + (shift ? 0.12 : 0) : 0), -1.0, burn ? 0.18 : -0.08);
    this.glide = THREE.MathUtils.damp(this.glide, want, 1.6, dt);
    // Steer: toward where the camera looks, plus A/D for a harder bank.
    let d = this.yaw - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = THREE.MathUtils.clamp(d * 1.2 + ax.x * -1.1, -1.2, 1.2);
    this.facing += turn * dt;
    this.wingBank = THREE.MathUtils.damp(this.wingBank, -turn / 1.2, 4, dt);
    // Speed the suit settles at for this glide angle (faster diving, slower flaring; rockets add).
    const vEq = 44 - this.glide * 40 + (burn ? 26 + (shift ? 24 : 0) : 0);
    const cg = Math.cos(this.glide);
    const dir = new THREE.Vector3(Math.sin(this.facing) * cg, Math.sin(this.glide), Math.cos(this.facing) * cg);
    // Settle toward that velocity: quick to turn the flight path, slower to change speed.
    const sp = v.length();
    const nextSp = THREE.MathUtils.damp(sp, vEq, 0.7, dt);
    v.lerp(dir.multiplyScalar(nextSp), 1 - Math.exp(-dt * 2.2));
    p.addScaledVector(v, dt);
    this.speed = Math.hypot(v.x, v.z);
    this.mode = burn ? 'fly' : 'air';
    this.ch.rockets = THREE.MathUtils.damp(this.ch.rockets, burn ? 0.75 + (shift ? 0.6 : 0) : 0.0, 10, dt);
    this.boost = THREE.MathUtils.damp(this.boost, shift ? 1 : 0, 3, dt);
    this.ch.lean.z = 1;
    this.ch.lean.x = this.wingBank;
  }

  /** Land from the air; how hard decides between a soft step, a crouch, and a roll. */
  private touchDown(ground: number) {
    const v = this.vel, p = this.position;
    const fall = -v.y, hs = Math.hypot(v.x, v.z);
    p.y = ground; v.y = 0;
    this.mode = 'walk';
    this.kick = 0;
    if (hs > 16 || fall > 28) {
      // Too fast to stick it: tuck and roll along the way you were going.
      if (hs > 1) this.facing = Math.atan2(v.x, v.z);
      this.speed = Math.min(hs, 11);
      this.stun = 0.75;
      this.ch.play('roll');
      this.shake = Math.min(1, 0.5 + (hs + fall) / 120);
    } else if (fall > 13 || hs > 9) {
      this.speed = Math.min(hs, 7.2);
      this.ch.play('land');
      this.shake = Math.min(1, fall / 30 + 0.3);
    } else this.speed = hs;
  }

  /** The collider pushed us out of a wall: kill the velocity into it, and slam if it was fast. */
  private hitWall(before: THREE.Vector3, after: THREE.Vector3) {
    const n = new THREE.Vector3(after.x - before.x, 0, after.z - before.z);
    if (n.lengthSq() < 1e-8) return;
    n.normalize();
    const v = this.vel;
    const into = -(v.x * n.x + v.z * n.z);
    if (into <= 0) return;
    v.x += n.x * into; v.z += n.z * into;
    if (into > 18) {
      this.shake = Math.min(1, into / 40);
      v.x += n.x * into * 0.15; v.z += n.z * into * 0.15; // bounce off a little
      if (this.mode === 'fly' && into > 30) this.mode = 'air'; // knocked the burn out of you
    }
  }

  /** Signed turn rate of the flight path (rad/s), smoothed. */
  private turnRate(heading: number, hs: number, dt: number) {
    let d = heading - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading = heading;
    const rate = hs > 2 && dt > 0 ? d / dt : 0;
    this.bank = THREE.MathUtils.damp(this.bank, THREE.MathUtils.clamp(rate, -3, 3), 6, dt);
    return this.bank;
  }

  private turnToward(target: number, dt: number, rate: number) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * rate);
  }

  private desiredCamera(out: THREE.Vector3) {
    const r = this.ride;
    const head = this.position.clone().add(new THREE.Vector3(0, r ? r.cam.height : 1.3, 0));
    const flyBack = r ? Math.min(4, Math.abs(r.speed) / 15) : this.mode === 'fly' ? 2.5 + Math.min(3.5, this.vel.length() / 18) : this.mode === 'air' ? 1.5 : 0;
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
    // Afterburner and ignition widen the lens a little (applied as a delta so photo mode's zoom is left alone).
    const fk = this.ride || this.xrView ? 0 : this.boost * 14 + this.kick * 5;
    const nextKick = THREE.MathUtils.damp(this.fovKick, fk, 5, dt);
    if (Math.abs(nextKick - this.fovKick) > 0.01) {
      this.camera.fov += nextKick - this.fovKick;
      this.fovKick = nextKick;
      this.camera.updateProjectionMatrix();
    }
    if (this.xrView) return;
    const want = new THREE.Vector3();
    const head = this.desiredCamera(want);
    const fast = this.mode === 'fly' || this.mode === 'air' ? Math.min(18, this.vel.length() * 0.2) : 0;
    // Past ~60 m/s (shuttle, plane, wingsuit, afterburner) the camera rides along with you and only
    // the offset is smoothed; otherwise it falls kilometers behind at Mach 1.
    const subjectSpeed = this.ride ? this.ride.speed : this.vel.length();
    if (this.haveHead && subjectSpeed > 60) this.camPos.add(head.clone().sub(this.lastHead));
    this.lastHead.copy(head); this.haveHead = true;
    this.camPos.lerp(want, 1 - Math.exp(-dt * (this.mode === 'fly' || this.ride ? 9 + fast : 14)));
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
    if (id === 'shuttle' && this.mode === 'swim') return false;
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
    else if (id === 'shuttle') { v.pitch = airborne ? Math.max(-0.2, Math.atan2(this.vel.y, Math.max(1, Math.hypot(this.vel.x, this.vel.z)))) : 0; (v as Shuttle).launch(airborne, this.vel.length()); }
    else if (airborne) { v.grounded = false; v.vy = this.vel.y; }
    if (id !== 'plane' && id !== 'kayak' && id !== 'boat' && id !== 'shuttle') v.speed = Math.max(0, this.vel.x * Math.sin(heading) + this.vel.z * Math.cos(heading));
    this.ride = v;
    this.vehicle = id;
    this.vehicleGroup.add(v.group);
    this.ch.boardOnBack = id !== 'skate';
    this.ch.rockets = 0;
    this.ch.lean.x = this.ch.lean.z = 0;
    this.mode = (id === 'plane' || id === 'shuttle') && airborne ? 'fly' : 'walk';
    this.wingsuit = false;
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
    const r = this.autopilot?.(v, dt) ? 'ok' : v.step(dt, {
      throttle: ax.y, steer: ax.x, space, spacePressed: pressed,
      shift: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      dive: this.input.down('KeyC') || this.input.down('ControlLeft'),
    }, this.vw);
    v.sync(dt);
    if (r === 'crash') { this.crash(); return; }
    this.position.copy(v.pos);
    this.facing = v.heading;
    this.speed = Math.abs(v.speed);
    const aircraft = v instanceof Plane || v instanceof Shuttle;
    this.mode = aircraft && !v.grounded ? 'fly' : 'walk';
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
      this.yaw += d * Math.min(1, dt * (aircraft ? 3 : 2.2));
      this.pitch = THREE.MathUtils.damp(this.pitch, v.cam.pitch + (aircraft ? -v.pitch * 0.5 : 0), 1.5, dt);
    }
    this.updateCamera(dt);
  }

  /** Step off: next to it on land, into the water from a boat, into free fall from a plane. */
  private dismount() {
    const v = this.ride!;
    const out = v.exitPoint(new THREE.Vector3());
    const f = v.forward;
    this.vel.set(f.x * v.speed * 0.5, v.grounded ? 0 : v.vy, f.z * v.speed * 0.5);
    const inAir = !v.grounded && (v.id === 'plane' || v.id === 'shuttle' || v.id === 'skate' || v.id === 'bike' || v.id === 'jeep');
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
    this.haveHead = false;
    this.desiredCamera(want);
    this.camPos.copy(want);
    this.camera.position.copy(want);
  }
}
