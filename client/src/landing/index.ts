import type { CityId, GeoPlace, Me, Repo } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { esc } from '../interact.ts';
import { CITIES } from '../city/profiles.ts';
import { searchPlaces } from '../earth/index.ts';
import { DESTINATIONS, REGIONS, toGeoPlace, type Destination, type Region } from './places.ts';
import { Globe } from './globe.ts';
import { tutorialSection, wireTutorial } from './tutorial.ts';
import { armResume, loadSession, sessionAgo } from '../session.ts';
import './landing.css';

const CITY_KEY = 'openworld.city';
const WORLD_KEY = 'openworld.place';
const store = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

/** Where the player last started, so the hero can offer "Continue in …". */
function lastStart(): CityId | GeoPlace {
  try {
    const saved = localStorage.getItem(WORLD_KEY);
    if (saved === 'classic') {
      const c = localStorage.getItem(CITY_KEY) as CityId | null;
      return c && CITIES[c] ? c : 'nyc';
    }
    if (saved) return JSON.parse(saved) as GeoPlace;
  } catch { /* fall through */ }
  return toGeoPlace(DESTINATIONS[0]);
}
const whereName = (w: CityId | GeoPlace) => (typeof w === 'string' ? CITIES[w].name : w.name);

const ICON = {
  building: '<path d="M4 21V5l7-3v19M11 21V9l9 3v9M2 21h20M7 8h1M7 12h1M7 16h1M14 14h2M14 18h2"/>',
  desk: '<circle cx="12" cy="6" r="3"/><path d="M6 15c0-3 2.7-5 6-5s6 2 6 5M3 15h18M5 15v6M19 15v6"/>',
  agent: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6M2 12v3M22 12v3"/>',
  board: '<path d="M3 10h18v8H3zM6 18v3M18 18v3"/><circle cx="6" cy="6" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="6" r="2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M9 8h6M9 11h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  vr: '<path d="M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-3l-2-3h-2l-2 3H6a3 3 0 0 1-3-3z"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/>',
};
const icon = (k: keyof typeof ICON, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const FEATURES: { icon: keyof typeof ICON; title: string; body: string; tag?: string; wide?: boolean }[] = [
  { icon: 'building', wide: true, title: 'Every repo is a building', body: 'Your most active projects take the tallest towers, logo on the crown. Weekend experiments are corner storefronts. They move in wherever you start, on real streets.' },
  { icon: 'desk', title: 'Every PR is a person', body: 'On the work floor each desk is a past change. Whoever made it, you, a teammate or an agent, sits there and walks you through it with the real diff.' },
  { icon: 'agent', title: 'Hire an agent', body: 'Type a task in the Agent Lab. A Claude Code agent takes a desk in its own git worktree. Watch the diff grow, stop it, or open a pull request.' },
  { icon: 'board', title: 'Put it to the board', body: 'Your Chair, CTO, Head of Product, Design Lead and Growth argue a decision out and record a resolution with next steps.' },
  { icon: 'phone', title: 'HQ in your pocket', body: 'Press P anywhere: mid-flight over the Alps, or across town from the office. Text HQ or any project’s lead agent; they dispatch agents in the right buildings, then report back.' },
  { icon: 'globe', wide: true, title: 'The whole planet, streamed', body: 'Real OpenStreetMap buildings and roads, real terrain, live local weather and a satellite horizon load around you as you move. Walk, skate, drive, fly a prop plane, or paddle out.' },
  { icon: 'vr', title: 'Step inside on Quest', tag: 'New', body: 'Run npm run vr and open the same world in the Meta Quest browser. Stand in it, walk it with the sticks, and wear your phone on your wrist.' },
];

const KEYS: [string, string][] = [
  ['W A S D', 'Move'], ['Shift', 'Run'], ['Space', 'Jump · hold in the air to fly'], ['E', 'Enter · talk'],
  ['P', 'Phone'], ['M', 'Map of the world'], ['1–7', 'Skate, bike, jeep, plane, boats'], ['F', 'Photo mode'],
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
    <div class="lp-links"><a href="#lp-tour">Tutorial</a><a href="#lp-how">How it works</a><a href="#lp-places">Destinations</a><a href="#lp-classic">Classic cities</a></div>
    <div id="gh-status" class="lp-gh">Connecting to GitHub…</div>
  </nav>

  <header class="lp-hero" id="lp-top">
    <div class="lp-hero-copy">
      <p class="lp-eyebrow">A living open world for your code</p>
      <h1>Your GitHub,<br>anywhere on Earth.</h1>
      <p class="lp-lede">Every repo becomes a building on real streets, every pull request a person at a desk, and Claude agents get to work inside. Start in any city on the planet and walk, drive or fly between your projects.</p>
      <div class="lp-cta">
        <button id="lp-resume" class="lp-play lp-resume hidden" disabled><span><span>Continue where you left off</span><small id="lp-resume-sub"></small></span>${icon('arrow')}</button>
        <button id="play" class="lp-play" disabled><span id="play-label">Enter the world</span>${icon('arrow')}</button>
        <button type="button" class="lp-ghost lp-watch" id="lp-watch">${icon('play')}Watch the tutorial</button>
      </div>
      <p class="lp-or">or <a href="#lp-places">pick a destination</a> anywhere on Earth</p>
      <form id="token-form" class="lp-token hidden">
        <input id="token-input" type="password" placeholder="Paste a GitHub token (repo scope)" autocomplete="off" />
        <button type="submit">Connect</button>
      </form>
      <p id="lp-repos" class="lp-repos"></p>
    </div>
    <div class="lp-globe-wrap">
      <canvas id="lp-globe" aria-label="The Earth, with a pin on every destination"></canvas>
      <div id="lp-globe-tip" class="lp-globe-tip hidden"></div>
    </div>
  </header>

${tutorialSection()}

  <section class="lp-section" id="lp-how">
    <div class="lp-head"><p class="lp-eyebrow">How it works</p><h2>An office you can walk around in.</h2></div>
    <div class="lp-bento">${FEATURES.map((f) => `
      <article class="lp-feat${f.wide ? ' wide' : ''}">
        <div class="lp-feat-ico">${icon(f.icon)}</div>
        <h3>${esc(f.title)}${f.tag ? ` <span class="lp-tag">${esc(f.tag)}</span>` : ''}</h3>
        <p>${esc(f.body)}</p>
      </article>`).join('')}
    </div>
  </section>

  <section class="lp-section" id="lp-places">
    <div class="lp-head lp-head-row">
      <div><p class="lp-eyebrow">Destinations</p><h2>Start anywhere. ${DESTINATIONS.length} favorites, or search the planet.</h2></div>
      <form class="lp-search" id="lp-search">${icon('search')}<input type="text" placeholder="Search any place: your street, your hometown…" autocomplete="off" /><button type="submit">Search</button></form>
    </div>
    <div class="lp-results hidden" id="lp-results"></div>
    <div class="lp-tabs" id="lp-tabs"></div>
    <div class="lp-grid" id="lp-grid"></div>
    <button type="button" class="lp-more hidden" id="lp-more"></button>
  </section>

  <section class="lp-section" id="lp-classic">
    <div class="lp-head"><p class="lp-eyebrow">Classic cities</p><h2>Hand-built, procedural, and fast on any laptop.</h2></div>
    <div class="lp-classic" id="cities"></div>
  </section>

  <section class="lp-section lp-keys-wrap">
    <div class="lp-head"><p class="lp-eyebrow">Controls</p><h2>Picks up like a game.</h2></div>
    <div class="lp-keys">${KEYS.map(([k, v]) => `<div class="lp-key"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div>
  </section>

  <footer class="lp-foot">
    <p>Runs entirely on your machine. Your GitHub token only ever talks to GitHub.</p>
    <p class="lp-attr">Map data © OpenStreetMap contributors, © OpenMapTiles · Terrain © Mapterhorn, Copernicus · Imagery Sentinel-2 cloudless 2016 by EOX (CC BY 4.0) · Weather Open-Meteo</p>
  </footer>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  // In-page links scroll the landing (it is its own scroll container), not the window.
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#lp-"]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const tour = wireTutorial(root);
  $('lp-watch').addEventListener('click', () => tour.play());
  const nav = root.querySelector('.lp-nav')!;
  root.addEventListener('scroll', () => nav.classList.toggle('solid', root.scrollTop > 24), { passive: true });

  const go = (where: CityId | GeoPlace) => {
    if (!me?.connected) {
      root.scrollTo({ top: 0, behavior: 'smooth' });
      const s = $('gh-status'); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash');
      ($('token-input') as HTMLInputElement).focus({ preventScroll: true });
      return;
    }
    if (typeof where === 'string') { store(CITY_KEY, where); store(WORLD_KEY, 'classic'); }
    else store(WORLD_KEY, JSON.stringify(where));
    globe?.dispose();
    globe = null;
    opts.onStart(where);
  };

  // ---- hero
  const resume = lastStart();
  $('play-label').textContent = `${typeof resume === 'string' || resume.name !== DESTINATIONS[0].name ? 'Continue in' : 'Start in'} ${whereName(resume)}`;
  $('play').addEventListener('click', () => go(resume));
  // A saved session: continuing is the main button; the start place becomes "Start fresh".
  const saved = loadSession();
  if (saved) {
    $('lp-resume').classList.remove('hidden');
    $('lp-resume-sub').textContent = `${saved.label} · ${sessionAgo(saved)}`;
    $('play').classList.replace('lp-play', 'lp-ghost');
    $('play-label').textContent = `Start fresh in ${whereName(lastStart())}`;
    $('lp-resume').addEventListener('click', () => { if (me?.connected) armResume(saved); go(saved.start); });
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
  } catch { $('lp-globe').classList.add('hidden'); /* no WebGL: the page still works */ }

  // ---- destinations
  const tabs = $('lp-tabs');
  const renderTabs = () => {
    tabs.innerHTML = (['All', ...REGIONS] as const).map((r) => {
      const n = r === 'All' ? DESTINATIONS.length : DESTINATIONS.filter((p) => p.region === r).length;
      return `<button type="button" class="${r === region ? 'on' : ''}" data-r="${esc(r)}">${esc(r)}<span>${n}</span></button>`;
    }).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { region = b.dataset.r as Region | 'All'; showAll = false; renderTabs(); renderGrid(); }));
  };
  const lazy = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); paintSatellite(e.target as HTMLCanvasElement); }
  }, { root, rootMargin: '300px' });
  const grid = $('lp-grid');
  const renderGrid = () => {
    const list = DESTINATIONS.map((p, i) => ({ p, i })).filter(({ p }) => region === 'All' || p.region === region);
    if (region === 'All') list.sort((a, b) => Number(!!b.p.featured) - Number(!!a.p.featured));
    // "All" opens on the featured places plus a few more; the rest are one click away.
    const cap = region === 'All' && !showAll ? 22 : list.length;
    const more = $('lp-more');
    more.classList.toggle('hidden', cap >= list.length);
    more.textContent = `Show all ${list.length} destinations`;
    more.onclick = () => { showAll = true; renderGrid(); };
    grid.innerHTML = '';
    for (const { p, i } of list.slice(0, cap)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lp-card${p.featured && region === 'All' ? ' feat' : ''}`;
      b.innerHTML = `<canvas width="480" height="360" data-i="${i}"></canvas>
        <div class="lp-card-meta"><span class="lp-cc">${esc(p.cc.toUpperCase())}</span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></div>
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

  // ---- classic cities
  const cities = $('cities');
  for (const p of Object.values(CITIES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lp-city';
    b.innerHTML = `<canvas width="400" height="200"></canvas><div><b>${esc(p.name)}</b><small>${esc(p.district)} · ${esc(p.blurb)}</small></div>`;
    drawSkyline(b.querySelector('canvas')!, p.id);
    b.addEventListener('click', () => go(p.id));
    cities.appendChild(b);
  }

  // ---- GitHub
  const connect = async () => {
    const status = $('gh-status'), form = $('token-form'), play = $('play') as HTMLButtonElement;
    try { me = await api.me(); } catch {
      status.innerHTML = '<span class="dot bad"></span>Local server isn’t running. Start it with <b>npm start</b>.';
      return;
    }
    if (me.connected) {
      status.innerHTML = `${me.avatarUrl ? `<img src="${esc(me.avatarUrl)}" alt="">` : '<span class="dot"></span>'}<b>${esc(me.login ?? '')}</b>${me.claudeAvailable ? '<span class="lp-gh-sub">agents ready</span>' : '<span class="lp-gh-sub bad">install Claude Code for agents</span>'}`;
      form.classList.add('hidden');
      play.disabled = false;
      ($('lp-resume') as HTMLButtonElement).disabled = false;
      api.repos().then((repos: Repo[]) => {
        const top = [...repos].sort((a, b) => b.score - a.score)[0];
        $('lp-repos').innerHTML = `${repos.length} of your repos are ready to move in${top ? `. <b>${esc(top.name)}</b> gets the tallest tower.` : '.'}`;
      }).catch(() => { /* the hero is fine without it */ });
    } else {
      status.innerHTML = '<span class="dot bad"></span>Not connected to GitHub';
      $('lp-repos').innerHTML = 'Run <code>gh auth login</code> in a terminal, or paste a token above.';
      form.classList.remove('hidden');
    }
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

/** Little procedural skyline postcard for each classic city. */
function drawSkyline(c: HTMLCanvasElement, id: CityId) {
  const g = c.getContext('2d')!;
  const p = CITIES[id], W = c.width, H = c.height, base = H * 0.82;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0f1a2e'); sky.addColorStop(1, p.thumb[1]);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = p.thumb[0]; g.globalAlpha = 0.85;
  g.beginPath(); g.arc(W * 0.8, H * 0.3, 20, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  let seed = id.length * 977;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < W;) {
    const w = 12 + r() * 22;
    const peak = Math.exp(-(((x - W / 2) / (W * 0.3)) ** 2));
    const h = 24 + r() * 40 + peak * (p.maxHeight / 2.6) * r();
    g.fillStyle = `rgba(10,14,22,${0.85 + r() * 0.15})`;
    g.fillRect(x, base - h, w, h + 40);
    g.fillStyle = 'rgba(255,214,140,0.7)';
    for (let wy = base - h + 6; wy < base - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (r() < 0.3) g.fillRect(wx, wy, 2, 3);
    x += w + 1;
  }
  g.fillStyle = id === 'miami' ? '#1f6f80' : '#16324a';
  g.fillRect(0, base, W, H - base);
}
