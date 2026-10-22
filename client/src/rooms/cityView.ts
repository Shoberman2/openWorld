// What you see out of an interior's windows: the real city, rendered into a cube map from the spot
// inside the building at that floor's height. The interior uses it as its background (so every window
// looks out at the actual streets and skyline) and, prefiltered, as its environment (so polished floors
// and glass reflect them). One capture per floor, made when you arrive on it.
import * as THREE from 'three';

export interface CityViewShot {
  /** Cube map of the city around the capture point (linear HDR, like the scene it came from). */
  cube: THREE.Texture;
  /** The same, prefiltered for image-based lighting. */
  env: THREE.Texture;
  dispose(): void;
}

/** Captures the city scene from a world point. Returns null when there's no city to look at. */
export type CityViewFn = (x: number, y: number, z: number) => CityViewShot | null;

/** Where an interior sits in the world: interior (x, y, z) -> world, by a yaw about its origin. */
export interface CityViewPlacement {
  capture: CityViewFn;
  origin: THREE.Vector3; // world position of the interior's (0, 0, 0)
  yaw: number; // world yaw of the interior's +z axis (0 = world +z)
  /**
   * The real building's footprint (world x,z pairs). Interiors are laid out by their own plan, which
   * can reach past the real walls (out into the street or the next building); with a footprint the
   * capture is moved to a point safely inside it, keeping the floor's height.
   */
  footprint?: number[];
}

/** A point well inside a footprint ring: its centroid when that's inside, else the deepest of a grid of samples. */
export function insidePoint(ring: number[]): { x: number; z: number } {
  const n = ring.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
  cx /= n; cz /= n;
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const edgeDist = (x: number, z: number) => {
    let d = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2] - ax, bz = ring[i * 2 + 1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
      d = Math.min(d, Math.hypot(x - ax - bx * t, z - az - bz * t));
    }
    return d;
  };
  if (inside(cx, cz) && edgeDist(cx, cz) > 2) return { x: cx, z: cz };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, ring[i * 2]); x1 = Math.max(x1, ring[i * 2]); z0 = Math.min(z0, ring[i * 2 + 1]); z1 = Math.max(z1, ring[i * 2 + 1]); }
  let best = { x: cx, z: cz }, bestD = -1;
  for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
    const x = x0 + ((x1 - x0) * i) / 16, z = z0 + ((z1 - z0) * j) / 16;
    if (!inside(x, z)) continue;
    const d = edgeDist(x, z);
    if (d > bestD) { bestD = d; best = { x, z }; }
  }
  return best;
}

export function makeCityView(opts: {
  renderer: THREE.WebGLRenderer;
  pmrem: THREE.PMREMGenerator;
  scene: THREE.Scene;
  /** Things to hide while capturing (the player, the ride). */
  hide: () => THREE.Object3D[];
  /** Things that ride with the camera (sky dome, stars) and must be moved to the capture point. */
  follow: () => THREE.Object3D[];
  size: () => number;
}): CityViewFn {
  return (x, y, z) => {
    const size = opts.size();
    if (size <= 0) return null;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.5, 9000, rt);
    cam.position.set(x, y, z);
    const hidden = opts.hide().filter((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    const moved = opts.follow().map((o) => ({ o, p: o.position.clone() }));
    moved.forEach(({ o }) => o.position.set(x, y, z));
    const r = opts.renderer;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    cam.update(r, opts.scene);
    r.xr.enabled = prevXr;
    r.setRenderTarget(prevTarget);
    moved.forEach(({ o, p }) => o.position.copy(p));
    hidden.forEach((o) => { o.visible = true; });
    const envRT = opts.pmrem.fromCubemap(rt.texture);
    return {
      cube: rt.texture,
      env: envRT.texture,
      dispose() { rt.dispose(); envRT.dispose(); },
    };
  };
}

/**
 * Keeps one city-view shot per floor for an interior and applies the current floor's to the scene.
 * `at(f)` gives the capture point in interior coordinates.
 */
export class FloorViews {
  private shots = new Map<number, CityViewShot>();
  private cur = -1;
  private inside: { x: number; z: number } | undefined;
  /**
   * `envIntensity` null: the view is only the background, and the room keeps its own (even) light.
   * A capture's light swings with what it happens to see (sunlit pavement, a sun disk, the next
   * building's wall), so rooms lit by it change exposure floor to floor.
   */
  constructor(private scene: THREE.Scene, private place: CityViewPlacement | undefined, private at: (f: number) => THREE.Vector3, private envIntensity: number | null = 1) {
    if (place) {
      // Interior directions -> world directions: rotate by the placement's yaw.
      this.scene.backgroundRotation.set(0, place.yaw, 0);
      this.scene.environmentRotation.set(0, place.yaw, 0);
    }
  }
  get available() { return !!this.place; }
  /** Show floor f's view (capturing it the first time). Returns false when there's no city view. */
  show(f: number): boolean {
    if (!this.place) return false;
    if (f === this.cur) return true;
    let s = this.shots.get(f);
    if (!s) {
      const p = this.at(f).clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.place.yaw).add(this.place.origin);
      if (this.place.footprint) {
        this.inside ??= insidePoint(this.place.footprint);
        p.x = this.inside.x; p.z = this.inside.z;
      }
      s = this.place.capture(p.x, p.y, p.z) ?? undefined;
      if (!s) { this.place = undefined; return false; }
      this.shots.set(f, s);
      // Keep the neighbors' shots (the lift goes up and down); drop far ones.
      for (const [k, o] of this.shots) if (Math.abs(k - f) > 2) { o.dispose(); this.shots.delete(k); }
    }
    this.cur = f;
    this.scene.background = s.cube;
    if (this.envIntensity != null) {
      this.scene.environment = s.env;
      this.scene.environmentIntensity = this.envIntensity;
    }
    return true;
  }
  dispose() {
    for (const s of this.shots.values()) s.dispose();
    this.shots.clear();
    if (this.place) { this.scene.background = null; if (this.envIntensity != null) this.scene.environment = null; }
  }
}
