// A working lift for any interior: a shaft with a landing door at every stop, a car with sliding
// doors, a mirror, handrails, a button panel and a floor display, smooth rides with you inside, and
// a call button. E at the landing calls it; E inside opens the floor picker. The shaft is only drawn
// around the floors you can see (rebuilt when you change floors), its colliders cover every floor.
import * as THREE from 'three';
import type { Colliders, MoveMode } from '../player.ts';
import { openPanel } from '../ui/panel.ts';
import { esc } from '../interact.ts';
import type { RoomInteraction } from './index.ts';

export interface LiftStop { y: number; label: string; title: string }
export interface LiftRider { position: THREE.Vector3; vel: THREE.Vector3; mode: MoveMode }

export interface LiftOpts {
  parent: THREE.Object3D;
  colliders: Colliders;
  /** Car center on the ground, and the yaw that turns local +z to face out of the doors. */
  x: number; z: number; yaw: number;
  stops: LiftStop[];
  start?: number;
  /** Inside size of the car. */
  w?: number; d?: number;
  /** Shaft wall color (matches the building's core walls). */
  wallColor?: THREE.ColorRepresentation;
  /** A stop that, when you arrive at it, takes you somewhere else (the roof). */
  onArrive?(stop: number): void;
  /** Called once the doors have shut and the car leaves (swap floors in here). */
  onDepart?(to: number): void;
  id?: string;
}

const CAR_H = 2.5, DOOR_H = 2.15;

