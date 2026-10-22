// New York landmarks added for the "real NYC" pass: Citigroup Center (a plain box in the map),
// the Manhattan, Williamsburg and Queensboro bridges, 30 Hudson Yards with Edge, One Vanderbilt, the Bank of
// America Tower, Hearst Tower's diagrid, the Guggenheim's spiral, the bronze Seagram and green-glass Lever
// House, 56 Leonard's stacked floors and the Oculus. Same model frame as models.ts: y up from the ground,
// x east, z south (turned by the bearing); bridges run along x with y = 0 at the water.
//
// Reference facts (checked 2026-10): Citigroup Center 279 m, 45° crown, tower on four 9-story stilts at
// mid-sides (Wikipedia). Manhattan Bridge towers 102 m, main span 448 m, clearance 41 m (NYC DOT /
// Wikipedia). Williamsburg Bridge towers 102 m, main span 488 m, unsuspended 182 m side spans, 12 m deep
// stiffening trusses, deck 36 m (Wikipedia / Structure mag). Edge cantilevers ~24 m (80 ft) from the
// 100th floor of 30 Hudson Yards, deck at 345 m (KPF). One Vanderbilt roof 397 m, spire 427 m, glass
// with terracotta spandrels. Bank of America Tower roof 288 m, spire 366 m. Hearst Tower 182 m, steel
// diagrid in 4-story modules. Guggenheim rotunda ~29 m tall, widening upward (Guggenheim). 56 Leonard
// 250 m, 57 floors. Queensboro spans 360 / 192 / 300 m, clearance 41 m (NYC DOT).
import * as THREE from 'three';
import { STYLES, area, built, type FacadeStyle, facadeMat, glowMat, merged, nightMats, ngon, offsetRing, prism, rect, solidMat, tier, type Built } from './kit.ts';
import type { BuildCtx } from './models.ts';

type Builder = (c: BuildCtx) => Built;

const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Which cell of a multi-cell facade tile is being painted (varies the per-window luck). */
let CELL = 0;
const rnd = (s: number) => rand(s + CELL * 17.31);

/** Lit/unlit pane: glass with a sliver of sky by day, a warm (or dark) room at night. */
function pane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, seed: number, glass: string, share = 0.35) {
  if (lit) {
    g.fillStyle = rnd(seed) < share ? `hsl(${38 + rnd(seed + 1) * 14}, 85%, ${58 + rnd(seed + 2) * 18}%)` : '#000';
    g.fillRect(x, y, w, h);
    return;
  }
  g.fillStyle = glass; g.fillRect(x, y, w, h);
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, 'rgba(205,222,240,0.45)'); grd.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x, y, w, h);
}

// ------------------------------------------------------------------ facade styles (registered into kit's table)

const NYC_STYLES: Record<string, FacadeStyle> = {
  // Citigroup Center: alternating ribbons of bright aluminum panels and glass (one floor per tile).
  nycCitiBands: {
    tile: [3.0, 3.66], px: [64, 128], rough: 0.38, metal: 0.25, glow: 0xfff0d8,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#eef0f1'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, 1, H); g.fillRect(0, H * 0.5, W, 2); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, 0, H * 0.08, W, H * 0.34, lit, W * 0.37 + 3, '#5b6b7b', 0.4);
      if (!lit) { g.fillStyle = '#c4c9ce'; g.fillRect(W - 2, H * 0.08, 2, H * 0.34); }
    },
  },
  // 30 Hudson Yards: blue-grey glass with slim vertical fins.
  nycHyGlass: {
    tile: [1.5, 4.25], px: [32, 128], rough: 0.1, metal: 0.85, glow: 0xe8efff,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); if (rnd(W + 5) < 0.5) { g.fillStyle = 'rgba(220,232,255,0.5)'; g.fillRect(3, 4, W - 6, H * 0.8); } return; }
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#a7bfd3'); grd.addColorStop(1, '#6f879e');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#dfe6ec'; g.fillRect(0, 0, 3, H);
      g.fillStyle = 'rgba(40,50,60,0.35)'; g.fillRect(0, H * 0.84, W, H * 0.16);
    },
  },
  // One Vanderbilt: clear glass between terracotta spandrels and soffits.
  nycVanderbilt: {
    tile: [3.0, 4.4], px: [64, 128], rough: 0.25, metal: 0.55, glow: 0xfff2dc,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#d9cdb8'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(150,120,90,0.25)'; g.fillRect(0, H * 0.8, W, 2); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, W * 0.06, 0, W * 0.88, H * 0.74, lit, W + 11, '#7f97ad', 0.3);
      if (!lit) { g.fillStyle = '#efe7da'; g.fillRect(W * 0.47, 0, 2, H * 0.74); }
    },
  },
  // Bank of America Tower: low-iron clear glass, fine mullions, a pale fritted band at each slab.
  nycBofa: {
    tile: [1.5, 4.0], px: [32, 128], rough: 0.06, metal: 0.9, glow: 0xeef4ff,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); if (rnd(W + 9) < 0.55) { g.fillStyle = 'rgba(235,242,255,0.55)'; g.fillRect(2, 4, W - 4, H * 0.82); } return; }
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#c3d4e0'); grd.addColorStop(1, '#8aa2b6');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#eef2f4'; g.fillRect(0, 0, 2, H); g.fillRect(0, H * 0.88, W, H * 0.12);
    },
  },
  // Hearst Tower: blue-grey glass between floor slabs (the diagrid is real geometry over it).
  nycHearstGlass: {
    tile: [3.0, 4.1], px: [64, 128], rough: 0.08, metal: 0.85, glow: 0xeef4ff,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); if (rnd(W + 21) < 0.6) { g.fillStyle = 'rgba(230,240,255,0.5)'; g.fillRect(2, 5, W - 4, H * 0.75); } return; }
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#9fb6c9'); grd.addColorStop(1, '#5f7488');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#c8d0d6'; g.fillRect(0, H * 0.86, W, H * 0.14); g.fillRect(0, 0, 2, H);
    },
  },
  // Seagram Building: bronze I-beam mullions over bronze-tinted glass.
  nycBronze: {
    tile: [1.42, 3.6], px: [32, 128], rough: 0.38, metal: 0.75, glow: 0xffdcae,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#6b5236'; g.fillRect(0, 0, W, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, W * 0.12, 0, W * 0.76, H * 0.7, lit, W * 3 + 1, '#7a6a58', 0.35);
      if (!lit) { g.fillStyle = '#95714a'; g.fillRect(0, 0, W * 0.12, H); g.fillStyle = '#5a4430'; g.fillRect(0, H * 0.72, W, H * 0.28); g.fillStyle = 'rgba(255,220,170,0.18)'; g.fillRect(1, 0, 1, H); }
    },
  },
  // Lever House: blue-green glass with stainless mullions and dark green spandrel glass.
  nycLever: {
    tile: [1.45, 3.65], px: [32, 128], rough: 0.12, metal: 0.65, glow: 0xf3fff0,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#2f5552'; g.fillRect(0, 0, W, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, 0, 0, W, H * 0.6, lit, W * 5 + 2, '#6f9c98', 0.4);
      if (!lit) { g.fillStyle = '#d7dcdc'; g.fillRect(0, 0, 2, H); g.fillRect(0, H * 0.6, W, 2); }
    },
  },
  // 56 Leonard: floor-to-ceiling glass between the exposed white edges of each slab.
  nycLeonard: {
    tile: [2.4, 4.38], px: [64, 128], rough: 0.08, metal: 0.8, glow: 0xfff1dc,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#f2f2ef'; g.fillRect(0, 0, W, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, 0, H * 0.1, W, H * 0.9, lit, W * 13 + 5, '#67809a', 0.35);
      if (!lit) { g.fillStyle = '#c9ced2'; g.fillRect(0, H * 0.14, 2, H * 0.86); }
    },
  },
  // Guggenheim annex and Hearst base: buff limestone grid with square windows.
  nycLimeGrid: {
    tile: [3.2, 3.8], px: [64, 128], rough: 0.85, metal: 0, glow: 0xffe3b8,
    paint(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) {
      if (!lit) { g.fillStyle = '#e2d8c4'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(120,100,70,0.2)'; g.fillRect(0, 0, W, 1); g.fillRect(0, 0, 1, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      pane(g, W * 0.18, H * 0.2, W * 0.64, H * 0.56, lit, W * 7, '#3d4652', 0.4);
    },
  },
};

