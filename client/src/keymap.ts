// Rebindable controls. Game code names each action by its default key code ('KeyW' is "forward",
// 'Space' is "jump / rockets"), so the rest of the game never changes: Input translates whatever
// physical key the player bound into that canonical code. Bindings live in localStorage.

export type ActionGroup = 'Moving' | 'Flying' | 'World' | 'Vehicles';

export interface Action {
  id: string;
  label: string;
  hint?: string;
  group: ActionGroup;
  /** Canonical code the game listens for (the first default key). */
  code: string;
  /** Default physical keys: primary, then optional alternate. */
  defaults: [string, string?];
}

export const ACTIONS: Action[] = [
  { id: 'forward', label: 'Move forward', hint: 'Gas, pedal, throttle up, dive the wingsuit', group: 'Moving', code: 'KeyW', defaults: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move back', hint: 'Brake, reverse, throttle down', group: 'Moving', code: 'KeyS', defaults: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Move left', hint: 'Steer, bank, carve', group: 'Moving', code: 'KeyA', defaults: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Move right', hint: 'Steer, bank, carve', group: 'Moving', code: 'KeyD', defaults: ['KeyD', 'ArrowRight'] },
  { id: 'run', label: 'Run', hint: 'Afterburner, boost, sprint', group: 'Moving', code: 'ShiftLeft', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'jump', label: 'Jump', hint: 'Hold in the air to fire the thrusters · ollie, handbrake, pull up', group: 'Moving', code: 'Space', defaults: ['Space'] },
  { id: 'interact', label: 'Interact', hint: 'Enter buildings, talk, use', group: 'Moving', code: 'KeyE', defaults: ['KeyE'] },
  { id: 'wave', label: 'Wave', group: 'Moving', code: 'KeyG', defaults: ['KeyG'] },
  { id: 'sit', label: 'Sit down', group: 'Moving', code: 'KeyX', defaults: ['KeyX'] },
  { id: 'dive', label: 'Cut the thrusters', hint: 'Dive · push the nose down', group: 'Flying', code: 'KeyC', defaults: ['KeyC', 'ControlLeft'] },
  { id: 'wingsuit', label: 'Wingsuit', hint: 'Open or stow it in the air', group: 'Flying', code: 'KeyQ', defaults: ['KeyQ'] },
  { id: 'autopilot', label: 'Autopilot', hint: 'Fly to the waypoint', group: 'Flying', code: 'KeyO', defaults: ['KeyO'] },
  { id: 'phone', label: 'Phone', hint: 'Agents, projects, maps, home', group: 'World', code: 'KeyP', defaults: ['KeyP'] },
  { id: 'map', label: 'Map', group: 'World', code: 'KeyM', defaults: ['KeyM'] },
  { id: 'directory', label: 'Directory', hint: 'Your projects · fast travel', group: 'World', code: 'Tab', defaults: ['Tab'] },
  { id: 'photo', label: 'Photo mode', group: 'World', code: 'KeyF', defaults: ['KeyF'] },
  { id: 'timelapse', label: 'Time-lapse', group: 'World', code: 'KeyL', defaults: ['KeyL'] },
  { id: 'clock', label: 'Skip 3 hours ahead', group: 'World', code: 'KeyT', defaults: ['KeyT'] },
  { id: 'settings', label: 'Settings', group: 'World', code: 'KeyK', defaults: ['KeyK'] },
  { id: 'v-foot', label: 'On foot', hint: 'Get off · bail out', group: 'Vehicles', code: 'Digit1', defaults: ['Digit1'] },
  { id: 'v-skate', label: 'Skateboard', group: 'Vehicles', code: 'Digit2', defaults: ['Digit2'] },
  { id: 'v-bike', label: 'Bike', group: 'Vehicles', code: 'Digit3', defaults: ['Digit3'] },
  { id: 'v-jeep', label: 'Jeep', group: 'Vehicles', code: 'Digit4', defaults: ['Digit4'] },
  { id: 'v-plane', label: 'Plane', group: 'Vehicles', code: 'Digit5', defaults: ['Digit5'] },
  { id: 'v-kayak', label: 'Kayak', group: 'Vehicles', code: 'Digit6', defaults: ['Digit6'] },
  { id: 'v-boat', label: 'Boat', group: 'Vehicles', code: 'Digit7', defaults: ['Digit7'] },
  { id: 'v-shuttle', label: 'Space shuttle', group: 'Vehicles', code: 'Digit8', defaults: ['Digit8'] },
];

const byId = new Map(ACTIONS.map((a) => [a.id, a]));
const CANONICAL = new Set(ACTIONS.map((a) => a.code));
const STORE = 'ow.keys';

/** Keys that can't be bound: they close things, or the browser owns them. */
export const RESERVED = new Set(['Escape', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);

type Bindings = Record<string, [string | null, string | null]>;
let bindings: Bindings = load();
let reverse = buildReverse();
const listeners = new Set<() => void>();

function defaults(): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, [a.defaults[0], a.defaults[1] ?? null]]));
}

