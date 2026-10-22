// Shared pieces for the European and Middle Eastern landmarks (eu-*.ts): lofts and lathes in the
// landmark model frame (y up, x east, z south), painted stone and glass textures, and a few
// architectural parts every one of them needs (colonnades, domes on drums, minarets, pyramids).
import * as THREE from 'three';
import { area, merged, nightMats, ngon, solidMat, STYLES, type Built } from './kit.ts';

export const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Add a mesh (casting and receiving shadows); `detail` ones only show up close. */
export function add(b: Built, g: THREE.BufferGeometry, m: THREE.Material, detail = false) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true; x.receiveShadow = true;
  b.group.add(x);
  if (detail) b.detail.push(x);
  return x;
}

/** Many small pieces in one material, merged into a single mesh. */
export function addMerged(b: Built, geos: THREE.BufferGeometry[], m: THREE.Material, detail = false) {
  if (!geos.length) return null;
  const x = merged(geos, m);
  b.group.add(x);
  if (detail) b.detail.push(x);
  return x;
}

/** Walls between successive rings (same vertex count), UV'd in meters of `tile`, optionally capped. */
export function loft(levels: { ring: number[]; y: number }[], tile: [number, number] = [4, 4], cap = true): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = levels[0].ring.length / 2;
  for (let L = 0; L + 1 < levels.length; L++) {
    const A = levels[L], B = levels[L + 1];
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0x = A.ring[i * 2], a0z = A.ring[i * 2 + 1], a1x = A.ring[j * 2], a1z = A.ring[j * 2 + 1];
      const b0x = B.ring[i * 2], b0z = B.ring[i * 2 + 1], b1x = B.ring[j * 2], b1z = B.ring[j * 2 + 1];
      const len = Math.hypot(a1x - a0x, a1z - a0z), lenB = Math.hypot(b1x - b0x, b1z - b0z), mid = (len - lenB) / 2;
      const b = pos.length / 3;
      pos.push(a0x, A.y, a0z, a1x, A.y, a1z, b1x, B.y, b1z, b0x, B.y, b0z);
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
    for (const p of pts) { pos.push(p.x, top.y, p.y); uv.push(p.x / 8, p.y / 8); }
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

/** A solid of revolution about the y axis from [radius, y] pairs (bottom to top), at (x, z). */
export function lathe(profile: [number, number][], segs = 32, x = 0, z = 0, phi = 0) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  return new THREE.LatheGeometry(pts, segs, phi).translate(x, 0, z);
}

/** A dome profile: from radius r at y0 up to the crown at y0 + h (h > r gives a pointed, taller dome). */
export function domeProfile(r: number, y0: number, h: number, n = 12, onion = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI / 2;
    // An onion bulges out past the drum before it narrows.
    const bulge = onion * Math.sin(t * 2) * r;
    out.push([Math.cos(t) * r + bulge, y0 + Math.sin(t) * h]);
  }
  return out;
}

/** Cylinder between two points (for struts, hangers, spokes, legs). */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/** A ring of columns (radius R, n columns of radius cr) from y0 to y1, around (x, z). */
export function colonnade(R: number, n: number, cr: number, y0: number, y1: number, x = 0, z = 0, a0 = 0) {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push(new THREE.CylinderGeometry(cr * 0.88, cr, y1 - y0, 10).translate(x + Math.cos(a) * R, (y0 + y1) / 2, z + Math.sin(a) * R));
  }
  return out;
}

/** A straight row of columns from (x0, z0) to (x1, z1). */
export function columnRow(x0: number, z0: number, x1: number, z1: number, n: number, cr: number, y0: number, y1: number) {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push(new THREE.CylinderGeometry(cr * 0.88, cr, y1 - y0, 10).translate(x0 + (x1 - x0) * t, (y0 + y1) / 2, z0 + (z1 - z0) * t));
  }
  return out;
}

/** A triangular pediment facing +z (or rotated by ry), w wide, h tall, d deep, its base centered at (x, y, z). */
export function pediment(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2).rotateY(ry).translate(x, y, z);
}

/** A cross on a ball (church finials). */
export function crossOnBall(x: number, y: number, z: number, s = 1) {
  return [
    new THREE.SphereGeometry(0.9 * s, 12, 8).translate(x, y + 0.9 * s, z),
    new THREE.BoxGeometry(0.35 * s, 3.2 * s, 0.35 * s).translate(x, y + 3.2 * s, z),
    new THREE.BoxGeometry(1.7 * s, 0.35 * s, 0.35 * s).translate(x, y + 3.8 * s, z),
  ];
}

