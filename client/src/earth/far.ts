// The horizon: coarse terrain with satellite imagery in rings around the player. A z12 ring always
// (the city's surroundings), and once you're up high a z9 ring underneath it that reaches a couple of
// hundred kilometers, so from a shuttle you see coastlines and mountain ranges, not a fog wall.
// Both bend down with the Earth's curvature away from the camera.
import * as THREE from 'three';
import type { GeoFrame } from './frame.ts';
import type { Pool } from './pool.ts';
import type { FarOut } from './build/far.ts';
import { meshGeometry } from './chunks.ts';
import { farMaterial } from './style.ts';

/** 1 / (2 · Earth radius): a point d meters away sits d²·k lower than the tangent plane. */
const CURVE = 1 / (2 * 6371000);

interface Ring {
  z: number;
  /** Tiles out from the center tile (-1: none), for an altitude and a ground speed (m/s). */
  radius: (agl: number, speed: number) => number;
  /** How far below the ring above it this one sits, so the sharper ring always wins. */
  drop: number;
  tiles: Map<string, THREE.Mesh>;
  loading: Set<string>;
  want: Set<string>;
}

export class FarTerrain {
  group = new THREE.Group();
  private rings: Ring[];
  /** Base radius of the near ring in tiles (VR and ?q=low set 1). */
  radius = 2;

  constructor(private frame: GeoFrame, private e0: number, private pool: Pool) {
    const ring = (z: number, radius: Ring['radius'], drop: number): Ring => ({ z, radius, drop, tiles: new Map(), loading: new Set(), want: new Set() });
    this.rings = [
      // Not when you're crossing a tile a second (autopilot at 40×): it would only fetch what you've passed.
      ring(12, (agl, sp) => (sp > 1500 ? -1 : agl > 2500 ? Math.max(this.radius, 4) : agl > 600 ? Math.max(this.radius, 3) : this.radius), 1.5),
      // Only worth it once you can see that far: from ~1.2 km up.
      ring(9, (agl, sp) => (agl <= 1200 ? -1 : sp > 6000 ? 1 : this.radius > 1 ? (agl > 5000 ? 3 : 2) : 1), 60),
      // At cruise altitude (and in autopilot, where you cover 30+ km a second) a coarse continental
      // ring keeps something under you while the sharper rings catch up.
      ring(7, (agl) => (agl > 4000 ? 2 : -1), 250),
    ];
  }

  /** Stream the rings around `lead` (where you'll be shortly), with distance priority from `p`. */
  update(p: THREE.Vector3, agl: number, lead: { x: number; z: number } = p, speed = 0) {
    for (const r of this.rings) this.updateRing(r, p, agl, lead, speed);
  }

  /**
   * The world re-centered (`map` takes old local coordinates to new, `s` = new k / old k): keep every
   * tile, just moved and rescaled, since the local frame is linear in mercator. Nothing reloads.
   */
  rebase(frame: GeoFrame, map: (v: THREE.Vector3) => void, s: number) {
    this.frame = frame;
    for (const r of this.rings) for (const m of r.tiles.values()) {
      map(m.position);
      m.scale.x *= s; m.scale.z *= s;
      m.updateMatrix();
    }
  }

  /** Tiles loading across all rings (for the streaming stats). */
  get pending() { return this.rings.reduce((n, r) => n + r.loading.size, 0); }

  private updateRing(ring: Ring, p: THREE.Vector3, agl: number, lead: { x: number; z: number }, speed: number) {
    const R = ring.radius(agl, speed);
    const next = new Set<string>();
    if (R >= 0) {
      const c = this.frame.tileAt(ring.z, lead.x, lead.z);
      const n = 2 ** ring.z;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const ty = c.ty + dy;
        if (ty < 0 || ty >= n) continue;
        next.add(`${c.tx + dx},${ty}`);
      }
    }
    ring.want = next;
    for (const key of next) {
      if (ring.tiles.has(key) || ring.loading.has(key)) continue;
      const [tx, ty] = key.split(',').map(Number);
      ring.loading.add(key);
      const rect = this.frame.tileRect(ring.z, tx, ty);
      const n = 2 ** ring.z;
      const frame = this.frame;
      this.pool.far({ z: ring.z, tx: ((tx % n) + n) % n, ty, k: frame.k, e0: this.e0 },
        // The coarse rings are cheap per area: the continental one first (it's what you see at speed),
        // then the near ring's closest tiles, then the rest.
        () => (ring.z < 9 ? 0 : ring.z < 12 ? 6000 : 4000) + Math.hypot(rect.x0 + rect.size / 2 - p.x, rect.z0 + rect.size / 2 - p.z) * (ring.z < 12 ? 0.05 : 1),
        () => ring.want.has(key))
        // Built for the frame it was asked in; if the world re-centered meanwhile, scale it across.
        .then((o) => { ring.loading.delete(key); if (ring.want.has(key)) this.install(ring, key, tx, ty, o, frame.k); else o.tex?.close(); })
        .catch(() => ring.loading.delete(key));
    }
    for (const [key, m] of ring.tiles) if (!next.has(key)) this.drop(ring, key, m);
  }

  private install(ring: Ring, key: string, tx: number, ty: number, o: FarOut, builtK = this.frame.k) {
    let tex: THREE.Texture | null = null;
    if (o.tex) {
      tex = new THREE.Texture(o.tex as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
    }
    const m = new THREE.Mesh(meshGeometry(o.ground), curved(farMaterial(tex)));
    // Placed by the unwrapped tile index, so a ring that crosses the antimeridian lines up.
    const r = this.frame.tileRect(o.z, tx, ty);
    // Slightly below the detailed ground so seams never show it on top; coarser rings lower still.
    m.position.set(r.x0, -ring.drop, r.z0);
    m.scale.set(this.frame.k / builtK, 1, this.frame.k / builtK);
    m.receiveShadow = false;
    m.renderOrder = -1 - (12 - ring.z);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    ring.tiles.set(key, m);
    this.group.add(m);
  }

  private drop(ring: Ring, key: string, m: THREE.Mesh) {
    this.group.remove(m);
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
    ring.tiles.delete(key);
  }

  dispose() {
    for (const r of this.rings) { for (const [k, m] of [...r.tiles]) this.drop(r, k, m); r.want.clear(); }
  }
}

/** Bend the terrain down with distance from the camera (on top of the far material's own shader). */
function curved(m: THREE.MeshStandardMaterial) {
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    inner.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `{
        vec4 cw = modelMatrix * vec4(transformed, 1.0);
        vec2 dd = cw.xz - cameraPosition.xz;
        transformed.y -= dot(dd, dd) * ${CURVE.toExponential(6)};
      }
      #include <project_vertex>`);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}-curved`;
  return m;
}
