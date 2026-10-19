// Photo mode (F): stop, frame a shot with a free camera, add depth of field, run a time-lapse,
// and take pictures into a local Photos gallery (~/.openworld/photos).
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { Engine, DayNight } from '../engine.ts';
import type { Input } from '../input.ts';
import { esc } from '../interact.ts';
import { toast } from './panel.ts';

export interface PhotoDeps {
  engine: Engine;
  input: Input;
  dayNight: () => DayNight;
  /** What to orbit (the robot's position). */
  subject: () => THREE.Vector3;
  /** Called when entering/leaving so the game can hide the HUD and freeze the player. */
  onToggle: (on: boolean) => void;
  where: () => { place: string; lat?: number; lon?: number };
}

interface Row { label: string; value: () => string; step: (dir: 1 | -1) => void }

const FSTOPS = [0, 1.4, 2.8, 5.6, 11];

export class PhotoMode {
  active = false;
  private el: HTMLDivElement;
  private grid: HTMLDivElement;
  private flash: HTMLDivElement;
  private bokeh: BokehPass | null = null;
  private yaw = 0;
  private pitch = 0.15;
  private dist = 5;
  private fov = 55;
  private baseFov = 62;
  private offset = new THREE.Vector3();
  private fstop = 0;
  private focusOnYou = true;
  private focusDist = 6;
  private lapse = 0; // 0, 10, 40
  private savedSpeed = 1 / 60;
  private sel = 0;
  private hidden = false;
  private rows: Row[];
  private drag: { x: number; y: number } | null = null;

  constructor(private d: PhotoDeps) {
    this.el = document.createElement('div');
    this.el.className = 'ow-photo hidden';
    this.grid = document.createElement('div');
    this.grid.className = 'ow-photo-grid hidden';
    this.flash = document.createElement('div');
    this.flash.className = 'ow-photo-flash';
    document.body.append(this.el, this.grid, this.flash);
    this.rows = [
      { label: 'Depth of field', value: () => (this.fstop ? `f/${this.fstop}` : 'Off'), step: (s) => { const i = FSTOPS.indexOf(this.fstop); this.fstop = FSTOPS[Math.max(0, Math.min(FSTOPS.length - 1, i + s))]; } },
      { label: 'Focus', value: () => (this.focusOnYou ? 'On you' : `${this.focusDist.toFixed(0)} m`), step: (s) => {
        if (this.focusOnYou) { this.focusOnYou = false; this.focusDist = this.dist; }
        this.focusDist = Math.max(1, this.focusDist * (s > 0 ? 1.4 : 1 / 1.4));
        if (s < 0 && this.focusDist <= 1.01) this.focusOnYou = true;
      } },
      { label: 'Zoom', value: () => `${Math.round(this.fov)}°`, step: (s) => { this.fov = THREE.MathUtils.clamp(this.fov - s * 5, 12, 95); } },
      { label: 'Time of day', value: () => this.d.dayNight().label(), step: (s) => { const dn = this.d.dayNight(); dn.hour = (dn.hour + s * 0.5 + 24) % 24; } },
      { label: 'Time-lapse', value: () => (this.lapse ? `${this.lapse}×` : 'Off'), step: (s) => {
        const opts = [0, 10, 40, 120]; const i = opts.indexOf(this.lapse);
        this.lapse = opts[Math.max(0, Math.min(opts.length - 1, i + s))];
        this.d.dayNight().speed = this.lapse ? this.savedSpeed * this.lapse : this.savedSpeed;
      } },
      { label: 'Grid', value: () => (this.grid.classList.contains('hidden') ? 'Off' : 'On'), step: () => this.grid.classList.toggle('hidden') },
    ];
    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('mousedown', (e) => { if (this.active && !this.d.input.locked && e.target === this.d.engine.renderer.domElement) this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.005; this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -1.2, 1.45);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('wheel', (e) => { if (this.active) this.dist = THREE.MathUtils.clamp(this.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.8, 400); }, { passive: true });
  }

  /** Enter photo mode framing the current camera view. */
  toggle(yaw: number, pitch: number) {
    this.active ? this.exit() : this.enter(yaw, pitch);
  }

  private enter(yaw: number, pitch: number) {
    const cam = this.d.engine.camera;
    this.active = true;
    this.baseFov = cam.fov;
    this.fov = cam.fov;
    this.yaw = yaw; this.pitch = pitch;
    this.dist = Math.max(2, cam.position.distanceTo(this.d.subject()) - 0.5);
    this.offset.set(0, 1.3, 0);
    this.savedSpeed = this.d.dayNight().speed;
    this.d.onToggle(true);
    this.el.classList.remove('hidden');
    this.hidden = false;
    this.render();
    void this.loadGallery();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    const cam = this.d.engine.camera;
    cam.fov = this.baseFov; cam.updateProjectionMatrix();
    if (this.bokeh) this.bokeh.enabled = false;
    this.d.dayNight().speed = this.savedSpeed;
    this.lapse = 0;
    this.el.classList.add('hidden');
    this.grid.classList.add('hidden');
    this.d.onToggle(false);
  }

  private key(e: KeyboardEvent) {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    switch (e.code) {
      case 'ArrowUp': this.sel = (this.sel + this.rows.length - 1) % this.rows.length; stop(); break;
      case 'ArrowDown': this.sel = (this.sel + 1) % this.rows.length; stop(); break;
      case 'ArrowLeft': this.rows[this.sel].step(-1); stop(); break;
      case 'ArrowRight': this.rows[this.sel].step(1); stop(); break;
      case 'Enter': case 'Space': if (!e.repeat) void this.shoot(); stop(); break;
      case 'KeyH': this.hidden = !this.hidden; this.el.classList.toggle('faded', this.hidden); stop(); break;
      case 'Escape': case 'KeyF': if (!e.repeat) this.exit(); stop(); break;
      default: return;
    }
    this.render();
  }

  update(dt: number) {
    if (!this.active) return;
    const input = this.d.input;
    const m = input.consumeMouse();
    this.yaw -= m.x * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch + m.y * 0.0022, -1.2, 1.45);
    // WASD slides the point we orbit, Q/E lowers and raises it.
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const sp = (input.down('ShiftLeft') ? 12 : 3) * dt;
    if (input.down('KeyW')) this.offset.addScaledVector(fwd, sp);
    if (input.down('KeyS')) this.offset.addScaledVector(fwd, -sp);
    if (input.down('KeyA')) this.offset.addScaledVector(right, sp);
    if (input.down('KeyD')) this.offset.addScaledVector(right, -sp);
    if (input.down('KeyE')) this.offset.y += sp;
    if (input.down('KeyQ')) this.offset.y -= sp;
    const target = this.d.subject().clone().add(this.offset);
    const cam = this.d.engine.camera;
    const back = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    cam.position.copy(target).addScaledVector(back, this.dist);
    cam.lookAt(target);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // Depth of field.
    if (this.fstop) {
      if (!this.bokeh) {
        const eng = this.d.engine;
        this.bokeh = new BokehPass(eng.scene, cam, { focus: 6, aperture: 0.0002, maxblur: 0.012 });
        const passes = eng.composer.passes;
        const out = passes.findIndex((p) => p.constructor.name === 'OutputPass');
        eng.composer.insertPass(this.bokeh, out >= 0 ? out : passes.length);
      }
      this.bokeh.enabled = true;
      (this.bokeh as unknown as { scene: THREE.Scene }).scene = this.d.engine.scene;
      const u = this.bokeh.uniforms as unknown as Record<string, { value: number }>;
      u.focus.value = this.focusOnYou ? cam.position.distanceTo(this.d.subject().clone().add(new THREE.Vector3(0, 1.1, 0))) : this.focusDist;
      u.aperture.value = (0.0009 / this.fstop) * (55 / this.fov);
      u.maxblur.value = 0.014;
    } else if (this.bokeh) this.bokeh.enabled = false;
    if (this.lapse) this.render();
  }

