import { esc } from '../interact.ts';

/**
 * The landing page's tutorial: a step per feature, each with real captures from the game (clips and stills
 * made by scripts/capture-tutorial.mjs into /tutorial/, listed in /tutorial/manifest.json).
 * A vertical tab list on the right (chips on phones), a stage on the left. "Play the tour" walks
 * through every step on its own; otherwise the current step's media loops.
 */

interface StepMedia { clip?: string; poster?: string; stills?: string[]; v?: string }
interface Manifest { steps: Record<string, StepMedia> }

interface Step {
  id: string;
  title: string;
  short: string;
  body: string;
  keys: [string, string][];
  /** What the keys row is called (default: Keyboard). */
  keysLabel?: string;
  quest: string;
}

export const TUTORIAL: Step[] = [
  {
    id: 'drop', title: 'Pick a place and drop in', short: 'Drop in',
    body: 'Choose one of the destinations below, or search any street on Earth. You fall in from the sky while the real city streams in around you: OpenStreetMap buildings and roads, terrain, trees and the live local weather.',
    keys: [['Click', 'a destination'], ['M', 'then Drop here, from anywhere']],
    quest: 'Pick the place in the Quest browser, then press Enter VR.',
  },
  {
    id: 'move', title: 'Jog by default, Shift to run', short: 'Move',
    body: 'The robot jogs wherever you point it. Hold Shift to break into a run, Space to jump. Click the game once to steer the camera with the mouse; the wheel pulls it in or out.',
    keys: [['W A S D', 'Move'], ['Shift', 'Run'], ['Space', 'Jump'], ['Mouse', 'Look']],
    quest: 'Left stick moves. Hold grip or trigger to run, or click the stick to lock running on.',
  },
  {
    id: 'rocket', title: 'Rocket boost', short: 'Rockets',
    body: 'Jump, then hold Space and the rocket shoes fire and launch you upward. Keep holding to climb, let go to coast and fall, steer with W A S D. Shift is the afterburner, C dives. Land on roofs, bridges, anywhere.',
    keys: [['Space', 'Hold in the air to boost'], ['Shift', 'Afterburner'], ['C', 'Dive']],
    quest: 'A jumps; hold A in the air for the rockets. Push the right stick down to dive.',
  },
  {
    id: 'vehicles', title: 'Eight ways to get around', short: 'Vehicles',
    body: 'Number keys swap what you ride: on foot, skateboard, bike, jeep, prop plane, kayak, motorboat and the space shuttle. The plane needs a runway’s worth of clear ground, or switch to it mid-air. Boats find the nearest water.',
    keys: [['1', 'On foot'], ['2 · 3 · 4', 'Skate, bike, jeep'], ['5', 'Plane'], ['6 · 7', 'Kayak, boat'], ['8', 'Shuttle']],
    quest: 'Y steps through the vehicles.',
  },
  {
    id: 'travel', title: 'Cross the planet', short: 'Shuttle',
    body: 'The shuttle launches from anywhere dry and goes supersonic on its boosters. Pick a place on the map and press Autopilot: it climbs out, follows the great circle with time running at 40×, and hands you the controls overhead. Bail out with 1, then Q opens the wingsuit for the glide down.',
    keys: [['8', 'Shuttle'], ['Shift', 'Boosters'], ['O', 'Autopilot to the waypoint'], ['Q', 'Wingsuit, in the air']],
    quest: 'Y picks the shuttle; set the autopilot on the map before you put the headset on.',
  },
  {
    id: 'map', title: 'The map of the world', short: 'Map',
    body: 'M opens a map of the whole planet. Search, browse famous places, or click any spot: Drop here takes you there in seconds, Navigate here puts a waypoint on your compass and minimap. Zoom all the way out and it becomes a globe with live clouds, storms and wind. Tab lists your projects.',
    keys: [['M', 'Map'], ['Click', 'Drop or navigate'], ['Wheel', 'Out to the globe'], ['Tab', 'Your projects']],
    quest: 'Plan your route on the map before you press Enter VR.',
  },
  {
    id: 'landmarks', title: 'Know where you are', short: 'Landmarks',
    body: 'The famous buildings are built by hand: the Empire State, Chrysler, One World Trade, the Flatiron, Grand Central, the Brooklyn Bridge, the Statue of Liberty, the Eiffel Tower, Big Ben, the Golden Gate. Times Square’s screens play after dark, street signs carry the real names, and a glance at any building tells you what and where it is.',
    keys: [['Look', 'Name and address of the building'], ['M · Settings', 'Building names, street signs']],
    quest: 'Look at a building for a moment to see its name.',
  },
  {
    id: 'hq', title: 'Your repos are buildings', short: 'Your HQs',
    body: 'Every repo you own moves into the streets where you start. The busiest projects take the tallest towers, with the logo on the entrance; small experiments get storefronts. Walk up to the door and press E.',
    keys: [['E', 'Enter at the door'], ['Tab', 'Waypoint or fly to any HQ']],
    quest: 'Pull the right trigger (or B) at the door.',
  },
  {
    id: 'inside', title: 'Reception, the elevator, a desk for every PR', short: 'Inside',
    body: 'The receptionist knows the project: README, stats, recent work. Take the elevator between floors. On the work floor each desk is a past pull request, and whoever made it, you, a teammate or an agent, explains it from the real diff and answers follow-ups.',
    keys: [['E', 'Talk, call the elevator'], ['Esc', 'Close a conversation']],
    quest: 'Trigger to talk. The conversation floats in front of you with ready-made questions.',
  },
  {
    id: 'lab', title: 'Hire an agent', short: 'Agent Lab',
    body: 'At the Agent Lab kiosk, type a task. A real Claude Code agent starts in its own git worktree of the repo, takes a desk, and its monitor shows the work live. Watch the diff grow, stop it, or open a pull request when it’s done.',
    keys: [['E', 'Use the kiosk'], ['Enter', 'Start the agent']],
    quest: 'Pick a task from the floating panel with the trigger.',
  },
  {
    id: 'board', title: 'Put it to the board', short: 'Boardroom',
    body: 'Bring a decision to the boardroom. The Chair, CTO, Head of Product, Design Lead and Growth debate it in turns and take sides, then the Chair records a resolution with next steps. Past decisions stay on the wall.',
    keys: [['E', 'Convene at the head of the table']],
    quest: 'Trigger at the table; follow the debate on the floating panel.',
  },
  {
    id: 'phone', title: 'The phone, on your left', short: 'Phone',
    body: 'Press P anywhere, across town or mid-flight. Text HQ, or the lead agent of any project, and they put agents to work and text you back when they finish. See every agent running across all your buildings, stop one, or jump to its desk. No pull request opens unless you ask for one.',
    keys: [['P', 'Open the phone'], ['Esc', 'Put it away']],
    quest: 'X raises the phone on your wrist. Point and pull the trigger to tap.',
  },
  {
    id: 'home', title: 'Your apartment on Central Park South', short: 'Home',
    body: 'Home is a real tower at 150 Central Park South, floor 33, with the whole park outside the windows. The doorman lets you in; sit on the sofa for a time-lapse, sleep till morning, check every agent on the desk monitor. The phone’s Home button flies you there from anywhere on Earth.',
    keys: [['P', 'Phone, Maps, Home'], ['Tab', 'Home, fast travel'], ['E', 'At the door']],
    quest: 'Home is in the wrist phone’s Maps.',
  },
  {
    id: 'photo', title: 'Photo mode and time-lapse', short: 'Photos',
    body: 'L runs a time-lapse: clouds race, the sun sets, the city lights up. F is photo mode: a free camera with depth of field, zoom and time of day. Space saves the picture to ~/.openworld/photos. X sits you down.',
    keys: [['L', 'Time-lapse'], ['F', 'Photo mode'], ['T', '+3 hours'], ['X', 'Sit']],
    quest: 'Skip ahead 3 hours from the wrist phone’s VR tab.',
  },
  {
    id: 'vr', title: 'Stand inside it on a Quest', short: 'VR',
    body: 'Run npm run vr on your Mac. It prints an https address; open it in the Quest browser on the same Wi-Fi, accept the certificate once, then press Enter VR. Prefer a cable? adb reverse tcp:4317 tcp:4317 and open localhost:4317.',
    keys: [['npm run vr', 'Serve to the headset']], keysLabel: 'On the Mac',
    quest: 'Left stick walks, right stick turns, A jumps and boosts, B or trigger is E, X is the phone, Y the vehicles.',
  },
];

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const QUEST = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-3l-2-3h-2l-2 3H6a3 3 0 0 1-3-3z"/></svg>';

