import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The player: your city's executive robot. A glossy white shell head with a visor-screen face, a
// tailored navy two-piece suit (notched lapels, a white shirt, a yellow OpenWorld tie, a pocket square
// and the OpenWorld lapel pin), and polished oxfords with heel thrusters in the soles. Built from
// primitives on a simple joint hierarchy and animated procedurally.

export type RobotState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'fly' | 'land' | 'roll' | 'sit' | 'wave'
  | 'crouch' | 'sprawl'
  | 'skate' | 'bike' | 'drive' | 'pilot' | 'paddle';

export interface Robot {
  root: THREE.Group; // feet at y=0, faces +Z, ~1.6 m tall
  state: RobotState;
  speed: number; // ground speed m/s: drives stride cadence/length for walk/run
  rockets: number; // heel-thruster thrust: 0 off, ~0.2 pilot light, 0.75 burn, up to 1.6 afterburner + ignition
  lean: { x: number; z: number }; // -1..1 lean while flying (x = bank right, z = pitch forward)
  /** Riding inputs: pedal/paddle/push cadence (cycles per second), steering -1..1, airborne 0..1. */
  ride: { cadence: number; steer: number; air: number };
  /** Not riding the skateboard (it's carried out of sight, and appears under your feet to ride). */
  boardOnBack: boolean;
  /** Wingsuit 0..1: arms and legs spread with the navy membranes between them (while flying). */
  wings: number;
  /** Falling speed through the air (m/s): the fall pose goes from flailing to a skydiver's arch. */
  airspeed: number;
  /** Ignition flash 0..1 (decays on its own): a burst of light and fat flames at the feet. */
  flash: number;
  /** Seconds of cut-off sputter left: the flames cough on and off before going out. */
  sputter: number;
  play(state: RobotState): void;
  update(dt: number): void;
  dispose(): void;
}

const KEYS = [
  'bodyY', 'pitch', 'roll', 'hipYaw', 'spineX', 'spineY', 'spineZ', 'neckX', 'headX', 'headY', 'headZ',
  'shLX', 'shLY', 'shLZ', 'elL', 'wrL', 'shRX', 'shRY', 'shRZ', 'elR', 'wrR',
  'thLX', 'thLZ', 'knL', 'anL', 'thRX', 'thRZ', 'knR', 'anR',
] as const;
type Key = (typeof KEYS)[number];
type Pose = Record<Key, number>;
const zero = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;

// About 1.6 m tall to the hat brim, a head roughly a sixth of that, slim limbs in work clothes.
const HIP_Y = 0.81;
/** Hip height of the previous, smaller body; the seated poses below keep their old hip height above the seat. */
const SEAT_DROP = HIP_Y - 0.71;

