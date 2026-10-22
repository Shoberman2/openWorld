// Facade styles: what kind of building this is (a Brooklyn brownstone, a SoHo cast-iron loft, a Lower
// East Side tenement, a Paris Haussmann block…), picked per building from where it stands, its height
// and footprint. One table drives both sides: the worker builds the geometry that goes with a style
// (stoops, fire escapes, cornices) and the facade shader paints its windows, so both read the same
// floor heights and bay widths from here. No three.js imports: this runs in the chunk worker too.

// ---- East US
import { EAST_STYLES, eastStyle } from '../cities/east.ts';
import { westKnown, westStyle } from '../cities/west.ts';

export type RGB = [number, number, number];

export interface FacadeStyle {
  name: string;
  /** Floor height range (m); picked per building from its seed. */
  floor: [number, number];
  /** Street-level shop/lobby floor height range; 0 = no tall ground floor (houses). */
  ground: [number, number];
  /** Raised first floor (brownstone parlor floor over a basement), m. */
  plinth: number;
  /** Window bay width range (m). */
  bay: [number, number];
  /** Window size as a fraction of the bay width / floor height. */
  winW: [number, number];
  winH: [number, number];
  /** Share of buildings with round-arched window heads. */
  arch: number;
  /** Stone lintels and sills (0..1). */
  lintel: number;
  /** Piers between bays (cast-iron columns, Art Deco verticals), 0..1. */
  pier: number;
  /** Floors above the ground floor clad in the base material (a limestone base). */
  baseFloors: number;
  /** Brick coursing (0 = stone or render). */
  brick: number;
  /** Horizontal ribbon windows (postwar, Asian towers). */
  ribbon: number;
  /** Shutters beside the windows (Mediterranean). */
  shutters: number;
  /** 1: iron balconies along certain floors (Haussmann); 2: a small balcony at most windows. */
  balcony: number;
  /** A dark zinc mansard top floor with dormers. */
  mansard: number;
  /** Glazing bars (sash windows). */
  sash: number;
  /** Window frame, stone trim and base material colors (sRGB 0..255). */
  frame: RGB;
  trim: RGB;
  base: RGB;
  /** Wall colors (sRGB hex). */
  walls: number[];
  /** Street level when the map doesn't say: 0 houses (no shops), 1 shops, 2 a lobby. */
  ground0: number;
  /** Cornice projection (m) and color (null = the trim). */
  cornice: number;
  corniceColor: RGB | null;
  /** Geometry: stoops, fire escapes (share of buildings), a projecting bay window. */
  stoop: number;
  fireEscape: number;
  bayWindow: number;
}

const hex = (s: string) => parseInt(s.slice(1), 16);
const H = (...s: string[]) => s.map(hex);

const S = (o: Partial<FacadeStyle> & { name: string }): FacadeStyle => ({
  floor: [3.1, 3.7], ground: [4.6, 5.4], plinth: 0, bay: [2.2, 3.2], winW: [0.38, 0.52], winH: [0.5, 0.64], arch: 0, lintel: 0, pier: 0,
  baseFloors: 0, brick: 0, ribbon: 0, shutters: 0, balcony: 0, mansard: 0, sash: 0,
  frame: [210, 206, 198], trim: [214, 208, 196], base: [196, 190, 178], walls: H('#bdb4a2'), ground0: 1,
  cornice: 0.35, corniceColor: null, stoop: 0, fireEscape: 0, bayWindow: 0,
  ...o,
});

