/// <reference types="vite/client" />
// The map screen (M): a full-screen slippy map of the whole planet. Pick any spot and drop in, or set
// a waypoint; browse famous places and your project HQs; flip between the street map and satellite.
import type { TileMap } from './tilemap.ts';
import type { MapMarker } from './earthMinimap.ts';
import { setOverlayOpen } from './panel.ts';
import { haversine } from '../earth/frame.ts';
import { ATTRIBUTION, formatDistance } from './hud.ts';
import './hud.css';

export interface WorldMapOpts {
  map: TileMap;
  here: () => { lat: number; lon: number; heading: number };
  markers: () => MapMarker[];
  places?: { name: string; sub?: string; lat: number; lon: number }[];
  search: (q: string) => Promise<{ name: string; label: string; lat: number; lon: number }[]>;
  onDrop: (lat: number, lon: number, name: string) => void;
  onNavigate: (lat: number, lon: number, name: string) => void;
  settings?: { label: string; value: () => string; next: () => void }[];
  onClose?: () => void;
  /** Distances in miles/feet. */
  imperial?: boolean;
  /** Starting zoom (default 15). */
  zoom?: number;
}

export const FAMOUS_PLACES: { name: string; sub: string; lat: number; lon: number }[] = [
  { name: 'Times Square', sub: 'Midtown Manhattan, New York', lat: 40.758, lon: -73.9855 },
  { name: 'Central Park', sub: 'Bethesda Terrace, New York', lat: 40.7740, lon: -73.9708 },
  { name: 'Golden Gate Bridge', sub: 'San Francisco, California', lat: 37.8078, lon: -122.4750 },
  { name: 'Russian Hill', sub: 'Lombard Street, San Francisco', lat: 37.8021, lon: -122.4187 },
  { name: 'Hollywood Sign', sub: 'Mount Lee, Los Angeles', lat: 34.1341, lon: -118.3215 },
  { name: 'Grand Canyon', sub: 'Mather Point, Arizona', lat: 36.0617, lon: -112.1077 },
  { name: 'Niagara Falls', sub: 'Horseshoe Falls, Ontario', lat: 43.0790, lon: -79.0765 },
  { name: 'Whistler Blackcomb', sub: 'Roundhouse Lodge, British Columbia', lat: 50.0626, lon: -122.9496 },
  { name: 'Copacabana', sub: 'Rio de Janeiro, Brazil', lat: -22.9711, lon: -43.1822 },
  { name: 'Machu Picchu', sub: 'Cusco Region, Peru', lat: -13.1631, lon: -72.5450 },
  { name: 'Big Ben', sub: 'Westminster, London', lat: 51.5007, lon: -0.1246 },
  { name: 'Eiffel Tower', sub: 'Champ de Mars, Paris', lat: 48.8584, lon: 2.2945 },
  { name: 'Jordaan', sub: 'Canal houses, Amsterdam', lat: 52.3752, lon: 4.8820 },
  { name: 'Colosseum', sub: 'Rome, Italy', lat: 41.8902, lon: 12.4922 },
  { name: 'Santorini', sub: 'Oia, Greece', lat: 36.4618, lon: 25.3753 },
  { name: 'Zermatt', sub: 'Under the Matterhorn, Switzerland', lat: 46.0207, lon: 7.7491 },
  { name: 'Burj Khalifa', sub: 'Downtown Dubai', lat: 25.1972, lon: 55.2744 },
  { name: 'Dubai Marina', sub: 'Dubai, UAE', lat: 25.0805, lon: 55.1403 },
  { name: 'Shibuya Crossing', sub: 'Shibuya, Tokyo', lat: 35.6595, lon: 139.7005 },
  { name: 'Mount Fuji', sub: 'Fujinomiya trail, Japan', lat: 35.3606, lon: 138.7274 },
  { name: 'Marina Bay', sub: 'Singapore', lat: 1.2834, lon: 103.8607 },
  { name: 'Victoria Harbour', sub: 'Central, Hong Kong', lat: 22.2850, lon: 114.1588 },
  { name: 'Sydney Opera House', sub: 'Bennelong Point, Sydney', lat: -33.8568, lon: 151.2153 },
  { name: 'Table Mountain', sub: 'Cape Town, South Africa', lat: -33.9628, lon: 18.4098 },
  { name: 'Pyramids of Giza', sub: 'Giza, Egypt', lat: 29.9792, lon: 31.1342 },
];

let current: { close(): void } | null = null;
export function worldMapOpen() { return !!current; }

