import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// People inside buildings (desk workers, receptionists, board members, Claude agents, doormen).
// Each one is a clothed human body generated here and skinned to the Xbot's Mixamo skeleton, so
// the Xbot clips (idle, walk, run, agree, headShake…) drive it and the whole person is one draw
// call. On top of the clips a small procedural layer does the office life: typing, sipping
// coffee, glancing at the monitor, and turning their head toward you when you walk up.

interface Template { scene: THREE.Group; clips: THREE.AnimationClip[] }
const templates: Record<'soldier' | 'xbot', Template | null> = { soldier: null, xbot: null };

/** Bind-pose (T-pose, meters, facing +Z) position of every Xbot bone, by name. */
const BIND = new Map<string, THREE.Vector3>();
const BONE = new Map<string, number>();

export async function loadCharacters(onProgress?: (msg: string) => void) {
  const loader = new GLTFLoader();
  onProgress?.('Loading characters…');
  // The rigs are fetched by `npm install` (scripts/fetch-models.mjs); without them, load the same
  // files from the three.js examples.
  const rig = (name: string) => loader.loadAsync(`/models/${name}`)
    .catch(() => loader.loadAsync(`https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/models/gltf/${name}`));
  const [soldier, xbot] = await Promise.all([rig('Soldier.glb'), rig('Xbot.glb')]);
  templates.soldier = { scene: soldier.scene, clips: soldier.animations };
  templates.xbot = { scene: xbot.scene, clips: xbot.animations };
  for (const t of [soldier.scene, xbot.scene]) {
    t.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.isMeshStandardMaterial) { mat.metalness = Math.min(mat.metalness, 0.2); mat.envMapIntensity = 0.5; }
      }
    });
  }
  const surf = xbot.scene.getObjectByName('Beta_Surface') as THREE.SkinnedMesh;
  surf.skeleton.bones.forEach((b, i) => {
    BONE.set(b.name, i);
    BIND.set(b.name, new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(surf.skeleton.boneInverses[i]).invert()));
  });
}

export type NpcRole = 'worker' | 'agent' | 'reception' | 'board' | 'pedestrian' | 'doorman' | 'resident';

export interface Character {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
  role: NpcRole;
  /** Crossfade to a named clip (no-op if already playing). */
  play(name: string, fade?: number): void;
  /** One-shot clip that returns to the previous loop (e.g. 'agree', 'headShake'). */
  gesture(name: string): void;
  /** Office life (people indoors): set by whoever moves them around the floor. */
  life?: NpcLife;
}

/** Up from the desk and talking to someone: no typing at thin air, eyes on the other person, hands when speaking. */
export interface NpcLife {
  /** Away from their desk (no keyboard, no coffee cup). */
  away: boolean;
  /** Who they're talking with (a point in the NPC's own scene, at their feet). */
  partner: THREE.Vector3 | null;
  /** Speaking (hands move) rather than listening (nods). */
  talking: boolean;
}

function build(t: Template, clipNames: Record<string, string>, role: NpcRole = 'pedestrian'): Character {
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(t.scene) as THREE.Group;
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [key, clipName] of Object.entries(clipNames)) {
    const clip = t.clips.find((c) => c.name === clipName);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  const ch: Character = {
    root, mixer, actions, current: '', role,
    play(name, fade = 0.25) {
      if (ch.current === name || !actions[name]) return;
      const next = actions[name];
      const prev = actions[ch.current];
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      prev?.fadeOut(fade);
      ch.current = name;
    },
    gesture(name) {
      const a = actions[name];
      if (!a) return;
      const back = ch.current;
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      ch.play(name, 0.2);
      const done = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== a) return;
        mixer.removeEventListener('finished', done as never);
        ch.current = '';
        ch.play(back || 'idle', 0.3);
      };
      mixer.addEventListener('finished', done as never);
    },
  };
  return ch;
}

/** The player: Soldier with Idle / Walk / Run. */
export function makePlayer(): Character {
  const ch = build(templates.soldier!, { idle: 'Idle', walk: 'Walk', run: 'Run' });
  ch.root.children[0].rotation.y = Math.PI; // model faces -Z; we treat +Z as forward
  ch.play('idle', 0);
  return ch;
}

// ------------------------------------------------------------------ looks

type HairStyle = 'short' | 'side' | 'long' | 'bob' | 'bun' | 'ponytail' | 'curly' | 'buzz' | 'bald';
type TopStyle = 'tee' | 'shirt' | 'blazer' | 'sweater' | 'hoodie' | 'zip' | 'coat';
interface Look {
  skin: number; hair: number; hairStyle: HairStyle; bangs: boolean; beard: boolean; stubble: boolean; glasses: boolean;
  eyes: number; lips: number;
  top: number; topStyle: TopStyle; under: number; tie: number | null;
  pants: number; shoes: number;
  /** Women's suits: a knee-length skirt (and tights) instead of trousers. */
  skirt: boolean; tights: number;
  /** Suit jackets: the pocket square and the lapel pin (Claude's agents wear theirs in clay). */
  pocket: number | null; pin: number | null;
  fem: boolean; width: number; // shoulders/hips width factor
  lanyard: boolean; earpiece: boolean; cap: boolean;
}

const SKIN = [0xf3d6bf, 0xeac3a1, 0xdcae88, 0xc8946b, 0xab7650, 0x8c5a3c, 0x6c4129, 0x4e2e1e];
const HAIR = [0x17110d, 0x241812, 0x3a281b, 0x5a3d26, 0x7d5a3a, 0xb08a58, 0xd6bd8a, 0x8d8a86, 0xa4482a];
const EYES = [0x3b2416, 0x4a2e1a, 0x2e1c12, 0x5a3b22, 0x6b5a3a, 0x3f6a8a, 0x5b7f5a, 0x4a6f9a];
const PANTS = [0x232a38, 0x1e1f23, 0x3d4d68, 0x56677f, 0x6b5f4f, 0xa8977a, 0x4b4d52, 0x3a3228];
const SHOES = [0xeeeeea, 0x1b1b1d, 0x4a3020, 0x6c4a33, 0x7c818a, 0x2b2b30];
const SHIRTS = [0xf2f3f5, 0xdde6f0, 0xa9c2de, 0xe8dccb, 0xc9d6c4, 0xf0d9d9, 0xffffff];
const KNITS = [0x2b3a55, 0x6b2e2e, 0x3d5a3d, 0x8a7a5c, 0x34495e, 0x5c4b6e, 0x9b5d3a, 0xc9c1b3, 0x7a8b94, 0xd4b483, 0x444a52];
/** Suit cloth: navy, charcoal, mid and light grey, black, a deep blue and a brown-grey. */
const SUITS = [0x1f2840, 0x2c2f35, 0x4a4f57, 0x6e737b, 0x18191d, 0x253658, 0x48423a];
const TIES = [0x7a1f2b, 0x24365e, 0x2f5a3a, 0x8a6a2a, 0x4a2b5a, 0x1b1d24];
/** Claude's clay color: the agents' ties, pocket squares and lapel pins, so you can tell them from people at a glance. */
const CLAY = 0xc4673f;

/** Palette for pedestrians — muted clothing colors. */
export const CLOTHES = [0x2b3a55, 0x6b2e2e, 0x3d5a3d, 0x8a7a5c, 0x1f1f24, 0x5c4b6e, 0xb0a48a, 0x34495e, 0x7f8c8d, 0x9b5d3a, 0x223344, 0xc9c1b3];

function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

