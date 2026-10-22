// Shops that look like the real thing: the store a building's point of interest names (an Apple
// Store, a coffee chain, a pharmacy, a supermarket, a bank…) gets that store's layout, fixtures and
// light. Everything is laid out from the front door: `a` is meters in from the door, `b` meters to
// the right looking in. Counters go to the back, checkouts by the door, displays along the walls.
import * as THREE from 'three';
import { hex, type Buf, type RGB } from './kit.ts';
import type { SurfaceName } from './surfaces.ts';

export type StoreType =
  | 'apple' | 'electronics' | 'coffee' | 'fastfood' | 'pharmacy' | 'grocery' | 'deli' | 'bank'
  | 'clothing' | 'books' | 'restaurant' | 'bar' | 'hotel' | 'shop';

export interface Poi { name: string; cls: string; sub: string }

const BRAND: [RegExp, StoreType][] = [
  [/^apple\b|\bapple store\b/i, 'apple'],
  [/best buy|samsung|microsoft store|verizon|t-mobile|at&t|sprint|boost mobile|metro by|cricket|vodafone|\bee\b|o2 store|orange|currys|fnac|mediamarkt|b&h/i, 'electronics'],
  [/starbucks|dunkin|coffee|caf[eé]|espresso|blue bottle|joe & the juice|pret|tim hortons|costa|peet|la colombe|gregorys|bluestone|roast/i, 'coffee'],
  [/mcdonald|burger king|wendy|chipotle|subway|shake shack|kfc|taco bell|five guys|popeyes|chick-fil-a|sweetgreen|panera|domino|papa john|pizza hut|wingstop|halal|dig\b|cava\b|qdoba|jollibee|white castle|nando/i, 'fastfood'],
  [/\bcvs\b|duane reade|walgreens|rite aid|boots|pharmac|chemist|apotheke|drugstore|pharmacie|farmacia/i, 'pharmacy'],
  [/whole foods|trader joe|key food|gristedes|fairway|wegmans|aldi|lidl|safeway|kroger|tesco|sainsbury|carrefour|monoprix|food emporium|morton williams|westside market|c-town|stop & shop|publix|market|supermarket|grocer|waitrose|m&s food|rewe|edeka|albert heijn/i, 'grocery'],
  [/\bdeli\b|bodega|7-eleven|convenience|newsstand|grocery & deli|mini ?mart/i, 'deli'],
  [/\bbank\b|chase|citibank|\bciti\b|wells fargo|\btd\b|hsbc|barclays|santander|capital one|credit union|banco|banque|sparkasse|bnp/i, 'bank'],
  [/zara|h&m|uniqlo|\bgap\b|nike|adidas|levi|banana republic|j\.?crew|forever 21|urban outfitters|lululemon|primark|old navy|aritzia|everlane|madewell|gucci|prada|louis vuitton|chanel|dior|hermes|burberry|coach|massimo dutti|mango|cos\b|abercrombie|hollister|american eagle|ralph lauren|tommy|calvin klein|foot locker|new balance|puma|under armour|the north face|patagonia/i, 'clothing'],
  [/barnes|strand|books|bookstore|librairie|buchhandlung|waterstones|kinokuniya/i, 'books'],
];

const BY_CLASS: Record<string, StoreType> = {
  cafe: 'coffee', fast_food: 'fastfood', restaurant: 'restaurant', bar: 'bar', pub: 'bar', beer: 'bar', ice_cream: 'coffee', bakery: 'coffee',
  pharmacy: 'pharmacy', chemist: 'pharmacy', grocery: 'grocery', supermarket: 'grocery', convenience: 'deli', alcohol_shop: 'deli',
  bank: 'bank', clothing_store: 'clothing', shoes: 'clothing', fashion: 'clothing', books: 'books', library: 'books',
  hotel: 'hotel', lodging: 'hotel', mobile_phone: 'electronics', electronics: 'electronics', computer: 'electronics',
  department_store: 'clothing', boutique: 'clothing', jewelry: 'clothing', cosmetics: 'pharmacy', beauty: 'pharmacy', deli: 'deli', butcher: 'deli', wine: 'deli',
};

/** The kind of store a point of interest is, from its brand name first, then its map class. */
export function storeType(poi: Poi | undefined): StoreType | null {
  if (!poi) return null;
  for (const [re, t] of BRAND) if (re.test(poi.name)) return t;
  return BY_CLASS[poi.sub] ?? BY_CLASS[poi.cls] ?? (/shop|store|boutique/.test(poi.cls) ? 'shop' : null);
}

/** The room itself: floor, walls, how bright, and whether upper floors are more of the store. */
export interface StoreLook { floor: SurfaceName; floorTint: number; wall: number; light: number; upper: boolean }
export const STORE_LOOK: Record<StoreType, StoreLook> = {
  apple: { floor: 'stone', floorTint: 0xeae4da, wall: 0xe6dccd, light: 1.12, upper: true },
  electronics: { floor: 'tile', floorTint: 0xe6e6e4, wall: 0xf0f0ee, light: 1.05, upper: true },
  coffee: { floor: 'oak', floorTint: 0xc39c74, wall: 0xe7dccb, light: 0.9, upper: false },
  fastfood: { floor: 'tile', floorTint: 0xd8d2c8, wall: 0xf1ebe2, light: 1.05, upper: false },
  pharmacy: { floor: 'tile', floorTint: 0xf2f1ee, wall: 0xf3f3f1, light: 1.1, upper: false },
  grocery: { floor: 'tile', floorTint: 0xe8e4dc, wall: 0xf1efea, light: 1.08, upper: false },
  deli: { floor: 'tile', floorTint: 0xd9d3c9, wall: 0xebe7df, light: 1.0, upper: false },
  bank: { floor: 'marble', floorTint: 0xffffff, wall: 0xeeebe5, light: 1.0, upper: false },
  clothing: { floor: 'oak', floorTint: 0xe3d3bd, wall: 0xf4f2ee, light: 1.08, upper: true },
  books: { floor: 'oak', floorTint: 0xb98e63, wall: 0xe9e1d2, light: 0.92, upper: true },
  restaurant: { floor: 'herringbone', floorTint: 0xc8a27a, wall: 0xe8dfd0, light: 0.85, upper: true },
  bar: { floor: 'walnut', floorTint: 0xa77d58, wall: 0xc9b9a2, light: 0.62, upper: false },
  hotel: { floor: 'marble', floorTint: 0xffffff, wall: 0xece6dc, light: 0.95, upper: true },
  shop: { floor: 'tile', floorTint: 0xeeebe6, wall: 0xf1ede6, light: 1.0, upper: false },
};

/** Sales floor a real store of each kind has (m²); Infinity = it takes whatever the building has. */
const NATURAL_AREA: Record<StoreType, number> = {
  apple: Infinity, electronics: 1500, coffee: 260, fastfood: 420, pharmacy: 1200, grocery: Infinity, deli: 260, bank: 520,
  clothing: 3000, books: 2200, restaurant: 480, bar: 320, hotel: Infinity, shop: 650,
};

/** A brand's accent color (sign bands, menu boards), where the name gives one. */
function accent(name: string, t: StoreType): number {
  const n = name.toLowerCase();
  const table: [RegExp, number][] = [
    [/starbucks/, 0x00704a], [/dunkin/, 0xff671f], [/mcdonald/, 0xda291c], [/burger king/, 0xd62300], [/wendy/, 0xe2203d], [/chipotle/, 0x441500],
    [/subway/, 0x008938], [/shake shack/, 0x1f1f1f], [/kfc/, 0xa3080c], [/taco bell/, 0x702082], [/five guys/, 0xc8102e], [/popeyes/, 0xf26522], [/sweetgreen/, 0x2f5a3d],
    [/cvs/, 0xcc0000], [/duane reade/, 0x2b5aa6], [/walgreens/, 0xe31837], [/rite aid/, 0x003c78], [/boots/, 0x05054b],
    [/whole foods/, 0x00674b], [/trader joe/, 0xc8102e], [/aldi/, 0x00005f], [/lidl/, 0x0050aa], [/key food/, 0xd71920],
    [/chase/, 0x117aca], [/citi/, 0x056dae], [/wells fargo/, 0xd71e28], [/\btd\b/, 0x34a853], [/hsbc/, 0xdb0011], [/santander/, 0xec0000], [/capital one/, 0x004977], [/bank of america/, 0xe31837],
    [/best buy/, 0x0046be], [/verizon/, 0xcd040b], [/t-mobile/, 0xe20074], [/at&t/, 0x00a8e0], [/samsung/, 0x1428a0],
  ];
  for (const [re, c] of table) if (re.test(n)) return c;
  const def: Partial<Record<StoreType, number>> = { coffee: 0x3c5a45, fastfood: 0xc8352d, pharmacy: 0x2f6fb8, grocery: 0x3f7a4a, deli: 0xc8452f, bank: 0x1f4e8c, electronics: 0x1f5fbf, books: 0x2f4f3f, clothing: 0x222222, restaurant: 0x6b3a2a, bar: 0x5a3a24, hotel: 0x8a6b3e };
  return def[t] ?? 0x2a72b0;
}

// Products: real packaging colors (mostly white and kraft, with brand reds, blues, greens).
const PROD = [0xf1efe9, 0xf1efe9, 0xe8e2d4, 0xc9a978, 0xb8352d, 0x23395d, 0x3f7a4a, 0xe2b33c, 0xd9742b, 0x3a76b8, 0x26272a, 0x2c8a8a, 0xd97a95, 0x6a4a8c].map(hex);
const MEDS = [0xffffff, 0xf4f4f2, 0xeef3f8, 0x2f6fb8, 0xd8343a, 0x6aa84f, 0xf0b429, 0x8e5bb5, 0x2bb3c0].map(hex);
const CLOTH = [0x1d1f24, 0x2e3a4f, 0xe8e4dc, 0x8a8f96, 0xb59a7a, 0x6b2f2f, 0x3f5a46, 0xd9cdb8, 0x9aaabb, 0xc46b4a, 0x4a4a52, 0xf2f0eb].map(hex);
const BOOKS = [0x8f3b2f, 0x2f4f6f, 0xc9a35a, 0x3f6b4f, 0xd8d2c4, 0x5a4a6a, 0x222222, 0xe8e2d4, 0xb85c38, 0x40607a].map(hex);
const PRODUCE = [0x6aa13a, 0x3f7a2a, 0xc8302a, 0xe8a02a, 0xf2d03c, 0x8a3a6a, 0xe86a2a, 0x9fc24a, 0xb8d26a, 0x7a2a2a].map(hex);
const BOTTLES = [0x5a3a1a, 0x2f4f2f, 0xd8c890, 0x8a2a2a, 0xc0a060, 0x2a2a3a, 0xe0e0d8, 0x6a8a3a].map(hex);

