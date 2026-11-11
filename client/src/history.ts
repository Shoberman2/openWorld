// "Replay history": the repo's building going up over its real history. The HQ is a real building
// that can't be rebuilt, so it starts wrapped in an opaque blueprint shell (its footprint, extruded to
// the roof and a little inflated, drawn as a drafting grid in the repo's color). As the commits add up
// the shell is wiped away from the ground, so the real building comes out floor by floor behind a
// bright construction line with sparks on it. A date ticker and milestone captions (first commit,
// releases, people joining, the busiest month) ride along, and the release fireworks go up at the end.
// Only what GitHub actually told us is captioned; an estimated curve is labelled as approximate.
import * as THREE from 'three';
import type { RepoHistory } from '../../shared/types.ts';
import { shared } from './engine.ts';
import type { FilmPart } from './cinema.ts';
import type { Site } from './place.ts';

export interface ReplayDeps {
  scene: THREE.Scene;
  /** The release fireworks and loose sparks of city/signals.ts. */
  film: { firework(repo: string, big?: boolean): void; spark(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, max?: number): void };
}

/** What the film is saying right now (drawn as DOM text here, and burned into a recording by clip.ts). */
export interface ReplayOverlay {
  date: string;
  commits: number;
  /** The milestone on screen, and how visible it is (0..1). */
  caption: string;
  captionAlpha: number;
  approximate: boolean;
  /** 0..1 through the building's life. */
  progress: number;
}

interface Milestone { at: number; kind: 'first' | 'release' | 'join' | 'busy' | 'made'; text: string; who?: string; tag?: string; s: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Seconds a replay should run for a history with this many buckets: short lives get a shorter film. */
export const replaySeconds = (h: RepoHistory) => THREE.MathUtils.clamp(11 + h.buckets.length * 0.12, 13, 18);

/** The timeline: where each bucket and each milestone falls in the film's 0..1. */
function timeline(h: RepoHistory) {
  const n = h.buckets.length, total = Math.max(1, h.totalCommits);
  const span = h.unit === 'week' ? 7 * 86_400_000 : 30.44 * 86_400_000;
  const t0 = Date.parse(h.buckets[0]?.t ?? h.createdAt), last = Date.parse(h.buckets[n - 1]?.t ?? h.createdAt) + span;
  const t1 = Math.max(t0 + 86_400_000, Math.min(last, Math.max(Date.parse(h.pushedAt) || last, t0)));
  // Half the film follows the calendar and half follows the work, so a quiet year passes quickly
  // without the dates jumping.
  const s = new Float32Array(n + 1), cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    s[i + 1] = s[i] + 0.5 / n + (0.5 * h.buckets[i].commits) / total;
    cum[i + 1] = cum[i] + h.buckets[i].commits;
  }
  const starts = h.buckets.map((b) => Date.parse(b.t));
  /** Film position of a date. */
  const sOf = (ms: number) => {
    if (ms <= t0) return 0;
    if (ms >= t1) return 1;
    let i = 0;
    while (i < n - 1 && starts[i + 1] <= ms) i++;
    const end = i < n - 1 ? starts[i + 1] : t1;
    return (s[i] + (s[i + 1] - s[i]) * THREE.MathUtils.clamp((ms - starts[i]) / Math.max(1, end - starts[i]), 0, 1)) / s[n];
  };
  /** Date and commits so far at a film position. */
  const at = (x: number) => {
    const want = THREE.MathUtils.clamp(x, 0, 1) * s[n];
    let i = 0;
    while (i < n - 1 && s[i + 1] < want) i++;
    const f = THREE.MathUtils.clamp((want - s[i]) / Math.max(1e-6, s[i + 1] - s[i]), 0, 1);
    const end = i < n - 1 ? starts[i + 1] : t1;
    return { ms: starts[i] + (end - starts[i]) * f, commits: cum[i] + (cum[i + 1] - cum[i]) * f };
  };