// One canvas tile per window would light every window of a tower at once; paint a block of cells (each
// its own luck) per tile instead, so the night pattern varies.
for (const [k, st] of Object.entries(NYC_STYLES)) {
  const [nx, ny] = k === 'nycLimeGrid' ? [3, 3] : [4, 4];
  const paint = st.paint;
  STYLES[k] = {
    ...st, tile: [st.tile[0] * nx, st.tile[1] * ny], px: [st.px[0] * nx, st.px[1] * ny],
    paint(g, W, H, lit) {
      const cw = W / nx, ch = H / ny;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        CELL = j * nx + i + 1;
        g.save(); g.translate(i * cw, j * ch); g.beginPath(); g.rect(0, 0, cw, ch); g.clip();
        paint(g, cw, ch, lit);
        g.restore();
      }
      CELL = 0;
    },
  };
}

// ------------------------------------------------------------------ helpers

function mesh(g: THREE.BufferGeometry, m: THREE.Material, b: Built, detail = false) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true; x.receiveShadow = true;
  b.group.add(x);
  if (detail) b.detail.push(x);
  return x;
}

type P3 = [number, number, number];

/** Flat convex faces (each a planar polygon) turned to face away from `center`, UV'd in meters of `tile`. */
function faces(polys: P3[][], center: P3, tile: [number, number] = [4, 4], inside?: P3[]) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const [pi, P0] of polys.entries()) {
    let P = P0;
    const ctr = inside?.[pi] ?? center;
    const [a, b, c] = P;
    let n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
    const m = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
    if (n.x * (m[0] - ctr[0]) + n.y * (m[1] - ctr[1]) + n.z * (m[2] - ctr[2]) < 0) { P = [...P].reverse(); n = n.negate(); }
    const h = Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const vAxis = Math.abs(n.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : null;
    const U = (p: P3) => (p[0] * h.x + p[1] * h.y + p[2] * h.z) / tile[0];
    const V = (p: P3) => (vAxis ? p[2] : p[1]) / tile[1];
    for (let i = 1; i + 1 < P.length; i++) for (const p of [P[0], P[i], P[i + 1]]) { pos.push(...p); nrm.push(n.x, n.y, n.z); uv.push(U(p), V(p)); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A box tapering from w0×d0 at y0 to w1×d1 at y1 (centered on cx, cz), sides only plus a cap. */
function frustum(w0: number, d0: number, w1: number, d1: number, y0: number, y1: number, cx = 0, cz = 0, tile: [number, number] = [4, 4]) {
  const lo: P3[] = [[cx - w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz + d0 / 2], [cx - w0 / 2, y0, cz + d0 / 2]];
  const hi: P3[] = [[cx - w1 / 2, y1, cz - d1 / 2], [cx + w1 / 2, y1, cz - d1 / 2], [cx + w1 / 2, y1, cz + d1 / 2], [cx - w1 / 2, y1, cz + d1 / 2]];
  const polys: P3[][] = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; polys.push([lo[i], lo[j], hi[j], hi[i]]); }
  polys.push(hi);
  return faces(polys, [cx, (y0 + y1) / 2, cz], tile);
}

/** A square beam from a to b (t thick), for merging. */
function beam(a: P3, b: P3, t: number, t2 = t) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(t, t2, len);
  const up = Math.abs(vb.y - va.y) > len * 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(vb, va, up);
  m.setPosition(va.clone().add(vb).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

/** Walls lofted between two rings with the same vertex count (no caps), UV'd in meters. */
function loftRings(r0: number[], y0: number, r1: number[], y1: number, tile: [number, number]) {
  const polys: P3[][] = [], inside: P3[] = [];
  const n = r0.length / 2, sgn = area(r0) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r0[i * 2], az = r0[i * 2 + 1], bx = r0[j * 2], bz = r0[j * 2 + 1], l = Math.hypot(bx - ax, bz - az) || 1;
    polys.push([[ax, y0, az], [bx, y0, bz], [r1[j * 2], y1, r1[j * 2 + 1]], [r1[i * 2], y1, r1[i * 2 + 1]]]);
    // A point just inside this wall (outward normal of a ring with area() > 0 is (dz, -dx)), so concave
    // outlines face the right way too.
    const nx = ((bz - az) / l) * sgn, nz = (-(bx - ax) / l) * sgn;
    inside.push([(ax + bx) / 2 - nx * 2, (y0 + y1) / 2, (az + bz) / 2 - nz * 2]);
  }
  return faces(polys, [0, 0, 0], tile, inside);
}

/** Cap polygon for a ring at height y. */
function capRing(ring: number[], y: number) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos: number[] = [];
  for (const [a, c, d] of tris) {
    const ny = (pts[d].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[d].y - pts[a].y);
    const o = ny > 0 ? [a, c, d] : [a, d, c];
    for (const k of o) pos.push(pts[k].x, y, pts[k].y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

function ringCenter(r: number[]) { let x = 0, z = 0; const n = r.length / 2; for (let i = 0; i < r.length; i += 2) { x += r[i] / n; z += r[i + 1] / n; } return { x, z }; }
function inRing(r: number[], x: number, z: number) {
  let ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function bboxOf(rings: number[][]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

/** A material whose emissive comes up at night (floodlit crowns), keeping its own day color. */
function floodMat(key: string, color: number, emissive: number, glow: number, rough = 0.4, metal = 0.5) {
  const cache = floodMat as unknown as { c?: Map<string, THREE.MeshStandardMaterial> };
  cache.c ??= new Map();
  let m = cache.c.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: 0 });
  m.userData.glow = glow; m.userData.day = 0;
  nightMats.push(m);
  cache.c.set(key, m);
  return m;
}

/** The map's parts minus outlines that merely wrap other parts (a building's outline drawn at full height). */
function realParts(c: BuildCtx) {
  const rs = c.rings.filter((r) => r.ring.length >= 6 && Math.abs(area(r.ring)) > 4);
  return rs.filter((r) => {
    const inside = rs.filter((o) => o !== r && Math.abs(area(o.ring)) < Math.abs(area(r.ring)) && (() => { const m = ringCenter(o.ring); return inRing(r.ring, m.x, m.z); })());
    return inside.length < 2;
  });
}

/**
 * A tower from the map's own parts: each part extruded in a facade style; parts that reach the top get a
 * crown sloping inward; slim parts above the roofline become a spire.
 */
function partsTower(b: Built, c: BuildCtx, style: string, opts: { crown?: number; spireMat?: THREE.Material; fallback: { ring: number[]; y1: number }[]; cornice?: THREE.Material }) {
  const st = STYLES[style];
  let parts = realParts(c);
  if (!parts.length) parts = opts.fallback.map((f) => ({ ring: f.ring, holes: [], y0: 0, y1: f.y1 }));
  const big = parts.filter((p) => Math.abs(area(p.ring)) >= 120);
  const roof = big.length ? Math.max(...big.map((p) => p.y1)) : 0;
  for (const p of parts) {
    const a = Math.abs(area(p.ring));
    const y0 = Math.max(-1.5, p.y0);
    if (a < 120 && p.y1 > roof + 5) {
      // A spire: a slim tapering mast from the roof.
      const r = Math.min(1.8, Math.max(0.8, Math.sqrt(a) / 2));
      const m = ringCenter(p.ring);
      mesh(new THREE.CylinderGeometry(0.35, r, p.y1 - roof + 4, 8).translate(m.x, (roof - 4 + p.y1) / 2, m.z), opts.spireMat ?? solidMat('nyc-spire', 0xcfd4da, 0.35, 0.8), b);
      b.solids.push({ ring: rect(r * 2, r * 2, m.x, m.z), y0: roof, y1: p.y1 });
      continue;
    }
    const crownH = opts.crown && p.y1 > roof * 0.6 && p.ring.length <= 64 ? Math.min(opts.crown, (p.y1 - y0) * 0.12) : 0;
    const wallTop = p.y1 - crownH;
    const m = new THREE.Mesh(prism(p.ring, y0, wallTop, st.tile, crownH === 0, p.holes), facadeMat(style));
    m.castShadow = true; m.receiveShadow = true;
    b.group.add(m);
    b.solids.push({ ring: p.ring, y0, y1: p.y1 });
    if (crownH > 0) {
      // Inset: a third of the part's smaller half-width, so the top leans in like a pavilion roof.
      const bb = bboxOf([p.ring]);
      const inset = Math.min(bb.w, bb.d) * 0.3;
      const top = offsetRing(p.ring, -inset);
      mesh(loftRings(p.ring, wallTop, top, p.y1, st.tile), facadeMat(style), b);
      mesh(capRing(top, p.y1), solidMat('nyc-roof', 0x9aa0a6, 0.6, 0.3), b);
    } else if (opts.cornice) {
      mesh(prism(offsetRing(p.ring, 0.25), p.y1 - 0.6, p.y1 + 0.4, [1, 1]), opts.cornice, b);
    }
  }
  return { parts, roof };
}

// ------------------------------------------------------------------ Citigroup Center

const citigroup: Builder = () => {
  const b = built();
  const W = 47.9, h = W / 2, Y0 = 34.7, Y1 = 231, TOP = 279;
  const conc = solidMat('nyc-citi-col', 0xd3d1ca, 0.75, 0.05);
  // Four mid-side columns and the core carry the whole tower 9 stories up; the corners hang free.
  for (const [x, z] of [[0, -(h - 3.65)], [0, h - 3.65], [-(h - 3.65), 0], [h - 3.65, 0]]) tier(b, rect(7.3, 7.3, x, z), -1.5, Y0, 'nycCitiBands', { mat: conc });
  tier(b, rect(17, 17), -1.5, Y0, 'nycCitiBands', { mat: solidMat('nyc-citi-core', 0x5f6870, 0.4, 0.4) });
  mesh(new THREE.BoxGeometry(W, 1.2, W).translate(0, Y0 + 0.6, 0), conc, b);
  tier(b, rect(W, W), Y0 + 1.2, Y1, 'nycCitiBands');
  // The 45° crown: its slope faces south (+z), walls continue the bands on the other three sides.
  const tile = STYLES.nycCitiBands.tile;
  const walls = faces([
    [[-h, Y1, -h], [h, Y1, -h], [h, TOP, -h], [-h, TOP, -h]],
    [[-h, Y1, h], [-h, Y1, -h], [-h, TOP, -h]],
    [[h, Y1, h], [h, Y1, -h], [h, TOP, -h]],
  ], [0, Y1 + 12, 0], tile);
  mesh(walls, facadeMat('nycCitiBands'), b);
  const slope = faces([[[-h, Y1, h], [h, Y1, h], [h, TOP, -h], [-h, TOP, -h]]], [0, Y1 + 12, 0], [3, 3]);
  mesh(slope, floodMat('nyc-citi-crown', 0xe9ecee, 0xfff6e6, 0.9, 0.3, 0.6), b);
  b.solids.push({ ring: rect(W, W), y0: Y0, y1: TOP });
  return b;
};

// ------------------------------------------------------------------ Hudson Yards

let EDGE_GLASS: THREE.MeshStandardMaterial | null = null;
const hy30: Builder = (c) => {
  const b = built();
  const fallback = [{ ring: rect(52, 64), y1: 395 }];
  const { parts, roof } = partsTower(b, c, 'nycHyGlass', { crown: 22, fallback });
  // Edge: a triangular deck cantilevered ~24 m from the 100th floor (345 m) on the tower's east side.
  const tall = parts.filter((p) => p.y1 >= roof - 1 && Math.abs(area(p.ring)) >= 120);
  const bb = bboxOf(tall.map((p) => p.ring));
  const deckY = Math.min(345, roof - 30);
  // The face toward +x (east, over 10th Avenue): the outermost wall of the tall parts.
  const x0 = bb.x1, zc = bb.cz;
  const half = Math.min(14, bb.d / 2 - 2), out = 24;
  const tri = [x0 - 1, zc - half, x0 + out, zc, x0 - 1, zc + half];
  mesh(prism(tri, deckY - 2.2, deckY, [1, 1]), solidMat('nyc-edge-deck', 0xc9ccd0, 0.6, 0.2), b);
  // Its glass walls lean outward.
  const top = offsetRing(tri, 1.2);
  const glass = EDGE_GLASS ??= new THREE.MeshStandardMaterial({ color: 0xd9e8e6, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  mesh(loftRings(tri, deckY, top, deckY + 4, [2, 2]), glass, b, true);
  mesh(prism(tri, deckY - 4.2, deckY - 2.2, [1, 1], false), glowMat('nyc-edge-soffit', 0xe6f0ff, 0.05, 1.6), b);
  b.solids.push({ ring: tri, y0: deckY - 2.2, y1: deckY });
  return b;
};

// ------------------------------------------------------------------ Midtown towers on the map's parts

const vanderbilt: Builder = (c) => {
  const b = built();
  partsTower(b, c, 'nycVanderbilt', { crown: 30, fallback: [{ ring: rect(60, 70), y1: 315 }, { ring: rect(40, 50, 6, -6), y1: 397 }], spireMat: floodMat('nyc-vand-spire', 0xe8ecef, 0xffffff, 2.5, 0.3, 0.8) });
  return b;
};

const bofa: Builder = (c) => {
  const b = built();
  partsTower(b, c, 'nycBofa', { crown: 26, fallback: [{ ring: rect(55, 55), y1: 288 }], spireMat: floodMat('nyc-bofa-spire', 0xdfe4e8, 0xf4f8ff, 2.2, 0.3, 0.8) });
  return b;
};

const seagram: Builder = (c) => {
  const b = built();
  partsTower(b, c, 'nycBronze', { fallback: [{ ring: rect(43, 26), y1: 157 }], cornice: solidMat('nyc-bronze-trim', 0x5a4632, 0.4, 0.7) });
  return b;
};

const lever: Builder = (c) => {
  const b = built();
  partsTower(b, c, 'nycLever', { fallback: [{ ring: rect(16, 55), y1: 94 }], cornice: solidMat('nyc-lever-trim', 0xc9d0d0, 0.3, 0.8) });
  return b;
};

// ------------------------------------------------------------------ Hearst Tower

const hearst: Builder = (c) => {
  const b = built();
  const parts = realParts(c);
  const tallest = parts.length ? parts.reduce((a, p) => (p.y1 > a.y1 ? p : a)) : null;
  const bb = tallest ? bboxOf([tallest.ring]) : { w: 49, d: 37, cx: 0, cz: 0 } as ReturnType<typeof bboxOf>;
  // The map's outline is the tower's: keep its size but square it to the grid.
  const W = Math.min(56, Math.max(30, bb.w)), D = Math.min(56, Math.max(26, bb.d)), cx = bb.cx, cz = bb.cz;
  const Y0 = 28, TOP = tallest ? Math.max(150, tallest.y1) : 182, ch = Math.min(W, D) * 0.12;
  const ring = [cx - W / 2 + ch, cz - D / 2, cx + W / 2 - ch, cz - D / 2, cx + W / 2, cz - D / 2 + ch, cx + W / 2, cz + D / 2 - ch, cx + W / 2 - ch, cz + D / 2, cx - W / 2 + ch, cz + D / 2, cx - W / 2, cz + D / 2 - ch, cx - W / 2, cz - D / 2 + ch];
  tier(b, ring, -1.5, TOP, 'nycHearstGlass');
  // The diagrid: four-story triangles on the four main faces, ring beams at every node row.
  const H = 16.4, t = 0.95, beams: THREE.BufferGeometry[] = [];
  const rows = Math.floor((TOP - Y0) / H);
  const facesDef: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [
    { a: [cx - W / 2, cz - D / 2], b: [cx + W / 2, cz - D / 2], n: [0, -1] },
    { a: [cx + W / 2, cz - D / 2], b: [cx + W / 2, cz + D / 2], n: [1, 0] },
    { a: [cx + W / 2, cz + D / 2], b: [cx - W / 2, cz + D / 2], n: [0, 1] },
    { a: [cx - W / 2, cz + D / 2], b: [cx - W / 2, cz - D / 2], n: [-1, 0] },
  ];
  for (const f of facesDef) {
    const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), ux = (f.b[0] - f.a[0]) / L, uz = (f.b[1] - f.a[1]) / L;
    const o = 0.7;
    const P = (s: number, y: number): P3 => [f.a[0] + ux * s + f.n[0] * o, y, f.a[1] + uz * s + f.n[1] * o];
    const n = Math.max(2, Math.round((L - 2 * ch) / 13));
    const step = (L - 2 * ch) / n;
    for (let r = 0; r < rows; r++) {
      const y0 = Y0 + r * H, y1 = y0 + H, shift = r % 2 ? step / 2 : 0;
      for (let k = 0; k <= n; k++) {
        const s0 = ch + k * step - shift;
        for (const dir of [-1, 1]) {
          const s1 = s0 + (dir * step) / 2;
          const a0 = Math.max(ch, Math.min(L - ch, s0)), a1 = Math.max(ch, Math.min(L - ch, s1));
          if (Math.abs(a1 - a0) < 0.5) continue;
          beams.push(beam(P(a0, y0), P(a1, y1), t));
        }
      }
      beams.push(beam(P(ch, y1), P(L - ch, y1), t * 0.8, t * 0.6));
    }
    beams.push(beam(P(ch, Y0), P(L - ch, Y0), t, t));
  }
  // The "bird's mouth" corners: diagonals stepping across each chamfer.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ax = cx + sx * (W / 2 - ch), az = cz + sz * (D / 2), bx = cx + sx * (W / 2), bz = cz + sz * (D / 2 - ch);
    for (let r = 0; r < rows; r++) {
      const y0 = Y0 + r * H;
      beams.push(beam([ax + sx * 0.7, y0, az + sz * 0.7], [bx + sx * 0.7, y0 + H, bz + sz * 0.7], t));
      beams.push(beam([bx + sx * 0.7, y0, bz + sz * 0.7], [ax + sx * 0.7, y0 + H, az + sz * 0.7], t));
    }
  }
  b.group.add(merged(beams, solidMat('nyc-hearst-steel', 0xc3c8cc, 0.45, 0.75)));
  mesh(prism(offsetRing(ring, 0.6), TOP - 0.2, TOP + 1.2, [1, 1]), solidMat('nyc-hearst-steel', 0xc3c8cc, 0.45, 0.75), b);
  return b;
};

// ------------------------------------------------------------------ Guggenheim

const guggenheim: Builder = (c) => {
  const b = built();
  // Frame: -x is Fifth Avenue (west), -z is 89th Street (north) after the 29° grid turn.
  const bb = c.rings.length ? bboxOf(c.rings.map((r) => r.ring)) : { x0: -30, x1: 30, z0: -32, z1: 32 } as ReturnType<typeof bboxOf>;
  const x0 = bb.x0, z0 = bb.z0, z1 = Math.max(bb.z1, bb.z0 + 55);
  const white = solidMat('nyc-gugg-white', 0xefebe1, 0.85, 0);
  const dark = glowMat('nyc-gugg-strip', 0xffe2b0, 0.02, 1.4);
  const rx = x0 + 18, rz = z0 + 19;
  // The rotunda: bands widening upward, each cantilevered over a recessed ribbon of skylight glass.
  const bands: [number, number, number, number][] = [[3.6, 9.4, 12.8, 13.6], [10.2, 15.8, 14.0, 14.9], [16.6, 22.2, 15.2, 16.1], [23.0, 28.4, 16.4, 17.3]];
  mesh(new THREE.CylinderGeometry(12.0, 12.0, 3.6, 40).translate(rx, 1.8, rz), solidMat('nyc-gugg-lobby', 0x39424c, 0.2, 0.3), b);
  let prev = 3.6;
  for (const [y0, y1, r0, r1] of bands) {
    if (y0 > prev) mesh(new THREE.CylinderGeometry(r0 - 0.9, r0 - 0.9, y0 - prev, 40, 1, true).translate(rx, (prev + y0) / 2, rz), dark, b);
    mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 48).translate(rx, (y0 + y1) / 2, rz), white, b);
    prev = y1;
  }
  // The glass oculus dome with its ribs.
  mesh(new THREE.SphereGeometry(10, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.28, 1).translate(rx, 28.4, rz), solidMat('nyc-gugg-dome', 0xc7d6dc, 0.15, 0.4), b);
  const ribs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ribs.push(beam([rx + Math.cos(a) * 9.6, 28.5, rz + Math.sin(a) * 9.6], [rx, 31.2, rz], 0.25)); }
  b.group.add(merged(ribs, white));
  b.solids.push({ ring: ngon(16, 16.5, 0, rx, rz), y0: 0, y1: 28.4 });
  // The small rotunda (the Monitor building) at 88th Street, and the band of the base joining them.
  const sx = x0 + 11, sz = z1 - 12;
  mesh(new THREE.CylinderGeometry(8.2, 7.4, 14.6, 40).translate(sx, 7.3, sz), white, b);
  mesh(new THREE.CylinderGeometry(6.8, 6.8, 1.6, 32, 1, true).translate(sx, 8.2, sz), dark, b);
  b.solids.push({ ring: ngon(12, 8, 0, sx, sz), y0: 0, y1: 14.6 });
  const base = [x0 + 1, rz + 8, x0 + 13, rz + 8, x0 + 13, sz - 3, x0 + 1, sz - 3];
  mesh(prism(base, 0, 3.4, [3, 3]), solidMat('nyc-gugg-lobby', 0x39424c, 0.2, 0.3), b);
  mesh(prism(offsetRing(base, 0.8), 3.4, 7.6, [3, 3]), white, b);
  b.solids.push({ ring: base, y0: 0, y1: 7.6 });
  // The 1992 limestone-grid tower behind: the map's tall parts at the east end of the lot.
  for (const p of c.rings) {
    const m = ringCenter(p.ring);
    if (p.y1 < 30 || m.x < x0 + 30) continue;
    tier(b, p.ring, Math.max(-1.5, p.y0), p.y1, 'nycLimeGrid');
  }
  return b;
};

// ------------------------------------------------------------------ bridges

function latticeMat(key: string, color: number) {
  const cache = latticeMat as unknown as { c?: Map<string, THREE.MeshStandardMaterial> };
  cache.c ??= new Map();
  let m = cache.c.get(key);
  if (m) return m;
  m = facadeMat('lattice').clone();
  m.color.setHex(color);
  cache.c.set(key, m);
  return m;
}

/** A flat lattice web (alpha-tested) along x from xa to xb at z, y0..y1, tiled square. */
function web(xa: number, xb: number, z: number, y0: number, y1: number) {
  const L = xb - xa, H = y1 - y0;
  const g = new THREE.PlaneGeometry(L, H).translate((xa + xb) / 2, (y0 + y1) / 2, z);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L / H), uv.getY(i));
  return g;
}

