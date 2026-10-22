// East US (and Toronto): the architecture of Miami, Boston, Chicago, Washington and Toronto, so they
// stop borrowing New York's brownstones and tenements. Pure data + a picker (the chunk worker runs it):
// four facade styles appended to facades.ts' table, which style each building gets by neighborhood,
// and Miami's / Toronto's lighter glass and cool white roofs.
//
// References: Miami Design Preservation League (Art Deco District: stucco in pastel and white, "eyebrow"
// sunshades over the windows, vertical fins and neon); Back Bay Architectural District guidelines (red
// brick and brownstone row houses with full-height bow fronts, low stoops); Chicago Landmarks (Chicago
// School: terra-cotta and brick frames, wide "Chicago windows"); DC Height of Buildings Act (a low,
// even skyline of limestone and brick); Toronto's glass-and-balcony condo towers.

import type { FacadeStyle } from '../build/facades.ts';

type RGB = [number, number, number];
const H = (...s: string[]) => s.map((x) => parseInt(x.slice(1), 16));

/** New facade styles (appended to the end of facades.ts STYLES; at most four). */
export const EAST_STYLES: (Partial<FacadeStyle> & { name: string })[] = [
  // South Beach Art Deco / MiMo: smooth stucco in pastels and white, a white eyebrow over every window
  // band (the geometry adds the projecting ledges), thin vertical fins, cafés at street level.
  { name: 'miamideco', floor: [3.0, 3.3], ground: [3.8, 4.3], bay: [1.7, 2.2], winW: [0.46, 0.56], winH: [0.46, 0.54], lintel: 0.2, pier: 0.3,
    walls: H('#f3c9cf', '#bfe4d6', '#a8d9e2', '#f6e4a2', '#dccde8', '#f7d3b2', '#f5f2ea', '#eeeae0', '#f9d9e4', '#cfe8e3'),
    trim: [248, 246, 240] as RGB, frame: [228, 236, 236] as RGB, base: [236, 232, 222] as RGB, ground0: 1, cornice: 0.12 },
  // The Brickell / Toronto condo tower: white slab edges and floor-to-ceiling glass behind a balcony on
  // every floor (the geometry adds the slabs and glass rails).
  { name: 'condo', floor: [3.0, 3.2], ground: [5.4, 6.4], bay: [2.8, 3.4], winW: [0.86, 0.9], winH: [0.68, 0.74], ribbon: 1,
    walls: H('#f3f3ef', '#ecebe6', '#e7e9e9', '#e0e4e5', '#f0ede4'), trim: [244, 244, 240] as RGB, frame: [196, 204, 208] as RGB, base: [222, 222, 218] as RGB,
    ground0: 2, cornice: 0.05 },
  // Back Bay / South End / Beacon Hill (and DC's and Toronto's brick Victorians): red brick row houses,
  // a brownstone basement, white sash windows with brownstone lintels, a full-height bow on each house.
  { name: 'bowfront', floor: [3.3, 3.7], ground: [0, 0], plinth: 1.3, bay: [1.5, 1.72], winW: [0.5, 0.58], winH: [0.6, 0.66], lintel: 1, brick: 1, sash: 1,
    walls: H('#8e3f2e', '#9a4a35', '#7f3a2c', '#a2533a', '#874232', '#93452f', '#7a4030'), trim: [196, 176, 150] as RGB, frame: [238, 236, 230] as RGB,
    base: [128, 92, 74] as RGB, ground0: 0, cornice: 0.45, corniceColor: [58, 50, 46] as RGB, stoop: 1, bayWindow: 1 },
  // Chicago School (the Loop): terra-cotta and brick frames, wide tripartite windows, a granite base.
  { name: 'chicagoschool', floor: [3.8, 4.3], ground: [5.0, 5.8], bay: [2.8, 3.3], winW: [0.72, 0.8], winH: [0.58, 0.66], lintel: 0.3, pier: 0.7, baseFloors: 1, brick: 0.4, sash: 1,
    walls: H('#e4ddcc', '#cdb48f', '#a8643f', '#8c5a44', '#c0b4a0', '#d9ceb6', '#b47a54'), trim: [224, 216, 200] as RGB, frame: [52, 54, 56] as RGB,
    base: [150, 140, 132] as RGB, ground0: 2, cornice: 0.4 },
];

const inBox = (lat: number, lon: number, s: number, w: number, n: number, e: number) => lat >= s && lat <= n && lon >= w && lon <= e;

/** Miami Beach's barrier island (South Beach to Mid-Beach). */
const miamiBeach = (lat: number, lon: number) => inBox(lat, lon, 25.765, -80.146, 25.83, -80.118);
const miamiMetro = (lat: number, lon: number) => inBox(lat, lon, 25.55, -80.5, 26.0, -80.11);
const toronto = (lat: number, lon: number) => inBox(lat, lon, 43.58, -79.64, 43.86, -79.12);

/**
 * The style name for a building in one of these cities, or null (not here). `h` height (m), `r` a
 * 0..1 hash for the building.
 */
