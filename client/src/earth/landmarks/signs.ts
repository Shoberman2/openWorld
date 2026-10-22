// Street name signs on every street corner, from the real street names in the map: New York's green
// blades ("W 42 St"), and a local style elsewhere (Paris enamel plaques, London's white signs…).
// Where a corner has a traffic signal, the blades go on the signal mast instead of a pole of their own.
import * as THREE from 'three';
import type { EdgeData, FootprintData } from '../build/types.ts';

interface SignStyle { bg: string; fg: string; border: string; font: string; upper: boolean }
const STYLES: Record<string, SignStyle> = {
  nyc: { bg: '#0d6b3c', fg: '#ffffff', border: '#ffffff', font: '600 54px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: false },
  us: { bg: '#0d6b3c', fg: '#ffffff', border: '#ffffff', font: '600 54px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: true },
  fr: { bg: '#1d3f8f', fg: '#ffffff', border: '#2f8a4a', font: '600 44px Georgia, "Times New Roman", serif', upper: true },
  gb: { bg: '#f7f7f2', fg: '#111111', border: '#111111', font: '700 48px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: true },
  de: { bg: '#1e4ea1', fg: '#ffffff', border: '#ffffff', font: '600 46px "DIN Alternate", "Helvetica Neue", Arial, sans-serif', upper: false },
  jp: { bg: '#1f5fa8', fg: '#ffffff', border: '#ffffff', font: '600 46px "Hiragino Sans", "Helvetica Neue", Arial, sans-serif', upper: false },
  default: { bg: '#1f4f8f', fg: '#ffffff', border: '#ffffff', font: '600 46px "Helvetica Neue", Helvetica, Arial, sans-serif', upper: false },
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
    .replace(/\bRoad\b/g, 'Rd').replace(/\bLane\b/g, 'Ln').replace(/\bParkway\b/g, 'Pkwy').replace(/\bTerrace\b/g, 'Ter')
    .replace(/\bAvenue\b(?! of)/g, style === 'nyc' ? 'Av' : 'Ave');
  if (style === 'nyc') s = s.replace(ORD, '$1');
  return s;
}

const SLOT_W = 512, SLOT_H = 72;
/** Blade height (a little over the real 0.25 m, so it reads from the sidewalk behind the robot), and the two mounting heights. */
const BLADE_H = 0.36, BLADE_Y = [2.98, 3.4];

type Arm = { x: number; z: number; y: number; name: string; dx: number; dz: number; w: number; ang: number };
type Sign = { x: number; z: number; y: number; a: Arm; b: Arm; onSignal: boolean };

/** One detailed chunk's signs: poles always, blades near the viewer (`update` with the viewer's chunk-local position). */
export interface StreetSigns { group: THREE.Group; update(x: number, z: number): void; dispose(): void }

/**
 * Build the signs for one detailed chunk. Everything is chunk-local; the returned object goes into
 * the chunk's group (it's disposed with it). `signalPoles` is the chunk's [x, y, z, rot, sig, group] list.
 */
export function buildSigns(edges: EdgeData[], size: number, styleKey: string, poleGeo: THREE.BufferGeometry, poleMat: THREE.Material, signalPoles: Float32Array, footprints: FootprintData[]): StreetSigns | null {
  // Arms at each node: which named streets leave it, in which direction.
  const arms = new Map<string, Arm[]>();
  for (const e of edges) {
    if (!e.drive || !e.name || e.bridge || e.cls === 'motorway' || e.cls === 'service' || e.pts.length < 4) continue;
    const n = e.pts.length;
    const ends: [string, number, number, number, number, number][] = [
      [e.a, e.pts[0], e.pts[1], e.pts[2], e.pts[3], e.ys[0]],
      [e.b, e.pts[n - 2], e.pts[n - 1], e.pts[n - 4], e.pts[n - 3], e.ys[e.ys.length - 1]],
    ];
    for (const [key, x, z, nx, nz, y] of ends) {
      const l = Math.hypot(nx - x, nz - z);
      if (l < 0.5) continue;
      const dx = (nx - x) / l, dz = (nz - z) / l;
      let list = arms.get(key);
      if (!list) arms.set(key, (list = []));
      list.push({ x, z, y, name: e.name, dx, dz, w: e.width, ang: Math.atan2(dz, dx) });
    }
  }

  // Buildings by 20 m cell, so a corner never lands inside one (odd street geometry, plazas).
  const fpCell = new Map<string, FootprintData[]>();
  for (const f of footprints) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < f.ring.length; i += 2) { x0 = Math.min(x0, f.ring[i]); x1 = Math.max(x1, f.ring[i]); z0 = Math.min(z0, f.ring[i + 1]); z1 = Math.max(z1, f.ring[i + 1]); }
    for (let i = Math.floor(x0 / 20); i <= Math.floor(x1 / 20); i++) for (let j = Math.floor(z0 / 20); j <= Math.floor(z1 / 20); j++) {
      const k = `${i},${j}`; let l = fpCell.get(k); if (!l) fpCell.set(k, (l = [])); l.push(f);
    }
  }
  const inBuilding = (x: number, z: number) => (fpCell.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`) ?? []).some((f) => {
    let inside = false;
    const r = f.ring;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
    return inside;
  });

  // One sign per corner: between each pair of neighbouring arms that belong to different streets and
  // meet at a real corner angle. Dual carriageways make several nodes per crossing, so a corner of the
  // same two streets within a few meters of another is skipped.
  const signs: Sign[] = [];
  const seen = new Map<string, { x: number; z: number }[]>();
  for (const list0 of arms.values()) {
    const p = list0[0];
    if (p.x < 0 || p.z < 0 || p.x >= size || p.z >= size || list0.length < 2) continue;
    const list = [...list0].sort((u, v) => u.ang - v.ang);
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[(i + 1) % list.length];
      if (a.name === b.name) continue;
      let gap = b.ang - a.ang;
      if (gap <= 0) gap += Math.PI * 2;
      if (gap < 0.85 || gap > 2.45) continue;
      // Out along each street past the other one's curb, onto the corner's sidewalk.
      const x = p.x + a.dx * (b.w / 2 + 1.6) + b.dx * (a.w / 2 + 1.6);
      const z = p.z + a.dz * (b.w / 2 + 1.6) + b.dz * (a.w / 2 + 1.6);
      const pair = a.name < b.name ? `${a.name}|${b.name}` : `${b.name}|${a.name}`;
      const near = seen.get(pair) ?? [];
      if (near.some((q) => Math.hypot(q.x - x, q.z - z) < 9)) continue;
      if (inBuilding(x, z)) continue;
      near.push({ x, z }); seen.set(pair, near);
      signs.push({ x, z, y: p.y + 0.04, a, b, onSignal: false });
    }
  }
  if (!signs.length) return null;
  // A signal mast on (or right by) the corner carries the blades.
  for (const s of signs) {
    let best = -1, bd = 4.5;
    for (let i = 0; i < signalPoles.length; i += 6) {
      const d = Math.hypot(signalPoles[i] - s.x, signalPoles[i + 2] - s.z);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { s.x = signalPoles[best]; s.z = signalPoles[best + 2]; s.y = signalPoles[best + 1]; s.onSignal = true; }
  }

  const grp = new THREE.Group();
  grp.name = 'street-signs';
  const own = signs.filter((s) => !s.onSignal);
  if (own.length) {
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, own.length);
    const m4 = new THREE.Matrix4();
    own.forEach((s, i) => poles.setMatrixAt(i, m4.makeTranslation(s.x, s.y, s.z)));
    poles.castShadow = true;
    poles.computeBoundingSphere();
    grp.add(poles);
  }
  // Corners (chunk-local x, y, z, on a signal 0/1), for tests and look-at.
  grp.userData.corners = signs.flatMap((s) => [s.x, s.y, s.z, s.onSignal ? 1 : 0]);

  // The blades only matter where you can read them, and a dense city has hundreds of names per
  // chunk: so they're built per 200 m cell (one small texture each) when you come near, and dropped
  // again when you leave.
  const cells = new Map<string, { signs: Sign[]; cx: number; cz: number; mesh: THREE.Mesh | null }>();
  for (const sg of signs) {
    const i = Math.floor(sg.x / CELL), j = Math.floor(sg.z / CELL), k = `${i},${j}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { signs: [], cx: (i + 0.5) * CELL, cz: (j + 0.5) * CELL, mesh: null }));
    c.signs.push(sg);
  }
  const drop = (c: { mesh: THREE.Mesh | null }) => {
    if (!c.mesh) return;
    grp.remove(c.mesh);
    c.mesh.geometry.dispose();
    const m = c.mesh.material as THREE.MeshStandardMaterial;
    m.map?.dispose(); m.dispose();
    c.mesh = null;
  };
  return {
    group: grp,
    update(x, z) {
      let built = 0;
      for (const c of cells.values()) {
        const d = Math.hypot(c.cx - x, c.cz - z);
        if (d < CELL_NEAR && !c.mesh && built < 2) { c.mesh = bladeMesh(c.signs, styleKey); grp.add(c.mesh); built++; }
        else if (d > CELL_FAR) drop(c);
      }
    },
    dispose() { for (const c of cells.values()) drop(c); },
  };
}