function load(): Bindings {
  const b = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') as Bindings;
    for (const [id, slots] of Object.entries(saved)) if (byId.has(id) && Array.isArray(slots)) b[id] = [slots[0] ?? null, slots[1] ?? null];
  } catch { /* private mode or bad JSON: defaults */ }
  return b;
}

function save() {
  // Only store actions that differ from the defaults, so new defaults reach existing players.
  const d = defaults();
  const diff = Object.fromEntries(Object.entries(bindings).filter(([id, s]) => s[0] !== d[id][0] || s[1] !== d[id][1]));
  try { localStorage.setItem(STORE, JSON.stringify(diff)); } catch { /* private mode */ }
}

function buildReverse() {
  const m = new Map<string, string>();
  for (const a of ACTIONS) for (const k of bindings[a.id]) if (k) m.set(k, a.code);
  return m;
}

function changed() {
  reverse = buildReverse();
  save();
  listeners.forEach((f) => f());
}

export const keymap = {
  /**
   * Physical key → the canonical code the game listens for. Keys bound to an action map to that
   * action; a default key the player moved elsewhere maps to nothing (null); anything else passes through.
   */
  translate(code: string): string | null {
    const c = reverse.get(code);
    if (c) return c;
    return CANONICAL.has(code) ? null : code;
  },
  /** Is this physical key bound to the action? */
  is(code: string, actionId: string) {
    return bindings[actionId]?.includes(code) ?? false;
  },
  /** Both binding slots, in order (primary, alternate); null = empty. */
  slots(actionId: string): [string | null, string | null] {
    return bindings[actionId] ?? [null, null];
  },
  keys(actionId: string): string[] {
    return (bindings[actionId] ?? []).filter((k): k is string => !!k);
  },
  /** Display label for an action's primary key ("W", "Space", "Shift"), or "—" when unbound. */
  label(actionId: string) {
    const k = keymap.keys(actionId)[0];
    return k ? keyName(k) : '—';
  },
  action(id: string) { return byId.get(id); },
  /** The action a physical key is bound to, if any. */
  actionFor(code: string): Action | undefined {
    for (const a of ACTIONS) if (bindings[a.id].includes(code)) return a;
    return undefined;
  },
  /**
   * Bind `code` to slot 0/1 of an action. If another action had that key, it takes this action's old
   * key in its place (a swap), so nothing silently ends up unbound. Returns the action it came from.
   */
  bind(actionId: string, slot: 0 | 1, code: string | null): Action | undefined {
    const slots = bindings[actionId];
    if (!slots) return undefined;
    const old = slots[slot];
    let from: Action | undefined;
    if (code) {
      for (const a of ACTIONS) {
        const s = bindings[a.id];
        const i = s.indexOf(code);
        if (i < 0 || (a.id === actionId && i === slot)) continue;
        from = a.id === actionId ? undefined : a;
        s[i] = a.id === actionId ? null : old;
      }
    }
    slots[slot] = code;
    changed();
    return from;
  },
  reset(actionId?: string) {
    const d = defaults();
    if (actionId) {
      // Free the default keys from wherever they went, then restore.
      for (const k of d[actionId]) if (k) for (const a of ACTIONS) if (a.id !== actionId) bindings[a.id] = bindings[a.id].map((x) => (x === k ? null : x)) as [string | null, string | null];
      bindings[actionId] = d[actionId];
    } else bindings = d;
    changed();
  },
  isDefault(actionId: string) {
    const d = defaults()[actionId];
    const s = bindings[actionId];
    return s[0] === d[0] && s[1] === d[1];
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Alt', AltRight: 'Right Alt', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=',
  Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** "KeyW" → "W", "Digit1" → "1", "Numpad4" → "Num 4". */
export function keyName(code: string) {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Expand `{action}` placeholders in copy to the player's keys; `{move}` is the four movement keys. */
export function keyText(s: string) {
  return s.replace(/\{([a-z-]+)\}/g, (m, id: string) =>
    id === 'move' ? ['forward', 'left', 'back', 'right'].map((a) => keymap.label(a)).join(' ') : byId.has(id) ? keymap.label(id) : m);
}

/** Keycap HTML for an action's current key(s), e.g. `<kbd>E</kbd>`. Movement collapses to WASD-style caps. */
export function kbd(...actionIds: string[]) {
  return actionIds.map((id) => `<kbd>${escapeHtml(keymap.label(id))}</kbd>`).join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
