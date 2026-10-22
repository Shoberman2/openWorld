// The look of the streaming world: clean, bright, slightly toy-like (early Apple Maps / the "Hello
// World" game). Materials are shared across chunks so the GPU compiles each shader once.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { quality, shared } from '../engine.ts';
import { styleGlsl } from './build/facades.ts';
// ---- Europe & Middle East
import { euProps } from './cities/eu-props.ts';

const NOISE = /* glsl */ `
  float eh21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float evn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(eh21(i), eh21(i + vec2(1, 0)), f.x), mix(eh21(i + vec2(0, 1)), eh21(i + vec2(1, 1)), f.x), f.y); }
`;

let buildingMat: THREE.MeshStandardMaterial | null = null;

/** Facade detail switches: uRooms = rooms behind the windows (off under ?q=low; VR may turn it off). */
export const facadeQuality = { uRooms: { value: quality.low ? 0 : 1 } };

/**
 * Shade takes some of the sky's color (lavender at dusk, soft blue by day), as in the game this
 * world is styled after, but not all of it.
 */
const NEUTRAL_SHADE = /* glsl */ `
  {
    vec3 ind = reflectedLight.indirectDiffuse;
    float il = dot(ind, vec3(0.2126, 0.7152, 0.0722));
    reflectedLight.indirectDiffuse = mix(vec3(il), ind, 0.4);
    // Rough surfaces (asphalt, render) shouldn't mirror the sky's hue either.
    vec3 isp = reflectedLight.indirectSpecular;
    float sl = dot(isp, vec3(0.2126, 0.7152, 0.0722));
    reflectedLight.indirectSpecular = mix(isp, vec3(sl), smoothstep(0.3, 0.8, roughnessFactor) * 0.7);
  }`;

/**
 * Night on the ground: the city's light (shop windows, screens, lamps, the sky's glow) falling on
 * pavement and asphalt, which otherwise go black between the lamp pools.
 */
const NIGHT_GLOW = /* glsl */ `
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.86, 0.68) * uCityGlow * 0.06;`;

/**
 * Rooms behind the glass (interior mapping): a box behind each window, ray-cast from the view
 * direction, so you see a floor, a ceiling, side walls and furniture against the back wall that shift
 * with parallax as you walk past. kind 0 a home, 1 an office, 2 a shop. Returns radiance (it's added as
 * emission: daylight through the window by day, its own lamps at night).
 */
const ROOMS = /* glsl */ `
  vec3 owRoom(vec2 pu, vec3 d, vec2 grow, float depth, float rs, float kind, float lit, float day) {
    // pu: point on the pane (0..1 across and up); d: view ray in pane units (z into the room, > 0).
    vec3 lo = vec3(-grow.x, -grow.y, 0.0), hi = vec3(1.0 + grow.x, 1.0 + grow.y, depth);
    vec3 p = vec3(pu, 0.0);
    vec3 inv = 1.0 / d;
    vec3 tF = max((lo - p) * inv, (hi - p) * inv);
    float t = min(min(tF.x, tF.y), tF.z);
    vec3 q = p + d * t;
    vec3 rel = (q - lo) / (hi - lo);
    float h1 = fract(rs * 17.31), h2 = fract(rs * 7.77), h3 = fract(rs * 3.13);
    vec3 wallC = h1 < 0.3 ? vec3(0.66, 0.62, 0.55) : h1 < 0.55 ? vec3(0.58, 0.6, 0.6) : h1 < 0.75 ? vec3(0.66, 0.58, 0.46) : vec3(0.52, 0.58, 0.54);
    vec3 c;
    float glow = 0.0;
    if (tF.z <= min(tF.x, tF.y)) {
      // Back wall.
      c = wallC;
      float xb = rel.x, yb = rel.y;
      if (kind < 0.5) {
        // A sofa or a bed, a picture, a bookcase, sometimes a doorway into the next room.
        float sofa = step(0.06, yb) * step(yb, 0.3) * step(0.15 + h3 * 0.2, xb) * step(xb, 0.5 + h3 * 0.2);
        c = mix(c, h2 < 0.5 ? vec3(0.22, 0.26, 0.34) : vec3(0.42, 0.27, 0.2), sofa);
        float pic = step(0.46, yb) * step(yb, 0.64) * step(0.25 + h3 * 0.3, xb) * step(xb, 0.4 + h3 * 0.3);
        c = mix(c, vec3(0.2, 0.28, 0.36) + vec3(h1, h2, h3) * 0.25, pic);
        float books = step(0.04, xb) * step(xb, 0.14) * step(yb, 0.86) * step(0.45, h1);
        c = mix(c, vec3(0.3, 0.2, 0.14) * (0.7 + 0.6 * step(0.5, fract(yb * 9.0))) * (0.8 + 0.4 * step(0.5, fract(xb * 60.0))), books);
        float door = step(0.76, xb) * step(xb, 0.9) * step(yb, 0.8) * step(0.5, h2);
        c = mix(c, c * 0.4, door);
      } else if (kind < 1.5) {
        // Office: a row of desks with monitors, a low partition, a whiteboard.
        float desk = step(0.22, yb) * step(yb, 0.27);
        float mon = step(0.27, yb) * step(yb, 0.4) * step(0.3, fract(xb * 4.0 + h3)) * step(fract(xb * 4.0 + h3), 0.62);
        float part = step(yb, 0.22) * step(0.12, yb);
        c = mix(c, vec3(0.42, 0.43, 0.45), part);
        c = mix(c, vec3(0.55, 0.5, 0.42), desk);
        c = mix(c, vec3(0.05, 0.06, 0.08), mon);
        glow += mon * 0.25;
        float board = step(0.45, yb) * step(yb, 0.7) * step(0.6, xb) * step(xb, 0.9) * step(0.5, h1);
        c = mix(c, vec3(0.86), board);
      } else if (kind < 2.5) {
        // Shop: shelves of goods in rows, colorful.
        float row = step(0.18, fract(yb * 4.5));
        vec3 goods = vec3(0.4 + 0.4 * fract(floor(xb * 14.0) * 0.37 + rs), 0.35 + 0.4 * fract(floor(xb * 14.0) * 0.71 + yb), 0.3 + 0.4 * fract(floor(xb * 14.0) * 0.13));
        c = mix(vec3(0.75, 0.74, 0.7), goods, row * step(yb, 0.85));
      } else if (kind < 3.5) {
        // Boutique: white walls, a rail of clothes, a framed display.
        c = vec3(0.74, 0.73, 0.71);
        float rail = step(0.2, yb) * step(yb, 0.62) * step(0.1, xb) * step(xb, 0.75);
        float garment = step(0.35, fract(xb * 26.0)) * rail;
        c = mix(c, vec3(0.2 + 0.6 * fract(floor(xb * 26.0) * 0.61), 0.2 + 0.5 * fract(floor(xb * 26.0) * 0.27), 0.25 + 0.5 * fract(floor(xb * 26.0) * 0.83)), garment);
        c = mix(c, vec3(0.15), step(abs(yb - 0.64), 0.008) * step(0.1, xb) * step(xb, 0.75));
      } else if (kind < 4.5) {
        // Restaurant: dark wood paneling, a bar with bottles, tables with white cloths.
        c = vec3(0.3, 0.2, 0.13);
        float bar = step(0.6, xb) * step(yb, 0.36);
        c = mix(c, vec3(0.18, 0.11, 0.07), bar);
        float bottles = step(0.6, xb) * step(0.45, yb) * step(yb, 0.62) * step(0.45, fract(xb * 40.0));
        c = mix(c, vec3(0.35, 0.5, 0.3) + 0.3 * fract(floor(xb * 40.0) * 0.37), bottles);
        float mirror = step(0.6, xb) * step(0.66, yb) * step(yb, 0.85);
        c = mix(c, vec3(0.5, 0.45, 0.38), mirror);
        float table = step(0.26, yb) * step(yb, 0.3) * step(xb, 0.55) * step(0.3, fract(xb * 4.0));
        c = mix(c, vec3(0.92, 0.9, 0.86), table);
      } else {
        // Lobby: pale stone walls, a reception desk, a big artwork.
        c = vec3(0.66, 0.62, 0.55);
        float desk = step(0.3, xb) * step(xb, 0.7) * step(yb, 0.3);
        c = mix(c, vec3(0.25, 0.2, 0.16), desk);
        float art = step(0.45, yb) * step(yb, 0.8) * step(0.35, xb) * step(xb, 0.65);
        c = mix(c, vec3(0.2 + 0.4 * h1, 0.3 + 0.3 * h2, 0.4 + 0.3 * h3), art);
      }
    } else if (tF.y <= tF.x) {
      if (d.y > 0.0) {
        // Ceiling, with a light fixture (office: a grid of panels).
        c = vec3(0.8, 0.79, 0.76);
        if (kind > 3.5 && kind < 4.5) {
          c = vec3(0.25, 0.18, 0.12);
          vec2 g = fract(vec2(q.x * 0.9, q.z * 0.7)) - 0.5;
          glow += (1.0 - smoothstep(0.05, 0.12, length(g))) * 2.0;
        } else if (kind > 0.5) {
          vec2 g = fract(vec2(q.x * 1.3, q.z * 1.1));
          float panel = step(0.15, g.x) * step(g.x, 0.55) * step(0.2, g.y) * step(g.y, 0.8);
          glow += panel * (kind > 1.5 ? 1.6 : 1.0);
        } else {
          glow += (1.0 - smoothstep(0.05, 0.14, length(vec2(rel.x - 0.5, rel.z - 0.45)))) * 1.4;
        }
      } else {
        // Floor: wood boards, a rug, office carpet.
        c = kind > 4.5 ? vec3(0.62, 0.6, 0.56) : kind > 3.5 ? vec3(0.22, 0.14, 0.09) : kind > 2.5 ? vec3(0.66, 0.64, 0.6) : kind > 0.5 ? vec3(0.24, 0.26, 0.29) : h2 < 0.6 ? vec3(0.36, 0.23, 0.14) : vec3(0.5, 0.46, 0.4);
        if (kind < 0.5) {
          c *= 0.88 + 0.12 * step(0.5, fract(q.x * 3.5));
          float rug = step(0.25, rel.x) * step(rel.x, 0.75) * step(0.2, rel.z) * step(rel.z, 0.7) * step(0.4, h3);
          c = mix(c, vec3(0.5, 0.2, 0.18) * (0.8 + 0.4 * h1), rug);
        }
      }
    } else {
      // Side walls: shelving in shops, a cabinet or doorway at home, glass partitions in offices.
      c = wallC * 0.86;
      float yb = rel.y, zb = rel.z;
      if (kind > 2.5) {
        c = kind < 3.5 ? vec3(0.84, 0.83, 0.81) : kind < 4.5 ? vec3(0.32, 0.22, 0.15) * (0.85 + 0.3 * step(0.5, fract(zb * 6.0))) : vec3(0.74, 0.7, 0.62);
        if (kind < 3.5) {
          // Boutique: garments hanging along the side walls too, and shelves of folded stock above them.
          float rail = step(0.22, yb) * step(yb, 0.6) * step(0.1, zb) * step(zb, 0.92);
          float gi = floor(zb * 22.0);
          float garment = step(0.3, fract(zb * 22.0)) * rail * step(0.15, fract(gi * 0.53 + rs));
          c = mix(c, vec3(0.18 + 0.6 * fract(gi * 0.61 + rs), 0.18 + 0.5 * fract(gi * 0.27), 0.22 + 0.5 * fract(gi * 0.83)), garment);
          float shelf = step(0.7, yb) * step(yb, 0.82) * step(0.1, zb) * step(zb, 0.92) * step(0.25, fract(zb * 9.0));
          c = mix(c, vec3(0.55, 0.5, 0.46) * (0.7 + 0.5 * fract(floor(zb * 9.0) * 0.37 + rs)), shelf);
        } else if (kind > 4.5) {
          // Lobby: stone panels, a long bench, artwork.
          c *= 0.9 + 0.1 * step(0.02, fract(zb * 4.0)) * step(0.02, fract(yb * 3.0));
          c = mix(c, vec3(0.2, 0.17, 0.15), step(0.1, yb) * step(yb, 0.18) * step(0.2, zb) * step(zb, 0.7));
          c = mix(c, vec3(0.25 + 0.4 * h2, 0.3 + 0.3 * h3, 0.38 + 0.3 * h1), step(0.42, yb) * step(yb, 0.75) * step(0.35, zb) * step(zb, 0.6));
        }
      } else if (kind > 1.5) {
        float row = step(0.18, fract(yb * 4.5)) * step(yb, 0.85) * step(0.08, zb);
        vec3 goods = vec3(0.4 + 0.4 * fract(floor(zb * 16.0) * 0.37 + rs), 0.35 + 0.4 * fract(floor(zb * 16.0) * 0.71 + yb), 0.3 + 0.4 * fract(floor(zb * 16.0) * 0.13 + h1));
        c = mix(vec3(0.72, 0.71, 0.67), goods, row);
      } else if (kind > 0.5) {
        float pane = step(0.12, yb) * step(yb, 0.8) * step(0.5, fract(zb * 3.0 + h2));
        c = mix(c, vec3(0.3, 0.34, 0.38), pane * 0.6);
      } else {
        float cab = step(yb, 0.45) * step(0.3 + h3 * 0.3, zb) * step(zb, 0.6 + h3 * 0.3);
        c = mix(c, h1 < 0.5 ? vec3(0.42, 0.3, 0.2) : vec3(0.75, 0.74, 0.7), cab);
        float frame = step(0.55, yb) * step(yb, 0.75) * step(0.15, zb) * step(zb, 0.3) * step(0.5, h3);
        c = mix(c, vec3(0.3, 0.36, 0.42), frame);
      }
    }
    // Daylight through the window fades into the room; lamps light it at night (and offices all day).
    float fall = 1.0 - 0.6 * rel.z;
    vec3 light = vec3(0.15, 0.155, 0.16) * day * fall;
    // At night a lamp hangs in the room: bright under it, falling off into the corners.
    vec3 lampP = vec3(0.35 + 0.3 * h2, 0.82, 0.35 + 0.3 * h3);
    vec3 dl = (rel - lampP) * vec3(1.0, 0.7, 0.8);
    float pool = 0.1 + 0.6 / (1.0 + 9.0 * dot(dl, dl));
    vec3 warm = kind > 0.5 && kind < 1.5 ? vec3(0.92, 0.97, 1.05) : vec3(1.0, 0.76, 0.5);
    light += lit * warm * (kind > 0.5 ? 0.45 + 0.2 * (1.0 - rel.z) : pool);
    // Some living rooms flicker blue with a TV.
    if (kind < 0.5 && h1 > 0.82) light += lit * vec3(0.2, 0.3, 0.55) * 0.35;
    return c * light + glow * lit * vec3(1.0, 0.92, 0.8) * 0.35;
  }
`;

