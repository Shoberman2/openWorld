// London's landmarks: the Elizabeth Tower (Big Ben) as restored in 2022, Tower Bridge, the Shard,
// 30 St Mary Axe, St Paul's dome and west towers, the London Eye and the White Tower.
// Model frame: y up from the ground, x east, z south (−z is the landmark's bearing).
import * as THREE from 'three';
import { band, built, facadeMat, glowMat, ngon, prism, rect, solidMat, STYLES, tier, type Built } from './kit.ts';
import type { BuildCtx } from './models.ts';
import { add, addMerged, colonnade, crossOnBall, domeProfile, euStyles, GILT, glassMat, lathe, LEAD, loft, mat, paintedMat, rand, strut } from './eu-kit.ts';
import { areaOf, centerOf } from './eu-parts.ts';

type Builder = (c: BuildCtx) => Built;

const PORTLAND = () => mat('portland', 0xe4ded0, 0.85);

/** Lead or copper dome skin with standing-seam ribs (n around), for lathes (u around, v up). */
export function ribbedMat(key: string, base: string, rib: string, n: number, opts: { metal?: number; rough?: number; band?: string } = {}) {
  return paintedMat(`ribs-${key}`, [512, 128], (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = rib;
    for (let k = 0; k < n; k++) g.fillRect((k / n) * W, 0, Math.max(2, W / n * 0.12), H);
    if (opts.band) { g.fillStyle = opts.band; g.fillRect(0, H * 0.82, W, H * 0.06); }
  }, { metal: opts.metal ?? 0.3, rough: opts.rough ?? 0.55 });
}

// ------------------------------------------------------------------ the Elizabeth Tower

/** The clock dial: opal glass in a cast-iron frame, Roman numerals, gilt hands (lit from behind at night). */
function dialMat() {
  return paintedMat('bb-dial', [256, 256], (g) => {
    g.fillStyle = '#1d2b4f'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f3ecd9'; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 2;
    for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 64, 128 + Math.sin(a) * 64); g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); g.stroke(); }
    g.strokeStyle = '#c9a24b'; g.lineWidth = 7; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1b1b1b'; g.font = 'bold 22px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const rn = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    rn.forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(t, 128 + Math.cos(a) * 94, 128 + Math.sin(a) * 94); });
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 1;
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20); g.lineTo(128 + Math.cos(a) * 60, 128 + Math.sin(a) * 60); g.stroke(); }
    g.strokeStyle = '#b08a3a'; g.lineCap = 'round';
    g.lineWidth = 8; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 52, 128 + 18); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 6, 128 - 92); g.stroke();
  }, { rough: 0.45, emissive: 0xfff1cf, night: 1.5 });
}

