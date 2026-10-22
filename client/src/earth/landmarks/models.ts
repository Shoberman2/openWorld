// The landmark models. Each builder works in a model frame: y up from the ground (0), x along the
// landmark's east axis, z along its south axis (so -z is the landmark's "north", its bearing). Builders
// that know the real outline from the map get the claimed footprints (`rings`) in that frame.
import * as THREE from 'three';
import { area, band, built, chamfer, facadeMat, glowMat, merged, ngon, offsetRing, placed, prism, rect, solidMat, tier, type Built, STYLES } from './kit.ts';
import { lollipopTree, treeMat } from '../style.ts';
// ---- East US
import { EAST_BUILDERS } from './east-models.ts';
import { APAC_BUILDERS } from './apac-models.ts';
// ---- Europe & Middle East
import { EU_BUILDERS } from './eu-builders.ts';
// ---- NYC
import { NYC_BUILDERS } from './nyc-models.ts';

export interface BuildCtx {
  /** Claimed map footprints in the model frame (empty when the map has none here). */
  rings: { ring: number[]; holes: number[][]; y0: number; y1: number }[];
  /** Lowest point a claimed part starts at (a tower standing on a podium starts there). */
  minY: number;
  /** Bridges: tower-to-tower distance measured from the map. */
  span?: number;
  // ---- West Coast
  /** Ground height at a model-frame point, relative to the model's base (where the map is loaded). */
  groundAt?: (x: number, z: number) => number;
}

type Builder = (c: BuildCtx) => Built;

const STAINLESS = () => solidMat('stainless', 0xd2d6dc, 0.22, 1);
const COPPER = () => solidMat('copper', 0x6fa58e, 0.6, 0.25);
const GRANITE = () => solidMat('granite', 0xc9c2b4, 0.85, 0);
const DARK = () => solidMat('darkstone', 0x55585e, 0.8, 0);
const SLATE = () => solidMat('slate', 0x5d6168, 0.75, 0.1);
const STONE = (c = 0xd8cfbd) => solidMat(`stone-${c}`, c, 0.85, 0);

/** Walls between successive rings (same vertex count), UV'd in meters of `tile`. */
function loft(levels: { ring: number[]; y: number }[], tile: [number, number] = [4, 4], cap = true): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = levels[0].ring.length / 2;
  for (let L = 0; L + 1 < levels.length; L++) {
    const A = levels[L], B = levels[L + 1];
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0x = A.ring[i * 2], a0z = A.ring[i * 2 + 1], a1x = A.ring[j * 2], a1z = A.ring[j * 2 + 1];
      const b0x = B.ring[i * 2], b0z = B.ring[i * 2 + 1], b1x = B.ring[j * 2], b1z = B.ring[j * 2 + 1];
      const len = Math.hypot(a1x - a0x, a1z - a0z);
      const b = pos.length / 3;
      pos.push(a0x, A.y, a0z, a1x, A.y, a1z, b1x, B.y, b1z, b0x, B.y, b0z);
      const lenB = Math.hypot(b1x - b0x, b1z - b0z);
      const mid = (len - lenB) / 2;
      uv.push(u / tile[0], A.y / tile[1], (u + len) / tile[0], A.y / tile[1], (u + mid + lenB) / tile[0], B.y / tile[1], (u + mid) / tile[0], B.y / tile[1]);
      if (area(A.ring) > 0) idx.push(b, b + 2, b + 1, b, b + 3, b + 2); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      u += len;
    }
  }
  if (cap) {
    const top = levels[levels.length - 1];
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < top.ring.length; i += 2) pts.push(new THREE.Vector2(top.ring[i], top.ring[i + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const b = pos.length / 3;
    for (const p of pts) { pos.push(p.x, top.y, p.y); uv.push(0, 0); }
    for (const [a, c, d] of tris) {
      const ny = (pts[d].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[d].y - pts[a].y);
      if (ny > 0) idx.push(b + a, b + c, b + d); else idx.push(b + a, b + d, b + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, b: Built, detail = false) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true; x.receiveShadow = true;
  b.group.add(x);
  if (detail) b.detail.push(x);
  return x;
}

/** Square pyramid (or frustum when r1 > 0), as a loft. */
function pyramid(w0: number, w1: number, y0: number, y1: number, sides = 4, rot = Math.PI / 4) {
  const r0 = w0 / Math.SQRT2, r1 = Math.max(0.01, w1 / Math.SQRT2);
  return loft([{ ring: ngon(sides, sides === 4 ? r0 : w0 / 2, rot), y: y0 }, { ring: ngon(sides, sides === 4 ? r1 : w1 / 2, rot), y: y1 }], [2, 2]);
}

/** Bounding box of the claimed rings in the model frame (or a default). */
function bbox(c: BuildCtx, w = 40, d = 40) {
  if (!c.rings.length) return { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of c.rings) for (let i = 0; i < r.ring.length; i += 2) { x0 = Math.min(x0, r.ring[i]); x1 = Math.max(x1, r.ring[i]); z0 = Math.min(z0, r.ring[i + 1]); z1 = Math.max(z1, r.ring[i + 1]); }
  return { x0, x1, z0, z1 };
}

/** The map's footprints extruded in a style, with a cornice — the base for outline-true landmarks. */
function fromRings(b: Built, c: BuildCtx, style: string, h: number, fallback: number[], cornice?: THREE.Material) {
  const parts = c.rings.length ? c.rings : [{ ring: fallback, holes: [] as number[][], y0: 0, y1: h }];
  for (const p of parts) {
    const top = c.rings.length ? Math.max(h * 0.5, Math.min(h, p.y1)) : h;
    const m = new THREE.Mesh(prism(p.ring, Math.max(-1.5, p.y0), top, STYLES[style].tile, true, p.holes), facadeMat(style));
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: p.ring, y0: p.y0, y1: top });
    if (cornice && area(p.ring) !== 0 && p.ring.length <= 400) band(b, p.ring, top - 1.2, 1.4, 0.7, cornice);
  }
  return parts;
}

/** The longest-footprint edge whose outward normal best faces direction (dx, dz): for porches and steps. */
function frontEdge(rings: number[][], dx: number, dz: number) {
  let best: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; len: number } | null = null, score = -Infinity;
  for (const r of rings) {
    const s = area(r) > 0 ? 1 : -1;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 6) continue;
      const nx = ((bz - az) / len) * s, nz = (-(bx - ax) / len) * s;
      const sc = (nx * dx + nz * dz) * 2 + len / 60;
      if (sc > score) { score = sc; best = { ax, az, bx, bz, nx, nz, len }; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ New York

const empire: Builder = () => {
  const b = built();
  const tiers: [number, number, number, number][] = [
    [129, 58, 0, 25], [104, 50, 25, 80], [76, 44, 80, 118], [58, 40, 118, 268], [46, 32, 268, 300], [36, 26, 300, 320], [28, 22, 320, 338],
  ];
  for (const [w, d, y0, y1] of tiers) {
    tier(b, rect(w, d), y0, y1, 'limestonePier');
    band(b, rect(w, d), y1 - 0.6, 0.8, 0.35, STONE(0xcfc6b5), true);
  }
  // The lit crown: stepped deco setbacks with floodlit fins (colors cycle at night).
  const crown = glowMat('esb-crown', 0xffffff, 0, 3.5);
  crown.userData.cycle = true;
  const fins: THREE.BufferGeometry[] = [];
  const steps: [number, number, number][] = [[24, 338, 350], [20, 350, 360], [16, 360, 368], [12, 368, 373]];
  for (const [w, y0, y1] of steps) {
    tier(b, chamfer(w, w * 0.84, w * 0.18), y0, y1, 'limestonePier', { solid: false });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      for (const off of [-0.32, 0, 0.32]) {
        const g = new THREE.BoxGeometry(0.6, y1 - y0 + 3, 0.6);
        fins.push(placed(g, Math.cos(a) * (w / 2) + Math.sin(a) * off * w, (y0 + y1) / 2 + 1, Math.sin(a) * (w * 0.42) - Math.cos(a) * off * w, a));
      }
    }
  }
  b.group.add(merged(fins, crown));
  const lit = new THREE.Mesh(prism(chamfer(27, 23, 4), 300, 338, [1, 1], false), crown);
  lit.scale.set(1.01, 1, 1.01);
  b.group.add(lit);
  // The mooring mast and antenna.
  mesh(new THREE.CylinderGeometry(4.2, 6.2, 18, 12).translate(0, 382, 0), STAINLESS(), b);
  mesh(new THREE.CylinderGeometry(2.4, 3.6, 10, 10).translate(0, 396, 0), STAINLESS(), b);
  mesh(new THREE.CylinderGeometry(0.35, 1.4, 42, 6).translate(0, 422, 0), solidMat('antenna', 0xb8bcc2, 0.4, 0.8), b);
  mesh(new THREE.SphereGeometry(0.7, 8, 6).translate(0, 443, 0), glowMat('beacon-red', 0xff2a1a, 1, 5), b);
  return b;
};

const chrysler: Builder = () => {
  const b = built();
  tier(b, rect(51, 61), 0, 62, 'whiteBrick');
  band(b, rect(51, 61), 61, 1.2, 0.4, DARK(), true);
  tier(b, rect(44, 52), 62, 78, 'whiteBrick');
  tier(b, chamfer(32, 32, 3), 78, 246, 'whiteBrick');
  band(b, chamfer(32, 32, 3), 232, 2.4, 0.5, STAINLESS());
  // Eagle gargoyles at the 61st-floor corners.
  const eagles: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    eagles.push(placed(new THREE.ConeGeometry(1.1, 6, 4).rotateX(Math.PI / 2), Math.cos(a) * 24, 234, Math.sin(a) * 24, -a + Math.PI / 2));
  }
  const em = merged(eagles, STAINLESS()); b.group.add(em); b.detail.push(em);
  // The crown: seven terraced sunburst arches in stainless steel, triangular windows lit at night.
  const steel = STAINLESS(), win = glowMat('chrysler-win', 0xfff2cf, 0.05, 4);
  const arches: THREE.BufferGeometry[] = [], glows: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const s = 28 - i * 3.0, y = 246 + i * 5.4, r = s / 2 - 0.4;
    tier(b, rect(s - 1.2, s - 1.2), y, y + 5.4, 'whiteBrick', { solid: i < 2, mat: steel });
    const shape = new THREE.Shape();
    shape.moveTo(-r, 0); shape.lineTo(-r, 0.01); shape.absarc(0, 0, r, Math.PI, 0, true); shape.lineTo(r, 0); shape.lineTo(-r, 0);
    // Radiating triangular windows.
    const nTri = 7;
    for (let t = 0; t < nTri; t++) {
      const a0 = Math.PI * (0.08 + (t / nTri) * 0.84), a1 = a0 + (Math.PI * 0.84) / nTri * 0.45;
      const h = new THREE.Path();
      h.moveTo(Math.cos(a0) * r * 0.86, Math.sin(a0) * r * 0.86);
      h.lineTo(Math.cos(a1) * r * 0.86, Math.sin(a1) * r * 0.86);
      h.lineTo(Math.cos((a0 + a1) / 2) * r * 0.32, Math.sin((a0 + a1) / 2) * r * 0.32);
      shape.holes.push(h);
    }
    const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, curveSegments: 14 });
    const back = new THREE.ShapeGeometry(new THREE.Shape().absarc(0, 0, r * 0.95, 0, Math.PI, false), 10);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const fx = Math.sin(a), fz = Math.cos(a);
      arches.push(placed(plate.clone(), fx * (s / 2), y, fz * (s / 2), a));
      glows.push(placed(back.clone(), fx * (s / 2 - 0.25), y, fz * (s / 2 - 0.25), a));
    }
  }
  b.group.add(merged(arches, steel));
  b.group.add(merged(glows, win));
  mesh(pyramid(7.5, 0.25, 284, 319), steel, b);
  return b;
};

