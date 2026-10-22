// Europe and the Middle East on the road: London's red double-deckers and black cabs, and the small
// hatchbacks that fill European streets where an American city would have pickups. Each vehicle
// faces +z (head lamps at +z), wheels on y = 0, painted with vertex colors like traffic.ts's.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TypeId } from '../../traffic.ts';

export interface VehicleLook { body: THREE.BufferGeometry; lights: THREE.BufferGeometry; length: number }

function paint(g: THREE.BufferGeometry, c: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const col = new THREE.Color(c), arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

function wheels(w: number, r: number, zs: number[]) {
  const out: THREE.BufferGeometry[] = [];
  for (const z of zs) for (const s of [-1, 1]) {
    out.push(paint(new THREE.CylinderGeometry(r, r, 0.26, 16).rotateZ(Math.PI / 2).translate(s * (w / 2 - 0.12), r, z), 0x141414));
    out.push(paint(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.28, 12).rotateZ(Math.PI / 2).translate(s * (w / 2 - 0.1), r, z), 0x8f9296));
  }
  return out;
}

/** A side profile (points in z, y; front at +z) extruded across the width with softened edges. */
function profile(pts: [number, number][], w: number, c: number, bevel = 0.06) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -(w - bevel * 2) / 2).rotateY(-Math.PI / 2);
  return paint(g, c);
}

const lamp = (x: number, y: number, z: number, w: number, h: number, c: number) => paint(new THREE.BoxGeometry(w, h, 0.05).translate(x, y, z), c);

/** London bus: a red double-decker (the New Routemaster's proportions: 11.2 m long, 4.4 m tall). */
function doubleDecker(): VehicleLook {
  const L = 11.2, W = 2.52, RED = 0xc8202a, GL = 0x1a2027;
  const parts = [
    paint(new RoundedBoxGeometry(W, 4.05, L, 3, 0.28).translate(0, 2.38, 0), RED),
    // Lower and upper deck window bands, the big front windscreens, the dark skirt.
    paint(new THREE.BoxGeometry(W + 0.03, 1.05, L - 1.6).translate(0, 1.95, -0.4), GL),
    paint(new THREE.BoxGeometry(W + 0.03, 0.95, L - 0.9).translate(0, 3.5, -0.1), GL),
    paint(new THREE.BoxGeometry(W - 0.3, 1.3, 0.06).translate(0, 1.95, L / 2 + 0.01), GL),
    paint(new THREE.BoxGeometry(W - 0.25, 1.0, 0.06).translate(0, 3.5, L / 2 + 0.01), GL),
    paint(new THREE.BoxGeometry(W + 0.02, 0.35, L - 0.2).translate(0, 0.52, 0), 0x2a2b2e),
    paint(new THREE.BoxGeometry(W + 0.04, 0.12, L - 0.4).translate(0, 2.72, 0), 0xe8e4dc),
    ...wheels(W, 0.5, [L / 2 - 2.2, -L / 2 + 2.4]),
  ];
  const lights = mergeGeometries([
    lamp(-W / 2 + 0.3, 0.9, L / 2 + 0.03, 0.34, 0.2, 0xfff4dc), lamp(W / 2 - 0.3, 0.9, L / 2 + 0.03, 0.34, 0.2, 0xfff4dc),
    lamp(-W / 2 + 0.25, 0.9, -L / 2 - 0.03, 0.3, 0.3, 0xff1a10), lamp(W / 2 - 0.25, 0.9, -L / 2 - 0.03, 0.3, 0.3, 0xff1a10),
    // The destination blind over the windscreen.
    lamp(0, 2.68, L / 2 + 0.04, 1.7, 0.32, 0xffc23a),
  ])!;
  return { body: mergeGeometries(parts)!, lights, length: L };
}

