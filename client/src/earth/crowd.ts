// People on the sidewalks: drawn as one instanced mesh per body part (and per variant of a part: a
// man's or a woman's torso, a coat, a skirt, three haircuts), so a whole crowd costs a few dozen
// draw calls. Every person has their own skin tone, hair, clothes and shoes (per-instance colors).
// Animated procedurally: walking, idling, sitting on benches, wiping windows, sweeping, carrying boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** What a part is colored by. */
type Paint = 'skin' | 'hair' | 'top' | 'sleeve' | 'pants' | 'leg' | 'shoes' | 'bag' | 'fixed';

interface Part {
  name: string;
  /** Variants of the part (a person shows one of them, or none). */
  geos: THREE.BufferGeometry[];
  paint: Paint;
  mat: 'cloth' | 'skin' | 'hair' | 'leather' | 'eyes';
  parent: number; // index into PARTS, -1 = root
  pivot: [number, number, number]; // joint position relative to the parent joint
}

/** Limb hanging down from its joint (top at 0). */
const r = (a: number, b: number, h: number, seg = 8) => new THREE.CylinderGeometry(a, b, h, seg, 1).translate(0, -h / 2, 0);

/** Lofted elliptical rings [y, half-width, half-depth, z offset] into a closed body shape. */
function loft(rings: [number, number, number, number][], radial = 12) {
  const pos: number[] = [], idx: number[] = [];
  const R = radial + 1;
  for (const [y, rx, rz, oz] of rings) {
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      // A squared-off ellipse reads as a body, not a tube.
      pos.push(Math.sign(s) * Math.abs(s) ** 0.8 * rx, y, Math.sign(c) * Math.abs(c) ** 0.8 * rz + oz);
    }
  }
  for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < radial; k++) {
    const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (ri: number, flip: boolean) => {
    const [y, , , oz] = rings[ri];
    const ci = pos.length / 3;
    pos.push(0, y, oz);
    for (let k = 0; k < radial; k++) { const a = ri * R + k; flip ? idx.push(ci, a, a + 1) : idx.push(ci, a + 1, a); }
  };
  cap(0, false); cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const merge = (...g: THREE.BufferGeometry[]) => {
  for (const x of g) if (x.attributes.uv) x.deleteAttribute('uv');
  return mergeGeometries(g)!;
};

// Torsos hang up from the waist joint (y = 0 at the waist, shoulders at ~0.42).
const TORSO_M = loft([[-0.07, 0.15, 0.1, 0], [0.02, 0.148, 0.098, 0.004], [0.14, 0.152, 0.104, 0.01], [0.26, 0.172, 0.112, 0.014], [0.35, 0.19, 0.106, 0.006], [0.41, 0.195, 0.09, -0.012], [0.45, 0.13, 0.07, -0.02], [0.47, 0.06, 0.05, -0.02]]);
const TORSO_F = merge(
  loft([[-0.07, 0.165, 0.1, 0], [0.02, 0.15, 0.094, 0.004], [0.13, 0.132, 0.09, 0.01], [0.24, 0.15, 0.104, 0.016], [0.34, 0.165, 0.1, 0.004], [0.4, 0.17, 0.085, -0.012], [0.44, 0.115, 0.066, -0.02], [0.46, 0.055, 0.046, -0.02]]),
  new THREE.SphereGeometry(0.05, 7, 4).scale(1, 0.85, 0.6).translate(0.058, 0.27, 0.08),
  new THREE.SphereGeometry(0.05, 7, 4).scale(1, 0.85, 0.6).translate(-0.058, 0.27, 0.08),
);
/** A long coat or a parka: the torso carries on down past the hips. */
const TORSO_COAT = loft([[-0.42, 0.2, 0.135, 0], [-0.2, 0.185, 0.122, 0], [0.02, 0.165, 0.11, 0.004], [0.14, 0.165, 0.112, 0.01], [0.26, 0.18, 0.118, 0.014], [0.35, 0.197, 0.112, 0.006], [0.41, 0.2, 0.095, -0.012], [0.46, 0.12, 0.075, -0.02], [0.49, 0.065, 0.06, -0.02]]);
const PELVIS = loft([[-0.12, 0.155, 0.098, 0], [-0.05, 0.162, 0.104, 0], [0.03, 0.155, 0.1, 0.004], [0.06, 0.15, 0.098, 0.004]]);
const SKIRT = loft([[-0.46, 0.2, 0.15, 0.01], [-0.25, 0.185, 0.13, 0.005], [-0.08, 0.17, 0.11, 0], [0.06, 0.15, 0.098, 0.004]]);

// The head hangs off the neck joint: skull, jaw, nose and ears in one skin-colored piece.
const HEAD = merge(
  new THREE.SphereGeometry(0.088, 12, 8).scale(0.92, 1.18, 1.05).translate(0, 0.13, -0.005),
  new THREE.SphereGeometry(0.066, 9, 6).scale(1, 0.9, 1.08).translate(0, 0.07, 0.02),
  new THREE.SphereGeometry(0.016, 5, 3).scale(0.85, 1.4, 1.2).translate(0, 0.11, 0.096),
  new THREE.SphereGeometry(0.022, 5, 3).scale(0.55, 1.2, 0.9).translate(0.083, 0.12, 0),
  new THREE.SphereGeometry(0.022, 5, 3).scale(0.55, 1.2, 0.9).translate(-0.083, 0.12, 0),
);
const NECK = r(0.045, 0.05, 0.11, 8).translate(0, 0.1, 0);
/** Eyes, brows and the line of the mouth: dark details that give the face a direction. */
const FACE = merge(
  new THREE.SphereGeometry(0.011, 5, 3).translate(0.031, 0.142, 0.086),
  new THREE.SphereGeometry(0.011, 5, 3).translate(-0.031, 0.142, 0.086),
  new THREE.BoxGeometry(0.03, 0.006, 0.008).translate(0.033, 0.163, 0.088),
  new THREE.BoxGeometry(0.03, 0.006, 0.008).translate(-0.033, 0.163, 0.088),
  new THREE.BoxGeometry(0.034, 0.005, 0.006).translate(0, 0.068, 0.089),
);
const hairCap = (thick: number, low: number) => {
  // The skull's shape, a little bigger, with everything below the hairline (and the face) cut away.
  const g = new THREE.SphereGeometry(0.088 + thick, 12, 7, 0, Math.PI * 2, 0, Math.PI * low).scale(0.94, 1.18, 1.07).translate(0, 0.135, -0.008);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    // Pull the front up into a hairline above the forehead.
    if (z > 0.03 && y < 0.185) p.setY(i, 0.185 + (y - 0.185) * 0.15);
  }
  g.computeVertexNormals();
  return g;
};
const HAIR_SHORT = hairCap(0.008, 0.52);
const HAIR_LONG = merge(hairCap(0.012, 0.56), loft([[-0.02, 0.085, 0.05, -0.06], [0.06, 0.1, 0.07, -0.05], [0.14, 0.1, 0.08, -0.03]], 12));
const HAIR_BUN = merge(hairCap(0.009, 0.54), new THREE.SphereGeometry(0.04, 7, 5).translate(0, 0.2, -0.09));

