import { WEST_LANDMARKS } from './west-catalog.ts';
// ---- Europe & Middle East
import { EU_LANDMARKS } from './eu-catalog.ts';
// ---- NYC
import { NYC_LANDMARKS } from './nyc-catalog.ts';

// The landmarks the world draws by hand instead of extruding their map footprint. Pure data (the chunk
// worker reads it too): where each one stands, which map buildings it replaces, and which builder
// makes its model. Adding a landmark = one entry here plus, if it needs a new shape, a builder.

import { APAC_LANDMARKS } from './apac-catalog.ts';

export interface Landmark {
  id: string;
  name: string;
  /** Street address for the look-at label. */
  addr: string;
  lat: number; lon: number;
  /**
   * Map buildings whose center falls in this zone are replaced (both detail tiers). A rectangle is
   * w meters across (east axis) by d meters along (north axis), turned by `bearing`; or a circle.
   */
  zone?: { w: number; d: number } | { r: number };
  /** Only replace parts at least this tall (keeps a low neighbor, e.g. Steinway Hall under 111 W 57th). */
  claimMinH?: number;
  /** Degrees clockwise from north of the model's north axis (Manhattan's avenues run at ~29°). */
  bearing: number;
  /** Builder key (see models.ts). */
  model: string;
  /** Total height in meters (for the far LOD, look-at hits and the minimum draw distance). */
  height: number;
  /** Bridges: the road name (a bridge's model runs along its bearing, fitted to the map's two towers). */
  road?: string;
  // ---- West Coast
  /** Stay at lat/lon even with claims (a pier taking over the buildings on it, not a bridge's towers). */
  keepPlace?: boolean;
}

/** Manhattan's street grid: avenues run 29° east of true north. */
export const GRID = 29;

