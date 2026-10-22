import type { CityId, GeoPlace, Me, Repo } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { esc } from '../interact.ts';
import { searchPlaces } from '../earth/index.ts';
import { DESTINATIONS, REGIONS, toGeoPlace, type Destination, type Region } from './places.ts';
import { Globe } from './globe.ts';
import { armResume, loadPostcard, loadSession, sessionAgo } from '../session.ts';
import { openSettings } from '../ui/settings.ts';
import './landing.css';

const WORLD_KEY = 'openworld.place';
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** Where the player last started (New York the first time). */
function lastStart(): GeoPlace {
  try {
    const saved = localStorage.getItem(WORLD_KEY);
    if (saved && saved !== 'classic') return JSON.parse(saved) as GeoPlace;
  } catch { /* fall through */ }
  return toGeoPlace(DESTINATIONS[0]);
}
/** "New York" for Times Square, otherwise the place itself. */
const cityOf = (p: GeoPlace) => (p.name === DESTINATIONS[0].name ? 'New York' : p.name);

const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (k: keyof typeof ICON) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const STEPS = [
  ['Your work becomes a place', 'Every repo is a real building. CI, pull requests and issues show up on it live.'],
  ['Every agent lives here', 'Claude, Codex, Gemini, Grok or any model through OpenCode take tasks at the desks, on your own keys. Work from Copilot and other agents shows up in the building it changed.'],
  ['Step in and steer', 'Hand off a task, answer a question, review the diff and ship, from the lobby or your phone.'],
];