/** Index = style id (stored in the building's seed attribute, see encodeSeed). 0 keeps the original look. */
export const STYLES: FacadeStyle[] = [
  S({ name: 'generic' }),
  // New York rowhouse: brown sandstone, a stoop up to the parlor floor, tall windows with heavy
  // lintels, a big bracketed cornice, often a bowed bay.
  S({ name: 'brownstone', floor: [3.3, 3.7], ground: [0, 0], plinth: 1.7, bay: [1.75, 2.05], winW: [0.56, 0.62], winH: [0.6, 0.66], arch: 0.15, lintel: 1,
    walls: H('#6f4a3a', '#7a5140', '#634136', '#80584a', '#5d3d31', '#8a6150', '#7b4a3a'), trim: [96, 66, 52], frame: [44, 34, 30], base: [92, 64, 52],
    ground0: 0, cornice: 0.6, corniceColor: [58, 46, 40], stoop: 1, bayWindow: 0.3 }),
  // SoHo / Tribeca cast iron: tall floors, columns between big arched windows, painted cream, grey, green.
  S({ name: 'castiron', floor: [4.1, 4.6], ground: [4.8, 5.4], bay: [2.6, 3.0], winW: [0.66, 0.72], winH: [0.66, 0.72], arch: 0.6, lintel: 0.5, pier: 1,
    walls: H('#d6cdb7', '#cbc3b0', '#b9b4a8', '#9aa29a', '#cfc6ae', '#a69c88', '#7f8780', '#e0d8c4'), trim: [226, 220, 204], frame: [40, 42, 44],
    ground0: 1, cornice: 0.7, fireEscape: 0.8 }),
  // Lower East Side / Chinatown tenement: five or six floors of painted brick, fire escapes on the front.
  S({ name: 'tenement', floor: [2.95, 3.15], ground: [3.9, 4.4], bay: [1.9, 2.2], winW: [0.46, 0.52], winH: [0.52, 0.58], lintel: 0.8, brick: 1,
    walls: H('#8a4434', '#7a3c30', '#9b5a40', '#6f3a2e', '#a77452', '#8f6e56', '#b3a28a', '#6e5a4a', '#94443a'), trim: [200, 192, 176], frame: [236, 232, 222],
    ground0: 1, cornice: 0.55, corniceColor: [70, 64, 60], fireEscape: 0.9 }),
  // Prewar apartment house (Upper West / East Side): limestone base, brick shaft, paired windows.
  S({ name: 'prewar', floor: [2.95, 3.2], ground: [4.2, 4.8], bay: [1.9, 2.3], winW: [0.46, 0.52], winH: [0.5, 0.56], lintel: 0.7, baseFloors: 2, brick: 1,
    walls: H('#9a6248', '#8a5440', '#b08a66', '#a46e52', '#c2a682', '#8e6a52', '#b4785a'), trim: [214, 206, 188], frame: [228, 224, 214], base: [204, 196, 178],
    ground0: 2, cornice: 0.5 }),
  // Art Deco: buff brick, continuous piers, dark recessed spandrels.
  S({ name: 'deco', floor: [3.4, 3.7], ground: [5.4, 6.2], bay: [1.6, 1.9], winW: [0.5, 0.56], winH: [0.58, 0.64], pier: 0.8, baseFloors: 2, brick: 0.6,
    walls: H('#c9b996', '#bfae8c', '#d3c6a8', '#b8a586', '#a89878'), trim: [218, 210, 190], frame: [60, 58, 56], base: [196, 186, 166],
    ground0: 2, cornice: 0.15 }),
  // Postwar white brick: ribbons of windows, thin balconies.
  S({ name: 'postwar', floor: [2.7, 2.9], ground: [4.0, 4.6], bay: [3.0, 3.6], winW: [0.72, 0.8], winH: [0.48, 0.54], ribbon: 0.6, brick: 0.7,
    walls: H('#dcd6c8', '#d4ccbb', '#e2ddd2', '#cfc9bd', '#c7c0b2'), trim: [200, 196, 188], frame: [150, 154, 158],
    ground0: 2, cornice: 0.05 }),
  // Midtown office (limestone / granite grid, 1920s–60s).
  S({ name: 'office', floor: [3.6, 3.9], ground: [5.2, 6.0], bay: [1.5, 1.8], winW: [0.6, 0.68], winH: [0.56, 0.62], lintel: 0.3, pier: 0.5, baseFloors: 1,
    walls: H('#cfc7b6', '#bcb4a2', '#c4bdb0', '#a9a49a', '#b9ad96', '#9a9690'), trim: [216, 210, 198], frame: [64, 66, 68], base: [150, 146, 140],
    ground0: 2, cornice: 0.2 }),
  // London Georgian / Victorian terraces: stock brick over a white stucco ground floor, sash windows.
  S({ name: 'georgian', floor: [3.2, 3.6], ground: [0, 0], plinth: 0.9, bay: [2.0, 2.4], winW: [0.46, 0.5], winH: [0.6, 0.68], lintel: 0.5, baseFloors: 1, brick: 1, sash: 1,
    walls: H('#a58a62', '#9a7f5a', '#b39a72', '#8e4b38', '#a05a40', '#b8a07a'), trim: [234, 230, 220], frame: [240, 238, 232], base: [232, 228, 218],
    ground0: 0, cornice: 0.25 }),
  // White stucco (Belgravia, Notting Hill; also Los Angeles).
  S({ name: 'stucco', floor: [3.1, 3.5], ground: [0, 0], plinth: 0.6, bay: [2.1, 2.6], winW: [0.46, 0.54], winH: [0.56, 0.64], lintel: 0.4, sash: 0.7,
    walls: H('#ece8de', '#e6e0d2', '#f0ece4', '#e2dccc', '#dcd4c4'), trim: [244, 242, 236], frame: [244, 242, 236], ground0: 0, cornice: 0.3 }),
  // Paris Haussmann: cream limestone, iron balconies on the 2nd and 5th floors, zinc mansard.
  S({ name: 'haussmann', floor: [3.0, 3.3], ground: [4.4, 5.0], bay: [2.2, 2.6], winW: [0.46, 0.52], winH: [0.66, 0.72], lintel: 0.6, balcony: 1, mansard: 1,
    walls: H('#d8ccb2', '#cfc2a6', '#e0d6c0', '#d2c6ae', '#c8bba0'), trim: [226, 218, 200], frame: [236, 232, 222], ground0: 1, cornice: 0.35 }),
  // Mediterranean (Rome, Barcelona, Lisbon, Athens): warm render, shutters, small balconies.
  S({ name: 'mediterranean', floor: [3.1, 3.5], ground: [4.0, 4.6], bay: [2.3, 2.9], winW: [0.36, 0.42], winH: [0.56, 0.62], lintel: 0.4, shutters: 1, balcony: 2,
    walls: H('#d9a86a', '#c98e5a', '#e2bf88', '#c97b52', '#e4cfa6', '#b86a46', '#d8b48a', '#e8dcc0'), trim: [232, 220, 196], frame: [228, 222, 206],
    ground0: 1, cornice: 0.3 }),
  // Central European Altbau: pastel plaster, tall windows with white surrounds.
  S({ name: 'altbau', floor: [3.4, 3.8], ground: [4.2, 4.8], bay: [2.3, 2.7], winW: [0.42, 0.48], winH: [0.6, 0.66], lintel: 0.7,
    walls: H('#e2d6b4', '#d8c99e', '#cfd2bd', '#e4c7b2', '#c9c2b0', '#ddd2c0', '#bfc6c0'), trim: [240, 236, 226], frame: [244, 242, 236], ground0: 1, cornice: 0.35 }),
  // East Asian city blocks: tiled cladding, window bands, AC units, vertical signs.
  S({ name: 'asiamodern', floor: [3.0, 3.3], ground: [3.8, 4.4], bay: [2.6, 3.4], winW: [0.6, 0.78], winH: [0.46, 0.56], ribbon: 0.5,
    walls: H('#dad6cc', '#cfcac0', '#c4c4c0', '#e2ddd2', '#bab4a8', '#d4ccbc', '#a8aaa8'), trim: [210, 208, 204], frame: [120, 124, 128],
    ground0: 1, cornice: 0.05 }),
  // Eastern Mediterranean, North Africa, South Asia: sand concrete, balconies, AC boxes.
  S({ name: 'levant', floor: [3.0, 3.2], ground: [3.8, 4.4], bay: [2.4, 3.0], winW: [0.4, 0.5], winH: [0.48, 0.56], balcony: 2,
    walls: H('#d6c4a0', '#cbb68e', '#e0d2b4', '#c2ad86', '#d8ccb6', '#bfa47e', '#e6dcc6'), trim: [222, 212, 190], frame: [150, 140, 124],
    ground0: 1, cornice: 0.08 }),
  // Latin America: painted render (Mexico City, Havana), modernist slabs with louvers (Rio, São Paulo).
  S({ name: 'latin', floor: [3.0, 3.3], ground: [3.8, 4.4], bay: [2.4, 3.0], winW: [0.42, 0.52], winH: [0.5, 0.58], lintel: 0.3, balcony: 2,
    walls: H('#d9a35e', '#c55a4a', '#4f8fa0', '#e2c27a', '#9fbf8a', '#e6dcc8', '#d98a6a', '#b4c6c8'), trim: [236, 230, 216], frame: [60, 60, 62],
    ground0: 1, cornice: 0.1 }),
  // San Francisco Victorians: painted wood, bay windows, ornate cornices.
  S({ name: 'victorian', floor: [3.3, 3.6], ground: [0, 0], plinth: 1.4, bay: [1.6, 1.9], winW: [0.5, 0.56], winH: [0.62, 0.68], lintel: 0.8, sash: 1,
    walls: H('#c9d6d2', '#e8d8a8', '#d8b4b4', '#b8c8a8', '#a8bccc', '#e6e0d0', '#d6c2a4', '#9fb4a8'), trim: [244, 242, 236], frame: [244, 242, 236],
    ground0: 0, cornice: 0.5, stoop: 0.6, bayWindow: 0.8 }),
  // Amsterdam canal house: narrow, dark brick, big white-framed windows.
  S({ name: 'canal', floor: [2.9, 3.3], ground: [0, 0], plinth: 0.8, bay: [1.5, 1.8], winW: [0.56, 0.64], winH: [0.6, 0.68], lintel: 0.4, brick: 1, sash: 0.8,
    walls: H('#6a3428', '#7a3c2c', '#5a2e24', '#8a4a36', '#4e2c26', '#6f4a3a', '#3e3b39', '#e6e0d2', '#8c7660', '#5c4a3f'), trim: [236, 232, 222], frame: [240, 238, 232], ground0: 0, cornice: 0.2 }),
  // Indiana limestone Art Deco (Rockefeller Center): smooth pale stone, slim continuous piers, dark spandrels.
  S({ name: 'limestone', floor: [3.6, 3.8], ground: [5.6, 6.2], bay: [1.5, 1.7], winW: [0.5, 0.54], winH: [0.6, 0.64], pier: 0.9, baseFloors: 1,
    walls: H('#d9d2c2', '#d3cbb9', '#ddd7c9', '#cfc7b4'), trim: [228, 222, 208], frame: [58, 60, 62], base: [200, 192, 176], ground0: 2, cornice: 0.08 }),
  // Place des Vosges: red brick with white stone quoins and window surrounds, steep slate roofs.
  S({ name: 'vosges', floor: [3.6, 3.9], ground: [4.8, 5.2], bay: [2.8, 3.2], winW: [0.42, 0.46], winH: [0.64, 0.7], lintel: 1, brick: 1, mansard: 1,
    walls: H('#a4513c', '#9a4a37', '#ad5a43', '#b0604a'), trim: [234, 228, 214], frame: [232, 228, 218], base: [214, 206, 190], ground0: 1, cornice: 0.2 }),
  // ---- East US: miamideco, condo, bowfront, chicagoschool (cities/east.ts).
  ...EAST_STYLES.map(S),
  // ---- Asia-Pacific & Latin America
  // Sydney / Melbourne Victorian terrace: two storeys of painted render or face brick behind a
  // verandah, the upper balcony fenced in cast-iron lace, sash windows, a parapet on top.
  S({ name: 'terrace', floor: [3.3, 3.7], ground: [0, 0], plinth: 0.5, bay: [2.0, 2.4], winW: [0.42, 0.48], winH: [0.62, 0.7], lintel: 0.4, sash: 1, balcony: 1,
    walls: H('#e9e1cf', '#d8c3a0', '#efe9dc', '#b5a28a', '#a0523d', '#8f9a86', '#c4a27a', '#e3d6bd', '#8c4a36'), trim: [240, 236, 226], frame: [244, 242, 236],
    base: [214, 204, 186], ground0: 0, cornice: 0.35 }),
  // ---- West Coast (cities/west.ts picks these)
  // Waikiki hotels and condos: white and sand concrete, a balcony at every unit, sliding glass doors.
  S({ name: 'resort', floor: [2.85, 3.05], ground: [4.6, 5.6], bay: [3.2, 4.0], winW: [0.7, 0.8], winH: [0.62, 0.7], ribbon: 0.2, balcony: 2,
    walls: H('#efece4', '#e8e2d4', '#f2efe8', '#e6dccb', '#dcd7cc', '#eadfd0', '#d9d4c6'), trim: [244, 242, 236], frame: [176, 184, 190], ground0: 2, cornice: 0.06 }),
  // Las Vegas resort towers: smooth stucco in cream, gold and bronze, bands of tinted glass.
  S({ name: 'casino', floor: [3.0, 3.2], ground: [6.0, 7.0], bay: [2.2, 2.8], winW: [0.7, 0.8], winH: [0.4, 0.48], ribbon: 0.6,
    walls: H('#e6d6b2', '#d9c08a', '#c9a66b', '#efe9dc', '#e3cfc0', '#b98f5e', '#d8d2c4'), trim: [236, 226, 206], frame: [150, 122, 84], ground0: 2, cornice: 0.15 }),
  // Southern California Spanish revival: white and cream stucco, arched windows, dark wood frames, tile roofs.
  S({ name: 'spanish', floor: [3.1, 3.5], ground: [0, 0], plinth: 0.4, bay: [2.4, 3.2], winW: [0.36, 0.44], winH: [0.5, 0.6], arch: 0.45,
    walls: H('#f1ece1', '#ece3d1', '#efe0c8', '#e9d5bd', '#f4efe6', '#e3d2b8', '#dcc9ae'), trim: [240, 236, 228], frame: [74, 54, 40], ground0: 0, cornice: 0.05 }),
  // ---- Europe & Middle East
  // Portland stone (London's West End, Westminster, the City): white-grey limestone, a rusticated
  // base, tall sash windows with stone surrounds, a strong cornice, dark slate attics.
  S({ name: 'portland', floor: [3.6, 4.1], ground: [4.6, 5.4], bay: [2.3, 2.8], winW: [0.42, 0.48], winH: [0.6, 0.68], lintel: 1, baseFloors: 1, sash: 1, mansard: 0.6,
    walls: H('#e2dccd', '#d9d2c1', '#e6e1d5', '#cfc8b6', '#ddd6c4'), trim: [238, 234, 224], frame: [246, 244, 238], base: [206, 199, 184], ground0: 1, cornice: 0.5 }),
  // Gothic Revival in honey Anston limestone (the Palace of Westminster): narrow tall windows between
  // buttress piers, traceried panels, tall floors.
  S({ name: 'gothicRevival', floor: [4.6, 5.2], ground: [0, 0], plinth: 1.2, bay: [1.7, 2.0], winW: [0.36, 0.42], winH: [0.66, 0.74], arch: 1, lintel: 0.8, pier: 1,
    walls: H('#c6a86e', '#bf9f66', '#cbaf78', '#b99a62'), trim: [212, 190, 140], frame: [70, 66, 60], base: [196, 178, 136], ground0: 0, cornice: 0.3, corniceColor: [204, 186, 142] }),
];