const STILL_MS = 3200;

/** Markup for the tutorial section; call wireTutorial once it's in the DOM. */
export function tutorialSection() {
  return `
  <section class="lp-section lp-tour" id="lp-tour" aria-labelledby="lp-tour-h">
    <div class="lp-head lp-head-row">
      <div><p class="lp-eyebrow">Tutorial</p><h2 id="lp-tour-h">Everything it does, in ${TUTORIAL.length} short steps.</h2></div>
      <button type="button" class="lp-tour-play" id="tour-play" aria-pressed="false">${ICON_PLAY}<span>Play the tour</span></button>
    </div>
    <div class="lp-tour-grid">
      <div class="lp-tour-main">
        <div class="lp-stage" id="tour-stage" aria-live="off">
          <div class="lp-stage-media" id="tour-media"></div>
          <div class="lp-stage-dots" id="tour-dots"></div>
          <div class="lp-stage-bar"><i id="tour-bar"></i></div>
          <span class="lp-stage-badge">Real gameplay</span>
        </div>
        <div class="lp-tour-copy" id="tour-panel" role="tabpanel" tabindex="0" aria-live="polite"></div>
      </div>
      <div class="lp-tour-steps" role="tablist" aria-orientation="vertical" aria-label="Tutorial steps" id="tour-steps">
        ${TUTORIAL.map((s, i) => `
        <button type="button" role="tab" id="tour-tab-${s.id}" aria-controls="tour-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}">
          <span class="lp-step-n">${String(i + 1).padStart(2, '0')}</span>
          <span class="lp-step-t"><b>${esc(s.title)}</b><small>${esc(s.keys[0][0])}</small></span>
          <span class="lp-step-chip">${esc(s.short)}</span>
        </button>`).join('')}
      </div>
    </div>
    <div class="lp-tour-nav">
      <button type="button" id="tour-prev" aria-label="Previous step">${ICON_PREV}</button>
      <span id="tour-count">1 / ${TUTORIAL.length}</span>
      <button type="button" id="tour-next" aria-label="Next step">${ICON_NEXT}</button>
    </div>
  </section>`;
}

