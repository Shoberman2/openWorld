// Building blocks for the hand-built landmarks: painted facade textures (one canvas per style, tiled
// in meters), extruded tiers with meter UVs, and materials whose windows light up at night.
import * as THREE from 'three';

/** A solid piece of a landmark for collisions: model-local footprint ring (x,z pairs) from y0 to y1. */
export interface Solid { ring: number[]; y0: number; y1: number }

export interface Built {
  group: THREE.Group;
  solids: Solid[];
  /** Children only worth drawing up close (statues, lions, trim). */
  detail: THREE.Object3D[];
}

export function built(): Built {
  return { group: new THREE.Group(), solids: [], detail: [] };
}

// ------------------------------------------------------------------ facade textures

type Painter = (g: CanvasRenderingContext2D, W: number, H: number, lit: boolean) => void;
export interface FacadeStyle {
  /** Meters one texture tile covers (across, up). */
  tile: [number, number];
  px: [number, number];
  paint: Painter;
  rough: number;
  metal: number;
  /** Night window glow color. */
  glow?: number;
}

const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Rows of windows in a grid: piers `pw` wide, spandrels `sh` tall (fractions of a cell). */
function windows(g: CanvasRenderingContext2D, W: number, H: number, cols: number, rows: number, pw: number, sh: number, glass: string, lit: boolean, litShare = 0.35, frame?: string) {
  const cw = W / cols, ch = H / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw + cw * pw / 2, y = r * ch + ch * sh, w = cw * (1 - pw), h = ch * (1 - sh);
    if (lit) {
      const on = rand(r * 31 + c * 7) < litShare;
      g.fillStyle = on ? `hsl(${36 + rand(r + c * 3) * 14}, 90%, ${55 + rand(c + r * 5) * 20}%)` : '#000';
    } else {
      g.fillStyle = glass;
    }
    g.fillRect(x, y, w, h);
    if (!lit) {
      // A little sky in the top of each pane, and the frame.
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, 'rgba(190,210,235,0.35)'); grd.addColorStop(0.5, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      if (frame) { g.strokeStyle = frame; g.lineWidth = Math.max(1, cw * 0.04); g.strokeRect(x, y, w, h); }
    }
  }
}

