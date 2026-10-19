import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AgentEvent, AgentInfo, BoardMessage, Repo, RepoDetail, Worker } from '../../shared/types.ts';
import type { GameCtx, Scene3D } from './ctx.ts';
import { api, onLive, track } from './api.ts';
import { shared } from './engine.ts';
import { CLOTHES, makeNpc, type Character } from './characters.ts';
import { Colliders, type PlayerWorld } from './player.ts';
import { esc } from './interact.ts';
import {
  canvas, carpetTexture, drawAgentMonitor, drawDecisions, drawFeed, drawIdleMonitor, drawLogoWall, drawPlate, drawSign,
  drawWorkerMonitor, hashStr, marbleTexture, rng, skylineTexture, texFrom, woodTexture,
} from './interiorArt.ts';
import { openWorkerPanel } from './ui/workerPanel.ts';
import { openAgentLivePanel, openHireAgentPanel } from './ui/agentPanel.ts';
import { BOARD, openBoardroomPanel } from './ui/boardroomPanel.ts';

export interface Interior extends Scene3D {
  world: PlayerWorld;
  spawn: THREE.Vector3;
  spawnFacing: number;
  repo: Repo;
  detail: RepoDetail;
}

// ---------- helpers ----------

type V3 = [number, number, number];
const KEEP = new Set(['position', 'normal', 'uv']);

/** Collects static geometry per material and merges it into one mesh per material. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos: V3, rotY = 0, rotX = 0, rotZ = 0) {
    let g = geo;
    if (g.index) { g = geo.toNonIndexed(); geo.dispose(); }
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)), new THREE.Vector3(1, 1, 1)));
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }
  box(mat: THREE.Material, w: number, h: number, d: number, pos: V3, rotY = 0) {
    this.add(mat, new THREE.BoxGeometry(w, h, d), pos, rotY);
  }
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, pos: V3, seg = 16) {
    this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg), pos);
  }
  build(parent: THREE.Object3D, casters: Set<THREE.Material>, out: THREE.BufferGeometry[]) {
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = casters.has(mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(merged);
    }
    this.parts.clear();
  }
}

const addClips = new Map<string, THREE.AnimationClip>();
/** Additive gesture on top of the idle loop (the Xbot gesture clips are authored as additive poses). */
function additive(ch: Character, name: string) {
  const base = ch.actions[name]?.getClip();
  if (!base) return null;
  let clip = addClips.get(name);
  if (!clip) { clip = THREE.AnimationUtils.makeClipAdditive(base.clone()); addClips.set(name, clip); }
  return ch.mixer.clipAction(clip);
}
function gesture(ch: Character, name: string) {
  const a = additive(ch, name);
  if (!a) return;
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.setEffectiveWeight(1);
  a.play();
}
function setPose(ch: Character, name: string, on: boolean) {
  const a = additive(ch, name);
  if (!a) return;
  if (on && !a.isRunning()) { a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.setEffectiveWeight(1); a.fadeIn(0.4).play(); }
  if (!on && a.isRunning()) a.fadeOut(0.4);
}

interface Npc {
  id: string;
  ch: Character;
  base: number; // resting facing
  look: number | null; // override facing (toward speaker/player)
  turnToPlayer: boolean;
  nextGesture: number;
  kind: 'worker' | 'reception' | 'agent' | 'board';
}

const angleTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// ---------- build ----------

