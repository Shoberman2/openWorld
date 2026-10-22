// Asia-Pacific and Latin American landmark models (catalog: apac-catalog.ts). Same model frame as
// models.ts: y up from the ground, x along the landmark's east axis, z along its south axis.
// Proportions come from the published figures (heights, spans, deck levels); the notes on each
// builder say which.
import * as THREE from 'three';
import { area, built, chamfer, merged, ngon, nightMats, placed, prism, rect, solidMat, type Built } from './kit.ts';
import type { BuildCtx } from './models.ts';
import { COPA_PIECES, COPA_PTS, copaPiece } from './apac-catalog.ts';

type Builder = (c: BuildCtx) => Built;

// ------------------------------------------------------------------ helpers

const TAU = Math.PI * 2;
const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function add(b: Built, g: THREE.BufferGeometry, m: THREE.Material, detail = false, solid?: { ring: number[]; y0: number; y1: number }) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true; x.receiveShadow = true;
  b.group.add(x);
  if (detail) b.detail.push(x);
  if (solid) b.solids.push(solid);
  return x;
}

/** Model-frame offset (m) of (lat, lon) from (lat0, lon0) for a landmark turned by `bearing`. */
function geoOff(lat0: number, lon0: number, lat: number, lon: number, bearing = 0) {
  const E = (lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180), S = -(lat - lat0) * 110_574;
  const b = (bearing * Math.PI) / 180;
  return { x: E * Math.cos(b) + S * Math.sin(b), z: -E * Math.sin(b) + S * Math.cos(b) };
}

/** Smooth walls through successive rings (same vertex count), UV'd in meters of `tile`. */
function loftS(levels: { ring: number[]; y: number }[], tile: [number, number] = [4, 4], cap = true): THREE.BufferGeometry {
  const n = levels[0].ring.length / 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const L of levels) {
    let u = 0;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      if (i > 0) { const p = (i - 1) % n; u += Math.hypot(L.ring[k * 2] - L.ring[p * 2], L.ring[k * 2 + 1] - L.ring[p * 2 + 1]); }
      pos.push(L.ring[k * 2], L.y, L.ring[k * 2 + 1]);
      uv.push(u / tile[0], L.y / tile[1]);
    }
  }
  const ccw = area(levels[0].ring) > 0;
  for (let L = 0; L + 1 < levels.length; L++) for (let i = 0; i < n; i++) {
    const a0 = L * (n + 1) + i, a1 = a0 + 1, b0 = (L + 1) * (n + 1) + i, b1 = b0 + 1;
    if (ccw) idx.push(a0, b1, a1, a0, b0, b1); else idx.push(a0, a1, b1, a0, b1, b0);
  }
  if (cap) {
    const top = levels[levels.length - 1];
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(top.ring[i * 2], top.ring[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const base = pos.length / 3;
    for (const p of pts) { pos.push(p.x, top.y, p.y); uv.push(p.x / 8, p.y / 8); }
    for (const [a, c, d] of tris) {
      const ny = (pts[d].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[d].y - pts[a].y);
      if (ny > 0) idx.push(base + a, base + c, base + d); else idx.push(base + a, base + d, base + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A box beam from a to b (w across, h up). */
function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h = w) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const dir = b.clone().sub(a).normalize();
  const up = Math.abs(dir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(a, b, up);
  m.setPosition(a.add(b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

/** A surface of revolution from a (radius, y) profile. */
function lathe(profile: [number, number][], seg = 32) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg);
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** A material that glows at night (pushed to the layer's night list). */
function nightMat(key: string, o: THREE.MeshStandardMaterialParameters, glow: number, day = 0) {
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ emissiveIntensity: day, ...o });
  m.userData.glow = glow; m.userData.day = day;
  nightMats.push(m);
  matCache.set(key, m);
  return m;
}

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

interface CurtainOpts {
  /** Glass top and bottom gradient. */
  glass: [string, string];
  frame: string;
  /** Cells (bays, floors) in one texture tile; the tile spans `tile` meters. */
  cells: [number, number];
  tile: [number, number];
  /** Mullion and spandrel thickness as a fraction of a cell. */
  mull: number;
  span: number;
  rough?: number; metal?: number;
  lit?: number; glowColor?: number;
  /** Extra drawing over the whole tile (day and night). */
  over?: (g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) => void;
}

/** A glass curtain wall: mullions, spandrels, a little sky in the panes; random lit offices at night. */
function curtain(key: string, o: CurtainOpts) {
  let m = matCache.get(key);
  if (m) return { mat: m, tile: o.tile };
  const W = 256, H = 256, [cx, cy] = o.cells, cw = W / cx, ch = H / cy;
  const paint = (lit: boolean) => (g: CanvasRenderingContext2D) => {
    g.fillStyle = lit ? '#000' : o.frame; g.fillRect(0, 0, W, H);
    for (let r = 0; r < cy; r++) for (let c = 0; c < cx; c++) {
      const x = c * cw + cw * o.mull / 2, y = r * ch + ch * o.span, w = cw * (1 - o.mull), h = ch * (1 - o.span);
      if (lit) {
        if (rnd(r * 31 + c * 7 + key.length) < (o.lit ?? 0.35)) { g.fillStyle = `hsl(${40 + rnd(r + c * 3) * 12}, 70%, ${62 + rnd(c + r * 5) * 18}%)`; g.fillRect(x, y, w, h); }
        continue;
      }
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, o.glass[0]); grd.addColorStop(1, o.glass[1]);
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = `rgba(255,255,255,${0.04 + rnd(r * 5 + c) * 0.08})`; g.fillRect(x, y, w, h * 0.35);
    }
    o.over?.(g, W, H, lit);
  };
  m = new THREE.MeshStandardMaterial({
    map: canvasTex(W, H, paint(false)), roughness: o.rough ?? 0.15, metalness: o.metal ?? 0.55,
    emissive: new THREE.Color(o.glowColor ?? 0xffe2b0), emissiveMap: canvasTex(W, H, paint(true)), emissiveIntensity: 0,
  });
  m.userData.glow = 1.4;
  nightMats.push(m);
  matCache.set(key, m);
  return { mat: m, tile: o.tile };
}

/** Dressed stone: coursed blocks with fine joints (granite pylons, cantera stone). */
function stone(key: string, base: string, joint: string, tile: [number, number] = [6, 6], rough = 0.85) {
  let m = matCache.get(key);
  if (m) return { mat: m, tile };
  const W = 128, H = 128;
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = (r * H) / rows;
      g.fillStyle = joint; g.fillRect(0, y, W, 1.5);
      const off = r % 2 ? W / 6 : 0;
      for (let x = off; x < W; x += W / 3) g.fillRect(x, y, 1.5, H / rows);
      for (let k = 0; k < 3; k++) { g.fillStyle = `rgba(0,0,0,${rnd(r * 9 + k) * 0.07})`; g.fillRect((k * W) / 3 + off, y + 1.5, W / 3, H / rows - 1.5); }
    }
  });
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: 0 });
  matCache.set(key, m);
  return { mat: m, tile };
}

/** Steel lattice (alpha-tested, both sides) in a color, glowing `night` after dark. */
function lattice(key: string, color: number, night: number, nightGlow = 0.8) {
  let m = matCache.get(key);
  if (m) return m;
  const tex = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
    g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.stroke();
  });
  tex.colorSpace = THREE.NoColorSpace;
  m = new THREE.MeshStandardMaterial({ color, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.3, emissive: night, emissiveMap: tex, emissiveIntensity: 0 });
  m.userData.glow = nightGlow; m.userData.day = 0;
  nightMats.push(m);
  matCache.set(key, m);
  return m;
}