export function openWorldMap(opts: WorldMapOpts): { close(): void } {
  current?.close();
  const map = opts.map;
  const prevStyle = map.style;
  const here0 = opts.here();
  let lat = here0.lat, lon = here0.lon, zoom = opts.zoom ?? 15;
  let tab: 'map' | 'places' | 'settings' = 'map';
  let selected: { lat: number; lon: number; name: string } | null = null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const el = document.createElement('div');
  el.className = 'ow-wmap';
  el.innerHTML = `
    <canvas></canvas>
    <div class="ow-wm-bar">
      <button data-tab="map" class="on">Map</button><button data-tab="places">Places</button><button data-tab="settings">Settings</button>
      <button class="ow-wm-style" title="Street map / satellite">🛰 Satellite</button>
      <form><input type="text" placeholder="Search anywhere on Earth" autocomplete="off" /></form>
      <button class="ow-wm-x" title="Close (M / Esc)">✕</button>
    </div>
    <div class="ow-wm-results"></div>
    <div class="ow-wm-zoom"><button data-z="1">+</button><button data-z="-1">−</button><div class="ow-wm-z"></div></div>
    <div class="ow-wm-sheet hidden"></div>
    <div class="ow-wm-card"></div>
    <div class="ow-wm-attrib">${ATTRIBUTION}</div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas')!;
  const g = cv.getContext('2d')!;
  const card = el.querySelector<HTMLDivElement>('.ow-wm-card')!;
  const sheet = el.querySelector<HTMLDivElement>('.ow-wm-sheet')!;
  const results = el.querySelector<HTMLDivElement>('.ow-wm-results')!;
  const input = el.querySelector<HTMLInputElement>('input')!;
  const styleBtn = el.querySelector<HTMLButtonElement>('.ow-wm-style')!;
  const zLabel = el.querySelector<HTMLDivElement>('.ow-wm-z')!;
  setOverlayOpen(true);

  const resize = () => {
    cv.width = Math.round(window.innerWidth * dpr);
    cv.height = Math.round(window.innerHeight * dpr);
    dirty = true;
  };
  let dirty = true;
  window.addEventListener('resize', resize);
  resize();

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const fmtCoord = (la: number, lo: number) => `${Math.abs(la).toFixed(5)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(5)}° ${lo >= 0 ? 'E' : 'W'}`;

  const renderCard = () => {
    const h = opts.here();
    if (selected) {
      const d = haversine(h, selected);
      card.innerHTML = `
        <div><h4>${esc(selected.name)}</h4><p>${fmtCoord(selected.lat, selected.lon)} · ${formatDistance(d, !!opts.imperial)} from you</p></div>
        <div class="ow-wm-acts">
          <button data-a="drop"><i>⤓</i>Drop here</button>
          <button data-a="nav"><i>➤</i>Navigate here</button>
          <button data-a="back"><i>◎</i>Back to you</button>
        </div>
        <div class="ow-wm-help"><span><kbd>drag</kbd>Move</span><span><kbd>wheel</kbd>Zoom</span><span><kbd>click</kbd>Pick a spot</span><span><kbd>M</kbd>Close</span></div>`;
    } else {
      card.innerHTML = `
        <div><h4>You are here</h4><p>${fmtCoord(h.lat, h.lon)}</p></div>
        <div class="ow-wm-acts"><button data-a="back"><i>◎</i>Back to you</button></div>
        <div class="ow-wm-help"><span><kbd>drag</kbd>Move</span><span><kbd>wheel</kbd>Zoom</span><span><kbd>click</kbd>Pick a spot</span><span><kbd>M</kbd>Close</span></div>`;
    }
  };
  card.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'back') { const h = opts.here(); lat = h.lat; lon = h.lon; zoom = Math.max(zoom, 15); selected = null; renderCard(); dirty = true; return; }
    if (!selected) return;
    const s = selected;
    if (a === 'drop') { api.close(); opts.onDrop(s.lat, s.lon, s.name); }
    if (a === 'nav') { api.close(); opts.onNavigate(s.lat, s.lon, s.name); }
  });

  const select = (la: number, lo: number, name?: string) => {
    selected = { lat: la, lon: lo, name: name ?? map.nearestName(la, lo, zoom) ?? 'Dropped pin' };
    renderCard();
    dirty = true;
  };
  const flyTo = (la: number, lo: number, z: number, name?: string) => {
    lat = la; lon = lo; zoom = z;
    select(la, lo, name);
    setTab('map');
  };

  // ---- tabs ----
  const renderSheet = () => {
    if (tab === 'places') {
      const mk = opts.markers().filter((m) => m.label);
      const places = opts.places ?? FAMOUS_PLACES;
      const h = opts.here();
      sheet.innerHTML = `${mk.length ? `<h5>Your projects</h5>${mk.map((m, i) => `<div class="ow-wm-row"><span class="dot" style="background:${esc(m.color)}"></span><div><b>${esc(m.label!)}</b><small>${formatDistance(haversine(h, m), !!opts.imperial)} away</small></div><button data-m="${i}">Go</button></div>`).join('')}` : ''}
        <h5>Around the world</h5>${places.map((p, i) => `<div class="ow-wm-row"><div><b>${esc(p.name)}</b><small>${esc(p.sub ?? '')}</small></div><button data-p="${i}">Go</button></div>`).join('')}`;
      sheet.querySelectorAll<HTMLButtonElement>('button[data-m]').forEach((b) => b.addEventListener('click', () => { const m = mk[Number(b.dataset.m)]; flyTo(m.lat, m.lon, 17, m.label); }));
      sheet.querySelectorAll<HTMLButtonElement>('button[data-p]').forEach((b) => b.addEventListener('click', () => { const p = places[Number(b.dataset.p)]; flyTo(p.lat, p.lon, 15, p.name); }));
    } else if (tab === 'settings') {
      const set = opts.settings ?? [];
      sheet.innerHTML = `<h5>Settings</h5>${set.length ? set.map((s, i) => `<div class="ow-wm-row set" data-s="${i}"><div><b>${esc(s.label)}</b></div><span class="val">${esc(s.value())}</span></div>`).join('') : '<div class="ow-wm-row"><div><b>Nothing to tweak yet</b></div></div>'}`;
      sheet.querySelectorAll<HTMLDivElement>('[data-s]').forEach((r) => r.addEventListener('click', () => { set[Number(r.dataset.s)].next(); renderSheet(); }));
    }
  };
  const setTab = (t: typeof tab) => {
    tab = t;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    sheet.classList.toggle('hidden', t === 'map');
    if (t !== 'map') renderSheet();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as typeof tab)));
  styleBtn.addEventListener('click', () => {
    map.style = map.style === 'map' ? 'satellite' : 'map';
    styleBtn.textContent = map.style === 'map' ? '🛰 Satellite' : '🗺 Street map';
    dirty = true;
  });
  el.querySelector('.ow-wm-x')!.addEventListener('click', () => api.close());
  el.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => b.addEventListener('click', () => { zoom = clampZ(zoom + Number(b.dataset.z)); dirty = true; }));

  // ---- search ----
  el.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    results.innerHTML = '<div>Searching…</div>';
    try {
      const hits = await opts.search(q);
      results.innerHTML = hits.length ? '' : '<div>No places found.</div>';
      for (const h of hits) {
        const b = document.createElement('button');
        b.innerHTML = `${esc(h.name)}<small>${esc(h.label)}</small>`;
        b.addEventListener('click', () => { results.innerHTML = ''; input.blur(); flyTo(h.lat, h.lon, 15, h.name); });
        results.appendChild(b);
      }
    } catch (err) {
      results.innerHTML = `<div>${esc((err as Error).message)}</div>`;
    }
  });

  // ---- pan / zoom / pick ----
  const clampZ = (z: number) => Math.max(2, Math.min(18, z));
  let drag: { x: number; y: number; lat: number; lon: number; moved: boolean } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, lat, lon, moved: false };
    results.innerHTML = '';
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add('drag'); }
    if (!drag.moved) return;
    const p = map.unproject(-dx, -dy, drag.lat, drag.lon, zoom);
    lat = p.lat; lon = p.lon;
    dirty = true;
  });
  cv.addEventListener('pointerup', (e) => {
    cv.classList.remove('drag');
    if (drag && !drag.moved) {
      const p = map.unproject(e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2, lat, lon, zoom);
      select(p.lat, p.lon);
    }
    drag = null;
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Zoom around the cursor.
    const ox = e.clientX - window.innerWidth / 2, oy = e.clientY - window.innerHeight / 2;
    const at = map.unproject(ox, oy, lat, lon, zoom);
    const nz = clampZ(zoom - e.deltaY * 0.0022);
    if (nz === zoom) return;
    zoom = nz;
    const p = map.project(at.lat, at.lon, lat, lon, zoom);
    const c = map.unproject(p.x - ox, p.y - oy, lat, lon, zoom);
    lat = c.lat; lon = c.lon;
    dirty = true;
  }, { passive: false });

  // ---- keys: M / Esc close (capture phase, so the game's own M handler doesn't reopen it) ----
  const onKey = (e: KeyboardEvent) => {
    const typing = document.activeElement === input;
    if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (typing) { input.blur(); results.innerHTML = ''; } else if (tab !== 'map') setTab('map'); else api.close();
      return;
    }
    if (typing) return;
    if (e.code === 'KeyM') { e.preventDefault(); e.stopImmediatePropagation(); api.close(); return; }
    const step = 120 / 2 ** 0;
    const pan = (dx: number, dy: number) => { const p = map.unproject(dx, dy, lat, lon, zoom); lat = p.lat; lon = p.lon; dirty = true; };
    if (e.code === 'KeyW' || e.code === 'ArrowUp') pan(0, -step);
    if (e.code === 'KeyS' || e.code === 'ArrowDown') pan(0, step);
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') pan(-step, 0);
    if (e.code === 'KeyD' || e.code === 'ArrowRight') pan(step, 0);
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { zoom = clampZ(zoom + 1); dirty = true; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { zoom = clampZ(zoom - 1); dirty = true; }
  };
  window.addEventListener('keydown', onKey, true);

  // ---- draw loop ----
  let raf = 0, pending = false, lastHere = '';
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const h = opts.here();
    const hk = `${h.lat.toFixed(6)},${h.lon.toFixed(6)},${Math.round(h.heading)}`;
    if (hk !== lastHere) { lastHere = hk; dirty = true; }
    if (!dirty && !pending) return;
    dirty = false;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    pending = !map.draw(g, lat, lon, zoom, cx, cy, 0, dpr);
    zLabel.textContent = `z${zoom.toFixed(1)}`;
    const toScreen = (la: number, lo: number) => { const p = map.project(la, lo, lat, lon, zoom); return { x: cx + p.x * dpr, y: cy + p.y * dpr }; };

    // Project HQs: dots for all, names where they fit (big ones first, never overlapping).
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const ms = opts.markers().slice().sort((a, b) => Number(!!b.big) - Number(!!a.big));
    g.font = `700 ${12 * dpr}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (const m of ms) {
      const p = toScreen(m.lat, m.lon);
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
      g.beginPath(); g.arc(p.x, p.y, (m.big ? 7 : 5) * dpr, 0, Math.PI * 2);
      g.fillStyle = m.color; g.fill();
      g.lineWidth = 2 * dpr; g.strokeStyle = '#fff'; g.stroke();
      if (!m.label || !(m.big || zoom >= 16)) continue;
      const w = g.measureText(m.label).width / 2 + 3 * dpr;
      const r = { x0: p.x - w, x1: p.x + w, y0: p.y - 24 * dpr, y1: p.y - 6 * dpr };
      if (placed.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1)) continue;
      placed.push(r);
      g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(m.label, p.x, p.y - 8 * dpr);
      g.fillStyle = '#2b2622'; g.fillText(m.label, p.x, p.y - 8 * dpr);
    }
    // Selected spot.
    if (selected) {
      const p = toScreen(selected.lat, selected.lon);
      g.save();
      g.translate(p.x, p.y);
      g.beginPath();
      g.moveTo(0, 0); g.bezierCurveTo(-3 * dpr, -9 * dpr, -11 * dpr, -12 * dpr, -11 * dpr, -21 * dpr);
      g.arc(0, -21 * dpr, 11 * dpr, Math.PI, 0); g.bezierCurveTo(11 * dpr, -12 * dpr, 3 * dpr, -9 * dpr, 0, 0);
      g.fillStyle = '#ff5a1f'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6 * dpr; g.fill();
      g.shadowBlur = 0; g.beginPath(); g.arc(0, -21 * dpr, 4 * dpr, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.restore();
    }
    // You.
    const me = toScreen(h.lat, h.lon);
    g.save();
    g.translate(me.x, me.y);
    g.beginPath(); g.arc(0, 0, 14 * dpr, 0, Math.PI * 2); g.fillStyle = 'rgba(31,124,242,.18)'; g.fill();
    g.rotate((h.heading * Math.PI) / 180);
    g.beginPath(); g.moveTo(0, -10 * dpr); g.lineTo(7.5 * dpr, 8 * dpr); g.lineTo(0, 4 * dpr); g.lineTo(-7.5 * dpr, 8 * dpr); g.closePath();
    g.fillStyle = '#1f7cf2'; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  };
  raf = requestAnimationFrame(frame);
  renderCard();

  const api = {
    close() {
      if (current !== api) return;
      current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', resize);
      map.style = prevStyle;
      el.remove();
      setOverlayOpen(false);
      opts.onClose?.();
    },
  };
  current = api;
  return api;
}