export function makeRobot(): Robot {
  const mats = {
    // Glazed ceramic: a clear lacquer over the white shell, and a glass visor.
    shell: new THREE.MeshPhysicalMaterial({ color: 0xf1f3f5, roughness: 0.35, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.08 }),
    shellDark: new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.45, metalness: 0.2 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0a1120, roughness: 0.18, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02 }),
    eyeGlow: new THREE.MeshBasicMaterial({ color: 0x8fe0ff, toneMapped: false }),
    // Worsted wool: a soft sheen across the cloth.
    jacket: new THREE.MeshPhysicalMaterial({ color: 0x1c2740, roughness: 0.78, sheen: 1, sheenRoughness: 0.5, sheenColor: 0x3b4a6b }),
    jacketDark: new THREE.MeshStandardMaterial({ color: 0x131b2d, roughness: 0.8 }),
    lapel: new THREE.MeshPhysicalMaterial({ color: 0x151d31, roughness: 0.55, sheen: 1, sheenRoughness: 0.35, sheenColor: 0x56688f }),
    shirt: new THREE.MeshPhysicalMaterial({ color: 0xf6f7f9, roughness: 0.7, sheen: 0.6, sheenColor: 0xffffff }),
    tie: new THREE.MeshPhysicalMaterial({ color: 0xf2bd1c, roughness: 0.45, sheen: 1, sheenRoughness: 0.3, sheenColor: 0xffe28a }),
    pocket: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, sheen: 1, sheenColor: 0xffffff }),
    pants: new THREE.MeshPhysicalMaterial({ color: 0x1c2740, roughness: 0.8, sheen: 1, sheenRoughness: 0.5, sheenColor: 0x3b4a6b }),
    belt: new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.35 }),
    buckle: new THREE.MeshStandardMaterial({ color: 0xd4d7db, roughness: 0.2, metalness: 1 }),
    button: new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.3 }),
    // Polished calf leather.
    boot: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa3abb3, roughness: 0.3, metalness: 0.8 }),
    thruster: new THREE.MeshBasicMaterial({ color: 0x6cc6ff, toneMapped: false }),
    logo: new THREE.MeshStandardMaterial({ map: logoTexture(), roughness: 0.55, transparent: true }),
  };
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => { geos.push(x); return x; };

  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const joint = (parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  /** Cylinder hanging down from the joint (top at 0, bottom at -len). */
  const limb = (r0: number, r1: number, len: number, seg = 12) => g(new THREE.CylinderGeometry(r0, r1, len, seg).translate(0, -len / 2, 0));
  const sphere = (r: number, w = 14, h = 10) => g(new THREE.SphereGeometry(r, w, h));

  const root = new THREE.Group();
  root.name = 'robot';
  const hips = joint(root, 0, HIP_Y, 0);

  // ---- Pelvis: suit trousers and a slim leather belt (mostly under the jacket) ----
  part(g(new THREE.CylinderGeometry(0.14, 0.152, 0.16, 20).scale(1, 1, 0.7)), mats.pants, hips, 0, -0.07, 0);
  part(g(new THREE.CylinderGeometry(0.163, 0.163, 0.03, 24).scale(1, 1, 0.71)), mats.belt, hips, 0, -0.025, 0);
  part(g(new RoundedBoxGeometry(0.04, 0.028, 0.012, 2, 0.004)), mats.buckle, hips, 0, -0.025, 0.117);

  // ---- Torso: a tailored suit jacket with notched lapels, open over a white shirt and a tie ----
  const spine = joint(hips, 0, 0.05, 0);
  const torsoGeo = g(new RoundedBoxGeometry(0.33, 0.5, 0.23, 4, 0.07));
  {
    // Broader at the shoulders, a little chest at the front.
    const p = torsoGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      p.setX(i, p.getX(i) * (1 + 0.1 * y / 0.25));
      if (z > 0) p.setZ(i, z * (1 + 0.07 * Math.exp(-(((y - 0.1) / 0.1) ** 2))));
    }
    torsoGeo.computeVertexNormals();
  }
  part(torsoGeo, mats.jacket, spine, 0, 0.13, 0);
  /**
   * A flat piece laid on the jacket front (lapels, the shirt, the tie): an outline in spine space,
   * each corner pushed onto the jacket's front, which bulges at the chest and rounds back at the top.
   */
  const TOP = 0.38, RAD = 0.07, FRONT = 0.115;
  const frontZ = (y: number) => {
    const dy = y - (TOP - RAD);
    const recess = dy > 0 ? RAD - Math.sqrt(Math.max(0, RAD * RAD - dy * dy)) : 0;
    return FRONT * (1 + 0.07 * Math.exp(-(((y - 0.23) / 0.1) ** 2))) - recess;
  };
  const onChest = (pts: [number, number][], off: number, mat: THREE.Material, thick = 0.004) => {
    const geo = g(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: thick, bevelEnabled: false }));
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, frontZ(p.getY(i)) + off + p.getZ(i) - thick);
    geo.computeVertexNormals();
    return part(geo, mat, spine);
  };
  const V_TOP = 0.375, V_BOT = 0.12;
  onChest([[-0.05, V_TOP], [0.05, V_TOP], [0, V_BOT - 0.01]], 0.002, mats.shirt); // the shirt in the V
  // The tie: a knot under the collar and a blade down to the button.
  onChest([[-0.02, V_TOP + 0.002], [0.02, V_TOP + 0.002], [0.013, V_TOP - 0.032], [-0.013, V_TOP - 0.032]], 0.008, mats.tie, 0.012);
  onChest([[-0.012, V_TOP - 0.03], [0.012, V_TOP - 0.03], [0.034, V_BOT + 0.05], [0, V_BOT + 0.02], [-0.034, V_BOT + 0.05]], 0.006, mats.tie);
  // Notched lapels, wide over the chest, meeting at the button.
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [[0.05, V_TOP], [0.078, V_TOP + 0.004], [0.092, 0.33], [0.079, 0.317], [0.113, 0.295], [0.014, V_BOT], [0.002, V_BOT]];
    onChest(pts.map(([x, y]) => [x * s, y]), 0.007, mats.lapel, 0.006);
  }
  for (const y of [V_BOT - 0.012, V_BOT - 0.09]) part(g(new THREE.CylinderGeometry(0.009, 0.009, 0.005, 12).rotateX(Math.PI / 2)), mats.button, spine, 0.003, y, frontZ(y) + 0.006);
  // Breast pocket with a white pocket square, the OpenWorld pin on the left lapel, flap pockets.
  onChest([[0.05, 0.255], [0.115, 0.26], [0.115, 0.25], [0.05, 0.245]], 0.004, mats.jacketDark, 0.002);
  onChest([[0.056, 0.256], [0.068, 0.284], [0.08, 0.266], [0.092, 0.288], [0.106, 0.258]], 0.006, mats.pocket);
  part(g(new THREE.CircleGeometry(0.012, 18)), mats.logo, spine, 0.088, 0.325, frontZ(0.325) + 0.016);
  for (const s of [-1, 1]) part(g(new RoundedBoxGeometry(0.095, 0.028, 0.012, 2, 0.004)), mats.jacketDark, spine, s * 0.095, -0.05, FRONT + 0.003);
  // Shirt collar round the neck, its points folded down over the tie knot.
  part(g(new THREE.CylinderGeometry(0.058, 0.064, 0.06, 20, 1, true).scale(1, 1, 0.9)), mats.shirt, spine, 0, 0.405, -0.01);
  for (const s of [-1, 1]) onChest([[0.008 * s, V_TOP + 0.012], [0.05 * s, V_TOP + 0.03], [0.046 * s, V_TOP - 0.03]], 0.014, mats.shirt, 0.003);
  // The jacket's skirt: it hangs over the seat of the trousers.
  part(g(new THREE.CylinderGeometry(0.168, 0.176, 0.13, 24, 1, true).scale(1, 1, 0.74)), mats.jacket, hips, 0, -0.09, 0);

  // ---- Back: no pack, the heel thrusters do the flying (a hidden mount keeps the old riding API) ----
  const board = joint(spine, 0, 0, 0);
  board.visible = false;

  // ---- Neck + head: a glossy white shell head with a dark glass visor for a face ----
  const neck = joint(spine, 0, 0.43, 0.0);
  part(limb(0.034, 0.04, 0.11).translate(0, 0.11, 0), mats.dark, neck);
  for (const y of [0.03, 0.065]) part(limb(0.042, 0.042, 0.01).translate(0, y, 0), mats.shellDark, neck); // segment rings
  const head = joint(neck, 0, 0.1, 0.012);
  head.scale.setScalar(1.18); // a big, friendly head reads from behind at the follow camera
  part(g(new RoundedBoxGeometry(0.235, 0.215, 0.225, 5, 0.08)), mats.shell, head, 0, 0.125, 0);
  part(g(new RoundedBoxGeometry(0.2, 0.115, 0.03, 3, 0.028)), mats.visor, head, 0, 0.115, 0.1);
  for (const s of [-1, 1]) for (const dy of [-0.02, 0.02]) part(g(new THREE.BoxGeometry(0.01, 0.012, 0.07)), mats.shellDark, head, s * 0.118, 0.12 + dy, -0.01); // side vents
  // Eyes on the visor: rounded bars that blink, widen in a fast fall and turn into ^ ^ on a wave.
  const eyeOpen = g(new THREE.CapsuleGeometry(0.011, 0.028, 3, 8));
  const eyeHappy = g(new THREE.TorusGeometry(0.019, 0.0065, 6, 12, Math.PI));
  const eyes: { open: THREE.Mesh; happy: THREE.Mesh }[] = [-1, 1].map((s) => ({
    open: part(eyeOpen, mats.eyeGlow, head, s * 0.045, 0.118, 0.117),
    happy: part(eyeHappy, mats.eyeGlow, head, s * 0.045, 0.108, 0.117),
  }));
  for (const e of eyes) { e.open.castShadow = e.happy.castShadow = false; e.happy.visible = false; }

  // ---- Arms: suit sleeves with a white shirt cuff showing, and white shell hands ----
  type Arm = { sh: THREE.Group; el: THREE.Group; wr: THREE.Group };
  const arm = (s: number): Arm => {
    const sh = joint(spine, s * 0.168, 0.355, -0.005);
    part(sphere(0.06, 18, 12).scale(1, 0.72, 0.95), mats.jacket, sh, 0, 0.0, 0); // padded shoulder
    part(limb(0.058, 0.053, 0.26, 16), mats.jacket, sh);
    const el = joint(sh, 0, -0.26, 0);
    part(sphere(0.052, 16, 10), mats.jacket, el);
    part(limb(0.052, 0.047, 0.205, 16), mats.jacket, el);
    for (let b = 0; b < 3; b++) part(sphere(0.005, 6, 4), mats.button, el, s * 0.012, -0.17 - b * 0.012, -0.044); // sleeve buttons
    part(limb(0.042, 0.042, 0.03, 14), mats.shirt, el, 0, -0.2, 0); // shirt cuff
    const wr = joint(el, 0, -0.26, 0);
    part(limb(0.034, 0.034, 0.03).translate(0, 0.02, 0), mats.dark, wr);
    part(g(new RoundedBoxGeometry(0.04, 0.075, 0.07, 2, 0.015)), mats.shell, wr, 0, -0.045, 0);
    for (let f = 0; f < 4; f++) {
      const z = -0.024 + f * 0.016;
      part(limb(0.0085, 0.008, 0.028, 6), mats.shell, wr, 0, -0.082, z);
      part(sphere(0.0085, 6, 4), mats.dark, wr, 0, -0.11, z);
      part(limb(0.0078, 0.007, 0.026, 6), mats.shell, wr, 0, -0.112, z);
    }
    part(limb(0.011, 0.009, 0.045, 6), mats.shell, wr, s * -0.014, -0.03, 0.036, -0.5, 0, s * 0.5);
    return { sh, el, wr };
  };
  const armL = arm(1), armR = arm(-1);

  // ---- Legs: suit trousers with pressed creases, polished oxfords with heel thrusters ----
  type Leg = { th: THREE.Group; kn: THREE.Group; an: THREE.Group; flame: THREE.Group };
  const flameOuterMat = new THREE.MeshBasicMaterial({ color: 0x4fb4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  // Wide at the sole, tip trailing 1 m (scaled) below it.
  const flameOuterGeo = g(new THREE.ConeGeometry(0.055, 1, 12, 1, true).rotateX(Math.PI).translate(0, -0.5, 0));
  const flameInnerGeo = g(new THREE.ConeGeometry(0.03, 0.6, 10, 1, true).rotateX(Math.PI).translate(0, -0.3, 0));
  // Afterburner plume: a wide, faint sheath that only shows on a hard burn.
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0x3d6dff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const plumeGeo = g(new THREE.ConeGeometry(0.09, 1, 14, 1, true).rotateX(Math.PI).translate(0, -0.5, 0));
  const leg = (s: number): Leg => {
    const th = joint(hips, s * 0.085, -0.04, 0);
    part(limb(0.088, 0.078, 0.36, 18), mats.pants, th, 0, 0.02, 0);
    part(g(new THREE.BoxGeometry(0.006, 0.34, 0.004)), mats.jacketDark, th, 0, -0.15, 0.082); // crease
    const kn = joint(th, 0, -0.34, 0);
    part(sphere(0.07, 16, 10), mats.pants, kn);
    part(limb(0.074, 0.07, 0.33, 18), mats.pants, kn, 0, -0.01, 0); // a straight leg breaking over the shoe
    part(g(new THREE.BoxGeometry(0.006, 0.3, 0.004)), mats.jacketDark, kn, 0, -0.17, 0.073);
    const an = joint(kn, 0, -0.34, 0);
    part(sphere(0.045, 10, 8), mats.boot, an);
    // Oxford, toe toward +Z: a sleek polished upper with a toe cap, a leather sole and the heel thruster.
    part(limb(0.052, 0.056, 0.05, 16), mats.boot, an, 0, 0.0, 0);
    part(g(new THREE.CapsuleGeometry(0.056, 0.17, 4, 16).rotateX(Math.PI / 2).scale(1, 0.72, 1)), mats.boot, an, 0, -0.045, 0.045);
    part(g(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.7, 1.1)), mats.boot, an, 0, -0.055, 0.12); // toe cap
    part(g(new RoundedBoxGeometry(0.118, 0.022, 0.29, 2, 0.008)), mats.sole, an, 0, -0.081, 0.045);
    part(g(new THREE.TorusGeometry(0.034, 0.01, 8, 18)), mats.metal, an, 0, -0.092, 0, Math.PI / 2, 0, 0);
    part(g(new THREE.CircleGeometry(0.026, 16)), mats.thruster, an, 0, -0.094, 0, Math.PI / 2, 0, 0);
    const flame = joint(an, 0, -0.088, 0.0);
    const outer = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    const inner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    flame.add(outer, inner, new THREE.Mesh(plumeGeo, plumeMat));
    flame.visible = false;
    return { th, kn, an, flame };
  };
  const legL = leg(1), legR = leg(-1);

  const glow = new THREE.PointLight(0x7cc4ff, 0, 5, 2);
  glow.castShadow = false;
  glow.position.set(0, 0.05, 0);
  root.add(glow);
  const exhaust = makeExhaust();

  // Wingsuit membranes: arm wings (shoulder–wrist–knee–hip) and a tail wing between the legs. Their
  // corners follow the joints every frame, so they stretch and fold with the pose.
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.75, side: THREE.DoubleSide });
  const wingGeo = g(new THREE.BufferGeometry());
  const WING_TRIS = 7;
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WING_TRIS * 9), 3));
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.castShadow = true;
  wing.frustumCulled = false;
  wing.visible = false;
  root.add(wing);
  const wp = Array.from({ length: 9 }, () => new THREE.Vector3());
  const hipSide = [joint(hips, 0.13, 0.02, -0.02), joint(hips, -0.13, 0.02, -0.02)];
  const crotch = joint(hips, 0, -0.08, -0.02);
  const updateWings = () => {
    root.updateMatrixWorld(true);
    const at = (o: THREE.Object3D, v: THREE.Vector3) => root.worldToLocal(o.getWorldPosition(v));
    const [shL, wrL, knL, anL, shR, wrR, knR, anR, cr] = wp;
    at(armL.sh, shL); at(armL.wr, wrL); at(legL.kn, knL); at(legL.an, anL);
    at(armR.sh, shR); at(armR.wr, wrR); at(legR.kn, knR); at(legR.an, anR); at(crotch, cr);
    const hl = at(hipSide[0], new THREE.Vector3()), hr = at(hipSide[1], new THREE.Vector3());
    const tris = [shL, wrL, knL, shL, knL, hl, shR, knR, wrR, shR, hr, knR, cr, anL, knL, cr, anR, anL, cr, knR, anR];
    const a = wingGeo.attributes.position as THREE.BufferAttribute;
    tris.forEach((v, i) => a.setXYZ(i, v.x, v.y, v.z));
    a.needsUpdate = true;
    wingGeo.computeVertexNormals();
  };

  // ---------------------------------------------------------------------------------------------
  // Animation

  let time = 0;
  let phase = 0; // gait phase (radians)
  let stateT = 0; // time in the current state
  let blendT = 1;
  let from = zero();
  let out = zero();
  const sl = { x: 0, z: 0 };

  const robot: Robot = {
    root, state: 'idle', speed: 0, rockets: 0, lean: { x: 0, z: 0 },
    ride: { cadence: 0, steer: 0, air: 0 }, boardOnBack: true, wings: 0, airspeed: 0, flash: 0, sputter: 0,
    play(state) {
      if (state === robot.state && state !== 'land' && state !== 'wave') return;
      if (state === robot.state) { stateT = 0; return; }
      from = { ...out };
      blendT = 0;
      stateT = 0;
      robot.state = state;
    },
    update(dt) {
      time += dt;
      stateT += dt;
      blendT += dt;
      const sp = Math.max(0, robot.speed);
      const step = Math.min(1.85, 0.56 + 0.18 * sp); // stride length (m)
      if (robot.state === 'walk' || robot.state === 'run') phase += (Math.PI * sp / step) * dt;
      else phase += Math.PI * 2 * robot.ride.cadence * dt;
      sl.x = THREE.MathUtils.damp(sl.x, THREE.MathUtils.clamp(robot.lean.x, -1, 1), 5, dt);
      sl.z = THREE.MathUtils.damp(sl.z, THREE.MathUtils.clamp(robot.lean.z, -1, 1), 5, dt);

      // One-shots return to the ground loop.
      if ((robot.state === 'land' && stateT > 0.35) || (robot.state === 'roll' && stateT > 0.7) || (robot.state === 'sprawl' && stateT > SPRAWL_T)) robot.play(sp > 3.6 ? 'run' : sp > 0.4 ? 'walk' : 'idle');
      if (robot.state === 'wave' && stateT > 1.8) robot.play(sp > 0.4 ? 'walk' : 'idle');

      const target = pose(robot.state, time, stateT, phase, sp, sl, robot.ride, robot.state === 'fly' || robot.state === 'fall' ? robot.wings : 0, robot.airspeed);
      const w = blendT >= 0.2 ? 1 : smooth(blendT / 0.2);
      for (const k of KEYS) out[k] = from[k] + (target[k] - from[k]) * w;
      apply(out);
      // Face: a blink every few seconds, wide eyes in a fast fall, ^ ^ while waving.
      const happy = robot.state === 'wave';
      const blink = (time % 3.7) < 0.12 ? 0.15 : 1;
      const wide = 1 + 0.45 * THREE.MathUtils.clamp((robot.airspeed - 18) / 30, 0, 1);
      for (const e of eyes) {
        e.open.visible = !happy;
        e.happy.visible = happy;
        e.open.scale.set(wide, blink * wide, 1);
      }
      wing.visible = robot.wings > 0.25 && (robot.state === 'fly' || robot.state === 'fall');
      if (wing.visible) updateWings();

      // Rocket flames: short and blue-white on a pilot light, a long roaring jet on a burn,
      // a wide plume on the afterburner. Exhaust streams out behind in world space.
      robot.flash = Math.max(0, robot.flash - dt * 3.2);
      robot.sputter = Math.max(0, robot.sputter - dt);
      // Cut-off: the jet coughs out (on/off in ~60 ms beats) instead of just shrinking away.
      const cough = robot.sputter > 0 ? (Math.sin(time * 97) * Math.sin(time * 41) > 0.1 ? 0.55 * Math.min(1, robot.sputter * 3) : 0) : 0;
      const r = Math.max(THREE.MathUtils.clamp(robot.rockets, 0, 1.6), cough) + robot.flash * 0.9;
      const hot = THREE.MathUtils.clamp(r - 0.9, 0, 0.7) / 0.7;
      for (const l of [legL, legR]) {
        l.flame.visible = r > 0.02;
        if (!l.flame.visible) continue;
        const flick = 0.82 + 0.36 * Math.sin(time * 47 + (l === legL ? 0 : 2)) * Math.sin(time * 31);
        const len = (0.2 + 0.95 * r) * flick;
        const fat = 0.75 + 0.55 * Math.min(r, 1.2) + robot.flash * 1.4;
        l.flame.scale.set(fat, len, fat);
      }
      flameOuterMat.opacity = 0.45 + 0.45 * Math.min(r, 1);
      flameOuterMat.color.setRGB(0.28 + 0.4 * (1 - Math.min(1, r * 2)) + 0.25 * hot, 0.62 + 0.2 * hot, 1);
      plumeMat.opacity = 0.35 * hot * (0.8 + 0.2 * Math.sin(time * 53));
      glow.intensity = r * 6 * (0.85 + 0.15 * Math.sin(time * 40)) + robot.flash * 60;
      glow.distance = 5 + robot.flash * 14;
      const scene = root.parent;
      if (scene && exhaust.group.parent !== scene) scene.add(exhaust.group);
      exhaust.update(time, dt, r, [legL.flame, legR.flame]);
    },
    dispose() {
      geos.forEach((x) => x.dispose());
      mats.logo.map?.dispose();
      Object.values(mats).forEach((m) => m.dispose());
      flameOuterMat.dispose(); flameInnerMat.dispose(); plumeMat.dispose(); wingMat.dispose();
      exhaust.dispose();
      glow.dispose();
    },
  };

  function apply(p: Pose) {
    hips.position.y = HIP_Y + p.bodyY;
    hips.rotation.set(p.pitch, p.hipYaw, p.roll, 'YXZ');
    spine.rotation.set(p.spineX, p.spineY, p.spineZ);
    neck.rotation.x = p.neckX;
    head.rotation.set(p.headX, p.headY, p.headZ);
    armL.sh.rotation.set(p.shLX, p.shLY, p.shLZ, 'ZXY');
    armR.sh.rotation.set(p.shRX, p.shRY, p.shRZ, 'ZXY');
    armL.el.rotation.x = p.elL; armR.el.rotation.x = p.elR;
    armL.wr.rotation.x = p.wrL; armR.wr.rotation.x = p.wrR;
    legL.th.rotation.set(p.thLX, 0, p.thLZ); legR.th.rotation.set(p.thRX, 0, p.thRZ);
    legL.kn.rotation.x = p.knL; legR.kn.rotation.x = p.knR;
    legL.an.rotation.x = p.anL; legR.an.rotation.x = p.anR;
  }

  apply(pose('idle', 0, 0, 0, 0, sl, robot.ride));
  out = pose('idle', 0, 0, 0, 0, sl, robot.ride);
  from = { ...out };
  return robot;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** How long a sprawl (face-down after a too-fast landing) lasts before you're back up. */