export function installLanding(opts: { onStart: (where: CityId | GeoPlace) => void }) {
  const root = document.getElementById('title')!;
  root.classList.add('landing');
  let me: Me | null = null;
  let region: Region | 'All' = 'All';
  let showAll = false;
  let globe: Globe | null = null;

  root.innerHTML = `
  <nav class="lp-nav">
    <a class="lp-brand" href="#lp-top"><span class="lp-mark">OW</span><span>OpenWorld HQ</span></a>
    <a class="lp-navlink" href="#lp-places">Destinations</a>
    <a class="lp-navlink lp-navset" href="#" id="lp-nav-settings">${icon('gear')}<span>Settings</span></a>
    <div id="gh-status" class="lp-gh">Connecting to GitHub…</div>
  </nav>

  <header class="lp-hero" id="lp-top">
    <picture class="lp-hero-img">
      <source media="(max-width: 700px)" srcset="/landing/hero-sm.webp">
      <img src="/landing/hero.webp" alt="The OpenWorld site engineer in a hard hat in an HQ lobby, beside a shelf of pull-request parcels and the reception desk" fetchpriority="high">
    </picture>
    <div class="lp-hero-copy">
      <p class="lp-eyebrow">An interactive virtual workspace</p>
      <h1>Walk into your work.</h1>
      <p class="lp-lede">A living world where your work and your AI agents actually live. Your repos are real buildings, with Claude, Codex and every other agent working inside. Watch the work happen, hand off tasks and ship without leaving.</p>
      <div class="lp-cta">
        <button id="lp-resume" class="lp-play hidden" disabled><span class="lp-two"><span>Continue where you left off</span><small id="lp-resume-sub"></small></span>${icon('arrow')}</button>
        <button id="play" class="lp-play" disabled><span id="play-label">Enter New York</span>${icon('arrow')}</button>
        <a class="lp-ghost" href="#lp-places">Start somewhere else</a>
      </div>
      <form id="token-form" class="lp-token hidden">
        <input id="token-input" type="password" placeholder="Paste a GitHub token (repo scope)" autocomplete="off" />
        <button type="submit">Connect</button>
      </form>
      <p id="lp-repos" class="lp-repos"></p>
      <div id="lp-setup" class="lp-setup hidden" aria-label="Set up">
        <b>Set up in two steps</b>
        <ol>
          <li id="lp-setup-gh"><span class="lp-tick"></span><span><b>Connect GitHub</b><small>Run <code>gh auth login</code>, or paste a token above.</small></span></li>
          <li id="lp-setup-agent"><span class="lp-tick"></span><span><b>Add an agent</b><small>Claude Code, Codex, Gemini, Grok or OpenCode, with your own login or API key.</small></span><button type="button" id="lp-setup-open">Add agent</button></li>
        </ol>
      </div>
    </div>
  </header>

  <ol class="lp-steps">${STEPS.map(([t, b], i) => `
    <li><span class="lp-n">${i + 1}</span><div><b>${esc(t)}</b><p>${esc(b)}</p></div></li>`).join('')}
  </ol>

  <section class="lp-section" id="lp-places">
    <div class="lp-head">
      <div><h2>Choose where your city starts</h2><p>${DESTINATIONS.length} places on every continent, or search for your own street. Your buildings move in around you.</p></div>
      <form class="lp-search" id="lp-search">${icon('search')}<input type="text" placeholder="Search any place" aria-label="Search any place" autocomplete="off" /><button type="submit">Search</button></form>
    </div>
    <div class="lp-results hidden" id="lp-results"></div>
    <div class="lp-places">
      <div class="lp-globe-wrap">
        <canvas id="lp-globe" aria-label="The Earth, with a pin on every destination"></canvas>
        <div id="lp-globe-tip" class="lp-globe-tip hidden"></div>
      </div>
      <div class="lp-places-main">
        <div class="lp-tabs" id="lp-tabs"></div>
        <div class="lp-grid" id="lp-grid"></div>
        <button type="button" class="lp-more hidden" id="lp-more"></button>
      </div>
    </div>
  </section>

  <footer class="lp-foot">
    <p>Runs on your machine. Your GitHub token only talks to GitHub.</p>
    <p class="lp-attr">Map data © OpenStreetMap contributors, © OpenMapTiles · Terrain © Mapterhorn, Copernicus · Imagery Sentinel-2 cloudless 2016 by EOX (CC BY 4.0) · Weather Open-Meteo</p>
  </footer>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  // In-page links scroll the landing (it is its own scroll container), not the window.
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#lp-"]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('lp-nav-settings').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
  $('lp-setup-open').addEventListener('click', () => {
    // Re-check when Settings closes, so the card ticks off the step right away.
    openSettings('agents').onClose(() => void connect());
  });
  const nav = root.querySelector('.lp-nav')!;
  root.addEventListener('scroll', () => nav.classList.toggle('solid', root.scrollTop > 24), { passive: true });

  // No GitHub yet is fine: the world works without it, and your repos move in once you connect.
  const go = (where: CityId | GeoPlace) => {
    if (typeof where !== 'string') store(WORLD_KEY, JSON.stringify(where));
    globe?.dispose();
    globe = null;
    opts.onStart(where);
  };

  // ---- hero
  const first = lastStart();
  $('play-label').textContent = `Enter ${cityOf(first)}`;
  $('play').addEventListener('click', () => go(first));
  // A saved session: continuing is the main button; the start place becomes "Start fresh".
  const saved = loadSession();
  if (saved) {
    $('lp-resume').classList.remove('hidden');
    $('lp-resume-sub').textContent = `${saved.label} · ${sessionAgo(saved)}`;
    $('play').classList.replace('lp-play', 'lp-ghost');
    $('play-label').textContent = `Start fresh in ${cityOf(first)}`;
    root.querySelector('.lp-cta > a.lp-ghost')!.remove();
    $('lp-resume').addEventListener('click', () => { if (me?.connected) armResume(saved); go(saved.start); });
  }
  // Once you've played, the hero is your own world: the last frame you saw. New visitors get the standard one.
  const card = loadPostcard();
  if (card) {
    const pic = root.querySelector('.lp-hero-img')!;
    pic.querySelector('source')?.remove();
    const img = pic.querySelector('img')!;
    img.src = card.data;
    img.alt = saved ? `Your world, where you left off: ${saved.label}` : 'Your world, the last time you were here';
    pic.classList.add('own');
  }

  // ---- globe
  try {
    globe = new Globe($('lp-globe') as HTMLCanvasElement, DESTINATIONS);
    const tip = $('lp-globe-tip');
    globe.onHover = (i, x, y) => {
      tip.classList.toggle('hidden', i < 0);
      if (i < 0) return;
      const p = DESTINATIONS[i];
      tip.innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.sub)}</small>`;
      tip.style.transform = `translate(${x + 14}px, ${y - 10}px)`;
    };
    globe.onPin = (i) => go(toGeoPlace(DESTINATIONS[i]));
  } catch { $('lp-globe').closest('.lp-globe-wrap')!.classList.add('hidden'); /* no WebGL: the page still works */ }

  // ---- destinations
  const tabs = $('lp-tabs');
  const renderTabs = () => {
    tabs.innerHTML = (['All', ...REGIONS] as const).map((r) =>
      `<button type="button" class="${r === region ? 'on' : ''}" data-r="${esc(r)}">${esc(r)}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { region = b.dataset.r as Region | 'All'; showAll = false; renderTabs(); renderGrid(); }));
  };
  const lazy = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); paintSatellite(e.target as HTMLCanvasElement); }
  }, { root, rootMargin: '300px' });
  const grid = $('lp-grid');
  const renderGrid = () => {
    const list = DESTINATIONS.map((p, i) => ({ p, i })).filter(({ p }) => region === 'All' || p.region === region);
    if (region === 'All') list.sort((a, b) => Number(!!b.p.featured) - Number(!!a.p.featured));
    // "All" opens on a dozen places; the rest are one click away.
    const cap = region === 'All' && !showAll ? 12 : list.length;
    const more = $('lp-more');
    more.classList.toggle('hidden', cap >= list.length);
    more.textContent = `Show all ${list.length} places`;
    more.onclick = () => { showAll = true; renderGrid(); };
    grid.innerHTML = '';
    for (const { p, i } of list.slice(0, cap)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lp-card';
      b.innerHTML = `<canvas width="480" height="360" data-i="${i}"></canvas>
        <div class="lp-card-meta"><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div>
        <span class="lp-card-go">Start here ${icon('arrow')}</span>`;
      const c = b.querySelector('canvas')!;
      paintFallback(c, p);
      lazy.observe(c);
      b.addEventListener('mouseenter', () => globe?.focus(i));
      b.addEventListener('focus', () => globe?.focus(i));
      b.addEventListener('mouseleave', () => globe?.focus(-1));
      b.addEventListener('click', () => go(toGeoPlace(p)));
      grid.appendChild(b);
    }
  };
  renderTabs();
  renderGrid();

  // ---- search the planet (Nominatim, through the local server)
  const sform = $('lp-search') as HTMLFormElement, sinput = sform.querySelector('input')!, results = $('lp-results');
  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = sinput.value.trim();
    if (!q) return;
    results.classList.remove('hidden');
    results.innerHTML = '<p class="lp-muted">Searching…</p>';
    try {
      const hits = await searchPlaces(q);
      results.innerHTML = hits.length ? '' : '<p class="lp-muted">No places found. Try a city, a neighborhood or a landmark.</p>';
      for (const h of hits) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span><b>${esc(h.name)}</b><small>${esc(h.label)}</small></span><span class="lp-card-go">Start here ${icon('arrow')}</span>`;
        b.addEventListener('click', () => go(h));
        results.appendChild(b);
      }
    } catch (err) {
      results.innerHTML = `<p class="lp-bad">${esc((err as Error).message)}</p>`;
    }
  });

  // ---- GitHub
  const connect = async () => {
    const status = $('gh-status'), form = $('token-form'), play = $('play') as HTMLButtonElement;
    try { me = await api.me(); } catch {
      status.innerHTML = '<span class="dot bad"></span>Server not running';
      $('lp-repos').innerHTML = 'Start the local server with <code>npm start</code>, then reload.';
      return;
    }
    play.disabled = false;
    ($('lp-resume') as HTMLButtonElement).disabled = false;
    if (me.connected) {
      status.innerHTML = `${me.avatarUrl ? `<img src="${esc(me.avatarUrl)}" alt="">` : '<span class="dot"></span>'}<b>${esc(me.login ?? '')}</b>`;
      form.classList.add('hidden');
      api.repos().then((repos: Repo[]) => {
        const top = [...repos].sort((a, b) => b.score - a.score)[0];
        $('lp-repos').innerHTML = `${repos.length} repos ready to move in${top ? ` · <b>${esc(top.name)}</b> gets the tallest tower` : ''}`;
      }).catch(() => { /* the hero is fine without it */ });
    } else {
      status.innerHTML = '<span class="dot bad"></span>Not connected';
      $('lp-repos').innerHTML = 'Connect GitHub: run <code>gh auth login</code> in a terminal, or paste a token.';
      form.classList.remove('hidden');
    }
    // New here: a two-step card until GitHub is connected and at least one coding agent is ready.
    const setup = $('lp-setup');
    setup.classList.toggle('hidden', !!(me.connected && me.agentsReady));
    $('lp-setup-gh').classList.toggle('done', me.connected);
    $('lp-setup-agent').classList.toggle('done', !!me.agentsReady);
    if (!me.connected) $('lp-repos').innerHTML = ''; // the setup card says how
    form.onsubmit = async (e) => {
      e.preventDefault();
      const token = ($('token-input') as HTMLInputElement).value.trim();
      if (!token) return;
      try { me = await api.saveToken(token); } catch (err) { $('lp-repos').textContent = String((err as Error).message); return; }
      connect();
    };
  };
  connect();
}