export async function buildInterior(ctx: GameCtx, repo: Repo): Promise<Interior> {
  const detail: RepoDetail = await api.repo(repo.name).catch(() => ({ repo, readme: '', workers: [], decisions: [], agents: [] }));
  track('building_entered', { repo: repo.name, tier: repo.tier });

  const W = ({ landmark: 48, tower: 44, midrise: 40, small: 34 } as const)[repo.tier] ?? 40;
  const D = 40;
  const H = repo.tier === 'landmark' ? 5 : 4.2;
  const LOBBY = 9;
  const ROOM_W = 13, ROOM_D = 14;
  const zRooms = D - ROOM_D;
  const labCx = W / 2 - ROOM_W / 2;
  const brdCx = -W / 2 + ROOM_W / 2;
  const brdCz = zRooms + ROOM_D / 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1018);
  const envRT = ctx.engine.pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.35;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const M = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };
  const T = <X extends THREE.Texture>(t: X) => { texs.push(t); return t; };

  const brand = new THREE.Color(repo.brandColor || '#4fd1ff');
  const mat = {
    wall: M(new THREE.MeshStandardMaterial({ color: 0xe9e6e0, roughness: 0.85 })),
    ceiling: M(new THREE.MeshStandardMaterial({ color: 0xd9d8d4, roughness: 0.95 })),
    light: M(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e2, emissiveIntensity: 2.2 })),
    metal: M(new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.35, metalness: 0.85 })),
    steel: M(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 })),
    white: M(new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.35 })),
    wood: M(new THREE.MeshStandardMaterial({ map: T(woodTexture('#9a7550')), roughness: 0.45 })),
    darkWood: M(new THREE.MeshStandardMaterial({ map: T(woodTexture('#4a3426')), roughness: 0.3 })),
    fabric: M(new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.95 })),
    sofa: M(new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.9 })),
    divider: M(new THREE.MeshStandardMaterial({ color: 0x8f9aa6, roughness: 0.95 })),
    black: M(new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4, metalness: 0.3 })),
    leaf: M(new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.8, flatShading: true })),
    leaf2: M(new THREE.MeshStandardMaterial({ color: 0x2f6332, roughness: 0.8, flatShading: true })),
    pot: M(new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 })),
    accent: M(new THREE.MeshStandardMaterial({ color: brand, emissive: brand, emissiveIntensity: 0.8, roughness: 0.4 })),
    glass: M(new THREE.MeshPhysicalMaterial({ color: 0xcfe6ee, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 })),
    window: M(new THREE.MeshPhysicalMaterial({ color: 0xbfd6e0, roughness: 0.02, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })),
  };
  const casters = new Set<THREE.Material>([mat.white, mat.wood, mat.darkWood, mat.fabric, mat.sofa, mat.divider, mat.black, mat.leaf, mat.leaf2, mat.pot, mat.metal]);

  const colliders = new Colliders(8);
  const solid = (x1: number, z1: number, x2: number, z2: number, maxY = 3) =>
    colliders.add({ minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2), maxY });

  const b = new Batch();
  const root = new THREE.Group();
  scene.add(root);

  // ---------- floors ----------
  const floorMesh = (m: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number) => {
    const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  const tiled = (t: THREE.Texture, rx: number, rz: number) => { const c = T(t.clone()); c.repeat.set(rx, rz); c.needsUpdate = true; return c; };
  const marble = T(marbleTexture());
  const carpet = T(carpetTexture());
  const oak = T(woodTexture('#7a5a3e'));
  floorMesh(M(new THREE.MeshStandardMaterial({ map: tiled(marble, W / 4, (LOBBY + 1.5) / 4), roughness: 0.08, metalness: 0.0 })), -W / 2, 0, W / 2, LOBBY + 1.5, 0);
  floorMesh(M(new THREE.MeshStandardMaterial({ map: tiled(carpet, W / 2, (D - LOBBY - 1.5) / 2), roughness: 0.97 })), -W / 2, LOBBY + 1.5, W / 2, D, 0.002);
  floorMesh(M(new THREE.MeshStandardMaterial({ map: tiled(oak, ROOM_W / 2, ROOM_D / 2), roughness: 0.25 })), -W / 2, zRooms, -W / 2 + ROOM_W, D, 0.004);
  floorMesh(M(new THREE.MeshStandardMaterial({ color: 0x3a414d, roughness: 0.22, metalness: 0.1 })), W / 2 - ROOM_W, zRooms, W / 2, D, 0.004);
  // Brand-colored inlay runner from the door to reception
  b.box(mat.accent, 0.12, 0.01, LOBBY - 4.2, [-1.4, 0.006, (LOBBY - 4.2) / 2]);
  b.box(mat.accent, 0.12, 0.01, LOBBY - 4.2, [1.4, 0.006, (LOBBY - 4.2) / 2]);

  // ---------- ceiling & lights ----------
  {
    const g = new THREE.PlaneGeometry(W, D);
    geos.push(g);
    const c = new THREE.Mesh(g, mat.ceiling);
    c.rotation.x = Math.PI / 2;
    c.position.set(0, H, D / 2);
    root.add(c);
    for (let x = -W / 2 + 4; x <= W / 2 - 4; x += 4) for (let z = 3; z < D - 1; z += 5) b.box(mat.light, 1.3, 0.04, 2.6, [x, H - 0.03, z]);
    // Lobby feature: a ring of linear lights above reception
    b.box(mat.light, 8, 0.05, 0.12, [0, H - 0.05, 4.2]);
    b.box(mat.light, 8, 0.05, 0.12, [0, H - 0.05, 7.2]);
  }

  // ---------- outer walls with floor-to-ceiling windows ----------
  const windowWall = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const rot = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2; // box X axis along the wall
    b.box(mat.wall, len, 0.5, 0.25, [cx, 0.25, cz], rot);
    b.box(mat.wall, len, 0.45, 0.25, [cx, H - 0.225, cz], rot);
    b.box(mat.window, len, H - 0.95, 0.02, [cx, 0.5 + (H - 0.95) / 2, cz], rot);
    const n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.box(mat.metal, 0.08, H, 0.12, [x1 + (x2 - x1) * t, H / 2, z1 + (z2 - z1) * t]);
    }
    b.box(mat.metal, len, 0.05, 0.1, [cx, 0.52, cz], rot); // sill
  };
  windowWall(-W / 2, 0, -W / 2, D);
  windowWall(W / 2, 0, W / 2, D);
  windowWall(-W / 2, D, W / 2, D);
  // Front wall with glass entrance doors
  b.box(mat.wall, W / 2 - 2, H, 0.3, [-(W / 2 + 2) / 2, H / 2, 0]);
  b.box(mat.wall, W / 2 - 2, H, 0.3, [(W / 2 + 2) / 2, H / 2, 0]);
  b.box(mat.wall, 4, H - 3, 0.3, [0, 3 + (H - 3) / 2, 0]);
  b.box(mat.glass, 1.95, 2.95, 0.04, [-1, 1.5, 0.02]);
  b.box(mat.glass, 1.95, 2.95, 0.04, [1, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [0, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [-2, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [2, 1.5, 0.02]);
  b.box(mat.steel, 0.6, 0.04, 0.04, [-0.4, 1.1, 0.1]);
  b.box(mat.steel, 0.6, 0.04, 0.04, [0.4, 1.1, 0.1]);
  {
    const { c } = canvas(512, 128);
    drawPlate(c, 'EXIT', '#3ddc97');
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(0.9, 0.22);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: t })));
    m.position.set(0, 3.25, 0.17);
    root.add(m);
  }
  solid(-W / 2, -0.4, W / 2, 0.15, 5);

  // ---------- skyline backdrops beyond the windows ----------
  {
    const seed = hashStr(repo.name);
    const day = T(skylineTexture(false, seed)), night = T(skylineTexture(true, seed));
    const sky = M(new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, uNight: shared.uNight },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform float uNight; varying vec2 vUv;
        void main(){ vec4 c = mix(texture2D(dayMap, vUv), texture2D(nightMap, vUv), uNight); gl_FragColor = vec4(c.rgb * 0.9, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    }));
    const put = (w: number, x: number, z: number, ry: number) => {
      const g = new THREE.PlaneGeometry(w, 34);
      geos.push(g);
      const m = new THREE.Mesh(g, sky);
      m.position.set(x, 6, z);
      m.rotation.y = ry;
      root.add(m);
    };
    put(W + 70, 0, D + 22, Math.PI);
    put(D + 70, -W / 2 - 22, D / 2, Math.PI / 2);
    put(D + 70, W / 2 + 22, D / 2, -Math.PI / 2);
  }

  // ---------- glass partitions ----------
  const glassWall = (x1: number, z1: number, x2: number, z2: number, gapAt?: number, gapW = 2.4) => {
    const segs: [number, number][] = [];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (gapAt === undefined) segs.push([0, len]);
    else { segs.push([0, gapAt - gapW / 2], [gapAt + gapW / 2, len]); }
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const rot = Math.atan2(dx, dz) - Math.PI / 2;
    for (const [a, bb] of segs) {
      const l = bb - a;
      if (l <= 0.05) continue;
      const mx = x1 + dx * (a + l / 2), mz = z1 + dz * (a + l / 2);
      b.box(mat.glass, l, H - 0.2, 0.03, [mx, (H - 0.2) / 2 + 0.05, mz], rot);
      b.box(mat.metal, l, 0.06, 0.08, [mx, 0.03, mz], rot);
      b.box(mat.metal, l, 0.08, 0.08, [mx, H - 0.14, mz], rot);
      const n = Math.max(1, Math.round(l / 2));
      for (let i = 0; i <= n; i++) b.box(mat.metal, 0.05, H - 0.1, 0.06, [x1 + dx * (a + (l * i) / n), (H - 0.1) / 2, z1 + dz * (a + (l * i) / n)]);
      // Frosted privacy band
      b.box(mat.white, l, 0.12, 0.035, [mx, 1.25, mz], rot);
      const ax = x1 + dx * a, az = z1 + dz * a, bx = x1 + dx * bb, bz = z1 + dz * bb;
      solid(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, 5);
    }
    if (gapAt !== undefined) b.box(mat.metal, gapW, H - 3, 0.1, [x1 + dx * gapAt, 3 + (H - 3) / 2, z1 + dz * gapAt], rot);
  };
  // Agent Lab (back right) and Boardroom (back left)
  glassWall(W / 2 - ROOM_W, zRooms, W / 2, zRooms, ROOM_W / 2);
  glassWall(W / 2 - ROOM_W, zRooms, W / 2 - ROOM_W, D);
  glassWall(-W / 2, zRooms, -W / 2 + ROOM_W, zRooms, ROOM_W / 2);
  glassWall(-W / 2 + ROOM_W, zRooms, -W / 2 + ROOM_W, D);

  const plate = (text: string, color: string, x: number, z: number) => {
    const { c } = canvas(1024, 160);
    drawPlate(c, text, color);
    const g = new THREE.PlaneGeometry(2.4, 0.38);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)) })));
    m.position.set(x, 3.25, z - 0.08);
    m.rotation.y = Math.PI;
    root.add(m);
  };
  plate('AGENT LAB', '#3ddc97', labCx, zRooms);
  plate('BOARDROOM', '#ffcc33', brdCx, zRooms);

  // ---------- columns ----------
  for (const [x, z] of [[-(W / 2 - 3), LOBBY + 0.8], [W / 2 - 3, LOBBY + 0.8], [-(W / 2 - ROOM_W - 1.6), zRooms - 1], [W / 2 - ROOM_W - 1.6, zRooms - 1]] as [number, number][]) {
    b.cyl(mat.white, 0.36, 0.36, H, [x, H / 2, z], 24);
    b.cyl(mat.steel, 0.4, 0.4, 0.08, [x, 0.04, z], 24);
    solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 5);
  }

  // ---------- plants ----------
  const plant = (x: number, z: number, s = 1) => {
    const r = rng(hashStr(`${x},${z}`));
    b.cyl(mat.pot, 0.32 * s, 0.24 * s, 0.6 * s, [x, 0.3 * s, z], 14);
    b.cyl(mat.black, 0.3 * s, 0.3 * s, 0.02, [x, 0.6 * s, z], 14);
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.25 * s;
      b.add(i % 2 ? mat.leaf : mat.leaf2, new THREE.IcosahedronGeometry((0.28 + r() * 0.25) * s, 0), [x + Math.cos(a) * d, (0.85 + r() * 0.9) * s, z + Math.sin(a) * d], r() * 3, r() * 3);
    }
    solid(x - 0.35 * s, z - 0.35 * s, x + 0.35 * s, z + 0.35 * s, 2);
  };
  plant(-W / 2 + 1.2, 1.2, 1.3); plant(W / 2 - 1.2, 1.2, 1.3);
  plant(-W / 2 + 1.2, LOBBY - 0.5, 1.1); plant(W / 2 - 1.2, LOBBY - 0.5, 1.1);
  plant(-(W / 2 - ROOM_W - 3), zRooms - 1); plant(W / 2 - ROOM_W - 3, zRooms - 1);
  plant(-W / 2 + 0.9, zRooms + 0.9); plant(W / 2 - 0.9, D - 0.9); plant(-W / 2 + 0.9, D - 0.9);

  // ---------- lobby ----------
  const npcs: Npc[] = [];
  const labelIds: string[] = [];
  const interactIds: string[] = [];
  const addLabel = (id: string, pos: THREE.Vector3, html: string, opts: { cls?: string; maxDist?: number } = {}) => {
    ctx.labels.set(id, pos, html, opts);
    if (!labelIds.includes(id)) labelIds.push(id);
  };
  const addInteract = (id: string, pos: THREE.Vector3, radius: number, label: string, sub: string | undefined, action: () => void) => {
    ctx.interactions.add({ id, position: pos, radius, label, sub, action });
    if (!interactIds.includes(id)) interactIds.push(id);
  };
  const spawnNpc = (id: string, kind: Npc['kind'], ch: Character, x: number, z: number, facing: number, turnToPlayer = true) => {
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = facing;
    root.add(ch.root);
    solid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 2);
    const n: Npc = { id, ch, base: facing, look: null, turnToPlayer, nextGesture: 3 + Math.random() * 10, kind };
    npcs.push(n);
    return n;
  };

  // Reception desk
  const recZ = 5.3;
  b.box(mat.white, 4.6, 1.05, 0.8, [0, 0.525, recZ]);
  b.box(mat.darkWood, 4.9, 0.06, 1.0, [0, 1.08, recZ + 0.05]);
  b.box(mat.accent, 4.6, 0.05, 0.02, [0, 0.12, recZ - 0.41]);
  b.box(mat.black, 0.55, 0.36, 0.03, [0.9, 1.33, recZ + 0.25]);
  b.box(mat.metal, 0.05, 0.16, 0.05, [0.9, 1.15, recZ + 0.28]);
  solid(-2.45, recZ - 0.5, 2.45, recZ + 0.55, 2);
  const receptionist = spawnNpc('reception', 'reception', makeNpc(0x2b3a55, 0xffcc33), 0, recZ + 1.05, Math.PI);
  addLabel('lbl-reception', new THREE.Vector3(0, 2.15, recZ + 1.05), `Reception <small>${esc(repo.name)}</small>`, { maxDist: 16 });

  // Logo wall
  {
    const wz = LOBBY - 0.6;
    b.box(mat.darkWood, 11, 3.7, 0.3, [0, 1.85, wz]);
    solid(-5.5, wz - 0.2, 5.5, wz + 0.2, 5);
    const { c } = canvas(2048, 680);
    drawLogoWall(c, repo, null);
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(10.6, 3.5);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.35 })));
    m.position.set(0, 1.88, wz - 0.16);
    m.rotation.y = Math.PI;
    root.add(m);
    // Back side of the wall faces the work floor: a big brand stripe.
    b.box(mat.accent, 10.6, 0.08, 0.02, [0, 3.4, wz + 0.16]);
    if (repo.hasLogo) {
      const img = new Image();
      img.onload = () => { drawLogoWall(c, repo, img); t.needsUpdate = true; };
      img.src = api.logoUrl(repo.name);
    }
  }

  // Directory totem
  {
    const x = -7.6, z = 6.2;
    b.box(mat.black, 1.3, 2.3, 0.2, [x, 1.15, z]);
    solid(x - 0.7, z - 0.15, x + 0.7, z + 0.15, 3);
    const { c } = canvas(560, 1000);
    drawSign(c, repo.name, [
      ['Front desk', 'Ask about the project'],
      ['Work floor', `${detail.workers.length} desks · past PRs & commits`],
      ['Agent Lab →', 'Back right · hire Claude agents'],
      ['← Boardroom', 'Back left · big decisions'],
      ['Exit', 'Behind you'],
    ]);
    const g = new THREE.PlaneGeometry(1.2, 2.14);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)) })));
    m.position.set(x, 1.17, z - 0.11);
    m.rotation.y = Math.PI;
    root.add(m);
  }

  // Lounge: sofas + coffee tables
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 4.5), z = 3.6;
    b.box(mat.sofa, 2.4, 0.45, 0.9, [x, 0.225, z]);
    b.box(mat.sofa, 2.4, 0.5, 0.22, [x, 0.6, z + 0.45]);
    b.box(mat.sofa, 0.22, 0.35, 0.9, [x - 1.2, 0.55, z]);
    b.box(mat.sofa, 0.22, 0.35, 0.9, [x + 1.2, 0.55, z]);
    b.cyl(mat.darkWood, 0.55, 0.55, 0.05, [x, 0.42, z - 1.3], 28);
    b.cyl(mat.steel, 0.05, 0.05, 0.4, [x, 0.2, z - 1.3], 8);
    solid(x - 1.35, z - 0.5, x + 1.35, z + 0.6, 1.2);
    solid(x - 0.6, z - 1.85, x + 0.6, z - 0.75, 1);
  }

  // ---------- desk factory ----------
  const screens: THREE.Mesh[] = [];
  const desk = (x: number, z: number) => {
    b.box(mat.white, 1.6, 0.05, 0.8, [x, 1.05, z]);
    b.box(mat.metal, 0.06, 1.03, 0.66, [x - 0.74, 0.515, z]);
    b.box(mat.metal, 0.06, 1.03, 0.66, [x + 0.74, 0.515, z]);
    b.box(mat.metal, 1.44, 0.08, 0.04, [x, 0.9, z + 0.3]);
    b.box(mat.divider, 1.6, 0.5, 0.04, [x, 1.32, z + 0.42]);
    b.box(mat.black, 0.92, 0.56, 0.035, [x, 1.5, z + 0.22]);
    b.box(mat.metal, 0.06, 0.2, 0.06, [x, 1.17, z + 0.25]);
    b.box(mat.metal, 0.3, 0.015, 0.2, [x, 1.08, z + 0.25]);
    b.box(mat.black, 0.45, 0.02, 0.15, [x, 1.085, z - 0.15]);
    // Chair parked beside the standing desk
    const cx = x + 1.05, cz = z - 0.35;
    b.box(mat.fabric, 0.5, 0.08, 0.5, [cx, 0.5, cz]);
    b.box(mat.fabric, 0.48, 0.55, 0.06, [cx, 0.83, cz + 0.24]);
    b.cyl(mat.metal, 0.03, 0.03, 0.45, [cx, 0.25, cz], 8);
    b.cyl(mat.metal, 0.3, 0.3, 0.03, [cx, 0.05, cz], 10);
    solid(x - 0.85, z - 0.45, x + 0.85, z + 0.47, 2);
    const { c } = canvas(512, 320);
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(0.86, 0.5);
    geos.push(g);
    const scr = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    scr.position.set(x, 1.5, z + 0.2);
    scr.rotation.y = Math.PI;
    root.add(scr);
    screens.push(scr);
    return { c, t };
  };

  // ---------- work floor ----------
  const workers = detail.workers.slice(0, 24);
  const COLS = 6;
  const rowsZ = [12.4, 15.9, 19.4, 22.9];
  const nDesks = Math.min(24, Math.max(12, Math.ceil(workers.length / COLS) * COLS));
  const colX = (i: number) => -(W / 2 - 5) + (i * (W - 10)) / (COLS - 1);
  const workerNpcs = new Map<string, Npc>();
  for (let i = 0; i < nDesks; i++) {
    const x = colX(i % COLS), z = rowsZ[Math.floor(i / COLS)];
    const { c, t } = desk(x, z);
    const w = workers[i];
    if (!w) { drawIdleMonitor(c, i * 31 + 7, 'Hot desk'); t.needsUpdate = true; continue; }
    drawWorkerMonitor(c, w);
    t.needsUpdate = true;
    const r = rng(hashStr(w.id));
    const ch = w.isAgent
      ? makeNpc(0xd5dde6, 0x2ee6c9, { glow: true })
      : makeNpc(CLOTHES[Math.floor(r() * CLOTHES.length)], [0x1a1a1f, 0x3b2a20, 0x2a2a35][Math.floor(r() * 3)]);
    const nx = x + (r() - 0.5) * 0.3, nz = z - 0.78;
    const n = spawnNpc(`w-${w.id}`, 'worker', ch, nx, nz, 0);
    workerNpcs.set(w.id, n);
    const ref = w.kind === 'pr' ? `PR #${w.number}` : w.sha?.slice(0, 7) ?? '';
    const name = w.isAgent ? (w.agentName ?? w.author) : w.author;
    addLabel(`lbl-${w.id}`, new THREE.Vector3(nx, 2.12, nz), `${esc(name)} <small>${esc(ref)}</small>${w.isAgent ? ' <span class="tag agent">AI agent</span>' : ''}`, { cls: w.isAgent ? 'agent' : '', maxDist: 14 });
    addInteract(`w-${w.id}`, new THREE.Vector3(nx, 0, nz), 2.1, `Talk to ${name}`, `${ref} · ${w.title.slice(0, 48)}`, () => talkTo(n, w));
  }

  // ---------- Agent Lab ----------
  const labSlots: { x: number; z: number; c: HTMLCanvasElement; t: THREE.CanvasTexture; agentId: string | null }[] = [];
  for (const z of [zRooms + 5.4, zRooms + 9.6]) for (const dx of [-4, 0, 4]) {
    const x = labCx + dx;
    const { c, t } = desk(x, z);
    drawIdleMonitor(c, Math.floor(x * 13 + z), 'Free desk — hire an agent');
    t.needsUpdate = true;
    labSlots.push({ x, z, c, t, agentId: null });
  }
  // Kiosk
  const kiosk = new THREE.Vector3(labCx - 4.2, 0, zRooms + 1.7);
  {
    b.box(mat.black, 0.6, 1.1, 0.4, [kiosk.x, 0.55, kiosk.z]);
    b.box(mat.accent, 0.62, 0.04, 0.42, [kiosk.x, 0.03, kiosk.z]);
    solid(kiosk.x - 0.35, kiosk.z - 0.25, kiosk.x + 0.35, kiosk.z + 0.25, 2);
    const { c, g } = canvas(400, 300);
    g.fillStyle = '#071a14'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#3ddc97'; g.font = '800 44px Inter, sans-serif'; g.fillText('Hire an', 30, 110); g.fillText('agent', 30, 160);
    g.fillStyle = '#9aa6b8'; g.font = '500 24px Inter, sans-serif'; g.fillText('Claude Code · press E', 30, 220);
    const geo = new THREE.PlaneGeometry(0.7, 0.52);
    geos.push(geo);
    const m = new THREE.Mesh(geo, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)), toneMapped: false })));
    m.position.set(kiosk.x, 1.35, kiosk.z + 0.05);
    m.rotation.set(0.5, Math.PI, 0);
    root.add(m);
    b.box(mat.black, 0.76, 0.58, 0.05, [kiosk.x, 1.35, kiosk.z + 0.09]);
    addLabel('lbl-kiosk', new THREE.Vector3(kiosk.x, 1.95, kiosk.z), 'Hire an agent', { cls: 'agent', maxDist: 12 });
    addInteract('kiosk', new THREE.Vector3(kiosk.x, 0, kiosk.z - 0.4), 2, 'Hire an agent', `Claude Code works on ${repo.name}`, () =>
      openHireAgentPanel(ctx, repo, detail, (a) => upsertAgent(a)));
  }
  // Live feed wall screen
  const feedC = canvas(1600, 620).c;
  const feedT = T(texFrom(feedC));
  {
    const g = new THREE.PlaneGeometry(8.4, 3.25);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: feedT, toneMapped: false })));
    m.position.set(labCx, 2.25, D - 0.3);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.black, 8.6, 3.45, 0.1, [labCx, 2.25, D - 0.22]);
  }

  // ---------- Boardroom ----------
  {
    b.box(mat.darkWood, 2.4, 0.08, 7.2, [brdCx, 0.76, brdCz]);
    b.box(mat.metal, 0.5, 0.72, 2.2, [brdCx, 0.36, brdCz - 2]);
    b.box(mat.metal, 0.5, 0.72, 2.2, [brdCx, 0.36, brdCz + 2]);
    b.box(mat.accent, 0.04, 0.01, 6.8, [brdCx, 0.805, brdCz]);
    solid(brdCx - 1.25, brdCz - 3.65, brdCx + 1.25, brdCz + 3.65, 1.2);
    for (const sx of [-1, 1]) for (const dz of [-2.7, 0, 2.7]) {
      const cx = brdCx + sx * 1.65, cz = brdCz + dz;
      b.box(mat.fabric, 0.55, 0.09, 0.55, [cx, 0.5, cz]);
      b.box(mat.fabric, 0.06, 0.6, 0.52, [cx + sx * 0.27, 0.85, cz]);
      b.cyl(mat.metal, 0.03, 0.03, 0.45, [cx, 0.25, cz], 8);
      b.cyl(mat.metal, 0.3, 0.3, 0.03, [cx, 0.05, cz], 10);
    }
    // Pendant lights over the table
    for (const dz of [-2.4, 0, 2.4]) {
      b.cyl(mat.metal, 0.01, 0.01, H - 2.5, [brdCx, 2.5 + (H - 2.5) / 2, brdCz + dz], 4);
      b.cyl(mat.light, 0.35, 0.35, 0.04, [brdCx, 2.48, brdCz + dz], 24);
    }
  }
  const decC = canvas(1400, 520).c;
  const decT = T(texFrom(decC));
  drawDecisions(decC, detail.decisions);
  decT.needsUpdate = true;
  {
    const g = new THREE.PlaneGeometry(5.6, 2.08);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: decT, toneMapped: false })));
    m.position.set(brdCx, 2.85, D - 0.3);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.black, 5.8, 2.25, 0.1, [brdCx, 2.85, D - 0.22]);
  }
  const boardNpcs = new Map<string, Npc>();
  const seats: Record<string, [number, number, number]> = {
    chair: [brdCx, brdCz + 4.25, Math.PI],
    cto: [brdCx - 1.75, brdCz - 1.35, Math.PI / 2],
    product: [brdCx - 1.75, brdCz + 1.35, Math.PI / 2],
    design: [brdCx + 1.75, brdCz - 1.35, -Math.PI / 2],
    growth: [brdCx + 1.75, brdCz + 1.35, -Math.PI / 2],
  };
  for (const m of BOARD) {
    const [x, z, f] = seats[m.id];
    const col = new THREE.Color(m.color);
    const n = spawnNpc(`b-${m.id}`, 'board', makeNpc(col.clone().multiplyScalar(0.28).getHex(), col.getHex(), { glow: true }), x, z, f, false);
    boardNpcs.set(m.id, n);
    addLabel(`lbl-b-${m.id}`, new THREE.Vector3(x, 2.12, z), `${m.name} <small>${m.role}</small>`, { maxDist: 13 });
  }
  const headSpot = new THREE.Vector3(brdCx, 0, brdCz - 4.4);
  addInteract('boardroom', headSpot, 2.2, 'Convene the board', `${detail.decisions.length} past decisions`, () => convene());

  // ---------- exit ----------
  addInteract('exit', new THREE.Vector3(0, 0, 0.8), 1.7, 'Exit to the street', repo.name, () => ctx.exitBuilding());

  b.build(root, casters, geos);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3a40, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.0);
  sun.position.set(W * 0.15, 14, D * 0.35);
  sun.target.position.set(0, 0, D * 0.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(W, D) * 0.62;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  for (const [x, z] of [[-W / 4, 4], [W / 4, 4], [-W / 4, 17], [W / 4, 17], [brdCx, brdCz], [labCx, brdCz]] as [number, number][]) {
    const p = new THREE.PointLight(0xffe6c8, 28, 18, 2);
    p.position.set(x, H - 0.4, z);
    scene.add(p);
  }
  const lobbyGlow = new THREE.PointLight(brand, 8, 9, 2);
  lobbyGlow.position.set(0, 2, LOBBY - 1.5);
  scene.add(lobbyGlow);

  // ---------- speech bubbles ----------
  const speechTokens = new Map<string, number>();
  const speak = (n: Npc, text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const show = t.length > 120 ? `…${t.slice(-120)}` : t;
    speechTokens.set(n.id, (speechTokens.get(n.id) ?? 0) + 1);
    addLabel(`speech-${n.id}`, new THREE.Vector3(n.ch.root.position.x, 2.5, n.ch.root.position.z), esc(show), { cls: 'speech', maxDist: 20 });
  };
  const hush = (n: Npc, delay = 3500) => {
    const tok = (speechTokens.get(n.id) ?? 0) + 1;
    speechTokens.set(n.id, tok);
    setTimeout(() => { if (speechTokens.get(n.id) === tok) ctx.labels.remove(`speech-${n.id}`); }, delay);
  };

  let talking: Npc | null = null;
  function talkTo(n: Npc, w: Worker | 'reception') {
    talking = n;
    gesture(n.ch, 'agree');
    openWorkerPanel(ctx, repo, w, {
      onSpeak: (t) => speak(n, t),
      onEnd: () => { hush(n); if (talking === n) talking = null; },
    });
  }
  addInteract('reception', new THREE.Vector3(0, 0, recZ - 0.8), 2.2, 'Talk to the receptionist', `Overview of ${repo.name}`, () => talkTo(receptionist, 'reception'));

  // ---------- boardroom debate ----------
  let debating = false;
  function convene() {
    debating = true;
    const all = [...boardNpcs.values()];
    openBoardroomPanel(ctx, repo, detail, {
      onTurn: (id) => {
        const sp = boardNpcs.get(id);
        if (!sp) return;
        for (const n of all) n.look = n === sp ? angleTo(n.ch.root.position, ctx.player.position) : angleTo(n.ch.root.position, sp.ch.root.position);
      },
      onDelta: (id, text) => { const n = boardNpcs.get(id); if (n) speak(n, text); },
      onMessage: (m: BoardMessage) => {
        const n = boardNpcs.get(m.memberId);
        if (!n) return;
        hush(n, 6000);
        if (m.stance === 'for') gesture(n.ch, 'agree');
        else if (m.stance === 'against') gesture(n.ch, 'headShake');
        // Listeners react to strong positions.
        for (const o of all) if (o !== n && Math.random() < 0.35) gesture(o.ch, m.stance === 'against' ? 'headShake' : 'agree');
      },
      onEnd: () => {
        debating = false;
        for (const n of all) { n.look = null; hush(n, 5000); }
        api.repo(repo.name).then((d) => { detail.decisions = d.decisions; drawDecisions(decC, d.decisions); decT.needsUpdate = true; }).catch(() => {});
      },
    });
  }

  // ---------- live agents ----------
  interface AgentSlot { info: AgentInfo; npc: Npc; slot: (typeof labSlots)[number]; diff: string; recent: string[]; dirty: boolean }
  const agentSlots = new Map<string, AgentSlot>();
  const feed: { who: string; text: string; color: string }[] = [];
  let feedDirty = true;
  const isActive = (a: AgentInfo) => a.status === 'running' || a.status === 'preparing';

  function agentLabel(s: AgentSlot) {
    const a = s.info;
    addLabel(`lbl-a-${a.id}`, new THREE.Vector3(s.npc.ch.root.position.x, 2.12, s.npc.ch.root.position.z),
      `🤖 ${esc(a.name)} <small>${esc(a.status)}</small><br><small>${esc((a.lastAction || a.task).slice(0, 60))}</small>`, { cls: 'agent', maxDist: 16 });
  }

  function upsertAgent(a: AgentInfo) {
    if (a.repo !== repo.name) return;
    const existing = agentSlots.get(a.id);
    if (existing) {
      const was = existing.info.status;
      existing.info = a;
      existing.dirty = true;
      if (was !== a.status) {
        setPose(existing.npc.ch, 'sad', a.status === 'error');
        if (a.status === 'done') gesture(existing.npc.ch, 'agree');
      }
      agentLabel(existing);
      return;
    }
    let slot = labSlots.find((s) => !s.agentId);
    if (!slot) {
      // Evict the oldest finished agent.
      const victim = [...agentSlots.values()].filter((s) => !isActive(s.info)).sort((x, y) => x.info.startedAt.localeCompare(y.info.startedAt))[0];
      if (!victim) return;
      removeAgent(victim.info.id);
      slot = victim.slot;
    }
    slot.agentId = a.id;
    const ch = makeNpc(0xe2e8ef, 0x34e0c8, { glow: true });
    const n = spawnNpc(`a-${a.id}`, 'agent', ch, slot.x, slot.z - 0.78, 0);
    const s: AgentSlot = { info: a, npc: n, slot, diff: '', recent: [], dirty: true };
    agentSlots.set(a.id, s);
    if (a.status === 'error') setPose(ch, 'sad', true);
    agentLabel(s);
    addInteract(`a-${a.id}`, new THREE.Vector3(slot.x, 0, slot.z - 0.78), 2.1, `Watch ${a.name}`, `${a.status} · ${a.task.slice(0, 50)}`, () => openAgentLivePanel(ctx, s.info));
    api.agentLog(a.id).then(({ events }) => { events.forEach((e) => onAgentEvent(a.id, e.event, false)); feedDirty = true; }).catch(() => {});
  }

  function removeAgent(id: string) {
    const s = agentSlots.get(id);
    if (!s) return;
    root.remove(s.npc.ch.root);
    npcs.splice(npcs.indexOf(s.npc), 1);
    ctx.labels.remove(`lbl-a-${id}`);
    ctx.interactions.remove(`a-${id}`);
    s.slot.agentId = null;
    drawIdleMonitor(s.slot.c, 3, 'Free desk — hire an agent');
    s.slot.t.needsUpdate = true;
    agentSlots.delete(id);
  }

  function onAgentEvent(id: string, ev: AgentEvent, live = true) {
    const s = agentSlots.get(id);
    if (!s) return;
    let line = '';
    let color = '#4fd1ff';
    if (ev.kind === 'tool') line = ev.summary || ev.tool;
    else if (ev.kind === 'text') { line = ev.text.split('\n')[0]; color = '#e6edf3'; }
    else if (ev.kind === 'result') { line = `Finished: ${ev.text.split('\n')[0]}`; color = '#3ddc97'; }
    else if (ev.kind === 'status') { line = `Status → ${ev.status}${ev.message ? ` (${ev.message})` : ''}`; color = '#ffcc33'; }
    else if (ev.kind === 'diff') { s.diff = ev.diff; line = `${ev.files.length} files changed`; color = '#a78bfa'; }
    else if (ev.kind === 'tool_result' && ev.isError) { line = `Error: ${ev.summary.slice(0, 80)}`; color = '#ff5d6c'; }
    if (line) {
      s.recent.push(line);
      if (s.recent.length > 30) s.recent.shift();
      feed.push({ who: s.info.name.replace(/^Agent\s+/, ''), text: line, color });
      if (feed.length > 60) feed.shift();
      feedDirty = true;
    }
    s.dirty = true;
    if (live && ev.kind === 'tool' && Math.random() < 0.3) gesture(s.npc.ch, 'agree');
  }

  const initial = new Map<string, AgentInfo>();
  for (const a of detail.agents) initial.set(a.id, a);
  for (const a of ctx.agents.values()) if (a.repo === repo.name) initial.set(a.id, a);
  [...initial.values()].sort((x, y) => y.startedAt.localeCompare(x.startedAt)).slice(0, labSlots.length).reverse().forEach(upsertAgent);

  const offLive = onLive((msg) => {
    if (msg.type === 'agent:update') { if (msg.agent.repo === repo.name) upsertAgent(msg.agent); }
    else if (msg.type === 'agent:event') onAgentEvent(msg.agentId, msg.event);
  });

  // ---------- per-frame ----------
  const prevExposure = ctx.engine.renderer.toneMappingExposure;
  const prevBloom = ctx.engine.bloom.strength;
  let redrawClock = 0;
  const tmp = new THREE.Vector3();

  const interior: Interior = {
    scene,
    repo,
    detail,
    spawn: new THREE.Vector3(0, 0, 2.6),
    spawnFacing: 0,
    world: {
      colliders,
      groundY: () => 0,
      bounds: { minX: -W / 2 + 0.45, maxX: W / 2 - 0.45, minZ: 0.5, maxZ: D - 0.45 },
    },
    update(dt: number) {
      ctx.engine.renderer.toneMappingExposure = 0.78;
      ctx.engine.bloom.strength = 0.16;
      const pp = ctx.player.position;
      for (const n of npcs) {
        const pos = n.ch.root.position;
        const d = tmp.copy(pp).sub(pos).setY(0).length();
        if (d > 45) continue;
        n.ch.mixer.update(dt);
        let want = n.base;
        if (n.look !== null) want = n.look;
        else if (talking === n || (n.turnToPlayer && d < 3.2)) want = angleTo(pos, pp);
        n.ch.root.rotation.y = lerpAngle(n.ch.root.rotation.y, want, Math.min(1, dt * 4));
        n.nextGesture -= dt;
        if (n.nextGesture <= 0) {
          const s = n.kind === 'agent' ? agentSlots.get(n.id.slice(2)) : null;
          if (n.kind === 'agent') { if (s && isActive(s.info)) gesture(n.ch, 'agree'); n.nextGesture = 3 + Math.random() * 3; }
          else if (n.kind === 'board') { if (!debating && Math.random() < 0.3) gesture(n.ch, Math.random() < 0.7 ? 'agree' : 'headShake'); n.nextGesture = 6 + Math.random() * 10; }
          else { if (Math.random() < 0.4) gesture(n.ch, 'agree'); n.nextGesture = 8 + Math.random() * 14; }
        }
      }
      redrawClock -= dt;
      if (redrawClock <= 0) {
        redrawClock = 0.25;
        for (const s of agentSlots.values()) {
          if (!s.dirty) continue;
          s.dirty = false;
          drawAgentMonitor(s.slot.c, s.info, s.diff, s.recent);
          s.slot.t.needsUpdate = true;
        }
        if (feedDirty) {
          feedDirty = false;
          drawFeed(feedC, `${repo.name} — agent activity`, feed);
          feedT.needsUpdate = true;
        }
      }
    },
    dispose() {
      offLive();
      for (const id of interactIds) ctx.interactions.remove(id);
      for (const id of labelIds) ctx.labels.remove(id);
      for (const s of agentSlots.values()) ctx.labels.remove(`lbl-a-${s.info.id}`);
      for (const n of npcs) { ctx.labels.remove(`speech-${n.id}`); n.ch.mixer.stopAllAction(); }
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      envRT.dispose();
      scene.environment = null;
      ctx.engine.renderer.toneMappingExposure = prevExposure;
      ctx.engine.bloom.strength = prevBloom;
    },
  };
  void screens;
  return interior;
}
