// Assign work in one step: "What should get done?" → an agent starts in that repo and takes a desk.
import type { AgentInfo, Repo } from '../../../shared/types.ts';
import type { GameCtx } from '../ctx.ts';
import { api, track } from '../api.ts';
import { esc } from '../interact.ts';
import { toast } from './panel.ts';
import './work.css';

export type AssignFrom = 'desk' | 'reception' | 'kiosk' | 'lab-desk' | 'phone' | 'lead';

/** Start an agent on `task` in `repo`, with clear feedback about where it went. */
export async function assignTask(ctx: GameCtx, repo: Repo, task: string, from: AssignFrom, onWatch?: (a: AgentInfo) => void): Promise<AgentInfo> {
  const a = await api.startAgent(repo.name, task);
  ctx.agents.set(a.id, a);
  track('agent_assigned', { from, repo: repo.name, taskLen: task.length });
  track('agent_started', { repo: repo.name, taskLen: task.length, via: from });
  const t = toast(`<b>${esc(a.name)}</b> is taking a desk in the ${esc(repo.name)} Agent Lab (floor 3).${onWatch ? ' <u>Watch</u>' : ''}`, 7000);
  if (onWatch) { t.style.cursor = 'pointer'; t.style.pointerEvents = 'auto'; t.addEventListener('click', () => { t.remove(); onWatch(a); }); }
  return a;
}

/**
 * A one-line "hand off a task" bar: type, Enter, done. Used on desk conversations and the receptionist.
 * Shows the result inline instead of navigating away, so the conversation can carry on.
 */
export function assignStrip(ctx: GameCtx, repo: Repo, from: AssignFrom, opts: { placeholder?: string; onLaunched?: (a: AgentInfo) => void; onWatch?: (a: AgentInfo) => void } = {}) {
  const el = document.createElement('form');
  el.className = 'assign-strip';
  el.innerHTML = `<span class="as-label">Hand off a task</span>
    <input type="text" maxlength="2000" placeholder="${esc(opts.placeholder ?? `What should get done in ${repo.name}?`)}" />
    <button class="btn primary" type="submit">Assign</button>
    <div class="as-done hidden"></div>`;
  const input = el.querySelector('input')!;
  const btn = el.querySelector('button')!;
  const done = el.querySelector<HTMLDivElement>('.as-done')!;
  // Keys typed here mustn't reach the game (WASD etc.) or the chat box's Enter handler.
  input.addEventListener('keydown', (e) => e.stopPropagation());
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (!task || btn.disabled) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Assigning…';
    try {
      const a = await assignTask(ctx, repo, task, from, opts.onWatch);
      input.value = '';
      done.innerHTML = `✓ <b>${esc(a.name)}</b> is on it at a desk in the Agent Lab.${opts.onWatch ? ' <button type="button" class="as-watch">Watch</button>' : ''}`;
      done.querySelector('.as-watch')?.addEventListener('click', () => opts.onWatch!(a));
      opts.onLaunched?.(a);
    } catch (err) {
      done.innerHTML = `<span class="bad">Couldn't start an agent: ${esc((err as Error).message)}</span>`;
    }
    done.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Assign';
  });
  return el;
}