interface CableSpec { half: number; side: number; top: number; deck: number; sag: number; zs: number[]; sideHung: boolean; step: number }

/** Main cables over both towers to the anchorages, and the suspenders. */
function cables(b: Built, s: CableSpec, color: number) {
  const y = (x: number) => {
    const ax = Math.abs(x);
    if (ax <= s.half) return s.sag + (s.top - s.sag) * (ax / s.half) ** 2;
    const t = (ax - s.half) / s.side;
    return s.top + (s.deck + 1 - s.top) * (s.sideHung ? t * (2 - t * 0.8) / 1.2 : t);
  };
  const tubes: THREE.BufferGeometry[] = [];
  for (const z of s.zs) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) { const x = -s.half - s.side + ((2 * (s.half + s.side)) * i) / 96; pts.push(new THREE.Vector3(x, y(x), z)); }
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 192, 0.5, 6, false));
  }
  b.group.add(merged(tubes, solidMat(`nyc-cable-${color}`, color, 0.55, 0.5)));
  const lines: number[] = [];
  const lim = s.sideHung ? s.half + s.side - 6 : s.half - 3;
  for (const z of s.zs) for (let x = -lim; x <= lim; x += s.step) { const cy = y(x); if (cy - s.deck > 1.2) lines.push(x, s.deck, z, x, cy, z); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  b.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.8) })));
}