export const SPRAWL_T = 1.9;

/**
 * Joint angles for a state. Conventions: rotation.x < 0 swings a limb forward (+Z); a positive knee
 * angle folds the shin back; a positive ankle angle points the toe down; positive spineX leans forward;
 * shoulder Z > 0 raises the left arm out to the side (mirrored for the right).
 */
function pose(state: RobotState, t: number, st: number, ph: number, sp: number, lean: { x: number; z: number }, ride: { cadence: number; steer: number; air: number }, wings = 0, air = 0): Pose {
  const p = basePose(wings > 0 && state === 'fall' ? 'fly' : state, t, st, ph, sp, lean, ride, air);
  if (wings <= 0) return p;
  // Wingsuit: flat to the wind, arms out to the sides, legs apart, banking with the turn.
  const w = smooth(Math.min(1, wings));
  const mix = (k: Key, v: number) => { p[k] += (v - p[k]) * w; };
  mix('pitch', 1.45 + lean.z * 0.05); mix('roll', -lean.x * 0.6); mix('headX', -1.2); mix('spineX', -0.05);
  mix('shLX', 0.35); mix('shRX', 0.35); mix('shLZ', 1.35 + lean.x * 0.12); mix('shRZ', -1.35 + lean.x * 0.12);
  mix('elL', -0.08); mix('elR', -0.08); mix('wrL', 0); mix('wrR', 0);
  mix('thLX', 0.06); mix('thRX', 0.06); mix('thLZ', 0.3); mix('thRZ', -0.3);
  mix('knL', 0.05); mix('knR', 0.05); mix('anL', 0.75); mix('anR', 0.75);
  return p;
}