/**
 * Sign lettering: stroke letters (A E F H I L N O T U …) built from a few bars, so a sign band reads
 * as a word from across the street. Each letter is picked by hash from a small alphabet.
 */
const LETTERS = /* glsl */ `
  float owSeg(vec2 q, float id, float sw, float sh, float a) {
    // id: 0 left, 1 right, 2 middle, 3 top, 4 center bar, 5 bottom, 6 diagonal, 7 other diagonal.
    float d = id < 0.5 ? q.x - sw : id < 1.5 ? (1.0 - sw) - q.x : id < 2.5 ? abs(q.x - 0.5) - sw * 0.5
            : id < 3.5 ? (1.0 - sh) - q.y : id < 4.5 ? abs(q.y - 0.5) - sh * 0.5 : id < 5.5 ? q.y - sh
            : id < 6.5 ? abs((1.0 - q.y) - q.x) * 0.7 - sw * 0.5 : abs(q.y - q.x) * 0.7 - sw * 0.5;
    return 1.0 - smoothstep(-a, a, d);
  }
  float owLetters(vec2 p, float h, float seed, float px) {
    float lh = h * 0.62, lw = lh * 0.66, cw = lw * 1.32;
    float y = (p.y - (h - lh) * 0.5) / lh;
    if (y < 0.0 || y > 1.0 || p.x < 0.0) return 0.0;
    float ci = floor(p.x / cw);
    vec2 q = vec2((p.x - ci * cw) / lw, y);
    if (q.x > 1.0) return 0.0;
    float word = step(0.16, eh21(vec2(ci * 1.7, seed * 13.0)));
    float a = px / lw * 0.9 + 0.01;
    float sw = 0.2, sh = 0.15;
    // Masks over the segments (bit k = segment k): A E F H I L N O T U C D X Y.
    float pick = floor(eh21(vec2(ci * 3.1 + seed * 5.0, seed * 17.0)) * 14.0);
    float m = pick < 0.5 ? 27.0 : pick < 1.5 ? 57.0 : pick < 2.5 ? 25.0 : pick < 3.5 ? 19.0 : pick < 4.5 ? 44.0
            : pick < 5.5 ? 33.0 : pick < 6.5 ? 67.0 : pick < 7.5 ? 43.0 : pick < 8.5 ? 12.0 : pick < 9.5 ? 35.0
            : pick < 10.5 ? 41.0 : pick < 11.5 ? 43.0 : pick < 12.5 ? 192.0 : 57.0;
    float on = 0.0;
    for (int k = 0; k < 8; k++) {
      if (mod(floor(m / exp2(float(k))), 2.0) > 0.5) on = max(on, owSeg(q, float(k), sw, sh, a));
    }
    // Far away: the average coverage, not shimmering strokes.
    return mix(on, 0.4, smoothstep(0.05, 0.12, px / lw)) * word;
  }
`;

/**
 * Street level by kind (from the map's points of interest): shops, a restaurant, a bodega, a bank,
 * a boutique, a lobby. Glass with mullions, a colored sign band with lettering, a dark frieze. Writes
 * the color into c where zone > 0, returns the lit-glass mask and the point on the pane (for rooms).
 */
const SHOPFRONT = /* glsl */ `
  float shopfront(float u, float v, float W, float zone, float groundH, float seed, float gk, vec3 stoneC, float px, inout vec3 c, inout vec2 spu, inout float sDepth, inout float sKind) {
    if (zone < 0.5) return 0.0;
    // Each 7.5 m run of frontage is its own business; most follow the building's kind.
    float grp = floor(u / 7.5);
    float r = eh21(vec2(grp + seed * 13.0, seed * 29.0));
    float k = gk;
    if (gk < 1.5 && gk > 0.5) k = r < 0.45 ? 1.0 : r < 0.7 ? 3.0 : r < 0.88 ? 4.0 : 6.0;
    else if (r > 0.72 && gk > 2.5 && gk < 6.5 && gk != 5.0) k = r < 0.86 ? 1.0 : 3.0;
    float gu = u - grp * 7.5;
    if (k > 1.5 && k < 2.5 || k > 6.5) {
      // Lobby / hotel: stone cladding, tall windows every bay, a glass entrance in the middle of the wall.
      vec3 o = stoneC * 0.82;
      float join = 1.0 - smoothstep(0.015, 0.015 + px, abs(fract(v / 0.75) - 0.5) - 0.48);
      o *= 0.94 + 0.06 * join;
      float bay = fract(u / 2.4);
      float win = step(0.2, bay) * step(bay, 0.8) * step(0.45, v) * step(v, groundH - 0.7);
      float door = step(abs(u - W * 0.5), 1.4) * step(v, min(3.0, groundH - 0.5));
      float glass = max(win, door);
      float frame = max(step(abs(fract(u / 2.4) - 0.2), 0.03 + px), step(abs(fract(u / 2.4) - 0.8), 0.03 + px)) * step(0.45, v) * step(v, groundH - 0.7) * (1.0 - door);
      o = mix(o, vec3(0.03, 0.035, 0.04), glass);
      o = mix(o, vec3(0.42, 0.34, 0.2), frame);                          // brass frames
      o = mix(o, vec3(0.42, 0.34, 0.2), door * step(abs(fract(u * 0.8) - 0.5), 0.03 + px));
      spu = vec2(door > 0.5 ? (u - W * 0.5 + 1.4) / 2.8 : (bay - 0.2) / 0.6, door > 0.5 ? v / 3.0 : (v - 0.45) / (groundH - 1.15));
      sDepth = 4.0; sKind = 5.0;
      c = o;
      return glass;
    }
    if (k > 4.5 && k < 5.5) {
      // Bank: stone, tall round-headed windows, the name cut into a band.
      vec3 o = stoneC;
      float rust = 1.0 - smoothstep(0.02, 0.02 + px, abs(fract(v / 0.6) - 0.5) - 0.46);
      o *= 0.9 + 0.1 * rust;
      float bay = fract(u / 3.2) * 3.2 - 1.6;
      float top = groundH - 1.3, rr = 0.75;
      float win = step(abs(bay), rr) * step(0.6, v) * (v < top - rr ? 1.0 : 1.0 - step(rr, length(vec2(bay, v - (top - rr)))));
      o = mix(o, vec3(0.03, 0.035, 0.04), win);
      float name = owLetters(vec2(u - W * 0.3, v - (groundH - 1.05)), 0.5, seed + 3.0, px) * step(abs(u - W * 0.5), W * 0.2);
      o = mix(o, o * 0.45, name);
      spu = vec2((bay + rr) / (2.0 * rr), (v - 0.6) / (top - 0.6));
      sDepth = 5.0; sKind = 5.0;
      c = o;
      return win;
    }
    // Shops, restaurants, bodegas, boutiques: glass in a frame, a sign band, a frieze.
    float bandBot = groundH - 1.15, bandTop = groundH - 0.7;
    float mullW = k > 2.5 && k < 3.5 ? 0.9 : k > 5.5 ? 2.5 : 1.6;
    float glassZone = step(0.12, v) * step(v, bandBot);
    float mu = fract(u / mullW);
    float mull = 1.0 - smoothstep(0.035, 0.035 + px / mullW * 1.2, min(mu, 1.0 - mu));
    float transom = (1.0 - smoothstep(0.05, 0.05 + px * 1.2, abs(v - (bandBot - 0.9)))) * step(k, 5.5);
    float shop = glassZone * (1.0 - max(mull, transom));
    float signBand = step(bandBot, v) * step(v, bandTop);
    float frieze = step(bandTop, v) * step(v, groundH);
    float sk = eh21(vec2(grp + seed * 13.0, seed * 7.0));
    vec3 signC = sk < 0.17 ? vec3(0.62, 0.12, 0.14) : sk < 0.34 ? vec3(0.1, 0.42, 0.26) : sk < 0.5 ? vec3(0.12, 0.26, 0.56)
               : sk < 0.66 ? vec3(0.78, 0.34, 0.1) : sk < 0.83 ? vec3(0.08, 0.42, 0.46) : vec3(0.42, 0.12, 0.24);
    vec3 frameC = vec3(0.05, 0.06, 0.08), letterC = vec3(0.92, 0.9, 0.84);
    if (k > 2.5 && k < 3.5) { signC = vec3(0.05, 0.05, 0.05) + signC * 0.15; frameC = vec3(0.13, 0.08, 0.05); letterC = vec3(0.78, 0.6, 0.3); }
    else if (k > 3.5 && k < 4.5) { signC = sk < 0.3 ? vec3(0.85, 0.65, 0.08) : sk < 0.6 ? vec3(0.7, 0.08, 0.06) : sk < 0.8 ? vec3(0.06, 0.4, 0.14) : vec3(0.06, 0.16, 0.5); letterC = sk < 0.3 ? vec3(0.6, 0.05, 0.04) : vec3(0.95); }
    else if (k > 5.5) { signC = vec3(0.02); frameC = vec3(0.02); letterC = vec3(0.9); }
    vec3 o = c;
    o = mix(o, frameC, glassZone * (1.0 - shop));                   // mullions and transom
    o = mix(o, vec3(0.03, 0.035, 0.045), shop);                     // glass (the room behind is added as light)
    o = mix(o, signC, signBand);
    // The shop's name: letters across the middle of the band.
    float lx = gu - (7.5 * 0.5 - 2.6 + 0.6 * sk);
    if (signBand > 0.5) {
      float letters = owLetters(vec2(lx, v - bandBot), bandTop - bandBot, seed * 3.0 + grp, px) * step(lx, 5.2 - 1.2 * sk);
      o = mix(o, letterC, letters);
    }
    o = mix(o, vec3(0.06, 0.075, 0.09), frieze);
    // Bodegas: posters in the windows, a roll-down gate housing over the glass.
    if (k > 3.5 && k < 4.5) {
      vec2 pc = floor(vec2(u / 0.55, v / 0.7));
      float poster = step(0.72, eh21(pc + seed)) * step(0.4, v) * step(v, 2.0) * shop;
      o = mix(o, vec3(0.8, 0.75, 0.6) * (0.6 + 0.4 * eh21(pc * 3.1)), poster);
      shop *= 1.0 - poster;
    }
    o = mix(o, vec3(0.08, 0.085, 0.09), step(v, 0.12));            // a dark base under the glass
    spu = vec2(mu, (v - 0.12) / max(0.5, bandBot - 0.12));
    sDepth = 4.0 * (mullW / 1.6); sKind = k > 2.5 && k < 3.5 ? 4.0 : k > 5.5 ? 3.0 : 2.0;
    c = o;
    return shop;
  }
`;