/** A slender minaret: shaft, balconies (şerefe), a pencil cap of lead and a gilt finial. */
export function minaret(b: Built, x: number, z: number, h: number, r: number, balconies: number, stone: THREE.Material, lead: THREE.Material, gilt: THREE.Material, sides = 12) {
  const capH = h * 0.17, shaftTop = h - capH;
  add(b, new THREE.CylinderGeometry(r * 0.92, r * 1.25, shaftTop, sides).translate(x, shaftTop / 2, z), stone);
  add(b, new THREE.CylinderGeometry(r * 1.45, r * 1.45, 3.2, sides).translate(x, 1.6, z), stone);
  const balc: THREE.BufferGeometry[] = [];
  for (let k = 0; k < balconies; k++) {
    const y = shaftTop * (0.55 + (0.4 * k) / Math.max(1, balconies - 0.5));
    balc.push(new THREE.CylinderGeometry(r * 1.7, r * 1.05, 1.4, sides).translate(x, y - 0.7, z));
    balc.push(new THREE.CylinderGeometry(r * 1.72, r * 1.72, 0.9, sides, 1, true).translate(x, y + 0.45, z));
  }
  addMerged(b, balc, stone);
  add(b, new THREE.ConeGeometry(r * 1.02, capH, sides).translate(x, shaftTop + capH / 2, z), lead);
  add(b, new THREE.CylinderGeometry(0.08, 0.12, 3, 6).translate(x, h + 1.5, z), gilt, true);
  b.solids.push({ ring: ngon(8, r * 1.2, 0, x, z), y0: 0, y1: shaftTop });
}

/** A dome on a drum: drum radius rd from y0 to y1 (windows painted by `drumMat`), dome rising h above it. */
export function domeOnDrum(b: Built, x: number, z: number, rd: number, y0: number, y1: number, h: number, drumMat: THREE.Material, domeMat: THREE.Material, segs = 32, onion = 0) {
  add(b, new THREE.CylinderGeometry(rd, rd, y1 - y0, segs, 1, true).translate(x, (y0 + y1) / 2, z), drumMat);
  add(b, lathe(domeProfile(rd * 1.02, y1, h, 12, onion), segs, x, z), domeMat);
  b.solids.push({ ring: ngon(12, rd, 0, x, z), y0, y1: y1 + h * 0.7 });
}

/** A rectangular ring (corner-first) of a w × d box centered at (x, z). */
export function box(w: number, d: number, x = 0, z = 0) {
  return [x - w / 2, z - d / 2, x + w / 2, z - d / 2, x + w / 2, z + d / 2, x - w / 2, z + d / 2];
}

// ------------------------------------------------------------------ materials

const cache = new Map<string, THREE.Material>();

/** A material with a painted, tiling canvas (meters per tile set by the geometry's UVs). */
export function paintedMat(key: string, px: [number, number], paint: (g: CanvasRenderingContext2D, W: number, H: number) => void, opts: { rough?: number; metal?: number; side?: THREE.Side; alphaTest?: number; repeat?: [number, number]; emissive?: number; night?: number } = {}) {
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  const c = document.createElement('canvas');
  [c.width, c.height] = px;
  paint(c.getContext('2d')!, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  m = new THREE.MeshStandardMaterial({ map: t, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, side: opts.side ?? THREE.FrontSide, alphaTest: opts.alphaTest ?? 0 });
  if (opts.emissive !== undefined) {
    m.emissive.setHex(opts.emissive); m.emissiveMap = t; m.emissiveIntensity = 0;
    m.userData.glow = opts.night ?? 1; m.userData.day = 0;
    nightMats.push(m);
  }
  cache.set(key, m);
  return m;
}

export const mat = (key: string, color: number, rough = 0.8, metal = 0) => solidMat(`eu-${key}`, color, rough, metal);
export const GILT = () => solidMat('eu-gilt', 0xd4a843, 0.3, 0.95);
export const LEAD = () => solidMat('eu-lead', 0x7c8489, 0.55, 0.35);

/** Glass that is mostly reflection (capsules, the Louvre's cousins), see-through. */
export function glassMat(key: string, color: number, opacity = 0.35) {
  let m = cache.get(`glass-${key}`) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.2, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });
  cache.set(`glass-${key}`, m);
  return m;
}

// ------------------------------------------------------------------ landmark facade styles (kit STYLES)

/** Pointed-arch window (lancet) into the canvas. */
function lancet(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w * 0.7); g.quadraticCurveTo(x, y, x + w / 2, y - w * 0.15); g.quadraticCurveTo(x + w, y, x + w, y + w * 0.7); g.lineTo(x + w, y + h); g.closePath(); g.fill();
}
function roundArch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
}