const owtc: Builder = () => {
  const b = built();
  tier(b, rect(61, 61), 0, 57, 'blueGlass');
  // Eight isosceles triangles: the square base twisting into a square turned 45° at the roof.
  const y0 = 57, y1 = 417, h = 30.5, t = 30.7;
  const B = [[h, h], [-h, h], [-h, -h], [h, -h]];
  const T = [[0, t], [-t, 0], [0, -t], [t, 0]];
  const pos: number[] = [], uv: number[] = [];
  const tri = (a: number[], ya: number, c: number[], yc: number, d: number[], yd: number) => {
    // Facets UV'd by their horizontal run so the glass grid keeps its size.
    const ex = c[0] - a[0], ez = c[1] - a[1], el = Math.hypot(ex, ez) || 1;
    const proj = (p: number[]) => ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / el;
    pos.push(a[0], ya, a[1], c[0], yc, c[1], d[0], yd, d[1]);
    uv.push(proj(a) / 3, ya / 4.1, proj(c) / 3, yc / 4.1, proj(d) / 3, yd / 4.1);
  };
  for (let i = 0; i < 4; i++) {
    const b0 = B[i], b1 = B[(i + 1) % 4], tp = T[i], tn = T[(i + 3) % 4];
    tri(b0, y0, tp, y1, b1, y0); // facing out along the base edge
    tri(b0, y0, tn, y1, tp, y1); // the inverted triangle under the roof corner
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // Make every facet face out.
  const p = g.getAttribute('position'), nrm = g.getAttribute('normal');
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (nrm.getX(i) * cx + nrm.getZ(i) * cz < 0) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z);
      const u = (g.getAttribute('uv') as THREE.BufferAttribute);
      const ux = u.getX(i + 1), uy = u.getY(i + 1); u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2)); u.setXY(i + 2, ux, uy);
    }
  }
  g.computeVertexNormals();
  mesh(g, facadeMat('blueGlass'), b);
  b.solids.push({ ring: rect(56, 56), y0: 57, y1: 417 });
  mesh(prism(ngon(4, t, 0), y1, y1 + 1.5, [1, 1]), solidMat('owtc-cap', 0xd8dde3, 0.4, 0.6), b);
  // The spire: a ring base and a mast with service rings, a beacon on top.
  mesh(new THREE.CylinderGeometry(9, 9, 6, 16, 1, true).translate(0, y1 + 4.5, 0), solidMat('owtc-ring', 0xe2e6ea, 0.4, 0.6), b);
  mesh(new THREE.CylinderGeometry(0.45, 1.9, 124, 8).translate(0, y1 + 62, 0), solidMat('antenna', 0xb8bcc2, 0.4, 0.8), b);
  for (let k = 0; k < 6; k++) mesh(new THREE.CylinderGeometry(2.6 - k * 0.3, 2.6 - k * 0.3, 1.2, 10).translate(0, y1 + 14 + k * 16, 0), solidMat('antenna', 0xb8bcc2, 0.4, 0.8), b, true);
  mesh(new THREE.SphereGeometry(1, 8, 6).translate(0, 541, 0), glowMat('beacon-white', 0xffffff, 0.8, 6), b);
  return b;
};

const flatiron: Builder = (c) => {
  const b = built();
  // Fallback wedge if the map doesn't have the outline here.
  const wedge = [-26, 28, 26, 28, 1, -58, -1, -58];
  const parts = fromRings(b, c, 'flatiron', 87, wedge, STONE(0xc9bca4));
  for (const p of parts) {
    band(b, p.ring, 0, 7, 0.25, STONE(0xbfb29a), true);
    band(b, p.ring, 78, 2.2, 1.1, STONE(0xcdbfa6));
  }
  return b;
};

const rock30: Builder = () => {
  const b = built();
  const tiers: [number, number, number, number][] = [[100, 45, 0, 25], [92, 31, 25, 170], [80, 29, 170, 205], [66, 27, 205, 232], [50, 25, 232, 259]];
  for (const [w, d, y0, y1] of tiers) tier(b, rect(w, d), y0, y1, 'limestonePier');
  // Top of the Rock: glass rails on the roof.
  mesh(prism(rect(48, 23), 259, 261.5, [1, 1], false), solidMat('glassrail', 0x9fb6c9, 0.1, 0.6), b, true);
  // The rink in the sunken plaza east of the tower, golden Prometheus at its west end, flags around.
  const rx = 76; // the Lower Plaza, across Rockefeller Plaza from the tower's east face
  mesh(new THREE.BoxGeometry(40, 1.1, 28).translate(rx, 0.55, 0), GRANITE(), b, true);
  mesh(new THREE.BoxGeometry(36, 0.2, 24).translate(rx, 1.15, 0), solidMat('ice', 0xe8f2fa, 0.15, 0), b, true);
  mesh(new THREE.TorusGeometry(2.4, 0.5, 8, 16).rotateY(Math.PI / 2).translate(rx - 17, 4.5, 0), solidMat('gold', 0xd9a63a, 0.3, 1), b, true);
  mesh(new THREE.SphereGeometry(1, 10, 8).scale(1, 1.4, 0.7).translate(rx - 17, 4.4, 0), solidMat('gold', 0xd9a63a, 0.3, 1), b, true);
  const poles: THREE.BufferGeometry[] = [], flags: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 24; i++) {
    const t = i / 24, x = rx - 20 + (t < 0.5 ? t * 2 * 40 : (1 - (t - 0.5) * 2) * 40), z = t < 0.5 ? -15 : 15;
    poles.push(new THREE.CylinderGeometry(0.06, 0.08, 9, 5).translate(x, 4.5, z));
    flags.push(new THREE.PlaneGeometry(1.6, 1).translate(x + 0.8, 8.3, z));
  }
  const pm = merged(poles, solidMat('flagpole', 0xd8d8d8, 0.4, 0.8)); b.group.add(pm); b.detail.push(pm);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: false, side: THREE.DoubleSide, roughness: 0.9 });
  const fm = merged(flags, flagMat);
  const cols = new Float32Array(fm.geometry.getAttribute('position').count * 3);
  const palette = [0xc8102e, 0x003da5, 0x009739, 0xffcd00, 0xffffff, 0x00205b];
  for (let i = 0; i < cols.length / 3; i++) new THREE.Color(palette[Math.floor(i / 6) % palette.length]).toArray(cols, i * 3);
  fm.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  flagMat.vertexColors = true;
  b.group.add(fm); b.detail.push(fm);
  return b;
};

const metlife: Builder = (c) => {
  const b = built();
  const y0 = Math.max(0, Math.min(40, c.minY || 0));
  const oct = [-46, -12, -30, -22, 30, -22, 46, -12, 46, 12, 30, 22, -30, 22, -46, 12];
  tier(b, rect(70, 44), Math.max(-1.5, y0 - 1), y0 + 6, 'precast');
  tier(b, oct, y0 + 6, 228, 'precast');
  // Recessed mechanical floors at the top, then the crown.
  tier(b, offsetRing(oct, -1.2), 228, 238, 'precast', { mat: DARK() });
  tier(b, oct, 238, 246, 'precast');
  band(b, oct, 72, 3, -0.3, DARK(), true);
  return b;
};

