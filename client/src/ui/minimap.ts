import type { Layout } from '../city/layout.ts';
import type * as THREE from 'three';

/** Rotating circular minimap (M toggles a large north-up map with labels). */
export class Minimap {
  private el = document.getElementById('minimap') as HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private scale: number;
  big = false;
  waypoint: { x: number; z: number; name: string } | null = null;

  constructor(private l: Layout) {
    const L = l.land, pad = 500;
    const w = L.maxX - L.minX + pad * 2, d = L.maxZ - L.minZ + pad * 2;
    this.scale = 2048 / Math.max(w, d);
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil(w * this.scale);
    this.base.height = Math.ceil(d * this.scale);
    const g = this.base.getContext('2d')!;
    const tx = (x: number) => (x - L.minX + pad) * this.scale, tz = (z: number) => (L.maxZ + pad - z) * this.scale;
    g.fillStyle = l.profile.water.length ? '#16324a' : '#1a1e26';
    g.fillRect(0, 0, this.base.width, this.base.height);
    g.fillStyle = '#2c313b';
    g.fillRect(tx(L.minX), tz(L.maxZ), (L.maxX - L.minX) * this.scale, (L.maxZ - L.minZ) * this.scale);
    for (const b of l.blocks) {
      g.fillStyle = b.park ? '#2f5a34' : '#4a505c';
      g.fillRect(tx(b.x0), tz(b.z1), (b.x1 - b.x0) * this.scale, (b.z1 - b.z0) * this.scale);
    }
    for (const lot of l.lots) {
      g.fillStyle = lot.repo ? lot.repo.brandColor || '#ffcc33' : `rgba(110,118,132,${0.4 + Math.min(lot.height, 200) / 400})`;
      g.fillRect(tx(lot.x0) + 1, tz(lot.z1) + 1, (lot.x1 - lot.x0) * this.scale - 2, (lot.z1 - lot.z0) * this.scale - 2);
    }
    this.tx = tx; this.tz = tz;
  }
  private tx: (x: number) => number;
  private tz: (z: number) => number;

  toggle() {
    this.big = !this.big;
    this.el.classList.toggle('big', this.big);
    const s = this.big ? Math.min(window.innerHeight * 0.8, window.innerWidth * 0.9) : 220;
    this.el.width = this.el.height = Math.round(s * Math.min(devicePixelRatio, 2));
  }

  draw(pos: THREE.Vector3, yaw: number) {
    const c = this.el, g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.save();
    g.clearRect(0, 0, W, H);
    const px = this.tx(pos.x), pz = this.tz(pos.z);
    if (this.big) {
      const k = Math.min(W / this.base.width, H / this.base.height) * 1.6;
      g.translate(W / 2, H / 2); g.scale(k, k);
      const cx = this.base.width / 2, cz = this.base.height / 2;
      g.translate(-cx, -cz);
      g.drawImage(this.base, 0, 0);
      g.font = `${600 / k / 50}px Inter, sans-serif`;
      g.textAlign = 'center';
      for (const s of this.l.sites) {
        if (s.repo.tier === 'small') continue;
        g.fillStyle = '#fff';
        g.font = `600 ${(s.repo.tier === 'landmark' ? 22 : 15) / k * 1.3}px Inter, sans-serif`;
        g.fillText(s.repo.name, this.tx((s.lot.x0 + s.lot.x1) / 2), this.tz((s.lot.z0 + s.lot.z1) / 2));
      }
      this.drawMarkers(g, px, pz, yaw, 1 / k * 2);
    } else {
      const zoom = 1.6 * (W / 220);
      g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip();
      g.translate(W / 2, H / 2);
      g.rotate(-yaw);
      g.scale(zoom, zoom);
      g.translate(-px, -pz);
      g.drawImage(this.base, 0, 0);
      this.drawMarkers(g, px, pz, yaw, 1 / zoom * 1.4, true);
    }
    g.restore();
  }

  private drawMarkers(g: CanvasRenderingContext2D, px: number, pz: number, yaw: number, k: number, rotating = false) {
    if (this.waypoint) {
      const wx = this.tx(this.waypoint.x), wz = this.tz(this.waypoint.z);
      g.strokeStyle = '#ffcc33'; g.lineWidth = 3 * k; g.setLineDash([8 * k, 6 * k]);
      g.beginPath(); g.moveTo(px, pz); g.lineTo(wx, wz); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(wx, wz, 9 * k, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(px, pz);
    g.rotate(yaw);
    g.fillStyle = '#4fd1ff';
    g.beginPath(); g.moveTo(0, -12 * k); g.lineTo(8 * k, 9 * k); g.lineTo(0, 4 * k); g.lineTo(-8 * k, 9 * k); g.closePath(); g.fill();
    g.restore();
    void rotating;
  }
}