/** Bump-map a surface from a procedural height's screen-space derivatives (three's perturbNormalArb). */
const BUMP = /* glsl */ `
  vec3 facadeBump(vec3 pos, vec3 n, vec2 dH, float fd) {
    vec3 sx = normalize(dFdx(pos)), sy = normalize(dFdy(pos));
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1) * fd;
    vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
    return normalize(abs(det) * n - grad);
  }
`;

/**
 * Procedural facades from per-vertex facade coordinates (aFac = along-wall meters, height above the
 * building's ground, wall length (0 flat roof, -1 pitched roof, -2 gable end), building height) and a
 * per-building seed (aSeed, see facades.ts encodeSeed: style, glass, street-level kind). Each style
 * (facades.ts) sets floor heights, window shapes, trim and materials; windows look into rooms.
 * Vertex colors are authored in sRGB and linearized here.
 */
export function buildingMaterial() {
  if (buildingMat) return buildingMat;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.uniforms.uRooms = facadeQuality.uRooms;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFac; attribute float aSeed; varying vec4 vFac; flat varying float vSeed; varying float vWy; varying vec3 vWp; varying vec3 vWn;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFac = aFac; vSeed = aSeed; vWp = (modelMatrix * vec4(position, 1.0)).xyz; vWy = vWp.y; vWn = mat3(modelMatrix) * normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uRooms; varying vec4 vFac; flat varying float vSeed; varying float vWy; varying vec3 vWp; varying vec3 vWn;
        ${NOISE}
        ${BUMP}
        ${LETTERS}
        ${SHOPFRONT}
        ${ROOMS}
        float fMin, fMax, gMin, gMax, plinth, bMin, bMax, wwMin, wwMax, whMin, whMax, archP, lintel, pier, baseFloors, brick, ribbon, shutters, balcony, mansard, sash, ground0;
        vec3 frameC, trimC, baseC;
        void styleParams(float st) {
          ${styleGlsl()}
        }
        /** The view ray in a wall's frame (x along the wall, y up, z into the building), unnormalized units: meters. */
        vec3 wallRay() {
          vec3 V = normalize(vWp - cameraPosition);
          vec3 N = normalize(vec3(vWn.x, 0.0, vWn.z));
          vec3 T = vec3(N.z, 0.0, -N.x);
          return vec3(dot(V, T), V.y, max(-dot(V, N), 0.02));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Decode the seed: fraction = this building's seed, +2 glass, +4 per style, +128 per street-level kind.
        float gk = floor(vSeed / 128.0);
        float rs1 = vSeed - gk * 128.0;
        float st = floor(rs1 / 4.0);
        float rs2 = rs1 - st * 4.0;
        float glassB = step(1.5, rs2);
        float seed = fract(rs2);
        float u = vFac.x, v = vFac.y, W = vFac.z, Hh = vFac.w;
        float isWall = step(0.5, W);
        float isPitch = step(-1.5, W) * step(W, -0.5);
        vec3 base = pow(diffuseColor.rgb, vec3(2.2)); // authored in sRGB
        // How big one pixel is on the wall: fades fine detail out before it can shimmer.
        float px = max(fwidth(u), fwidth(v));
        float day = 1.0 - uNight;
        float win = 0.0; float lit = 0.0; float litTint = 0.0; float shopLit = 0.0; float rough = 0.9; float metal = 0.0; float hgt = 0.0; float signLit = 0.0;
        vec3 roomE = vec3(0.0);
        if (isWall > 0.5) {
          vec3 R = wallRay();
          if (glassB > 0.5) {
            // Curtain wall, one of three systems: a mullion grid with spandrel bands, ribbon windows
            // between deep spandrels, or vertical fins over continuous glass.
            float sys = floor(fract(seed * 41.3) * 3.0);
            float floorH = 3.9;
            float paneW = sys < 0.5 ? 1.5 : sys < 1.5 ? 3.0 : 1.2;
            float fv = v / floorH;
            float fu = u / paneW;
            float mw = sys > 1.5 ? 0.09 : 0.03;
            float mull = step(fract(fu), mw * 0.5) + step(1.0 - mw * 0.5, fract(fu));
            float spH = sys < 0.5 ? 0.16 : sys < 1.5 ? 0.4 : 0.08;
            float spandrel = step(fract(fv), spH);
            vec2 pane = vec2(floor(fu), floor(fv));
            float farG = smoothstep(0.08, 0.3, px);
            float pr = mix(eh21(pane + seed * 91.0), 0.5, farG);
            vec3 glassC = mix(vec3(0.5, 0.62, 0.82), base, 0.3) * (0.85 + 0.3 * pr);
            vec3 frameCol = sys > 1.5 ? base * 0.5 + 0.08 : vec3(0.12, 0.125, 0.13);
            vec3 spandC = sys < 1.5 ? base * 0.18 + vec3(0.015) : base * 0.3;
            spandrel = mix(spandrel, spH, farG);
            vec3 c = mix(glassC, spandC, spandrel);
            c = mix(c, frameCol, clamp(mull, 0.0, 1.0) * (1.0 - smoothstep(0.08, 0.2, px)));
            diffuseColor.rgb = c;
            win = (1.0 - clamp(mull + spandrel, 0.0, 1.0));
            rough = mix(0.5, mix(0.04 + pr * 0.06, 0.32, farG), win);
            // Vision glass: reflective, but up close you see into the offices.
            float near = (1.0 - smoothstep(0.025, 0.06, px / paneW)) * uRooms;
            metal = win * mix(1.0, 0.55, near);
            hgt = -mull * (sys > 1.5 ? 0.12 : 0.02);
            // Every pane sits a hair out of true (real curtain walls do), so the sky and the towers
            // across the street reflect broken up pane by pane, not as one flawless mirror.
            float tilt = (1.0 - farG) * (1.0 - clamp(mull, 0.0, 1.0)) * (1.0 - step(fract(fv), spH));
            hgt += tilt * ((pr - 0.5) * 0.07 * (fract(fu) - 0.5) * paneW + (eh21(pane + 7.3) - 0.5) * 0.05 * (fract(fv) - 0.5) * floorH);
            float hs = eh21(pane + vec2(seed * 57.0, 3.0));
            float on = step(0.7, hs) * step(1.0, v) * (0.35 + 0.65 * fract(hs * 17.3));
            lit = win * on;
            litTint = fract(hs * 31.7);
            // A lobby / shop base at street level.
            float gH = step(7.0, Hh) * mix(4.8, 5.6, fract(seed * 3.31));
            float base0 = step(v, gH) * step(7.0, Hh) * step(3.0, W);
            vec3 cb = diffuseColor.rgb;
            vec2 spu = vec2(0.5); float sDepth = 4.0, sKind = 2.0;
            shopLit = shopfront(u, v, W, base0, gH, seed, gk > 0.5 ? gk : 2.0, vec3(0.5, 0.5, 0.5), px, cb, spu, sDepth, sKind);
            diffuseColor.rgb = mix(diffuseColor.rgb, cb, base0);
            win *= 1.0 - base0; metal *= 1.0 - base0; lit *= 1.0 - base0;
            // Plate glass at street level mirrors the street by day (the shop behind is darker than outside).
            metal += shopLit * base0 * 0.3 * day;
            rough = mix(rough, mix(0.5, 0.88, 1.0 - shopLit), base0);
            if (win > 0.01 && near > 0.0) {
              vec2 pu = vec2(fract(fu), (fract(fv) - spH) / (1.0 - spH));
              vec3 d = vec3(R.x / paneW, R.y / (floorH * (1.0 - spH)), R.z / paneW);
              float officeLit = step(0.35, hs) * mix(0.55, 1.0, uNight);
              roomE += owRoom(pu, d, vec2(1.5, 0.12), 4.0, hs + seed, 1.0, officeLit, day) * win * near * (1.0 - spandrel) * 0.9;
              lit *= 1.0 - near;
            }
            if (shopLit > 0.01) {
              float nearS = (1.0 - smoothstep(0.03, 0.08, px)) * uRooms;
              roomE += owRoom(spu, vec3(R.x / 1.6, R.y / 3.0, R.z / 1.6), vec2(0.4, 0.1), sDepth, seed + floor(u / 7.5), sKind, mix(0.3, 0.85, uNight), day) * shopLit * nearS * mix(0.42, 1.0, uNight);
              shopLit *= 1.0 - nearS;
            }
          } else {
            styleParams(st);
            float tall = step(7.0, Hh);
            float floorH = mix(fMin, fMax, fract(seed * 7.13));
            float shopH = gk < 0.5 ? 0.0 : (gMax > 0.0 ? mix(gMin, gMax, fract(seed * 3.31)) : mix(4.0, 4.6, fract(seed * 3.31)));
            float groundH = tall * shopH;
            float first = groundH > 0.0 ? groundH : plinth;
            float bayW = mix(bMin, bMax, fract(seed * 5.71));
            // Houses (a raised parlor floor) come in ~6 m lots, each with its door in the first bay.
            float houses = step(0.01, plinth) * step(groundH, 0.0);
            float lots = houses > 0.5 ? max(1.0, floor(W / 6.2 + 0.5)) : 1.0;
            float LW = W / lots;
            float lotI = houses > 0.5 ? min(lots - 1.0, floor(u / LW)) : 0.0;
            float lu = u - lotI * LW;
            float bays = max(1.0, floor((LW - (houses > 0.5 ? 0.4 : 0.9)) / bayW));
            float margin = (LW - bays * bayW) * 0.5;
            float fu = (lu - margin) / bayW;
            float fv = (v - first) / floorH;
            vec2 cell = floor(vec2(fu, fv));
            vec2 fr = fract(vec2(fu, fv));
            float inBays = step(0.0, fu) * step(fu, bays) * step(1.6, W);
            float ribbonOn = step(1.0 - ribbon, fract(seed * 23.7)) * step(0.01, ribbon);
            float ww = mix(wwMin, wwMax, fract(seed * 11.1)) * 0.5, wh = mix(whMin, whMax, fract(seed * 13.7)) * 0.5;
            if (ribbonOn > 0.5) ww = 0.5 - 0.05 / bayW;
            float topLimit = Hh - (mansard > 0.5 ? 0.8 : 1.0);
            float band = step(first + 0.3, v) * step(v, topLimit) * inBays;
            float ax = px / bayW * 1.2, ay = px / floorH * 1.2;
            float dx = abs(fr.x - 0.5), dy = abs(fr.y - 0.5);
            // Round-headed windows (cast iron, some brownstones).
            float archOn = step(fract(seed * 29.3), archP);
            float rr = ww * bayW, topY = (0.5 + wh) * floorH;
            vec2 am = vec2((fr.x - 0.5) * bayW, fr.y * floorH - (topY - rr));
            float archIn = am.y < 0.0 ? 1.0 : 1.0 - smoothstep(rr - px * 1.2, rr + px * 1.2, length(am));
            float archFr = am.y < 0.0 ? 1.0 : 1.0 - smoothstep(rr + 0.07 - px * 1.2, rr + 0.07 + px * 1.2, length(am));
            float paneR = (1.0 - smoothstep(ww - ax, ww + ax, dx)) * (1.0 - smoothstep(wh - ay, wh + ay, dy));
            float frameR = (1.0 - smoothstep(ww + 0.06 - ax, ww + 0.06 + ax, dx)) * (1.0 - smoothstep(wh + 0.07 - ay, wh + 0.07 + ay, dy));
            float pane = paneR * mix(1.0, archIn, archOn) * band;
            float frame = frameR * mix(1.0, archFr, archOn) * band - pane;
            // The door (houses): first bay of each lot, up the stoop at the parlor floor.
            float doorBay = houses * step(cell.x, 0.5) * step(-0.5, cell.x) * step(v, plinth + 2.75) * step(plinth, v);
            float doorX = abs((fr.x - 0.5) * bayW);
            float door = doorBay * step(doorX, 0.6);
            float doorSurround = doorBay * step(doorX, 0.78) * step(v, plinth + 2.95) * (1.0 - door);
            pane *= 1.0 - doorBay; frame *= 1.0 - doorBay;
            float cornice = smoothstep(Hh - 0.6 - px, Hh - 0.6 + px, v);

            vec3 wallC = base * (0.97 + 0.06 * evn(vec2(u, v) * 0.15 + seed * 31.0));
            // Brick: running bond (fades into the wall color with distance).
            float brickOn = step(0.5, brick) * step(fract(seed * 17.9), brick + 0.001);
            if (brickOn > 0.5) {
              float cy = v / 0.076;
              float row = floor(cy);
              float bx = u / 0.23 + 0.5 * mod(row, 2.0);
              float mortar = max(1.0 - smoothstep(0.08, 0.16, fract(cy)), 1.0 - smoothstep(0.03, 0.07, fract(bx)));
              float fine = 1.0 - smoothstep(0.004, 0.012, px);
              float var = eh21(vec2(floor(bx), row) + seed * 11.0);
              wallC *= mix(1.0, (0.9 + 0.2 * var) * (1.0 - mortar) + 1.35 * mortar, fine);
              hgt -= mortar * 0.006 * fine;
            }
            // A stone base: the ground floor and the first floors above it (rusticated).
            float baseZone = step(v, first + baseFloors * floorH - 0.15) * step(0.01, baseFloors + plinth);
            float rust = 1.0 - smoothstep(0.015, 0.015 + px, abs(fract(v / 0.55) - 0.5) - 0.47);
            vec3 baseCol = (baseFloors > 0.5 ? baseC : mix(base, baseC, 0.5) * 0.92) * (0.92 + 0.08 * rust);
            wallC = mix(wallC, baseCol, baseZone);
            hgt -= baseZone * (1.0 - rust) * 0.02;
            // Piers between bays (cast-iron columns with a capital at each floor; Art Deco verticals).
            float pw = 0.07 + 0.08 * pier;
            float pierM = step(0.01, pier) * (1.0 - smoothstep(pw - ax, pw + ax, min(fr.x, 1.0 - fr.x))) * step(first, v) * step(v, Hh - 0.6) * inBays;
            float cap = pierM * (1.0 - smoothstep(0.08, 0.08 + ay, abs(fr.y - 0.97)));
            wallC = mix(wallC, mix(trimC, base * 1.08, 0.5), pierM * 0.6);
            hgt += pierM * 0.06 + cap * 0.04;
            // Deco spandrels: the panel between one floor's window and the next is recessed and dark.
            float spand = step(abs(pier - 0.8), 0.05) * (1.0 - step(ww, dx)) * step(wh, dy) * band;
            wallC = mix(wallC, base * 0.55, spand * 0.7);
            vec3 frameCol = frameC;
            vec3 c = wallC;
            c = mix(c, base * 1.12 + 0.02, cornice);
            // Lintel over the window and a sill under it (a keystone arch for round heads).
            float lw = (ww * bayW + 0.12);
            float lintelY = (fr.y - 0.5 - wh) * floorH;
            float lin = lintel * band * step(abs((fr.x - 0.5) * bayW), lw) * step(0.0, lintelY) * step(lintelY, 0.12 + 0.18 * lintel) * (1.0 - archOn);
            float arcB = lintel * band * archOn * step(0.0, am.y) * step(length(am), rr + 0.2) * (1.0 - archFr);
            float sillY = (fr.y - 0.5 + wh) * floorH;
            float sill = step(0.01, lintel) * band * step(abs((fr.x - 0.5) * bayW), ww * bayW + 0.08) * step(-0.09, sillY) * step(sillY, 0.0) * (1.0 - doorBay);
            float stoneT = clamp(lin + arcB + sill, 0.0, 1.0);
            c = mix(c, trimC, stoneT);
            hgt += stoneT * 0.05;
            // Shutters beside the window (Mediterranean): slatted, often green; some closed.
            float shut = 0.0, closed = 0.0;
            if (shutters > 0.5) {
              float sw = ww * 0.95;
              float sx = dx - ww - 0.02;
              shut = step(0.0, sx) * step(sx, sw) * (1.0 - step(wh + 0.02, dy)) * band;
              float hs2 = eh21(cell + seed * 9.0);
              closed = step(0.72, hs2) * pane;
              vec3 shutC = fract(seed * 5.3) < 0.4 ? vec3(0.12, 0.26, 0.16) : fract(seed * 5.3) < 0.7 ? vec3(0.32, 0.2, 0.12) : vec3(0.36, 0.44, 0.48);
              float slat = 0.85 + 0.15 * step(0.5, fract(fr.y * floorH / 0.07));
              c = mix(c, shutC * slat, max(shut, closed));
            }
            c = mix(c, frameCol, clamp(frame, 0.0, 1.0));
            // Glass: dark; what's behind it is added below as light (a room) or, far away, an average.
            float glassR = eh21(cell + seed * 40.0);
            vec3 glassC = vec3(0.05, 0.065, 0.09) * (0.75 + 0.5 * glassR);
            float blind = step(0.72, glassR) * step(1.0 - mix(0.25, 0.6, fract(glassR * 7.3)), (fr.y - 0.5 + wh) / (2.0 * wh));
            glassC = mix(glassC, vec3(0.5, 0.45, 0.36), blind * 0.7);
            // Glazing bars (sash windows), ribbon mullions.
            vec2 pu = vec2((fr.x - 0.5) / (2.0 * ww) + 0.5, (fr.y - 0.5) / (2.0 * wh) + 0.5);
            float bars = 0.0;
            if (sash > 0.5) {
              // Six-over-six: a vertical bar down the middle, two horizontal bars.
              float tbx = 0.025 / (2.0 * ww * bayW), tby = 0.025 / (2.0 * wh * floorH);
              float fy3 = fract(pu.y * 3.0);
              bars = max(step(abs(pu.x - 0.5), tbx), step(min(fy3, 1.0 - fy3) / 3.0, tby) * step(0.1, pu.y) * step(pu.y, 0.9));
              bars *= 1.0 - smoothstep(0.01, 0.03, px);
            }
            if (ribbonOn > 0.5) bars = max(bars, step(0.5 - 0.03 / 1.2, abs(fract(u / 1.2) - 0.5)));
            float paneG = pane * (1.0 - closed);
            c = mix(c, glassC, paneG);
            c = mix(c, frameCol, paneG * clamp(bars, 0.0, 1.0));
            // Iron balconies: along the 2nd and 5th floors (Haussmann), or small ones at most windows.
            if (balcony > 0.5) {
              float fl = cell.y;
              float bh = (fr.y * floorH);
              float along = balcony < 1.5 ? step(abs(fl - 1.0), 0.1) + step(abs(fl - 4.0), 0.1) : step(dx, ww + 0.08) * step(0.45, eh21(cell + seed * 3.0));
              float rail = clamp(along, 0.0, 1.0) * step(bh, 1.0) * step(0.0, bh) * band * step(1.0, fl + 0.5);
              float baluster = step(0.5, fract(u / 0.11)) * (1.0 - smoothstep(0.85, 0.9, bh)) + step(0.9, bh) + step(bh, 0.08);
              c = mix(c, vec3(0.06, 0.06, 0.065), rail * clamp(baluster, 0.0, 1.0) * (1.0 - smoothstep(0.02, 0.06, px)) + rail * 0.55 * smoothstep(0.02, 0.06, px));
              hgt += rail * 0.08;
            }
            // Zinc mansard top floor.
            float mans = step(0.5, mansard) * step(Hh - floorH - 0.6, v) * step(v, Hh);
            c = mix(c, vec3(0.2, 0.23, 0.27), mans * (1.0 - pane - frame));
            // The front door (houses): painted wood panels, a glass transom, a stone surround.
            if (houses > 0.5) {
              float dc = eh21(vec2(lotI, seed * 7.0));
              vec3 doorC = dc < 0.35 ? vec3(0.12, 0.07, 0.04) : dc < 0.55 ? vec3(0.03, 0.03, 0.03) : dc < 0.75 ? vec3(0.05, 0.16, 0.1) : vec3(0.3, 0.05, 0.04);
              float dv = v - plinth;
              float panel = step(0.06, abs(fract((fr.x - 0.5) * bayW / 0.6 + 0.5) - 0.5)) * step(0.1, fract(dv / 0.75));
              vec3 dcol = doorC * (0.75 + 0.25 * panel);
              float transomD = step(2.3, dv);
              dcol = mix(dcol, vec3(0.04, 0.05, 0.06), transomD);
              c = mix(c, dcol, door);
              c = mix(c, trimC, doorSurround);
              hgt += doorSurround * 0.06 - door * 0.12;
              // Basement windows under the parlor floor.
              float bw = step(0.0, fu) * step(fu, bays) * step(0.35, v) * step(v, plinth - 0.25) * step(abs(fr.x - 0.5), ww * 0.8) * (1.0 - step(cell.x, 0.5) * step(-0.5, cell.x));
              c = mix(c, vec3(0.04, 0.045, 0.05), bw * (0.7 + 0.3 * step(0.5, fract(u / 0.12))));
            }
            // An apartment-house entrance in the middle of a wall without shops: a glass-and-bronze
            // door in a stone surround, a light over it.
            float aptDoor = 0.0;
            if (houses < 0.5 && gk < 0.5 && W >= 6.0 && tall > 0.5) {
              float ib = floor(bays * 0.5);
              float uc = margin + (ib + 0.5) * bayW;
              float ddx = abs(u - uc);
              float inD = step(ddx, 0.75) * step(v, 2.7);
              float sur = step(ddx, 0.98) * step(v, 3.0) * (1.0 - inD);
              float fr2 = step(abs(ddx - 0.72), 0.04) + step(abs(v - 2.25), 0.04) + step(ddx, 0.035);
              c = mix(c, trimC * 0.95, sur);
              c = mix(c, mix(vec3(0.03, 0.035, 0.04), vec3(0.32, 0.24, 0.14), clamp(fr2, 0.0, 1.0)), inD);
              aptDoor = inD * (1.0 - clamp(fr2, 0.0, 1.0));
              paneG *= 1.0 - step(ddx, 1.0) * step(v, first + floorH * 0.99);
              hgt += sur * 0.05 - inD * 0.1;
            }
            // Far away the grid becomes its average color instead of shimmering.
            float paneA = 4.0 * ww * wh, frameA = 4.0 * (ww + 0.06) * (wh + 0.07) - paneA;
            vec3 avgC = wallC * (1.0 - paneA - frameA) + frameCol * frameA + glassC * paneA;
            c = mix(c, mix(wallC, avgC, band), smoothstep(0.1, 0.3, px / min(bayW, floorH)));
            vec2 spu = vec2(0.5); float sDepth = 4.0, sKind = 2.0;
            float shop = shopfront(u, v, W, tall * step(3.0, W) * step(0.5, gk), groundH, seed, gk, trimC, px, c, spu, sDepth, sKind);
            diffuseColor.rgb = c;
            win = clamp(paneG * (1.0 - blind) + shop * 0.3, 0.0, 1.0);
            // Far panes go matte: a sharp sun glint on every distant window reads as noise.
            float farW = smoothstep(0.06, 0.25, px / min(bayW, floorH));
            rough = mix(0.88, mix(0.06, 0.5, farW), paneG) * (1.0 - shop) + shop * mix(0.08, 0.5, farW);
            // Windows sit back in the wall: a reveal around each opening.
            hgt += -paneG * 0.12 + frame * 0.03;
            // Each window's glass is a little out of plane, older panes slightly wavy: reflections waver.
            {
              float gt = eh21(cell + seed * 13.0), gw = eh21(cell + seed * 5.0);
              hgt += paneG * (1.0 - farW) * ((gt - 0.5) * 0.06 * (fr.x - 0.5) * bayW + (gw - 0.5) * 0.04 * (fr.y - 0.5) * floorH
                + 0.0015 * sin(fr.y * floorH * 9.0 + gt * 6.28) * step(0.5, brick + sash));
            }
            float hs = eh21(cell + vec2(seed * 71.0, lotI * 13.0 + floor(u / max(W, 1.0)) * 13.0 + W));
            float on = step(0.62, hs) * (0.35 + 0.65 * fract(hs * 17.3));
            lit = paneG * on * (1.0 - blind * 0.5) * (0.75 + 0.35 * fr.y);
            litTint = fract(hs * 31.7);
            shopLit = shop;
            // Plate glass mirrors the street by day.
            metal = shop * 0.42 * day;
            // Up close: rooms behind the glass, with parallax.
            float near = (1.0 - smoothstep(0.025, 0.06, px / min(bayW, floorH))) * uRooms;
            if (paneG > 0.01 && near > 0.0) {
              vec3 d = vec3(R.x / (2.0 * ww * bayW), R.y / (2.0 * wh * floorH), R.z / (2.0 * ww * bayW));
              float growX = (0.5 - ww) / (2.0 * ww) + 0.7, growY = (0.5 - wh) / (2.0 * wh);
              float kindR = abs(st - 5.0) < 0.5 || abs(st - 7.0) < 0.5 ? 1.0 : 0.0;
              roomE += owRoom(pu, d, vec2(growX, growY), 3.2, hs + seed, kindR, on * uNight, day) * paneG * (1.0 - blind) * near;
              lit *= 1.0 - near;
            }
            if (shop > 0.01) {
              float nearS = (1.0 - smoothstep(0.03, 0.08, px)) * uRooms;
              // By day the shop is dimmer than the street outside (the glass reflects more of the street).
              roomE += owRoom(spu, vec3(R.x / 1.6, R.y / 3.0, R.z / 1.6), vec2(0.4, 0.1), sDepth, seed + floor(u / 7.5), sKind, mix(0.3, 0.85, uNight), day) * shop * nearS * mix(0.42, 1.0, uNight);
              shopLit *= 1.0 - nearS;
            }
            // The lobby behind the entrance door.
            if (aptDoor > 0.01) {
              float ib = floor(bays * 0.5), uc = margin + (ib + 0.5) * bayW;
              roomE += owRoom(vec2((u - uc + 0.75) / 1.5, v / 2.25), vec3(R.x / 1.5, R.y / 2.25, R.z / 1.5), vec2(0.6, 0.2), 4.0, seed + 0.5, 5.0, mix(0.35, 0.8, uNight), day) * aptDoor;
            }
          }
        } else if (isPitch > 0.5) {
          // Tiles / slate in courses, with moss and soot variation.
          float courses = smoothstep(0.08, 0.0, abs(fract(vWy * 3.2) - 0.5) - 0.38);
          vec3 c = base * (0.85 + 0.15 * courses) * (0.85 + 0.3 * evn(vec2(vWy * 3.0, seed * 50.0)));
          c *= 0.85 + 0.3 * eh21(floor(vec2(vWy * 3.2, seed * 9.0)));
          diffuseColor.rgb = c;
          hgt = courses * 0.01;
          rough = 0.75;
        } else if (W > -0.5) {
          // Flat roof: membrane and gravel, ponding stains, a few lighter patches.
          float n1 = evn(vec2(vWy, seed * 40.0) * 2.0);
          diffuseColor.rgb = base * (0.82 + 0.25 * n1);
          rough = 0.95;
        } else {
          // Gable ends (-2), stone trim and canopies (-3), signs (-4), awning canvas (-5, striped -6):
          // the plain material, a little weathered.
          float n1 = evn(vec2(u * 1.3 + vWy * 0.4, vWy * 1.7) + seed * 20.0);
          diffuseColor.rgb = base * (0.88 + 0.2 * n1);
          rough = W < -3.5 ? 0.4 : 0.85;
          signLit = step(W, -3.5);
          if (W < -4.5) {
            // Canvas: a fine weave, cream stripes on striped awnings, matte; the shop's light shows through it after dark.
            float weave = 0.96 + 0.04 * step(0.5, fract(u * 40.0)) * (1.0 - smoothstep(0.004, 0.01, px));
            // The underside is authored darker; its cream stripes are too.
            vec3 cream = vec3(0.74, 0.7, 0.6) * (vWn.y < -0.2 ? 0.3 : 1.0);
            float far = smoothstep(0.08, 0.16, px);
            float stripe = step(W, -5.5) * mix(step(0.5, fract(u / 0.3)), 0.5, far);
            diffuseColor.rgb = mix(base * (0.92 + 0.12 * n1), cream, stripe) * weave;
            rough = 0.95;
            signLit = 0.1;
          }
        }
        float facadeWin = win; float facadeLit = lit; float facadeTint = litTint; float facadeShop = shopLit; float facadeRough = rough; float facadeMetal = metal; float facadeH = hgt; float facadePx = max(px, 0.002); float facadeSign = signLit;
        vec3 facadeRoom = roomE;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = facadeRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = facadeMetal;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Height difference per pixel over the pixel's size on the wall = slope.
          vec2 dH = vec2(dFdx(facadeH), dFdy(facadeH)) / facadePx * 0.35;
          float l = length(dH);
          if (l > 2.5) dH *= 2.5 / l;
          normal = facadeBump(-vViewPosition, normal, dH, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warm = facadeTint < 0.55 ? vec3(1.0, 0.68, 0.38) : facadeTint < 0.85 ? vec3(1.0, 0.86, 0.66) : vec3(0.72, 0.84, 1.0);
        totalEmissiveRadiance += facadeLit * warm * uNight * 0.6;
        // Shop windows glow warm all day (lit interiors), brighter after dark (far away: an average).
        totalEmissiveRadiance += facadeShop * vec3(1.0, 0.82, 0.58) * (0.09 + uNight * 0.92);
        // Rooms behind the glass (seen through it: less where the glass reflects, at grazing angles).
        {
          float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          totalEmissiveRadiance += facadeRoom * (1.0 - fres);
        }
        totalEmissiveRadiance += diffuseColor.rgb * facadeSign * uNight * 2.2;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        ${NEUTRAL_SHADE}`);
  };
  mat.customProgramCacheKey = () => 'earth-building-v13';
  mat.userData.quality = facadeQuality;
  buildingMat = mat;
  return mat;
}

const groundPatch = (sh: THREE.WebGLProgramParametersWithUniforms) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGw;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vGw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.uniforms.uCityGlow = shared.uNight;
  sh.uniforms.uWet = shared.uWet;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGw; uniform float uCityGlow; uniform float uWet;
      ${NOISE}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      float gWetPave = 0.0;
      {
        vec3 c = diffuseColor.rgb;
        float green = smoothstep(0.004, 0.03, c.g - max(c.r, c.b));
        vec2 p = vGw.xz;
        float px = fwidth(p.x);
        float fine = 1.0 - smoothstep(0.05, 0.25, px);
        float n1 = evn(p * 0.045), n2 = evn(p * 0.31), n3 = evn(p * 2.7), n4 = eh21(floor(p * 9.0));
        // Grass: patchy, sun-dried in places, clover-dark in others, blade noise up close.
        vec3 dry = c * vec3(1.25, 1.1, 0.7);
        vec3 lush = c * vec3(0.75, 0.95, 0.75);
        vec3 g = mix(lush, dry, smoothstep(0.35, 0.8, n1 * 0.7 + n2 * 0.3));
        g *= 0.82 + 0.3 * n3 * fine + 0.12 * (1.0 - fine);
        g *= 1.0 - 0.18 * step(0.7, n4) * fine;
        // Paved/urban: concrete and asphalt grime, oil stains, faint slab joints.
        vec3 pv = c * (0.86 + 0.2 * n2 + 0.08 * n3 * fine);
        pv *= 1.0 - 0.25 * smoothstep(0.72, 0.9, evn(p * 0.21 + 5.0));
        vec2 slab = abs(fract(p / 1.8) - 0.5);
        pv *= 1.0 - 0.06 * step(0.48, max(slab.x, slab.y)) * fine;
        // Rain darkens the paving and leaves it glossy; grass just darkens a little.
        gWetPave = uWet * (1.0 - green);
        pv *= mix(1.0, 0.62, uWet);
        g *= mix(1.0, 0.85, uWet);
        c = mix(pv, g, green);
        diffuseColor.rgb = c;
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(0.95, 0.38, gWetPave);`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      ${NEUTRAL_SHADE}
      ${NIGHT_GLOW}`);
};

/** Ground of a detailed chunk: its painted landuse map plus grass and paving detail. */
export function groundMaterial(tex: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xa9c77a, roughness: 0.97, metalness: 0 });
  m.onBeforeCompile = groundPatch;
  m.customProgramCacheKey = () => (tex ? 'earth-ground-map-v2' : 'earth-ground-plain-v2');
  return m;
}

/** Which detailed chunks are loaded, so the far terrain can hide underneath them. */
export const farMask = {
  n: 48,
  tex: null as THREE.DataTexture | null,
  origin: new THREE.Vector2(),
  cell: { value: 1 },
  base: { tx: 0, ty: 0 },
  uOrigin: { value: new THREE.Vector2() },
  uCell: { value: 1 },
  uN: { value: 48 },
  uMask: { value: null as THREE.DataTexture | null },
};

export function farMaterial(tex: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x7d9a62, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = farMask.uMask;
    sh.uniforms.uOrigin = farMask.uOrigin;
    sh.uniforms.uCell = farMask.uCell;
    sh.uniforms.uN = farMask.uN;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFw;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFw; uniform sampler2D uMask; uniform vec2 uOrigin; uniform float uCell; uniform float uN;`)
      .replace('void main() {', `void main() {
        {
          vec2 t = (vFw.xz - uOrigin) / uCell;
          if (t.x >= 0.0 && t.y >= 0.0 && t.x < uN && t.y < uN) {
            float m = texture2D(uMask, (floor(t) + 0.5) / uN).r;
            if (m > 0.5) discard;
          }
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // Satellite imagery as photographed, with a touch of contrast lost to the atmosphere put back.
          vec3 c = diffuseColor.rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.12) * 1.05;
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => `earth-far-${tex ? 1 : 0}`;
  return m;
}

let waterMat: THREE.MeshStandardMaterial | null = null;
const waterT = { value: 0 };
/**
 * Lakes, rivers and the flat sea: two layers of ripples drifting against each other, a lighter
 * teal toward grazing angles (fresnel), and a hot sun glint. The ocean waves reuse it.
 */
export function waterMaterial() {
  if (waterMat) return waterMat;
  const normals = new THREE.TextureLoader().load('/textures/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ color: 0x0e2a36, roughness: 0.04, metalness: 0.0, normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterT = waterT;
    sh.uniforms.uNightW = shared.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWaterT; uniform float uNightW;`)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n1 = texture2D(normalMap, vNormalMapUv + uWaterT * vec2(0.013, 0.009)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vNormalMapUv * 2.3 + uWaterT * vec2(-0.018, 0.012)).xyz * 2.0 - 1.0;
          vec3 mapN = vec3((n1.xy + n2.xy) * 0.5 * normalScale, 1.0);
          normal = normalize(tbn * mapN);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Light scattered up out of the water body: a little green-blue, strongest looking down into it.
          float down = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.006, 0.02, 0.022) * down * (1.0 - uNightW * 0.9);
        }`);
  };
  m.customProgramCacheKey = () => 'earth-water-v3';
  waterMat = m;
  return m;
}
export function updateWater(t: number) {
  waterT.value = t;
}

/** Pull coplanar overlays toward the camera so they never z-fight with the ground. */
export function overlay<T extends THREE.Material>(m: T, layer: number): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -layer;
  m.polygonOffsetUnits = -layer * 2;
  return m;
}

/**
 * Street surfaces, textured procedurally (the meshes carry their own pattern coordinates, see
 * chunk.ts): asphalt with tire-polished lane tracks, utility-cut patches and sealed cracks; concrete
 * sidewalk flags with expansion joints and a granite curb; fresh paint.
 */
function street<T extends THREE.MeshStandardMaterial>(m: T, kind: 'road' | 'walk' | 'paint' | 'deck'): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSw; varying vec2 vSt;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSw = (modelMatrix * vec4(transformed, 1.0)).xyz; vSt = uv;`);
    sh.uniforms.uCityGlow = shared.uNight;
    sh.uniforms.uWet = shared.uWet;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSw; varying vec2 vSt; uniform float uCityGlow; uniform float uWet;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 sp = vSw.xz;
        float spx = fwidth(sp.x);
        float sfine = 1.0 - smoothstep(0.03, 0.2, spx);
        float sRough = roughness;
        {
          vec3 c = diffuseColor.rgb;
          float big = evn(sp * 0.05), mid = evn(sp * 0.4), grit = eh21(floor(sp * 22.0));
          ${kind === 'road' ? `
            // Asphalt: even and clean, fine aggregate up close.
            c *= 0.95 + 0.07 * big + 0.03 * mid;
            c *= 1.0 + (grit - 0.5) * 0.06 * sfine;
            sRough = 0.86;
            float across = vSt.x, width = vSt.y;
            if (across > -0.5 && width > 2.0) {
              // Tire tracks polished darker down each lane, an oil line between them.
              float lanes = max(1.0, floor(width / 3.1 + 0.25)), laneW = width / lanes;
              float lp = fract(across / laneW);
              float track = (1.0 - smoothstep(0.1, 0.24, abs(lp - 0.27) * laneW)) + (1.0 - smoothstep(0.1, 0.24, abs(lp - 0.73) * laneW));
              float oil = 1.0 - smoothstep(0.05, 0.3, abs(lp - 0.5) * laneW);
              c *= 1.0 - 0.07 * clamp(track, 0.0, 1.0) - 0.05 * oil * (0.6 + 0.4 * evn(sp * 0.7));
              sRough -= 0.12 * clamp(track, 0.0, 1.0);
              // The gutter by the curb: a band of older, lighter asphalt.
              float gut = 1.0 - smoothstep(0.35, 0.6, min(across, width - across));
              c *= 1.0 + 0.06 * gut;
            }
            // Utility cuts: rectangular patches of newer (darker) or older (greyer) asphalt with sealed seams.
            {
              vec2 cellP = floor(sp / 9.0), lp2 = sp - cellP * 9.0;
              float hp = eh21(cellP + 3.7);
              if (hp > 0.8) {
                vec2 c0 = vec2(eh21(cellP + 1.1), eh21(cellP + 2.3)) * 4.0 + 0.6;
                vec2 sz = vec2(1.2 + eh21(cellP + 5.1) * 3.4, 0.8 + eh21(cellP + 6.7) * 2.2);
                vec2 dq = abs(lp2 - c0 - sz * 0.5) - sz * 0.5;
                float inP = step(max(dq.x, dq.y), 0.0);
                float seam = 1.0 - smoothstep(0.0, 0.05, abs(max(dq.x, dq.y)));
                c *= mix(1.0, hp > 0.9 ? 0.86 : 1.08, inP);
                c *= 1.0 - 0.3 * seam * sfine;
              }
            }
            // Sealed cracks: thin dark tar lines wandering across the lanes.
            {
              float n = evn(sp * 0.22 + 7.0) * 0.7 + evn(sp * 0.9) * 0.3;
              float crack = 1.0 - smoothstep(0.0, 0.006 + spx * 0.02, abs(n - 0.5));
              c *= 1.0 - 0.35 * crack * sfine * step(0.62, evn(sp * 0.04 + 3.0));
            }
          ` : kind === 'walk' ? `
            // Sidewalk: concrete flags in ~1.5 m squares with expansion joints, a granite curb along
            // the street, a little tone variation between flags.
            float across = vSt.x, along = vSt.y;
            if (across < -1.5) {
              c *= 0.9; // the outer edge
            } else if (across < -0.5) {
              // Curb face: granite.
              c = vec3(0.36, 0.37, 0.39) * (0.9 + 0.12 * mid);
              sRough = 0.7;
            } else if (across < 400.0) {
              float curbW = 0.42;
              if (across < curbW) {
                c = vec3(0.4, 0.41, 0.43) * (0.92 + 0.1 * mid);
                c *= 1.0 - 0.25 * (1.0 - smoothstep(0.004, 0.012 + spx, min(fract(along / 1.8), 1.0 - fract(along / 1.8)) * 1.8)) * sfine;
                sRough = 0.75;
              } else {
                vec2 g = vec2((across - curbW) / 1.52, along / 1.52);
                vec2 fg = fract(g), id = floor(g);
                float joint = 1.0 - smoothstep(0.004, 0.012 + spx, min(min(fg.x, 1.0 - fg.x), min(fg.y, 1.0 - fg.y)) * 1.52);
                float tone = eh21(id + 4.2);
                c *= 0.95 + 0.1 * tone;
                c *= 1.0 - 0.22 * joint * sfine;
                // Score lines: each flag scored into quarters, faintly.
                float score = 1.0 - smoothstep(0.003, 0.008 + spx, min(abs(fg.x - 0.5), abs(fg.y - 0.5)) * 1.52);
                c *= 1.0 - 0.08 * score * sfine;
              }
              sRough = 0.92;
            } else {
              // Plazas and paths: faint slab joints on a world grid.
              c *= 0.96 + 0.06 * big;
              vec2 slab = abs(fract(sp / 1.5) - 0.5);
              c *= 1.0 - 0.05 * step(0.475, max(slab.x, slab.y)) * sfine;
              sRough = 0.92;
            }
          ` : kind === 'paint' ? `
            // Road paint: bright but scuffed by tires, worn thin in patches where the asphalt shows through.
            float wear = smoothstep(0.42, 0.8, evn(sp * 1.1) * 0.55 + evn(sp * 5.0) * 0.3 + grit * 0.15 * sfine);
            c *= 0.88 + 0.06 * mid;
            c = mix(c, vec3(0.2, 0.205, 0.21), wear * 0.55);
            sRough = 0.6 + 0.25 * wear;
          ` : `
            // Concrete deck and piers: weathered, streaky.
            c *= 0.8 + 0.25 * big + 0.1 * mid;
            sRough = 0.9;
          `}
          if (uWet > 0.001) {
            // Rain: the surface darkens as it soaks up water and turns glossy (the sky and the lit
            // windows show in it), and puddles gather in the low spots and along the gutters,
            // mirror-smooth.
            float low = evn(sp * 0.33 + 11.0) * 0.7 + evn(sp * 1.6 + 2.0) * 0.3;
            ${kind === 'road' ? `if (vSt.x > -0.5 && vSt.y > 2.0) low += 0.28 * (1.0 - smoothstep(0.2, 0.9, min(vSt.x, vSt.y - vSt.x)));` : ''}
            float puddle = smoothstep(0.56, 0.66, low) * smoothstep(0.35, 0.95, uWet);
            c *= mix(1.0, ${kind === 'paint' ? '0.78' : '0.5'}, uWet);
            c *= 1.0 - 0.12 * puddle;
            sRough = mix(sRough, ${kind === 'paint' ? '0.26' : '0.24'}, uWet * 0.85);
            sRough = mix(sRough, 0.03, puddle);
          }
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = sRough;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        ${NEUTRAL_SHADE}
        ${NIGHT_GLOW}`);
  };
  m.customProgramCacheKey = () => `earth-street-${kind}-v7`;
  return m;
}

export const MATS = {
  road: overlay(street(new THREE.MeshStandardMaterial({ color: 0x66686d, roughness: 0.9 }), 'road'), 3),
  walk: overlay(street(new THREE.MeshStandardMaterial({ color: 0xaeaca8, roughness: 0.93 }), 'walk'), 2),
  paintW: overlay(street(new THREE.MeshStandardMaterial({ color: 0xececea, roughness: 0.6 }), 'paint'), 5),
  paintY: overlay(street(new THREE.MeshStandardMaterial({ color: 0xd0a43a, roughness: 0.7 }), 'paint'), 5),
  deck: street(new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.88, side: THREE.DoubleSide }), 'deck'),
};

// ---------------------------------------------------------------------------------------------
// Props

function colored(g: THREE.BufferGeometry, top: number, bottom = top) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y, y1 = g.boundingBox!.max.y;
  const a = new THREE.Color(bottom), b = new THREE.Color(top), c = new THREE.Color();
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / Math.max(0.001, y1 - y0);
    c.copy(a).lerp(b, t);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** Seeded random for the tree generators (deterministic, so every chunk shares the same meshes). */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Trees are leaf cards: a few hundred small textured quads scattered through each crown volume,
// alpha-tested against a painted atlas of leaf sprays, with normals bent out from the crown center
// so the crown shades as one soft mass. Atlas: broadleaf sprays | conifer needles | bark | plain.
const ATLAS = { leaf: [0, 0.5], needle: [0.5, 0.875], bark: [0.875, 0.9375], plain: [0.9375, 1] } as const;

function leafAtlas() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const r = rng(7);
  // Broadleaf: overlapping leaves on twigs, lit from above, a midrib on each.
  g.save();
  g.beginPath(); g.rect(0, 0, 256, 256); g.clip();
  g.strokeStyle = '#4a3b2c'; g.lineWidth = 3;
  for (let t = 0; t < 5; t++) {
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(t * 1.3) * 110, 128 + Math.sin(t * 1.3) * 110); g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 18 + Math.sqrt(r()) * 96;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const len = 26 + r() * 18, wid = len * (0.42 + r() * 0.12);
    const hue = 78 + r() * 26, sat = 34 + r() * 22, lit = 22 + r() * 18 + (1 - y / 256) * 8;
    g.save();
    g.translate(x, y); g.rotate(a + (r() - 0.5) * 1.2);
    const grd = g.createLinearGradient(0, -wid / 2, 0, wid / 2);
    grd.addColorStop(0, `hsl(${hue},${sat}%,${lit + 9}%)`);
    grd.addColorStop(1, `hsl(${hue},${sat}%,${lit - 5}%)`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, -wid * 0.75, len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, wid * 0.75, -len / 2, 0);
    g.fill();
    g.strokeStyle = `hsla(${hue},${sat}%,${lit - 9}%,0.7)`; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  g.restore();
  // Conifer: needle sprays along drooping twigs.
  g.save();
  g.beginPath(); g.rect(256, 0, 192, 256); g.clip();
  for (let b = 0; b < 7; b++) {
    const x0 = 262 + r() * 40, y0 = 20 + b * 34 + r() * 10, ang = -0.25 + r() * 0.5;
    for (let s2 = 0; s2 < 26; s2++) {
      const t = s2 / 26, x = x0 + Math.cos(ang) * t * 170, y = y0 + Math.sin(ang) * t * 170 + t * t * 18;
      for (const side of [-1, 1]) {
        const l = 12 + r() * 9, a = ang + side * (0.9 + r() * 0.4);
        g.strokeStyle = `hsl(${100 + r() * 30},${30 + r() * 15}%,${14 + r() * 14}%)`; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  }
  g.restore();
  // Bark: dark grey-brown with vertical fissures. Plain: light grey (vertex colors carry the hue).
  g.fillStyle = '#5a4a3c'; g.fillRect(448, 0, 32, 256);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(30,22,16,${0.2 + r() * 0.3})`; g.fillRect(448 + r() * 32, r() * 256, 1 + r() * 2, 10 + r() * 40); }
  g.fillStyle = '#d9d9d9'; g.fillRect(480, 0, 32, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A part with its UVs squeezed into one atlas column and a flat vertex tint. */
function atlasPart(g: THREE.BufferGeometry, col: readonly [number, number], tint: number) {
  g = g.index ? g.toNonIndexed() : g;
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  const out = new Float32Array(n * 2), c = new THREE.Color(tint), cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 2] = col[0] + 0.004 + (uv ? uv.getX(i) : 0.5) * (col[1] - col[0] - 0.008);
    out[i * 2 + 1] = uv ? uv.getY(i) : 0.5;
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/**
 * Leaf cards through an ellipsoid crown (center c, radii rx/ry), denser toward the outside. Normals
 * point out from the center (plus a little up); vertex colors darken the inner and lower leaves.
 */
function crownCards(r: () => number, c: THREE.Vector3, rx: number, ry: number, count: number, size: number, col: readonly [number, number], droop = 0) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], cols: number[] = [], idx: number[] = [];
  const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), p = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // A point in the shell of the crown.
    d.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (d.lengthSq() < 1e-3) d.set(0, 1, 0);
    d.normalize();
    const rad = 0.5 + 0.5 * Math.sqrt(r());
    p.set(c.x + d.x * rx * rad, c.y + d.y * ry * rad, c.z + d.z * rx * rad);
    // Card facing: mostly outward, twisted at random.
    nn.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).multiplyScalar(0.8).add(d).normalize();
    t1.set(0, 1, 0).cross(nn);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    t2.copy(nn).cross(t1).normalize();
    const s = size * (0.75 + r() * 0.5), h = s / 2;
    const out = new THREE.Vector3(d.x, d.y * 0.7 + 0.3, d.z).normalize();
    const ao = THREE.MathUtils.clamp(0.42 + rad * 0.45 + d.y * 0.18, 0.3, 1.05);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const base = pos.length / 3;
    for (const [a, b] of corners) {
      pos.push(p.x + t1.x * a * h + t2.x * b * h, p.y + t1.y * a * h + t2.y * b * h - (droop * (a + 1)) / 2, p.z + t1.z * a * h + t2.z * b * h);
      uv.push(col[0] + 0.004 + ((a + 1) / 2) * (col[1] - col[0] - 0.008), (b + 1) / 2);
      nrm.push(out.x, out.y, out.z);
      cols.push(ao, ao, ao * 0.97);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  return mergeGeometries(parts.map((q) => {
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) q.deleteAttribute(k);
    if (!q.index) q.setIndex([...Array((q.attributes.position as THREE.BufferAttribute).count).keys()]);
    return q;
  }))!;
}

