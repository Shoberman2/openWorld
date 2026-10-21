/** VR preferences, kept in this browser (Quest and desktop each have their own). */
export interface XrSettings {
  /** Offer "Enter VR" at all. */
  enabled: boolean;
  /** First person (your eyes are the robot's), or a comfort view from behind and above it. */
  view: 'first' | 'third';
  /** Snap turn (30° clicks, the comfortable default) or smooth turn. */
  turn: 'snap' | 'smooth';
  /** Darken the edges of your view while moving or turning. */
  vignette: boolean;
}

const KEY = 'openworld.vr';
const DEFAULTS: XrSettings = { enabled: true, view: 'first', turn: 'snap', vignette: true };

let current: XrSettings = { ...DEFAULTS };
try { current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private mode */ }
// ?vr=0 / ?vr=1 overrides (and remembers) the switch.
const q = new URLSearchParams(location.search).get('vr');
if (q === '0' || q === '1') current.enabled = q === '1';

const listeners: Array<(s: XrSettings) => void> = [];

export const xrSettings = {
  get: () => current,
  set(patch: Partial<XrSettings>) {
    current = { ...current, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
    listeners.forEach((f) => f(current));
  },
  onChange(f: (s: XrSettings) => void) { listeners.push(f); },
};
