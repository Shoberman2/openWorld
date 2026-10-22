// East US (and Toronto) landmarks, hand-built: Miami's lifeguard towers and Freedom Tower, Boston's
// State House dome and 200 Clarendon, Chicago's Cloud Gate and Marina City, Washington's Monument,
// Capitol, Lincoln Memorial and White House, and the CN Tower. Model frame as in models.ts: y up from
// the ground, x east, -z the landmark's "north" (its bearing). Dimensions from the sources noted per model.
import * as THREE from 'three';
import { STYLES, band, built, facadeMat, glowMat, merged, ngon, prism, rect, solidMat, tier, type Built } from './kit.ts';

interface Ctx { rings: { ring: number[]; holes: number[][]; y0: number; y1: number }[]; minY: number; span?: number }
type Builder = (c: Ctx) => Built;

function add(b: Built, g: THREE.BufferGeometry, m: THREE.Material, detail = false) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true; x.receiveShadow = true;
  b.group.add(x);
  if (detail) b.detail.push(x);
  return x;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0: number, r1: number, h: number, seg: number, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z);
/** A solid of revolution from (radius, y) pairs, bottom to top. */
const lathe = (pts: [number, number][], seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg);
/** Repeat a 0..1-UV'd surface (cylinders) so a facade texture keeps its real size. */
function tiled(g: THREE.BufferGeometry, metersU: number, metersV: number, style: string) {
  const t = STYLES[style].tile, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * metersU / t[0], uv.getY(i) * metersV / t[1]);
  return g;
}
/** A triangular pediment w wide, h high, d deep (face toward -z/+z, ridge along z). */
function pediment(w: number, h: number, d: number) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}
/** A row of columns (cylinders) between two points, with plinth and capital blocks. */
function colonnade(out: THREE.BufferGeometry[], x0: number, z0: number, x1: number, z1: number, n: number, r: number, y0: number, h: number) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    out.push(cyl(r, r * 0.86, h - 0.6, 12, x, y0 + 0.3, z), box(r * 2.4, 0.3, r * 2.4, x, y0, z), box(r * 2.5, 0.3, r * 2.5, x, y0 + h - 0.3, z));
  }
}

