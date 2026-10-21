import * as THREE from 'three';
import { CanvasPanel } from './canvasPanel.ts';
import type { XrPhoneSource, XrThread } from './phoneSource.ts';
import { xrSettings } from './settings.ts';

/** What the wrist phone can do in the game besides messaging. */
export interface WristHooks {
  source: XrPhoneSource;
  status(): { place: string; time: string };
  vehicles: { id: string; label: string; icon: string }[];
  vehicle(): string;
  ride(id: string): void;
  skipTime(): void;
  exitVr(): void;
}

type Page = { tab: 'chats'; thread?: string; scroll: number } | { tab: 'agents'; scroll: number } | { tab: 'ride' } | { tab: 'vr' };

const W = 480, H = 800, ROW = 92, LIST_TOP = 64, LIST_BOTTOM = 700;
const STATUS_COLOR: Record<string, string> = { running: '#4cd97b', preparing: '#ffcc33', done: '#8fa3ff', error: '#ff6b6b', stopped: '#9aa0a6' };

/**
 * The phone on your left wrist in VR: texts with HQ and every project's master agent (canned replies,
 * since there's no keyboard), the agent roster, vehicles and VR settings. Point the right controller
 * at it and pull the trigger.
 */
export class WristPhone {
  readonly panel = new CanvasPanel(W, H, 0.12);
  /** Holds the panel; parent it to the left controller's grip space. */
  readonly group = new THREE.Group();
  private page: Page = { tab: 'chats', scroll: 0 };
  private drawn = -1;
  private hoverDrawn: string | null = null;
  private clock = 0;

  constructor(private h: WristHooks) {
    // Above the back of the wrist, tilted toward your eyes.
    this.panel.mesh.position.set(0, 0.07, 0.03);
    this.panel.mesh.rotation.set(-0.9, 0, 0);
    this.group.add(this.panel.mesh);
    this.group.visible = false;
  }

  get visible() { return this.group.visible; }
  set visible(on: boolean) { this.group.visible = on; this.drawn = -1; }

  update(dt: number) {
    if (!this.group.visible) return;
    this.clock += dt;
    // Redraw on data or hover changes, and once a second for the clock.
    const v = this.h.source.version() * 1000 + Math.floor(this.clock);
    if (v === this.drawn && this.panel.hover === this.hoverDrawn) return;
    this.drawn = v;
    this.hoverDrawn = this.panel.hover;
    this.panel.draw((p) => this.render(p));
  }

  unread() { return this.h.source.threads().reduce((n, t) => n + t.unread, 0); }

  private go(page: Page) { this.page = page; this.drawn = -1; }

  private render(p: CanvasPanel) {
    p.rect(0, 0, W, H, 44, 'rgba(14,16,22,0.94)');
    const st = this.h.status();
    p.text(st.time, 28, 34, 24, '#fff', 700);
    p.text(st.place, W - 28, 34, 20, '#aab', 500, 'right', 300);

    const pg = this.page;
    if (pg.tab === 'chats' && pg.thread) this.thread(p, pg.thread);
    else if (pg.tab === 'chats') this.chats(p, pg.scroll);
    else if (pg.tab === 'agents') this.agents(p, pg.scroll);
    else if (pg.tab === 'ride') this.ride(p);
    else this.vr(p);

    // Tab bar.
    const tabs: { id: Page['tab']; label: string }[] = [{ id: 'chats', label: 'Chats' }, { id: 'agents', label: 'Agents' }, { id: 'ride', label: 'Ride' }, { id: 'vr', label: 'VR' }];
    const unread = this.unread();
    tabs.forEach((t, i) => {
      const x = 12 + i * 114;
      const on = pg.tab === t.id;
      p.button(`tab:${t.id}`, x, 712, 106, 72, t.id === 'chats' && unread ? `${t.label} ${unread}` : t.label,
        () => this.go(t.id === 'chats' || t.id === 'agents' ? { tab: t.id, scroll: 0 } : { tab: t.id } as Page),
        { fill: on ? 'rgba(79,140,255,0.45)' : 'rgba(255,255,255,0.08)', size: 22 });
    });
  }

  /** Scroll arrows for a list; returns the first index to show. */
  private pager(p: CanvasPanel, n: number, scroll: number, set: (s: number) => void) {
    const fit = Math.floor((LIST_BOTTOM - LIST_TOP - 10) / ROW);
    const s = Math.max(0, Math.min(scroll, Math.max(0, n - fit)));
    if (n > fit) {
      if (s > 0) p.button('up', W - 76, LIST_TOP, 60, 50, '▲', () => set(s - fit), { size: 22 });
      if (s + fit < n) p.button('down', W - 76, LIST_BOTTOM - 56, 60, 50, '▼', () => set(s + fit), { size: 22 });
    }
    return { s, fit };
  }

  private chats(p: CanvasPanel, scroll: number) {
    const threads = this.h.source.threads();
    const { s, fit } = this.pager(p, threads.length, scroll, (v) => this.go({ tab: 'chats', scroll: v }));
    threads.slice(s, s + fit).forEach((t, i) => {
      const y = LIST_TOP + 6 + i * ROW;
      const last = t.typing ? 'typing…' : t.messages.at(-1)?.text ?? t.sub;
      p.button(`t:${t.id}`, 16, y, W - 104, ROW - 10, '', () => { this.h.source.open(t.id); this.go({ tab: 'chats', thread: t.id, scroll: 0 }); }, { fill: 'rgba(255,255,255,0.07)' });
      p.text(t.title, 34, y + 28, 26, '#fff', 700, 'left', W - 190);
      p.text(last.replace(/\s+/g, ' '), 34, y + 60, 20, '#aab', 400, 'left', W - 160);
      if (t.unread) { p.rect(W - 132, y + 14, 36, 30, 15, '#ff4d5e'); p.text(String(t.unread), W - 114, y + 29, 18, '#fff', 700, 'center'); }
    });
  }