export const LANDMARKS: Landmark[] = [
  // ------------------------------------------------------------------ New York
  { id: 'esb', name: 'Empire State Building', addr: '350 Fifth Ave', lat: 40.748441, lon: -73.985664, zone: { w: 118, d: 52 }, bearing: GRID, model: 'empire', height: 443 },
  { id: 'chrysler', name: 'Chrysler Building', addr: '405 Lexington Ave', lat: 40.751652, lon: -73.975311, zone: { w: 44, d: 54 }, bearing: GRID, model: 'chrysler', height: 319 },
  { id: 'owtc', name: 'One World Trade Center', addr: '285 Fulton St', lat: 40.712742, lon: -74.013382, zone: { r: 40 }, bearing: GRID, model: 'owtc', height: 541 },
  { id: 'flatiron', name: 'Flatiron Building', addr: '175 Fifth Ave', lat: 40.741061, lon: -73.989699, zone: { r: 26 }, bearing: GRID, model: 'flatiron', height: 87 },
  { id: 'rock30', name: '30 Rockefeller Plaza', addr: '30 Rockefeller Plaza', lat: 40.75902, lon: -73.97933, zone: { w: 96, d: 30 }, claimMinH: 20, bearing: GRID, model: 'rock30', height: 259 },
  { id: 'metlife', name: 'MetLife Building', addr: '200 Park Ave', lat: 40.753496, lon: -73.976436, zone: { w: 80, d: 34 }, claimMinH: 60, bearing: GRID, model: 'metlife', height: 246 },
  { id: 'gct', name: 'Grand Central Terminal', addr: '89 E 42nd St', lat: 40.752726, lon: -73.977229, zone: { r: 46 }, bearing: GRID, model: 'grandCentral', height: 38 },
  { id: 'nypl', name: 'New York Public Library', addr: '476 Fifth Ave', lat: 40.753182, lon: -73.982253, zone: { r: 40 }, bearing: GRID, model: 'nypl', height: 30 },
  { id: 'stpat', name: "St. Patrick's Cathedral", addr: '5th Ave & 50th St', lat: 40.758465, lon: -73.976048, zone: { r: 42 }, bearing: GRID, model: 'stPatricks', height: 101 },
  { id: 'woolworth', name: 'Woolworth Building', addr: '233 Broadway', lat: 40.712392, lon: -74.008424, zone: { r: 32 }, bearing: 30, model: 'woolworth', height: 241 },
  { id: 'park432', name: '432 Park Avenue', addr: '432 Park Ave', lat: 40.761615, lon: -73.971747, zone: { r: 20 }, claimMinH: 100, bearing: GRID, model: 'park432', height: 426 },
  { id: 'cpt', name: 'Central Park Tower', addr: '225 W 57th St', lat: 40.766358, lon: -73.98093, zone: { r: 28 }, claimMinH: 100, bearing: GRID, model: 'centralParkTower', height: 472 },
  { id: 'w57', name: '111 West 57th Street', addr: '111 W 57th St', lat: 40.764694, lon: -73.977389, zone: { w: 22, d: 46 }, claimMinH: 100, bearing: GRID, model: 'steinway', height: 435 },
  { id: 'vessel', name: 'The Vessel', addr: 'Hudson Yards', lat: 40.753825, lon: -74.002294, zone: { r: 14 }, bearing: GRID, model: 'vessel', height: 46 },
  { id: 'msg', name: 'Madison Square Garden', addr: '4 Pennsylvania Plaza', lat: 40.750504, lon: -73.993439, zone: { r: 40 }, bearing: GRID, model: 'msg', height: 46 },
  { id: 'plaza', name: 'The Plaza Hotel', addr: '768 Fifth Ave', lat: 40.764467, lon: -73.974483, zone: { w: 86, d: 66 }, claimMinH: 70, bearing: GRID, model: 'plaza', height: 76 },
  { id: 'dakota', name: 'The Dakota', addr: '1 W 72nd St', lat: 40.776557, lon: -73.976371, zone: { r: 32 }, bearing: GRID, model: 'dakota', height: 40 },
  { id: 'liberty', name: 'Statue of Liberty', addr: 'Liberty Island', lat: 40.689249, lon: -74.0445, zone: { r: 70 }, bearing: 0, model: 'liberty', height: 93 },
  { id: 'brooklyn', name: 'Brooklyn Bridge', addr: 'East River', lat: 40.706086, lon: -73.996864, zone: { w: 160, d: 760 }, claimMinH: 30, bearing: 137, model: 'brooklynBridge', height: 84, road: 'Brooklyn Bridge' },
  { id: 'apple5th', name: 'Apple Fifth Avenue', addr: '767 Fifth Ave', lat: 40.763841, lon: -73.97296, zone: { r: 7 }, bearing: GRID, model: 'appleCube', height: 10 },
  { id: 'gm', name: 'General Motors Building', addr: '767 Fifth Ave', lat: 40.763562, lon: -73.972307, zone: { r: 26 }, claimMinH: 100, bearing: GRID, model: 'gmBuilding', height: 214 },
  { id: 'channel', name: 'Channel Gardens', addr: 'Rockefeller Center', lat: 40.758366, lon: -73.977764, bearing: GRID, model: 'channelGardens', height: 2 },
  { id: 'washarch', name: 'Washington Square Arch', addr: 'Washington Square Park', lat: 40.731205, lon: -73.997065, zone: { r: 10 }, bearing: GRID, model: 'washArch', height: 23.5 },
  // ---- NYC: more New York landmarks (nyc-catalog.ts)
  ...NYC_LANDMARKS,
  // ------------------------------------------------------------------ Paris
  { id: 'arc', name: 'Arc de Triomphe', addr: "Place Charles de Gaulle, Paris", lat: 48.873792, lon: 2.295028, zone: { r: 28 }, bearing: 115, model: 'arcTriomphe', height: 50 },
  { id: 'louvre', name: 'Louvre Pyramid', addr: 'Cour Napoléon, Paris', lat: 48.861024, lon: 2.335851, zone: { r: 24 }, bearing: 25, model: 'louvrePyramid', height: 22 },
  { id: 'notredame', name: 'Notre-Dame de Paris', addr: 'Parvis Notre-Dame, Paris', lat: 48.852968, lon: 2.349902, zone: { w: 136, d: 52 }, bearing: 25, model: 'notreDame', height: 96 },
  // ------------------------------------------------------------------ elsewhere
  { id: 'colosseum', name: 'Colosseum', addr: 'Piazza del Colosseo, Rome', lat: 41.89021, lon: 12.492231, zone: { r: 80 }, bearing: 0, model: 'colosseum', height: 48 },
  { id: 'burj', name: 'Burj Khalifa', addr: 'Downtown Dubai', lat: 25.197139, lon: 55.274111, zone: { r: 70 }, claimMinH: 60, bearing: 0, model: 'burj', height: 828 },
  { id: 'opera', name: 'Sydney Opera House', addr: 'Bennelong Point, Sydney', lat: -33.857, lon: 151.2151, zone: { r: 95 }, bearing: 18, model: 'operaHouseSails', height: 67 },
  { id: 'eiffel', name: 'Eiffel Tower', addr: 'Champ de Mars, Paris', lat: 48.85837, lon: 2.294481, zone: { r: 70 }, bearing: 46, model: 'eiffel', height: 330 },
  { id: 'bigben', name: 'Big Ben (Elizabeth Tower)', addr: 'Westminster, London', lat: 51.500729, lon: -0.124625, zone: { r: 9 }, bearing: 0, model: 'bigBen', height: 96 },
  { id: 'ggb', name: 'Golden Gate Bridge', addr: 'San Francisco', lat: 37.8197, lon: -122.47861, zone: { w: 220, d: 1700 }, claimMinH: 40, bearing: 354.7, model: 'goldenGate', height: 227, road: 'Golden Gate Bridge' },
  { id: 'transamerica', name: 'Transamerica Pyramid', addr: '600 Montgomery St, San Francisco', lat: 37.795193, lon: -122.402794, zone: { r: 30 }, claimMinH: 20, bearing: 0, model: 'transamerica', height: 260 },
  { id: 'tokyotower', name: 'Tokyo Tower', addr: 'Shiba Park, Minato', lat: 35.658581, lon: 139.745433, zone: { r: 50 }, bearing: 0, model: 'tokyoTower', height: 333 },
  // ---- East US: Miami, Boston, Chicago, Washington, Toronto (models in east-models.ts)
  // South Beach lifeguard towers (OpenStreetMap emergency=lifeguard), facing the Atlantic.
  { id: 'sobe-lg0', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7656443, lon: -80.1307301, zone: { r: 6 }, bearing: 98, model: 'lifeguard0', height: 5 },
  { id: 'sobe-lg1', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7675435, lon: -80.1307372, zone: { r: 6 }, bearing: 98, model: 'lifeguard1', height: 5 },
  { id: 'sobe-lg2', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7691353, lon: -80.1307609, zone: { r: 6 }, bearing: 98, model: 'lifeguard2', height: 5 },
  { id: 'sobe-lg3', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.771366, lon: -80.1304069, zone: { r: 6 }, bearing: 98, model: 'lifeguard3', height: 5 },
  { id: 'sobe-lg4', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7728442, lon: -80.1301454, zone: { r: 6 }, bearing: 98, model: 'lifeguard4', height: 5 },
  { id: 'sobe-lg5', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7745211, lon: -80.1298511, zone: { r: 6 }, bearing: 98, model: 'lifeguard5', height: 5 },
  { id: 'sobe-lg6', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7760989, lon: -80.1293219, zone: { r: 6 }, bearing: 98, model: 'lifeguard0', height: 5 },
  { id: 'sobe-lg7', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7779745, lon: -80.1287412, zone: { r: 6 }, bearing: 98, model: 'lifeguard1', height: 5 },
  { id: 'sobe-lg8', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7801517, lon: -80.1283291, zone: { r: 6 }, bearing: 98, model: 'lifeguard2', height: 5 },
  { id: 'sobe-lg9', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7822507, lon: -80.1280921, zone: { r: 6 }, bearing: 98, model: 'lifeguard3', height: 5 },
  { id: 'sobe-lg10', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.783829, lon: -80.1278776, zone: { r: 6 }, bearing: 98, model: 'lifeguard4', height: 5 },
  { id: 'sobe-lg11', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7856029, lon: -80.1275621, zone: { r: 6 }, bearing: 98, model: 'lifeguard5', height: 5 },
  { id: 'sobe-lg12', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7876871, lon: -80.1273626, zone: { r: 6 }, bearing: 98, model: 'lifeguard0', height: 5 },
  { id: 'sobe-lg13', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7907536, lon: -80.1267611, zone: { r: 6 }, bearing: 98, model: 'lifeguard1', height: 5 },
  { id: 'sobe-lg14', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7923922, lon: -80.1265332, zone: { r: 6 }, bearing: 98, model: 'lifeguard2', height: 5 },
  { id: 'sobe-lg15', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7958142, lon: -80.1258907, zone: { r: 6 }, bearing: 98, model: 'lifeguard3', height: 5 },
  { id: 'sobe-lg16', name: 'Lifeguard Tower', addr: 'South Beach, Miami Beach', lat: 25.7994873, lon: -80.1251008, zone: { r: 6 }, bearing: 98, model: 'lifeguard4', height: 5 },
  { id: 'freedom', name: 'Freedom Tower', addr: '600 Biscayne Blvd, Miami', lat: 25.78, lon: -80.18972, zone: { r: 26 }, bearing: 0, model: 'freedomTower', height: 78 },
  { id: 'mastate', name: 'Massachusetts State House', addr: '24 Beacon St, Boston', lat: 42.35817, lon: -71.06369, zone: { r: 13 }, claimMinH: 24, bearing: 0, model: 'stateHouse', height: 47 },
  { id: 'clarendon', name: '200 Clarendon (John Hancock Tower)', addr: '200 Clarendon St, Boston', lat: 42.34926, lon: -71.07517, zone: { r: 42 }, claimMinH: 100, bearing: 0, model: 'clarendon', height: 241 },
  { id: 'cloudgate', name: 'Cloud Gate', addr: 'Millennium Park, Chicago', lat: 41.8827, lon: -87.62333, zone: { r: 14 }, bearing: 0, model: 'cloudGate', height: 10 },
  { id: 'marinacity', name: 'Marina City', addr: '300 N State St, Chicago', lat: 41.88775, lon: -87.6286, zone: { r: 55 }, claimMinH: 100, bearing: 0, model: 'marinaCity', height: 179 },
  { id: 'washmon', name: 'Washington Monument', addr: 'National Mall, Washington', lat: 38.88948, lon: -77.03528, zone: { r: 14 }, bearing: 0, model: 'washMonument', height: 169.3 },
  { id: 'capitol', name: 'United States Capitol', addr: 'First St SE, Washington', lat: 38.88986, lon: -77.00905, zone: { w: 140, d: 240 }, bearing: 0, model: 'capitol', height: 88 },
  { id: 'lincoln', name: 'Lincoln Memorial', addr: '2 Lincoln Memorial Cir NW, Washington', lat: 38.88927, lon: -77.05018, zone: { r: 40 }, bearing: 90, model: 'lincolnMemorial', height: 30 },
  { id: 'whitehouse', name: 'The White House', addr: '1600 Pennsylvania Ave NW, Washington', lat: 38.89768, lon: -77.03653, zone: { w: 54, d: 30 }, bearing: 0, model: 'whiteHouse', height: 21 },
  { id: 'cntower', name: 'CN Tower', addr: '290 Bremner Blvd, Toronto', lat: 43.642556, lon: -79.387083, zone: { r: 30 }, claimMinH: 30, bearing: 0, model: 'cnTower', height: 553 },
  // ---- Asia-Pacific & Latin America (apac-catalog.ts)
  ...APAC_LANDMARKS,
  // ---- West Coast (west-catalog.ts)
  ...WEST_LANDMARKS,
  // ---- Europe & Middle East
  ...EU_LANDMARKS,
];

export const BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));
