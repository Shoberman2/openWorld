// Rome, Barcelona, Berlin, Istanbul, Dubai and Giza: St Peter's, the Pantheon, the Sagrada Família,
// the Brandenburg Gate, the Fernsehturm, Hagia Sophia, the Sultan Ahmed Mosque, the Burj Al Arab,
// the three pyramids and the Sphinx. Model frame: y up, x east, z south (−z is the bearing).
import * as THREE from 'three';
import { band, built, facadeMat, glowMat, ngon, prism, rect, STYLES, tier, type Built } from './kit.ts';
import type { BuildCtx } from './models.ts';
import { add, addMerged, colonnade, columnRow, crossOnBall, domeOnDrum, domeProfile, euStyles, GILT, lathe, loft, mat, minaret, paintedMat, pediment, rand, strut } from './eu-kit.ts';
import { areaOf, at, bboxOf, centerOf, type Part } from './eu-parts.ts';
import { ribbedMat } from './eu-london.ts';

type Builder = (c: BuildCtx) => Built;

function body(b: Built, parts: Part[], style: string, cap: number, mat?: THREE.Material) {
  for (const p of parts) {
    const top = Math.min(cap, p.y1);
    if (top < 2) continue;
    const m = new THREE.Mesh(prism(p.ring, Math.max(-1.5, p.y0), top, STYLES[style]?.tile ?? [4, 4], true, p.holes), mat ?? facadeMat(style));
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: p.ring, y0: p.y0, y1: top });
  }
}

/** Half a dome (a semi-dome over an apse or exedra), open side facing direction a (radians, x toward z). */
function semiDome(r: number, y: number, x: number, z: number, a: number, h = r) {
  return new THREE.SphereGeometry(r, 20, 10, 0, Math.PI, 0, Math.PI / 2).scale(1, h / r, 1).rotateY(-a - Math.PI / 2).translate(x, y, z);
}

// ------------------------------------------------------------------ Rome

/** St Peter's: the basilica on the map's outline in travertine, Maderno's façade to the east, and
 * Michelangelo's dome over the crossing: drum with paired columns, the ribbed lead dome, the lantern,
 * ball and cross at 136.6 m; two of the minor cupolas. */
const stPeters: Builder = (c) => {
  euStyles();
  const b = built();
  const trav = mat('sp-trav', 0xe6dcc6, 0.85), lead = mat('sp-lead', 0x8c9aa3, 0.5, 0.35), gilt = GILT();
  const parts = c.rings.filter((p) => areaOf(p.ring) > 400);
  if (parts.length) body(b, parts, 'travArch', 44);
  else { tier(b, rect(210, 60, 0, 0), -1, 44, 'travArch'); tier(b, rect(140, 140, -40, 0), -1, 44, 'travArch'); }
  const bb = bboxOf(parts, 105);
  const zc = (bb.z0 + bb.z1) / 2;
  // The dome stands over the crossing of Michelangelo's Greek cross, about a third of the way from the apse.
  const dx = bb.x0 + (bb.x1 - bb.x0) * 0.34;
  tier(b, rect(56, 56, dx, zc), 30, 46, 'travArch', { mat: trav });
  add(b, new THREE.CylinderGeometry(24.6, 24.6, 23, 48, 1, true).translate(dx, 57.5, zc), facadeMat('travArch'));
  const cols: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 16; k++) for (const d of [-0.04, 0.04]) { const a = (k / 16) * Math.PI * 2 + d; cols.push(new THREE.CylinderGeometry(0.8, 0.9, 20, 10).translate(dx + Math.cos(a) * 26.4, 56, zc + Math.sin(a) * 26.4)); }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; cols.push(new THREE.BoxGeometry(4.2, 20, 3.4).rotateY(-a).translate(dx + Math.cos(a) * 25.4, 56, zc + Math.sin(a) * 25.4)); }
  addMerged(b, cols, trav);
  add(b, new THREE.CylinderGeometry(27.6, 27.6, 3.2, 48).translate(dx, 67.6, zc), trav);
  add(b, new THREE.CylinderGeometry(24.2, 24.8, 7, 48).translate(dx, 72.7, zc), facadeMat('ashlar'));
  add(b, lathe([[24.2, 76], [23.8, 82], [22.4, 90], [19.6, 99], [15.4, 107], [10, 113.6], [5.4, 116.6]], 48, dx, zc), ribbedMat('stpeter', '#8c9aa3', '#c9c7bd', 16, { band: '#7e8b94' }));
  // The lantern: a little colonnaded temple, its lead cone, the gilt ball and cross.
  addMerged(b, colonnade(5.6, 16, 0.4, 116.6, 126, dx, zc), trav);
  add(b, new THREE.CylinderGeometry(4.6, 4.8, 10, 16).translate(dx, 121.6, zc), trav);
  add(b, lathe([[5.6, 126.4], [4.6, 128.6], [2.6, 130.6], [0.9, 132]], 16, dx, zc), lead);
  addMerged(b, crossOnBall(dx, 131.6, zc, 1.3), gilt);
  b.solids.push({ ring: ngon(16, 26, 0, dx, zc), y0: 0, y1: 76 }, { ring: ngon(16, 18, 0, dx, zc), y0: 76, y1: 112 });
  // Two minor cupolas on the east corners of the cross.
  for (const sz of [-1, 1]) domeOnDrum(b, dx + 40, zc + sz * 40, 6, 44, 53, 8, facadeMat('travArch'), lead, 16);
  // Maderno's façade on the east end: giant columns, the attic, the thirteen statues.
  const xf = bb.x1 + 1;
  tier(b, rect(6, 114.7, xf - 2, zc), -1, 45.5, 'travArch', { mat: facadeMat('travArch') });
  const fc = [...columnRow(xf + 1.6, zc - 26, xf + 1.6, zc + 26, 8, 1.5, 0, 28), ...columnRow(xf + 1, zc - 50, xf + 1, zc - 36, 3, 1.3, 0, 28), ...columnRow(xf + 1, zc + 36, xf + 1, zc + 50, 3, 1.3, 0, 28)];
  addMerged(b, fc, trav);
  add(b, new THREE.BoxGeometry(5, 3.6, 116).translate(xf, 29.8, zc), trav);
  add(b, pediment(26, 6.4, 3, xf + 1.6, 31.6, zc, Math.PI / 2), trav);
  const st: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 13; k++) { const z = zc - 30 + k * 5; st.push(new THREE.CylinderGeometry(0.55, 0.7, 5.6, 8).translate(xf - 1, 48.3, z), new THREE.SphereGeometry(0.45, 8, 6).translate(xf - 1, 51.5, z)); }
  addMerged(b, st, mat('sp-statue', 0xd8d0bd, 0.9), true);
  return b;
};

