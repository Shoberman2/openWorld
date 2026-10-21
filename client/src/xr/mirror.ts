import { CanvasPanel } from './canvasPanel.ts';

const W = 1024, H = 768;
const QUICK_ASKS = ['Walk me through this change', "What's the risk here?", 'What should happen next?'];

/**
 * DOM panels (desk conversations, the Agent Lab, the boardroom...) don't render in a headset. While one
 * is open in VR this floats a copy in front of you: its text, its buttons, and canned questions for
 * chat panels, all clickable with the controller ray.
 */
export class PanelMirror {
  readonly panel = new CanvasPanel(W, H, 1.3);
  private sig = '';
  private hoverDrawn: string | null = null;
  private wait = 0;

  get mesh() { return this.panel.mesh; }

  /** The DOM panel currently open, if any. */
  static source(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#panel-root .panel');
  }

  update(dt: number, close: () => void) {
    const el = PanelMirror.source();
    if (!el) return;
    this.wait -= dt;
    if (this.wait > 0 && this.panel.hover === this.hoverDrawn) return;
    this.wait = 0.25;
    const title = el.querySelector('h3')?.textContent ?? '';
    const body = (el.querySelector<HTMLElement>('.panel-body')?.innerText ?? '').trim();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.panel-body button, .panel-footer button')]
      .filter((b) => !b.disabled && b.offsetParent !== null && (b.textContent ?? '').trim() && !b.classList.contains('close'));
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('.panel-footer input, .panel-footer textarea, .panel-body textarea');
    const send = input ? buttons.find((b) => b.parentElement === input.parentElement) : undefined;
    const sig = `${title}|${body.length}|${body.slice(-80)}|${buttons.map((b) => b.textContent).join(',')}|${this.panel.hover}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.hoverDrawn = this.panel.hover;

    this.panel.draw((p) => {
      p.rect(0, 0, W, H, 36, 'rgba(14,16,22,0.95)');
      p.text(title, 36, 48, 36, '#fff', 700, 'left', W - 220);
      p.button('close', W - 170, 18, 140, 60, 'Close (B)', close, { size: 24, fill: 'rgba(255,77,94,0.45)' });
      // The newest text, which is where conversations grow.
      const lines = p.wrap(body, W - 72, 24);
      const fit = 15;
      lines.slice(-fit).forEach((l, i) => p.text(l, 36, 112 + i * 31, 24, '#e6e8ee', 400));
      // Buttons from the panel itself, then canned questions for chat panels.
      const acts: { label: string; run: () => void }[] = buttons.filter((b) => b !== send).slice(0, 4).map((b) => ({ label: (b.textContent ?? '').trim(), run: () => b.click() }));
      if (input && send) for (const q of QUICK_ASKS) acts.push({ label: q, run: () => { input.value = q; input.dispatchEvent(new Event('input')); send.click(); } });
      acts.slice(0, 6).forEach((a, i) => {
        const x = 30 + (i % 3) * 325, y = H - 150 + Math.floor(i / 3) * 70;
        p.button(`a:${i}`, x, y, 310, 60, a.label, a.run, { size: 22, fill: 'rgba(79,140,255,0.25)' });
      });
    });
  }

  reset() { this.sig = ''; }
}