function basePose(state: RobotState, t: number, st: number, ph: number, sp: number, lean: { x: number; z: number }, ride: { cadence: number; steer: number; air: number }, air = 0): Pose {
  const p = zero();
  // Arms rest slightly away from the body, elbows soft.
  p.shLZ = 0.09; p.shRZ = -0.09; p.elL = p.elR = -0.18;
  switch (state) {
    case 'idle': {
      const b = Math.sin(t * 1.9);
      p.spineX = 0.015 * b; p.bodyY = -0.004 + 0.004 * b;
      p.shLZ = 0.1 + 0.015 * b; p.shRZ = -0.1 - 0.015 * b;
      // Look around now and then.
      p.headY = 0.35 * Math.sin(t * 0.37) * Math.max(0, Math.sin(t * 0.21));
      p.headX = 0.05 * Math.sin(t * 0.53); p.headZ = 0.04 * Math.sin(t * 0.29);
      p.knL = p.knR = 0.04; p.thLX = p.thRX = -0.02;
      break;
    }
    case 'walk':
    case 'run': {
      // One gait blended by speed: a walk below ~1.8 m/s, the easy jog at 3.2, a full sprint by 6.5.
      const g = THREE.MathUtils.clamp((sp - 1.8) / 4.7, 0, 1) * (state === 'run' ? 1 : 0.85);
      const amp = THREE.MathUtils.clamp(sp / 1.6, 0.45, 1);
      const L = (a: number, b: number) => a + (b - a) * g;
      const s = Math.sin(ph), c = Math.cos(ph);
      const stride = L(0.4, 0.82);
      p.thLX = -stride * s * amp; p.thRX = stride * s * amp;
      // The knee folds as the leg swings through, high behind you at a sprint.
      const kneeAmp = L(0.75, 1.7);
      const bend = L(0.06, 0.28);
      p.knL = 0.06 + kneeAmp * amp * Math.max(0, c) ** 1.3 + bend;
      p.knR = 0.06 + kneeAmp * amp * Math.max(0, -c) ** 1.3 + bend;
      p.anL = -0.15 * s * amp - L(0.2, 0.35) * Math.max(0, c); p.anR = 0.15 * s * amp - L(0.2, 0.35) * Math.max(0, -c);
      // Arms pump with bent elbows once it's a jog.
      const armAmp = L(0.38, 0.95) * amp;
      p.shLX = armAmp * s; p.shRX = -armAmp * s;
      p.elL = p.elR = L(-0.25, -1.45);
      p.elL -= L(0.15, 0.3) * Math.max(0, -s);
      p.elR -= L(0.15, 0.3) * Math.max(0, s);
      p.shLZ = L(0.08, 0.16); p.shRZ = -p.shLZ;
      p.bodyY = L(0.016, 0.05) * Math.cos(2 * ph) * amp - L(0.01, 0.06);
      p.hipYaw = L(0.08, 0.13) * s * amp;
      p.spineY = -p.hipYaw * 1.3;
      p.spineX = L(0.04, 0.2);
      p.pitch = L(0.0, 0.08);
      p.headX = -p.spineX * 0.7;
      // Lean into turns (lean.x from the turn rate), more the faster you go.
      p.roll = L(0.02, 0.03) * s - lean.x * L(0.12, 0.3);
      p.spineZ = lean.x * 0.08;
      break;
    }
    case 'jump': {
      p.thLX = -0.9; p.thRX = -0.6; p.knL = 1.35; p.knR = 1.0; p.anL = p.anR = 0.4;
      p.shLX = -0.7; p.shRX = -0.5; p.shLZ = 0.5; p.shRZ = -0.5; p.elL = p.elR = -0.8;
      p.spineX = 0.15; p.headX = -0.1;
      break;
    }
    case 'fall': {
      // Three falls blended by airspeed: off a curb (still the jump tuck), a flailing drop (arms
      // windmilling), and at skydiving speed a stable belly arch, limbs spread and fluttering in the
      // wind. lean.z > 0 tucks into a head-down dive; lean.x banks the arch to steer.
      const settle = smooth(Math.min(1, st / 0.45));
      const k = THREE.MathUtils.clamp((air - 9) / 26, 0, 1);
      const arch = smooth(k);
      const flail = settle * (1 - arch);
      const f = Math.sin(t * 9), f2 = Math.sin(t * 7.3 + 1);
      const flut = (a: number, b: number) => (0.04 + 0.1 * arch) * Math.sin(t * a + b) * Math.sin(t * (a * 0.61) + b * 2);
      // Short drop: the jump tuck.
      const tuck = 1 - settle;
      p.thLX = -0.9 * tuck; p.thRX = -0.6 * tuck; p.knL = 1.35 * tuck; p.knR = 1.0 * tuck; p.anL = p.anR = 0.4 * tuck;
      p.shLX = -0.7 * tuck; p.shRX = -0.5 * tuck; p.shLZ = 0.5 * tuck; p.shRZ = -0.5 * tuck; p.elL = p.elR = -0.8 * tuck;
      p.spineX = 0.15 * tuck; p.headX = -0.1 * tuck;
      // Flailing.
      p.shLZ += flail * (2.3 + 0.25 * f); p.shRZ += flail * (-2.3 + 0.25 * f2);
      p.shLX += flail * (-0.2 + 0.2 * f2); p.shRX += flail * (-0.2 + 0.2 * f);
      p.elL += flail * (-0.4 + 0.2 * f); p.elR += flail * (-0.4 + 0.2 * f2);
      p.thLX += flail * (-0.35 + 0.35 * f); p.thRX += flail * (-0.2 - 0.35 * f); p.knL += flail * (0.6 + 0.3 * f2); p.knR += flail * (0.7 - 0.3 * f);
      p.spineX += flail * -0.1; p.headX += flail * 0.15;
      // Belly arch, face to the ground, head up; or (lean.z) tucked head-down.
      const dive = THREE.MathUtils.clamp(lean.z, 0, 1) * arch;
      const belly = arch * (1 - dive);
      const a = settle * belly;
      p.pitch += a * 1.45 + dive * 2.55;
      p.roll += -lean.x * 0.5 * arch;
      p.spineX += a * -0.32 + dive * 0.05; p.neckX += a * -0.35; p.headX += a * -0.75 + dive * -0.3;
      p.shLZ += a * (1.55 + flut(13, 0)); p.shRZ += a * (-1.55 + flut(12, 1));
      p.shLX += a * (0.55 + flut(17, 2)); p.shRX += a * (0.55 + flut(15, 3));
      p.elL += a * (-1.1 + flut(19, 4)); p.elR += a * (-1.1 + flut(18, 5));
      p.thLZ += a * 0.32; p.thRZ += a * -0.32;
      p.thLX += a * (0.25 + flut(11, 6)); p.thRX += a * (0.25 + flut(10, 7));
      p.knL += a * (1.0 + flut(14, 8)); p.knR += a * (1.0 + flut(16, 9)); p.anL += a * 0.5; p.anR += a * 0.5;
      // Head-down dive: arms swept back along the body, legs together and straight.
      p.shLX += dive * 0.6; p.shRX += dive * 0.6; p.shLZ += dive * 0.25; p.shRZ += dive * -0.25;
      p.elL += dive * -0.1; p.elR += dive * -0.1; p.anL += dive * 0.7; p.anR += dive * 0.7;
      p.wrL = p.wrR = 0.3 * arch;
      p.headY = flut(9, 10) * arch; p.headZ = flut(8, 11) * arch * 0.6;
      break;
    }
    case 'crouch': {
      // Anticipation before a launch or a big jump: sink, arms swing back, chin down.
      const k = smooth(Math.min(1, st / 0.16));
      p.bodyY = -0.24 * k; p.thLX = p.thRX = -1.05 * k; p.knL = p.knR = 1.85 * k; p.anL = p.anR = -0.78 * k;
      p.spineX = 0.5 * k; p.headX = -0.25 * k;
      p.shLX = p.shRX = 0.95 * k; p.shLZ = 0.22; p.shRZ = -0.22; p.elL = p.elR = -0.35;
      p.thLZ = 0.06 * k; p.thRZ = -0.06 * k;
      break;
    }
    case 'sprawl': {
      // Came in far too fast: pitch forward onto the ground, lie there a beat, push back up.
      const down = smooth(Math.min(1, st / 0.28));
      const up = smooth(THREE.MathUtils.clamp((st - 0.95) / (SPRAWL_T - 0.95), 0, 1));
      const flat = down * (1 - up);
      const kneel = Math.sin(Math.PI * up); // hands and knees on the way up
      p.pitch = 1.42 * flat + 0.5 * kneel;
      p.bodyY = -(HIP_Y - 0.14) * flat - 0.42 * kneel;
      p.shLX = p.shRX = -1.55 * flat - 1.0 * kneel; p.shLZ = 0.35 + 0.25 * flat; p.shRZ = -0.35 - 0.25 * flat;
      p.elL = p.elR = -0.5 * flat - 0.3 * kneel;
      p.thLX = p.thRX = 0.12 * flat - 1.1 * kneel; p.knL = p.knR = 0.15 * flat + 1.5 * kneel;
      p.anL = p.anR = 0.6 * flat;
      p.thLZ = 0.15 * flat; p.thRZ = -0.15 * flat;
      p.headX = -0.6 * flat; p.headY = 0.4 * flat * Math.sin(Math.min(1, st / 0.9) * Math.PI);
      break;
    }
    case 'fly': {
      // lean.z 0 = upright on a vertical burn, 1 = flat out like a superhero, arms swept back.
      const hover = 1 - Math.abs(lean.z);
      const fast = Math.abs(lean.z);
      const bob = Math.sin(t * 2.4);
      const buffet = 0.03 * fast * Math.sin(t * 17) * Math.sin(t * 7.3);
      p.pitch = lean.z * 1.4 + buffet;
      p.roll = -lean.x * 0.75;
      p.headX = -lean.z * 1.1; // keep looking where we're going
      p.spineX = 0.05 - 0.1 * fast;
      p.shLX = 0.55 + 0.1 * bob * hover + 0.75 * fast; p.shRX = 0.55 - 0.1 * bob * hover + 0.75 * fast;
      p.shLZ = 0.4 - 0.25 * fast + lean.x * 0.15; p.shRZ = -0.4 + 0.25 * fast + lean.x * 0.15;
      p.elL = p.elR = -0.25 + 0.2 * fast; p.wrL = p.wrR = 0.3;
      p.thLX = 0.05 + 0.08 * bob * hover + 0.1 * fast; p.thRX = 0.02 - 0.08 * bob * hover + 0.06 * fast;
      p.thLZ = -0.03 + 0.02 * fast; p.thRZ = 0.03 - 0.02 * fast;
      p.knL = 0.18 + 0.12 * hover; p.knR = 0.22 + 0.1 * hover + 0.08 * fast;
      p.anL = p.anR = 0.55 + 0.25 * fast;
      p.bodyY = 0.02 * bob * hover;
      break;
    }
    case 'roll': {
      // Tuck and roll forward once over 0.7 s, then come up running.
      const k = Math.min(1, st / 0.7);
      const tuck = Math.sin(k * Math.PI);
      p.pitch = smooth(k) * Math.PI * 2;
      p.bodyY = -0.35 * tuck;
      p.spineX = 0.6 * tuck; p.neckX = 0.4 * tuck; p.headX = 0.3 * tuck;
      p.thLX = p.thRX = -1.6 * tuck; p.knL = p.knR = 2.1 * tuck; p.anL = p.anR = -0.3 * tuck;
      p.shLX = p.shRX = -1.0 * tuck; p.elL = p.elR = -1.2 * tuck; p.shLZ = 0.25; p.shRZ = -0.25;
      break;
    }
    case 'land': {
      const k = Math.sin(Math.min(1, st / 0.35) * Math.PI);
      p.bodyY = -0.2 * k; p.thLX = p.thRX = -0.85 * k; p.knL = p.knR = 1.45 * k; p.anL = p.anR = -0.55 * k;
      p.spineX = 0.35 * k; p.shLX = p.shRX = -0.5 * k; p.shLZ = 0.35; p.shRZ = -0.35; p.elL = p.elR = -0.6;
      break;
    }
    case 'sit': {
      // Sitting on the ground, knees up, hands resting on them.
      p.bodyY = 0.16 - HIP_Y; p.thLX = p.thRX = -1.85; p.knL = 2.2 + 0.05 * Math.sin(t * 1.3); p.knR = 2.1 - 0.05 * Math.sin(t * 1.3);
      p.thLZ = 0.06; p.thRZ = -0.06; p.anL = p.anR = 0.2;
      p.spineX = 0.12 + 0.012 * Math.sin(t * 1.9); p.shLX = p.shRX = -0.6; p.elL = p.elR = -0.85; p.shLZ = 0.12; p.shRZ = -0.12;
      p.headY = 0.3 * Math.sin(t * 0.3); p.headX = -0.05;
      break;
    }
    case 'skate': {
      // Sideways stance on the deck, knees soft; push with the back foot while cadence > 0.
      const push = ride.cadence > 0.05 ? Math.max(0, Math.sin(ph)) : 0;
      const air = ride.air;
      p.hipYaw = -1.35; p.spineY = 1.0; p.headY = 0.4 + ride.steer * 0.2;
      p.bodyY = -0.07 - 0.12 * air - 0.03 * (1 - push);
      p.roll = ride.steer * 0.18;
      p.thLZ = 0.22; p.thRZ = -0.22;
      p.thLX = -0.15 - 0.6 * air; p.thRX = 0.1 - 0.6 * air - 0.55 * push;
      p.knL = 0.45 + 1.0 * air; p.knR = 0.45 + 1.0 * air + 0.5 * push;
      p.anL = -0.3; p.anR = -0.3;
      p.spineX = 0.18 + 0.15 * air; p.shLZ = 0.55 + 0.2 * Math.sin(t * 1.3); p.shRZ = -0.55; p.elL = p.elR = -0.35;
      p.shLX = 0.2 * ride.steer; p.shRX = -0.2 * ride.steer;
      break;
    }
    case 'bike': {
      const s = Math.sin(ph), c = Math.cos(ph);
      p.bodyY = -0.36 - SEAT_DROP + 0.06 * ride.air; p.spineX = 0.5; p.headX = -0.45; p.roll = -ride.steer * 0.1;
      p.shLX = p.shRX = -1.15; p.shLZ = 0.12; p.shRZ = -0.12; p.elL = p.elR = -0.25; p.wrL = p.wrR = 0.2;
      p.thLX = -1.0 - 0.38 * s; p.thRX = -1.0 + 0.38 * s;
      p.knL = 1.15 + 0.45 * c; p.knR = 1.15 - 0.45 * c;
      p.thLZ = 0.04; p.thRZ = -0.04; p.anL = p.anR = 0.15;
      break;
    }
    case 'drive':
    case 'pilot': {
      p.bodyY = -0.36 - SEAT_DROP; p.spineX = -0.1; p.headX = 0.05; p.headY = ride.steer * 0.25;
      p.thLX = p.thRX = -1.4; p.knL = p.knR = 1.05; p.anL = p.anR = 0.1; p.thLZ = 0.08; p.thRZ = -0.08;
      p.shLX = p.shRX = -0.95; p.elL = p.elR = -0.65;
      p.shLZ = 0.18 + ride.steer * 0.25; p.shRZ = -0.18 + ride.steer * 0.25;
      break;
    }
    case 'paddle': {
      const s = Math.sin(ph);
      const k = ride.cadence > 0.05 ? 1 : 0.15;
      p.bodyY = -0.5 - SEAT_DROP; p.thLX = p.thRX = -1.5; p.knL = p.knR = 0.25; p.thLZ = 0.1; p.thRZ = -0.1; p.anL = p.anR = 0.4;
      p.spineX = 0.12; p.spineY = 0.45 * s * k; p.headY = -0.3 * s * k;
      p.shLX = -1.05 + 0.35 * s * k; p.shRX = -1.05 - 0.35 * s * k; p.shLZ = 0.3; p.shRZ = -0.3;
      p.elL = -0.6 - 0.3 * Math.max(0, s) * k; p.elR = -0.6 - 0.3 * Math.max(0, -s) * k;
      break;
    }
    case 'wave': {
      const k = Math.min(1, st / 0.25) * Math.min(1, Math.max(0, (1.8 - st) / 0.3));
      p.shRZ = -0.1 - 2.45 * k + 0.28 * Math.sin(st * 10) * k;
      p.shRX = -0.2 * k; p.elR = -0.25 - 0.35 * k;
      p.headY = -0.2 * k; p.headZ = 0.08 * k;
      p.spineZ = 0.04 * k;
      break;
    }
  }
  return p;
}