/** Palm, fingers held together, and the thumb on the side toward the body's front (s = +1 left, -1 right). */
const hand = (s: number) => merge(
  new THREE.SphereGeometry(0.04, 6, 4).scale(0.55, 1.2, 0.9).translate(0, -0.045, 0),
  new THREE.CapsuleGeometry(0.02, 0.05, 1, 5).scale(0.8, 1, 1.5).translate(0, -0.11, 0.004),
  new THREE.CapsuleGeometry(0.011, 0.035, 1, 4).rotateX(-0.5).translate(-0.004 * s, -0.06, 0.03),
);
const SHOE = merge(
  new THREE.CapsuleGeometry(0.048, 0.16, 2, 7).rotateX(Math.PI / 2).scale(1, 0.62, 1).translate(0, -0.035, 0.05),
  new THREE.BoxGeometry(0.1, 0.022, 0.255).translate(0, -0.062, 0.05),
);
const BACKPACK = merge(
  new THREE.BoxGeometry(0.26, 0.34, 0.12).translate(0, 0.25, -0.165),
  new THREE.BoxGeometry(0.2, 0.14, 0.05).translate(0, 0.16, -0.24),
);

const PARTS: Part[] = [
  { name: 'pelvis', geos: [PELVIS, SKIRT], paint: 'pants', mat: 'cloth', parent: -1, pivot: [0, 0.94, 0] },
  { name: 'torso', geos: [TORSO_M, TORSO_F, TORSO_COAT], paint: 'top', mat: 'cloth', parent: 0, pivot: [0, 0.06, 0] },
  { name: 'head', geos: [HEAD], paint: 'skin', mat: 'skin', parent: 1, pivot: [0, 0.48, -0.02] },
  { name: 'hair', geos: [HAIR_SHORT, HAIR_LONG, HAIR_BUN], paint: 'hair', mat: 'hair', parent: 1, pivot: [0, 0.48, -0.02] },
  { name: 'armL', geos: [r(0.052, 0.044, 0.29)], paint: 'top', mat: 'cloth', parent: 1, pivot: [0.19, 0.4, -0.01] },
  { name: 'armR', geos: [r(0.052, 0.044, 0.29)], paint: 'top', mat: 'cloth', parent: 1, pivot: [-0.19, 0.4, -0.01] },
  { name: 'foreL', geos: [r(0.042, 0.033, 0.26).translate(0, 0.01, 0)], paint: 'sleeve', mat: 'cloth', parent: 4, pivot: [0, -0.29, 0] },
  { name: 'foreR', geos: [r(0.042, 0.033, 0.26).translate(0, 0.01, 0)], paint: 'sleeve', mat: 'cloth', parent: 5, pivot: [0, -0.29, 0] },
  { name: 'thighL', geos: [r(0.078, 0.056, 0.42)], paint: 'pants', mat: 'cloth', parent: 0, pivot: [0.088, -0.04, 0] },
  { name: 'thighR', geos: [r(0.078, 0.056, 0.42)], paint: 'pants', mat: 'cloth', parent: 0, pivot: [-0.088, -0.04, 0] },
  { name: 'shinL', geos: [r(0.054, 0.038, 0.42).translate(0, 0.01, 0)], paint: 'leg', mat: 'cloth', parent: 8, pivot: [0, -0.42, 0] },
  { name: 'shinR', geos: [r(0.054, 0.038, 0.42).translate(0, 0.01, 0)], paint: 'leg', mat: 'cloth', parent: 9, pivot: [0, -0.42, 0] },
  { name: 'footL', geos: [SHOE], paint: 'shoes', mat: 'leather', parent: 10, pivot: [0, -0.41, 0] },
  { name: 'footR', geos: [SHOE], paint: 'shoes', mat: 'leather', parent: 11, pivot: [0, -0.41, 0] },
  // Parts that follow their parent joint without moving on their own.
  { name: 'neck', geos: [NECK], paint: 'skin', mat: 'skin', parent: 1, pivot: [0, 0.38, -0.02] },
  { name: 'face', geos: [FACE], paint: 'fixed', mat: 'eyes', parent: 2, pivot: [0, 0, 0] },
  { name: 'handL', geos: [hand(1)], paint: 'skin', mat: 'skin', parent: 6, pivot: [0, -0.255, 0] },
  { name: 'handR', geos: [hand(-1)], paint: 'skin', mat: 'skin', parent: 7, pivot: [0, -0.255, 0] },
  { name: 'bag', geos: [BACKPACK], paint: 'bag', mat: 'cloth', parent: 1, pivot: [0, 0, 0] },
];
const HEAD_I = 2, HAIR_I = 3;
const EXTRA = 14;
const BROOM = new THREE.Matrix4().makeRotationX(0.9).setPosition(0, -0.3, 0);

