// Player preferences from Settings, remembered per browser. Import this first in main.ts: the
// quality choice has to land in the URL (?q=low) before the engine and world modules read it.

export interface Prefs {
  /** The coordinates / weather / address card, top left. Off by default; it lives in Settings. */
  showLocation: boolean;
  /** 'low' = the ?q=low tier (lower resolution, smaller streaming radius). */
  quality: 'high' | 'low';
  /** 0..1, applied by the sound engine. */
  volume: number;
  muted: boolean;
}

const STORE = 'ow.prefs';
const DEFAULTS: Prefs = { showLocation: false, quality: 'high', volume: 0.8, muted: false };
const listeners = new Set<(p: Prefs) => void>();

function load(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export const prefs: Prefs = load();

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* private mode */ }
  listeners.forEach((f) => f(prefs));
}

export function onPrefs(fn: (p: Prefs) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Effective output level for the sound engine (0 when muted). */
export function soundLevel() {
  return prefs.muted ? 0 : prefs.volume;
}

// An explicit ?q= in the URL wins; otherwise the saved choice is written into it before anything reads it.
const url = new URL(location.href);
if (!url.searchParams.has('q') && prefs.quality === 'low') {
  url.searchParams.set('q', 'low');
  history.replaceState(history.state, '', url);
}

/** Switch quality: the renderer and streaming radius are set up at load, so this reloads (the session resumes). */
export function applyQuality(q: Prefs['quality']) {
  setPref('quality', q);
  const u = new URL(location.href);
  if (q === 'low') u.searchParams.set('q', 'low');
  else u.searchParams.delete('q');
  location.replace(u);
}