const bigBen: Builder = () => {
  euStyles();
  const b = built();
  const stone = mat('anston', 0xc6aa72, 0.85), gilt = GILT(), prussian = mat('prussian', 0x1d2b4f, 0.5, 0.3), iron = mat('bb-iron', 0x2f3542, 0.55, 0.5);
  // The shaft: 12 m square of Anston limestone, panelled the full height, buttress strips at the corners.
  tier(b, rect(12, 12), 0, 48, 'anston');
  const strips: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) strips.push(new THREE.BoxGeometry(1.3, 49, 1.3).translate(sx * 5.9, 24.5, sz * 5.9));
  addMerged(b, strips, stone);
  band(b, rect(12, 12), 47.4, 0.9, 0.5, stone);
  // The clock stage: slightly wider, a 7 m dial on each face in a gilt and Prussian-blue surround.
  tier(b, rect(13.4, 13.4), 48, 62, 'anston');
  const dial = dialMat();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, sx = Math.sin(a), sz = Math.cos(a);
    add(b, new THREE.BoxGeometry(9.6, 9.6, 0.3).rotateY(a).translate(sx * 6.75, 55, sz * 6.75), prussian);
    add(b, new THREE.CircleGeometry(3.5, 40).rotateY(a).translate(sx * 6.92, 55, sz * 6.92), dial);
    add(b, new THREE.TorusGeometry(3.65, 0.22, 6, 40).rotateY(a).translate(sx * 6.9, 55, sz * 6.9), gilt, true);
    // A gilt inscription band under the dial and a gablet over it.
    add(b, new THREE.BoxGeometry(8.4, 0.5, 0.2).rotateY(a).translate(sx * 6.9, 49.9, sz * 6.9), gilt, true);
    const gab = new THREE.Shape([new THREE.Vector2(-5, 0), new THREE.Vector2(5, 0), new THREE.Vector2(0, 3.4)]);
    add(b, new THREE.ExtrudeGeometry(gab, { depth: 0.6, bevelEnabled: false }).translate(0, 0, -0.3).rotateY(a).translate(sx * 6.7, 62, sz * 6.7), stone);
  }
  // The belfry: open traceried arcades (dark), gilt shafts between them, pinnacles at the corners.
  tier(b, rect(11.6, 11.6), 62, 72.5, 'anston', { mat: stone });
  const arc: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    for (const o of [-3.2, 0, 3.2]) arc.push(new THREE.BoxGeometry(2.3, 7.5, 0.1).translate(o, 67.4, 5.84).rotateY(a));
  }
  addMerged(b, arc, iron);
  const pins: THREE.BufferGeometry[] = [], gpins: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pins.push(new THREE.CylinderGeometry(0.55, 0.7, 6, 8).translate(sx * 6.1, 70, sz * 6.1));
    gpins.push(new THREE.ConeGeometry(0.6, 4.2, 8).translate(sx * 6.1, 75.1, sz * 6.1));
  }
  addMerged(b, pins, stone, true); addMerged(b, gpins, gilt, true);
  band(b, rect(11.6, 11.6), 72.2, 0.8, 0.45, gilt);
  // The spire: a steep cast-iron roof in Prussian blue and gilt, the Ayrton Light's lantern, the finial.
  add(b, loft([{ ring: rect(11.2, 11.2), y: 72.5 }, { ring: rect(5.4, 5.4), y: 84 }, { ring: rect(3.6, 3.6), y: 87.5 }], [2, 2], true), prussian);
  const ribs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ribs.push(strut(new THREE.Vector3(sx * 5.6, 72.5, sz * 5.6), new THREE.Vector3(sx * 1.8, 87.5, sz * 1.8), 0.2, 6));
  for (let y = 75; y < 86; y += 3.5) { const w = 11.2 - ((y - 72.5) / 11.5) * 5.8; ribs.push(new THREE.BoxGeometry(w + 0.1, 0.25, w + 0.1).translate(0, y, 0)); }
  addMerged(b, ribs, gilt, true);
  add(b, new THREE.BoxGeometry(3.4, 2.6, 3.4).translate(0, 88.8, 0), glowMat('bb-ayrton', 0xfff0c8, 0.05, 2.5));
  add(b, loft([{ ring: rect(3.6, 3.6), y: 90.1 }, { ring: rect(0.3, 0.3), y: 95 }], [1, 1], true), gilt);
  add(b, new THREE.CylinderGeometry(0.08, 0.12, 1.2, 6).translate(0, 95.6, 0), gilt, true);
  b.solids.push({ ring: rect(13.4, 13.4), y0: 0, y1: 90 });
  return b;
};

// ------------------------------------------------------------------ Tower Bridge

/** Tower Bridge: two stone-clad towers on river piers, the bascules, the high-level walkways and the
 * blue and white suspension chains over the side spans to the shore towers. The road runs along z. */