const grandCentral: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'beaux', 32, rect(110, 84), STONE(0xd6cbb6));
  // The 42nd Street front: three great arched windows, paired columns, and the clock with its statues.
  const fr = frontEdge(parts.map((p) => p.ring), 0, 1);
  if (fr) {
    const mx = (fr.ax + fr.bx) / 2, mz = (fr.az + fr.bz) / 2, ux = (fr.bx - fr.ax) / fr.len, uz = (fr.bz - fr.az) / fr.len;
    const rot = Math.atan2(fr.nx, fr.nz);
    const glass = glowMat('gct-win', 0xffd9a0, 0.02, 3);
    for (const k of [-1, 0, 1]) {
      const x = mx + ux * k * 16 + fr.nx * 0.3, z = mz + uz * k * 16 + fr.nz * 0.3;
      const arch = new THREE.Shape(); arch.moveTo(-5, 0); arch.lineTo(-5, 14); arch.absarc(0, 14, 5, Math.PI, 0, true); arch.lineTo(5, 0); arch.lineTo(-5, 0);
      mesh(placed(new THREE.ShapeGeometry(arch, 12), x, 6, z, rot), glass, b);
    }
    const cols: THREE.BufferGeometry[] = [];
    for (const k of [-24, -21, -8, -5, 5, 8, 21, 24]) cols.push(new THREE.CylinderGeometry(0.9, 1, 18, 10).translate(mx + ux * k + fr.nx * 1.4, 13, mz + uz * k + fr.nz * 1.4));
    const cm = merged(cols, STONE(0xe6dece)); b.group.add(cm); b.detail.push(cm);
    // Glory of Commerce: a copper sculpture group with the clock in front.
    mesh(new THREE.BoxGeometry(14, 6, 3).translate(0, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(rot).setPosition(mx + fr.nx * 0.5, 33, mz + fr.nz * 0.5)), COPPER(), b, true);
    mesh(placed(new THREE.CylinderGeometry(2, 2, 0.4, 20).rotateX(Math.PI / 2), mx + fr.nx * 2.2, 30, mz + fr.nz * 2.2, rot), glowMat('clockface', 0xfff4dc, 0.3, 3), b, true);
  }
  return b;
};

/** A seated lion on a pedestal (the Library's Patience and Fortitude). */
function lion(): THREE.BufferGeometry[] {
  return [
    new THREE.BoxGeometry(2.4, 1.6, 6).translate(0, 0.8, 0),
    new THREE.CylinderGeometry(0.75, 0.9, 3.6, 10).rotateX(Math.PI / 2).translate(0, 2.25, 0.2),
    new THREE.SphereGeometry(1.05, 10, 8).scale(1, 1.05, 1).translate(0, 3.1, 1.9),
    new THREE.SphereGeometry(0.55, 8, 6).translate(0, 2.9, 2.75),
    new THREE.BoxGeometry(0.4, 1, 1).translate(-0.6, 2, 2.2), new THREE.BoxGeometry(0.4, 1, 1).translate(0.6, 2, 2.2),
  ];
}

const nypl: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'beaux', 27, rect(110, 60), STONE(0xd8cfbd));
  const fr = frontEdge(parts.map((p) => p.ring), 1, 0); // Fifth Avenue, on the east side
  if (fr) {
    const mx = (fr.ax + fr.bx) / 2, mz = (fr.az + fr.bz) / 2, ux = (fr.bx - fr.ax) / fr.len, uz = (fr.bz - fr.az) / fr.len;
    const rot = Math.atan2(fr.nx, fr.nz);
    const at = (along: number, out: number, y: number) => new THREE.Vector3(mx + ux * along + fr.nx * out, y, mz + uz * along + fr.nz * out);
    // The broad front steps.
    const steps: THREE.BufferGeometry[] = [];
    for (let s = 0; s < 6; s++) { const p = at(0, 2 + (6 - s) * 1.1, 0); steps.push(placed(new THREE.BoxGeometry(46, 0.4 + s * 0.35, 1.2), p.x, (0.4 + s * 0.35) / 2, p.z, rot)); }
    b.group.add(merged(steps, STONE(0xe2dacb)));
    // Portico: three arches between paired columns.
    const cols: THREE.BufferGeometry[] = [];
    for (const k of [-15, -12.5, -5.5, -3, 3, 5.5, 12.5, 15]) { const p = at(k, 1.4, 0); cols.push(new THREE.CylinderGeometry(0.7, 0.8, 13, 10).translate(p.x, 9, p.z)); }
    const cm = merged(cols, STONE(0xece5d6)); b.group.add(cm); b.detail.push(cm);
    for (const k of [-9, 0, 9]) {
      const p = at(k, 0.3, 0);
      const arch = new THREE.Shape(); arch.moveTo(-2.6, 0); arch.lineTo(-2.6, 7); arch.absarc(0, 7, 2.6, Math.PI, 0, true); arch.lineTo(2.6, 0); arch.lineTo(-2.6, 0);
      mesh(placed(new THREE.ShapeGeometry(arch, 10), p.x, 2.6, p.z, rot), glowMat('nypl-door', 0xffd49a, 0.02, 2.5), b);
    }
    // Patience and Fortitude.
    for (const k of [-20, 20]) {
      const p = at(k, 9, 0);
      const ped = placed(new THREE.BoxGeometry(3, 2.2, 6.5), p.x, 1.1, p.z, rot);
      const lm = merged([ped, ...lion().map((g) => placed(g, p.x, 2.2, p.z, rot))], STONE(0xe7ddcc));
      b.group.add(lm); b.detail.push(lm);
    }
  }
  return b;
};

const stPatricks: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'cathedral', 32, rect(100, 52), STONE(0xe2ddd2));
  const bb = bbox(c, 100, 52);
  // A steep gabled roof over the nave, ridge along the long axis.
  const long = bb.x1 - bb.x0 >= bb.z1 - bb.z0;
  const L = long ? bb.x1 - bb.x0 : bb.z1 - bb.z0, Wd = (long ? bb.z1 - bb.z0 : bb.x1 - bb.x0) * 0.62;
  const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
  const roofShape = new THREE.Shape([new THREE.Vector2(-Wd / 2, 0), new THREE.Vector2(Wd / 2, 0), new THREE.Vector2(0, 14)]);
  const roof = new THREE.ExtrudeGeometry(roofShape, { depth: L * 0.82, bevelEnabled: false }).translate(0, 0, -L * 0.41);
  mesh(placed(roof, cx, 32, cz, long ? Math.PI / 2 : 0), solidMat('cath-roof', 0x7a8a86, 0.7, 0.2), b);
  // Twin spires on the Fifth Avenue (west) front.
  const fx = long ? bb.x0 + 7 : cx, fz = long ? cz : bb.z1 - 7;
  for (const s of [-1, 1]) {
    const x = long ? fx : cx + s * (Wd / 2 + 1), z = long ? cz + s * (Wd / 2 + 1) : fz;
    tier(b, rect(10, 10, x, z), 0, 58, 'cathedral');
    tier(b, ngon(8, 5.2, Math.PI / 8, x, z), 58, 66, 'cathedral', { solid: false });
    mesh(pyramid(10.4, 0.3, 66, 101, 8, Math.PI / 8).translate(x, 0, z), STONE(0xe4dfd4), b);
    const pins: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; pins.push(new THREE.ConeGeometry(0.7, 8, 6).translate(x + Math.cos(a) * 6.5, 62, z + Math.sin(a) * 6.5)); }
    const pm = merged(pins, STONE(0xe4dfd4)); b.group.add(pm); b.detail.push(pm);
  }
  void parts;
  return b;
};

const woolworth: Builder = () => {
  const b = built();
  tier(b, rect(60, 46), 0, 112, 'gothic');
  band(b, rect(60, 46), 110, 2.5, 0.8, STONE(0xd9cfb9));
  const tx = 15;
  tier(b, rect(27, 27, tx, 0), 112, 188, 'gothic');
  tier(b, rect(22, 22, tx, 0), 188, 200, 'gothic');
  tier(b, rect(18, 18, tx, 0), 200, 212, 'gothic');
  mesh(pyramid(18, 3, 212, 233).translate(tx, 0, 0), COPPER(), b);
  tier(b, ngon(8, 1.8, 0, tx, 0), 233, 237, 'gothic', { solid: false, mat: COPPER() });
  mesh(new THREE.ConeGeometry(1.4, 4, 8).translate(tx, 239, 0), solidMat('gold', 0xd9a63a, 0.3, 1), b);
  const pins: THREE.BufferGeometry[] = [];
  for (const [w, y] of [[27, 188], [22, 200], [18, 212]] as const) for (const sx of [-1, 1]) for (const sz of [-1, 1]) pins.push(new THREE.ConeGeometry(0.9, 9, 6).translate(tx + sx * w / 2, y + 4.5, sz * w / 2));
  const pm = merged(pins, STONE(0xe4dccb)); b.group.add(pm); b.detail.push(pm);
  return b;
};

const park432: Builder = () => {
  const b = built();
  const w = 28.5;
  let y = 0;
  // Open double-height mechanical floors every twelve stories.
  for (let k = 0; y < 426; k++) {
    const y1 = Math.min(426, y + 44);
    tier(b, rect(w, w), y, y1, 'concreteGrid');
    if (y1 < 420) tier(b, rect(w - 1.2, w - 1.2), y1, y1 + 4.5, 'concreteGrid', { mat: DARK() });
    y = y1 + 4.5;
  }
  return b;
};

const centralParkTower: Builder = () => {
  const b = built();
  tier(b, rect(62, 46), 0, 52, 'blueGlass');
  tier(b, rect(40, 30, 4, 0), 52, 290, 'blueGlass');
  tier(b, rect(36, 28, 2, 0), 290, 400, 'blueGlass');
  tier(b, rect(30, 25), 400, 462, 'blueGlass');
  // White fins up the corners and a crown of fins.
  const fins: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-16, -12.5], [16, -12.5], [16, 12.5], [-16, 12.5]]) fins.push(new THREE.BoxGeometry(1.2, 410, 1.2).translate(x * 1.0, 257, z));
  for (let k = 0; k < 14; k++) fins.push(new THREE.BoxGeometry(0.8, 12, 0.8).translate(-15 + k * 2.3, 468, -12.5), new THREE.BoxGeometry(0.8, 12, 0.8).translate(-15 + k * 2.3, 468, 12.5));
  b.group.add(merged(fins, solidMat('white-fin', 0xf0f0ee, 0.5, 0.1)));
  return b;
};

