// Real-looking interior surfaces, painted procedurally once and cached: an albedo, a normal map (from
// a painted height field) and a roughness map per surface. Polished stone and wood get a clear coat,
// so they pick up the room's lights and the city outside the windows.
import * as THREE from 'three';

export type SurfaceName =
  | 'marble' | 'oak' | 'walnut' | 'herringbone' | 'carpet' | 'carpetWarm' | 'concrete' | 'terrazzo'
  | 'tile' | 'stone' | 'acoustic' | 'plaster' | 'fabric' | 'felt' | 'epoxy';

interface SurfaceSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; meters: number }

// ---------- noise ----------
function hash2(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise on a `period`-cell lattice. */
function vnoise(x: number, y: number, period: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash2(w(xi), w(yi), s), b = hash2(w(xi + 1), w(yi), s), c = hash2(w(xi), w(yi + 1), s), d = hash2(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Tileable fBm in [0,1): (x, y) in [0,1) texture space, `base` lattice cells across. */
function fbm(x: number, y: number, base: number, oct: number, s: number) {
  let f = 0, amp = 0.5, tot = 0, p = base;
  for (let o = 0; o < oct; o++) { f += amp * vnoise(x * p, y * p, p, s + o * 17); tot += amp; amp *= 0.5; p *= 2; }
  return f / tot;
}
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- painting ----------
/** A surface being painted: per-pixel color (0..1 linear-ish sRGB), height and roughness. */
class Paint {
  col: Float32Array; hgt: Float32Array; rough: Float32Array;
  constructor(public n: number) {
    this.col = new Float32Array(n * n * 3);
    this.hgt = new Float32Array(n * n);
    this.rough = new Float32Array(n * n);
  }
  each(fn: (x: number, y: number, i: number) => void) {
    const n = this.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) fn(x, y, y * n + x);
  }
  set(i: number, r: number, g: number, b: number) { this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; }
  /** Build the three textures. `bump` scales height into the normal map. */
  textures(bump: number): Omit<SurfaceSet, 'meters'> {
    const n = this.n;
    const mk = (fill: (d: Uint8ClampedArray) => void, srgb: boolean) => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d')!;
      const img = g.createImageData(n, n);
      fill(img.data);
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    };
    const map = mk((d) => {
      for (let i = 0; i < n * n; i++) {
        d[i * 4] = this.col[i * 3] * 255; d[i * 4 + 1] = this.col[i * 3 + 1] * 255; d[i * 4 + 2] = this.col[i * 3 + 2] * 255; d[i * 4 + 3] = 255;
      }
    }, true);
    const normalMap = mk((d) => {
      const H = this.hgt;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const l = H[y * n + ((x - 1 + n) % n)], r = H[y * n + ((x + 1) % n)], u = H[((y - 1 + n) % n) * n + x], dn = H[((y + 1) % n) * n + x];
        let nx = (l - r) * bump, ny = (u - dn) * bump, nz = 1;
        const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
        const i = (y * n + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }, false);
    const roughnessMap = mk((d) => {
      for (let i = 0; i < n * n; i++) { const v = this.rough[i] * 255; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    }, false);
    return { map, normalMap, roughnessMap };
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Planks in rows (`rows` across the texture), staggered random lengths; returns per-pixel plank info. */
function planks(p: Paint, rows: number, minLen: number, maxLen: number, seed: number, tone: [number, number, number], spread: number, groove: number) {
  const n = p.n, R = rng(seed);
  const rowH = n / rows;
  // Each row: break points along x (in pixels), tileable (they wrap).
  const rowsInfo: { cuts: number[]; tones: number[]; rough: number[] }[] = [];
  for (let r = 0; r < rows; r++) {
    const cuts: number[] = []; const tones: number[] = []; const rough: number[] = [];
    let x = R() * n * 0.5;
    const start = x;
    while (x < start + n) { cuts.push(x % n); tones.push((R() - 0.5) * spread); rough.push(R()); x += (minLen + R() * (maxLen - minLen)) * n; }
    rowsInfo.push({ cuts, tones, rough });
  }
  p.each((x, y, i) => {
    const r = Math.floor(y / rowH), ri = rowsInfo[r];
    // Which plank along x.
    let k = 0, best = -1;
    for (let j = 0; j < ri.cuts.length; j++) { const d = (x - ri.cuts[j] + n) % n; if (best < 0 || d < best) { best = d; k = j; } }
    const yin = y - r * rowH;
    const edgeY = Math.min(yin, rowH - 1 - yin), edgeX = Math.min(best, (ri.cuts[(k + 1) % ri.cuts.length] - x + n) % n);
    const edge = Math.min(edgeY, edgeX);
    // Grain: stretched noise along the plank, with the odd ring figure.
    const gx = x / n, gy = y / n;
    const grain = fbm(gx * 0.25 + k * 0.37, gy * 3 + r * 0.11, 8, 4, seed + 3);
    const fig = Math.sin((gy * rows * 9 + grain * 6 + k) * Math.PI) * 0.5 + 0.5;
    const t = ri.tones[k] + (grain - 0.5) * 0.35 + (fig - 0.5) * 0.12;
    const g = edge < groove ? 0.55 + 0.45 * (edge / groove) : 1;
    p.set(i, clamp01(tone[0] * (1 + t) * g), clamp01(tone[1] * (1 + t * 1.05) * g), clamp01(tone[2] * (1 + t * 1.1) * g));
    p.hgt[i] = (edge < groove ? edge / groove - 1 : 0) + (grain - 0.5) * 0.15;
    p.rough[i] = clamp01(0.32 + ri.rough[k] * 0.12 + (1 - fig) * 0.08 + (edge < groove ? 0.3 : 0));
  });
}

const cache = new Map<SurfaceName, SurfaceSet>();

function paint(name: SurfaceName): SurfaceSet {
  switch (name) {
    case 'marble': {
      // Large-format polished stone tiles, warm white with soft grey veining.
      const p = new Paint(1024), tiles = 2;
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n;
        const tx = Math.floor(u * tiles), ty = Math.floor(v * tiles);
        const warp = fbm(u, v, 3, 5, 11 + tx * 7 + ty * 13);
        const vein = Math.abs(Math.sin((u * 2.2 + v * 1.4 + warp * 3.2 + tx * 0.7) * Math.PI));
        const fine = Math.pow(1 - vein, 14) * 0.55 + Math.pow(1 - Math.abs(Math.sin((u * 7 - v * 3 + warp * 5) * Math.PI)), 40) * 0.25;
        const cloud = fbm(u, v, 6, 4, 5) - 0.5;
        const tile = (hash2(tx, ty, 3) - 0.5) * 0.03;
        const gx = (u * tiles) % 1, gy = (v * tiles) % 1, gd = Math.min(gx, 1 - gx, gy, 1 - gy) * p.n / tiles;
        const grout = gd < 1.6;
        const base = 0.93 + cloud * 0.05 + tile - fine * 0.32;
        if (grout) p.set(i, 0.68, 0.66, 0.62); else p.set(i, base, base * 0.985, base * 0.96);
        p.hgt[i] = grout ? -1 : 0;
        p.rough[i] = grout ? 0.75 : 0.06 + fine * 0.05;
      });
      return { ...p.textures(3), meters: 1.8 };
    }
    case 'oak': case 'walnut': {
      const p = new Paint(1024);
      planks(p, 8, 0.45, 0.95, name === 'oak' ? 41 : 43, name === 'oak' ? [0.74, 0.56, 0.38] : [0.36, 0.23, 0.15], 0.18, 2.2);
      return { ...p.textures(2.5), meters: 1.6 };
    }
    case 'herringbone': {
      // Oak herringbone: 45° blocks, alternating direction.
      const p = new Paint(1024), R = rng(9), blk = 8; // blocks across
      const tone = [0.7, 0.52, 0.34];
      const tones = Array.from({ length: 64 }, () => (R() - 0.5) * 0.22);
      p.each((x, y, i) => {
        const u = (x / p.n) * blk, v = (y / p.n) * blk;
        // Rotate 45°, then stagger.
        const a = (u + v) / Math.SQRT2, b = (v - u) / Math.SQRT2;
        const col = Math.floor(a * Math.SQRT2 / 1), dir = col % 2;
        const along = dir ? b * 4 : b * 4 + 0.5;
        const k = Math.floor(along), fa = a * Math.SQRT2 % 1, fb = along - k;
        const edge = Math.min(fa, 1 - fa, fb * 0.25, (1 - fb) * 0.25) * (p.n / blk);
        const grain = fbm(x / p.n, y / p.n, 16, 3, 5 + dir);
        const t = tones[((k + col * 7) % 64 + 64) % 64] + (grain - 0.5) * 0.3;
        const g = edge < 1.8 ? 0.6 : 1;
        p.set(i, clamp01(tone[0] * (1 + t) * g), clamp01(tone[1] * (1 + t) * g), clamp01(tone[2] * (1 + t * 1.1) * g));
        p.hgt[i] = edge < 1.8 ? -1 : (grain - 0.5) * 0.1;
        p.rough[i] = edge < 1.8 ? 0.7 : 0.34 + grain * 0.1;
      });
      return { ...p.textures(2.5), meters: 2.4 };
    }
    case 'carpet': case 'carpetWarm': {
      // Carpet tiles, quarter-turned so the pile catches the light differently.
      const p = new Paint(512), tiles = 2;
      const base = name === 'carpet' ? [0.4, 0.41, 0.42] : [0.6, 0.55, 0.48];
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n;
        const tx = Math.floor(u * tiles), ty = Math.floor(v * tiles), turn = (tx + ty) % 2;
        const pile = fbm(turn ? u * 0.5 : u * 4, turn ? v * 4 : v * 0.5, 64, 2, 7 + turn);
        const fleck = hash2(x, y, 9);
        const shade = (turn ? 0.012 : -0.012) + (pile - 0.5) * 0.12 + (fleck > 0.97 ? 0.1 : fleck < 0.03 ? -0.08 : 0);
        p.set(i, clamp01(base[0] * (1 + shade)), clamp01(base[1] * (1 + shade)), clamp01(base[2] * (1 + shade)));
        const gx = (u * tiles) % 1, gy = (v * tiles) % 1, gd = Math.min(gx, 1 - gx, gy, 1 - gy) * p.n / tiles;
        p.hgt[i] = (pile - 0.5) * 0.8 + (gd < 0.8 ? -0.5 : 0);
        p.rough[i] = 0.96;
      });
      return { ...p.textures(4), meters: 1.0 };
    }
    case 'concrete': case 'epoxy': {
      // Polished concrete (soft mottling, aggregate specks, saw-cut joints) or a grey epoxy floor.
      const p = new Paint(1024), epoxy = name === 'epoxy';
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n;
        const m = fbm(u, v, 4, 5, 31), m2 = fbm(u, v, 24, 3, 37);
        const speck = hash2(x, y, 3);
        let c = epoxy ? 0.5 + (m - 0.5) * 0.06 : 0.6 + (m - 0.5) * 0.16 + (m2 - 0.5) * 0.06 + (speck > 0.985 ? -0.12 : speck < 0.01 ? 0.08 : 0);
        const joint = Math.min(u, 1 - u, v, 1 - v) * p.n < 1.6;
        if (joint) c *= 0.55;
        p.set(i, c * 0.98, c * 0.98, c * (epoxy ? 1.0 : 0.96));
        p.hgt[i] = joint ? -1 : (m2 - 0.5) * 0.05;
        p.rough[i] = joint ? 0.8 : epoxy ? 0.18 + (m - 0.5) * 0.08 : 0.24 + (m - 0.5) * 0.25;
      });
      return { ...p.textures(3), meters: epoxy ? 6 : 4 };
    }
    case 'terrazzo': {
      const p = new Paint(1024), R = rng(77);
      p.each((x, y, i) => { const m = fbm(x / p.n, y / p.n, 8, 3, 3); const c = 0.86 + (m - 0.5) * 0.04; p.set(i, c, c * 0.98, c * 0.95); p.hgt[i] = 0; p.rough[i] = 0.1; });
      // Chips: small irregular stones in a few colors.
      const chips = [[0.55, 0.53, 0.5], [0.32, 0.31, 0.3], [0.78, 0.7, 0.6], [0.62, 0.48, 0.4], [0.95, 0.95, 0.93]];
      for (let k = 0; k < 5200; k++) {
        const cx = R() * p.n, cy = R() * p.n, r = 1.5 + Math.pow(R(), 3) * 9, col = chips[Math.floor(R() * chips.length)];
        const sides = 5 + Math.floor(R() * 3), rot = R() * 6.28;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const a = Math.atan2(dy, dx) - rot, d = Math.hypot(dx, dy);
          const lim = r * (0.75 + 0.25 * Math.cos(sides * a));
          if (d > lim) continue;
          const px = ((Math.round(cx + dx) % p.n) + p.n) % p.n, py = ((Math.round(cy + dy) % p.n) + p.n) % p.n, i = py * p.n + px;
          p.set(i, col[0], col[1], col[2]); p.rough[i] = 0.08;
        }
      }
      return { ...p.textures(1), meters: 1.6 };
    }
    case 'tile': {
      // 30 cm porcelain tiles, light grey, with grout.
      const p = new Paint(512), tiles = 4;
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n, tx = Math.floor(u * tiles), ty = Math.floor(v * tiles);
        const gx = (u * tiles) % 1, gy = (v * tiles) % 1, gd = Math.min(gx, 1 - gx, gy, 1 - gy) * p.n / tiles;
        const m = fbm(u, v, 16, 3, 13);
        const c = 0.86 + (hash2(tx, ty, 5) - 0.5) * 0.03 + (m - 0.5) * 0.03;
        if (gd < 1.4) p.set(i, 0.6, 0.6, 0.58); else p.set(i, c, c, c * 0.98);
        p.hgt[i] = gd < 1.4 ? -1 : 0;
        p.rough[i] = gd < 1.4 ? 0.85 : 0.18;
      });
      return { ...p.textures(3), meters: 1.2 };
    }
    case 'stone': {
      // Limestone flags of mixed sizes (church floors).
      const p = new Paint(1024), R = rng(5);
      const cols = 3, rowsN = 4;
      const rowCuts: number[][] = [];
      for (let r = 0; r < rowsN; r++) { const c: number[] = [0]; let x = 0; while (x < 1) { x += 0.2 + R() * 0.25; c.push(Math.min(1, x)); } rowCuts.push(c); }
      void cols;
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n, r = Math.floor(v * rowsN), cuts = rowCuts[r];
        let k = 0; while (k < cuts.length - 1 && u > cuts[k + 1]) k++;
        const fx = Math.min(u - cuts[k], cuts[k + 1] - u) * p.n, fy = Math.min(v * rowsN % 1, 1 - (v * rowsN % 1)) * p.n / rowsN;
        const joint = Math.min(fx, fy) < 2;
        const m = fbm(u, v, 8, 5, 19 + k + r * 5), tone = (hash2(k, r, 2) - 0.5) * 0.08;
        const c = 0.74 + tone + (m - 0.5) * 0.12;
        if (joint) p.set(i, 0.48, 0.46, 0.42); else p.set(i, c, c * 0.96, c * 0.88);
        p.hgt[i] = joint ? -1 : (m - 0.5) * 0.4;
        p.rough[i] = joint ? 0.9 : 0.55 + (m - 0.5) * 0.2;
      });
      return { ...p.textures(3), meters: 4 };
    }
    case 'acoustic': {
      // 60 cm acoustic ceiling tiles in a white T-bar grid.
      const p = new Paint(512), tiles = 2;
      p.each((x, y, i) => {
        const u = x / p.n, v = y / p.n, gx = (u * tiles) % 1, gy = (v * tiles) % 1, gd = Math.min(gx, 1 - gx, gy, 1 - gy) * p.n / tiles;
        const fiss = fbm(u, v, 48, 3, 23), pore = hash2(x, y, 4) > 0.93;
        const bar = gd < 3.2;
        const c = bar ? 0.96 : 0.9 - (pore ? 0.12 : 0) - (fiss < 0.35 ? 0.06 : 0);
        p.set(i, c, c, c * 0.985);
        p.hgt[i] = bar ? (gd < 1 ? -0.4 : 0.2) : (pore ? -0.6 : 0) + (fiss - 0.5) * 0.3;
        p.rough[i] = bar ? 0.45 : 0.97;
      });
      return { ...p.textures(3), meters: 1.2 };
    }
    case 'plaster': {
      const p = new Paint(512);
      p.each((x, y, i) => { const m = fbm(x / p.n, y / p.n, 6, 5, 61); const c = 0.97 + (m - 0.5) * 0.05; p.set(i, c, c, c); p.hgt[i] = (m - 0.5) * 0.3; p.rough[i] = 0.9; });
      return { ...p.textures(1.5), meters: 2.5 };
    }
    case 'fabric': case 'felt': {
      const p = new Paint(256), felt = name === 'felt';
      p.each((x, y, i) => {
        const weave = felt ? 0 : ((x % 4 < 2) !== (y % 4 < 2) ? 0.05 : -0.05);
        const m = fbm(x / p.n, y / p.n, felt ? 32 : 64, 2, 71);
        const c = 0.92 + weave + (m - 0.5) * (felt ? 0.12 : 0.08);
        p.set(i, c, c, c); p.hgt[i] = weave * 6 + (m - 0.5) * 0.5; p.rough[i] = 0.95;
      });
      return { ...p.textures(2), meters: felt ? 0.6 : 0.3 };
    }
  }
}

