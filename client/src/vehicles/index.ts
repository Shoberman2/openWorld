// Things to ride: the skateboard off your back, a bike, a jeep, a little prop plane, a kayak and a
// motorboat. Arcade physics against the streamed world: terrain/roof/bridge heights from
// PlayerWorld.support, water from PlayerWorld.water, buildings from the colliders.
import * as THREE from 'three';
import type { Colliders } from '../player.ts';
import type { RobotState } from '../robot.ts';
import { Plume } from './plume.ts';
import { bikeModel, boatModel, jeepModel, kayakModel, planeModel, shuttleModel, skateboardModel, type Model } from './models.ts';

export type VehicleId = 'foot' | 'skate' | 'bike' | 'jeep' | 'plane' | 'kayak' | 'boat' | 'shuttle';

export interface VehicleInput {
  throttle: number; // -1..1 (W/S)
  steer: number; // -1..1 (D = +1 = turn right)
  space: boolean;
  spacePressed: boolean;
  shift: boolean;
  dive: boolean; // C
}

export interface VehicleWorld {
  surface(x: number, z: number, y: number): number;
  water(x: number, z: number): number;
  colliders: Colliders;
}

export type StepResult = 'ok' | 'crash';

const G = 9.81;
const tmpV = new THREE.Vector3();

export abstract class Vehicle {
  abstract readonly id: Exclude<VehicleId, 'foot'>;
  model: Model;
  pos = new THREE.Vector3();
  heading = 0;
  pitch = 0; // nose up > 0
  roll = 0; // right side down > 0
  speed = 0; // along the heading, m/s
  vy = 0;
  grounded = true;
  /** Where the robot's root sits (local), its pose, and how the chase camera frames it. */
  abstract readonly seat: THREE.Vector3;
  abstract readonly pose: RobotState;
  abstract readonly cam: { dist: number; height: number; pitch: number };
  cadence = 0;
  steerLook = 0;
  air = 0;
  private travelled = 0;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(model: Model) { this.model = model; }

