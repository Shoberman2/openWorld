/// <reference types="vite/client" />
// Heading-up minimap in the bottom-right corner: the light street map around you, your arrow in the
// middle, a north marker on the rim, project HQs as colored dots and a dashed line to the waypoint.
import type { TileMap } from './tilemap.ts';
import './hud.css';

export interface MapMarker { lat: number; lon: number; color: string; label?: string; big?: boolean }

export class EarthMinimap {
  readonly canvas: HTMLCanvasElement;
  /** Map zoom; raise it when walking, lower it when flying fast. */
  zoom = 16.2;
  private size = 176;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private lastKey = '';
  private visible = true;

  constructor(private map: TileMap) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ow-minimap';
    (document.getElementById('hud') ?? document.body).appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.size = window.innerWidth < 700 ? 120 : 176;
    this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.canvas.width = this.canvas.height = Math.round(this.size * this.dpr);
    this.lastKey = '';
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.canvas.style.display = on ? '' : 'none';
  }

  draw(lat: number, lon: number, headingDeg: number, markers: MapMarker[], waypoint: { lat: number; lon: number; name: string } | null) {
    if (!this.visible) return;
    // Skip redraws when nothing visibly moved (most frames while standing still).
    const key = `${lat.toFixed(6)},${lon.toFixed(6)},${headingDeg.toFixed(1)},${this.zoom.toFixed(2)},${waypoint?.lat ?? ''},${markers.length}`;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    const cx = W / 2, cy = H / 2;
    if (key === this.lastKey) return;
    const rot = (headingDeg * Math.PI) / 180;
    this.map.labels = false;
    const done = this.map.draw(g, lat, lon, this.zoom, cx, cy, rot, d);
    this.map.labels = true;
    this.lastKey = done ? key : '';

    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const toScreen = (la: number, lo: number) => {
      const p = this.map.project(la, lo, lat, lon, this.zoom);
      const x = p.x * d, y = p.y * d;
      return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
    };
    const clampToRim = (p: { x: number; y: number }, inset: number) => {
      const dx = p.x - cx, dy = p.y - cy;
      const m = Math.max(Math.abs(dx) / (W / 2 - inset), Math.abs(dy) / (H / 2 - inset));
      return m > 1 ? { x: cx + dx / m, y: cy + dy / m, clamped: true } : { ...p, clamped: false };
    };

    // Project HQs.
    for (const m of markers) {
      const p = toScreen(m.lat, m.lon);
      if (p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) continue;
      g.beginPath();
      g.arc(p.x, p.y, (m.big ? 5 : 3.5) * d, 0, Math.PI * 2);
      g.fillStyle = m.color;
      g.fill();
      g.lineWidth = 1.5 * d;
      g.strokeStyle = '#fff';
      g.stroke();
    }

    // Waypoint: dashed red route line and a pin (pinned to the rim when off-map).
    if (waypoint) {
      const raw = toScreen(waypoint.lat, waypoint.lon);
      const p = clampToRim(raw, 10 * d);
      g.save();
      g.setLineDash([5 * d, 4 * d]);
      g.strokeStyle = '#e8432e';
      g.lineWidth = 2.5 * d;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke();
      g.restore();
      g.beginPath();
      g.arc(p.x, p.y, 6 * d, 0, Math.PI * 2);
      g.fillStyle = '#ff5a1f';
      g.fill();
      g.lineWidth = 2 * d; g.strokeStyle = '#fff'; g.stroke();
    }

    // You: blue arrow pointing up (the map turns, you don't).
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.moveTo(0, -9 * d); g.lineTo(7 * d, 8 * d); g.lineTo(0, 4 * d); g.lineTo(-7 * d, 8 * d); g.closePath();
    g.fillStyle = '#1f7cf2';
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 3 * d;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 1.5 * d; g.strokeStyle = '#fff'; g.stroke();
    g.restore();

    // North marker riding the rim.
    const n = clampToRim({ x: cx + Math.sin(-rot) * W, y: cy - Math.cos(-rot) * H }, 13 * d);
    g.beginPath();
    g.arc(n.x, n.y, 9 * d, 0, Math.PI * 2);
    g.fillStyle = '#3a3a3c'; g.fill();
    g.fillStyle = '#fff';
    g.font = `700 ${10 * d}px Inter, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', n.x, n.y + 0.5 * d);
  }
}