const towerBridge: Builder = () => {
  euStyles();
  const b = built();
  const S = 61, T = 17, TW = 23, DECK = 8.6;
  const blue = mat('tb-blue', 0x78acd8, 0.5, 0.35), white = mat('tb-white', 0xeef0ee, 0.55, 0.2), granite = mat('tb-granite', 0xa9a39a, 0.9);
  const slate = mat('tb-slate', 0x4b5363, 0.7, 0.2), gilt = GILT(), road = mat('tb-road', 0x4a4c50, 0.95);
  for (const sz of [-1, 1]) {
    const zc = sz * (S / 2 + T / 2);
    // River pier with pointed cutwaters, granite.
    const pier = [-27, zc, -21, zc - 10.5, 21, zc - 10.5, 27, zc, 21, zc + 10.5, -21, zc + 10.5];
    add(b, prism(pier, -6, 3.5, [4, 4]), granite);
    b.solids.push({ ring: pier, y0: -6, y1: 3.5 });
    // The tower: two legs with the road arch between them, the body above, four corner turrets.
    for (const sx of [-1, 1]) tier(b, rect(5, T, sx * (TW / 2 - 2.5), zc), 3.5, 24, 'tbStone');
    tier(b, rect(TW, T, 0, zc), 24, 55, 'tbStone');
    const arch = new THREE.Shape();
    // The spandrel over the pointed road arch.
    arch.moveTo(-6.5, 5); arch.quadraticCurveTo(-6.3, 10.5, 0, 12.2); arch.quadraticCurveTo(6.3, 10.5, 6.5, 5);
    arch.lineTo(6.5, 12.6); arch.lineTo(-6.5, 12.6); arch.closePath();
    for (const fz of [-1, 1]) add(b, new THREE.ExtrudeGeometry(arch, { depth: 1.2, bevelEnabled: false }).translate(0, DECK + 2.8, fz > 0 ? T / 2 - 1.2 : -T / 2).translate(0, 0, zc), mat('tb-stone', 0xd7d0c0, 0.85));
    const turrets: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [], fin: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const tz of [-1, 1]) {
      const x = sx * (TW / 2 - 0.6), z = zc + tz * (T / 2 - 0.6);
      turrets.push(prism(ngon(8, 3.1, Math.PI / 8, x, z), 3.5, 59, STYLES.tbStone.tile));
      caps.push(new THREE.ConeGeometry(3.3, 6.5, 8).rotateY(Math.PI / 8).translate(x, 62.25, z));
      fin.push(new THREE.CylinderGeometry(0.08, 0.18, 2.6, 6).translate(x, 66.6, z), new THREE.SphereGeometry(0.35, 8, 6).translate(x, 66, z));
    }
    addMerged(b, turrets, facadeMat('tbStone'));
    addMerged(b, caps, slate); addMerged(b, fin, gilt, true);
    // The steep hipped roof of the tower with its gilt cresting.
    add(b, loft([{ ring: rect(TW - 3, T - 3, 0, zc), y: 55 }, { ring: rect(6, 2.5, 0, zc), y: 63 }], [3, 3], true), slate);
    add(b, new THREE.BoxGeometry(6, 0.4, 0.3).translate(0, 63.2, zc), gilt, true);
    band(b, rect(TW, T, 0, zc), 54.4, 0.9, 0.4, white);
    for (const sx of [-1, 1]) b.solids.push({ ring: rect(5, T, sx * (TW / 2 - 2.5), zc), y0: 3.5, y1: 59 });
    b.solids.push({ ring: rect(TW, T, 0, zc), y0: 24, y1: 63 });
  }
  // The bascules and the side-span decks (blue girders along both edges).
  const half = S / 2 + T, side = 82;
  for (const [z0, z1] of [[-S / 2, S / 2], [-(half + side), -half], [half, half + side]]) {
    add(b, new THREE.BoxGeometry(12.6, 0.4, z1 - z0).translate(0, DECK - 0.2, (z0 + z1) / 2), road);
    for (const sx of [-1, 1]) add(b, new THREE.BoxGeometry(0.7, 2.2, z1 - z0).translate(sx * 6.6, DECK - 1.3, (z0 + z1) / 2), blue);
    // Parapet railings.
    for (const sx of [-1, 1]) add(b, new THREE.BoxGeometry(0.25, 1.1, z1 - z0).translate(sx * 6.3, DECK + 0.55, (z0 + z1) / 2), blue, true);
    b.solids.push({ ring: rect(12.6, z1 - z0, 0, (z0 + z1) / 2), y0: DECK - 2.4, y1: DECK });
  }
  // The high-level walkways, 44 m above the river: lattice girders in blue with white trim.
  const lattice = paintedMat('tb-walk', [256, 64], (g, W, H) => {
    g.fillStyle = '#78acd8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#5a8fbf'; g.lineWidth = 4;
    for (let x = -H; x < W + H; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = '#eef0ee'; g.fillRect(0, 0, W, 5); g.fillRect(0, H - 5, W, 5);
  }, { metal: 0.3, rough: 0.5 });
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(3.4, 4.6, S).translate(sx * 8.2, 44.3, 0);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * S / 18, uv.getY(i));
    add(b, g, lattice);
    b.solids.push({ ring: rect(3.4, S, sx * 8.2, 0), y0: 42, y1: 46.6 });
  }
  // The side spans: curved chain girders from the towers down to the deck and up to the shore towers.
  const chains: THREE.BufferGeometry[] = [], hangers: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const x = sx * 6.6, za = sz * half, zb = sz * (half + side);
    const P = (t: number) => new THREE.Vector3(x, 40 * (1 - t) * (1 - t) + 2 * t * (1 - t) * 4 + t * t * 21, za + (zb - za) * t);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) pts.push(P(i / 24));
    chains.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.75, 6));
    for (let i = 1; i < 14; i++) { const p = P(i / 14); if (p.y > DECK + 1) hangers.push(strut(new THREE.Vector3(x, DECK, p.z), p, 0.12, 4)); }
  }
  addMerged(b, chains, blue); addMerged(b, hangers, white, true);
  // The shore towers where the chains are anchored.
  for (const sz of [-1, 1]) {
    const zc = sz * (half + side + 4);
    for (const sx of [-1, 1]) {
      tier(b, rect(5, 8, sx * 7.5, zc), 0, 22, 'tbStone');
      add(b, new THREE.ConeGeometry(3.2, 5, 4).rotateY(Math.PI / 4).translate(sx * 7.5, 24.5, zc), slate);
    }
  }
  return b;
};

