// Regional building looks: Amsterdam is brick, Paris is sandstone and zinc, Manhattan is brick,
// limestone and glass. Colors are stylized (clean, slightly saturated), like an early Apple Maps.

const hex = (s: string) => parseInt(s.slice(1), 16);

const REGION: Record<string, { walls: number[]; roofs: number[]; glass: number[]; pitch: number; flat?: number }> = {
  us: {
    walls: ['#b24a32', '#c25a3c', '#8e4a36', '#d8c7a8', '#e4dccb', '#c9a57a', '#a4a9ad', '#eae7df', '#d7b48a', '#9c5b43', '#cfc8bb'].map(hex),
    roofs: ['#5d636b', '#6c6f74', '#4f555d', '#7a5245'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#3f6f99', '#6d9cc0', '#6f8ea6'].map(hex), pitch: 11, flat: 0xc4c2bd,
  },
  nl: {
    walls: ['#8e4430', '#a3533a', '#6f3a2c', '#b8644a', '#7c4636', '#e8e2d4', '#5d3a30', '#9c4b36'].map(hex),
    roofs: ['#3f4248', '#4a3f3a', '#5b5f66', '#7d3f2e'].map(hex), glass: ['#4f7fa8', '#6d9cc0'].map(hex), pitch: 18, flat: 0x7b7f86,
  },
  de: {
    walls: ['#e6dfcf', '#d9cdb5', '#c8b48f', '#ece8de', '#a8553c', '#c9c2b4', '#dcc59a'].map(hex),
    roofs: ['#9c4a32', '#7d3f2e', '#4a4c52', '#a85a3d'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#6d9cc0'].map(hex), pitch: 16, flat: 0xa3a19c,
  },
  fr: {
    walls: ['#e3d5bb', '#ddcbaa', '#e9dfca', '#d6c4a2', '#efe7d6', '#cdb894'].map(hex),
    roofs: ['#76838f', '#6b7884', '#808c97', '#a3553a'].map(hex), glass: ['#4f7fa8', '#6d9cc0'].map(hex), pitch: 14, flat: 0x8e9aa6,
  },
  south: { // Mediterranean / Latin
    walls: ['#efe6d2', '#e8cfa2', '#f2ede2', '#e0b98a', '#d9a27a', '#f0e2c0', '#cfd8d6'].map(hex),
    roofs: ['#b4583a', '#a64e34', '#c06a45', '#8f4a35'].map(hex), glass: ['#4f7fa8', '#6d9cc0'].map(hex), pitch: 12, flat: 0xd6ccbd,
  },
  gb: {
    walls: ['#9a5236', '#ad6142', '#d7cdb6', '#c9bea4', '#ebe6dc', '#7f4733', '#bba98a'].map(hex),
    roofs: ['#4b4f57', '#5a5d63', '#7a4535'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#6d9cc0'].map(hex), pitch: 14, flat: 0x96989c,
  },
  asia: {
    walls: ['#e4e3df', '#d2d4d3', '#c3c8cb', '#e8e1d2', '#b9bec2', '#d9d0c0', '#f0eeea'].map(hex),
    roofs: ['#62676e', '#7b8086', '#4c5258'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#6d9cc0', '#7aa7c6'].map(hex), pitch: 8, flat: 0xc9c8c3,
  },
  gulf: {
    walls: ['#e3d2ae', '#efe4cc', '#d6c29a', '#f3efe6', '#cbb48a'].map(hex),
    roofs: ['#b9b2a3', '#a89f8e'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#6aa4c4', '#5fa3b0'].map(hex), pitch: 0, flat: 0xe2d8c4,
  },
  base: {
    walls: ['#d9cfbd', '#c9b79a', '#b25a3e', '#e6e2d8', '#a9aeb2', '#d7b48a', '#c6c0b4'].map(hex),
    roofs: ['#5d636b', '#7a4a3a', '#6c6f74'].map(hex), glass: ['#4f7fa8', '#5a8cb4', '#6d9cc0'].map(hex), pitch: 11, flat: 0xc4c2bd,
  },
};

const MAP: Record<string, string> = {
  us: 'us', ca: 'us', au: 'us', nz: 'us',
  nl: 'nl', be: 'nl', dk: 'nl',
  de: 'de', at: 'de', ch: 'de', cz: 'de', pl: 'de', se: 'de', no: 'de', fi: 'de',
  fr: 'fr', lu: 'fr',
  es: 'south', pt: 'south', it: 'south', gr: 'south', hr: 'south', mx: 'south', br: 'south', ar: 'south', cl: 'south', co: 'south', pe: 'south', ma: 'south', tr: 'south',
  gb: 'gb', ie: 'gb',
  jp: 'asia', kr: 'asia', cn: 'asia', tw: 'asia', hk: 'asia', sg: 'asia', th: 'asia', vn: 'asia', my: 'asia', ph: 'asia', id: 'asia', in: 'asia',
  ae: 'gulf', qa: 'gulf', sa: 'gulf', kw: 'gulf', bh: 'gulf', om: 'gulf', eg: 'gulf',
};

export function regionOf(country: string) { return REGION[MAP[country] ?? 'base'] ?? REGION.base; }

const NAMED: Record<string, number> = {
  white: 0xf0eee8, black: 0x3a3a3c, grey: 0xa2a5a8, gray: 0xa2a5a8, red: 0xb24a32, brown: 0x8a5a44, beige: 0xe0d2b4,
  yellow: 0xe2c77a, blue: 0x6d86a6, green: 0x6f9a6a, orange: 0xd9894e, silver: 0xc4c8cc, tan: 0xd4ba92, cream: 0xf0e6cc,
};

/** A tagged OSM colour, lifted toward the stylized palette so dark tags don't look like soot. */
export function taggedColor(s: string): number | null {
  const v = s.trim().toLowerCase();
  let c: number | null = null;
  if (NAMED[v] !== undefined) c = NAMED[v];
  else if (/^#([0-9a-f]{6})$/.test(v)) c = parseInt(v.slice(1), 16);
  else if (/^#([0-9a-f]{3})$/.test(v)) c = parseInt(v.slice(1).split('').map((ch) => ch + ch).join(''), 16);
  if (c === null) return null;
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  // Lift: never darker than ~35% luminance, a bit more saturated.
  const l = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
  const lift = l < 0.42 ? (0.42 - l) * 255 : 0;
  r = Math.min(255, r + lift); g = Math.min(255, g + lift); b = Math.min(255, b + lift);
  const m = (r + g + b) / 3;
  r = Math.min(255, m + (r - m) * 1.15); g = Math.min(255, m + (g - m) * 1.15); b = Math.min(255, m + (b - m) * 1.15);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Ground colors painted into each chunk's texture. */
export const GROUND = {
  grass: '#9fcc63', park: '#96c95c', wood: '#77a956', farmland: '#d3d79c', sand: '#efe0b0', wetland: '#a5c79a',
  ice: '#f4f8fb', rock: '#c4beb2', paved: '#d6d2c9', urban: '#cfcbc2', civic: '#ddd6c6', cemetery: '#a9cc8b',
  pitch: '#86c45e', water: '#5fb0e0', rail: '#c3beb5', road: '#8d9096', path: '#e2ddd2',
};
