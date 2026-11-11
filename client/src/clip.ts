// Record clip: one click makes a short film of a project's building in the real city and saves it.
// The sheet picks the building, the move (orbit, flyover or the history replay) and the shape (wide
// or tall); the film camera (cinema.ts) flies the move while each finished frame is copied into a 2D
// canvas with a small caption, and that canvas is recorded with MediaRecorder (MP4 where the browser
// can, WebM otherwise). The file is kept in ~/.openworld/clips and offered as a download. "Replay
// history" plays the same film without recording. Opened from photo mode (R), at an HQ's door (R) and
// from the phone's project page.
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { ClipInfo, Repo, RepoHistory } from '../../shared/types.ts';
import { api, track } from './api.ts';
import type { DayNight, Engine } from './engine.ts';
import type { Input } from './input.ts';
import { esc } from './interact.ts';
import type { Site } from './place.ts';
import { Cinema, filmTarget, makeShot, type FilmPart, type FilmWorld, type ShotKind } from './cinema.ts';
import { HistoryReplay, replaySeconds, type ReplayOverlay } from './history.ts';
import { toast } from './ui/panel.ts';
import './ui/clip.css';

export type ClipAspect = '16:9' | '9:16';

export interface StudioDeps {
  engine: Engine;
  input: Input;
  scene: THREE.Scene;
  dayNight: DayNight;
  sites: () => Site[];
  /** The HQs are in the world right now (you're in the home city). */
  sitesHere: () => boolean;
  player: () => THREE.Vector3;
  world: FilmWorld;
  film: { parts(repo: string): FilmPart[]; firework(repo: string, big?: boolean): void; spark(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, max?: number): void };
  /** Teleport to the building's doorstep (leaves any interior first). */
  travelTo: (s: Site) => Promise<void>;
  /** Inside a building, or mid-teleport. */
  indoors: () => boolean;
  /** The HQ whose door prompt is showing, if any. */
  atDoor: () => string | null;
}

export interface ClipStudio {
  /** A film is playing: the game loop calls `update` instead of moving the player's camera. */
  readonly busy: boolean;
  /** The sheet is up or a film is playing: photo mode leaves the keyboard alone. */
  readonly showing: boolean;
  update(dt: number): void;
  /** Call right after each frame is drawn. */
  afterRender(): void;
  /** Open the sheet for a building (default: the nearest one). */
  open(repo?: string, kind?: ShotKind): void;
  /** Watch a building's history without recording. */
  replay(repo?: string): void;
  close(): void;
}

/** How the phone (and anything else without a handle on the game) reaches the studio. */
export const clipEntry: { studio: ClipStudio | null } = { studio: null };

const LINK = 'OpenWorld · github.com/Shoberman2/openWorld';
const KINDS: { id: ShotKind; label: string; blurb: string }[] = [
  { id: 'orbit', label: 'Orbit', blurb: 'Circles up the building to its sign. 10 seconds.' },
  { id: 'flyover', label: 'Flyover', blurb: 'Comes in over the city and lands on the sign. 10 seconds.' },
  { id: 'history', label: 'History', blurb: 'The building goes up commit by commit. About 16 seconds.' },
];
const num = (n: number) => n.toLocaleString('en-US');

/** "1,204 commits · 38 PRs" */
export function statLine(r: Repo) {
  return [`${num(r.commits)} commit${r.commits === 1 ? '' : 's'}`, r.prs ? `${num(r.prs)} PR${r.prs === 1 ? '' : 's'}` : '', r.stars >= 10 ? `${num(r.stars)} stars` : ''].filter(Boolean).join(' · ');
}