/** A soft placeholder in the region's colors while the satellite picture loads (or if you're offline). */
function paintFallback(c: HTMLCanvasElement, p: Destination) {
  const g = c.getContext('2d')!;
  const hue = ({ 'North America': 205, 'South America': 160, Europe: 225, Africa: 32, 'Middle East': 38, Asia: 345, Oceania: 190, Antarctica: 200 })[p.region];
  const gr = g.createLinearGradient(0, 0, c.width, c.height);
  gr.addColorStop(0, `hsl(${hue} 35% 22%)`); gr.addColorStop(1, `hsl(${hue + 20} 30% 10%)`);
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,.06)';
  for (let x = 0; x < c.width; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 0; y < c.height; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
}

/** The real place from orbit: a 2×2 block of Sentinel-2 tiles around it, cropped to the card. */
function paintSatellite(c: HTMLCanvasElement) {
  const p = DESTINATIONS[Number(c.dataset.i)];
  // Sentinel-2 is 10 m imagery: z13 is about as sharp as it gets at card size.
  const z = Math.min(13, p.z), n = 2 ** z;
  const fx = ((p.lon + 180) / 360) * n;
  const lat = (p.lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const x0 = Math.round(fx) - 1, y0 = Math.round(fy) - 1;
  const block = document.createElement('canvas');
  block.width = block.height = 512;
  const bg = block.getContext('2d')!;
  let ok = 0;
  const jobs = [0, 1].flatMap((dx) => [0, 1].map((dy) => new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => { bg.drawImage(img, dx * 256, dy * 256); ok++; res(); };
    img.onerror = () => res();
    img.src = `/api/tiles/sat/${z}/${(((x0 + dx) % n) + n) % n}/${Math.min(n - 1, Math.max(0, y0 + dy))}`;
  })));
  Promise.all(jobs).then(() => {
    if (ok < 4) return; // keep the placeholder rather than show a picture with holes
    const g = c.getContext('2d')!;
    // Cover-crop the 512² block into the 4:3 card, centered on the place as far as the block allows.
    const sw = 512, sh = 384;
    const cy = (fy - y0) * 256;
    const sy = Math.max(0, Math.min(512 - sh, cy - sh / 2));
    g.drawImage(block, 0, sy, sw, sh, 0, 0, c.width, c.height);
    c.classList.add('ready');
  });
}
