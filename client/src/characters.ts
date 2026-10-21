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
  const [soldier, xbot] = await Promise.all([
    loader.loadAsync('/models/Soldier.glb'),
    loader.loadAsync('/models/Xbot.glb'),
  ]);
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

type HairStyle = 'short' | 'side' | 'long' | 'bun' | 'ponytail' | 'curly' | 'buzz' | 'bald';
type TopStyle = 'tee' | 'shirt' | 'blazer' | 'sweater' | 'hoodie' | 'zip' | 'coat';
interface Look {
  skin: number; hair: number; hairStyle: HairStyle; beard: boolean; glasses: boolean;
  top: number; topStyle: TopStyle; under: number; tie: number | null;
  pants: number; shoes: number;
  fem: boolean; width: number; // shoulders/hips width factor
  lanyard: boolean; headset: boolean; cap: boolean;
}

const SKIN = [0xf3d6bf, 0xeac3a1, 0xdcae88, 0xc8946b, 0xab7650, 0x8c5a3c, 0x6c4129, 0x4e2e1e];
const HAIR = [0x17110d, 0x241812, 0x3a281b, 0x5a3d26, 0x7d5a3a, 0xb08a58, 0xd6bd8a, 0x8d8a86, 0xa4482a];
const PANTS = [0x232a38, 0x1e1f23, 0x3d4d68, 0x56677f, 0x6b5f4f, 0xa8977a, 0x4b4d52, 0x3a3228];
const SHOES = [0xeeeeea, 0x1b1b1d, 0x4a3020, 0x6c4a33, 0x7c818a, 0x2b2b30];
const SHIRTS = [0xf2f3f5, 0xdde6f0, 0xa9c2de, 0xe8dccb, 0xc9d6c4, 0xf0d9d9, 0xffffff];
const KNITS = [0x2b3a55, 0x6b2e2e, 0x3d5a3d, 0x8a7a5c, 0x34495e, 0x5c4b6e, 0x9b5d3a, 0xc9c1b3, 0x7a8b94, 0xd4b483, 0x444a52];
const SUITS = [0x22283a, 0x2c2f36, 0x3b3f47, 0x4a4036, 0x1f2a24, 0x5b6470, 0x1c1c22];
const TIES = [0x7a1f2b, 0x24365e, 0x2f5a3a, 0x8a6a2a, 0x4a2b5a];
/** Claude's clay color: the agents' quarter-zips, so you can tell them from people at a glance. */
const AGENT_TOP = 0xc4673f;

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

function makeLook(role: NpcRole, seed: number): Look {
  const r = rng(seed * 7919 + role.length * 104729);
  const fem = r() < 0.5;
  const hairStyle: HairStyle = fem
    ? pick(r, ['long', 'long', 'bun', 'ponytail', 'curly', 'side', 'short'] as const)
    : pick(r, ['short', 'short', 'side', 'buzz', 'curly', 'bald', 'side'] as const);
  const skin = pick(r, SKIN);
  const age = r();
  const hair = age > 0.85 ? 0x9a9792 : pick(r, HAIR);
  const look: Look = {
    skin, hair, hairStyle, beard: !fem && r() < 0.28, glasses: r() < 0.3,
    top: pick(r, KNITS), topStyle: 'sweater', under: pick(r, SHIRTS), tie: null,
    pants: pick(r, PANTS), shoes: pick(r, SHOES),
    fem, width: fem ? 0.92 + r() * 0.08 : 0.98 + r() * 0.1,
    lanyard: false, headset: false, cap: false,
  };
  const office = (): TopStyle => pick(r, ['shirt', 'shirt', 'sweater', 'blazer', 'tee', 'hoodie', 'shirt'] as const);
  switch (role) {
    case 'agent':
      look.topStyle = 'zip'; look.top = AGENT_TOP; look.under = 0xf1efe9;
      look.lanyard = true; look.headset = true; look.pants = pick(r, [0x23252b, 0x2b3446, 0x4b4d52]);
      break;
    case 'board':
      look.topStyle = 'blazer'; look.top = pick(r, SUITS); look.under = pick(r, SHIRTS);
      look.tie = !fem && r() < 0.6 ? pick(r, TIES) : null; look.pants = look.top; look.shoes = pick(r, [0x1b1b1d, 0x4a3020]);
      break;
    case 'reception':
      look.topStyle = 'blazer'; look.top = pick(r, SUITS); look.under = pick(r, SHIRTS); look.lanyard = true;
      look.pants = look.top; look.shoes = 0x1b1b1d;
      break;
    case 'doorman':
      look.topStyle = 'coat'; look.top = 0x1f3a2c; look.under = 0xf2f3f5; look.tie = 0x1b1b1d;
      look.pants = 0x1e1f23; look.shoes = 0x1b1b1d; look.cap = true; look.glasses = false;
      if (look.hairStyle === 'long' || look.hairStyle === 'bun' || look.hairStyle === 'ponytail' || look.hairStyle === 'curly') look.hairStyle = 'bun';
      break;
    default: {
      look.topStyle = office();
      if (look.topStyle === 'shirt') look.top = pick(r, SHIRTS);
      if (look.topStyle === 'blazer') { look.top = pick(r, SUITS); look.under = pick(r, SHIRTS); }
      if (look.topStyle === 'tee') look.top = pick(r, [...KNITS, 0xf2f2f0, 0x1e1f23]);
      if (role === 'worker' && r() < 0.35) look.lanyard = true;
    }
  }
  return look;
}