// One set of materials for every lift.
let MATS: ReturnType<typeof liftMaterials> | null = null;
function liftMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.88, roughness: 0.3 }),
    brushed: new THREE.MeshStandardMaterial({ color: 0x9da3aa, metalness: 0.8, roughness: 0.42 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.06 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x3b3a39, roughness: 0.55 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xc8a96a, metalness: 0.9, roughness: 0.25 }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff6e8 }),
    button: new THREE.MeshBasicMaterial({ color: 0xffd48a }),
    buttonDim: new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.7, roughness: 0.3 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x1c1f23, metalness: 0.5, roughness: 0.35 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.95 }),
  };
}

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}
function merged(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    if (g !== p) g.dispose();
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

export class Lift {
  readonly group = new THREE.Group();
  private readonly car = new THREE.Group();
  private readonly carDoors: THREE.Mesh[] = [];
  private readonly landing = new THREE.Group();
  private readonly landingDoors: THREE.Mesh[] = [];
  private shaft: THREE.Group | null = null;
  private readonly stops: LiftStop[];
  private readonly w: number;
  private readonly d: number;
  private readonly op: number; // door opening width
  private readonly cos: number;
  private readonly sin: number;
  private readonly owner: string;
  private readonly display: { c: HTMLCanvasElement; t: THREE.CanvasTexture; shown: string };
  private carY: number;
  private at: number | null; // stop the car is standing at
  private ride: { from: number; to: number; y0: number; y1: number; t: number; T: number } | null = null;
  private queued: number | null = null;
  private doors = 0; // 0 closed .. 1 open
  private doorWant = 0;
  private idle = 0;
  private carrying = false;
  private gate = false;
  private viewLo = -1;
  private viewHi = -1;
  private playerStop = 0;

  constructor(private o: LiftOpts) {
    MATS ??= liftMaterials();
    this.stops = o.stops;
    this.w = o.w ?? 1.9;
    this.d = o.d ?? 1.75;
    this.op = Math.min(1.15, this.w - 0.5);
    this.cos = Math.cos(o.yaw); this.sin = Math.sin(o.yaw);
    this.owner = `lift:${o.id ?? 'main'}`;
    this.at = o.start ?? 0;
    this.carY = this.stops[this.at].y;
    this.group.position.set(o.x, 0, o.z);
    this.group.rotation.y = o.yaw;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.display = { c, t, shown: '' };
    this.buildCar();
    this.buildLanding();
    this.group.add(this.car, this.landing);
    o.parent.add(this.group);
    this.addColliders();
    this.setGate(true);
    this.view(this.at);
    this.drawDisplay();
  }

  // ---------- geometry ----------

  private buildCar() {
    const M = MATS!, w = this.w, d = this.d, op = this.op;
    const steel: THREE.BufferGeometry[] = [], brushed: THREE.BufferGeometry[] = [], rail: THREE.BufferGeometry[] = [];
    // Floor, ceiling and light.
    this.car.add(new THREE.Mesh(boxGeo(w + 0.1, 0.06, d + 0.1, 0, -0.06, 0), M.floor));
    steel.push(boxGeo(w + 0.1, 0.08, d + 0.1, 0, CAR_H, 0));
    this.car.add(new THREE.Mesh(boxGeo(w - 0.5, 0.02, d - 0.5, 0, CAR_H - 0.02, 0), M.light));
    // Side walls in brushed steel, a mirror on the back wall above a steel dado.
    for (const s of [-1, 1]) brushed.push(boxGeo(0.04, CAR_H, d, s * (w / 2 + 0.02), 0, 0));
    steel.push(boxGeo(w, 0.95, 0.04, 0, 0, -d / 2 - 0.02));
    this.car.add(new THREE.Mesh(boxGeo(w - 0.1, CAR_H - 1.0, 0.02, 0, 0.97, -d / 2 - 0.005), M.mirror));
    // Handrails on three sides.
    rail.push(new THREE.CylinderGeometry(0.025, 0.025, w - 0.3, 8).rotateZ(Math.PI / 2).translate(0, 0.92, -d / 2 + 0.06));
    for (const s of [-1, 1]) rail.push(new THREE.CylinderGeometry(0.025, 0.025, d - 0.5, 8).rotateX(Math.PI / 2).translate(s * (w / 2 - 0.06), 0.92, -0.1));
    // Front returns either side of the door, and the header above it.
    const rw = (w - op) / 2;
    for (const s of [-1, 1]) brushed.push(boxGeo(rw, CAR_H, 0.04, s * (op / 2 + rw / 2), 0, d / 2 - 0.05));
    brushed.push(boxGeo(op, CAR_H - DOOR_H, 0.04, 0, DOOR_H, d / 2 - 0.05));
    this.car.add(new THREE.Mesh(merged(steel), M.steel), new THREE.Mesh(merged(brushed), M.brushed), new THREE.Mesh(merged(rail), M.rail));
    // Button panel on the right return, a display over the door.
    const px = op / 2 + rw / 2;
    this.car.add(new THREE.Mesh(boxGeo(Math.min(0.24, rw - 0.06), 0.7, 0.015, px, 0.9, d / 2 - 0.075), M.panel));
    for (let i = 0; i < 6; i++) this.car.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 10).rotateX(Math.PI / 2).translate(px + (i % 2 ? 0.05 : -0.05), 1.0 + Math.floor(i / 2) * 0.12, d / 2 - 0.085), i === 0 ? M.button : M.buttonDim));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.135), new THREE.MeshBasicMaterial({ map: this.display.t }));
    disp.position.set(0, DOOR_H + 0.16, d / 2 - 0.075);
    disp.rotation.y = Math.PI;
    this.car.add(disp);
    // Car doors: center-opening, outside the returns.
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(boxGeo(op / 2 + 0.03, DOOR_H, 0.03, 0, 0, 0), M.steel);
      m.position.set(s * (op / 4), 0, d / 2 - 0.005);
      m.userData.side = s;
      this.carDoors.push(m);
      this.car.add(m);
    }
    const lamp = new THREE.PointLight(0xfff1dc, 3.5, 4.5, 2);
    lamp.position.set(0, CAR_H - 0.3, 0);
    this.car.add(lamp);
    this.car.position.y = this.carY;
  }

  /** The landing doors and indicator, moved to whichever floor you're on. */
  private buildLanding() {
    const M = MATS!, op = this.op, d = this.d;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(boxGeo(op / 2 + 0.03, DOOR_H, 0.03, 0, 0, 0), M.brushed);
      m.position.set(s * (op / 4), 0, d / 2 + 0.06);
      m.userData.side = s;
      this.landingDoors.push(m);
      this.landing.add(m);
    }
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: this.display.t }));
    disp.position.set(0, DOOR_H + 0.3, d / 2 + 0.27);
    this.landing.add(disp);
  }

  /** Shaft walls, door frames and call buttons for stops lo..hi. */
  private buildShaft(lo: number, hi: number) {
    const M = MATS!, w = this.w, d = this.d, op = this.op;
    if (this.shaft) {
      this.group.remove(this.shaft);
      this.shaft.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    }
    const wallMat = (this.shaftMat ??= new THREE.MeshStandardMaterial({ color: this.o.wallColor ?? 0xd9d6cf, roughness: 0.85 }));
    const walls: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], btn: THREE.BufferGeometry[] = [];
    const y0 = this.stops[lo].y - (lo > 0 ? 0.2 : 0.05);
    const nextY = (k: number) => this.stops[k + 1]?.y ?? this.stops[k].y + CAR_H + 0.8;
    const y1 = nextY(hi);
    const H = y1 - y0;
    const ow = w / 2 + 0.2, fz = d / 2 + 0.18;
    walls.push(boxGeo(2 * ow, H, 0.16, 0, y0, -d / 2 - 0.12));
    for (const s of [-1, 1]) walls.push(boxGeo(0.16, H, d + 0.4, s * (w / 2 + 0.12), y0, 0.04));
    // Front wall: pillars either side of the openings, a lintel between each stop's door and the next floor.
    const pw = ow - op / 2;
    for (const s of [-1, 1]) walls.push(boxGeo(pw, H, 0.16, s * (op / 2 + pw / 2), y0, fz));
    for (let k = lo; k <= hi; k++) {
      const y = this.stops[k].y;
      walls.push(boxGeo(op, nextY(k) - (y + DOOR_H), 0.16, 0, y + DOOR_H, fz));
      if (k === lo && y0 < y) walls.push(boxGeo(op, y - y0, 0.16, 0, y0, fz));
      // Steel door frame, call button panel, and a sill.
      for (const s of [-1, 1]) trim.push(boxGeo(0.07, DOOR_H + 0.07, 0.04, s * (op / 2 + 0.035), y, fz + 0.09));
      trim.push(boxGeo(op + 0.14, 0.07, 0.04, 0, y + DOOR_H, fz + 0.09));
      trim.push(boxGeo(op + 0.1, 0.02, 0.3, 0, y, d / 2 + 0.12));
      trim.push(boxGeo(0.12, 0.26, 0.02, op / 2 + 0.3, y + 0.95, fz + 0.09));
      btn.push(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 12).rotateX(Math.PI / 2).translate(op / 2 + 0.3, y + 1.13, fz + 0.1));
      btn.push(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 12).rotateX(Math.PI / 2).translate(op / 2 + 0.3, y + 1.03, fz + 0.1));
    }
    const g = new THREE.Group();
    const mw = new THREE.Mesh(merged(walls), wallMat);
    mw.castShadow = mw.receiveShadow = true;
    g.add(mw, new THREE.Mesh(merged(trim), M.steel), new THREE.Mesh(merged(btn), M.button));
    this.shaft = g;
    this.group.add(g);
  }
  private shaftMat: THREE.MeshStandardMaterial | null = null;

  /** Show the shaft around the floor you're on (and the floor below, for the cutaway camera). */
  view(stop: number) {
    this.playerStop = stop;
    this.landing.position.y = this.stops[stop].y;
    if (this.ride) return;
    this.setView(Math.max(0, stop - 1), stop);
  }
  private setView(lo: number, hi: number) {
    if (lo === this.viewLo && hi === this.viewHi) return;
    this.viewLo = lo; this.viewHi = hi;
    this.buildShaft(lo, hi);
  }

  // ---------- colliders ----------

  private col(lx0: number, lx1: number, lz0: number, lz1: number, y0: number, y1: number, owner: string) {
    const P = (lx: number, lz: number) => [this.o.x + lx * this.cos + lz * this.sin, this.o.z - lx * this.sin + lz * this.cos];
    const poly = [...P(lx0, lz0), ...P(lx1, lz0), ...P(lx1, lz1), ...P(lx0, lz1)];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < poly.length; i += 2) { minX = Math.min(minX, poly[i]); maxX = Math.max(maxX, poly[i]); minZ = Math.min(minZ, poly[i + 1]); maxZ = Math.max(maxZ, poly[i + 1]); }
    this.o.colliders.add({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1, poly }, owner);
  }
  private addColliders() {
    const w = this.w, d = this.d, op = this.op;
    const y0 = this.stops[0].y - 1, y1 = this.stops[this.stops.length - 1].y + CAR_H + 1;
    const ow = w / 2 + 0.2;
    // Thick on the outside so the chase camera can't slip through (and so you can't walk into the shaft).
    this.col(-ow - 0.3, ow + 0.3, -d / 2 - 0.6, -d / 2 - 0.04, y0, y1, this.owner);
    for (const s of [-1, 1]) this.col(s > 0 ? w / 2 + 0.04 : -ow - 0.3, s > 0 ? ow + 0.3 : -w / 2 - 0.04, -d / 2 - 0.6, d / 2 + 0.26, y0, y1, this.owner);
    for (const s of [-1, 1]) this.col(s > 0 ? op / 2 : -ow - 0.3, s > 0 ? ow + 0.3 : -op / 2, d / 2 - 0.08, d / 2 + 0.26, y0, y1, this.owner);
  }
  /** The doorway itself: closed unless the car is here with its doors open. */
  private setGate(on: boolean) {
    if (on === this.gate) return;
    this.gate = on;
    const gOwner = `${this.owner}:gate`;
    if (on) {
      const y0 = this.stops[0].y - 1, y1 = this.stops[this.stops.length - 1].y + CAR_H + 1;
      this.col(-this.op / 2 - 0.05, this.op / 2 + 0.05, d0(this.d), this.d / 2 + 0.2, y0, y1, gOwner);
    } else this.o.colliders.removeOwner(gOwner);
  }

  // ---------- queries ----------

  private local(x: number, z: number) {
    const dx = x - this.o.x, dz = z - this.o.z;
    return { lx: dx * this.cos - dz * this.sin, lz: dx * this.sin + dz * this.cos };
  }
  /** Car floor height if (x, z) is inside the car, else null. */
  floorAt(x: number, z: number): number | null {
    const { lx, lz } = this.local(x, z);
    return Math.abs(lx) <= this.w / 2 + 0.05 && lz >= -this.d / 2 - 0.05 && lz <= this.d / 2 + 0.05 ? this.carY : null;
  }
  inCar(p: THREE.Vector3) {
    return this.floorAt(p.x, p.z) !== null && Math.abs(p.y - this.carY) < 1.2;
  }
  get moving() { return !!this.ride; }

  /** E-interactions for one stop: the call button outside, the floor picker inside. */
  interactions(stop: number): RoomInteraction[] {
    const y = this.stops[stop].y;
    const P = (lx: number, lz: number) => new THREE.Vector3(this.o.x + lx * this.cos + lz * this.sin, y, this.o.z - lx * this.sin + lz * this.cos);
    return [
      { id: `${this.owner}:call:${stop}`, position: P(0, this.d / 2 + 1.0), radius: 1.5, label: 'Call the lift', sub: this.stops[stop].title, action: () => this.call(stop) },
      { id: `${this.owner}:car:${stop}`, position: P(0, -0.15), radius: 0.95, label: 'Choose a floor', sub: 'Lift', action: () => this.picker() },
    ];
  }

  // ---------- control ----------

  call(stop: number) {
    if (this.at === stop && !this.ride) { this.doorWant = 1; this.idle = 0; return; }
    if (this.ride) { this.queued = stop; return; }
    this.depart(stop);
  }
  go(stop: number) {
    if (this.ride) return;
    if (this.at === stop) { this.doorWant = 1; return; }
    this.depart(stop);
  }
  private depart(to: number) {
    this.queued = to;
    this.doorWant = 0;
  }

  picker() {
    const cur = this.at ?? this.playerStop;
    const p = openPanel({ title: 'Lift', subtitle: 'Choose a floor', avatar: '⇅', color: '#5b6470' });
    const list = this.stops.map((s, i) => ({ s, i })).reverse();
    p.body.innerHTML = `<div class="lift-grid">${list.map(({ s, i }) =>
      `<button class="lift-btn${i === cur ? ' here' : ''}" data-stop="${i}"><b>${esc(s.label)}</b><span>${esc(s.title)}</span></button>`).join('')}</div>`;
    p.body.querySelectorAll<HTMLButtonElement>('button[data-stop]').forEach((b) => b.addEventListener('click', () => {
      p.close();
      this.go(Number(b.dataset.stop));
    }));
    ensureStyle();
  }

  // ---------- per frame ----------

  update(dt: number, rider: LiftRider) {
    const inside = this.inCar(rider.position);
    // Doors.
    const speed = this.doorWant > this.doors ? 1.4 : 1.1;
    this.doors = THREE.MathUtils.clamp(this.doors + Math.sign(this.doorWant - this.doors) * speed * dt, 0, 1);
    const e = this.doors * this.doors * (3 - 2 * this.doors);
    for (const m of this.carDoors) m.position.x = m.userData.side * (this.op / 4 + (this.op / 2) * e);
    const landHere = this.at === this.playerStop && !this.ride;
    for (const m of this.landingDoors) m.position.x = m.userData.side * (this.op / 4 + (this.op / 2) * (landHere ? e : 0));
    this.setGate(!(landHere && this.doors > 0.7));

    // Hold the doors while someone's in the doorway or the car; close them after a while otherwise.
    if (this.doorWant === 1 && !this.ride) {
      const near = rider.position.distanceTo(this.landing.localToWorld(new THREE.Vector3(0, 0, this.d / 2 + 0.6))) < 1.6;
      if (inside || near) this.idle = 0;
      else if ((this.idle += dt) > 6) this.doorWant = 0;
    }

    // Leave once the doors have shut.
    if (this.queued !== null && !this.ride && this.doors === 0) {
      const to = this.queued;
      this.queued = null;
      if (to === this.at) { this.doorWant = 1; }
      else {
        const from = this.at ?? 0;
        const y0 = this.carY, y1 = this.stops[to].y;
        this.carrying = inside;
        this.ride = { from, to, y0, y1, t: 0, T: THREE.MathUtils.clamp(2.2 + Math.abs(y1 - y0) / 4.5, 2.6, 12) };
        this.at = null;
        this.setView(Math.min(from, to), Math.max(from, to));
        if (this.carrying) this.o.onDepart?.(to);
      }
    }

    if (this.ride) {
      const r = this.ride;
      r.t = Math.min(r.T, r.t + dt);
      const k = r.t / r.T, s = 0.5 - 0.5 * Math.cos(Math.PI * k);
      this.carY = r.y0 + (r.y1 - r.y0) * s;
      if (r.t >= r.T) {
        this.ride = null;
        this.at = r.to;
        this.carY = r.y1;
        this.doorWant = 1;
        this.idle = 0;
        if (this.carrying) { this.playerStop = r.to; this.landing.position.y = r.y1; }
        this.setView(Math.max(0, this.playerStop - 1), this.playerStop);
        if (this.carrying) this.o.onArrive?.(r.to);
        this.carrying = false;
      }
    }
    this.car.position.y = this.carY;
    if (this.carrying || (this.ride && inside)) {
      // Ride along: stay inside the car, on its floor.
      const { lx, lz } = this.local(rider.position.x, rider.position.z);
      const cx = THREE.MathUtils.clamp(lx, -this.w / 2 + 0.3, this.w / 2 - 0.3), cz = THREE.MathUtils.clamp(lz, -this.d / 2 + 0.3, this.d / 2 - 0.35);
      rider.position.x = this.o.x + cx * this.cos + cz * this.sin;
      rider.position.z = this.o.z - cx * this.sin + cz * this.cos;
      rider.position.y = this.carY;
      rider.vel.set(0, 0, 0);
      rider.mode = 'walk';
    }
    this.drawDisplay();
  }

  private drawDisplay() {
    const r = this.ride;
    const near = this.stops.reduce((b, s, i) => Math.abs(s.y - this.carY) < Math.abs(this.stops[b].y - this.carY) ? i : b, 0);
    const arrow = r ? (r.y1 > r.y0 ? '▲' : '▼') : '';
    const text = `${arrow}${this.stops[near].label}`;
    if (text === this.display.shown) return;
    this.display.shown = text;
    const g = this.display.c.getContext('2d')!;
    g.fillStyle = '#07090b'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ff9b3d';
    g.font = '700 64px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 52);
    this.display.t.needsUpdate = true;
  }

  dispose() {
    this.o.colliders.removeOwner(this.owner);
    this.o.colliders.removeOwner(`${this.owner}:gate`);
    this.group.parent?.remove(this.group);
    const shared = new Set<THREE.Material>(Object.values(MATS!));
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      if (!shared.has(m.material as THREE.Material)) (m.material as THREE.Material).dispose();
    });
    this.display.t.dispose();
  }
}

const d0 = (d: number) => d / 2 - 0.12;

let styled = false;
function ensureStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .lift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: 52vh; overflow: auto; padding: 2px; }
    .lift-btn { display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: inherit; cursor: pointer; font: inherit; }
    .lift-btn b { display: grid; place-items: center; min-width: 34px; height: 34px; border-radius: 50%; border: 2px solid #b9bec4;
      font-weight: 700; font-size: 14px; color: #e9ecef; }
    .lift-btn span { font-size: 13px; opacity: .85; }
    .lift-btn:hover b { border-color: #ffb45c; color: #ffb45c; box-shadow: 0 0 12px rgba(255,180,92,.45); }
    .lift-btn.here { border-color: rgba(255,180,92,.5); }
    .lift-btn.here b { border-color: #ffb45c; color: #ffb45c; }`;
  document.head.appendChild(s);
}
