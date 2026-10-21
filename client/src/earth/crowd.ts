// The city's caretaker robots: white humanoids drawn as one instanced mesh per body part, so a
// whole crowd costs a couple of dozen draw calls. Animated procedurally: walking, idling, sitting on
// benches, wiping windows, sweeping, carrying packages.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Part {
  name: string;
  geo: THREE.BufferGeometry;
  dark: boolean;
  parent: number; // index into PARTS, -1 = root
  pivot: [number, number, number]; // joint position relative to the parent joint
}

const r = (a: number, b: number, h: number, seg = 8) => new THREE.CylinderGeometry(a, b, h, seg).translate(0, -h / 2, 0);

// Joint hierarchy (meters). Geometry hangs down from each joint, so rotating the joint swings the limb.
const PARTS: Part[] = [
  { name: 'pelvis', geo: new THREE.SphereGeometry(0.15, 10, 6).scale(1.25, 0.75, 0.9), dark: false, parent: -1, pivot: [0, 0.9, 0] },
  { name: 'torso', geo: new THREE.CapsuleGeometry(0.17, 0.3, 4, 10).scale(1.15, 1, 0.8).translate(0, 0.28, 0), dark: false, parent: 0, pivot: [0, 0.08, 0] },
  { name: 'head', geo: new THREE.SphereGeometry(0.15, 12, 9).scale(0.92, 1.12, 1).translate(0, 0.17, 0), dark: false, parent: 1, pivot: [0, 0.58, 0] },
  { name: 'visor', geo: new THREE.SphereGeometry(0.152, 12, 6, -0.9, 1.8, 1.15, 0.6).scale(0.92, 1.12, 1).translate(0, 0.17, 0), dark: true, parent: 1, pivot: [0, 0.58, 0] },
  { name: 'armL', geo: r(0.055, 0.045, 0.28), dark: false, parent: 1, pivot: [0.22, 0.5, 0] },
  { name: 'armR', geo: r(0.055, 0.045, 0.28), dark: false, parent: 1, pivot: [-0.22, 0.5, 0] },
  { name: 'foreL', geo: r(0.045, 0.04, 0.27).translate(0, -0.02, 0), dark: true, parent: 4, pivot: [0, -0.29, 0] },
  { name: 'foreR', geo: r(0.045, 0.04, 0.27).translate(0, -0.02, 0), dark: true, parent: 5, pivot: [0, -0.29, 0] },
  { name: 'thighL', geo: r(0.075, 0.06, 0.4), dark: false, parent: 0, pivot: [0.1, -0.05, 0] },
  { name: 'thighR', geo: r(0.075, 0.06, 0.4), dark: false, parent: 0, pivot: [-0.1, -0.05, 0] },
  { name: 'shinL', geo: r(0.055, 0.045, 0.4).translate(0, -0.01, 0), dark: true, parent: 8, pivot: [0, -0.41, 0] },
  { name: 'shinR', geo: r(0.055, 0.045, 0.4).translate(0, -0.01, 0), dark: true, parent: 9, pivot: [0, -0.41, 0] },
  { name: 'footL', geo: new THREE.BoxGeometry(0.1, 0.06, 0.2).translate(0, -0.03, 0.04), dark: false, parent: 10, pivot: [0, -0.42, 0] },
  { name: 'footR', geo: new THREE.BoxGeometry(0.1, 0.06, 0.2).translate(0, -0.03, 0.04), dark: false, parent: 11, pivot: [0, -0.42, 0] },
  // Ear discs (white rim, dark center), like the game's caretakers.
  { name: 'earL', geo: new THREE.CylinderGeometry(0.075, 0.075, 0.035, 16).rotateZ(Math.PI / 2).translate(0.14, 0.17, 0), dark: false, parent: 2, pivot: [0, 0, 0] },
  { name: 'earR', geo: new THREE.CylinderGeometry(0.075, 0.075, 0.035, 16).rotateZ(Math.PI / 2).translate(-0.14, 0.17, 0), dark: false, parent: 2, pivot: [0, 0, 0] },
  { name: 'earDots', geo: new THREE.CylinderGeometry(0.04, 0.04, 0.32, 12).rotateZ(Math.PI / 2).translate(0, 0.17, 0), dark: true, parent: 2, pivot: [0, 0, 0] },
  // Dark joints at elbows and knees.
  { name: 'elbowL', geo: new THREE.SphereGeometry(0.05, 8, 6), dark: true, parent: 6, pivot: [0, 0, 0] },
  { name: 'elbowR', geo: new THREE.SphereGeometry(0.05, 8, 6), dark: true, parent: 7, pivot: [0, 0, 0] },
  { name: 'kneeL', geo: new THREE.SphereGeometry(0.062, 8, 6), dark: true, parent: 10, pivot: [0, 0, 0] },
  { name: 'kneeR', geo: new THREE.SphereGeometry(0.062, 8, 6), dark: true, parent: 11, pivot: [0, 0, 0] },
];
const EXTRA = PARTS.length;
const BROOM = new THREE.Matrix4().makeRotationX(0.9).setPosition(0, -0.3, 0);

const PIVOTS = PARTS.map((p) => new THREE.Vector3(...p.pivot));
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const BOX_OFFSET = new THREE.Matrix4().makeTranslation(0, 0.3, 0.32);

