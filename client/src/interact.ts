import * as THREE from 'three';

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
      this.promptEl.innerHTML = `<kbd>E</kbd>${esc(best.label)}${best.sub ? `<small>${esc(best.sub)}</small>` : ''}`;
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
    for (const it of all) {
      const d = camera.position.distanceTo(it.pos);
      this.v.copy(it.pos).project(camera);
      const visible = !it.hidden && d < it.maxDist && d > it.minDist && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      if (!visible) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.left = `${((this.v.x + 1) / 2) * w}px`;
      it.el.style.top = `${((1 - this.v.y) / 2) * h}px`;
      it.el.style.opacity = String(THREE.MathUtils.clamp((it.maxDist - d) / (it.maxDist * 0.25), 0, 1));
    }
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
