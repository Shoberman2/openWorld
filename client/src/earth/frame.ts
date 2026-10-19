// The local frame of the streaming world: Web Mercator scaled by cos(origin latitude), so that near
// the origin one unit is one meter, map tiles are exact squares, and neighboring tiles meet exactly.
// Local axes: x = east, z = south, y = up (meters above the origin's ground elevation).

export const R = 6378137;
export const WORLD = 2 * Math.PI * R; // mercator meters around the equator

export interface LatLon { lat: number; lon: number }

export class GeoFrame {
  readonly mx0: number;
  readonly my0: number;
  /** Local meters per mercator meter at the origin. */
  readonly k: number;
  constructor(readonly lat0: number, readonly lon0: number) {
    this.mx0 = mercX(lon0);
    this.my0 = mercY(lat0);
    this.k = Math.cos((lat0 * Math.PI) / 180);
  }

  toLocal(lat: number, lon: number) {
    return { x: (mercX(lon) - this.mx0) * this.k, z: -(mercY(lat) - this.my0) * this.k };
  }

  toGeo(x: number, z: number): LatLon {
    return { lon: lonOf(x / this.k + this.mx0), lat: latOf(-z / this.k + this.my0) };
  }

  /** Size of a zoom-z tile in local meters. */
  tileSize(z: number) { return (WORLD / 2 ** z) * this.k; }

  /** Local square covered by tile (z, x, y): west edge x0, north edge z0, side length. */
  tileRect(z: number, tx: number, ty: number) {
    const s = WORLD / 2 ** z;
    return {
      x0: (tx * s - WORLD / 2 - this.mx0) * this.k,
      z0: (ty * s - WORLD / 2 + this.my0) * this.k,
      size: s * this.k,
    };
  }

  /** Which zoom-z tile contains local point (x, z). */
  tileAt(z: number, x: number, zz: number) {
    const s = WORLD / 2 ** z;
    const mx = x / this.k + this.mx0, my = -zz / this.k + this.my0;
    return { tx: Math.floor((mx + WORLD / 2) / s), ty: Math.floor((WORLD / 2 - my) / s) };
  }

  /** Meters between two local points, corrected for the projection's scale away from the origin. */
  distance(ax: number, az: number, bx: number, bz: number) {
    const g = this.toGeo((ax + bx) / 2, (az + bz) / 2);
    return Math.hypot(bx - ax, bz - az) * Math.cos((g.lat * Math.PI) / 180) / this.k;
  }
}

export function mercX(lon: number) { return (lon * Math.PI / 180) * R; }
export function mercY(lat: number) {
  const l = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return R * Math.log(Math.tan(Math.PI / 4 + l / 2));
}
export function lonOf(mx: number) { return (mx / R) * 180 / Math.PI; }
export function latOf(my: number) { return (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI; }

/** Fractional slippy-map tile coordinates of a lat/lon at zoom z. */
export function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  return { x: ((lon + 180) / 360) * n, y: ((WORLD / 2 - mercY(lat)) / WORLD) * n };
}

/** Great-circle distance in meters. */
export function haversine(a: LatLon, b: LatLon) {
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon) {
  const toR = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR);
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