/** The best container the browser will record: MP4 with H.264 first, then WebM. */
export function pickMime() {
  const order = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42E01F', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  return order.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

interface Caption { name: string; stat: string; aspect: ClipAspect }

/** Copies each frame into a fixed-size canvas, writes the caption on it and records that canvas. */
class Recorder {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private frames = 0;
  readonly mime: string;

  constructor(private src: HTMLCanvasElement, private cap: Caption, mime: string) {
    // A fixed size whatever the window is, as long as the game is drawing enough pixels to fill it.
    const tall = cap.aspect === '9:16';
    const big = tall ? src.height >= 1500 : src.height >= 1000 && src.width >= 1800;
    const [w, h] = tall ? (big ? [1080, 1920] : [720, 1280]) : big ? [1920, 1080] : [1280, 720];
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.g.imageSmoothingQuality = 'high';
    this.mime = mime;
    this.rec = new MediaRecorder(this.canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: w * h >= 1920 * 1080 ? 14_000_000 : 8_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  /** Draw the frame the game just rendered. `time` fades the caption in; `replay` is the history film's text. */
  frame(time: number, replay: ReplayOverlay | null) {
    const { g, canvas: c, src } = this, W = c.width, H = c.height;
    // Center-crop the game's picture to our shape.
    const want = W / H, have = src.width / src.height;
    const sw = have > want ? src.height * want : src.width, sh = have > want ? src.height : src.width / want;
    g.globalAlpha = 1;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
    this.caption(Math.min(1, Math.max(0, (time - 0.25) / 0.6)), replay);
    if (this.frames++ === 0) this.rec.start();
  }

  private caption(alpha: number, replay: ReplayOverlay | null) {
    const { g, canvas: c, cap } = this, W = c.width, H = c.height, tall = cap.aspect === '9:16';
    const u = (tall ? W : H) / 1080; // type scale
    const font = (px: number, weight = 600, mono = false) => `${weight} ${Math.round(px * u)}px ${mono ? '"JetBrains Mono", ui-monospace, monospace' : 'Inter, system-ui, sans-serif'}`;
    // A soft scrim under the words, so they read over a bright sky or a white wall.
    const scrim = g.createLinearGradient(0, H * (tall ? 0.66 : 0.72), 0, H);
    scrim.addColorStop(0, 'rgba(8,12,20,0)');
    scrim.addColorStop(1, 'rgba(8,12,20,0.6)');
    g.globalAlpha = alpha;
    g.fillStyle = scrim;
    g.fillRect(0, H * (tall ? 0.66 : 0.72), W, H);
    g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 14 * u;
    const fit = (text: string, px: number, weight: number, max: number) => {
      let size = px;
      g.font = font(size, weight);
      while (g.measureText(text).width > max && size > px * 0.5) { size -= 2; g.font = font(size, weight); }
    };
    if (tall) {
      // Stacked and centered, clear of the buttons a phone app draws over the bottom of a video.
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      fit(cap.name, 66, 700, W * 0.86);
      g.fillText(cap.name, W / 2, H * 0.8);
      g.font = font(32, 500);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(cap.stat, W / 2, H * 0.8 + 52 * u);
      g.font = font(24, 500);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(LINK, W / 2, H * 0.8 + 104 * u);
    } else {
      const m = 64 * u;
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      fit(cap.name, 58, 700, W * 0.55);
      g.fillText(cap.name, m, H - m - 44 * u);
      g.font = font(28, 500);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(cap.stat, m, H - m);
      g.textAlign = 'right';
      g.font = font(22, 500);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(LINK, W - m, H - m);
    }
    if (replay) {
      // The history film's ticker: the date and the count up top, the milestone under them.
      const x = tall ? W / 2 : 64 * u, y = tall ? H * 0.115 : 64 * u + 50 * u;
      g.textAlign = tall ? 'center' : 'left';
      g.fillStyle = '#fff';
      g.font = font(tall ? 60 : 56, 600, true);
      g.fillText(replay.date.toUpperCase(), x, y);
      g.font = font(27, 500);
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.fillText(`${num(replay.commits)} commit${replay.commits === 1 ? '' : 's'}${replay.approximate ? ' · approximate timeline' : ''}`, x, y + 44 * u);
      if (replay.caption && replay.captionAlpha > 0.01) {
        g.globalAlpha = alpha * replay.captionAlpha;
        g.fillStyle = '#fff';
        fit(replay.caption, 36, 600, W * (tall ? 0.88 : 0.6));
        g.fillText(replay.caption, x, y + 104 * u);
      }
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
  }

  /** Finish the file. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (this.rec.state === 'inactive') { resolve(new Blob(this.chunks, { type: this.mime })); return; }
      this.rec.onstop = () => {
        this.rec.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.mime }));
      };
      this.rec.stop();
    });
  }
}

export function installClipStudio(d: StudioDeps): ClipStudio {
  const cinema = new Cinema(d.engine.camera);
  const el = document.createElement('div');
  el.className = 'ow-clip ow-cine hidden';
  const rec = document.createElement('div');
  rec.className = 'ow-clip-rec ow-cine hidden';
  const hint = document.createElement('div');
  hint.className = 'ow-clip-hint hidden';
  document.body.append(el, rec, hint);

  const state = { repo: '', kind: 'orbit' as ShotKind, aspect: '16:9' as ClipAspect, hideName: false };
  let sheet: 'closed' | 'setup' | 'working' | 'result' = 'closed';
  let status = '';
  let filming = false;
  let recorder: Recorder | null = null;
  let replay: HistoryReplay | null = null;
  let result: { blob: Blob; url: string; saved: ClipInfo | null; error: string; kind: ShotKind; aspect: ClipAspect; seconds: number; name: string } | null = null;
  let hidePrivateMode = false;
  const mime = pickMime();

  const siteOf = (name: string) => d.sites().find((s) => s.repo.name === name);
  const nearest = () => {
    const p = d.player();
    let best: Site | undefined, bd = Infinity;
    for (const s of d.sites()) { const k = Math.hypot(s.door.x - p.x, s.door.z - p.z); if (k < bd) { bd = k; best = s; } }
    return best;
  };

  // ---- the sheet ----
  function draw() {
    el.classList.toggle('hidden', sheet === 'closed' || filming);
    document.body.classList.toggle('clip-sheet', sheet !== 'closed' && !filming);
    if (sheet === 'closed') { el.innerHTML = ''; return; }
    const site = siteOf(state.repo), r = site?.repo;
    const seg = (name: string, opts: { id: string; label: string }[], on: string) =>
      `<div class="ow-clip-seg" role="radiogroup" data-seg="${name}">${opts.map((o) => `<button role="radio" aria-checked="${o.id === on}" data-v="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>`;
    const head = (title: string) => `<div class="ow-clip-head"><h4>${title}</h4><button class="ow-clip-x" data-close title="Close (Esc)" aria-label="Close">✕</button></div>`;
    if (sheet === 'result' && result) {
      const tall = result.aspect === '9:16';
      el.innerHTML = `${head('Your Clip')}
        <video class="ow-clip-video${tall ? ' tall' : ''}" src="${result.url}" controls loop muted autoplay playsinline></video>
        <p class="ow-clip-note">${result.saved ? `Saved to <code>${esc(result.saved.path)}</code>` : result.error ? `Couldn't keep a copy on this computer (${esc(result.error)}). Download it instead.` : 'Saving…'}</p>
        <div class="ow-clip-acts"><button class="ow-clip-btn" data-download>Download</button><button class="ow-clip-btn ghost" data-again>Record another</button></div>`;
    } else if (sheet === 'working') {
      el.innerHTML = `${head('Record A Clip')}<p class="ow-clip-note">${esc(status)}</p>`;
    } else {
      const kind = KINDS.find((k) => k.id === state.kind)!;
      const priv = r?.isPrivate
        ? `<div class="ow-clip-private"><p>This clip shows a private repo's name.</p>${hidePrivateMode
          ? '<p class="ow-clip-note">Hide private repos is on, so the name stays out of it.</p>'
          : seg('name', [{ id: 'show', label: 'Show the name' }, { id: 'hide', label: 'Hide the name' }], state.hideName ? 'hide' : 'show')}
          ${state.hideName || hidePrivateMode ? '<p class="ow-clip-note">The caption says "A private project", and the sign and logo come off the building while it films.</p>' : ''}</div>`
        : '';
      el.innerHTML = `${head('Record A Clip')}
        <label class="ow-clip-label" for="ow-clip-repo">Building</label>
        <select id="ow-clip-repo" class="ow-clip-select">${d.sites().map((s) => `<option value="${esc(s.repo.name)}"${s.repo.name === state.repo ? ' selected' : ''}>${esc(s.repo.name)}</option>`).join('')}</select>
        <span class="ow-clip-label">Shot</span>${seg('kind', KINDS, state.kind)}
        <p class="ow-clip-note">${esc(kind.blurb)}</p>
        <span class="ow-clip-label">Shape</span>${seg('aspect', [{ id: '16:9', label: 'Wide 16:9' }, { id: '9:16', label: 'Tall 9:16' }], state.aspect)}
        ${priv}
        ${mime ? '' : '<p class="ow-clip-note">This browser can\'t record video. You can still watch the film.</p>'}
        <div class="ow-clip-acts"><button class="ow-clip-btn" data-record ${mime && r ? '' : 'disabled'}>Record clip</button>${state.kind === 'history' ? '<button class="ow-clip-btn ghost" data-watch>Just watch</button>' : ''}</div>`;
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => close());
    el.querySelector<HTMLSelectElement>('#ow-clip-repo')?.addEventListener('change', (e) => { state.repo = (e.target as HTMLSelectElement).value; state.hideName = false; draw(); });
    el.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => s.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.v!;
      if (s.dataset.seg === 'kind') state.kind = v as ShotKind;
      else if (s.dataset.seg === 'aspect') state.aspect = v as ClipAspect;
      else state.hideName = v === 'hide';
      draw();
    })));
    el.querySelector('[data-record]')?.addEventListener('click', () => void film(true));
    el.querySelector('[data-watch]')?.addEventListener('click', () => void film(false));
    el.querySelector('[data-again]')?.addEventListener('click', () => { dropResult(); sheet = 'setup'; draw(); });
    el.querySelector('[data-download]')?.addEventListener('click', () => {
      if (!result) return;
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `openworld-${result.name}-${result.kind}.${result.blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      track('clip_downloaded', { kind: result.kind, aspect: result.aspect });
    });
  }
  function dropResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }
  let job = 0;
  function close() {
    if (filming) return;
    job++;
    dropResult();
    sheet = 'closed';
    draw();
  }

  function open(repo?: string, kind?: ShotKind) {
    if (filming) return;
    if (d.engine.renderer.xr.isPresenting) { toast('Clips are recorded from the desktop view. Leave VR first.'); return; }
    if (!d.sites().length) { toast('Connect GitHub first: clips are films of your own buildings.'); return; }
    const site = (repo && siteOf(repo)) || (!repo && d.sitesHere() ? nearest() : undefined) || d.sites()[0];
    dropResult();
    state.repo = site.repo.name;
    if (kind) state.kind = kind;
    state.hideName = false;
    sheet = 'setup';
    d.input.free();
    draw();
    // Private repos may be hidden for recording (Settings): if one is still on screen, its name stays out.
    api.me().then((me) => { hidePrivateMode = !!me.hidePrivate; if (sheet === 'setup') draw(); }).catch(() => {});
  }

  // ---- filming ----
  async function film(record: boolean, only?: { repo: string }) {
    if (filming || sheet === 'working') return;
    const site = siteOf(only?.repo ?? state.repo);
    if (!site) return;
    const kind: ShotKind = only ? 'history' : state.kind, aspect = state.aspect, repo = site.repo;
    const hide = repo.isPrivate && (state.hideName || hidePrivateMode);
    const wait = (text: string) => { status = text; sheet = 'working'; draw(); };
    const mine = ++job;
    try {
      // Be at the building: the detailed city streams in around the player.
      const p = d.player();
      if (d.indoors() || !d.sitesHere() || Math.hypot(site.door.x - p.x, site.door.z - p.z) > 260) {
        wait(`Going to ${repo.name}…`);
        await d.travelTo(site);
        await new Promise((r) => setTimeout(r, 1200));
        if (d.indoors() || !d.sitesHere()) throw new Error('could not get to the building');
      }
      let history: RepoHistory | null = null;
      if (kind === 'history') {
        wait('Reading the history from GitHub…');
        history = await api.history(repo.name);
      }
      // Closed while we were getting ready: never mind.
      if (mine !== job) return;
      const parts = d.film.parts(repo.name);
      const target = filmTarget(site, parts);
      const frameAspect = record ? (aspect === '9:16' ? 9 / 16 : Math.min(16 / 9, d.engine.camera.aspect)) : d.engine.camera.aspect;
      const shot = makeShot(kind, target, d.world, frameAspect, history ? replaySeconds(history) : undefined);

      // ---- take over: no HUD, no depth-of-field left over from photo mode, the clock held where it is ----
      filming = true;
      draw();
      const bokeh = d.engine.composer.passes.filter((x) => x instanceof BokehPass && x.enabled);
      bokeh.forEach((x) => { x.enabled = false; });
      const hour = d.dayNight.hour, speed = d.dayNight.speed;
      const signs = hide ? d.scene.getObjectByName(`repo:${repo.name}`) : null, signsWere = signs?.visible ?? true;
      if (signs) signs.visible = false;
      document.body.classList.add('cinema-mode');
      rec.classList.remove('hidden');
      if (history) replay = new HistoryReplay({ scene: d.scene, film: d.film }, site, parts, history, { duration: shot.duration, dom: true, showSigns: !hide });
      if (record) {
        recorder = new Recorder(d.engine.renderer.domElement, { name: hide ? 'A private project' : repo.name, stat: statLine(repo), aspect }, mime!);
        track('clip_started', { kind, aspect });
      } else track('history_replayed', {});
      cinema.onFrame = (time, dt) => {
        replay?.update(time, dt);
        const left = Math.max(0, Math.ceil(shot.duration - time));
        const text = `${record ? 'Recording' : 'Replaying'} · ${left}s · Esc to stop`;
        if (rec.textContent !== text) rec.textContent = text;
      };
      rec.classList.toggle('live', record);
      const finished = await cinema.play(shot);
      // The last frame has been drawn into the recording by now (afterRender runs after the camera is back, so it was skipped).
      const blob = recorder ? await recorder.stop() : null;
      const seconds = Math.round(cinema.time * 10) / 10;

      // ---- give everything back ----
      recorder = null;
      cinema.onFrame = null;
      replay?.dispose();
      replay = null;
      if (signs) signs.visible = signsWere;
      bokeh.forEach((x) => { x.enabled = true; });
      d.dayNight.hour = hour; d.dayNight.speed = speed;
      document.body.classList.remove('cinema-mode');
      rec.classList.add('hidden');
      d.input.consumeMouse();
      filming = false;

      if (!finished || !blob) {
        if (only) { sheet = 'closed'; draw(); return; }
        sheet = 'setup';
        draw();
        if (!finished && record) toast('Recording stopped. Nothing was saved.', 3000);
        return;
      }
      const name = hide ? 'project' : repo.name.replace(/[^\w.-]/g, '_');
      result = { blob, url: URL.createObjectURL(blob), saved: null, error: '', kind, aspect, seconds, name };
      sheet = 'result';
      draw();
      const kept = result;
      api.saveClip(blob, { repo: hide ? '' : repo.name, kind, aspect, seconds }).then(
        (saved) => { kept.saved = saved; track('clip_saved', { kind, aspect, seconds, bytes: blob.size, type: blob.type.split(';')[0] }); },
        (e: Error) => { kept.error = e.message; },
      ).finally(() => { if (result === kept && sheet === 'result') draw(); });
    } catch (e) {
      filming = false;
      document.body.classList.remove('cinema-mode');
      rec.classList.add('hidden');
      toast(`Couldn't make the clip: ${esc((e as Error).message)}`);
      sheet = only ? 'closed' : 'setup';
      draw();
    }
  }

  // While a film plays the keyboard belongs to it: Esc stops, everything else waits.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (filming && cinema.active) {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'Escape') cinema.stop();
      return;
    }
    if (sheet === 'closed' || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  // R at an HQ's door opens the sheet for that building.
  d.input.onPress('KeyR', () => {
    const repo = d.atDoor();
    if (repo && sheet === 'closed' && !filming && !d.indoors()) open(repo);
  });
  let hintT = 0, hintFor = '';
  function doorHint() {
    const now = performance.now();
    if (now - hintT < 200) return;
    hintT = now;
    const repo = sheet === 'closed' && !filming && !d.indoors() ? d.atDoor() ?? '' : '';
    if (repo === hintFor) return;
    hintFor = repo;
    hint.classList.toggle('hidden', !repo);
    if (repo) hint.innerHTML = '<kbd>R</kbd>Record a clip';
  }

  const studio: ClipStudio = {
    get busy() { return filming && cinema.active; },
    get showing() { return sheet !== 'closed' || filming; },
    update(dt) { cinema.update(dt); },
    afterRender() {
      if (recorder && cinema.active) recorder.frame(cinema.time, replay?.overlay ?? null);
      else doorHint();
    },
    open,
    replay(repo) {
      const site = (repo && siteOf(repo)) || nearest();
      if (!site || filming) return;
      if (d.engine.renderer.xr.isPresenting) { toast('The history replay plays in the desktop view. Leave VR first.'); return; }
      void film(false, { repo: site.repo.name });
    },
    close,
  };
  clipEntry.studio = studio;
  return studio;
}