const steinway: Builder = () => {
  const b = built();
  // A thin terra-cotta blade; its north face feathers back in steps toward the top.
  const W = 18, D = 50;
  tier(b, rect(W, D), 0, 300, 'terracotta');
  for (let k = 0; k < 11; k++) {
    const d = D - k * 3.4, y0 = 300 + k * 11, y1 = y0 + 11;
    tier(b, rect(W, d, 0, (D - d) / 2), y0, y1, 'terracotta');
  }
  mesh(pyramid(W, 0.4, 421, 435).scale(1, 1, 0.8).translate(0, 0, (D - 12) / 2), solidMat('bronze', 0x8a6a45, 0.45, 0.6), b);
  return b;
};

const vessel: Builder = () => {
  const b = built();
  // A copper honeycomb bowl of stairs.
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff'; g.lineWidth = 14;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(64, 0); g.lineTo(128, 64); g.lineTo(64, 128); g.closePath(); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8794b, metalness: 0.85, roughness: 0.35, alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(7.5 + 15.5 * Math.pow(t, 1.3), t * 46)); }
  mesh(new THREE.LatheGeometry(pts, 40), mat, b);
  b.solids.push({ ring: ngon(10, 8), y0: 0, y1: 2 });
  return b;
};

const msg: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'ribs', 42, ngon(36, 64));
  for (const p of parts) {
    const bb = bbox({ rings: [p], minY: 0 });
    const r = Math.min(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2, cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    if (r > 20) mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.98, 4, 36).translate(cx, Math.min(42, p.y1) + 2, cz), solidMat('msg-roof', 0xb3b0aa, 0.8, 0.1), b);
  }
  return b;
};

/** A mansard roof: the wall ring at y0 leaning in by `inset` up to y1, then capped. */
function mansard(b: Built, ring: number[], holes: number[][], y0: number, y1: number, inset: number, mat: THREE.Material) {
  const top = offsetRing(ring, -inset);
  mesh(loft([{ ring, y: y0 }, { ring: top, y: y1 }], [4, 4], holes.length === 0), mat, b);
  for (const h of holes) mesh(loft([{ ring: h, y: y0 }, { ring: offsetRing(h, inset), y: y1 }], [4, 4], false), mat, b);
}

/**
 * The Plaza: the map draws it as dozens of parts, so build the whole block as one French Renaissance
 * château — a rusticated base, the white brick shaft, a copper mansard with dormers and steep corner
 * pavilions, and the Fifth Avenue entrance (canopy and flags) facing Grand Army Plaza.
 */
const plaza: Builder = (c) => {
  const b = built();
  const bb = bbox(c, 84, 62);
  // Keep it to the hotel's block (the map's parts sometimes reach across the side streets).
  const x0 = Math.max(bb.x0, -46), x1 = Math.min(bb.x1, 46), z0 = Math.max(bb.z0, -34), z1 = Math.min(bb.z1, 34);
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ring = rect(w, d, cx, cz);
  tier(b, ring, -1.5, 11, 'beaux', { mat: STONE(0xe6e1d6) });
  band(b, ring, 10.6, 0.8, 0.5, STONE(0xdcd6ca));
  tier(b, offsetRing(ring, -0.3), 11, 62, 'whiteStone');
  band(b, ring, 60.6, 1.4, 0.8, STONE(0xe9e4da));
  mansard(b, offsetRing(ring, -0.3), [], 62, 72, 3.2, COPPER());
  // Dormers all round.
  const dorm: THREE.BufferGeometry[] = [];
  const sides: [number, number, number, number, number][] = [[x0, z0, x1, z0, 0], [x1, z0, x1, z1, 1], [x1, z1, x0, z1, 2], [x0, z1, x0, z0, 3]];
  for (const [ax, az, bx, bz, k] of sides) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = [0, 1, 0, -1][k], nz = [-1, 0, 1, 0][k];
    for (let t = 10; t < len - 9; t += 4.2) dorm.push(placed(new THREE.BoxGeometry(1.8, 2.6, 1.6), ax + ux * t - nx * 1.6, 65.5, az + uz * t - nz * 1.6, Math.atan2(nx, nz)));
  }
  const dm = merged(dorm, STONE(0xf2efe8)); b.group.add(dm); b.detail.push(dm);
  // Corner pavilions: steep hipped copper roofs over the corners, and the flat roof between.
  for (const [px, pz] of [[x0 + 7, z0 + 7], [x1 - 7, z0 + 7], [x1 - 7, z1 - 7], [x0 + 7, z1 - 7]]) {
    tier(b, rect(14, 14, px, pz), 62, 66, 'whiteStone');
    mesh(pyramid(14.4, 2, 66, 80).translate(px, 0, pz), COPPER(), b);
    mesh(new THREE.ConeGeometry(0.3, 3, 6).translate(px, 81.5, pz), solidMat('gilt', 0xc9a24b, 0.35, 0.9), b, true);
  }
  mesh(prism(offsetRing(ring, -3.6), 71.9, 72, [1, 1]), SLATE(), b, true);
  // The Fifth Avenue entrance: a canopy over the steps and three flags above it.
  const ex = x1 + 0.2;
  mesh(new THREE.BoxGeometry(3.2, 0.35, 12).translate(ex + 1.6, 4.2, cz), solidMat('plaza-canopy', 0x2a2b2e, 0.5, 0.4), b, true);
  const poles: THREE.BufferGeometry[] = [], flags: THREE.BufferGeometry[] = [];
  for (const dz of [-6, 0, 6]) {
    poles.push(placed(new THREE.CylinderGeometry(0.07, 0.07, 6, 6), ex + 2.4, 9.5, cz + dz, 0, 0, -0.6));
    flags.push(new THREE.PlaneGeometry(2.6, 1.6).rotateY(Math.PI / 2).translate(ex + 4.0, 10.6, cz + dz + 0.0));
  }
  const pm = merged(poles, STEEL()); b.group.add(pm); b.detail.push(pm);
  const fl = merged(flags, solidMat('plaza-flag', 0xe8e4dc, 0.9, 0)); b.group.add(fl); b.detail.push(fl);
  return b;
};

const dakota: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'brick', 30, rect(62, 62), STONE(0xd6c3a1));
  for (const p of parts) if (p.ring.length <= 400) {
    mansard(b, p.ring, p.holes, Math.min(30, p.y1), Math.min(30, p.y1) + 9, 3.2, SLATE());
    const ch: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.ring.length; i += 6) ch.push(new THREE.BoxGeometry(1.4, 4, 1.4).translate(p.ring[i] * 0.94, Math.min(30, p.y1) + 9, p.ring[i + 1] * 0.94));
    const cm = merged(ch, solidMat('dk-chimney', 0x8d6a4f, 0.9, 0)); b.group.add(cm); b.detail.push(cm);
  }
  return b;
};

const liberty: Builder = () => {
  const b = built();
  const granite = GRANITE(), verd = solidMat('verdigris', 0x7fb8a3, 0.7, 0.15);
  // Fort Wood's eleven-pointed star.
  const star: number[] = [];
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2, r = i % 2 ? 34 : 50; star.push(Math.cos(a) * r, Math.sin(a) * r); }
  tier(b, star, -2, 8, 'beaux', { mat: STONE(0xcfc5b2) });
  tier(b, rect(30, 30), 8, 16, 'beaux', { mat: granite });
  tier(b, rect(20, 20), 16, 38, 'beaux', { mat: granite });
  tier(b, rect(17, 17), 38, 47, 'beaux', { mat: granite });
  // The statue faces -z (her bearing turns her toward the harbor).
  const parts: THREE.BufferGeometry[] = [];
  const robe: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; robe.push(new THREE.Vector2(5.8 - t * 2.4 + Math.sin(t * 9) * 0.15, 47 + t * 28)); }
  parts.push(new THREE.LatheGeometry(robe, 18));
  parts.push(new THREE.SphereGeometry(3.4, 14, 10).scale(1.1, 0.8, 0.85).translate(0, 76.5, 0)); // shoulders
  parts.push(new THREE.CylinderGeometry(0.9, 1.1, 2, 10).translate(0, 79.5, 0)); // neck
  parts.push(new THREE.SphereGeometry(1.75, 14, 12).scale(0.95, 1.1, 1).translate(0, 81.8, -0.2)); // head
  parts.push(new THREE.CylinderGeometry(2.05, 2.05, 0.7, 16).translate(0, 83, -0.1)); // diadem
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (0.15 + (k / 6) * 0.7);
    parts.push(placed(new THREE.ConeGeometry(0.28, 3.8, 4), Math.cos(a) * 2.6, 84.2, -Math.sin(a) * 2.6, 0, -Math.PI / 2 + 0.35, -Math.cos(a) * 1.2));
  }
  // Right arm raised with the torch; left arm cradles the tablet.
  const arm = new THREE.CylinderGeometry(0.75, 0.9, 12, 10);
  parts.push(placed(arm, 2.9, 84, 0.2, 0, 0, -0.18));
  parts.push(new THREE.CylinderGeometry(1.1, 0.6, 1.6, 10).translate(4, 90.6, 0.2)); // torch cup
  parts.push(placed(new THREE.BoxGeometry(1.4, 4.2, 0.7), -3.6, 72, -0.8, 0.3, 0, 0.32)); // tablet
  parts.push(placed(new THREE.CylinderGeometry(0.7, 0.8, 6, 8), -3.2, 73.5, -0.2, 0, 0, 0.6));
  b.group.add(merged(parts, verd));
  mesh(new THREE.ConeGeometry(0.9, 2.6, 10).translate(4, 92.6, 0.2), glowMat('torch', 0xffc23a, 0.8, 6), b);
  b.solids.push({ ring: ngon(8, 5.5), y0: 47, y1: 76 });
  return b;
};

// ------------------------------------------------------------------ bridges

interface BridgeSpec { span: number; side: number; towerH: number; deckH: number; deckW: number; style: 'gothic' | 'deco' }

