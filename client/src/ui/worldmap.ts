/// <reference types="vite/client" />
// The map screen (M): a full-screen slippy map of the whole planet. Pick any spot and drop in, set a
// waypoint or fly there on autopilot; browse famous places and your project HQs; flip between the
// street map and satellite. Zoom out and it turns into a globe with live clouds, storms and wind.
import type { TileMap } from './tilemap.ts';
import type { MapMarker } from './earthMinimap.ts';
import { setOverlayOpen } from './panel.ts';
import { haversine } from '../earth/frame.ts';
import { ATTRIBUTION, formatDistance } from './hud.ts';
import { Globe, type GlobeLayer } from './globe.ts';
import './hud.css';

export interface WorldMapOpts {
  map: TileMap;
  here: () => { lat: number; lon: number; heading: number };
  markers: () => MapMarker[];
  places?: { name: string; sub?: string; lat: number; lon: number }[];
  search: (q: string) => Promise<{ name: string; label: string; lat: number; lon: number }[]>;
  onDrop: (lat: number, lon: number, name: string) => void;
  onNavigate: (lat: number, lon: number, name: string) => void;
  /** Fly there on autopilot (the shuttle, unless you're already in an aircraft). */
  onAutopilot?: (lat: number, lon: number, name: string) => void;
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
    <canvas class="ow-wm-ov" style="pointer-events:none"></canvas>
    <div class="ow-wm-layers hidden">
      <button data-l="clouds" class="on">☁ Clouds</button><button data-l="storms">⛈ Rain &amp; storms</button><button data-l="wind">🌬 Wind</button>
      <small>Live conditions · Open-Meteo, 15° grid</small>
    </div>
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
  const ov = el.querySelector<HTMLCanvasElement>('.ow-wm-ov')!;
  const og = ov.getContext('2d')!;
  const layersEl = el.querySelector<HTMLDivElement>('.ow-wm-layers')!;
  // The globe (zoomed out): made on first use, cross-fades with the flat map between z4.5 and z5.5.
  let globe: Globe | null = null;
  const globeAlpha = () => Math.max(0, Math.min(1, 5.5 - zoom));
  const ensureGlobe = () => {
    if (globe) return globe;
    globe = new Globe(el, dpr, () => { dirty = true; });
    globe.canvas.style.pointerEvents = 'none';
    el.insertBefore(globe.canvas, ov);
    return globe;
  };
  layersEl.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => b.addEventListener('click', () => {
    const gl = ensureGlobe(), k = b.dataset.l as GlobeLayer;
    gl.layers[k] = !gl.layers[k];
    b.classList.toggle('on', gl.layers[k]);
    dirty = true;
  }));
  const card = el.querySelector<HTMLDivElement>('.ow-wm-card')!;
  const sheet = el.querySelector<HTMLDivElement>('.ow-wm-sheet')!;
  const results = el.querySelector<HTMLDivElement>('.ow-wm-results')!;
  const input = el.querySelector<HTMLInputElement>('input')!;
  const styleBtn = el.querySelector<HTMLButtonElement>('.ow-wm-style')!;
  const zLabel = el.querySelector<HTMLDivElement>('.ow-wm-z')!;
  setOverlayOpen(true);

  const resize = () => {
    cv.width = ov.width = Math.round(window.innerWidth * dpr);
    cv.height = ov.height = Math.round(window.innerHeight * dpr);
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
          ${opts.onAutopilot ? '<button data-a="auto"><i>✈</i>Autopilot</button>' : ''}
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
    if (a === 'auto') { api.close(); opts.onAutopilot?.(s.lat, s.lon, s.name); }
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
      if (globe && globeAlpha() > 0.5) {
        const p = globe.pick(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
        if (p) select(p.lat, p.lon, map.nearestName(p.lat, p.lon, zoom) ?? `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`);
      } else {
        const p = map.unproject(e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2, lat, lon, zoom);
        select(p.lat, p.lon);
      }
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
    const ga = globeAlpha();
    // The globe's clouds drift: keep drawing while it shows.
    if (!dirty && !pending && ga <= 0) return;
    dirty = false;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    if (ga < 1) pending = !map.draw(g, lat, lon, zoom, cx, cy, 0, dpr);
    else { g.fillStyle = '#05070d'; g.fillRect(0, 0, W, H); pending = false; }
    zLabel.textContent = `z${zoom.toFixed(1)}`;
    og.clearRect(0, 0, W, H);
    layersEl.classList.toggle('hidden', ga <= 0);
    if (ga > 0) {
      const gl = ensureGlobe();
      gl.canvas.style.opacity = String(ga);
      gl.canvas.style.display = '';
      gl.setView(lat, lon, zoom, window.innerWidth, window.innerHeight);
      gl.render();
      if (gl.layers.wind && gl.weather) drawWind(og, gl, dpr);
    } else if (globe) globe.canvas.style.display = 'none';
    // Markers go on the overlay above the globe once it's the main view.
    const onGlobe = ga > 0.5 && !!globe;
    const gx = onGlobe ? og : g;
    const toScreen = (la: number, lo: number) => {
      if (onGlobe) { const p = globe!.project(la, lo, window.innerWidth, window.innerHeight); return { x: p.visible ? p.x * dpr : -1e4, y: p.y * dpr }; }
      const p = map.project(la, lo, lat, lon, zoom); return { x: cx + p.x * dpr, y: cy + p.y * dpr };
    };

    // Project HQs: dots for all, names where they fit (big ones first, never overlapping).
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const ms = opts.markers().slice().sort((a, b) => Number(!!b.big) - Number(!!a.big));
    gx.font = `700 ${12 * dpr}px Inter, sans-serif`; gx.textAlign = 'center'; gx.textBaseline = 'bottom';
    for (const m of ms) {
      const p = toScreen(m.lat, m.lon);
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
      gx.beginPath(); gx.arc(p.x, p.y, (m.big ? 7 : 5) * dpr, 0, Math.PI * 2);
      gx.fillStyle = m.color; gx.fill();
      gx.lineWidth = 2 * dpr; gx.strokeStyle = '#fff'; gx.stroke();
      if (!m.label || !(m.big || zoom >= 16)) continue;
      const w = gx.measureText(m.label).width / 2 + 3 * dpr;
      const r = { x0: p.x - w, x1: p.x + w, y0: p.y - 24 * dpr, y1: p.y - 6 * dpr };
      if (placed.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1)) continue;
      placed.push(r);
      gx.lineWidth = 3 * dpr; gx.strokeStyle = 'rgba(255,255,255,.9)'; gx.strokeText(m.label, p.x, p.y - 8 * dpr);
      gx.fillStyle = '#2b2622'; gx.fillText(m.label, p.x, p.y - 8 * dpr);
    }
    // Selected spot.
    if (selected) {
      const p = toScreen(selected.lat, selected.lon);
      gx.save();
      gx.translate(p.x, p.y);
      gx.beginPath();
      gx.moveTo(0, 0); gx.bezierCurveTo(-3 * dpr, -9 * dpr, -11 * dpr, -12 * dpr, -11 * dpr, -21 * dpr);
      gx.arc(0, -21 * dpr, 11 * dpr, Math.PI, 0); gx.bezierCurveTo(11 * dpr, -12 * dpr, 3 * dpr, -9 * dpr, 0, 0);
      gx.fillStyle = '#ff5a1f'; gx.shadowColor = 'rgba(0,0,0,.35)'; gx.shadowBlur = 6 * dpr; gx.fill();
      gx.shadowBlur = 0; gx.beginPath(); gx.arc(0, -21 * dpr, 4 * dpr, 0, Math.PI * 2); gx.fillStyle = '#fff'; gx.fill();
      gx.restore();
    }
    // You.
    const me = toScreen(h.lat, h.lon);
    gx.save();
    gx.translate(me.x, me.y);
    gx.beginPath(); gx.arc(0, 0, 14 * dpr, 0, Math.PI * 2); gx.fillStyle = 'rgba(31,124,242,.18)'; gx.fill();
    gx.rotate((h.heading * Math.PI) / 180);
    gx.beginPath(); gx.moveTo(0, -10 * dpr); gx.lineTo(7.5 * dpr, 8 * dpr); gx.lineTo(0, 4 * dpr); gx.lineTo(-7.5 * dpr, 8 * dpr); gx.closePath();
    gx.fillStyle = '#1f7cf2'; gx.fill(); gx.lineWidth = 2 * dpr; gx.strokeStyle = '#fff'; gx.stroke();
    gx.restore();
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
      globe?.dispose();
      el.remove();
      setOverlayOpen(false);
      opts.onClose?.();
    },
  };
  current = api;
  return api;
}

