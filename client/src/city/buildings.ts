import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout, Lot, RepoSite } from './layout.ts';
import { facadeMaterial, unitBox, taperedBox, unitCylinder } from './facade.ts';
import type { Box } from '../player.ts';
import { api } from '../api.ts';
import { shared } from '../engine.ts';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

interface Piece { x: number; y: number; z: number; w: number; h: number; d: number; color: THREE.Color }

/** Filler buildings: thousands of boxes in a handful of instanced draw calls. */
export function buildFiller(l: Layout, colliders: Box[]) {
  const p = l.profile, rand = l.rand;
  const pieces: Record<'masonry' | 'glass', Piece[]> = { masonry: [], glass: [] };
  const roofBits: Piece[] = [];
  const towers: THREE.Vector3[] = [];

  for (const lot of l.lots) {
    if (lot.repo) continue;
    const pal = lot.style === 'glass' ? p.palette.glass : p.palette.masonry;
    const color = new THREE.Color(pal[Math.floor(rand() * pal.length)]).multiplyScalar(0.85 + rand() * 0.3);
    const inset = 0.4;
    const x0 = lot.x0 + inset, x1 = lot.x1 - inset, z0 = lot.z0 + inset, z1 = lot.z1 - inset;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const base = minGround(l, x0, x1, z0, z1) - 0.5;
    const top = maxGround(l, x0, x1, z0, z1);
    const h = lot.height + (top - base);
    const list = pieces[lot.style];

    if (lot.height > 70 && rand() < 0.75) {
      // Setback tower (classic NYC zoning silhouette).
      const tiers = 2 + Math.floor(rand() * 2);
      let cw = w, cd = d, y = base, remaining = h;
      for (let t = 0; t < tiers; t++) {
        const th = t === tiers - 1 ? remaining : remaining * (0.45 + rand() * 0.2);
        list.push({ x: cx, y, z: cz, w: cw, h: th, d: cd, color });
        y += th; remaining -= th;
        cw *= 0.72 + rand() * 0.12; cd *= 0.72 + rand() * 0.12;
      }
      if (rand() < 0.5) roofBits.push({ x: cx, y, z: cz, w: 1.2, h: 6 + rand() * 18, d: 1.2, color: new THREE.Color(0x777777) });
    } else {
      list.push({ x: cx, y: base, z: cz, w, h, d, color });
      // Rooftop mechanicals.
      const n = Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const bw = 2 + rand() * Math.min(6, w * 0.3), bd = 2 + rand() * Math.min(6, d * 0.3);
        roofBits.push({ x: cx + (rand() - 0.5) * (w - bw) * 0.8, y: base + h, z: cz + (rand() - 0.5) * (d - bd) * 0.8, w: bw, h: 1.5 + rand() * 2.5, d: bd, color: new THREE.Color(0x8a8a88) });
      }
      if (p.waterTowers && lot.height < 60 && lot.height > 14 && rand() < 0.28) towers.push(new THREE.Vector3(cx + (rand() - 0.5) * w * 0.4, base + h, cz + (rand() - 0.5) * d * 0.4));
    }
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: base + h });
  }

  const group = new THREE.Group();
  for (const kind of ['masonry', 'glass'] as const) {
    const mesh = instancedFrom(unitBox, facadeMaterial(kind), pieces[kind]);
    group.add(mesh);
  }
  group.add(instancedFrom(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), roofBits));
  if (towers.length) group.add(waterTowers(towers));
  return group;
}