/** London taxi: the black cab (LEVC TX proportions), tall and upright, its amber TAXI sign. */
function blackCab(): VehicleLook {
  const L = 4.86, W = 1.96, BLACK = 0x15171b;
  const f = L / 2, b = -L / 2;
  const parts = [
    profile([[b + 0.05, 0.32], [f - 0.05, 0.32], [f, 0.45], [f, 0.82], [f - 0.3, 0.98], [f - 1.05, 1.08], [f - 1.6, 1.72], [b + 0.3, 1.84], [b + 0.05, 1.7], [b, 1.0], [b, 0.45]], W, BLACK),
    profile([[f - 1.12, 1.12], [f - 1.58, 1.66], [b + 0.35, 1.76], [b + 0.12, 1.62], [b + 0.08, 1.14]], W + 0.03, 0x1b232c, 0.02),
    paint(new THREE.BoxGeometry(W + 0.06, 0.6, 0.1).translate(0, 1.45, f - 2.2), BLACK),
    paint(new THREE.BoxGeometry(W - 0.5, 0.22, 0.05).translate(0, 0.62, f + 0.01), 0x9a9da1),
    paint(new THREE.BoxGeometry(W + 0.04, 0.18, 0.14).translate(0, 0.42, f), 0x2a2c2f), paint(new THREE.BoxGeometry(W + 0.04, 0.18, 0.14).translate(0, 0.42, b), 0x2a2c2f),
    ...wheels(W, 0.36, [f - 0.95, b + 1.0]),
  ];
  const lights = mergeGeometries([
    lamp(-W / 2 + 0.3, 0.78, f + 0.02, 0.3, 0.26, 0xfff4dc), lamp(W / 2 - 0.3, 0.78, f + 0.02, 0.3, 0.26, 0xfff4dc),
    lamp(-W / 2 + 0.25, 0.9, b - 0.02, 0.26, 0.3, 0xff1a10), lamp(W / 2 - 0.25, 0.9, b - 0.02, 0.26, 0.3, 0xff1a10),
    paint(new THREE.BoxGeometry(0.62, 0.17, 0.2).translate(0, 1.84, f - 1.7), 0xffb020),
  ])!;
  return { body: mergeGeometries(parts)!, lights, length: L };
}

/** A small European hatchback (body left white for the instance paint). */
function hatchback(): VehicleLook {
  const L = 4.1, W = 1.78, WH = 0xffffff;
  const f = L / 2, b = -L / 2;
  const parts = [
    profile([[b + 0.05, 0.3], [f - 0.05, 0.3], [f, 0.42], [f, 0.74], [f - 0.2, 0.86], [f - 1.1, 0.98], [f - 1.85, 1.44], [b + 0.45, 1.48], [b + 0.08, 1.2], [b, 0.95], [b, 0.42]], W, WH),
    profile([[f - 1.14, 1.01], [f - 1.83, 1.4], [b + 0.5, 1.43], [b + 0.16, 1.16], [b + 0.13, 1.0]], W + 0.03, 0x1b232c, 0.02),
    paint(new THREE.BoxGeometry(W + 0.05, 0.42, 0.1).translate(0, 1.2, f - 2.0), WH),
    paint(new THREE.BoxGeometry(W + 0.04, 0.18, 0.14).translate(0, 0.42, f), 0x2a2c2f), paint(new THREE.BoxGeometry(W + 0.04, 0.18, 0.14).translate(0, 0.42, b), 0x2a2c2f),
    ...wheels(W, 0.32, [f - 0.8, b + 0.75]),
  ];
  const lights = mergeGeometries([
    lamp(-W / 2 + 0.3, 0.72, f + 0.02, 0.36, 0.14, 0xfff4dc), lamp(W / 2 - 0.3, 0.72, f + 0.02, 0.36, 0.14, 0xfff4dc),
    lamp(-W / 2 + 0.22, 0.95, b - 0.02, 0.22, 0.26, 0xff1a10), lamp(W / 2 - 0.22, 0.95, b - 0.02, 0.22, 0.26, 0xff1a10),
  ])!;
  return { body: mergeGeometries(parts)!, lights, length: L };
}

const EUROPE = new Set(['gb', 'ie', 'fr', 'be', 'nl', 'lu', 'de', 'at', 'ch', 'it', 'es', 'pt', 'dk', 'se', 'no', 'fi', 'pl', 'cz', 'gr', 'hr', 'hu', 'ro', 'tr']);

/** Vehicle looks for a country (none: keep the default American fleet). */
const looks = new Map<string, Partial<Record<TypeId, VehicleLook>>>();
export function euVehicles(country: string): Partial<Record<TypeId, VehicleLook>> {
  const key = country === 'gb' ? 'gb' : EUROPE.has(country) ? 'eu' : '';
  let out = looks.get(key);
  if (out) return out;
  out = {};
  if (key) out.pickup = hatchback();
  if (key === 'gb') { out.bus = doubleDecker(); out.taxi = blackCab(); }
  looks.set(key, out);
  return out;
}

/** Share of taxis in the traffic (London's black cabs, Istanbul's yellow taxis). */
export const EU_TAXI_SHARE: Record<string, number> = { gb: 0.16, tr: 0.22 };