/** The texture set for a surface (painted the first time it's asked for). */
export function surface(name: SurfaceName): SurfaceSet {
  let s = cache.get(name);
  if (!s) { s = paint(name); cache.set(name, s); }
  return s;
}

const POLISHED: Partial<Record<SurfaceName, { clearcoat: number; clearcoatRoughness: number }>> = {
  marble: { clearcoat: 1, clearcoatRoughness: 0.06 },
  oak: { clearcoat: 0.6, clearcoatRoughness: 0.22 },
  walnut: { clearcoat: 0.7, clearcoatRoughness: 0.18 },
  herringbone: { clearcoat: 0.6, clearcoatRoughness: 0.2 },
  concrete: { clearcoat: 0.45, clearcoatRoughness: 0.25 },
  terrazzo: { clearcoat: 0.9, clearcoatRoughness: 0.08 },
  tile: { clearcoat: 0.5, clearcoatRoughness: 0.12 },
  epoxy: { clearcoat: 0.8, clearcoatRoughness: 0.1 },
};

/**
 * A material for a surface. UVs are expected in meters (see planarUV); the texture repeat converts
 * them to tiles. `tint` multiplies the albedo (vertex colors also multiply it when `vertexColors`).
 * `lite` (low quality / VR) drops the clear coat and normal map.
 */