const PIVOTS = PARTS.map((p) => new THREE.Vector3(...p.pivot));
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const BOX_OFFSET = new THREE.Matrix4().makeTranslation(0, 0.26, 0.32);

// ---- What people wear (sRGB; converted to linear for the instance colors) ----
const SKIN = [0xf1d2bb, 0xe8bf9c, 0xdaa987, 0xc89068, 0xad7650, 0x8d5a3b, 0x6d4229, 0x4f2f1f];
const HAIR = [0x16100c, 0x221710, 0x34241a, 0x4f3624, 0x72513a, 0xa8835a, 0xcfb487, 0x8a8782, 0xb9b6b0, 0x8c3f24];
const TOPS = [0x1e2533, 0x2b3a55, 0xf1f0ec, 0xdcdad4, 0x7e8a96, 0x6b2e2e, 0x3d5a3d, 0x8a7a5c, 0x1b1b1e, 0x5c4b6e, 0xb8a582, 0x34495e, 0xc9c1b3, 0x9b5d3a, 0x2f6f8f, 0xd9a441, 0xb03a3a, 0xe7d7c1, 0x506a4b, 0x7a3d55];
const COATS = [0x1d1f24, 0x2a2e36, 0x6f5b45, 0xa58a68, 0x3b3f2c, 0x2c3a52, 0x5a5f66, 0x8c2f2f, 0xc2b19a];
const PANTS = [0x232a38, 0x2f4466, 0x3f5b85, 0x1c1d21, 0x4b4d52, 0x6b5f4f, 0xa8977a, 0x3a3228, 0x5a6470, 0x203047];
const SHOES = [0xefefec, 0x1a1a1c, 0x3d2a1d, 0x6b4a33, 0x7c818a, 0x2b2b30, 0xd8d2c4, 0x9c2b2b];
const BAGS = [0x1b1c20, 0x2b3a55, 0x4a3a2a, 0x6b6e73, 0x8a2f2f, 0x3d5a3d];