// A few facade textures of their own (registered into the kit's table, painted on first use).
STYLES.redBrick = {
  tile: [3.2, 3.6], px: [128, 128], rough: 0.88, metal: 0, glow: 0xffd09a,
  paint(g, W, H, lit) {
    if (!lit) {
      g.fillStyle = '#93432f'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(60,20,10,0.22)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
      g.fillStyle = '#efe9dc'; g.fillRect(W * 0.26, H * 0.14, W * 0.48, H * 0.06); g.fillRect(W * 0.24, H * 0.78, W * 0.52, H * 0.05);
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    const x = W * 0.3, w = W * 0.4, y = H * 0.2, h = H * 0.56;
    g.fillStyle = lit ? 'rgba(255,205,140,0.8)' : '#2d3440'; g.fillRect(x, y, w, h);
    if (!lit) { g.strokeStyle = '#f2efe6'; g.lineWidth = 4; g.strokeRect(x, y, w, h); g.fillStyle = '#f2efe6'; g.fillRect(x, y + h * 0.5, w, 3); g.fillRect(x + w / 2 - 1, y, 3, h); }
  },
};
STYLES.whiteMarble = {
  tile: [4.4, 4.2], px: [128, 128], rough: 0.6, metal: 0, glow: 0xffe2b0,
  paint(g, W, H, lit) {
    if (!lit) {
      g.fillStyle = '#f1efe8'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(150,140,120,0.12)'; for (let y = 0; y < H; y += 10) g.fillRect(0, y, W, 1);
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    const x = W * 0.33, w = W * 0.34, y = H * 0.2, h = H * 0.55;
    g.fillStyle = lit ? 'rgba(255,214,150,0.8)' : '#38404b'; g.fillRect(x, y, w, h);
    if (!lit) { g.fillStyle = '#e2ddd2'; g.fillRect(x - 6, y - 8, w + 12, 7); g.fillRect(x - 4, y + h, w + 8, 5); }
  },
};
STYLES.condoBand = {
  tile: [3.0, 3.1], px: [64, 64], rough: 0.25, metal: 0.4, glow: 0xfff0d8,
  paint(g, W, H, lit) {
    if (!lit) {
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#7fa6b8'); grd.addColorStop(1, '#4f7488');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f2f2ee'; g.fillRect(0, H * 0.82, W, H * 0.18);
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,230,190,0.5)'; g.fillRect(W * 0.1, H * 0.1, W * 0.5, H * 0.6); }
  },
};

const MARBLE = () => solidMat('e-marble', 0xf0ede6, 0.55, 0);
const CONCRETE = () => solidMat('e-concrete', 0xc9c5bd, 0.85, 0);
const GOLD = () => solidMat('e-gold', 0xe0b04a, 0.28, 1);
const MIRROR = () => solidMat('e-mirror', 0xe4e8ec, 0.04, 1);
const DARKGLASS = () => solidMat('e-darkglass', 0x2a3540, 0.12, 0.6);

// ------------------------------------------------------------------ Miami

/**
 * South Beach's lifeguard towers (William Lane's post-Andrew designs): a bright cabin up on stilts,
 * a deck with a rail all round, a ramp down to the sand on the land side. Windows face the sea (-z).
 * Positions: the towers mapped in OpenStreetMap (emergency=lifeguard, Lummus Park to 21st St).
 */
const LG: [number, number, number][] = [
  [0xf3a6c4, 0x47c1c8, 0xfff2f6], [0xffd84a, 0x2f7fd0, 0xff6a3a], [0x53c7c0, 0xff8fb0, 0xf4f2ea],
  [0xff8a3d, 0x7a4fc9, 0xffe36e], [0xb7e36b, 0x9b59d0, 0xffffff], [0x6fb7ff, 0xffd34a, 0xff5a7a],
];
const lifeguard = (v: number): Builder => () => {
  const b = built();
  const [cab, trim, roofC] = LG[v % LG.length];
  const mCab = solidMat(`lg-cab-${v}`, cab, 0.7, 0), mTrim = solidMat(`lg-trim-${v}`, trim, 0.6, 0), mRoof = solidMat(`lg-roof-${v}`, roofC, 0.6, 0);
  const wood = solidMat('lg-wood', 0xd9d2c4, 0.85, 0);
  const posts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(box(0.26, 1.9, 0.26, sx * 1.9, 0, sz * 1.5));
  b.group.add(merged(posts, mTrim));
  add(b, box(4.6, 0.18, 3.8, 0, 1.9, 0), wood);
  // The cabin: walls in the color, a porthole-style window band facing the sea, a rounded roof.
  add(b, box(3.0, 2.3, 2.3, 0, 2.08, 0.2), mCab);
  add(b, box(2.4, 0.75, 0.05, 0, 3.0, -0.97), DARKGLASS());
  for (const sx of [-1, 1]) add(b, box(0.05, 0.7, 1.2, sx * 1.52, 3.0, 0.1), DARKGLASS(), true);
  if (v % 2) add(b, new THREE.CylinderGeometry(1.6, 1.6, 2.9, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, 0.45, 1).translate(0, 4.38, 0.2), mRoof);
  else add(b, box(3.5, 0.22, 2.9, 0, 4.38, 0.2), mRoof);
  // Rail round the deck, the ramp to the sand behind, a flagpole.
  const rail: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) rail.push(box(4.6, 0.08, 0.08, 0, 2.95, sz * 1.86));
  for (const sx of [-1, 1]) rail.push(box(0.08, 0.08, 3.8, sx * 2.26, 2.95, 0));
  for (let i = 0; i < 8; i++) rail.push(box(0.06, 0.9, 0.06, -2.26 + (i / 7) * 4.52, 2.05, -1.86));
  const rm = merged(rail, mTrim); b.group.add(rm); b.detail.push(rm);
  const ramp = new THREE.BoxGeometry(1.2, 0.14, 5.4).rotateX(-Math.atan2(2.0, 5.0)).translate(1.2, 1.0, 4.4);
  add(b, ramp, wood, true);
  add(b, cyl(0.04, 0.04, 3.2, 6, -2.1, 2.0, -1.6), solidMat('lg-pole', 0xcfd3d6, 0.4, 0.8), true);
  add(b, box(0.03, 0.55, 0.9, -2.1, 4.55, -1.15), solidMat('lg-flag', 0xe8392e, 0.8, 0), true);
  b.solids.push({ ring: rect(4.6, 3.8), y0: 1.9, y1: 4.5 });
  return b;
};

/**
 * Freedom Tower (1925, Schultze & Weaver; after the Giralda of Seville): a cream Spanish Revival
 * tower 78 m (255 ft) to the top of its cupola over a lower wing with red tile roofs, on Biscayne Blvd.
 */
const freedomTower: Builder = () => {
  const b = built();
  const cream = STYLES.beaux ? 'beaux' : 'whiteStone';
  const tile = solidMat('ft-tile', 0xb5583a, 0.8, 0), trim = solidMat('ft-trim', 0xe9dfc8, 0.8, 0);
  // The wing behind (west) the tower, three floors, hipped tile roof.
  tier(b, rect(34, 26, 0, 10), 0, 14, cream);
  add(b, new THREE.ConeGeometry(23, 5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.76).translate(0, 16.5, 10), tile);
  // The shaft (16 m square), a balconied belfry stage, then the cupola.
  tier(b, rect(16, 16), 0, 50, cream);
  band(b, rect(16, 16), 49, 1.2, 0.6, trim);
  tier(b, rect(13, 13), 50.2, 60, cream);
  band(b, rect(13, 13), 59.5, 1, 0.7, trim);
  // Arched openings on the belfry (dark), corner urns.
  const arches: THREE.BufferGeometry[] = [];
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (const k of [-1, 1]) arches.push(box(nz ? 2.2 : 0.2, 5, nz ? 0.2 : 2.2, nx * 6.55 + (nz ? k * 3 : 0), 52.5, nz * 6.55 + (nx ? k * 3 : 0)));
  b.group.add(merged(arches, DARKGLASS()));
  tier(b, ngon(8, 5.4, Math.PI / 8), 60.5, 66, cream);
  add(b, lathe([[5.6, 66], [5.6, 66.6], [4.8, 67.2], [4.2, 70.5], [3, 73], [1.2, 75.5], [0.3, 77], [0.05, 78]], 8), tile);
  add(b, cyl(0.12, 0.05, 2, 6, 0, 76.5, 0), GOLD(), true);
  b.solids.push({ ring: rect(16, 16), y0: 0, y1: 60 }, { ring: rect(34, 26, 0, 10), y0: 0, y1: 14 });
  return b;
};

// ------------------------------------------------------------------ Boston

/**
 * Massachusetts State House (Bulfinch, 1798): the gilded dome, 53 ft (16 m) across and 35 ft high,
 * on its drum over the red-brick front, the lantern and the gilded pine cone some 155 ft above Beacon
 * Street. The map's front block stays; this replaces its stepped stand-in for the dome.
 */
const stateHouse: Builder = (c) => {
  const b = built();
  // The Bulfinch front's roof (the map's 20 m block, which stays); the claimed parts are the stepped dome.
  const roof = 20;
  void c;
  const white = solidMat('sh-white', 0xf1eee6, 0.7, 0);
  // The square attic the dome stands on (brick with a white cornice), the drum, the dome, the lantern.
  tier(b, rect(20, 20), roof - 1, roof + 4.5, 'redBrick');
  band(b, rect(20, 20), roof + 4.2, 0.6, 0.5, white);
  add(b, cyl(8.4, 8.4, 2.4, 40, 0, roof + 4.5, 0), white);
  add(b, lathe(Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI / 2; return [8.1 * Math.cos(a) + (i === 12 ? 0 : 0), roof + 6.9 + 10.7 * Math.sin(a)] as [number, number]; }), 48), GOLD());
  const lan = roof + 6.9 + 10.2;
  add(b, cyl(2.1, 2.1, 3.6, 12, 0, lan, 0), white);
  const lc: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; lc.push(cyl(0.18, 0.18, 3.2, 6, Math.cos(a) * 2.3, lan + 0.2, Math.sin(a) * 2.3)); }
  const lm = merged(lc, white); b.group.add(lm); b.detail.push(lm);
  add(b, lathe([[2.5, lan + 3.6], [2.4, lan + 4.0], [1.6, lan + 5.0], [0.5, lan + 5.6]], 16), GOLD());
  add(b, new THREE.SphereGeometry(0.55, 10, 8).scale(1, 1.6, 1).translate(0, lan + 6.3, 0), GOLD());
  b.solids.push({ ring: rect(20, 20), y0: roof - 1, y1: roof + 15 });
  return b;
};