/** A suspension bridge along x: towers at ±span/2, the deck at deckH above the water (y = 0). */
function suspension(s: BridgeSpec): Built {
  const b = built();
  const half = s.span / 2;
  const towerMat = s.style === 'gothic' ? STONE(0xb9ad98) : solidMat('intl-orange', 0xc0392b, 0.55, 0.2);
  const cableMat = s.style === 'gothic' ? solidMat('bb-cable', 0x6b6f75, 0.6, 0.5) : towerMat;
  for (const sx of [-1, 1]) {
    const x = sx * half;
    if (s.style === 'gothic') {
      // Granite tower with two pointed arches for the roadways.
      const T = s.towerH, D = 20, W = s.deckW + 16, archTop = s.deckH + 34;
      for (const z of [-W / 2 + 4, 0, W / 2 - 4]) tier(b, rect(D, z === 0 ? 7 : 8, x, z), -6, archTop, 'beaux', { mat: towerMat });
      tier(b, rect(D, W, x, 0), archTop, T, 'beaux', { mat: towerMat });
      band(b, rect(D, W, x, 0), T - 3, 1.5, 0.8, STONE(0xa9a08f));
      for (const z of [-W / 4 + 0.5, W / 4 - 0.5]) {
        const arch = new THREE.Shape([new THREE.Vector2(-5.5, 0), new THREE.Vector2(5.5, 0), new THREE.Vector2(0, 7)]);
        for (const face of [-1, 1]) mesh(placed(new THREE.ShapeGeometry(arch), x + face * (D / 2 + 0.05), archTop - 0.2, z, face * Math.PI / 2), towerMat, b);
      }
    } else {
      // Art-deco steel tower: two legs tapering up, joined by portal struts.
      const T = s.towerH, gap = s.deckW / 2 + 3;
      for (const z of [-gap, gap]) {
        mesh(loft([{ ring: rect(10, 10, x, z), y: -6 }, { ring: rect(7, 7, x, z), y: T }], [4, 4]), towerMat, b);
        b.solids.push({ ring: rect(10, 10, x, z), y0: -6, y1: T });
      }
      for (const y of [s.deckH + 28, s.deckH + 70, s.deckH + 110, T - 6]) mesh(new THREE.BoxGeometry(6, 9, gap * 2).translate(x, y, 0), towerMat, b);
    }
  }
  // Main cables (catenary-ish parabolas) and the side spans down to the anchorages.
  const cableY = (xx: number) => {
    const ax = Math.abs(xx);
    if (ax <= half) return s.deckH + 3 + (s.towerH - 3 - s.deckH - 3) * (ax / half) ** 2;
    const t = (ax - half) / s.side;
    return s.towerH - 3 + (s.deckH + 1 - (s.towerH - 3)) * t * (2 - t * 0.7);
  };
  const zs = s.style === 'gothic' ? [-s.deckW / 2 + 1, -s.deckW / 6, s.deckW / 6, s.deckW / 2 - 1] : [-(s.deckW / 2 + 3), s.deckW / 2 + 3];
  const tubes: THREE.BufferGeometry[] = [];
  for (const z of zs) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) { const xx = -half - s.side + ((s.span + s.side * 2) * i) / 80; pts.push(new THREE.Vector3(xx, cableY(xx), z)); }
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, s.style === 'gothic' ? 0.35 : 0.6, 6, false));
  }
  b.group.add(merged(tubes, cableMat));
  // Suspenders, and Brooklyn's diagonal stays.
  const lines: number[] = [];
  for (const z of zs) {
    for (let xx = -half - s.side + 6; xx < half + s.side - 6; xx += s.style === 'gothic' ? 6 : 15) {
      const cy = cableY(xx);
      if (cy - s.deckH > 1.5) lines.push(xx, s.deckH, z, xx, cy, z);
    }
    if (s.style === 'gothic') for (const sx of [-1, 1]) for (let k = 1; k <= 14; k++) {
      const x0 = sx * half, x1 = sx * (half - k * 12);
      lines.push(x0, s.towerH - 6, z, x1, s.deckH, z);
      const x2 = sx * (half + k * 12);
      if (Math.abs(x2) < half + s.side) lines.push(x0, s.towerH - 6, z, x2, s.deckH, z);
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: s.style === 'gothic' ? 0x4c5258 : 0xb23a2b }));
  b.group.add(ls);
  if (s.style === 'deco') {
    // The stiffening truss under the deck.
    const t = new THREE.BoxGeometry(s.span + s.side * 2, 7.6, s.deckW + 2).translate(0, s.deckH - 4.5, 0);
    mesh(t, towerMat, b);
  }
  return b;
}

const brooklynBridge: Builder = (c) => suspension({ span: c.span ?? 486, side: 283, towerH: 84, deckH: 40, deckW: 26, style: 'gothic' });
const goldenGate: Builder = (c) => suspension({ span: c.span ?? 1280, side: 343, towerH: 227, deckH: 67, deckW: 27, style: 'deco' });

// ------------------------------------------------------------------ elsewhere

/** A lattice tower: four legs that gather into one shaft, with observation platforms. */
function latticeTower(levels: [number, number][], platforms: [number, number, number][], antenna: [number, number], colorA: number, colorB: number | null, bandH: number): Built {
  const b = built();
  const latt = (color: number, key: string) => {
    const cached = LATT.cache.get(color);
    if (cached) return cached;
    const base = facadeMat('lattice');
    const m = base.clone();
    LATT.cache.set(color, m);
    LATT.nightMats.push(m);
    m.color.setHex(color);
    m.emissive.setHex(0xffb54a); m.emissiveMap = base.map; m.emissiveIntensity = 0; m.userData.glow = 0.9;
    m.name = key;
    return m;
  };
  const matA = latt(colorA, 'lattA'), matB = colorB !== null ? latt(colorB, 'lattB') : matA;
  // Shaft: a hollow square frustum through the profile levels, alternating paint bands.
  for (let i = 0; i + 1 < levels.length; i++) {
    const [y0, hw0] = levels[i], [y1, hw1] = levels[i + 1];
    const steps = Math.max(1, Math.round((y1 - y0) / bandH));
    for (let k = 0; k < steps; k++) {
      const ya = y0 + ((y1 - y0) * k) / steps, yb = y0 + ((y1 - y0) * (k + 1)) / steps;
      const ha = hw0 + ((hw1 - hw0) * k) / steps, hb = hw0 + ((hw1 - hw0) * (k + 1)) / steps;
      const m = (Math.floor(ya / bandH) % 2 === 0) ? matA : matB;
      mesh(loft([{ ring: rect(ha * 2, ha * 2), y: ya }, { ring: rect(hb * 2, hb * 2), y: yb }], [6, 6], false), m, b);
    }
  }
  for (const [y, hw, t] of platforms) {
    mesh(prism(rect(hw * 2, hw * 2), y, y + t, [1, 1]), solidMat(`plat-${colorA}`, colorA, 0.7, 0.2), b);
    mesh(prism(rect(hw * 1.6, hw * 1.6), y + t, y + t + 3, [1, 1], false), glowMat('deck-win', 0xffe6b0, 0.1, 2.5), b);
  }
  mesh(new THREE.CylinderGeometry(0.3, 1.4, antenna[1] - antenna[0], 6).translate(0, (antenna[0] + antenna[1]) / 2, 0), matA, b);
  const legW = levels[0][1];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.solids.push({ ring: rect(10, 10, sx * (legW - 5), sz * (legW - 5)), y0: 0, y1: levels[1][0] });
  return b;
}
const LATT = { nightMats: [] as THREE.MeshStandardMaterial[], cache: new Map<number, THREE.MeshStandardMaterial>(), dial: null as THREE.MeshStandardMaterial | null };
export const latticeNight = LATT.nightMats;

const eiffel: Builder = () => {
  const b = latticeTower([[0, 62], [24, 46], [57, 35], [85, 26], [115, 19], [160, 13], [210, 8.5], [276, 5]], [[57, 35, 6], [115, 20, 4], [276, 6, 4]], [280, 330], 0x7a6248, null, 1000);
  // The great arches between the legs under the first floor.
  for (const a of [0, Math.PI / 2]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20, x = -40 + t * 80; pts.push(new THREE.Vector3(x, 14 + 25 * Math.sin(t * Math.PI), 0)); }
    for (const s of [-1, 1]) {
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 1.1, 6).translate(0, 0, s * 44);
      mesh(g.rotateY(a), solidMat('eiffel-iron', 0x7a6248, 0.6, 0.3), b, true);
    }
  }
  return b;
};

const tokyoTower: Builder = () => latticeTower([[0, 40], [30, 30], [90, 18], [150, 11], [200, 7], [250, 4.5]], [[145, 16, 10], [250, 6, 6]], [256, 333], 0xe8501f, 0xf2f2ee, 28);

const bigBen: Builder = () => {
  const b = built();
  const gold = solidMat('gilt', 0xc9a24b, 0.35, 0.9);
  tier(b, rect(12, 12), 0, 55, 'gothic', { mat: facadeMat('gothic') });
  tier(b, rect(13.5, 13.5), 55, 70, 'gothic');
  // Four lit clock dials.
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4ecd8'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a2a2a'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#222'; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rn = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  rn.forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(t, 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); });
  g.lineWidth = 8; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 52); g.moveTo(128, 128); g.lineTo(178, 140); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const dial = LATT.dial ??= new THREE.MeshStandardMaterial({ map: tex, emissive: 0xfff2d0, emissiveMap: tex, emissiveIntensity: 0.05, roughness: 0.5 });
  if (!dial.userData.glow) { dial.userData.glow = 1.4; LATT.nightMats.push(dial); }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    mesh(placed(new THREE.CircleGeometry(3.5, 32), Math.sin(a) * 6.8, 62.5, Math.cos(a) * 6.8, a), dial, b);
  }
  tier(b, rect(11, 11), 70, 80, 'gothic', { mat: DARK() });
  mesh(pyramid(12, 0.4, 80, 96), solidMat('bb-roof', 0x3d4652, 0.6, 0.4), b);
  const pins: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pins.push(new THREE.ConeGeometry(0.6, 7, 6).translate(sx * 6, 74, sz * 6));
  const pm = merged(pins, gold); b.group.add(pm); b.detail.push(pm);
  return b;
};

