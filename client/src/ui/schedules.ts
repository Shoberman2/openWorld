// Phone "Schedules" app: project leads that work while you're away. List, toggle, run now, and add
// from a template or a custom task. Nothing runs until you switch it on.
import type { Schedule } from '../../../shared/types.ts';
import { schedules as api, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { toast } from './panel.ts';
import './briefing.css';

export const TEMPLATES: { id: string; title: string; blurb: string; task: string; cadence: Schedule['cadence']; hour: number; weekday?: number }[] = [
  {
    id: 'deps', title: 'Nightly dependency check', blurb: 'Outdated or vulnerable packages, summarized. Read-only.', cadence: 'daily', hour: 2,
    task: "Check this repo's dependencies for outdated or vulnerable packages (npm outdated / npm audit, or the equivalent for its language). Summarize what is outdated, what is risky, and what you'd bump first. Read-only: do not edit, create or delete any files.",
  },
  {
    id: 'triage', title: 'Morning issue triage', blurb: 'New issues, one line each, with a priority guess. Read-only.', cadence: 'daily', hour: 7,
    task: 'Look at the open GitHub issues for this repo (and any TODO/FIXME notes added recently). For each, write one line: what it is, a priority guess (P0-P3) and the files likely involved. Read-only: do not edit, create or delete any files.',
  },
  {
    id: 'tests', title: 'Fix failing tests', blurb: 'Runs the tests; if any fail, a small fix waits for your review.', cadence: 'daily', hour: 3,
    task: "Run this repo's test suite (and the type checker, if there is one). If everything passes, say so and stop. If something fails, find the cause and fix it with the smallest sensible change. Do not push or open PRs; leave the fix for review.",
  },
  {
    id: 'docs', title: 'Weekly docs freshness', blurb: 'README and docs vs. the code: what is out of date. Read-only.', cadence: 'weekly', hour: 9, weekday: 1,
    task: 'Compare the README and any docs with the current code. List anything that is out of date or missing, and propose the corrected text. Read-only: do not edit, create or delete any files.',
  },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
export const cadenceLabel = (s: Pick<Schedule, 'cadence' | 'hour' | 'weekday'>) =>
  s.cadence === 'weekly' ? `Every ${DAYS[s.weekday ?? 1]} at ${hourLabel(s.hour)}` : `Every day at ${hourLabel(s.hour)}`;

function nextLabel(iso: string | null) {
  if (!iso) return 'Off';
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86400_000);
  return `Next: ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : DAYS[d.getDay()]} ${t}`;
}

let list: Schedule[] | null = null;
let loadErr = '';
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };

function load() {
  return api.list().then((s) => { list = s; loadErr = ''; changed(); }).catch((e) => { loadErr = (e as Error).message; changed(); });
}
onLive((msg) => {
  if (msg.type !== 'schedule:update' || !list) return;
  void load();
});

/** Enabled schedules, for badges elsewhere. */
export const enabledSchedules = () => (list ?? []).filter((s) => s.enabled);

type Mode = { kind: 'list' } | { kind: 'add'; tpl?: string; repo?: string };
let mode: Mode = { kind: 'list' };

export interface SchedulesAppOpts {
  /** The phone's app header markup (with its back button). */
  header(title: string, sub?: string): string;
  /** Wire the phone's shared bits (back button) after each draw. */
  bindCommon(): void;
  repos(): string[];
  /** Back button inside the add form returns to the list instead of the home screen. */
  setBackHandler(fn: (() => boolean) | null): void;
}

/** Draw the Schedules app into the phone's view. Returns an unsubscribe for live updates. */
export function renderSchedulesApp(el: HTMLElement, o: SchedulesAppOpts, opts: { repo?: string } = {}) {
  if (opts.repo) mode = { kind: 'add', repo: opts.repo };
  const draw = () => {
    if (!el.isConnected) { listeners.delete(draw); return; }
    if (mode.kind === 'add') drawAdd(el, o, mode);
    else drawList(el, o);
  };
  listeners.add(draw);
  if (!list) void load();
  draw();
  return () => listeners.delete(draw);
}

