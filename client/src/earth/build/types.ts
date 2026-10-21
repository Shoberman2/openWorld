// What the chunk worker sends back: typed arrays (transferable) for meshes, plus plain data the main
// thread needs for physics, traffic, labels and project sites. All coordinates are chunk-local meters:
// x east from the tile's west edge, z south from its north edge, y up relative to the origin's ground.

import type { ParkOut } from './parks.ts';
import type { LandmarkClaim } from '../landmarks/zones.ts';

export interface ChunkJob {
  id: number;
  z: number; tx: number; ty: number;
  lod: 0 | 1;
  /** Local meters per mercator meter (GeoFrame.k). */
  k: number;
  /** Ground elevation at the origin (meters above sea level); y = elevation - e0. */
  e0: number;
  lat: number; // for regional style (palms, palettes)
  country: string;
}

export interface MeshData {
  pos: Float32Array;
  nrm?: Int8Array;
  uv?: Float32Array;
  col?: Uint8Array; // rgb
  fac?: Float32Array; // facade: u, v, wallLen (0 roof, -1 pitched roof, -2 gable), height
  seed?: Float32Array; // facade style seed (+2 = glass)
  idx?: Uint32Array;
}

export interface FootprintData {
  key: number; // stable across chunks for the same OSM building
  ring: number[]; // clockwise in x/z (outward normal = (-dz, dx)), chunk-local
  area: number;
  cx: number; cz: number;
  base: number; // ground y under the building (lowest corner)
  top: number; // roof y
  h: number; // height above base
  glass: boolean;
  color: number; // wall rgb hex
  roof: number; // roof rgb hex
  pitched: boolean;
  /** A named place inside (from the map's points of interest): "St. Patrick's Cathedral", class "place_of_worship". */
  poi?: { name: string; cls: string; sub: string };
  /** House number from the map (look-at label). */
  num?: string;
  /** Which of the chunk's building meshes (4x4 grid) holds it. */
  cell: number;
  /** Vertex range of this building inside the chunk's building mesh (to hide it when a project moves in). */
  start: number; count: number;
}

export interface EdgeData {
  a: string; b: string; // node keys (quantized mercator, shared across chunks)
  pts: number[]; // x,z pairs from a to b
  ys: number[]; // surface y per point
  width: number;
  lanesF: number; lanesB: number;
  cls: string;
  name: string | null;
  bridge: boolean;
  drive: boolean;
  walk: boolean;
}

export interface SignalData { key: string; x: number; y: number; z: number; phase: number; ref: number }

export interface ChunkOut {
  id: number;
  z: number; tx: number; ty: number; lod: 0 | 1;
  size: number;
  /** Ground height grid (n+1)² over the chunk, water beds already dipped. */
  n: number;
  heights: Float32Array;
  /** Water surface y per cell (m×m), NaN = dry. */
  wetN: number;
  wet: Float32Array;
  ground: MeshData;
  tex: ImageBitmap | null;
  water: MeshData | null;
  buildings: (MeshData | null)[];
  /** See-through ironwork: fire escapes (uv = meters along/up, color r = pattern). */
  iron: MeshData | null;
  footprints: FootprintData[];
  road: MeshData | null; // asphalt
  walk: MeshData | null; // sidewalks, paths, plazas
  paintW: MeshData | null; // white markings
  paintY: MeshData | null; // yellow markings
  deck: MeshData | null; // bridge decks + sides (concrete)
  /** Instances: [x, y, z, rotY, scale, kind] (kind: 0 broadleaf, 1 conifer, 2 palm). */
  trees: Float32Array;
  /** Park and wood trees, boulders and park walls (parks.ts). */
  parks: ParkOut;
  /** [x, y, z, rotY] */
  lamps: Float32Array;
  /** [x, y, z, rotY, signalIndex, group] */
  poles: Float32Array;
  /** [x, yBottom, z, height] */
  pillars: Float32Array;
  /** Street furniture [x, y, z, rotY, kind] (kind: 0 bench, 1 bin, 2 hydrant, 3 manhole, 4 mailbox). */
  props: Float32Array;
  /** Raised sidewalks, for walking on them: [ax, az, bx, bz, inner, outer] (centerline segment, offsets from it). */
  curbs: Float32Array;
  /** Foam and shallows along shorelines (uv: along the shore, across it; color r = strength). */
  shore: MeshData | null;
  signals: SignalData[];
  /** Map buildings handed to hand-built landmarks (landmarks/). */
  landmarks?: LandmarkClaim[];
  edges: EdgeData[];
  names: { name: string; pts: number[]; w: number }[];
  places: { name: string; cls: string; x: number; z: number; rank: number }[];
  stats: { buildings: number; roads: number; ms: number; verts: number };
}
