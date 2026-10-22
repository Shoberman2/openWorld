// Paris: Sacré-Cœur on Montmartre, the Dôme des Invalides and the Panthéon. Each stands on the map's
// own footprints (the body is extruded from them in its stone) with the dome built where the map
// puts it. Model frame: y up, x east, z south (−z is the landmark's bearing).
import * as THREE from 'three';
import { band, built, facadeMat, glowMat, prism, rect, STYLES, tier, type Built } from './kit.ts';
import type { BuildCtx } from './models.ts';
import { add, addMerged, colonnade, columnRow, crossOnBall, domeProfile, euStyles, GILT, lathe, LEAD, mat, paintedMat, pediment } from './eu-kit.ts';
import { areaOf, bboxOf, centerOf, type Part } from './eu-parts.ts';
import { ribbedMat } from './eu-london.ts';

type Builder = (c: BuildCtx) => Built;

/** The map's footprints as the building's body, in a landmark style, capped at `cap` m. */
function body(b: Built, parts: Part[], style: string, cap: number, cornice?: THREE.Material) {
  for (const p of parts) {
    const top = Math.min(cap, p.y1);
    if (top < 2) continue;
    const m = new THREE.Mesh(prism(p.ring, Math.max(-1.5, p.y0), top, STYLES[style].tile, true, p.holes), facadeMat(style));
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: p.ring, y0: p.y0, y1: top });
    if (cornice && p.ring.length <= 200 && areaOf(p.ring) > 150) band(b, p.ring, top - 1, 1.2, 0.5, cornice, true);
  }
}

// ------------------------------------------------------------------ Sacré-Cœur

/** The Basilica of the Sacred Heart: white Château-Landon travertine, the great ovoid dome (83 m)
 * with four small domes round it, the campanile behind (91 m), the three-arched porch facing Paris. */