// ------------------------------------------------------------------ the Shard

/** The Shard: eight glass facets leaning in toward a point, stopping short of each other so the top
 * breaks into splinters (306 m of glass, the spire to 310 m). */
const shard: Builder = (c) => {
  const b = built();
  STYLES.shardGlass ??= {
    tile: [3, 3.7], px: [64, 96], rough: 0.08, metal: 0.85, glow: 0xe8eeff,
    paint(g, W, H, lit) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); if (rand(W + H) < 2) { g.fillStyle = 'rgba(220,230,255,0.35)'; g.fillRect(3, 3, W - 6, H * 0.75); } return; }
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#c6d3de'); grd.addColorStop(1, '#a5b6c6');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e1e8ee'; g.fillRect(0, 0, 2, H); g.fillRect(0, H - 4, W, 3);
    },
  };
  const glass = facadeMat('shardGlass').clone();
  glass.side = THREE.DoubleSide;
  // Base outline: an irregular octagon (fitted to the map's tower when it's there).
  let R = 27;
  if (c.rings.length) {
    let far = 0;
    for (const p of c.rings) for (let i = 0; i < p.ring.length; i += 2) far = Math.max(far, Math.hypot(p.ring[i], p.ring[i + 1]));
    R = Math.min(32, Math.max(22, far * 0.92));
  }
  const n = 8, apexH = 318;
  const rad = Array.from({ length: n }, (_, i) => R * (0.86 + rand(i + 3) * 0.2));
  const ang = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + (rand(i + 11) - 0.5) * 0.25);
  const pt = (i: number, y: number) => { const k = i % n, s = 1 - y / apexH; return [Math.cos(ang[k]) * rad[k] * s, Math.sin(ang[k]) * rad[k] * s] as const; };
  // The dark core (the floors) up to where the facets open out.
  const core = (y: number) => { const out: number[] = []; for (let i = 0; i < n; i++) { const [x, z] = pt(i, y); out.push(x * 0.97, z * 0.97); } return out; };
  add(b, loft([{ ring: core(0), y: 0 }, { ring: core(244), y: 244 }], STYLES.shardGlass.tile, true), facadeMat('shardGlass'));
  // Each facet a separate leaning plane, its top at a different height, its corners pulled back.
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < n; i++) {
    const top = 268 + rand(i + 21) * 38;
    const a0 = 0.03 + rand(i + 31) * 0.04, a1 = 0.97 - rand(i + 41) * 0.04;
    const P = (t: number, y: number) => { const [x0, z0] = pt(i, y), [x1, z1] = pt(i + 1, y); const nx = (x0 + x1) / 2, nz = (z0 + z1) / 2, l = Math.hypot(nx, nz) || 1; return [x0 + (x1 - x0) * t + (nx / l) * 0.5, y, z0 + (z1 - z0) * t + (nz / l) * 0.5]; };
    const ys = [0, 120, 244, top];
    let u0 = 0;
    for (let k = 0; k + 1 < ys.length; k++) {
      const yA = ys[k], yB = ys[k + 1];
      // Above the core the facet narrows to a splinter.
      const tA0 = k < 2 ? a0 : a0 + 0.12, tA1 = k < 2 ? a1 : a1 - 0.12, tB0 = k < 2 ? a0 : 0.42 + rand(i) * 0.1, tB1 = k < 2 ? a1 : 0.5 + rand(i + 5) * 0.1;
      const q = [P(k < 2 ? a0 : tA0, yA), P(k < 2 ? a1 : tA1, yA), P(k + 1 < 2 ? a1 : tB1, yB), P(k + 1 < 2 ? a0 : tB0, yB)];
      const w = Math.hypot(q[1][0] - q[0][0], q[1][2] - q[0][2]);
      pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
      const s = STYLES.shardGlass.tile;
      uv.push(u0, yA / s[1], u0 + w / s[0], yA / s[1], u0 + w / s[0], yB / s[1], u0, yA / s[1], u0 + w / s[0], yB / s[1], u0, yB / s[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  add(b, g, glass);
  b.solids.push({ ring: core(0), y0: 0, y1: 120 }, { ring: core(120), y0: 120, y1: 244 });
  return b;
};

// ------------------------------------------------------------------ 30 St Mary Axe

const gherkin: Builder = () => {
  const b = built();
  // Diagrid glass: light panels, six dark spirals winding round the tower (about 200° over 41 floors).
  const skin = paintedMat('gherkin', [512, 512], (g, W, H) => {
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const u = i / W, v = 1 - j / H;
      const band = ((u * 6 + v * 3.3) % 1 + 1) % 1 < 0.36;
      const d1 = ((u * 48 + v * 22) % 1 + 1) % 1, d2 = ((u * 48 - v * 22) % 1 + 1) % 1;
      const grid = d1 < 0.06 || d2 < 0.06;
      const sh = 0.92 + 0.08 * Math.sin(v * 80);
      let r = band ? 52 : 168, gg = band ? 66 : 190, bb = band ? 84 : 205;
      if (grid) { r = 214; gg = 220; bb = 224; }
      const k = (j * W + i) * 4;
      img.data[k] = r * sh; img.data[k + 1] = gg * sh; img.data[k + 2] = bb * sh; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { rough: 0.12, metal: 0.55 });
  const prof: [number, number][] = [[24.6, 0], [26.3, 18], [27.6, 38], [28.07, 60], [27.7, 80], [26.4, 100], [24.1, 120], [20.6, 140], [16, 157], [11, 169], [6, 176.5], [2.4, 179.4], [0.2, 180]];
  add(b, lathe(prof, 64), skin);
  // The glazed lobby band at street level.
  add(b, new THREE.CylinderGeometry(24.7, 24.7, 5, 64, 1, true).translate(0, 2.5, 0), glassMat('gk-lobby', 0x6f8796, 0.5));
  b.solids.push({ ring: ngon(16, 26), y0: 0, y1: 120 }, { ring: ngon(16, 18), y0: 120, y1: 160 }, { ring: ngon(12, 9), y0: 160, y1: 178 });
  return b;
};

// ------------------------------------------------------------------ St Paul's

/** St Paul's dome: the peristyle and Stone Gallery, the attic, Wren's lead dome, the Golden Gallery,
 * the lantern and the gilt ball and cross at 111 m. On the map's drum footprint. */
const stPaulsDome: Builder = () => {
  euStyles();
  const b = built();
  const stone = PORTLAND(), gilt = GILT();
  tier(b, rect(30, 30), -1, 33, 'portland', { mat: stone });
  // The peristyle: 32 columns round the drum, the drum wall behind them with its windows.
  add(b, new THREE.CylinderGeometry(21.6, 21.6, 1.8, 48).translate(0, 33.9, 0), stone);
  addMerged(b, colonnade(20.3, 32, 0.78, 34.8, 48.6), stone);
  add(b, new THREE.CylinderGeometry(17.6, 17.6, 17, 48, 1, true).translate(0, 43.3, 0), facadeMat('travArch'));
  add(b, new THREE.CylinderGeometry(21.6, 21.6, 2.6, 48).translate(0, 49.9, 0), stone);
  // The Stone Gallery's balustrade, then the attic.
  add(b, new THREE.CylinderGeometry(21.3, 21.3, 1.2, 48, 1, true).translate(0, 51.8, 0), stone, true);
  add(b, new THREE.CylinderGeometry(17.2, 17.6, 9.5, 48).translate(0, 56, 0), facadeMat('portland'));
  add(b, new THREE.CylinderGeometry(17.8, 17.8, 1, 48).translate(0, 61, 0), stone);
  // The outer dome: lead with ribs, slightly taller than a hemisphere.
  add(b, lathe(domeProfile(17.2, 61.5, 23.5, 14), 48), ribbedMat('stpauls', '#7d8588', '#8e9699', 32));
  // Golden Gallery, lantern, ball and cross.
  add(b, new THREE.TorusGeometry(4.6, 0.15, 6, 24).rotateX(Math.PI / 2).translate(0, 86, 0), gilt, true);
  add(b, new THREE.CylinderGeometry(3.8, 4.2, 2.5, 16).translate(0, 85.6, 0), stone);
  add(b, new THREE.CylinderGeometry(2.8, 3.2, 10.5, 16).translate(0, 92, 0), stone);
  addMerged(b, colonnade(3.5, 8, 0.32, 87, 96.5), stone, true);
  add(b, lathe(domeProfile(3.4, 97.2, 3.4, 8), 16), LEAD());
  add(b, new THREE.CylinderGeometry(0.5, 1.2, 4, 12).translate(0, 102.3, 0), LEAD());
  addMerged(b, crossOnBall(0, 104.2, 0, 1.6), gilt);
  b.solids.push({ ring: ngon(16, 21.6), y0: 0, y1: 53 }, { ring: ngon(16, 17.2), y0: 53, y1: 78 }, { ring: ngon(8, 4), y0: 78, y1: 104 });
  return b;
};

/** St Paul's west towers, one on each of the map's tower footprints: belfry and clock stages in
 * Portland stone with paired columns, the concave lead cupolas and gilt pineapple finials (67 m). */
const stPaulsTowers: Builder = (c) => {
  euStyles();
  const b = built();
  const stone = PORTLAND(), gilt = GILT();
  const spots = c.rings.filter((p) => areaOf(p.ring) < 400).map((p) => centerOf(p.ring));
  const at = spots.length ? spots : [{ x: 0, z: -20.9 }, { x: 0, z: 20.9 }];
  for (const { x, z } of at) {
    tier(b, rect(11, 11, x, z), -1, 38, 'portland', { mat: facadeMat('portland') });
    band(b, rect(11, 11, x, z), 37.4, 1.2, 0.5, stone);
    add(b, new THREE.CylinderGeometry(4.6, 5, 13, 8).rotateY(Math.PI / 8).translate(x, 45, z), facadeMat('travArch'));
    addMerged(b, colonnade(5.6, 8, 0.4, 38.6, 50.5, x, z, Math.PI / 8), stone);
    add(b, new THREE.CylinderGeometry(6, 6, 1.2, 8).rotateY(Math.PI / 8).translate(x, 51.2, z), stone);
    add(b, new THREE.CylinderGeometry(3.6, 4.4, 4, 8).rotateY(Math.PI / 8).translate(x, 53.8, z), stone);
    // The cupola: concave lead, then the gilt pineapple.
    add(b, lathe([[4.2, 55.8], [3.4, 57.6], [2.1, 59.8], [1.3, 61.4], [0.9, 62.6], [0.3, 63.2]], 16, x, z), LEAD());
    add(b, new THREE.SphereGeometry(0.9, 10, 8).scale(1, 1.6, 1).translate(x, 64.6, z), gilt);
    add(b, new THREE.CylinderGeometry(0.06, 0.2, 2.2, 6).translate(x, 66.4, z), gilt, true);
    b.solids.push({ ring: rect(11, 11, x, z), y0: -1, y1: 63 });
  }
  return b;
};

// ------------------------------------------------------------------ the London Eye

/** The London Eye: the 120 m rim (a triangular truss) on 64 spoke cables, 32 glass capsules outside
 * it, held from the land side by the raked A-frame. The wheel turns in the y–z plane (axle along x). */
const londonEye: Builder = () => {
  const b = built();
  const white = mat('eye-white', 0xf1f2f2, 0.45, 0.4), steel = mat('eye-steel', 0xd9dde0, 0.35, 0.7);
  const HUB = 71, R0 = 60.5, R1 = 57.5;
  // Rim: outer chord and two inner chords, braced.
  const rimA = new THREE.TorusGeometry(R0, 0.55, 6, 128).rotateY(Math.PI / 2).translate(0, HUB, 0);
  const rims = [rimA, ...[-2.3, 2.3].map((x) => new THREE.TorusGeometry(R1, 0.42, 6, 128).rotateY(Math.PI / 2).translate(x, HUB, 0))];
  addMerged(b, rims, white);
  const brace: THREE.BufferGeometry[] = [], spokes: THREE.BufferGeometry[] = [];
  const P = (r: number, a: number, x: number) => new THREE.Vector3(x, HUB + Math.sin(a) * r, Math.cos(a) * r);
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2, a2 = ((k + 1) / 64) * Math.PI * 2;
    for (const x of [-2.3, 2.3]) {
      brace.push(strut(P(R0, a, 0), P(R1, a, x), 0.16, 4), strut(P(R1, a, x), P(R0, a2, 0), 0.13, 4));
      if (k % 2) brace.push(strut(P(R1, a, -2.3), P(R1, a, 2.3), 0.12, 4));
    }
    spokes.push(strut(new THREE.Vector3(k % 2 ? -8 : 8, HUB, 0), P(R1, a, k % 2 ? -2.3 : 2.3), 0.07, 3));
  }
  addMerged(b, brace, white, true);
  addMerged(b, spokes, steel);
  // Hub and spindle.
  add(b, new THREE.CylinderGeometry(2.2, 2.2, 18, 20).rotateZ(Math.PI / 2).translate(0, HUB, 0), white);
  add(b, new THREE.CylinderGeometry(3.4, 3.4, 1.2, 24).rotateZ(Math.PI / 2).translate(-8.2, HUB, 0), white);
  add(b, new THREE.CylinderGeometry(3.4, 3.4, 1.2, 24).rotateZ(Math.PI / 2).translate(8.2, HUB, 0), white);
  // Capsules: glass eggs on the outside of the rim, each kept level.
  const caps: THREE.BufferGeometry[] = [], rings: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2 + 0.05, y = HUB + Math.sin(a) * (R0 + 3), z = Math.cos(a) * (R0 + 3);
    caps.push(new THREE.SphereGeometry(1, 16, 10).scale(4.1, 2.1, 2.1).translate(0, y, z));
    rings.push(new THREE.TorusGeometry(2.15, 0.12, 4, 20).rotateY(Math.PI / 2).translate(-2.4, y, z), new THREE.TorusGeometry(2.15, 0.12, 4, 20).rotateY(Math.PI / 2).translate(2.4, y, z));
    rings.push(new THREE.BoxGeometry(7.6, 0.18, 3.4).translate(0, y - 1.2, z));
  }
  addMerged(b, caps, glassMat('eye-capsule', 0xcfe4ec, 0.45));
  addMerged(b, rings, steel, true);
  // The A-frame, raked back to the land side (east), and its backstay cables.
  const legs: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) {
    legs.push(strut(new THREE.Vector3(30, 0, sz * 17), new THREE.Vector3(9.4, HUB, sz * 1.4), 1.1, 10));
    legs.push(strut(new THREE.Vector3(9.4, HUB, 0), new THREE.Vector3(80, 0, sz * 32), 0.12, 4));
  }
  legs.push(strut(new THREE.Vector3(24, 18, -12.4), new THREE.Vector3(24, 18, 12.4), 0.5, 6));
  addMerged(b, legs, white);
  // Boarding platform over the river wall.
  add(b, new THREE.BoxGeometry(14, 1.6, 54).translate(1, 0.8, 0), mat('eye-deck', 0x8a8d90, 0.9));
  add(b, new THREE.BoxGeometry(12, 0.3, 40).translate(1, 5.2, 0), glassMat('eye-canopy', 0xe6eef2, 0.4), true);
  b.solids.push({ ring: rect(14, 54, 1, 0), y0: 0, y1: 1.6 });
  for (const sz of [-1, 1]) b.solids.push({ ring: rect(4, 4, 28, sz * 16), y0: 0, y1: 12 });
  return b;
};

// ------------------------------------------------------------------ the White Tower

const whiteTower: Builder = () => {
  euStyles();
  const b = built();
  const stone = mat('wt-stone', 0xe2dccd, 0.95), gilt = GILT();
  tier(b, rect(36, 32), -1, 27, 'norman');
  // Crenellated parapet.
  const mer: THREE.BufferGeometry[] = [];
  for (const [ax, az, bx, bz] of [[-18, -16, 18, -16], [18, -16, 18, 16], [18, 16, -18, 16], [-18, 16, -18, -16]]) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 2.4);
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; mer.push(new THREE.BoxGeometry(1.2, 1.5, 1.2).translate(ax + (bx - ax) * t, 27.75, az + (bz - az) * t)); }
  }
  addMerged(b, mer, stone, true);
  // Corner turrets (the north-east one round), each with its lead cupola and weathervane.
  const tops: [number, number, boolean][] = [[-18, -16, false], [-18, 16, false], [18, 16, false], [18, -16, true]];
  for (const [x, z, round] of tops) {
    if (round) add(b, new THREE.CylinderGeometry(4.3, 4.3, 35, 20).translate(x, 16.5, z), facadeMat('norman'));
    else tier(b, rect(6.2, 6.2, x, z), -1, 32, 'norman');
    const y = round ? 34 : 32;
    add(b, lathe([[round ? 4.4 : 3.6, y], [round ? 4.6 : 3.8, y + 1.4], [3.2, y + 3], [1.6, y + 4.4], [0.4, y + 5.4], [0.1, y + 6]], 16, x, z), LEAD());
    add(b, new THREE.CylinderGeometry(0.05, 0.08, 2.4, 6).translate(x, y + 7, z), gilt, true);
    add(b, new THREE.BoxGeometry(1.1, 0.6, 0.05).translate(x + 0.5, y + 7.6, z), gilt, true);
    b.solids.push({ ring: rect(6.2, 6.2, x, z), y0: -1, y1: y + 4 });
  }
  return b;
};

