import * as THREE from 'three';
import type { CityId } from '../../../shared/types.ts';
import type { SkyLook } from '../engine.ts';

export type WaterSide = 'north' | 'south' | 'east' | 'west';

export interface CityProfile {
  id: CityId;
  name: string;
  district: string;
  blurb: string;
  cols: number; // blocks along X
  rows: number; // blocks along Z
  blockW: number; // block size along X (m)
  blockD: number; // along Z
  avenueW: number; // roads running along Z (between columns)
  streetW: number; // roads running along X (between rows)
  /** Names for roads running along Z (index 0 = west) and along X (index 0 = south). */
  avenueNames: string[];
  streetNames: (i: number) => string;
  water: WaterSide[];
  /** Park blocks: [col0, row0, col1, row1] inclusive. */
  parks: [number, number, number, number][];
  /** Height peaks (in block coords) that make the skyline: [col, row, strength, radius]. */
  peaks: [number, number, number, number][];
  maxHeight: number;
  hills: number; // amplitude of rolling ground (m); SF only
  palette: { masonry: number[]; glass: number[]; ground: number; sidewalk: number; water: number };
  trees: 'oak' | 'palm' | 'mixed';
  taxiShare: number; // fraction of cars that are yellow cabs
  waterTowers: boolean;
  bridge: { side: WaterSide; color: number } | null;
  sky: SkyLook;
  thumb: [string, string];
}

const nycStreets = (i: number) => `${ordinal(i * 2 + 14)} St`;