export function wireTutorial(scroller: HTMLElement) {
  const $ = (id: string) => document.getElementById(id)!;
  const tabs = [...$('tour-steps').querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const media = $('tour-media'), dots = $('tour-dots'), bar = $('tour-bar'), panel = $('tour-panel'), playBtn = $('tour-play');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let manifest: Manifest = { steps: {} };
  let cur = 0;
  let item = 0;
  let touring = false;
  let visible = false;
  let timer = 0;
  let loaded = false;

  const url = (f: string, v?: string) => `/tutorial/${f}${v ? `?v=${v}` : ''}`;
  type Item = { kind: 'clip' | 'still'; src: string; poster?: string };
  const itemsOf = (id: string): Item[] => {
    const m = manifest.steps[id];
    if (!m) return [];
    return [
      ...(m.clip ? [{ kind: 'clip' as const, src: url(m.clip, m.v), poster: m.poster ? url(m.poster, m.v) : undefined }] : []),
      ...(m.stills ?? []).map((s) => ({ kind: 'still' as const, src: url(s, m.v) })),
    ];
  };

  // Each tab gets a little thumbnail once the manifest is in.
  const thumbs = () => {
    TUTORIAL.forEach((s, i) => {
      const m = manifest.steps[s.id];
      const src = m?.poster ?? m?.stills?.[0];
      const n = tabs[i].querySelector('.lp-step-n')!;
      if (src && !tabs[i].querySelector('img')) n.insertAdjacentHTML('afterend', `<img src="${url(src, m!.v)}" alt="" loading="lazy" decoding="async">`);
    });
  };

  const setBar = (ms: number) => {
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(0)';
    if (ms <= 0) return;
    void bar.offsetWidth;
    bar.style.transition = `transform ${ms}ms linear`;
    bar.style.transform = 'scaleX(1)';
  };

  const next = () => {
    const items = itemsOf(TUTORIAL[cur].id);
    if (item + 1 < items.length) show(item + 1);
    else if (touring) select(cur + 1 < TUTORIAL.length ? cur + 1 : 0, false);
    else show(0);
  };

  /** Show media item `i` of the current step. */
  const show = (i: number) => {
    clearTimeout(timer);
    const items = itemsOf(TUTORIAL[cur].id);
    item = i;
    dots.innerHTML = items.length > 1 ? items.map((_, k) => `<button type="button" aria-label="Picture ${k + 1} of ${items.length}" class="${k === i ? 'on' : ''}" data-k="${k}"></button>`).join('') : '';
    dots.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.k))));
    const it = items[i];
    const prev = [...media.children] as HTMLElement[];
    let el: HTMLElement;
    if (!it) {
      el = document.createElement('div');
      el.className = 'lp-stage-empty';
      el.innerHTML = `<b>${esc(TUTORIAL[cur].title)}</b><span>Captures for this step haven’t been made yet. Run <code>node scripts/capture-tutorial.mjs</code> with the game running.</span>`;
      setBar(0);
    } else if (it.kind === 'clip') {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      if (it.poster) v.poster = it.poster;
      v.src = it.src;
      v.setAttribute('aria-label', `${TUTORIAL[cur].title}: gameplay clip`);
      const go = () => {
        if (!visible || reduced) return;
        v.play().catch(() => {});
      };
      v.addEventListener('loadedmetadata', () => { if (visible && !reduced) setBar((v.duration || 5) * 1000); }, { once: true });
      v.addEventListener('ended', () => {
        if (touring || items.length > 1) { next(); return; }
        v.currentTime = 0; // a single clip just loops
        setBar((v.duration || 5) * 1000);
        go();
      });
      v.addEventListener('canplay', go, { once: true });
      el = v;
      if (reduced) setBar(0);
    } else {
      const img = new Image();
      img.src = it.src;
      img.alt = `${TUTORIAL[cur].title} (${i + 1} of ${items.length})`;
      img.decoding = 'async';
      el = img;
      if (visible && !reduced && items.length > 1 || touring) {
        setBar(STILL_MS);
        timer = window.setTimeout(next, STILL_MS);
      } else setBar(0);
    }
    el.classList.add('lp-stage-item');
    media.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    for (const p of prev) { p.classList.remove('in'); if (p instanceof HTMLVideoElement) p.pause(); setTimeout(() => p.remove(), 450); }
    // Warm up the next step's first picture.
    const nx = itemsOf(TUTORIAL[(cur + 1) % TUTORIAL.length].id)[0];
    if (nx) { const pre = new Image(); pre.src = nx.poster ?? nx.src; }
  };

  const renderCopy = () => {
    const s = TUTORIAL[cur];
    panel.setAttribute('aria-labelledby', `tour-tab-${s.id}`);
    panel.innerHTML = `
      <p class="lp-tour-step">Step ${cur + 1} of ${TUTORIAL.length}</p>
      <h3>${esc(s.title)}</h3>
      <p class="lp-tour-body">${esc(s.body)}</p>
      <div class="lp-tour-keys">
        <div class="lp-tour-row"><span class="lp-tour-lbl">${esc(s.keysLabel ?? 'Keyboard')}</span><div>${s.keys.map(([k, v]) => `<span class="lp-kv"><kbd>${esc(k)}</kbd>${esc(v)}</span>`).join('')}</div></div>
        <div class="lp-tour-row quest"><span class="lp-tour-lbl">${QUEST}Quest</span><div><span class="lp-kq">${esc(s.quest)}</span></div></div>
      </div>`;
    $('tour-count').textContent = `${cur + 1} / ${TUTORIAL.length}`;
  };

  function select(i: number, focus: boolean) {
    cur = (i + TUTORIAL.length) % TUTORIAL.length;
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === cur)); t.tabIndex = k === cur ? 0 : -1; });
    const tab = tabs[cur];
    if (focus) tab.focus({ preventScroll: true });
    // Keep the active step in view inside its own list without scrolling the page.
    const list = tab.parentElement!;
    const lr = list.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    if (tr.top < lr.top || tr.bottom > lr.bottom || tr.left < lr.left || tr.right > lr.right) {
      list.scrollBy({ top: tr.top - lr.top - (lr.height - tr.height) / 2, left: tr.left - lr.left - (lr.width - tr.width) / 2, behavior: reduced ? 'auto' : 'smooth' });
    }
    renderCopy();
    if (loaded) show(0);
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { setTour(false); select(i, false); });
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      const to = k === 'ArrowDown' || k === 'ArrowRight' ? cur + 1 : k === 'ArrowUp' || k === 'ArrowLeft' ? cur - 1 : k === 'Home' ? 0 : k === 'End' ? TUTORIAL.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      setTour(false);
      select(to, true);
    });
  });
  $('tour-prev').addEventListener('click', () => { setTour(false); select(cur - 1, false); });
  $('tour-next').addEventListener('click', () => { setTour(false); select(cur + 1, false); });

  function setTour(on: boolean) {
    if (touring === on) return;
    touring = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.innerHTML = `${on ? ICON_PAUSE : ICON_PLAY}<span>${on ? 'Pause the tour' : 'Play the tour'}</span>`;
    if (loaded) show(item);
  }
  playBtn.addEventListener('click', () => {
    const on = !touring;
    setTour(on);
    if (on) $('lp-tour').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  });

  // Only load and play media while the section is on screen.
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    const v = media.querySelector('video.in') as HTMLVideoElement | null;
    if (!loaded && visible) {
      loaded = true;
      fetch('/tutorial/manifest.json').then((r) => (r.ok ? r.json() : { steps: {} })).catch(() => ({ steps: {} })).then((m: Manifest) => {
        manifest = m?.steps ? m : { steps: {} };
        thumbs();
        show(0);
      });
    } else if (v) {
      if (visible && !reduced) v.play().catch(() => {}); else v.pause();
    }
  }, { root: scroller, threshold: 0.25 }).observe($('tour-stage'));

  renderCopy();
  return {
    /** Scroll to the tutorial and start the tour from the top. */
    play() { select(0, false); setTour(true); $('lp-tour').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); },
  };
}