export interface CrowdMember {
  pos: THREE.Vector3;
  yaw: number;
  speed: number; // m/s (0 = idle)
  scale: number;
  visible: boolean;
  phase: number;
  /** Optional box carried in both hands (deliveries). */
  carry: boolean;
  /** What the body is doing: walking/idling, sitting on a bench, wiping a window, sweeping. */
  pose: 'stand' | 'sit' | 'clean' | 'sweep';
  /** 0..1 fade for going in and out of doors (scales the person down to nothing). */
  fade: number;
}

interface Look {
  /** Variant per part (-1 = not worn). */
  v: Int8Array;
  /** Linear RGB per part. */
  c: Float32Array;
}

function makeLook(): Look {
  const R = Math.random, pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
  const lin = (h: number) => new THREE.Color(h);
  const fem = R() < 0.5;
  const skin = lin(pick(SKIN)).multiplyScalar(0.94 + R() * 0.1);
  const hair = lin(R() < 0.12 ? pick([0x8a8782, 0xb9b6b0]) : pick(HAIR));
  const coat = R() < 0.22;
  const top = lin(coat ? pick(COATS) : pick(TOPS));
  const skirt = fem && !coat && R() < 0.3;
  const shorts = !skirt && R() < 0.12;
  const pants = lin(skirt ? pick([...PANTS, 0x7a3d55, 0xc9c1b3, 0x1b1b1e]) : pick(PANTS));
  const shortSleeves = !coat && R() < 0.3;
  const paint: Record<Paint, THREE.Color> = {
    skin, hair, top, sleeve: shortSleeves ? skin : top, pants,
    leg: skirt ? (R() < 0.5 ? lin(0x2a2526) : skin) : shorts ? skin : pants,
    shoes: lin(pick(SHOES)), bag: lin(pick(BAGS)), fixed: lin(0x2a201b),
  };
  const v = new Int8Array(PARTS.length), c = new Float32Array(PARTS.length * 3);
  PARTS.forEach((p, i) => {
    const col = paint[p.paint];
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  });
  v[0] = skirt ? 1 : 0;
  v[1] = coat ? 2 : fem ? 1 : 0;
  const bald = !fem && R() < 0.12;
  v[HAIR_I] = bald ? -1 : fem ? (R() < 0.65 ? 1 : 2) : 0;
  v[PARTS.findIndex((p) => p.name === 'bag')] = R() < 0.22 ? 0 : -1;
  return { v, c };
}

export class Crowd {
  group = new THREE.Group();
  members: CrowdMember[] = [];
  /** meshes[part][variant] */
  private meshes: THREE.InstancedMesh[][];
  private counts: Int32Array[];
  /** Which member each instance slot showed last frame: colors are only rewritten when that changes. */
  private owner: Int32Array[][];
  private looks: Look[] = [];
  private box: THREE.InstancedMesh;
  private broom: THREE.InstancedMesh;
  private local = PARTS.map(() => new THREE.Matrix4());
  private world = PARTS.map(() => new THREE.Matrix4());
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sc = new THREE.Vector3();
  private p = new THREE.Vector3();
  private recolor = false;