/** 200 Clarendon (I. M. Pei & Partners, 1976): 241 m of reflective blue glass on its rhomboid plan. */
const clarendon: Builder = (c) => {
  const b = built();
  const parts = c.rings.length ? c.rings : [{ ring: rect(32, 90), holes: [], y0: 0, y1: 241 }];
  for (const p of parts) {
    const top = Math.max(200, p.y1);
    const m = new THREE.Mesh(prism(p.ring, Math.max(-1.5, p.y0), top, [1.6, 3.9], true, p.holes), solidMat('cl-glass', 0x9fc0d6, 0.05, 0.85));
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: p.ring, y0: p.y0, y1: top });
  }
  return b;
};

// ------------------------------------------------------------------ Chicago

/**
 * Cloud Gate (Anish Kapoor, 2006): 10 × 13 × 20 m of polished stainless steel, the omphalos arch
 * underneath 3.7 m high (Millennium Park).
 */
const cloudGate: Builder = () => {
  const b = built();
  const g = new THREE.SphereGeometry(1, 72, 40);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // A fat bean: flattened on the ground, the ends a little fuller than the middle.
    x *= 10; z *= 6.5 * (1 + 0.08 * Math.abs(x / 10)); y = y * 5 + 5;
    if (y < 1.2) y = 1.2 * Math.pow(Math.max(0, y) / 1.2, 0.6);
    // The omphalos: the underside pushed up into an arch through the middle.
    const arch = 3.7 * Math.max(0, 1 - (x / 5.8) ** 2);
    if (y < 5) y += arch * (1 - y / 5) * (1 - Math.min(1, Math.abs(z) / 7.5) * 0.15);
    p.setXYZ(i, x, Math.max(0, y), z);
  }
  g.computeVertexNormals();
  add(b, g, MIRROR());
  for (const sx of [-1, 1]) b.solids.push({ ring: rect(6, 11, sx * 6.5, 0), y0: 0, y1: 10 });
  b.solids.push({ ring: rect(8, 11), y0: 3.7, y1: 10 });
  return b;
};