/** The Pantheon: the brick-faced rotunda with its stepped rings, the shallow concrete dome and its
 * open oculus, the intermediate block, and the portico of sixteen granite columns facing north. */
const pantheonRome: Builder = (c) => {
  const b = built();
  const brick = paintedMat('pr-brick', [128, 128], (g, W, H) => {
    g.fillStyle = '#b29a7e'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 4) { g.fillStyle = `rgba(120,95,70,${0.1 + rand(y) * 0.15})`; g.fillRect(0, y, W, 1); }
    for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(90,80,70,${0.06 + rand(k) * 0.08})`; g.fillRect(rand(k + 1) * W, rand(k + 2) * H, 10 + rand(k + 3) * 30, 6 + rand(k + 4) * 20); }
  }, { rough: 0.95, repeat: [24, 3] });
  const marble = mat('pr-marble', 0xe4ddcb, 0.75), granite = mat('pr-granite', 0x8e8a86, 0.6), lead = mat('pr-dome', 0xb4b1a8, 0.65, 0.2);
  // The rotunda's center: the biggest round footprint (the map knows), else the origin.
  const rot = c.rings.filter((p) => areaOf(p.ring) > 1500).sort((a, b2) => areaOf(b2.ring) - areaOf(a.ring))[0];
  const O = rot ? centerOf(rot.ring) : { x: 0, z: 8 };
  add(b, new THREE.CylinderGeometry(28.6, 28.8, 31, 64, 1, true).translate(O.x, 14.5, O.z), brick);
  for (const y of [12.5, 22.5, 29.6]) add(b, new THREE.TorusGeometry(28.8, 0.45, 4, 64).rotateX(Math.PI / 2).translate(O.x, y, O.z), marble, true);
  add(b, lathe([[28.6, 30], [27.4, 30.5], [27.4, 32], [26, 32.2], [26, 33.6], [24.6, 33.8], [24.6, 35], [22.8, 35.2], [19, 38.4], [13, 41.4], [6.8, 43.1], [4.6, 43.3]], 64, O.x, O.z), lead);
  add(b, new THREE.CircleGeometry(4.5, 32).rotateX(-Math.PI / 2).translate(O.x, 43.25, O.z), mat('pr-oculus', 0x15161a, 1));
  b.solids.push({ ring: ngon(24, 28.6, 0, O.x, O.z), y0: -1, y1: 36 });
  // The intermediate block and the portico to the north (−z).
  const zb = O.z - 26;
  tier(b, rect(34, 10, O.x, zb - 4), -1, 30, 'pr', { mat: brick, cap: true });
  add(b, pediment(34, 6, 1.4, O.x, 30, zb - 8.4), marble);
  const zp = zb - 9;
  add(b, new THREE.BoxGeometry(34.4, 1.4, 16.4).translate(O.x, 0.7, zp - 7.6), marble);
  const cols = [...columnRow(O.x - 14.4, zp - 14.6, O.x + 14.4, zp - 14.6, 8, 0.75, 1.4, 13.3), ...columnRow(O.x - 10.3, zp - 9.8, O.x + 10.3, zp - 9.8, 2, 0.75, 1.4, 13.3), ...columnRow(O.x - 10.3, zp - 5, O.x + 10.3, zp - 5, 2, 0.75, 1.4, 13.3), ...columnRow(O.x - 14.4, zp - 9.8, O.x - 14.4, zp - 5, 2, 0.75, 1.4, 13.3), ...columnRow(O.x + 14.4, zp - 9.8, O.x + 14.4, zp - 5, 2, 0.75, 1.4, 13.3)];
  addMerged(b, cols, granite);
  add(b, new THREE.BoxGeometry(33.4, 2.6, 15.8).translate(O.x, 14.6, zp - 7.6), marble);
  add(b, pediment(33.6, 6.4, 1.6, O.x, 15.9, zp - 14.6), marble);
  const roof = new THREE.Shape([new THREE.Vector2(-16.6, 0), new THREE.Vector2(16.6, 0), new THREE.Vector2(0, 6.2)]);
  add(b, new THREE.ExtrudeGeometry(roof, { depth: 14, bevelEnabled: false }).translate(O.x, 15.9, zp - 14.4), lead);
  b.solids.push({ ring: rect(34, 10, O.x, zb - 4), y0: -1, y1: 30 }, { ring: rect(34, 16, O.x, zp - 7.6), y0: 13.3, y1: 22 });
  return b;
};

/** St Peter's Square: Bernini's colonnades, four columns deep, embracing the piazza round the Vatican
 * obelisk, crowned with the saints along the balustrade; Maderno's and Bernini's fountains. */
const piazzaSanPietro: Builder = () => {
  const b = built();
  const trav = mat('sp-trav', 0xe6dcc6, 0.85), statue = mat('sp-statue', 0xd8d0bd, 0.9), granite = mat('sp-obelisk', 0xa98a76, 0.8);
  const RX = 98, RZ = 114, rows = [-6.3, -2.1, 2.1, 6.3], N = 36;
  const cols: THREE.BufferGeometry[] = [], roof: THREE.BufferGeometry[] = [], saints: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = (20 + (140 * i) / (N - 1)) * (Math.PI / 180);
      const ex = Math.cos(t) * RX, ez = -side * Math.sin(t) * RZ;
      // Outward normal of the ellipse at this point.
      let nx = Math.cos(t) / RX, nz = -side * Math.sin(t) / RZ; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      for (const r of rows) cols.push(new THREE.CylinderGeometry(0.66, 0.78, 14, 10).translate(ex + nx * r, 7, ez + nz * r));
      if (i < N - 1) {
        const t2 = (20 + (140 * (i + 1)) / (N - 1)) * (Math.PI / 180);
        const x2 = Math.cos(t2) * RX, z2 = -side * Math.sin(t2) * RZ, len = Math.hypot(x2 - ex, z2 - ez) + 0.3;
        const ang = Math.atan2(z2 - ez, x2 - ex), mx = (ex + x2) / 2, mz = (ez + z2) / 2;
        roof.push(new THREE.BoxGeometry(len, 3.6, 17.6).rotateY(-ang).translate(mx, 15.8, mz));
        roof.push(new THREE.BoxGeometry(len, 0.9, 16.4).rotateY(-ang).translate(mx, 18, mz));
        for (const r of [-8.4, 8.4]) saints.push(new THREE.CylinderGeometry(0.4, 0.5, 2.6, 6).translate(mx + nx * r, 19.8, mz + nz * r), new THREE.SphereGeometry(0.34, 6, 5).translate(mx + nx * r, 21.4, mz + nz * r));
      }
      b.solids.push({ ring: rect(2, 2, ex + nx * 6.3, ez + nz * 6.3), y0: 0, y1: 18 }, { ring: rect(2, 2, ex - nx * 6.3, ez - nz * 6.3), y0: 0, y1: 18 });
    }
  }
  addMerged(b, cols, trav); addMerged(b, roof, trav); addMerged(b, saints, statue, true);
  // The paving: grey sampietrini cobbles with travertine bands radiating from the obelisk like a compass rose.
  const paving = paintedMat('sp-paving', [512, 512], (g, W, H) => {
    g.fillStyle = '#9d978d'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${rand(k) < 0.5 ? '70,66,60' : '190,184,172'},0.18)`; g.fillRect(rand(k + 1) * W, rand(k + 2) * H, 3, 3); }
    g.strokeStyle = '#d9d0bd'; g.lineWidth = 5;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * 20, H / 2 + Math.sin(a) * 20); g.lineTo(W / 2 + Math.cos(a) * W / 2, H / 2 + Math.sin(a) * H / 2); g.stroke(); }
    g.beginPath(); g.arc(W / 2, H / 2, 22, 0, Math.PI * 2); g.stroke();
  }, { rough: 0.95 });
  add(b, new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2).scale(RX - 9, 1, RZ - 9).translate(0, 0.06, 0), paving);
  // The obelisk (25.5 m of red granite) on its pedestal, the cross on top.
  add(b, new THREE.BoxGeometry(6, 1.2, 6).translate(0, 0.6, 0), trav);
  add(b, new THREE.BoxGeometry(4, 7, 4).translate(0, 4.2, 0), trav);
  add(b, loft([{ ring: rect(2.7, 2.7), y: 7.7 }, { ring: rect(1.8, 1.8), y: 31.5 }, { ring: rect(0.2, 0.2), y: 33.2 }], [2, 2], true), granite);
  addMerged(b, crossOnBall(0, 33.2, 0, 0.7), mat('sp-bronze', 0x5a4a32, 0.5, 0.6));
  b.solids.push({ ring: rect(4, 4), y0: 0, y1: 31 });
  // The two fountains on the long axis.
  for (const z of [-58, 58]) {
    add(b, new THREE.CylinderGeometry(6.5, 6.8, 0.8, 24).translate(0, 0.4, z), trav);
    add(b, new THREE.CylinderGeometry(6.1, 6.1, 0.1, 24).translate(0, 0.75, z), mat('lm-water2', 0x6f93a6, 0.1, 0.3));
    add(b, lathe([[0.7, 0.8], [0.6, 3.2], [2.8, 4.2], [2.6, 4.6], [0.5, 4.8], [0.4, 6.2], [1.6, 6.8], [0.2, 7.6]], 16, 0, z), trav);
    b.solids.push({ ring: ngon(10, 6.5, 0, 0, z), y0: 0, y1: 1 });
  }
  return b;
};

