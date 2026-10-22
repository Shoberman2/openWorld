// West Coast landmarks (San Francisco, Los Angeles, Seattle, Las Vegas): pure data like catalog.ts
// (the chunk worker reads it too). Heights and positions from the buildings' published figures and
// the map's own footprints; the builders are in west-models.ts.
import type { Landmark } from './catalog.ts';

/** The Bay Bridge's west crossing runs 40° east of north (tower W2 to W6 on the map). */
export const BAY_BRIDGE_BEARING = 40.25;

export const WEST_LANDMARKS: Landmark[] = [
  // ------------------------------------------------------------------ San Francisco
  // 415 Mission St: 61 floors, roof 296 m, the open crown to 326 m (Pelli Clarke Pelli, 2018).
  { id: 'salesforce', name: 'Salesforce Tower', addr: '415 Mission St, San Francisco', lat: 37.78977, lon: -122.39690, zone: { r: 40 }, claimMinH: 150, bearing: 0, model: 'salesforceTower', height: 326 },
  // Telegraph Hill: a 64 m fluted concrete column (1933) on a low base, 11 m across.
  { id: 'coit', name: 'Coit Tower', addr: '1 Telegraph Hill Blvd, San Francisco', lat: 37.802372, lon: -122.405835, zone: { r: 14 }, bearing: 0, model: 'coitTower', height: 64 },
  // The Ferry Building (1898): a 200 m arcaded hall along the Embarcadero, its 75 m clock tower facing Market St.
  { id: 'ferry', name: 'Ferry Building', addr: '1 Ferry Building, San Francisco', lat: 37.795443, lon: -122.393604, zone: { w: 215, d: 56 }, bearing: 50, model: 'ferryBuilding', height: 75 },
  // San Francisco–Oakland Bay Bridge, west crossing (1936): two suspension bridges back to back (704 m main
  // spans, 160 m towers) meeting at the central anchorage. Drawn whole from here; the map's own tower
  // columns are handed over to the claim-only entries below.
  { id: 'baybridge', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.79819, lon: -122.377861, bearing: BAY_BRIDGE_BEARING, model: 'bayBridgeWest', height: 160, road: 'Bay Bridge' },
  { id: 'bb-w2', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.790753, lon: -122.385823, zone: { r: 24 }, claimMinH: 100, bearing: 0, model: 'none', height: 160 },
  { id: 'bb-w3', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.795587, lon: -122.380646, zone: { r: 24 }, claimMinH: 100, bearing: 0, model: 'none', height: 160 },
  { id: 'bb-w4', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.79819, lon: -122.377861, zone: { r: 50 }, claimMinH: 50, bearing: 0, model: 'none', height: 90 },
  { id: 'bb-w5', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.800787, lon: -122.37508, zone: { r: 24 }, claimMinH: 100, bearing: 0, model: 'none', height: 160 },
  { id: 'bb-w6', name: 'San Francisco–Oakland Bay Bridge', addr: 'Interstate 80, San Francisco Bay', lat: 37.805623, lon: -122.369899, zone: { r: 24 }, claimMinH: 100, bearing: 0, model: 'none', height: 160 },
  // ------------------------------------------------------------------ Seattle
  // 184 m (605 ft); the top house at 158 m, the waist at about 113 m, three pairs of legs (1962).
  { id: 'needle', name: 'Space Needle', addr: '400 Broad St, Seattle', lat: 47.620507, lon: -122.349352, zone: { r: 24 }, bearing: 0, model: 'spaceNeedle', height: 184 },
  // ------------------------------------------------------------------ Los Angeles
  // Mount Lee: nine sheet-metal letters 13.7 m tall, 107 m end to end, facing the city (1923/1978).
  { id: 'hollywood', name: 'Hollywood Sign', addr: 'Mount Lee, Los Angeles', lat: 34.134115, lon: -118.321548, bearing: 8, model: 'hollywoodSign', height: 14 },
  // Griffith Park (1935): white Art Deco, the planetarium's copper dome between two telescope domes.
  { id: 'griffith', name: 'Griffith Observatory', addr: '2800 E Observatory Rd, Los Angeles', lat: 34.11826, lon: -118.300352, zone: { r: 45 }, bearing: 0, model: 'griffith', height: 26 },
  // Wilshire Grand Center (2017): 73 floors, the sail crown and spire to 335 m. The map draws the whole
  // block 336 m tall, so it's rebuilt from the tower's own parts.
  { id: 'wilshire', name: 'Wilshire Grand Center', addr: '900 Wilshire Blvd, Los Angeles', lat: 34.050161, lon: -118.260164, zone: { r: 80 }, claimMinH: 30, bearing: 0, model: 'wilshireGrand', height: 335 },
  // Pacific Park on the Santa Monica Pier: the solar-powered Pacific Wheel, 26 m tall, turning north–south.
  { id: 'smwheel', name: 'Pacific Wheel', addr: 'Santa Monica Pier', lat: 34.008227, lon: -118.497834, zone: { r: 9 }, bearing: 0, model: 'none', height: 27 },
  // The pier itself (1909): the map has no deck, so it's drawn from its OpenStreetMap outline (way
  // 22728853) on pilings over the surf, the wheel on it. Placed at the water's level like a bridge.
  { id: 'smpier', name: 'Santa Monica Pier', addr: '200 Santa Monica Pier, Santa Monica', lat: 34.0089, lon: -118.4980, zone: { w: 80, d: 580 }, bearing: 228.7, model: 'santaMonicaPier', height: 27, road: 'Santa Monica Pier', keepPlace: true },
  // ------------------------------------------------------------------ Las Vegas
  // Luxor (1993): a 30-storey black-glass pyramid, 107 m tall on a 184 m base, the beam from its apex.
  { id: 'luxor', name: 'Luxor', addr: '3900 S Las Vegas Blvd, Las Vegas', lat: 36.095471, lon: -115.175805, zone: { r: 60 }, claimMinH: 60, bearing: 0, model: 'luxor', height: 107 },
  // The STRAT (1996): 350 m, the pod at 260–283 m on a three-legged shaft, the mast and rides above.
  { id: 'strat', name: 'The STRAT Tower', addr: '2000 S Las Vegas Blvd, Las Vegas', lat: 36.147631, lon: -115.156381, bearing: 0, model: 'stratTower', height: 350 },
  // Paris Las Vegas: the half-scale Eiffel Tower, 165 m.
  { id: 'pariseiffel', name: 'Eiffel Tower (Paris Las Vegas)', addr: '3655 S Las Vegas Blvd, Las Vegas', lat: 36.112411, lon: -115.171553, bearing: 0, model: 'parisEiffel', height: 165 },
  // The Fountains of Bellagio: jets in the 8-acre lake along the Strip.
  { id: 'bellagiofountains', name: 'Fountains of Bellagio', addr: '3600 S Las Vegas Blvd, Las Vegas', lat: 36.11265, lon: -115.17385, bearing: 0, model: 'bellagioFountains', height: 70 },
];
