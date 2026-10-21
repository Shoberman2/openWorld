// Regional building looks: Amsterdam is brick, Paris is sandstone and zinc, Manhattan is brick,
// limestone and glass. Colors are measured-looking real materials (sRGB): weathered brick, limestone,
// render, concrete; tar and gravel roofs; tinted glass.

const hex = (s: string) => parseInt(s.slice(1), 16);

const REGION: Record<string, { walls: number[]; roofs: number[]; glass: number[]; pitch: number; flat?: number }> = {
  us: {
    walls: ['#8a4a36', '#9b5a43', '#6e3f31', '#b9ab92', '#c8bfae', '#a68c6c', '#8d8f8e', '#d0cbbf', '#b29674', '#7d4a39', '#aaa498'].map(hex),
    roofs: ['#4b4f55', '#5a5c60', '#3f4349', '#5e463d'].map(hex), glass: ['#5d7286', '#647a8d', '#4f6577', '#6f8494', '#6b7a84'].map(hex), pitch: 11, flat: 0x7d7b77,
  },
  nl: {
    walls: ['#73392b', '#874534', '#5a3127', '#985440', '#653a2f', '#d2cbbb', '#4b3029', '#7f3f30'].map(hex),
    roofs: ['#34373c', '#3e3632', '#4b4e54', '#673628'].map(hex), glass: ['#5d7286', '#6f8494'].map(hex), pitch: 18, flat: 0x5e6166,
  },
  de: {
    walls: ['#cfc6b4', '#bfb299', '#a99773', '#d6d1c5', '#8a4934', '#aea89b', '#bfa67d'].map(hex),
    roofs: ['#7e3d2b', '#663427', '#3c3e43', '#8a4a33'].map(hex), glass: ['#5d7286', '#647a8d', '#6f8494'].map(hex), pitch: 16, flat: 0x7d7b77,
  },
  fr: {
    walls: ['#c9b99c', '#c0ad8c', '#d1c4ab', '#b9a687', '#d8cfbd', '#ae9a78'].map(hex),
    roofs: ['#5f6a74', '#56616b', '#6a7580', '#87472f'].map(hex), glass: ['#5d7286', '#6f8494'].map(hex), pitch: 14, flat: 0x6f7880,
  },
  south: { // Mediterranean / Latin
    walls: ['#d7cdb6', '#cdb48a', '#ddd6c8', '#c69e74', '#b98a66', '#d6c6a2', '#b3bab6'].map(hex),
    roofs: ['#93492f', '#86402b', '#a05838', '#743c2c'].map(hex), glass: ['#5d7286', '#6f8494'].map(hex), pitch: 12, flat: 0xa79f92,
  },
  gb: {
    walls: ['#7e4430', '#8f513a', '#bcb29b', '#aea48b', '#d0cbc0', '#683b2c', '#9f8e71'].map(hex),
    roofs: ['#3d4047', '#4a4c51', '#653a2d'].map(hex), glass: ['#5d7286', '#647a8d', '#6f8494'].map(hex), pitch: 14, flat: 0x6f7175,
  },
  asia: {
    walls: ['#cbcac5', '#b6b8b6', '#a5aaad', '#cec7b8', '#9ca1a5', '#bdb4a5', '#d6d4cf'].map(hex),
    roofs: ['#4f545a', '#62666c', '#3e4348'].map(hex), glass: ['#5d7286', '#647a8d', '#6f8494', '#73899a'].map(hex), pitch: 8, flat: 0x8f8e8a,
  },
  gulf: {
    walls: ['#c8b792', '#d4c9b1', '#bba780', '#dad5cb', '#ae9870'].map(hex),
    roofs: ['#9a9486', '#8b8374'].map(hex), glass: ['#5d7286', '#647a8d', '#62808f', '#5d7f86'].map(hex), pitch: 0, flat: 0xb3aa98,
  },
  latin: {
    walls: ['#d9a35e', '#c55a4a', '#e2c27a', '#e6dcc8', '#d98a6a', '#b4c6c8'].map(hex),
    roofs: ['#93492f', '#86402b', '#a05838'].map(hex), glass: ['#5d7286', '#6f8494'].map(hex), pitch: 9, flat: 0xa79f92,
  },
  levant: {
    walls: ['#d6c4a0', '#cbb68e', '#e0d2b4', '#c2ad86', '#d8ccb6'].map(hex),
    roofs: ['#9a9486', '#8b8374'].map(hex), glass: ['#5d7286', '#62808f'].map(hex), pitch: 0, flat: 0xb3aa98,
  },
  aus: {
    walls: ['#c9a878', '#b98a5e', '#8f4c37', '#d8cdb6', '#a65a3c'].map(hex),
    roofs: ['#7e3d2b', '#4b4f55', '#8a4a33'].map(hex), glass: ['#5d7286', '#647a8d', '#6f8494'].map(hex), pitch: 9, flat: 0x7d7b77,
  },
  base: {
    walls: ['#bdb4a2', '#ad9c80', '#8f4c37', '#cbc6bb', '#8e9295', '#b29674', '#aaa498'].map(hex),
    roofs: ['#4b4f55', '#633d31', '#5a5c60'].map(hex), glass: ['#5d7286', '#647a8d', '#6f8494'].map(hex), pitch: 11, flat: 0x7d7b77,
  },
};

