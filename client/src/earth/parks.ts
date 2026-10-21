// Parks and woods on the main thread: the dense forest from build/parks.ts drawn in three tiers so a
// forest the size of Central Park (tens of thousands of trees) stays cheap. Near the viewer, the full
// leaf-card trees; a little further, the light card trees; beyond that, every tree is one camera-facing
// impostor quad shaded as a lumpy sunlit crown, which is how the park reads from the air: a green
// canopy of individual round crowns with lawns and paths between them. Plus boulders and park walls.
import * as THREE from 'three';
import type { ParkOut } from './build/parks.ts';
import { quality } from '../engine.ts';
import { coniferTree, lollipopTree, palmTree, treeMat } from './style.ts';

/** Full leaf-card trees within this distance of the viewer. */
const NEAR = 90;
/** Light card trees out to here; impostors beyond (they grow in over FADE meters as these go). */
const MID = 220;
const FADE = 30;
/** Beyond this distance a chunk's impostors thin out (to 30% at ~3.3 km). */
const THIN_FROM = 1800;

/** Deterministic in-place shuffle. */
function shuffle(a: number[], seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}

/** Where the viewer is, for the impostors' near fade (shared by every park material). */
const viewer = { value: new THREE.Vector3(0, 0, 0) };
const fadeR = { value: new THREE.Vector2(MID - FADE, MID) };

// Crown boxes in a tree's own units (before its scale): center height, width, height.
const CROWN = [
  { y: 5.0, w: 6.6, h: 5.8 }, // broadleaf
  { y: 4.0, w: 4.6, h: 7.8 }, // conifer
  { y: 7.2, w: 7.6, h: 4.2 }, // palm
];

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  return {
    near: [lollipopTree(), coniferTree(), palmTree()],
    mid: [lollipopTree(true), coniferTree(true), palmTree()],
    imp: CROWN.map(() => crownFan()),
    impMat: CROWN.map((_, k) => impostorMaterial(k)),
    rock: rockGeometry(),
    // Manhattan schist: dark grey, a little warm, glinting with mica where it's worn.
    rockMat: new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.88, metalness: 0.04, flatShading: true, vertexColors: true }),
    wallMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
  };
}

/**
 * Crown sprites, painted once: each cell is a cluster of leafy spheres (clumps) packed into a crown
 * outline. RG = the view-facing normal of whichever clump is on top (so the crown shades as round
 * lumps under the sun), B = albedo (darker in the crevices between clumps), A = coverage.
 * Cells: 4 broadleaf variants, 2 conifer spires (side view), a conifer tuft (top view), a palm.
 */
