// Vehicle meshes: chunky, clean and toy-like, like the ones in the game that inspired this.
// Each model faces +Z with its ground contact at y=0. Static parts are merged per material; parts that
// move (wheels, propeller, paddle) are separate objects the vehicle animates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Model {
  group: THREE.Group;
  /** Wheels: spun around their local X by distance travelled / radius. */
  wheels: { obj: THREE.Object3D; r: number; steer?: boolean }[];
  /** Propeller / paddle / anything else the vehicle animates by name. */
  parts: Record<string, THREE.Object3D>;
  dispose(): void;
}

const std = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/** Builds a model from (geometry, material) pairs, merging pieces that share a material. */
function builder() {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    let l = byMat.get(mat);
    if (!l) byMat.set(mat, (l = []));
    l.push(g);
  };
  const build = (group: THREE.Group) => {
    for (const [mat, list] of byMat) {
      const geo = mergeGeometries(list)!;
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      owned.push(geo, mat);
    }
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    owned.push(geo, mat);
    return m;
  };
  return { add, build, mesh, dispose: () => owned.forEach((o) => o.dispose()) };
}

function wheel(b: ReturnType<typeof builder>, r: number, w: number, tire: THREE.Material, hub: THREE.Material) {
  const obj = new THREE.Group();
  const t = b.mesh(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), tire);
  const h = b.mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.02, 10).rotateZ(Math.PI / 2), hub);
  // A spoke bar so you can see it spin.
  const s = b.mesh(new THREE.BoxGeometry(w + 0.03, r * 1.5, r * 0.18), hub);
  obj.add(t, h, s);
  return obj;
}

export function skateboardModel(): Model {
  const b = builder(), group = new THREE.Group();
  const deck = std(0xf4bf1d, 0.6), grip = std(0x2a2d32, 0.95), metal = std(0x9aa0a6, 0.4, 0.6), white = std(0xf2efe8, 0.55);
  b.add(new THREE.CapsuleGeometry(0.11, 0.62, 4, 12).rotateX(Math.PI / 2).scale(1, 0.1, 1), deck, 0, 0.11, 0);
  b.add(new THREE.BoxGeometry(0.2, 0.006, 0.7), grip, 0, 0.123, 0);
  for (const z of [-0.26, 0.26]) b.add(new THREE.BoxGeometry(0.16, 0.035, 0.04), metal, 0, 0.075, z);
  b.build(group);
  const wheels: Model['wheels'] = [];
  for (const z of [-0.26, 0.26]) for (const x of [-0.09, 0.09]) {
    const w = new THREE.Group();
    w.add(b.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 12).rotateZ(Math.PI / 2), white));
    w.position.set(x, 0.03, z);
    group.add(w);
    wheels.push({ obj: w, r: 0.03 });
  }
  return { group, wheels, parts: {}, dispose: b.dispose };
}