/**
 * Manhattan Bridge (1909): slim steel towers of four columns joined by an arched portal and crowned
 * with ornamental caps, four cables, deep stiffening trusses. Painted a pale blue-grey.
 */
const manhattanBridge: Builder = (c) => {
  const b = built();
  const span = c.span ?? 448, half = span / 2, side = 221, T = 102, deck = 41, W = 36.6;
  const steel = solidMat('nyc-mb-steel', 0x9fb2c0, 0.6, 0.35);
  const pier = solidMat('nyc-mb-pier', 0xb4ab9b, 0.9, 0);
  const cols = [-17, -7, 7, 17];
  for (const sx of [-1, 1]) {
    const x = sx * half;
    tier(b, rect(22, 44, x, 0), -10, 7, 'beaux', { mat: pier });
    const parts: THREE.BufferGeometry[] = [];
    for (const z of cols) {
      const outer = Math.abs(z) > 10;
      parts.push(frustum(outer ? 9 : 7, 4.2, outer ? 5.2 : 4.4, 3.4, 7, T - 4, x, z));
      // Ornamental cap: a cornice block and a small pyramid with a finial ball.
      parts.push(new THREE.BoxGeometry(6.4, 2.2, 4.6).translate(x, T - 2.9, z));
      parts.push(new THREE.ConeGeometry(2.6, 4.2, 4, 1).rotateY(Math.PI / 4).translate(x, T + 0.3, z));
      parts.push(new THREE.SphereGeometry(0.75, 8, 6).translate(x, T + 2.8, z));
      b.solids.push({ ring: rect(8, 4.6, x, z), y0: -10, y1: T });
    }
    // The arched top portal across all four columns.
    const sh = new THREE.Shape();
    sh.moveTo(-19, 0); sh.lineTo(19, 0); sh.lineTo(19, 14); sh.lineTo(-19, 14); sh.closePath();
    for (const [a, w] of [[-12, 8.5], [0, 11], [12, 8.5]] as [number, number][]) {
      const hole = new THREE.Path();
      hole.moveTo(a - w / 2, 1.5); hole.lineTo(a + w / 2, 1.5); hole.lineTo(a + w / 2, 6); hole.absarc(a, 6, w / 2, 0, Math.PI, false); hole.lineTo(a - w / 2, 1.5);
      sh.holes.push(hole);
    }
    parts.push(new THREE.ExtrudeGeometry(sh, { depth: 3.2, bevelEnabled: false }).translate(0, 0, -1.6).rotateY(Math.PI / 2).translate(x, T - 18, 0));
    // Below the deck: a cross girder and X-bracing between the outer columns.
    parts.push(new THREE.BoxGeometry(4.4, 3, W + 2).translate(x, deck - 9.5, 0));
    for (const zs of [[-17, -7], [7, 17], [-7, 7]]) {
      parts.push(beam([x, 9, zs[0]], [x, deck - 11, zs[1]], 1.2), beam([x, 9, zs[1]], [x, deck - 11, zs[0]], 1.2));
    }
    // Above the deck: two light struts.
    for (const yy of [deck + 22, deck + 40]) parts.push(new THREE.BoxGeometry(2.6, 2.2, 36).translate(x, yy, 0));
    b.group.add(merged(parts, steel));
  }
  // Stiffening trusses along the deck edges and between the roadway and the tracks.
  const latt = latticeMat('nyc-mb-latt', 0x8fa2b0);
  const webs: THREE.BufferGeometry[] = [];
  for (const z of [-W / 2, -7, 7, W / 2]) webs.push(web(-half - side, half + side, z, deck - 8, deck));
  b.group.add(merged(webs, latt));
  const chords: THREE.BufferGeometry[] = [];
  for (const z of [-W / 2, -7, 7, W / 2]) for (const yy of [deck - 8, deck]) chords.push(new THREE.BoxGeometry(span + side * 2, 0.7, 0.8).translate(0, yy, z));
  b.group.add(merged(chords, steel));
  cables(b, { half, side, top: T - 3, deck, sag: deck + 4.5, zs: cols, sideHung: true, step: 6 }, 0x8d9ea9);
  return b;
};