/** Wind arrows on the globe: one per grid point on the near side, longer and warmer for stronger wind. */
function drawWind(g: CanvasRenderingContext2D, gl: Globe, dpr: number) {
  const w = gl.weather!;
  const W = window.innerWidth, H = window.innerHeight;
  g.lineCap = 'round';
  for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
    const i = r * w.cols + c, la = w.lat0 + r * w.step, lo = w.lon0 + c * w.step;
    const p = gl.project(la, lo, W, H);
    if (!p.visible) continue;
    // The wind blows *from* windDir: draw it pointing downwind.
    const to = ((w.windDir[i] + 180) * Math.PI) / 180;
    const q = gl.project(la + Math.cos(to) * 2.5, lo + (Math.sin(to) * 2.5) / Math.max(0.2, Math.cos((la * Math.PI) / 180)), W, H);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    // Scaled to the globe's size on screen, so a small globe isn't buried in arrows.
    const scale = Math.min(1, gl.radiusPx(W, H) / 320);
    if (scale < 0.6 && (r + c) % 2) continue;
    const len = Math.min(26, 6 + w.wind[i] * 0.45) * dpr * scale;
    const ux = dx / d, uy = dy / d;
    const x0 = p.x * dpr, y0 = p.y * dpr, x1 = x0 + ux * len, y1 = y0 + uy * len;
    g.strokeStyle = w.wind[i] > 45 ? 'rgba(255,120,80,.95)' : w.wind[i] > 25 ? 'rgba(255,220,120,.9)' : 'rgba(220,240,255,.85)';
    g.lineWidth = 1.6 * dpr;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.moveTo(x1, y1); g.lineTo(x1 - ux * 5 * dpr - uy * 3 * dpr, y1 - uy * 5 * dpr + ux * 3 * dpr);
    g.moveTo(x1, y1); g.lineTo(x1 - ux * 5 * dpr + uy * 3 * dpr, y1 - uy * 5 * dpr - ux * 3 * dpr);
    g.stroke();
  }
}

const layerCss = document.createElement('style');
layerCss.textContent = `
.ow-wm-layers { position: absolute; left: 16px; top: 78px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: calc(100vw - 32px); padding: 5px;
  border-radius: 12px; background: #f4ead8; border: 2px solid #2b2622; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
.ow-wm-layers.hidden { display: none; }
.ow-wm-layers button { border: 0; background: transparent; padding: 6px 11px; border-radius: 9px; font: 600 13px Inter, sans-serif; color: #2b2622; cursor: pointer; }
.ow-wm-layers button.on { background: #2b2622; color: #f4ead8; }
.ow-wm-layers small { padding: 0 6px; font: 500 11px Inter, sans-serif; opacity: .7; }
`;
document.head.appendChild(layerCss);
