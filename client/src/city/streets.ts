import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout } from './layout.ts';
import { SIDEWALK, mulberry32 } from './layout.ts';
import { asphalt, concrete, grass, sand } from './textures.ts';
import { facadeMaterial, unitBox } from './facade.ts';
import { shared } from '../engine.ts';
import type { Box } from '../player.ts';

export const CURB = 0.18;
export const LANE_W = 3.4;

/** Lane center offsets from a road centerline for one travel direction (positive side). */
export function laneOffsets(roadW: number) {
  const n = Math.max(1, Math.floor((roadW / 2 - 1.2) / LANE_W));
  return Array.from({ length: n }, (_, i) => 1.1 + LANE_W * (i + 0.5));
}

type Y = (x: number, z: number) => number;

/** A terrain-following grid patch with world-space UVs (uvScale meters per texture repeat). */
function patch(x0: number, x1: number, z0: number, z1: number, y: Y, lift: number, cell: number, uvScale: number) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    pos.push(x, y(x, z) + lift, z);
    uv.push(x / uvScale, z / uvScale);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical curb faces around a rectangle. */
function curbRing(x0: number, x1: number, z0: number, z1: number, y: Y, cell: number) {
  const pos: number[] = [], uv: number[] = [];
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / cell));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p0x = ax + (bx - ax) * t0, p0z = az + (bz - az) * t0, p1x = ax + (bx - ax) * t1, p1z = az + (bz - az) * t1;
      const y0 = y(p0x, p0z), y1 = y(p1x, p1z);
      pos.push(p0x, y0 - 0.05, p0z, p1x, y1 - 0.05, p1z, p1x, y1 + CURB, p1z, p0x, y0 - 0.05, p0z, p1x, y1 + CURB, p1z, p0x, y0 + CURB, p0z);
      uv.push(0, 0, 1, 0, 1, 0.1, 0, 0, 1, 0.1, 0, 0.1);
    }
  };
  edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A flat painted strip along a line, following the terrain. */
function strip(ax: number, az: number, bx: number, bz: number, width: number, y: Y, out: number[]) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 6));
  const px = (-(bz - az) / len) * (width / 2), pz = ((bx - ax) / len) * (width / 2);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
    const y0 = y(x0, z0) + 0.025, y1 = y(x1, z1) + 0.025;
    out.push(x0 - px, y0, z0 - pz, x1 + px, y1, z1 + pz, x1 - px, y1, z1 - pz, x0 - px, y0, z0 - pz, x0 + px, y0, z0 + pz, x1 + px, y1, z1 + pz);
  }
}