const ATLAS_COLS = 4, ATLAS_ROWS = 2, CELL = 256;
function crownAtlas() {
  const W = ATLAS_COLS * CELL, H = ATLAS_ROWS * CELL;
  const data = new Uint8Array(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  type Clump = { x: number; y: number; r: number; z: number };
  const paint = (cell: number, clumps: Clump[]) => {
    const ox = (cell % ATLAS_COLS) * CELL, oy = Math.floor(cell / ATLAS_COLS) * CELL;
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      // -1..1, y up.
      const x = ((px + 0.5) / CELL) * 2 - 1, y = 1 - ((py + 0.5) / CELL) * 2;
      let best = -1e9, nx = 0, ny = 0, nz = 1, edge = 1;
      for (const c of clumps) {
        const dx = (x - c.x) / c.r, dy = (y - c.y) / c.r, d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const h = Math.sqrt(1 - d2);
        const top = c.z + h * c.r;
        if (top > best) { best = top; nx = dx; ny = dy; nz = h; edge = h; }
      }
      const o = ((oy + py) * W + ox + px) * 4;
      if (best < -1e8) { data[o] = 128; data[o + 1] = 128; data[o + 2] = 0; data[o + 3] = 0; continue; }
      // Bend toward the whole crown's sphere so the big form still reads, lumps on top of it.
      const gx = x * 0.55, gy = y * 0.55;
      let fx = nx * 0.75 + gx, fy = ny * 0.75 + gy;
      const l = Math.hypot(fx, fy);
      if (l > 0.97) { fx *= 0.97 / l; fy *= 0.97 / l; }
      const ao = 0.55 + 0.45 * Math.min(1, edge * 1.6);
      data[o] = Math.round((fx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((fy * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(Math.min(1, ao * (0.88 + rnd() * 0.12)) * 255);
      data[o + 3] = 255;
      void nz;
    }
  };
  // Broadleaf: clumps inside a rounded crown, bigger ones in the middle.
  for (let v = 0; v < 4; v++) {
    const cl: Clump[] = [];
    const n = 26 + v * 4;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.62;
      const r = 0.2 + rnd() * 0.16 + (0.62 - rr) * 0.25;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.9 + 0.02;
      cl.push({ x, y, r, z: Math.sqrt(Math.max(0, 1 - (x * x + y * y))) * 0.8 });
    }
    paint(v, cl);
  }
  // Conifer spires: tiers of clumps narrowing to a tip.
  for (let v = 0; v < 2; v++) {
    const cl: Clump[] = [];
    for (let i = 0; i < 34; i++) {
      const t = rnd(), y = -0.95 + t * 1.75, w = (1 - t) * 0.62 + 0.04;
      const x = (rnd() * 2 - 1) * w * 0.8;
      cl.push({ x, y, r: 0.1 + w * 0.32, z: (1 - Math.abs(x) / (w + 0.01)) * 0.5 });
    }
    paint(4 + v, cl);
  }
  // Conifer from above: a tuft of needles around the leader.
  {
    const cl: Clump[] = [];
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.7;
      cl.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, r: 0.18 + (0.7 - rr) * 0.3, z: (0.7 - rr) * 1.2 });
    }
    paint(6, cl);
  }
  // Palm: fronds radiating from the crown, as strings of small clumps.
  {
    const cl: Clump[] = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd() * 0.3;
      for (let j = 1; j <= 7; j++) {
        const t = j / 7;
        cl.push({ x: Math.cos(a) * t * 0.9, y: Math.sin(a) * t * 0.55 - t * t * 0.3, r: 0.13 - t * 0.05, z: 0.5 - t * 0.3 });
      }
    }
    paint(7, cl);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
let atlas: THREE.DataTexture | null = null;

/** A disc fan (center + 12 rim vertices, radius 0.5) that the vertex shader bends into a crown outline. */
function crownFan() {
  const n = 12, pos = [0, 0, 0], idx: number[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pos.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0); }
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/**
 * The far tier: a quad per tree, turned to face the camera in the vertex shader and textured with a
 * crown sprite whose normals light it as round leafy clumps (lit side, shadowed side, dark crevices).
 * Hidden near the viewer, where the real trees are drawn, with a dithered hand-over.
 */
function impostorMaterial(kind: number) {
  const c = CROWN[kind];
  atlas ??= crownAtlas();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uViewer = viewer;
    sh.uniforms.uFade = fadeR;
    sh.uniforms.uCrown = { value: atlas };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uViewer; uniform vec2 uFade;
        varying vec2 vAt; varying float vMir; varying vec2 vLoc;`)
      .replace('#include <project_vertex>', `
        // Billboard: the crown center in view space, the quad spread in screen-aligned axes.
        vec4 wc = modelMatrix * instanceMatrix * vec4(0.0, ${c.y.toFixed(2)}, 0.0, 1.0);
        float sc = length(instanceMatrix[0].xyz);
        float dv = distance(wc.xyz, uViewer);
        float grow = smoothstep(uFade.x, uFade.y, dv);
        vec4 mvPosition = viewMatrix * wc;
        // Seen from above, a crown is round: blend the outline's height toward its width.
        float above = clamp(normalize(cameraPosition - wc.xyz).y, 0.0, 1.0);
        float hh = mix(${c.h.toFixed(2)}, ${c.w.toFixed(2)}, above * above);
        float rnd = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        // The outline: rim vertices pulled in and out into lumps (no alpha cut-outs, so the GPU can
        // reject hidden crowns before shading them).
        vec2 rim = position.xy * 2.0;
        float ang = atan(rim.y, rim.x), s6 = rnd * 6.2831;
        ${kind === 0
          ? 'rim *= 0.84 + 0.08 * sin(ang * 5.0 + s6) + 0.05 * sin(ang * 9.0 - s6 * 1.7);'
          : kind === 1
            ? `float wsp = (1.0 - (rim.y + 1.0) * 0.5) * 0.92 + 0.05;
               vec2 spire = vec2(rim.x * wsp * (0.92 + 0.06 * sin(rim.y * 9.0 + s6)), rim.y * 0.97);
               rim = mix(spire, rim * (0.88 + 0.06 * sin(ang * 7.0 + s6)), smoothstep(0.45, 0.8, above));`
            : 'rim *= mix(0.3, 1.0, pow(abs(cos(ang * 4.5 + s6)), 0.7));'}
        vLoc = rim;
        mvPosition.xy += rim * 0.5 * vec2(${c.w.toFixed(2)}, hh) * sc * grow;
        mvPosition.z += 0.3 * sc * ${(c.w * 0.5).toFixed(2)};
        // Which sprite: a variant per tree (broadleaf), spire or tuft by view angle (conifer).
        ${kind === 0 ? 'float cell = floor(rnd * 3.999);' : kind === 1 ? 'float cell = above > 0.62 ? 6.0 : 4.0 + step(0.5, rnd);' : 'float cell = 7.0;'}
        // Mirror half the trees for more variety.
        vMir = rnd > 0.5 ? -1.0 : 1.0;
        vec2 uq = (rim * 0.5 + 0.5) * vec2(rnd > 0.5 ? -1.0 : 1.0, 1.0) + vec2(rnd > 0.5 ? 1.0 : 0.0, 0.0);
        vAt = (vec2(mod(cell, ${ATLAS_COLS}.0), floor(cell / ${ATLAS_COLS}.0)) + vec2(uq.x, 1.0 - uq.y)) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
        if (dv < uFade.x) mvPosition = vec4(0.0, 0.0, 2.0, 1.0); // behind the camera: culled
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uCrown;
        varying vec2 vAt; varying float vMir; varying vec2 vLoc;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec4 crown = texture2D(uCrown, vAt);
        // Outside the painted clumps (the outline's edge): a shaded crevice on the crown's sphere.
        vec2 sph = vLoc * 0.6;
        crown = mix(vec4(sph * vec2(vMir, 1.0) * 0.5 + 0.5, 0.5, 1.0), crown, step(0.5, crown.a));
        vec2 cnxy = (crown.rg * 2.0 - 1.0) * vec2(vMir, 1.0);
        vec3 impN = normalize(vec3(cnxy, sqrt(max(0.05, 1.0 - dot(cnxy, cnxy)))));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= crown.b * 1.15;`)
      .replace('#include <normal_fragment_maps>', 'normal = impN;');
  };
  m.customProgramCacheKey = () => `park-impostor-${kind}`;
  return m;
}

/** A boulder: a lumpy, flattened icosphere, lighter on top where it weathers. */
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 9.1 + z * 4.3) * Math.cos(y * 7.7 - x * 3.1);
    p.setXYZ(i, x * k, Math.max(-0.12, y * k), z * k);
    const t = 0.7 + (y + 0.5) * 0.3 + 0.08 * Math.sin(x * 23.0 + z * 17.0);
    col.push(t, t * 0.98, t * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.translate(0, 0.12, 0);
  g.computeVertexNormals();
  return g;
}

/** One chunk's parks: the tree tiers, boulders and walls. */
export class ParkLayer {
  private near: (THREE.InstancedMesh | null)[] = [];
  private imps: THREE.InstancedMesh[] = [];
  private thin = 1;
  private mid: (THREE.InstancedMesh | null)[] = [];
  private byKind: number[][] = [[], [], []];
  private mats: Float32Array;
  private pos: Float32Array;
  private at = new THREE.Vector3(1e9, 0, 0);
  private idle = false;
  private radius = 0;
  private cx = 0; private cz = 0;

  constructor(private o: ParkOut, group: THREE.Group, private lod: 0 | 1) {
    shared ??= makeShared();
    const sh = shared;
    const t = o.trees, n = t.length / 6;
    // ?q=low keeps half the trees (the canopy still reads; it's the far tier that costs).
    const stride = quality.low ? 2 : 1;
    this.mats = new Float32Array(Math.ceil(n / stride) * 16);
    this.pos = new Float32Array(Math.ceil(n / stride) * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let k = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i += stride, k++) {
      const s = t[i * 6 + 4];
      q.setFromAxisAngle(up, t[i * 6 + 3]);
      m4.compose(v.set(t[i * 6], t[i * 6 + 1] - 0.1, t[i * 6 + 2]), q, sc.set(s, s * (0.9 + (k % 5) * 0.05), s));
      m4.toArray(this.mats, k * 16);
      this.pos.set([t[i * 6], t[i * 6 + 1] + 4, t[i * 6 + 2]], k * 3);
      this.byKind[t[i * 6 + 5]].push(k);
      minX = Math.min(minX, t[i * 6]); maxX = Math.max(maxX, t[i * 6]); minZ = Math.min(minZ, t[i * 6 + 2]); maxZ = Math.max(maxZ, t[i * 6 + 2]);
    }
    this.cx = (minX + maxX) / 2; this.cz = (minZ + maxZ) / 2; this.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    const tint = new THREE.Color();
    for (let kind = 0; kind < 3; kind++) {
      const ids = this.byKind[kind];
      if (!ids.length) { this.near.push(null); this.mid.push(null); continue; }
      // Impostors: every tree, static, in shuffled order so far chunks can draw a thinned-out subset.
      shuffle(ids, kind + this.byKind[0].length);
      const imp = new THREE.InstancedMesh(sh.imp[kind], sh.impMat[kind], ids.length);
      this.imps.push(imp);
      const arr = imp.instanceMatrix.array as Float32Array;
      const cols = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => {
        arr.set(this.mats.subarray(id * 16, id * 16 + 16), j * 16);
        const h = (id * 0.6180339) % 1;
        // Leaf greens, varied tree to tree; matched to the leaf atlas under the same sun.
        if (kind === 1) tint.setRGB(0.1 + h * 0.03, 0.17 + h * 0.04, 0.09);
        else tint.setRGB(0.15 + h * 0.07, 0.25 + h * 0.08 + ((id * 0.37) % 1) * 0.04, 0.08 + h * 0.03);
        tint.toArray(cols, j * 3);
      });
      imp.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      imp.computeBoundingSphere();
      // The quads grow out of the instance points; pad the bounds so frustum culling keeps edge crowns.
      if (imp.boundingSphere) imp.boundingSphere.radius += 20;
      imp.name = 'park-impostors';
      imp.castShadow = false; imp.receiveShadow = false;
      group.add(imp);
      if (lod !== 0) { this.near.push(null); this.mid.push(null); continue; }
      // Room for as many trees as can stand within the tier's radius (a tree per ~25 m² at most).
      const make = (g: THREE.BufferGeometry, shadow: boolean, r: number) => {
        const cap = Math.min(ids.length, Math.ceil((Math.PI * r * r) / 25));
        const im = new THREE.InstancedMesh(g, treeMat, cap);
        im.name = 'park-trees';
        (im.instanceMatrix.array as Float32Array).set(arr.subarray(0, cap * 16));
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        // Bounds of the whole stand, so frustum culling holds wherever the near trees are.
        im.boundingSphere = imp.boundingSphere!.clone();
        im.count = 0;
        im.castShadow = shadow; im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(im);
        return im;
      };
      this.near.push(make(sh.near[kind], true, NEAR));
      this.mid.push(make(sh.mid[kind], false, MID));
    }
    // Boulders.
    const r = o.rocks, nr = r.length / 7;
    if (nr) {
      const im = new THREE.InstancedMesh(sh.rock, sh.rockMat, nr);
      im.name = 'park-rocks';
      for (let i = 0; i < nr; i++) {
        q.setFromAxisAngle(up, r[i * 7 + 3]);
        m4.compose(v.set(r[i * 7], r[i * 7 + 1], r[i * 7 + 2]), q, sc.set(r[i * 7 + 4], r[i * 7 + 5], r[i * 7 + 6]));
        im.setMatrixAt(i, m4);
      }
      im.computeBoundingSphere();
      im.castShadow = lod === 0; im.receiveShadow = true;
      group.add(im);
    }
    if (o.wall) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.wall.pos, 3));
      if (o.wall.nrm) g.setAttribute('normal', new THREE.BufferAttribute(o.wall.nrm, 3, true));
      if (o.wall.col) g.setAttribute('color', new THREE.BufferAttribute(o.wall.col, 3, true));
      if (o.wall.idx) g.setIndex(new THREE.BufferAttribute(o.wall.idx, 1));
      g.computeBoundingSphere();
      const w = new THREE.Mesh(g, sh.wallMat);
      w.name = 'park-wall';
      w.castShadow = true; w.receiveShadow = true;
      group.add(w);
    }
  }

  /** Re-sort the near and mid tiers around the viewer (chunk-local coordinates). */
  split(x: number, y: number, z: number) {
    // Far away, a thinned-out canopy (over the shaded forest floor) reads the same and costs less.
    const dc = Math.max(0, Math.hypot(x - this.cx, z - this.cz) - this.radius);
    const thin = Math.min(1, Math.max(0.3, (THIN_FROM / Math.max(dc, 1)) ** 2));
    if (Math.abs(thin - this.thin) > 0.04 || (thin === 1 && this.thin !== 1)) {
      this.thin = thin;
      for (const m of this.imps) m.count = Math.ceil((m.instanceMatrix.count) * thin);
    }
    if (this.lod !== 0) return;
    // Far from this chunk's trees: everything is an impostor; nothing to do once emptied.
    const far = Math.hypot(x - this.cx, z - this.cz) - this.radius > MID + 20;
    if (far) {
      if (this.idle) return;
      for (const m of [...this.near, ...this.mid]) if (m) m.count = 0;
      this.idle = true;
      this.at.set(1e9, 0, 0);
      return;
    }
    this.idle = false;
    if (this.at.distanceToSquared(new THREE.Vector3(x, y, z)) < 100) return;
    this.at.set(x, y, z);
    const P = this.pos, M = this.mats, n2 = NEAR * NEAR, m2 = MID * MID;
    for (let kind = 0; kind < 3; kind++) {
      const near = this.near[kind], mid = this.mid[kind];
      if (!near || !mid) continue;
      const na = near.instanceMatrix.array as Float32Array, ma = mid.instanceMatrix.array as Float32Array;
      let ni = 0, mi = 0;
      const nCap = near.instanceMatrix.count, mCap = mid.instanceMatrix.count;
      for (const id of this.byKind[kind]) {
        const dx = P[id * 3] - x, dy = P[id * 3 + 1] - y, dz = P[id * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < n2 && ni < nCap) na.set(M.subarray(id * 16, id * 16 + 16), (ni++) * 16);
        else if (d2 < m2 && mi < mCap) ma.set(M.subarray(id * 16, id * 16 + 16), (mi++) * 16);
      }
      near.count = ni; mid.count = mi;
      near.instanceMatrix.needsUpdate = true; mid.instanceMatrix.needsUpdate = true;
    }
  }

  /** Trunk and boulder colliders, in world coordinates. */
  colliders(x0: number, z0: number, add: (b: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }) => void) {
    const t = this.o.trees;
    for (let i = 0; i < t.length; i += 6) {
      const x = t[i] + x0, z = t[i + 2] + z0, r = 0.35 * t[i + 4];
      add({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, maxY: t[i + 1] + 3 * t[i + 4] });
    }
    const r = this.o.rocks;
    for (let i = 0; i < r.length; i += 7) {
      const x = r[i] + x0, z = r[i + 2] + z0, w = Math.max(r[i + 4], r[i + 6]) * 0.4;
      add({ minX: x - w, maxX: x + w, minZ: z - w, maxZ: z + w, maxY: r[i + 1] + r[i + 5] * 0.55 });
    }
  }
}

/** The viewer point for the impostors' hand-over (same point the tiers are split around). */
export function setParkViewer(p: THREE.Vector3) { viewer.value.copy(p); }
