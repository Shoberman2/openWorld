// Asia-Pacific and Latin American landmarks (pure data, the chunk worker reads it too). Positions,
// footprints and bearings are taken from OpenStreetMap; heights and proportions from the buildings'
// published figures (see each builder in apac-models.ts).
import type { Landmark } from './catalog.ts';


/**
 * Copacabana's beachfront promenade (the Calçadão, OpenStreetMap way 42292908), lat/lon pairs. It's
 * laid in pieces of a few hundred meters so each piece sits on its own stretch of ground.
 */
export const COPA_PTS = [
  -22.965132, -43.172952, -22.965390, -43.173481, -22.965743, -43.174292, -22.965935, -43.174712, -22.966171, -43.175224, -22.966709, -43.176341,
  -22.967149, -43.177177, -22.967332, -43.177521, -22.967560, -43.177917, -22.967824, -43.178384, -22.968265, -43.179169, -22.968525, -43.179603,
  -22.969015, -43.180390, -22.969338, -43.180909, -22.969750, -43.181530, -22.970049, -43.181974, -22.970325, -43.182382, -22.970612, -43.182771,
  -22.970865, -43.183103, -22.971254, -43.183573, -22.971585, -43.183959, -22.971882, -43.184302, -22.972250, -43.184686, -22.972623, -43.185055,
  -22.973316, -43.185669, -22.973941, -43.186173, -22.974312, -43.186450, -22.974804, -43.186805, -22.975192, -43.187071, -22.975528, -43.187283,
  -22.976089, -43.187597, -22.976996, -43.188082, -22.977600, -43.188373, -22.978398, -43.188687, -22.979113, -43.188944, -22.979885, -43.189174,
  -22.980642, -43.189353, -22.981253, -43.189478, -22.981855, -43.189549, -22.982358, -43.189562, -22.982787, -43.189535, -22.983306, -43.189475,
  -22.983847, -43.189347, -22.985033, -43.188971, -22.985394, -43.188856, -22.986017, -43.188659, -22.986069, -43.188623,
];
export const COPA_PIECES = 8;
/** The point range [i0, i1] of piece k. */
export function copaPiece(k: number) {
  const n = COPA_PTS.length / 2, per = Math.ceil((n - 1) / COPA_PIECES);
  return [k * per, Math.min(n - 1, (k + 1) * per)];
}