function geoFrom(pos: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export interface Streets {
  group: THREE.Group;
  water: THREE.Mesh | null;
  update(dt: number): void;
  /** Which road axis has a green light right now: 'x' roads (streets) or 'z' roads (avenues), or null during all-red. */
  green(): 'x' | 'z' | null;
}

export function buildStreets(l: Layout, colliders: Box[]): Streets {
  const p = l.profile, y = l.groundY, rand = mulberry32(42);
  const group = new THREE.Group();
  const hilly = p.hills > 0;
  const cell = hilly ? 6 : 1e9;

  // ---- Road surface (one big asphalt patch over the land) ----
  const asphaltTex = asphalt();
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0xbfbfc4, roughness: 0.92 });
  const land = l.land;
  const road = new THREE.Mesh(patch(land.minX, land.maxX, land.minZ, land.maxZ, y, 0, hilly ? 8 : 1e9, 14), roadMat);
  road.receiveShadow = true;
  group.add(road);

  // ---- Sidewalk slabs & curbs per block ----
  const swTex = concrete(p.palette.sidewalk);
  const swMat = new THREE.MeshStandardMaterial({ map: swTex, color: 0x9a9a9a, roughness: 0.9 });
  const grassMat = new THREE.MeshStandardMaterial({ map: grass(), roughness: 1 });
  const swGeos: THREE.BufferGeometry[] = [], grassGeos: THREE.BufferGeometry[] = [];
  for (const b of l.blocks) {
    swGeos.push(curbRing(b.x0, b.x1, b.z0, b.z1, y, cell));
    if (b.park) {
      // Paved ring + lawn.
      const s = SIDEWALK;
      swGeos.push(patch(b.x0, b.x1, b.z0, b.z0 + s, y, CURB, cell, 3), patch(b.x0, b.x1, b.z1 - s, b.z1, y, CURB, cell, 3));
      swGeos.push(patch(b.x0, b.x0 + s, b.z0 + s, b.z1 - s, y, CURB, cell, 3), patch(b.x1 - s, b.x1, b.z0 + s, b.z1 - s, y, CURB, cell, 3));
      grassGeos.push(patch(b.x0 + s, b.x1 - s, b.z0 + s, b.z1 - s, y, CURB + 0.02, hilly ? 6 : 12, 10));
    } else {
      swGeos.push(patch(b.x0, b.x1, b.z0, b.z1, y, CURB, cell, 3));
    }
  }
  // Waterfront promenade + seawall.
  const prom: [number, number, number, number][] = [];
  if (p.water.includes('west')) prom.push([land.minX, l.grid.minX - p.avenueW / 2, land.minZ, land.maxZ]);
  if (p.water.includes('east')) prom.push([l.grid.maxX + p.avenueW / 2, land.maxX, land.minZ, land.maxZ]);
  if (p.water.includes('south')) prom.push([land.minX, land.maxX, land.minZ, l.grid.minZ - p.streetW / 2]);
  if (p.water.includes('north')) prom.push([land.minX, land.maxX, l.grid.maxZ + p.streetW / 2, land.maxZ]);
  const promGeos: THREE.BufferGeometry[] = [];
  for (const [x0, x1, z0, z1] of prom) {
    promGeos.push(patch(x0, x1, z0, z1, y, CURB, cell, 3), curbRing(x0, x1, z0, z1, y, cell));
  }
  group.add(mergedMesh(swGeos, swMat), mergedMesh(promGeos, p.trees === 'palm' ? new THREE.MeshStandardMaterial({ map: sand(), roughness: 1 }) : swMat));
  if (grassGeos.length) group.add(mergedMesh(grassGeos, grassMat));

  // Seawall faces + railings.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.7, roughness: 0.4 });
  const sea: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const edgeWall = (ax: number, az: number, bx: number, bz: number) => {
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    sea.push(new THREE.BoxGeometry(alongX ? len : 1, 6, alongX ? 1 : len).translate(cx, -2.8, cz));
    rails.push(new THREE.BoxGeometry(alongX ? len : 0.12, 0.1, alongX ? 0.12 : len).translate(cx, 1.15, cz));
    for (let t = 0; t <= len; t += 3) {
      const px = ax + ((bx - ax) * t) / len, pz = az + ((bz - az) * t) / len;
      rails.push(new THREE.BoxGeometry(0.08, 1.1, 0.08).translate(px, 0.6, pz));
    }
  };
  if (p.water.includes('west')) edgeWall(land.minX, land.minZ, land.minX, land.maxZ);
  if (p.water.includes('east')) edgeWall(land.maxX, land.minZ, land.maxX, land.maxZ);
  if (p.water.includes('south')) edgeWall(land.minX, land.minZ, land.maxX, land.minZ);
  if (p.water.includes('north')) edgeWall(land.minX, land.maxZ, land.maxX, land.maxZ);
  if (sea.length) group.add(mergedMesh(sea, wallMat), mergedMesh(rails, railMat));

  // ---- Lane markings, crosswalks, stop lines ----
  const yellow: number[] = [], white: number[] = [];
  const A = l.avenuesX, S = l.streetsZ;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < S.length - 1; j++) {
    const za = S[j] + p.streetW / 2 + 3, zb = S[j + 1] - p.streetW / 2 - 3, x = A[i];
    strip(x - 0.18, za, x - 0.18, zb, 0.12, y, yellow); strip(x + 0.18, za, x + 0.18, zb, 0.12, y, yellow);
    for (const off of laneOffsets(p.avenueW).slice(0, -1)) for (const sgn of [-1, 1]) dashes(x + sgn * (off + LANE_W / 2), za, x + sgn * (off + LANE_W / 2), zb, white);
    // Crosswalks across this avenue at both ends of the segment.
    zebra(x - p.avenueW / 2 + 0.6, x + p.avenueW / 2 - 0.6, za - 2.2, 'x', white);
    zebra(x - p.avenueW / 2 + 0.6, x + p.avenueW / 2 - 0.6, zb + 2.2, 'x', white);
  }
  for (let j = 0; j < S.length; j++) for (let i = 0; i < A.length - 1; i++) {
    const xa = A[i] + p.avenueW / 2 + 3, xb = A[i + 1] - p.avenueW / 2 - 3, z = S[j];
    strip(xa, z - 0.18, xb, z - 0.18, 0.12, y, yellow); strip(xa, z + 0.18, xb, z + 0.18, 0.12, y, yellow);
    for (const off of laneOffsets(p.streetW).slice(0, -1)) for (const sgn of [-1, 1]) dashes(xa, z + sgn * (off + LANE_W / 2), xb, z + sgn * (off + LANE_W / 2), white);
    zebra(z - p.streetW / 2 + 0.6, z + p.streetW / 2 - 0.6, xa - 2.2, 'z', white);
    zebra(z - p.streetW / 2 + 0.6, z + p.streetW / 2 - 0.6, xb + 2.2, 'z', white);
  }
  function dashes(ax: number, az: number, bx: number, bz: number, out: number[]) {
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t < len - 3; t += 9) {
      const t1 = Math.min(len, t + 3);
      strip(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, ax + ((bx - ax) * t1) / len, az + ((bz - az) * t1) / len, 0.14, y, out);
    }
  }
  function zebra(a: number, b: number, at: number, across: 'x' | 'z', out: number[]) {
    for (let v = a; v < b; v += 1.1) {
      if (across === 'x') strip(v + 0.3, at - 1.5, v + 0.3, at + 1.5, 0.55, y, out);
      else strip(at - 1.5, v + 0.3, at + 1.5, v + 0.3, 0.55, y, out);
    }
  }
  const paint = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const yMesh = new THREE.Mesh(geoFrom(yellow), paint(0xd9b23a)), wMesh = new THREE.Mesh(geoFrom(white), paint(0xd8d8d2));
  yMesh.receiveShadow = wMesh.receiveShadow = true;
  group.add(yMesh, wMesh);

  // ---- Street lights ----
  const lampPts: THREE.Vector3[] = [], lampRot: number[] = [];
  for (const b of l.blocks) {
    if (b.outer && rand() < 0.5) continue;
    const pts: [number, number, number][] = [
      [b.x0 + 0.7, b.z0 + 0.7, -Math.PI * 0.75], [b.x1 - 0.7, b.z0 + 0.7, Math.PI * 0.75], [b.x0 + 0.7, b.z1 - 0.7, -Math.PI * 0.25], [b.x1 - 0.7, b.z1 - 0.7, Math.PI * 0.25],
    ];
    const longX = b.x1 - b.x0 > b.z1 - b.z0;
    if (longX) pts.push([(b.x0 + b.x1) / 2, b.z0 + 0.7, Math.PI], [(b.x0 + b.x1) / 2, b.z1 - 0.7, 0]);
    else pts.push([b.x0 + 0.7, (b.z0 + b.z1) / 2, -Math.PI / 2], [b.x1 - 0.7, (b.z0 + b.z1) / 2, Math.PI / 2]);
    for (const [x, z, r] of pts) { lampPts.push(new THREE.Vector3(x, y(x, z) + CURB, z)); lampRot.push(r); }
  }
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.13, 8, 8).translate(0, 4, 0),
    new THREE.BoxGeometry(0.08, 0.08, 2.4).translate(0, 7.9, 1.2),
  ]);
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9).translate(0, 7.8, 2.3);
  const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.6, roughness: 0.5 }), lampPts.length);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const headMesh = new THREE.InstancedMesh(headGeo, lampMat, lampPts.length);
  const m4 = new THREE.Matrix4();
  lampPts.forEach((pt, i) => {
    m4.makeRotationY(lampRot[i]).setPosition(pt);
    poleMesh.setMatrixAt(i, m4); headMesh.setMatrixAt(i, m4);
    colliders.push({ minX: pt.x - 0.2, maxX: pt.x + 0.2, minZ: pt.z - 0.2, maxZ: pt.z + 0.2, maxY: pt.y + 8 });
  });
  poleMesh.castShadow = true;
  group.add(poleMesh, headMesh);
  // Pools of light on the ground under each lamp (cheap fake lights).
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTex() });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), poolMat, lampPts.length);
  lampPts.forEach((pt, i) => {
    const dx = Math.sin(lampRot[i]) * 2.3, dz = Math.cos(lampRot[i]) * 2.3;
    m4.makeTranslation(pt.x + dx, y(pt.x + dx, pt.z + dz) + 0.06, pt.z + dz);
    pools.setMatrixAt(i, m4);
  });
  pools.renderOrder = 1;
  group.add(pools);

  // ---- Traffic signals ----
  const heads: { pos: THREE.Vector3; axis: 'x' | 'z'; rot: number }[] = [];
  for (let i = 0; i < A.length; i++) for (let j = 0; j < S.length; j++) {
    const x = A[i], z = S[j];
    const hx = p.avenueW / 2 + 0.6, hz = p.streetW / 2 + 0.6;
    // One pole per corner, facing traffic approaching on that side.
    heads.push({ pos: new THREE.Vector3(x + hx, 0, z - hz), axis: 'z', rot: Math.PI });
    heads.push({ pos: new THREE.Vector3(x - hx, 0, z + hz), axis: 'z', rot: 0 });
    heads.push({ pos: new THREE.Vector3(x - hx, 0, z - hz), axis: 'x', rot: -Math.PI / 2 });
    heads.push({ pos: new THREE.Vector3(x + hx, 0, z + hz), axis: 'x', rot: Math.PI / 2 });
  }
  heads.forEach((h) => (h.pos.y = y(h.pos.x, h.pos.z) + CURB));
  const sigPole = new THREE.InstancedMesh(mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.12, 4.2, 8).translate(0, 2.1, 0),
    new THREE.BoxGeometry(0.45, 1.3, 0.35).translate(0, 4.4, 0),
  ]), new THREE.MeshStandardMaterial({ color: 0x1d2a1f, roughness: 0.6, metalness: 0.4 }), heads.length);
  const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), heads.length * 3);
  heads.forEach((h, i) => {
    m4.makeRotationY(h.rot).setPosition(h.pos);
    sigPole.setMatrixAt(i, m4);
    const fwd = new THREE.Vector3(Math.sin(h.rot), 0, Math.cos(h.rot));
    for (let k = 0; k < 3; k++) {
      const bp = h.pos.clone().add(new THREE.Vector3(0, 4.82 - k * 0.4, 0)).addScaledVector(fwd, 0.19);
      bulbs.setMatrixAt(i * 3 + k, new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z));
    }
    colliders.push({ minX: h.pos.x - 0.2, maxX: h.pos.x + 0.2, minZ: h.pos.z - 0.2, maxZ: h.pos.z + 0.2, maxY: h.pos.y + 5 });
  });
  sigPole.castShadow = true;
  group.add(sigPole, bulbs);

  const CYCLE = 26; // seconds: 11 green Z, 2 yellow, 0.5 red, 11 green X, 2 yellow, 0.5 red
  let t = rand() * CYCLE;
  let lastState = '';
  const RED = new THREE.Color(0xff2a1a), AMB = new THREE.Color(0xffb020), GRN = new THREE.Color(0x30ff7a), OFF = new THREE.Color(0x151515);
  const state = () => {
    const c = t % CYCLE;
    if (c < 11) return { z: 'g', x: 'r' };
    if (c < 13) return { z: 'y', x: 'r' };
    if (c < 13.5) return { z: 'r', x: 'r' };
    if (c < 24.5) return { z: 'r', x: 'g' };
    if (c < 26) return { z: 'r', x: 'y' };
    return { z: 'r', x: 'r' };
  };
  const refreshBulbs = () => {
    const s = state();
    const key = s.x + s.z;
    if (key === lastState) return;
    lastState = key;
    heads.forEach((h, i) => {
      const st = s[h.axis];
      bulbs.setColorAt(i * 3, st === 'r' ? RED : OFF);
      bulbs.setColorAt(i * 3 + 1, st === 'y' ? AMB : OFF);
      bulbs.setColorAt(i * 3 + 2, st === 'g' ? GRN : OFF);
    });
    bulbs.instanceColor!.needsUpdate = true;
  };
  refreshBulbs();

  // ---- Trees ----
  group.add(buildTrees(l, colliders));

  // ---- Water, far shores, bridge ----
  let water: THREE.Mesh | null = null;
  if (p.water.length) {
    const nTex = new THREE.TextureLoader().load('/textures/waternormals.jpg');
    nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping;
    nTex.repeat.set(60, 60);
    const wMat = new THREE.MeshStandardMaterial({ color: p.palette.water, roughness: 0.06, metalness: 0.35, normalMap: nTex, normalScale: new THREE.Vector2(0.55, 0.55) });
    water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), wMat);
    water.position.y = -1.4;
    water.receiveShadow = true;
    group.add(water);
    group.add(farShores(l));
    if (p.bridge) group.add(bridge(l));
  }

  return {
    group,
    water,
    update(dt) {
      t += dt;
      refreshBulbs();
      const n = shared.uNight.value;
      lampMat.emissiveIntensity = n * 3.2;
      poolMat.opacity = n * 0.38;
      if (water) {
        const nm = (water.material as THREE.MeshStandardMaterial).normalMap!;
        nm.offset.x += dt * 0.004; nm.offset.y += dt * 0.0025;
      }
    },
    green() {
      const s = state();
      return s.z === 'g' ? 'z' : s.x === 'g' ? 'x' : null;
    },
  };
}