/** A prism in a tiled material, recorded as a solid. */
function block(b: Built, ring: number[], y0: number, y1: number, m: { mat: THREE.Material; tile: [number, number] }, solid = true, cap = true) {
  const x = add(b, prism(ring, y0, y1, m.tile, cap), m.mat);
  if (solid) b.solids.push({ ring, y0, y1 });
  return x;
}

// ------------------------------------------------------------------ Tokyo

/**
 * The Shibuya scramble: the zebra crossings of the five-way junction outside Hachikō exit, on the
 * crosswalk lines mapped in OpenStreetMap, plus the second diagonal that makes the X.
 */
const SHIBUYA_C = { lat: 35.659510, lon: 139.700500 };
const SHIBUYA_WALKS: [number, number, number, number, number][] = [
  [35.659603, 139.700243, 35.659446, 139.700205, 9], // west (Dogenzaka side, toward 109)
  [35.659603, 139.700243, 35.659614, 139.700450, 9], // north (Center-gai / Q-Front side)
  [35.659358, 139.700335, 35.659317, 139.700574, 9], // south (Hachikō side)
  [35.659387, 139.700754, 35.659534, 139.700780, 8], // east (station side)
  [35.659672, 139.700552, 35.659645, 139.700715, 7], // north-east (Koen-dori / Meiji-dori)
  [35.659377, 139.700656, 35.659618, 139.700463, 7], // diagonal, Hachikō to Q-Front
  [35.659395, 139.700300, 35.659650, 139.700590, 7], // the other diagonal
];

const shibuyaScramble: Builder = () => {
  const b = built();
  const pos: number[] = [];
  const quad = (p: number[][]) => { for (const k of [0, 2, 1, 0, 3, 2]) pos.push(p[k][0], p[k][1], p[k][2]); };
  SHIBUYA_WALKS.forEach(([la0, lo0, la1, lo1, w], wi) => {
    const A = geoOff(SHIBUYA_C.lat, SHIBUYA_C.lon, la0, lo0), B = geoOff(SHIBUYA_C.lat, SHIBUYA_C.lon, la1, lo1);
    const len = Math.hypot(B.x - A.x, B.z - A.z), dx = (B.x - A.x) / len, dz = (B.z - A.z) / len, rx = -dz, rz = dx;
    // The diagonals cross over each other's stripes: lift one a hair so they don't flicker.
    const y = 0.2 + wi * 0.004;
    // Japanese crossings: 45 cm bars, 45 cm gaps, running the length of the crossing.
    for (let s = 0.6; s < len - 0.4; s += 0.9) {
      const ax = A.x + dx * s, az = A.z + dz * s, bx = ax + dx * 0.45, bz = az + dz * 0.45;
      quad([[ax - rx * w / 2, y, az - rz * w / 2], [bx - rx * w / 2, y, bz - rz * w / 2], [bx + rx * w / 2, y, bz + rz * w / 2], [ax + rx * w / 2, y, az + rz * w / 2]]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const m = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  b.group.add(mesh);
  return b;
};

/**
 * Tokyo Skytree (634 m): a three-legged steel lattice, an equilateral triangle about 68 m a side at
 * the ground that rounds into a circle by ~320 m; Tembo Deck at 350 m, Tembo Galleria at 450 m,
 * the roof at 495 m and the gain-tower mast above. Painted "Skytree White" (a pale blue-white).
 */
function triCircle(s: number, k: number, n = 48, rot = -Math.PI / 2) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * TAU;
    const seg = TAU / 3, local = ((((t - rot) % seg) + seg) % seg) - seg / 2;
    const rTri = (s * 0.5) / Math.cos(local);
    // Slightly bowed sides (the "sori" curve) rather than dead straight.
    const r = rTri * (1 - k) * (1 - 0.04 * Math.cos(local * 3)) + s * k;
    out.push(Math.cos(t) * r, Math.sin(t) * r);
  }
  return out;
}

const skytree: Builder = () => {
  const b = built();
  const white = 0xe9f0f4;
  const latt = lattice('st-latt', white, 0x8fd6ff, 0.9);
  const core = solidMat('st-core', 0xdfe6ea, 0.6, 0.15);
  const prof: [number, number, number][] = [[0, 39, 0], [30, 35, 0.08], [80, 29, 0.25], [150, 23.5, 0.45], [230, 19, 0.7], [300, 16.5, 0.92], [335, 16, 1], [440, 13.5, 1], [455, 12.5, 1], [495, 9, 1]];
  const lv = (scale: number) => prof.map(([y, s, k]) => ({ ring: triCircle(s * scale, k), y }));
  add(b, loftS(lv(1), [6, 6], false), latt);
  add(b, loftS(lv(1.004).map((l, i) => ({ ring: l.ring, y: l.y + (i ? 3 : 0) })), [4.5, 4.5], false), latt, true);
  // A dense inner body so it reads solid from afar, and the central concrete column.
  add(b, loftS(lv(0.62), [8, 8], true), core);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * TAU;
    b.solids.push({ ring: rect(14, 14, Math.cos(a) * 30, Math.sin(a) * 30), y0: 0, y1: 60 });
  }
  b.solids.push({ ring: ngon(12, 17), y0: 0, y1: 495 });
  // Tembo Deck: three stacked glass rings over a flared underside.
  const glass = nightMat('st-glass', { color: 0x2c3e52, roughness: 0.08, metalness: 0.75, emissive: 0xfff0d0 }, 1.2, 0.05);
  const frame = solidMat('st-frame', white, 0.45, 0.3);
  add(b, lathe([[16, 330], [21, 340], [23, 341]], 48), frame);
  add(b, lathe([[23, 341], [23.5, 345.5], [22.5, 346.5], [24, 351], [23, 352]], 48), glass);
  add(b, lathe([[23, 352], [22, 353], [21.2, 357], [16, 360]], 48), frame);
  b.solids.push({ ring: ngon(16, 23.5), y0: 330, y1: 360 });
  // Tembo Galleria: the glass ring with the spiral ramp, at 445–451 m.
  add(b, lathe([[13.5, 438], [18, 445], [18.6, 448], [18, 452], [13, 456]], 48), glass);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    add(b, beam(Math.cos(a) * 18.7, 444.5 + (k % 2) * 0.2, Math.sin(a) * 18.7, Math.cos(a + 0.25) * 18.7, 452, Math.sin(a + 0.25) * 18.7, 0.35), frame, true);
  }
  add(b, new THREE.CylinderGeometry(9, 9, 0.8, 32).translate(0, 495.4, 0), frame);
  // Gain tower: a slim square lattice mast, then the antenna.
  add(b, loftS([{ ring: rect(10, 10), y: 495 }, { ring: rect(6, 6), y: 625 }], [3, 3], false), latt);
  add(b, new THREE.CylinderGeometry(1.4, 2.2, 130, 10).translate(0, 560, 0), core);
  add(b, new THREE.CylinderGeometry(0.35, 0.8, 10, 8).translate(0, 629, 0), core);
  add(b, new THREE.SphereGeometry(0.9, 10, 6).translate(0, 634, 0), nightMat('st-beacon', { color: 0xff3020, emissive: 0xff2010 }, 4, 0.8));
  return b;
};

// ------------------------------------------------------------------ Sydney