/**
 * Williamsburg Bridge (1903): two all-steel braced lattice towers, four cables, a 12 m deep lattice
 * stiffening truss; the side spans sit on truss towers, so their cables carry nothing.
 */
const williamsburgBridge: Builder = (c) => {
  const b = built();
  const span = c.span ?? 488, half = span / 2, side = 182, T = 102, deck = 47, W = 36;
  const steel = solidMat('nyc-wb-steel', 0x6f6f72, 0.65, 0.35);
  const latt = latticeMat('nyc-wb-latt', 0x77777a);
  const legZ = [-(W / 2 + 1), W / 2 + 1];
  for (const sx of [-1, 1]) {
    const x = sx * half;
    tier(b, rect(26, 50, x, 0), -10, 6, 'beaux', { mat: solidMat('nyc-wb-pier', 0xa9a297, 0.9, 0) });
    const posts: THREE.BufferGeometry[] = [], webs: THREE.BufferGeometry[] = [];
    for (const z of legZ) {
      // Each leg: four corner posts leaning in, lattice webs between them.
      const w0 = 14, w1 = 6, d0 = 7, d1 = 4.6;
      for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) posts.push(beam([x + ax * w0 / 2, 6, z + az * d0 / 2], [x + ax * w1 / 2, T, z + az * d1 / 2], 1.1));
      webs.push(loftRings(rect(w0, d0, x, z), 6, rect(w1, d1, x, z), T, [7, 7]));
      posts.push(new THREE.BoxGeometry(w1 + 1.6, 3, d1 + 1.6).translate(x, T + 1.5, z));
      b.solids.push({ ring: rect(10, 6, x, z), y0: -10, y1: T });
    }
    // Lattice girders across the top and below the deck.
    for (const [y0, y1] of [[T - 12, T - 2], [deck - 16, deck - 11]]) {
      webs.push(web(-(W / 2 + 1), W / 2 + 1, 0, y0, y1).rotateY(Math.PI / 2).translate(x, 0, 0));
      posts.push(new THREE.BoxGeometry(1.4, 1, W + 4).translate(x, y0, 0), new THREE.BoxGeometry(1.4, 1, W + 4).translate(x, y1, 0));
    }
    b.group.add(merged(posts, steel));
    b.group.add(merged(webs, latt));
  }
  // The deep main truss along both edges and down the middle.
  const webs: THREE.BufferGeometry[] = [], chords: THREE.BufferGeometry[] = [];
  for (const z of [-W / 2, -6, 6, W / 2]) {
    webs.push(web(-half - side, half + side, z, deck - 12, deck));
    for (const yy of [deck - 12, deck]) chords.push(new THREE.BoxGeometry(span + side * 2, 0.9, 0.9).translate(0, yy, z));
  }
  b.group.add(merged(webs, latt));
  b.group.add(merged(chords, steel));
  // Truss towers under the side spans.
  for (const sx of [-1, 1]) for (const f of [0.5]) {
    const x = sx * (half + side * f);
    const p: THREE.BufferGeometry[] = [];
    for (const z of [-W / 2, W / 2]) p.push(frustum(8, 5, 5, 4, -2, deck - 12, x, z));
    b.group.add(merged(p, steel));
  }
  cables(b, { half, side, top: T - 1, deck, sag: deck + 3, zs: [-(W / 2 + 2.2), -(W / 2 - 0.2), W / 2 - 0.2, W / 2 + 2.2], sideHung: false, step: 7 }, 0x7c7c80);
  return b;
};