const C = {
  oakLight: hex(0xd5b48a), oak: hex(0xb08458), walnut: hex(0x5a3c28), dark: hex(0x2b2d31), black: hex(0x16171a), white: hex(0xf4f3f0), offWhite: hex(0xe9e6e0),
  steel: hex(0xc4c9cf), alu: hex(0xd5d8dc), chrome: hex(0xe2e5e8), stone: hex(0xd9d1c2), stoneDark: hex(0x8f8a82), glassTint: hex(0xdff0f6),
  screen: hex(0x101820), lamp: hex(0xfff1d6), cool: hex(0xf6fbff), fridge: hex(0xe8f4ff), red: hex(0xc8352d), leather: hex(0x6a4630), brass: hex(0xc9a46a),
  linen: hex(0xf2efe8), green: hex(0x3f6d34), green2: hex(0x2f5a2c), soil: hex(0x2f2620), skin: hex(0xe9e2d8),
};

export interface Rect { u0: number; u1: number; v0: number; v1: number }
type Piece = (lx: number, lz: number, ly: number, w: number, h: number, d: number, col: RGB, buf?: Buf) => void;

/** Everything a store needs from the room it's furnishing (all in the building's u/v frame). */
export interface StoreKit {
  R: () => number;
  y: number; H: number; f: number; floors: number;
  name: string;
  /** The store is the whole floor (else it keeps to a shop-sized zone by the door, in a bigger building's lobby). */
  whole: boolean;
  /** Floor area of the room (m²) and its wall color. */
  area: number;
  wallColor: RGB;
  solid: Buf; gloss: Buf; metal: Buf; glow: Buf; glass: Buf; leaves: Buf;
  /** Door center (on the wall) and the direction into the room. */
  du: number; dv: number; iu: number; iv: number;
  at(u: number, v: number, fu: number, fv: number): Piece;
  yaw(fu: number, fv: number): number;
  cyl(buf: Buf, u: number, v: number, ly: number, rt: number, rb: number, h: number, col: RGB, seg?: number): void;
  shape(buf: Buf, g: THREE.BufferGeometry, u: number, v: number, ly: number, col: RGB, rot?: THREE.Euler): void;
  collide(u: number, v: number, w: number, d: number, fu: number, fv: number, h: number): void;
  fits(r: Rect, margin: number): boolean;
  occupied: Rect[];
  /** Inside the walls, at least `margin` from them. */
  inside(u: number, v: number, margin: number): boolean;
  /** Wall runs on this floor: start corner, unit direction along, unit inward, length; `front` = the door's wall. */
  walls: { u: number; v: number; tu: number; tv: number; nu: number; nv: number; len: number; front: boolean }[];
  plant(u: number, v: number, s?: number): void;
  chair(u: number, v: number, fu: number, fv: number, col: RGB, seat?: RGB): void;
  shelf(u: number, v: number, fu: number, fv: number, w?: number, h?: number): void;
  sofa(u: number, v: number, fu: number, fv: number, col: RGB, w?: number): void;
  bed(u: number, v: number, fu: number, fv: number): void;
  officeChair(u: number, v: number, fu: number, fv: number): void;
}

const overlap = (a: Rect, b: Rect) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;