const sacreCoeur: Builder = (c) => {
  euStyles();
  const b = built();
  const stone = mat('sc-trav', 0xf1eee6, 0.8), dome = mat('sc-dome', 0xeeebe2, 0.75), bronze = mat('sc-bronze', 0x3f5a4c, 0.6, 0.5);
  const R = c.rings;
  const big = (p: Part) => areaOf(p.ring);
  const domeP = R.find((p) => p.y1 > 60 && p.y1 < 80 && big(p) > 180 && big(p) < 700);
  const campP = R.find((p) => p.y1 >= 60 && big(p) > 60 && big(p) < 260 && p !== domeP);
  const smalls = R.filter((p) => p.y1 > 38 && p.y1 < 55 && big(p) > 50 && big(p) < 140).map((p) => centerOf(p.ring));
  const D = domeP ? centerOf(domeP.ring) : { x: 0, z: 0 };
  const C = campP ? centerOf(campP.ring) : { x: D.x, z: D.z - 45 };
  const S = smalls.length >= 3 ? smalls.slice(0, 4) : [[-13, -13], [13, -13], [13, 13], [-13, 13]].map(([x, z]) => ({ x: D.x + x, z: D.z + z }));
  // The body: the map's outline (the nave, transepts and apse), up to the cornice.
  const parts = R.filter((p) => p !== domeP && p !== campP && !(p.y1 > 38 && big(p) < 140));
  if (parts.length) body(b, parts, 'travArch', 30, stone);
  else {
    tier(b, rect(34, 80, D.x, D.z - 6), -1, 28, 'travArch');
    tier(b, rect(52, 30, D.x, D.z), -1, 28, 'travArch');
  }
  // The great dome: a square base, the drum ringed with columns, the ovoid dome, the lantern.
  tier(b, rect(26, 26, D.x, D.z), 20, 32, 'travArch', { mat: stone });
  add(b, new THREE.CylinderGeometry(10.6, 10.6, 16, 32, 1, true).translate(D.x, 40, D.z), facadeMat('travArch'));
  addMerged(b, colonnade(11.3, 16, 0.45, 32, 46.5, D.x, D.z), stone, true);
  add(b, new THREE.CylinderGeometry(11.8, 11.8, 1.6, 32).translate(D.x, 48.4, D.z), stone);
  add(b, lathe([[11, 49], [11, 51], [10.6, 54], [9.6, 58], [7.8, 62], [5.2, 65.5], [3.2, 67]], 32, D.x, D.z), ribbedMat('sc-dome', '#efece3', '#e2ded2', 24, { metal: 0, rough: 0.75 }));
  addMerged(b, colonnade(2.9, 12, 0.22, 67, 73, D.x, D.z), stone, true);
  add(b, new THREE.CylinderGeometry(2.4, 2.6, 6, 16).translate(D.x, 70, D.z), stone);
  add(b, lathe(domeProfile(3.2, 73, 4.5, 8), 16, D.x, D.z), dome);
  addMerged(b, crossOnBall(D.x, 77.5, D.z, 1.1), bronze);
  b.solids.push({ ring: rect(24, 24, D.x, D.z), y0: 0, y1: 62 });
  // The four small domes.
  for (const s of S) {
    add(b, new THREE.CylinderGeometry(4.2, 4.2, 9, 16).translate(s.x, 33.5, s.z), facadeMat('travArch'));
    add(b, lathe([[4.4, 38], [4.3, 40], [3.6, 42.5], [2.2, 44.5], [0.8, 45.4]], 16, s.x, s.z), dome);
    add(b, new THREE.CylinderGeometry(0.15, 0.3, 2.6, 6).translate(s.x, 46.6, s.z), stone, true);
  }
  // The campanile: square tower, open belfry, domed top to 91 m.
  tier(b, rect(11.5, 11.5, C.x, C.z), -1, 58, 'travArch');
  tier(b, rect(10.5, 10.5, C.x, C.z), 58, 71, 'travArch', { mat: stone });
  const op: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; op.push(new THREE.BoxGeometry(4, 9, 0.1).translate(0, 64.5, 5.3).rotateY(a).translate(C.x, 0, C.z)); }
  addMerged(b, op, mat('sc-dark', 0x2c2e33, 0.9));
  add(b, new THREE.CylinderGeometry(5.4, 5.6, 4, 16).translate(C.x, 73, C.z), stone);
  add(b, lathe([[5.4, 75], [5.2, 77], [4.2, 80], [2.4, 82.6], [0.8, 84]], 16, C.x, C.z), dome);
  add(b, new THREE.CylinderGeometry(0.9, 1.2, 3.5, 12).translate(C.x, 85.7, C.z), stone);
  addMerged(b, crossOnBall(C.x, 87.2, C.z, 0.8), bronze);
  b.solids.push({ ring: rect(11.5, 11.5, C.x, C.z), y0: 0, y1: 84 });
  // The porch facing south over Paris: three arches under a gable, Joan of Arc and Saint Louis.
  const bb = bboxOf(parts, 40);
  const zf = Math.max(D.z + 30, bb.z1) + 3;
  const porch = new THREE.Shape();
  porch.moveTo(-16, 0); porch.lineTo(16, 0); porch.lineTo(16, 17); porch.lineTo(0, 21.5); porch.lineTo(-16, 17); porch.closePath();
  for (const x of [-10, 0, 10]) { const h = new THREE.Path(); h.moveTo(x - 3.6, 0); h.lineTo(x + 3.6, 0); h.lineTo(x + 3.6, 8.5); h.absarc(x, 8.5, 3.6, 0, Math.PI, false); h.closePath(); porch.holes.push(h); }
  add(b, new THREE.ExtrudeGeometry(porch, { depth: 1.6, bevelEnabled: false, curveSegments: 10 }).translate(D.x, 0, zf - 1.6), stone);
  add(b, new THREE.BoxGeometry(32, 12, 0.3).translate(D.x, 6, zf - 7), mat('sc-dark', 0x2c2e33, 0.9));
  add(b, new THREE.BoxGeometry(32, 1.2, 7).translate(D.x, 17.6, zf - 4.5), stone);
  for (const sx of [-1, 1]) {
    add(b, new THREE.BoxGeometry(3.4, 6.5, 6).translate(D.x + sx * 19.5, 3.25, zf - 2), stone);
    add(b, new THREE.BoxGeometry(1.4, 2.2, 3.6).translate(D.x + sx * 19.5, 8.4, zf - 2), bronze, true);
    add(b, new THREE.CylinderGeometry(0.35, 0.4, 2.2, 8).translate(D.x + sx * 19.5, 10.2, zf - 2.3), bronze, true);
  }
  return b;
};