// ------------------------------------------------------------------ 56 Leonard ("the Jenga building")

const leonard56: Builder = () => {
  const b = built();
  // 57 floors, 250 m. A plain shaft for the lower floors; above, each floor (or pair) slides out on its own
  // cantilever, the stack tapering irregularly toward the top. Deterministic, so it always looks the same.
  const floors = 57, fh = 250 / floors, geos: THREE.BufferGeometry[] = [];
  const st = STYLES.nycLeonard;
  let k = 0;
  for (let i = 0; i < floors;) {
    const n = i < 10 ? 10 : 1 + Math.floor(rand(i * 3.7) * 2.2);
    const y0 = i * fh, y1 = Math.min(floors, i + n) * fh;
    const up = i / floors;
    let w = 30, d = 36, cx = 0, cz = 0;
    if (i >= 10) {
      // Gentle jogs up the shaft; the stack really comes apart in the top third.
      const wild = up < 0.6 ? 0.25 : 0.25 + (up - 0.6) * 2.2;
      const shrink = up > 0.82 ? (up - 0.82) * 50 : 0;
      w = 30 + (rand(k * 5.1) - 0.3) * 12 * wild - shrink; d = 36 + (rand(k * 7.3) - 0.3) * 12 * wild - shrink * 1.1;
      cx = (rand(k * 2.9) - 0.5) * 16 * wild; cz = (rand(k * 4.3) - 0.5) * 16 * wild;
    }
    geos.push(prism(rect(Math.max(10, w), Math.max(12, d), cx, cz), y0, y1, st.tile, true));
    i += n; k++;
  }
  b.group.add(merged(geos, facadeMat('nycLeonard')));
  b.solids.push({ ring: rect(32, 38), y0: 0, y1: 250 });
  return b;
};

