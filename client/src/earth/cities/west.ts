// The American West's cities, the way they actually look (runs in the chunk worker: no three.js):
// Los Angeles' Spanish-revival stucco under terracotta and its rows of tall fan palms, the Las Vegas
// valley's desert floor and resort towers, Waikiki's white balconied hotels, Seattle's wood houses and
// brick. Facade styles are returned by name (facades.ts turns them into ids).

const inBox = (lat: number, lon: number, s: number, w: number, n: number, e: number) => lat >= s && lat <= n && lon >= w && lon <= e;
const hash = (lat: number, lon: number) => { const x = Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453; return x - Math.floor(x); };

export type WestCity = 'la' | 'vegas' | 'honolulu' | 'seattle' | null;

export function westCity(lat: number, lon: number): WestCity {
  if (inBox(lat, lon, 33.6, -118.95, 34.36, -117.6)) return 'la';
  if (inBox(lat, lon, 35.9, -115.42, 36.36, -114.9)) return 'vegas';
  if (inBox(lat, lon, 21.24, -158.3, 21.72, -157.64)) return 'honolulu';
  if (inBox(lat, lon, 47.45, -122.46, 47.78, -122.2)) return 'seattle';
  return null;
}

/** The Strip, Las Vegas Blvd from Mandalay Bay to the STRAT. */
const onStrip = (lat: number, lon: number) => inBox(lat, lon, 36.085, -115.182, 36.152, -115.15);
/** Waikiki, Ala Wai Canal to Kapiolani Park. */
const inWaikiki = (lat: number, lon: number) => inBox(lat, lon, 21.268, -157.842, 21.292, -157.812);

/**
 * Ensembles the map can't describe: the Strip's resort towers and Waikiki's hotels are painted
 * concrete, not glass curtain walls (a few Strip towers are glass, and stay so). Style name or null.
 */
export function westKnown(lat: number, lon: number, h: number): string | null {
  if (h >= 30 && inWaikiki(lat, lon)) return 'resort';
  if (h >= 30 && onStrip(lat, lon) && hash(lat, lon) < 0.7) return 'casino';
  return null;
}

/** Facade style for a building in one of these cities (null: the default rules). */
export function westStyle(lat: number, lon: number, h: number, r: number): string | null {
  switch (westCity(lat, lon)) {
    case 'la':
      if (h < 12) return r < 0.55 ? 'spanish' : r < 0.9 ? 'stucco' : 'postwar';
      if (h < 30) return r < 0.4 ? 'stucco' : r < 0.65 ? 'spanish' : 'postwar';
      return h < 60 ? (r < 0.5 ? 'postwar' : 'office') : r < 0.7 ? 'office' : 'deco';
    case 'vegas':
      if (h < 12) return r < 0.65 ? 'spanish' : 'stucco';
      if (onStrip(lat, lon)) return h < 30 ? (r < 0.6 ? 'casino' : 'stucco') : 'casino';
      return h < 40 ? (r < 0.6 ? 'stucco' : 'postwar') : r < 0.5 ? 'casino' : 'office';
    case 'honolulu':
      if (h < 12) return r < 0.6 ? 'stucco' : r < 0.85 ? 'victorian' : 'latin';
      return h < 25 ? (r < 0.6 ? 'resort' : 'postwar') : r < 0.8 ? 'resort' : 'office';
    case 'seattle':
      if (h < 12) return r < 0.55 ? 'victorian' : r < 0.8 ? 'stucco' : 'tenement';
      if (h < 35) return r < 0.45 ? 'prewar' : r < 0.75 ? 'postwar' : 'office';
      return null;
  }
  return null;
}

const TERRACOTTA = [0xb5562f, 0xa44b2a, 0xc0653a, 0x9c4a2e, 0xb8613d];

/** Per-chunk climate: the ground's color, the street trees, the roofs. */
export interface WestClimate {
  city: WestCity;
  /** Open ground (unbuilt land and plain grass) where it isn't irrigated: desert, dry chaparral. */
  ground: string | null;
  /** Street tree kind for a 0..1 hash: 0 broadleaf, 2 palm, 3 tall fan palm. */
  treeKind(r: number): number;
  /** Roof color for a pitched roof in this style (null: the region's). */
  roof(style: string, r: number): number | null;
  /** Styles that take a pitched roof here. */
  pitchy(style: string): boolean;
}

export function westClimate(lat: number, lon: number): WestClimate | null {
  const city = westCity(lat, lon);
  if (!city || city === 'seattle') return null;
  const tileRoofs = city === 'la' || city === 'vegas';
  return {
    city,
    ground: city === 'vegas' ? '#c2a983' : city === 'la' ? '#959159' : null,
    treeKind(r) {
      if (city === 'la') return r < 0.36 ? 3 : r < 0.48 ? 2 : 0;
      if (city === 'vegas') return r < 0.35 ? 3 : r < 0.6 ? 2 : 0;
      return r < 0.75 ? 2 : 0; // Honolulu
    },
    roof(style, r) {
      if (tileRoofs && (style === 'spanish' || style === 'stucco')) return TERRACOTTA[Math.floor(r * TERRACOTTA.length)];
      return null;
    },
    pitchy: (style) => style === 'spanish',
  };
}

/**
 * The big suspension bridges' real deck heights above the water (the map only knows a bridge is
 * "layer 2"): along-axis profiles (meters from the landmark's center, deck height above sea level),
 * so the drivable deck sits on the hand-built towers' trusses.
 */
const BRIDGE_DECKS: { lat: number; lon: number; bearing: number; half: number; prof: [number, number][] }[] = [
  // Golden Gate: 67 m above the strait, level between the bluffs (catalog 'ggb').
  { lat: 37.8197, lon: -122.47861, bearing: 354.7, half: 22, prof: [[-1450, 64], [-1000, 67], [1000, 67], [1450, 64]] },
  // Bay Bridge west crossing (catalog 'baybridge'): down to Rincon Hill, up to Yerba Buena Island.
  { lat: 37.79819, lon: -122.377861, bearing: 40.25, half: 22, prof: [[-2350, 16], [-1450, 59], [-1084, 62], [1084, 62], [1440, 58], [1900, 50]] },
];

/** Deck height above sea level for a bridge point at (lat, lon), or null. */
export function westBridgeDeck(lat: number, lon: number): number | null {
  for (const b of BRIDGE_DECKS) {
    const dn = (lat - b.lat) * 111320, de = (lon - b.lon) * 111320 * Math.cos((b.lat * Math.PI) / 180);
    const br = (b.bearing * Math.PI) / 180;
    const s = dn * Math.cos(br) + de * Math.sin(br), off = -dn * Math.sin(br) + de * Math.cos(br);
    if (Math.abs(off) > b.half) continue;
    const p = b.prof;
    if (s < p[0][0] || s > p[p.length - 1][0]) continue;
    for (let i = 1; i < p.length; i++) if (s <= p[i][0]) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (s - p[i - 1][0])) / (p[i][0] - p[i - 1][0]);
  }
  return null;
}
