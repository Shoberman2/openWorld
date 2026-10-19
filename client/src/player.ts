import * as THREE from 'three';
import type { Character } from './characters.ts';
import type { Input } from './input.ts';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }

/** 2D spatial hash of axis-aligned boxes: building footprints, desks, walls. */
export class Colliders {
  private cells = new Map<string, Box[]>();
  constructor(private cell = 32) {}

  add(b: Box) {
    const c = this.cell;
    for (let x = Math.floor(b.minX / c); x <= Math.floor(b.maxX / c); x++)
      for (let z = Math.floor(b.minZ / c); z <= Math.floor(b.maxZ / c); z++) {
        const k = `${x},${z}`;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
  }

  clear() { this.cells.clear(); }

  near(x: number, z: number): Box[] {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    const out = new Set<Box>();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.cells.get(`${cx + i},${cz + j}`)?.forEach((b) => out.add(b));
    return [...out];
  }

  /** Push a circle at (p.x,p.z) out of any box it overlaps. */
  resolve(p: THREE.Vector3, r: number) {
    for (const b of this.near(p.x, p.z)) {
      if (p.y > b.maxY) continue;
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
        // Center is inside the box: exit through the nearest face.
        const opts = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z];
        const m = Math.min(...opts);
        if (m === opts[0]) p.x = b.minX - r; else if (m === opts[1]) p.x = b.maxX + r;
        else if (m === opts[2]) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
    }
  }

  /** Fraction (0..1) along from→to before hitting a box (for the camera). */
  rayFraction(from: THREE.Vector3, to: THREE.Vector3): number {
    const t = 1;
    const steps = THREE.MathUtils.clamp(Math.ceil(from.distanceTo(to) / 5), 8, 160);
    const p = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      p.lerpVectors(from, to, f);
      for (const b of this.near(p.x, p.z)) {
        if (p.y < b.maxY && p.x > b.minX - 0.25 && p.x < b.maxX + 0.25 && p.z > b.minZ - 0.25 && p.z < b.maxZ + 0.25) {
          return Math.max(0.08, (i - 1) / steps);
        }
      }
    }
    return t;
  }
}

export interface PlayerWorld {
  colliders: Colliders;
  groundY(x: number, z: number): number;
  /** Optional bounds; the player is clamped inside. */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export class Player {
  position = new THREE.Vector3();
  yaw = 0; // camera yaw
  pitch = 0.18;
  facing = 0; // character yaw
  distance = 5.2;
  speed = 0;
  camCollide = true;
  world!: PlayerWorld;
  private camPos = new THREE.Vector3();

  constructor(public ch: Character, private input: Input, private camera: THREE.PerspectiveCamera) {
    window.addEventListener('wheel', (e) => {
      if (!this.input.enabled) return;
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.005, 2.2, 14);
    }, { passive: true });
  }

  setWorld(world: PlayerWorld, pos: THREE.Vector3, facing = 0) {
    this.world = world;
    this.position.copy(pos);
    this.position.y = world.groundY(pos.x, pos.z);
    this.facing = facing;
    this.yaw = facing;
    this.ch.root.position.copy(this.position);
    this.ch.root.rotation.y = facing;
    this.snapCamera();
  }

  /** Forward unit vector on the ground plane for the current camera yaw. */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  update(dt: number) {
    const m = this.input.consumeMouse();
    this.yaw -= m.x * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch + m.y * 0.0022, -0.55, 1.2);

    const ax = this.input.axes();
    const moving = ax.x !== 0 || ax.y !== 0;
    const run = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const target = moving ? (run ? 6.2 : 2.1) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);

    if (moving) {
      const fwd = this.forward();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const dir = fwd.multiplyScalar(ax.y).addScaledVector(right, -ax.x).normalize();
      const desired = Math.atan2(dir.x, dir.z);
      let d = desired - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
      this.position.addScaledVector(dir, this.speed * dt);
    }
    this.position.y = this.world.groundY(this.position.x, this.position.z);
    this.world.colliders.resolve(this.position, 0.4);
    const b = this.world.bounds;
    if (b) {
      this.position.x = THREE.MathUtils.clamp(this.position.x, b.minX, b.maxX);
      this.position.z = THREE.MathUtils.clamp(this.position.z, b.minZ, b.maxZ);
    }

    this.ch.root.position.copy(this.position);
    this.ch.root.rotation.y = this.facing;
    this.ch.play(this.speed > 3.6 ? 'run' : this.speed > 0.4 ? 'walk' : 'idle');
    const anim = this.ch.actions[this.ch.current];
    if (anim && this.ch.current === 'walk') anim.timeScale = Math.max(0.6, this.speed / 1.9);
    this.ch.mixer.update(dt);

    this.updateCamera(dt);
  }

  private desiredCamera(out: THREE.Vector3) {
    const head = this.position.clone().add(new THREE.Vector3(0, 1.65, 0));
    const back = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    out.copy(head).addScaledVector(back, this.distance);
    // Over-the-shoulder offset.
    out.x += Math.cos(this.yaw) * -0.45;
    out.z += -Math.sin(this.yaw) * -0.45;
    const f = this.camCollide ? this.world.colliders.rayFraction(head, out) : 1;
    out.lerpVectors(head, out, f);
    const gy = this.world.groundY(out.x, out.z) + 0.3;
    if (out.y < gy) out.y = gy;
    return head;
  }

  private updateCamera(dt: number) {
    const want = new THREE.Vector3();
    const head = this.desiredCamera(want);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.camPos);
    // Orbit camera: aim through the head (with shoulder offset), so pitching down looks up at towers.
    const look = head.clone();
    look.x += Math.cos(this.yaw) * -0.45;
    look.z += -Math.sin(this.yaw) * -0.45;
    look.addScaledVector(this.forward(), 0.6);
    this.camera.lookAt(look);
  }

  snapCamera() {
    const want = new THREE.Vector3();
    this.desiredCamera(want);
    this.camPos.copy(want);
    this.camera.position.copy(want);
  }
}
