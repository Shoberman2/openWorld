// Worker side: which map buildings in a tile belong to a hand-built landmark (they're handed over
// instead of extruded), and which house numbers stand in which footprint (for the look-at label).
import { WORLD, mercX, mercY } from '../frame.ts';
import type { Layers } from '../mvt.ts';
import { num, str } from '../mvt.ts';
import { inRing } from '../build/geo.ts';
import type { ChunkJob, FootprintData } from '../build/types.ts';
import { LANDMARKS } from './catalog.ts';

/** A map building handed to a landmark: chunk-local ring (clockwise), base and top y. */
export interface LandmarkClaim { id: string; ring: number[]; holes: number[][]; base: number; top: number; minH: number }

interface Zone { id: string; x: number; z: number; ex: number; ez: number; nx: number; nz: number; hw: number; hd: number; r: number; minH: number }

/** Zones that touch this tile, in chunk-local meters. */
export function landmarkZones(job: ChunkJob) {
  const s = WORLD / 2 ** job.z;
  const mxW = job.tx * s - WORLD / 2, myN = WORLD / 2 - job.ty * s, size = s * job.k;
  const zones: Zone[] = [];
  for (const l of LANDMARKS) {
    if (!l.zone) continue;
    const x = (mercX(l.lon) - mxW) * job.k, z = (myN - mercY(l.lat)) * job.k;
    const reach = 'r' in l.zone ? l.zone.r : Math.hypot(l.zone.w, l.zone.d) / 2;
    if (x < -reach || z < -reach || x > size + reach || z > size + reach) continue;
    const b = (l.bearing * Math.PI) / 180;
    zones.push({
      id: l.id, x, z,
      ex: Math.cos(b), ez: Math.sin(b), nx: Math.sin(b), nz: -Math.cos(b),
      hw: 'r' in l.zone ? 0 : l.zone.w / 2, hd: 'r' in l.zone ? 0 : l.zone.d / 2,
      r: 'r' in l.zone ? l.zone.r : 0, minH: l.claimMinH ?? 0,
    });
  }
  return {
    any: zones.length > 0,
    /** The landmark a building centered at (cx, cz) and h tall belongs to, if any. */
    claim(cx: number, cz: number, h: number): string | null {
      for (const zn of zones) {
        if (h < zn.minH) continue;
        const dx = cx - zn.x, dz = cz - zn.z;
        if (zn.r > 0) { if (dx * dx + dz * dz < zn.r * zn.r) return zn.id; continue; }
        if (Math.abs(dx * zn.ex + dz * zn.ez) < zn.hw && Math.abs(dx * zn.nx + dz * zn.nz) < zn.hd) return zn.id;
      }
      return null;
    },
  };
}

/** Give each footprint the house number standing inside it (OpenMapTiles' housenumber layer). */
export function assignHousenumbers(layers: Layers, footprints: FootprintData[], S: number) {
  const pts = layers.points.housenumber;
  if (!pts?.length || !footprints.length) return;
  const G = 40, grid = new Map<string, FootprintData[]>();
  for (const f of footprints) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let q = 0; q < f.ring.length; q += 2) { x0 = Math.min(x0, f.ring[q]); x1 = Math.max(x1, f.ring[q]); z0 = Math.min(z0, f.ring[q + 1]); z1 = Math.max(z1, f.ring[q + 1]); }
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = `${i},${j}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(f);
    }
  }
  for (const p of pts) {
    const n = str(p.props.housenumber) || String(num(p.props.housenumber, 0) || '');
    if (!n) continue;
    const x = p.x * S, z = p.y * S;
    for (const f of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) {
      if (f.num || !inRing(f.ring, x, z)) continue;
      f.num = n.length > 12 ? n.slice(0, 12) : n;
      break;
    }
  }
}