  private render() {
    if (!this.active) return;
    this.el.innerHTML = `
      <div class="ow-photo-title">📷 Photo mode</div>
      ${this.rows.map((r, i) => `<div class="ow-photo-row${i === this.sel ? ' on' : ''}"><span>${esc(r.label)}</span><b>‹ ${esc(r.value())} ›</b></div>`).join('')}
      <div class="ow-photo-keys"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>←</kbd><kbd>→</kbd> change · <kbd>Space</kbd> take the picture · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>Q</kbd><kbd>E</kbd> move · drag/mouse look · wheel distance · <kbd>H</kbd> hide · <kbd>F</kbd> done</div>
      <div class="ow-photo-gallery"></div>`;
    this.renderGallery();
  }

  private gallery: { url: string; place: string }[] = [];
  private async loadGallery() {
    try { this.gallery = await (await fetch('/api/photos')).json(); } catch { this.gallery = []; }
    this.renderGallery();
  }
  private renderGallery() {
    const g = this.el.querySelector('.ow-photo-gallery');
    if (!g) return;
    g.innerHTML = this.gallery.length
      ? `<small>Photos (${this.gallery.length})</small><div>${this.gallery.slice(0, 6).map((p) => `<a href="${esc(p.url)}" target="_blank" title="${esc(p.place)}"><img src="${esc(p.url)}" loading="lazy"></a>`).join('')}</div>`
      : '<small>Your photos will show up here.</small>';
  }

  /** Render one clean frame (no UI) and keep it. */
  private async shoot() {
    const eng = this.d.engine;
    eng.render();
    const data = eng.renderer.domElement.toDataURL('image/jpeg', 0.92);
    this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
    const w = this.d.where();
    try {
      const res = await fetch('/api/photos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, ...w }) });
      if (!res.ok) throw new Error(String(res.status));
      const p = await res.json();
      this.gallery.unshift(p);
      this.renderGallery();
      toast(`Saved to Photos · <a href="${esc(p.url)}" target="_blank">open</a>`, 4000);
    } catch (e) {
      toast(`Couldn't save the photo (${esc((e as Error).message)})`);
    }
  }
}