let stylesAdded = false;
/** The European landmarks' facade textures, added to kit's table (so `tier` and `facadeMat` know them). */
export function euStyles() {
  if (stylesAdded) return;
  stylesAdded = true;
  // Perpendicular Gothic in honey Anston limestone (the Palace of Westminster, the Elizabeth Tower):
  // tall traceried panels between buttress strips, two lancets a bay.
  STYLES.anston = {
    tile: [3.2, 7.2], px: [96, 224], rough: 0.85, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#c6aa72'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#d2b884'; g.fillRect(0, 0, W * 0.1, H); g.fillRect(W * 0.9, 0, W * 0.1, H);
        g.fillStyle = 'rgba(110,90,55,0.25)'; g.fillRect(W * 0.1, 0, 2, H); g.fillRect(W * 0.9 - 2, 0, 2, H);
        g.fillStyle = '#b59a64'; g.fillRect(0, H * 0.02, W, H * 0.03); g.fillRect(0, H * 0.52, W, H * 0.03);
        // Blind tracery panels above and below the lancets.
        g.strokeStyle = 'rgba(120,98,60,0.45)'; g.lineWidth = 1.5;
        for (const x of [0.2, 0.5, 0.8]) { g.beginPath(); g.moveTo(W * x, H * 0.06); g.lineTo(W * x, H * 0.5); g.stroke(); }
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      g.fillStyle = lit ? 'rgba(255,205,140,0.85)' : '#3a3d48';
      lancet(g, W * 0.2, H * 0.62, W * 0.24, H * 0.3);
      lancet(g, W * 0.56, H * 0.62, W * 0.24, H * 0.3);
      g.fillStyle = lit ? 'rgba(255,205,140,0.6)' : '#454852';
      lancet(g, W * 0.24, H * 0.14, W * 0.18, H * 0.32);
      lancet(g, W * 0.58, H * 0.14, W * 0.18, H * 0.32);
    },
  };
  // Portland stone, London's classical white: rusticated courses, tall windows with cornices.
  STYLES.portland = {
    tile: [4.2, 5.2], px: [128, 160], rough: 0.85, metal: 0, glow: 0xffd9a0,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#e4ded0'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,110,95,0.18)'; for (let y = 0; y < H; y += 13) g.fillRect(0, y, W, 1);
        for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(90,85,75,${0.04 + rand(k) * 0.05})`; g.fillRect(rand(k + 2) * W, 0, 4 + rand(k + 5) * 8, H); }
        g.fillStyle = '#d4cdbd'; g.fillRect(W * 0.25, H * 0.12, W * 0.5, H * 0.05);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      g.fillStyle = lit ? 'rgba(255,215,160,0.85)' : '#323844';
      g.fillRect(W * 0.3, H * 0.2, W * 0.4, H * 0.62);
      if (!lit) { g.strokeStyle = '#f2eee4'; g.lineWidth = 3; g.strokeRect(W * 0.3, H * 0.2, W * 0.4, H * 0.62); g.beginPath(); g.moveTo(W * 0.3, H * 0.51); g.lineTo(W * 0.7, H * 0.51); g.moveTo(W * 0.5, H * 0.2); g.lineTo(W * 0.5, H * 0.82); g.lineWidth = 1.5; g.stroke(); }
    },
  };
  // Tower Bridge: Cornish granite and Portland stone over steel, gothic windows in pairs.
  STYLES.tbStone = {
    tile: [5, 7], px: [128, 176], rough: 0.85, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#d7d0c0'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(110,100,85,0.2)'; for (let y = 0; y < H; y += 9) g.fillRect(0, y, W, 1);
        g.fillStyle = '#c9c1af'; g.fillRect(0, H * 0.9, W, H * 0.04);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      g.fillStyle = lit ? 'rgba(255,210,150,0.8)' : '#34394a';
      lancet(g, W * 0.3, H * 0.35, W * 0.16, H * 0.45);
      lancet(g, W * 0.54, H * 0.35, W * 0.16, H * 0.45);
    },
  };
  // Norman stone (the White Tower): pale ashlar, small round-headed windows, pilaster strips.
  STYLES.norman = {
    tile: [7, 8], px: [128, 148], rough: 0.95, metal: 0, glow: 0xffc27a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#e2dccd'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,110,90,0.16)'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
        for (let k = 0; k < 8; k++) { g.fillStyle = `rgba(110,100,80,${0.05 + rand(k + 40) * 0.08})`; g.fillRect(rand(k) * W, rand(k + 9) * H, 6 + rand(k + 4) * 14, 4 + rand(k + 7) * 8); }
        g.fillStyle = '#d6cfbe'; g.fillRect(0, 0, W * 0.08, H);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      g.fillStyle = lit ? 'rgba(255,200,130,0.8)' : '#2e2f34';
      roundArch(g, W * 0.42, H * 0.38, W * 0.16, H * 0.3);
    },
  };
  // Pale travertine with tall round-arched windows (Sacré-Cœur, St Peter's drum, the Panthéon's attic).
  STYLES.travArch = {
    tile: [4.5, 9], px: [96, 192], rough: 0.85, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#efebe2'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,110,95,0.14)'; for (let y = 0; y < H; y += 10) g.fillRect(0, y, W, 1);
        g.fillStyle = '#e2ddd1'; g.fillRect(0, 0, W * 0.14, H); g.fillRect(W * 0.86, 0, W * 0.14, H);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      g.fillStyle = lit ? 'rgba(255,205,140,0.85)' : '#3d4049';
      roundArch(g, W * 0.32, H * 0.25, W * 0.36, H * 0.55);
    },
  };
  // A blank ashlar wall (the Panthéon in Paris had its windows walled up).
  STYLES.ashlar = {
    tile: [6, 6], px: [128, 128], rough: 0.9, metal: 0,
    paint(g, W, H) {
      g.fillStyle = '#e1d9c6'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(120,105,80,0.2)';
      for (let y = 0; y < H; y += 16) { g.fillRect(0, y, W, 1); for (let x = (y / 16) % 2 ? 0 : 32; x < W; x += 64) g.fillRect(x, y, 1, 16); }
    },
  };
}
