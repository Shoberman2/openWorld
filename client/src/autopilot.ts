// Autopilot, like the game this is styled after: pick a place on the map, and the shuttle (or the prop
// plane) climbs out, turns onto the great-circle course and cruises there with time running up to 40×,
// so the sun and clouds race past, then slows down, descends and hands you the controls overhead.
// Any flying input (WASD, Space, Shift, C) takes over at once.
import * as THREE from 'three';
import type { Input } from './input.ts';
import type { Player } from './player.ts';
import type { DayNight } from './engine.ts';
import type { EarthApi } from './earth/index.ts';
import { bearing, haversine } from './earth/frame.ts';
import { Plane, Shuttle, type Vehicle } from './vehicles/index.ts';

export interface AutopilotTarget { lat: number; lon: number; name: string }

/** How each aircraft cruises (meters above the ground, m/s) and where it starts down and hands over. */
const PROFILE = {
  shuttle: { cruiseAgl: 6500, cruise: 620, climb: 110, arriveAgl: 1200, arrive: 260, descend: 70_000, approach: 15_000, handover: 2500 },
  plane: { cruiseAgl: 900, cruise: 68, climb: 9, arriveAgl: 350, arrive: 50, descend: 6000, approach: 3000, handover: 900 },
} as const;
const MAX_SCALE = 40;
const TAKEOVER = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC'];

export class Autopilot {
  target: AutopilotTarget | null = null;
  /** Time compression right now (1 = real time). */
  scale = 1;
  /** Why it's not at full speed (streaming can't keep up), for the HUD. */
  limited = false;
  phase: 'climb' | 'cruise' | 'descend' = 'climb';
  distance = 0;
  private since = 0;
  private lapseByUs = false;
  private vy = 0;

  constructor(private o: {
    earth: EarthApi; player: Player; input: Input; dayNight: DayNight;
    onArrive: (t: AutopilotTarget) => void;
    onCancel: (why: string) => void;
  }) {}

  get active() { return !!this.target; }

  /** Fly to `t` in whatever aircraft you're in. Returns false if you're not in one. */
  engage(t: AutopilotTarget): boolean {
    const v = this.o.player.vehicleObj;
    if (!(v instanceof Shuttle || v instanceof Plane)) return false;
    this.target = t;
    this.since = 0;
    this.scale = 1;
    this.phase = 'climb';
    this.vy = 0;
    if (v instanceof Shuttle && v.grounded) v.launch(false);
    this.o.player.autopilot = (veh, dt) => this.drive(veh, dt);
    return true;
  }

  disengage(why = '') {
    if (!this.target) return;
    const v = this.o.player.vehicleObj;
    // Hand back a flying aircraft: keep the speed and heading we had.
    if (v instanceof Shuttle) v.v3.copy(v.nose(new THREE.Vector3())).multiplyScalar(v.speed);
    this.target = null;
    this.scale = 1;
    this.o.player.autopilot = null;
    if (this.lapseByUs) { this.o.dayNight.timelapse(false); this.lapseByUs = false; }
    if (why) this.o.onCancel(why);
  }