export function surfaceMaterial(name: SurfaceName, opts: { tint?: THREE.ColorRepresentation; vertexColors?: boolean; lite?: boolean; normalScale?: number; side?: THREE.Side; ceiling?: boolean } = {}) {
  const s = surface(name);
  const rep = 1 / s.meters;
  const tex = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c; };
  const pol = POLISHED[name];
  const base = {
    map: tex(s.map), roughnessMap: tex(s.roughnessMap), roughness: 1, metalness: 0,
    color: new THREE.Color(opts.tint ?? 0xffffff), vertexColors: !!opts.vertexColors, side: opts.side ?? THREE.FrontSide,
  };
  if (opts.lite) return new THREE.MeshStandardMaterial(name === 'acoustic' || opts.ceiling ? { ...base, emissive: new THREE.Color(0x3a3833) } : base);
  const n = opts.normalScale ?? 1;
  const extra = { normalMap: tex(s.normalMap), normalScale: new THREE.Vector2(n, n) };
  // Ceilings are lit mostly by light bounced off the floor and walls: fake that bounce a little.
  const bounce = name === 'acoustic' || opts.ceiling ? { emissive: new THREE.Color(0x3a3833), emissiveIntensity: 1 } : {};
  if (pol) return new THREE.MeshPhysicalMaterial({ ...base, ...extra, ...pol });
  return new THREE.MeshStandardMaterial({ ...base, ...extra, ...bounce });
}