export interface CrowdMember {
  pos: THREE.Vector3;
  yaw: number;
  speed: number; // m/s (0 = idle)
  scale: number;
  visible: boolean;
  phase: number;
  /** Optional box carried in both hands (delivery robots). */
  carry: boolean;
  /** What the body is doing: walking/idling, sitting on a bench, wiping a window, sweeping. */
  pose: 'stand' | 'sit' | 'clean' | 'sweep';
  /** 0..1 fade for going in and out of doors (scales the robot down to nothing). */
  fade: number;
}

export class Crowd {
  group = new THREE.Group();
  members: CrowdMember[] = [];
  private meshes: THREE.InstancedMesh[];
  private box: THREE.InstancedMesh;
  private broom: THREE.InstancedMesh;
  private local = PARTS.map(() => new THREE.Matrix4());
  private world = PARTS.map(() => new THREE.Matrix4());
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sc = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(count: number) {
    const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.45, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b414a, roughness: 0.5, metalness: 0.2 });
    this.meshes = PARTS.map((p) => {
      const im = new THREE.InstancedMesh(p.geo, p.dark ? dark : white, count);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    });
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
    for (let i = 0; i < count; i++) this.members.push({ pos: new THREE.Vector3(), yaw: 0, speed: 0, scale: 1, visible: false, phase: Math.random() * 10, carry: false, pose: 'stand', fade: 1 });
  }

  update(dt: number) {
    const rot = (i: number, x: number, y = 0, z = 0) => {
      this.q.setFromEuler(this.e.set(x, y, z));
      this.local[i].compose(PIVOTS[i], this.q, ONE);
    };
    // Only robots in view are written, packed at the front, and only those are drawn (hidden ones
    // would still cost vertex work in the main and shadow passes).
    let n = 0, nb = 0, nw = 0;
    for (const c of this.members) {
      if (!c.visible || c.fade <= 0.01) continue;
      const walking = c.speed > 0.2;
      c.phase += dt * (walking ? c.speed * 3.1 : 1.2);
      const s = Math.sin(c.phase), co = Math.cos(c.phase);
      const amp = walking ? Math.min(1, c.speed / 1.4) : 0;
      const bob = walking ? Math.abs(co) * 0.035 : Math.sin(c.phase * 0.5) * 0.008;
      rot(0, 0, walking ? s * 0.08 : 0, 0);
      this.local[0].elements[13] += bob;
      rot(1, walking ? 0.06 : 0, walking ? -s * 0.12 : Math.sin(c.phase * 0.3) * 0.05, 0);
      rot(2, 0, walking ? s * 0.08 : Math.sin(c.phase * 0.21) * 0.25, 0);
      rot(3, 0, walking ? s * 0.08 : Math.sin(c.phase * 0.21) * 0.25, 0);
      const arm = c.carry ? -1.05 : -s * 0.55 * amp;
      rot(4, arm, 0, c.carry ? 0.15 : 0.06);
      rot(5, c.carry ? -1.05 : s * 0.55 * amp, 0, c.carry ? -0.15 : -0.06);
      rot(6, c.carry ? -0.5 : -0.25 - Math.max(0, s) * 0.3 * amp, 0, 0);
      rot(7, c.carry ? -0.5 : -0.25 - Math.max(0, -s) * 0.3 * amp, 0, 0);
      rot(8, s * 0.55 * amp, 0, 0);
      rot(9, -s * 0.55 * amp, 0, 0);
      rot(10, Math.max(0, -co) * 0.85 * amp + 0.02, 0, 0);
      rot(11, Math.max(0, co) * 0.85 * amp + 0.02, 0, 0);
      rot(12, -s * 0.2 * amp, 0, 0);
      rot(13, s * 0.2 * amp, 0, 0);
      for (let i = 14; i < EXTRA; i++) rot(i, 0);
      let drop = 0;
      if (c.pose === 'sit') {
        // On a bench: seat at 0.46 m, thighs forward, shins down, hands on the knees.
        drop = 0.42;
        rot(0, 0); rot(1, -0.05, Math.sin(c.phase * 0.2) * 0.1, 0);
        rot(8, -1.5, 0, 0.06); rot(9, -1.5, 0, -0.06);
        rot(10, 1.5, 0, 0); rot(11, 1.5, 0, 0);
        rot(12, 0); rot(13, 0);
        rot(4, -0.75, 0, 0.1); rot(5, -0.75, 0, -0.1);
        rot(6, -0.55, 0, 0); rot(7, -0.55, 0, 0);
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
        this.meshes[i].setMatrixAt(n, this.world[i]);
      }
      if (c.carry) {
        this.m.copy(this.world[1]).multiply(BOX_OFFSET);
        this.box.setMatrixAt(nb++, this.m);
      }
      if (c.pose === 'sweep') {
        this.m.copy(this.world[7]).multiply(BROOM);
        this.broom.setMatrixAt(nw++, this.m);
      }
      n++;
    }
    for (const im of this.meshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    this.box.count = nb; this.box.instanceMatrix.needsUpdate = true;
    this.broom.count = nw; this.broom.instanceMatrix.needsUpdate = true;
  }
}
