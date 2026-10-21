// The landmarks the world draws by hand instead of extruding their map footprint. Pure data (the chunk
// worker reads it too): where each one stands, which map buildings it replaces, and which builder
// makes its model. Adding a landmark = one entry here plus, if it needs a new shape, a builder.

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
  { id: 'plaza', name: 'The Plaza Hotel', addr: '768 Fifth Ave', lat: 40.764543, lon: -73.974468, zone: { r: 34 }, bearing: GRID, model: 'plaza', height: 76 },
  { id: 'dakota', name: 'The Dakota', addr: '1 W 72nd St', lat: 40.776557, lon: -73.976371, zone: { r: 32 }, bearing: GRID, model: 'dakota', height: 40 },
  { id: 'liberty', name: 'Statue of Liberty', addr: 'Liberty Island', lat: 40.689249, lon: -74.0445, zone: { r: 70 }, bearing: 0, model: 'liberty', height: 93 },
  { id: 'brooklyn', name: 'Brooklyn Bridge', addr: 'East River', lat: 40.706086, lon: -73.996864, zone: { w: 160, d: 760 }, claimMinH: 30, bearing: 137, model: 'brooklynBridge', height: 84, road: 'Brooklyn Bridge' },
  // ------------------------------------------------------------------ elsewhere
  { id: 'eiffel', name: 'Eiffel Tower', addr: 'Champ de Mars, Paris', lat: 48.85837, lon: 2.294481, zone: { r: 70 }, bearing: 46, model: 'eiffel', height: 330 },
  { id: 'bigben', name: 'Big Ben (Elizabeth Tower)', addr: 'Westminster, London', lat: 51.500729, lon: -0.124625, zone: { r: 9 }, bearing: 0, model: 'bigBen', height: 96 },
  { id: 'ggb', name: 'Golden Gate Bridge', addr: 'San Francisco', lat: 37.81855, lon: -122.47853, zone: { w: 220, d: 1700 }, claimMinH: 40, bearing: 352, model: 'goldenGate', height: 227, road: 'Golden Gate Bridge' },
  { id: 'transamerica', name: 'Transamerica Pyramid', addr: '600 Montgomery St, San Francisco', lat: 37.795193, lon: -122.402794, zone: { r: 30 }, claimMinH: 60, bearing: 0, model: 'transamerica', height: 260 },
  { id: 'tokyotower', name: 'Tokyo Tower', addr: 'Shiba Park, Minato', lat: 35.658581, lon: 139.745433, zone: { r: 50 }, bearing: 0, model: 'tokyoTower', height: 333 },
];

export const BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));
