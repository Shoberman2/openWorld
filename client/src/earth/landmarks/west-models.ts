// West Coast landmark models (catalog in west-catalog.ts): San Francisco's Salesforce Tower, Coit
// Tower, Ferry Building and Bay Bridge; Seattle's Space Needle; the Hollywood Sign, Griffith
// Observatory, the Wilshire Grand and the Santa Monica Pier's wheel; the Las Vegas Strip's Luxor,
// STRAT, half-size Eiffel Tower and the Bellagio fountains. Same model frame as models.ts: y up from
// the ground, x east, -z north (the landmark's bearing); bridges run along +x.
import * as THREE from 'three';
import { shared } from '../../engine.ts';
import { STYLES, area, band, built, facadeMat, glowMat, merged, ngon, nightMats, placed, prism, rect, solidMat, tier, type Built } from './kit.ts';
import { BUILDERS, type BuildCtx, loft, mesh } from './models.ts';

const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------ facade textures

Object.assign(STYLES, {
  // Salesforce Tower: pale glass behind white horizontal sunshades, a slab edge at each floor.
  sfGlass: {
    tile: [3.0, 4.15], px: [64, 128], rough: 0.12, metal: 0.55, glow: 0xf4f6ff,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) {
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        { g.fillStyle = 'rgba(235,240,255,0.35)'; g.fillRect(3, H * 0.12, W - 6, H * 0.62); }
        return;
      }
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#b9cad6'); grd.addColorStop(0.6, '#93a9b8'); grd.addColorStop(1, '#a7bac7');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e4e8ea'; g.fillRect(0, 0, 2, H); // mullion
      g.fillStyle = '#f2f3f1'; g.fillRect(0, H * 0.34, W, H * 0.06); // sunshade fin
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, H * 0.4, W, H * 0.025);
      g.fillStyle = '#dfe3e4'; g.fillRect(0, H * 0.88, W, H * 0.12); // slab edge
    },
  },
  // Coit Tower's top: arched openings round the observation gallery in plain concrete.
  coitTop: {
    tile: [2.25, 7], px: [64, 192], rough: 0.9, metal: 0, glow: 0xffd9a0,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      g.fillStyle = lit ? '#000' : '#e6dfcf'; g.fillRect(0, 0, W, H);
      const x = W * 0.22, w = W * 0.56, y = H * 0.18, h = H * 0.6;
      g.fillStyle = lit ? 'rgba(255,215,160,0.7)' : '#3a3a3a';
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
      if (!lit) { g.fillStyle = 'rgba(120,110,90,0.25)'; g.fillRect(0, H * 0.84, W, 3); g.fillRect(0, H * 0.08, W, 3); }
    },
  },
  // Ferry Building: grey-cream Colusa sandstone, two tiers of arched windows over an arcade.
  ferryArcade: {
    tile: [6.2, 13], px: [96, 200], rough: 0.85, metal: 0, glow: 0xffd49a,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      g.fillStyle = lit ? '#000' : '#d9d2c1'; g.fillRect(0, 0, W, H);
      if (!lit) {
        g.fillStyle = 'rgba(110,100,80,0.18)'; for (let y = 0; y < H; y += 9) g.fillRect(0, y, W, 1);
        g.fillStyle = '#cbc3b0'; g.fillRect(0, 0, W * 0.1, H); g.fillRect(W * 0.9, 0, W * 0.1, H);
        g.fillStyle = '#e8e2d4'; g.fillRect(0, H * 0.47, W, H * 0.04);
      }
      const arch = (x: number, y: number, w: number, h: number, col: string) => {
        g.fillStyle = col;
        g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
      };
      arch(W * 0.24, H * 0.06, W * 0.52, H * 0.36, lit ? 'rgba(255,205,140,0.8)' : '#3b4350');
      arch(W * 0.18, H * 0.55, W * 0.64, H * 0.45, lit ? 'rgba(255,205,140,0.9)' : '#454b52');
    },
  },
  // Luxor: dark bronze glass in a fine grid, slabs showing faintly.
  luxorGlass: {
    tile: [4, 3.4], px: [64, 64], rough: 0.14, metal: 0.75, glow: 0xffd9a0,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); { g.fillStyle = 'rgba(255,214,150,0.35)'; g.fillRect(4, 6, W - 8, H * 0.6); } return; }
      g.fillStyle = '#23272c'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#3d434b'; g.fillRect(0, 0, W, 2); g.fillRect(0, 0, 2, H);
      g.fillStyle = 'rgba(150,170,190,0.12)'; g.fillRect(2, 2, W - 2, H * 0.4);
    },
  },
  // Wilshire Grand: blue-silver reflective curtain wall.
  wgGlass: {
    tile: [1.5, 4.1], px: [32, 128], rough: 0.08, metal: 0.85, glow: 0xe8f0ff,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); { g.fillStyle = 'rgba(230,238,255,0.3)'; g.fillRect(2, 4, W - 3, H * 0.7); } return; }
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#9db6cf'); grd.addColorStop(1, '#6f8fae');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#cdd6de'; g.fillRect(0, 0, 2, H); g.fillRect(0, H * 0.8, W, 3);
    },
  },
});

// ------------------------------------------------------------------ shared bits

const WHITE = () => solidMat('w-white', 0xefede7, 0.7, 0.05);
const CONCRETE = () => solidMat('w-concrete', 0xe6dfcf, 0.9, 0);
const BRIDGE_GREY = () => solidMat('w-baybridge', 0x9ea4a8, 0.5, 0.45);

/** Rounded square ring (side s, corner radius r, n segments per corner). */
function roundedSquare(s: number, r: number, n = 5) {
  const out: number[] = [], h = s / 2 - r;
  const corners: [number, number, number][] = [[h, -h, -Math.PI / 2], [h, h, 0], [-h, h, Math.PI / 2], [-h, -h, Math.PI]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k <= n; k++) { const a = a0 + (k / n) * (Math.PI / 2); out.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); }
  return out;
}

