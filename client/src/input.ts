import { keymap } from './keymap.ts';

/**
 * Keyboard + pointer-lock mouse input. `enabled=false` while a UI panel has focus.
 * Codes are canonical (see keymap.ts): a player who rebinds "forward" to I still reads as 'KeyW' here.
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

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const code = keymap.translate(e.code);
      if (e.code === 'Tab' || code === 'Tab') e.preventDefault();
      if (!code) return;
      if (!e.repeat) this.pressHandlers.get(code)?.forEach((h) => h());
      if (this.enabled) this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => {
      const code = keymap.translate(e.code);
      if (code) this.keys.delete(code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    keymap.onChange(() => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
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
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