// ------------------------------------------------------------------ the Invalides

/** The Dôme des Invalides: the church's two-storey south front, the drum with paired columns, the
 * black lead dome with its gilded ribs and trophies, the gilt lantern and spire (107 m). */
const invalides: Builder = (c) => {
  euStyles();
  const b = built();
  const stone = mat('inv-stone', 0xe0d7c2, 0.85), gilt = GILT();
  const tall = c.rings.filter((p) => p.y1 > 31);
  const parts = c.rings.filter((p) => !tall.includes(p));
  if (parts.length) body(b, parts, 'beaux', 28, stone);
  else tier(b, rect(56, 60), -1, 28, 'beaux');
  // Drum: a square base, then the round drum with 40 columns in pairs and buttresses.
  tier(b, rect(34, 34), 20, 31, 'beaux', { mat: stone });
  add(b, new THREE.CylinderGeometry(14.2, 14.2, 18, 40, 1, true).translate(0, 40, 0), facadeMat('travArch'));
  const cols: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 20; k++) for (const d of [-0.035, 0.035]) { const a = (k / 20) * Math.PI * 2 + d; cols.push(new THREE.CylinderGeometry(0.5, 0.55, 16, 10).translate(Math.cos(a) * 15.2, 39, Math.sin(a) * 15.2)); }
  addMerged(b, cols, stone, true);
  add(b, new THREE.CylinderGeometry(16, 16, 2, 40).translate(0, 48, 0), stone);
  add(b, new THREE.CylinderGeometry(13.6, 14.2, 6.5, 40).translate(0, 52.2, 0), facadeMat('ashlar'));
  // The dome: dark lead, sixteen gilt ribs, a band of gilt trophies above the attic.
  const skin = paintedMat('inv-dome', [512, 256], (g, W, H) => {
    g.fillStyle = '#2b2e33'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d4a843';
    for (let k = 0; k < 16; k++) g.fillRect((k / 16) * W - 3, 0, 6, H * 0.92);
    for (let k = 0; k < 16; k++) { const x = ((k + 0.5) / 16) * W; g.beginPath(); g.ellipse(x, H * 0.86, 9, 13, 0, 0, Math.PI * 2); g.fill(); g.fillRect(x - 2, H * 0.55, 4, H * 0.25); }
    g.fillRect(0, H * 0.94, W, H * 0.04);
  }, { metal: 0.55, rough: 0.4 });
  add(b, lathe(domeProfile(13.9, 55.4, 26, 14), 48), skin);
  // The lantern and spire, all gilt.
  add(b, new THREE.CylinderGeometry(3.4, 3.8, 9, 16).translate(0, 85.5, 0), gilt);
  add(b, lathe([[3.6, 90], [3.2, 92.5], [1.6, 95], [0.7, 101], [0.15, 104.5]], 16), gilt);
  addMerged(b, crossOnBall(0, 104.3, 0, 0.6), gilt);
  b.solids.push({ ring: rect(30, 30), y0: 0, y1: 75 });
  // The south front: a portico of columns under a pediment, on the map's south face.
  const bb = bboxOf(parts, 30);
  const zf = bb.z1 + 1;
  addMerged(b, columnRow(-9, zf, 9, zf, 6, 0.75, 0, 13), stone);
  add(b, new THREE.BoxGeometry(22, 2.4, 3).translate(0, 14.2, zf - 1), stone);
  addMerged(b, columnRow(-7, zf - 0.5, 7, zf - 0.5, 4, 0.6, 15.4, 24), stone);
  add(b, new THREE.BoxGeometry(17, 1.8, 2.5).translate(0, 24.9, zf - 1.2), stone);
  add(b, pediment(18, 4.6, 2.2, 0, 25.8, zf - 1.2), stone);
  return b;
};

// ------------------------------------------------------------------ the Panthéon