function makeLook(role: NpcRole, seed: number): Look {
  const r = rng(seed * 7919 + role.length * 104729);
  const fem = r() < 0.5;
  const hairStyle: HairStyle = fem
    ? pick(r, ['long', 'long', 'bob', 'bun', 'ponytail', 'curly', 'side', 'short'] as const)
    : pick(r, ['short', 'short', 'side', 'side', 'buzz', 'curly', 'bald'] as const);
  const skin = pick(r, SKIN);
  const age = r();
  const hair = age > 0.85 ? pick(r, [0x9a9792, 0xbdbab4, 0x77746f]) : pick(r, HAIR);
  const look: Look = {
    skin, hair, hairStyle, bangs: fem && r() < 0.3, beard: !fem && r() < 0.22, stubble: !fem && r() < 0.3, glasses: r() < 0.28,
    eyes: pick(r, EYES), lips: mix(skin, fem ? 0xa8505a : 0x9a5a52, fem ? 0.45 : 0.3),
    top: pick(r, KNITS), topStyle: 'sweater', under: pick(r, SHIRTS), tie: null,
    pants: pick(r, PANTS), shoes: pick(r, SHOES), skirt: false, tights: mix(skin, 0x2a2224, 0.25),
    pocket: null, pin: null,
    fem, width: fem ? 0.92 + r() * 0.08 : 0.98 + r() * 0.1,
    lanyard: false, earpiece: false, cap: false,
  };
  const office = (): TopStyle => pick(r, ['shirt', 'shirt', 'sweater', 'blazer', 'tee', 'hoodie', 'shirt'] as const);
  /** A two-piece suit: jacket and trousers (or skirt) in one cloth, a shirt, leather shoes. */
  const suit = () => {
    look.topStyle = 'blazer'; look.top = pick(r, SUITS); look.pants = look.top;
    look.under = fem ? pick(r, [0xffffff, 0xf4efe6, 0xe9eef4, 0x1c1c20, 0xdcc9b6]) : pick(r, [0xffffff, 0xffffff, 0xe3ecf6, 0xd6e2f0, 0xf3e6e6]);
    look.shoes = pick(r, [0x17171a, 0x17171a, 0x3a2418, 0x5a3622]);
    look.skirt = fem && r() < 0.4;
    look.tights = r() < 0.5 ? mix(look.skin, 0x1d1a1c, 0.55) : mix(look.skin, 0x5a3f36, 0.12);
    look.pocket = r() < 0.5 ? 0xf6f4ef : null;
  };
  switch (role) {
    case 'agent':
      // Claude's agents: sharp suits with a clay tie (or an open collar), a clay pocket square and
      // lapel pin, and a discreet earpiece.
      suit();
      look.tie = !fem && r() < 0.7 ? CLAY : null;
      look.pocket = CLAY; look.pin = CLAY; look.earpiece = true;
      if (look.tie === CLAY) look.under = pick(r, [0xffffff, 0xe3ecf6, 0xf6f4ef]);
      break;
    case 'board':
      suit();
      look.tie = !fem && r() < 0.65 ? pick(r, TIES) : null;
      break;
    case 'reception':
      suit(); look.lanyard = true;
      look.tie = !fem && r() < 0.4 ? pick(r, TIES) : null;
      break;
    case 'doorman':
      look.topStyle = 'coat'; look.top = 0x1f3a2c; look.under = 0xf2f3f5; look.tie = 0x1b1b1d;
      look.pants = 0x1e1f23; look.shoes = 0x1b1b1d; look.cap = true; look.glasses = false; look.bangs = false;
      if (look.hairStyle === 'long' || look.hairStyle === 'bun' || look.hairStyle === 'ponytail' || look.hairStyle === 'curly' || look.hairStyle === 'bob') look.hairStyle = 'bun';
      break;
    default: {
      look.topStyle = office();
      if (look.topStyle === 'shirt') look.top = pick(r, SHIRTS);
      if (look.topStyle === 'blazer') { look.top = pick(r, SUITS); look.under = pick(r, SHIRTS); look.pants = r() < 0.5 ? look.top : pick(r, PANTS); look.shoes = pick(r, [0x1b1b1d, 0x4a3020, 0x6c4a33]); }
      if (look.topStyle === 'tee') look.top = pick(r, [...KNITS, 0xf2f2f0, 0x1e1f23]);
      if (role === 'worker' && r() < 0.35) look.lanyard = true;
    }
  }
  return look;
}

// ------------------------------------------------------------------ the body

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Weights = (p: THREE.Vector3) => [number, number, number, number]; // bone, weight, bone2, weight2

/** Surfaces, written per vertex: the person shader gives each its own roughness, sheen and detail. */
const enum Surf { Cloth = 0, Skin = 1, Hair = 2, Leather = 3, Eye = 4, Metal = 5, Lip = 6, Silk = 7 }

class BodyBuilder {
  geos: THREE.BufferGeometry[] = [];
  /** What each color is made of (skin, hair, shoes…); anything else is cloth. */
  surfOf = new Map<number, Surf>();
  private tmp = new THREE.Vector3();

  push(g: THREE.BufferGeometry, color: number, w: Weights, surf?: Surf) {
    g.deleteAttribute('uv');
    if (!g.index) g = (() => { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); return g; })();
    const pos = g.attributes.position as THREE.BufferAttribute, n = pos.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), sf = new Float32Array(n);
    const c = new THREE.Color(color);
    const s = surf ?? this.surfOf.get(color) ?? Surf.Cloth;
    for (let i = 0; i < n; i++) {
      this.tmp.fromBufferAttribute(pos, i);
      const [b0, w0, b1, w1] = w(this.tmp);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      si[i * 4] = b0; sw[i * 4] = w0; si[i * 4 + 1] = b1; sw[i * 4 + 1] = w1;
      sf[i] = s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('surf', new THREE.BufferAttribute(sf, 1));
    if (!g.attributes.normal) g.computeVertexNormals();
    this.geos.push(g);
  }

  ellipsoid(c: THREE.Vector3, r: THREE.Vector3, color: number, w: Weights, seg = 12, keep?: (p: THREE.Vector3) => boolean, surf?: Surf) {
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
    g.scale(r.x, r.y, r.z);
    g.translate(c.x, c.y, c.z);
    if (keep) {
      // Pull the parts we don't want (a hairline, a beard's upper edge) inside the head.
      const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (!keep(v)) { v.sub(c).multiplyScalar(0.82).add(c); p.setXYZ(i, v.x, v.y, v.z); }
      }
    }
    this.push(g, color, w, surf);
  }

  /** A tapered tube from a (radius r0) to b (radius r1), with rounded ends. */
  tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: number, w: Weights, radial = 10, caps = true, surf?: Surf) {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, radial, 3, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    this.push(g, color, w, surf);
    if (caps) {
      this.ellipsoid(a, V(r0, r0, r0), color, w, radial, undefined, surf);
      this.ellipsoid(b, V(r1, r1, r1), color, w, radial, undefined, surf);
    }
  }

  box(c: THREE.Vector3, s: THREE.Vector3, color: number, w: Weights, rotX = 0, surf?: Surf) {
    const g = new THREE.BoxGeometry(s.x, s.y, s.z);
    if (rotX) g.rotateX(rotX);
    g.translate(c.x, c.y, c.z);
    this.push(g, color, w, surf);
  }

  /**
   * A flat piece of cloth laid on the body (lapels, a tie, a pocket square): an outline in x/y,
   * each corner pushed out onto the surface `z(x, y)`, with a little thickness so it catches light
   * along its edges.
   */
  panel(pts: [number, number][], z: (x: number, y: number) => number, color: number, w: Weights, thick = 0.004, surf?: Surf) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, z(p.getX(i), p.getY(i)) + p.getZ(i) - thick);
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    this.push(g, color, w, surf);
  }

  /** Lofted elliptical rings (torso, coat), each ring [y, half-width, half-depth, z offset, color]. */
  loft(rings: [number, number, number, number, number][], w: Weights, radial = 24) {
    const pos: number[] = [], cols: number[] = [], idx: number[] = [], sfs: number[] = [];
    rings.forEach(([y, rx, rz, oz, c]) => {
      const col = new THREE.Color(c), s = this.surfOf.get(c) ?? Surf.Cloth;
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const [x, z] = superEllipse(a, rx, rz);
        pos.push(x, y, z + oz);
        cols.push(col.r, col.g, col.b);
        sfs.push(s);
      }
    });
    const R = radial + 1;
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < radial; k++) {
      const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    // Caps
    const capAt = (ri: number, flip: boolean) => {
      const [y, , , oz, c] = rings[ri];
      const ci = pos.length / 3;
      const col = new THREE.Color(c);
      pos.push(0, y, oz); cols.push(col.r, col.g, col.b); sfs.push(this.surfOf.get(c) ?? Surf.Cloth);
      for (let k = 0; k < radial; k++) {
        const a = ri * R + k, b = a + 1;
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    };
    capAt(0, false);
    capAt(rings.length - 1, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // push() would recolor the whole loft one color; keep the per-ring colors.
    const n = pos.length / 3, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const [b0, w0, b1, w1] = w(v);
      si[i * 4] = b0; sw[i * 4] = w0; si[i * 4 + 1] = b1; sw[i * 4 + 1] = w1;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(sfs, 1));
    this.geos.push(g);
  }
}