/** Broadleaf street tree (plane, oak, linden): a forked trunk under an irregular crown of leaf clumps. */
export function lollipopTree(far = false) {
  const r = rng(11);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(atlasPart(new THREE.CylinderGeometry(0.13, 0.24, 3.4, 7, 1, true).translate(0, 1.7, 0), ATLAS.bark, 0xffffff));
  for (const [ax, az] of [[0.5, 0.2], [-0.4, -0.35], [0.1, 0.55]]) {
    const limb = new THREE.CylinderGeometry(0.05, 0.11, 2.4, 5, 1, true).translate(0, 1.2, 0);
    limb.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(az, 0, -ax)));
    limb.translate(0, 2.9, 0);
    parts.push(atlasPart(limb, ATLAS.bark, 0xffffff));
  }
  // Far away: a couple of dozen big cards read the same.
  parts.push(crownCards(r, new THREE.Vector3(0, 5.0, 0), 2.3, 1.9, far ? 20 : 120, far ? 2.5 : 1.25, ATLAS.leaf));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r() * 0.7;
    parts.push(crownCards(r, new THREE.Vector3(Math.cos(a) * 1.3, 4.3 + r() * 1.6, Math.sin(a) * 1.3), 1.2, 1.0, far ? 3 : 26, far ? 1.9 : 1.0, ATLAS.leaf));
  }
  return mergeParts(parts);
}