  constructor(count: number) {
    const mats = {
      cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52, metalness: 0, emissive: 0x2a0d05, emissiveIntensity: 0.25 }),
      hair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0 }),
      leather: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 }),
      eyes: new THREE.MeshStandardMaterial({ color: 0x2a201b, roughness: 0.3, metalness: 0 }),
    };
    this.meshes = PARTS.map((p) => p.geos.map((geo) => {
      const im = new THREE.InstancedMesh(geo, mats[p.mat], count);
      if (p.paint !== 'fixed') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
      // Eyes, hands and necks are too small to throw a shadow worth its cost.
      im.castShadow = p.mat !== 'eyes' && !p.name.startsWith('hand') && p.name !== 'neck';
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
      return im;
    }));
    this.counts = PARTS.map((p) => new Int32Array(p.geos.length));
    this.owner = PARTS.map((p) => p.geos.map(() => new Int32Array(count).fill(-1)));
    this.box = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.28, 0.3), new THREE.MeshStandardMaterial({ color: 0xc89a5c, roughness: 0.9 }), count);
    this.box.castShadow = true;
    this.box.frustumCulled = false;
    this.group.add(this.box);
    const broom = mergeGeometries([
      new THREE.CylinderGeometry(0.016, 0.016, 1.25, 6).translate(0, -0.35, 0),
      new THREE.BoxGeometry(0.34, 0.09, 0.08).translate(0, -0.99, 0),
    ]);
    this.broom = new THREE.InstancedMesh(broom, new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 }), count);
    this.broom.frustumCulled = false;
    this.group.add(this.broom);
    for (let i = 0; i < count; i++) {
      this.members.push({ pos: new THREE.Vector3(), yaw: 0, speed: 0, scale: 1, visible: false, phase: Math.random() * 10, carry: false, pose: 'stand', fade: 1 });
      this.looks.push(makeLook());
    }
  }

  update(dt: number) {
    const rot = (i: number, x: number, y = 0, z = 0) => {
      this.q.setFromEuler(this.e.set(x, y, z));
      this.local[i].compose(PIVOTS[i], this.q, ONE);
    };
    // Only people in view are written, packed at the front of each mesh, and only those are drawn
    // (hidden ones would still cost vertex work in the main and shadow passes).
    for (const c of this.counts) c.fill(0);
    this.recolor = false;
    let nb = 0, nw = 0;
    for (let mi = 0; mi < this.members.length; mi++) {
      const c = this.members[mi];
      if (!c.visible || c.fade <= 0.01) continue;
      const look = this.looks[mi];
      const walking = c.speed > 0.2;
      c.phase += dt * (walking ? c.speed * 3.1 : 1.2);
      const s = Math.sin(c.phase), co = Math.cos(c.phase);
      const amp = walking ? Math.min(1, c.speed / 1.4) : 0;
      const bob = walking ? Math.abs(co) * 0.03 : Math.sin(c.phase * 0.5) * 0.004;
      rot(0, 0, walking ? s * 0.09 : 0, walking ? s * 0.025 : 0);
      this.local[0].elements[13] += bob;
      // Shoulders counter-rotate against the hips; the head steadies itself against both.
      rot(1, walking ? 0.04 : 0, walking ? -s * 0.15 : Math.sin(c.phase * 0.3) * 0.04, 0);
      const look2 = walking ? s * 0.06 : Math.sin(c.phase * 0.21) * 0.35 * Math.max(0, Math.sin(c.phase * 0.13 + mi));
      rot(HEAD_I, walking ? -0.04 : 0.03 * Math.sin(c.phase * 0.4), look2, 0);
      rot(HAIR_I, walking ? -0.04 : 0.03 * Math.sin(c.phase * 0.4), look2, 0);
      const arm = c.carry ? -1.05 : -s * 0.5 * amp;
      rot(4, arm, 0, c.carry ? 0.15 : 0.08);
      rot(5, c.carry ? -1.05 : s * 0.5 * amp, 0, c.carry ? -0.15 : -0.08);
      rot(6, c.carry ? -0.5 : -0.18 - Math.max(0, s) * 0.35 * amp, 0, 0);
      rot(7, c.carry ? -0.5 : -0.18 - Math.max(0, -s) * 0.35 * amp, 0, 0);
      rot(8, s * 0.5 * amp, 0, 0);
      rot(9, -s * 0.5 * amp, 0, 0);
      rot(10, Math.max(0, -co) * 0.9 * amp + 0.03, 0, 0);
      rot(11, Math.max(0, co) * 0.9 * amp + 0.03, 0, 0);
      rot(12, -s * 0.22 * amp, 0, 0);
      rot(13, s * 0.22 * amp, 0, 0);
      for (let i = EXTRA; i < PARTS.length; i++) rot(i, 0);
      let drop = 0;
      if (c.pose === 'sit') {
        // On a bench: seat at 0.46 m, thighs forward, shins down, hands on the knees.
        drop = 0.45;
        rot(0, 0); rot(1, -0.06, Math.sin(c.phase * 0.2) * 0.1, 0);
        rot(8, -1.5, 0, 0.08); rot(9, -1.5, 0, -0.08);
        rot(10, 1.5, 0, 0); rot(11, 1.5, 0, 0);
        rot(12, 0); rot(13, 0);
        rot(4, -0.7, 0, 0.1); rot(5, -0.7, 0, -0.1);
        rot(6, -0.6, 0, 0); rot(7, -0.6, 0, 0);
      } else if (c.pose === 'clean') {
        // Wiping a window: right arm up in slow circles, left hand on the hip.
        const w = c.phase * 1.6;
        rot(4, -0.25, 0, 0.35); rot(6, -1.2, 0, 0);
        rot(5, -2.1 + Math.sin(w) * 0.25, 0, -0.2 + Math.cos(w) * 0.3); rot(7, -0.35, 0, 0);
        rot(1, 0, Math.sin(w) * 0.06, 0);
      } else if (c.pose === 'sweep') {
        // Both hands on the broom, swinging it side to side.
        const w = c.phase * 0.9;
        rot(1, 0.12, Math.sin(w) * 0.35, 0);
        rot(4, -0.7, 0, 0.2); rot(5, -0.55, 0, -0.25);
        rot(6, -0.6, 0, 0); rot(7, -0.5, 0, 0);
      }
      this.q.setFromAxisAngle(UP, c.yaw);
      const k = c.scale * Math.min(1, c.fade);
      this.p.copy(c.pos); this.p.y -= drop * c.scale;
      this.m.compose(this.p, this.q, this.sc.set(k, k, k));
      for (let i = 0; i < PARTS.length; i++) {
        const p = PARTS[i].parent;
        this.world[i].multiplyMatrices(p < 0 ? this.m : this.world[p], this.local[i]);
        const v = look.v[i];
        if (v < 0) continue;
        const im = this.meshes[i][v], n = this.counts[i][v]++;
        im.setMatrixAt(n, this.world[i]);
        const own = this.owner[i][v];
        if (im.instanceColor && own[n] !== mi) {
          own[n] = mi;
          const a = im.instanceColor.array as Float32Array;
          a[n * 3] = look.c[i * 3]; a[n * 3 + 1] = look.c[i * 3 + 1]; a[n * 3 + 2] = look.c[i * 3 + 2];
          this.recolor = true;
        }
      }
      if (c.carry) {
        this.m.copy(this.world[1]).multiply(BOX_OFFSET);
        this.box.setMatrixAt(nb++, this.m);
      }
      if (c.pose === 'sweep') {
        this.m.copy(this.world[7]).multiply(BROOM);
        this.broom.setMatrixAt(nw++, this.m);
      }
    }
    this.meshes.forEach((vs, i) => vs.forEach((im, v) => {
      im.count = this.counts[i][v];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor && this.recolor) im.instanceColor.needsUpdate = true;
    }));
    this.box.count = nb; this.box.instanceMatrix.needsUpdate = true;
    this.broom.count = nw; this.broom.instanceMatrix.needsUpdate = true;
  }
}
