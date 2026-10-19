import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function paint(g: THREE.BufferGeometry, c: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

/** A narrow-body airliner, ~38 m long, nose toward +Z. */
function airliner(livery: number) {
  const white = 0xf2f4f7;
  const wing = new THREE.BoxGeometry(34, 0.5, 5.5);
  const wp = wing.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i), k = Math.abs(x) / 17;
    wp.setZ(i, wp.getZ(i) * (1 - 0.6 * k) - k * 5.5); // taper + sweep
    wp.setY(i, wp.getY(i) + k * 1.2); // dihedral
  }
  const stab = new THREE.BoxGeometry(12, 0.35, 3);
  const sp = stab.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) { const k = Math.abs(sp.getX(i)) / 6; sp.setZ(i, sp.getZ(i) * (1 - 0.5 * k) - k * 2.5); }
  const fin = new THREE.BoxGeometry(0.4, 7, 5);
  const fp = fin.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) { const k = (fp.getY(i) + 3.5) / 7; fp.setZ(i, fp.getZ(i) * (1 - 0.5 * k) - k * 3.5); }
  return mergeGeometries([
    paint(new THREE.CapsuleGeometry(1.9, 32, 6, 14).rotateX(Math.PI / 2), white),
    paint(new THREE.CylinderGeometry(1.93, 1.93, 26, 14, 1, true).rotateX(Math.PI / 2).translate(0, -0.55, 0).scale(1, 0.35, 1), livery),
    paint(wing.translate(0, -0.9, 1), white),
    paint(stab.translate(0, 0.6, -16), white),
    paint(fin.translate(0, 4.6, -15), livery),
    paint(new THREE.CylinderGeometry(0.95, 0.85, 4.2, 12).rotateX(Math.PI / 2).translate(-6.2, -1.9, 3.5), 0xc9ccd1),
    paint(new THREE.CylinderGeometry(0.95, 0.85, 4.2, 12).rotateX(Math.PI / 2).translate(6.2, -1.9, 3.5), 0xc9ccd1),
    paint(new THREE.BoxGeometry(2.6, 0.4, 0.8).translate(0, 0.9, 16.4), 0x101820), // cockpit windows
  ]);
}

function helicopter() {
  return mergeGeometries([
    paint(new THREE.CapsuleGeometry(1.2, 3, 4, 10).rotateX(Math.PI / 2), 0x1d3557),
    paint(new THREE.BoxGeometry(0.4, 0.4, 6).translate(0, 0.4, -4.5), 0x1d3557),
    paint(new THREE.BoxGeometry(0.15, 1.6, 0.8).translate(0, 1, -7.4), 0x1d3557),
    paint(new THREE.BoxGeometry(1.8, 0.6, 1.2).translate(0, 0.3, 1.6), 0x0e1720),
    paint(new THREE.BoxGeometry(0.1, 0.1, 3).translate(-0.9, -1.4, 0), 0x222222),
    paint(new THREE.BoxGeometry(0.1, 0.1, 3).translate(0.9, -1.4, 0), 0x222222),
  ]);
}

interface Flight {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  strobe: THREE.Mesh;
  trail: THREE.Mesh | null;
}

export class Aircraft {
  group = new THREE.Group();
  private flights: Flight[] = [];
  private helis: { obj: THREE.Group; rotor: THREE.Mesh; center: THREE.Vector3; r: number; a: number; h: number; speed: number }[] = [];
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 });
  private time = 0;
  private center: THREE.Vector3;
  private radius: number;

  constructor(land: { minX: number; maxX: number; minZ: number; maxZ: number }, planes = 4) {
    this.center = new THREE.Vector3((land.minX + land.maxX) / 2, 0, (land.minZ + land.maxZ) / 2);
    this.radius = Math.max(land.maxX - land.minX, land.maxZ - land.minZ);
    const liveries = [0x0b3d91, 0xc8102e, 0x00a1de, 0x5b2c83, 0x1f7a3a];
    for (let i = 0; i < planes; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(airliner(liveries[i % liveries.length]), this.mat);
      body.castShadow = true;
      g.add(body);
      const red = navLight(0xff2020), green = navLight(0x20ff40), strobe = navLight(0xffffff);
      red.position.set(-17, 0.5, -4.5); green.position.set(17, 0.5, -4.5); strobe.position.set(0, -2, 0);
      g.add(red, green, strobe);
      let trail: THREE.Mesh | null = null;
      if (i % 2 === 0) {
        trail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 420).rotateX(-Math.PI / 2).translate(0, 0, -230), contrailMat());
        g.add(trail);
      }
      this.group.add(g);
      const f: Flight = { mesh: g, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, strobe, trail };
      this.route(f, Math.random());
      this.flights.push(f);
    }
    for (let i = 0; i < 2; i++) {
      const obj = new THREE.Group();
      obj.add(new THREE.Mesh(helicopter(), this.mat));
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
      rotor.position.y = 1.6;
      obj.add(rotor);
      const blink = navLight(0xff2020); blink.position.set(0, -1.6, 0); obj.add(blink);
      this.group.add(obj);
      this.helis.push({ obj, rotor, center: this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 300, 0, (Math.random() - 0.5) * 300)), r: 160 + Math.random() * 160, a: Math.random() * 6, h: 140 + Math.random() * 90, speed: 0.05 + Math.random() * 0.03 });
    }
  }

  /** Pick a straight path across the sky; low ones descend toward an "airport" off-map. */
  private route(f: Flight, progress = 0) {
    const ang = Math.random() * Math.PI * 2;
    const R = this.radius * 1.6 + 900;
    const off = (Math.random() - 0.5) * this.radius;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const low = Math.random() < 0.5;
    const h0 = low ? 380 + Math.random() * 120 : 750 + Math.random() * 500;
    const h1 = low ? h0 - 220 : h0;
    f.from.copy(this.center).addScaledVector(dir, -R).addScaledVector(perp, off).setY(h0);
    f.to.copy(this.center).addScaledVector(dir, R).addScaledVector(perp, off).setY(h1);
    const speed = low ? 75 : 210;
    f.dur = f.from.distanceTo(f.to) / speed;
    f.t = progress * f.dur;
    if (f.trail) f.trail.visible = !low;
  }

  update(dt: number) {
    this.time += dt;
    for (const f of this.flights) {
      f.t += dt;
      if (f.t > f.dur) this.route(f);
      const k = f.t / f.dur;
      f.mesh.position.lerpVectors(f.from, f.to, k);
      const ahead = new THREE.Vector3().subVectors(f.to, f.from).normalize();
      f.mesh.lookAt(f.mesh.position.clone().add(ahead));
      f.strobe.visible = (this.time * 1.1) % 1 < 0.08;
    }
    for (const h of this.helis) {
      h.a += h.speed * dt;
      const x = h.center.x + Math.cos(h.a) * h.r, z = h.center.z + Math.sin(h.a) * h.r;
      h.obj.position.set(x, h.h + Math.sin(this.time * 0.5) * 3, z);
      h.obj.rotation.set(0.12, -h.a, 0.18);
      h.rotor.rotation.y += dt * 40;
    }
  }

  /** Distance from a point to the nearest aircraft (for engine sound). */
  nearest(p: THREE.Vector3) {
    let d = Infinity;
    for (const f of this.flights) d = Math.min(d, f.mesh.position.distanceTo(p));
    for (const h of this.helis) d = Math.min(d, h.obj.position.distanceTo(p) * 0.6);
    return d;
  }
}

function navLight(c: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  return m;
}

function contrailMat() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.85, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
}