export function bikeModel(): Model {
  const b = builder(), group = new THREE.Group();
  const frame = std(0xe4692e, 0.45, 0.2), dark = std(0x24272c, 0.8), metal = std(0xb7bcc2, 0.35, 0.7), seat = std(0x1d1f23, 0.7);
  const tube = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r = 0.022, mat: THREE.Material = frame) => {
    const a = new THREE.Vector3(ax, ay, az), c = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(c);
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1)));
    b.add(g, mat);
  };
  const R = 0.34;
  // Diamond frame: rear axle (z -0.5), bottom bracket, seat cluster, head tube.
  tube(0, R, -0.5, 0, 0.3, -0.02); tube(0, R, -0.5, 0, 0.82, -0.18); tube(0, 0.3, -0.02, 0, 0.84, -0.16, 0.026);
  tube(0, 0.3, -0.02, 0, 0.78, 0.36, 0.028); tube(0, 0.84, -0.16, 0, 0.86, 0.34, 0.024);
  tube(0, 0.78, 0.36, 0, R, 0.52, 0.02, metal); // fork
  tube(0, 0.84, -0.16, 0, 0.96, -0.2, 0.018, metal); // seat post
  b.add(new THREE.BoxGeometry(0.12, 0.04, 0.24).translate(0, 0.98, -0.2), seat);
  tube(0, 0.78, 0.36, 0, 1.02, 0.4, 0.02, metal); // stem
  tube(-0.26, 1.02, 0.42, 0.26, 1.02, 0.42, 0.018, dark); // bars
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12).rotateZ(Math.PI / 2), dark, 0, 0.3, -0.02); // chainring
  b.build(group);
  const wheels: Model['wheels'] = [];
  for (const z of [-0.5, 0.52]) {
    const w = new THREE.Group();
    w.add(b.mesh(new THREE.TorusGeometry(R, 0.03, 8, 28).rotateY(Math.PI / 2), dark));
    for (let k = 0; k < 3; k++) w.add(b.mesh(new THREE.BoxGeometry(0.01, R * 1.95, 0.012).rotateX((k * Math.PI) / 3), metal));
    w.position.set(0, R, z);
    group.add(w);
    wheels.push({ obj: w, r: R, steer: z > 0 });
  }
  return { group, wheels, parts: {}, dispose: b.dispose };
}

export function jeepModel(color = 0x7fbcb4): Model {
  const b = builder(), group = new THREE.Group();
  const body = std(color, 0.45, 0.1), sand = std(0xd9c79f, 0.85), dark = std(0x26292e, 0.8), glass = std(0x9fc6dc, 0.15, 0.3);
  const chrome = std(0xd6dade, 0.3, 0.8), seat = std(0x5a4636, 0.8), light = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 0.6 });
  // Tub, hood, fenders, bumpers.
  b.add(new THREE.BoxGeometry(1.7, 0.55, 3.6), body, 0, 0.75, 0);
  b.add(new THREE.BoxGeometry(1.62, 0.22, 1.25), body, 0, 1.1, 1.15);
  for (const s of [-1, 1]) for (const z of [-1.25, 1.25]) b.add(new THREE.BoxGeometry(0.22, 0.12, 0.95), body, s * 0.93, 1.0, z);
  b.add(new THREE.BoxGeometry(1.8, 0.18, 0.18), dark, 0, 0.5, 1.88);
  b.add(new THREE.BoxGeometry(1.8, 0.18, 0.18), dark, 0, 0.5, -1.88);
  // Grille slots and headlights.
  for (let i = -3; i <= 3; i++) b.add(new THREE.BoxGeometry(0.06, 0.32, 0.02), dark, i * 0.13, 0.95, 1.81);
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14).rotateX(Math.PI / 2), light, s * 0.62, 0.98, 1.81);
  // Windshield frame + glass, roll bar, canvas top.
  b.add(new THREE.BoxGeometry(1.6, 0.05, 0.05), body, 0, 1.75, 0.52, -0.3);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.06, 0.62, 0.06), body, s * 0.78, 1.45, 0.45, -0.3);
  b.add(new THREE.BoxGeometry(1.5, 0.52, 0.02), glass, 0, 1.44, 0.46, -0.3);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.07, 0.8, 0.07), chrome, s * 0.75, 1.42, -0.55);
  b.add(new THREE.BoxGeometry(1.57, 0.07, 0.07), chrome, 0, 1.8, -0.55);
  b.add(new THREE.BoxGeometry(1.66, 0.06, 1.55), sand, 0, 1.82, -0.15);
  // Seats, wheel, spare tyre.
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.55, 0.12, 0.55), seat, s * 0.4, 1.02, -0.3);
    b.add(new THREE.BoxGeometry(0.55, 0.55, 0.12), seat, s * 0.4, 1.3, -0.6);
  }
  b.add(new THREE.TorusGeometry(0.19, 0.025, 6, 18), dark, 0.4, 1.38, 0.18, -0.9);
  b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 18).rotateX(Math.PI / 2), dark, 0, 1.05, -2.0);
  b.build(group);
  const wheels: Model['wheels'] = [];
  for (const z of [-1.25, 1.25]) for (const s of [-1, 1]) {
    const w = wheel(b, 0.42, 0.32, dark, chrome);
    w.position.set(s * 0.86, 0.42, z);
    group.add(w);
    wheels.push({ obj: w, r: 0.42, steer: z > 0 });
  }
  return { group, wheels, parts: {}, dispose: b.dispose };
}