// ------------------------------------------------------------------ Nelson's Column

/** Nelson's Column (51.6 m): the granite pedestal with its four bronze reliefs, Landseer's lions,
 * the fluted Corinthian column, the bronze capital, and Nelson on top. */
const nelson: Builder = () => {
  const b = built();
  const granite = mat('nc-granite', 0xb9b3a8, 0.8), bronze = mat('nc-bronze', 0x3d3a33, 0.5, 0.6), statue = mat('nc-statue', 0xa49d90, 0.85);
  add(b, new THREE.BoxGeometry(17, 0.6, 17).translate(0, 0.3, 0), granite);
  add(b, new THREE.BoxGeometry(13, 0.6, 13).translate(0, 0.9, 0), granite);
  add(b, new THREE.BoxGeometry(6.4, 9.2, 6.4).translate(0, 5.8, 0), granite);
  const rel: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) rel.push(new THREE.BoxGeometry(4.6, 3.6, 0.2).translate(0, 4.4, 3.25).rotateY((k * Math.PI) / 2));
  addMerged(b, rel, bronze, true);
  add(b, new THREE.BoxGeometry(5.2, 1.6, 5.2).translate(0, 11.2, 0), granite);
  const fl = paintedMat('nc-flutes', [256, 16], (g, W, H) => { g.fillStyle = '#bdb7ac'; g.fillRect(0, 0, W, H); g.fillStyle = '#9f998e'; for (let k = 0; k < 24; k++) g.fillRect((k / 24) * W, 0, 3, H); });
  add(b, new THREE.CylinderGeometry(1.3, 1.55, 31, 24, 1, true).translate(0, 27.5, 0), fl);
  add(b, lathe([[1.35, 43], [1.9, 44.6], [2.6, 46], [2.7, 46.8], [0.1, 46.9]], 16), bronze);
  add(b, new THREE.BoxGeometry(2.8, 1, 2.8).translate(0, 47.4, 0), granite);
  add(b, new THREE.CylinderGeometry(0.55, 0.75, 4.2, 10).translate(0, 50, 0), statue);
  add(b, new THREE.SphereGeometry(0.42, 10, 8).translate(0, 52.5, 0), statue);
  add(b, new THREE.BoxGeometry(0.9, 0.35, 0.5).translate(0, 53, 0), statue, true);
  // The four lions on their plinths, facing out along the diagonals.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4, x = Math.cos(a) * 8.6, z = Math.sin(a) * 8.6;
    const lion = [
      new THREE.BoxGeometry(6, 1.6, 2.6).translate(0, 2, 0),
      new THREE.CapsuleGeometry(1.1, 3.2, 4, 8).rotateZ(Math.PI / 2).translate(-0.4, 3.0, 0),
      new THREE.SphereGeometry(1.15, 10, 8).translate(1.9, 3.7, 0),
      new THREE.BoxGeometry(2.2, 0.6, 1.8).translate(2.6, 2.6, 0),
    ].map((g) => g.rotateY(-a).translate(x, 0, z));
    addMerged(b, lion.slice(1), bronze);
    add(b, lion[0], granite);
  }
  b.solids.push({ ring: rect(13, 13), y0: 0, y1: 1.2 }, { ring: rect(6.4, 6.4), y0: 0, y1: 12 }, { ring: ngon(12, 1.6), y0: 12, y1: 53 });
  return b;
};

export const LONDON_BUILDERS: Record<string, Builder> = { nelson, bigBen, towerBridge, shard, gherkin, stPaulsDome, stPaulsTowers, londonEye, whiteTower };
void solidMat;