function instancedFrom(geo: THREE.BufferGeometry, mat: THREE.Material, list: Piece[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  list.forEach((pc, i) => {
    tmpM.compose(tmpP.set(pc.x, pc.y, pc.z), tmpQ.identity(), tmpS.set(pc.w, pc.h, pc.d));
    mesh.setMatrixAt(i, tmpM);
    mesh.setColorAt(i, pc.color);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Iconic NYC wooden rooftop water towers. */
function waterTowers(at: THREE.Vector3[]) {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  parts.push(paint(new THREE.CylinderGeometry(1.8, 1.8, 4, 14).translate(0, 5, 0), 0x6b4a2f));
  parts.push(paint(new THREE.ConeGeometry(2.0, 1.6, 14).translate(0, 7.8, 0), 0x3b2f28));
  for (const [x, z] of [[1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]]) parts.push(paint(new THREE.BoxGeometry(0.2, 3, 0.2).translate(x, 1.5, z), 0x2a2a2a));
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), at.length);
  at.forEach((p, i) => { tmpM.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(i, tmpM); });
  mesh.castShadow = true;
  return mesh;
}

export function minGround(l: Layout, x0: number, x1: number, z0: number, z1: number) {
  return Math.min(l.groundY(x0, z0), l.groundY(x1, z0), l.groundY(x0, z1), l.groundY(x1, z1), l.groundY((x0 + x1) / 2, (z0 + z1) / 2));
}
function maxGround(l: Layout, x0: number, x1: number, z0: number, z1: number) {
  return Math.max(l.groundY(x0, z0), l.groundY(x1, z0), l.groundY(x0, z1), l.groundY(x1, z1), l.groundY((x0 + x1) / 2, (z0 + z1) / 2));
}

// ---------------------------------------------------------------------------------------------
// Repo buildings
// ---------------------------------------------------------------------------------------------

const logoCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadLogo(name: string, hasLogo: boolean): Promise<HTMLImageElement | null> {
  if (!hasLogo) return Promise.resolve(null);
  let pr = logoCache.get(name);
  if (!pr) {
    pr = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = api.logoUrl(name);
    });
    logoCache.set(name, pr);
  }
  return pr;
}