const MAP: Record<string, string> = {
  us: 'us', ca: 'us', au: 'aus', nz: 'aus',
  nl: 'nl', be: 'nl', dk: 'nl',
  de: 'de', at: 'de', ch: 'de', cz: 'de', pl: 'de', se: 'de', no: 'de', fi: 'de',
  fr: 'fr', lu: 'fr',
  es: 'south', pt: 'south', it: 'south', gr: 'south', hr: 'south', mt: 'south', cy: 'south',
  mx: 'latin', br: 'latin', ar: 'latin', cl: 'latin', co: 'latin', pe: 'latin', cu: 'latin', ve: 'latin', ec: 'latin', uy: 'latin', gt: 'latin', do: 'latin', pr: 'latin',
  tr: 'levant', ma: 'levant', tn: 'levant', dz: 'levant', lb: 'levant', jo: 'levant', il: 'levant', ir: 'levant', pk: 'levant', bd: 'levant', in: 'levant', lk: 'levant', np: 'levant',
  gb: 'gb', ie: 'gb',
  jp: 'asia', kr: 'asia', cn: 'asia', tw: 'asia', hk: 'asia', sg: 'asia', th: 'asia', vn: 'asia', my: 'asia', ph: 'asia', id: 'asia',
  ae: 'gulf', qa: 'gulf', sa: 'gulf', kw: 'gulf', bh: 'gulf', om: 'gulf', eg: 'levant',
};

export function regionOf(country: string) { return REGION[MAP[country] ?? 'base'] ?? REGION.base; }
/** The region key (for facade styles, see facades.ts). */
export function regionKey(country: string) { return REGION[MAP[country] ?? ''] ? MAP[country] : 'base'; }

const NAMED: Record<string, number> = {
  white: 0xd8d5ce, black: 0x2e2e30, grey: 0x8e9194, gray: 0x8e9194, red: 0x8a4130, brown: 0x6e4a3a, beige: 0xc7b99c,
  yellow: 0xc9b06a, blue: 0x56687e, green: 0x5a7656, orange: 0xb27445, silver: 0xaeb2b5, tan: 0xb9a07c, cream: 0xd8cdb3,
};

/** A tagged OSM colour, kept within the range of real facade materials (no soot-black, no neon). */
export function taggedColor(s: string): number | null {
  const v = s.trim().toLowerCase();
  let c: number | null = null;
  if (NAMED[v] !== undefined) c = NAMED[v];
  else if (/^#([0-9a-f]{6})$/.test(v)) c = parseInt(v.slice(1), 16);
  else if (/^#([0-9a-f]{3})$/.test(v)) c = parseInt(v.slice(1).split('').map((ch) => ch + ch).join(''), 16);
  if (c === null) return null;
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  // Keep between ~20% and ~85% luminance and tame the saturation (tags are often pure web colors).
  const l = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
  const lift = l < 0.2 ? (0.2 - l) * 255 : l > 0.85 ? (0.85 - l) * 255 : 0;
  r = Math.max(0, Math.min(255, r + lift)); g = Math.max(0, Math.min(255, g + lift)); b = Math.max(0, Math.min(255, b + lift));
  const m = (r + g + b) / 3;
  r = m + (r - m) * 0.7; g = m + (g - m) * 0.7; b = m + (b - m) * 0.7;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Ground colors painted into each chunk's texture. */
export const GROUND = {
  grass: '#74983f', park: '#6d963c', wood: '#466a2e', farmland: '#a39e6a', sand: '#cdbd94', wetland: '#5f7a4e',
  ice: '#e8ecef', rock: '#8f8a80', paved: '#9c9890', urban: '#8f8c85', civic: '#a19b8e', cemetery: '#62823f',
  pitch: '#67983a', water: '#2f5566', rail: '#6f6a62', road: '#4a4c50', path: '#a9a296',
};
