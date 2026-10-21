import { join } from 'node:path';
import type { Express } from 'express';
import type { AgentInfo, Schedule, ServerMsg } from '../shared/types.ts';
import { PATHS, readJson, writeJson, logEvent } from './config.ts';
import { findRepo } from './github.ts';
import { startAgent } from './agents.ts';

// Schedules: project leads that work while you're away. Each one starts a worker agent in its repo
// on a daily or weekly hour. Nothing is enabled until the boss turns it on.

const FILE = join(PATHS.home, 'schedules.json');
/** A run missed while the server was off still happens on startup if it was due this recently. */
const CATCH_UP_MS = 12 * 3600_000;

let schedules: Schedule[] = readJson<Schedule[]>(FILE, []);
let broadcast: (msg: ServerMsg) => void = () => {};
const starting = new Set<string>();

function save() {
  writeJson(FILE, schedules);
}

function changed(s: Schedule) {
  save();
  broadcast({ type: 'schedule:update', schedule: s });
}

function bad(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** Next local time at `hour` (and `weekday` for weekly) strictly after `from`. */
export function nextRun(s: Pick<Schedule, 'cadence' | 'hour' | 'weekday'>, from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(s.hour);
  if (d <= from) d.setDate(d.getDate() + 1);
  if (s.cadence === 'weekly') {
    const wd = s.weekday ?? 1;
    while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  }
  return d;
}

/** The most recent scheduled time at or before `now`. */
function lastDue(s: Schedule, now = new Date()): Date {
  const step = s.cadence === 'weekly' ? 7 : 1;
  const d = nextRun(s, new Date(now.getTime() - step * 86400_000));
  return d <= now ? d : new Date(d.getTime() - step * 86400_000);
}

function normalize(input: any, base?: Schedule): Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastAgentId' | 'nextRunAt'> {
  const cadence = input.cadence ?? base?.cadence ?? 'daily';
  if (cadence !== 'daily' && cadence !== 'weekly') throw bad('cadence must be daily or weekly');
  const hour = Number(input.hour ?? base?.hour ?? 2);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw bad('hour must be 0-23');
  const weekday = cadence === 'weekly' ? Number(input.weekday ?? base?.weekday ?? 1) : undefined;
  if (weekday != null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) throw bad('weekday must be 0-6');
  const task = String(input.task ?? base?.task ?? '').trim().slice(0, 4000);
  if (!task) throw bad('task is required');
  const repo = String(input.repo ?? base?.repo ?? '').trim();
  if (!repo) throw bad('repo is required');
  const enabled = input.enabled != null ? !!input.enabled : base?.enabled ?? true;
  return { repo, task, cadence, hour, weekday, enabled };
}

export function listSchedules(): Schedule[] {
  return [...schedules].sort((a, b) => (a.nextRunAt ?? '~').localeCompare(b.nextRunAt ?? '~'));
}

export async function createSchedule(input: any): Promise<Schedule> {
  const fields = normalize(input);
  const repo = await findRepo(fields.repo);
  const s: Schedule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    ...fields,
    repo: repo.name,
    lastRunAt: null,
    lastAgentId: null,
    nextRunAt: null,
    createdAt: new Date().toISOString(),
  };
  s.nextRunAt = s.enabled ? nextRun(s).toISOString() : null;
  schedules.push(s);
  changed(s);
  return s;
}

function find(id: string) {
  const s = schedules.find((x) => x.id === id);
  if (!s) throw bad(`Unknown schedule ${id}`, 404);
  return s;
}

export function updateSchedule(id: string, patch: any): Schedule {
  const s = find(id);
  Object.assign(s, normalize({ ...patch, repo: s.repo }, s));
  if (s.cadence === 'daily') delete s.weekday;
  s.nextRunAt = s.enabled ? nextRun(s).toISOString() : null;
  changed(s);
  return s;
}

export function deleteSchedule(id: string) {
  const s = find(id);
  schedules = schedules.filter((x) => x !== s);
  save();
  broadcast({ type: 'schedule:update', schedule: { ...s, enabled: false, nextRunAt: null } });
  return { ok: true };
}

export async function runSchedule(id: string): Promise<AgentInfo> {
  const s = find(id);
  if (starting.has(id)) throw bad('Already starting', 409);
  starting.add(id);
  try {
    const repo = await findRepo(s.repo);
    const info = await startAgent(repo, `${s.task}\n\n(Scheduled ${s.cadence} run from OpenWorld. Do not push or open PRs; leave changes for review.)`);
    // startAgent hands back the live info object, so this persists with the agent's next update.
    info.scheduleId = s.id;
    s.lastRunAt = new Date().toISOString();
    s.lastAgentId = info.id;
    s.nextRunAt = s.enabled ? nextRun(s).toISOString() : null;
    changed(s);
    logEvent('schedule_ran', { repo: s.repo });
    return info;
  } finally {
    starting.delete(id);
  }
}

async function tick(now = new Date()) {
  for (const s of schedules) {
    if (!s.enabled || !s.nextRunAt || new Date(s.nextRunAt) > now) continue;
    await runSchedule(s.id).catch((e) => console.warn(`Schedule ${s.id} (${s.repo}) failed:`, e.message));
  }
}

/** On startup: recompute next runs, and run once anything missed within the catch-up window. */
function catchUp(now = new Date()) {
  for (const s of schedules) {
    if (!s.enabled) {
      s.nextRunAt = null;
      continue;
    }
    const due = lastDue(s, now);
    const missed = now.getTime() - due.getTime() < CATCH_UP_MS && (!s.lastRunAt || new Date(s.lastRunAt) < due) && new Date(s.createdAt) < due;
    s.nextRunAt = missed ? now.toISOString() : nextRun(s, now).toISOString();
  }
  save();
}

export function registerSchedules(app: Express, bc: (msg: ServerMsg) => void) {
  broadcast = bc;
  app.get('/api/schedules', (_req, res) => {
    res.json(listSchedules());
  });
  app.post('/api/schedules', (req, res, next) => {
    createSchedule(req.body ?? {}).then((s) => res.json(s), next);
  });
  app.patch('/api/schedules/:id', (req, res, next) => {
    try { res.json(updateSchedule(String(req.params.id), req.body ?? {})); } catch (e) { next(e); }
  });
  app.delete('/api/schedules/:id', (req, res, next) => {
    try { res.json(deleteSchedule(String(req.params.id))); } catch (e) { next(e); }
  });
  app.post('/api/schedules/:id/run', (req, res, next) => {
    runSchedule(String(req.params.id)).then((a) => res.json(a), next);
  });
  catchUp();
  // Give GitHub a moment to answer the first repo list before catch-up runs start.
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), 60_000).unref();
}
