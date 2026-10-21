import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The player: a curious little robot in an orange hoodie, with a backpack, a skateboard strapped on, and
// rocket shoes. Built from primitives on a simple joint hierarchy and animated procedurally.

export type RobotState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'fly' | 'land' | 'roll' | 'sit' | 'wave'
  | 'skate' | 'bike' | 'drive' | 'pilot' | 'paddle';

export interface Robot {
  root: THREE.Group; // feet at y=0, faces +Z, ~1.6 m tall
  state: RobotState;
  speed: number; // ground speed m/s: drives stride cadence/length for walk/run
  rockets: number; // rocket-shoe thrust: 0 off, ~0.2 pilot light, 0.75 burn, up to 1.6 afterburner + ignition
  lean: { x: number; z: number }; // -1..1 lean while flying (x = bank right, z = pitch forward)
  /** Riding inputs: pedal/paddle/push cadence (cycles per second), steering -1..1, airborne 0..1. */
  ride: { cadence: number; steer: number; air: number };
  /** The skateboard strapped to the backpack (hidden while it's under your feet). */
  boardOnBack: boolean;
  /** Wingsuit 0..1: arms and legs spread with the orange membranes between them (while flying). */
  wings: number;
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

// Proportions follow the Hello World robot: about 1.6 m tall, a head roughly a sixth of that, thin
// mannequin limbs with big dark knee joints, a long hoodie that covers the hips, knee-length shorts.
const HIP_Y = 0.81;
/** Hip height of the previous, smaller body; the seated poses below keep their old hip height above the seat. */
const SEAT_DROP = HIP_Y - 0.71;

export function makeRobot(): Robot {
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: 0xbcae9a, roughness: 0.6 }),
    skinDark: new THREE.MeshStandardMaterial({ color: 0x9c8f7d, roughness: 0.7 }),
    hoodie: new THREE.MeshStandardMaterial({ color: 0xd9542a, roughness: 0.9 }),
    hoodieDark: new THREE.MeshStandardMaterial({ color: 0xb2401c, roughness: 0.92 }),
    zip: new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.45, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.6 }),
    tee: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.85 }),
    pack: new THREE.MeshStandardMaterial({ color: 0x4a5561, roughness: 0.82 }),
    packLight: new THREE.MeshStandardMaterial({ color: 0x6b7682, roughness: 0.8 }),
    shorts: new THREE.MeshStandardMaterial({ color: 0x41464d, roughness: 0.88 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x8e9399, roughness: 0.8 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3 }),
    board: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa3a8ad, roughness: 0.35, metalness: 0.7 }),
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

  // ---- Pelvis / shorts (mostly hidden under the hoodie) ----
  part(g(new THREE.CylinderGeometry(0.135, 0.155, 0.14, 16).scale(1, 1, 0.68)), mats.shorts, hips, 0, -0.06, 0);

  // ---- Torso: a long, slightly boxy hoodie that covers the hips ----
  const spine = joint(hips, 0, 0.05, 0);
  const torsoGeo = g(new THREE.CylinderGeometry(0.158, 0.166, 0.52, 22, 10).scale(1, 1, 0.7).translate(0, 0.13, 0));
  // A little chest, and a soft bag at the belly where the pocket sits.
  const bulge = (y: number) => 1 + 0.08 * Math.exp(-(((y - 0.27) / 0.08) ** 2)) + 0.06 * Math.exp(-((y / 0.1) ** 2));
  /** Distance of the hoodie's front surface from the spine at height y. */
  const frontZ = (y: number) => (0.166 + (0.158 - 0.166) * (y + 0.13) / 0.52) * 0.7 * bulge(y);
  {
    const p = torsoGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      if (z > 0) p.setZ(i, z * bulge(y));
    }
    torsoGeo.computeVertexNormals();
  }
  part(torsoGeo, mats.hoodie, spine);
  part(g(new THREE.SphereGeometry(0.158, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.04, 0.42, 0.7)), mats.hoodie, spine, 0, 0.39, 0); // shoulders
  part(g(new THREE.CylinderGeometry(0.16, 0.152, 0.06, 22).scale(1, 1, 0.72)), mats.hoodieDark, spine, 0, -0.13, 0); // ribbed hem
  // Hood: bunched up behind the neck, open at the front in a V that shows the grey tee.
  part(g(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1.05, 0.9, 0.8)), mats.hoodie, spine, 0, 0.42, -0.08, -0.3, 0, 0);
  // Rim of the hood around the neck, dipping at the front where the zip opens.
  part(g(new THREE.TorusGeometry(0.088, 0.034, 10, 26)), mats.hoodie, spine, 0, 0.43, 0.0, Math.PI / 2 - 0.42, 0, 0);
  part(g(new THREE.CylinderGeometry(0.06, 0.072, 0.05, 14)), mats.tee, spine, 0, 0.43, 0.012);
  // Zip: full length, just right of center, with a pull at the top.
  const zipSeg = g(new THREE.BoxGeometry(0.01, 0.042, 0.006));
  for (let y = -0.13; y < 0.36; y += 0.04) part(zipSeg, mats.zip, spine, -0.012, y + 0.02, frontZ(y + 0.02) + 0.002, -Math.atan2(frontZ(y + 0.04) - frontZ(y), 0.04), 0, 0);
  part(g(new THREE.BoxGeometry(0.016, 0.032, 0.008)), mats.zip, spine, -0.008, 0.35, frontZ(0.35) + 0.004);
  // Kangaroo pocket: a raised panel with darker openings at the sides.
  part(g(new THREE.BoxGeometry(0.22, 0.006, 0.01)), mats.hoodieDark, spine, 0, 0.0, frontZ(0) + 0.001, 0, 0, 0);
  for (const s of [-1, 1]) part(g(new THREE.BoxGeometry(0.01, 0.13, 0.01)), mats.hoodieDark, spine, s * 0.1, -0.07, frontZ(-0.07) - 0.004, 0.25, 0, s * -0.3);

  // ---- Backpack (big, slate, rounded) + skateboard ----
  const pack = joint(spine, 0, 0.16, -0.125);
  part(g(new RoundedBoxGeometry(0.32, 0.44, 0.16, 4, 0.07)), mats.pack, pack, 0, 0, -0.07);
  part(g(new RoundedBoxGeometry(0.26, 0.17, 0.05, 3, 0.022)), mats.pack, pack, 0, -0.1, -0.155); // front pocket
  part(g(new THREE.BoxGeometry(0.07, 0.035, 0.01)), mats.packLight, pack, 0, 0.17, -0.152); // label patch
  part(g(new THREE.TorusGeometry(0.04, 0.009, 6, 14, Math.PI)), mats.dark, pack, 0, 0.235, -0.07); // carry loop
  for (const s of [-1, 1]) {
    part(g(new RoundedBoxGeometry(0.05, 0.3, 0.1, 2, 0.02)), mats.pack, pack, s * 0.165, -0.04, -0.07); // side pockets
    // Wide shoulder straps: over the top and down the chest, curving out to the sides.
    part(g(new THREE.BoxGeometry(0.058, 0.028, 0.24)), mats.pack, spine, s * 0.112, 0.415, -0.005, 0, 0, s * 0.12);
    part(g(new RoundedBoxGeometry(0.052, 0.24, 0.012, 2, 0.005)), mats.pack, spine, s * 0.122, 0.29, frontZ(0.29) - 0.012, -0.22, 0, s * -0.05);
  }
  // Skateboard strapped upright to the pack: orange deck with slate nose and tail, a round emblem, white wheels.
  const board = joint(pack, 0, 0.11, -0.2);
  const deckGeo = g(new THREE.CapsuleGeometry(0.1, 0.6, 6, 14, 12).scale(1, 1, 0.08));
  {
    const p = deckGeo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const orange = new THREE.Color(0xe0682c), slate = new THREE.Color(0x4f6177);
    for (let i = 0; i < p.count; i++) (Math.abs(p.getY(i)) > 0.27 ? slate : orange).toArray(col, i * 3);
    deckGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  part(deckGeo, mats.board, board);
  part(g(new THREE.CircleGeometry(0.068, 24)), mats.pack, board, 0, -0.08, -0.0085, 0, Math.PI, 0);
  part(g(new THREE.TorusGeometry(0.058, 0.009, 6, 24)), mats.white, board, 0, -0.08, -0.009);
  part(g(new THREE.BoxGeometry(0.11, 0.012, 0.004)), mats.white, board, 0, -0.08, -0.01);
  part(g(new THREE.BoxGeometry(0.012, 0.11, 0.004)), mats.white, board, 0, -0.08, -0.01);
  for (const ty of [-0.27, 0.27]) {
    part(g(new THREE.BoxGeometry(0.05, 0.05, 0.02)), mats.metal, board, 0, ty, -0.018); // baseplate
    part(g(new THREE.BoxGeometry(0.15, 0.026, 0.026)), mats.metal, board, 0, ty, -0.038); // hanger
    for (const s of [-1, 1]) part(g(new THREE.CylinderGeometry(0.03, 0.03, 0.034, 12)), mats.white, board, s * 0.09, ty, -0.04, 0, 0, Math.PI / 2);
  }

  // ---- Neck + head ----
  const neck = joint(spine, 0, 0.43, 0.0);
  part(limb(0.036, 0.042, 0.11).translate(0, 0.11, 0), mats.dark, neck);
  part(limb(0.041, 0.041, 0.012).translate(0, 0.055, 0), mats.skinDark, neck); // collar ring between segments
  const head = joint(neck, 0, 0.1, 0.012);
  const headGeo = g(new THREE.SphereGeometry(1, 32, 24));
  {
    // Egg: fuller toward the crown, narrower at the chin, a touch deeper than wide.
    const p = headGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const w = 1 + 0.09 * y;
      p.setXYZ(i, p.getX(i) * 0.118 * w, y * 0.135 + 0.13, p.getZ(i) * 0.125 * w);
    }
    headGeo.computeVertexNormals();
  }
  part(headGeo, mats.skin, head);
  for (const s of [-1, 1]) {
    // Small dot eyes, set low and fairly wide.
    part(sphere(0.013, 12, 8).scale(1, 1.1, 0.5), mats.eye, head, s * 0.045, 0.1, 0.118);
    // Ear discs, like headphone cups: a beige drum with a dark center.
    const ear = joint(head, s * 0.117, 0.152, -0.008);
    part(g(new THREE.CylinderGeometry(0.056, 0.06, 0.04, 28)), mats.skin, ear, s * 0.004, 0, 0, 0, 0, Math.PI / 2);
    part(g(new THREE.TorusGeometry(0.048, 0.007, 8, 28)), mats.skin, ear, s * 0.024, 0, 0, 0, Math.PI / 2, 0);
    part(g(new THREE.CylinderGeometry(0.031, 0.031, 0.008, 22)), mats.dark, ear, s * 0.022, 0, 0, 0, 0, Math.PI / 2);
  }

  // ---- Arms: baggy sleeves to just past the elbow, thin mannequin forearms, jointed hands ----
  type Arm = { sh: THREE.Group; el: THREE.Group; wr: THREE.Group };
  const arm = (s: number): Arm => {
    const sh = joint(spine, s * 0.168, 0.355, -0.005);
    part(sphere(0.058), mats.hoodie, sh);
    part(limb(0.056, 0.052, 0.26), mats.hoodie, sh);
    const el = joint(sh, 0, -0.26, 0);
    part(sphere(0.051), mats.hoodie, el);
    part(limb(0.052, 0.05, 0.05), mats.hoodie, el);
    part(limb(0.047, 0.047, 0.028), mats.dark, el, 0, -0.05, 0); // cuff
    part(limb(0.035, 0.03, 0.18), mats.skin, el, 0, -0.07, 0);
    part(g(new THREE.BoxGeometry(0.003, 0.13, 0.003)), mats.skinDark, el, 0, -0.16, 0.032); // panel seam
    const wr = joint(el, 0, -0.26, 0);
    part(limb(0.031, 0.031, 0.026).translate(0, 0.013, 0), mats.dark, wr); // wrist band
    part(g(new THREE.BoxGeometry(0.03, 0.07, 0.062)), mats.skin, wr, 0, -0.045, 0);
    for (let f = 0; f < 4; f++) {
      const z = -0.022 + f * 0.0147;
      part(limb(0.0075, 0.007, 0.028, 6), mats.skin, wr, 0, -0.082, z);
      part(sphere(0.0075, 6, 4), mats.dark, wr, 0, -0.11, z);
      part(limb(0.0068, 0.006, 0.026, 6), mats.skin, wr, 0, -0.112, z);
    }
    part(limb(0.009, 0.008, 0.045, 6), mats.skin, wr, s * -0.012, -0.03, 0.033, -0.5, 0, s * 0.5);
    return { sh, el, wr };
  };
  const armL = arm(1), armR = arm(-1);

  // ---- Legs: knee-length shorts, dark knee and ankle joints, chunky sneakers (with rocket nozzles) ----
  type Leg = { th: THREE.Group; kn: THREE.Group; an: THREE.Group; flame: THREE.Group };
  const flameOuterMat = new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  // Wide at the sole, tip trailing 1 m (scaled) below it.
  const flameOuterGeo = g(new THREE.ConeGeometry(0.055, 1, 12, 1, true).rotateX(Math.PI).translate(0, -0.5, 0));
  const flameInnerGeo = g(new THREE.ConeGeometry(0.03, 0.6, 10, 1, true).rotateX(Math.PI).translate(0, -0.3, 0));
  // Afterburner plume: a wide, faint sheath that only shows on a hard burn.
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0xff4d12, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const plumeGeo = g(new THREE.ConeGeometry(0.09, 1, 14, 1, true).rotateX(Math.PI).translate(0, -0.5, 0));
  const leg = (s: number): Leg => {
    const th = joint(hips, s * 0.085, -0.04, 0);
    part(limb(0.09, 0.086, 0.27, 14), mats.shorts, th, 0, 0.02, 0);
    part(g(new THREE.BoxGeometry(0.03, 0.09, 0.08)), mats.shorts, th, s * 0.088, -0.15, 0); // cargo pocket
    part(limb(0.05, 0.047, 0.1), mats.skin, th, 0, -0.24, 0);
    const kn = joint(th, 0, -0.34, 0);
    part(sphere(0.056, 14, 10), mats.dark, kn);
    part(limb(0.047, 0.037, 0.31), mats.skin, kn, 0, -0.01, 0);
    part(g(new THREE.BoxGeometry(0.003, 0.18, 0.003)), mats.skinDark, kn, 0, -0.15, 0.042); // panel seam
    const an = joint(kn, 0, -0.34, 0);
    part(sphere(0.034, 10, 8), mats.dark, an);
    // Chunky sneaker, toe toward +Z, on a pale sole.
    part(g(new THREE.CapsuleGeometry(0.056, 0.13, 4, 12).rotateX(Math.PI / 2).scale(1.05, 0.82, 1)), mats.shoe, an, 0, -0.035, 0.04);
    part(g(new RoundedBoxGeometry(0.105, 0.03, 0.25, 2, 0.012)), mats.sole, an, 0, -0.07, 0.04);
    part(g(new THREE.BoxGeometry(0.11, 0.012, 0.06)), mats.sole, an, 0, -0.012, 0.075); // laces strip
    const flame = joint(an, 0, -0.088, 0.0);
    const outer = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    const inner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    flame.add(outer, inner, new THREE.Mesh(plumeGeo, plumeMat));
    flame.visible = false;
    return { th, kn, an, flame };
  };
  const legL = leg(1), legR = leg(-1);

  const glow = new THREE.PointLight(0xff8a3a, 0, 5, 2);
  glow.castShadow = false;
  glow.position.set(0, 0.05, 0);
  root.add(glow);
  const exhaust = makeExhaust();

  // Wingsuit membranes: arm wings (shoulder–wrist–knee–hip) and a tail wing between the legs. Their
  // corners follow the joints every frame, so they stretch and fold with the pose.
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xd9542a, roughness: 0.75, side: THREE.DoubleSide });
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
    ride: { cadence: 0, steer: 0, air: 0 }, boardOnBack: true, wings: 0,
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
      board.visible = robot.boardOnBack;
      sl.x = THREE.MathUtils.damp(sl.x, THREE.MathUtils.clamp(robot.lean.x, -1, 1), 5, dt);
      sl.z = THREE.MathUtils.damp(sl.z, THREE.MathUtils.clamp(robot.lean.z, -1, 1), 5, dt);

      // One-shots return to the ground loop.
      if ((robot.state === 'land' && stateT > 0.35) || (robot.state === 'roll' && stateT > 0.7)) robot.play(sp > 3.6 ? 'run' : sp > 0.4 ? 'walk' : 'idle');
      if (robot.state === 'wave' && stateT > 1.8) robot.play(sp > 0.4 ? 'walk' : 'idle');

      const target = pose(robot.state, time, stateT, phase, sp, sl, robot.ride, robot.state === 'fly' || robot.state === 'fall' ? robot.wings : 0);
      const w = blendT >= 0.2 ? 1 : smooth(blendT / 0.2);
      for (const k of KEYS) out[k] = from[k] + (target[k] - from[k]) * w;
      apply(out);
      wing.visible = robot.wings > 0.25 && (robot.state === 'fly' || robot.state === 'fall');
      if (wing.visible) updateWings();

      // Rocket flames: short and blue-white on a pilot light, a long roaring jet on a burn,
      // a wide plume on the afterburner. Exhaust streams out behind in world space.
      const r = THREE.MathUtils.clamp(robot.rockets, 0, 1.6);
      const hot = THREE.MathUtils.clamp(r - 0.9, 0, 0.7) / 0.7;
      for (const l of [legL, legR]) {
        l.flame.visible = r > 0.02;
        if (!l.flame.visible) continue;
        const flick = 0.82 + 0.36 * Math.sin(time * 47 + (l === legL ? 0 : 2)) * Math.sin(time * 31);
        const len = (0.2 + 0.95 * r) * flick;
        l.flame.scale.set(0.75 + 0.55 * Math.min(r, 1.2), len, 0.75 + 0.55 * Math.min(r, 1.2));
      }
      flameOuterMat.opacity = 0.45 + 0.45 * Math.min(r, 1);
      flameOuterMat.color.setRGB(1, 0.42 + 0.12 * hot, 0.1 + 0.6 * (1 - Math.min(1, r * 2)));
      plumeMat.opacity = 0.35 * hot * (0.8 + 0.2 * Math.sin(time * 53));
      glow.intensity = r * 6 * (0.85 + 0.15 * Math.sin(time * 40));
      const scene = root.parent;
      if (scene && exhaust.group.parent !== scene) scene.add(exhaust.group);
      exhaust.update(time, dt, r, [legL.flame, legR.flame]);
    },
    dispose() {
      geos.forEach((x) => x.dispose());
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

/**
 * Joint angles for a state. Conventions: rotation.x < 0 swings a limb forward (+Z); a positive knee
 * angle folds the shin back; a positive ankle angle points the toe down; positive spineX leans forward;
 * shoulder Z > 0 raises the left arm out to the side (mirrored for the right).
 */
function pose(state: RobotState, t: number, st: number, ph: number, sp: number, lean: { x: number; z: number }, ride: { cadence: number; steer: number; air: number }, wings = 0): Pose {
  const p = basePose(wings > 0 && state === 'fall' ? 'fly' : state, t, st, ph, sp, lean, ride);
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

function basePose(state: RobotState, t: number, st: number, ph: number, sp: number, lean: { x: number; z: number }, ride: { cadence: number; steer: number; air: number }): Pose {
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
      p.roll = L(0.02, 0.03) * s;
      break;
    }
    case 'jump': {
      p.thLX = -0.9; p.thRX = -0.6; p.knL = 1.35; p.knR = 1.0; p.anL = p.anR = 0.4;
      p.shLX = -0.7; p.shRX = -0.5; p.shLZ = 0.5; p.shRZ = -0.5; p.elL = p.elR = -0.8;
      p.spineX = 0.15; p.headX = -0.1;
      break;
    }
    case 'fall': {
      const f = Math.sin(t * 9), f2 = Math.sin(t * 7.3 + 1);
      p.shLZ = 2.3 + 0.25 * f; p.shRZ = -2.3 + 0.25 * f2;
      p.shLX = -0.2 + 0.2 * f2; p.shRX = -0.2 + 0.2 * f;
      p.elL = -0.4 + 0.2 * f; p.elR = -0.4 + 0.2 * f2;
      p.thLX = -0.35 + 0.35 * f; p.thRX = -0.2 - 0.35 * f; p.knL = 0.6 + 0.3 * f2; p.knR = 0.7 - 0.3 * f;
      p.spineX = -0.1; p.headX = 0.15;
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
  group.name = 'rocket-exhaust';
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
      vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.35, 0.05), clamp(vAge * 1.6, 0.0, 1.0));
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
      vec3 col = mix(vec3(1.0, 0.72, 0.45), vec3(0.78, 0.78, 0.8), smoothstep(0.0, 0.12, vAge));
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