/** A slightly squared-off ellipse reads more like a torso than a tube. */
const SQ = 0.82;
function superEllipse(a: number, rx: number, rz: number): [number, number] {
  const s = Math.sin(a), c = Math.cos(a);
  return [Math.sign(s) * Math.pow(Math.abs(s), SQ) * rx, Math.sign(c) * Math.pow(Math.abs(c), SQ) * rz];
}

const B = (name: string) => BONE.get(`mixamorig${name}`) ?? 0;
const P = (name: string) => BIND.get(`mixamorig${name}`)!.clone();
const rigid = (bone: number): Weights => () => [bone, 1, 0, 0];
/** Along a limb from joint a to b: blend into the parent bone near a so joints bend smoothly. */
function limb(a: THREE.Vector3, b: THREE.Vector3, bone: number, parent: number, blend = 0.18): Weights {
  const d = b.clone().sub(a), len = d.length();
  d.normalize();
  const t = new THREE.Vector3();
  return (p) => {
    const s = t.copy(p).sub(a).dot(d) / len;
    if (s >= blend) return [bone, 1, 0, 0];
    const wp = 0.5 * (1 - Math.max(0, s) / blend);
    return [bone, 1 - wp, parent, wp];
  };
}

function spineWeights(): Weights {
  const chain = ['Hips', 'Spine', 'Spine1', 'Spine2'].map((n) => ({ b: B(n), y: P(n).y }));
  return (p) => {
    if (p.y <= chain[0].y) return [chain[0].b, 1, 0, 0];
    for (let i = 0; i + 1 < chain.length; i++) {
      const lo = chain[i], hi = chain[i + 1];
      if (p.y <= hi.y) { const t = (p.y - lo.y) / (hi.y - lo.y); return [lo.b, 1 - t, hi.b, t]; }
    }
    // Shoulder tops follow the arm a little so they don't tear when the arms swing.
    const ax = Math.abs(p.x);
    if (ax > 0.12 && p.y > 1.38) { const t = Math.min(0.45, (ax - 0.12) * 4); return [chain[3].b, 1 - t, p.x > 0 ? B('LeftArm') : B('RightArm'), t]; }
    return [chain[3].b, 1, 0, 0];
  };
}

/**
 * The head as one smooth surface (so there are no seams where a jaw meets a skull): a sphere
 * shaped into a skull that narrows into the jaw and chin, flattens across the face, pulls in at the
 * nape, with shallow eye sockets and a brow above them.
 */
function headShape(c: THREE.Vector3, fem: boolean) {
  const g = new THREE.SphereGeometry(1, 36, 28);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rx = 0.08 * (fem ? 0.96 : 1), ry = 0.108, rz = 0.097;
  const bump = (d2: number, w: number) => Math.exp(-d2 / (w * w));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = THREE.MathUtils.smoothstep(-y, 0, 1); // 0 at the equator, 1 under the chin
    let X = x * rx * (1 - (fem ? 0.3 : 0.24) * t ** 1.2);
    let Y = y * ry * (y < 0 ? 1 + 0.17 * t : 1);
    let Z = z * rz;
    if (z > 0) Z = Z * (1 - 0.06 * (1 - t) * Math.max(0, 1 - Math.abs(x) * 1.6)) + (fem ? 0.012 : 0.016) * t * z; // flatter face, the chin forward
    else Z *= 1 - 0.38 * t; // in at the nape
    if (z > 0.3) {
      for (const s of [-1, 1]) Z -= 0.0075 * bump((X - 0.031 * s) ** 2 + ((Y - 0.004) * 1.3) ** 2, 0.016); // eye sockets
      Z += 0.0045 * bump((Y - 0.03) ** 2, 0.011) * Math.max(0, 1 - Math.abs(X) / 0.065); // brow
      Z += (fem ? 0.002 : 0.004) * bump((Y + 0.052) ** 2 + (X * 0.6) ** 2, 0.03); // the jaw's front, under the cheeks
    }
    p.setXYZ(i, c.x + X, c.y + Y, c.z + Z);
  }
  g.computeVertexNormals();
  return g;
}

