// The landmark models. Each builder works in a model frame: y up from the ground (0), x along the
// landmark's east axis, z along its south axis (so -z is the landmark's "north", its bearing). Builders
// that know the real outline from the map get the claimed footprints (`rings`) in that frame.
import * as THREE from 'three';
import { area, band, built, chamfer, facadeMat, glowMat, merged, ngon, offsetRing, placed, prism, rect, solidMat, tier, type Built, STYLES } from './kit.ts';

export interface BuildCtx {
  /** Claimed map footprints in the model frame (empty when the map has none here). */
  rings: { ring: number[]; holes: number[][]; y0: number; y1: number }[];
  /** Lowest point a claimed part starts at (a tower standing on a podium starts there). */
  minY: number;
  /** Bridges: tower-to-tower distance measured from the map. */
  span?: number;
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

const plaza: Builder = (c) => {
  const b = built();
  const parts = fromRings(b, c, 'whiteStone', 62, rect(70, 60), STONE(0xe9e4da));
  for (const p of parts) if (p.ring.length <= 400) {
    mansard(b, p.ring, p.holes, Math.min(62, p.y1), Math.min(62, p.y1) + 12, 3.5, COPPER());
    // Dormers.
    const dorm: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.ring.length; i += 2) {
      const j = (i + 2) % p.ring.length;
      const ax = p.ring[i], az = p.ring[i + 1], bx = p.ring[j], bz = p.ring[j + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 8) continue;
      const s = area(p.ring) > 0 ? 1 : -1, nx = ((bz - az) / len) * s, nz = (-(bx - ax) / len) * s;
      for (let t = 4; t < len - 3; t += 6) {
        const x = ax + ((bx - ax) * t) / len - nx * 1.6, z = az + ((bz - az) * t) / len - nz * 1.6;
        dorm.push(placed(new THREE.BoxGeometry(2, 2.6, 1.6), x, Math.min(62, p.y1) + 4, z, Math.atan2(nx, nz)));
      }
    }
    if (dorm.length) { const dm = merged(dorm, STONE(0xf2efe8)); b.group.add(dm); b.detail.push(dm); }
  }
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

export const BUILDERS: Record<string, Builder> = {
  empire, chrysler, owtc, flatiron, rock30, metlife, grandCentral, nypl, stPatricks, woolworth,
  park432, centralParkTower, steinway, vessel, msg, plaza, dakota, liberty, brooklynBridge,
  eiffel, bigBen, goldenGate, transamerica, tokyoTower,
};