/**
 * Sydney Harbour Bridge: a two-hinged steel arch of 503 m between the bearing pins, top chord 134 m
 * above the water at the crown, two 28-panel trusses carrying a 48.8 m deck ~49 m clear of the
 * water, and four 89 m granite-faced pylons. `span` is the pylon-to-pylon distance from the map.
 */
const harbourBridge: Builder = (c) => {
  const b = built();
  const span = c.span ?? 575, half = span / 2, pin = 251.5;
  const steel = solidMat('shb-steel', 0x8b9397, 0.62, 0.35);
  const granite = stone('shb-granite', '#cdbb98', 'rgba(110,95,70,0.45)', [5, 5]);
  const DECK = 58;
  const top = (x: number) => 134 - (134 - 66) * (x / pin) ** 2;
  const bot = (x: number) => 118.5 - (118.5 - 7) * (x / pin) ** 2;
  const Z = 15; // the two trusses, 30 m apart
  const beams: THREE.BufferGeometry[] = [], light: THREE.BufferGeometry[] = [];
  const P = 28, dx = (2 * pin) / P;
  for (const z of [-Z, Z]) {
    for (let k = 0; k < P; k++) {
      const x0 = -pin + k * dx, x1 = x0 + dx;
      beams.push(beam(x0, top(x0), z, x1, top(x1), z, 2.6, 3.2));
      beams.push(beam(x0, bot(x0), z, x1, bot(x1), z, 3.4, 4.2));
      // Diagonals lean toward the crown (Pratt pattern, mirrored at mid-span).
      if (k < P / 2) light.push(beam(x0, bot(x0), z, x1, top(x1), z, 1.4));
      else light.push(beam(x0, top(x0), z, x1, bot(x1), z, 1.4));
    }
    for (let k = 0; k <= P; k++) { const x = -pin + k * dx; light.push(beam(x, bot(x), z, x, top(x), z, 1.7)); }
    // End panels: the top chord runs on to the pylons.
    for (const s of [-1, 1]) light.push(beam(s * pin, top(pin), z, s * (half - 14), top(pin) - 2, z, 2.4, 3));
  }
  // Wind bracing between the trusses.
  for (let k = 0; k <= P; k++) {
    const x = -pin + k * dx;
    light.push(beam(x, top(x), -Z, x, top(x), Z, 1.2), beam(x, bot(x), -Z, x, bot(x), Z, 1.4));
    if (k < P) { const x1 = x + dx; light.push(beam(x, top(x), -Z, x1, top(x1), Z, 0.8), beam(x, top(x), Z, x1, top(x1), -Z, 0.8)); }
  }
  // Hangers down to the deck, and posts up to it near the ends.
  for (let k = 1; k < P; k++) {
    const x = -pin + k * dx, yb = bot(x);
    for (const z of [-Z, Z]) {
      if (yb > DECK + 1) light.push(beam(x, DECK - 1, z, x, yb, z, 0.9, 1.4));
      else if (yb < DECK - 5) light.push(beam(x, yb, z, x, DECK - 4, z, 1.5));
    }
  }
  b.group.add(merged(beams, steel), merged(light, steel));
  // The deck: steel girders under eight road lanes, two rail tracks, the cycleway and footway.
  const L = span + 70;
  add(b, new THREE.BoxGeometry(L, 4, 48.8).translate(0, DECK - 2.4, 0), steel);
  const rails: THREE.BufferGeometry[] = [];
  for (const z of [-24.4, 24.4]) rails.push(new THREE.BoxGeometry(L, 1.3, 0.25).translate(0, DECK + 0.4, z));
  b.group.add(merged(rails, steel));
  // Pylons: granite, two at each end either side of the deck, stepped crowns.
  for (const sx of [-1, 1]) {
    const x = sx * half;
    block(b, rect(32, 66, x, 0), -2, DECK - 4.5, granite);
    for (const sz of [-1, 1]) {
      const z = sz * 35;
      block(b, rect(26, 20, x, z), -2, 74, granite);
      block(b, rect(23, 17.5, x, z), 74, 86.5, granite);
      block(b, rect(25, 19.5, x, z), 82, 83.4, granite, false);
      block(b, rect(19, 14, x, z), 86.5, 89, granite);
      // The arched lookout openings near the top.
      const dark = solidMat('shb-open', 0x2a2724, 0.9, 0);
      for (const f of [-1, 1]) for (const oz of [-4.5, 0, 4.5]) add(b, new THREE.BoxGeometry(0.3, 6, 2.4).translate(x + f * 11.6, 78.5, z + oz), dark, true);
    }
  }
  return b;
};

/**
 * Sydney Tower (309 m to the spire): a slim shaft held by a waisted net of 56 steel cables, the
 * golden nine-level turret at about 250–270 m and the spire above.
 */
const sydneyTower: Builder = () => {
  const b = built();
  const shaft = solidMat('syt-shaft', 0xc5c7c6, 0.5, 0.4);
  add(b, new THREE.CylinderGeometry(3.6, 4.2, 252, 20).translate(0, 126, 0), shaft, false, { ring: ngon(12, 4.2), y0: 0, y1: 252 });
  // The cable net: a hyperboloid of straight cables from the podium roof to under the turret.
  const cables: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 56; k++) {
    const a0 = (k / 56) * TAU, a1 = a0 + 1.3;
    cables.push(beam(Math.cos(a0) * 13, 0, Math.sin(a0) * 13, Math.cos(a1) * 10, 238, Math.sin(a1) * 10, 0.22));
  }
  const cm = merged(cables, solidMat('syt-cable', 0x9a9c9c, 0.5, 0.6));
  b.group.add(cm);
  const gold = nightMat('syt-gold', { color: 0xd9a84a, roughness: 0.22, metalness: 0.85, emissive: 0xffd48a }, 1.6, 0.06);
  const white = solidMat('syt-white', 0xe6e4de, 0.5, 0.2);
  add(b, lathe([[4, 232], [12, 240], [16, 247]], 40), white);
  add(b, lathe([[16, 247], [16.6, 252], [16.3, 257], [17, 262], [16.6, 266]], 40), gold, false, { ring: ngon(16, 17), y0: 240, y1: 272 });
  add(b, lathe([[16.6, 266], [15, 268], [9, 271], [3, 273]], 40), white);
  add(b, new THREE.CylinderGeometry(0.5, 1.6, 36, 8).translate(0, 291, 0), white);
  add(b, new THREE.CylinderGeometry(0.2, 0.5, 2, 6).translate(0, 309, 0), nightMat('syt-beacon', { color: 0xff3020, emissive: 0xff2010 }, 4, 0.8));
  return b;
};

/**
 * Sydney Opera House: the 183 × 120 m podium of brown granite, and the shells in two rows — the
 * Concert Hall (west) and the Joan Sutherland Theatre (east), each a run of overlapping sails rising
 * toward the harbour to 67 m above the water, plus the small pair over the Bennelong restaurant at
 * the south-west. The sails are spherical segments, white and cream chevron tiles.
 */
