import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

interface Template { scene: THREE.Group; clips: THREE.AnimationClip[] }
const templates: Record<'soldier' | 'xbot', Template | null> = { soldier: null, xbot: null };

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
}

export interface Character {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
  /** Crossfade to a named clip (no-op if already playing). */
  play(name: string, fade?: number): void;
  /** One-shot clip that returns to the previous loop (e.g. 'agree', 'headShake'). */
  gesture(name: string): void;
}

function build(t: Template, clipNames: Record<string, string>): Character {
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
    root, mixer, actions, current: '',
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

const npcMatCache = new Map<string, THREE.Material[]>();

/**
 * An NPC (pedestrian, desk worker, agent, board member): Xbot tinted with a body color and joint
 * accent. Clips: idle, walk, run, agree, headShake, sad, sneak.
 */
export function makeNpc(color: THREE.ColorRepresentation = 0x8899aa, accent: THREE.ColorRepresentation = 0x222222, opts: { glow?: boolean } = {}): Character {
  const ch = build(templates.xbot!, { idle: 'idle', walk: 'walk', run: 'run', agree: 'agree', headShake: 'headShake', sad: 'sad_pose', sneak: 'sneak_pose' });
  ch.root.children[0].rotation.y = Math.PI;
  const key = `${new THREE.Color(color).getHexString()}-${new THREE.Color(accent).getHexString()}-${opts.glow ? 1 : 0}`;
  let mats = npcMatCache.get(key);
  if (!mats) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
    const joints = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3 });
    if (opts.glow) { joints.emissive = new THREE.Color(accent); joints.emissiveIntensity = 1.2; }
    mats = [body, joints];
    npcMatCache.set(key, mats);
  }
  ch.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    m.material = /joint/i.test(src.name) ? mats![1] : mats![0];
  });
  ch.play('idle', 0);
  // Desync idle loops so crowds don't move in lockstep.
  ch.mixer.setTime(Math.random() * 3);
  return ch;
}

/** Palette for pedestrians — muted clothing colors. */
export const CLOTHES = [0x2b3a55, 0x6b2e2e, 0x3d5a3d, 0x8a7a5c, 0x1f1f24, 0x5c4b6e, 0xb0a48a, 0x34495e, 0x7f8c8d, 0x9b5d3a, 0x223344, 0xc9c1b3];