/** A solid of revolution from (radius, y) pairs. */
function lathe(profile: [number, number][], segs = 48) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), segs);
}

/** A straight beam (box) between two points. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d = w) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

/** A material that only shows at night (beams, LED bands): additive, opacity follows the night. */
function nightOnly(color: number, strength: number) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a *= uNight * ${strength.toFixed(3)};`);
  };
  m.opacity = 1;
  return m;
}

let DIAL: THREE.MeshStandardMaterial | null = null;
/** A lit clock face (Ferry Building). */
function clockDial() {
  if (DIAL) return DIAL;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f1e2'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1f1f1f'; g.lineWidth = 7; g.stroke();
  g.fillStyle = '#1f1f1f'; g.font = 'bold 28px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(t, 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); });
  g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 50); g.moveTo(128, 128); g.lineTo(186, 150); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  DIAL = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xfff2d0, emissiveMap: tex, emissiveIntensity: 0.04, roughness: 0.5 });
  return DIAL;
}

// ------------------------------------------------------------------ San Francisco

/** Salesforce Tower: a rounded square tapering from 53 to 47 m, the perforated crown lit at night. */
const salesforceTower = (): Built => {
  const b = built();
  const lv = (s: number, r: number, y: number) => ({ ring: roundedSquare(s, r), y });
  mesh(loft([lv(53, 10.5, -2), lv(51, 11, 160), lv(47, 12, 296)], STYLES.sfGlass.tile, true), facadeMat('sfGlass'), b);
  b.solids.push({ ring: roundedSquare(52, 11), y0: 0, y1: 296 });
  // The crown: the walls carry on 30 m past the roof as perforated aluminum, open to the sky.
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 4; y < 64; y += 8) for (let x = 4; x < 64; x += 8) { g.beginPath(); g.arc(x + ((y / 8) % 2) * 4, y, 2.4, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1);
  const crown = new THREE.MeshStandardMaterial({ color: 0xe9ecee, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.5, emissive: 0xe6eeff, emissiveMap: tex, emissiveIntensity: 0 });
  crown.userData.glow = 1.1;
  b.group.add(Object.assign(new THREE.Mesh(prism(roundedSquare(47.2, 12), 295, 326, [1.6, 1.6], false), crown), { castShadow: true }));
  if (!nightMats.includes(crown)) nightMats.push(crown);
  mesh(prism(roundedSquare(30, 6), 296, 304, [4, 4]), solidMat('w-mech', 0x8f969b, 0.7, 0.3), b);
  // Street level: a taller, clearer lobby.
  mesh(prism(roundedSquare(53.4, 10.4), 0, 12, [3, 12], false), solidMat('w-lobby', 0x6d8291, 0.1, 0.7), b);
  return b;
};

/** Coit Tower: a fluted column on Telegraph Hill, the arcaded gallery at the top. */
const coitTower = (): Built => {
  const b = built();
  tier(b, rect(19, 19), -2, 5.5, 'coitTop', { mat: CONCRETE() });
  band(b, rect(19, 19), 5.2, 0.6, 0.35, CONCRETE());
  const fluted = (r: number) => { const out: number[] = []; for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, rr = i % 2 ? r - 0.32 : r; out.push(Math.cos(a) * rr, Math.sin(a) * rr); } return out; };
  mesh(loft([{ ring: fluted(5.75), y: 5.5 }, { ring: fluted(5.45), y: 56 }], [2, 2], false), CONCRETE(), b);
  tier(b, ngon(32, 5.55), 56, 63.2, 'coitTop');
  band(b, ngon(32, 5.55), 62.6, 1.4, 0.35, CONCRETE());
  b.solids.push({ ring: ngon(12, 5.7), y0: 0, y1: 64 });
  return b;
};

/** Ferry Building: the arcaded hall along x, the clock tower on its Market Street (+z) front. */
const STONE = () => solidMat('w-sandstone', 0xd6cebb, 0.85, 0);

const ferryBuilding = (c: BuildCtx): Built => {
  const b = built();
  // The hall: 200 m by 40, two arcaded storeys, the nave's raised roof and skylight down the middle.
  const W = 200, D = 40, H = 14;
  tier(b, rect(W, D), -3, H, 'ferryArcade');
  band(b, rect(W, D), H - 0.8, 1.1, 0.6, STONE());
  mesh(prism(rect(W - 12, 16), H, H + 5, [4, 4]), solidMat('w-ferry-roof', 0x7b8584, 0.7, 0.2), b);
  mesh(prism(rect(W - 20, 4), H + 5, H + 5.6, [4, 4]), solidMat('w-skylight', 0x9fb4bf, 0.15, 0.5), b);
  // End pavilions.
  for (const sx of [-1, 1]) tier(b, rect(14, D + 2, sx * (W / 2 - 7), 0), -3, H + 3, 'ferryArcade', { solid: false });
  // The clock tower (Giralda-like), 75 m.
  const tz = D / 2 - 6;
  tier(b, rect(14, 14, 0, tz), H, 47, 'beaux');
  band(b, rect(14, 14, 0, tz), 46.5, 1.2, 0.5, STONE());
  tier(b, rect(13, 13, 0, tz), 47.7, 56, 'beaux', { mat: STONE() });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    mesh(placed(new THREE.CircleGeometry(3.35, 32), Math.sin(a) * 6.56, 52, tz + Math.cos(a) * 6.56, a), clockDial(), b);
  }
  band(b, rect(13, 13, 0, tz), 55.5, 0.9, 0.5, STONE());
  tier(b, rect(10.5, 10.5, 0, tz), 56.4, 63, 'coitTop', { mat: facadeMat('coitTop') });
  band(b, rect(10.5, 10.5, 0, tz), 62.6, 0.8, 0.5, STONE());
  tier(b, rect(8.4, 8.4, 0, tz), 63.4, 67, 'beaux');
  mesh(prism(ngon(8, 3.6, Math.PI / 8, 0, tz), 67, 70, [2, 2]), STONE(), b);
  mesh(lathe([[3.7, 0], [3.3, 1.6], [2.2, 3.2], [0.6, 4.4], [0.3, 4.6]], 16).translate(0, 70, tz), solidMat('w-ferry-dome', 0xb9b2a0, 0.7, 0.1), b);
  mesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 6).translate(0, 77, tz), solidMat('w-flagpole', 0xdddddd, 0.4, 0.6), b, true);
  void c;
  return b;
};

/** Cable height along a parabola between (x0, y0) and (x1, y1) sagging `sag` in the middle. */
function sagY(x: number, x0: number, y0: number, x1: number, y1: number, sag: number) {
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
}

/**
 * The Bay Bridge's west crossing along +x (San Francisco at -x): two suspension bridges back to back,
 * each a 704 m main span between 160 m towers with 354 m side spans, meeting at the central anchorage.
 * The deck truss carries the map's road.
 */
const bayBridgeWest = (): Built => {
  const b = built();
  const deck = 62, T = 160, gap = 15.5;
  const towers = [-1084.5, -379.5, 378.7, 1083.7];
  const ends = [-1438.5, 1437.7];
  const grey = BRIDGE_GREY();
  // Towers: two cross-braced steel legs each.
  const parts: THREE.BufferGeometry[] = [];
  for (const x of towers) {
    for (const z of [-gap, gap]) {
      parts.push(loft([{ ring: rect(8, 9, x, z), y: -4 }, { ring: rect(5.5, 6, x, z), y: T }], [4, 4]));
      b.solids.push({ ring: rect(8, 9, x, z), y0: -4, y1: T });
    }
    const panels: [number, number][] = [[4, deck - 11], [deck + 6, deck + 40], [deck + 40, deck + 72], [deck + 72, T - 4]];
    for (const [y0, y1] of panels) {
      for (const s of [-1, 1]) parts.push(beam(new THREE.Vector3(x, y0, -gap * s), new THREE.Vector3(x, y1, gap * s), 1.4, 2.2));
      parts.push(new THREE.BoxGeometry(3, 2.4, gap * 2).translate(x, y1, 0));
    }
    parts.push(new THREE.BoxGeometry(6, 3.5, gap * 2 + 5).translate(x, T - 1, 0)); // the saddle housing
  }
  // Central anchorage: a concrete block in the bay, the cable bent above the deck.
  mesh(prism(rect(60, 30), -6, deck - 3, [4, 4]), solidMat('w-bb-anchor', 0xbcb7ab, 0.9, 0), b);
  b.solids.push({ ring: rect(60, 30), y0: -6, y1: deck - 3 });
  const bentTop = deck + 30;
  for (const z of [-gap, gap]) parts.push(loft([{ ring: rect(7, 6, 0, z), y: deck - 3 }, { ring: rect(4.5, 4.5, 0, z), y: bentTop }], [4, 4]));
  parts.push(new THREE.BoxGeometry(6, 3, gap * 2 + 4).translate(0, bentTop - 1, 0));
  for (const sx of [-1, 1]) parts.push(beam(new THREE.Vector3(0, deck + 2, -gap * sx), new THREE.Vector3(0, bentTop - 3, gap * sx), 1.2, 1.8));
  // End bents (the cables come down to the deck there).
  for (const x of ends) for (const z of [-gap, gap]) parts.push(new THREE.BoxGeometry(4, deck + 8, 4).translate(x, (deck + 8) / 2 - 4, z));
  // Deck truss, under the road.
  parts.push(new THREE.BoxGeometry(ends[1] - ends[0], 9.5, 2 * gap - 3).translate((ends[0] + ends[1]) / 2, deck - 5.2, 0));
  b.group.add(merged(parts, grey));
  // Main cables: end → tower → tower → anchorage for each bridge.
  const yAt = (x: number) => {
    const ax = x < 0 ? -1 : 1, [tA, tB] = ax < 0 ? [towers[0], towers[1]] : [towers[3], towers[2]], end = ax < 0 ? ends[0] : ends[1];
    const top = T - 1;
    if ((x - end) * ax <= 0 && (x - tA) * ax >= 0) return sagY(x, end, deck + 2, tA, top, 18);
    if ((x - tA) * ax <= 0 && (x - tB) * ax >= 0) return sagY(x, tA, top, tB, top, top - deck - 3);
    return sagY(x, tB, top, 0, bentTop - 1, 22);
  };
  const tubes: THREE.BufferGeometry[] = [];
  const lines: number[] = [];
  for (const z of [-gap, gap]) for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    const x0 = side < 0 ? ends[0] : 0, x1 = side < 0 ? 0 : ends[1];
    for (let i = 0; i <= 120; i++) { const x = x0 + ((x1 - x0) * i) / 120; pts.push(new THREE.Vector3(x, yAt(x === 0 ? side * 0.01 : x), z)); }
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.55, 6, false));
    for (let x = x0 + 8; x < x1 - 8; x += 15) { const y = yAt(x); if (y - deck > 2) lines.push(x, deck, z, x, y, z); }
  }
  b.group.add(merged(tubes, grey));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  b.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7f8589 })));
  // Aircraft warning lights on the towers, and the cable lights' glow at night.
  for (const x of towers) mesh(new THREE.SphereGeometry(0.9, 8, 6).translate(x, T + 1.2, 0), glowMat('w-bb-beacon', 0xff2a1a, 0.6, 5), b);
  const led = nightOnly(0xf4f2ff, 0.7);
  const dots: THREE.BufferGeometry[] = [];
  for (let x = ends[0] + 20; x < ends[1] - 20; x += 12) for (const z of [-gap, gap]) dots.push(new THREE.SphereGeometry(0.7, 5, 4).translate(x, yAt(x) - 0.4, z));
  b.group.add(merged(dots, led));
  return b;
};

// ------------------------------------------------------------------ Seattle

/** Space Needle: three pairs of legs pinched at the waist, the core, the top house and spire. */
const spaceNeedle = (): Built => {
  const b = built();
  const white = solidMat('w-needle', 0xf3f2ee, 0.55, 0.15);
  const legs: THREE.BufferGeometry[] = [];
  const prof: [number, number][] = [[17, 0], [13.2, 35], [9.2, 72], [5.4, 112], [6.6, 130], [10.5, 145], [14.6, 151]];
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2 + Math.PI / 2;
    for (const s of [-1, 1]) {
      const pts = prof.map(([r, y]) => {
        const off = s * (y < 112 ? 1.7 + (r - 5.4) * 0.06 : 1.7);
        const ca = Math.cos(a0), sa = Math.sin(a0);
        return new THREE.Vector3(ca * r - sa * off, y, sa * r + ca * off);
      });
      legs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.62, 6, false));
    }
    // Cross ties between the pair.
    for (const [r, y] of prof.slice(0, 4)) {
      const ca = Math.cos(a0), sa = Math.sin(a0);
      legs.push(beam(new THREE.Vector3(ca * r - sa * 1.9, y + 6, sa * r + ca * 1.9), new THREE.Vector3(ca * r + sa * 1.9, y + 6, sa * r - ca * 1.9), 0.4));
    }
  }
  b.group.add(merged(legs, white));
  mesh(new THREE.CylinderGeometry(2.9, 3.1, 160, 16).translate(0, 80, 0), solidMat('w-needle-core', 0xd6d8d8, 0.6, 0.2), b);
  // The elevators' gold cabs riding the core.
  for (const [a, y] of [[0.3, 64], [2.4, 118]] as [number, number][]) mesh(new THREE.BoxGeometry(2, 3, 1.2).translate(Math.cos(a) * 3.6, y, Math.sin(a) * 3.6).rotateY(0), solidMat('w-needle-cab', 0xd4a33a, 0.4, 0.6), b, true);
  // SkyLine level at 30 m (the 100-foot banquet floor).
  mesh(lathe([[3, 28], [8.5, 29], [8.5, 32.2], [3, 33]], 24), white, b);
  // The top house: white underside, restaurant glass, the halo deck, observation glass and roof.
  mesh(lathe([[3.2, 144], [9, 148.2], [15, 151.2], [19.6, 153.8], [20.6, 155]], 48), white, b);
  const glass = solidMat('w-needle-glass', 0x51697a, 0.12, 0.65);
  mesh(lathe([[20.6, 155], [20.9, 158.4]], 48), glowMat('w-needle-lit', 0xffe2b0, 0, 1.4), b);
  mesh(lathe([[20.75, 155.1], [21.05, 158.3]], 48), new THREE.MeshStandardMaterial({ color: 0x5c7486, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.7 }), b);
  mesh(lathe([[20.9, 158.4], [22.6, 158.8], [22.6, 159.6], [20.2, 159.9]], 48), white, b);
  mesh(lathe([[20.2, 159.9], [19.6, 163.4]], 48), glass, b);
  mesh(lathe([[19.6, 163.4], [20.4, 163.8], [17.5, 165.2], [10, 167], [4.2, 168.4], [1.2, 169]], 48), white, b);
  mesh(new THREE.CylinderGeometry(0.25, 0.95, 15, 8).translate(0, 176.5, 0), white, b);
  mesh(new THREE.SphereGeometry(0.5, 8, 6).translate(0, 184, 0), glowMat('w-needle-beacon', 0xfff4dc, 0.5, 4), b);
  b.solids.push({ ring: ngon(10, 3.2), y0: 0, y1: 150 }, { ring: ngon(16, 20.6), y0: 145, y1: 169 });
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + Math.PI / 2; b.solids.push({ ring: rect(4, 4, Math.cos(a) * 16, Math.sin(a) * 16), y0: 0, y1: 20 }); }
  return b;
};

// ------------------------------------------------------------------ Los Angeles

/** The nine letters, 13.7 m tall, as flat shapes (x across, y up) in a box `w` wide. */
function letterShapes(ch: string, w: number, h: number): THREE.Shape[] {
  const t = 2.5;
  const poly = (pts: number[]) => { const s = new THREE.Shape(); s.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]); s.closePath(); return s; };
  const stroke = (x0: number, y0: number, x1: number, y1: number, wd: number) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = (-dy / l) * (wd / 2), ny = (dx / l) * (wd / 2);
    return poly([x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny]);
  };
  switch (ch) {
    case 'H': return [poly([0, 0, t, 0, t, h * 0.42, w - t, h * 0.42, w - t, 0, w, 0, w, h, w - t, h, w - t, h * 0.58, t, h * 0.58, t, h, 0, h])];
    case 'L': return [poly([0, 0, w, 0, w, t, t, t, t, h, 0, h])];
    case 'O': case 'D': {
      const s = new THREE.Shape(), hole = new THREE.Path();
      if (ch === 'O') {
        s.absellipse(w / 2, h / 2, w / 2, h / 2, 0, Math.PI * 2, false, 0);
        hole.absellipse(w / 2, h / 2, w / 2 - t, h / 2 - t, 0, Math.PI * 2, true, 0);
      } else {
        const rx = w * 0.55;
        s.moveTo(0, 0); s.lineTo(w - rx, 0); s.absellipse(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, false, 0); s.lineTo(0, h); s.closePath();
        hole.moveTo(t, t); hole.lineTo(w - rx, t); hole.absellipse(w - rx, h / 2, rx - t, h / 2 - t, -Math.PI / 2, Math.PI / 2, false, 0); hole.lineTo(t, h - t); hole.closePath();
      }
      s.holes.push(hole);
      return [s];
    }
    case 'Y': return [stroke(w / 2, 0, w / 2, h * 0.5, t), stroke(w / 2, h * 0.48, t * 0.5, h, t * 1.05), stroke(w / 2, h * 0.48, w - t * 0.5, h, t * 1.05)];
    case 'W': return [stroke(t * 0.5, h, w * 0.27, 0, t), stroke(w * 0.27, 0, w * 0.5, h * 0.72, t * 0.95), stroke(w * 0.5, h * 0.72, w * 0.73, 0, t * 0.95), stroke(w * 0.73, 0, w - t * 0.5, h, t)];
  }
  return [];
}

/** The Hollywood Sign: white letters on the scaffolding that holds them to Mount Lee's slope. */
const hollywoodSign = (c: BuildCtx): Built => {
  const b = built();
  const H = 13.7, gapW = 1.1;
  const letters: [string, number][] = [['H', 10.4], ['O', 11.4], ['L', 9.2], ['L', 9.2], ['Y', 11.2], ['W', 13.6], ['O', 11.4], ['O', 11.4], ['D', 11]];
  const total = letters.reduce((s, [, w]) => s + w, 0) + gapW * (letters.length - 1);
  const face: THREE.BufferGeometry[] = [], frame: THREE.BufferGeometry[] = [];
  let x = -total / 2;
  letters.forEach(([ch, w], i) => {
    const cx = x + w / 2;
    const g0 = c.groundAt ? c.groundAt(cx, 0) : 0;
    const base = g0 + 1.2 + (rnd(i + 4) - 0.5) * 0.6;
    for (const s of letterShapes(ch, w, H)) {
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 18 });
      g.translate(x, base, 0);
      // A slight tilt back into the hill, letter by letter.
      face.push(g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), -0.05 + (rnd(i) - 0.5) * 0.03)));
    }
    // Scaffolding behind: posts down to the ground, braces back into the slope.
    for (let k = 0; k < 3; k++) {
      const px = x + w * (0.18 + 0.32 * k);
      const gp = c.groundAt ? c.groundAt(px, -1) : g0;
      frame.push(beam(new THREE.Vector3(px, Math.min(gp, base) - 3, -0.6), new THREE.Vector3(px, base + H - 0.8, -0.6), 0.35));
      const gb = c.groundAt ? c.groundAt(px, -6) : g0 + 2;
      frame.push(beam(new THREE.Vector3(px, base + H * 0.62, -0.6), new THREE.Vector3(px, gb - 1, -6), 0.28));
    }
    frame.push(beam(new THREE.Vector3(x + 0.3, base + H * 0.3, -0.8), new THREE.Vector3(x + w - 0.3, base + H * 0.3, -0.8), 0.22));
    frame.push(beam(new THREE.Vector3(x + 0.3, base + H * 0.75, -0.8), new THREE.Vector3(x + w - 0.3, base + H * 0.75, -0.8), 0.22));
    b.solids.push({ ring: rect(w, 2, cx, -0.5), y0: base - 2, y1: base + H });
    x += w + gapW;
  });
  b.group.add(merged(face, solidMat('w-hsign', 0xf6f5f1, 0.55, 0.05)));
  const fm = merged(frame, solidMat('w-hsign-frame', 0x77736d, 0.8, 0.3));
  b.group.add(fm); b.detail.push(fm);
  return b;
};

/** Griffith Observatory: white Art Deco, the planetarium dome and two telescope domes, facing the city. */
const griffith = (): Built => {
  const b = built();
  const white = solidMat('w-griffith', 0xf1eee6, 0.75, 0);
  const copper = solidMat('w-griffith-dome', 0x4d6a63, 0.45, 0.55);
  tier(b, rect(66, 13, 0, 8), -2, 10, 'coitTop', { mat: white });
  band(b, rect(66, 13, 0, 8), 9.4, 0.9, 0.4, white);
  tier(b, rect(34, 28, 0, -8), -2, 12.5, 'coitTop', { mat: white });
  band(b, rect(34, 28, 0, -8), 12, 0.8, 0.4, white);
  // Entrance block with its tall windows.
  tier(b, rect(16, 5, 0, 16), -2, 13.5, 'beaux', { mat: facadeMat('beaux') });
  // The planetarium: drum and copper dome (23 m across).
  mesh(prism(ngon(40, 11.6, 0, 0, -8), 12.5, 15, [2, 2]), white, b);
  mesh(new THREE.SphereGeometry(11.6, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 15, -8), copper, b);
  // The telescope domes at the ends.
  for (const sx of [-1, 1]) {
    tier(b, ngon(28, 5.4, 0, sx * 30, 8), 10, 16, 'coitTop', { mat: white });
    mesh(new THREE.SphereGeometry(5.4, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(sx * 30, 16, 8), copper, b);
  }
  // The Astronomers Monument on the front lawn.
  tier(b, rect(2.6, 2.6, 0, 46), 0, 11, 'coitTop', { mat: white });
  mesh(new THREE.SphereGeometry(0.9, 12, 8).translate(0, 11.6, 46), copper, b, true);
  b.solids.push({ ring: ngon(16, 11.6, 0, 0, -8), y0: 0, y1: 26.6 });
  return b;
};

/** Wilshire Grand: the podium, the glass tower from the map's own parts, the sail crown and spire. */
const wilshireGrand = (c: BuildCtx): Built => {
  const b = built();
  const glass = facadeMat('wgGlass');
  let tower: { ring: number[]; y1: number } | null = null;
  for (const r of c.rings) {
    const big = Math.abs(area(r.ring)) > 6000;
    const top = big ? 30 : Math.max(30, Math.min(r.y1, 285));
    const m = new THREE.Mesh(prism(r.ring, r.y0, top, big ? [3.4, 3.6] : STYLES.wgGlass.tile, true, r.holes), big ? facadeMat('whiteStone') : glass);
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: r.ring, y0: r.y0, y1: top });
    if (!big && (!tower || top > tower.y1)) tower = { ring: r.ring, y1: top };
  }
  if (!tower) {
    tower = { ring: rect(48, 40), y1: 285 };
    tier(b, tower.ring, 0, 285, 'wgGlass');
    tier(b, rect(120, 90), 0, 30, 'whiteStone');
  }
  // The sail: the top floors lean back from one end up to 310 m, the spire to 335.
  const r = tower.ring, n = r.length / 2;
  let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += r[i * 2]; cz += r[i * 2 + 1]; } cx /= n; cz /= n;
  let fx = 0, fz = 0, fd = 0; for (let i = 0; i < n; i++) { const d = Math.hypot(r[i * 2] - cx, r[i * 2 + 1] - cz); if (d > fd) { fd = d; fx = r[i * 2]; fz = r[i * 2 + 1]; } }
  const top = r.map((v, i) => (i % 2 ? fz + (v - fz) * 0.25 : fx + (v - fx) * 0.25));
  const y0 = tower.y1, y1 = 310;
  mesh(loft([{ ring: r, y: y0 }, { ring: top, y: y1 }], STYLES.wgGlass.tile), glass, b);
  const tx = fx + (cx - fx) * 0.12, tz = fz + (cz - fz) * 0.12;
  mesh(new THREE.CylinderGeometry(0.4, 1.4, 25, 8).translate(tx, y1 + 12.5, tz), solidMat('w-spire', 0xd8dde2, 0.3, 0.8), b);
  // The crown's light band (at night).
  const edge: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edge.push(beam(new THREE.Vector3(r[i * 2], y0, r[i * 2 + 1]), new THREE.Vector3(top[i * 2], y1, top[i * 2 + 1]), 0.6));
  }
  b.group.add(merged(edge, nightOnly(0x9fd0ff, 0.9)));
  return b;
};

/** The Pacific Wheel: 26 m, its rim lit in color at night, turning slowly. */
const pacificWheel = (): Built => {
  const b = built();
  const R = 12.2, hub = 14.2;
  const steel = solidMat('w-wheel', 0xe9e9e6, 0.4, 0.5);
  const spin = new THREE.Group();
  spin.position.set(0, hub, 0);
  const rim: THREE.BufferGeometry[] = [], spokes: THREE.BufferGeometry[] = [];
  for (const x of [-0.9, 0.9]) {
    rim.push(new THREE.TorusGeometry(R, 0.22, 6, 72).rotateY(Math.PI / 2).translate(x, 0, 0));
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      spokes.push(beam(new THREE.Vector3(x * 0.4, 0, 0), new THREE.Vector3(x, Math.sin(a) * R, Math.cos(a) * R), 0.09));
    }
  }
  const rimM = merged(rim, glowMat('w-wheel-led', 0xff5aa0, 0.15, 3.2));
  spin.add(rimM, merged(spokes, steel));
  const cars: THREE.BufferGeometry[] = [];
  const cols = [0xd8423a, 0xf2c230, 0x2f7fc1, 0x3aa35a];
  const carMats = cols.map((cc, i) => solidMat(`w-gondola-${i}`, cc, 0.5, 0.1));
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const g = new THREE.BoxGeometry(1.5, 1.7, 1.5).translate(0, Math.sin(a) * R - 1.1, Math.cos(a) * R);
    if (k % 4 === 0) cars.push(g); else { const m = new THREE.Mesh(g, carMats[k % 4]); spin.add(m); }
  }
  spin.add(merged(cars, carMats[0]));
  b.group.add(spin);
  rimM.onBeforeRender = () => { spin.rotation.x = (performance.now() / 1000) * 0.045; };
  // A-frame legs on both sides.
  const legs: THREE.BufferGeometry[] = [];
  for (const x of [-2.4, 2.4]) for (const z of [-6.5, 6.5]) legs.push(beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x * 0.55, hub, 0), 0.45));
  legs.push(new THREE.CylinderGeometry(0.5, 0.5, 5.2, 10).rotateZ(Math.PI / 2).translate(0, hub, 0));
  b.group.add(merged(legs, steel));
  b.solids.push({ ring: rect(5.4, 14), y0: 0, y1: hub + R });
  return b;
};


/** The Santa Monica Pier's outline (OpenStreetMap way 22728853), lon/lat pairs. */
const SM_PIER = [-118.5001913, 34.0075998, -118.4999246, 34.0073681, -118.4997392, 34.0072888, -118.4993612, 34.0075947, -118.4994543, 34.0076743,
  -118.4992845, 34.00781, -118.4990382, 34.0079352, -118.4990842, 34.0079745, -118.4985463, 34.0084077, -118.4979391, 34.0078879, -118.4974352, 34.0082939,
  -118.4969831, 34.0086526, -118.4965666, 34.008987, -118.4962547, 34.0092369, -118.4959075, 34.0095132, -118.4958143, 34.0096611, -118.4956924, 34.0097609,
  -118.4955902, 34.0097616, -118.4957186, 34.0098753, -118.4957111, 34.0100192, -118.4957725, 34.0101201, -118.4959269, 34.010352, -118.4960769, 34.0104172,
  -118.4959869, 34.0104932, -118.4960567, 34.0105585, -118.4964588, 34.0102363, -118.4968234, 34.0099417, -118.4970605, 34.0097806, -118.4973815, 34.0097122,
  -118.4972541, 34.0095971, -118.4974977, 34.009402, -118.4989762, 34.0081988, -118.4994097, 34.0079187, -118.4993684, 34.0078831, -118.499545, 34.0077395,
  -118.4997041, 34.0078754, -118.4998658, 34.0077443, -118.4999414, 34.0078055];
const SM_REF = { lat: 34.0089, lon: -118.4980, rot: Math.PI / 2 - (228.7 * Math.PI) / 180 };
/** lon/lat → the pier model's frame (its x runs out along the pier, as for a bridge). */
const smLocal = (lon: number, lat: number): [number, number] => {
  const dx = (lon - SM_REF.lon) * 111320 * Math.cos((SM_REF.lat * Math.PI) / 180), dz = -(lat - SM_REF.lat) * 111320;
  const c = Math.cos(SM_REF.rot), s = Math.sin(SM_REF.rot);
  return [dx * c - dz * s, dx * s + dz * c];
};

/** The Santa Monica Pier: a plank deck on pilings, white railings, the Pacific Wheel on Pacific Park. */
const santaMonicaPier = (cx: BuildCtx): Built => {
  const b = built();
  const ring: number[] = [];
  for (let i = 0; i < SM_PIER.length; i += 2) ring.push(...smLocal(SM_PIER[i], SM_PIER[i + 1]));
  const deck = 4.2;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 8; k++) { g.fillStyle = ['#9b8a73', '#8f7f69', '#a39079', '#93826b'][k % 4]; g.fillRect(0, k * 8, 64, 7); g.fillStyle = '#5f5446'; g.fillRect(0, k * 8 + 7, 64, 1); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  const wood = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const m = new THREE.Mesh(prism(ring, deck - 1.2, deck, [2, 2]), wood);
  m.receiveShadow = true; m.castShadow = true;
  b.group.add(m);
  b.solids.push({ ring, y0: -3, y1: deck });
  // Pilings on a 7 m grid under the deck.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const piles: THREE.BufferGeometry[] = [];
  const inside = (x: number, z: number) => { let o = false; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) { const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o; } return o; };
  for (let x = x0 + 3; x < x1; x += 7) for (let z = z0 + 3; z < z1; z += 7) if (inside(x, z)) piles.push(new THREE.CylinderGeometry(0.28, 0.32, deck + 4, 6).translate(x, deck / 2 - 2.6, z));
  b.group.add(merged(piles, solidMat('w-piling', 0x5d5246, 0.95, 0)));
  // The pier's shops and restaurants (the map stands them in the surf): rebuilt on the deck.
  for (const r of cx.rings) {
    const h = Math.max(3.5, Math.min(14, r.y1 - r.y0 - 1.6));
    if (Math.abs(area(r.ring)) < 6) continue;
    const bm = new THREE.Mesh(prism(r.ring, deck - 0.2, deck + h, STYLES.whiteStone.tile, true, r.holes), facadeMat('whiteStone'));
    bm.castShadow = true; bm.receiveShadow = true;
    b.group.add(bm);
    if (r.ring.length <= 200) band(b, r.ring, deck + h - 0.2, 0.6, 0.3, solidMat('w-pier-roof', 0xa9543a, 0.8, 0));
    b.solids.push({ ring: r.ring, y0: deck, y1: deck + h });
  }
  // White railings round the edge.
  const rail = new THREE.Mesh(prism(ring, deck, deck + 1.05, [1, 1], false), solidMat('w-rail', 0xeeeeea, 0.6, 0));
  b.group.add(rail); b.detail.push(rail);
  // The Pacific Wheel.
  const w = pacificWheel();
  const [wx, wz] = smLocal(-118.497834, 34.008227);
  w.group.position.set(wx, deck, wz);
  b.group.add(w.group);
  for (const s0 of w.solids) b.solids.push({ ring: s0.ring.map((v, i) => v + (i % 2 ? wz : wx)), y0: s0.y0 + deck, y1: s0.y1 + deck });
  return b;
};

// ------------------------------------------------------------------ Las Vegas

/** Luxor: the black-glass pyramid fitted to the map's footprint, the Sky Beam, the Sphinx facing the Strip. */
const luxor = (c: BuildCtx): Built => {
  const b = built();
  let side = 184, rot = 0, cx = 0, cz = 0;
  const big = c.rings.reduce<number[] | null>((m, r) => (!m || Math.abs(area(r.ring)) > Math.abs(area(m)) ? r.ring : m), null);
  if (big && Math.abs(area(big)) > 20000) {
    side = Math.min(200, Math.sqrt(Math.abs(area(big))));
    let best = 0;
    for (let i = 0; i < big.length; i += 2) {
      const j = (i + 2) % big.length, dx = big[j] - big[i], dz = big[j + 1] - big[i + 1], l = Math.hypot(dx, dz);
      if (l > best) { best = l; rot = Math.atan2(dz, dx); }
    }
    for (let i = 0; i < big.length; i += 2) { cx += big[i]; cz += big[i + 1]; }
    cx /= big.length / 2; cz /= big.length / 2;
  }
  const sq = (s: number) => { const h = s / 2, c0 = Math.cos(rot), s0 = Math.sin(rot); return [[-h, -h], [h, -h], [h, h], [-h, h]].flatMap(([x, z]) => [cx + x * c0 - z * s0, cz + x * s0 + z * c0]); };
  mesh(loft([{ ring: sq(side), y: -1 }, { ring: sq(0.6), y: 107 }], STYLES.luxorGlass.tile, false), facadeMat('luxorGlass'), b);
  for (let k = 0; k < 5; k++) b.solids.push({ ring: sq(side * (1 - k / 5)), y0: (107 * k) / 5, y1: (107 * (k + 1)) / 5 });
  // The Sky Beam (only at night).
  mesh(new THREE.CylinderGeometry(3.2, 1.6, 2600, 12, 1, true).translate(cx, 107 + 1300, cz), nightOnly(0xdfe8ff, 0.55), b);
  mesh(new THREE.ConeGeometry(2.4, 3, 4).translate(cx, 107.5, cz), glowMat('w-luxor-apex', 0xf2f6ff, 0.3, 5), b);
  // The Sphinx (34 m) between the pyramid and the Strip, facing east.
  const stone = solidMat('w-sphinx', 0xcdb68c, 0.9, 0);
  const sx = cx + side / 2 + 46, sz = cz;
  const sph: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(38, 13, 15).translate(-6, 6.5, 0),
    new THREE.BoxGeometry(18, 4.5, 4).translate(17, 2.25, -4.6), new THREE.BoxGeometry(18, 4.5, 4).translate(17, 2.25, 4.6),
    new THREE.BoxGeometry(10, 12, 10).translate(9, 17, 0),
    loft([{ ring: rect(9, 15, 8, 0), y: 13 }, { ring: rect(7, 9, 9, 0), y: 27 }], [2, 2]),
    new THREE.BoxGeometry(5, 7, 6).translate(13.5, 22, 0),
  ];
  const sm = merged(sph, stone);
  sm.position.set(sx, 0, sz);
  b.group.add(sm);
  b.solids.push({ ring: ngon(8, 18, 0, sx, sz), y0: 0, y1: 27 });
  return b;
};

/** The STRAT: a three-legged shaft to the pod at 250–285 m, the mast to 350 m. */
const stratTower = (): Built => {
  const b = built();
  const white = solidMat('w-strat', 0xeeebe4, 0.75, 0.05);
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(6.6, 7.6, 252, 20).translate(0, 126, 0)];
  // Three tapering legs (wings) gathering into the shaft.
  const levels: [number, number][] = [[0, 19], [55, 14.5], [140, 10.5], [215, 8], [245, 7]];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    const ring = (r: number, w: number) => [[5, -w / 2], [r, -w / 2], [r, w / 2], [5, w / 2]].flatMap(([x, z]) => [x * ca - z * sa, x * sa + z * ca]);
    parts.push(loft(levels.map(([y, r]) => ({ ring: ring(r, 6.5 - y / 80), y })), [4, 4], false));
    b.solids.push({ ring: ring(19, 6.5), y0: 0, y1: 60 });
  }
  b.group.add(merged(parts, white));
  // The pod: twelve levels, glass bands for the restaurant and observation decks.
  mesh(lathe([[6.8, 244], [12, 248], [17.5, 253], [19.5, 257]], 40), white, b);
  const glass = glowMat('w-strat-glass', 0xffe0b0, 0, 1.8);
  glass.color.setHex(0x2d3a45); glass.roughness = 0.15; glass.metalness = 0.6;
  mesh(lathe([[19.5, 257], [19.8, 262]], 40), glass, b);
  mesh(lathe([[19.8, 262], [20.6, 263], [20.6, 265], [18.6, 266]], 40), white, b);
  mesh(lathe([[18.6, 266], [18.4, 271]], 40), glass, b);
  mesh(lathe([[18.4, 271], [19.2, 272], [19.2, 273.4], [16.5, 274.5], [16, 279]], 40), white, b);
  mesh(lathe([[16, 279], [15.2, 282.5]], 40), glass, b);
  mesh(lathe([[15.2, 282.5], [12, 285], [6, 287], [3.2, 288]], 40), white, b);
  // The mast and the Big Shot's frame on top.
  mesh(new THREE.CylinderGeometry(2.3, 3.2, 58, 12).translate(0, 317, 0), white, b);
  const rig: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; rig.push(beam(new THREE.Vector3(Math.cos(a) * 3.4, 290, Math.sin(a) * 3.4), new THREE.Vector3(Math.cos(a) * 2.6, 344, Math.sin(a) * 2.6), 0.5)); }
  for (let y = 296; y < 344; y += 8) rig.push(lathe([[3.4 - (y - 290) * 0.015, y], [3.5 - (y - 290) * 0.015, y + 0.4]], 16));
  const rm = merged(rig, solidMat('w-strat-rig', 0xc23a32, 0.6, 0.3)); b.group.add(rm); b.detail.push(rm);
  mesh(new THREE.CylinderGeometry(0.4, 1.2, 6, 8).translate(0, 349, 0), white, b);
  mesh(new THREE.SphereGeometry(0.8, 8, 6).translate(0, 352.5, 0), glowMat('w-strat-beacon', 0xff2a1a, 1, 5), b);
  b.solids.push({ ring: ngon(10, 7.6), y0: 0, y1: 288 }, { ring: ngon(16, 20), y0: 248, y1: 287 });
  return b;
};

/** Paris Las Vegas: the Eiffel Tower at half size (165 m). */
const parisEiffel = (c: BuildCtx): Built => {
  const b = BUILDERS.eiffel(c);
  const inner = new THREE.Group();
  inner.add(...b.group.children);
  inner.scale.setScalar(0.5);
  b.group.add(inner);
  b.solids = b.solids.map((s) => ({ ring: s.ring.map((v) => v * 0.5), y0: s.y0 * 0.5, y1: s.y1 * 0.5 }));
  return b;
};

/**
 * The Fountains of Bellagio: rows of jets along the lake's Strip side, dancing through a show every
 * ninety seconds (the shaders animate them; nothing on the CPU).
 */
const bellagioFountains = (): Built => {
  const b = built();
  const N = 180;
  const geo = new THREE.CylinderGeometry(0.06, 0.55, 1, 7, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f9fc, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, emissive: 0xe8f4ff, emissiveIntensity: 0.15 });
  const im = new THREE.InstancedMesh(geo, mat, N);
  const phase = new Float32Array(N), kind = new Float32Array(N);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    // Two gently curving rows parallel to the Strip, with the big shooters along the middle.
    const row = i % 3, t = Math.floor(i / 3) / (N / 3 - 1);
    const z = -125 + t * 250;
    const x = 22 + row * 9 + Math.sin(t * Math.PI) * -18;
    m.makeTranslation(x, 0, z);
    im.setMatrixAt(i, m);
    phase[i] = t;
    kind[i] = row === 1 && Math.floor(i / 3) % 6 === 0 ? 1 : 0;
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aKind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ts = mod(uTime, 90.0);
        float on = smoothstep(0.0, 2.5, ts) * (1.0 - smoothstep(44.0, 47.0, ts));
        float wave = 0.5 + 0.5 * sin(ts * 1.6 - aPhase * 18.0);
        float climax = smoothstep(32.0, 36.0, ts) * (1.0 - smoothstep(42.0, 44.0, ts));
        float hgt = mix(8.0 + 22.0 * wave, 26.0 + 10.0 * wave, climax) * (1.0 + aKind * (1.2 + 1.6 * climax));
        hgt = max(0.05, hgt * on);
        transformed.y *= hgt;
        transformed.xz *= 1.0 + hgt * 0.035;`);
  };
  mat.customProgramCacheKey = () => 'w-bellagio-jets-v1';
  im.frustumCulled = false;
  b.group.add(im);
  return b;
};

const none = (): Built => built();

Object.assign(BUILDERS, {
  salesforceTower, coitTower, ferryBuilding, bayBridgeWest, spaceNeedle, hollywoodSign, griffith, wilshireGrand, pacificWheel,
  luxor, stratTower, parisEiffel, bellagioFountains, santaMonicaPier, none,
});
