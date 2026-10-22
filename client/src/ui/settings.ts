// Settings: every control (click a key, press a new one), display and sound, and the live location
// readout that used to sit top left. Opens from the gear button, the Settings key, or the landing page.
import { ACTIONS, RESERVED, keyName, keymap, type ActionGroup } from '../keymap.ts';
import { prefs, setPref, onPrefs, applyQuality } from '../prefs.ts';
import { lookLabels, type HudLocation } from './hud.ts';
import { openPanel, panelOpen, type Panel } from './panel.ts';
import { esc } from '../interact.ts';
import { agentsTab } from './agentKeys.ts';
import './settings.css';

type Tab = 'controls' | 'agents' | 'display' | 'location';

/** Live data the in-game Settings can show; the landing page has none. */
interface SettingsSource { location: () => HudLocation | null }
let source: SettingsSource | null = null;
let current: Panel | null = null;

const GROUPS: ActionGroup[] = ['Moving', 'Flying', 'World', 'Vehicles'];

// The location card is a Settings choice; the old city HUD's chips follow it too.
const applyLocationPref = () => document.body.classList.toggle('show-location', prefs.showLocation);
applyLocationPref();
onPrefs(applyLocationPref);

/** In-game: a gear button on the HUD and live location data. */
export function installSettings(src: SettingsSource) {
  source = src;
  const hud = document.getElementById('hud');
  if (hud && !hud.querySelector('.ow-gear')) {
    const b = document.createElement('button');
    b.className = 'ow-gear';
    b.title = 'Settings';
    b.setAttribute('aria-label', 'Settings');
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
    b.addEventListener('click', () => toggleSettings());
    hud.appendChild(b);
  }
}

export function toggleSettings(tab?: Tab) {
  if (current) current.close();
  else if (!panelOpen()) openSettings(tab);
}

export function openSettings(tab: Tab = 'controls') {
  const panel = openPanel({ title: 'Settings', subtitle: 'Controls, agents, display and sound', avatar: '⚙', color: '#d7dde8', wide: true });
  current = panel;
  panel.el.classList.add('settings-panel');
  document.body.classList.add('settings-open');
  const tabs: [Tab, string][] = [['controls', 'Controls'], ['agents', 'Agents & keys'], ['display', 'Display & sound'], ['location', 'Location']];
  panel.body.innerHTML = `
    <div class="st-tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
    <div class="st-page"></div>`;
  const page = panel.body.querySelector<HTMLElement>('.st-page')!;
  let cleanup: (() => void) | null = null;

  const show = (t: Tab) => {
    cleanup?.();
    cleanup = null;
    panel.body.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (t === 'controls') cleanup = controls(page);
    else if (t === 'agents') cleanup = agentsTab(page);
    else if (t === 'display') cleanup = display(page);
    else cleanup = location(page);
    panel.body.scrollTop = 0;
  };
  panel.body.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
  panel.onClose(() => { cleanup?.(); current = null; document.body.classList.remove('settings-open'); });
  show(source || tab !== 'location' ? tab : 'controls');
  return panel;
}

/** In the game, which tier Auto picked for this computer (the engine stamps it on the page). */
function autoNote() {
  const t = document.documentElement.dataset.quality;
  if (prefs.quality !== 'auto' || !t) return '';
  return `Auto is using <b>${t === 'ultra' ? 'Ultra' : t === 'low' ? 'Performance' : 'High'}</b> on this computer. `;
}

// ---------- Controls ----------