function mergedMesh(geos: THREE.BufferGeometry[], mat: THREE.Material) {
  const clean = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of clean) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  const m = new THREE.Mesh(mergeGeometries(clean), mat);
  m.receiveShadow = true;
  return m;
}

function radialTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------------------------

function colored(g: THREE.BufferGeometry, c: number, jitter = 0) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    const j = 1 + (Math.random() - 0.5) * jitter;
    arr[i] = col.r * j; arr[i + 1] = col.g * j; arr[i + 2] = col.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function oakGeometry() {
  const parts = [colored(new THREE.CylinderGeometry(0.16, 0.26, 3.4, 7).translate(0, 1.7, 0), 0x4a3a2c)];
  const blobs: [number, number, number, number][] = [[0, 4.6, 0, 2.1], [0.9, 4.0, 0.4, 1.5], [-0.8, 4.2, -0.5, 1.6], [0.2, 5.4, -0.3, 1.4]];
  for (const [x, yy, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      v.multiplyScalar(0.85 + Math.random() * 0.3);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    parts.push(colored(g.translate(x, yy, z), 0x4f7a3a, 0.35));
  }
  return mergeGeometries(parts);
}

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // Curved trunk from stacked segments.
  let px = 0, py = 0;
  for (let i = 0; i < 10; i++) {
    const seg = new THREE.CylinderGeometry(0.17 - i * 0.006, 0.2 - i * 0.006, 0.95, 7).translate(px, py + 0.47, 0);
    parts.push(colored(seg, 0x8b7355, 0.2));
    py += 0.92; px += 0.05 + i * 0.012;
  }
  for (let k = 0; k < 9; k++) {
    const frond = new THREE.PlaneGeometry(0.7, 3.4, 1, 6);
    const pos = frond.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i) + 1.7; // 0..3.4 along frond
      pos.setXYZ(i, pos.getX(i) * (1 - yy / 4), -0.12 * yy * yy, yy);
    }
    frond.rotateY((k / 9) * Math.PI * 2).translate(px, py, 0);
    parts.push(colored(frond, 0x4b7d36, 0.3));
  }
  return mergeGeometries(parts);
}

