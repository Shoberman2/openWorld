import * as THREE from 'three';
import type { Layout, Block } from './city/layout.ts';
import { SIDEWALK } from './city/layout.ts';
import { CURB } from './city/streets.ts';
import { makeNpc, CLOTHES, type Character } from './characters.ts';

interface Ped {
  ch: Character;
  block: Block;
  t: number; // distance along the block perimeter
  inset: number;
  dir: 1 | -1;
  speed: number;
  wait: number;
  cooldown: number;
}

/** People walking laps around blocks, recycled around the player so the streets always feel busy. */
export class Pedestrians {
  group = new THREE.Group();
  peds: Ped[] = [];

  constructor(private l: Layout, count: number, around: THREE.Vector3) {
    for (let i = 0; i < count; i++) {
      const color = CLOTHES[Math.floor(Math.random() * CLOTHES.length)];
      const accent = CLOTHES[Math.floor(Math.random() * CLOTHES.length)];
      const ch = makeNpc(color, accent, { role: 'pedestrian' });
      const s = 0.92 + Math.random() * 0.16;
      ch.root.scale.setScalar(s);
      const ped: Ped = { ch, block: this.nearBlock(around, 260), t: 0, inset: 1.4 + Math.random() * 2.2, dir: Math.random() < 0.5 ? 1 : -1, speed: 1.15 + Math.random() * 0.5, wait: 0, cooldown: 5 + Math.random() * 20 };
      ped.t = Math.random() * this.perimeter(ped);
      ch.play('walk', 0);
      this.group.add(ch.root);
      this.peds.push(ped);
    }
  }

  private nearBlock(p: THREE.Vector3, radius: number): Block {
    const blocks = this.l.blocks.filter((b) => Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z) < radius);
    const pool = blocks.length ? blocks : this.l.blocks;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private rect(p: Ped) {
    const b = p.block, i = p.inset;
    return { x0: b.x0 + i, x1: b.x1 - i, z0: b.z0 + i, z1: b.z1 - i };
  }

  private perimeter(p: Ped) {
    const r = this.rect(p);
    return 2 * (r.x1 - r.x0 + (r.z1 - r.z0));
  }

  /** Position + heading for distance t along the rectangle (counter-clockwise). */
  private at(p: Ped, t: number, out: THREE.Vector3) {
    const r = this.rect(p), w = r.x1 - r.x0, d = r.z1 - r.z0, per = 2 * (w + d);
    t = ((t % per) + per) % per;
    let heading: number;
    if (t < w) { out.set(r.x0 + t, 0, r.z0); heading = Math.PI / 2; }
    else if (t < w + d) { out.set(r.x1, 0, r.z0 + (t - w)); heading = 0; }
    else if (t < 2 * w + d) { out.set(r.x1 - (t - w - d), 0, r.z1); heading = -Math.PI / 2; }
    else { out.set(r.x0, 0, r.z1 - (t - 2 * w - d)); heading = Math.PI; }
    if (p.dir < 0) heading += Math.PI;
    out.y = this.l.groundY(out.x, out.z) + CURB;
    return heading;
  }

  update(dt: number, player: THREE.Vector3) {
    const v = new THREE.Vector3();
    for (const p of this.peds) {
      const dist = Math.hypot(p.ch.root.position.x - player.x, p.ch.root.position.z - player.z);
      if (dist > 280) {
        // Recycle: drop them onto a block near the player, out of the way.
        p.block = this.nearBlock(player, 220);
        p.t = Math.random() * this.perimeter(p);
      }
      if (p.wait > 0) {
        p.wait -= dt;
        p.ch.play('idle');
        if (p.wait <= 0) p.ch.play('walk');
      } else {
        p.cooldown -= dt;
        if (p.cooldown < 0) { p.wait = 2 + Math.random() * 7; p.cooldown = 10 + Math.random() * 30; }
        // Step aside a little for the player.
        p.t += p.speed * dt * p.dir;
      }
      const heading = this.at(p, p.t, v);
      const dx = v.x - player.x, dz = v.z - player.z, dd = Math.hypot(dx, dz);
      if (dd < 1.2 && dd > 0.01) { v.x += (dx / dd) * (1.2 - dd); v.z += (dz / dd) * (1.2 - dd); }
      p.ch.root.position.copy(v);
      let d = heading - p.ch.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      p.ch.root.rotation.y += d * Math.min(1, dt * 8);
      const a = p.ch.actions.walk;
      if (a) a.timeScale = p.speed / 1.25;
      if (dist < 110) p.ch.mixer.update(dt);
      p.ch.root.visible = dist < 240;
    }
  }
}

export { SIDEWALK };
