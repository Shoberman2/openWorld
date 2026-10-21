import * as THREE from 'three';
import { kbd } from './keymap.ts';

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  label: string;
  sub?: string;
  action: () => void;
}

/** Things the player can press E on. The nearest one in range (biased to what you face) wins. */
export class Interactions {
  private items = new Map<string, Interactable>();
  current: Interactable | null = null;
  private promptEl = document.getElementById('prompt')!;

  add(i: Interactable) { this.items.set(i.id, i); }
  remove(id: string) { this.items.delete(id); }
  clear() { this.items.clear(); this.current = null; }

  update(pos: THREE.Vector3, facing: number, show: boolean) {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const it of this.items.values()) {
      const dx = it.position.x - pos.x, dz = it.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius || Math.abs(it.position.y - pos.y) > 6) continue;
      const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d * (1.6 - dot * 0.6);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    this.current = best;
    if (best && show) {
      this.promptEl.innerHTML = `${kbd('interact')}${esc(best.label)}${best.sub ? `<small>${esc(best.sub)}</small>` : ''}`;
      this.promptEl.classList.remove('hidden');
    } else {
      this.promptEl.classList.add('hidden');
    }
  }

  trigger() { this.current?.action(); }
}

/** HTML labels pinned to world positions (building names, NPC tags, speech bubbles). */
export class Labels {
  private root = document.getElementById('labels')!;
  private items = new Map<string, { el: HTMLDivElement; pos: THREE.Vector3; maxDist: number; minDist: number; hidden: boolean }>();
  private v = new THREE.Vector3();
  /** Optional line-of-sight test; labels behind buildings are hidden. Re-checked a few at a time. */
  occluder: ((from: THREE.Vector3, to: THREE.Vector3) => boolean) | null = null;
  maxVisible = 7;
  private cursor = 0;

  set(id: string, pos: THREE.Vector3, html: string, opts: { cls?: string; maxDist?: number; minDist?: number } = {}) {
    let it = this.items.get(id);
    if (!it) {
      const el = document.createElement('div');
      this.root.appendChild(el);
      it = { el, pos: pos.clone(), maxDist: 80, minDist: 0, hidden: false };
      this.items.set(id, it);
    }
    it.el.className = `wlabel ${opts.cls ?? ''}`;
    if (it.el.innerHTML !== html) it.el.innerHTML = html;
    it.pos.copy(pos);
    it.maxDist = opts.maxDist ?? 80;
    it.minDist = opts.minDist ?? 0;
  }

  move(id: string, pos: THREE.Vector3) { this.items.get(id)?.pos.copy(pos); }

  remove(id: string) {
    const it = this.items.get(id);
    if (it) { it.el.remove(); this.items.delete(id); }
  }

  clear() { for (const id of [...this.items.keys()]) this.remove(id); }

  update(camera: THREE.Camera) {
    const w = window.innerWidth, h = window.innerHeight;
    const all = [...this.items.values()];
    if (this.occluder && all.length) {
      for (let k = 0; k < 12; k++) {
        const it = all[this.cursor++ % all.length];
        it.hidden = camera.position.distanceTo(it.pos) < it.maxDist && this.occluder(camera.position, it.pos);
      }
    } else for (const it of all) it.hidden = false;
    // Nearest first; at most `maxVisible`, and never two on top of each other.
    const shown: { it: typeof all[0]; x: number; y: number; d: number }[] = [];
    for (const it of all) {
      const d = camera.position.distanceTo(it.pos);
      this.v.copy(it.pos).project(camera);
      const visible = !it.hidden && d < it.maxDist && d > it.minDist && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      if (!visible) { it.el.style.display = 'none'; continue; }
      shown.push({ it, x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h, d });
    }
    shown.sort((a, b) => a.d - b.d);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    let n = 0;
    for (const s of shown) {
      const half = Math.min(150, (s.it.el.textContent?.length ?? 10) * 3.8 + 14);
      const r = { x0: s.x - half, x1: s.x + half, y0: s.y - 30, y1: s.y + 4 };
      if (n >= this.maxVisible || placed.some((p) => r.x0 < p.x1 && p.x0 < r.x1 && r.y0 < p.y1 && p.y0 < r.y1)) { s.it.el.style.display = 'none'; continue; }
      placed.push(r);
      n++;
      s.it.el.style.display = '';
      s.it.el.style.left = `${s.x}px`;
      s.it.el.style.top = `${s.y}px`;
      s.it.el.style.opacity = String(THREE.MathUtils.clamp((s.it.maxDist - s.d) / (s.it.maxDist * 0.25), 0, 1));
    }
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