export function eastStyle(country: string, lat: number, lon: number, h: number, r: number): string | null {
  if (country === 'ca') {
    if (!toronto(lat, lon)) return null;
    if (h >= 30) return r < 0.65 ? 'condo' : r < 0.9 ? 'office' : 'postwar';
    if (h < 14) return r < 0.5 ? 'bowfront' : r < 0.8 ? 'victorian' : 'georgian';
    return r < 0.4 ? 'prewar' : r < 0.7 ? 'postwar' : 'chicagoschool';
  }
  if (country !== 'us') return null;
  // ---- Miami
  if (miamiBeach(lat, lon)) {
    // South Beach's Art Deco District runs from 5th to 23rd Street; taller oceanfront hotels and condos are white.
    if (h < 26) return r < 0.82 ? 'miamideco' : 'stucco';
    return r < 0.75 ? 'condo' : 'miamideco';
  }
  if (miamiMetro(lat, lon)) {
    if (h >= 40) return r < 0.72 ? 'condo' : r < 0.9 ? 'office' : 'postwar';
    if (h < 14) return r < 0.45 ? 'stucco' : r < 0.75 ? 'miamideco' : 'mediterranean';
    return r < 0.5 ? 'miamideco' : r < 0.8 ? 'condo' : 'stucco';
  }
  // ---- Boston
  if (inBox(lat, lon, 42.2, -71.2, 42.45, -70.95)) {
    const backBay = inBox(lat, lon, 42.344, -71.095, 42.3535, -71.069);
    const southEnd = inBox(lat, lon, 42.334, -71.085, 42.3445, -71.064);
    const beaconHill = inBox(lat, lon, 42.3545, -71.074, 42.3605, -71.062);
    if ((backBay || southEnd || beaconHill) && h < 26) return beaconHill ? (r < 0.7 ? 'bowfront' : 'georgian') : r < 0.72 ? 'bowfront' : 'brownstone';
    if (h >= 60) return r < 0.5 ? 'office' : r < 0.75 ? 'postwar' : 'deco';
    if (h < 13) return r < 0.5 ? 'victorian' : r < 0.8 ? 'bowfront' : 'georgian';
    return r < 0.4 ? 'prewar' : r < 0.65 ? 'bowfront' : r < 0.85 ? 'office' : 'chicagoschool';
  }
  // ---- Chicago
  if (inBox(lat, lon, 41.64, -87.95, 42.07, -87.52)) {
    const loop = inBox(lat, lon, 41.872, -87.645, 41.892, -87.618);
    if (loop) return h >= 90 ? (r < 0.45 ? 'office' : r < 0.75 ? 'deco' : 'chicagoschool') : r < 0.55 ? 'chicagoschool' : r < 0.8 ? 'office' : 'deco';
    if (h >= 50) return r < 0.4 ? 'condo' : r < 0.7 ? 'office' : 'postwar';
    // Two-flats and three-flats: brick and greystone.
    if (h < 14) return r < 0.55 ? 'prewar' : r < 0.8 ? 'chicagoschool' : 'limestone';
    return r < 0.5 ? 'chicagoschool' : r < 0.8 ? 'prewar' : 'office';
  }
  // ---- Washington, D.C. (the Height Act keeps it low and even)
  if (inBox(lat, lon, 38.79, -77.12, 39.0, -76.9)) {
    const core = inBox(lat, lon, 38.882, -77.05, 38.905, -77.005);
    if (core) return r < 0.5 ? 'limestone' : r < 0.85 ? 'office' : 'prewar';
    if (h < 15) return r < 0.7 ? 'bowfront' : 'georgian';
    return r < 0.45 ? 'office' : r < 0.75 ? 'prewar' : 'limestone';
  }
  return null;
}

/** Glass towers' tint here (Miami's and Toronto's aqua-blue, low-iron glass), or null. */
export function eastGlass(country: string, lat: number, lon: number): number[] | null {
  if ((country === 'us' && miamiMetro(lat, lon)) || (country === 'ca' && toronto(lat, lon))) return [0x7fb0bf, 0x8cbccb, 0x6fa4b8, 0x9cc4cf, 0x78a8c4];
  return null;
}

/** Flat roofs: Miami's are white (cool roofs, white gravel), or null. */
export function eastFlatRoof(country: string, lat: number, lon: number): number | null {
  return country === 'us' && miamiMetro(lat, lon) ? 0xcfccc4 : null;
}

/** Glass towers that wear balconies (Miami's and Toronto's condos). */
export function eastGlassBalconies(country: string, lat: number, lon: number) {
  return (country === 'us' && miamiMetro(lat, lon)) || (country === 'ca' && toronto(lat, lon));
}

/**
 * The map gives most of South Beach's Deco hotels and Back Bay's row houses no height (5 m, one
 * floor). Untagged buildings big enough to be one get their real three to four (Deco) or four to five
 * (Back Bay) stories.
 */
export function eastHeight(country: string, lat: number, lon: number, h: number, minH: number, area: number, seed: number): number {
  if (h > 5.5 || minH > 0 || area < 90 || country !== 'us') return h;
  if (inBox(lat, lon, 25.765, -80.146, 25.795, -80.125)) return area < 160 ? 7.5 + seed * 3 : 10.2 + seed * 4.2;
  if (inBox(lat, lon, 42.334, -71.095, 42.3605, -71.062)) return 13.5 + seed * 4;
  return h;
}
