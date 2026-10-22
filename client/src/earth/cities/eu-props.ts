// Europe's street furniture (prop kinds 20–22, placed by build/chunk.ts): the Royal Mail pillar
// box, the red K6 telephone kiosk (Giles Gilbert Scott, 1935: 2.5 m tall, 0.91 m square, a domed
// roof, TELEPHONE signs), and the Paris Morris column (green cast iron, posters, a domed cap).
import * as THREE from 'three';

type Part = (g: THREE.BufferGeometry, c: number) => THREE.BufferGeometry;
type Merge = (parts: THREE.BufferGeometry[]) => THREE.BufferGeometry;

export function euProps(kinds: THREE.BufferGeometry[], part: Part, merge: Merge) {
  const RED = 0xc81e24, BLACK = 0x1c1c1e;
  // Pillar box: a red cast-iron cylinder on a black base, its cap and the posting slot.
  kinds[20] = merge([
    part(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16).translate(0, 0.06, 0), BLACK),
    part(new THREE.CylinderGeometry(0.28, 0.29, 1.25, 16).translate(0, 0.745, 0), RED),
    part(new THREE.CylinderGeometry(0.34, 0.3, 0.12, 16).translate(0, 1.43, 0), RED),
    part(new THREE.SphereGeometry(0.31, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 1.49, 0), RED),
    part(new THREE.BoxGeometry(0.26, 0.04, 0.05).translate(0, 1.2, 0.285), BLACK),
    part(new THREE.BoxGeometry(0.18, 0.12, 0.02).translate(0, 0.98, 0.29), 0xf2efe6),
  ]);
  // K6 kiosk: red cast iron, glazed on three sides in rows of small panes, the TELEPHONE signs, the dome.
  const k6: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(1.0, 0.1, 1.0).translate(0, 0.05, 0), RED),
    part(new THREE.BoxGeometry(0.91, 2.12, 0.91).translate(0, 1.16, 0), RED),
    part(new THREE.BoxGeometry(0.98, 0.18, 0.98).translate(0, 2.3, 0), RED),
    part(new THREE.CylinderGeometry(0.49, 0.49, 0.98, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.35, 1).translate(0, 2.39, 0), RED),
  ];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, rot = (g: THREE.BufferGeometry) => g.rotateY(a);
    // The sign box (lit white in the real thing) on all four sides.
    k6.push(part(rot(new THREE.BoxGeometry(0.62, 0.13, 0.02).translate(0, 2.08, 0.466)), 0xf3efe2));
    if (k === 3) continue; // the back is solid
    k6.push(part(rot(new THREE.BoxGeometry(0.66, 1.56, 0.02).translate(0, 1.18, 0.462)), 0x2e3a44));
    for (let r = 1; r < 8; r++) k6.push(part(rot(new THREE.BoxGeometry(0.66, 0.025, 0.03).translate(0, 0.4 + r * 0.195, 0.47)), RED));
    for (const x of [-0.11, 0.11]) k6.push(part(rot(new THREE.BoxGeometry(0.025, 1.56, 0.03).translate(x, 1.18, 0.47)), RED));
    // The crown above the sign.
    k6.push(part(rot(new THREE.BoxGeometry(0.16, 0.12, 0.02).translate(0, 2.47, 0.49)), 0xd9b23c));
  }
  kinds[21] = merge(k6);
  // Morris column: dark green base, a drum of posters, a frieze and the scalloped dome with its finial.
  const GREEN = 0x274536;
  const posters = [0xe8d9b8, 0xc8372d, 0x2f5f9a, 0xf0e6c8, 0xd6a43a, 0x1f1f22, 0xe6ddc8, 0x7a2e4a];
  const col: THREE.BufferGeometry[] = [
    part(new THREE.CylinderGeometry(0.72, 0.74, 0.5, 20).translate(0, 0.25, 0), GREEN),
    part(new THREE.CylinderGeometry(0.62, 0.62, 2.3, 20).translate(0, 1.65, 0), 0xdcd2bc),
    part(new THREE.CylinderGeometry(0.7, 0.66, 0.3, 20).translate(0, 2.95, 0), GREEN),
    part(new THREE.SphereGeometry(0.72, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 3.1, 0), GREEN),
    part(new THREE.CylinderGeometry(0.05, 0.1, 0.45, 8).translate(0, 3.75, 0), GREEN),
    part(new THREE.SphereGeometry(0.09, 8, 6).translate(0, 4.0, 0), GREEN),
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    col.push(part(new THREE.BoxGeometry(0.42, 1.5 + (k % 3) * 0.2, 0.02).translate(0, 1.6, 0.63).rotateY(a), posters[k]));
  }
  kinds[22] = merge(col);
}
