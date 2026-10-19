// The horizon: coarse terrain with satellite imagery in a wide ring around the player.
import * as THREE from 'three';
import type { GeoFrame } from './frame.ts';
import type { Pool } from './pool.ts';
import type { FarOut } from './build/far.ts';
import { meshGeometry } from './chunks.ts';
import { farMaterial } from './style.ts';

const FZ = 12;

export class FarTerrain {
  group = new THREE.Group();
  private tiles = new Map<string, THREE.Mesh>();
  private loading = new Set<string>();
  private want = new Set<string>();
  radius = 2;

  constructor(private frame: GeoFrame, private e0: number, private pool: Pool) {}

  update(p: THREE.Vector3, agl: number) {
    const c = this.frame.tileAt(FZ, p.x, p.z);
    const R = agl > 600 ? 3 : this.radius;
    const next = new Set<string>();
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) next.add(`${c.tx + dx},${c.ty + dy}`);
    this.want = next;
    for (const key of next) {
      if (this.tiles.has(key) || this.loading.has(key)) continue;
      const [tx, ty] = key.split(',').map(Number);
      this.loading.add(key);
      const rect = this.frame.tileRect(FZ, tx, ty);
      this.pool.far({ z: FZ, tx, ty, k: this.frame.k, e0: this.e0 },
        () => 4000 + Math.hypot(rect.x0 + rect.size / 2 - p.x, rect.z0 + rect.size / 2 - p.z),
        () => this.want.has(key))
        .then((o) => { this.loading.delete(key); if (this.want.has(key)) this.install(key, o); else o.tex?.close(); })
        .catch(() => this.loading.delete(key));
    }
    for (const [key, m] of this.tiles) if (!next.has(key)) this.drop(key, m);
  }

  private install(key: string, o: FarOut) {
    let tex: THREE.Texture | null = null;
    if (o.tex) {
      tex = new THREE.Texture(o.tex as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
    }
    const m = new THREE.Mesh(meshGeometry(o.ground), farMaterial(tex));
    const r = this.frame.tileRect(o.z, o.tx, o.ty);
    // Slightly below the detailed ground so seams never show it on top.
    m.position.set(r.x0, -1.5, r.z0);
    m.receiveShadow = false;
    m.renderOrder = -1;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.tiles.set(key, m);
    this.group.add(m);
  }

  private drop(key: string, m: THREE.Mesh) {
    this.group.remove(m);
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.tiles.delete(key);
  }

  dispose() { for (const [k, m] of [...this.tiles]) this.drop(k, m); this.want.clear(); }
}