// ------------------------------------------------------------------ Barcelona

/** A Gaudí spire: the parabolic stone shaft, its pierced louvres, and the mosaic pinnacle on top. */
function gaudiSpire(b: Built, x: number, z: number, y0: number, h: number, r: number, stone: THREE.Material, crown: THREE.Material) {
  const prof: [number, number][] = [];
  const top = y0 + h * 0.84;
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([r * Math.pow(1 - t, 0.62) + 0.4, y0 + (top - y0) * t]); }
  add(b, lathe(prof, 14, x, z), stone);
  add(b, lathe([[0.9, top - 0.5], [1.9, top + 2], [2.1, top + 5], [1.5, top + 8.5], [1.8, top + 10.5], [0.6, y0 + h - 1.2], [0.1, y0 + h]], 10, x, z), crown);
  add(b, new THREE.SphereGeometry(0.9, 10, 8).translate(x, top + 11.3, z), mat('sf-white', 0xf3f0e8, 0.5), true);
}

/** The Sagrada Família, finished at 172.5 m in 2026: nave and transepts with their pinnacles, the
 * Nativity (+x) and Passion (−x) façades with four apostle towers each, the four Evangelists round
 * the Tower of Jesus Christ and its white cross, and the Virgin Mary's tower with the star over the apse. */