/**
 * Rocket exhaust: hot sparks right behind the shoes and a long smoke trail that hangs in the air,
 * as world-space point sprites (ring buffers, emitted along the path so it stays continuous at speed).
 */
function makeExhaust() {
  const group = new THREE.Group();
  group.name = 'thruster-exhaust';
  const layer = (n: number, life: number, frag: string, blending: THREE.Blending) => {
    const pos = new Float32Array(n * 3), born = new Float32Array(n).fill(-1e3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('born', new THREE.BufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: life } },
      vertexShader: `
        attribute float born; attribute float seed;
        uniform float uTime; uniform float uLife;
        varying float vAge; varying float vSeed;
        void main() {
          float age = (uTime - born) / uLife;
          vAge = age; vSeed = seed;
          vec3 p = position;
          p.y += age * uLife * (0.25 + 0.5 * seed); // smoke rises, sparks barely
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = ${frag.includes('SMOKE') ? 'mix(0.35, 2.6, sqrt(clamp(age, 0.0, 1.0)))' : 'mix(0.45, 0.12, clamp(age, 0.0, 1.0))'};
          gl_PointSize = age < 0.0 || age > 1.0 ? 0.0 : size * (0.7 + 0.6 * seed) * 520.0 / max(0.5, -mv.z);
        }`,
      fragmentShader: frag,
      transparent: true, depthWrite: false, blending, toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    let head = 0;
    return {
      mat, life,
      emit(x: number, y: number, z: number, t: number, jitter: number) {
        const i = head; head = (head + 1) % n;
        pos[i * 3] = x + (Math.random() - 0.5) * jitter;
        pos[i * 3 + 1] = y + (Math.random() - 0.5) * jitter;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * jitter;
        born[i] = t;
      },
      flush() { geo.attributes.position.needsUpdate = true; geo.attributes.born.needsUpdate = true; },
      dispose() { geo.dispose(); mat.dispose(); },
    };
  };
  const fire = layer(240, 0.32, `
    varying float vAge; varying float vSeed;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float d = length(c);
      if (d > 0.5) discard;
      vec3 col = mix(vec3(0.85, 0.95, 1.0), vec3(0.15, 0.45, 1.0), clamp(vAge * 1.6, 0.0, 1.0));
      float a = smoothstep(0.5, 0.0, d) * (1.0 - vAge);
      gl_FragColor = vec4(col * a * 1.6, a);
    }`, THREE.AdditiveBlending);
  const smoke = layer(700, 2.6, `
    // SMOKE
    varying float vAge; varying float vSeed;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float d = length(c);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.1, d) * 0.32 * (1.0 - vAge) * smoothstep(0.0, 0.06, vAge);
      vec3 col = mix(vec3(0.7, 0.84, 1.0), vec3(0.8, 0.81, 0.83), smoothstep(0.0, 0.12, vAge));
      gl_FragColor = vec4(col, a);
    }`, THREE.NormalBlending);
  const last: (THREE.Vector3 | null)[] = [null, null];
  const at = new THREE.Vector3();
  return {
    group,
    update(t: number, dt: number, r: number, nozzles: THREE.Object3D[]) {
      fire.mat.uniforms.uTime.value = t;
      smoke.mat.uniforms.uTime.value = t;
      if (r < 0.3) { last[0] = last[1] = null; return; }
      nozzles.forEach((nz, k) => {
        nz.updateWorldMatrix(true, false);
        at.set(0, -0.05, 0).applyMatrix4(nz.matrixWorld);
        const prev = last[k] ?? at.clone();
        const dist = prev.distanceTo(at);
        const nSmoke = Math.min(8, Math.max(1, Math.ceil(dist / 0.6)));
        for (let i = 1; i <= nSmoke; i++) {
          const f = i / nSmoke;
          if (Math.random() < Math.min(1, 0.35 + r * 0.5)) smoke.emit(prev.x + (at.x - prev.x) * f, prev.y + (at.y - prev.y) * f, prev.z + (at.z - prev.z) * f, t - dt * (1 - f), 0.25);
        }
        const nFire = Math.min(5, Math.max(1, Math.ceil(dist / 0.3)));
        for (let i = 1; i <= nFire; i++) {
          const f = i / nFire;
          fire.emit(prev.x + (at.x - prev.x) * f, prev.y + (at.y - prev.y) * f - 0.15 * r, prev.z + (at.z - prev.z) * f, t - dt * (1 - f), 0.08);
        }
        last[k] = (last[k] ?? new THREE.Vector3()).copy(at);
      });
      fire.flush(); smoke.flush();
    },
    dispose() { fire.dispose(); smoke.dispose(); group.removeFromParent(); },
  };
}

/** The OpenWorld mark: "OW" in navy on a rounded yellow tile, for the chest, back and hat. */
function logoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f6c21c';
  x.beginPath();
  x.roundRect(6, 6, 116, 116, 26);
  x.fill();
  x.fillStyle = '#1f3358';
  x.font = '800 62px system-ui, -apple-system, Helvetica, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('OW', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