const operaHouseSails: Builder = () => {
  const b = built();
  const PODIUM = 9;
  const pod = stone('soh-podium', '#b9967a', 'rgba(90,60,40,0.35)', [4, 4]);
  block(b, rect(118, 183, 0, 4), -1, PODIUM, pod);
  // The monumental steps down to the forecourt (south).
  const steps: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) steps.push(new THREE.BoxGeometry(96, PODIUM * (1 - k / 9), 2.2).translate(0, PODIUM * (1 - k / 9) / 2 - 0.5, 95.5 + 1 + k * 2.2));
  b.group.add(merged(steps, pod.mat));
  const tileTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#f3f0e6'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(205,195,170,0.85)'; g.lineWidth = 3;
    // The chevron lids of glossy white and matte cream tiles.
    for (let y = -128; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(128, y); g.stroke(); }
  });
  const tiles = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.28, metalness: 0.05, side: THREE.DoubleSide });
  const ribs = solidMat('soh-ribs', 0xd8cfbd, 0.7, 0);
  const glassWall = nightMat('soh-glass', { color: 0x3a3a34, roughness: 0.1, metalness: 0.6, emissive: 0xffc980, side: THREE.DoubleSide }, 1.3, 0.04);
  /**
   * A sail: a triangular patch of a sphere (all the shells share one radius, ~75 m) standing on a
   * base line at x0..x1 and z = zb, rising to an apex at height h leaning `lean` meters toward dir.
   */
  const sail = (cx: number, zb: number, w: number, h: number, lean: number, dir: number, glassFront: boolean) => {
    const N = 18, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const u = i / N, v = j / N;
      // Edges curve like the real ridges: base wide, apex pinched, the outline bowed out.
      const halfW = (w / 2) * (1 - v) ** 1.3;
      const x = (u * 2 - 1) * halfW;
      const y = h * (1 - (1 - v) ** 1.7);
      const z = dir * lean * v ** 1.6 - dir * Math.sin(Math.PI * v) * (1 - (u * 2 - 1) ** 2) * w * 0.16;
      pos.push(cx + x, PODIUM + y, zb + z);
      uv.push(u * w / 6, v * h / 6);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, c2 = a + N + 1; idx.push(a, c2, a + 1, a + 1, c2, c2 + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    add(b, g, tiles);
    // The ridge rib.
    const rib: THREE.Vector3[] = [];
    for (let j = 0; j <= N; j++) { const v = j / N; rib.push(new THREE.Vector3(cx, PODIUM + h * (1 - (1 - v) ** 1.7) + 0.3, zb + dir * lean * v ** 1.6 - dir * Math.sin(Math.PI * v) * w * 0.16)); }
    add(b, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rib), 24, 0.45, 5), ribs, true);
    if (glassFront) {
      // The glass wall that closes the open mouth of the outermost sail.
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      for (let k = 1; k <= 12; k++) { const v = k / 12; s.lineTo(-(w / 2) * (1 - v) ** 1.3 * 0.98, h * (1 - (1 - v) ** 1.7) * 0.97); }
      for (let k = 11; k >= 0; k--) { const v = k / 12; s.lineTo((w / 2) * (1 - v) ** 1.3 * 0.98, h * (1 - (1 - v) ** 1.7) * 0.97); }
      const gg = new THREE.ShapeGeometry(s);
      // Lean the glass back under the sail.
      gg.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, dir * lean * 0.55 / h, 0));
      add(b, gg.translate(cx, PODIUM, zb + dir * 2), glassWall);
    }
  };
  // The halls: the tallest sails at the north end face out over the harbour; the rest step down
  // toward the steps, alternately facing north and south (back to back).
  for (const [hx, s] of [[-24, 1], [25, 0.88]] as [number, number][]) {
    sail(hx, -38, 52 * s, 58 * s, 24 * s, -1, true);
    sail(hx, -36, 50 * s, 54 * s, 18 * s, 1, false);
    sail(hx, -10, 44 * s, 44 * s, 16 * s, 1, false);
    sail(hx, 14, 36 * s, 32 * s, 12 * s, 1, false);
    sail(hx, 30, 26 * s, 20 * s, 9 * s, -1, true);
    b.solids.push({ ring: rect(46 * s, 80, hx, -6), y0: PODIUM, y1: PODIUM + 44 * s });
  }
  // Bennelong restaurant, by the steps at the south-west.
  sail(-40, 72, 24, 19, 9, -1, true);
  sail(-40, 73, 20, 15, 7, 1, false);
  return b;
};

// ------------------------------------------------------------------ Hong Kong

/**
 * Bank of China Tower (367.4 m with the masts, roof 315 m): a 52 m square split on its diagonals
 * into four triangular shafts that stop at different heights with sloping glass tops; the facade is
 * blue-grey glass framed by the giant aluminium-clad X braces, each 13 floors tall.
 */
const bocTower: Builder = () => {
  const b = built();
  const cw = curtain('boc-glass', {
    glass: ['#7f97ad', '#4c6378'], frame: '#c9d1d8', cells: [16, 13], tile: [52, 52], mull: 0.12, span: 0.18, metal: 0.7, lit: 0.3, glowColor: 0xf4f6ff,
    over(g, W, H, lit) {
      g.strokeStyle = lit ? 'rgba(255,255,255,0.95)' : '#e9edf0'; g.lineWidth = 12;
      g.strokeRect(6, 6, W - 12, H - 12);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
    },
  });
  const S = 26;
  const C = [[-S, -S], [S, -S], [S, S], [-S, S]];
  // The quadrants' tops (m): the west first, then south, east, and the north shaft to the roof.
  const tops = [305, 245, 205, 175];
  for (let q = 0; q < 4; q++) {
    const a = C[q], c2 = C[(q + 1) % 4], H = tops[q], y0 = H - 22;
    const ring = [a[0], a[1], c2[0], c2[1], 0, 0];
    block(b, ring, 0, y0, cw, true, false);
    // The sloping glass top rises from the outer edge to the tower's center line.
    const g = new THREE.BufferGeometry();
    const p = [a[0], y0, a[1], c2[0], y0, c2[1], 0, H, 0, a[0], y0, a[1], 0, y0, 0, 0, H, 0, c2[0], y0, c2[1], 0, H, 0, 0, y0, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, y0 / 52, 1, y0 / 52, 0.5, H / 52, 0, 0, 0.3, 0, 0.3, 0.4, 0, 0, 0.3, 0, 0.3, 0.4], 2));
    g.computeVertexNormals();
    const mat = (cw.mat as THREE.MeshStandardMaterial).clone(); mat.side = THREE.DoubleSide;
    add(b, g, mat);
    b.solids.push({ ring, y0, y1: H - 8 });
  }
  const mast = solidMat('boc-mast', 0xd8dde2, 0.4, 0.7);
  add(b, new THREE.CylinderGeometry(0.7, 1.2, 62, 8).translate(-6, 336, -12), mast);
  add(b, new THREE.CylinderGeometry(0.7, 1.2, 50, 8).translate(6, 330, -12), mast);
  return b;
};

/**
 * Two IFC (412 m roof, 415.8 m to the crown): a square plan with chamfered corners, pale grey glass
 * striped by white mullion fins, stepping in near the top under a crown of corner fins.
 */
const ifc2: Builder = () => {
  const b = built();
  const cw = curtain('ifc-glass', {
    glass: ['#a9bccb', '#71889c'], frame: '#eef0f0', cells: [8, 6], tile: [12, 25.2], mull: 0.32, span: 0.08, metal: 0.6, lit: 0.35,
  });
  const tiers: [number, number, number][] = [[0, 60, 330], [330, 56, 362], [362, 52, 384], [384, 47, 398]];
  for (const [y0, w, y1] of tiers) block(b, chamfer(w, w, w * 0.22), y0, y1, cw);
  const fin = solidMat('ifc-fin', 0xe8eaea, 0.4, 0.5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let k = 0; k < 3; k++) {
      const off = 18 - k * 5, h = 405 + k * 5;
      add(b, new THREE.BoxGeometry(2.2, h - 384, 2.2).translate(sx * off, (h + 384) / 2, sz * off), fin);
    }
  }
  add(b, new THREE.BoxGeometry(34, 4, 34).translate(0, 400, 0), fin);
  return b;
};