/**
 * Buildings the map can't describe but everyone knows: whole ensembles with one architecture
 * (Rockefeller Center's limestone, the brick pavilions of the Place des Vosges). Circles in lat/lon
 * with a radius in meters; `ring` keeps only an annulus (a square's frame of buildings).
 */
const KNOWN: { lat: number; lon: number; r: number; r0?: number; style: string; maxH?: number }[] = [
  { lat: 40.75885, lon: -73.97905, r: 150, style: 'limestone' }, // Rockefeller Center, Fifth to Sixth Avenue
  { lat: 40.763634, lon: -73.972509, r: 15, style: 'limestone', maxH: 30 }, // the GM Building's white marble base
  { lat: 48.85561, lon: 2.36549, r: 118, r0: 58, style: 'vosges', maxH: 30 }, // Place des Vosges
  // ---- Europe & Middle East
  { lat: 51.49935, lon: -0.12475, r: 140, style: 'gothicRevival', maxH: 110 }, // the Palace of Westminster
  { lat: 51.49929, lon: -0.12734, r: 60, style: 'gothicRevival', maxH: 80 }, // Westminster Abbey
  { lat: 51.51383, lon: -0.09836, r: 95, style: 'portland', maxH: 45 }, // St Paul's Cathedral and its churchyard
  { lat: 51.51355, lon: -0.11365, r: 70, style: 'gothicRevival', maxH: 50 }, // the Royal Courts of Justice
  { lat: 51.50140, lon: -0.14190, r: 75, style: 'portland', maxH: 30 }, // Buckingham Palace
];

