// The city's caretaker robots: white humanoids drawn as one instanced mesh per body part, so a
// whole crowd costs a dozen draw calls. Animated procedurally (walk cycle, idle sway).
import * as THREE from 'three';

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
];

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
}

export class Crowd {
  group = new THREE.Group();
  members: CrowdMember[] = [];
  private meshes: THREE.InstancedMesh[];
  private box: THREE.InstancedMesh;
  private local = PARTS.map(() => new THREE.Matrix4());
  private world = PARTS.map(() => new THREE.Matrix4());
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private sc = new THREE.Vector3();

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
    for (let i = 0; i < count; i++) this.members.push({ pos: new THREE.Vector3(), yaw: 0, speed: 0, scale: 1, visible: false, phase: Math.random() * 10, carry: Math.random() < 0.12 });
  }

  update(dt: number) {
    const rot = (i: number, x: number, y = 0, z = 0) => {
      this.q.setFromEuler(this.e.set(x, y, z));
      this.local[i].compose(PIVOTS[i], this.q, ONE);
    };
    this.members.forEach((c, n) => {
      if (!c.visible) {
        for (const im of this.meshes) im.setMatrixAt(n, this.zero);
        this.box.setMatrixAt(n, this.zero);
        return;
      }
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
      this.q.setFromAxisAngle(UP, c.yaw);
      this.m.compose(c.pos, this.q, this.sc.set(c.scale, c.scale, c.scale));
      for (let i = 0; i < PARTS.length; i++) {
        const p = PARTS[i].parent;
        this.world[i].multiplyMatrices(p < 0 ? this.m : this.world[p], this.local[i]);
        this.meshes[i].setMatrixAt(n, this.world[i]);
      }
      if (c.carry) {
        this.m.copy(this.world[1]).multiply(BOX_OFFSET);
        this.box.setMatrixAt(n, this.m);
      } else this.box.setMatrixAt(n, this.zero);
    });
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
    this.box.instanceMatrix.needsUpdate = true;
  }
}