const sagrada: Builder = () => {
  const b = built();
  const old = mat('sf-old', 0xa59479, 0.9), stone = mat('sf-stone', 0xcbbfa6, 0.85), white = mat('sf-white', 0xf3f0e8, 0.5);
  const mosaic = paintedMat('sf-mosaic', [64, 128], (g, W, H) => {
    g.fillStyle = '#e9e1cf'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 90; k++) { g.fillStyle = ['#b8322a', '#e2b33a', '#f4f1e8', '#c94a2a', '#d9c26a'][k % 5]; g.fillRect(rand(k) * W, rand(k + 50) * H, 5 + rand(k + 7) * 6, 5 + rand(k + 9) * 6); }
  }, { rough: 0.4, metal: 0.1 });
  const wall = paintedMat('sf-wall', [128, 256], (g, W, H) => {
    g.fillStyle = '#cbbfa6'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(100,85,60,0.18)'; for (let y = 0; y < H; y += 7) g.fillRect(0, y, W, 1);
    g.fillStyle = '#5a5f6a';
    for (const x of [0.22, 0.6]) { g.beginPath(); g.ellipse(W * (x + 0.09), H * 0.38, W * 0.08, H * 0.22, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#b9ad93'; g.fillRect(0, 0, W * 0.06, H); g.fillRect(W * 0.94, 0, W * 0.06, H);
  }, { rough: 0.85 });
  const wallTier = (ring: number[], y0: number, y1: number) => { add(b, loft([{ ring, y: y0 }, { ring, y: y1 }], [8, 18], true), wall); b.solids.push({ ring, y0, y1 }); };
  // Body: the nave (to the Glory front at +z), the transept, the apse (−z), all 45 m.
  wallTier(rect(45, 62, 0, 18), -1, 45);
  wallTier(rect(62, 30, 0, 0), -1, 45);
  const apse: number[] = []; for (let k = 0; k <= 14; k++) { const a = Math.PI + (k / 14) * Math.PI; apse.push(Math.cos(a) * 22, -15 + Math.sin(a) * 22); }
  wallTier(apse, -1, 40);
  // Pinnacles along the nave and the transept, fruit-topped.
  const pin: THREE.BufferGeometry[] = [], fruit: THREE.BufferGeometry[] = [];
  for (let z = -8; z <= 46; z += 8) for (const sx of [-1, 1]) { pin.push(new THREE.ConeGeometry(1.4, 12, 8).translate(sx * 22.5, 51, z)); fruit.push(new THREE.SphereGeometry(1.1, 8, 6).translate(sx * 22.5, 57.6, z)); }
  for (let k = 0; k < 10; k++) { const a = Math.PI + ((k + 0.5) / 10) * Math.PI; pin.push(new THREE.ConeGeometry(1.4, 12, 8).translate(Math.cos(a) * 22, 46, -15 + Math.sin(a) * 22)); }
  addMerged(b, pin, stone); addMerged(b, fruit, mosaic, true);
  // The nave's steep roof.
  add(b, loft([{ ring: rect(40, 60, 0, 18), y: 45 }, { ring: rect(6, 60, 0, 18), y: 60 }], [4, 4], true), stone);
  // The two transept façades: a gabled portal wall between four apostle towers each.
  for (const [sx, hs, st] of [[1, [98, 107, 107, 98], old], [-1, [107, 112, 112, 107], stone]] as [number, number[], THREE.Material][]) {
    const x = sx * 36;
    wallTier(rect(10, 44, x, 0), -1, 52);
    const gab = new THREE.Shape([new THREE.Vector2(-18, 0), new THREE.Vector2(18, 0), new THREE.Vector2(0, 22)]);
    add(b, new THREE.ExtrudeGeometry(gab, { depth: 2, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x + sx * 4, 52, 0), st);
    add(b, new THREE.BoxGeometry(0.4, 22, 26).translate(x + sx * 5.1, 11, 0), mat('sf-portal', 0x4d4740, 0.9), true);
    [-21, -7, 7, 21].forEach((z, i) => gaudiSpire(b, x + sx * 2, z, 0, hs[i], 4.3, st, mosaic));
    for (const z of [-21, -7, 7, 21]) b.solids.push({ ring: ngon(8, 4.2, 0, x + sx * 2, z), y0: 0, y1: 80 });
  }
  // The Evangelists (135 m) round the Tower of Jesus Christ (172.5 m), the Virgin Mary (138 m) over the apse.
  const cent = (x: number, z: number, top: number, r: number) => {
    const prof: [number, number][] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([r * Math.pow(1 - t, 0.5) + 1, 40 + (top - 40) * t]); }
    add(b, lathe(prof, 16, x, z), stone);
    // The white glazed-ceramic crown.
    add(b, lathe([[r * 0.55 + 1, 40 + (top - 40) * 0.7], [r * 0.4 + 0.8, 40 + (top - 40) * 0.85], [0.6, top]], 16, x, z), white);
    b.solids.push({ ring: ngon(8, r, 0, x, z), y0: 40, y1: top * 0.8 });
  };
  for (const [ex, ez] of [[-11, -11], [11, -11], [11, 11], [-11, 11]]) { cent(ex, ez, 125, 4.8); add(b, new THREE.IcosahedronGeometry(2.6, 0).translate(ex, 128, ez), mosaic); }
  cent(0, -24, 128, 6.5);
  add(b, new THREE.IcosahedronGeometry(4.6, 0).translate(0, 133, -24), glowMat('sf-star', 0xf6f2ff, 0.4, 3));
  cent(0, 0, 155, 8.5);
  // The cross: 17 m by 13.5 m, white glass and ceramic, lit at night.
  const cross = glowMat('sf-cross', 0xf4f6ff, 0.35, 3.2);
  add(b, new THREE.BoxGeometry(3.2, 17, 3.2).translate(0, 164, 0), cross);
  add(b, new THREE.BoxGeometry(13.5, 3.2, 3.2).translate(0, 166.4, 0), cross);
  add(b, new THREE.BoxGeometry(3.2, 3.2, 13.5).translate(0, 166.4, 0), cross);
  return b;
};

// ------------------------------------------------------------------ Berlin

/** The Brandenburg Gate: twelve Doric columns of Elbe sandstone in two rows with the walls between
 * the five passages, the entablature and attic, and the Quadriga facing east to Pariser Platz. */
const brandenburg: Builder = () => {
  const b = built();
  const sand = mat('bg-sand', 0xd6cbb0, 0.85), shade = mat('bg-shade', 0xc4b89c, 0.9), copper = mat('bg-copper', 0x5d8a74, 0.55, 0.45);
  const Z = [-14.8, -9.25, -3.7, 3.7, 9.25, 14.8];
  const cols: THREE.BufferGeometry[] = [], walls: THREE.BufferGeometry[] = [];
  for (const z of Z) {
    for (const x of [-4.6, 4.6]) cols.push(new THREE.CylinderGeometry(0.78, 0.9, 13.6, 16).translate(x, 7.6, z));
    walls.push(new THREE.BoxGeometry(7.4, 14.4, 1.7).translate(0, 7.2, z));
    for (const x of [-4.6, 4.6]) b.solids.push({ ring: rect(1.8, 1.8, x, z), y0: 0, y1: 15 });
    b.solids.push({ ring: rect(7.4, 1.7, 0, z), y0: 0, y1: 15 });
  }
  addMerged(b, cols, sand); addMerged(b, walls, shade);
  for (const x of [-4.6, 4.6]) add(b, new THREE.BoxGeometry(2.2, 0.8, 34).translate(x, 0.4, 0), sand);
  // Entablature with its triglyph frieze, the attic stepping up to the Quadriga's pedestal.
  const frieze = paintedMat('bg-frieze', [256, 32], (g, W, H) => {
    g.fillStyle = '#d6cbb0'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#b9ad91'; for (let x = 0; x < W; x += 32) g.fillRect(x + 4, 4, 10, H - 8);
  }, { repeat: [6, 1] });
  add(b, new THREE.BoxGeometry(11.4, 1.4, 34.6).translate(0, 15.1, 0), sand);
  add(b, new THREE.BoxGeometry(11.2, 1.8, 34.4).translate(0, 16.7, 0), frieze);
  add(b, new THREE.BoxGeometry(12, 0.8, 35.2).translate(0, 18, 0), sand);
  add(b, new THREE.BoxGeometry(10.6, 2.4, 33.6).translate(0, 19.6, 0), shade);
  add(b, new THREE.BoxGeometry(8, 1.8, 12).translate(0, 21.7, 0), sand);
  b.solids.push({ ring: rect(12, 35.2), y0: 14.4, y1: 22.6 });
  // The Quadriga: four horses abreast, the chariot, Victoria with her staff and wreath.
  const q: THREE.BufferGeometry[] = [];
  for (const z of [-2.4, -0.8, 0.8, 2.4]) {
    q.push(new THREE.CapsuleGeometry(0.55, 1.5, 4, 8).rotateZ(Math.PI / 2).translate(1.2, 24.3, z));
    q.push(new THREE.CapsuleGeometry(0.22, 0.9, 3, 6).rotateZ(-0.6).translate(2.3, 25.1, z));
    q.push(new THREE.BoxGeometry(0.3, 0.7, 0.3).translate(2.75, 25.6, z));
    for (const [lx, lz] of [[0.5, -0.2], [0.5, 0.2], [1.9, -0.2], [1.9, 0.2]]) q.push(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 4).translate(lx, 22.9, z + lz));
  }
  q.push(new THREE.BoxGeometry(1.6, 1.2, 2.6).translate(-1.2, 23.4, 0));
  q.push(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 8).translate(-1.4, 25.3, 0), new THREE.SphereGeometry(0.3, 8, 6).translate(-1.4, 26.8, 0));
  q.push(new THREE.BoxGeometry(0.3, 1.6, 1.8).translate(-1.7, 26, 0));
  q.push(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 4).translate(-0.9, 27, 0.5), new THREE.TorusGeometry(0.4, 0.07, 4, 12).translate(-0.9, 28.8, 0.5));
  addMerged(b, q, copper);
  return b;
};