const transamerica: Builder = () => {
  const b = built();
  const sq = (w: number) => rect(w, w);
  mesh(loft([{ ring: sq(53), y: 0 }, { ring: sq(14), y: 212 }], [3.4, 3.7]), facadeMat('whiteStone'), b);
  b.solids.push({ ring: sq(48), y0: 0, y1: 90 }, { ring: sq(30), y0: 90, y1: 160 }, { ring: sq(18), y0: 160, y1: 212 });
  for (const sx of [-1, 1]) tier(b, rect(9, 10, sx * 11.5, 0), 118, 224, 'whiteStone');
  mesh(loft([{ ring: sq(14), y: 212 }, { ring: sq(0.4), y: 260 }], [2, 2]), solidMat('ta-spire', 0xeeece6, 0.6, 0.1), b);
  return b;
};

// ------------------------------------------------------------------ shared pieces

let TREE_GEO: THREE.BufferGeometry | null = null;
/** Trees with the city's own crown model and wind (x, z, scale), instanced. */
function trees(b: Built, pts: [number, number, number][], y = 0) {
  TREE_GEO ??= lollipopTree();
  const im = new THREE.InstancedMesh(TREE_GEO, treeMat, pts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  pts.forEach(([x, z, s], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, i * 2.1), new THREE.Vector3(s, s, s))));
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pts.length * 3).fill(1), 3);
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  b.group.add(im); b.detail.push(im);
}

const WATER = () => solidMat('lm-water', 0x5f8296, 0.06, 0.35);
const MARBLE = () => solidMat('lm-marble', 0xeeebe4, 0.4, 0);
const STEEL = () => solidMat('lm-steel', 0xd6dadf, 0.18, 1);

let GLASS: THREE.MeshStandardMaterial | null = null;
/** Clear structural glass: mostly reflections, a hint of green at the edges. */
function clearGlass() {
  return GLASS ??= new THREE.MeshStandardMaterial({ color: 0xd9e8e6, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
}

/** A rectangular basin: granite rim, water surface, a row of jets. */
function fountain(b: Built, cx: number, cz: number, w: number, d: number, jets = 0) {
  const rim: THREE.BufferGeometry[] = [];
  const t = 0.45, h = 0.5;
  rim.push(new THREE.BoxGeometry(w, h, t).translate(cx, h / 2, cz - d / 2 + t / 2), new THREE.BoxGeometry(w, h, t).translate(cx, h / 2, cz + d / 2 - t / 2));
  rim.push(new THREE.BoxGeometry(t, h, d).translate(cx - w / 2 + t / 2, h / 2, cz), new THREE.BoxGeometry(t, h, d).translate(cx + w / 2 - t / 2, h / 2, cz));
  const rm = merged(rim, GRANITE()); b.group.add(rm); b.detail.push(rm);
  mesh(new THREE.BoxGeometry(w - t * 2, 0.05, d - t * 2).translate(cx, h - 0.12, cz), WATER(), b, true);
  if (jets) {
    const js: THREE.BufferGeometry[] = [];
    for (let k = 0; k < jets; k++) js.push(new THREE.CylinderGeometry(0.03, 0.08, 1.4, 6).translate(cx - w / 2 + 0.9 + ((w - 1.8) * (k + 0.5)) / jets, h + 0.6, cz));
    const jm = merged(js, solidMat('lm-jet', 0xf4f8fa, 0.2, 0, 0xffffff, 0.15)); b.group.add(jm); b.detail.push(jm);
  }
}

/** A front face with an arched opening, extruded from z0 to z1 (opening runs along z). */
function archSlab(w: number, h: number, ow: number, spring: number, z0: number, z1: number, notchH = 0) {
  const s = new THREE.Shape();
  const r = ow / 2;
  if (notchH > 0) {
    // Middle slab of a two-way arch: the side passages leave the piers open below notchH.
    s.moveTo(-w / 2, notchH); s.lineTo(-r, notchH);
  } else { s.moveTo(-w / 2, 0); s.lineTo(-r, 0); }
  s.lineTo(-r, spring); s.absarc(0, spring, r, Math.PI, 0, true); s.lineTo(r, notchH > 0 ? notchH : 0);
  s.lineTo(w / 2, notchH > 0 ? notchH : 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, z0);
}

// ------------------------------------------------------------------ Fifth Avenue at 59th

/**
 * Apple Fifth Avenue: the 32-foot glass cube over the store underground, on the General Motors
 * Building's plaza — the cylindrical glass lift and the spiral stair's well inside, fountains to the
 * north and south, honey locusts in granite planters, and the round "skylenses" lighting the store.
 */
const appleCube: Builder = () => {
  const b = built();
  const S = 9.75, h = S / 2;
  const glass = clearGlass();
  // Five panes of glass (four walls and the roof), each wall three panels with silicone joints.
  mesh(new THREE.BoxGeometry(S, S, S).translate(0, h, 0), glass, b);
  const seams: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const k of [-1, 1]) {
    seams.push(new THREE.BoxGeometry(0.03, S, 0.03).translate(k * S / 6, h, sx * h), new THREE.BoxGeometry(0.03, S, 0.03).translate(sx * h, h, k * S / 6));
    seams.push(new THREE.BoxGeometry(0.03, 0.03, S).translate(k * S / 6, S, 0));
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) seams.push(new THREE.BoxGeometry(0.05, S, 0.05).translate(x * h, h, z * h));
  for (const sx of [-1, 1]) seams.push(new THREE.BoxGeometry(S, 0.05, 0.05).translate(0, S, sx * h), new THREE.BoxGeometry(0.05, 0.05, S).translate(sx * h, S, 0));
  const sm = merged(seams, solidMat('apple-seam', 0x9aa3a8, 0.4, 0.6)); b.group.add(sm);
  // Glass fins behind the joints.
  const fins: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const k of [-1, 1]) fins.push(new THREE.BoxGeometry(0.03, S - 0.1, 0.45).translate(k * S / 6, h, sx * (h - 0.25)), new THREE.BoxGeometry(0.45, S - 0.1, 0.03).translate(sx * (h - 0.25), h, k * S / 6));
  const fm = merged(fins, glass); b.group.add(fm); b.detail.push(fm);
  // The stair well and the glass lift.
  mesh(new THREE.CircleGeometry(3.3, 40).rotateX(-Math.PI / 2).translate(0, 0.03, 0), solidMat('apple-well', 0x2a2c30, 0.6, 0), b, true);
  mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.05, 40, 1, true).translate(0, 0.55, 0), glass, b, true);
  mesh(new THREE.TorusGeometry(3.4, 0.04, 6, 48).rotateX(Math.PI / 2).translate(0, 1.08, 0), STEEL(), b, true);
  mesh(new THREE.CylinderGeometry(1.25, 1.25, 3.2, 32, 1, true).translate(0, 1.6, 0), glass, b, true);
  mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 32).translate(0, 3.25, 0), STEEL(), b, true);
  // The first turns of the spiral stair, curling down into the well.
  const treads: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 1.5; treads.push(placed(new THREE.BoxGeometry(1.7, 0.04, 0.42), Math.cos(a) * 2.3, -0.18 * k, -Math.sin(a) * 2.3, a)); }
  const tm = merged(treads, glass); b.group.add(tm); b.detail.push(tm);
  // Plaza: fountains to the north and south of the cube, trees in granite planters along the edges.
  for (const sz of [-1, 1]) fountain(b, 5, sz * 15.5, 13, 5.5, 9);
  const planters: THREE.BufferGeometry[] = [];
  const tp: [number, number, number][] = [];
  for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) {
    const x = -6 + k * 7.5, z = sz * 24.5;
    planters.push(new THREE.BoxGeometry(4.2, 0.46, 3.2).translate(x, 0.23, z));
    tp.push([x, z, 1.05 + ((k * 7) % 3) * 0.08]);
  }
  const pl = merged(planters, GRANITE()); b.group.add(pl); b.detail.push(pl);
  trees(b, tp, 0.46);
  // Skylenses: round skylights, flush with the paving or raised to sit on.
  const rims: THREE.BufferGeometry[] = [], lenses: THREE.BufferGeometry[] = [];
  const spots: [number, number, number][] = [
    [-9, -8, 0], [-9, 0, 0.42], [-9, 8, 0], [-13, -4, 0], [-13, 4, 0],
    [9, -9, 0], [9, 9, 0], [13, -4, 0.42], [13, 4, 0.42], [17, -9, 0], [17, 0, 0], [17, 9, 0],
    [21, -4, 0.42], [21, 4, 0], [0, -9.5, 0], [0, 9.5, 0], [25, -9, 0], [25, 9, 0],
  ];
  for (const [x, z, hh] of spots) {
    const r = hh > 0 ? 1.15 : 0.85;
    rims.push(new THREE.CylinderGeometry(r, r + 0.05, hh + 0.06, 28).translate(x, (hh + 0.06) / 2, z));
    lenses.push(new THREE.CircleGeometry(r - 0.08, 28).rotateX(-Math.PI / 2).translate(x, hh + 0.065, z));
  }
  const rmm = merged(rims, STEEL()); b.group.add(rmm); b.detail.push(rmm);
  const lm = merged(lenses, solidMat('apple-lens', 0xcfe2ea, 0.05, 0.2, 0xf4fbff, 0.25)); b.group.add(lm); b.detail.push(lm);
  b.solids.push({ ring: rect(S, S), y0: 0, y1: S });
  for (const sz of [-1, 1]) b.solids.push({ ring: rect(13, 5.5, 5, sz * 15.5), y0: 0, y1: 0.5 });
  return b;
};

