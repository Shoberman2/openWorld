/// <reference types="vite/client" />
// The streaming-world HUD: compass strip, info panel, navigation card, control hints, mode bar and
// map attributions. Pure DOM in #hud; update() is cheap enough to call every frame.
import { bearing, haversine } from '../earth/frame.ts';
import './hud.css';

export interface HudFrame {
  lat: number; lon: number;
  altitude: number; // meters above sea level
  agl: number; // meters above ground
  heading: number; // compass degrees
  pitch: number; // degrees, + = looking up
  speed: number; // m/s
  localTime: string;
  place: string;
  sub?: string;
  mode: 'walk' | 'fly' | 'indoors';
  waypoint: { lat: number; lon: number; name: string } | null;
  imperial: boolean;
  /** Real weather line from the game; falls back to a made-up one. */
  weather?: string;
  /** Optional extra status, e.g. "on road", "on roof". */
  surface?: string;
  /** The building in the middle of the view ("Chrysler Building · 405 Lexington Ave"). */
  looking?: { title: string; sub: string } | null;
}

/** The look-at label can be switched off (map Settings); remembered per browser. */
export const lookLabels = {
  get on() { try { return localStorage.getItem('ow.lookLabels') !== '0'; } catch { return true; } },
  set on(v: boolean) { try { localStorage.setItem('ow.lookLabels', v ? '1' : '0'); } catch { /* private mode */ } },
};