/** Conifer: a straight trunk under drooping tiers of needle sprays. */
export function coniferTree(far = false) {
  const r = rng(23);
  const parts: THREE.BufferGeometry[] = [atlasPart(new THREE.CylinderGeometry(0.1, 0.22, 7.2, 6, 1, true).translate(0, 3.6, 0), ATLAS.bark, 0xffffff)];
  const tiers: [number, number, number][] = [[1.6, 2.2, 1.0], [2.8, 1.85, 0.9], [4.0, 1.5, 0.85], [5.1, 1.1, 0.75], [6.1, 0.7, 0.6], [6.9, 0.35, 0.45]];
  for (const [y, rr, hh] of tiers) parts.push(crownCards(r, new THREE.Vector3(0, y, 0), rr, hh, far ? Math.round(3 + rr * 2) : Math.round(14 + rr * 22), far ? 1.9 : 1.05, ATLAS.needle, 0.25));
  return mergeParts(parts);
}

/** Palm: a curved ringed trunk and a crown of arching fronds. */
export function palmTree() {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * 7.5, bend = (i / segs) ** 2 * 0.8;
    const seg = new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 7.5 / segs + 0.05, 6, 1, true).translate(bend, y0 + 7.5 / segs / 2, 0);
    parts.push(atlasPart(seg, ATLAS.bark, 0xc8b8a0));
  }
  const top = new THREE.Vector3(0.8, 7.5, 0);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    // A frond: a thin strip arching out and down.
    const pts: number[] = [];
    const n = 6;
    for (let j = 0; j <= n; j++) {
      const t = j / n, len = 3.4 * t;
      const y = Math.sin(t * Math.PI * 0.75) * 0.9 - t * t * 1.6;
      const w = Math.sin(t * Math.PI) * 0.55 + 0.05;
      const cx = top.x + Math.cos(a) * len, cz = top.z + Math.sin(a) * len;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pts.push(cx + px, top.y + y, cz + pz, cx - px, top.y + y - 0.12, cz - pz);
    }
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (let j = 0; j < n; j++) {
      const i0 = j * 6, i1 = (j + 1) * 6;
      const A = pts.slice(i0, i0 + 3), B = pts.slice(i0 + 3, i0 + 6), C = pts.slice(i1, i1 + 3), D = pts.slice(i1 + 3, i1 + 6);
      pos.push(...A, ...B, ...C, ...B, ...D, ...C, ...A, ...C, ...B, ...B, ...C, ...D);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(atlasPart(colored(g, 0x55702f, 0x2e4220), ATLAS.plain, 0xffffff));
    // atlasPart overwrote the frond colors; put the green gradient back.
    const last = parts[parts.length - 1];
    last.setAttribute('color', colored(g.clone(), 0x55702f, 0x2e4220).getAttribute('color'));
  }
  return mergeParts(parts);
}

