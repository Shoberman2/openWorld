// Street name signs at intersections, from the real street names in the map: New York's green
// blades ("W 42 St"), and a local style elsewhere (Paris enamel plaques, London's white signs…).
import * as THREE from 'three';
import type { EdgeData } from '../build/types.ts';

interface SignStyle { bg: string; fg: string; border: string; font: string; upper: boolean }
const STYLES: Record<string, SignStyle> = {
  nyc: { bg: '#0d6b3c', fg: '#ffffff', border: '#ffffff', font: '600 46px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: false },
  us: { bg: '#0d6b3c', fg: '#ffffff', border: '#ffffff', font: '600 46px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: true },
  fr: { bg: '#1d3f8f', fg: '#ffffff', border: '#2f8a4a', font: '600 40px Georgia, "Times New Roman", serif', upper: true },
  gb: { bg: '#f7f7f2', fg: '#111111', border: '#111111', font: '700 44px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: true },
  de: { bg: '#1e4ea1', fg: '#ffffff', border: '#ffffff', font: '600 42px "DIN Alternate", "Helvetica Neue", Arial, sans-serif', upper: false },
  jp: { bg: '#1f5fa8', fg: '#ffffff', border: '#ffffff', font: '600 42px "Hiragino Sans", "Helvetica Neue", Arial, sans-serif', upper: false },
  default: { bg: '#1f4f8f', fg: '#ffffff', border: '#ffffff', font: '600 42px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: false },
};

export function signStyleKey(country: string, nyc: boolean) {
  if (nyc) return 'nyc';
  if (country === 'us' || country === 'ca') return 'us';
  if (country === 'fr' || country === 'be') return 'fr';
  if (country === 'gb' || country === 'ie') return 'gb';
  if (country === 'de' || country === 'at' || country === 'nl') return 'de';
  if (country === 'jp') return 'jp';
  return 'default';
}

const ORD = /\b(\d+)(st|nd|rd|th)\b/gi;
/** "West 42nd Street" → "W 42 St" (New York); "Avenue of the Americas" stays. */
export function shortName(name: string, style: string) {
  if (style !== 'nyc' && style !== 'us') return name;
  let s = name
    .replace(/\bWest\b/g, 'W').replace(/\bEast\b/g, 'E').replace(/\bNorth\b/g, 'N').replace(/\bSouth\b/g, 'S')
    .replace(/\bStreet\b/g, 'St').replace(/\bBoulevard\b/g, 'Blvd').replace(/\bPlace\b/g, 'Pl').replace(/\bDrive\b/g, 'Dr')
    .replace(/\bAvenue\b(?! of)/g, style === 'nyc' ? 'Av' : 'Ave');
  if (style === 'nyc') s = s.replace(ORD, '$1');
  return s;
}

const SLOT_W = 512, SLOT_H = 72;

/**
 * Build the signs for one detailed chunk. Edge points are chunk-local; the returned object goes
 * into the chunk's group (it's disposed with it).
 */
export function buildSigns(edges: EdgeData[], nameLines: { name: string; pts: number[]; w: number }[], size: number, styleKey: string, poleGeo: THREE.BufferGeometry, poleMat: THREE.Material): THREE.Object3D | null {
  // Street names come as their own lines: bucket their segments so each arm can find its name.
  const G = 30, segs = new Map<string, { ax: number; az: number; bx: number; bz: number; name: string }[]>();
  for (const n of nameLines) for (let i = 0; i + 3 < n.pts.length; i += 2) {
    const sg = { ax: n.pts[i], az: n.pts[i + 1], bx: n.pts[i + 2], bz: n.pts[i + 3], name: n.name };
    for (let gx = Math.floor(Math.min(sg.ax, sg.bx) / G); gx <= Math.floor(Math.max(sg.ax, sg.bx) / G); gx++)
      for (let gz = Math.floor(Math.min(sg.az, sg.bz) / G); gz <= Math.floor(Math.max(sg.az, sg.bz) / G); gz++) {
        const k = `${gx},${gz}`; let l = segs.get(k); if (!l) segs.set(k, (l = [])); l.push(sg);
      }
  }
  const nameAt = (x: number, z: number, dx: number, dz: number) => {
    let best: string | null = null, bd = 9;
    for (const sg of segs.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) {
      const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, l2 = ex * ex + ez * ez;
      if (l2 < 0.01) continue;
      if (Math.abs((ex * dx + ez * dz) / Math.sqrt(l2)) < 0.85) continue; // must run the same way
      const t = Math.max(0, Math.min(1, ((x - sg.ax) * ex + (z - sg.az) * ez) / l2));
      const d = Math.hypot(x - sg.ax - ex * t, z - sg.az - ez * t);
      if (d < bd) { bd = d; best = sg.name; }
    }
    return best;
  };
  // Arms at each node: which named streets leave it, in which direction.
  const arms = new Map<string, { x: number; z: number; y: number; name: string; dx: number; dz: number; w: number }[]>();
  for (const e of edges) {
    if (!e.drive || e.bridge || e.cls === 'motorway' || e.cls === 'service' || e.pts.length < 4) continue;
    const n = e.pts.length;
    const ends: [string, number, number, number, number, number][] = [
      [e.a, e.pts[0], e.pts[1], e.pts[2], e.pts[3], e.ys[0]],
      [e.b, e.pts[n - 2], e.pts[n - 1], e.pts[n - 4], e.pts[n - 3], e.ys[e.ys.length - 1]],
    ];
    for (const [key, x, z, nx, nz, y] of ends) {
      const l = Math.hypot(nx - x, nz - z);
      if (l < 0.5) continue;
      const dx = (nx - x) / l, dz = (nz - z) / l;
      const name = e.name ?? nameAt(x + dx * 10, z + dz * 10, dx, dz);
      if (!name) continue;
      let list = arms.get(key);
      if (!list) arms.set(key, (list = []));
      list.push({ x, z, y, name, dx, dz, w: e.width });
    }
  }
  const signs: { x: number; z: number; y: number; a: { name: string; dx: number; dz: number }; b: { name: string; dx: number; dz: number } }[] = [];
  for (const list of arms.values()) {
    const p = list[0];
    if (p.x < 0 || p.z < 0 || p.x >= size || p.z >= size) continue;
    // The most perpendicular pair of differently named streets.
    let best: [typeof p, typeof p] | null = null, bd = 0.75;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].name === list[j].name) continue;
      const d = Math.abs(list[i].dx * list[j].dx + list[i].dz * list[j].dz);
      if (d < bd) { bd = d; best = [list[i], list[j]]; }
    }
    if (!best) continue;
    const [s1, s2] = best;
    const x = p.x + s1.dx * (s2.w / 2 + 1.7) + s2.dx * (s1.w / 2 + 1.7);
    const z = p.z + s1.dz * (s2.w / 2 + 1.7) + s2.dz * (s1.w / 2 + 1.7);
    signs.push({ x, z, y: p.y + 0.14, a: s1, b: s2 });
  }
  if (!signs.length) return null;

  // One texture per chunk with every name in it.
  const st = STYLES[styleKey] ?? STYLES.default;
  const names = [...new Set(signs.flatMap((s) => [s.a.name, s.b.name]))].slice(0, 64);
  const label = (n: string) => { const t = shortName(n, styleKey); return st.upper ? t.toUpperCase() : t; };
  const rows = Math.max(1, names.length);
  const H = 1 << Math.ceil(Math.log2(rows * SLOT_H));
  const c = document.createElement('canvas'); c.width = SLOT_W; c.height = H;
  const g = c.getContext('2d')!;
  const widths = new Map<string, number>();
  names.forEach((n, i) => {
    const y = i * SLOT_H, t = label(n);
    g.fillStyle = st.bg; g.fillRect(0, y, SLOT_W, SLOT_H);
    g.strokeStyle = st.border; g.lineWidth = 4; g.strokeRect(5, y + 5, SLOT_W - 10, SLOT_H - 10);
    g.fillStyle = st.fg; g.font = st.font; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(t).width, k = Math.min(1, (SLOT_W - 36) / Math.max(1, w));
    g.save(); g.translate(SLOT_W / 2, y + SLOT_H / 2 + 2); g.scale(k, 1); g.fillText(t, 0, 0); g.restore();
    widths.set(n, Math.min(1, (w * k + 40) / SLOT_W));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const slot = (n: string) => names.indexOf(n);

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const blade = (x: number, y: number, z: number, dx: number, dz: number, name: string) => {
    const i = slot(name);
    if (i < 0) return;
    // Use only the part of the slot the name fills, at the slot's aspect, so letters aren't stretched.
    const wf = Math.max(0.4, widths.get(name) ?? 1), h = 0.24, L = wf * (SLOT_W / SLOT_H) * h;
    const ua = (1 - wf) / 2, ub = (1 + wf) / 2;
    const ax = x - dx * L / 2, az = z - dz * L / 2, bx = x + dx * L / 2, bz = z + dz * L / 2;
    const vb = 1 - (i * SLOT_H + SLOT_H) / H, vt = 1 - (i * SLOT_H) / H;
    const nx = -dz, nz = dx;
    for (const side of [1, -1]) {
      const o = side * 0.012;
      const p0 = [ax + nx * o, y, az + nz * o], p1 = [bx + nx * o, y, bz + nz * o], p2 = [bx + nx * o, y + h, bz + nz * o], p3 = [ax + nx * o, y + h, az + nz * o];
      // Seen from its own side, each face reads left to right (a→b on the +n face, b→a on the back).
      const [u0, u1] = side > 0 ? [ua, ub] : [ub, ua];
      const verts = side > 0 ? [p0, p1, p2, p0, p2, p3] : [p0, p2, p1, p0, p3, p2];
      const uvs = side > 0 ? [[u0, vb], [u1, vb], [u1, vt], [u0, vb], [u1, vt], [u0, vt]] : [[u0, vb], [u1, vt], [u1, vb], [u0, vb], [u0, vt], [u1, vt]];
      for (let k = 0; k < 6; k++) { pos.push(...verts[k]); nrm.push(nx * side, 0, nz * side); uv.push(uvs[k][0], uvs[k][1]); }
    }
  };
  for (const s of signs) {
    blade(s.x, s.y + 3.05, s.z, s.a.dx, s.a.dz, s.a.name);
    blade(s.x, s.y + 3.33, s.z, s.b.dx, s.b.dz, s.b.name);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 });
  mat.userData.perChunk = true;
  const grp = new THREE.Group();
  grp.name = 'street-signs';
  grp.add(new THREE.Mesh(geo, mat));
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, signs.length);
  const m4 = new THREE.Matrix4();
  signs.forEach((s, i) => poles.setMatrixAt(i, m4.makeTranslation(s.x, s.y, s.z)));
  poles.castShadow = true;
  poles.computeBoundingSphere();
  grp.add(poles);
  return grp;
}