/** The Fernsehturm: the tapering concrete shaft, the steel-clad sphere with its windows at 203–207 m,
 * the red and white antenna to 368 m. */
const fernsehturm: Builder = () => {
  const b = built();
  const conc = mat('ft-conc', 0xd0cec8, 0.85);
  add(b, lathe([[16, 0], [12.5, 10], [9.6, 40], [7.6, 100], [6.2, 160], [5.6, 200], [5, 230], [4.2, 250]], 32), conc);
  const sphere = paintedMat('ft-sphere', [512, 256], (g, W, H) => {
    g.fillStyle = '#c9ced3'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,128,136,0.6)'; g.lineWidth = 1;
    for (let k = 0; k < 64; k++) { const x = (k / 64) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + W / 64, H); g.moveTo(x + W / 64, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += H / 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // The windows round the observation deck and the restaurant.
    g.fillStyle = '#2b3442'; g.fillRect(0, H * 0.44, W, H * 0.16);
    g.fillStyle = '#9aa3ad'; for (let k = 0; k < 96; k++) g.fillRect((k / 96) * W, H * 0.44, 2, H * 0.16);
  }, { metal: 0.75, rough: 0.28 });
  add(b, new THREE.SphereGeometry(16, 48, 32).translate(0, 207, 0), sphere);
  const ant = paintedMat('ft-ant', [8, 128], (g, W, H) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f2f2f0' : '#d23a2c'; g.fillRect(0, (k / 8) * H, W, H / 8); }
  }, { rough: 0.5 });
  add(b, new THREE.CylinderGeometry(1.4, 2.6, 30, 12).translate(0, 263, 0), conc);
  add(b, new THREE.CylinderGeometry(0.5, 1.5, 90, 10).translate(0, 323, 0), ant);
  add(b, new THREE.SphereGeometry(0.6, 8, 6).translate(0, 368, 0), glowMat('ft-beacon', 0xff3020, 0.6, 3), true);
  b.solids.push({ ring: ngon(12, 9), y0: 0, y1: 191 }, { ring: ngon(16, 15), y0: 193, y1: 221 });
  return b;
};

// ------------------------------------------------------------------ Istanbul

/** Footprints that are minarets: small and tall. */
const minaretsOf = (c: BuildCtx) => c.rings.filter((p) => areaOf(p.ring) < 40 && p.y1 > 40).map((p) => ({ ...centerOf(p.ring), h: p.y1 }));

/** Hagia Sophia: the 31 m dome on its ring of forty windows (55.6 m), the semi-domes east and west,
 * the great buttresses, the Ottoman-pink plaster, and the four minarets where the map has them. */
