import * as THREE from 'three';

// The player: a curious little robot in an orange hoodie, with a backpack, a skateboard strapped on, and
// rocket shoes. Built from primitives on a simple joint hierarchy and animated procedurally.

export type RobotState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'fly' | 'land' | 'sit' | 'wave'
  | 'skate' | 'bike' | 'drive' | 'pilot' | 'paddle';

export interface Robot {
  root: THREE.Group; // feet at y=0, faces +Z, ~1.55 m tall
  state: RobotState;
  speed: number; // ground speed m/s: drives stride cadence/length for walk/run
  rockets: number; // 0..1 rocket-shoe thrust
  lean: { x: number; z: number }; // -1..1 lean while flying (x = bank right, z = pitch forward)
  /** Riding inputs: pedal/paddle/push cadence (cycles per second), steering -1..1, airborne 0..1. */
  ride: { cadence: number; steer: number; air: number };
  /** The skateboard strapped to the backpack (hidden while it's under your feet). */
  boardOnBack: boolean;
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

const HIP_Y = 0.71;

export function makeRobot(): Robot {
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: 0xcdb99c, roughness: 0.72 }),
    skinDark: new THREE.MeshStandardMaterial({ color: 0xa8957b, roughness: 0.75 }),
    hoodie: new THREE.MeshStandardMaterial({ color: 0xd4582a, roughness: 0.85 }),
    hoodieDark: new THREE.MeshStandardMaterial({ color: 0xb4461f, roughness: 0.88 }),
    zip: new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.7 }),
    pack: new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.8 }),
    shorts: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.85 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.65 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.8 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15, metalness: 0.2 }),
    board: new THREE.MeshStandardMaterial({ color: 0xe0642c, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.6 }),
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
  const limb = (r0: number, r1: number, len: number, seg = 10) => g(new THREE.CylinderGeometry(r0, r1, len, seg).translate(0, -len / 2, 0));
  const sphere = (r: number, w = 12, h = 10) => g(new THREE.SphereGeometry(r, w, h));

  const root = new THREE.Group();
  root.name = 'robot';
  const hips = joint(root, 0, HIP_Y, 0);

  // ---- Pelvis / shorts ----
  part(g(new THREE.CylinderGeometry(0.135, 0.14, 0.14, 14).scale(1, 1, 0.78)), mats.shorts, hips, 0, -0.02, 0);
  part(g(new THREE.CylinderGeometry(0.137, 0.137, 0.03, 14).scale(1, 1, 0.78)), mats.dark, hips, 0, 0.045, 0); // waistband

  // ---- Torso (hoodie) ----
  const spine = joint(hips, 0, 0.04, 0);
  const torsoGeo = g(new THREE.CylinderGeometry(0.165, 0.145, 0.36, 16, 1).scale(1, 1, 0.7).translate(0, 0.18, 0));
  part(torsoGeo, mats.hoodie, spine);
  part(g(new THREE.SphereGeometry(0.165, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 0.7)), mats.hoodie, spine, 0, 0.36, 0); // shoulders
  part(g(new THREE.CylinderGeometry(0.15, 0.148, 0.05, 16).scale(1, 1, 0.72)), mats.hoodieDark, spine, 0, 0.0, 0); // hem
  part(g(new THREE.TorusGeometry(0.085, 0.038, 8, 16)), mats.hoodie, spine, 0, 0.41, -0.01, Math.PI / 2 - 0.25, 0, 0); // rolled hood
  part(g(new THREE.BoxGeometry(0.012, 0.34, 0.01)), mats.zip, spine, 0, 0.19, 0.105, -0.05, 0, 0); // zipper
  part(g(new THREE.BoxGeometry(0.17, 0.075, 0.012)), mats.hoodieDark, spine, 0, 0.08, 0.1, -0.08, 0, 0); // front pocket

  // ---- Backpack + skateboard ----
  const pack = joint(spine, 0, 0.2, -0.13);
  part(g(new THREE.CapsuleGeometry(0.08, 0.17, 4, 10).scale(1.9, 1, 0.85)), mats.pack, pack, 0, 0, -0.025);
  part(g(new THREE.BoxGeometry(0.18, 0.09, 0.03)), mats.dark, pack, 0, -0.06, -0.085); // outer pocket
  for (const s of [-1, 1]) {
    // Shoulder straps: over the top and down the chest.
    part(g(new THREE.BoxGeometry(0.035, 0.02, 0.2)), mats.pack, spine, s * 0.085, 0.395, 0.0);
    part(g(new THREE.BoxGeometry(0.035, 0.27, 0.018)), mats.pack, spine, s * 0.09, 0.25, 0.1, -0.12, 0, 0);
  }
  const board = joint(pack, 0, 0.04, -0.11);
  const deckGeo = g(new THREE.CapsuleGeometry(0.078, 0.5, 4, 12).scale(1, 1, 0.12));
  part(deckGeo, mats.board, board);
  // Round emblem on the deck's outer face.
  part(g(new THREE.TorusGeometry(0.055, 0.008, 6, 20)), mats.white, board, 0, 0.0, -0.012);
  part(g(new THREE.BoxGeometry(0.1, 0.008, 0.004)), mats.white, board, 0, 0, -0.012);
  part(g(new THREE.BoxGeometry(0.008, 0.1, 0.004)), mats.white, board, 0, 0, -0.012);
  for (const ty of [-0.22, 0.22]) {
    part(g(new THREE.BoxGeometry(0.12, 0.03, 0.03)), mats.metal, board, 0, ty, -0.028);
    for (const s of [-1, 1]) part(g(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 10)), mats.white, board, s * 0.075, ty, -0.04, 0, 0, Math.PI / 2);
  }

  // ---- Neck + head ----
  const neck = joint(spine, 0, 0.4, 0);
  part(limb(0.032, 0.036, 0.09).translate(0, 0.09, 0), mats.dark, neck);
  const head = joint(neck, 0, 0.1, 0.01);
  const headGeo = g(new THREE.SphereGeometry(1, 28, 22));
  {
    // Egg: wider toward the crown, narrower at the chin.
    const p = headGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const w = 1 + 0.1 * y;
      p.setXYZ(i, p.getX(i) * 0.153 * w, y * 0.185 + 0.18, p.getZ(i) * 0.162 * w);
    }
    headGeo.computeVertexNormals();
  }
  part(headGeo, mats.skin, head);
  for (const s of [-1, 1]) {
    part(sphere(0.02, 10, 8).scale(1, 1.15, 0.6), mats.eye, head, s * 0.064, 0.135, 0.15);
    // Ear discs, like headphones.
    const ear = joint(head, s * 0.152, 0.18, -0.005);
    part(g(new THREE.CylinderGeometry(0.066, 0.07, 0.04, 20)), mats.skin, ear, s * 0.008, 0, 0, 0, 0, Math.PI / 2);
    part(g(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 20)), mats.skinDark, ear, s * 0.03, 0, 0, 0, 0, Math.PI / 2);
    part(g(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14)), mats.dark, ear, s * 0.034, 0, 0, 0, 0, Math.PI / 2);
  }

  // ---- Arms ----
  type Arm = { sh: THREE.Group; el: THREE.Group; wr: THREE.Group };
  const arm = (s: number): Arm => {
    const sh = joint(spine, s * 0.175, 0.34, 0);
    part(sphere(0.06), mats.hoodie, sh);
    part(limb(0.055, 0.05, 0.25), mats.hoodie, sh);
    const el = joint(sh, 0, -0.25, 0);
    part(sphere(0.05), mats.hoodie, el);
    part(limb(0.05, 0.047, 0.1), mats.hoodie, el);
    part(limb(0.049, 0.049, 0.035), mats.dark, el, 0, -0.095, 0); // cuff
    part(limb(0.034, 0.03, 0.12), mats.skin, el, 0, -0.12, 0);
    part(g(new THREE.BoxGeometry(0.004, 0.1, 0.004)), mats.skinDark, el, s * 0.0, -0.18, 0.033); // mannequin seam
    const wr = joint(el, 0, -0.24, 0);
    part(sphere(0.028, 8, 6), mats.dark, wr);
    part(g(new THREE.BoxGeometry(0.03, 0.065, 0.06)), mats.skin, wr, 0, -0.045, 0);
    for (let f = 0; f < 4; f++) part(limb(0.008, 0.007, 0.05, 6), mats.skin, wr, 0, -0.075, -0.022 + f * 0.0147);
    part(limb(0.009, 0.008, 0.04, 6), mats.skin, wr, s * -0.012, -0.03, 0.03, -0.5, 0, s * 0.5);
    return { sh, el, wr };
  };
  const armL = arm(1), armR = arm(-1);

  // ---- Legs ----
  type Leg = { th: THREE.Group; kn: THREE.Group; an: THREE.Group; flame: THREE.Group };
  const flameOuterMat = new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  // Wide at the sole, tip trailing 1 m (scaled) below it.
  const flameOuterGeo = g(new THREE.ConeGeometry(0.055, 1, 12, 1, true).rotateX(Math.PI).translate(0, -0.5, 0));
  const flameInnerGeo = g(new THREE.ConeGeometry(0.03, 0.6, 10, 1, true).rotateX(Math.PI).translate(0, -0.3, 0));
  const leg = (s: number): Leg => {
    const th = joint(hips, s * 0.078, -0.03, 0);
    part(limb(0.077, 0.072, 0.22, 12), mats.shorts, th);
    part(g(new THREE.BoxGeometry(0.03, 0.08, 0.07)), mats.shorts, th, s * 0.072, -0.12, 0); // cargo pocket
    part(limb(0.05, 0.046, 0.16), mats.skin, th, 0, -0.15, 0);
    const kn = joint(th, 0, -0.31, 0);
    part(sphere(0.048, 10, 8), mats.skin, kn);
    part(g(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.7).scale(0.9, 1.1, 0.7)), mats.dark, kn, 0, 0.0, 0.018, Math.PI / 2, 0, 0); // knee pad
    part(limb(0.045, 0.037, 0.28), mats.skin, kn);
    const an = joint(kn, 0, -0.29, 0);
    // Chunky shoe, toe toward +Z.
    part(g(new THREE.CapsuleGeometry(0.05, 0.11, 4, 10).rotateX(Math.PI / 2).scale(1.05, 0.85, 1)), mats.shoe, an, 0, -0.025, 0.035);
    part(g(new THREE.BoxGeometry(0.088, 0.02, 0.19)), mats.sole, an, 0, -0.062, 0.035);
    const flame = joint(an, 0, -0.078, 0.0);
    const outer = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    const inner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    flame.add(outer, inner);
    flame.visible = false;
    return { th, kn, an, flame };
  };
  const legL = leg(1), legR = leg(-1);

  const glow = new THREE.PointLight(0xff8a3a, 0, 5, 2);
  glow.castShadow = false;
  glow.position.set(0, 0.05, 0);
  root.add(glow);

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
    ride: { cadence: 0, steer: 0, air: 0 }, boardOnBack: true,
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
      const step = Math.min(1.45, 0.5 + 0.15 * sp);
      if (robot.state === 'walk' || robot.state === 'run') phase += (Math.PI * sp / step) * dt;
      else phase += Math.PI * 2 * robot.ride.cadence * dt;
      board.visible = robot.boardOnBack;
      sl.x = THREE.MathUtils.damp(sl.x, THREE.MathUtils.clamp(robot.lean.x, -1, 1), 5, dt);
      sl.z = THREE.MathUtils.damp(sl.z, THREE.MathUtils.clamp(robot.lean.z, -1, 1), 5, dt);

      // One-shots return to the ground loop.
      if (robot.state === 'land' && stateT > 0.35) robot.play(sp > 3.6 ? 'run' : sp > 0.4 ? 'walk' : 'idle');
      if (robot.state === 'wave' && stateT > 1.8) robot.play(sp > 0.4 ? 'walk' : 'idle');

      const target = pose(robot.state, time, stateT, phase, sp, sl, robot.ride);
      const w = blendT >= 0.2 ? 1 : smooth(blendT / 0.2);
      for (const k of KEYS) out[k] = from[k] + (target[k] - from[k]) * w;
      apply(out);

      // Rocket flames.
      const r = THREE.MathUtils.clamp(robot.rockets, 0, 1);
      for (const l of [legL, legR]) {
        l.flame.visible = r > 0.02;
        if (!l.flame.visible) continue;
        const flick = 0.85 + 0.3 * Math.sin(time * 47 + (l === legL ? 0 : 2)) * Math.sin(time * 31);
        const len = (0.25 + 0.85 * r) * flick;
        l.flame.scale.set(0.8 + 0.5 * r, len, 0.8 + 0.5 * r);
      }
      flameOuterMat.opacity = 0.5 + 0.4 * r;
      glow.intensity = r * 6 * (0.85 + 0.15 * Math.sin(time * 40));
    },
    dispose() {
      geos.forEach((x) => x.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      flameOuterMat.dispose(); flameInnerMat.dispose();
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
function pose(state: RobotState, t: number, st: number, ph: number, sp: number, lean: { x: number; z: number }, ride: { cadence: number; steer: number; air: number }): Pose {
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
      const run = state === 'run';
      const amp = run ? 1 : THREE.MathUtils.clamp(sp / 2, 0.5, 1.15);
      const s = Math.sin(ph), c = Math.cos(ph);
      const stride = run ? 0.75 : 0.42;
      p.thLX = -stride * s * amp; p.thRX = stride * s * amp;
      // Knee folds while the leg swings forward.
      const kneeAmp = run ? 1.45 : 0.7;
      p.knL = 0.08 + kneeAmp * amp * Math.max(0, c) ** 1.4 + (run ? 0.25 : 0.05);
      p.knR = 0.08 + kneeAmp * amp * Math.max(0, -c) ** 1.4 + (run ? 0.25 : 0.05);
      p.anL = -0.15 * s * amp - 0.2 * Math.max(0, c); p.anR = 0.15 * s * amp - 0.2 * Math.max(0, -c);
      const armAmp = (run ? 0.85 : 0.4) * amp;
      p.shLX = armAmp * s; p.shRX = -armAmp * s;
      p.elL = p.elR = run ? -1.35 : -0.3;
      p.elL -= run ? 0.25 * Math.max(0, -s) : 0.15 * Math.max(0, -s);
      p.elR -= run ? 0.25 * Math.max(0, s) : 0.15 * Math.max(0, s);
      p.shLZ = run ? 0.18 : 0.1; p.shRZ = -p.shLZ;
      p.bodyY = (run ? 0.045 : 0.018) * Math.cos(2 * ph) * amp - (run ? 0.05 : 0.01);
      p.hipYaw = (run ? 0.12 : 0.08) * s * amp;
      p.spineY = -p.hipYaw * 1.3;
      p.spineX = run ? 0.18 : 0.04;
      p.pitch = run ? 0.06 : 0.0;
      p.headX = -p.spineX * 0.6;
      p.roll = (run ? 0.03 : 0.02) * s;
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
      const hover = 1 - Math.abs(lean.z);
      const bob = Math.sin(t * 2.4);
      p.pitch = lean.z * 1.15;
      p.roll = -lean.x * 0.6;
      p.headX = -lean.z * 0.9; // keep looking where we're going
      p.spineX = 0.05;
      p.shLX = 0.55 + 0.1 * bob * hover; p.shRX = 0.55 + 0.1 * bob * hover;
      p.shLZ = 0.4 + lean.x * 0.15; p.shRZ = -0.4 + lean.x * 0.15;
      p.elL = p.elR = -0.25; p.wrL = p.wrR = 0.3;
      p.thLX = 0.05 + 0.08 * bob * hover; p.thRX = 0.02 - 0.08 * bob * hover;
      p.thLZ = -0.03; p.thRZ = 0.03;
      p.knL = 0.18 + 0.12 * hover; p.knR = 0.22 + 0.1 * hover;
      p.anL = p.anR = 0.55;
      p.bodyY = 0.02 * bob * hover;
      break;
    }
    case 'land': {
      const k = Math.sin(Math.min(1, st / 0.35) * Math.PI);
      p.bodyY = -0.2 * k; p.thLX = p.thRX = -0.85 * k; p.knL = p.knR = 1.45 * k; p.anL = p.anR = -0.55 * k;
      p.spineX = 0.35 * k; p.shLX = p.shRX = -0.5 * k; p.shLZ = 0.35; p.shRZ = -0.35; p.elL = p.elR = -0.6;
      break;
    }
    case 'sit': {
      // Sitting on a ledge about 0.4 m high, hands on knees.
      p.bodyY = -0.36; p.thLX = p.thRX = -1.5; p.knL = 1.45 + 0.05 * Math.sin(t * 1.3); p.knR = 1.35 - 0.05 * Math.sin(t * 1.3);
      p.thLZ = 0.06; p.thRZ = -0.06; p.anL = p.anR = 0.2;
      p.spineX = 0.12 + 0.012 * Math.sin(t * 1.9); p.shLX = p.shRX = -0.75; p.elL = p.elR = -0.5; p.shLZ = 0.12; p.shRZ = -0.12;
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
      p.bodyY = -0.36 + 0.06 * ride.air; p.spineX = 0.5; p.headX = -0.45; p.roll = -ride.steer * 0.1;
      p.shLX = p.shRX = -1.15; p.shLZ = 0.12; p.shRZ = -0.12; p.elL = p.elR = -0.25; p.wrL = p.wrR = 0.2;
      p.thLX = -1.0 - 0.38 * s; p.thRX = -1.0 + 0.38 * s;
      p.knL = 1.15 + 0.45 * c; p.knR = 1.15 - 0.45 * c;
      p.thLZ = 0.04; p.thRZ = -0.04; p.anL = p.anR = 0.15;
      break;
    }
    case 'drive':
    case 'pilot': {
      p.bodyY = -0.36; p.spineX = -0.1; p.headX = 0.05; p.headY = ride.steer * 0.25;
      p.thLX = p.thRX = -1.4; p.knL = p.knR = 1.05; p.anL = p.anR = 0.1; p.thLZ = 0.08; p.thRZ = -0.08;
      p.shLX = p.shRX = -0.95; p.elL = p.elR = -0.65;
      p.shLZ = 0.18 + ride.steer * 0.25; p.shRZ = -0.18 + ride.steer * 0.25;
      break;
    }
    case 'paddle': {
      const s = Math.sin(ph);
      const k = ride.cadence > 0.05 ? 1 : 0.15;
      p.bodyY = -0.5; p.thLX = p.thRX = -1.5; p.knL = p.knR = 0.25; p.thLZ = 0.1; p.thRZ = -0.1; p.anL = p.anR = 0.4;
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