export const APAC_LANDMARKS: Landmark[] = [
  // ------------------------------------------------------------------ Tokyo
  // The Shibuya scramble: the zebra crossings painted in every direction (stripes only, no claim).
  { id: 'shibuya', name: 'Shibuya Scramble Crossing', addr: 'Dogenzaka, Shibuya', lat: 35.659510, lon: 139.700500, bearing: 0, model: 'shibuyaScramble', height: 1 },
  { id: 'skytree', name: 'Tokyo Skytree', addr: '1-1-2 Oshiage, Sumida', lat: 35.710046, lon: 139.810714, zone: { r: 40 }, claimMinH: 60, bearing: 0, model: 'skytree', height: 634 },
  // ------------------------------------------------------------------ Sydney
  { id: 'harbourbridge', name: 'Sydney Harbour Bridge', addr: 'Bradfield Highway, Sydney', lat: -33.852285, lon: 151.210643, zone: { w: 90, d: 680 }, claimMinH: 40, bearing: 27.5, model: 'harbourBridge', height: 134, road: 'Bradfield Highway' },
  { id: 'sydtower', name: 'Sydney Tower Eye', addr: '100 Market St, Sydney', lat: -33.870495, lon: 151.208948, zone: { r: 9 }, claimMinH: 80, bearing: 0, model: 'sydneyTower', height: 309 },
  // ------------------------------------------------------------------ Hong Kong
  { id: 'boc', name: 'Bank of China Tower', addr: '1 Garden Rd, Central', lat: 22.279268, lon: 114.161569, zone: { r: 36 }, claimMinH: 40, bearing: 15.9, model: 'bocTower', height: 367 },
  { id: 'ifc2', name: 'Two International Finance Centre', addr: '8 Finance St, Central', lat: 22.285298, lon: 114.159277, zone: { r: 36 }, claimMinH: 80, bearing: 30, model: 'ifc2', height: 416 },
  // ------------------------------------------------------------------ Shanghai
  { id: 'pearl', name: 'Oriental Pearl Tower', addr: '1 Century Ave, Pudong', lat: 31.241897, lon: 121.495267, zone: { r: 60 }, bearing: 0, model: 'orientalPearl', height: 468 },
  { id: 'shtower', name: 'Shanghai Tower', addr: '501 Yincheng Middle Rd, Pudong', lat: 31.235596, lon: 121.501291, zone: { r: 52 }, claimMinH: 80, bearing: 0, model: 'shanghaiTower', height: 632 },
  { id: 'jinmao', name: 'Jin Mao Tower', addr: '88 Century Ave, Pudong', lat: 31.237261, lon: 121.501405, zone: { r: 30 }, claimMinH: 80, bearing: 0, model: 'jinMao', height: 420.5 },
  { id: 'swfc', name: 'Shanghai World Financial Center', addr: '100 Century Ave, Pudong', lat: 31.236575, lon: 121.503015, zone: { r: 40 }, claimMinH: 80, bearing: -5, model: 'swfc', height: 492 },
  // ------------------------------------------------------------------ Singapore
  { id: 'mbs', name: 'Marina Bay Sands', addr: '10 Bayfront Ave, Singapore', lat: 1.283589, lon: 103.860692, zone: { w: 120, d: 300 }, claimMinH: 60, bearing: 23, model: 'marinaBaySands', height: 200 },
  { id: 'supertrees', name: 'Supertree Grove', addr: 'Gardens by the Bay, Singapore', lat: 1.282067, lon: 103.864002, bearing: 0, model: 'supertrees', height: 50 },
  // ------------------------------------------------------------------ Seoul, Taipei
  { id: 'lotte', name: 'Lotte World Tower', addr: '300 Olympic-ro, Songpa-gu, Seoul', lat: 37.512542, lon: 127.102655, zone: { r: 42 }, claimMinH: 60, bearing: 0, model: 'lotteTower', height: 555 },
  { id: 'taipei101', name: 'Taipei 101', addr: '7 Xinyi Rd Sec. 5, Taipei', lat: 25.033937, lon: 121.564619, zone: { r: 38 }, claimMinH: 60, bearing: 1.2, model: 'taipei101', height: 508 },
  // ------------------------------------------------------------------ Rio de Janeiro, Mexico City
  { id: 'cristo', name: 'Christ the Redeemer', addr: 'Corcovado, Rio de Janeiro', lat: -22.951917, lon: -43.210459, zone: { r: 14 }, bearing: 95, model: 'cristo', height: 38 },
  ...Array.from({ length: COPA_PIECES }, (_, k): Landmark => {
    const [i0, i1] = copaPiece(k), m = Math.round((i0 + i1) / 2);
    return { id: `copa${k}`, name: 'Copacabana Promenade', addr: 'Avenida Atlântica, Copacabana', lat: COPA_PTS[m * 2], lon: COPA_PTS[m * 2 + 1], bearing: 0, model: `copaWaves${k}`, height: 1 };
  }),
  { id: 'latino', name: 'Torre Latinoamericana', addr: 'Eje Central Lázaro Cárdenas 2, Centro', lat: 19.433866, lon: -99.140611, zone: { r: 24 }, claimMinH: 30, bearing: 8.1, model: 'torreLatino', height: 182 },
  { id: 'zocaloflag', name: 'Zócalo Flag', addr: 'Plaza de la Constitución, Centro', lat: 19.432608, lon: -99.133209, zone: { r: 3 }, bearing: 90, model: 'zocaloFlag', height: 50 },
  { id: 'cdmxcathedral', name: 'Metropolitan Cathedral', addr: 'Plaza de la Constitución, Centro', lat: 19.434438, lon: -99.133058, zone: { w: 80, d: 140 }, bearing: 7.7, model: 'cdmxCathedral', height: 67 },
];