/** The General Motors Building: 50 floors of white Georgia marble piers over black windows. */
const gmBuilding: Builder = (c) => {
  const b = built();
  // The map also has the whole block (podium and plaza) at full height: build the slab only.
  const slab = c.rings.filter((r) => Math.abs(area(r.ring)) < 4500 && r.ring.length <= 400);
  const parts = slab.length ? slab : [{ ring: rect(46, 62), holes: [] as number[][], y0: 0, y1: 214 }];
  for (const p of parts) {
    const top = Math.max(180, Math.min(216, p.y1));
    tier(b, p.ring, Math.max(-1.5, p.y0), top - 4, 'gmMarble');
    tier(b, offsetRing(p.ring, -0.6), top - 4, top, 'gmMarble', { mat: DARK() });
    band(b, p.ring, top - 0.4, 0.6, 0.15, MARBLE());
  }
  return b;
};

/** Rockefeller Center's Channel Gardens: the six pools with their fountainheads, and the planted beds. */
const channelGardens: Builder = () => {
  const b = built();
  // The promenade runs west (−x) from Fifth Avenue down to the Lower Plaza; beds and pools in a line.
  for (let k = 0; k < 6; k++) {
    const x = 28 - k * 11;
    const beds = [new THREE.BoxGeometry(9, 0.6, 2.4).translate(x, 0.3, -4.2), new THREE.BoxGeometry(9, 0.6, 2.4).translate(x, 0.3, 4.2)];
    const bm = merged(beds, GRANITE()); b.group.add(bm); b.detail.push(bm);
    // Seasonal planting on the beds.
    const fl = merged([new THREE.BoxGeometry(8.4, 0.25, 1.9).translate(x, 0.72, -4.2), new THREE.BoxGeometry(8.4, 0.25, 1.9).translate(x, 0.72, 4.2)], solidMat('cg-flowers', [0x6f9a3c, 0xc94a6a, 0xe0b23a][k % 3], 0.9, 0));
    b.group.add(fl); b.detail.push(fl);
    fountain(b, x, 0, 8, 2.6, 0);
    mesh(new THREE.ConeGeometry(0.35, 0.9, 8).translate(x + 3.3, 0.9, 0), COPPER(), b, true);
  }
  return b;
};

// ------------------------------------------------------------------ Washington Square

const washArch: Builder = () => {
  const b = built();
  const W = 18.9, H = 23.5, D = 4.6, ow = 9.1, spring = 14.3 - ow / 2;
  mesh(archSlab(W, H - 3.6, ow, spring, -D / 2, D / 2), MARBLE(), b);
  // Attic and cornice; the piers' plinths.
  mesh(new THREE.BoxGeometry(W + 0.8, 0.9, D + 0.8).translate(0, H - 3.6 + 0.45, 0), MARBLE(), b);
  mesh(new THREE.BoxGeometry(W - 0.4, 2.7, D - 0.2).translate(0, H - 1.35, 0), MARBLE(), b);
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry((W - ow) / 2 + 0.4, 1.2, D + 0.6).translate(sx * (ow / 2 + (W - ow) / 4), 0.6, 0), MARBLE(), b, true);
  // Washington statues on the north face's piers (dark against the marble), and the spandrel figures.
  const st: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    st.push(new THREE.BoxGeometry(2.0, 0.6, 1.1).translate(sx * 7.0, 1.5, -D / 2 - 0.6));
    st.push(new THREE.CylinderGeometry(0.5, 0.65, 3.4, 8).translate(sx * 7.0, 3.5, -D / 2 - 0.6));
    st.push(new THREE.SphereGeometry(0.36, 8, 6).translate(sx * 7.0, 5.5, -D / 2 - 0.6));
    for (const sz of [-1, 1]) st.push(placed(new THREE.BoxGeometry(4.2, 1.4, 0.3), sx * 6.2, spring + 3.2, sz * (D / 2 + 0.12), 0, 0, sx * -0.5));
  }
  const sm = merged(st, STONE(0xd7d2c8)); b.group.add(sm); b.detail.push(sm);
  for (const sx of [-1, 1]) b.solids.push({ ring: rect((W - ow) / 2, D, sx * (ow / 2 + (W - ow) / 4), 0), y0: 0, y1: H });
  b.solids.push({ ring: rect(W, D), y0: 14.3, y1: H });
  return b;
};

// ------------------------------------------------------------------ Paris

/** Arc de Triomphe: the great arch along the Champs-Élysées axis, the cross arches, attic, reliefs. */
const arcTriomphe: Builder = () => {
  const b = built();
  const W = 44.8, D = 22.2, H = 50, ow = 14.6, spring = 29.2 - ow / 2, side = 18.7;
  const stone = STONE(0xdcd2bc);
  // Front and back piers (the main arch cut through), and the middle with the side passages.
  mesh(archSlab(W, H, ow, spring, -D / 2, -4.2), stone, b);
  mesh(archSlab(W, H, ow, spring, 4.2, D / 2), stone, b);
  mesh(archSlab(W, H, ow, spring, -4.2, 4.2, side), stone, b);
  // Cornices: above the arches and the attic's crown.
  mesh(new THREE.BoxGeometry(W + 1.6, 1.6, D + 1.6).translate(0, 37.8, 0), STONE(0xd2c7ae), b);
  mesh(new THREE.BoxGeometry(W + 1.0, 1.2, D + 1.0).translate(0, H - 0.6, 0), STONE(0xd2c7ae), b);
  mesh(new THREE.BoxGeometry(W + 0.6, 0.8, D + 0.6).translate(0, 21.5, 0), STONE(0xd2c7ae), b, true);
  // The four great sculpture groups on the piers, the frieze, and the attic's shields.
  const rel: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (ow / 2 + (W / 2 - ow / 2) / 2);
    rel.push(new THREE.BoxGeometry(9.5, 11.5, 0.9).translate(x, 9.5, sz * (D / 2 + 0.45)));
    rel.push(new THREE.BoxGeometry(8.5, 4.2, 0.4).translate(x, 24.5, sz * (D / 2 + 0.2)));
  }
  for (const sz of [-1, 1]) rel.push(new THREE.BoxGeometry(W, 3.2, 0.35).translate(0, 34.4, sz * (D / 2 + 0.18)));
  const rm = merged(rel, STONE(0xcfc4ab)); b.group.add(rm); b.detail.push(rm);
  const shields: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) for (let k = 0; k < 15; k++) shields.push(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 12).rotateX(Math.PI / 2).translate(-W / 2 + 2 + k * ((W - 4) / 14), 44, sz * (D / 2 + 0.15)));
  const shm = merged(shields, STONE(0xd8ceb6)); b.group.add(shm); b.detail.push(shm);
  // Place Charles-de-Gaulle's island is cobbled granite setts, not lawn.
  mesh(new THREE.CircleGeometry(48, 64).rotateX(-Math.PI / 2).translate(0, 0.06, 0), solidMat('setts', 0x9c968c, 0.95, 0), b);
  // The Unknown Soldier's flame under the arch.
  mesh(new THREE.ConeGeometry(0.35, 1.1, 8).translate(0, 0.6, 0), glowMat('arc-flame', 0xff9a3a, 2, 3), b, true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solids.push({ ring: rect((W - ow) / 2, (D - 8.4) / 2, sx * (ow / 2 + (W - ow) / 4), sz * (4.2 + (D - 8.4) / 4)), y0: 0, y1: H });
  b.solids.push({ ring: rect(W, D), y0: 29.2, y1: H });
  return b;
};

/** The Louvre Pyramid: glass on a diamond steel net, three pyramidions and the triangular pools. */
const louvrePyramid: Builder = () => {
  const b = built();
  const net = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 128, 128); g.strokeStyle = '#d9dde0'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.stroke();
    g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.35 });
  })();
  const glass = clearGlass();
  const big = (w: number, h: number, x: number, z: number) => {
    mesh(pyramid(w, 0.05, 0, h).translate(x, 0, z), glass, b);
    const g = pyramid(w, 0.05, 0, h, 4, Math.PI / 4).translate(x, 0, z);
    // Net tiles ~3 m: rescale the loft's UVs (tiled in 2 m) to the lozenge size.
    const uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.66, uv.getY(i) * 0.66 * 1.45);
    mesh(g, net, b, w > 10 ? false : true);
  };
  big(35.4, 21.6, 0, 0);
  for (const [x, z] of [[0, -28], [0, 28], [28, 0]]) big(5.3, 3.4, x, z);
  // Pools around it (seven triangles in the real plaza; four large ones here) with granite rims.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tri = new THREE.Shape([new THREE.Vector2(sx * 20, sz * 20), new THREE.Vector2(sx * 38, sz * 20), new THREE.Vector2(sx * 20, sz * 38)]);
    const wg = new THREE.ShapeGeometry(tri).rotateX(-Math.PI / 2).translate(0, 0.37, 0);
    mesh(wg, WATER(), b, true);
    const rim = new THREE.ExtrudeGeometry(tri, { depth: 0.35, bevelEnabled: false }).rotateX(-Math.PI / 2);
    mesh(rim, GRANITE(), b, true);
  }
  b.solids.push({ ring: rect(30, 30), y0: 0, y1: 8 }, { ring: rect(18, 18), y0: 8, y1: 15 });
  return b;
};

/** A pitched roof along x (ridge at the center), from x0 to x1, eaves at ±hw. */
function gable(x0: number, x1: number, hw: number, y0: number, ridge: number) {
  const s = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, ridge - y0)]);
  return new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(x1, y0, 0);
}