export const STYLES: Record<string, FacadeStyle> = {
  // Empire State: Indiana limestone piers, aluminum spandrels, recessed window strips.
  limestonePier: {
    tile: [4.6, 3.8], px: [128, 128], rough: 0.8, metal: 0.05, glow: 0xffd9a0,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#d9d1c3'; g.fillRect(0, 0, W, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      const x = W * 0.3, w = W * 0.4;
      if (!lit) { g.fillStyle = '#8f9399'; g.fillRect(x, 0, w, H); } // aluminum spandrel strip
      windows(g, W, H, 1, 1, 0.6, 0.28, '#3b4656', lit, 0.4);
      if (!lit) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x - 3, 0, 3, H); g.fillRect(x + w, 0, 3, H); }
    },
  },
  // Chrysler: white brick with dark grey bands under the windows.
  whiteBrick: {
    tile: [3.4, 3.7], px: [128, 128], rough: 0.85, metal: 0, glow: 0xffd9a0,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#e6e2da'; g.fillRect(0, 0, W, H); g.fillStyle = '#5f6266'; g.fillRect(0, H * 0.72, W, H * 0.12); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.42, 0.3, '#334050', lit, 0.4);
    },
  },
  // One WTC: prismatic glass with fine mullions.
  blueGlass: {
    tile: [3.0, 4.1], px: [64, 128], rough: 0.08, metal: 0.9, glow: 0xdfe8ff,
    paint(g, W, H, lit) {
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); if (rand(W) > 0) { g.fillStyle = 'rgba(210,225,255,0.28)'; g.fillRect(2, 2, W - 4, H * 0.7); } return; }
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#8fb2d6'); grd.addColorStop(1, '#5e7fa6');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#c8d3dd'; g.fillRect(0, 0, 3, H); g.fillRect(0, H * 0.78, W, 4);
    },
  },
  // 432 Park: white concrete frame, huge square windows.
  concreteGrid: {
    tile: [5.3, 4.7], px: [128, 128], rough: 0.7, metal: 0, glow: 0xfff0d8,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#ece9e2'; g.fillRect(0, 0, W, H); } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.22, 0.22, '#3d4a59', lit, 0.25);
    },
  },
  // 111 W 57th: terra-cotta and bronze piers in a fine vertical rhythm.
  terracotta: {
    tile: [2.2, 4.2], px: [64, 128], rough: 0.6, metal: 0.3, glow: 0xffe1b0,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#cdb9a0'; g.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 6) { g.fillStyle = y % 12 ? '#bea78c' : '#d9c7af'; g.fillRect(0, y, W * 0.3, 4); }
        g.fillStyle = '#7c5f3e'; g.fillRect(W * 0.3, 0, 3, H);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.46, 0.18, '#3a4552', lit, 0.3);
    },
  },
  // Woolworth: cream terra-cotta with gothic piers.
  gothic: {
    tile: [3.2, 3.9], px: [64, 128], rough: 0.75, metal: 0, glow: 0xffd9a0,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#e8dfcc'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#d3c8b1'; g.fillRect(0, 0, W * 0.16, H); g.fillRect(W * 0.84, 0, W * 0.16, H);
        g.fillStyle = '#b9a98a'; g.fillRect(W * 0.2, H * 0.74, W * 0.6, H * 0.1);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.42, 0.3, '#3a4352', lit, 0.4);
    },
  },
  // Beaux-Arts stone: rusticated courses with tall arched windows (Grand Central, the Library).
  beaux: {
    tile: [7, 9], px: [128, 160], rough: 0.85, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#ddd3c0'; g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(120,105,85,0.25)'; g.lineWidth = 1;
        for (let y = 0; y < H; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
        g.fillStyle = '#cbbfa8'; g.fillRect(0, 0, W * 0.14, H); g.fillRect(W * 0.86, 0, W * 0.14, H);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      const x = W * 0.28, w = W * 0.44, y = H * 0.22, h = H * 0.62;
      g.fillStyle = lit ? 'rgba(255,200,130,0.85)' : '#3b4350';
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
      if (!lit) { g.strokeStyle = '#efe7d6'; g.lineWidth = 3; g.stroke(); }
    },
  },
  // MetLife: precast concrete grid.
  precast: {
    tile: [1.6, 3.7], px: [32, 128], rough: 0.8, metal: 0, glow: 0xfff0d0,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#c7c3bb'; g.fillRect(0, 0, W, H); } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.42, 0.34, '#3a4250', lit, 0.4);
    },
  },
  // The Dakota: buff brick with sandstone trim.
  brick: {
    tile: [3.6, 3.6], px: [128, 128], rough: 0.9, metal: 0, glow: 0xffc985,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#c9a77c'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(90,60,30,0.18)'; for (let y = 0; y < H; y += 5) g.fillRect(0, y, W, 1);
        g.fillStyle = '#ddc9a8'; g.fillRect(0, H * 0.78, W, H * 0.08); g.fillRect(W * 0.26, H * 0.16, W * 0.48, H * 0.06);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.5, 0.36, '#2f3540', lit, 0.45);
    },
  },
  // The Plaza: white glazed brick, French windows.
  whiteStone: {
    tile: [3.4, 3.6], px: [128, 128], rough: 0.7, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#efebe3'; g.fillRect(0, 0, W, H); g.fillStyle = '#e0dbd1'; g.fillRect(0, H * 0.82, W, H * 0.06); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.5, 0.3, '#39414d', lit, 0.5, '#d4cfc5');
    },
  },
  // Madison Square Garden: precast concrete ribs.
  ribs: {
    tile: [3, 6], px: [64, 128], rough: 0.85, metal: 0, glow: 0xfff2dc,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#b9b5ae'; g.fillRect(0, 0, W, H); g.fillStyle = '#8f8b84'; g.fillRect(W * 0.42, 0, W * 0.16, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,240,215,0.35)'; g.fillRect(W * 0.6, H * 0.1, W * 0.3, H * 0.15); }
    },
  },
  // St. Patrick's: white marble with tall lancet windows.
  cathedral: {
    tile: [8, 14], px: [128, 224], rough: 0.8, metal: 0, glow: 0xffc070,
    paint(g, W, H, lit) {
      if (!lit) { g.fillStyle = '#e9e5dc'; g.fillRect(0, 0, W, H); g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, W * 0.12, H); g.fillRect(W * 0.88, 0, W * 0.12, H); }
      else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      const x = W * 0.34, w = W * 0.32, y = H * 0.18, h = H * 0.66;
      g.fillStyle = lit ? 'rgba(255,190,110,0.8)' : '#3e3a4a';
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w * 0.6); g.quadraticCurveTo(x, y, x + w / 2, y - w * 0.1); g.quadraticCurveTo(x + w, y, x + w, y + w * 0.6); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    },
  },
  // Flatiron: rusticated limestone and terra-cotta with dense windows.
  flatiron: {
    tile: [2.9, 3.6], px: [64, 128], rough: 0.8, metal: 0, glow: 0xffd49a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#d8ccb6'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,100,70,0.22)'; for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      windows(g, W, H, 1, 1, 0.44, 0.32, '#363e4a', lit, 0.4, '#efe8d8');
    },
  },
  // The GM Building: continuous white Georgia marble piers, black recessed windows and spandrels.
  gmMarble: {
    tile: [1.55, 3.65], px: [64, 128], rough: 0.45, metal: 0.05, glow: 0xfff0d8,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#1d2026'; g.fillRect(0, 0, W, H);
        // Marble pier, a little veined, with a shadow on its far side.
        g.fillStyle = '#eceae4'; g.fillRect(0, 0, W * 0.3, H);
        g.fillStyle = 'rgba(160,160,160,0.18)'; for (let y = 0; y < H; y += 9) g.fillRect(W * 0.05, y, W * 0.18, 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(W * 0.3, 0, 2, H);
        // Window: a dark pane with a sliver of sky, black spandrel below.
        const grd = g.createLinearGradient(0, H * 0.06, 0, H * 0.74);
        grd.addColorStop(0, '#5d6c80'); grd.addColorStop(0.4, '#2c3440'); grd.addColorStop(1, '#232830');
        g.fillStyle = grd; g.fillRect(W * 0.36, H * 0.06, W * 0.6, H * 0.68);
        g.fillStyle = '#3c4048'; g.fillRect(W * 0.36, H * 0.38, W * 0.6, 2);
      } else {
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        if (rand(W * 3.1) < 0.5) { g.fillStyle = 'rgba(255,236,200,0.9)'; g.fillRect(W * 0.36, H * 0.06, W * 0.6, H * 0.68); }
      }
    },
  },
  // Roman travertine arcades (the Colosseum's outer wall): arches between engaged half-columns.
  travertine: {
    tile: [6.6, 11.5], px: [128, 224], rough: 0.95, metal: 0, glow: 0xffc27a,
    paint(g, W, H, lit) {
      if (!lit) {
        g.fillStyle = '#cdbb98'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(110,90,60,0.22)'; for (let y = 0; y < H; y += 7) g.fillRect(0, y, W, 1);
        // Weathering streaks.
        for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(90,75,55,${0.06 + rand(k) * 0.08})`; g.fillRect(rand(k + 3) * W, 0, 3 + rand(k + 9) * 6, H); }
        // Engaged half-columns and the entablature.
        g.fillStyle = '#d9c8a6'; g.fillRect(0, 0, W * 0.12, H); g.fillRect(W * 0.88, 0, W * 0.12, H);
        g.fillStyle = '#bba887'; g.fillRect(0, H * 0.02, W, H * 0.07);
      } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      const x = W * 0.2, w = W * 0.6, y = H * 0.22, h = H * 0.78;
      g.fillStyle = lit ? 'rgba(255,190,110,0.75)' : '#4a3f33';
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
      if (!lit) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + w / 2, w * 0.12, h - w / 2); }
    },
  },
  // Golden Gate / Tokyo Tower / Eiffel: steel lattice (alpha-tested).
  lattice: {
    tile: [6, 6], px: [128, 128], rough: 0.6, metal: 0.35,
    paint(g, W, H, lit) {
      g.clearRect(0, 0, W, H);
      if (lit) return;
      g.strokeStyle = '#fff'; g.lineWidth = 9;
      g.strokeRect(4, 4, W - 8, H - 8);
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
    },
  },
};

const texCache = new Map<string, { map: THREE.CanvasTexture; lit: THREE.CanvasTexture | null }>();
function styleTextures(key: string) {
  let t = texCache.get(key);
  if (t) return t;
  const st = STYLES[key];
  const make = (lit: boolean) => {
    const c = document.createElement('canvas');
    [c.width, c.height] = st.px;
    st.paint(c.getContext('2d')!, c.width, c.height, lit);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  };
  t = { map: make(false), lit: st.glow ? make(true) : null };
  texCache.set(key, t);
  return t;
}

/** Materials whose emissive follows the night (the layer sets `night` every frame). */
export const nightMats: THREE.MeshStandardMaterial[] = [];
const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function facadeMat(key: string): THREE.MeshStandardMaterial {
  let m = matCache.get(key);
  if (m) return m;
  const st = STYLES[key], t = styleTextures(key);
  m = new THREE.MeshStandardMaterial({
    map: t.map, roughness: st.rough, metalness: st.metal,
    emissive: new THREE.Color(st.glow ?? 0), emissiveMap: t.lit, emissiveIntensity: 0,
    transparent: false, alphaTest: key === 'lattice' ? 0.5 : 0, side: key === 'lattice' ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (st.glow) { m.userData.glow = 1.6; nightMats.push(m); }
  matCache.set(key, m);
  return m;
}

/** Plain materials, cached by key. */
export function solidMat(key: string, color: number, rough = 0.7, metal = 0, emissive = 0, emissiveIntensity = 0) {
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity });
  matCache.set(key, m);
  return m;
}

/** A lit element that only glows at night (crown lights, clock faces, torch). */
export function glowMat(key: string, color: number, dayIntensity = 0, nightIntensity = 3) {
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, emissive: color, emissiveIntensity: dayIntensity });
  m.userData.glow = nightIntensity; m.userData.day = dayIntensity;
  nightMats.push(m);
  matCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ geometry

/**
 * A vertical prism over a closed ring (x,z pairs, either winding) from y0 to y1, walls UV'd in
 * tiles of the given style (so windows stay the same size on every tier), with a flat cap on top.
 */
export function prism(ring: number[], y0: number, y1: number, tile: [number, number] = [1, 1], cap = true, holes: number[][] = []): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const ccw = area(ring) > 0; // counter-clockwise in x/z (y up, viewed from above with z south)
  const wall = (r: number[], outward: boolean) => {
    const n = r.length / 2;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-4) continue;
      // Outward normal for a ring with area() > 0 is (dz, -dx).
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      const flip = (area(r) > 0) !== outward;
      if (flip) { nx = -nx; nz = -nz; }
      const b = pos.length / 3;
      const u0 = u / tile[0], u1 = (u + len) / tile[0], v0 = y0 / tile[1], v1 = y1 / tile[1];
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      if (!flip) idx.push(b, b + 2, b + 1, b, b + 3, b + 2); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      u += len;
    }
  };
  wall(ring, true);
  for (const h of holes) wall(h, false);
  if (cap) {
    const shape = new THREE.Shape();
    const pts = (r: number[]) => { const out: THREE.Vector2[] = []; for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1])); return out; };
    const outer = pts(ring);
    shape.setFromPoints(outer);
    for (const h of holes) shape.holes.push(new THREE.Path(pts(h)));
    const tris = THREE.ShapeUtils.triangulateShape(outer, holes.map(pts));
    const all = [...outer, ...holes.flatMap(pts)];
    const b = pos.length / 3;
    for (const p of all) { pos.push(p.x, y1, p.y); nrm.push(0, 1, 0); uv.push(p.x / 8, p.y / 8); }
    for (const t of tris) {
      // Make the cap face up.
      const [a, c, d] = t;
      const ax = all[a].x, az = all[a].y, cx = all[c].x, cz = all[c].y, dx = all[d].x, dz = all[d].y;
      const ny = (dx - ax) * (cz - az) - (cx - ax) * (dz - az);
      if (ny > 0) idx.push(b + a, b + c, b + d); else idx.push(b + a, b + d, b + c);
    }
  }
  void ccw;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function area(r: number[]) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1]);
  return a / 2;
}

/** Axis-aligned rectangle ring centered on (cx, cz). */
export function rect(w: number, d: number, cx = 0, cz = 0) {
  return [cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2, cx + w / 2, cz + d / 2, cx - w / 2, cz + d / 2];
}

/** Rectangle with the corners cut back by `c` (an octagon when c is big). */
export function chamfer(w: number, d: number, c: number) {
  const x = w / 2, z = d / 2;
  return [-x + c, -z, x - c, -z, x, -z + c, x, z - c, x - c, z, -x + c, z, -x, z - c, -x, -z + c];
}

/** Regular polygon ring. */
export function ngon(n: number, r: number, rot = 0, cx = 0, cz = 0) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); }
  return out;
}

/** Ring offset outward by d (simple miter, fine for convex-ish rings). */
export function offsetRing(r: number[], d: number) {
  const n = r.length / 2, out: number[] = [];
  const s = area(r) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1], bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const n1x = (az / la) * s, n1z = (-ax / la) * s, n2x = (bz / lb) * s, n2z = (-bx / lb) * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.3, mx * n1x + mz * n1z));
    out.push(r[i * 2] + mx * d * k, r[i * 2 + 1] + mz * d * k);
  }
  return out;
}

/** Add a tier (prism) of a facade style to a landmark and record it as a solid. */
export function tier(b: Built, ring: number[], y0: number, y1: number, style: string, opts: { cap?: boolean; mat?: THREE.Material; solid?: boolean } = {}) {
  const st = STYLES[style];
  const mesh = new THREE.Mesh(prism(ring, y0, y1, st?.tile ?? [4, 4], opts.cap ?? true), opts.mat ?? facadeMat(style));
  mesh.castShadow = true; mesh.receiveShadow = true;
  b.group.add(mesh);
  if (opts.solid !== false) b.solids.push({ ring, y0, y1 });
  return mesh;
}

/** A trim band (cornice, ledge) around a ring. */
export function band(b: Built, ring: number[], y: number, h: number, out: number, mat: THREE.Material, detail = false) {
  const m = new THREE.Mesh(prism(offsetRing(ring, out), y, y + h, [1, 1]), mat);
  m.castShadow = true;
  b.group.add(m);
  if (detail) b.detail.push(m);
  return m;
}

/** Merge many small geometries into one mesh. */
export function merged(geos: THREE.BufferGeometry[], mat: THREE.Material) {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) { if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2)); }
  const total = flat.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of flat) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    if (g.getAttribute('normal')) nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A geometry moved/rotated (for merging). */
export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')).setPosition(x, y, z);
  return g.applyMatrix4(m);
}
