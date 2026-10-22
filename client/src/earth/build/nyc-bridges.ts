// Worker side: the real deck heights of New York's great suspension bridges. The map only knows a bridge
// is "a bridge" (a few meters over the water, on pillars every 30 m); the East River bridges carry their
// roadways ~40-47 m up, hung from the hand-built towers and cables (landmarks/nyc-models.ts, models.ts).
// The profile is a function of world position (flat over the main span, easing down across the side
// spans and approaches), so every chunk a bridge crosses agrees on it.
import { WORLD, mercX, mercY } from '../frame.ts';
import type { ChunkJob } from './types.ts';

interface Deck {
  lat: number; lon: number;
  /** Degrees clockwise from north along the bridge. */
  bearing: number;
  /** Half the main span (flat at `deck`). */
  half: number;
  /** Distance past the towers over which the roadway eases back down to the map's own profile. */
  ramp: number;
  /** Suspended (no pillars) out to this distance from the center. */
  hung: number;
  /** Roadway height above the water, meters. */
  deck: number;
  /** Corridor half-width. */
  w: number;
}

// Clearances: Brooklyn 41 m (135 ft), Manhattan 41 m, Williamsburg 41 m under a 12 m truss, Queensboro 41 m (NYC DOT).
// Centers and bearings are where the landmark layer fits the models between the map's tower parts.
const DECKS: Deck[] = [
  { lat: 40.705686, lon: -73.996348, bearing: 136.4, half: 243, ramp: 560, hung: 520, deck: 40, w: 16 },
  { lat: 40.706963, lon: -73.990469, bearing: 157.2, half: 224, ramp: 520, hung: 440, deck: 41, w: 24 },
  { lat: 40.713577, lon: -73.97214, bearing: 111.9, half: 244, ramp: 560, hung: 430, deck: 47, w: 26 },
  // Queensboro: a cantilever truss, level from the Manhattan pier to the Queens pier; 41 m over the channels.
  { lat: 40.756049, lon: -73.95262, bearing: 119.8, half: 441, ramp: 420, hung: 600, deck: 41, w: 22 },
];

/** Decks touching this tile, in chunk-local meters. `at` gives the lift over the water and whether the span is hung there. */
export function realDecks(job: ChunkJob) {
  const s = WORLD / 2 ** job.z;
  const mxW = job.tx * s - WORLD / 2, myN = WORLD / 2 - job.ty * s, size = s * job.k;
  const here = DECKS.map((d) => {
    const b = (d.bearing * Math.PI) / 180;
    return { ...d, x: (mercX(d.lon) - mxW) * job.k, z: (myN - mercY(d.lat)) * job.k, ex: Math.sin(b), ez: -Math.cos(b) };
  }).filter((d) => {
    const reach = d.half + d.ramp + d.w;
    return d.x > -reach && d.z > -reach && d.x < size + reach && d.z < size + reach;
  });
  return {
    any: here.length > 0,
    /**
     * For a bridge road (x,z pairs): the profile along it when the whole road runs inside one bridge's
     * corridor, parallel to it (a path that merely crosses the corridor keeps the map's own heights).
     */
    of(pts: number[]): ((x: number, z: number) => { lift: number; hung: boolean } | null) | null {
      const n = pts.length / 2;
      if (n < 2) return null;
      const dx = pts[n * 2 - 2] - pts[0], dz = pts[n * 2 - 1] - pts[1], dl = Math.hypot(dx, dz) || 1;
      for (const d of here) {
        if (Math.abs((dx * d.ex + dz * d.ez) / dl) < 0.9) continue;
        let inside = true;
        for (let q = 0; q < n && inside; q++) {
          const rx = pts[q * 2] - d.x, rz = pts[q * 2 + 1] - d.z;
          const t = Math.abs(rx * d.ex + rz * d.ez), l = Math.abs(-rx * d.ez + rz * d.ex);
          if (t < d.half + d.ramp && l > d.w) inside = false;
        }
        if (!inside) continue;
        return (x: number, z: number) => {
          const rx = x - d.x, rz = z - d.z;
          const t = Math.abs(rx * d.ex + rz * d.ez);
          if (t > d.half + d.ramp) return null;
          const k = t <= d.half ? 1 : 1 - (t - d.half) / d.ramp;
          // Ease (smoothstep) so the roadway meets the towers level and the approaches gently.
          return { lift: d.deck * k * k * (3 - 2 * k), hung: t < d.hung };
        };
      }
      return null;
    },
  };
}