function buildTrees(l: Layout, colliders: Box[]) {
  const p = l.profile, rand = mulberry32(7);
  const spots: { x: number; z: number; s: number; palm: boolean }[] = [];
  const palmCity = p.trees === 'palm';
  for (const b of l.blocks) {
    if (b.park) {
      const area = (b.x1 - b.x0) * (b.z1 - b.z0);
      for (let i = 0; i < area / 160; i++) {
        const x = b.x0 + SIDEWALK + 3 + rand() * (b.x1 - b.x0 - 2 * SIDEWALK - 6);
        const z = b.z0 + SIDEWALK + 3 + rand() * (b.z1 - b.z0 - 2 * SIDEWALK - 6);
        spots.push({ x, z, s: 0.9 + rand() * 0.8, palm: palmCity && rand() < 0.7 });
      }
      continue;
    }
    if (rand() < (palmCity ? 0.35 : 0.45)) continue;
    // Street trees along the curb on the long sides.
    const step = palmCity ? 16 : 11;
    for (let x = b.x0 + 8; x < b.x1 - 8; x += step) for (const z of [b.z0 + 1.4, b.z1 - 1.4]) if (rand() < 0.75) spots.push({ x, z, s: 0.7 + rand() * 0.45, palm: palmCity || (p.trees === 'mixed' && rand() < 0.2) });
  }
  if (palmCity) {
    // Palms along the bayfront.
    const L = l.land;
    for (let z = L.minZ + 10; z < L.maxZ - 10; z += 14) spots.push({ x: L.maxX - 6, z, s: 1 + rand() * 0.4, palm: true });
    for (let x = L.minX + 10; x < L.maxX - 10; x += 14) if (p.water.includes('north')) spots.push({ x, z: L.maxZ - 6, s: 1 + rand() * 0.4, palm: true });
  }
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  for (const palm of [false, true]) {
    const list = spots.filter((s) => s.palm === palm);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(palm ? palmGeometry() : oakGeometry(), mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      m4.compose(new THREE.Vector3(s.x, l.groundY(s.x, s.z) + CURB, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + rand() * 0.25), s.s));
      mesh.setMatrixAt(i, m4);
      colliders.push({ minX: s.x - 0.3, maxX: s.x + 0.3, minZ: s.z - 0.3, maxZ: s.z + 0.3, maxY: 3 });
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Low-detail skyline across the water (Brooklyn / Oakland / Miami Beach / Cambridge). */
function farShores(l: Layout) {
  const p = l.profile, rand = mulberry32(99);
  const group = new THREE.Group();
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f3330, roughness: 1 });
  const items: { x: number; z: number; w: number; d: number; h: number; c: THREE.Color }[] = [];
  const L = l.land;
  const shore = (side: string) => {
    const gap = side === 'west' || side === 'east' ? 420 : 480;
    const depth = 900;
    let x0: number, x1: number, z0: number, z1: number;
    if (side === 'east') { x0 = L.maxX + gap; x1 = x0 + depth; z0 = L.minZ - 900; z1 = L.maxZ + 900; }
    else if (side === 'west') { x1 = L.minX - gap; x0 = x1 - depth; z0 = L.minZ - 900; z1 = L.maxZ + 900; }
    else if (side === 'north') { z0 = L.maxZ + gap; z1 = z0 + depth; x0 = L.minX - 900; x1 = L.maxX + 900; }
    else { z1 = L.minZ - gap; z0 = z1 - depth; x0 = L.minX - 900; x1 = L.maxX + 900; }
    const g = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2, z1 - z0), groundMat);
    g.position.set((x0 + x1) / 2, -0.6, (z0 + z1) / 2);
    group.add(g);
    for (let i = 0; i < 360; i++) {
      const w = 14 + rand() * 30, d = 14 + rand() * 30;
      const near = rand();
      const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
      const h = 8 + Math.pow(rand(), 3) * (p.id === 'miami' && side === 'east' ? 120 : 90) * (0.5 + near);
      const pal = h > 50 ? p.palette.glass : p.palette.masonry;
      items.push({ x, z, w, d, h, c: new THREE.Color(pal[Math.floor(rand() * pal.length)]) });
    }
  };
  p.water.forEach(shore);
  const masonry = items.filter((i) => i.h <= 50), glass = items.filter((i) => i.h > 50);
  for (const [list, kind] of [[masonry, 'masonry'], [glass, 'glass']] as const) {
    const mesh = new THREE.InstancedMesh(unitBox, facadeMaterial(kind), list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((b, i) => {
      m4.compose(new THREE.Vector3(b.x, 0.4, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, b.c);
    });
    group.add(mesh);
  }
  return group;
}

/** A suspension bridge leaving the waterfront toward the far shore. */
function bridge(l: Layout) {
  const p = l.profile, b = p.bridge!;
  const group = new THREE.Group();
  const L = l.land;
  const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.3 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 });
  const span = 460;
  // Build along +X from the origin, then rotate into place.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 22), deckMat);
  deck.position.set(span / 2, 12, 0);
  group.add(deck);
  const towerX = [span * 0.25, span * 0.75];
  const towerH = 120;
  for (const tx of towerX) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(4.5, towerH, 4.5), mat);
      leg.position.set(tx, towerH / 2 - 2, s * 12.5);
      group.add(leg);
    }
    for (const yy of [30, 70, towerH - 6]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4, 25), mat);
      beam.position.set(tx, yy, 0);
      group.add(beam);
    }
  }
  // Main cables (catenary) + suspenders.
  const cableMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0.5 });
  const suspenders: number[] = [];
  for (const s of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) {
      const x = (i / 80) * span;
      let yy: number;
      if (x < towerX[0]) yy = THREE.MathUtils.lerp(16, towerH - 4, x / towerX[0]);
      else if (x > towerX[1]) yy = THREE.MathUtils.lerp(towerH - 4, 16, (x - towerX[1]) / (span - towerX[1]));
      else { const u = (x - towerX[0]) / (towerX[1] - towerX[0]) * 2 - 1; yy = 18 + (towerH - 22) * u * u; }
      pts.push(new THREE.Vector3(x, yy, s * 12.5));
      if (i % 2 === 0) suspenders.push(x, 12.8, s * 12.5, x, yy, s * 12.5);
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.45, 6), cableMat));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(suspenders, 3));
  group.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: b.color })));
  // Deck lights.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 2 });
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 4), lightMat, 60);
  for (let i = 0; i < 60; i++) {
    const x = (i % 30) * (span / 30) + 6, s = i < 30 ? -1 : 1;
    lights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 14.2, s * 10.5));
  }
  group.add(lights);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  (group.userData as { lightMat: THREE.MeshStandardMaterial }).lightMat = lightMat;

  const midZ = (L.minZ + L.maxZ) / 2, midX = (L.minX + L.maxX) / 2;
  if (b.side === 'east') { group.position.set(L.maxX + 20, 0, midZ - 120); }
  else if (b.side === 'west') { group.position.set(L.minX - 20, 0, midZ); group.rotation.y = Math.PI; }
  else if (b.side === 'north') { group.position.set(midX - 260, 0, L.maxZ + 20); group.rotation.y = -Math.PI / 2; }
  else { group.position.set(midX, 0, L.minZ - 20); group.rotation.y = Math.PI / 2; }
  return group;
}