// ------------------------------------------------------------------ Shanghai

/**
 * Oriental Pearl Tower (468 m): three 9 m columns and three raked legs, the 50 m lower sphere
 * (68–118 m), five small spheres up the columns, the 45 m upper sphere (~240–285 m), the "space
 * module" at 350 m and the antenna. The spheres are rose-red mirror glass.
 */
const orientalPearl: Builder = () => {
  const b = built();
  const conc = solidMat('opt-conc', 0xd9d4cc, 0.6, 0.1);
  const pink = nightMat('opt-pink', { color: 0xb8326a, roughness: 0.22, metalness: 0.55, emissive: 0xff4b9a }, 0.9, 0.04);
  const R = 12;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 6;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    add(b, new THREE.CylinderGeometry(4.5, 4.5, 286, 20).translate(x, 143, z), conc, false, { ring: ngon(10, 4.5, 0, x, z), y0: 0, y1: 286 });
    // The raked legs.
    const a2 = a + Math.PI / 3, lx = Math.cos(a2) * 42, lz = Math.sin(a2) * 42;
    add(b, beam(lx, 0, lz, Math.cos(a2) * 8, 62, Math.sin(a2) * 8, 6.5), conc);
    b.solids.push({ ring: ngon(8, 5, 0, lx, lz), y0: 0, y1: 12 });
    add(b, new THREE.SphereGeometry(4.2, 16, 10).translate(lx, 2, lz), pink, true);
  }
  // Lower sphere and its ring of windows.
  add(b, new THREE.SphereGeometry(25, 40, 28).translate(0, 93, 0), pink, false, { ring: ngon(16, 25), y0: 70, y1: 116 });
  // Five small spheres between the big ones.
  for (let k = 0; k < 5; k++) add(b, new THREE.SphereGeometry(6.5, 20, 14).translate(0, 136 + k * 22, 0), pink);
  add(b, new THREE.SphereGeometry(22.5, 40, 28).translate(0, 263, 0), pink, false, { ring: ngon(16, 22.5), y0: 242, y1: 285 });
  add(b, new THREE.CylinderGeometry(4, 5, 70, 16).translate(0, 315, 0), conc);
  add(b, new THREE.SphereGeometry(7.5, 24, 16).translate(0, 350, 0), pink);
  add(b, new THREE.CylinderGeometry(1.2, 3.2, 110, 10).translate(0, 410, 0), solidMat('opt-ant', 0xe2e2e2, 0.4, 0.6));
  for (const y of [372, 395, 420]) add(b, new THREE.CylinderGeometry(3.2, 3.2, 1.5, 12).translate(0, y, 0), conc);
  add(b, new THREE.SphereGeometry(0.9, 8, 6).translate(0, 466, 0), nightMat('opt-beacon', { color: 0xff3020, emissive: 0xff2010 }, 4, 0.8));
  return b;
};

/**
 * Shanghai Tower (632 m): a rounded triangle with a notch, tapering from ~83 m across and turning
 * 120° as it rises; the outer glass skin runs past the 580 m roof as the open crown.
 */
const shanghaiTower: Builder = () => {
  const b = built();
  const cw = curtain('sht-glass', {
    glass: ['#c5d6e2', '#8fa7ba'], frame: '#dfe6ea', cells: [10, 8], tile: [15, 34], mull: 0.1, span: 0.14, metal: 0.65, lit: 0.3,
    over(g, W, H, lit) { if (!lit) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, H - 6, W, 6); } },
  });
  const ring = (y: number) => {
    const t = y / 632, R = 44 * (1 - 0.5 * t), phi = (t * 2 * Math.PI) / 3, n = 72, out: number[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      let r = R * (0.86 + 0.14 * Math.cos(3 * (th - phi)));
      const d = Math.atan2(Math.sin(th - phi), Math.cos(th - phi));
      r *= 1 - 0.09 * Math.exp(-((d / 0.07) ** 2));
      out.push(Math.cos(th) * r, Math.sin(th) * r);
    }
    return out;
  };
  const lv: { ring: number[]; y: number }[] = [];
  for (let y = 0; y <= 580; y += 20) lv.push({ ring: ring(y), y });
  add(b, loftS(lv, cw.tile, true), cw.mat);
  b.solids.push({ ring: ngon(16, 40), y0: 0, y1: 300 }, { ring: ngon(16, 30), y0: 300, y1: 580 });
  const crown: { ring: number[]; y: number }[] = [];
  for (let y = 580; y <= 632; y += 13) crown.push({ ring: ring(y).map((v) => v * (1 - (y - 580) / 420)), y });
  const cm = (cw.mat as THREE.MeshStandardMaterial).clone(); cm.side = THREE.DoubleSide; cm.transparent = true; cm.opacity = 0.75;
  add(b, loftS(crown, cw.tile, false), cm);
  add(b, new THREE.CylinderGeometry(9, 12, 14, 24).translate(0, 587, 0), solidMat('sht-mech', 0xb9c1c6, 0.5, 0.5));
  return b;
};

/**
 * Jin Mao Tower (420.5 m): a pagoda of setbacks — the lowest segment 16 floors, each one above an
 * eighth shorter — in silver aluminium and dark glass, crowned by stepped tiers and a spire.
 */
const jinMao: Builder = () => {
  const b = built();
  const cw = curtain('jm-glass', {
    glass: ['#5f6c78', '#3b4651'], frame: '#c4c8cc', cells: [6, 6], tile: [9, 24], mull: 0.3, span: 0.22, metal: 0.75, lit: 0.35,
    over(g, W, H, lit) { if (!lit) { g.fillStyle = '#e1e4e6'; for (let x = 0; x < W; x += W / 6) g.fillRect(x, 0, 4, H); } },
  });
  const trim = solidMat('jm-trim', 0xd4d7da, 0.35, 0.8);
  const floors = [16, 14, 12, 10, 8, 6, 4, 2, 1, 1, 1];
  let y = 0, w = 54;
  for (const f of floors) {
    const h = f * 4.1;
    block(b, chamfer(w, w, w * 0.2), y, y + h, cw);
    add(b, prism(chamfer(w + 2.4, w + 2.4, (w + 2.4) * 0.2), y + h - 0.8, y + h, [1, 1]), trim);
    y += h; w -= 2.6;
  }
  // The crown: stepped octagonal tiers with fins, then the spire.
  for (let k = 0; k < 6; k++) { const ww = w - k * 3.2; block(b, chamfer(ww, ww, ww * 0.3), y, y + 7, cw, k < 2); y += 7; }
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + Math.PI / 8; fins.push(new THREE.BoxGeometry(0.8, 30, 4).rotateY(-a).translate(Math.cos(a) * 9, y - 18, Math.sin(a) * 9)); }
  b.group.add(merged(fins, trim));
  add(b, new THREE.CylinderGeometry(0.6, 3.5, 420.5 - y, 8).translate(0, (420.5 + y) / 2, 0), trim);
  return b;
};

/**
 * Shanghai World Financial Center (492 m): a 58 m square prism cut by two great arcs, so its plan
 * thins to a line along one diagonal at the top, with the trapezoidal aperture through the top.
 */