function controls(page: HTMLElement) {
  let capture: { id: string; slot: 0 | 1 } | null = null;
  let note = '';

  const render = () => {
    page.innerHTML = `
      <div class="st-intro">
        <p>Click a key to change it, then press the new one. <b>Esc</b> cancels, <b>Backspace</b> clears. If the key was already in use, the two actions swap.</p>
        <button class="st-btn" data-reset-all>Reset all to defaults</button>
      </div>
      ${note ? `<div class="st-note">${note}</div>` : ''}
      ${GROUPS.map((g) => `
        <section class="st-group">
          <h4>${g}</h4>
          ${ACTIONS.filter((a) => a.group === g).map((a) => {
            const keys = keymap.keys(a.id);
            const slot = (i: 0 | 1) => {
              const k = keymap.slots(a.id)[i];
              const on = capture?.id === a.id && capture.slot === i;
              return `<button class="st-key${on ? ' capturing' : ''}${k ? '' : ' empty'}" data-bind="${a.id}" data-slot="${i}" title="${on ? 'Press a key' : 'Click to change'}">${on ? 'Press a key…' : k ? esc(keyName(k)) : i === 0 ? 'Unbound' : '+'}</button>`;
            };
            return `
            <div class="st-row${keys.length ? '' : ' unbound'}">
              <div class="st-act"><b>${esc(a.label)}</b>${a.hint ? `<span>${esc(a.hint)}</span>` : ''}</div>
              <div class="st-keys">${slot(0)}${slot(1)}<button class="st-undo" data-reset="${a.id}" title="Back to ${esc(a.defaults.filter(Boolean).map((k) => keyName(k!)).join(' / '))}" ${keymap.isDefault(a.id) ? 'hidden' : ''}>↺</button></div>
            </div>`;
          }).join('')}
        </section>`).join('')}
      <section class="st-group">
        <h4>Always</h4>
        <div class="st-row fixed"><div class="st-act"><b>Look around</b><span>Click the game, then move the mouse · wheel zooms the camera</span></div><div class="st-keys"><span class="st-key fixed">Mouse</span></div></div>
        <div class="st-row fixed"><div class="st-act"><b>Close · release the mouse</b></div><div class="st-keys"><span class="st-key fixed">Esc</span></div></div>
        <div class="st-row fixed"><div class="st-act"><b>Photo mode menu</b><span>Choose and change settings in photo mode</span></div><div class="st-keys"><span class="st-key fixed">↑ ↓ ← →</span></div></div>
      </section>`;
  };

  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bind],[data-reset],[data-reset-all]');
    if (!t) return;
    if (t.dataset.bind) {
      const next = { id: t.dataset.bind, slot: Number(t.dataset.slot) as 0 | 1 };
      capture = capture && capture.id === next.id && capture.slot === next.slot ? null : next;
      note = '';
    } else if (t.dataset.reset) {
      keymap.reset(t.dataset.reset);
      note = `<b>${esc(keymap.action(t.dataset.reset)!.label)}</b> is back to ${esc(keymap.label(t.dataset.reset))}.`;
      capture = null;
    } else {
      keymap.reset();
      note = 'Every key is back to its default.';
      capture = null;
    }
    render();
  };

  // Capture phase on window, ahead of the game, the phone and Esc-closes-the-panel.
  const onKey = (e: KeyboardEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const a = keymap.action(capture.id)!;
    if (e.code === 'Escape') { capture = null; render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      keymap.bind(a.id, capture.slot, null);
      note = `Cleared a key from <b>${esc(a.label)}</b>.`;
      capture = null;
      render();
      return;
    }
    if (RESERVED.has(e.code) || !e.code) { note = `<b>${esc(keyName(e.code || e.key))}</b> can't be used: the browser keeps it.`; render(); return; }
    const from = keymap.bind(a.id, capture.slot, e.code);
    note = from
      ? `<b>${esc(keyName(e.code))}</b> moved from <b>${esc(from.label)}</b> to <b>${esc(a.label)}</b>; ${esc(from.label)} is now ${esc(keymap.label(from.id))}.`
      : `<b>${esc(a.label)}</b> is now <b>${esc(keyName(e.code))}</b>.`;
    capture = null;
    render();
  };

  page.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey, true);
  render();
  return () => { page.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey, true); };
}

// ---------- Display & sound ----------