/** One petal-balconied tower of Marina City (Bertrand Goldberg, 1964): 179 m, 65 floors, parking spiral below. */
function cob(b: Built, cx: number, cz: number) {
  const R = 16, petals = 16, H = 179, park = 19, fh = H / 65;
  const s = new THREE.Shape();
  for (let i = 0; i <= petals * 8; i++) {
    const a = (i / (petals * 8)) * Math.PI * 2, k = (i % 8) / 8;
    const r = R * (0.86 + 0.14 * Math.sin(k * Math.PI));
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const slab = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
  const n = 65;
  const im = new THREE.InstancedMesh(slab, CONCRETE(), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) im.setMatrixAt(i, m.makeTranslation(cx, i * fh + fh - 0.32, cz));
  im.castShadow = true; im.receiveShadow = true;
  b.group.add(im);
  // The parking floors: an open spiral (dark, with the parked cars' shapes); flats above: glass behind the balconies.
  add(b, cyl(R * 0.82, R * 0.82, park * fh, 40, cx, 0, cz), solidMat('mc-park', 0x4a4d52, 0.9, 0));
  add(b, tiled(cyl(R * 0.74, R * 0.74, H - park * fh, 40, cx, park * fh, cz), 2 * Math.PI * R * 0.74, H - park * fh, 'condoBand'), facadeMat('condoBand'));
  add(b, cyl(R * 0.9, R * 0.9, 1.4, 40, cx, H, cz), CONCRETE());
  b.solids.push({ ring: ngon(16, R * 0.86, 0, cx, cz), y0: 0, y1: H + 1.4 });
}
const marinaCity: Builder = (c) => {
  const b = built();
  // The two towers stand ~58 m apart east-west on the river (from the map's own footprints when known).
  const big = c.rings.filter((r) => r.y1 > 120);
  if (big.length >= 2) {
    for (const r of big.slice(0, 2)) {
      let x = 0, z = 0; for (let i = 0; i < r.ring.length; i += 2) { x += r.ring[i]; z += r.ring[i + 1]; }
      cob(b, x / (r.ring.length / 2), z / (r.ring.length / 2));
    }
  } else { cob(b, -29, 0); cob(b, 29, 0); }
  return b;
};

// ------------------------------------------------------------------ Washington

/** A small US flag (13 stripes, the blue canton), shared. */
let FLAG: THREE.MeshStandardMaterial | null = null;
function flagMat() {
  if (FLAG) return FLAG;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 34;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, (i * 34) / 13, 64, 34 / 13 + 0.5); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 26, 18);
  g.fillStyle = '#fff'; for (let y = 2; y < 17; y += 3) for (let x = 2; x < 25; x += 4) g.fillRect(x + (y % 2), y, 1, 1);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return (FLAG = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
}