  get group() { return this.model.group; }
  // Right side down is a positive roll about the vehicle's own Z (its right is local -X).
  get quaternion() { return this.q.setFromEuler(this.e.set(-this.pitch, this.heading, this.roll, 'YXZ')); }
  private fv = new THREE.Vector3();
  get forward() { return this.fv.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  abstract step(dt: number, inp: VehicleInput, w: VehicleWorld): StepResult;

  /** Copy the physics state onto the mesh and spin the wheels. */
  sync(dt: number) {
    const g = this.model.group;
    g.position.copy(this.pos);
    g.quaternion.copy(this.quaternion);
    this.travelled += this.speed * dt;
    for (const wh of this.model.wheels) {
      wh.obj.rotation.x = this.travelled / wh.r;
      if (wh.steer) wh.obj.rotation.y = -this.steerLook * 0.45;
    }
  }

  /** World position for the robot's root. */
  robotRoot(out: THREE.Vector3) {
    return out.copy(this.seat).applyQuaternion(this.quaternion).add(this.pos);
  }

  /** Where to stand after getting off. */
  exitPoint(out: THREE.Vector3, side = 1.4) {
    const f = this.forward;
    return out.set(this.pos.x - f.z * side, this.pos.y, this.pos.z + f.x * side);
  }

  dispose() { this.model.group.removeFromParent(); this.model.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Wheels on the ground

interface GroundSpec {
  max: number; boost: number; accel: number; brake: number; drag: number; coast: number;
  steer: number; steerFalloff: number; length: number; width: number; radius: number; jump: number; reverse: number;
  lean: number; // visual lean into turns (bikes, boards)
}

abstract class GroundVehicle extends Vehicle {
  abstract readonly spec: GroundSpec;
  private gp = 0; // smoothed terrain pitch
  private gr = 0;

  step(dt: number, inp: VehicleInput, w: VehicleWorld): StepResult {
    const S = this.spec;
    const top = S.max * (inp.shift ? S.boost : 1);
    if (inp.throttle > 0) this.speed += S.accel * inp.throttle * (inp.shift ? 1.4 : 1) * dt;
    else if (inp.throttle < 0) this.speed -= (this.speed > 0.3 ? S.brake : S.accel * 0.6) * -inp.throttle * dt;
    // Rolling resistance and air drag.
    const d = (S.coast + S.drag * Math.abs(this.speed)) * dt;
    this.speed = Math.abs(this.speed) <= d ? 0 : this.speed - Math.sign(this.speed) * d;
    if (this.id === 'jeep' && inp.space && this.grounded) this.speed *= Math.exp(-dt * 1.6); // handbrake
    this.speed = THREE.MathUtils.clamp(this.speed, -S.max * S.reverse, top);
    // Steering: full lock when slow, tighter at speed; hand-brake turns sharper.
    const k = THREE.MathUtils.clamp(Math.abs(this.speed) / 3, 0, 1) / (1 + Math.abs(this.speed) / S.steerFalloff);
    const turn = inp.steer * S.steer * k * (this.id === 'jeep' && inp.space ? 1.8 : 1) * (this.grounded ? 1 : 0.35);
    this.heading -= turn * Math.sign(this.speed || 1) * dt;
    this.steerLook = THREE.MathUtils.damp(this.steerLook, inp.steer, 8, dt);

    // Move, blocked by water and buildings.
    const f = this.forward;
    const nx = this.pos.x + f.x * this.speed * dt, nz = this.pos.z + f.z * this.speed * dt;
    const wy = w.water(nx, nz);
    const gNext = w.surface(nx, nz, this.pos.y + 0.6);
    if (!Number.isNaN(wy) && wy > gNext + 0.35 && this.grounded) {
      this.speed *= -0.25; // the shore stops you
    } else {
      const test = tmpV.set(nx, this.pos.y + 0.3, nz);
      const bx = test.x, bz = test.z;
      w.colliders.resolve(test, S.radius);
      const push = Math.hypot(test.x - bx, test.z - bz);
      if (push > 0.02) {
        // Bounced off a wall: lose most speed, more if head-on.
        const nxp = (test.x - bx) / push, nzp = (test.z - bz) / push;
        const head = -(nxp * Math.sin(this.heading) + nzp * Math.cos(this.heading));
        this.speed *= head > 0.6 ? -0.25 : 0.6;
      }
      this.pos.x = test.x; this.pos.z = test.z;
    }

    // Ground contact, jumps and falls.
    const g = w.surface(this.pos.x, this.pos.z, this.pos.y + 0.6);
    if (this.grounded) {
      if (g < this.pos.y - 0.9) { this.grounded = false; this.vy = 0; }
      else { this.pos.y = g; this.vy = 0; }
      if (inp.spacePressed && S.jump > 0) { this.grounded = false; this.vy = S.jump; }
    }
    if (!this.grounded) {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g) {
        this.pos.y = g;
        const hard = this.vy < -12; // a drop of ~7 m
        this.vy = 0;
        this.grounded = true;
        if (hard && this.id !== 'jeep') return 'crash';
      }
    }
    this.air = THREE.MathUtils.damp(this.air, this.grounded ? 0 : 1, 10, dt);

    // Follow the slope (sample front/back/left/right), lean into turns.
    if (this.grounded) {
      const L = S.length / 2, W = S.width / 2, rx = -f.z, rz = f.x; // r = left-to-right across
      const y = this.pos.y + 1.5;
      const hf = w.surface(this.pos.x + f.x * L, this.pos.z + f.z * L, y), hb = w.surface(this.pos.x - f.x * L, this.pos.z - f.z * L, y);
      const hr = w.surface(this.pos.x + rx * W, this.pos.z + rz * W, y), hl = w.surface(this.pos.x - rx * W, this.pos.z - rz * W, y);
      this.gp = THREE.MathUtils.damp(this.gp, THREE.MathUtils.clamp(Math.atan2(hf - hb, S.length), -0.6, 0.6), 10, dt);
      this.gr = THREE.MathUtils.damp(this.gr, THREE.MathUtils.clamp(Math.atan2(hl - hr, S.width), -0.5, 0.5), 10, dt);
      // Gravity pulls you down hills (and slows you going up).
      this.speed -= Math.sin(this.gp) * G * dt * (this.id === 'jeep' ? 0.5 : 0.8);
    }
    this.pitch = this.gp + (this.grounded ? 0 : THREE.MathUtils.clamp(this.vy * 0.02, -0.25, 0.25));
    const leanTarget = inp.steer * S.lean * THREE.MathUtils.clamp(Math.abs(this.speed) / S.max, 0, 1);
    this.roll = this.gr + leanTarget;
    return 'ok';
  }
}

export class Skateboard extends GroundVehicle {
  readonly id = 'skate' as const;
  readonly spec: GroundSpec = { max: 9, boost: 1.25, accel: 3.2, brake: 6, drag: 0.02, coast: 0.25, steer: 2.2, steerFalloff: 14, length: 0.7, width: 0.25, radius: 0.35, jump: 3.2, reverse: 0.2, lean: 0.35 };
  readonly seat = new THREE.Vector3(0, 0.125, 0);
  readonly pose = 'skate' as const;
  readonly cam = { dist: 4.2, height: 1.15, pitch: 0.16 };
  constructor() { super(skateboardModel()); }
  step(dt: number, inp: VehicleInput, w: VehicleWorld) {
    // Pushing: kick cadence while accelerating on the ground.
    this.cadence = inp.throttle > 0 && this.grounded && this.speed < this.spec.max * 0.95 ? 1.2 : 0;
    return super.step(dt, inp, w);
  }
}

export class Bike extends GroundVehicle {
  readonly id = 'bike' as const;
  readonly spec: GroundSpec = { max: 12, boost: 1.3, accel: 4, brake: 9, drag: 0.015, coast: 0.2, steer: 1.9, steerFalloff: 16, length: 1.05, width: 0.3, radius: 0.45, jump: 2.9, reverse: 0.15, lean: 0.4 };
  readonly seat = new THREE.Vector3(0, 0.64, -0.2);
  readonly pose = 'bike' as const;
  readonly cam = { dist: 4.8, height: 1.45, pitch: 0.16 };
  constructor() { super(bikeModel()); }
  step(dt: number, inp: VehicleInput, w: VehicleWorld) {
    const r = super.step(dt, inp, w);
    // Pedal cadence follows wheel speed while you're on the pedals.
    this.cadence = inp.throttle > 0 ? Math.max(0.6, this.speed / 4.5) : 0;
    return r;
  }
}

export class Jeep extends GroundVehicle {
  readonly id = 'jeep' as const;
  readonly spec: GroundSpec = { max: 30, boost: 1.2, accel: 7.5, brake: 15, drag: 0.012, coast: 0.6, steer: 1.45, steerFalloff: 18, length: 3.2, width: 1.7, radius: 1.35, jump: 0, reverse: 0.3, lean: 0.04 };
  readonly seat = new THREE.Vector3(0.4, 0.76, -0.3);
  readonly pose = 'drive' as const;
  readonly cam = { dist: 7.5, height: 1.9, pitch: 0.17 };
  constructor() { super(jeepModel()); }
  exitPoint(out: THREE.Vector3) { return super.exitPoint(out, -1.9); }
}

// ---------------------------------------------------------------------------------------------
// The prop plane

export class Plane extends Vehicle {
  readonly id = 'plane' as const;
  readonly seat = new THREE.Vector3(0, 1.22, 0.35);
  readonly pose = 'pilot' as const;
  readonly cam = { dist: 14, height: 2.6, pitch: 0.12 };
  throttle = 0;
  private bank = 0;
  static readonly STALL = 25;
  constructor() { super(planeModel()); }

  step(dt: number, inp: VehicleInput, w: VehicleWorld): StepResult {
    this.throttle = THREE.MathUtils.clamp(this.throttle + inp.throttle * 0.6 * dt, 0, 1);
    const thrust = this.throttle * (inp.shift ? 34 : 27);
    const drag = 0.0056 * this.speed * this.speed + (this.grounded ? 0.8 + (inp.throttle < 0 ? 6 : 0) : 0);
    this.speed += (thrust - drag - (this.grounded ? 0 : 9.8 * Math.sin(this.pitch))) * dt;
    this.speed = Math.max(0, this.speed);
    const stall = this.speed < Plane.STALL;

    if (this.grounded) {
      // Taxi: steer with the nose wheel; rotate (pull up) to take off.
      this.heading -= inp.steer * 0.9 * THREE.MathUtils.clamp(this.speed / 6, 0, 1) * dt;
      this.bank = THREE.MathUtils.damp(this.bank, 0, 6, dt);
      // Pull up with Space past 20 m/s; past 32 it rotates by itself so a field is long enough.
      const want = (inp.space && this.speed > 20) || this.speed > 32 ? 0.22 : 0;
      this.pitch = THREE.MathUtils.damp(this.pitch, want, 3, dt);
      if (this.pitch > 0.12 && this.speed > 28) { this.grounded = false; this.vy = 2; }
    } else {
      // Bank with A/D, the bank turns you; Space/C pitch.
      this.bank = THREE.MathUtils.damp(this.bank, inp.steer * 0.85, 2.5, dt);
      this.heading -= (9.8 * Math.tan(this.bank) / Math.max(this.speed, 18)) * dt;
      const pr = (inp.space ? 0.6 : 0) - (inp.dive ? 0.6 : 0);
      this.pitch += pr * dt * Math.cos(this.bank);
      if (!inp.space && !inp.dive) this.pitch = THREE.MathUtils.damp(this.pitch, 0.02, 0.6, dt);
      if (stall) this.pitch -= (Plane.STALL - this.speed) * 0.03 * dt; // the nose drops in a stall
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.1, 1.0);
      const lift = stall ? -(Plane.STALL - this.speed) * 0.7 : 0;
      this.vy = this.speed * Math.sin(this.pitch) + lift;
    }
    this.roll = this.bank;
    this.steerLook = inp.steer;

    const f = this.forward;
    const horiz = this.speed * Math.cos(this.grounded ? 0 : this.pitch);
    this.pos.x += f.x * horiz * dt;
    this.pos.z += f.z * horiz * dt;
    if (!this.grounded) this.pos.y += this.vy * dt;

    // Buildings (checked above tree/lamp height while taxiing): hitting one is a crash.
    const test = tmpV.set(this.pos.x, this.pos.y + (this.grounded ? 4 : 1.2), this.pos.z);
    w.colliders.resolve(test, this.grounded ? 2.2 : 3);
    if (Math.hypot(test.x - this.pos.x, test.z - this.pos.z) > 0.05) {
      if (!this.grounded || this.speed > 8) return 'crash';
      this.pos.x = test.x; this.pos.z = test.z; this.speed = 0;
    }
    const g = w.surface(this.pos.x, this.pos.z, this.pos.y + 1);
    const wy = w.water(this.pos.x, this.pos.z);
    const floor = !Number.isNaN(wy) && wy > g ? wy : g;
    if (this.grounded) {
      if (!Number.isNaN(wy) && wy > g + 0.4) return 'crash'; // rolled into the water
      if (g < this.pos.y - 2) { this.grounded = false; this.vy = 0; }
      else this.pos.y = g;
    } else if (this.pos.y <= floor) {
      const water = floor !== g;
      if (water || this.vy < -7 || Math.abs(this.roll) > 0.45 || this.pitch < -0.3) return 'crash';
      this.pos.y = g; this.grounded = true; this.vy = 0;
    }
    // Propeller.
    const prop = this.model.parts.prop;
    prop.rotation.z += dt * (8 + this.throttle * 70);
    const blur = this.model.parts.blur as THREE.Mesh;
    (blur.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, this.throttle * 0.5);
    this.air = this.grounded ? 0 : 1;
    return 'ok';
  }

  /** Planes stop where the gear is: start airborne at cruise if you call it in the air. */
  launch(airborne: boolean) {
    if (airborne) { this.grounded = false; this.speed = 42; this.throttle = 0.7; this.pitch = 0; }
  }
}

// ---------------------------------------------------------------------------------------------
// The space shuttle: the way to cross a continent. Rocket thrust along the nose against drag that
// thins with altitude (about Mach 1 on the mains up high, ~1.4 with the boosters), wings that bend the
// flight path toward where the nose points once you're fast, and a vertical launch from anywhere.
// Launch numbers follow the real one: it stands on its tail, lights, and climbs off the ground at
// a thrust-to-weight of ~1.5 (half a g of real acceleration, clearing ~100 m in about 7 s), never
// more than ~3 g, then pitches over gradually.

const SOUND = 340;
/** Main engines at full throttle and the boosters on top (m/s² of thrust: 2.2 g and +1.2 g). */
const MAINS = 22;
const BOOSTERS = 12;
/** Seconds to stand her up on her tail before lift-off; pitch when standing; nozzle-to-gear length. */
const RAISE_TIME = 2.4;
const VERTICAL = 1.5;
const TAIL = 10.8;

export class Shuttle extends Vehicle {
  readonly id = 'shuttle' as const;
  // The pilot sits in the flight deck, out of sight; the chase camera stands well back.
  readonly seat = new THREE.Vector3(0, 2.4, 6.2);
  readonly pose = 'pilot' as const;
  readonly cam = { dist: 30, height: 6, pitch: 0.1 };
  throttle = 0;
  booster = false;
  /** Velocity (m/s, world). `speed` mirrors its length. */
  readonly v3 = new THREE.Vector3();
  /** Felt acceleration in g (for the HUD). */
  g = 1;
  private bank = 0;
  private flick = 0;
  /** Launched from the ground: stand on the tail and go straight up until clear of the towers. */
  private climbOut = -Infinity;
  /** 0..1 while standing up on the pad (engines lit) before lift-off. */
  private raise = 0;
  /** Set on the frame she leaves the ground (the player's camera does a launch shot). */
  liftoff = false;
  private plume = new Plume();
  private nozzles = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private fire = new THREE.Vector3();
  private gndY = 0;
  constructor() { super(shuttleModel()); }