function drawList(el: HTMLElement, o: SchedulesAppOpts) {
  o.setBackHandler(null);
  const items = list ?? [];
  let html = `${o.header('Schedules', `${items.filter((s) => s.enabled).length} on · work while you're away`)}<div class="pv-scroll">`;
  if (!list) html += `<p class="bf-empty">${loadErr ? `Couldn't load: ${esc(loadErr)}` : 'Loading…'}</p>`;
  for (const s of items) {
    html += `<div class="sc-row" data-id="${esc(s.id)}">
      <div class="sc-top"><div><b>${esc(s.repo)}</b><small>${esc(cadenceLabel(s))} · ${esc(nextLabel(s.nextRunAt))}</small></div>
        <button class="sc-toggle ${s.enabled ? 'on' : ''}" data-toggle title="${s.enabled ? 'Turn off' : 'Turn on'}" aria-pressed="${s.enabled}"></button></div>
      <p>${esc(s.task.slice(0, 180))}${s.task.length > 180 ? '…' : ''}</p>
      <div class="sc-actions"><button class="pbtn sm" data-run>Run now</button><button class="pbtn sm ghost" data-del>Delete</button>
        ${s.lastRunAt ? `<small style="margin-left:auto;align-self:center;color:#8a93a2;font-size:11.5px">Last run ${esc(new Date(s.lastRunAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</small>` : ''}</div>
    </div>`;
  }
  html += `<h5 class="bf-h">Add a schedule</h5><div class="sc-templates">${TEMPLATES.map((t) => `<button class="sc-tpl" data-tpl="${t.id}"><b>${esc(t.title)}</b><small>${esc(t.blurb)} ${esc(cadenceLabel(t))}.</small></button>`).join('')}
    <button class="sc-tpl" data-tpl=""><b>Custom task…</b><small>Any repo, any instructions, daily or weekly.</small></button></div>
    <p class="sc-note">Each run is a Claude agent in its own branch. Nothing is pushed; finished work waits for your review in the building's lobby and on the morning briefing.</p></div>`;
  el.innerHTML = html;
  o.bindCommon();
  el.querySelectorAll<HTMLElement>('[data-tpl]').forEach((b) => b.addEventListener('click', () => { mode = { kind: 'add', tpl: b.dataset.tpl || undefined }; changed(); }));
  el.querySelectorAll<HTMLElement>('.sc-row').forEach((row) => {
    const id = row.dataset.id!;
    const s = items.find((x) => x.id === id)!;
    row.querySelector('[data-toggle]')!.addEventListener('click', async () => {
      try {
        Object.assign(s, await api.update(id, { enabled: !s.enabled }));
        track('schedule_toggled', { repo: s.repo, enabled: s.enabled });
        changed();
      } catch (e) { toast(esc((e as Error).message)); }
    });
    const run = row.querySelector<HTMLButtonElement>('[data-run]')!;
    run.addEventListener('click', async () => {
      run.disabled = true;
      try {
        const a = await api.run(id);
        toast(`<b>${esc(a.name)}</b> started in <b>${esc(s.repo)}</b>`);
        void load();
      } catch (e) { toast(esc((e as Error).message)); run.disabled = false; }
    });
    // Two taps to delete.
    const del = row.querySelector<HTMLButtonElement>('[data-del]')!;
    del.addEventListener('click', async () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap to confirm'; del.classList.add('danger'); return; }
      try { await api.remove(id); list = items.filter((x) => x.id !== id); changed(); } catch (e) { toast(esc((e as Error).message)); }
    });
  });
}

function drawAdd(el: HTMLElement, o: SchedulesAppOpts, m: Extract<Mode, { kind: 'add' }>) {
  const t = TEMPLATES.find((x) => x.id === m.tpl);
  const repos = o.repos();
  o.setBackHandler(() => { mode = { kind: 'list' }; changed(); return true; });
  el.innerHTML = `${o.header(t ? t.title : 'New schedule', 'A project lead works on this while you’re away')}
    <div class="pv-scroll"><form class="sc-form">
      <label>Project<select name="repo">${repos.map((r) => `<option ${r === m.repo ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label>Task<textarea name="task" data-keep="sc-task" placeholder="What should the agent do each time?">${esc(t?.task ?? '')}</textarea></label>
      <div class="sc-when">
        <label>How often<select name="cadence"><option value="daily" ${t?.cadence !== 'weekly' ? 'selected' : ''}>Every day</option><option value="weekly" ${t?.cadence === 'weekly' ? 'selected' : ''}>Every week</option></select></label>
        <label class="sc-day">Day<select name="weekday">${DAYS.map((d, i) => `<option value="${i}" ${i === (t?.weekday ?? 1) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>At<select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === (t?.hour ?? 2) ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
      </div>
      <button class="pbtn" type="submit">Turn on schedule</button>
      <button class="pbtn ghost" type="button" data-cancel>Cancel</button>
    </form>
    <p class="sc-note">Runs on this computer while OpenWorld's server is running. A run missed while it was off happens once when it starts again (if it was within 12 hours).</p></div>`;
  o.bindCommon();
  const f = el.querySelector<HTMLFormElement>('form')!;
  const day = f.querySelector<HTMLElement>('.sc-day')!;
  const cadence = f.elements.namedItem('cadence') as HTMLSelectElement;
  const syncDay = () => { day.style.display = cadence.value === 'weekly' ? '' : 'none'; };
  cadence.addEventListener('change', syncDay);
  syncDay();
  f.querySelector('[data-cancel]')!.addEventListener('click', () => { mode = { kind: 'list' }; changed(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const btn = f.querySelector<HTMLButtonElement>('[type=submit]')!;
    btn.disabled = true;
    try {
      const s = await api.create({
        repo: String(fd.get('repo')), task: String(fd.get('task')).trim(), cadence: fd.get('cadence') as Schedule['cadence'],
        hour: Number(fd.get('hour')), weekday: fd.get('cadence') === 'weekly' ? Number(fd.get('weekday')) : undefined,
      });
      track('schedule_created', { repo: s.repo, cadence: s.cadence, template: m.tpl ?? 'custom' });
      toast(`Scheduled: <b>${esc(s.repo)}</b> · ${esc(cadenceLabel(s))}`);
      list = [...(list ?? []), s];
      mode = { kind: 'list' };
      changed();
    } catch (err) {
      btn.disabled = false;
      toast(esc((err as Error).message));
    }
  });
}
