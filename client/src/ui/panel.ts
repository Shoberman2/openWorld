import { esc } from '../interact.ts';

export interface Panel {
  el: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  close(): void;
  onClose(fn: () => void): void;
}

let active: Panel | null = null;
let setInputEnabled: (on: boolean) => void = () => {};

/** Called once by main.ts so panels can pause game input while open. */
export function bindPanelInput(fn: (on: boolean) => void) { setInputEnabled = fn; }
export function panelOpen() { return !!active || overlayOpen; }

let overlayOpen = false;
/** A full-screen-ish overlay (the phone) that, like a panel, pauses game input while open. */
export function setOverlayOpen(on: boolean) {
  overlayOpen = on;
  if (on) active?.close();
  setInputEnabled(!on);
}
export function closePanel() { active?.close(); }

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && active) { e.preventDefault(); active.close(); }
});

export function openPanel(opts: { title: string; subtitle?: string; avatar?: string; color?: string; avatarImg?: string; wide?: boolean }): Panel {
  active?.close();
  const root = document.getElementById('panel-root')!;
  const el = document.createElement('div');
  el.className = `panel${opts.wide ? ' wide' : ''}`;
  const avatar = opts.avatarImg
    ? `<div class="avatar" style="background:#fff center/cover no-repeat url('${opts.avatarImg}')"></div>`
    : `<div class="avatar" style="background:${opts.color ?? 'var(--accent)'}">${esc(opts.avatar ?? opts.title.slice(0, 1))}</div>`;
  el.innerHTML = `
    <div class="panel-header">${avatar}
      <div><h3>${esc(opts.title)}</h3>${opts.subtitle ? `<p>${opts.subtitle}</p>` : ''}</div>
      <button class="close" title="Close (Esc)">✕</button>
    </div>
    <div class="panel-body"></div>
    <div class="panel-footer"></div>`;
  root.appendChild(el);
  const closers: Array<() => void> = [];
  const panel: Panel = {
    el,
    body: el.querySelector('.panel-body')!,
    footer: el.querySelector('.panel-footer')!,
    close() {
      if (active !== panel) return;
      active = null;
      el.remove();
      closers.forEach((f) => f());
      setInputEnabled(true);
    },
    onClose(fn) { closers.push(fn); },
  };
  el.querySelector('.close')!.addEventListener('click', () => panel.close());
  active = panel;
  setInputEnabled(false);
  return panel;
}

/** A streaming chat transcript with an input box in the panel footer. */
export function chatUI(panel: Panel, npcName: string, onSend: (text: string) => void) {
  panel.footer.innerHTML = `<input type="text" placeholder="Ask ${esc(npcName)} something…" /><button class="btn primary">Send</button>`;
  const input = panel.footer.querySelector('input')!;
  const btn = panel.footer.querySelector('button')!;
  const send = () => {
    const t = input.value.trim();
    if (!t || btn.disabled) return;
    input.value = '';
    onSend(t);
  };
  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  setTimeout(() => input.focus(), 50);

  return {
    addUser(text: string) {
      const m = document.createElement('div');
      m.className = 'msg user';
      m.innerHTML = `<span class="who">You</span>${esc(text)}`;
      panel.body.appendChild(m);
      panel.body.scrollTop = panel.body.scrollHeight;
    },
    /** Start a streaming NPC message; returns append/finish handles. */
    startNpc(who = npcName) {
      const m = document.createElement('div');
      m.className = 'msg npc typing';
      m.innerHTML = `<span class="who">${esc(who)}</span><span class="t"></span>`;
      panel.body.appendChild(m);
      const t = m.querySelector('.t')!;
      btn.disabled = true;
      return {
        append(delta: string) { t.textContent += delta; panel.body.scrollTop = panel.body.scrollHeight; },
        finish() { m.classList.remove('typing'); btn.disabled = false; input.focus(); },
        text: () => t.textContent ?? '',
      };
    },
  };
}

export function toast(html: string, ms = 5000) {
  const root = document.getElementById('toasts')!;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