/**
 * Foliage: alpha-tested leaf cards (kept from thinning out at a distance as the mipmaps blur the
 * alpha), light glowing through thin leaves when backlit, and a slightly waxy sheen.
 */
export const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: !quality.low });
treeMat.map = leafAtlas();
treeMat.onBeforeCompile = (sh) => {
  // Wind: the crown sways (more toward the top, each tree out of step) and the leaves flutter.
  sh.uniforms.uTime = shared.uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      uniform float uTime;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float hh = max(0.0, position.y - 2.4);
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = dot(ip.xz, vec2(0.131, 0.173));
        float sway = sin(uTime * 1.05 + ph) * 0.65 + sin(uTime * 2.2 + ph * 1.7) * 0.3;
        transformed.x += sway * hh * 0.035;
        transformed.z += sway * hh * 0.02;
        transformed += normal * sin(uTime * 5.5 + dot(position, vec3(3.1, 1.7, 2.3)) + ph) * 0.025 * step(2.4, position.y);
      }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      float leafy = smoothstep(0.0, 0.03, diffuseColor.g - diffuseColor.r);
      #ifdef USE_MAP
      {
        vec2 tx = vMapUv * vec2(512.0, 256.0);
        float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
        diffuseColor.a *= 1.0 + mip * 0.3;
      }
      #endif
      float treeLeafy = leafy;`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      // Translucency: sun through the leaves when looking toward it.
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 L = directionalLights[0].direction;
        float back = pow(clamp(dot(-normalize(vViewPosition), L), 0.0, 1.0), 3.0);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * back * 0.3 * treeLeafy;
      }
      #endif
      ${NEUTRAL_SHADE}`);
};
treeMat.customProgramCacheKey = () => 'earth-tree-v5';