const hagiaSophia: Builder = (c) => {
  const b = built();
  const pink = mat('hs-pink', 0xd7a486, 0.85), pinkDark = mat('hs-pink2', 0xc8957a, 0.9), lead = mat('hs-lead', 0x8d969c, 0.5, 0.35), white = mat('hs-white', 0xe8e2d6, 0.85), gilt = GILT();
  const mins = minaretsOf(c);
  const parts = c.rings.filter((p) => areaOf(p.ring) >= 40 && p.y1 <= 36);
  if (parts.length) body(b, parts, 'hs', 26, pink);
  else tier(b, rect(76, 70), -1, 24, 'hs', { mat: pink });
  // The core: the dome square and the buttress towers north and south.
  tier(b, rect(34, 34), 18, 40, 'hs', { mat: pink });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tier(b, rect(9, 11, sx * 12, sz * 24), -1, 40, 'hs', { mat: pinkDark });
    add(b, loft([{ ring: rect(9, 11, sx * 12, sz * 24), y: 40 }, { ring: rect(9, 3, sx * 12, sz * 20), y: 44 }], [4, 4], true), lead);
  }
  // The window ring and the dome.
  const ring = paintedMat('hs-drum', [512, 32], (g, W, H) => {
    g.fillStyle = '#d7a486'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a2c33'; for (let k = 0; k < 40; k++) { const x = (k / 40) * W + 3; g.fillRect(x, 6, W / 40 - 6, H - 6); g.beginPath(); g.arc(x + (W / 40 - 6) / 2, 6, (W / 40 - 6) / 2, Math.PI, 0); g.fill(); }
  }, { rough: 0.85 });
  add(b, new THREE.CylinderGeometry(16.6, 16.8, 4, 40, 1, true).translate(0, 42, 0), ring);
  const ribs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; ribs.push(new THREE.BoxGeometry(1.2, 4, 1).rotateY(-a).translate(Math.cos(a) * 17, 42, Math.sin(a) * 17)); }
  addMerged(b, ribs, pinkDark, true);
  add(b, lathe(domeProfile(16.8, 44, 11.6, 12), 48), lead);
  add(b, new THREE.CylinderGeometry(0.15, 0.3, 4, 6).translate(0, 57.5, 0), gilt, true);
  // Semi-domes east (+x, the apse) and west, and the smaller exedrae.
  add(b, semiDome(16.2, 34, 17, 0, 0, 13), lead);
  add(b, semiDome(16.2, 34, -17, 0, Math.PI, 13), lead);
  for (const sx of [-1, 1]) {
    tier(b, rect(16, 34, sx * 25, 0), 18, 34, 'hs', { mat: pink });
    for (const sz of [-1, 1]) add(b, semiDome(7, 26, sx * 30, sz * 10, Math.atan2(sz, sx), 6), lead);
  }
  b.solids.push({ ring: rect(34, 34), y0: 0, y1: 52 });
  // Minarets: on the map's footprints; else at the four corners.
  const spots = mins.length ? mins : [[-40, -38, 60], [-40, 38, 60], [40, 38, 55], [40, -38, 58]].map(([x, z, h]) => ({ x, z, h }));
  spots.forEach((m, i) => minaret(b, m.x, m.z, Math.max(50, Math.min(64, m.h)), i % 2 ? 1.9 : 1.6, i % 2 ? 2 : 1, i === 2 ? mat('hs-brick', 0xa9583e, 0.9) : white, lead, gilt));
  return b;
};

/** The Sultan Ahmed Mosque: the cascade of domes (the central one 23.5 m across, 43 m high) over the
 * prayer hall, four semi-domes, the four corner turrets, the arcaded courtyard and the six minarets. */
