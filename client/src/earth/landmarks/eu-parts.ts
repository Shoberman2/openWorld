// Reading the map's claimed footprints (in a landmark's model frame) for the European landmarks:
// where a dome, a campanile or a minaret stands, and how a building is turned.
import { area } from './kit.ts';

export interface Part { ring: number[]; holes: number[][]; y0: number; y1: number }

export function centerOf(r: number[]) {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  return { x: x / (r.length / 2), z: z / (r.length / 2) };
}
export const areaOf = (r: number[]) => Math.abs(area(r));

/** Direction (radians, in x/z) of a ring's longest edge, folded to ±45°: how a square-ish building is turned. */
export function angleOf(r: number[]) {
  let best = 0, a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length, dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], l = Math.hypot(dx, dz);
    if (l > best) { best = l; a = Math.atan2(dz, dx); }
  }
  while (a > Math.PI / 4) a -= Math.PI / 2;
  while (a <= -Math.PI / 4) a += Math.PI / 2;
  return a;
}

export function bboxOf(parts: Part[], fallback = 30) {
  if (!parts.length) return { x0: -fallback, x1: fallback, z0: -fallback, z1: fallback };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) for (let i = 0; i < p.ring.length; i += 2) { x0 = Math.min(x0, p.ring[i]); x1 = Math.max(x1, p.ring[i]); z0 = Math.min(z0, p.ring[i + 1]); z1 = Math.max(z1, p.ring[i + 1]); }
  return { x0, x1, z0, z1 };
}

/** Rotate a ring (x, z pairs) about the origin by a (radians, x toward z), then move it to (ox, oz). */
export function turn(r: number[], a: number, ox = 0, oz = 0) {
  const c = Math.cos(a), s = Math.sin(a), out: number[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(ox + r[i] * c - r[i + 1] * s, oz + r[i] * s + r[i + 1] * c);
  return out;
}

/** Point (x, z) turned by a about (ox, oz)'s frame: local → model. */
export function at(ox: number, oz: number, a: number, x: number, z: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: ox + x * c - z * s, z: oz + x * s + z * c };
}