export function lampGeometries() {
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.08, 0.12, 7.5, 7).translate(0, 3.75, 0),
    new THREE.BoxGeometry(0.07, 0.07, 2.2).translate(0, 7.4, 1.1),
  ])!;
  const head = new THREE.BoxGeometry(0.45, 0.16, 0.8).translate(0, 7.32, 2.1);
  return { pole, head };
}

/** Ground under a street lamp: illuminance from a lamp 7.3 m up ((1 + (d/h)²)^-1.5), out to 15 m. Grey levels, no alpha. */
export function lampPoolTexture() {
  const N = 128, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2) * 15;
    const v = (1 + (d / 7.3) ** 2) ** -1.5 * (1 - THREE.MathUtils.smoothstep(d, 11, 15));
    const k = (j * N + i) * 4, c = Math.round(255 * v);
    img.data[k] = img.data[k + 1] = img.data[k + 2] = c; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

/** Street furniture by kind: bench, litter bin, fire hydrant, manhole cover, mailbox (vertex-colored, origin on the ground). */
export function propGeometries() {
  const part = (g: THREE.BufferGeometry, c: number) => colored(g, c);
  const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((p) => { for (const k of ['uv']) if (p.attributes[k]) p.deleteAttribute(k); return p; }))!;
  const iron = 0x262728, wood = 0x7a5b3e;
  const bench = merge([
    ...[-0.16, 0, 0.16].map((z) => part(new THREE.BoxGeometry(1.8, 0.045, 0.12).translate(0, 0.46, z + 0.02), wood)),
    ...[0.62, 0.78].map((y) => part(new THREE.BoxGeometry(1.8, 0.1, 0.035).translate(0, y, -0.23), wood)),
    ...[-0.78, 0.78].flatMap((x) => [part(new THREE.BoxGeometry(0.06, 0.46, 0.5).translate(x, 0.23, 0), iron), part(new THREE.BoxGeometry(0.06, 0.45, 0.05).translate(x, 0.66, -0.24), iron)]),
  ]);
  const bin = merge([
    part(new THREE.CylinderGeometry(0.27, 0.24, 0.9, 12).translate(0, 0.45, 0), 0x2f3a32),
    part(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 12).translate(0, 0.92, 0), 0x1f2620),
  ]);
  const hydrant = merge([
    part(new THREE.CylinderGeometry(0.11, 0.13, 0.55, 10).translate(0, 0.3, 0), 0x9c2a1f),
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10).translate(0, 0.05, 0), 0x8a2419),
    part(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.57, 0), 0x9c2a1f),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8).rotateZ(Math.PI / 2).translate(0, 0.38, 0), 0x8f8c84),
  ]);
  const manhole = part(new THREE.CylinderGeometry(0.36, 0.37, 0.02, 12, 1, true).translate(0, 0.01, 0), 0x2c2b29);
  const lid = part(new THREE.CircleGeometry(0.36, 12).rotateX(-Math.PI / 2).translate(0, 0.02, 0), 0x2c2b29);
  const mailbox = merge([
    part(new THREE.BoxGeometry(0.46, 0.8, 0.5).translate(0, 0.62, 0), 0x22427a),
    part(new THREE.CylinderGeometry(0.25, 0.25, 0.46, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 1.02, 0), 0x22427a),
    ...[[-0.18, -0.2], [0.18, -0.2], [-0.18, 0.2], [0.18, 0.2]].map(([x, z]) => part(new THREE.BoxGeometry(0.05, 0.22, 0.05).translate(x, 0.11, z), 0x1a1a1c)),
  ]);
  // Tree pit: a square of dark soil edged in steel, flush with the paving.
  const pit = merge([
    part(new THREE.BoxGeometry(1.2, 0.01, 1.2).translate(0, 0.0, 0), 0x3a2c20),
    ...[[0, 0.62, 1.28, 0.05], [0, -0.62, 1.28, 0.05], [0.62, 0, 0.05, 1.28], [-0.62, 0, 0.05, 1.28]].map(([x, z, w, d]) => part(new THREE.BoxGeometry(w, 0.03, d).translate(x, 0.01, z), 0x5a5c5e)),
  ]);
  // Subway entrance (New York style): green iron railings round a stair going down, two globe lamps.
  const sg = 0x2c5a3c, L = 4.2, Wd = 1.8;
  const stairs = [];
  for (let k = 0; k < 7; k++) stairs.push(part(new THREE.BoxGeometry(L / 7, 0.012, Wd).translate(-L / 2 + (k + 0.5) * (L / 7), 0.004, 0), k % 2 ? 0x101112 : 0x1a1b1d));
  const subway = merge([
    ...stairs,
    // Long-side railings (top rail, mid rail, posts) and the closed end.
    ...[-1, 1].flatMap((sd) => [
      part(new THREE.BoxGeometry(L, 0.05, 0.05).translate(0, 1.05, sd * Wd / 2), sg),
      part(new THREE.BoxGeometry(L, 0.04, 0.04).translate(0, 0.55, sd * Wd / 2), sg),
      part(new THREE.BoxGeometry(L, 0.18, 0.06).translate(0, 0.09, sd * Wd / 2), sg),
      ...[0, 1, 2, 3, 4, 5].map((k) => part(new THREE.BoxGeometry(0.05, 1.05, 0.05).translate(-L / 2 + (k / 5) * L, 0.52, sd * Wd / 2), sg)),
    ]),
    part(new THREE.BoxGeometry(0.05, 0.05, Wd).translate(-L / 2, 1.05, 0), sg),
    part(new THREE.BoxGeometry(0.06, 0.18, Wd).translate(-L / 2, 0.09, 0), sg),
    ...[-1, 1].flatMap((sd) => [
      part(new THREE.CylinderGeometry(0.05, 0.07, 2.3, 8).translate(L / 2, 1.15, sd * Wd / 2), sg),
      part(new THREE.SphereGeometry(0.2, 12, 8).translate(L / 2, 2.45, sd * Wd / 2), 0xbfe8c8),
    ]),
  ]);
  // Newsstand: a green metal kiosk with racks of magazines on its front.
  const mags = [];
  for (let k = 0; k < 12; k++) {
    const c = [0xc23b2e, 0xe0b03a, 0x2f6fb5, 0xe8e4da, 0x3f9a5a, 0xd06a2a, 0x7a3c8a][k % 7];
    mags.push(part(new THREE.BoxGeometry(0.22, 0.3, 0.02).translate(-1.05 + (k % 6) * 0.42, 0.95 + Math.floor(k / 6) * 0.38, 0.78), c));
  }
  const newsstand = merge([
    part(new THREE.BoxGeometry(2.6, 2.3, 1.5).translate(0, 1.15, 0), 0x2f4a3c),
    part(new THREE.BoxGeometry(2.9, 0.12, 1.8).translate(0, 2.36, 0), 0x22362c),
    part(new THREE.BoxGeometry(2.4, 0.9, 0.04).translate(0, 1.15, 0.76), 0x1a1d1c),
    ...mags,
  ]);
  // Bus shelter: steel frame, a glass back, an ad panel at one end, a bench.
  const steel = 0x4a4f55, glassT = 0x9db2be;
  const shelter = merge([
    part(new THREE.BoxGeometry(3.8, 0.1, 1.6).translate(0, 2.5, 0), steel),
    ...[[-1.85, -0.75], [1.85, -0.75], [-1.85, 0.75], [1.85, 0.75]].map(([x, z]) => part(new THREE.BoxGeometry(0.07, 2.5, 0.07).translate(x, 1.25, z), steel)),
    part(new THREE.BoxGeometry(3.7, 2.0, 0.03).translate(0, 1.2, -0.75), glassT),
    part(new THREE.BoxGeometry(0.06, 2.0, 1.4).translate(1.85, 1.2, 0), 0xece6d6),
    part(new THREE.BoxGeometry(0.03, 1.8, 1.2).translate(1.89, 1.2, 0), 0x2b6cb0),
    part(new THREE.BoxGeometry(1.8, 0.06, 0.35).translate(-0.5, 0.48, -0.5), steel),
  ]);
  // Bike-share dock: a rail of docked bikes (Citi Bike blue) and a payment kiosk.
  const blue = 0x2a6fd6, tire = 0x1a1a1c;
  const bikes = [];
  for (let k = 0; k < 7; k++) {
    const x = -3 + k * 0.95;
    bikes.push(
      part(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 12).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(x, 0.34, -0.55), tire),
      part(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 12).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(x, 0.34, 0.55), tire),
      part(new THREE.BoxGeometry(0.06, 0.08, 1.1).translate(x, 0.55, 0), blue),
      part(new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(x, 0.75, -0.25), blue),
      part(new THREE.BoxGeometry(0.5, 0.05, 0.05).translate(x, 1.0, 0.5), 0x2a2a2c),
      part(new THREE.BoxGeometry(0.12, 0.06, 0.24).translate(x, 0.98, -0.28), 0x1a1a1c),
    );
  }
  const dock = merge([
    part(new THREE.BoxGeometry(7.0, 0.12, 0.25).translate(-0.15, 0.06, -0.9), 0x6a6e72),
    ...bikes,
    part(new THREE.BoxGeometry(0.5, 1.9, 0.4).translate(3.6, 0.95, -0.9), 0x1d3f7a),
  ]);
  const kinds: THREE.BufferGeometry[] = [bench, bin, hydrant, merge([manhole, lid]), mailbox, pit, subway, newsstand, shelter, dock];
  // ---- Europe & Middle East (kinds 20–22, see earth/cities/eu-props.ts)
  euProps(kinds, part, merge);
  return kinds;
}