const blueMosque: Builder = (c) => {
  const b = built();
  const stone = mat('bm-stone', 0xd9d5cc, 0.85), lead = mat('bm-lead', 0x8796a5, 0.5, 0.4), gilt = GILT();
  const mins = minaretsOf(c);
  const hall = c.rings.filter((p) => p.y1 >= 20 && areaOf(p.ring) > 1500).sort((a, b2) => areaOf(b2.ring) - areaOf(a.ring))[0];
  const H = hall ? centerOf(hall.ring) : { x: 0, z: 0 };
  // The hall's turn: from its longest wall.
  let a = 0;
  if (hall) {
    let best = 0;
    const r = hall.ring;
    for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length, dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], l = Math.hypot(dx, dz); if (l > best) { best = l; a = Math.atan2(dz, dx); } }
  }
  const P = (x: number, z: number) => at(H.x, H.z, a, x, z);
  const sq = (w: number, d: number, x: number, z: number) => { const out: number[] = []; for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) { const q = P(x + px, z + pz); out.push(q.x, q.z); } return out; };
  const hallMat = paintedMat('bm-hall', [128, 192], (g, W, Hh) => {
    g.fillStyle = '#d9d5cc'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(110,105,95,0.18)'; for (let y = 0; y < Hh; y += 8) g.fillRect(0, y, W, 1);
    g.fillStyle = '#3a3e46';
    for (const [y, h] of [[0.18, 0.2], [0.55, 0.22]]) for (const x of [0.2, 0.62]) { g.fillRect(W * x, Hh * y + W * 0.09, W * 0.18, Hh * h); g.beginPath(); g.arc(W * (x + 0.09), Hh * y + W * 0.09, W * 0.09, Math.PI, 0); g.fill(); }
  }, { repeat: [1, 1] });
  const hallRing = sq(53, 53, 0, 0);
  add(b, loft([{ ring: hallRing, y: -1 }, { ring: hallRing, y: 24 }], [6, 12], true), hallMat);
  b.solids.push({ ring: hallRing, y0: -1, y1: 24 });
  // Central dome on its drum of windows.
  const d0 = P(0, 0);
  domeOnDrum(b, d0.x, d0.z, 12, 30, 33.5, 9.5, mat('bm-drum', 0xcfcac0, 0.85), lead, 36);
  add(b, new THREE.CylinderGeometry(13, 13, 6, 36).translate(d0.x, 27, d0.z), stone);
  add(b, new THREE.CylinderGeometry(0.15, 0.3, 4, 6).translate(d0.x, 45, d0.z), gilt, true);
  // Four semi-domes, the exedrae and the corner domes stepping down.
  for (let k = 0; k < 4; k++) {
    const ang = a + (k * Math.PI) / 2, s = P(Math.cos((k * Math.PI) / 2) * 13, Math.sin((k * Math.PI) / 2) * 13);
    add(b, semiDome(11.8, 27, s.x, s.z, ang, 9), lead);
    for (const sd of [-1, 1]) { const e = P(Math.cos((k * Math.PI) / 2) * 17 - Math.sin((k * Math.PI) / 2) * sd * 9, Math.sin((k * Math.PI) / 2) * 17 + Math.cos((k * Math.PI) / 2) * sd * 9); add(b, semiDome(4.6, 24, e.x, e.z, ang, 4), lead); }
  }
  for (const [x, z] of [[-18, -18], [18, -18], [18, 18], [-18, 18]]) {
    const q = P(x, z);
    add(b, new THREE.CylinderGeometry(6.2, 6.2, 2, 16).translate(q.x, 25, q.z), stone);
    add(b, lathe(domeProfile(6.2, 26, 4.6, 8), 16, q.x, q.z), lead);
    const t = P(x * 0.7, z * 0.7);
    add(b, new THREE.CylinderGeometry(2.2, 2.4, 13, 8).translate(t.x, 30.5, t.z), stone);
    add(b, new THREE.ConeGeometry(2.4, 4.5, 8).translate(t.x, 39.2, t.z), lead);
  }
  // The courtyard on the side away from Mecca (qibla ~151°: the model's south-east), arcaded and domed.
  const qx = Math.sin((151 * Math.PI) / 180), qz = -Math.cos((151 * Math.PI) / 180);
  const axes = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, z]) => { const p = at(0, 0, a, x, z); return { x, z, d: -(p.x * qx + p.z * qz) }; }).sort((u, v) => v.d - u.d)[0];
  const cc = { x: axes.x * 53, z: axes.z * 53 };
  const arcade: THREE.BufferGeometry[] = [], cups: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 6; i++) {
      const t = -21 + i * 8.4, ax = k % 2 ? (k === 1 ? 23 : -23) : t, az = k % 2 ? t : (k === 0 ? -23 : 23);
      const q = P(cc.x + ax, cc.z + az);
      arcade.push(new THREE.BoxGeometry(8, 8, 8).rotateY(-a).translate(q.x, 4, q.z));
      cups.push(lathe(domeProfile(3.6, 8, 3, 6), 12, q.x, q.z));
    }
  }
  addMerged(b, arcade, hallMat); addMerged(b, cups, lead);
  const f = P(cc.x, cc.z);
  add(b, new THREE.CylinderGeometry(3, 3.4, 4, 8).translate(f.x, 2, f.z), stone);
  add(b, lathe(domeProfile(3.2, 4, 2.6, 6), 8, f.x, f.z), lead);
  // Six minarets: where the map has them, else at the hall's and courtyard's outer corners.
  const spots = mins.length >= 4 ? mins : [[-27, -27, 64], [27, -27, 64], [27, 27, 64], [-27, 27, 64], [cc.x + axes.x * 27 - axes.z * 27, cc.z + axes.z * 27 + axes.x * 27, 54], [cc.x + axes.x * 27 + axes.z * 27, cc.z + axes.z * 27 - axes.x * 27, 54]].map(([x, z, h]) => { const q = P(x, z); return { x: q.x, z: q.z, h }; });
  for (const m of spots) minaret(b, m.x, m.z, Math.max(48, Math.min(64, m.h)), 1.5, m.h > 59 ? 3 : 2, stone, lead, gilt, 16);
  return b;
};

// ------------------------------------------------------------------ Dubai

/** The Burj Al Arab: the sail of white fabric between two wings meeting at the back, lofted from the
 * map's own footprint toward the mast; the helipad at 210 m; the spire to 321 m. */
const burjAlArab: Builder = (c) => {
  const b = built();
  const fabric = paintedMat('ba-sail', [128, 256], (g, W, H) => {
    g.fillStyle = '#f4f5f4'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(160,170,180,0.35)'; for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 2);
    g.fillStyle = 'rgba(80,110,140,0.45)'; for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 3, H);
  }, { rough: 0.45, side: THREE.DoubleSide });
  let ring = c.rings.length ? c.rings.sort((a, b2) => areaOf(b2.ring) - areaOf(a.ring))[0].ring : null;
  if (!ring) { ring = []; ring.push(0, -50); for (let k = 0; k <= 10; k++) { const t = k / 10, ang = Math.PI * 0.15 + t * Math.PI * 0.7; ring.push(Math.cos(ang) * -42, 22 + Math.sin(ang) * 18); } }
  // The apex (the mast's corner): the vertex with the sharpest angle.
  const n = ring.length / 2;
  let apex = 0, sharp = Infinity;
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const ax = ring[p * 2] - ring[i * 2], az = ring[p * 2 + 1] - ring[i * 2 + 1], bx = ring[q * 2] - ring[i * 2], bz = ring[q * 2 + 1] - ring[i * 2 + 1];
    const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang < sharp) { sharp = ang; apex = i; }
  }
  const Ax = ring[apex * 2], Az = ring[apex * 2 + 1];
  const levels: { ring: number[]; y: number }[] = [];
  for (let k = 0; k <= 14; k++) {
    const y = (k / 14) * 200, s = Math.max(0.05, 1 - Math.pow(y / 205, 1.35));
    levels.push({ ring: ring.map((v, i) => (i % 2 ? Az + (v - Az) * s : Ax + (v - Ax) * s)), y });
  }
  add(b, loft(levels, [6, 6], true), fabric);
  for (let k = 0; k + 1 < levels.length; k += 2) b.solids.push({ ring: levels[k].ring, y0: levels[k].y, y1: levels[k + 1].y });
  // The mast and its spire.
  add(b, new THREE.CylinderGeometry(0.5, 2.8, 140, 10).translate(Ax, 251, Az), mat('ba-mast', 0xeeeeec, 0.4, 0.4));
  // The helipad, cantilevered off the side at 210 m.
  const cx = levels[0].ring.reduce((s, v, i) => (i % 2 ? s : s + v), 0) / n, cz = levels[0].ring.reduce((s, v, i) => (i % 2 ? s + v : s), 0) / n;
  const ux = -(cz - Az), uz = cx - Ax, ul = Math.hypot(ux, uz) || 1;
  const hx = Ax + (ux / ul) * 16, hz = Az + (uz / ul) * 16;
  add(b, new THREE.CylinderGeometry(12, 11, 1.2, 32).translate(hx, 210, hz), mat('ba-pad', 0x6f7b6a, 0.8));
  add(b, strut(new THREE.Vector3(Ax, 196, Az), new THREE.Vector3(hx, 209.5, hz), 0.9, 6), mat('ba-mast', 0xeeeeec, 0.4, 0.4));
  return b;
};

