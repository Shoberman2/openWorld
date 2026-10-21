// Where you left off: position, heading, which building (and floor) you were in, the time of day and
// the phone app you had open. Saved to localStorage every few seconds and when the tab closes; the
// landing page offers "Continue where you left off". Agent threads already persist on the server.
import type { CityId, GeoPlace } from '../../shared/types.ts';

const KEY = 'openworld.session';
/** Older than this, a saved session isn't offered any more. */
const MAX_AGE = 21 * 86400_000;

export interface SavedSession {
  v: 1;
  /** What the world was started with: your HQs are placed around it, so resume starts the same way. */
  start: CityId | GeoPlace;
  /** Earth worlds: where you were (inside a building, its door). */
  lat?: number;
  lon?: number;
  /** Classic cities: local coordinates. */
  x?: number;
  z?: number;
  /** Height above the ground; > a few meters means you were flying. */
  agl: number;
  facing: number;
  inside: { kind: 'hq'; repo: string; floor: number } | { kind: 'home' } | null;
  hour: number;
  phoneApp: string | null;
  /** For the landing page: "Inside my-app HQ, floor 2" / "Times Square, New York". */
  label: string;
  savedAt: number;
}

export function loadSession(): SavedSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedSession | null;
    if (!s || s.v !== 1 || !s.start || Date.now() - s.savedAt > MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Omit<SavedSession, 'v' | 'savedAt'>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, v: 1, savedAt: Date.now() })); } catch { /* private mode: no resume */ }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// The landing page arms a resume right before it starts the game; the game takes it once loaded.
let armed: SavedSession | null = null;
export function armResume(s: SavedSession) { armed = s; }
export function takeResume() { const s = armed; armed = null; return s; }

export function sessionAgo(s: SavedSession) {
  const m = (Date.now() - s.savedAt) / 60_000;
  if (m < 2) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