function display(page: HTMLElement) {
  const render = () => {
    page.innerHTML = `
      <section class="st-group">
        <h4>On screen</h4>
        ${toggle('loc', 'Location panel', 'Coordinates, altitude, heading, weather and address in the top-left corner. Always in Settings › Location.', prefs.showLocation)}
        ${toggle('look', 'Building names', 'Name and address of the building in the middle of the view.', lookLabels.on)}
      </section>
      <section class="st-group">
        <h4>Graphics</h4>
        <div class="st-row">
          <div class="st-act"><b>Quality</b><span>Ultra renders up to 4K with sharper shadows, finer ambient occlusion, extra antialiasing and more of the city in detail, and lowers the resolution by itself if frames run long. Performance renders less and streams a smaller area: for older laptops and VR. ${autoNote()}Changing it reloads; you'll be right back.</span></div>
          <div class="st-seg" role="radiogroup">
            <button data-q="auto" aria-checked="${prefs.quality === 'auto'}">Auto</button>
            <button data-q="ultra" aria-checked="${prefs.quality === 'ultra'}">Ultra</button>
            <button data-q="high" aria-checked="${prefs.quality === 'high'}">High</button>
            <button data-q="low" aria-checked="${prefs.quality === 'low'}">Performance</button>
          </div>
        </div>
      </section>
      <section class="st-group">
        <h4>Sound</h4>
        <div class="st-row">
          <div class="st-act"><b>Volume</b><span>Wind, thrusters, the city and the phone.</span></div>
          <div class="st-vol"><input type="range" min="0" max="100" step="1" value="${Math.round(prefs.volume * 100)}" aria-label="Volume"><output>${Math.round(prefs.volume * 100)}%</output></div>
        </div>
        ${toggle('mute', 'Mute', 'Silence everything.', prefs.muted)}
      </section>`;
  };
  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle],[data-q]');
    if (!t) return;
    if (t.dataset.q) { if (t.dataset.q !== prefs.quality) applyQuality(t.dataset.q as typeof prefs.quality); return; }
    const id = t.dataset.toggle;
    if (id === 'loc') setPref('showLocation', !prefs.showLocation);
    else if (id === 'look') lookLabels.on = !lookLabels.on;
    else if (id === 'mute') setPref('muted', !prefs.muted);
    render();
  };
  const onInput = (e: Event) => {
    const r = e.target as HTMLInputElement;
    if (r.type !== 'range') return;
    setPref('volume', Number(r.value) / 100);
    r.nextElementSibling!.textContent = `${r.value}%`;
  };
  page.addEventListener('click', onClick);
  page.addEventListener('input', onInput);
  render();
  return () => { page.removeEventListener('click', onClick); page.removeEventListener('input', onInput); };
}

function toggle(id: string, label: string, sub: string, on: boolean) {
  return `
    <div class="st-row">
      <div class="st-act"><b>${esc(label)}</b><span>${esc(sub)}</span></div>
      <button class="st-switch" role="switch" aria-checked="${on}" data-toggle="${id}" aria-label="${esc(label)}"><i></i></button>
    </div>`;
}

// ---------- Location ----------

function location(page: HTMLElement) {
  const loc = () => source?.location() ?? null;
  const render = () => {
    const l = loc();
    page.innerHTML = l && l.coord ? `
      <div class="st-loc">
        <div class="st-loc-place">${esc(l.place)}</div>
        <div class="st-loc-time">${esc(l.time)}</div>
        <dl>
          <dt>Coordinates</dt><dd data-f="coord">${esc(l.coord)}</dd>
          <dt>Altitude</dt><dd data-f="alt">${esc(l.alt)}</dd>
          <dt>Heading</dt><dd data-f="hdg">${esc(l.hdg)}</dd>
          <dt>Weather</dt><dd data-f="weather">${esc(l.weather)}</dd>
        </dl>
      </div>
      ${toggle('loc', 'Show this on screen', 'Keep the location panel in the top-left corner while you play.', prefs.showLocation)}`
      : `<div class="st-empty">Your location shows here once you're in the world.</div>`;
  };
  // Refresh the numbers in place twice a second (the panel's text, not the whole page).
  const timer = window.setInterval(() => {
    const l = loc();
    if (!l) return;
    for (const f of ['coord', 'alt', 'hdg', 'weather'] as const) { const el = page.querySelector(`[data-f="${f}"]`); if (el) el.textContent = l[f]; }
    const p = page.querySelector('.st-loc-place'), t = page.querySelector('.st-loc-time');
    if (p) p.textContent = l.place;
    if (t) t.textContent = l.time;
  }, 500);
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-toggle="loc"]')) { setPref('showLocation', !prefs.showLocation); render(); }
  };
  page.addEventListener('click', onClick);
  render();
  return () => { clearInterval(timer); page.removeEventListener('click', onClick); };
}