// ------------------------------------------------------------------ the body

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Weights = (p: THREE.Vector3) => [number, number, number, number]; // bone, weight, bone2, weight2

class BodyBuilder {
  geos: THREE.BufferGeometry[] = [];
  private tmp = new THREE.Vector3();

  push(g: THREE.BufferGeometry, color: number, w: Weights) {
    g.deleteAttribute('uv');
    if (!g.index) g = (() => { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); return g; })();
    const pos = g.attributes.position as THREE.BufferAttribute, n = pos.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      this.tmp.fromBufferAttribute(pos, i);
      const [b0, w0, b1, w1] = w(this.tmp);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      si[i * 4] = b0; sw[i * 4] = w0; si[i * 4 + 1] = b1; sw[i * 4 + 1] = w1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!g.attributes.normal) g.computeVertexNormals();
    this.geos.push(g);
  }

  ellipsoid(c: THREE.Vector3, r: THREE.Vector3, color: number, w: Weights, seg = 12, keep?: (p: THREE.Vector3) => boolean) {
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
    this.push(g, color, w);
  }

  /** A tapered tube from a (radius r0) to b (radius r1), with rounded ends. */
  tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: number, w: Weights, radial = 10, caps = true) {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, radial, 3, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    this.push(g, color, w);
    if (caps) {
      this.ellipsoid(a, V(r0, r0, r0), color, w, radial);
      this.ellipsoid(b, V(r1, r1, r1), color, w, radial);
    }
  }

  box(c: THREE.Vector3, s: THREE.Vector3, color: number, w: Weights, rotX = 0) {
    const g = new THREE.BoxGeometry(s.x, s.y, s.z);
    if (rotX) g.rotateX(rotX);
    g.translate(c.x, c.y, c.z);
    this.push(g, color, w);
  }

  /** Lofted elliptical rings (torso, coat), each ring [y, half-width, half-depth, z offset, color]. */
  loft(rings: [number, number, number, number, number][], w: Weights, radial = 20) {
    const pos: number[] = [], cols: number[] = [], idx: number[] = [];
    const ringCol: number[] = [];
    rings.forEach(([y, rx, rz, oz, c]) => {
      const col = new THREE.Color(c);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        // A slightly squared-off ellipse reads more like a torso than a tube.
        const s = Math.sin(a), co = Math.cos(a);
        const sq = 0.82;
        const x = Math.sign(s) * Math.pow(Math.abs(s), sq) * rx, z = Math.sign(co) * Math.pow(Math.abs(co), sq) * rz + oz;
        pos.push(x, y, z);
        cols.push(col.r, col.g, col.b);
      }
      ringCol.push(c);
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
      pos.push(0, y, oz); cols.push(col.r, col.g, col.b);
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
    this.geos.push(g);
  }
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

function buildBody(look: Look): THREE.BufferGeometry {
  const bb = new BodyBuilder();
  const head = B('Head'), neck = B('Neck'), spine2 = B('Spine2'), hips = B('Hips');
  const W = look.width, fem = look.fem;
  const spine = spineWeights();

  // ---- torso: pants below the waist, the top above (jackets and coats run longer)
  const long = look.topStyle === 'blazer' ? 0.86 : look.topStyle === 'coat' ? 0.62 : look.topStyle === 'hoodie' || look.topStyle === 'zip' ? 0.93 : 0.985;
  const T = look.top, Pn = look.pants;
  const hipW = (fem ? 0.172 : 0.158) * W, waistW = (fem ? 0.13 : 0.148) * W, chestW = (fem ? 0.158 : 0.178) * W, shW = (fem ? 0.165 : 0.19) * W;
  const rings: [number, number, number, number, number][] = [];
  const add = (y: number, rx: number, rz: number, oz: number) => rings.push([y, rx, rz, oz, y < long ? Pn : T]);
  if (look.topStyle === 'coat') {
    // A knee-length doorman's coat flares out over the legs.
    rings.push([0.6, hipW * 1.18, 0.15, 0.0, T], [0.75, hipW * 1.12, 0.14, 0.0, T]);
  }
  add(0.86, hipW * 0.96, 0.1, 0.0);
  add(0.94, hipW, 0.108, 0.004);
  if (long > 0.9 && long < 1.0) { add(long - 0.004, hipW * 0.99, 0.108, 0.004); add(long + 0.004, hipW * 0.99 + 0.004, 0.11, 0.004); }
  add(1.04, waistW + (look.topStyle === 'blazer' || look.topStyle === 'coat' ? 0.012 : 0), 0.104, 0.008);
  add(1.14, waistW * 1.02, 0.102 + (fem ? 0.004 : 0), 0.012);
  add(1.24, chestW, fem ? 0.118 : 0.112, 0.016);
  add(1.33, chestW * 1.03, fem ? 0.112 : 0.114, 0.006);
  add(1.4, shW, 0.1, -0.018);
  add(1.45, shW * 0.82, 0.085, -0.028);
  add(1.475, 0.07, 0.058, -0.03);
  bb.loft(rings, spine);
  const front = (y: number) => {
    // z of the torso's front surface at height y (matches the rings above, near enough)
    if (y > 1.38) return 0.085;
    if (y > 1.28) return fem ? 0.125 : 0.12;
    if (y > 1.18) return fem ? 0.133 : 0.127;
    return 0.11;
  };
  if (fem) for (const s of [-1, 1]) bb.ellipsoid(V(0.058 * s, 1.27, 0.088), V(0.06, 0.055, 0.05), T, spine, 10);

  // ---- tops: collars, jacket fronts, zips, hoods, ties, lanyards
  const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
  if (look.topStyle === 'shirt' || look.topStyle === 'blazer' || look.topStyle === 'coat') {
    const collar = look.topStyle === 'shirt' ? T : look.under;
    bb.tube(V(0, 1.45, -0.03), V(0, 1.5, -0.025), 0.058, 0.05, collar, rigid(neck), 12, false);
    for (const s of [-1, 1]) bb.box(V(0.03 * s, 1.462, 0.045), V(0.045, 0.006, 0.05), collar, rigid(spine2), -0.5);
  }
  if (look.topStyle === 'blazer' || look.topStyle === 'coat') {
    // The shirt showing in the jacket's V, and lapels.
    const vTop = 1.45, vBot = look.topStyle === 'coat' ? 1.3 : 1.2;
    for (let y = vBot; y < vTop; y += 0.03) {
      const t = (y - vBot) / (vTop - vBot);
      bb.box(V(0, y + 0.015, front(y) + 0.002), V(0.012 + 0.07 * t, 0.032, 0.006), look.under, spine);
    }
    for (const s of [-1, 1]) bb.box(V(0.05 * s, 1.33, front(1.33) + 0.004), V(0.012, 0.2, 0.008), darker(T, 0.75), spine);
    const btns = look.topStyle === 'coat' ? [1.24, 1.12, 1.0, 0.88] : [1.1];
    for (const y of btns) bb.ellipsoid(V(0, y, front(y) + 0.006), V(0.009, 0.009, 0.005), look.topStyle === 'coat' ? 0xc9a24a : darker(T, 0.6), spine, 6);
  }
  if (look.tie !== null) {
    bb.box(V(0, 1.43, front(1.43) + 0.006), V(0.03, 0.03, 0.012), look.tie, rigid(spine2));
    bb.box(V(0, 1.3, front(1.3) + 0.006), V(0.04, 0.22, 0.006), look.tie, spine);
  }
  if (look.topStyle === 'zip') {
    bb.tube(V(0, 1.44, -0.03), V(0, 1.53, -0.02), 0.064, 0.056, T, rigid(neck), 12, false);
    bb.box(V(0, 1.24, front(1.24) + 0.004), V(0.008, 0.42, 0.004), 0xe8e2d8, spine);
    bb.box(V(0, 1.47, 0.07), V(0.012, 0.03, 0.008), 0xbfbfbf, rigid(neck));
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
    const strap = look.topStyle === 'zip' ? 0x2bb5a0 : 0x2b4a7a;
    for (const s of [-1, 1]) bb.tube(V(0.055 * s, 1.46, 0.03), V(0.012 * s, 1.27, front(1.27) + 0.008), 0.006, 0.006, strap, spine, 5, false);
    bb.box(V(0, 1.215, front(1.21) + 0.01), V(0.058, 0.082, 0.004), 0xf6f6f2, spine);
    bb.box(V(0, 1.245, front(1.21) + 0.0125), V(0.058, 0.018, 0.002), strap, spine);
  }

  // ---- neck and head
  bb.tube(V(0, 1.44, -0.03), V(0, 1.57, -0.015), 0.048, 0.044, look.skin, limb(V(0, 1.44, -0.03), V(0, 1.57, -0.015), neck, spine2, 0.4), 10, false);
  const hc = V(0, 1.668, 0.004);
  bb.ellipsoid(hc, V(0.082 * (fem ? 0.97 : 1), 0.11, 0.097), look.skin, rigid(head), 16);
  bb.ellipsoid(V(0, 1.598, 0.024), V(fem ? 0.06 : 0.068, 0.058, 0.074), look.skin, rigid(head), 12); // jaw
  bb.ellipsoid(V(0, 1.643, 0.102), V(0.0135, 0.024, 0.02), look.skin, rigid(head), 8); // nose
  for (const s of [-1, 1]) {
    bb.ellipsoid(V(0.084 * s, 1.655, -0.002), V(0.013, 0.027, 0.019), look.skin, rigid(head), 8); // ears
    bb.ellipsoid(V(0.032 * s, 1.672, 0.086), V(0.0155, 0.0105, 0.008), 0xf4f1ec, rigid(head), 8); // eye whites
    bb.ellipsoid(V(0.032 * s, 1.672, 0.0925), V(0.0072, 0.0072, 0.0035), 0x2a1e17, rigid(head), 8); // irises
    bb.box(V(0.034 * s, 1.693, 0.09), V(0.03, 0.0055, 0.008), look.hairStyle === 'bald' ? darker(look.skin, 0.55) : look.hair, rigid(head)); // brows
  }
  bb.ellipsoid(V(0, 1.604, 0.091), V(0.02, 0.0055, 0.006), darker(look.skin, fem ? 0.62 : 0.72), rigid(head), 8); // mouth
  if (look.beard) bb.ellipsoid(V(0, 1.6, 0.03), V(0.074, 0.062, 0.08), look.hair, rigid(head), 12, (p) => p.y < 1.625 || p.z < 0.02);
  if (look.glasses) {
    for (const s of [-1, 1]) {
      const g = new THREE.TorusGeometry(0.019, 0.0028, 5, 14);
      g.translate(0.033 * s, 1.672, 0.1);
      bb.push(g, 0x1c1c1e, rigid(head));
      bb.box(V(0.068 * s, 1.674, 0.055), V(0.003, 0.004, 0.09), 0x1c1c1e, rigid(head));
    }
    bb.box(V(0, 1.676, 0.102), V(0.016, 0.003, 0.003), 0x1c1c1e, rigid(head));
  }
  // Hair: a cap over the skull with a hairline, plus whatever the style adds.
  const H = look.hair;
  if (look.hairStyle !== 'bald') {
    const thick = look.hairStyle === 'buzz' ? 0.004 : look.hairStyle === 'curly' ? 0.03 : 0.012;
    const line = look.hairStyle === 'buzz' ? 1.71 : 1.718;
    bb.ellipsoid(V(0, 1.676, -0.004), V(0.084 + thick, 0.112 + thick, 0.1 + thick), H, rigid(head), look.hairStyle === 'curly' ? 18 : 16,
      (p) => (p.z < 0.035 || p.y > line) && (p.y > 1.632 || p.z < -0.03) && !(Math.abs(p.x) > 0.07 && p.y < 1.68 && p.z > -0.02));
    if (look.hairStyle === 'side') bb.ellipsoid(V(0.02, 1.752, 0.045), V(0.075, 0.03, 0.06), H, rigid(head), 12);
    if (look.hairStyle === 'short') bb.ellipsoid(V(0, 1.755, 0.03), V(0.08, 0.03, 0.07), H, rigid(head), 12);
    if (look.hairStyle === 'long') {
      bb.ellipsoid(V(0, 1.56, -0.05), V(0.098, 0.14, 0.06), H, rigid(head), 14, (p) => p.z < 0.0 || p.y > 1.62);
      for (const s of [-1, 1]) bb.ellipsoid(V(0.08 * s, 1.6, 0.0), V(0.03, 0.09, 0.05), H, rigid(head), 10);
    }
    if (look.hairStyle === 'bun') bb.ellipsoid(V(0, 1.735, -0.088), V(0.04, 0.038, 0.036), H, rigid(head), 10);
    if (look.hairStyle === 'ponytail') {
      bb.ellipsoid(V(0, 1.7, -0.098), V(0.026, 0.024, 0.024), H, rigid(head), 8);
      bb.ellipsoid(V(0, 1.6, -0.118), V(0.026, 0.085, 0.026), H, rigid(head), 10);
    }
    if (look.hairStyle === 'curly') bb.ellipsoid(V(0, 1.72, -0.01), V(0.105, 0.085, 0.112), H, rigid(head), 14, (p) => p.z < 0.06 || p.y > 1.725);
  }
  if (look.cap) {
    bb.tube(V(0, 1.735, -0.004), V(0, 1.8, -0.004), 0.094, 0.098, 0x1f3a2c, rigid(head), 16, false);
    bb.ellipsoid(V(0, 1.8, -0.004), V(0.098, 0.012, 0.098), 0x1f3a2c, rigid(head), 14);
    bb.box(V(0, 1.742, 0.11), V(0.15, 0.008, 0.06), 0x111111, rigid(head));
    bb.box(V(0, 1.752, 0.095), V(0.19, 0.012, 0.004), 0xc9a24a, rigid(head));
  }
  if (look.headset) {
    bb.ellipsoid(V(-0.09, 1.656, 0.0), V(0.012, 0.022, 0.02), 0x1c1d20, rigid(head), 8);
    bb.tube(V(-0.093, 1.645, 0.012), V(-0.045, 1.605, 0.095), 0.0028, 0.0028, 0x1c1d20, rigid(head), 5);
    bb.ellipsoid(V(-0.042, 1.604, 0.097), V(0.006, 0.006, 0.006), 0x1c1d20, rigid(head), 6);
  }

  // ---- arms (T-pose along ±X). Short sleeves on tees; cuffs on everything else.
  const shortSleeve = look.topStyle === 'tee';
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? 1 : -1;
    const sh = P(`${side}Arm`), el = P(`${side}ForeArm`), wr = P(`${side}Hand`);
    const arm = B(`${side}Arm`), fore = B(`${side}ForeArm`), hand = B(`${side}Hand`);
    const upW = limb(sh, el, arm, spine2, 0.22), foreW = limb(el, wr, fore, arm, 0.18);
    const ur0 = (fem ? 0.047 : 0.054) * W, ur1 = fem ? 0.038 : 0.044;
    if (shortSleeve) {
      const mid = sh.clone().lerp(el, 0.55);
      bb.tube(sh, mid, ur0 + 0.008, ur1 + 0.01, T, upW, 12, false);
      bb.ellipsoid(sh.clone().add(V(-0.012 * s, -0.006, 0)), V(ur0 + 0.006, ur0 + 0.004, ur0 + 0.008), T, upW, 12);
      bb.tube(mid, el, ur1, ur1 * 0.95, look.skin, upW, 10, false);
      bb.tube(el, wr, ur1 * 0.88, 0.029, look.skin, foreW, 10);
    } else {
      bb.tube(sh, el, ur0 + 0.006, ur1 + 0.006, T, upW, 12, false);
      bb.ellipsoid(sh.clone().add(V(-0.012 * s, -0.006, 0)), V(ur0 + 0.004, ur0 + 0.002, ur0 + 0.006), T, upW, 12);
      bb.ellipsoid(el, V(ur1 + 0.005, ur1 + 0.005, ur1 + 0.005), T, foreW, 10);
      const cuff = wr.clone().lerp(el, 0.06);
      bb.tube(el, cuff, ur1 * 0.95 + 0.004, 0.036, T, foreW, 10);
      bb.tube(cuff, wr, 0.03, 0.028, look.skin, foreW, 8, false);
    }
    // Hand: palm, a mitten of fingers, a thumb.
    bb.ellipsoid(wr.clone().add(V(0.045 * s, -0.004, 0)), V(0.048, 0.019, 0.04), look.skin, rigid(hand), 10);
    bb.ellipsoid(wr.clone().add(V(0.11 * s, -0.006, -0.002)), V(0.038, 0.014, 0.037), look.skin, limb(wr, wr.clone().add(V(0.15 * s, 0, 0)), B(`${side}HandMiddle1`), hand, 0.5), 10);
    bb.ellipsoid(wr.clone().add(V(0.045 * s, -0.016, 0.04)), V(0.025, 0.012, 0.014), look.skin, rigid(hand), 8);
  }

  // ---- legs and shoes
  for (const side of ['Left', 'Right'] as const) {
    const hip = P(`${side}UpLeg`), knee = P(`${side}Leg`), ankle = P(`${side}Foot`), toe = P(`${side}ToeBase`);
    const up = B(`${side}UpLeg`), leg = B(`${side}Leg`), foot = B(`${side}Foot`);
    const top = hip.clone().add(V(0, 0.03, 0));
    const tr = (fem ? 0.082 : 0.078) * W;
    bb.tube(top, knee, tr, 0.054, Pn, limb(top, knee, up, hips, 0.25), 12);
    bb.tube(knee, ankle.clone().add(V(0, 0.03, 0)), 0.053, 0.042, Pn, limb(knee, ankle, leg, up, 0.15), 12);
    const sx = ankle.x;
    bb.ellipsoid(V(sx, 0.05, 0.035), V(0.047, 0.05, 0.125), look.shoes, limb(ankle, toe, foot, leg, 0.05), 12, (p) => p.y > 0.008);
    bb.box(V(sx, 0.01, 0.035), V(0.09, 0.02, 0.245), look.shoes === 0xeeeeea ? 0xdedbd2 : darker(look.shoes, 0.7), rigid(foot));
  }

  const g = mergeGeometries(bb.geos, false)!;
  for (const x of bb.geos) x.dispose();
  return g;
}