// ------------------------------------------------------------------ the Oculus

const oculus: Builder = () => {
  const b = built();
  const white = solidMat('nyc-oculus-white', 0xf4f4f1, 0.45, 0.15);
  const L = 53; // half length along x (the long axis, east-west on the grid)
  // The enclosed hall: an elongated oval of glass between the rib rows, with a white base.
  const oval = ngon(28, 1, 0).map((v, i) => (i % 2 ? v * 16 : v * L * 0.96));
  mesh(prism(oval, 0, 3.2, [3, 3]), white, b);
  mesh(prism(offsetRing(oval, -0.6), 3.2, 15, [3, 3]), solidMat('nyc-oculus-glass', 0x9fb4c2, 0.08, 0.6), b);
  b.solids.push({ ring: oval, y0: 0, y1: 15 });
  // The skylit roof: a low vault along the spine.
  const vault = new THREE.CylinderGeometry(15, 15, L * 1.7, 24, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 15, 0);
  mesh(vault, solidMat('nyc-oculus-roof', 0xdfe6ea, 0.2, 0.3), b);
  mesh(new THREE.BoxGeometry(L * 1.5, 0.6, 2.2).translate(0, 23.6, 0), glowMat('nyc-oculus-sky', 0xeaf4ff, 0.15, 1.8), b);
  // The ribs: two rows splaying up and out like wings, tallest at the middle (~50 m), shorter to the ends.
  const ribs: THREE.BufferGeometry[] = [];
  for (let x = -L; x <= L + 0.01; x += 3.1) {
    const f = 1 - (x / (L + 6)) ** 2;
    const H = 18 + 32 * f, out = 6 + 20 * f;
    for (const s of [-1, 1]) {
      const z0 = s * 16 * Math.sqrt(Math.max(0.05, 1 - (x / (L + 2)) ** 2));
      const mid: P3 = [x * 1.02, 14, z0 + s * out * 0.18];
      ribs.push(beam([x, 0, z0], mid, 1.1, 1.6), beam(mid, [x * 1.08, H, z0 + s * out], 0.9, 1.3));
      // Over the roof to the spine.
      ribs.push(beam(mid, [x, 23.4, s * 1.2], 0.7, 1.0));
    }
  }
  b.group.add(merged(ribs, white));
  return b;
};

