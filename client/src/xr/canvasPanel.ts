import * as THREE from 'three';

/** A clickable region on a panel, in canvas pixels. */
interface Hit { id: string; x: number; y: number; w: number; h: number; onClick: () => void }

export const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * A flat 2D panel for VR, drawn with the canvas API onto a texture (DOM doesn't render in a headset).
 * Buttons registered while drawing can be hit with a controller ray via `hitAt(uv)`.
 */
export class CanvasPanel {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  hover: string | null = null;
  private hits: Hit[] = [];

  constructor(readonly w: number, readonly h: number, widthM: number) {
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, fog: false, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, (widthM * h) / w), mat);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
  }

  /** Clear, draw, upload. */
  draw(fn: (p: CanvasPanel) => void) {
    this.hits = [];
    this.g.clearRect(0, 0, this.w, this.h);
    fn(this);
    this.texture.needsUpdate = true;
  }

  hitAt(uv: THREE.Vector2): Hit | null {
    const x = uv.x * this.w, y = (1 - uv.y) * this.h;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const b = this.hits[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // ------------------------------------------------------------- drawing helpers

  rect(x: number, y: number, w: number, h: number, r: number, fill: string) {
    const g = this.g;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fillStyle = fill;
    g.fill();
  }

  text(s: string, x: number, y: number, size: number, color = '#fff', weight = 500, align: CanvasTextAlign = 'left', maxW?: number) {
    const g = this.g;
    g.font = `${weight} ${size}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(maxW ? this.clip(s, maxW) : s, x, y);
  }

  /** Shorten to fit, with an ellipsis. Uses the current font. */
  clip(s: string, maxW: number) {
    const g = this.g;
    if (g.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    return s.slice(0, lo) + '…';
  }

  /** Word-wrap into lines no wider than maxW at this font size. */
  wrap(s: string, maxW: number, size: number, weight = 400) {
    const g = this.g;
    g.font = `${weight} ${size}px ${FONT}`;
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? `${line} ${word}` : word;
        if (g.measureText(next).width <= maxW || !line) line = next;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  button(id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, opts: { fill?: string; color?: string; size?: number; align?: CanvasTextAlign; r?: number } = {}) {
    const hot = this.hover === id;
    this.rect(x, y, w, h, opts.r ?? 14, hot ? '#4f8cff' : opts.fill ?? 'rgba(255,255,255,0.12)');
    const align = opts.align ?? 'center';
    this.text(label, align === 'center' ? x + w / 2 : x + 18, y + h / 2, opts.size ?? 26, opts.color ?? '#fff', 600, align, w - 28);
    this.hits.push({ id, x, y, w, h, onClick });
  }
}