const PERSON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0, envMapIntensity: 0.45 });
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

class Behavior {
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

  get desk() { return this.ch.role === 'worker' || this.ch.role === 'agent' || this.ch.role === 'reception'; }

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
    const near = focusOn && idle && rootPos.distanceTo(focus) < 3.4;
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

    const typing = idle && this.desk && (this.act === 'type' || this.act === 'glance' || this.act === 'sip');
    this.armW = THREE.MathUtils.damp(this.armW, typing ? 1 : 0, 6, dt);
    // A nod or head shake playing on top (agents agreeing, the board voting) keeps the head.
    const gesturing = ch.mixer.stats.actions.inUse > 1;
    const lookWant = idle && (this.act === 'attend' || this.act === 'glance' || this.desk) ? (gesturing ? 0.25 : 1) : 0;
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
      if (this.act === 'attend') target = focus.clone().add(_e.set(0, 1.45, 0));
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
  ch.root.children[0].rotation.y = Math.PI;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6) + new THREE.Color(color).getHex();
  dress(ch, role, seed);
  ch.play('idle', 0);
  // Desync idle loops so crowds don't move in lockstep.
  ch.mixer.setTime(Math.random() * 3);
  if (role !== 'pedestrian') {
    const behave = new Behavior(ch);
    const update = ch.mixer.update.bind(ch.mixer);
    ch.mixer.update = (dt: number) => { update(dt); behave.update(dt); return ch.mixer; };
  }
  return ch;
}
