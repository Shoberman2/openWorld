import type * as THREE from 'three';
import type { MapSource, Site } from '../place.ts';

/** Rotating circular minimap (M toggles a large north-up map with labels). */
export class Minimap {
  private el = document.getElementById('minimap') as HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private scale: number;
  big = false;
  waypoint: { x: number; z: number; name: string } | null = null;
  private tx: (x: number) => number;
  private tz: (z: number) => number;

  constructor(private src: MapSource, private sites: Site[]) {
    const L = src.bounds, pad = 500;
    const w = L.maxX - L.minX + pad * 2, d = L.maxZ - L.minZ + pad * 2;
    this.scale = 2048 / Math.max(w, d);
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil(w * this.scale);
    this.base.height = Math.ceil(d * this.scale);
    const g = this.base.getContext('2d')!;
    const k = this.scale;
    this.tx = (x: number) => (x - L.minX + pad) * k;
    this.tz = src.zSouth > 0 ? (z: number) => (z - L.minZ + pad) * k : (z: number) => (L.maxZ + pad - z) * k;
    g.fillStyle = src.background;
    g.fillRect(0, 0, this.base.width, this.base.height);
    src.draw(g, this.tx, this.tz, k);
  }

  toggle() {
    this.big = !this.big;
    this.el.classList.toggle('big', this.big);
    const s = this.big ? Math.min(window.innerHeight * 0.8, window.innerWidth * 0.9) : 220;
    this.el.width = this.el.height = Math.round(s * Math.min(devicePixelRatio, 2));
  }

  /** Canvas angle of the player's facing (0 = up on the map). */
  private angle(yaw: number) {
    // World forward is (sin yaw, cos yaw) in x/z; on canvas z maps to +y when zSouth, -y otherwise.
    const cx = Math.sin(yaw), cy = Math.cos(yaw) * this.src.zSouth;
    return Math.atan2(cx, -cy);
  }

  draw(pos: THREE.Vector3, yaw: number) {
    const c = this.el, g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.save();
    g.clearRect(0, 0, W, H);
    const px = this.tx(pos.x), pz = this.tz(pos.z);
    const a = this.angle(yaw);
    if (this.big) {
      const k = Math.min(W / this.base.width, H / this.base.height) * 1.6;
      g.translate(W / 2, H / 2); g.scale(k, k);
      g.translate(-this.base.width / 2, -this.base.height / 2);
      g.drawImage(this.base, 0, 0);
      g.textAlign = 'center';
      // Names for the big buildings (skipping any that would overlap one already drawn); dots for the rest.
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const s of this.sites) {
        const x = this.tx(s.center.x), y = this.tz(s.center.z);
        g.fillStyle = s.repo.brandColor || '#ffcc33';
        g.beginPath(); g.arc(x, y, 4 / k, 0, Math.PI * 2); g.fill();
        if (s.repo.tier === 'small' || s.repo.tier === 'midrise') continue;
        const size = (s.repo.tier === 'landmark' ? 20 : 14) / k * 1.3;
        g.font = `600 ${size}px Inter, sans-serif`;
        const w = g.measureText(s.repo.name).width, box = { x: x - w / 2, y: y - size - 6 / k, w, h: size };
        if (placed.some((p) => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h)) continue;
        placed.push(box);
        g.fillStyle = '#fff';
        g.fillText(s.repo.name, x, y - 6 / k);
      }
      this.drawMarkers(g, px, pz, a, 1 / k * 2);
    } else {
      const zoom = 1.6 * (W / 220);
      g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip();
      g.translate(W / 2, H / 2);
      g.rotate(-a);
      g.scale(zoom, zoom);
      g.translate(-px, -pz);
      g.drawImage(this.base, 0, 0);
      this.drawMarkers(g, px, pz, a, 1 / zoom * 1.4);
    }
    g.restore();
  }

  private drawMarkers(g: CanvasRenderingContext2D, px: number, pz: number, a: number, k: number) {
    if (this.waypoint) {
      const wx = this.tx(this.waypoint.x), wz = this.tz(this.waypoint.z);
      g.strokeStyle = '#ffcc33'; g.lineWidth = 3 * k; g.setLineDash([8 * k, 6 * k]);
      g.beginPath(); g.moveTo(px, pz); g.lineTo(wx, wz); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(wx, wz, 9 * k, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(px, pz);
    g.rotate(a);
    g.fillStyle = '#4fd1ff';
    g.beginPath(); g.moveTo(0, -12 * k); g.lineTo(8 * k, 9 * k); g.lineTo(0, 4 * k); g.lineTo(-8 * k, 9 * k); g.closePath(); g.fill();
    g.restore();
  }
}