const swfc: Builder = () => {
  const b = built();
  const cw = curtain('swfc-glass', {
    glass: ['#8fa8bd', '#566f86'], frame: '#c9d2d9', cells: [8, 8], tile: [12, 33], mull: 0.1, span: 0.15, metal: 0.7, lit: 0.3,
  });
  // Ridge frame: u along the diagonal that survives to the top, v across it.
  const U = 41, ux = Math.SQRT1_2, uz = -Math.SQRT1_2, vx = Math.SQRT1_2, vz = Math.SQRT1_2;
  const half = (y: number) => U * (1 - 0.9 * (y / 492) ** 1.15);
  const rh = (ua: number, va: number) => [ua * ux + va * vx, ua * uz + va * vz];
  const plan = (y: number) => { const h = half(y); return [...rh(U, 0), ...rh(0, h), ...rh(-U, 0), ...rh(0, -h)]; };
  const lv: { ring: number[]; y: number }[] = [];
  for (let y = 0; y <= 448; y += 32) lv.push({ ring: plan(y), y });
  lv.push({ ring: plan(448), y: 448 });
  add(b, loftS(lv.filter((l, i) => i === 0 || l.y !== lv[i - 1].y), cw.tile, true), cw.mat);
  b.solids.push({ ring: plan(0), y0: 0, y1: 200 }, { ring: plan(300), y0: 200, y1: 448 });
  // The aperture: two legs either side of the trapezoidal opening, the bridge over it.
  const A = 22, h = half(470);
  for (const s of [-1, 1]) {
    const leg = [...rh(s * U, 0), ...rh(s * A, h * (1 - A / U)), ...rh(s * A, -h * (1 - A / U))];
    block(b, leg, 448, 478, cw);
  }
  block(b, plan(485), 478, 492, cw);
  return b;
};

// ------------------------------------------------------------------ Singapore

/**
 * Marina Bay Sands: three 55-storey hotel towers (~194 m) in a row, each two legs — the east one
 * straight, the west one curving in to meet it — under the 340 m SkyPark, which cantilevers ~67 m
 * past the north tower. Tower positions from the map.
 */
const MBS_T = [[1.282696, 103.860189], [1.283589, 103.860692], [1.284583, 103.861001]];
const marinaBaySands: Builder = () => {
  const b = built();
  const cw = curtain('mbs-glass', {
    glass: ['#c3d0d8', '#94a8b5'], frame: '#e9ecec', cells: [10, 10], tile: [16, 32], mull: 0.08, span: 0.3, metal: 0.6, lit: 0.45,
  });
  const c0 = { lat: 1.283589, lon: 103.860692 };
  const zs = MBS_T.map(([la, lo]) => geoOff(c0.lat, c0.lon, la, lo, 23));
  const TOP = 191, X = 16;
  for (const t of zs) {
    // The north leg rises straight; the south leg curves in to meet it about the 23rd floor, and
    // the two run on as one slab to the SkyPark (legs splay along the row, as the map's outlines do).
    block(b, rect(X * 2, 24, t.x, t.z - 15), 0, 96, cw);
    const leg: { ring: number[]; y: number }[] = [];
    for (let k = 0; k <= 8; k++) {
      const y = (k / 8) * 96, f = (k / 8) ** 0.75;
      const zOut = t.z + 27 - 24 * f, zIn = t.z + 5 - 8 * f;
      leg.push({ ring: rect(X * 2, zOut - zIn, t.x, (zOut + zIn) / 2), y });
    }
    add(b, loftS(leg, cw.tile, false), cw.mat, false, { ring: rect(X * 2, 20, t.x, t.z + 14), y0: 0, y1: 60 });
    block(b, rect(X * 2, 30, t.x, t.z - 12), 96, TOP, cw);
  }
  // The SkyPark: a ship's hull on the three towers, prow to the north.
  const deck = solidMat('mbs-deck', 0xe9ebeb, 0.45, 0.3);
  const zS = zs[0].z + 45, zN = zs[2].z - 67, xc = (zs[0].x + zs[2].x) / 2;
  const hull = [xc - 19, zS, xc + 19, zS, xc + 19, zN + 25, xc + 4, zN, xc - 4, zN, xc - 19, zN + 25];
  add(b, prism(hull, TOP, TOP + 9, [8, 8]), deck, false, { ring: hull, y0: TOP, y1: TOP + 9 });
  const pool = solidMat('mbs-pool', 0x3aa7c9, 0.05, 0.2);
  add(b, new THREE.BoxGeometry(12, 0.3, (zS - zN) * 0.42).translate(xc - 11, TOP + 9.1, (zs[1].z + zs[2].z) / 2), pool, true);
  const palms: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 18; k++) palms.push(new THREE.SphereGeometry(2.2, 8, 6).scale(1, 0.6, 1).translate(xc + 8 + (k % 2) * 5, TOP + 12, zS - 20 - k * 12));
  b.group.add(merged(palms, solidMat('mbs-palm', 0x4d7a35, 0.8, 0)));
  return b;
};

/**
 * Supertree Grove (Gardens by the Bay): twelve 25–50 m "trees" — a concrete trunk wrapped in a
 * vertical garden, flaring into a steel canopy — with the OCBC Skyway between two of the tallest.
 */
const supertrees: Builder = () => {
  const b = built();
  const trunk = solidMat('stg-trunk', 0x6b5a7a, 0.85, 0);
  const green = solidMat('stg-green', 0x56813d, 0.9, 0);
  const canopy = nightMat('stg-canopy', { color: 0x8c4a85, roughness: 0.6, metalness: 0.4, emissive: 0xc86cff, side: THREE.DoubleSide }, 1.5, 0);
  const trees: [number, number, number][] = [
    [0, 0, 50], [-36, 18, 42], [38, -14, 42], [-62, -22, 35], [58, 34, 33], [-14, 52, 30],
    [20, -52, 30], [-48, 58, 27], [72, -40, 27], [-80, 10, 25], [44, 72, 25], [-18, -70, 25],
  ];
  const trunks: THREE.BufferGeometry[] = [], greens: THREE.BufferGeometry[] = [], cans: THREE.BufferGeometry[] = [];
  for (const [x, z, H] of trees) {
    const R = H * 0.33;
    trunks.push(lathe([[2.6, 0], [2.2, H * 0.55], [1.6, H * 0.62]], 10).translate(x, 0, z));
    greens.push(lathe([[2.75, 1], [2.35, H * 0.5]], 10).translate(x, 0, z));
    // The canopy: an open funnel of radial ribs and rings.
    cans.push(lathe([[1.6, H * 0.62], [R * 0.45, H * 0.78], [R * 0.85, H * 0.93], [R, H]], 16).translate(x, 0, z));
    b.solids.push({ ring: ngon(8, 2.8, 0, x, z), y0: 0, y1: H * 0.6 });
  }
  b.group.add(merged(trunks, trunk), merged(greens, green));
  const cm = merged(cans, canopy); cm.castShadow = true; b.group.add(cm);
  // The OCBC Skyway, 22 m up between the two 42 m trees.
  const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-36, 22, 18), new THREE.Vector3(0, 22.5, 6), new THREE.Vector3(38, 22, -14)]);
  add(b, new THREE.TubeGeometry(path, 40, 1.1, 6), solidMat('stg-sky', 0xd8d8d2, 0.5, 0.4));
  return b;
};

// ------------------------------------------------------------------ Seoul, Taipei

/**
 * Lotte World Tower (554.5 m): a smooth tapering cone of pale silver glass on a rounded-square plan
 * (~69 m at the base), seamed at the corners, opening at the top into a diagrid lantern.
 */