export const CITIES: Record<CityId, CityProfile> = {
  nyc: {
    id: 'nyc', name: 'New York City', district: 'Midtown Manhattan', blurb: 'Avenues, yellow cabs, water towers.',
    cols: 9, rows: 14, blockW: 96, blockD: 62, avenueW: 22, streetW: 14,
    avenueNames: ['11th Ave', '10th Ave', '9th Ave', '8th Ave', '7th Ave', '6th Ave', '5th Ave', 'Madison Ave', 'Park Ave', 'Lexington Ave'],
    streetNames: nycStreets,
    water: ['west', 'east'],
    parks: [[2, 12, 6, 13]],
    peaks: [[5, 6, 1, 3.2], [6, 2, 0.8, 2.4], [3, 9, 0.65, 2.5]],
    maxHeight: 300, hills: 0,
    palette: { masonry: [0x8f857a, 0x7a6f66, 0xa39a8c, 0x6e5a4e, 0x9c8e7c, 0x5f5a55, 0xb4aa98], glass: [0x55606b, 0x3f4b57, 0x6a7681, 0x2f3a45], ground: 0x2b2b2e, sidewalk: 0x8d8a85, water: 0x203845 },
    trees: 'oak', taxiShare: 0.55, waterTowers: true, bridge: { side: 'east', color: 0x8a8f96 },
    sky: { turbidity: 6, rayleigh: 1.4, fogColorDay: new THREE.Color(0xb7c4d2), fogColorNight: new THREE.Color(0x14203a), fogDensity: 0.0011, sunAzimuth: 200, maxElevation: 52 },
    thumb: ['#f5c542', '#22314a'],
  },
  sf: {
    id: 'sf', name: 'San Francisco', district: 'Financial District', blurb: 'Hills, fog, and the bay.',
    cols: 9, rows: 9, blockW: 84, blockD: 84, avenueW: 18, streetW: 16,
    avenueNames: ['Van Ness Ave', 'Polk St', 'Larkin St', 'Hyde St', 'Leavenworth St', 'Jones St', 'Taylor St', 'Mason St', 'Powell St', 'Stockton St'],
    streetNames: (i) => ['Market St', 'Mission St', 'Ellis St', "O'Farrell St", 'Geary St', 'Post St', 'Sutter St', 'Bush St', 'Pine St', 'California St'][i] ?? `Street ${i}`,
    water: ['north', 'east'],
    parks: [[1, 1, 1, 1]],
    peaks: [[6, 5, 1, 2.4], [4, 3, 0.55, 2]],
    maxHeight: 280, hills: 26,
    palette: { masonry: [0xd8cfc0, 0xc9bca6, 0xe6ddd0, 0xb8a993, 0xd2c2b0, 0x9aa3a8], glass: [0x6d7f8f, 0x8796a3, 0x4f5f6e, 0x9fb0be], ground: 0x2e2e30, sidewalk: 0x9a968f, water: 0x2a4a5a },
    trees: 'mixed', taxiShare: 0.12, waterTowers: false, bridge: { side: 'north', color: 0xc0362c },
    sky: { turbidity: 9, rayleigh: 1.2, fogColorDay: new THREE.Color(0xc9d1d8), fogColorNight: new THREE.Color(0x14203a), fogDensity: 0.0019, sunAzimuth: 210, maxElevation: 55 },
    thumb: ['#c0362c', '#2a4a5a'],
  },
  miami: {
    id: 'miami', name: 'Miami', district: 'Brickell & Downtown', blurb: 'Glass towers, palms, Biscayne Bay.',
    cols: 8, rows: 10, blockW: 88, blockD: 76, avenueW: 20, streetW: 16,
    avenueNames: ['SW 4th Ave', 'SW 3rd Ave', 'SW 2nd Ave', 'SW 1st Ave', 'S Miami Ave', 'Brickell Ave', 'Brickell Bay Dr', 'Bayfront Dr', 'Bay Walk'],
    streetNames: (i) => `${i === 0 ? 'SE 1st' : `SE ${ordinal(i + 1)}`} St`,
    water: ['east', 'north'],
    parks: [[6, 8, 7, 9]],
    peaks: [[5, 4, 1, 2.6], [4, 8, 0.7, 2.2]],
    maxHeight: 260, hills: 0,
    palette: { masonry: [0xeeeae2, 0xf3efe6, 0xe0f0ef, 0xf6e9da, 0xdad7cf], glass: [0x5aa6b8, 0x3f8ea6, 0x7cc0cc, 0x4b7f9c, 0x91c9d3], ground: 0x323234, sidewalk: 0xc9c2b2, water: 0x1f6f80 },
    trees: 'palm', taxiShare: 0.1, waterTowers: false, bridge: null,
    sky: { turbidity: 4, rayleigh: 2.2, fogColorDay: new THREE.Color(0xbfdcec), fogColorNight: new THREE.Color(0x14203a), fogDensity: 0.0009, sunAzimuth: 170, maxElevation: 72 },
    thumb: ['#3fd0c9', '#ff7eb6'],
  },
  boston: {
    id: 'boston', name: 'Boston', district: 'Back Bay & Financial District', blurb: 'Brownstones, the Charles, a few big towers.',
    cols: 9, rows: 8, blockW: 80, blockD: 64, avenueW: 18, streetW: 16,
    avenueNames: ['Hereford St', 'Gloucester St', 'Fairfield St', 'Exeter St', 'Dartmouth St', 'Clarendon St', 'Berkeley St', 'Arlington St', 'Charles St', 'Tremont St'],
    streetNames: (i) => ['Huntington Ave', 'St James Ave', 'Boylston St', 'Newbury St', 'Commonwealth Ave', 'Marlborough St', 'Beacon St', 'Storrow Dr', 'Embankment Rd'][i] ?? `Street ${i}`,
    water: ['north'],
    parks: [[7, 3, 8, 5]],
    peaks: [[3, 1, 1, 1.6], [5, 0, 0.8, 1.6], [8, 1, 0.6, 1.5]],
    maxHeight: 230, hills: 0,
    palette: { masonry: [0x8a4b3a, 0x7a3f31, 0x9b5b45, 0x6e3b2e, 0xa8836a, 0x8f8578, 0xb59a7e], glass: [0x6f8796, 0x587080, 0x8aa0ae], ground: 0x2c2c2e, sidewalk: 0x8e7f74, water: 0x2b4552 },
    trees: 'oak', taxiShare: 0.08, waterTowers: false, bridge: { side: 'north', color: 0xd9dde2 },
    sky: { turbidity: 5, rayleigh: 1.6, fogColorDay: new THREE.Color(0xbac8d6), fogColorNight: new THREE.Color(0x14203a), fogDensity: 0.0012, sunAzimuth: 195, maxElevation: 50 },
    thumb: ['#8a4b3a', '#2b4552'],
  },
};

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