export function planeModel(): Model {
  const b = builder(), group = new THREE.Group();
  const white = std(0xf1efe9, 0.45), orange = std(0xe2652b, 0.5), dark = std(0x2a2d33, 0.7), glass = std(0x7fb2d6, 0.1, 0.3), metal = std(0xb8bcc2, 0.35, 0.7);
  // Fuselage along Z, belly about 1.05 m up on the gear.
  b.add(new THREE.CapsuleGeometry(0.55, 4.6, 6, 16).rotateX(Math.PI / 2).scale(1, 1.05, 1), white, 0, 1.6, 0);
  b.add(new THREE.CylinderGeometry(0.56, 0.56, 0.5, 16).rotateX(Math.PI / 2), orange, 0, 1.6, 1.6);
  b.add(new THREE.ConeGeometry(0.3, 0.5, 14).rotateX(Math.PI / 2), orange, 0, 1.6, 3.05); // spinner
  b.add(new THREE.SphereGeometry(0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.75, 1.5), glass, 0, 2.05, 0.4); // canopy
  // High wing with orange tips, struts.
  b.add(new THREE.BoxGeometry(10.5, 0.14, 1.5), white, 0, 2.55, 0.5);
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(1.2, 0.15, 1.52), orange, s * 4.7, 2.56, 0.5);
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), metal, s * 1.6, 1.85, 0.5, 0, 0, s * 1.05);
  }
  // Tail: fin, stabilizer.
  b.add(new THREE.BoxGeometry(0.1, 1.3, 1.1), orange, 0, 2.4, -2.7, 0.35, 0, 0);
  b.add(new THREE.BoxGeometry(3.4, 0.1, 0.9), white, 0, 1.75, -2.75);
  // Stripe and gear.
  b.add(new THREE.BoxGeometry(1.13, 0.16, 3.2), orange, 0, 1.45, -0.3);
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), metal, s * 0.55, 0.85, 0.9, 0, 0, s * -0.4);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), metal, 0, 0.75, -2.4);
  b.build(group);
  const wheels: Model['wheels'] = [];
  for (const [x, z, r] of [[-0.85, 0.9, 0.3], [0.85, 0.9, 0.3], [0, -2.4, 0.15]] as const) {
    const w = wheel(b, r, 0.16, dark, metal);
    w.position.set(x, r, z);
    group.add(w);
    wheels.push({ obj: w, r });
  }
  const prop = new THREE.Group();
  prop.add(b.mesh(new THREE.BoxGeometry(2.3, 0.18, 0.06), dark));
  prop.add(b.mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.01, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false })));
  prop.position.set(0, 1.6, 3.05);
  group.add(prop);
  return { group, wheels, parts: { prop, blur: prop.children[1] }, dispose: b.dispose };
}

export function kayakModel(): Model {
  const b = builder(), group = new THREE.Group();
  const hull = std(0xd8432f, 0.45), dark = std(0x23262b, 0.8), yellow = std(0xf0c24a, 0.5), black = std(0x1c1e22, 0.6);
  b.add(new THREE.CapsuleGeometry(0.33, 3.0, 6, 14).rotateX(Math.PI / 2).scale(1, 0.55, 1), hull, 0, 0.12, 0);
  b.add(new THREE.TorusGeometry(0.3, 0.05, 8, 20).rotateX(Math.PI / 2).scale(1, 1, 1.4), dark, 0, 0.3, -0.15);
  b.add(new THREE.CylinderGeometry(0.29, 0.29, 0.03, 18).scale(1, 1, 1.4), black, 0, 0.27, -0.15);
  b.build(group);
  // Paddle, held across in front of the paddler; the vehicle rocks it side to side.
  const paddle = new THREE.Group();
  paddle.add(b.mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 8).rotateZ(Math.PI / 2), black));
  for (const s of [-1, 1]) paddle.add(b.mesh(new THREE.BoxGeometry(0.4, 0.02, 0.18).translate(s * 1.25, 0, 0).rotateX(s * 0.6), yellow));
  paddle.position.set(0, 0.72, 0.12);
  group.add(paddle);
  return { group, wheels: [], parts: { paddle }, dispose: b.dispose };
}