  get mach() { return this.speed / SOUND; }
  /** On the pad or still in the vertical climb-out (the autopilot lets the launch fly itself). */
  get launching() { return this.grounded ? this.raise > 0 || this.throttle > 0.12 : this.climbOut > -Infinity && this.pos.y - this.climbOut < 400; }

  step(dt: number, inp: VehicleInput, w: VehicleWorld): StepResult {
    this.throttle = THREE.MathUtils.clamp(this.throttle + inp.throttle * 0.55 * dt, 0, 1);
    this.booster = inp.shift && this.throttle > 0.05;
    const f = this.nose(new THREE.Vector3());
    const rho = Math.exp(-Math.max(0, this.pos.y) / 8500);
    const thrust = this.throttle * MAINS + (this.booster ? BOOSTERS : 0);
    const v = this.v3, sp = v.length();

    if (this.grounded) {
      // Light the mains and pull up (Space), or just open the throttle wide: she stands up on her tail
      // with the engines lit, then lifts off once vertical and the thrust beats her weight.
      this.bank = THREE.MathUtils.damp(this.bank, 0, 6, dt);
      const go = this.throttle > 0.12 && (inp.space || this.throttle > 0.55 || this.booster);
      if (go || (this.raise > 0 && this.throttle > 0.05)) {
        this.raise = Math.min(1, this.raise + dt / RAISE_TIME);
        const e = this.raise * this.raise * (3 - 2 * this.raise);
        this.pitch = VERTICAL * e;
        v.set(0, 0, 0);
        if (this.raise >= 1 && thrust > 9.8 * 1.2) {
          this.grounded = false;
          this.raise = 0;
          this.climbOut = this.pos.y;
          this.liftoff = true;
        }
      } else if (this.raise > 0) {
        // Throttled back to idle on the pad: lay her back down.
        this.raise = Math.max(0, this.raise - dt / RAISE_TIME);
        this.pitch = VERTICAL * this.raise * this.raise * (3 - 2 * this.raise);
        v.set(0, 0, 0);
      } else {
        // Rolling out after a landing: brakes.
        v.multiplyScalar(Math.exp(-dt * (inp.throttle < 0 ? 1.6 : 0.5)));
        this.heading -= inp.steer * 0.4 * THREE.MathUtils.clamp(sp / 20, 0, 1) * dt;
        this.pitch = THREE.MathUtils.damp(this.pitch, 0, 3, dt);
        const fl = this.forward;
        v.set(fl.x * v.length(), 0, fl.z * v.length());
      }
    }
    if (!this.grounded) {
      // Attitude: A/D bank (the bank turns you, like a plane), Space/C pitch.
      this.bank = THREE.MathUtils.damp(this.bank, inp.steer * 1.0, 2.2, dt);
      const pr = (inp.space ? 0.75 : 0) - (inp.dive ? 0.75 : 0);
      this.pitch = THREE.MathUtils.clamp(this.pitch + pr * dt * Math.cos(this.bank), -1.45, VERTICAL);
      // Climb-out: straight up until clear of the towers (~150 m above the pad, or you push it over),
      // then the pitch program: a slow pitch-over toward the horizon as the speed builds.
      if (this.pos.y - this.climbOut < 150 && !inp.dive) this.pitch = THREE.MathUtils.damp(this.pitch, VERTICAL, 3, dt);
      else if (this.pos.y - this.climbOut < 2500 && !inp.space && !inp.dive && this.pitch > 0.4) this.pitch -= 0.06 * dt;
      else this.climbOut = -Infinity;
      this.heading -= (9.8 * Math.tan(this.bank) / Math.max(sp, 60)) * dt + inp.steer * 0.12 * dt;
      // Forces: thrust along the nose, drag, gravity, and lift that holds you up once you're fast.
      const acc = new THREE.Vector3().copy(this.nose(f)).multiplyScalar(thrust);
      acc.addScaledVector(v, -3.3e-4 * rho * sp);
      const felt = acc.length();
      acc.y -= 9.8;
      const liftK = THREE.MathUtils.clamp((sp - 60) / 90, 0, 1);
      acc.y += 9.8 * liftK * Math.cos(this.bank) * Math.cos(this.pitch);
      v.addScaledVector(acc, dt);
      // The wings turn the flight path toward the nose (faster the faster you go).
      const n = v.length();
      if (n > 1) {
        const dir = v.clone().divideScalar(n).lerp(this.nose(f), 1 - Math.exp(-dt * n / 70)).normalize();
        v.copy(dir).multiplyScalar(n);
      }
      // What you feel is thrust and drag (and the wings' lift), not gravity: ~1.5 g on the pad.
      this.g = THREE.MathUtils.damp(this.g, (felt + 9.8 * liftK) / 9.8, 4, dt);
    }
    this.roll = this.bank;
    this.steerLook = inp.steer;
    const wasGrounded = this.grounded;
    this.pos.addScaledVector(v, dt);
    this.speed = v.length();
    this.vy = v.y;

    // Buildings: a crash at speed; while climbing out (slow across the ground) it just slides off
    // lamp posts and walls. Ground: a landing if it's gentle enough, otherwise a crash.
    const test = tmpV.set(this.pos.x, this.pos.y + 2.6, this.pos.z);
    w.colliders.resolve(test, 3);
    if (Math.hypot(test.x - this.pos.x, test.z - this.pos.z) > 0.05) {
      if (Math.hypot(v.x, v.z) > 25) return 'crash';
      this.pos.x = test.x; this.pos.z = test.z;
    }
    // Standing up (or just lifted off) the gear isn't what's lowest: the tail is, TAIL·sin(pitch) below.
    const stand = wasGrounded ? TAIL * Math.sin(Math.max(0, this.pitch)) : 0;
    const gnd = w.surface(this.pos.x, this.pos.z, this.pos.y - stand + 2);
    this.gndY = gnd;
    const wy = w.water(this.pos.x, this.pos.z);
    const floor = !Number.isNaN(wy) && wy > gnd ? wy : gnd;
    if (!this.grounded && this.pos.y <= floor) {
      if (floor !== gnd || v.y < -8 || this.speed > 120 || Math.abs(this.roll) > 0.35 || this.pitch < -0.25) return 'crash';
      this.pos.y = gnd; this.grounded = true; v.y = 0; this.pitch = 0;
    } else if (this.grounded) this.pos.y = gnd + stand;
    this.air = this.grounded ? 0 : 1;
    this.animate(dt);
    return 'ok';
  }