// ------------------------------------------------------------------ Giza

function courses(key: string, base: string, line: string, casing = false) {
  return paintedMat(`gz-${key}`, [128, 128], (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    if (casing) { for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(150,120,80,${0.05 + rand(k) * 0.08})`; g.fillRect(rand(k + 3) * W, rand(k + 5) * H, 8, 8); } return; }
    // Eight courses per tile, each a row of weathered blocks.
    for (let r = 0; r < 8; r++) {
      const y = (r / 8) * H;
      g.fillStyle = line; g.fillRect(0, y, W, 3);
      for (let x = rand(r) * 30; x < W; x += 18 + rand(r * 7 + x) * 22) { g.fillStyle = `rgba(110,85,55,${0.15 + rand(x + r) * 0.2})`; g.fillRect(x, y, 2, H / 8); }
      g.fillStyle = `rgba(255,240,210,${rand(r + 9) * 0.12})`; g.fillRect(0, y + 3, W, H / 16);
    }
  }, { rough: 0.95 });
}

/** A pyramid on the cardinal points, its base sunk below ground so it meets uneven terrain. */
function pyramidModel(base: number, h: number, flatTop: number, capFrom: number, stones: THREE.Material, casing: THREE.Material | null) {
  const b = built();
  const sink = 10, r = (w: number) => rect(w, w);
  const w = (y: number) => Math.max(flatTop, base * (1 - y / h));
  const yCap = casing ? h * capFrom : h;
  add(b, loft([{ ring: r(w(-sink)), y: -sink }, { ring: r(w(yCap)), y: yCap }], [8, 8], !casing), stones);
  if (casing) add(b, loft([{ ring: r(w(yCap)), y: yCap }, { ring: r(Math.max(0.3, w(h - 0.5))), y: h }], [8, 8], true), casing);
  for (let k = 0; k < 6; k++) { const y0 = (k / 6) * h, y1 = ((k + 1) / 6) * h; b.solids.push({ ring: r(w(y0) * 0.98), y0: y0 - sink, y1 }); }
  return b;
}

const pyramidKhufu: Builder = () => pyramidModel(230.3, 138.5, 10, 1, courses('khufu', '#cfb48a', '#a98d64'), null);
const pyramidKhafre: Builder = () => pyramidModel(215.3, 136.4, 0.5, 0.82, courses('khafre', '#cbb089', '#a68a62'), courses('khafre-c', '#e3d3b0', '', true));
const pyramidMenkaure: Builder = () => pyramidModel(103.4, 61, 1.5, 1, courses('menkaure', '#c9a97e', '#a3845c'), null);

/** The Great Sphinx: a lion lying with its paws forward, facing the sunrise (+x), the king's head
 * in the nemes headdress. 73 m long, 20 m tall. */
const sphinx: Builder = () => {
  const b = built();
  const rock = mat('sx-rock', 0xc4a372, 0.95), head = mat('sx-head', 0xd0b388, 0.9), dark = mat('sx-dark', 0x9c7f58, 0.95);
  // The lion: a long low back (about 13 m at the shoulder), the haunch, the breast, the forelegs and paws.
  const parts = [
    new THREE.CapsuleGeometry(6.4, 30, 6, 14).rotateZ(Math.PI / 2).scale(1, 1, 1.1).translate(-11, 6.6, 0),
    new THREE.SphereGeometry(7.6, 16, 12).scale(1.25, 0.95, 1.05).translate(-27, 6.4, 0),
    new THREE.BoxGeometry(9, 13, 12).translate(9.5, 6.5, 0),
  ];
  for (const sz of [-1, 1]) parts.push(
    new THREE.BoxGeometry(24, 3.2, 4.2).translate(27, 1.6, sz * 4.2),
    new THREE.SphereGeometry(2.4, 10, 8).scale(1.1, 0.7, 1).translate(39, 1.7, sz * 4.2),
    new THREE.SphereGeometry(4.6, 10, 8).scale(1.7, 0.9, 0.7).translate(-24, 3.2, sz * 8.2),
  );
  addMerged(b, parts, rock);
  // The head in the nemes headdress: the face, the head cloth's crown and lappets, the neck behind.
  add(b, new THREE.BoxGeometry(4.2, 5.4, 4.2).translate(16.4, 16.2, 0), head);
  add(b, new THREE.BoxGeometry(1.2, 1.5, 1.4).translate(18.9, 15.6, 0), head, true);
  add(b, new THREE.BoxGeometry(5.6, 2, 6.4).translate(15.8, 19.6, 0), head);
  for (const sz of [-1, 1]) add(b, new THREE.BoxGeometry(2.4, 8.2, 1.1).rotateX(sz * -0.18).translate(16.6, 13.6, sz * 3.4), head);
  add(b, new THREE.BoxGeometry(5, 7, 6.6).translate(13.2, 15, 0), dark);
  b.solids.push({ ring: rect(58, 16, -7, 0), y0: 0, y1: 13 }, { ring: rect(24, 13, 27, 0), y0: 0, y1: 3.5 }, { ring: rect(10, 8, 15, 0), y0: 10, y1: 20.5 });
  return b;
};

export const MORE_BUILDERS: Record<string, Builder> = { piazzaSanPietro, stPeters, pantheonRome, sagrada, brandenburg, fernsehturm, hagiaSophia, blueMosque, burjAlArab, pyramidKhufu, pyramidKhafre, pyramidMenkaure, sphinx };
void band;