  const out: Milestone[] = [];
  const add = (ms: number, m: Omit<Milestone, 'at' | 's'>) => { if (Number.isFinite(ms)) out.push({ ...m, at: ms, s: sOf(ms) }); };
  if (h.firstCommitAt) add(Date.parse(h.firstCommitAt), { kind: 'first', text: `First commit · ${new Date(h.firstCommitAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` });
  else add(Date.parse(h.createdAt), { kind: 'made', text: `Repository created · ${monthYear(Date.parse(h.createdAt))}` });
  for (const r of h.releases) add(Date.parse(r.publishedAt), { kind: 'release', text: `Released ${r.tag}`, tag: r.tag });
  // People who arrive after the first bucket are the ones who joined (the founders are the first commit).
  // GitHub dates a contributor to the week of their first commit, so anyone within a week of the very
  // first commit is a founder, not someone who joined.
  const founders = Math.max(starts[0], Date.parse(h.firstCommitAt ?? h.buckets[0]?.t ?? h.createdAt)) + 7 * 86_400_000;
  for (const c of h.contributors) {
    const ms = Date.parse(c.firstAt);
    if (ms > founders && !/\[bot\]$/.test(c.login)) add(ms + 3.5 * 86_400_000, { kind: 'join', text: `${c.login} joined`, who: c.login });
  }
  if (!h.approximate) {
    const byMonth = new Map<string, { n: number; ms: number }>();
    h.buckets.forEach((b, i) => {
      const k = b.t.slice(0, 7), m = byMonth.get(k) ?? { n: 0, ms: starts[i] };
      m.n += b.commits;
      byMonth.set(k, m);
    });
    const busiest = [...byMonth.values()].sort((a, b) => b.n - a.n)[0];
    if (busiest && byMonth.size >= 3 && busiest.n >= 5) {
      const d = new Date(busiest.ms);
      add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 16), { kind: 'busy', text: `Busiest month · ${plural(busiest.n, 'commit')} in ${monthYear(busiest.ms)}` });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return { at, milestones: out, total: h.totalCommits };
}

/** Push a ring's corners outward by `d` meters (mitred), so the shell stands just off the walls. */
function inflate(ring: number[], d: number) {
  const n = ring.length / 2, out = new Array<number>(ring.length);
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]; }
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    let ax = ring[i * 2] - ring[p * 2], az = ring[i * 2 + 1] - ring[p * 2 + 1], bx = ring[q * 2] - ring[i * 2], bz = ring[q * 2 + 1] - ring[i * 2 + 1];
    const al = Math.hypot(ax, az) || 1, bl = Math.hypot(bx, bz) || 1;
    ax /= al; az /= al; bx /= bl; bz /= bl;
    // Outward normals of the two edges that meet here, averaged.
    let nx = (az + bz) * sign, nz = -(ax + bx) * sign;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-4) { nx = az * sign; nz = -ax * sign; } else { nx /= nl; nz /= nl; }
    const k = Math.min(2.5, 1 / Math.max(0.35, nx * az * sign - nz * ax * sign));
    out[i * 2] = ring[i * 2] + nx * d * k;
    out[i * 2 + 1] = ring[i * 2 + 1] + nz * d * k;
  }
  return out;
}

