import { keymap } from './keymap.ts';

/**
 * Keyboard + pointer-lock mouse input. `enabled=false` while a UI panel has focus.
 * Codes are canonical (see keymap.ts): a player who rebinds "forward" to I still reads as 'KeyW' here.
 *
 * The mouse looks around only from the game view: clicking it locks the pointer (mouse-look), and with
 * a free cursor dragging on it looks around too. Over the phone, map or any panel the mouse is just a
 * cursor (clicks, wheel scrolls the panel, the camera never turns). Holding Alt frees the cursor while
 * it's held; `free()` lets it go for good (P does that for the phone) until you click the game again.
 */
export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  enabled = true;
  locked = false;
  /** Input from another device (VR controllers): held key codes and an analog stick (x right, y forward). */
  virtual = { keys: new Set<string>(), x: 0, y: 0 };
  private pressHandlers = new Map<string, Array<() => void>>();
  /** Alt is holding the cursor free; re-lock on release unless you clicked some UI meanwhile. */
  private altHeld = false;
  private altRelock = false;
  /** Free-cursor drag on the game view: where it started, and whether it moved enough to be a look. */
  private drag: { x: number; y: number; looked: boolean } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat) {
        e.preventDefault(); // no browser menu bar focus on Windows
        if (!this.altHeld) { this.altHeld = true; this.altRelock = this.locked; if (this.locked) document.exitPointerLock(); }
        return;
      }
      if (isTyping(e)) return;
      const code = keymap.translate(e.code);
      if (e.code === 'Tab' || code === 'Tab') e.preventDefault();
      if (!code) return;
      if (!e.repeat) this.pressHandlers.get(code)?.forEach((h) => h());
      if (this.enabled) this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
        if (this.altHeld && this.altRelock && this.enabled && !isTyping(e)) this.canvas.requestPointerLock();
        this.altHeld = false; this.altRelock = false;
        return;
      }
      const code = keymap.translate(e.code);
      if (code) this.keys.delete(code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.altHeld = false; this.altRelock = false; });
    keymap.onChange(() => this.keys.clear());
    // Pressing anything outside the game view while Alt holds the cursor: you're using that UI, stay free.
    window.addEventListener('pointerdown', (e) => { if (this.altHeld && e.target !== canvas) this.altRelock = false; }, true);
    canvas.addEventListener('pointerdown', (e) => {
      if (this.locked || e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, looked: false };
    });
    window.addEventListener('pointerup', () => { setTimeout(() => { this.drag = null; }, 0); });
    canvas.addEventListener('click', () => {
      // A drag that looked around isn't a click: keep the cursor free.
      if (this.drag?.looked) return;
      if (this.enabled && !this.locked && !this.altHeld) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('mouse-look', this.locked);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else if (this.drag && e.buttons & 1) {
        if (!this.drag.looked && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) < 5) return;
        this.drag.looked = true;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    // The wheel zooms the camera only over the game view; over the phone or a panel it scrolls that.
    document.addEventListener('wheel', (e) => {
      if (!this.locked && e.target !== canvas) e.stopPropagation();
    }, { passive: true });
  }

  /** Register a handler for an action, named by its canonical code (e.g. 'KeyE' = interact). */
  onPress(code: string, handler: () => void) {
    const list = this.pressHandlers.get(code) ?? [];
    list.push(handler);
    this.pressHandlers.set(code, list);
  }

  down(code: string) {
    return this.enabled && (this.keys.has(code) || this.virtual.keys.has(code));
  }

  /** Fire a key's press handlers as if it were tapped (VR controller buttons). */
  press(code: string) {
    this.pressHandlers.get(code)?.forEach((h) => h());
  }

  /** Movement axes: x = strafe right, y = forward. */
  axes() {
    let x = 0, y = 0;
    if (this.down('KeyW')) y += 1;
    if (this.down('KeyS')) y -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyA')) x -= 1;
    if (this.enabled) { x = Math.max(-1, Math.min(1, x + this.virtual.x)); y = Math.max(-1, Math.min(1, y + this.virtual.y)); }
    return { x, y };
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Disable game input (a panel is open) and release the mouse. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.virtual.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  /** Let the mouse go (a free cursor for the phone or a panel) until the game view is clicked again. */
  free() {
    this.altRelock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