export function boatModel(): Model {
  const b = builder(), group = new THREE.Group();
  const hull = std(0xf2efe8, 0.45), stripe = std(0xc94a35, 0.5), dark = std(0x2a2d33, 0.7), wood = std(0xa77b52, 0.8), glass = std(0x9fc6dc, 0.15, 0.3);
  // A little runabout: tapered hull, a bench, a windscreen and an outboard at the back.
  const shape = new THREE.Shape();
  shape.moveTo(-0.9, -2.1); shape.lineTo(0.9, -2.1); shape.lineTo(0.95, 0.9); shape.quadraticCurveTo(0.6, 2.2, 0, 2.5); shape.quadraticCurveTo(-0.6, 2.2, -0.95, 0.9); shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.75, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.85, 0);
  b.add(hullGeo, hull, 0, -0.1, 0);
  b.add(new THREE.BoxGeometry(1.92, 0.14, 4.0), stripe, 0, 0.55, -0.1);
  b.add(new THREE.BoxGeometry(1.6, 0.08, 3.6), wood, 0, 0.72, -0.2);
  b.add(new THREE.BoxGeometry(1.4, 0.32, 0.5), wood, 0, 0.92, -1.2);
  b.add(new THREE.BoxGeometry(1.5, 0.45, 0.04), glass, 0, 1.1, 0.75, -0.4);
  b.add(new THREE.BoxGeometry(0.4, 0.6, 0.45), dark, 0, 0.95, -2.25);
  b.add(new THREE.BoxGeometry(0.12, 0.7, 0.14), dark, 0, 0.35, -2.3);
  b.build(group);
  return { group, wheels: [], parts: {}, dispose: b.dispose };
}

/**
 * A space shuttle orbiter, about 0.6 scale (22 m long): white fuselage and delta wings, black nose
 * and belly, a tall fin, OMS pods and three main engines whose flames the vehicle scales.
 */