const lotteTower: Builder = () => {
  const b = built();
  const cw = curtain('lwt-glass', {
    glass: ['#d3dde3', '#a3b4bf'], frame: '#eef1f2', cells: [12, 8], tile: [18, 34], mull: 0.08, span: 0.12, metal: 0.6, lit: 0.3,
  });
  const hw = (y: number) => 34.5 - 21 * (y / 555) ** 1.5;
  const ring = (y: number) => {
    const h = hw(y), n = 64, out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU, c = Math.cos(t), s = Math.sin(t);
      // Squircle with a slight seam in at each corner.
      let r = h / Math.pow(Math.abs(c) ** 3.2 + Math.abs(s) ** 3.2, 1 / 3.2);
      const d = Math.abs(((t + Math.PI / 4) % (Math.PI / 2)) - Math.PI / 4);
      r *= 1 - 0.035 * Math.exp(-(((Math.PI / 4 - d) / 0.03) ** 2));
      out.push(c * r, s * r);
    }
    return out;
  };
  const lv: { ring: number[]; y: number }[] = [];
  for (let y = 0; y <= 495; y += 33) lv.push({ ring: ring(y), y });
  add(b, loftS(lv, cw.tile, true), cw.mat);
  b.solids.push({ ring: rect(66, 66), y0: 0, y1: 250 }, { ring: rect(46, 46), y0: 250, y1: 495 });
  const latt = lattice('lwt-latt', 0xdfe5e8, 0xfff2d8, 0.7);
  const top: { ring: number[]; y: number }[] = [];
  for (let y = 495; y <= 555; y += 15) top.push({ ring: ring(y).map((v) => v * (1 - (y - 495) / 160)), y });
  add(b, loftS(top, [4, 4], false), latt);
  return b;
};

/**
 * Taipei 101 (508 m): a tapered 25-storey base, eight flared segments of eight floors each (the
 * lucky number), the top tiers to the 448 m roof and the pinnacle; green-blue glass, notched corners.
 */
const taipei101: Builder = () => {
  const b = built();
  const cw = curtain('t101-glass', {
    glass: ['#5f9a9a', '#356a6e'], frame: '#9fb8b6', cells: [8, 8], tile: [12, 33.6], mull: 0.12, span: 0.2, metal: 0.6, lit: 0.35,
  });
  const trim = solidMat('t101-trim', 0xb9c9c6, 0.35, 0.7);
  const notched = (h: number, n = h * 0.13) => [
    -h + n, -h, h - n, -h, h - n, -h + n, h, -h + n, h, h - n, h - n, h - n, h - n, h, -h + n, h, -h + n, h - n, -h, h - n, -h, -h + n, -h + n, -h + n,
  ];
  // Base: 25 floors leaning inward.
  add(b, loftS([{ ring: notched(33), y: 0 }, { ring: notched(28), y: 105 }], cw.tile, true), cw.mat, false, { ring: rect(62, 62), y0: 0, y1: 105 });
  let y = 105;
  for (let k = 0; k < 8; k++) {
    add(b, loftS([{ ring: notched(25.5), y }, { ring: notched(30.5), y: y + 33.6 }], cw.tile, true), cw.mat, false, { ring: rect(56, 56), y0: y, y1: y + 33.6 });
    add(b, prism(notched(31.2), y + 33.6 - 0.6, y + 33.6 + 0.2, [1, 1]), trim);
    y += 33.6;
  }
  for (const [h, t] of [[24, 18], [21, 14], [17, 12], [13, 10], [9, 6]] as [number, number][]) { block(b, notched(h), y, y + t, cw); y += t; }
  add(b, new THREE.CylinderGeometry(0.8, 3.2, 508 - y, 10).translate(0, (508 + y) / 2, 0), trim);
  for (const yy of [y + 8, y + 18, y + 28]) add(b, new THREE.CylinderGeometry(3, 3, 1.2, 12).translate(0, yy, 0), trim, true);
  return b;
};

// ------------------------------------------------------------------ Rio, Mexico City

/**
 * Christ the Redeemer: 30 m of reinforced concrete clad in pale soapstone on an 8 m pedestal, arms
 * spread 28 m, looking out over the city toward Guanabara Bay.
 */
const cristo: Builder = () => {
  const b = built();
  const soap = solidMat('cr-soap', 0xd9d8cf, 0.75, 0);
  const ped = stone('cr-ped', '#cfcbbf', 'rgba(100,95,85,0.35)', [3, 3]);
  block(b, rect(10, 10), -1, 1.5, ped);
  block(b, rect(8.5, 8.5), 1.5, 8, ped);
  add(b, prism(rect(9.4, 9.4), 7.6, 8.3, [1, 1]), soap);
  const P = 8;
  // The robe: a long column flaring a little at the hem, narrowing to the shoulders.
  const robe: { ring: number[]; y: number }[] = [[0, 2.6, 2.0], [3, 2.4, 1.9], [12, 2.2, 1.9], [18, 2.3, 2.0], [21.5, 3.1, 2.2], [23.5, 3.4, 2.1]].map(([y, rx, rz]) => {
    const r: number[] = [];
    for (let i = 0; i < 24; i++) { const t = (i / 24) * TAU; r.push(Math.cos(t) * rx, Math.sin(t) * rz); }
    return { ring: r, y: P + y };
  });
  add(b, loftS(robe, [2, 2], true), soap, false, { ring: rect(5.4, 4.2), y0: P, y1: P + 24 });
  // Arms: tapering, with the sleeves hanging below.
  for (const s of [-1, 1]) {
    add(b, beam(s * 2.5, P + 22.4, 0, s * 14, P + 22.2, 0, 1.6, 1.4), soap);
    add(b, beam(s * 3, P + 21.2, 0, s * 9.5, P + 21.4, 0, 1.5, 2.6), soap);
    add(b, new THREE.BoxGeometry(0.9, 1.6, 0.6).translate(s * 14.2, P + 22.1, 0), soap);
  }
  add(b, new THREE.CylinderGeometry(0.9, 1.1, 1.4, 12).translate(0, P + 24.2, 0), soap);
  add(b, new THREE.SphereGeometry(1.75, 18, 14).scale(0.9, 1.15, 1).translate(0, P + 26.6, -0.1), soap);
  // The hair falls to the shoulders behind.
  add(b, new THREE.SphereGeometry(1.8, 14, 10).scale(0.95, 1.25, 0.7).translate(0, P + 26, 0.55), soap, true);
  return b;
};

/**
 * Torre Latinoamericana (166 m architectural, 182 m to the tip; 44 floors): a steel-framed slab of
 * blue-green glass and aluminium with stepped setbacks under the observation deck and the antenna.
 */
const torreLatino: Builder = () => {
  const b = built();
  const cw = curtain('tl-glass', {
    glass: ['#6f9aa0', '#3f6870'], frame: '#c7ccc9', cells: [10, 6], tile: [14, 21], mull: 0.18, span: 0.3, metal: 0.55, lit: 0.4,
  });
  const tiers: [number, number, number, number][] = [[0, 36, 32, 132], [132, 30, 27, 144], [144, 24, 21, 152], [152, 17, 15, 160], [160, 10, 10, 166]];
  for (const [y0, w, d, y1] of tiers) block(b, rect(w, d), y0, y1, cw);
  const al = solidMat('tl-al', 0xd2d6d6, 0.35, 0.7);
  add(b, new THREE.CylinderGeometry(0.4, 1.2, 16, 8).translate(0, 174, 0), al);
  add(b, new THREE.SphereGeometry(0.6, 8, 6).translate(0, 182, 0), nightMat('tl-beacon', { color: 0xff3020, emissive: 0xff2010 }, 4, 0.8));
  return b;
};