/** Lay out `t` on this floor. */
export function furnishStore(t: StoreType, k: StoreKit): { partial: boolean } {
  const { R, iu, iv } = k;
  const ru = iv, rv = -iu; // to the right, looking in from the door
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const acc = hex(accent(k.name, t));
  const H = k.H;

  // ---- door-relative frame ----
  const U = (a: number, b: number) => k.du + iu * a + ru * b;
  const V = (a: number, b: number) => k.dv + iv * a + rv * b;
  const dir = (fa: number, fb: number): [number, number] => [iu * fa + ru * fb, iv * fa + rv * fb];
  const P = (a: number, b: number, fa: number, fb: number) => { const [fu, fv] = dir(fa, fb); return k.at(U(a, b), V(a, b), fu, fv); };
  /** Rect (u/v bounds) of a box centered at (a, b), `w` across (along b) by `d` deep (along a). */
  const rectD = (a: number, b: number, w: number, d: number): Rect => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of [[-d / 2, -w / 2], [d / 2, -w / 2], [d / 2, w / 2], [-d / 2, w / 2]]) {
      const u = U(a + x, b + y), v = V(a + x, b + y);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return { u0, u1, v0, v1 };
  };
  const free = (r: Rect, margin: number) => k.fits(r, margin) && !k.occupied.some((o) => overlap(o, r));
  const tryClaim = (a: number, b: number, w: number, d: number, margin = 0.3) => {
    const r = rectD(a, b, w, d);
    if (!free(r, margin)) return false;
    k.occupied.push(r);
    return true;
  };
  const collideD = (a: number, b: number, w: number, d: number, h: number) => { const [fu, fv] = dir(1, 0); k.collide(U(a, b), V(a, b), w, d, fu, fv, h); };
  const cylD = (buf: Buf, a: number, b: number, ly: number, rt: number, rb: number, h: number, col: RGB, seg = 14) => k.cyl(buf, U(a, b), V(a, b), ly, rt, rb, h, col, seg);
  /** Geometry at (a, b) turned to face (fa, fb), tilted back by `tilt` (radians). */
  const shapeD = (buf: Buf, g: THREE.BufferGeometry, a: number, b: number, ly: number, col: RGB, fa = 1, fb = 0, tilt = 0) => {
    const [fu, fv] = dir(fa, fb);
    k.shape(buf, g, U(a, b), V(a, b), ly, col, new THREE.Euler(-tilt, k.yaw(fu, fv), 0, 'YXZ'));
  };

  // How deep the room goes straight in from the door, and how wide it is at a given depth.
  let depth = 0;
  while (depth < 120 && k.inside(U(depth + 0.5, 0), V(depth + 0.5, 0), 0.3)) depth += 0.5;
  const across = (a: number, m = 0.5, lim = 120): [number, number] => {
    let b0 = 0, b1 = 0;
    while (b1 < lim && k.inside(U(a, b1 + 0.25), V(a, b1 + 0.25), m)) b1 += 0.25;
    while (b0 > -lim && k.inside(U(a, b0 - 0.25), V(a, b0 - 0.25), m)) b0 -= 0.25;
    return [b0, b1];
  };
  // A store takes the floor area a real one of its kind has. In a bigger footprint (a café in an office
  // tower's base, a bank branch in a block-sized building) it keeps to a zone by the door, walled off
  // from the rest with a staff door at the back.
  const nat = NATURAL_AREA[t];
  const fitsWhole = k.whole && k.area <= nat * 1.4;
  let D = depth, WMAX = 120;
  if (!fitsWhole) {
    D = Math.min(depth, Math.max(6, Math.sqrt(nat) * 1.1));
    WMAX = Math.max(3.5, Math.min(nat / D / 2, 24));
  }
  const span = (a: number, m = 0.5): [number, number] => across(a, m, WMAX);
  if (!fitsWhole) partition();

  /** Walls between the store and the rest of the floor: across the back (with a staff door) and down the sides. */
  function partition() {
    const th = 0.16, col = k.wallColor;
    if (depth > D + 0.8) {
      const [b0, b1] = across(D, 0.05, WMAX);
      // The staff door, off to one side (the counters take the middle of the back wall).
      const db = Math.max(b0 + 1.2, Math.min(b1 - 1.2, b1 - 1.6));
      for (let b = b0; b < b1 - 0.01; b += 0.5) {
        const w = Math.min(0.5, b1 - b), bc = b + w / 2;
        if (Math.abs(bc - db) < 0.85) continue;
        P(D + th / 2, bc, 1, 0)(0, 0, 0, w + 0.01, H - 0.02, th, col);
        collideD(D + th / 2, bc, w, th, H);
      }
      const p = P(D + th / 2, db, 1, 0);
      for (const s of [-1, 1]) p(s * 0.82, 0, 0, 0.08, 2.15, th + 0.06, C.walnut);
      p(0, 0, 2.15, 1.72, H - 2.17, th, col);
      p(0, 0, 2.15, 1.72, 0.08, th + 0.06, C.walnut);
      const [tu, tv] = dir(0, 1), [nu, nv] = dir(-1, 0);
      k.walls.push({ u: U(D, b0), v: V(D, b0), tu, tv, nu, nv, len: b1 - b0, front: false });
      k.occupied.push(rectD(D - 0.8, db, 1.9, 1.6));
    }
    for (const s of [-1, 1]) {
      let n = 0;
      for (let a = 0; a < D - 0.01; a += 0.5) {
        const d = Math.min(0.5, D - a), ac = a + d / 2, bc = s * (WMAX + th / 2);
        if (!k.inside(U(ac, s * (WMAX + 0.4)), V(ac, s * (WMAX + 0.4)), 0.02)) continue;
        P(ac, bc, 1, 0)(0, 0, 0, th, H - 0.02, d + 0.01, col);
        collideD(ac, bc, th, d, H);
        n++;
      }
      if (n > 6) { const [tu, tv] = dir(1, 0), [nu, nv] = dir(0, -s); k.walls.push({ u: U(0.3, s * WMAX), v: V(0.3, s * WMAX), tu, tv, nu, nv, len: D - 0.3, front: false }); }
    }
  }

  /** Grid of pieces in door coordinates; each cell is claimed before `fn` builds it. */
  const grid = (a0: number, a1: number, stepA: number, stepB: number, w: number, d: number, fn: (a: number, b: number, i: number) => void, max = 200, margin = 0.4) => {
    let i = 0;
    for (let a = a0 + d / 2; a <= a1 - d / 2 && i < max; a += stepA) {
      const [b0, b1] = span(a, margin);
      const n = Math.floor((b1 - b0 - w) / stepB) + 1;
      if (n < 1) continue;
      const off = (b1 - b0 - w - (n - 1) * stepB) / 2;
      // Middle of the room first, so a capped grid gathers in front of you, not along one wall.
      const bs = Array.from({ length: n }, (_, j) => b0 + off + w / 2 + j * stepB).sort((x, y) => Math.abs(x) - Math.abs(y));
      for (const b of bs) {
        if (i >= max) break;
        if (!tryClaim(a, b, w, d, margin)) continue;
        fn(a, b, i++);
      }
    }
    return i;
  };
  /** Fixtures along the walls: `fn(u, v, nu, nv)` with the fixture's back to the wall, facing in. */
  const alongWalls = (w: number, d: number, fn: (u: number, v: number, nu: number, nv: number, wallIdx: number) => void, opts: { front?: boolean; back?: boolean; sides?: boolean; gap?: number; max?: number; within?: number } = {}) => {
    const { front = false, back = true, sides = true, gap = 0.05, max = 200, within = D + 1 } = opts;
    let n = 0;
    k.walls.forEach((wl, wi) => {
      const dot = wl.nu * iu + wl.nv * iv; // inward normal vs into-the-room: -1 = the back wall
      if (wl.front && !front) return;
      if (!wl.front && dot < -0.7 && !back) return;
      if (!wl.front && dot >= -0.7 && !sides) return;
      const slots = Math.floor((wl.len - 0.4) / (w + gap));
      const off = (wl.len - slots * (w + gap)) / 2;
      for (let s = 0; s < slots && n < max; s++) {
        const t = off + (s + 0.5) * (w + gap);
        const u = wl.u + wl.tu * t + wl.nu * (d / 2 + 0.06), v = wl.v + wl.tv * t + wl.nv * (d / 2 + 0.06);
        // Only within the store's zone (measured from the door).
        const a = (u - k.du) * iu + (v - k.dv) * iv, b = (u - k.du) * ru + (v - k.dv) * rv;
        if (a < 0.6 || a > within || Math.abs(b) > WMAX + 1) continue;
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const [x, y] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
          const pu = u + wl.tu * x + wl.nu * y, pv = v + wl.tv * x + wl.nv * y;
          u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
        }
        const r = { u0, u1, v0, v1 };
        // Walls are slanted in the u/v frame sometimes: test the center line, not the rect corners.
        if (!k.inside(u, v, 0.02) || !k.inside(u + wl.nu * d * 0.5, v + wl.nv * d * 0.5, 0.05) || k.occupied.some((o) => overlap(o, shrink(r, 0.12)))) continue;
        k.occupied.push(r);
        fn(u, v, wl.nu, wl.nv, wi);
        n++;
      }
    });
    return n;
  };
  /** The back wall straight ahead (the longest wall facing the door), if there is one. */
  const backWall = () => {
    let best: (typeof k.walls)[number] | null = null;
    for (const wl of k.walls) {
      if (wl.front || wl.nu * iu + wl.nv * iv >= -0.7 || (best && wl.len <= best.len)) continue;
      const m = onWall(wl, wl.len / 2, 0);
      if (m.a <= D + 1 && Math.abs(m.b) <= WMAX + 1) best = wl;
    }
    return best;
  };
  /** Door coordinates of a point on a wall, `t` along it and `off` in from it. */
  const onWall = (wl: (typeof k.walls)[number], t: number, off: number) => {
    const u = wl.u + wl.tu * t + wl.nu * off, v = wl.v + wl.tv * t + wl.nv * off;
    return { a: (u - k.du) * iu + (v - k.dv) * iv, b: (u - k.du) * ru + (v - k.dv) * rv };
  };

  // ---- ceiling light ----
  const panels = (sp: number, size: number, col: RGB) => {
    for (let a = sp / 2; a < D; a += sp) {
      const [b0, b1] = span(a, 0.6);
      for (let b = b0 + sp / 2; b < b1; b += sp) {
        if (!k.inside(U(a, b), V(a, b), 0.6)) continue;
        P(a, b, 1, 0)(0, 0, H - 0.05, size, 0.02, size, col, k.glow);
      }
    }
  };
  const strips = (sp: number, len: number, col: RGB = C.cool) => {
    for (let a = sp / 2; a < D; a += sp) {
      const [b0, b1] = span(a, 0.6);
      for (let b = b0 + 1; b < b1 - 0.6; b += len + 0.8) {
        P(a, b + len / 2, 1, 0)(0, 0, H - 0.06, len + 0.06, 0.05, 0.16, C.steel, k.metal);
        P(a, b + len / 2, 1, 0)(0, 0, H - 0.075, len, 0.02, 0.1, col, k.glow);
      }
    }
  };
  const cans = (sp: number, col: RGB = C.lamp) => {
    for (let a = sp / 2; a < D; a += sp) {
      const [b0, b1] = span(a, 0.6);
      for (let b = b0 + sp / 2; b < b1; b += sp) {
        cylD(k.metal, a, b, H - 0.025, 0.09, 0.09, 0.02, C.white, 14);
        cylD(k.glow, a, b, H - 0.032, 0.065, 0.065, 0.008, col, 14);
      }
    }
  };
  const pendant = (a: number, b: number, drop: number, r: number, col: RGB = C.lamp, shade: RGB = C.black) => {
    P(a, b, 1, 0)(0, 0, H - drop, 0.01, drop, 0.01, C.black, k.metal);
    cylD(k.metal, a, b, H - drop - 0.2, 0.03, r, 0.2, shade, 18);
    cylD(k.glow, a, b, H - drop - 0.205, r * 0.85, r * 0.85, 0.01, col, 18);
  };

  // ---- common fixtures ----
  /** A run of product on a shelf `len` long, packed with boxes or bottles. */
  const stock = (p: Piece, lx0: number, len: number, lz: number, ly: number, depthS: number, maxH: number, pal: RGB[], bottles = false) => {
    // Products come in runs of identical facings (a brand's block on the shelf), each run its own
    // size: squat cans, tall cereal boxes, bottles, jars.
    let x = lx0;
    while (x < lx0 + len - 0.05) {
      const bw = bottles ? 0.07 + R() * 0.03 : 0.07 + R() * 0.2;
      const h = maxH * (bottles ? 0.75 + R() * 0.25 : 0.35 + R() * 0.6);
      const col = pick(pal), facings = 2 + Math.floor(R() * 4);
      for (let q = 0; q < facings && x < lx0 + len - bw; q++) {
        if (R() < 0.95) p(x + bw / 2, lz, ly, bw - 0.012, h, depthS, col);
        x += bw;
      }
      x += R() < 0.08 ? 0.1 : 0.01;
    }
  };
  /** Gondola: a double-sided shelving run, 1.5–1.8 m tall, stocked both sides, a price strip on every shelf. */
  const gondola = (a: number, b: number, len: number, h: number, pal: RGB[], sign?: RGB, frameCol: RGB = C.offWhite) => {
    const p = P(a, b, 0, 1); // runs along a (in from the door), shelves face left and right
    p(0, 0, 0, len, 0.12, 0.92, C.dark);
    p(0, 0, 0.12, len, h - 0.12, 0.05, frameCol);
    const levels = Math.max(3, Math.round((h - 0.2) / 0.38));
    for (let l = 0; l < levels; l++) {
      const ly = 0.14 + l * ((h - 0.3) / levels);
      for (const s of [-1, 1]) {
        p(0, s * 0.24, ly, len, 0.025, 0.42, frameCol);
        p(0, s * 0.452, ly - 0.02, len, 0.04, 0.008, C.white); // price strip
        stock(p, -len / 2 + 0.03, len - 0.06, s * 0.27, ly + 0.025, 0.28, Math.min(0.34, (h - 0.3) / levels - 0.03), pal);
      }
    }
    // End caps.
    for (const e of [-1, 1]) p(e * (len / 2 + 0.2), 0, 0, 0.4, h * 0.85, 0.92, frameCol);
    if (sign) {
      p(0, 0, h, 0.02, H - h - 0.05, 0.02, C.dark, k.metal);
      // Aisle sign: a slim board in the store's color, white lettering both sides.
      const sy = Math.min(H - 0.6, h + 0.9);
      p(0, 0, sy, 0.95, 0.24, 0.025, sign);
      for (const s of [-1, 1]) for (let r = 0; r < 2; r++) p(0, s * 0.014, sy + 0.05 + r * 0.08, 0.5 - r * 0.2, 0.035, 0.004, C.white);
    }
    collideD(a, b, 0.92, len + 0.8, h);
  };
  /** Wall shelving (against a wall, facing in). */
  const wallShelf = (u: number, v: number, nu: number, nv: number, w: number, h: number, pal: RGB[], frameCol: RGB = C.offWhite) => {
    const p = k.at(u, v, nu, nv);
    p(0, -0.22, 0, w, h, 0.04, frameCol);
    p(0, 0, 0, w, 0.12, 0.5, C.dark);
    const levels = Math.max(3, Math.round(h / 0.4));
    for (let l = 0; l < levels; l++) {
      const ly = 0.14 + l * ((h - 0.2) / levels);
      p(0, 0, ly, w, 0.025, 0.46, frameCol);
      p(0, 0.232, ly - 0.02, w, 0.04, 0.008, C.white);
      stock(p, -w / 2 + 0.03, w - 0.06, 0.02, ly + 0.025, 0.3, Math.min(0.34, (h - 0.2) / levels - 0.03), pal);
    }
    k.collide(u, v, w, 0.5, nu, nv, h);
  };
  /** Glass-door fridges against a wall: lit inside, rows of drinks. */
  const fridge = (u: number, v: number, nu: number, nv: number, w: number, pal = BOTTLES.concat(PROD)) => {
    const p = k.at(u, v, nu, nv);
    p(0, 0, 0, w, 2.1, 0.75, C.dark);
    p(0, 0.38, 0.1, w - 0.1, 1.85, 0.01, C.fridge, k.glow);
    for (let l = 0; l < 5; l++) stock(p, -w / 2 + 0.1, w - 0.2, 0.3, 0.16 + l * 0.37, 0.12, 0.26, pal, true);
    p(0, 0.39, 0.1, w - 0.04, 1.9, 0.02, C.glassTint, k.glass);
    const doors = Math.max(1, Math.round(w / 0.75));
    for (let d = 0; d <= doors; d++) p(-w / 2 + (d * w) / doors, 0.4, 0.1, 0.04, 1.9, 0.04, C.chrome, k.metal);
    p(0, 0.39, 2.0, w, 0.12, 0.04, acc);
    k.collide(u, v, w, 0.75, nu, nv, 2.1);
  };
  /** A counter facing the customers (front = +z of the piece). */
  const counter = (p: Piece, w: number, body: RGB, top: RGB, h = 1.0) => {
    p(0, 0, 0, w, 0.1, 0.62, C.black);
    p(0, 0, 0.1, w, h - 0.14, 0.68, body);
    p(0, 0.02, h - 0.04, w + 0.04, 0.04, 0.76, top, k.gloss);
  };
  const register = (p: Piece, lx: number) => {
    p(lx, -0.1, 1.0, 0.32, 0.06, 0.26, C.dark, k.gloss);
    p(lx, -0.12, 1.06, 0.03, 0.18, 0.03, C.dark, k.metal);
    p(lx, -0.11, 1.18, 0.3, 0.2, 0.025, C.black, k.gloss);
    p(lx, -0.097, 1.19, 0.27, 0.17, 0.004, hex(0x6fa6d8), k.glow);
    p(lx + 0.24, 0.08, 1.0, 0.09, 0.03, 0.15, C.black, k.gloss); // card reader
  };
  /** A menu board: dark panel, lines of lit text, a few photos. */
  const menuBoard = (p: Piece, lx: number, ly: number, w: number, h: number, lz: number, photos: boolean, light = false) => {
    p(lx, lz, ly, w, h, 0.04, light ? C.white : C.black, k.gloss);
    const cols = Math.max(1, Math.round(w / 0.55));
    for (let c = 0; c < cols; c++) {
      const cx = lx - w / 2 + (c + 0.5) * (w / cols), cw = w / cols - 0.12;
      if (photos && c % 2 === 0) { p(cx, lz + 0.022, ly + h * 0.45, cw, h * 0.45, 0.004, pick(PRODUCE.concat([hex(0xd8a050), hex(0x8a4a2a)])), k.glow); continue; }
      for (let r = 0; r < Math.floor(h / 0.09) - 1; r++) {
        const tw = cw * (0.5 + R() * 0.45);
        p(cx - (cw - tw) / 2, lz + 0.022, ly + h - 0.12 - r * 0.085, tw, 0.028, 0.004, light ? C.dark : hex(0xf2eee4), light ? k.solid : k.glow);
      }
    }
  };
  const stool = (a: number, b: number, h: number, seat: RGB = C.dark) => {
    cylD(k.metal, a, b, 0, 0.18, 0.2, 0.03, C.dark, 14);
    cylD(k.metal, a, b, 0.03, 0.022, 0.022, h - 0.06, C.steel, 8);
    cylD(k.solid, a, b, h - 0.05, 0.19, 0.18, 0.05, seat, 18);
    cylD(k.metal, a, b, h * 0.38, 0.17, 0.17, 0.015, C.steel, 16);
  };
  /** A small round café table on a pedestal. */
  const bistro = (a: number, b: number, r: number, top: RGB, h = 0.74) => {
    cylD(k.metal, a, b, 0, 0.24, 0.26, 0.03, C.black, 16);
    cylD(k.metal, a, b, 0.03, 0.03, 0.03, h - 0.06, C.black, 8);
    cylD(k.gloss, a, b, h - 0.03, r, r, 0.03, top, 24);
    collideD(a, b, r * 1.6, r * 1.6, h);
  };
  const chairD = (a: number, b: number, fa: number, fb: number, col: RGB, seat?: RGB) => { const [fu, fv] = dir(fa, fb); k.chair(U(a, b), V(a, b), fu, fv, col, seat); };
  /** A tree in a planter (indoor ficus, as in the big stores), with a round bench rim. */
  const tree = (a: number, b: number, s = 1, bench = false) => {
    cylD(k.solid, a, b, 0, 0.75 * s, 0.75 * s, 0.45, bench ? C.oakLight : C.stone, 28);
    cylD(k.solid, a, b, 0.45, 0.68 * s, 0.68 * s, 0.02, C.soil, 24);
    cylD(k.solid, a, b, 0.45, 0.05 * s, 0.09 * s, 2.0 * s, hex(0x6b5a48), 8);
    for (let i = 0; i < 3; i++) shapeD(k.solid, new THREE.CylinderGeometry(0.02 * s, 0.035 * s, 0.9 * s, 6), a + Math.cos(i * 2.1) * 0.25 * s, b + Math.sin(i * 2.1) * 0.25 * s, 0.45 + 1.7 * s, hex(0x6b5a48), Math.cos(i * 2.1), Math.sin(i * 2.1), 0.6);
    const n = Math.round(420 * s);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, rr = Math.sqrt(R()) * 1.1 * s, hh = 0.45 + (1.8 + R() * 1.3 - rr * 0.45) * s;
      const g = new THREE.SphereGeometry(1, 6, 3);
      g.scale(0.06 * s, 0.01, 0.11 * s); g.translate(0, 0, 0.09 * s);
      const cu = U(a, b) + Math.cos(th) * rr, cv = V(a, b) + Math.sin(th) * rr;
      k.shape(k.leaves, g, cu, cv, hh, R() < 0.5 ? C.green : C.green2, new THREE.Euler(-0.2 - R() * 0.9, R() * 6.28, 0, 'YXZ'));
    }
    collideD(a, b, 1.5 * s, 1.5 * s, 0.5);
  };

  // ---- devices (Apple / electronics tables) ----
  /** An open laptop facing (fa, fb), at table height `ly`. */
  const laptop = (a: number, b: number, fa: number, fb: number, ly: number, body: RGB = C.alu, screenCol: RGB = pick([hex(0x3c6fb0), hex(0x7a5ab8), hex(0xd8865a), hex(0x2f8a7a), hex(0x1c2a3e)])) => {
    shapeD(k.metal, new THREE.BoxGeometry(0.31, 0.012, 0.22), a, b, ly + 0.006, body, fa, fb);
    shapeD(k.gloss, new THREE.BoxGeometry(0.22, 0.002, 0.08), a + fa * 0.04, b + fb * 0.04, ly + 0.013, C.dark, fa, fb); // keyboard
    const t = 0.3, hgt = 0.2;
    const ca = a - fa * (0.11 + Math.sin(t) * hgt / 2), cb = b - fb * (0.11 + Math.sin(t) * hgt / 2);
    shapeD(k.metal, new THREE.BoxGeometry(0.31, hgt, 0.006), ca, cb, ly + 0.012 + Math.cos(t) * hgt / 2, body, fa, fb, t);
    const g = new THREE.BoxGeometry(0.29, hgt - 0.02, 0.002); g.translate(0, 0, 0.004);
    shapeD(k.glow, g, ca, cb, ly + 0.012 + Math.cos(t) * hgt / 2, screenCol, fa, fb, t);
  };
  const phoneFlat = (a: number, b: number, fa: number, fb: number, ly: number, body: RGB) => {
    shapeD(k.gloss, new THREE.BoxGeometry(0.072, 0.008, 0.15), a, b, ly + 0.004, body, fa, fb);
    shapeD(k.glow, new THREE.BoxGeometry(0.066, 0.002, 0.142), a, b, ly + 0.009, pick([hex(0x2a4a8a), hex(0x8a5ab8), hex(0xe0a060), hex(0x3a8a6a)]), fa, fb);
  };
  const tablet = (a: number, b: number, fa: number, fb: number, ly: number) => {
    shapeD(k.metal, new THREE.BoxGeometry(0.06, 0.012, 0.1), a, b, ly + 0.006, C.alu, fa, fb);
    const t = 1.05;
    shapeD(k.gloss, new THREE.BoxGeometry(0.25, 0.18, 0.007), a - fa * 0.03, b - fb * 0.03, ly + 0.012 + 0.07, C.dark, fa, fb, t);
    const g = new THREE.BoxGeometry(0.23, 0.165, 0.002); g.translate(0, 0, 0.005);
    shapeD(k.glow, g, a - fa * 0.03, b - fb * 0.03, ly + 0.012 + 0.07, pick([hex(0x4a7ac8), hex(0xe8a868), hex(0x6a9a5a)]), fa, fb, t);
  };
  const watch = (a: number, b: number, fa: number, fb: number, ly: number) => {
    cylD(k.gloss, a, b, ly, 0.045, 0.05, 0.03, C.offWhite, 18);
    shapeD(k.gloss, new THREE.BoxGeometry(0.04, 0.012, 0.048), a, b, ly + 0.036, C.dark, fa, fb);
    shapeD(k.glow, new THREE.BoxGeometry(0.034, 0.002, 0.04), a, b, ly + 0.043, hex(0x2a3a5a), fa, fb);
    shapeD(k.solid, new THREE.BoxGeometry(0.022, 0.006, 0.16), a, b, ly + 0.031, pick([C.white, hex(0x2a2a30), hex(0xd8b8a0), hex(0x5a7a9a)]), fa, fb);
  };
  /** The long light-oak product table: thick top on two slab legs, devices along both long sides. */
  const productTable = (a: number, b: number, len: number, theme: number, top: RGB = C.oakLight, legs: RGB = C.oakLight, h = 0.86) => {
    const p = P(a, b, 1, 0);
    p(0, 0, h - 0.065, 1.22, 0.065, len, top, k.gloss);
    for (const e of [-1, 1]) p(0, e * (len / 2 - 0.45), 0, 1.0, h - 0.065, 0.09, legs);
    collideD(a, b, 1.22, len, h);
    const n = Math.floor((len - 0.3) / 0.62);
    for (let i = 0; i < n; i++) {
      const da = -len / 2 + 0.3 + (i + 0.5) * ((len - 0.6) / n) + 0.15;
      for (const s of [-1, 1]) {
        const db = s * 0.36;
        if (theme === 0) laptop(a + da, b + db, 0, s, h);
        else if (theme === 1) { phoneFlat(a + da - 0.08, b + db, 0, s, h, pick([hex(0x2a2a2e), hex(0xe8e4dc), hex(0x3a4a6a), hex(0xd8c8b0)])); phoneFlat(a + da + 0.08, b + db, 0, s, h, pick([hex(0x2a2a2e), hex(0xf2d8c8), hex(0x6a7a8a)])); }
        else if (theme === 2) tablet(a + da, b + db, 0, s, h);
        else { watch(a + da - 0.1, b + db, 0, s, h); watch(a + da + 0.1, b + db, 0, s, h); }
      }
    }
  };

  /** Display bay against a wall: backlit panel, oak shelves with boxed accessories, storage below. */
  const avenueBay = (u: number, v: number, nu: number, nv: number, w: number) => {
    const p = k.at(u, v, nu, nv);
    p(0, -0.2, 0, w, 2.9, 0.06, C.offWhite);
    p(0, -0.165, 1.0, w - 0.2, 1.75, 0.006, hex(0xdedcd6), k.glow);
    p(0, 0, 0, w, 0.9, 0.42, C.oakLight);
    p(0, 0.012, 0.9, w + 0.02, 0.02, 0.44, C.oakLight, k.gloss);
    for (let l = 0; l < 3; l++) {
      const ly = 1.25 + l * 0.48;
      p(0, -0.04, ly, w - 0.2, 0.02, 0.28, C.oakLight);
      let x = -w / 2 + 0.2;
      while (x < w / 2 - 0.3) { const bw = 0.12 + R() * 0.06; p(x + bw / 2, -0.04, ly + 0.02, bw, 0.18 + R() * 0.06, 0.06, pick([C.white, C.white, hex(0x2a2a2e), hex(0xe8c8b0), hex(0x8aa8c8), hex(0xd84a3a)])); x += bw + 0.08; }
    }
    k.collide(u, v, w, 0.45, nu, nv, 2.9);
  };
  /** A big video wall (the forum screen): a picture made of bands of light. */
  const screenWall = (u: number, v: number, nu: number, nv: number, w: number, h: number, ly: number) => {
    const p = k.at(u, v, nu, nv);
    p(0, 0, ly - 0.05, w + 0.1, h + 0.1, 0.08, C.black, k.gloss);
    const sky = [0x0d2a4a, 0x174a7a, 0x2a6aa8, 0x5a92c8, 0x9cc4e4, 0xf0d8b0, 0xe89a5a, 0x3a5a3a].map(hex);
    for (let i = 0; i < sky.length; i++) p(0, 0.045, ly + h - (i + 1) * (h / sky.length), w, h / sky.length, 0.004, sky[i], k.glow);
  };

  const bw = backWall();
  // Where the counter goes: across the back, closer in when the room is shallow (a wide shopfront).
  const back = Math.min(D, 16), deep = back >= 9;

  switch (t) {
    case 'apple': {
      // Luminous ceiling, long oak tables in rows running in from the door, display bays on the walls,
      // trees in round planters, and on the top floor the forum: a video wall with oak cube seats.
      panels(1.2, 1.205, hex(0xd9d7d1)); // under the bloom threshold: a whole ceiling of light would haze the room
      const forumHere = k.f === k.floors - 1;
      if (forumHere && bw) {
        const sw = Math.min(bw.len - 1.2, 7.5), mid = bw.len / 2;
        const c = onWall(bw, mid, 0.08);
        screenWall(U(c.a, c.b), V(c.a, c.b), bw.nu, bw.nv, sw, Math.min(3.3, H - 1.2), 0.75);
        // Mark the screen's strip so the bays don't cover it.
        tryClaim(c.a - 0.3, c.b, sw, 0.6, 0);
        // Cube seats in rows facing the screen.
        for (let r = 0; r < 4; r++) for (let q = -4; q <= 4; q++) {
          const s = onWall(bw, mid + q * 0.75, 2.2 + r * 0.9);
          if (Math.abs(q * 0.75) > sw / 2 || !tryClaim(s.a, s.b, 0.5, 0.5, 0.2)) continue;
          P(s.a, s.b, 1, 0)(0, 0, 0, 0.46, 0.45, 0.46, C.oakLight);
          collideD(s.a, s.b, 0.46, 0.46, 0.45);
        }
      }
      alongWalls(2.4, 0.45, (u, v, nu, nv) => avenueBay(u, v, nu, nv, 2.4), { back: true });
      // Trees: two groves, one each side of the tables.
      let trees = 0;
      for (const a of [Math.min(D * 0.3, 8), Math.min(D * 0.7, 20)]) {
        const [b0, b1] = span(a, 2);
        for (const b of [b0 + 2.4, b1 - 2.4]) if (trees < 4 && b1 - b0 > 9 && tryClaim(a, b, 2.4, 2.4, 0.3)) { tree(a, b, 1.15, true); trees++; }
      }
      const len = Math.max(2.4, Math.min(5.4, D - 6));
      grid(3.2, D - (forumHere && bw ? 6.5 : 1.2), len + 1.6, 2.9, 1.3, len, (a, b, i) => productTable(a, b, len, (i + Math.floor(a)) % 4), 160, 0.6);
      break;
    }
    case 'electronics': {
      strips(2.4, 1.2);
      alongWalls(1.5, 0.3, (u, v, nu, nv) => {
        // TVs and phones on the walls.
        const p = k.at(u, v, nu, nv);
        p(0, -0.1, 0, 1.5, 0.9, 0.4, C.white);
        p(0, -0.14, 1.15, 1.3, 0.75, 0.03, C.black, k.gloss);
        p(0, -0.12, 1.18, 1.25, 0.7, 0.004, pick([hex(0x2a6ab8), hex(0x6ab84a), hex(0xd88a3a), hex(0x8a4ad8)]), k.glow);
        p(0, -0.135, 2.1, 1.5, 0.3, 0.02, acc);
        k.collide(u, v, 1.5, 0.4, nu, nv, 0.9);
      });
      grid(2.6, D - 1.2, 3.8, 2.8, 1.3, 2.4, (a, b, i) => productTable(a, b, 2.4, i % 3, C.white, C.offWhite, 0.9), 120);
      break;
    }
    case 'coffee': {
      // The bar: a long counter across the back with the pastry case, the register and, behind it,
      // the espresso machines under the menu boards. Café tables up front, a window ledge with stools.
      cans(2.2);
      const ca = back - (deep ? 2.6 : 2.15);
      const [b0, b1] = span(ca, 0.6);
      const cw = Math.min(b1 - b0 - 1.6, 7.5);
      if (cw > 2.4 && ca > 3.2) {
        const cb = (b0 + b1) / 2 + (b1 - b0 - cw) / 2 - 0.4;
        tryClaim(ca + 0.7, cb, cw + 0.6, 2.6, 0);
        const p = P(ca, cb, -1, 0);
        counter(p, cw, C.walnut, hex(0xd9d4cc), 1.0);
        register(p, -cw / 2 + 0.9);
        // Pastry case at the customer end.
        const px = cw / 2 - 0.8;
        p(px, 0, 1.0, 1.3, 0.42, 0.62, C.glassTint, k.glass);
        p(px, 0, 1.0, 1.26, 0.008, 0.58, hex(0xfff3dc), k.glow);
        for (const ly of [1.03, 1.22]) for (let i = 0; i < 6; i++) p(px - 0.5 + i * 0.2, 0.1 - (ly > 1.1 ? 0.1 : 0), ly, 0.14, 0.06, 0.12, pick([hex(0xc88a4a), hex(0xd8a868), hex(0x8a5a3a), hex(0xe8c898), hex(0x5a3a2a)]));
        // Pickup end with cups.
        for (let i = 0; i < 4; i++) cylD(k.solid, ca - 0.1, cb - cw / 2 + 0.3 + i * 0.12, 1.0, 0.045, 0.035, 0.14, C.white, 10);
        // Back bar: machines, grinders, cups, and the menu boards over it.
        const q = P(ca + 1.35, cb, -1, 0);
        q(0, 0, 0, cw, 0.92, 0.6, C.dark); q(0, 0, 0.92, cw + 0.02, 0.04, 0.62, hex(0xd9d4cc), k.gloss);
        for (const mx of [-1.2, 0.6]) { q(mx, 0.05, 0.96, 0.85, 0.45, 0.5, C.steel, k.metal); q(mx, 0.3, 1.15, 0.6, 0.06, 0.01, hex(0x7fd0ff), k.glow); for (const g of [-0.25, 0.25]) q(mx + g, 0.3, 1.02, 0.06, 0.06, 0.06, C.black, k.metal); }
        for (const gx of [-2.0, 1.6]) { cylD(k.metal, ca + 1.35, cb + gx * (cw > 5 ? 1 : 0.6), 0.96, 0.08, 0.1, 0.32, C.black, 12); cylD(k.glass, ca + 1.35, cb + gx * (cw > 5 ? 1 : 0.6), 1.28, 0.1, 0.06, 0.16, hex(0x5a3a2a), 12); }
        for (let i = 0; i < 3; i++) menuBoard(q, -cw / 2 + cw * ((i + 0.5) / 3), Math.min(H - 1.05, 1.9), Math.min(1.4, cw / 3 - 0.15), 0.85, -0.29, i === 1);
        q(0, -0.3, 1.0, cw, 0.6, 0.02, hex(0xe9e2d6)); // tile backsplash
        collideD(ca + 0.7, cb, cw, 2.2, 1.1);
        for (let i = 0; i < Math.floor(cw / 1.6); i++) pendant(ca, cb - cw / 2 + 0.8 + i * 1.6, 0.9, 0.16, C.lamp, hex(0x2f3a30));
      }
      // Window ledge with stools along the front.
      alongWalls(1.6, 0.42, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        p(0, 0, 1.03, 1.6, 0.04, 0.4, C.oak, k.gloss);
        p(0, -0.15, 0, 0.06, 1.03, 0.06, C.black, k.metal);
        for (const sx of [-0.4, 0.4]) { const su = u + nv * sx + nu * 0.55, sv = v - nu * sx + nv * 0.55; const da = (su - k.du) * iu + (sv - k.dv) * iv, db = (su - k.du) * ru + (sv - k.dv) * rv; stool(da, db, 0.76, hex(0x3a2a22)); }
        k.collide(u, v, 1.6, 0.4, nu, nv, 1.05);
      }, { front: true, back: false, sides: false });
      // A communal table, then two-tops.
      const ma = Math.min(D * 0.45, 6);
      if (D > 9 && tryClaim(ma, 0, 1.2, 3.6, 0.8)) {
        P(ma, 0, 1, 0)(0, 0, 0.72, 1.0, 0.05, 3.4, C.oak, k.gloss);
        for (const e of [-1, 1]) P(ma, 0, 1, 0)(0, e * 1.4, 0, 0.8, 0.72, 0.08, C.black, k.metal);
        collideD(ma, 0, 1.0, 3.4, 0.76);
        for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) chairD(ma + i * 1.05, s * 0.85, 0, -s, C.walnut, hex(0x3a2a22));
      }
      grid(1.0, ca - 1.0, 1.9, 1.9, 1.5, 1.5, (a, b, i) => {
        bistro(a, b, 0.34, i % 3 ? hex(0xd9d4cc) : C.oak);
        chairD(a, b - 0.55, 0, 1, C.walnut, hex(0x3a2a22));
        chairD(a, b + 0.55, 0, -1, C.walnut, hex(0x3a2a22));
      }, 60, 0.5);
      // An armchair corner and a condiment station by the side wall.
      alongWalls(2.2, 0.9, (u, v, nu, nv) => k.sofa(u, v, nu, nv, hex(0x5a4030), 2.0), { back: false, max: 1 });
      alongWalls(1.2, 0.6, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv); p(0, 0, 0, 1.2, 0.95, 0.55, C.walnut); p(0, 0, 0.95, 1.22, 0.03, 0.57, hex(0xd9d4cc), k.gloss);
        for (let i = 0; i < 4; i++) cylD(k.metal, (u - k.du) * iu + (v - k.dv) * iv, (u - k.du) * ru + (v - k.dv) * rv + (i - 1.5) * 0.18, 0.98, 0.04, 0.04, 0.16, C.steel, 10);
        k.collide(u, v, 1.2, 0.55, nu, nv, 1);
      }, { back: false, max: 1 });
      for (let i = 0; i < 3; i++) { const a = 1.5 + i * 3.5; const [, b1] = span(a, 0.6); if (b1 > 1.2 && tryClaim(a, b1 - 0.4, 0.6, 0.6, 0.1)) k.plant(U(a, b1 - 0.4), V(a, b1 - 0.4), 1.1); }
      break;
    }
    case 'fastfood': {
      panels(2.4, 0.6, C.cool);
      const ca = back - (deep ? 3.2 : 2.0);
      const [b0, b1] = span(ca, 0.6);
      const cw = Math.min(b1 - b0 - 1.2, 9);
      if (cw > 2.4 && ca > 3.2) {
        const cb = (b0 + b1) / 2;
        tryClaim(ca + (deep ? 1.2 : 0.7), cb, cw + 0.4, deep ? 3.4 : 2.2, 0);
        const p = P(ca, cb, -1, 0);
        counter(p, cw, acc, C.steel, 1.0);
        p(0, 0.345, 0.3, cw, 0.25, 0.006, C.white); // stripe
        for (let i = 0; i < Math.max(1, Math.floor(cw / 2.2)); i++) register(p, -cw / 2 + 1 + i * 2.2);
        // Kitchen: fryers, a grill under a steel hood, a prep line, and the menu boards over the counter.
        const q = P(ca + (deep ? 2.0 : 1.3), cb, -1, 0);
        q(0, 0, 0, cw, 0.9, deep ? 0.8 : 0.6, C.steel, k.metal);
        for (let i = 0; i < Math.floor(cw / 0.6); i++) q(-cw / 2 + 0.3 + i * 0.6, 0, 0.9, 0.5, 0.02, 0.5, i % 3 === 0 ? hex(0xc8902a) : C.dark, k.metal);
        if (deep) q(0, 0, H - 1.0, cw, 0.6, 1.0, C.steel, k.metal);
        for (let i = 0; i < 3; i++) menuBoard(p, -cw / 2 + cw * ((i + 0.5) / 3), Math.min(H - 1.0, 2.1), cw / 3 - 0.2, 0.8, deep ? -0.9 : -1.55, true);
        collideD(ca + (deep ? 1 : 0.65), cb, cw, deep ? 2.8 : 1.9, 1.1);
        // Drinks station by the counter end.
        const da = ca - 1.6, db = b1 - 1.0;
        if (tryClaim(da, db, 0.7, 1.4, 0.1)) { const r = P(da, db, 0, -1); r(0, 0, 0, 1.4, 0.95, 0.65, C.dark); r(0, 0, 0.95, 1.2, 0.75, 0.5, C.steel, k.metal); r(0, 0.26, 1.2, 1.0, 0.4, 0.004, acc, k.glow); collideD(da, db, 0.7, 1.4, 1.7); }
      }
      // Ordering kiosks by the door.
      for (const s of [-1, 1]) { const a = 1.6, b = s * 3.9; if (tryClaim(a, b, 0.6, 0.5, 0.1)) { const p = P(a, b, 1, -s * 0.4); p(0, 0, 0, 0.5, 0.95, 0.4, C.dark); p(0, 0, 0.95, 0.55, 0.9, 0.08, C.black, k.gloss); p(0, 0.045, 1.0, 0.48, 0.8, 0.004, pick([acc, hex(0xe8a050)]), k.glow); collideD(a, b, 0.5, 0.4, 1.9); } }
      // Booths along the sides, tables in the middle.
      alongWalls(1.8, 1.5, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        // Table out from the wall, a bench each side.
        p(0, 0, 0.72, 0.75, 0.04, 1.2, C.white, k.gloss);
        p(0, -0.1, 0, 0.12, 0.72, 0.12, C.dark, k.metal);
        for (const s of [-1, 1]) { p(s * 0.72, 0, 0, 0.42, 0.44, 1.2, acc); p(s * 0.88, 0, 0.44, 0.12, 0.62, 1.2, acc); }
        k.collide(u, v, 1.9, 1.3, nu, nv, 1.06);
      }, { back: false, within: ca - 1.4 });
      grid(1.0, ca - 1.0, 2.0, 2.0, 1.6, 1.6, (a, b) => {
        P(a, b, 1, 0)(0, 0, 0.72, 0.75, 0.04, 0.75, C.white, k.gloss);
        cylD(k.metal, a, b, 0, 0.03, 0.03, 0.72, C.dark, 8);
        collideD(a, b, 0.75, 0.75, 0.76);
        chairD(a - 0.55, b, 1, 0, C.dark, acc); chairD(a + 0.55, b, -1, 0, C.dark, acc);
      }, 60, 0.5);
      break;
    }
    case 'pharmacy':
    case 'grocery':
    case 'deli':
    case 'shop': {
      const grocery = t === 'grocery', deli = t === 'deli', pharm = t === 'pharmacy';
      if (deli) panels(1.8, 0.6, C.cool); else strips(grocery ? 2.6 : 2.3, 1.2);
      const pal = pharm ? MEDS.concat(PROD.slice(0, 4)) : PROD;
      // Back wall: the pharmacy counter, the deli case, or fridges.
      if (bw) {
        const back = onWall(bw, bw.len / 2, 0.5);
        if (pharm || deli) {
          const cw = Math.min(bw.len - 2, deli ? 5 : 6);
          const ca = back.a - 1.4;
          if (tryClaim(ca + 0.7, back.b, cw + 0.4, 2.4, 0)) {
            const p = P(ca, back.b, -1, 0);
            if (deli) {
              // Deli case: glass front, cold cuts and salads inside, the slicer on top.
              p(0, 0, 0, cw, 0.9, 0.85, C.offWhite);
              p(0, 0.1, 0.9, cw, 0.55, 0.65, C.glassTint, k.glass);
              p(0, 0.1, 0.9, cw - 0.06, 0.01, 0.6, C.cool, k.glow);
              for (let i = 0; i < Math.floor(cw / 0.32); i++) p(-cw / 2 + 0.2 + i * 0.32, 0.12, 0.92, 0.28, 0.08, 0.36, pick([hex(0xd88a8a), hex(0xe8c898), hex(0xc8504a), hex(0xf2e2b0), hex(0x9ac86a), hex(0xe8a868)]));
              p(cw / 2 - 0.5, -0.1, 1.45, 0.4, 0.3, 0.35, C.steel, k.metal);
              for (let i = 0; i < 2; i++) menuBoard(p, -cw / 4 + i * (cw / 2), Math.min(H - 0.9, 2.1), cw / 2 - 0.2, 0.7, -1.3, false, true);
            } else {
              counter(p, cw, C.white, C.offWhite, 1.05);
              register(p, -cw / 2 + 0.8); register(p, cw / 2 - 0.8);
              // Dispensary shelves behind, a colored sign band over them.
              const q = P(ca + 1.2, back.b, -1, 0);
              q(0, 0, 0, cw, 2.2, 0.4, C.offWhite);
              for (let l = 0; l < 5; l++) for (let i = 0; i < Math.floor(cw / 0.32); i++) q(-cw / 2 + 0.18 + i * 0.32, 0.21, 0.25 + l * 0.4, 0.28, 0.16, 0.01, l % 2 ? C.white : hex(0xdfe8f2));
              q(0, 0.21, 2.35, cw, 0.4, 0.04, acc);
              q(0, 0.235, 2.47, 1.4, 0.16, 0.004, C.white);
            }
            collideD(ca + 0.6, back.b, cw, 2.0, 1.1);
          }
        }
        if (!pharm) alongWalls(2.25, 0.75, (u, v, nu, nv) => fridge(u, v, nu, nv, 2.25), { sides: deli || (grocery && !deep), back: true, max: grocery ? 40 : 10 });
      }
      // Side walls: fridges in a pharmacy (drinks), shelving everywhere else.
      if (pharm) alongWalls(2.25, 0.75, (u, v, nu, nv) => fridge(u, v, nu, nv, 2.25), { back: false, max: 3 });
      // Checkouts by the door.
      const lanes = grocery ? 3 : 1;
      const [cb0, cb1] = span(3.0, 0.6);
      const side = cb1 > -cb0 ? 1 : -1; // the roomier side
      for (let l = 0; l < lanes; l++) {
        const a = 3.0, b = side * (1.9 + l * 2.1);
        if (Math.abs(b) > Math.max(-cb0, cb1) - 0.6 || !tryClaim(a, b, 1.0, 2.4, 0.1)) continue;
        const p = P(a, b, 0, -side);
        if (grocery) {
          p(0, 0, 0, 2.2, 0.9, 0.7, C.offWhite);
          p(0.2, 0, 0.9, 1.6, 0.02, 0.5, C.black);
          register(p, -0.85);
          p(-0.5, -0.5, 0, 0.6, 1.4, 0.3, C.dark); stock(p, -0.75, 0.5, -0.4, 0.4, 0.1, 0.12, PROD);
          P(a, b, 0, -side)(-1.15, 0, 0, 0.06, 2.0, 0.06, C.steel, k.metal);
          P(a, b, 0, -side)(-1.15, 0, 2.0, 0.3, 0.3, 0.06, acc, k.glow);
        } else {
          counter(p, 2.2, deli ? hex(0x8a6a4a) : C.white, C.offWhite, 1.0);
          register(p, -0.5);
          p(0.4, 0.05, 1.0, 0.5, 0.5, 0.4, C.glassTint, k.glass); // plexiglass
          if (deli) { const q = P(a - 0.2, b - side * 1.0, 0, side); q(0, 0, 1.1, 1.6, 0.9, 0.3, C.dark); for (let r = 0; r < 4; r++) stock(q, -0.75, 1.5, 0.08, 1.12 + r * 0.22, 0.12, 0.18, [C.white, C.red, hex(0x2a3a6a), hex(0xe2b33c)]); }
        }
        collideD(a, b, 1.0, 2.2, 1.05);
      }
      // Produce up front in a grocery: angled wooden tables piled with fruit and vegetables.
      if (grocery) {
        grid(deep ? 4.6 : 1.2, Math.min(D, 12), 2.4, 2.6, 2.0, 1.4, (a, b) => {
          const p = P(a, b, 1, 0);
          p(0, 0, 0, 1.3, 0.72, 1.9, C.oak);
          for (let i = 0; i < 6; i++) {
            const col = PRODUCE[Math.floor(R() * PRODUCE.length)];
            for (let j = 0; j < 22; j++) {
              const g = new THREE.SphereGeometry(0.045 + R() * 0.02, 7, 5);
              shapeD(k.solid, g, a + (j % 4) * 0.13 - 0.2 + (R() - 0.5) * 0.04, b - 0.85 + i * 0.32 + (Math.floor(j / 4) % 3) * 0.09, 0.76 + (j % 4) * 0.035, col);
            }
          }
          collideD(a, b, 1.3, 1.9, 0.9);
        }, 6, 0.5);
      }
      // Aisles.
      const len = Math.min(grocery ? 7 : 5, Math.max(2.4, D * 0.5));
      const h = pharm ? 1.6 : deli ? 1.7 : 1.8;
      grid(deep ? (grocery ? 7.2 : 4.6) : 1.4, D - (bw ? 2.2 : 0.8), len + 2.2, deli ? 1.9 : 2.3, 0.95, len + 0.8, (a, b) => gondola(a, b, len, h, pal, deli ? undefined : acc, grocery ? hex(0xc4c8cc) : C.offWhite), 160, 0.4);
      alongWalls(1.8, 0.5, (u, v, nu, nv) => wallShelf(u, v, nu, nv, 1.8, deli ? 2.1 : 1.9, pal), { back: !bw || pharm, max: 40 });
      break;
    }
    case 'bank': {
      cans(2.2, C.cool);
      // Teller line across the back behind glass, banker desks along the sides, ATMs by the door.
      if (bw) {
        const back = onWall(bw, bw.len / 2, 0.5);
        const cw = Math.min(bw.len - 2, 7.5), ca = back.a - 2.0;
        if (tryClaim(ca + 0.8, back.b, cw + 0.4, 2.8, 0)) {
          const p = P(ca, back.b, -1, 0);
          counter(p, cw, C.walnut, hex(0xd6d0c4), 1.1);
          const n = Math.max(2, Math.floor(cw / 1.6));
          for (let i = 0; i <= n; i++) p(-cw / 2 + (i * cw) / n, 0.02, 1.1, 0.04, Math.min(1.1, H - 2.4), 0.04, C.chrome, k.metal);
          p(0, 0.02, 1.1, cw, Math.min(1.1, H - 2.4), 0.012, C.glassTint, k.glass);
          for (let i = 0; i < n; i++) { const lx = -cw / 2 + ((i + 0.5) * cw) / n; p(lx, -0.15, 1.1, 0.4, 0.28, 0.03, C.black, k.gloss); p(lx, -0.135, 1.12, 0.36, 0.24, 0.004, hex(0x6fa6d8), k.glow); }
          // The brand wall behind the tellers.
          const q = P(ca + 1.9, back.b, -1, 0);
          q(0, 0, 0, cw + 0.6, H - 0.4, 0.08, acc);
          q(0, 0.05, H * 0.55, 1.8, 0.3, 0.004, C.white, k.glow);
          collideD(ca + 0.6, back.b, cw, 1.8, 1.2);
          // Queue stanchions.
          for (let i = 0; i < 5; i++) { cylD(k.metal, ca - 2.2 - i * 0.9, back.b - cw / 4, 0, 0.12, 0.14, 0.03, C.chrome, 14); cylD(k.metal, ca - 2.2 - i * 0.9, back.b - cw / 4, 0.03, 0.025, 0.025, 0.95, C.chrome, 8); if (i) P(ca - 2.2 - (i - 0.5) * 0.9, back.b - cw / 4, 1, 0)(0, 0, 0.88, 0.03, 0.03, 0.9, hex(0x1f3a6a)); }
        }
      }
      alongWalls(0.75, 0.6, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        p(0, 0, 0, 0.72, 1.85, 0.6, C.dark);
        p(0, 0.25, 1.2, 0.5, 0.36, 0.12, C.black, k.gloss);
        p(0, 0.31, 1.23, 0.4, 0.28, 0.004, hex(0x4a8ad8), k.glow);
        p(0, 0.3, 0.98, 0.5, 0.05, 0.2, C.steel, k.metal);
        p(0, 0.3, 1.75, 0.72, 0.1, 0.02, acc, k.glow);
        k.collide(u, v, 0.72, 0.6, nu, nv, 1.85);
      }, { front: true, back: false, sides: false, max: 3 });
      alongWalls(3.2, 2.6, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        // Desk facing in, the banker behind it (by the wall), two guest chairs in front.
        p(0, 0, 0.72, 1.6, 0.04, 0.8, C.walnut, k.gloss);
        for (const sx of [-0.75, 0.75]) p(sx, 0, 0, 0.05, 0.72, 0.7, C.dark, k.metal);
        p(0, -0.2, 0.76, 0.5, 0.32, 0.02, C.black, k.gloss); p(0, -0.19, 0.78, 0.46, 0.28, 0.004, hex(0x6fa6d8), k.glow);
        const bu = u - nu * 0.75, bv = v - nv * 0.75;
        k.officeChair(bu, bv, nu, nv);
        for (const sx of [-0.4, 0.4]) k.chair(u + nv * sx + nu * 0.85, v - nu * sx + nv * 0.85, -nu, -nv, C.dark, hex(0x4a5a6a));
        k.collide(u, v, 1.6, 0.8, nu, nv, 0.76);
      }, { back: false, max: 6 });
      // The floor between: stand-up desks for filling in slips, and a couple of waiting sofas.
      grid(3.5, Math.max(4.5, D - 4.5), 4.6, 5.2, 1.9, 0.8, (a, b, i) => {
        if (i % 2) { k.sofa(U(a, b), V(a, b), ...dir(1, 0), hex(0x4a5a6a), 1.8); return; }
        const p = P(a, b, 1, 0);
        p(0, 0, 0, 1.4, 1.0, 0.5, C.walnut); p(0, 0, 1.0, 1.5, 0.04, 0.6, hex(0xd6d0c4), k.gloss);
        for (const s of [-0.4, 0.4]) p(s, 0, 1.04, 0.2, 0.12, 0.14, C.white);
        collideD(a, b, 1.5, 0.6, 1.05);
      }, 6, 0.8);
      for (let i = 0; i < 4; i++) { const a = 2 + i * 4; const [b0] = span(a, 0.8); if (tryClaim(a, b0 + 0.5, 0.6, 0.6, 0.1)) k.plant(U(a, b0 + 0.5), V(a, b0 + 0.5), 1.2); }
      break;
    }
    case 'clothing': {
      cans(1.8);
      // Fitting rooms along the back, wall cubbies with folded stacks, racks and tables on the floor.
      if (bw) {
        const n = Math.min(5, Math.floor((bw.len - 2) / 1.3));
        for (let i = 0; i < n; i++) {
          const c = onWall(bw, bw.len / 2 + (i - (n - 1) / 2) * 1.3, 0.75);
          if (!tryClaim(c.a, c.b, 1.3, 1.5, 0)) continue;
          const p = P(c.a, c.b, -1, 0);
          for (const s of [-1, 1]) p(s * 0.64, 0, 0.1, 0.04, 2.2, 1.4, C.white);
          p(0, 0.68, 0.15, 1.2, 1.95, 0.03, pick([hex(0x6b6458), hex(0x3a3f48), hex(0xb8ad9a)])); // curtain
          p(0, 0.68, 2.12, 1.26, 0.03, 0.03, C.chrome, k.metal);
          p(0, -0.68, 0.5, 0.6, 1.6, 0.02, hex(0xdfe8ee), k.gloss); // mirror
          k.collide(U(c.a, c.b), V(c.a, c.b), 0.1, 1.4, ...dir(-1, 0), 2.3);
        }
      }
      alongWalls(1.6, 0.45, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        p(0, -0.2, 0, 1.6, 2.6, 0.05, C.white);
        if (R() < 0.5) {
          // Cubbies with folded stacks.
          for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
            p(-0.6 + c * 0.4, 0, 0.3 + r * 0.45, 0.38, 0.02, 0.4, C.oakLight);
            const col = pick(CLOTH), n = 3 + Math.floor(R() * 4);
            for (let s = 0; s < n; s++) p(-0.6 + c * 0.4, 0, 0.32 + r * 0.45 + s * 0.045, 0.3, 0.04, 0.3, col);
          }
        } else {
          // A hanging rail with garments.
          p(0, 0.05, 1.7, 1.5, 0.025, 0.025, C.chrome, k.metal);
          for (let i = 0; i < 13; i++) p(-0.66 + i * 0.11, 0.05, 0.9 + R() * 0.15, 0.03, 0.75, 0.42, pick(CLOTH));
        }
        k.collide(u, v, 1.6, 0.45, nu, nv, 2.6);
      }, { back: true });
      grid(2.6, D - 2, 2.6, 2.8, 2.0, 1.6, (a, b, i) => {
        const p = P(a, b, 1, 0);
        if (i % 3 === 0) {
          // Nesting table with folded stacks.
          p(0, 0, 0, 1.4, 0.8, 1.0, C.oakLight); p(0, 0, 0.8, 1.45, 0.03, 1.05, C.oakLight, k.gloss);
          for (let s = 0; s < 6; s++) { const col = pick(CLOTH); for (let j = 0; j < 4; j++) p(-0.45 + (s % 3) * 0.45, -0.25 + Math.floor(s / 3) * 0.5, 0.83 + j * 0.045, 0.36, 0.04, 0.32, col); }
          collideD(a, b, 1.45, 1.05, 0.9);
        } else if (i % 3 === 1) {
          // Round rack.
          cylD(k.metal, a, b, 0, 0.3, 0.32, 0.03, C.chrome, 16);
          cylD(k.metal, a, b, 0.03, 0.02, 0.02, 1.35, C.chrome, 8);
          for (let j = 0; j < 16; j++) { const th = (j / 16) * Math.PI * 2; shapeD(k.solid, new THREE.BoxGeometry(0.03, 0.8, 0.4), a + Math.cos(th) * 0.55, b + Math.sin(th) * 0.55, 0.95, pick(CLOTH), Math.cos(th), Math.sin(th)); }
          collideD(a, b, 1.2, 1.2, 1.4);
        } else {
          // A mannequin (abstract, matte white) on a plinth.
          p(0, 0, 0, 0.6, 0.12, 0.6, C.white);
          p(0, 0, 0.12, 0.04, 0.8, 0.04, C.chrome, k.metal);
          const top = pick(CLOTH), bottom = pick(CLOTH);
          p(0, 0, 0.92, 0.36, 0.5, 0.2, bottom);
          p(0, 0, 1.42, 0.42, 0.52, 0.24, top);
          for (const s of [-1, 1]) p(s * 0.25, 0, 1.2, 0.09, 0.7, 0.1, top);
          cylD(k.solid, a, b, 1.94, 0.05, 0.05, 0.1, C.skin, 10);
          shapeD(k.solid, new THREE.SphereGeometry(0.11, 14, 10), a, b, 2.14, C.skin);
          collideD(a, b, 0.6, 0.6, 2.1);
        }
      }, 260, 0.6);
      // Cash desk.
      const [, cb1] = span(3, 0.6);
      if (tryClaim(3, cb1 - 1.0, 0.8, 2.2, 0.1)) { const p = P(3, cb1 - 1.0, 0, -1); counter(p, 2.2, C.white, C.oakLight, 1.0); register(p, 0.4); collideD(3, cb1 - 1.0, 0.8, 2.2, 1.05); }
      break;
    }
    case 'books': {
      cans(2.0);
      alongWalls(1.6, 0.36, (u, v, nu, nv) => k.shelf(u, v, nu, nv, 1.6, Math.min(2.4, H - 0.6)), { back: true });
      const [, cb1] = span(2.6, 0.6);
      if (tryClaim(2.6, cb1 - 1.1, 0.8, 2.4, 0.1)) { const p = P(2.6, cb1 - 1.1, 0, -1); counter(p, 2.4, C.walnut, C.oak, 1.0); register(p, 0.5); collideD(2.6, cb1 - 1.1, 0.8, 2.4, 1.05); }
      // Display tables up front, then rows of freestanding shelves, armchairs in a corner.
      grid(2.0, Math.min(D * 0.35, 6), 2.4, 2.6, 1.8, 1.2, (a, b) => {
        const p = P(a, b, 1, 0);
        p(0, 0, 0, 1.0, 0.76, 1.6, C.walnut); p(0, 0, 0.76, 1.05, 0.03, 1.65, C.oak, k.gloss);
        for (let i = 0; i < 8; i++) { const col = pick(BOOKS); for (let j = 0; j < 1 + Math.floor(R() * 4); j++) p(-0.25 + (i % 2) * 0.5, -0.6 + Math.floor(i / 2) * 0.4, 0.79 + j * 0.03, 0.2, 0.028, 0.28, col); }
        collideD(a, b, 1.05, 1.65, 0.85);
      }, 6, 0.6);
      grid(Math.min(D * 0.35, 6) + 0.5, D - 1, 2.2, 3.0, 2.6, 0.7, (a, b) => {
        const [fu, fv] = dir(1, 0), [gu, gv] = dir(-1, 0);
        k.shelf(U(a + 0.17, b), V(a + 0.17, b), fu, fv, 2.4, 1.9);
        k.shelf(U(a - 0.17, b), V(a - 0.17, b), gu, gv, 2.4, 1.9);
      }, 140, 0.5);
      alongWalls(1.0, 1.0, (u, v, nu, nv) => { const p = k.at(u, v, nu, nv); p(0, 0, 0.1, 0.85, 0.3, 0.85, C.leather); p(0, -0.34, 0.1, 0.85, 0.75, 0.16, C.leather); for (const s of [-1, 1]) p(s * 0.36, 0, 0.1, 0.14, 0.55, 0.85, C.leather); k.collide(u, v, 0.85, 0.85, nu, nv, 0.8); }, { back: false, max: 3 });
      break;
    }
    case 'restaurant':
    case 'bar': {
      const bar = t === 'bar';
      const pendantUV = (u: number, v: number) => { const a = (u - k.du) * iu + (v - k.dv) * iv, b = (u - k.du) * ru + (v - k.dv) * rv; pendant(a, b, 0.9, 0.13, hex(0xffd9a0), C.brass); };
      // The bar along one side: counter, stools, back bar with lit bottle shelves and a mirror.
      let built = false;
      alongWalls(Math.min(6, D * 0.6), 2.1, (u, v, nu, nv) => {
        if (built) return; built = true;
        const w = Math.min(6, D * 0.6);
        const p = k.at(u, v, nu, nv);
        p(0, -0.85, 0, w, 0.9, 0.45, C.walnut); // back bar
        p(0, -0.85, 0.9, w + 0.02, 0.03, 0.47, C.dark, k.gloss);
        p(0, -1.03, 1.0, w, 1.3, 0.02, hex(0xc8ccd0), k.gloss); // mirror
        for (let l = 0; l < 3; l++) { p(0, -0.95, 1.1 + l * 0.42, w, 0.02, 0.22, C.glassTint, k.glass); p(0, -1.0, 1.1 + l * 0.42 + 0.01, w, 0.01, 0.12, hex(0xffd9a0), k.glow); stock(p, -w / 2 + 0.1, w - 0.2, -0.95, 1.12 + l * 0.42, 0.07, 0.32, BOTTLES, true); }
        p(0, 0.25, 0, w, 1.05, 0.55, C.walnut); p(0, 0.25, 1.05, w + 0.1, 0.05, 0.7, hex(0x3a2418), k.gloss);
        p(0, 0.52, 0.22, w, 0.04, 0.04, C.brass, k.metal); // foot rail
        k.collide(u, v, w, 2.0, nu, nv, 1.1);
        for (let i = 0; i < Math.floor(w / 0.65); i++) {
          const sx = -w / 2 + 0.35 + i * 0.65, su = u + nv * sx + nu * 0.95, sv = v - nu * sx + nv * 0.95;
          stool((su - k.du) * iu + (sv - k.dv) * iv, (su - k.du) * ru + (sv - k.dv) * rv, 0.76, C.leather);
          pendantUV(su - nu * 0.65, sv - nv * 0.65);
        }
      }, { back: false });
      // Host stand by the door (restaurants).
      if (!bar && tryClaim(1.6, 1.2, 0.5, 0.7, 0.1)) { const p = P(1.6, 1.2, -1, 0); p(0, 0, 0, 0.7, 1.1, 0.45, C.walnut); p(0, 0, 1.1, 0.6, 0.02, 0.35, hex(0xe8dcc0)); collideD(1.6, 1.2, 0.7, 0.45, 1.1); }
      // Banquette along a wall with two-tops.
      alongWalls(1.5, 1.4, (u, v, nu, nv) => {
        const p = k.at(u, v, nu, nv);
        p(0, -0.42, 0, 1.5, 0.45, 0.55, hex(0x6a3a2a)); p(0, -0.62, 0.45, 1.5, 0.6, 0.14, hex(0x6a3a2a));
        p(0, 0.25, 0.72, 0.7, 0.04, 0.7, bar ? C.walnut : C.linen, k.gloss);
        p(0, 0.25, 0, 0.08, 0.72, 0.08, C.black, k.metal);
        k.chair(u + nu * 0.95, v + nv * 0.95, -nu, -nv, C.walnut, hex(0x3a2a22));
        k.collide(u, v, 1.5, 1.4, nu, nv, 0.76);
      }, { back: !bar, max: 12 });
      grid(2.6, D - 1.2, bar ? 2.8 : 2.4, bar ? 2.8 : 2.4, bar ? 1.4 : 1.9, bar ? 1.4 : 1.9, (a, b, i) => {
        if (bar) {
          bistro(a, b, 0.32, C.walnut, 1.05);
          stool(a, b - 0.55, 0.76, C.leather); stool(a, b + 0.55, 0.76, C.leather);
        } else {
          const cloth = i % 2 === 0;
          P(a, b, 1, 0)(0, 0, 0.72, 0.9, 0.04, 0.9, cloth ? C.linen : C.walnut, k.gloss);
          if (cloth) P(a, b, 1, 0)(0, 0, 0.38, 0.92, 0.34, 0.92, C.linen);
          cylD(k.metal, a, b, 0, 0.03, 0.03, 0.72, C.black, 8);
          collideD(a, b, 0.9, 0.9, 0.76);
          for (const [fa, fb] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (i % 3 || fa === 0) chairD(a - fa * 0.62, b - fb * 0.62, fa, fb, C.walnut, hex(0x3a2a22));
          cylD(k.glass, a, b, 0.76, 0.03, 0.025, 0.1, C.glassTint, 8);
        }
        pendant(a, b, bar ? 1.0 : 1.1, 0.14, hex(0xffd9a0), bar ? C.brass : C.dark);
      }, 90, 0.5);
      break;
    }
    case 'hotel': {
      if (k.f === 0) {
        cans(2.4);
        // Reception at the back, a lounge, plants and a big pendant.
        const ra = Math.min(D - 2.2, 10);
        if (tryClaim(ra, 0, 1.4, 4.4, 0.2)) {
          const p = P(ra, 0, -1, 0);
          p(0, 0, 0, 4.0, 1.05, 0.8, C.stone);
          p(0, 0.02, 1.05, 4.2, 0.05, 0.9, C.walnut, k.gloss);
          for (const lx of [-1.0, 1.0]) { p(lx, -0.2, 1.1, 0.4, 0.28, 0.03, C.black, k.gloss); p(lx, -0.185, 1.12, 0.36, 0.24, 0.004, hex(0x6fa6d8), k.glow); }
          P(ra + 1.4, 0, -1, 0)(0, 0, 0, 5, H - 0.4, 0.1, C.walnut);
          collideD(ra, 0, 0.9, 4.2, 1.1);
        }
        grid(2.5, ra - 1.8, 3.6, 4.2, 3.0, 2.6, (a, b) => {
          const [fu, fv] = dir(0, 1), [gu, gv] = dir(0, -1);
          k.sofa(U(a, b - 1.0), V(a, b - 1.0), fu, fv, hex(0x8a7a68), 2.0);
          k.sofa(U(a, b + 1.0), V(a, b + 1.0), gu, gv, hex(0x8a7a68), 2.0);
          P(a, b, 1, 0)(0, 0, 0.36, 0.9, 0.06, 0.6, C.walnut, k.gloss);
        }, 3, 0.6);
        const ca = Math.min(D / 2, 6);
        P(ca, 0, 1, 0)(0, 0, H - 1.6, 0.01, 1.4, 0.01, C.black, k.metal);
        for (let i = 0; i < 12; i++) { const th = (i / 12) * Math.PI * 2; shapeD(k.glow, new THREE.SphereGeometry(0.07, 10, 8), ca + Math.cos(th) * 0.55, Math.sin(th) * 0.55, H - 1.7, C.lamp); }
        cylD(k.metal, ca, 0, H - 1.66, 0.6, 0.6, 0.03, C.brass, 24);
        for (let i = 0; i < 4; i++) { const a = 2 + i * 3; const [b0, b1] = span(a, 0.8); for (const b of [b0 + 0.5, b1 - 0.5]) if (tryClaim(a, b, 0.6, 0.6, 0.1)) k.plant(U(a, b), V(a, b), 1.3); }
      } else {
        cans(2.6);
        // Guest rooms: a bed, a desk and an armchair in each, a carpeted corridor between.
        grid(1.6, depth, 4.4, 4.2, 3.4, 3.6, (a, b) => {
          const [fu, fv] = dir(0, 1);
          k.bed(U(a, b), V(a, b), fu, fv);
          k.chair(U(a + 1.4, b + 1.2), V(a + 1.4, b + 1.2), ...dir(0, -1), C.walnut, hex(0x8a7a68));
        }, 60, 0.4);
      }
      break;
    }
  }
  // The rest of the floor (past the partition) is someone else's: keep the room's other furniture out.
  if (!fitsWhole) k.occupied.push(rectD(D / 2, 0, 2 * WMAX, D));
  return { partial: !fitsWhole };
}

function shrink(r: Rect, m: number): Rect { return { u0: r.u0 + m, u1: r.u1 - m, v0: r.v0 + m, v1: r.v1 - m }; }