/** The Panthéon: a Greek cross of blank ashlar walls (its windows were walled up in 1791), the
 * portico of Corinthian columns facing the rue Soufflot, the colonnaded drum and the dome (83 m). */
const pantheonParis: Builder = (c) => {
  euStyles();
  const b = built();
  const stone = mat('pan-stone', 0xe1d9c6, 0.85), lead = mat('pan-lead', 0x8b939a, 0.55, 0.35);
  const domeP = c.rings.find((p) => p.y1 > 55 && areaOf(p.ring) < 900);
  const D = domeP ? centerOf(domeP.ring) : { x: 0, z: 0 };
  const parts = c.rings.filter((p) => p !== domeP && !(p.y1 > 32 && areaOf(p.ring) < 1600));
  if (parts.length) body(b, parts, 'ashlar', 27, stone);
  else { tier(b, rect(30, 100, 0, 6), -1, 27, 'ashlar'); tier(b, rect(84, 30), -1, 27, 'ashlar'); }
  // Drum on its square base; the colonnade of 32 columns; attic; the dome; the lantern.
  tier(b, rect(36, 36, D.x, D.z), 20, 33, 'ashlar', { mat: stone });
  add(b, new THREE.CylinderGeometry(17.6, 17.6, 1.6, 48).translate(D.x, 33.8, D.z), stone);
  add(b, new THREE.CylinderGeometry(14.3, 14.3, 18, 48, 1, true).translate(D.x, 43.5, D.z), facadeMat('travArch'));
  addMerged(b, colonnade(16.8, 32, 0.62, 34.6, 50.6, D.x, D.z), stone);
  add(b, new THREE.CylinderGeometry(17.6, 17.6, 2.4, 48).translate(D.x, 51.8, D.z), stone);
  add(b, new THREE.CylinderGeometry(17.2, 17.2, 1, 48, 1, true).translate(D.x, 53.5, D.z), stone, true);
  add(b, new THREE.CylinderGeometry(14, 14.3, 6, 48).translate(D.x, 56, D.z), facadeMat('ashlar'));
  add(b, lathe(domeProfile(14.2, 59, 15.5, 12), 48, D.x, D.z), ribbedMat('pan-dome', '#8b939a', '#9aa2a8', 24));
  addMerged(b, colonnade(3, 12, 0.25, 74.2, 79.5, D.x, D.z), stone, true);
  add(b, new THREE.CylinderGeometry(2.6, 2.8, 5.3, 16).translate(D.x, 76.9, D.z), stone);
  add(b, lathe(domeProfile(3.2, 79.5, 2.6, 8), 16, D.x, D.z), lead);
  addMerged(b, crossOnBall(D.x, 82, D.z, 0.4), GILT());
  b.solids.push({ ring: rect(32, 32, D.x, D.z), y0: 0, y1: 72 });
  // The portico (the front faces +z): 22 columns, the pediment "Aux grands hommes".
  const bb = bboxOf(parts, 50);
  const zf = bb.z1 - 1.2, cx = D.x;
  const cols = [...columnRow(cx - 17, zf, cx + 17, zf, 6, 0.95, 1.2, 19.8), ...columnRow(cx - 17, zf - 5, cx + 17, zf - 5, 6, 0.95, 1.2, 19.8), ...columnRow(cx - 17, zf - 10, cx + 17, zf - 10, 2, 0.95, 1.2, 19.8)];
  addMerged(b, cols, stone);
  add(b, new THREE.BoxGeometry(40, 1.2, 14).translate(cx, 0.6, zf - 5), stone);
  add(b, new THREE.BoxGeometry(38, 3.4, 13).translate(cx, 21.5, zf - 5.2), stone);
  add(b, pediment(39, 7.2, 2.6, cx, 23.2, zf - 0.6), stone);
  add(b, new THREE.BoxGeometry(30, 0.9, 0.2).translate(cx, 21.6, zf + 1.1), mat('pan-letters', 0x6a6152, 0.8), true);
  void glowMat; void LEAD;
  return b;
};

export const PARIS_BUILDERS: Record<string, Builder> = { sacreCoeur, invalides, pantheonParis };