/** A known ensemble's style for a building at (lat, lon), or -1. */
export function knownStyle(lat: number, lon: number, h: number): number {
  const west = westKnown(lat, lon, h); // ---- West Coast
  if (west) return STYLE[west];
  for (const k of KNOWN) {
    if (k.maxH && h > k.maxH) continue;
    const dy = (lat - k.lat) * 111_320, dx = (lon - k.lon) * 111_320 * Math.cos((k.lat * Math.PI) / 180), d = Math.hypot(dx, dy);
    if (d <= k.r && d >= (k.r0 ?? 0)) return STYLE[k.style];
  }
  return -1;
}

export const STYLE = Object.fromEntries(STYLES.map((s, i) => [s.name, i])) as Record<string, number>;

/** Street-level kinds (from the map's points of interest, or the style's default). */
export const GROUND_KIND = { none: 0, shops: 1, lobby: 2, restaurant: 3, bodega: 4, bank: 5, boutique: 6, hotel: 7 } as const;

/** Per-vertex style seed: fractional seed (0..1) + 2 if glass + 4 * style + 128 * ground kind. */
export function encodeSeed(seed: number, glass: boolean, style: number, ground: number) {
  return (seed % 1) * 0.999 + (glass ? 2 : 0) + style * 4 + ground * 128;
}

