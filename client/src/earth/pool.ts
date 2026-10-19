// A small pool of chunk workers with a priority queue (nearest chunks first; stale requests dropped).
import type { ChunkJob, ChunkOut } from './build/types.ts';
import type { FarJob, FarOut } from './build/far.ts';

type Job =
  | { kind: 'chunk'; job: ChunkJob; prio: () => number; resolve: (o: ChunkOut) => void; reject: (e: Error) => void; wanted: () => boolean }
  | { kind: 'far'; job: FarJob; prio: () => number; resolve: (o: FarOut) => void; reject: (e: Error) => void; wanted: () => boolean };

export class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private elevIds = new Set<number>();
  busy = 0;

  constructor(n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.done(w, e.data);
      w.onerror = (e) => console.error('chunk worker error', e.message);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get queued() { return this.queue.length; }

  chunk(job: Omit<ChunkJob, 'id'>, prio: () => number, wanted: () => boolean = () => true) {
    return new Promise<ChunkOut>((resolve, reject) => {
      this.queue.push({ kind: 'chunk', job: { ...job, id: this.nextId++ }, prio, resolve, reject, wanted });
      this.pump();
    });
  }

  far(job: Omit<FarJob, 'id'>, prio: () => number, wanted: () => boolean = () => true) {
    return new Promise<FarOut>((resolve, reject) => {
      this.queue.push({ kind: 'far', job: { ...job, id: this.nextId++ }, prio, resolve, reject, wanted });
      this.pump();
    });
  }

  /** Ground elevation (meters above sea level) at a mercator point. */
  elev(mx: number, my: number) {
    // Workers handle messages concurrently, so this can ride along with whatever a worker is doing.
    const id = this.nextId++;
    return new Promise<number>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.elevIds.add(id);
      this.workers[id % this.workers.length].postMessage({ type: 'elev', id, mx, my });
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      // Drop requests nobody wants anymore, then take the most urgent.
      this.queue = this.queue.filter((j) => {
        if (j.wanted()) return true;
        j.reject(new Error('cancelled'));
        return false;
      });
      if (!this.queue.length) return;
      let bi = 0, bp = Infinity;
      this.queue.forEach((j, i) => { const p = j.prio(); if (p < bp) { bp = p; bi = i; } });
      const j = this.queue.splice(bi, 1)[0];
      const w = this.idle.pop()!;
      this.busy++;
      this.pending.set(j.job.id, { resolve: j.resolve as (v: never) => void, reject: j.reject });
      w.postMessage({ type: j.kind, job: j.job });
    }
  }

  private done(w: Worker, msg: { type: string; out?: { id: number }; id?: number; h?: number; error?: string }) {
    const id = msg.out?.id ?? msg.id!;
    const p = this.pending.get(id);
    this.pending.delete(id);
    const wasElev = this.elevIds.delete(id);
    if (!wasElev) {
      this.busy--;
      if (!this.idle.includes(w)) this.idle.push(w);
    }
    if (msg.type === 'error') p?.reject(new Error(msg.error));
    else if (msg.type === 'elev') p?.resolve(msg.h as never);
    else p?.resolve(msg.out as never);
    this.pump();
  }

  dispose() { for (const w of this.workers) w.terminate(); this.workers = []; this.idle = []; }
}