/**
 * Washington Monument (1884): 169.3 m (555 ft 5 in) of marble, 16.8 m square at the base tapering to
 * 10.5 m at 152 m where the pyramidion starts; the color shift at ~46 m where building resumed in 1879;
 * fifty flags in a circle round the base.
 */
const washMonument: Builder = () => {
  const b = built();
  const lower = solidMat('wm-lower', 0xeee8dc, 0.7, 0), upper = solidMat('wm-upper', 0xf3efe7, 0.7, 0);
  const shaft = (w0: number, w1: number, y0: number, y1: number) => new THREE.CylinderGeometry(w1 / Math.SQRT2, w0 / Math.SQRT2, y1 - y0, 4, 1).rotateY(Math.PI / 4).translate(0, (y0 + y1) / 2, 0);
  const wAt = (y: number) => 16.8 + (10.5 - 16.8) * (y / 152.4);
  add(b, shaft(16.8, wAt(46), 0, 46), lower);
  add(b, shaft(wAt(46), 10.5, 46, 152.4), upper);
  add(b, new THREE.ConeGeometry(10.5 / Math.SQRT2, 16.9, 4, 1).rotateY(Math.PI / 4).translate(0, 152.4 + 8.45, 0), upper);
  // Observation windows near the top (two per face), the red aircraft lights.
  const win: THREE.BufferGeometry[] = [];
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (const k of [-1, 1]) win.push(box(nz ? 0.8 : 0.1, 0.9, nz ? 0.1 : 0.8, nx * 5.3 + (nz ? k * 1.2 : 0), 147.5, nz * 5.3 + (nx ? k * 1.2 : 0)));
  const wm = merged(win, DARKGLASS()); b.group.add(wm); b.detail.push(wm);
  add(b, new THREE.SphereGeometry(0.35, 8, 6).translate(0, 152.6, -5.3), glowMat('wm-red', 0xff2a1a, 0.6, 4), true);
  // Plaza and the ring of flags.
  add(b, cyl(30, 30, 0.25, 48), solidMat('wm-plaza', 0xd9d2c3, 0.9, 0), true);
  const poles: THREE.BufferGeometry[] = [], flags: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2, x = Math.cos(a) * 26, z = Math.sin(a) * 26;
    poles.push(cyl(0.08, 0.05, 9, 6, x, 0, z));
    flags.push(new THREE.PlaneGeometry(2.4, 1.3).translate(1.25, 8.2, 0).rotateY(0.6).translate(x, 0, z));
  }
  const pm = merged(poles, solidMat('wm-pole', 0xd8dcdf, 0.35, 0.8)); b.group.add(pm); b.detail.push(pm);
  const fm = merged(flags, flagMat()); b.group.add(fm); b.detail.push(fm);
  b.solids.push({ ring: rect(16.8, 16.8), y0: 0, y1: 169 });
  return b;
};

/**
 * The U.S. Capitol: 229 m (751 ft) north-south by 107 m, the cast-iron dome rising to 88 m (288 ft) at
 * the Statue of Freedom; the peristyle of 36 columns round its drum; the east front's central portico;
 * the Senate (north) and House (south) wings.
 */