function initials(name: string) {
  const parts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Square sign: the repo logo on a light panel, or a monogram in the brand color. */
function logoTexture(site: RepoSite, img: HTMLImageElement | null) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  if (img) {
    g.fillStyle = '#f7f7f5';
    roundRect(g, 0, 0, 512, 512, 60); g.fill();
    const s = Math.min(400 / img.naturalWidth, 400 / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    g.drawImage(img, 256 - w / 2, 256 - h / 2, w, h);
  } else {
    g.fillStyle = site.repo.brandColor || '#6b7a8f';
    roundRect(g, 0, 0, 512, 512, 60); g.fill();
    g.fillStyle = '#fff';
    g.font = '800 230px Inter, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initials(site.repo.name), 256, 270);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function nameTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(12,14,20,0.92)';
  roundRect(g, 0, 0, 1024, 192, 24); g.fill();
  g.fillStyle = color; g.fillRect(0, 168, 1024, 24);
  g.fillStyle = '#fff';
  let size = 110;
  g.font = `800 ${size}px Inter, sans-serif`;
  while (g.measureText(text).width > 940 && size > 40) { size -= 6; g.font = `800 ${size}px Inter, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Glass lobby doors with frames, warm light inside and a brand-colored transom. */
function doorTexture(brand: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#7a6a52'); grd.addColorStop(1, '#f3dcae');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,240,210,0.5)';
  for (let x = 30; x < 512; x += 90) g.fillRect(x, 0, 40, 30);
  g.fillStyle = brand || '#ffcc33'; g.fillRect(0, 0, 512, 22);
  g.fillStyle = '#15181c';
  for (const x of [0, 128, 254, 382, 506]) g.fillRect(x, 0, 6, 256);
  g.fillRect(0, 22, 512, 6); g.fillRect(0, 250, 512, 6);
  g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect(236, 120, 6, 50); g.fillRect(270, 120, 6, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Materials whose glow follows the day/night cycle. */
export const glowMaterials: THREE.MeshStandardMaterial[] = [];
export function updateGlow(time: number) {
  const n = shared.uNight.value;
  for (const m of glowMaterials) m.emissiveIntensity = (m.userData.base ?? 1) * (0.35 + n * 0.6) * (m.userData.blink ? (Math.sin(time * 3) > 0.6 ? 1 : 0.05) : 1);
}

function glow(color: THREE.ColorRepresentation, base = 1, blink = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: base, roughness: 0.4 });
  m.userData = { base, blink };
  glowMaterials.push(m);
  return m;
}

export interface RepoBuilding { group: THREE.Group; site: RepoSite; top: THREE.Vector3 }

export async function buildRepoBuilding(l: Layout, site: RepoSite, colliders: Box[]): Promise<RepoBuilding> {
  const { lot, repo } = site;
  const group = new THREE.Group();
  group.name = `repo:${repo.name}`;
  const brand = new THREE.Color(repo.brandColor || '#6b7a8f');
  const pal = lot.style === 'glass' ? l.profile.palette.glass : l.profile.palette.masonry;
  const tint = new THREE.Color(pal[(repo.name.length * 7) % pal.length]).lerp(brand, 0.12);

  const x0 = lot.x0 + 0.4, x1 = lot.x1 - 0.4, z0 = lot.z0 + 0.4, z1 = lot.z1 - 0.4;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const base = minGround(l, x0, x1, z0, z1) - 0.5;
  const H = site.height + (site.door.y - base);
  const kind = lot.style;

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const facade = facadeMaterial(kind, { color: tint, glass: kind === 'glass' ? new THREE.Color(0x2e4152).lerp(brand, 0.15) : undefined });
  let top = base + H;
  let crownW = w, crownD = d;

  switch (site.shape) {
    case 'setback': {
      let y = base, cw = w, cd = d;
      const tiers = [0.5, 0.25, 0.15, 0.1];
      for (const f of tiers) {
        add(unitBox, facade, cx, y, cz, cw, H * f, cd);
        y += H * f; cw *= 0.78; cd *= 0.78;
      }
      top = y; crownW = cw / 0.78; crownD = cd / 0.78;
      add(new THREE.CylinderGeometry(0.4, 1.6, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 }), cx, top, cz, 1, H * 0.18, 1);
      break;
    }
    case 'obelisk': {
      add(taperedBox(0.55), facade, cx, base, cz, w, H, d);
      top = base + H; crownW = w * 0.55; crownD = d * 0.55;
      add(new THREE.CylinderGeometry(0.25, 0.8, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.25 }), cx, top, cz, 1, H * 0.22, 1);
      break;
    }
    case 'crown': {
      add(unitBox, facade, cx, base, cz, w, H * 0.82, d);
      let y = base + H * 0.82, s = Math.min(w, d) * 0.8;
      const steel = new THREE.MeshStandardMaterial({ color: 0xd0d4d9, metalness: 1, roughness: 0.2 });
      for (let i = 0; i < 5; i++) {
        const h = H * 0.03;
        add(unitBox, steel, cx, y, cz, s, h, s, i % 2 ? Math.PI / 4 : 0);
        add(unitBox, glow(brand, 1.2), cx, y + h, cz, s * 1.01, 0.4, s * 1.01, i % 2 ? Math.PI / 4 : 0);
        y += h; s *= 0.78;
      }
      add(new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0), steel, cx, y, cz, s, H * 0.1, s);
      top = y; crownW = w; crownD = d;
      break;
    }
    case 'cylinder': {
      const r = Math.min(w, d);
      add(unitCylinder, facadeMaterial('glass', { color: tint, cylinder: true }), cx, base, cz, r, H, r);
      const dome = new THREE.SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      add(dome, new THREE.MeshStandardMaterial({ color: 0xcfd8de, metalness: 0.7, roughness: 0.25 }), cx, base + H, cz, r, r * 0.7, r);
      top = base + H; crownW = r * 0.71; crownD = r * 0.71;
      break;
    }
    case 'slab': {
      add(unitBox, facade, cx, base, cz, w, H, d);
      add(unitBox, glow(brand, 1), cx, base + H - 3, cz, w + 0.3, 1.2, d + 0.3);
      top = base + H;
      break;
    }
    default: {
      add(unitBox, facade, cx, base, cz, w, H, d);
      // Parapet in brand color for the smaller buildings.
      add(unitBox, new THREE.MeshStandardMaterial({ color: brand, roughness: 0.6 }), cx, base + H, cz, w + 0.2, 0.8, d + 0.2);
      top = base + H;
    }
  }
  colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: top });

  // Aircraft warning light on tall buildings.
  if (H > 80) {
    const b = add(new THREE.SphereGeometry(0.6, 8, 6), glow(0xff2a2a, 3, true), cx, top + (site.shape === 'setback' ? H * 0.18 : site.shape === 'obelisk' ? H * 0.22 : 2), cz, 1, 1, 1);
    b.castShadow = false;
  }

  // ---- Signage ----
  const img = await loadLogo(repo.name, repo.hasLogo);
  const logoMat = new THREE.MeshBasicMaterial({ map: logoTexture(site, img), toneMapped: true });
  const nameMat = new THREE.MeshBasicMaterial({ map: nameTexture(repo.name, repo.brandColor || '#ffcc33'), transparent: true });
  const plane = new THREE.PlaneGeometry(1, 1);
  const faces: [number, number, number, number, number][] = [
    // [nx, nz, halfW(of perpendicular extent), offset, rotY]
    [0, 1, crownW, crownD / 2, 0], [0, -1, crownW, crownD / 2, Math.PI], [1, 0, crownD, crownW / 2, Math.PI / 2], [-1, 0, crownD, crownW / 2, -Math.PI / 2],
  ];
  if (H > 40) {
    const signY = site.shape === 'crown' ? base + H * 0.74 : site.shape === 'setback' ? base + H * 0.68 : top - Math.min(crownW, crownD) * 0.45 - 4;
    for (const [nx, nz, span, off, ry] of faces) {
      const s = Math.min(span * 0.62, 24);
      const at = new THREE.Vector3(cx + nx * (off + 0.3), signY, cz + nz * (off + 0.3));
      if (site.shape === 'obelisk' || site.shape === 'cylinder') {
        // Signs sit lower on tapered/round towers, where the face is wide enough.
        at.y = base + H * 0.55;
        const r = site.shape === 'cylinder' ? Math.min(w, d) / 2 : (1 - 0.45 * 0.55) * (nx !== 0 ? w / 2 : d / 2);
        at.x = cx + nx * (r + 0.6); at.z = cz + nz * (r + 0.6);
      }
      const m = new THREE.Mesh(plane, logoMat);
      m.position.copy(at); m.rotation.y = ry; m.scale.setScalar(s);
      group.add(m);
    }
  }

  // Entrance: canopy, glowing doors, name sign above, logo plaque.
  const out = site.doorOut;
  const ry = Math.atan2(out.x, out.z);
  const doorW = repo.tier === 'landmark' ? 8 : repo.tier === 'tower' ? 6 : 3.6;
  const gy = site.door.y;
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x0b1016, roughness: 0.08, metalness: 0.6, emissive: 0xffffff, emissiveMap: doorTexture(repo.brandColor), emissiveIntensity: 0.8 });
  doorMat.userData = { base: 0.8 };
  glowMaterials.push(doorMat);
  const door = new THREE.Mesh(plane, doorMat);
  door.position.copy(site.door).addScaledVector(out, 0.06); door.position.y = gy + 1.6;
  door.rotation.y = ry; door.scale.set(doorW, 3.2, 1);
  group.add(door);
  const canopy = add(unitBox, new THREE.MeshStandardMaterial({ color: brand, roughness: 0.4, metalness: 0.3 }), 0, 0, 0, doorW + 2, 0.35, 3);
  canopy.position.copy(site.door).addScaledVector(out, 1.5); canopy.position.y = gy + 3.6; canopy.rotation.y = ry;
  const strip = add(unitBox, glow(brand, 1.6), 0, 0, 0, doorW + 2.05, 0.12, 3.05);
  strip.position.copy(canopy.position); strip.position.y = gy + 3.58; strip.rotation.y = ry;
  const nm = new THREE.Mesh(plane, nameMat);
  const nameW = Math.min(Math.max(doorW + 4, 9), (out.x !== 0 ? d : w) * 0.9);
  nm.position.copy(site.door).addScaledVector(out, 0.08); nm.position.y = gy + 5.4;
  nm.rotation.y = ry; nm.scale.set(nameW, nameW * 0.1875, 1);
  group.add(nm);
  if (H <= 40) {
    const lg = new THREE.Mesh(plane, logoMat);
    const s = Math.min(6, Math.max(3, (out.x !== 0 ? d : w) * 0.25));
    lg.position.copy(site.door).addScaledVector(out, 0.08); lg.position.y = Math.min(gy + 6.4 + s / 2 + 0.6, base + H - s / 2 - 0.5);
    if (lg.position.y - s / 2 < gy + 6.2) lg.position.y = base + H + s / 2 + 0.9; // roof-mounted on tiny buildings
    lg.rotation.y = ry; lg.scale.setScalar(s);
    group.add(lg);
  }
  // Pillars flanking the door so it reads as an entrance.
  for (const side of [-1, 1]) {
    const px = site.door.x + out.z * side * (doorW / 2 + 0.6) + out.x * 2.6;
    const pz = site.door.z - out.x * side * (doorW / 2 + 0.6) + out.z * 2.6;
    add(new THREE.CylinderGeometry(0.18, 0.18, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 }), px, gy, pz, 1, 3.6, 1);
  }

  return { group, site, top: new THREE.Vector3(cx, top, cz) };
}

export function lotCenter(lot: Lot) {
  return new THREE.Vector3((lot.x0 + lot.x1) / 2, 0, (lot.z0 + lot.z1) / 2);
}