/**
 * Metropolitan Cathedral, Mexico City: the map's outline in grey cantera stone, the baroque facade
 * facing the Zócalo (south) between two 67 m bell towers with bell-shaped caps, and the dome.
 */
const cdmxCathedral: Builder = (c) => {
  const b = built();
  const cant = stone('cdmx-cantera', '#a99c8a', 'rgba(80,70,60,0.35)', [5, 5]);
  const dark = solidMat('cdmx-dark', 0x7c7266, 0.85, 0);
  const tez = solidMat('cdmx-tez', 0x8d5a4a, 0.9, 0);
  let x0 = -40, x1 = 40, z0 = -70, z1 = 70;
  if (c.rings.length) {
    x0 = Infinity; x1 = -Infinity; z0 = Infinity; z1 = -Infinity;
    for (const r of c.rings) {
      if (r.ring.length > 1600) continue;
      block(b, r.ring, Math.max(-1.5, r.y0), 26, cant);
      for (let i = 0; i < r.ring.length; i += 2) { x0 = Math.min(x0, r.ring[i]); x1 = Math.max(x1, r.ring[i]); z0 = Math.min(z0, r.ring[i + 1]); z1 = Math.max(z1, r.ring[i + 1]); }
    }
  } else block(b, rect(x1 - x0, z1 - z0), 0, 26, cant);
  // The church proper is the western ~60 m of the block (the Sagrario stands to its east).
  const cx = x0 + 31, front = z1 - 8;
  for (const s of [-1, 1]) {
    const tx = cx + s * 22, tz = front;
    block(b, rect(14, 14, tx, tz), 0, 40, cant);
    block(b, rect(12, 12, tx, tz), 40, 54, cant);
    for (const f of [-1, 1]) {
      add(b, new THREE.BoxGeometry(0.3, 7, 4).translate(tx + f * 6.05, 47, tz), dark);
      add(b, new THREE.BoxGeometry(4, 7, 0.3).translate(tx, 47, tz + f * 6.05), dark);
    }
    // The bell-shaped caps, a lantern and the cross.
    add(b, lathe([[6.2, 54], [6.4, 55.2], [5.9, 56.5], [5.0, 58.5], [3.6, 60.5], [2.2, 61.8], [1.6, 62.2], [1.6, 64.5], [0.9, 65.2], [0.25, 67]], 16).translate(tx, 0, tz), cant.mat);
  }
  // The central body of the facade, its clock tower and statues rising between the towers.
  block(b, rect(24, 8, cx, front + 2), 0, 38, cant);
  block(b, rect(8, 6, cx, front + 2), 38, 46, cant);
  // The dome over the crossing, with its lantern.
  const dz = (z0 + z1) / 2 - 6;
  add(b, new THREE.CylinderGeometry(9, 9, 10, 16).translate(cx, 31, dz), cant.mat);
  add(b, new THREE.SphereGeometry(9, 20, 10, 0, TAU, 0, Math.PI / 2).translate(cx, 36, dz), tez);
  add(b, new THREE.CylinderGeometry(1.8, 2.2, 6, 8).translate(cx, 47, dz), cant.mat);
  return b;
};

/**
 * Copacabana's promenade: Roberto Burle Marx's black and white Portuguese pavement, the waves
 * running lengthwise along the beach (his 1970 layout), on the map's promenade line.
 */
let WAVES: THREE.MeshStandardMaterial | null = null;
function wavesMat() {
  if (WAVES) return WAVES;
  const W = 256, H = 341, LAM = 6, WID = 8;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (x / W) * LAM, t = (y / H) * WID;
    const f = (t + 1.15 * Math.sin((2 * Math.PI * s) / LAM)) / (WID / 3);
    const dark = f - Math.floor(f) < 0.5;
    const n = (rnd(x * 3.1 + y * 7.7) - 0.5) * 18;
    const v = dark ? 46 + n : 232 + n * 0.6, i = (y * W + x) * 4;
    img.data[i] = v; img.data[i + 1] = v - (dark ? 2 : 4); img.data[i + 2] = v - (dark ? 0 : 10); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
  WAVES = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return WAVES;
}
function copaWaves(k: number): Builder {
  return () => {
    const b = built();
    const [i0, i1] = copaPiece(k), m = Math.round((i0 + i1) / 2);
    const lat0 = COPA_PTS[m * 2], lon0 = COPA_PTS[m * 2 + 1];
    const P: { x: number; z: number }[] = [];
    for (let i = i0; i <= i1; i++) P.push(geoOff(lat0, lon0, COPA_PTS[i * 2], COPA_PTS[i * 2 + 1]));
    const WID = 8, LAM = 6, y = 0.22;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let s = 0;
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)], c2 = P[Math.min(P.length - 1, i + 1)];
      const dx = c2.x - a.x, dz = c2.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      if (i > 0) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z);
      pos.push(p.x - nx * WID / 2, y, p.z - nz * WID / 2, p.x + nx * WID / 2, y, p.z + nz * WID / 2);
      uv.push(s / LAM, 0, s / LAM, 1);
      if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, wavesMat()); mesh.receiveShadow = true;
    b.group.add(mesh);
    return b;
  };
}

/** The Zócalo's giant flag: a 50 m pole and a 14 × 25 m tricolour. */
const zocaloFlag: Builder = () => {
  const b = built();
  const steel = solidMat('zf-pole', 0xd8dadc, 0.35, 0.8);
  add(b, new THREE.CylinderGeometry(0.35, 0.75, 50, 12).translate(0, 25, 0), steel, false, { ring: ngon(8, 1.2), y0: 0, y1: 50 });
  add(b, new THREE.CylinderGeometry(3.5, 4.5, 1.2, 16).translate(0, 0.6, 0), solidMat('zf-base', 0x9c9488, 0.8, 0));
  const tex = canvasTex(256, 144, (g) => {
    g.fillStyle = '#006847'; g.fillRect(0, 0, 86, 144);
    g.fillStyle = '#ffffff'; g.fillRect(86, 0, 85, 144);
    g.fillStyle = '#ce1126'; g.fillRect(171, 0, 85, 144);
    g.fillStyle = '#8a5a2b'; g.beginPath(); g.ellipse(128, 72, 18, 20, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4b7d33'; g.beginPath(); g.ellipse(128, 92, 22, 7, 0, 0, Math.PI); g.fill();
  });
  // A gentle wave in the cloth.
  const fg = new THREE.PlaneGeometry(25, 14.3, 24, 1);
  const p = fg.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 12.5; p.setZ(i, Math.sin(x * 0.45) * 0.9 * (x / 25)); }
  fg.computeVertexNormals();
  add(b, fg.translate(12.9, 42, 0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
  return b;
};

export const APAC_BUILDERS: Record<string, Builder> = {
  zocaloFlag,
  ...Object.fromEntries(Array.from({ length: COPA_PIECES }, (_, k) => [`copaWaves${k}`, copaWaves(k)])),
  shibuyaScramble, skytree, harbourBridge, sydneyTower, operaHouseSails, bocTower, ifc2, orientalPearl, shanghaiTower, jinMao, swfc,
  marinaBaySands, supertrees, lotteTower, taipei101, cristo, torreLatino, cdmxCathedral,
};