/**
 * Queensboro (59th Street) Bridge (1909): a cantilever truss on four masonry piers (West Channel span
 * 360 m, Blackwell's Island span 192 m, East Channel span 300 m, anchor arms ~140 m), its top chords
 * climbing to steel towers with pointed finials over each pier. The map's piers (plain ~110 m boxes)
 * give the pier positions.
 */
const queensboroBridge: Builder = (c) => {
  const b = built();
  const deck = 41, W = 27;
  // Pier positions along x: the claimed parts' centers, completed with the real spans where the map lacks one.
  const spans = [360, 192, 300];
  let xs = c.rings.map((r) => ringCenter(r.ring).x).sort((a, b2) => a - b2);
  const merged0: number[] = [];
  for (const x of xs) if (!merged0.length || x - merged0[merged0.length - 1] > 40) merged0.push(x); else merged0[merged0.length - 1] = (merged0[merged0.length - 1] + x) / 2;
  xs = merged0;
  if (xs.length === 3) {
    // Which three? The 192 m gap is the island span; the missing pier is the Manhattan one (360 m west) or the Queens one.
    const g0 = xs[1] - xs[0], g1 = xs[2] - xs[1];
    if (Math.abs(g0 - 192) < Math.abs(g1 - 192)) xs = [xs[0] - 360, ...xs]; else xs = [...xs, xs[2] + 300];
  }
  if (xs.length !== 4) xs = [-441, -81, 111, 411];
  const ends = [xs[0] - 143, xs[3] + 140];
  void spans;
  const steel = solidMat('nyc-qb-steel', 0x8b8780, 0.7, 0.3);
  const latt = latticeMat('nyc-qb-latt', 0x87837c);
  const stone = solidMat('nyc-qb-pier', 0xb9b0a0, 0.9, 0);
  // Top chord height above the deck along x: tall over the piers, sagging to ~12 m mid-span, down to the deck at the ends.
  const top = (x: number) => {
    if (x <= xs[0]) return 6 + 54 * Math.max(0, (x - ends[0]) / (xs[0] - ends[0])) ** 1.6;
    if (x >= xs[3]) return 6 + 54 * Math.max(0, (ends[1] - x) / (ends[1] - xs[3])) ** 1.6;
    for (let i = 0; i < 3; i++) if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]), m = Math.abs(t - 0.5) * 2;
      return 12 + 48 * m ** 2.2;
    }
    return 12;
  };
  const N = 160, webs: THREE.BufferGeometry[] = [], chords: THREE.BufferGeometry[] = [];
  for (const z of [-W / 2, W / 2]) {
    const pos: number[] = [], uv: number[] = [];
    let prevX = ends[0], prevY = deck + top(ends[0]);
    for (let i = 1; i <= N; i++) {
      const x = ends[0] + ((ends[1] - ends[0]) * i) / N, y = deck + top(x);
      pos.push(prevX, deck, z, x, deck, z, x, y, z, prevX, deck, z, x, y, z, prevX, prevY, z);
      uv.push(prevX / 9, 0, x / 9, 0, x / 9, (y - deck) / 9, prevX / 9, 0, x / 9, (y - deck) / 9, prevX / 9, (prevY - deck) / 9);
      chords.push(beam([prevX, prevY, z], [x, y, z], 1.3), beam([prevX, deck, z], [x, deck, z], 1.5));
      prevX = x; prevY = y;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    webs.push(g);
  }
  // Floor beams and top struts tying the two trusses.
  for (let x = ends[0]; x <= ends[1]; x += 18) {
    chords.push(new THREE.BoxGeometry(0.8, 1.2, W).translate(x, deck - 0.6, 0));
    if (top(x) > 14) chords.push(new THREE.BoxGeometry(0.7, 0.7, W).translate(x, deck + top(x) - 1, 0));
  }
  // Over each pier: twin steel towers with pointed caps and finials, on granite piers down to the water.
  for (const x of xs) {
    tier(b, rect(26, W + 12, x, 0), -8, deck - 2, 'beaux', { mat: stone });
    for (const z of [-W / 2, W / 2]) {
      chords.push(frustum(9, 6, 6, 4.5, deck, deck + 62, x, z));
      chords.push(new THREE.ConeGeometry(4.4, 9, 4, 1).rotateY(Math.PI / 4).translate(x, deck + 66.5, z));
      chords.push(new THREE.CylinderGeometry(0.25, 0.5, 6, 6).translate(x, deck + 74, z), new THREE.SphereGeometry(0.9, 8, 6).translate(x, deck + 71, z));
      b.solids.push({ ring: rect(9, 6, x, z), y0: -8, y1: deck + 62 });
    }
    chords.push(new THREE.BoxGeometry(5, 3, W).translate(x, deck + 58, 0));
  }
  b.group.add(merged(webs, latt));
  b.group.add(merged(chords, steel));
  return b;
};

export const NYC_BUILDERS: Record<string, Builder> = {
  citigroup, hy30, vanderbilt, bofa, seagram, lever, hearst, guggenheim, manhattanBridge, williamsburgBridge, leonard56, oculus, queensboroBridge,
};
