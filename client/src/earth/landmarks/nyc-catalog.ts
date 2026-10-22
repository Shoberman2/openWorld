// More New York landmarks (pure data, the chunk worker reads it too). Positions are the map's own parts
// (OpenMapTiles building parts, probed in game) or Wikipedia / OSM coordinates; builders in nyc-models.ts.
import type { Landmark } from './catalog.ts';

const G = 29; // Manhattan's grid bearing (see catalog.ts GRID)

export const NYC_LANDMARKS: Landmark[] = [
  // The map has a plain box on five stilt parts; the model brings the 45° crown, the open corners and the bands.
  { id: 'citigroup', name: 'Citigroup Center', addr: '601 Lexington Ave', lat: 40.758401, lon: -73.970245, zone: { r: 26 }, claimMinH: 30, bearing: G, model: 'citigroup', height: 279 },
  { id: 'hy30', name: '30 Hudson Yards (Edge)', addr: '30 Hudson Yards', lat: 40.754, lon: -74.00075, zone: { r: 45 }, claimMinH: 280, bearing: G, model: 'hy30', height: 395 },
  { id: 'vanderbilt', name: 'One Vanderbilt', addr: '1 Vanderbilt Ave', lat: 40.753, lon: -73.97845, zone: { r: 45 }, claimMinH: 100, bearing: G, model: 'vanderbilt', height: 427 },
  { id: 'bofa', name: 'Bank of America Tower', addr: '1 Bryant Park', lat: 40.75545, lon: -73.9845, zone: { r: 45 }, claimMinH: 150, bearing: G, model: 'bofa', height: 366 },
  { id: 'hearst', name: 'Hearst Tower', addr: '300 W 57th St', lat: 40.766573, lon: -73.983642, zone: { r: 20 }, claimMinH: 100, bearing: G, model: 'hearst', height: 182 },
  { id: 'seagram', name: 'Seagram Building', addr: '375 Park Ave', lat: 40.758421, lon: -73.972095, zone: { r: 30 }, claimMinH: 100, bearing: G, model: 'seagram', height: 157 },
  { id: 'lever', name: 'Lever House', addr: '390 Park Ave', lat: 40.759695, lon: -73.972931, zone: { r: 20 }, claimMinH: 60, bearing: G, model: 'lever', height: 94 },
  { id: 'guggenheim', name: 'Solomon R. Guggenheim Museum', addr: '1071 Fifth Ave', lat: 40.7829, lon: -73.959, zone: { r: 30 }, bearing: G, model: 'guggenheim', height: 42 },
  // The map has it as one plain 250 m prism; the stacked, cantilevered floors are the whole point.
  { id: 'leonard56', name: '56 Leonard Street', addr: '56 Leonard St', lat: 40.717584, lon: -74.006241, zone: { r: 24 }, claimMinH: 100, bearing: G, model: 'leonard56', height: 250 },
  { id: 'oculus', name: 'The Oculus (WTC Transportation Hub)', addr: '185 Greenwich St', lat: 40.711558, lon: -74.011426, zone: { r: 30 }, claimMinH: 20, bearing: G, model: 'oculus', height: 50 },
  // Bridges: both have their towers in the map as plain ~100 m boxes; the model spans between them. The
  // Williamsburg's center and bearing are OSM's centerline (40.71357, -73.97170, 112° Manhattan → Brooklyn).
  { id: 'manhattanbr', name: 'Manhattan Bridge', addr: 'East River', lat: 40.706964, lon: -73.990469, zone: { w: 70, d: 520 }, claimMinH: 60, bearing: 157, model: 'manhattanBridge', height: 102, road: 'Manhattan Bridge' },
  // Queensboro: the map's piers are four ~110 m boxes; claimed, they place the truss (bearing 119.8°).
  { id: 'queensborobr', name: 'Queensboro Bridge', addr: 'East River at 59th St', lat: 40.756049, lon: -73.95262, zone: { w: 60, d: 960 }, claimMinH: 90, bearing: 119.8, model: 'queensboroBridge', height: 115, road: 'Queensboro Bridge' },
  { id: 'williamsburgbr', name: 'Williamsburg Bridge', addr: 'East River', lat: 40.71357, lon: -73.9717, zone: { w: 90, d: 640 }, claimMinH: 60, bearing: 112, model: 'williamsburgBridge', height: 102, road: 'Williamsburg Bridge' },
];