const VERT = /* glsl */ `
  attribute vec2 aGrid; attribute float aShade;
  varying vec2 vGrid; varying float vY; varying float vShade;
  void main() {
    vGrid = aGrid; vY = position.y; vShade = aShade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */ `
  uniform float uBuild, uNight, uLine;
  uniform vec3 uPaper, uInk;
  varying vec2 vGrid; varying float vY; varying float vShade;
  float grid(vec2 g, float every) {
    vec2 q = g / every, w = fwidth(q);
    vec2 l = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-5));
    // Lines thinner than a pixel fade out instead of shimmering.
    return (1.0 - min(min(l.x, l.y), 1.0)) * (1.0 - smoothstep(0.3, 0.7, max(w.x, w.y)));
  }
  void main() {
    if (vY < uBuild) discard;
    float fine = grid(vGrid, 3.3), bold = grid(vGrid, 16.5);
    vec3 col = uPaper * vShade * mix(1.0, 0.5, uNight);
    col += uInk * (fine * 0.3 + bold * 0.75) * mix(1.0, 1.5, uNight);
    // The construction line: the shell's lower edge burns bright where the building is being finished.
    float edge = 1.0 - smoothstep(0.0, uLine, vY - uBuild);
    col += (uInk * 2.2 + vec3(1.6, 1.3, 0.9)) * edge * edge;
    // Alpha 1: the renderer reads the color buffer's alpha as a reflection mask, and this isn't a mirror.
    gl_FragColor = vec4(col, 1.0);
  }`;

export class HistoryReplay {
  readonly duration: number;
  readonly overlay: ReplayOverlay = { date: '', commits: 0, caption: '', captionAlpha: 0, approximate: false, progress: 0 };
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private el: HTMLDivElement | null = null;
  private tl: ReturnType<typeof timeline>;
  private base: number; private top: number;
  private buildY: number;
  private next = 0;
  private queue: Milestone[] = [];
  private captionT = 99;
  private fired = 0;
  private sparkDebt = 0;
  /** Outline segments to throw sparks from: [x, z, dx, dz, len, base, top]. */
  private edges: number[][] = [];
  private edgeLen = 0;
  private signs: THREE.Object3D | null;
  private signsWere = true;
  private warm = new THREE.Color(2.6, 1.5, 0.45);
  private hot = new THREE.Color(2.4, 2.2, 1.9);
  private ink: THREE.Color;

  /** `dom`: show the ticker and captions on screen. `showSigns`: false keeps the project's sign and logo off (a private repo). */
  constructor(private d: ReplayDeps, private site: Site, parts: FilmPart[], private history: RepoHistory, opts: { duration?: number; dom?: boolean; showSigns?: boolean } = {}) {
    this.duration = opts.duration ?? replaySeconds(history);
    this.tl = timeline(history);
    this.overlay.approximate = history.approximate;
    const all = parts.length ? parts : [{ ring: site.footprint ?? [], base: site.door.y, top: site.top.y }];
    this.base = Math.min(site.door.y, ...all.map((p) => p.base));
    this.top = Math.max(site.top.y, ...all.map((p) => p.top));
    this.buildY = this.base - 1;

    // ---- the shell: every part's outline extruded to its roof, with a lid ----
    const pos: number[] = [], grid: number[] = [], shade: number[] = [], idx: number[] = [];
    const PAD = 0.75, LID = 0.9;
    for (const p of all) {
      if (p.ring.length < 6) continue;
      const r = inflate(p.ring, PAD), n = r.length / 2, y0 = p.base - 1.2, y1 = p.top + LID;
      let run = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1], len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        // A fixed "sun" from the south-east gives the box some form without real lighting.
        const lit = 0.78 + 0.22 * (((bz - az) / len) * 0.6 - ((bx - ax) / len) * 0.5);
        const v = pos.length / 3;
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
        grid.push(run, y0 - this.base, run + len, y0 - this.base, run + len, y1 - this.base, run, y1 - this.base);
        shade.push(lit, lit, lit, lit);
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        this.edges.push([ax, az, (bx - ax) / len, (bz - az) / len, len, p.base, p.top + LID]);
        this.edgeLen += len;
        run += len;
      }
      const v0 = pos.length / 3;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) { pts.push(new THREE.Vector2(r[i * 2], r[i * 2 + 1])); pos.push(r[i * 2], y1, r[i * 2 + 1]); grid.push(r[i * 2], r[i * 2 + 1]); shade.push(1.08); }
      for (const tri of THREE.ShapeUtils.triangulateShape(pts, [])) idx.push(v0 + tri[0], v0 + tri[1], v0 + tri[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 2));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    geo.setIndex(idx);
    // The repo's color, as blueprint paper (deep) and as ink (light).
    const brand = new THREE.Color(site.repo.brandColor || '#4fd1ff'), hsl = brand.getHSL({ h: 0, s: 0, l: 0 });
    const paper = new THREE.Color().setHSL(hsl.h, Math.max(0.55, hsl.s), 0.2);
    this.ink = new THREE.Color().setHSL(hsl.h, Math.max(0.5, hsl.s * 0.9), 0.74);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uBuild: { value: this.buildY }, uNight: shared.uNight, uLine: { value: 1.2 }, uPaper: { value: paper }, uInk: { value: this.ink } },
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'history-shell';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    d.scene.add(this.mesh);

    // The project's sign, logo and lobby wait until the ground floor is up.
    this.signs = d.scene.getObjectByName(`repo:${site.repo.name}`) ?? null;
    if (this.signs) { this.signsWere = this.signs.visible; this.signs.visible = false; }
    this.showSigns = opts.showSigns !== false;

    if (opts.dom !== false) {
      this.el = document.createElement('div');
      this.el.className = 'ow-replay ow-cine';
      this.el.innerHTML = `<div class="ow-replay-date"></div><div class="ow-replay-count"></div><div class="ow-replay-cap"></div>${history.approximate ? '<div class="ow-replay-note">Approximate: GitHub could not give this repo\'s history, so the growth is spread evenly.</div>' : ''}`;
      document.body.append(this.el);
    }
    this.update(0, 0);
  }
  private showSigns: boolean;

  /** `time`: seconds into the film. The build runs from a short hold at the start to the finale. */
  update(time: number, dt: number) {
    const D = this.duration, lead = 1.3, finale = 4.4;
    const x = THREE.MathUtils.clamp((time - lead) / Math.max(1, D - lead - finale), 0, 1);
    const now = this.tl.at(x), frac = this.tl.total ? now.commits / this.tl.total : x;
    // The wipe follows the commits, eased so a single big week still rises instead of jumping.
    const h = this.top - this.base, want = x >= 1 ? this.top + 4 : this.base - 1 + (h + 1) * frac;
    const before = this.buildY;
    this.buildY = dt > 0 ? THREE.MathUtils.damp(this.buildY, want, x >= 1 ? 2.2 : 5, dt) : want;
    this.mat.uniforms.uBuild.value = this.buildY;
    this.mat.uniforms.uLine.value = THREE.MathUtils.clamp(h * 0.02, 0.9, 3);
    this.mesh.visible = this.buildY < this.top + 2;
    if (this.signs) this.signs.visible = this.showSigns && this.signsWere && this.buildY > this.base + Math.min(5, h * 0.3);

    // Sparks along the construction line while it is moving.
    const rising = this.buildY - before;
    if (dt > 0 && rising > 0.002 && this.mesh.visible && this.edgeLen > 0) {
      this.sparkDebt += dt * THREE.MathUtils.clamp(this.edgeLen * 0.5, 30, 110);
      const p = new THREE.Vector3(), v = new THREE.Vector3();
      for (; this.sparkDebt >= 1; this.sparkDebt--) {
        let pick = Math.random() * this.edgeLen, e = this.edges[0];
        for (const k of this.edges) { e = k; if ((pick -= k[4]) <= 0) break; }
        if (this.buildY < e[5] || this.buildY > e[6]) continue;
        const along = Math.random() * e[4];
        p.set(e[0] + e[2] * along, this.buildY + 0.2, e[1] + e[3] * along);
        v.set((Math.random() - 0.5) * 5, 1 + Math.random() * 4, (Math.random() - 0.5) * 5);
        this.d.film.spark(p, v, Math.random() < 0.3 ? this.hot : this.warm, 0.45 + Math.random() * 0.6);
      }
    }

    // Milestones: as the film passes each one it joins the line; they take turns on screen.
    while (this.next < this.tl.milestones.length && (this.tl.milestones[this.next].s <= x || x >= 1) && time >= 0.5) this.queue.push(this.tl.milestones[this.next++]);
    this.captionT += dt;
    const o = this.overlay;
    if (this.queue.length && this.captionT > (this.queue.length > 2 ? 0.75 : 1.25)) {
      const m = this.queue.shift()!;
      // Several of a kind at once read as one line.
      let more = 0, last = m;
      while (this.queue.length && this.queue[0].kind === m.kind && (m.kind === 'release' || m.kind === 'join')) { last = this.queue.shift()!; more++; }
      o.caption = !more ? m.text : m.kind === 'release' ? `Released ${last.tag} · ${more + 1} releases` : `${m.who} and ${more} more joined`;
      this.captionT = 0;
    }
    // The finale: fireworks off the roof, and the building's whole story in one line.
    if (time > D - finale + 0.3 && this.fired === 0) { this.fired = 1; this.d.film.firework(this.site.repo.name, true); }
    if (time > D - finale + 1.9 && this.fired === 1) { this.fired = 2; this.d.film.firework(this.site.repo.name, true); }
    if (time > D - finale + 1.2 && !this.queue.length && this.fired && !this.summed && this.captionT > 1) {
      this.summed = true;
      const h2 = this.history, people = h2.contributors.filter((c) => !/\[bot\]$/.test(c.login)).length;
      o.caption = [plural(h2.totalCommits, 'commit'), h2.releases.length ? plural(h2.releases.length, 'release') : '', people > 1 ? plural(people, 'contributor') : ''].filter(Boolean).join(' · ');
      this.captionT = 0;
    }
    o.captionAlpha = o.caption ? THREE.MathUtils.clamp(this.captionT / 0.25, 0, 1) * (this.summed ? 1 : THREE.MathUtils.clamp((3.2 - this.captionT) / 0.5, 0, 1)) : 0;
    o.date = monthYear(now.ms);
    o.commits = Math.round(now.commits);
    o.progress = x;
    if (this.el) {
      const [date, count, cap] = this.el.children as unknown as HTMLElement[];
      if (date.textContent !== o.date) date.textContent = o.date;
      const c = plural(o.commits, 'commit');
      if (count.textContent !== c) count.textContent = c;
      if (cap.textContent !== o.caption) cap.textContent = o.caption;
      cap.style.opacity = String(o.captionAlpha);
    }
  }
  private summed = false;

  /** Take everything down: the shell, its material, the text, and the signs back as they were. */
  dispose() {
    this.d.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.el?.remove();
    this.el = null;
    if (this.signs) this.signs.visible = this.signsWere;
  }
}