  /** Unit vector out of the nose. */
  nose(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), Math.cos(this.heading) * cp);
  }

  /** Flames follow the throttle (and the boosters); called by step and by the autopilot. */
  animate(dt: number) {
    this.flick += dt;
    const k = this.throttle + (this.booster ? 0.8 : 0);
    const flames = this.model.parts.flames;
    flames.visible = k > 0.02;
    flames.children.forEach((c, i) => {
      if (!(c instanceof THREE.Group)) return;
      const fl = 0.86 + 0.14 * Math.sin(this.flick * 41 + i * 2.1) * Math.sin(this.flick * 23 + i);
      c.scale.set(0.8 + 0.5 * Math.min(k, 1), 0.8 + 0.5 * Math.min(k, 1), (2 + 16 * k) * fl);
    });
    (this.model.parts.glow as THREE.PointLight).intensity = k * 900;
    // Smoke: from the three engine bells (in the world), with the pad cloud while low.
    if (!this.plume.mesh.parent && this.group.parent) this.group.parent.add(this.plume.mesh);
    this.group.updateWorldMatrix(true, false);
    const m = this.group.matrixWorld;
    this.nozzles[0].set(0, 3.55, -10.8).applyMatrix4(m);
    this.nozzles[1].set(-0.95, 2.1, -10.8).applyMatrix4(m);
    this.nozzles[2].set(0.95, 2.1, -10.8).applyMatrix4(m);
    this.fire.set(0, 2.6, -14).applyMatrix4(m);
    const gnd = this.grounded ? this.pos.y - TAIL * Math.sin(Math.max(0, this.pitch)) : this.gndY;
    this.plume.update(dt, this.nozzles, this.grounded && this.raise < 0.95 ? k * 0.25 : k, gnd, this.fire);
  }

  dispose() { this.plume.dispose(); super.dispose(); }

  /** Called up in the air (or for a fresh launch): start moving with the nose. */
  launch(airborne: boolean, speed = 0) {
    if (airborne) {
      this.grounded = false;
      this.throttle = 0.8;
      this.v3.copy(this.nose(new THREE.Vector3())).multiplyScalar(Math.max(speed, 140));
      this.speed = this.v3.length();
    } else {
      this.throttle = 0.68; // lift-off thrust-to-weight ~1.5, like the real one
      this.pitch = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Boats

abstract class Boat extends Vehicle {
  abstract readonly max: number;
  abstract readonly accel: number;
  abstract readonly turnRate: number;
  abstract readonly draft: number;
  private t = Math.random() * 10;

  step(dt: number, inp: VehicleInput, w: VehicleWorld): StepResult {
    this.t += dt;
    const top = this.max * (inp.shift ? 1.4 : 1);
    if (inp.throttle > 0) this.speed += this.accel * inp.throttle * dt;
    else if (inp.throttle < 0) this.speed -= this.accel * 0.8 * -inp.throttle * dt;
    this.speed -= this.speed * 0.35 * dt; // water drag
    this.speed = THREE.MathUtils.clamp(this.speed, -this.max * 0.4, top);
    // Boats turn even when slow (the paddle/rudder), more with speed.
    const turn = inp.steer * this.turnRate * (0.35 + 0.65 * THREE.MathUtils.clamp(Math.abs(this.speed) / this.max, 0, 1));
    this.heading -= turn * dt;
    this.steerLook = THREE.MathUtils.damp(this.steerLook, inp.steer, 6, dt);
    const f = this.forward;
    const nx = this.pos.x + f.x * this.speed * dt, nz = this.pos.z + f.z * this.speed * dt;
    const wy = w.water(nx, nz);
    const ok = !Number.isNaN(wy) && w.surface(nx, nz, wy) < wy - 0.3;
    if (ok) {
      const test = tmpV.set(nx, wy, nz);
      w.colliders.resolve(test, 1);
      if (Math.hypot(test.x - nx, test.z - nz) > 0.02) this.speed *= 0.3;
      this.pos.x = test.x; this.pos.z = test.z;
    } else this.speed *= -0.3; // beached: bump back off the shore
    const here = w.water(this.pos.x, this.pos.z);
    const level = Number.isNaN(here) ? this.pos.y + this.draft : here;
    this.pos.y = level - this.draft + Math.sin(this.t * 1.7) * 0.04;
    this.pitch = Math.sin(this.t * 1.3) * 0.02 + THREE.MathUtils.clamp(this.speed / 60, 0, 0.12);
    this.roll = Math.sin(this.t * 1.1) * 0.03 + this.steerLook * 0.06 * Math.min(1, Math.abs(this.speed) / 5);
    return 'ok';
  }
}

export class Kayak extends Boat {
  readonly id = 'kayak' as const;
  readonly max = 3; readonly accel = 2.4; readonly turnRate = 1.1; readonly draft = 0.08;
  readonly seat = new THREE.Vector3(0, 0.1, -0.15);
  readonly pose = 'paddle' as const;
  readonly cam = { dist: 5.2, height: 1.0, pitch: 0.2 };
  private ph = 0;
  constructor() { super(kayakModel()); }
  step(dt: number, inp: VehicleInput, w: VehicleWorld) {
    this.cadence = inp.throttle !== 0 || inp.steer !== 0 ? 0.75 : 0;
    this.ph += Math.PI * 2 * this.cadence * dt;
    const paddle = this.model.parts.paddle;
    paddle.rotation.z = this.cadence ? Math.sin(this.ph) * 0.6 : paddle.rotation.z * 0.95;
    paddle.rotation.y = this.cadence ? Math.cos(this.ph) * 0.25 : 0;
    return super.step(dt, inp, w);
  }
}

export class Motorboat extends Boat {
  readonly id = 'boat' as const;
  readonly max = 15; readonly accel = 5; readonly turnRate = 0.9; readonly draft = 0.3;
  readonly seat = new THREE.Vector3(0, 0.72, -1.15);
  readonly pose = 'drive' as const;
  readonly cam = { dist: 8, height: 1.8, pitch: 0.17 };
  constructor() { super(boatModel()); }
}

export function makeVehicle(id: Exclude<VehicleId, 'foot'>): Vehicle {
  switch (id) {
    case 'skate': return new Skateboard();
    case 'bike': return new Bike();
    case 'jeep': return new Jeep();
    case 'plane': return new Plane();
    case 'kayak': return new Kayak();
    case 'boat': return new Motorboat();
    case 'shuttle': return new Shuttle();
  }
}

export const VEHICLE_LABELS: Record<VehicleId, string> = {
  foot: 'On foot', skate: 'Skateboard', bike: 'Bike', jeep: 'Jeep', plane: 'Prop plane', kayak: 'Kayak', boat: 'Boat', shuttle: 'Space shuttle',
};