  private thread(p: CanvasPanel, id: string) {
    const t: XrThread | undefined = this.h.source.threads().find((x) => x.id === id);
    p.button('back', 16, 58, 120, 48, '‹ Back', () => this.go({ tab: 'chats', scroll: 0 }), { size: 22 });
    p.text(t?.title ?? id, 152, 82, 26, '#fff', 700, 'left', W - 176);
    if (!t) return;
    // Messages, newest at the bottom, as many as fit above the replies.
    const repliesTop = LIST_BOTTOM - t.replies.length * 52 - 6;
    let y = repliesTop - 14;
    if (t.typing) { p.text(`${t.title === 'HQ' ? 'HQ' : 'Lead'} is typing…`, 28, y - 10, 20, '#aab', 400); y -= 34; }
    for (let i = t.messages.length - 1; i >= 0 && y > 130; i--) {
      const m = t.messages[i];
      const lines = p.wrap(m.text, W - 150, 21).slice(0, 12);
      const hgt = lines.length * 27 + 22;
      const top = Math.max(118, y - hgt);
      const x = m.me ? 110 : 20;
      p.rect(x, top, W - 130, y - top, 18, m.me ? '#2f6bff' : 'rgba(255,255,255,0.13)');
      lines.forEach((l, j) => { const ly = top + 22 + j * 27; if (ly < y - 6) p.text(l, x + 16, ly, 21, '#fff', 400); });
      y = top - 10;
    }
    if (!t.messages.length) p.text('No messages yet. Pick one below.', W / 2, 300, 22, '#aab', 400, 'center');
    t.replies.forEach((r, i) => p.button(`r:${i}`, 16, repliesTop + i * 52, W - 32, 46, r, () => this.h.source.send(t.id, r), { size: 20, fill: 'rgba(79,140,255,0.22)' }));
  }

  private agents(p: CanvasPanel, scroll: number) {
    const list = this.h.source.agents();
    if (!list.length) { p.text('No agents yet. Text HQ or a project lead.', W / 2, 300, 22, '#aab', 400, 'center'); return; }
    const { s, fit } = this.pager(p, list.length, scroll, (v) => this.go({ tab: 'agents', scroll: v }));
    list.slice(s, s + fit).forEach((a, i) => {
      const y = LIST_TOP + 6 + i * ROW;
      p.rect(16, y, W - 104, ROW - 10, 14, 'rgba(255,255,255,0.07)');
      p.rect(30, y + 20, 14, 14, 7, STATUS_COLOR[a.status] ?? '#9aa0a6');
      p.text(`${a.name} · ${a.repo}`, 54, y + 27, 22, '#fff', 700, 'left', W - (a.status === 'running' ? 250 : 170));
      p.text(a.lastAction || a.task, 34, y + 60, 19, '#aab', 400, 'left', W - 150);
      if (a.status === 'running' || a.status === 'preparing') p.button(`stop:${a.id}`, W - 184, y + 8, 84, 40, 'Stop', () => this.h.source.stopAgent(a.id), { size: 19, fill: 'rgba(255,77,94,0.5)' });
    });
  }

  private ride(p: CanvasPanel) {
    const cur = this.h.vehicle();
    this.h.vehicles.forEach((v, i) => {
      const x = 16 + (i % 2) * 228, y = LIST_TOP + 10 + Math.floor(i / 2) * 108;
      p.button(`v:${v.id}`, x, y, 220, 96, `${v.icon} ${v.label}`, () => { this.h.ride(v.id); this.drawn = -1; }, { size: 24, fill: cur === v.id ? 'rgba(79,140,255,0.45)' : undefined });
    });
    p.text('Y on the left controller cycles them.', W / 2, 520, 19, '#aab', 400, 'center');
  }

  private vr(p: CanvasPanel) {
    const s = xrSettings.get();
    const row = (i: number, label: string, value: string, next: () => void) => {
      const y = LIST_TOP + 10 + i * 84;
      p.text(label, 28, y + 36, 24, '#fff', 600);
      p.button(`s:${i}`, W - 236, y + 6, 220, 60, value, () => { next(); this.drawn = -1; }, { size: 22 });
    };
    row(0, 'View', s.view === 'first' ? 'First person' : 'Behind robot', () => xrSettings.set({ view: s.view === 'first' ? 'third' : 'first' }));
    row(1, 'Turning', s.turn === 'snap' ? 'Snap 30°' : 'Smooth', () => xrSettings.set({ turn: s.turn === 'snap' ? 'smooth' : 'snap' }));
    row(2, 'Comfort vignette', s.vignette ? 'On' : 'Off', () => xrSettings.set({ vignette: !s.vignette }));
    row(3, 'Time of day', '+3 hours', () => this.h.skipTime());
    p.button('exit', 16, LIST_TOP + 10 + 4 * 84 + 10, W - 32, 64, 'Exit VR', () => this.h.exitVr(), { size: 24, fill: 'rgba(255,77,94,0.45)' });
    p.text('Left stick move · click or grip: run', W / 2, 560, 18, '#aab', 400, 'center');
    p.text('Right stick turn · down: dive · click: view', W / 2, 588, 18, '#aab', 400, 'center');
    p.text('A jump, hold for thrusters · B / trigger: use', W / 2, 616, 18, '#aab', 400, 'center');
    p.text('X this phone · Y next vehicle', W / 2, 644, 18, '#aab', 400, 'center');
  }
}