const CELL = 200, CELL_NEAR = 300, CELL_FAR = 420;

/** The blades of one cell: a texture with each name once, and two blades per corner. */
function bladeMesh(signs: Sign[], styleKey: string) {
  const st = STYLES[styleKey] ?? STYLES.default;
  const names = [...new Set(signs.flatMap((s) => [s.a.name, s.b.name]))];
  const label = (n: string) => { const t = shortName(n, styleKey); return st.upper ? t.toUpperCase() : t; };
  const H = Math.max(1, names.length) * SLOT_H;
  const c = document.createElement('canvas'); c.width = SLOT_W; c.height = H;
  const g = c.getContext('2d')!;
  const widths = new Map<string, number>();
  names.forEach((n, i) => {
    const y = i * SLOT_H, t = label(n);
    g.font = st.font;
    const w = g.measureText(t).width, k = Math.min(1, (SLOT_W - 40) / Math.max(1, w));
    const wf = Math.min(1, Math.max(0.42, (w * k + 44) / SLOT_W)), x0 = (SLOT_W * (1 - wf)) / 2;
    // The plate is only as long as its name: background and border drawn to that width.
    g.fillStyle = st.bg; g.fillRect(x0, y, SLOT_W * wf, SLOT_H);
    g.strokeStyle = st.border; g.lineWidth = 3.5; g.strokeRect(x0 + 5, y + 5, SLOT_W * wf - 10, SLOT_H - 10);
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(SLOT_W / 2, y + SLOT_H / 2 + 2); g.scale(k, 1); g.fillText(t, 0, 0); g.restore();
    widths.set(n, wf);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const slot = new Map(names.map((n, i) => [n, i]));

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const blade = (x: number, y: number, z: number, dx: number, dz: number, name: string) => {
    const i = slot.get(name)!;
    // Use only the part of the slot the name fills, at the slot's aspect, so letters aren't stretched.
    const wf = widths.get(name) ?? 1, h = BLADE_H, L = wf * (SLOT_W / SLOT_H) * h;
    const ua = (1 - wf) / 2 + 0.002, ub = (1 + wf) / 2 - 0.002;
    const ax = x - dx * L / 2, az = z - dz * L / 2, bx = x + dx * L / 2, bz = z + dz * L / 2;
    const vb = 1 - (i * SLOT_H + SLOT_H - 1) / H, vt = 1 - (i * SLOT_H + 1) / H;
    const nx = -dz, nz = dx;
    for (const side of [1, -1]) {
      const o = side * 0.014;
      const p0 = [ax + nx * o, y, az + nz * o], p1 = [bx + nx * o, y, bz + nz * o], p2 = [bx + nx * o, y + h, bz + nz * o], p3 = [ax + nx * o, y + h, az + nz * o];
      // Seen from its own side, each face reads left to right (a→b on the +n face, b→a on the back).
      const [u0, u1] = side > 0 ? [ua, ub] : [ub, ua];
      const verts = side > 0 ? [p0, p1, p2, p0, p2, p3] : [p0, p2, p1, p0, p3, p2];
      const uvs = side > 0 ? [[u0, vb], [u1, vb], [u1, vt], [u0, vb], [u1, vt], [u0, vt]] : [[u0, vb], [u1, vt], [u1, vb], [u0, vb], [u0, vt], [u1, vt]];
      for (let k = 0; k < 6; k++) { pos.push(...verts[k]); nrm.push(nx * side, 0, nz * side); uv.push(uvs[k][0], uvs[k][1]); }
    }
  };
  for (const s of signs) {
    // Each blade runs along its own street, so you read it standing on that street's sidewalk.
    blade(s.x, s.y + BLADE_Y[0], s.z, s.a.dx, s.a.dz, s.a.name);
    blade(s.x, s.y + BLADE_Y[1], s.z, s.b.dx, s.b.dz, s.b.name);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1 });
  mat.userData.perChunk = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}