export function shuttleModel(): Model {
  const b = builder(), group = new THREE.Group();
  const white = std(0xeeece6, 0.5), black = std(0x26282c, 0.7), grey = std(0x9a9ea4, 0.45, 0.4), glass = std(0x1e2a36, 0.1, 0.4);
  const bell = std(0x3a3d42, 0.35, 0.7);
  // The wings are one shape mirrored, so their faces must show from both sides.
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.5, side: THREE.DoubleSide });
  const Y = 2.6; // fuselage axis height on its gear
  // Fuselage along Z with a rounded nose, a payload-bay seam and a black chin.
  b.add(new THREE.CylinderGeometry(1.55, 1.6, 14, 20).rotateX(Math.PI / 2), white, 0, Y, -1);
  b.add(new THREE.SphereGeometry(1.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.95, 2.6), white, 0, Y, 6);
  b.add(new THREE.SphereGeometry(1.56, 20, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38).rotateX(Math.PI / 2).scale(1, 0.95, 2.62), black, 0, Y, 6);
  b.add(new THREE.BoxGeometry(2.7, 0.06, 9), grey, 0, Y + 1.5, -1.5);
  // Cockpit windows.
  for (const s of [-1, 0, 1]) b.add(new THREE.BoxGeometry(0.55, 0.32, 0.06), glass, s * 0.62, Y + 1.25, 7.2, -0.75, s * -0.25, 0);
  // Delta wings with black leading edges (a flat shape, extruded thin).
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 4.5); wingShape.lineTo(1.2, 2.2); wingShape.lineTo(7.4, -5.6); wingShape.lineTo(7.4, -7.2); wingShape.lineTo(0, -7.6); wingShape.closePath();
  for (const s of [-1, 1]) {
    // Shape x runs outboard, y forward; extruded downward 0.32 m.
    const wg = new THREE.ExtrudeGeometry(wingShape, { depth: 0.32, bevelEnabled: false }).rotateX(Math.PI / 2).scale(s, 1, 1);
    b.add(wg, wingMat, s * 0.9, Y - 0.85, -0.2);
    b.add(new THREE.BoxGeometry(6.6, 0.12, 0.9), grey, s * 4.6, Y - 0.9, -7.4); // elevons
  }
  // Black belly.
  b.add(new THREE.BoxGeometry(3.0, 0.1, 13.5), black, 0, Y - 1.45, -1.2);
  // Fin and rudder.
  const fin = new THREE.Shape();
  // Shape x runs aft from the fin's root leading edge, y up; the leading edge sweeps back.
  fin.moveTo(0, 0); fin.lineTo(4.6, 0); fin.lineTo(4.4, 6.2); fin.lineTo(3.0, 6.2); fin.closePath();
  b.add(new THREE.ExtrudeGeometry(fin, { depth: 0.36, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-0.18, 0, 0), wingMat, 0, Y + 1.1, -3.9);
  b.add(new THREE.BoxGeometry(0.42, 6.0, 0.35), grey, 0, Y + 4.2, -8.3); // rudder hinge line
  // OMS pods and the engine block.
  for (const s of [-1, 1]) b.add(new THREE.CapsuleGeometry(0.62, 3.2, 4, 12).rotateX(Math.PI / 2), white, s * 1.25, Y + 1.25, -6.6);
  b.add(new THREE.BoxGeometry(3.2, 3.0, 1.0), grey, 0, Y + 0.1, -8.4);
  const engines: [number, number][] = [[0, 0.95], [-0.95, -0.5], [0.95, -0.5]];
  for (const [x, y] of engines) b.add(new THREE.CylinderGeometry(0.5, 0.85, 1.6, 16, 1, true).rotateX(-Math.PI / 2), bell, x, Y + y, -9.6);
  // Landing gear.
  for (const [x, z] of [[-1.5, -2.5], [1.5, -2.5], [0, 5.2]] as const) b.add(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), grey, x, 0.6, z);
  b.build(group);
  const wheels: Model['wheels'] = [];
  for (const [x, z] of [[-1.5, -2.5], [1.5, -2.5], [0, 5.2]] as const) {
    const w = wheel(b, 0.42, 0.3, black, grey);
    w.position.set(x, 0.42, z);
    group.add(w);
    wheels.push({ obj: w, r: 0.42 });
  }
  // Main-engine flames: a white-hot core in a long orange jet, scaled by the vehicle with throttle.
  const flames = new THREE.Group();
  const outer = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const inner = new THREE.MeshBasicMaterial({ color: 0xfff3c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const og = new THREE.ConeGeometry(0.78, 1, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
  const ig = new THREE.ConeGeometry(0.42, 0.55, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.275);
  for (const [x, y] of engines) {
    const f = new THREE.Group();
    f.add(new THREE.Mesh(og, outer), new THREE.Mesh(ig, inner));
    f.position.set(x, Y + y, -10.3);
    flames.add(f);
  }
  const glowLight = new THREE.PointLight(0xff9a4a, 0, 60, 2);
  glowLight.position.set(0, Y, -12);
  flames.add(glowLight);
  group.add(flames);
  const dispose = () => { b.dispose(); og.dispose(); ig.dispose(); outer.dispose(); inner.dispose(); glowLight.dispose(); };
  return { group, wheels, parts: { flames, glow: glowLight }, dispose };
}
