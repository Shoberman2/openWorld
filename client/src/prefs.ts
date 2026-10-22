// Player preferences from Settings, remembered per browser. Import this first in main.ts: the
// quality choice has to land in the URL (?q=low) before the engine and world modules read it.

export interface Prefs {
  /** The coordinates / weather / address card, top left. Off by default; it lives in Settings. */
  showLocation: boolean;
  /**
   * Graphics tier. 'auto' lets the game pick (Ultra on a capable desktop GPU, otherwise High);
   * the others are written into the URL as ?q= (low: lower resolution, smaller streaming radius).
   */
  quality: 'auto' | 'ultra' | 'high' | 'low';
  /** 0..1, applied by the sound engine. */
  volume: number;
  muted: boolean;
}

const STORE = 'ow.prefs';
const DEFAULTS: Prefs = { showLocation: false, quality: 'auto', volume: 0.8, muted: false };
const listeners = new Set<(p: Prefs) => void>();

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    // Before Ultra existed every saved prefs said 'high' (the old default): that means "let the game pick".
    if (raw.quality === 'high' && !raw.tiers) raw.quality = 'auto';
    return { ...DEFAULTS, ...raw };
  } catch { return { ...DEFAULTS }; }
}

export const prefs: Prefs = load();

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  try { localStorage.setItem(STORE, JSON.stringify({ ...prefs, tiers: 2 })); } catch { /* private mode */ }
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
if (!url.searchParams.has('q') && prefs.quality !== 'auto') {
  url.searchParams.set('q', prefs.quality);
  history.replaceState(history.state, '', url);
}

/** Switch quality: the renderer and streaming radius are set up at load, so this reloads (the session resumes). */
export function applyQuality(q: Prefs['quality']) {
  setPref('quality', q);
  const u = new URL(location.href);
  if (q === 'auto') u.searchParams.delete('q');
  else u.searchParams.set('q', q);
  location.replace(u);
}
