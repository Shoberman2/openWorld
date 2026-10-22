// ---- Asia-Pacific & Latin America: each city's own cabs. The taxi model is painted yellow and
// tinted per car, so a tint turns it into Tokyo's black cabs, Hong Kong's red ones, Seoul's orange.
import type { EarthTraffic } from './traffic.ts';

interface CabCity { s: number; w: number; n: number; e: number; share: number; tints: [number, number, number][] }

const CITIES: CabCity[] = [
  { s: 35.4, w: 139.4, n: 35.9, e: 140.0, share: 0.22, tints: [[0.09, 0.09, 0.1], [0.09, 0.09, 0.1], [0.12, 0.14, 0.22], [1, 1, 1], [0.35, 1, 0.6]] }, // Tokyo
  { s: 22.15, w: 113.8, n: 22.45, e: 114.35, share: 0.3, tints: [[1, 0.13, 0.13], [1, 0.13, 0.13], [1, 0.13, 0.13], [0.35, 1, 0.5]] }, // Hong Kong (red urban, green NT)
  { s: 37.4, w: 126.75, n: 37.7, e: 127.2, share: 0.2, tints: [[1, 0.62, 1], [1, 0.62, 1], [0.8, 0.82, 0.9]] }, // Seoul (orange, silver)
  { s: 24.95, w: 121.4, n: 25.15, e: 121.65, share: 0.25, tints: [[1, 1, 1]] }, // Taipei (all yellow)
  { s: 31.0, w: 121.2, n: 31.4, e: 121.7, share: 0.15, tints: [[0.3, 1, 1], [1, 0.85, 1], [0.95, 0.2, 0.2]] }, // Shanghai
  { s: -34.1, w: 150.9, n: -33.7, e: 151.35, share: 0.1, tints: [[1, 1, 1], [0.8, 0.82, 0.86]] }, // Sydney
];

const cityAt = (lat: number, lon: number) => CITIES.find((c) => lat >= c.s && lat <= c.n && lon >= c.w && lon <= c.e);

/** Share of the traffic that's taxis in this city (0 = none). */
export function cityTaxiShare(lat: number, lon: number) { return cityAt(lat, lon)?.share ?? 0; }

/** Paint this city's taxis. */
export function tintCityTaxis(traffic: EarthTraffic, lat: number, lon: number) {
  const c = cityAt(lat, lon);
  if (!c) return;
  let k = 0;
  for (const car of traffic.cars) if (car.type.id === 'taxi') { const t = c.tints[k++ % c.tints.length]; car.paint.setRGB(t[0], t[1], t[2]); }
}