function buildBody(look: Look): THREE.BufferGeometry {
  const bb = new BodyBuilder();
  bb.surfOf.set(look.skin, Surf.Skin);
  bb.surfOf.set(look.hair, Surf.Hair);
  bb.surfOf.set(look.shoes, Surf.Leather);
  bb.surfOf.set(look.lips, Surf.Lip);
  if (look.tie !== null) bb.surfOf.set(look.tie, Surf.Silk);
  const head = B('Head'), neck = B('Neck'), spine2 = B('Spine2'), hips = B('Hips');
  const W = look.width, fem = look.fem;
  const spine = spineWeights();
  const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
  const suit = look.topStyle === 'blazer';

  // ---- torso: pants below the waist, the top above (jackets run down over the seat, coats longer)
  const long = suit ? 0.78 : look.topStyle === 'coat' ? 0.62 : look.topStyle === 'hoodie' || look.topStyle === 'zip' ? 0.93 : 0.985;
  const T = look.top, Pn = look.pants;
  const hipW = (fem ? 0.172 : 0.158) * W, waistW = (fem ? 0.13 : 0.148) * W, chestW = (fem ? 0.158 : 0.178) * W, shW = (fem ? 0.165 : 0.19) * W;
  const rings: [number, number, number, number, number][] = [];
  const add = (y: number, rx: number, rz: number, oz: number) => rings.push([y, rx, rz, oz, y < long ? Pn : T]);
  if (look.topStyle === 'coat') {
    // A knee-length doorman's coat flares out over the legs.
    rings.push([0.6, hipW * 1.18, 0.15, 0.0, T], [0.75, hipW * 1.12, 0.14, 0.0, T]);
  }
  if (suit) {
    // The jacket's skirt hangs just over the seat, a touch away from the body.
    add(0.79, hipW * 1.05 + 0.01, 0.118, 0.002);
  }
  const jk = suit ? 0.01 : 0; // a jacket sits a little off the shirt
  add(0.86, hipW * 0.96 + jk, 0.1 + jk, 0.0);
  add(0.94, hipW + jk, 0.108 + jk, 0.004);
  if (long > 0.9 && long < 1.0) { add(long - 0.004, hipW * 0.99, 0.108, 0.004); add(long + 0.004, hipW * 0.99 + 0.004, 0.11, 0.004); }
  add(1.04, waistW + (suit || look.topStyle === 'coat' ? 0.014 : 0), 0.104 + jk, 0.008);
  add(1.14, waistW * 1.02 + jk, 0.102 + (fem ? 0.004 : 0) + jk, 0.012);
  add(1.24, chestW + jk, (fem ? 0.118 : 0.112) + jk, 0.016);
  add(1.33, chestW * 1.03 + jk, (fem ? 0.112 : 0.114) + jk, 0.006);
  // Suit shoulders are built up and square.
  add(1.4, shW + (suit ? 0.012 : 0), 0.1 + jk, -0.018);
  add(1.45, shW * (suit ? 0.86 : 0.82), 0.085, -0.028);
  add(1.475, 0.07, 0.058, -0.03);
  bb.loft(rings, spine);
  /** z of the torso's surface at (x, y), front side: the same super-ellipse rings, interpolated. */
  const surfZ = (x: number, y: number) => {
    let i = 0;
    while (i + 2 < rings.length && rings[i + 1][0] < y) i++;
    const a = rings[i], b = rings[i + 1];
    const t = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    const rx = a[1] + (b[1] - a[1]) * t, rz = a[2] + (b[2] - a[2]) * t, oz = a[3] + (b[3] - a[3]) * t;
    const sx = Math.min(1, Math.abs(x) / rx) ** (1 / SQ);
    return Math.pow(Math.sqrt(Math.max(0, 1 - sx * sx)), SQ) * rz + oz;
  };
  const on = (off: number) => (x: number, y: number) => surfZ(x, y) + off;
  const front = (y: number) => surfZ(0, y);
  if (fem) for (const s of [-1, 1]) bb.ellipsoid(V(0.055 * s, 1.27, 0.08 + jk), V(0.054, 0.05, suit ? 0.036 : 0.042), T, spine, 14);

  // ---- tops: collars, jacket fronts, zips, hoods, ties, lanyards
  if (look.topStyle === 'shirt' || suit || look.topStyle === 'coat') {
    const collar = look.topStyle === 'shirt' ? T : look.under;
    bb.tube(V(0, 1.45, -0.03), V(0, 1.505, -0.025), 0.058, 0.051, collar, rigid(neck), 14, false);
    // Collar points, folded down over the front.
    for (const s of [-1, 1]) bb.panel([[0.012 * s, 1.47], [0.052 * s, 1.49], [0.05 * s, 1.432]], (x, y) => surfZ(x, Math.min(y, 1.46)) + 0.012, collar, rigid(spine2), 0.003);
  }
  if (suit || look.topStyle === 'coat') {
    const coat = look.topStyle === 'coat';
    const vBot = coat ? 1.3 : 1.1, vTop = 1.455;
    // The shirt (or blouse) in the jacket's V.
    bb.panel([[-0.058, vTop], [0.058, vTop], [0, vBot - 0.02]], on(0.004), look.under, spine, 0.003);
    // Notched lapels: from the collar down to the top button, wider over the chest, with a notch
    // under the collar.
    const lapel = darker(T, 0.9);
    for (const s of [-1, 1]) {
      const pts: [number, number][] = [[0.058, vTop], [0.085, 1.455], [0.098, 1.4], [0.086, 1.385], [0.118, 1.36], [0.016, vBot], [0.002, vBot]];
      bb.panel(pts.map(([x, y]) => [x * s, y]), on(0.008), lapel, spine, 0.005);
    }
    // The jacket's front edges, cut away below the button, and the buttons.
    for (const s of [-1, 1]) bb.panel([[0.002 * s, vBot], [0.006 * s, vBot], [0.05 * s, 0.79], [0.04 * s, 0.79]], on(0.004), darker(T, 0.6), spine, 0.002);
    const btns = coat ? [1.24, 1.12, 1.0, 0.88] : [vBot - 0.01, vBot - 0.11];
    for (const y of btns) bb.ellipsoid(V(0.004, y, front(y) + 0.008), V(0.009, 0.009, 0.004), coat ? 0xc9a24a : darker(T, 0.45), spine, 8, undefined, coat ? Surf.Metal : Surf.Leather);
    if (suit) {
      // Breast pocket welt (left chest) with a pocket square, and flap pockets at the hips.
      bb.panel([[0.056, 1.29], [0.122, 1.296], [0.122, 1.284], [0.056, 1.278]], on(0.005), darker(T, 0.75), spine, 0.002);
      if (look.pocket !== null) bb.panel([[0.062, 1.293], [0.075, 1.322], [0.088, 1.303], [0.1, 1.325], [0.112, 1.296]], on(0.007), look.pocket, spine, 0.004, Surf.Silk);
      for (const s of [-1, 1]) bb.panel([[0.06 * s, 0.93], [0.15 * s, 0.928], [0.15 * s, 0.9], [0.06 * s, 0.902]], on(0.004), darker(T, 0.82), spine, 0.004);
      if (look.pin !== null) bb.ellipsoid(V(0.098, 1.37, surfZ(0.098, 1.37) + 0.014), V(0.007, 0.007, 0.004), look.pin, spine, 8, undefined, Surf.Metal);
    }
  }
  if (look.tie !== null) {
    // Knot and blade, tapering to the point (tucked under the jacket's button on a suit).
    bb.panel([[-0.018, 1.452], [0.018, 1.452], [0.012, 1.418], [-0.012, 1.418]], on(0.009), look.tie, rigid(spine2), 0.012);
    const tip = suit ? 1.13 : 1.07;
    bb.panel([[-0.011, 1.42], [0.011, 1.42], [0.036, tip + 0.03], [0, tip], [-0.036, tip + 0.03]], on(0.006), look.tie, spine, 0.004);
  }
  if (look.topStyle === 'zip') {
    bb.tube(V(0, 1.44, -0.03), V(0, 1.53, -0.02), 0.064, 0.056, T, rigid(neck), 12, false);
    bb.box(V(0, 1.24, front(1.24) + 0.004), V(0.008, 0.42, 0.004), 0xe8e2d8, spine);
    bb.box(V(0, 1.47, 0.07), V(0.012, 0.03, 0.008), 0xbfbfbf, rigid(neck), 0, Surf.Metal);
  }
  if (look.topStyle === 'hoodie') {
    bb.ellipsoid(V(0, 1.47, -0.1), V(0.11, 0.07, 0.07), T, rigid(spine2), 12);
    bb.box(V(0, 1.05, front(1.05) + 0.004), V(0.2, 0.11, 0.01), darker(T, 0.88), spine);
    for (const s of [-1, 1]) bb.tube(V(0.04 * s, 1.43, 0.085), V(0.045 * s, 1.3, front(1.3) + 0.006), 0.004, 0.004, 0xeeeeee, spine, 5);
  }
  if (look.topStyle === 'tee' || look.topStyle === 'sweater') {
    bb.tube(V(0, 1.445, -0.03), V(0, 1.47, -0.028), 0.062, 0.058, darker(T, 0.9), rigid(neck), 12, false);
  }
  if (look.lanyard) {
    const strap = 0x2b4a7a;
    for (const s of [-1, 1]) bb.tube(V(0.055 * s, 1.46, 0.03), V(0.012 * s, 1.27, front(1.27) + 0.012), 0.006, 0.006, strap, spine, 5, false);
    bb.box(V(0, 1.215, front(1.21) + 0.014), V(0.058, 0.082, 0.004), 0xf6f6f2, spine);
    bb.box(V(0, 1.245, front(1.21) + 0.0165), V(0.058, 0.018, 0.002), strap, spine);
  }

  // ---- neck and head
  const S = look.skin;
  bb.tube(V(0, 1.44, -0.03), V(0, 1.57, -0.015), fem ? 0.047 : 0.053, fem ? 0.043 : 0.049, S, limb(V(0, 1.44, -0.03), V(0, 1.57, -0.015), neck, spine2, 0.4), 12, false);
  const hr = rigid(head);
  const hc = V(0, 1.668, 0.004);
  bb.push(headShape(hc, fem), S, hr);
  // Nose: bridge, tip and the wings of the nostrils.
  bb.tube(V(0, 1.682, 0.094), V(0, 1.632, 0.112), 0.009, 0.012, S, hr, 8, false);
  bb.ellipsoid(V(0, 1.628, 0.111), V(0.0135, 0.0125, 0.013), S, hr, 10);
  for (const s of [-1, 1]) bb.ellipsoid(V(0.0125 * s, 1.623, 0.1), V(0.009, 0.008, 0.009), S, hr, 8);
  bb.ellipsoid(V(0, 1.618, 0.103), V(0.011, 0.003, 0.006), darker(S, 0.45), hr, 8);
  for (const s of [-1, 1]) {
    bb.ellipsoid(V(0.081 * s, 1.655, -0.004), V(0.012, 0.027, 0.019), S, hr, 10); // ears
    // Eyes: a glossy white, a colored iris with a pupil, and lids that give the eye its shape.
    const ex = 0.031 * s, ey = 1.67, ez = 0.083;
    bb.ellipsoid(V(ex, ey, ez), V(0.0145, 0.0095, 0.009), 0xeeeae4, hr, 12, undefined, Surf.Eye);
    bb.ellipsoid(V(ex, ey, ez + 0.0068), V(0.0066, 0.0066, 0.003), look.eyes, hr, 10, undefined, Surf.Eye);
    bb.ellipsoid(V(ex, ey, ez + 0.0083), V(0.0029, 0.0029, 0.0014), 0x0b0908, hr, 8, undefined, Surf.Eye);
    bb.ellipsoid(V(ex, ey + 0.004, ez + 0.001), V(0.0158, 0.0072, 0.0098), S, hr, 12, (p) => p.y > ey + 0.0035); // upper lid
    bb.ellipsoid(V(ex, ey - 0.0045, ez), V(0.0152, 0.005, 0.0094), S, hr, 10, (p) => p.y < ey - 0.006); // lower lid
    if (fem) bb.tube(V(ex - 0.014 * s, ey + 0.0045, ez + 0.006), V(ex + 0.015 * s, ey + 0.006, ez + 0.004), 0.0012, 0.0016, 0x16100c, hr, 4, false, Surf.Hair); // lashes
    // Brows: an arch of three short strokes.
    const bc = look.hairStyle === 'bald' ? darker(S, 0.5) : darker(look.hair, look.hair > 0x808080 ? 0.7 : 1);
    const bw = fem ? 0.0022 : 0.0032;
    bb.tube(V(0.012 * s, 1.692, 0.095), V(0.03 * s, 1.698, 0.096), bw + 0.0006, bw, bc, hr, 5, true, Surf.Hair);
    bb.tube(V(0.03 * s, 1.698, 0.096), V(0.05 * s, 1.692, 0.089), bw, bw * 0.7, bc, hr, 5, true, Surf.Hair);
  }
  // Lips: upper and lower.
  bb.ellipsoid(V(0, 1.601, 0.092), V(0.02, 0.0048, 0.008), look.lips, hr, 10);
  bb.ellipsoid(V(0, 1.593, 0.09), V(0.017, 0.0055, 0.008), look.lips, hr, 10);
  if (look.beard) bb.ellipsoid(V(0, 1.6, 0.032), V(0.072, 0.064, 0.082), look.hair, hr, 16, (p) => p.y < 1.625 || p.z < 0.02);
  else if (look.stubble) bb.ellipsoid(V(0, 1.6, 0.029), V(0.069, 0.06, 0.079), mix(S, look.hair, 0.35), hr, 16, (p) => (p.y < 1.62 || p.z < 0.02) && !(p.y > 1.585 && p.y < 1.61 && p.z > 0.07));
  if (look.glasses) {
    for (const s of [-1, 1]) {
      const g = new THREE.TorusGeometry(0.019, 0.0024, 5, 18);
      g.scale(1.1, 0.85, 1);
      g.translate(0.032 * s, 1.67, 0.104);
      bb.push(g, 0x1c1c1e, hr, Surf.Leather);
      bb.box(V(0.068 * s, 1.674, 0.055), V(0.003, 0.004, 0.09), 0x1c1c1e, hr, 0, Surf.Leather);
    }
    bb.box(V(0, 1.676, 0.106), V(0.016, 0.003, 0.003), 0x1c1c1e, hr, 0, Surf.Leather);
  }
  // Hair: a cap over the skull with a hairline, plus whatever the style adds.
  const H = look.hair;
  if (look.hairStyle !== 'bald') {
    const thick = look.hairStyle === 'buzz' ? 0.004 : look.hairStyle === 'curly' ? 0.03 : 0.014;
    const line = look.hairStyle === 'buzz' ? 1.712 : look.bangs ? 1.7 : 1.72;
    bb.ellipsoid(V(0, 1.678, -0.006), V(0.082 + thick, 0.11 + thick, 0.1 + thick), H, hr, 24,
      (p) => (p.z < 0.03 || p.y > line) && (p.y > 1.63 || p.z < -0.03) && !(Math.abs(p.x) > 0.068 && p.y < 1.685 && p.z > -0.025));
    // Volume on top: short cuts lift at the front, side parts sweep across.
    if (look.hairStyle === 'short') bb.ellipsoid(V(0, 1.758, 0.028), V(0.078, 0.032, 0.07), H, hr, 14);
    if (look.hairStyle === 'side') {
      bb.ellipsoid(V(0.018, 1.758, 0.04), V(0.076, 0.03, 0.066), H, hr, 14);
      bb.ellipsoid(V(-0.04, 1.745, 0.06), V(0.04, 0.022, 0.04), H, hr, 10);
    }
    if (look.bangs) bb.ellipsoid(V(0, 1.718, 0.07), V(0.072, 0.024, 0.04), H, hr, 14, (p) => p.y > 1.706 || p.z < 0.07);
    if (look.hairStyle === 'long' || look.hairStyle === 'bob') {
      const bottom = look.hairStyle === 'long' ? 1.47 : 1.585;
      const mid = (1.69 + bottom) / 2, half = (1.69 - bottom) / 2;
      // The back falls to the shoulders (long) or the jaw (bob), with curtains framing the face.
      bb.ellipsoid(V(0, mid, -0.045), V(0.1, half + 0.02, 0.07), H, rigid(look.hairStyle === 'long' ? neck : head), 18, (p) => p.z < 0.01 || p.y > 1.64);
      for (const s of [-1, 1]) bb.ellipsoid(V(0.08 * s, mid + 0.02, 0.008), V(0.02, half, 0.048), H, hr, 12);
    }
    if (look.hairStyle === 'bun') bb.ellipsoid(V(0, 1.74, -0.09), V(0.042, 0.04, 0.038), H, hr, 14);
    if (look.hairStyle === 'ponytail') {
      bb.ellipsoid(V(0, 1.7, -0.1), V(0.026, 0.024, 0.024), H, hr, 10);
      bb.tube(V(0, 1.69, -0.112), V(0, 1.5, -0.13), 0.028, 0.012, H, limb(V(0, 1.69, -0.112), V(0, 1.5, -0.13), head, neck, 0.6), 10, true);
    }
    if (look.hairStyle === 'curly') {
      bb.ellipsoid(V(0, 1.725, -0.012), V(0.108, 0.088, 0.114), H, hr, 18, (p) => p.z < 0.06 || p.y > 1.728);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        bb.ellipsoid(V(Math.cos(a) * 0.085, 1.74 + Math.sin(a * 2) * 0.01, Math.sin(a) * 0.08 - 0.015), V(0.04, 0.04, 0.04), H, hr, 8);
      }
    }
  }
  if (look.cap) {
    bb.tube(V(0, 1.735, -0.004), V(0, 1.8, -0.004), 0.094, 0.098, 0x1f3a2c, hr, 18, false);
    bb.ellipsoid(V(0, 1.8, -0.004), V(0.098, 0.012, 0.098), 0x1f3a2c, hr, 16);
    bb.box(V(0, 1.742, 0.11), V(0.15, 0.008, 0.06), 0x111111, hr, 0, Surf.Leather);
    bb.box(V(0, 1.752, 0.095), V(0.19, 0.012, 0.004), 0xc9a24a, hr, 0, Surf.Metal);
  }
  if (look.earpiece) {
    // A discreet earpiece with its coiled wire running down into the collar.
    bb.ellipsoid(V(-0.083, 1.652, 0.012), V(0.006, 0.008, 0.006), 0xd8d6d0, hr, 8, undefined, Surf.Metal);
    bb.tube(V(-0.082, 1.645, 0.0), V(-0.06, 1.5, -0.04), 0.0016, 0.0016, 0xd8d6d0, limb(V(-0.082, 1.645, 0), V(-0.06, 1.5, -0.04), neck, head, 0.6), 4, false, Surf.Metal);
  }

  // ---- arms (T-pose along ±X). Short sleeves on tees; cuffs on everything else; a shirt cuff
  // showing under a jacket sleeve.
  const shortSleeve = look.topStyle === 'tee';
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? 1 : -1;
    const sh = P(`${side}Arm`), el = P(`${side}ForeArm`), wr = P(`${side}Hand`);
    const arm = B(`${side}Arm`), fore = B(`${side}ForeArm`), hand = B(`${side}Hand`);
    const upW = limb(sh, el, arm, spine2, 0.22), foreW = limb(el, wr, fore, arm, 0.18);
    const ur0 = (fem ? 0.047 : 0.054) * W, ur1 = fem ? 0.038 : 0.044;
    const sl = suit ? 0.008 : 0;
    if (shortSleeve) {
      const mid = sh.clone().lerp(el, 0.55);
      bb.tube(sh, mid, ur0 + 0.008, ur1 + 0.01, T, upW, 14, false);
      bb.ellipsoid(sh.clone().add(V(-0.012 * s, -0.006, 0)), V(ur0 + 0.006, ur0 + 0.004, ur0 + 0.008), T, upW, 14);
      bb.tube(mid, el, ur1, ur1 * 0.95, S, upW, 12, false);
      bb.tube(el, wr, ur1 * 0.88, 0.029, S, foreW, 12);
    } else {
      bb.tube(sh, el, ur0 + 0.006 + sl, ur1 + 0.006 + sl, T, upW, 14, false);
      bb.ellipsoid(sh.clone().add(V(-0.012 * s, -0.006, 0)), V(ur0 + 0.004 + sl, ur0 + 0.002 + sl, ur0 + 0.006 + sl), T, upW, 14);
      bb.ellipsoid(el, V(ur1 + 0.005 + sl, ur1 + 0.005 + sl, ur1 + 0.005 + sl), T, foreW, 12);
      const cuff = wr.clone().lerp(el, suit ? 0.1 : 0.06);
      bb.tube(el, cuff, ur1 * 0.95 + 0.004 + sl, 0.036 + sl, T, foreW, 12);
      if (suit) {
        const shirtCuff = wr.clone().lerp(el, 0.04);
        bb.tube(cuff, shirtCuff, 0.033, 0.032, look.under, foreW, 12, false);
        bb.tube(shirtCuff, wr, 0.029, 0.028, S, foreW, 10, false);
      } else bb.tube(cuff, wr, 0.03, 0.028, S, foreW, 10, false);
    }
    // Hand: the palm, four fingers on their own bones (they bend with the clips) and a thumb.
    const mid1 = P(`${side}HandMiddle1`);
    const palmC = wr.clone().lerp(mid1, 0.5);
    bb.ellipsoid(palmC.clone().add(V(0, -0.003, 0)), V(Math.abs(mid1.x - wr.x) * 0.62, 0.016, 0.039), S, rigid(hand), 12);
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky'] as const) {
      const r0 = f === 'Pinky' ? 0.0075 : f === 'Middle' ? 0.0095 : 0.009;
      const j = [1, 2, 3, 4].map((k) => P(`${side}Hand${f}${k}`));
      for (let k = 0; k < 3; k++) {
        const bone = B(`${side}Hand${f}${k + 1}`), parent = k ? B(`${side}Hand${f}${k}`) : hand;
        bb.tube(j[k], j[k + 1], r0 * (1 - k * 0.1), r0 * (0.9 - k * 0.1), S, limb(j[k], j[k + 1], bone, parent, 0.3), 7, true);
      }
    }
    const t = [1, 2, 3, 4].map((k) => P(`${side}HandThumb${k}`));
    for (let k = 0; k < 3; k++) {
      const bone = B(`${side}HandThumb${k + 1}`), parent = k ? B(`${side}HandThumb${k}`) : hand;
      bb.tube(t[k], t[k + 1], 0.012 - k * 0.0012, 0.0105 - k * 0.0012, S, limb(t[k], t[k + 1], bone, parent, 0.3), 7, true);
    }
  }

  // ---- legs (or a skirt and tights) and shoes
  if (look.skirt) {
    // A pencil skirt to the knee. Its lower half follows the thighs, so it moves when they do.
    const lUp = B('LeftUpLeg'), rUp = B('RightUpLeg');
    const knee = P('LeftLeg').y;
    const skirtW: Weights = (p) => {
      const t = THREE.MathUtils.clamp((0.92 - p.y) / (0.92 - knee), 0, 1) * 0.8;
      return [hips, 1 - t, p.x >= 0 ? lUp : rUp, t];
    };
    const sk: [number, number, number, number, number][] = [
      [knee + 0.02, hipW * 1.0, 0.105, 0.0, T], [0.72, hipW * 1.05, 0.112, 0.0, T], [0.86, hipW * 1.03, 0.11, 0.0, T], [0.95, hipW * 0.98, 0.106, 0.004, T],
    ];
    bb.loft(sk, skirtW, 24);
  }
  for (const side of ['Left', 'Right'] as const) {
    const hip = P(`${side}UpLeg`), knee = P(`${side}Leg`), ankle = P(`${side}Foot`), toe = P(`${side}ToeBase`);
    const up = B(`${side}UpLeg`), leg = B(`${side}Leg`), foot = B(`${side}Foot`);
    const top = hip.clone().add(V(0, 0.03, 0));
    const tr = (fem ? 0.082 : 0.078) * W;
    const legC = look.skirt ? look.tights : Pn;
    if (look.skirt) bb.surfOf.set(look.tights, Surf.Silk);
    bb.tube(top, knee, look.skirt ? tr * 0.86 : tr, look.skirt ? 0.046 : 0.054, legC, limb(top, knee, up, hips, 0.25), 14);
    bb.tube(knee, ankle.clone().add(V(0, 0.03, 0)), look.skirt ? 0.045 : 0.053, look.skirt ? 0.032 : 0.042, legC, limb(knee, ankle, leg, up, 0.15), 14);
    if (suit && !look.skirt) {
      // Pressed trouser creases down the front of each leg.
      bb.tube(top.clone().add(V(0, -0.1, tr - 0.004)), knee.clone().add(V(0, 0, 0.051)), 0.0035, 0.003, darker(Pn, 0.86), limb(top, knee, up, hips, 0.25), 4, false);
      bb.tube(knee.clone().add(V(0, 0, 0.051)), ankle.clone().add(V(0, 0.04, 0.04)), 0.003, 0.003, darker(Pn, 0.86), limb(knee, ankle, leg, up, 0.15), 4, false);
    }
    const sx = ankle.x;
    const fw = limb(ankle, toe, foot, leg, 0.05);
    if (look.skirt) {
      // Court shoes: a slim toe, an open top and a block heel.
      bb.ellipsoid(V(sx, 0.045, 0.055), V(0.037, 0.035, 0.11), look.shoes, fw, 14, (p) => p.y > 0.016);
      bb.box(V(sx, 0.03, -0.045), V(0.034, 0.05, 0.034), look.shoes, rigid(foot));
      bb.ellipsoid(V(sx, 0.07, 0.0), V(0.032, 0.02, 0.06), look.tights, fw, 10);
    } else {
      const formal = suit || look.shoes === 0x1b1b1d || look.shoes === 0x4a3020;
      // Oxfords for a suit (a toe cap, a slim welt), trainers and boots otherwise.
      bb.ellipsoid(V(sx, 0.052, 0.036), V(formal ? 0.044 : 0.048, formal ? 0.046 : 0.052, formal ? 0.13 : 0.125), look.shoes, fw, 16, (p) => p.y > 0.008);
      if (formal) bb.ellipsoid(V(sx, 0.04, 0.115), V(0.039, 0.032, 0.05), darker(look.shoes, 0.8), fw, 12, (p) => p.y > 0.012);
      bb.box(V(sx, 0.01, 0.035), V(formal ? 0.086 : 0.092, 0.02, 0.252), look.shoes === 0xeeeeea ? 0xdedbd2 : darker(look.shoes, 0.6), rigid(foot), 0, Surf.Leather);
      if (!formal) bb.box(V(sx, 0.07, 0.07), V(0.05, 0.01, 0.1), look.shoes === 0xeeeeea ? 0xcfcac0 : darker(look.shoes, 0.8), fw, -0.35); // laces
    }
  }

  const g = mergeGeometries(bb.geos, false)!;
  for (const x of bb.geos) x.dispose();
  return g;
}