/** Notre-Dame de Paris: the west front with its two towers and rose, the nave and its flying buttresses, the spire. */
const notreDame: Builder = () => {
  const b = built();
  const lead = solidMat('nd-lead', 0x737b82, 0.55, 0.35);
  // Aisles and chapels, then the clerestory over the nave, transept and choir.
  tier(b, rect(88, 40, -4, 0), 0, 20, 'cathedral');
  tier(b, rect(88, 14, -4, 0), 20, 33, 'cathedral');
  tier(b, rect(12, 48, 2, 0), 0, 33, 'cathedral');
  // The apse: a half-round chevet.
  const half = (r: number) => { const out: number[] = []; for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (k / 12) * Math.PI; out.push(40 + Math.cos(a) * r, Math.sin(a) * r); } return out; };
  tier(b, half(20), 0, 20, 'cathedral');
  tier(b, half(7), 20, 33, 'cathedral');
  mesh(new THREE.ConeGeometry(7.6, 10, 24, 1, false, 0, Math.PI).translate(40, 38, 0), lead, b);
  // Lead roofs.
  mesh(gable(-48, 40, 7.6, 33, 43), lead, b);
  const tr = gable(-24, 24, 6.6, 33, 43); tr.rotateY(Math.PI / 2).translate(2, 0, 0); mesh(tr, lead, b);
  for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(88, 1.2, 13).translate(-4, 20.6, sz * 13.5), lead, b, true);
  // Flying buttresses down both sides.
  const fly: THREE.BufferGeometry[] = [];
  for (let x = -44; x <= 36; x += 7) for (const sz of [-1, 1]) {
    fly.push(new THREE.BoxGeometry(1.4, 22, 2.4).translate(x, 11, sz * 20.6));
    fly.push(placed(new THREE.BoxGeometry(1.0, 1.2, 15), x, 26, sz * 13.5, 0, sz * -0.62));
  }
  const fm = merged(fly, STONE(0xd6ccb8)); b.group.add(fm);
  // West front: three portals, the gallery of kings, the rose, the open gallery, then the towers.
  tier(b, rect(14, 41, -55, 0), 0, 43, 'beaux', { mat: STONE(0xdcd3c2) });
  const front: THREE.BufferGeometry[] = [];
  for (const zz of [-13.2, 0, 13.2]) {
    const s = new THREE.Shape(); s.moveTo(-3.2, 0); s.lineTo(-3.2, 7); s.quadraticCurveTo(-3.2, 11.5, 0, 12.5); s.quadraticCurveTo(3.2, 11.5, 3.2, 7); s.lineTo(3.2, 0); s.closePath();
    front.push(new THREE.ShapeGeometry(s).rotateY(-Math.PI / 2).translate(-62.05, 0, zz));
  }
  const pm = merged(front, solidMat('nd-portal', 0x3a342e, 0.9, 0)); b.group.add(pm); b.detail.push(pm);
  mesh(new THREE.BoxGeometry(0.6, 2.4, 40).translate(-62.2, 18, 0), STONE(0xcdc2ad), b, true);
  mesh(new THREE.CircleGeometry(4.8, 40).rotateY(-Math.PI / 2).translate(-62.06, 27, 0), glowMat('nd-rose', 0x6a5cc8, 0.15, 2.2), b);
  mesh(new THREE.TorusGeometry(4.9, 0.35, 6, 40).rotateY(Math.PI / 2).translate(-62.1, 27, 0), STONE(0xcdc2ad), b, true);
  for (const sz of [-1, 1]) {
    tier(b, rect(14, 14, -55, sz * 13.5), 43, 69, 'cathedral');
    band(b, rect(14, 14, -55, sz * 13.5), 68.4, 0.8, 0.4, STONE(0xcdc2ad), true);
  }
  // The spire (rebuilt as Viollet-le-Duc's), lead over oak, at the crossing.
  mesh(new THREE.CylinderGeometry(2.6, 3.2, 10, 8).translate(2, 48, 0), lead, b);
  mesh(new THREE.ConeGeometry(2.6, 43, 8).translate(2, 74.5, 0), lead, b);
  mesh(new THREE.ConeGeometry(0.25, 3, 6).translate(2, 97, 0), solidMat('gilt', 0xc9a24b, 0.35, 0.9), b, true);
  return b;
};

// ------------------------------------------------------------------ elsewhere

/** The Colosseum: four storeys of travertine arcades around the arena, on the map's own ellipse. */
const colosseum: Builder = (c) => {
  const b = built();
  const ell: number[] = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; ell.push(Math.cos(a) * 94.5, Math.sin(a) * 78); }
  const inner: number[] = [];
  for (let i = 63; i >= 0; i--) { const a = (i / 64) * Math.PI * 2; inner.push(Math.cos(a) * 43, Math.sin(a) * 27); }
  const parts = c.rings.length ? c.rings.filter((r) => Math.abs(area(r.ring)) > 2000) : [];
  const use = parts.length ? parts : [{ ring: ell, holes: [inner], y0: 0, y1: 48 }];
  for (const p of use) {
    const m = new THREE.Mesh(prism(p.ring, -1, 48, STYLES.travertine.tile, true, p.holes), facadeMat('travertine'));
    m.castShadow = true; m.receiveShadow = true; b.group.add(m);
    b.solids.push({ ring: p.ring, y0: 0, y1: 48 });
    if (p.ring.length <= 400) { band(b, p.ring, 11, 0.8, 0.5, STONE(0xc6b593), true); band(b, p.ring, 23, 0.8, 0.5, STONE(0xc6b593), true); band(b, p.ring, 35, 0.8, 0.5, STONE(0xc6b593), true); }
  }
  return b;
};

/** Burj Khalifa: three wings around a hexagonal core stepping back in a spiral, then the spire. */
const burj: Builder = () => {
  const b = built();
  const glass = facadeMat('blueGlass');
  const wing = (len: number, w: number, a: number) => {
    const ca = Math.cos(a), sa = Math.sin(a), out: number[] = [];
    const pts: [number, number][] = [[0, -w / 2], [len - w / 2, -w / 2]];
    for (let k = 0; k <= 8; k++) { const t = -Math.PI / 2 + (k / 8) * Math.PI; pts.push([len - w / 2 + Math.cos(t) * w / 2, Math.sin(t) * w / 2]); }
    pts.push([0, w / 2]);
    for (const [x, z] of pts) out.push(x * ca - z * sa, x * sa + z * ca);
    return out;
  };
  let y = 0;
  const steps = 27;
  for (let t = 0; t < steps; t++) {
    const y1 = t < 24 ? y + 24 : y + 14;
    for (let k = 0; k < 3; k++) {
      // Each wing gives up a bay in turn, so the setbacks wind up the tower.
      const lost = Math.floor((t + (2 - k)) / 3);
      const len = Math.max(9, 72 - lost * 7.2);
      tier(b, wing(len, 27 - Math.min(10, t * 0.35), (k / 3) * Math.PI * 2 + Math.PI / 2), y, y1, 'blueGlass', { mat: glass, solid: t < 6 });
    }
    y = y1;
  }
  tier(b, ngon(6, 11), y, y + 60, 'blueGlass', { mat: glass });
  mesh(new THREE.CylinderGeometry(0.8, 5.5, 828 - y - 60, 8).translate(0, (828 + y + 60) / 2, 0), STAINLESS(), b);
  return b;
};

/** Sydney Opera House: the podium and two rows of white shells over the halls, the restaurant's pair. */
const operaHouse: Builder = () => {
  const b = built();
  const tiles = solidMat('soh-tiles', 0xf1eee4, 0.32, 0.05);
  tiles.side = THREE.DoubleSide;
  const granite = solidMat('soh-podium', 0xc9a98a, 0.85, 0);
  mesh(prism(rect(118, 183, 0, 4), -1, 9, [4, 4]), granite, b);
  b.solids.push({ ring: rect(118, 183, 0, 4), y0: -1, y1: 9 });
  // A shell: a curved triangle from a base line up to a leaning apex.
  const shell = (cx: number, cz: number, w: number, hgt: number, lean: number, dir: number) => {
    const N = 14, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const u = i / N, v = j / N;
      const bx = (u - 0.5) * w * (1 - v), by = v * hgt, bz = dir * lean * v * v;
      const bulge = Math.sin(Math.PI * v) * (1 - Math.pow(2 * u - 1, 2)) * w * 0.18;
      pos.push(cx + bx, 9 + by, cz + bz - dir * bulge);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, c2 = a + N + 1; idx.push(a, c2, a + 1, a + 1, c2, c2 + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, tiles); m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
  };
  // The halls point north (−z) out to the harbour: each row has shells opening both ways.
  for (const [hx, s] of [[-26, 1], [26, 0.9]] as [number, number][]) {
    shell(hx, -40, 50 * s, 58 * s, 26 * s, -1);
    shell(hx, -18, 46 * s, 50 * s, 20 * s, 1);
    shell(hx, 4, 40 * s, 40 * s, 16 * s, -1);
    shell(hx, 20, 32 * s, 30 * s, 12 * s, 1);
    b.solids.push({ ring: rect(40 * s, 70, hx, -10), y0: 9, y1: 9 + 40 * s });
  }
  shell(0, 74, 22, 18, 8, -1);
  shell(0, 84, 18, 14, 6, 1);
  return b;
};

export const BUILDERS: Record<string, Builder> = {
  appleCube, gmBuilding, channelGardens, washArch, arcTriomphe, louvrePyramid, notreDame, colosseum, burj, operaHouse,
  empire, chrysler, owtc, flatiron, rock30, metlife, grandCentral, nypl, stPatricks, woolworth,
  park432, centralParkTower, steinway, vessel, msg, plaza, dakota, liberty, brooklynBridge,
  eiffel, bigBen, goldenGate, transamerica, tokyoTower,
  // ---- East US
  ...EAST_BUILDERS,
  // ---- Asia-Pacific & Latin America (apac-models.ts)
  ...APAC_BUILDERS,
  // ---- Europe & Middle East (London's bigBen is rebuilt there: the 2022 restoration's colours)
  ...EU_BUILDERS,
  // ---- NYC: more New York builders (nyc-models.ts)
  ...NYC_BUILDERS,
};

// ---- West Coast: shared helpers for west-models.ts
export { loft, mesh };