const fract = (v: number) => v - Math.floor(v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The same numbers the facade shader derives from the seed (keep in step with style.ts). */
export function facadeDims(style: number, seed: number, h: number, ground: number) {
  const st = STYLES[style] ?? STYLES[0];
  const tall = h >= 7 ? 1 : 0;
  const floorH = mix(st.floor[0], st.floor[1], fract(seed * 7.13));
  const shopH = ground === GROUND_KIND.none ? 0 : st.ground[1] > 0 ? mix(st.ground[0], st.ground[1], fract(seed * 3.31)) : mix(4.0, 4.6, fract(seed * 3.31));
  const groundH = tall * shopH;
  const bayW = mix(st.bay[0], st.bay[1], fract(seed * 5.71));
  const first = groundH > 0 ? groundH : st.plinth;
  return { floorH, groundH, bayW, first, plinth: st.plinth };
}

/** Which ground-floor kind a point of interest suggests. */
export function groundFromPoi(cls: string, sub: string): number {
  if (['restaurant', 'cafe', 'bar', 'fast_food', 'beer', 'ice_cream', 'bakery'].includes(cls)) return GROUND_KIND.restaurant;
  if (cls === 'grocery' || sub === 'convenience' || sub === 'deli' || sub === 'newsagent' || sub === 'tobacco' || cls === 'alcohol_shop' || cls === 'pharmacy' || cls === 'laundry') return GROUND_KIND.bodega;
  if (cls === 'bank' || cls === 'atm') return GROUND_KIND.bank;
  if (['clothing_store', 'art_gallery', 'jewelry'].includes(cls) || ['jewelry', 'shoes', 'clothes', 'gallery', 'cosmetics', 'boutique', 'furniture', 'optician'].includes(sub)) return GROUND_KIND.boutique;
  if (cls === 'lodging') return GROUND_KIND.hotel;
  if (cls === 'office' || cls === 'town_hall' || cls === 'college' || cls === 'library' || cls === 'museum' || cls === 'theatre') return GROUND_KIND.lobby;
  if (cls === 'shop' || cls === 'hairdresser' || cls === 'mobile_phone' || cls === 'shoes' || cls === 'gift' || cls === 'beauty' || cls === 'books') return GROUND_KIND.shops;
  return -1;
}

const inBox = (lat: number, lon: number, s: number, w: number, n: number, e: number) => lat >= s && lat <= n && lon >= w && lon <= e;

// Manhattan's shores, west and east longitude by latitude (piecewise linear).
const MN_LAT = [40.700, 40.705, 40.710, 40.720, 40.730, 40.750, 40.770, 40.790, 40.800, 40.830, 40.870, 40.880];
const MN_W = [-74.020, -74.019, -74.017, -74.014, -74.012, -74.009, -73.995, -73.979, -73.972, -73.952, -73.930, -73.926];
const MN_E = [-74.010, -74.001, -73.993, -73.974, -73.972, -73.968, -73.947, -73.939, -73.929, -73.934, -73.910, -73.912];
function interpLat(lat: number, xs: number[]) {
  if (lat <= MN_LAT[0]) return xs[0];
  for (let i = 1; i < MN_LAT.length; i++) if (lat <= MN_LAT[i]) return xs[i - 1] + ((xs[i] - xs[i - 1]) * (lat - MN_LAT[i - 1])) / (MN_LAT[i] - MN_LAT[i - 1]);
  return xs[xs.length - 1];
}
export const inManhattan = (lat: number, lon: number) => lat > 40.698 && lat < 40.88 && lon > interpLat(lat, MN_W) && lon < interpLat(lat, MN_E);

/**
 * Pick a style for one building. `region` is the palette region (palette.ts), `h` its height,
 * `area` its footprint, `r` a 0..1 hash for this building.
 */
export function chooseStyle(region: string, country: string, lat: number, lon: number, h: number, area: number, r: number): number {
  // ---- East US: Miami, Boston, Chicago, Washington, Toronto (cities/east.ts).
  if (country === 'us') { const west = westStyle(lat, lon, h, r); if (west) return STYLE[west]; } // ---- West Coast
  if (country === 'us' || country === 'ca') { const e = eastStyle(country, lat, lon, h, r); if (e) return STYLE[e]; }
  if (country === 'us') {
    // New York City: by neighborhood.
    if (inBox(lat, lon, 40.49, -74.27, 40.92, -73.68)) {
      const manhattan = inManhattan(lat, lon);
      if (manhattan) {
        const les = inBox(lat, lon, 40.709, -73.998, 40.727, -73.972);
        const chinatown = inBox(lat, lon, 40.711, -74.003, 40.72, -73.99);
        const soho = inBox(lat, lon, 40.716, -74.012, 40.7285, -73.996);
        const village = inBox(lat, lon, 40.7285, -74.012, 40.742, -73.975);
        const midtown = inBox(lat, lon, 40.742, -74.01, 40.766, -73.96);
        const fidi = lat < 40.716;
        const uptown = lat > 40.766;
        // (The map merges whole rows of houses into one footprint, so go by height, not size.)
        if (h < 22 && (village || uptown) && !midtown && !les) return r < 0.8 ? STYLE.brownstone : STYLE.tenement;
        if (soho && h < 45) return r < 0.72 ? STYLE.castiron : STYLE.tenement;
        if ((les || chinatown) && h < 32) return r < 0.85 ? STYLE.tenement : STYLE.postwar;
        if (village && h < 32) return r < 0.55 ? STYLE.tenement : r < 0.8 ? STYLE.prewar : STYLE.castiron;
        if (uptown && h < 70) return r < 0.7 ? STYLE.prewar : r < 0.85 ? STYLE.postwar : STYLE.tenement;
        if (h >= 70) return r < 0.5 ? STYLE.deco : r < 0.85 ? STYLE.office : STYLE.postwar;
        if (midtown || fidi) return h < 20 ? (r < 0.5 ? STYLE.tenement : STYLE.office) : r < 0.45 ? STYLE.office : r < 0.7 ? STYLE.prewar : r < 0.85 ? STYLE.deco : STYLE.postwar;
        return r < 0.4 ? STYLE.prewar : r < 0.7 ? STYLE.tenement : STYLE.postwar;
      }
      // Brooklyn, Queens, the Bronx: rowhouses and walk-ups, apartment blocks.
      if (h < 16) return r < 0.65 ? STYLE.brownstone : STYLE.tenement;
      if (h < 30) return r < 0.6 ? STYLE.tenement : STYLE.prewar;
      return r < 0.6 ? STYLE.postwar : STYLE.prewar;
    }
    // San Francisco.
    if (inBox(lat, lon, 37.70, -122.52, 37.82, -122.35)) {
      if (h < 16) return r < 0.7 ? STYLE.victorian : STYLE.stucco;
      return h > 60 ? (r < 0.6 ? STYLE.office : STYLE.deco) : r < 0.5 ? STYLE.prewar : STYLE.stucco;
    }
    // The West: stucco.
    if (lon < -110) return h < 20 ? STYLE.stucco : r < 0.5 ? STYLE.office : STYLE.postwar;
    // Other American downtowns.
    if (h >= 60) return r < 0.5 ? STYLE.office : r < 0.75 ? STYLE.deco : STYLE.postwar;
    if (h < 14) return r < 0.5 ? STYLE.brownstone : STYLE.tenement;
    return r < 0.4 ? STYLE.prewar : r < 0.7 ? STYLE.tenement : STYLE.office;
  }
  // ---- Europe & Middle East
  // Central London (Westminster, the West End, the City): Portland stone for most mid-rise blocks.
  if (region === 'gb' && inBox(lat, lon, 51.495, -0.19, 51.525, -0.07) && h >= 14 && h < 45) return r < 0.55 ? STYLE.portland : r < 0.85 ? STYLE.georgian : STYLE.office;
  // Amsterdam's canal ring and Jordaan: the map's heights include the gables, so the houses run taller.
  if (region === 'nl' && inBox(lat, lon, 52.355, 4.86, 52.385, 4.92) && h < 27) return STYLE.canal;
  switch (region) {
    case 'gb': return h < 18 ? (r < 0.6 ? STYLE.georgian : STYLE.stucco) : h < 40 ? (r < 0.5 ? STYLE.georgian : STYLE.office) : STYLE.office;
    case 'fr': return h < 40 ? (r < 0.85 ? STYLE.haussmann : STYLE.altbau) : STYLE.office;
    case 'nl': return h < 20 ? STYLE.canal : r < 0.5 ? STYLE.postwar : STYLE.office;
    case 'de': return h < 30 ? (r < 0.8 ? STYLE.altbau : STYLE.postwar) : r < 0.6 ? STYLE.postwar : STYLE.office;
    case 'south': return h < 32 ? STYLE.mediterranean : r < 0.5 ? STYLE.postwar : STYLE.office;
    case 'latin': return h < 30 ? (r < 0.8 ? STYLE.latin : STYLE.mediterranean) : r < 0.6 ? STYLE.latin : STYLE.postwar;
    case 'asia': return h < 50 ? (r < 0.85 ? STYLE.asiamodern : STYLE.postwar) : r < 0.7 ? STYLE.asiamodern : STYLE.office;
    case 'gulf': case 'levant': return h < 40 ? STYLE.levant : r < 0.5 ? STYLE.levant : STYLE.office;
    // ---- Asia-Pacific & Latin America: Victorian terraces, sandstone and buff-brick commercial blocks.
    case 'aus': return h < 13 ? (r < 0.7 ? STYLE.terrace : r < 0.85 ? STYLE.georgian : STYLE.stucco) : h < 40 ? (r < 0.4 ? STYLE.deco : r < 0.7 ? STYLE.office : STYLE.postwar) : STYLE.office;
    default: return h < 20 ? (r < 0.5 ? STYLE.altbau : STYLE.generic) : r < 0.5 ? STYLE.postwar : STYLE.generic;
  }
}

// ---------------------------------------------------------------------------------------------
// GLSL: the per-style parameters as an if-chain (generated from the table above).

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const lin = (c: number) => Number(Math.pow(c / 255, 2.2).toFixed(4));
const v3 = (c: RGB) => `vec3(${f(lin(c[0]))}, ${f(lin(c[1]))}, ${f(lin(c[2]))})`;

export function styleGlsl() {
  const lines: string[] = [];
  STYLES.forEach((s, i) => {
    lines.push(`${i ? 'else ' : ''}if (st < ${i}.5) {`,
      `  fMin = ${f(s.floor[0])}; fMax = ${f(s.floor[1])}; gMin = ${f(s.ground[0])}; gMax = ${f(s.ground[1])}; plinth = ${f(s.plinth)};`,
      `  bMin = ${f(s.bay[0])}; bMax = ${f(s.bay[1])}; wwMin = ${f(s.winW[0])}; wwMax = ${f(s.winW[1])}; whMin = ${f(s.winH[0])}; whMax = ${f(s.winH[1])};`,
      `  archP = ${f(s.arch)}; lintel = ${f(s.lintel)}; pier = ${f(s.pier)}; baseFloors = ${f(s.baseFloors)}; brick = ${f(s.brick)}; ribbon = ${f(s.ribbon)};`,
      `  shutters = ${f(s.shutters)}; balcony = ${f(s.balcony)}; mansard = ${f(s.mansard)}; sash = ${f(s.sash)}; ground0 = ${f(s.ground0)};`,
      `  frameC = ${v3(s.frame)}; trimC = ${v3(s.trim)}; baseC = ${v3(s.base)};`,
      '}');
  });
  return lines.join('\n');
}