/**
 * Give a geometry UVs in meters from its world-space position: floors and ceilings project from
 * above, walls along their face (by normal). Call after the geometry has its final transform baked in.
 */
export function planarUV(g: THREE.BufferGeometry, offset = { x: 0, z: 0 }) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x, y = pos.getY(i), z = pos.getZ(i) + offset.z;
    const nx = nrm ? Math.abs(nrm.getX(i)) : 0, ny = nrm ? Math.abs(nrm.getY(i)) : 1, nz = nrm ? Math.abs(nrm.getZ(i)) : 0;
    if (ny >= nx && ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (nx >= nz) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Subtle plaster/fabric grain on a vertex-colored material, projected from world position (no UVs
 * needed): breaks up large flat walls and furniture faces without changing their colors.
 */
export function plasterDetail(mat: THREE.MeshStandardMaterial, strength = 0.07) {
  const tex = surface('plaster').map;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: tex };
    sh.uniforms.uGrainK = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrainP; varying vec3 vGrainN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrainP = (modelMatrix * vec4(position, 1.0)).xyz; vGrainN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGrain; uniform float uGrainK; varying vec3 vGrainP; varying vec3 vGrainN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 gw = pow(abs(vGrainN), vec3(4.0)); gw /= (gw.x + gw.y + gw.z);
        float g = texture2D(uGrain, vGrainP.zy * 0.4).g * gw.x + texture2D(uGrain, vGrainP.xz * 0.4).g * gw.y + texture2D(uGrain, vGrainP.xy * 0.4).g * gw.z;
        diffuseColor.rgb *= 1.0 + (g - 0.95) * uGrainK * 6.0;`);
  };
  mat.customProgramCacheKey = () => 'plasterDetail';
}