let ironMat: THREE.MeshStandardMaterial | null = null;
/**
 * Black-painted ironwork (fire escapes): quads whose shader cuts out the gaps, so you see the wall
 * through railings (vertical bars), platforms (slats) and stairs (treads). Pattern in color r.
 */
export function ironMaterial() {
  if (ironMat) return ironMat;
  const m = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide, vertexColors: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 color; varying vec2 vIu; varying float vPat;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vIu = uv; vPat = color.r * 255.0 / 60.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vIu; varying float vPat;`)
      .replace('#include <alphatest_fragment>', `
        {
          vec2 q = vIu;
          float px = max(fwidth(q.x), fwidth(q.y));
          float keep = 1.0;
          if (vPat < 1.5) {
            // Railing: top rail, mid rail, toe plate, bars every 11 cm.
            float bar = step(fract(q.x / 0.11), 0.22);
            float rail = step(0.94, q.y) + step(abs(q.y - 0.5), 0.02) + step(q.y, 0.1);
            float post = step(min(q.x, 0.03), 0.03);
            keep = clamp(bar + rail + post, 0.0, 1.0);
          } else if (vPat < 2.5) {
            // Platform: slats along the wall, a frame round the edge.
            keep = clamp(step(fract(q.y / 0.1), 0.55) + step(q.y, 0.04) + step(q.x, 0.04), 0.0, 1.0);
          } else {
            // Stair / ladder: two stringers and treads.
            keep = clamp(step(q.x, 0.05) + step(0.55, q.x) + step(fract(q.y / 0.25), 0.22), 0.0, 1.0);
          }
          // Far away the bars would shimmer: the pattern coarsens with distance instead (bars and slats a
          // few pixels apart), so a fire escape stays an open grille rather than turning into solid slabs.
          if (px > 0.03) {
            // In steps of 2x (a pitch that changed smoothly would swim as you walk).
            float pitch = 0.1 * exp2(ceil(log2(px * 6.0 / 0.1)));
            if (vPat < 1.5) keep = clamp(step(0.88, q.y) + step(q.y, 0.14) + step(fract(q.x / pitch), 0.3), 0.0, 1.0);
            else if (vPat < 2.5) keep = clamp(step(fract(q.y / pitch), 0.45) + step(q.y, 0.06) + step(q.x, 0.06), 0.0, 1.0);
            else keep = clamp(step(q.x, 0.1) + step(0.5, q.x), 0.0, 1.0);
          }
          if (keep < 0.5) discard;
        }`);
  };
  m.customProgramCacheKey = () => 'earth-iron-v2';
  ironMat = m;
  return m;
}

/** Colliders for street furniture by kind: [half-size, height]; 0 = walk over it. */
export const PROP_COLLIDE: [number, number][] = [[0.6, 0.5], [0.28, 0.9], [0.28, 0.9], [0, 0], [0.3, 1.2], [0, 0], [1.3, 1.1], [1.3, 2.4], [0, 0], [0, 0]];
// ---- Europe & Middle East: pillar box, K6 kiosk, Morris column.
PROP_COLLIDE[20] = [0.32, 1.5]; PROP_COLLIDE[21] = [0.5, 2.5]; PROP_COLLIDE[22] = [0.65, 3.4];

export const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.25 });

let shoreMat: THREE.MeshStandardMaterial | null = null;
/**
 * Shorelines: a band of shallow, sandy-green water fading out from the bank, with surf foam that
 * washes in and out (strongest on the sea). Geometry carries aShore (along, across) and aStr (strength).
 */
export function shoreMaterial() {
  if (shoreMat) return shoreMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterT = waterT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aShore; attribute vec3 aStr; varying vec2 vShore; varying float vStr;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vShore = aShore; vStr = aStr.r;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWaterT; varying vec2 vShore; varying float vStr;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sv = vShore.y, su = vShore.x;
        float fn = evn(vec2(su * 0.35 - uWaterT * 0.25, sv * 3.0 + uWaterT * 0.4)) * 0.6 + evn(vec2(su * 1.7, sv * 9.0 - uWaterT * 1.1)) * 0.4;
        float wash = 0.1 + 0.08 * sin(uWaterT * 0.9 + su * 0.05);
        float line = smoothstep(wash + 0.14, wash, sv) * smoothstep(0.32, 0.62, fn);
        float lace = smoothstep(0.55, 0.78, fn) * (1.0 - smoothstep(0.1, 0.75, sv)) * 0.55;
        float foam = clamp(line + lace, 0.0, 1.0) * vStr;
        float shallow = (1.0 - sv) * (1.0 - sv) * (0.25 + 0.35 * vStr);
        float fw = foam / max(foam + shallow * 0.6, 1e-3);
        diffuseColor.rgb = mix(vec3(0.07, 0.11, 0.08), vec3(0.8, 0.82, 0.8), fw);
        diffuseColor.a = clamp(foam * 0.85 + shallow, 0.0, 0.92);
        float shoreRough = mix(0.08, 0.8, fw);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = shoreRough;`);
  };
  m.customProgramCacheKey = () => 'earth-shore-v1';
  shoreMat = m;
  return m;
}

// ---- West Coast
/**
 * Mexican fan palm (Los Angeles, Las Vegas): a pencil-thin trunk 17 m up, a skirt of dry fronds, and
 * a small round head of fan leaves.
 */
export function fanPalmTree() {
  const parts: THREE.BufferGeometry[] = [];
  const H = 17, segs = 8;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, y0 = t * H, lean = t * t * 0.45;
    const seg = new THREE.CylinderGeometry(0.17 - t * 0.05, 0.22 - t * 0.05, H / segs + 0.05, 6, 1, true).translate(lean, y0 + H / segs / 2, 0);
    parts.push(atlasPart(seg, ATLAS.bark, 0xbfae96));
  }
  const top = new THREE.Vector3(0.45, H, 0);
  // The skirt of old fronds hanging against the trunk.
  parts.push(atlasPart(new THREE.CylinderGeometry(0.62, 0.3, 1.5, 8, 1, true).translate(top.x, H - 0.55, 0), ATLAS.plain, 0x8a7350));
  const frond = (a: number, tilt: number, len: number) => {
    const pts: number[] = [], n = 4;
    for (let j = 0; j <= n; j++) {
      const t = j / n, l = len * t;
      const y = Math.sin(tilt) * l - t * t * 0.5;
      const w = t < 0.35 ? 0.06 : Math.sin(((t - 0.35) / 0.65) * Math.PI) * 0.75 + 0.06;
      const cx = top.x + Math.cos(a) * Math.cos(tilt) * l, cz = top.z + Math.sin(a) * Math.cos(tilt) * l;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pts.push(cx + px, top.y + y, cz + pz, cx - px, top.y + y, cz - pz);
    }
    const pos: number[] = [];
    for (let j = 0; j < n; j++) {
      const i0 = j * 6, i1 = (j + 1) * 6;
      const A = pts.slice(i0, i0 + 3), B = pts.slice(i0 + 3, i0 + 6), C = pts.slice(i1, i1 + 3), D = pts.slice(i1 + 3, i1 + 6);
      pos.push(...A, ...B, ...C, ...B, ...D, ...C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const part = atlasPart(g, ATLAS.plain, 0xffffff);
    part.setAttribute('color', colored(g.clone(), 0x5f7a36, 0x3d5226).getAttribute('color'));
    return part;
  };
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + (k % 2) * 0.2;
    const tilt = k % 3 === 0 ? 0.9 : k % 3 === 1 ? 0.35 : -0.15;
    parts.push(frond(a, tilt, 2.1 + (k % 2) * 0.3));
  }
  return mergeParts(parts);
}