export interface Hud {
  update(f: HudFrame): void;
  setMode(id: string): void;
  setVisible(on: boolean): void;
  /** Swap the hint set shown bottom-left (also follows HudFrame.mode automatically). */
  setHints(key: string): void;
  el: HTMLElement;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const PX_PER_DEG = 3.2;
const STRIP_W = 460;

export const ATTRIBUTION = 'Terrain © Mapterhorn, Copernicus · Imagery: Sentinel-2 cloudless 2016 (EOX) · © OpenMapTiles, © OpenStreetMap contributors';

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "[W][A][S][D] Move · [Space] Jump" → keycaps. */
function hintHtml(s: string) {
  return s.split(' · ').map((part) => `<span class="ow-hint">${esc(part).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>')}</span>`).join('');
}

export function formatDistance(m: number, imperial: boolean) {
  if (imperial) {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`;
    const mi = m / 1609.344;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString()} mi`;
  }
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}

/** Plausible weather for a place and hour, stable over the hour (no network). */
function fakeWeather(lat: number, lon: number, localTime: string, imperial: boolean) {
  const h = (() => { const m = /(\d+):(\d+)\s*(AM|PM)?/i.exec(localTime); if (!m) return 12; let hh = Number(m[1]) % 12; if (m[3]?.toUpperCase() === 'PM') hh += 12; if (!m[3]) hh = Number(m[1]); return hh + Number(m[2]) / 60; })();
  const day = Math.floor(Date.now() / 86400000);
  const seed = Math.sin(day * 12.9898 + Math.round(lat) * 78.233 + Math.round(lon) * 37.719) * 43758.5453;
  const r = seed - Math.floor(seed);
  const month = new Date().getUTCMonth();
  const summer = lat >= 0 ? Math.cos(((month - 6.5) / 12) * Math.PI * 2) : -Math.cos(((month - 6.5) / 12) * Math.PI * 2);
  const base = 27 - Math.abs(lat) * 0.42 + summer * Math.min(14, Math.abs(lat) * 0.35);
  const diurnal = -Math.cos(((h - 3) / 24) * Math.PI * 2) * 5;
  const c = base + diurnal + (r - 0.5) * 6;
  const sky = ['Sunny', 'Mostly sunny', 'Partly sunny', 'Partly cloudy', 'Mostly cloudy', 'Light breeze, clear'][Math.floor(r * 6)];
  const night = h < 6 || h > 20;
  const label = night ? sky.replace('Sunny', 'Clear').replace('sunny', 'clear') : sky;
  const wind = Math.round(3 + r * 14);
  const from = DIRS[Math.floor(r * 97) % 8];
  return imperial ? `${label} · ${Math.round(c * 9 / 5 + 32)} °F · wind ${wind} mph from the ${from}` : `${label} · ${Math.round(c)} °C · wind ${Math.round(wind * 1.609)} km/h from the ${from}`;
}

export function installHud(opts: { modes: { id: string; label: string; icon?: string }[]; hints: Record<string, string[]>; onMode?: (id: string) => void }): Hud {
  const root = document.getElementById('hud') ?? document.body;
  root.classList.add('ow-earth-hud');
  const el = document.createElement('div');
  el.className = 'ow-hud';

  // Compass strip.
  const ticks: string[] = [];
  for (let d = -360; d <= 720; d += 5) {
    const deg = ((d % 360) + 360) % 360;
    const x = (d + 360) * PX_PER_DEG;
    if (deg % 45 === 0) ticks.push(`<span class="ow-cdir${deg === 0 ? ' n' : ''}" style="left:${x}px">${DIRS[deg / 45]}</span>`);
    else ticks.push(`<i class="ow-tick${deg % 15 === 0 ? ' mid' : ''}" style="left:${x}px"></i>`);
  }
  el.innerHTML = `
    <div class="ow-cwrap" style="width:${STRIP_W}px">
      <div class="ow-compass">
        <div class="ow-cstrip">${ticks.join('')}</div>
        <div class="ow-cpin hidden"><b></b></div>
        <div class="ow-cnotch"></div>
      </div>
      <div class="ow-cdeg">0°</div>
      <div class="ow-cdist hidden"></div>
    </div>
    <div class="ow-info">
      <div class="ow-i-coord"></div>
      <div class="ow-i-alt"></div>
      <div class="ow-i-hdg"></div>
      <div class="ow-i-wx"></div>
      <div class="ow-i-sep"></div>
      <div class="ow-i-place"></div>
      <div class="ow-i-time"></div>
    </div>
    <div class="ow-look"><b></b><span></span></div>
    <div class="ow-nav hidden">
      <div class="ow-nav-arrow">↑</div>
      <div class="ow-nav-text"><b></b><span></span><small><i></i><em></em></small></div>
    </div>
    <div class="ow-hints"></div>
    <div class="ow-modes">${opts.modes.map((m) => `<div class="ow-mode" data-id="${esc(m.id)}">${m.icon ? `<span class="ow-mode-i">${m.icon}</span>` : ''}<span>${esc(m.label)}</span></div>`).join('')}</div>
    <div class="ow-attrib">${esc(ATTRIBUTION)}</div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector(s) as T;
  const strip = q('.ow-cstrip'), deg = q('.ow-cdeg'), pin = q('.ow-cpin'), cdist = q('.ow-cdist');
  const coord = q('.ow-i-coord'), alt = q('.ow-i-alt'), hdg = q('.ow-i-hdg'), wx = q('.ow-i-wx'), place = q('.ow-i-place'), time = q('.ow-i-time');
  const nav = q('.ow-nav'), navArrow = q('.ow-nav-arrow');
  const navDist = q('.ow-nav-text b'), navDir = q('.ow-nav-text span'), navName = q('.ow-nav-text em');
  const hints = q('.ow-hints');
  const look = q('.ow-look'), lookTitle = q('.ow-look b'), lookSub = q('.ow-look span');
  let lookKey = '';
  let hintKey = '';
  const setHints = (key: string) => {
    if (key === hintKey) return;
    hintKey = key;
    const rows = opts.hints[key] ?? [];
    hints.innerHTML = rows.map((r) => `<div class="ow-hrow">${hintHtml(r)}</div>`).join('');
    hints.classList.toggle('hidden', rows.length === 0);
  };
  if (opts.onMode) el.querySelectorAll<HTMLElement>('.ow-mode').forEach((m) => { m.style.pointerEvents = 'auto'; m.style.cursor = 'pointer'; m.addEventListener('click', () => opts.onMode!(m.dataset.id!)); });
  const setMode = (id: string) => el.querySelectorAll<HTMLElement>('.ow-mode').forEach((m) => m.classList.toggle('on', m.dataset.id === id));

  let slow = 0;
  let wxText = '', wxAt = 0;
  return {
    el,
    setMode,
    setHints,
    setVisible(on) { el.classList.toggle('hidden', !on); root.classList.toggle('ow-earth-hud', on); },
    update(f) {
      const h = ((f.heading % 360) + 360) % 360;
      strip.style.transform = `translateX(${STRIP_W / 2 - (h + 360) * PX_PER_DEG}px)`;
      deg.textContent = `${Math.round(h) % 360}°`;

      if (f.waypoint) {
        const here = { lat: f.lat, lon: f.lon };
        const dist = haversine(here, f.waypoint);
        const b = bearing(here, f.waypoint);
        let rel = b - h;
        rel = ((rel + 540) % 360) - 180;
        const half = STRIP_W / 2 / PX_PER_DEG - 6;
        const x = STRIP_W / 2 + Math.max(-half, Math.min(half, rel)) * PX_PER_DEG;
        pin.classList.remove('hidden');
        pin.style.left = `${x}px`;
        pin.classList.toggle('edge', Math.abs(rel) > half);
        cdist.classList.remove('hidden');
        cdist.style.left = `${x}px`;
        cdist.textContent = formatDistance(dist, f.imperial);
        nav.classList.remove('hidden');
        navArrow.style.transform = `rotate(${rel}deg)`;
        navDist.textContent = formatDistance(dist, f.imperial);
        const a = Math.abs(rel);
        navDir.textContent = dist < 25 ? 'You have arrived' : a < 20 ? 'Straight ahead' : a > 150 ? 'Behind you' : rel < 0 ? (a < 60 ? 'Bear left' : 'To your left') : (a < 60 ? 'Bear right' : 'To your right');
        navName.textContent = f.waypoint.name;
      } else {
        pin.classList.add('hidden');
        cdist.classList.add('hidden');
        nav.classList.add('hidden');
      }

      setHints(f.mode);
      const lk = lookLabels.on && f.mode !== 'indoors' ? f.looking ?? null : null;
      const key = lk ? lk.title + '|' + lk.sub : '';
      if (key !== lookKey) {
        lookKey = key;
        if (lk) { lookTitle.textContent = lk.title; lookSub.textContent = lk.sub; }
        look.classList.toggle('on', !!lk);
      }
      // Text lines don't need 60 Hz.
      slow -= 1;
      if (slow > 0) return;
      slow = 6;
      const ns = f.lat >= 0 ? 'N' : 'S', ew = f.lon >= 0 ? 'E' : 'W';
      coord.textContent = `${Math.abs(f.lat).toFixed(5)}° ${ns}, ${Math.abs(f.lon).toFixed(5)}° ${ew}`;
      const len = (m: number) => (f.imperial ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);
      alt.textContent = `Alt ${len(f.altitude)} · AGL ${len(Math.max(0, f.agl))}${f.surface ? ` · ${f.surface}` : ''}`;
      const spd = f.imperial ? `${Math.round(f.speed * 2.23694)} mph` : `${Math.round(f.speed * 3.6)} km/h`;
      hdg.textContent = `Hdg ${String(Math.round(h) % 360).padStart(3, '0')}° · Pitch ${Math.round(f.pitch)}° · ${spd}`;
      if (f.weather) wxText = f.weather;
      else if (Date.now() - wxAt > 20000) { wxText = fakeWeather(f.lat, f.lon, f.localTime, f.imperial); wxAt = Date.now(); }
      wx.textContent = wxText;
      place.textContent = f.sub ? `${f.place} · ${f.sub}` : f.place;
      time.textContent = f.localTime;
    },
  };
}