const capitol: Builder = () => {
  const b = built();
  const wall = 'whiteMarble', white = MARBLE(), roofM = solidMat('cap-roof', 0xd9d6cf, 0.8, 0.1);
  // Central block, the connecting links, the two wings (long axis north-south = z).
  tier(b, rect(70, 96), 0, 24, wall);
  for (const sz of [-1, 1]) {
    tier(b, rect(46, 18, 0, sz * 57), 0, 22, wall);
    tier(b, rect(72, 50, 0, sz * 89), 0, 23, wall);
    band(b, rect(72, 50, 0, sz * 89), 22.2, 1.6, 0.6, white);
  }
  band(b, rect(70, 96), 23, 1.8, 0.6, white);
  // East front porticoes: the central one and one on each wing (columns, pediment).
  const cols: THREE.BufferGeometry[] = [];
  const portico = (cz: number, w: number, n: number, h: number) => {
    colonnade(cols, 38, cz - w / 2, 38, cz + w / 2, n, 0.75, 6, h - 6);
    add(b, box(5, 1.6, w + 2, 37.5, h, cz), white);
    add(b, pediment(w + 2, 4.2, 5).rotateY(Math.PI / 2).translate(37.5, h + 1.6, cz), white);
    add(b, box(10, 6, w + 6, 38, 0, cz), white); // steps / terrace
  };
  portico(0, 34, 8, 20);
  for (const sz of [-1, 1]) portico(sz * 89, 30, 8, 19);
  const cm = merged(cols, white); b.group.add(cm);
  // The dome: base, peristyle drum, attic, ribbed cast-iron dome, the tholos, the statue.
  add(b, cyl(24, 24, 6, 48, 0, 24, 0), white);
  add(b, tiled(cyl(19, 19, 13, 48, 0, 30, 0), 2 * Math.PI * 19, 13, wall), facadeMat(wall));
  const per: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; per.push(cyl(0.55, 0.5, 11.5, 10, Math.cos(a) * 21.4, 30.6, Math.sin(a) * 21.4)); }
  const pm = merged(per, white); b.group.add(pm);
  add(b, cyl(22.6, 22.6, 1.6, 48, 0, 42.4, 0), white);
  add(b, tiled(cyl(17.5, 17.5, 7, 48, 0, 44, 0), 2 * Math.PI * 17.5, 7, wall), facadeMat(wall));
  add(b, cyl(18.2, 18.2, 1.2, 48, 0, 50.6, 0), white);
  add(b, lathe([[17.4, 51.8], [17.2, 54], [16.2, 58], [14, 62.5], [10.8, 66.5], [6.5, 69.5], [4.2, 70.6]], 48), white);
  add(b, cyl(4.2, 4.2, 5.4, 16, 0, 70.6, 0), white);
  add(b, lathe([[4.6, 76], [3.6, 77.6], [1.8, 79], [0.6, 80.2]], 16), white);
  add(b, cyl(0.7, 0.55, 2.2, 10, 0, 80.2, 0), solidMat('cap-bronze', 0x5d5446, 0.6, 0.5));
  add(b, cyl(0.45, 0.3, 5.4, 10, 0, 82.4, 0), solidMat('cap-bronze', 0x5d5446, 0.6, 0.5));
  add(b, new THREE.SphereGeometry(0.55, 8, 6).translate(0, 87.4, 0), solidMat('cap-bronze', 0x5d5446, 0.6, 0.5));
  add(b, cyl(1, 1, 13, 16, 0, 69, 0), roofM);
  b.solids.push({ ring: rect(70, 96), y0: 0, y1: 24 }, { ring: rect(72, 50, 0, 89), y0: 0, y1: 23 }, { ring: rect(72, 50, 0, -89), y0: 0, y1: 23 }, { ring: ngon(16, 22), y0: 24, y1: 70 });
  return b;
};

/**
 * Lincoln Memorial (Henry Bacon, 1922): a Doric temple 57.8 × 36.1 m on its terrace, 36 columns
 * 13.4 m tall, the attic above, 30 m overall; it faces east down the Reflecting Pool (-z = east here).
 */