  private drive(v: Vehicle, dt: number): boolean {
    const t = this.target;
    if (!t) return false;
    const P = v instanceof Shuttle ? PROFILE.shuttle : v instanceof Plane ? PROFILE.plane : null;
    if (!P || (v.grounded && !(v instanceof Shuttle))) { this.disengage('Autopilot off: not flying.'); return false; }
    this.since += dt;
    if (this.since > 0.6 && TAKEOVER.some((k) => this.o.input.down(k))) { this.disengage('You have the controls.'); return false; }

    const { earth } = this.o;
    const here = earth.frame.toGeo(v.pos.x, v.pos.z);
    const dist = haversine(here, t);
    this.distance = dist;
    // A shuttle launch flies itself (stand up, lift off, climb clear of the towers) facing the course;
    // the autopilot takes over above that.
    if (v instanceof Shuttle && v.launching) {
      if (v.grounded) {
        const b0 = (bearing(here, t) * Math.PI) / 180;
        v.heading = Math.atan2(Math.sin(b0), -Math.cos(b0));
      }
      return false;
    }
    if (dist < P.handover) {
      this.disengage();
      this.o.onArrive(t);
      return false;
    }
    // Great-circle course; local heading convention: forward = (sin h, 0, cos h), x east, z south.
    const b = (bearing(here, t) * Math.PI) / 180;
    const want = Math.atan2(Math.sin(b), -Math.cos(b));
    let dh = want - v.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.heading += THREE.MathUtils.clamp(dh, -0.35 * dt, 0.35 * dt);
    v.roll = THREE.MathUtils.damp(v.roll, THREE.MathUtils.clamp(-dh * 1.5, -0.6, 0.6), 3, dt);

    // Phase: climb to cruise, cruise, then start down early enough to arrive slow and low.
    const agl = v.pos.y - earth.heightAt(v.pos.x, v.pos.z);
    if (dist < P.descend) this.phase = 'descend';
    else if (agl > P.cruiseAgl * 0.85) this.phase = 'cruise';
    const k = this.phase === 'descend' ? THREE.MathUtils.clamp(dist / P.descend, 0, 1) : 1;
    const wantAgl = THREE.MathUtils.lerp(P.arriveAgl, P.cruiseAgl, k);
    const wantSpeed = THREE.MathUtils.lerp(P.arrive, P.cruise, k);

    // Time compression: once clear of the ground (climb, cruise and most of the descent), easing back to
    // real time for the final approach, and held back while the horizon is still streaming in (honest:
    // no flying over blank ground).
    const st = earth.stats();
    const backlog = st.far + st.queued * 0.5;
    this.limited = backlog > 8;
    const cap = backlog > 18 ? 4 : backlog > 8 ? 12 : MAX_SCALE;
    const room = (dist - P.approach) / Math.max(1, v.speed * 3);
    const target = agl > P.arriveAgl * 0.8 ? THREE.MathUtils.clamp(room, 1, cap) : 1;
    this.scale = THREE.MathUtils.damp(this.scale, target, target > this.scale ? 0.8 : 3, dt);
    const lapse = this.scale > 5;
    if (lapse !== this.lapseByUs) { this.o.dayNight.timelapse(lapse); this.lapseByUs = lapse; }
    const sdt = dt * this.scale;

    // Speed and altitude (in sim time), then move along the course.
    v.speed += THREE.MathUtils.clamp(wantSpeed - v.speed, -P.climb * 0.6 * sdt, (v instanceof Shuttle ? 18 : 3) * sdt);
    this.vy = THREE.MathUtils.damp(this.vy, THREE.MathUtils.clamp((wantAgl - agl) * 0.08, -P.climb, P.climb), 1.2, dt);
    const f = v.forward;
    v.pos.x += f.x * v.speed * sdt;
    v.pos.z += f.z * v.speed * sdt;
    v.pos.y += this.vy * sdt;
    v.pos.y = Math.max(v.pos.y, earth.heightAt(v.pos.x, v.pos.z) + 60);
    v.pitch = THREE.MathUtils.damp(v.pitch, Math.atan2(this.vy, Math.max(30, v.speed)), 2, dt);
    v.vy = this.vy;
    v.grounded = false;
    if (v instanceof Shuttle) {
      v.throttle = THREE.MathUtils.damp(v.throttle, this.phase === 'descend' ? 0.35 : 0.85, 2, dt);
      v.booster = false;
      v.v3.copy(v.nose(new THREE.Vector3())).multiplyScalar(v.speed);
      v.g = 1;
      v.animate(dt);
    } else if (v instanceof Plane) {
      v.throttle = 0.8;
      v.model.parts.prop.rotation.z += dt * 60;
    }
    v.air = 1;
    return true;
  }

  /** Remaining time at the current pace, in real seconds (for the HUD). */
  eta() {
    const v = this.o.player.vehicleObj;
    const sp = Math.max(1, (v?.speed ?? 1) * this.scale);
    return this.distance / sp;
  }
}