/**
 * One material for every person (so each is still one draw call), with what each vertex is made of
 * deciding how it shades: skin with a warm glow where light scatters under it and a soft sheen,
 * cloth with a weave, a fabric sheen and a little color variation, glossy eyes, polished leather,
 * hair with strands. The detail is procedural, in the body's own (bind-pose) space, so it sticks
 * to the person as they move.
 */
const PERSON_MAT = (() => {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.74, metalness: 0, envMapIntensity: 0.55, sheen: 1, sheenRoughness: 0.55, sheenColor: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float surf;\nvarying float vSurf;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vSurf;
varying vec3 vBind;
float pHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(pHash(i), pHash(i + vec3(1,0,0)), f.x), mix(pHash(i + vec3(0,1,0)), pHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(pHash(i + vec3(0,0,1)), pHash(i + vec3(1,0,1)), f.x), mix(pHash(i + vec3(0,1,1)), pHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float isS(float id) { return 1.0 - step(0.5, abs(vSurf - id)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // Detail fades out once it would shimmer (smaller than a pixel or two).
  float px = length(fwidth(vBind));
  float fine = 1.0 - smoothstep(0.0015, 0.004, px);
  float n1 = pNoise(vBind * 40.0), n2 = pNoise(vBind * 160.0);
  float cloth = isS(0.0), skin = isS(1.0), hair = isS(2.0);
  // Cloth: a mottle and a weave.
  float weave = sin(vBind.x * 2200.0) * sin(vBind.y * 2200.0);
  diffuseColor.rgb *= 1.0 + cloth * ((n1 - 0.5) * 0.08 + fine * weave * 0.035);
  // Skin: blotchy warmth and pores.
  diffuseColor.rgb *= 1.0 + skin * ((n1 - 0.5) * 0.03 + fine * (n2 - 0.5) * 0.04);
  // Hair: strands running down and back.
  float strand = pNoise(vec3(vBind.x * 900.0, vBind.y * 60.0, vBind.z * 900.0));
  diffuseColor.rgb *= 1.0 + hair * ((strand - 0.5) * (0.25 * fine + 0.08) + (n1 - 0.5) * 0.1);
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
roughnessFactor = isS(0.0) * 0.86 + isS(1.0) * 0.5 + isS(2.0) * 0.42 + isS(3.0) * 0.3 + isS(4.0) * 0.08 + isS(5.0) * 0.28 + isS(6.0) * 0.38 + isS(7.0) * 0.45;
roughnessFactor += isS(1.0) * (pNoise(vBind * 300.0) - 0.5) * 0.12;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = isS(5.0) * 0.85;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
// Sheen: soft and bright on cloth (stronger on silk and wool), a faint peach fuzz on skin.
material.sheenColor = diffuseColor.rgb * (isS(0.0) * 0.9 + isS(7.0) * 1.1 + isS(1.0) * 0.35) + vec3(isS(1.0) * 0.03);
material.sheenRoughness = isS(7.0) > 0.5 ? 0.35 : 0.6;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// Light scattering under the skin: a warm glow that keeps faces from going grey in shade.
totalEmissiveRadiance += isS(1.0) * diffuseColor.rgb * vec3(0.11, 0.035, 0.02);
totalEmissiveRadiance += isS(6.0) * diffuseColor.rgb * vec3(0.08, 0.02, 0.02);`);
  };
  m.customProgramCacheKey = () => 'person-v2';
  return m;
})();
const bodyCache = new Map<string, THREE.BufferGeometry>();
/** Looks per role: enough variety for a busy floor, bounded so memory doesn't grow per visit. */
const LOOKS_PER_ROLE = 40;

function dress(ch: Character, role: NpcRole, seed: number) {
  const model = ch.root.children[0];
  const surf = model.getObjectByName('Beta_Surface') as THREE.SkinnedMesh | undefined;
  const joints = model.getObjectByName('Beta_Joints');
  if (!surf) return;
  const key = `${role}:${seed % LOOKS_PER_ROLE}`;
  let geo = bodyCache.get(key);
  if (!geo) { geo = buildBody(makeLook(role, seed % LOOKS_PER_ROLE)); bodyCache.set(key, geo); }
  const mesh = new THREE.SkinnedMesh(geo, PERSON_MAT);
  mesh.bind(surf.skeleton, surf.bindMatrix);
  mesh.bindMatrixInverse.copy(surf.bindMatrixInverse);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'Person';
  surf.parent!.add(mesh);
  surf.removeFromParent();
  joints?.removeFromParent();
}

// ------------------------------------------------------------------ behavior

/** Done with a person: stop their clips and free their skeleton's bone texture (body geometry is shared). */
export function disposeNpc(ch: Character) {
  ch.mixer.stopAllAction();
  ch.root.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) s.skeleton.dispose(); });
}

const focus = new THREE.Vector3();
let focusOn = false;
/** Where the player is (in the scene the NPCs are in): people look up at you when you come close. */
export function setNpcFocus(p: THREE.Vector3 | null) {
  if (p) { focus.copy(p); focusOn = true; } else focusOn = false;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Rotate a bone (in world terms) so the direction `from` (from the bone's origin) turns toward `to`. */
function turnBone(bone: THREE.Object3D, fromDir: THREE.Vector3, toDir: THREE.Vector3, w: number) {
  _q.setFromUnitVectors(fromDir, toDir);
  bone.getWorldQuaternion(_q2);
  _q.multiply(_q2); // desired world rotation
  bone.parent!.getWorldQuaternion(_q3);
  _q3.invert().multiply(_q); // desired local rotation
  bone.quaternion.slerp(_q3, w);
  bone.updateMatrixWorld(true);
}
function aimAt(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, w: number) {
  const o = bone.getWorldPosition(_a);
  const from = child.getWorldPosition(_b).sub(o).normalize();
  const to = _c.copy(target).sub(o).normalize();
  turnBone(bone, from, to, w);
}
/** Two-bone IK: shoulder→elbow→wrist reaches `target`, elbow bending toward `pole`. */
function reach(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(fore.getWorldPosition(_d)), b = _d.distanceTo(hand.getWorldPosition(_e));
  const dir = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(dir.length(), 0.05, a + b - 0.002);
  dir.normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
  aimAt(upper, fore, elbow, w);
  aimAt(fore, hand, S.addScaledVector(dir, d), w);
}

type Activity = 'type' | 'sip' | 'glance' | 'attend' | 'idle';

class Behavior implements NpcLife {
  away = false;
  partner: THREE.Vector3 | null = null;
  talking = false;
  talkW = 0;
  t = Math.random() * 10;
  act: Activity = 'type';
  actT = 2 + Math.random() * 6;
  armW = 0;
  headW = 0;
  glanceYaw = 0;
  cup: THREE.Mesh | null = null;
  bones: Record<string, THREE.Object3D> = {};
  private fwd = new THREE.Vector3();
  private left = new THREE.Vector3();

  constructor(private ch: Character) {
    const model = ch.root.children[0];
    for (const n of ['Hips', 'Spine2', 'Neck', 'Head', 'LeftEye', 'RightEye', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1'])
      this.bones[n] = model.getObjectByName(`mixamorig${n}`)!;
    if (this.desk) {
      this.cup = new THREE.Mesh(CUP_GEO, CUP_MAT);
      this.cup.castShadow = true;
      ch.root.add(this.cup);
    }
    if (ch.role === 'board' || ch.role === 'doorman') this.act = 'idle';
  }

  get desk() { return !this.away && (this.ch.role === 'worker' || this.ch.role === 'agent' || this.ch.role === 'reception'); }

  update(dt: number) {
    const ch = this.ch, bn = this.bones;
    this.t += dt;
    const idle = ch.current === 'idle';
    ch.root.updateMatrixWorld(true);
    const rootPos = ch.root.getWorldPosition(new THREE.Vector3());
    const scale = ch.root.getWorldScale(_a).y;
    // Facing from the eyes, sideways from the shoulders: no assumptions about the rig's axes.
    const headPos = bn.Head.getWorldPosition(new THREE.Vector3());
    const eyes = bn.LeftEye.getWorldPosition(_b).add(bn.RightEye.getWorldPosition(_c)).multiplyScalar(0.5);
    this.fwd.copy(eyes).sub(headPos).setY(0).normalize();
    this.left.copy(bn.LeftArm.getWorldPosition(_b)).sub(bn.RightArm.getWorldPosition(_c)).setY(0).normalize();

    // Someone walks up: stop and look at them.
    const near = focusOn && idle && !this.partner && rootPos.distanceTo(focus) < 3.4;
    if (near && this.act !== 'attend') { this.act = 'attend'; this.actT = 0; }
    if (!near && this.act === 'attend') { this.act = this.desk ? 'type' : 'idle'; this.actT = 2 + Math.random() * 4; }
    this.actT -= dt;
    if (this.actT <= 0 && this.act !== 'attend') {
      const r = Math.random();
      if (this.desk) {
        const busy = ch.role === 'agent';
        if (this.act === 'type') {
          this.act = r < (busy ? 0.08 : 0.3) ? 'sip' : r < (busy ? 0.2 : 0.55) ? 'glance' : 'type';
          this.actT = this.act === 'sip' ? 3.2 : this.act === 'glance' ? 1.6 + Math.random() : 4 + Math.random() * (busy ? 10 : 7);
          this.glanceYaw = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        } else { this.act = 'type'; this.actT = 4 + Math.random() * 8; }
      } else {
        this.act = r < 0.35 ? 'glance' : 'idle';
        this.actT = this.act === 'glance' ? 1.8 : 3 + Math.random() * 6;
        this.glanceYaw = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      }
    }

    const typing = idle && this.desk && !this.partner && (this.act === 'type' || this.act === 'glance' || this.act === 'sip');
    this.armW = THREE.MathUtils.damp(this.armW, typing ? 1 : 0, 6, dt);
    // A nod or head shake playing on top (agents agreeing, the board voting) keeps the head.
    const gesturing = ch.mixer.stats.actions.inUse > 1;
    const conversing = idle && !!this.partner;
    this.talkW = THREE.MathUtils.damp(this.talkW, conversing && this.talking ? 1 : 0, 4, dt);
    const lookWant = idle && (conversing || this.act === 'attend' || this.act === 'glance' || this.desk) ? (gesturing ? 0.25 : 1) : 0;
    this.headW = THREE.MathUtils.damp(this.headW, lookWant, 5, dt);

    const deskPt = (side: number, up: number, out: number) =>
      rootPos.clone().addScaledVector(this.fwd, out * scale).addScaledVector(this.left, side * scale).addScaledVector(UP, up * scale);

    // Arms: hands on the keyboard (typing taps), or the right one bringing the cup up.
    if (this.armW > 0.01) {
      const rate = ch.role === 'agent' ? 17 : 11;
      for (const side of [1, -1]) {
        const tap = Math.max(0, Math.sin(this.t * rate + side * 1.9 + Math.sin(this.t * 2.3) * 2)) * 0.014;
        const sipping = side === -1 && this.act === 'sip';
        let target: THREE.Vector3;
        if (sipping) {
          const k = THREE.MathUtils.smoothstep(Math.min(this.actT, 3.2 - this.actT), 0, 0.7);
          const rest = deskPt(-0.3, 1.1, 0.42);
          const mouth = headPos.clone().addScaledVector(this.fwd, 0.13 * scale).addScaledVector(UP, -0.075 * scale);
          target = rest.lerp(mouth, k);
        } else target = deskPt(0.15 * side, 1.075 - tap, 0.44);
        const pole = this.left.clone().multiplyScalar(side * 0.7).addScaledVector(UP, -1).addScaledVector(this.fwd, -0.4);
        const pre = side === 1 ? 'Left' : 'Right';
        reach(bn[`${pre}Arm`], bn[`${pre}ForeArm`], bn[`${pre}Hand`], target, pole, this.armW);
      }
    }
    // Talking with their hands: loose beats in front of the chest, the two hands out of step.
    if (this.talkW > 0.01 && this.armW < 0.05) {
      for (const side of [1, -1]) {
        const ph = this.t * (side === 1 ? 2.6 : 2.1) + side;
        const beat = Math.sin(ph) * 0.5 + Math.sin(ph * 2.3) * 0.25;
        const target = deskPt(0.2 * side + Math.sin(ph * 0.7) * 0.05, 1.0 + beat * 0.07, 0.3 + Math.max(0, beat) * 0.06);
        const pole = this.left.clone().multiplyScalar(side * 0.8).addScaledVector(UP, -1).addScaledVector(this.fwd, -0.3);
        const pre = side === 1 ? 'Left' : 'Right';
        reach(bn[`${pre}Arm`], bn[`${pre}ForeArm`], bn[`${pre}Hand`], target, pole, this.talkW * (side === 1 ? 0.8 : 0.55));
      }
    }
    // The coffee cup: on the desk, or in the right hand on the way up.
    if (this.cup) {
      const inHand = this.armW > 0.5 && this.act === 'sip';
      const p = inHand ? bn.RightHandMiddle1.getWorldPosition(_d).addScaledVector(UP, 0.035 * scale) : deskPt(-0.36, 1.06, 0.48);
      this.cup.visible = this.desk && idle;
      this.cup.position.copy(ch.root.worldToLocal(p));
    }
    // Head: at the monitor while working, at you when you're close, a glance around now and then.
    if (this.headW > 0.01) {
      let target: THREE.Vector3;
      if (conversing) target = this.partner!.clone().add(_e.set(0, 1.5 + (this.talking ? 0 : Math.max(0, Math.sin(this.t * 3.1)) * -0.12), 0));
      else if (this.act === 'attend') target = focus.clone().add(_e.set(0, 1.45, 0));
      else if (this.act === 'glance') target = headPos.clone().add(this.fwd.clone().applyAxisAngle(UP, this.glanceYaw).multiplyScalar(3)).addScaledVector(UP, -0.1);
      else if (this.act === 'sip') target = headPos.clone().addScaledVector(this.fwd, 2).addScaledVector(UP, 0.15);
      else target = deskPt(Math.sin(this.t * 0.37) * 0.12, 1.36 + Math.sin(this.t * 0.9) * 0.02, 0.95);
      const from = eyes.clone().sub(headPos).normalize();
      const to = target.sub(headPos).normalize();
      // Necks don't turn all the way round.
      const yaw = Math.atan2(to.clone().cross(this.fwd).y, to.clone().setY(0).normalize().dot(this.fwd));
      if (Math.abs(yaw) > 1.25) to.applyAxisAngle(UP, (Math.sign(yaw) * (Math.abs(yaw) - 1.25)));
      turnBone(bn.Neck, from, _c.copy(from).lerp(to, 0.4).normalize(), this.headW);
      const eyes2 = bn.LeftEye.getWorldPosition(_b).add(bn.RightEye.getWorldPosition(_c)).multiplyScalar(0.5);
      const head2 = bn.Head.getWorldPosition(_d);
      turnBone(bn.Head, eyes2.sub(head2).normalize(), to, this.headW * 0.85);
    }
  }
}

const CUP_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.042, 0.034, 0.1, 14);
  g.translate(0, 0.05, 0);
  return g;
})();
const CUP_MAT = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.35 });

/**
 * A person: a desk worker, Claude agent, receptionist, board member, doorman or pedestrian, with a
 * look of their own. Clips: idle, walk, run, agree, headShake, sad, sneak. `color`/`accent` are the
 * old tint parameters: a glowing teal accent means an agent and a glowing colored one a board
 * member, which is how existing callers ask for them.
 */
export function makeNpc(color: THREE.ColorRepresentation = 0x8899aa, accent: THREE.ColorRepresentation = 0x222222, opts: { glow?: boolean; role?: NpcRole; seed?: number } = {}): Character {
  const acc = new THREE.Color(accent).getHex();
  const role: NpcRole = opts.role ?? (opts.glow ? (acc === 0x2ee6c9 || acc === 0x34e0c8 ? 'agent' : 'board') : acc === 0xffcc33 ? 'reception' : 'worker');
  const ch = build(templates.xbot!, { idle: 'idle', walk: 'walk', run: 'run', agree: 'agree', headShake: 'headShake', sad: 'sad_pose', sneak: 'sneak_pose' }, role);
  // The Xbot already faces +Z, which is forward for every caller (turning a half turn here had
  // desk workers standing with their backs to their desks and people turning away from you).
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6) + new THREE.Color(color).getHex();
  dress(ch, role, seed);
  ch.play('idle', 0);
  // Desync idle loops so crowds don't move in lockstep.
  ch.mixer.setTime(Math.random() * 3);
  if (role !== 'pedestrian') {
    const behave = new Behavior(ch);
    ch.life = behave;
    const update = ch.mixer.update.bind(ch.mixer);
    ch.mixer.update = (dt: number) => { update(dt); behave.update(dt); return ch.mixer; };
  }
  return ch;
}