const lincolnMemorial: Builder = () => {
  const b = built();
  const white = MARBLE(), stone = solidMat('lm-terrace', 0xd9d4c8, 0.85, 0);
  // Model frame: x along the long side (north-south), -z toward the pool (bearing 90).
  const L = 57.8, D = 36.1;
  add(b, box(L + 16, 3.4, D + 14, 0, 0, 0), stone);
  // The great stair down to the pool.
  for (let i = 0; i < 10; i++) add(b, box(34, 0.34 * (10 - i), 1.2, 0, 0, -(D + 14) / 2 - 0.6 - i * 1.2), stone, i > 3);
  add(b, box(L, 1.4, D, 0, 3.4, 0), white);
  const y0 = 4.8, ch = 13.4;
  // The cella inside the colonnade, then the columns, the entablature and the attic.
  tier(b, rect(L - 8, D - 8), y0, y0 + ch, 'whiteMarble', { mat: white });
  const cols: THREE.BufferGeometry[] = [];
  const hx = L / 2 - 1.5, hz = D / 2 - 1.5;
  colonnade(cols, -hx, -hz, hx, -hz, 12, 1.13, y0, ch);
  colonnade(cols, -hx, hz, hx, hz, 12, 1.13, y0, ch);
  colonnade(cols, -hx, -hz + 3.7, -hx, hz - 3.7, 6, 1.13, y0, ch);
  colonnade(cols, hx, -hz + 3.7, hx, hz - 3.7, 6, 1.13, y0, ch);
  b.group.add(merged(cols, white));
  add(b, box(L, 3.6, D, 0, y0 + ch, 0), white);
  add(b, box(L + 0.6, 0.6, D + 0.6, 0, y0 + ch + 3.6, 0), white);
  add(b, box(L - 10, 5.2, D - 9, 0, y0 + ch + 4.2, 0), white);
  add(b, box(L - 9.4, 0.5, D - 8.4, 0, y0 + ch + 9.4, 0), white);
  // Lincoln in the dim hall, seen through the middle intercolumniation.
  add(b, box(5.8, 6, 5, 0, y0, -2), solidMat('lm-statue', 0xe7e3da, 0.6, 0), true);
  b.solids.push({ ring: rect(L + 16, D + 14), y0: 0, y1: 4.8 }, { ring: rect(L, D), y0: 4.8, y1: 30 });
  return b;
};

/**
 * The White House: the Executive Residence, 168 × 85.5 ft (51 × 26 m), white-painted sandstone, the
 * North Portico's pediment on four Ionic columns, the South Portico's bow of six with the Truman
 * Balcony. The East and West Wings stay as the map draws them.
 */
const whiteHouse: Builder = (c) => {
  const b = built();
  const white = solidMat('wh-white', 0xf6f5f0, 0.7, 0);
  const minY = c.rings.length ? Math.min(...c.rings.map((r) => r.y0)) : -1.6;
  const H = 18.5;
  tier(b, rect(51.2, 26), Math.max(-4, minY), H, 'whiteMarble', { mat: undefined });
  band(b, rect(51.2, 26), H - 1.2, 1.4, 0.5, white);
  // Balustrade and the low roof.
  add(b, box(50, 1.1, 24.8, 0, H, 0), white);
  add(b, new THREE.ConeGeometry(18, 3.2, 4, 1).rotateY(Math.PI / 4).scale(1.4, 1, 0.6).translate(0, H + 1.1 + 1.6, 0), solidMat('wh-roof', 0x9ea3a8, 0.7, 0.2));
  const cols: THREE.BufferGeometry[] = [];
  // North Portico (-z): pediment on columns, out over the drive.
  colonnade(cols, -7, -19.5, 7, -19.5, 4, 0.55, 0, 12.5);
  colonnade(cols, -7, -15.5, 7, -15.5, 4, 0.55, 0, 12.5);
  add(b, box(17, 1.8, 7.6, 0, 12.5, -16.8), white);
  add(b, pediment(17, 3.4, 7.6).translate(0, 14.3, -16.8), white);
  // South Portico (+z): the bow of columns, the balcony and its rail.
  for (let i = 0; i < 6; i++) { const a = Math.PI * (0.12 + (i / 5) * 0.76); cols.push(cyl(0.55, 0.48, 14, 12, Math.cos(a) * 9, 0, 13 + Math.sin(a) * 6.2)); }
  const halfDisc = (r: number, h: number, y: number) => new THREE.CylinderGeometry(r, r, h, 24, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.7).translate(0, y + h / 2, 13);
  add(b, halfDisc(9.8, 1.6, 14), white);
  add(b, halfDisc(9.6, 0.4, 7.2), white, true);
  b.group.add(merged(cols, white));
  b.solids.push({ ring: rect(51.2, 26), y0: minY, y1: H + 2 });
  return b;
};

// ------------------------------------------------------------------ Toronto

/**
 * CN Tower (1976): 553.3 m. Y-shaped concrete legs merging into a hexagonal shaft; the main pod with
 * the radome (338 m), glass floor and outdoor deck (342 m), LookOut (346 m), 360 Restaurant (351 m)
 * and EdgeWalk roof (356 m); the SkyPod at 446.5 m; the antenna mast above.
 */
const cnTower: Builder = () => {
  const b = built();
  const conc = solidMat('cn-concrete', 0xd2cec6, 0.8, 0);
  // The Y: three wings round a hexagonal core, all tapering; the wings run out below the pod.
  const yRing = (core: number, arm: number, armW: number) => {
    const r: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
      const hw = armW / 2;
      // Each arm: out along a, back in; corners between arms at the core.
      const between = a - Math.PI / 3;
      r.push(Math.cos(between) * core, Math.sin(between) * core);
      r.push(ca * core + px * -hw, sa * core + pz * -hw);
      r.push(ca * arm + px * -hw, sa * arm + pz * -hw);
      r.push(ca * arm + px * hw, sa * arm + pz * hw);
      r.push(ca * core + px * hw, sa * core + pz * hw);
    }
    return r;
  };
  const levels: [number, number, number, number][] = [[0, 9, 32, 9], [60, 8.2, 22, 8], [150, 7.4, 14, 7], [250, 6.6, 9.5, 6.4], [330, 6, 6.2, 6]];
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const [y0, c0, a0, w0] = levels[i], [y1, c1, a1, w1] = levels[i + 1];
    // Lofted wall between two Y rings (same vertex count).
    const A = yRing(c0, a0, w0), B = yRing(c1, a1, w1);
    const pos: number[] = [];
    const n = A.length / 2;
    for (let q = 0; q < n; q++) {
      const r = (q + 1) % n;
      pos.push(A[q * 2], y0, A[q * 2 + 1], B[r * 2], y1, B[r * 2 + 1], A[r * 2], y0, A[r * 2 + 1]);
      pos.push(A[q * 2], y0, A[q * 2 + 1], B[q * 2], y1, B[q * 2 + 1], B[r * 2], y1, B[r * 2 + 1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    geos.push(g);
  }
  b.group.add(merged(geos, conc));
  // The shaft on up through the pod to the SkyPod.
  add(b, cyl(6, 4.6, 120, 6, 0, 330, 0), conc);
  // Main pod: radome bulge, the glass-floor and deck levels, the window band, the restaurant, the roof.
  add(b, lathe([[6, 328], [14, 333], [20.5, 337], [21.5, 339], [19.5, 341.2], [21, 342], [22.5, 343.5], [22.5, 345], [22, 352], [21, 354], [18, 356.5], [8, 358.5], [6, 359]], 48), conc);
  add(b, cyl(22.7, 22.3, 7.6, 48, 0, 344.6, 0), solidMat('cn-glass', 0x34424e, 0.1, 0.7));
  add(b, cyl(21.2, 21.2, 0.25, 48, 0, 336.4, 0), solidMat('cn-radome', 0xf4f4f2, 0.6, 0), true);
  // SkyPod and the antenna, red and white bands near its top, red lights.
  add(b, lathe([[4.6, 442], [8, 444.5], [8, 448], [5, 450.5], [4, 451]], 24), conc);
  add(b, cyl(8.1, 8.1, 2.2, 24, 0, 445.4, 0), solidMat('cn-glass', 0x34424e, 0.1, 0.7));
  add(b, cyl(3.2, 0.6, 102, 8, 0, 451, 0), solidMat('cn-mast', 0xb9bdc2, 0.5, 0.6));
  add(b, new THREE.SphereGeometry(0.6, 8, 6).translate(0, 553, 0), glowMat('cn-red', 0xff2a1a, 0.8, 5), true);
  b.solids.push({ ring: ngon(6, 9), y0: 0, y1: 330 }, { ring: ngon(16, 22), y0: 330, y1: 359 }, { ring: ngon(6, 5), y0: 359, y1: 451 });
  return b;
};

export const EAST_BUILDERS: Record<string, Builder> = {
  lifeguard0: lifeguard(0), lifeguard1: lifeguard(1), lifeguard2: lifeguard(2), lifeguard3: lifeguard(3), lifeguard4: lifeguard(4), lifeguard5: lifeguard(5),
  freedomTower, stateHouse, clarendon, cloudGate, marinaCity, washMonument, capitol, lincolnMemorial, whiteHouse, cnTower,
};
