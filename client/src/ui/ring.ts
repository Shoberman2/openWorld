// Questions while you're away: when an agent gets blocked on a decision only you can make, your phone
// rings wherever you are (street, another city, a wingsuit). Answer inline; the agent picks back up.
import type { AgentInfo } from '../../../shared/types.ts';
import type { GameCtx } from '../ctx.ts';
import { api, onLive, track } from '../api.ts';
import { esc } from '../interact.ts';
import { toast } from './panel.ts';
import { openReview } from './review.ts';
import './work.css';

let audio: AudioContext | null = null;

/** A soft two-note chime, three times. Quiet on purpose: it's a nudge, not an alarm. */
function ringtone() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = 0.11;
    out.connect(ctx.destination);
    for (let r = 0; r < 3; r++) {
      for (const [i, f] of [[0, 1318.5], [1, 987.8]] as const) {
        const t = t0 + r * 1.1 + i * 0.16;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.55);
      }
    }
  } catch { /* no audio: the visual ring still shows */ }
}

/**
 * Watch for agents moving into needs_input and ring. One call card at a time; the rest queue behind it
 * ("+2 more waiting"). Returns a count of agents waiting on you, for badges.
 */
export function installRing(ctx: GameCtx, opts: { onChange?: () => void } = {}) {
  const queue: string[] = []; // agent ids with a question, oldest first
  const dismissed = new Set<string>(); // "Later": don't ring again for the same question
  let card: HTMLDivElement | null = null;
  let showing: string | null = null;

  const waiting = () => [...ctx.agents.values()].filter((a) => a.status === 'needs_input');

  function show(a: AgentInfo, ring: boolean) {
    showing = a.id;
    card?.remove();
    card = document.createElement('div');
    card.className = `agent-call${ring ? ' ringing' : ''}`;
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-label', `${a.name} has a question`);
    const more = queue.filter((id) => id !== a.id).length;
    card.innerHTML = `
      <div class="ac-who"><span class="ac-av">${esc(a.name.replace(/^Agent\s+/, '').slice(0, 2))}</span>
        <div><b>${esc(a.name)} · ${esc(a.repo)}</b><small>${ring ? 'is calling with a question' : 'has a question'}</small></div>
        <button class="ac-x" title="Later" aria-label="Later">✕</button></div>
      <p class="ac-q">${esc(a.question ?? 'Can you take a look?')}</p>
      <form><input type="text" placeholder="Answer ${esc(a.name.replace(/^Agent\s+/, ''))}…" maxlength="4000" /><button class="btn primary" type="submit">Answer</button></form>
      <div class="ac-foot"><button type="button" data-open>Open review</button><button type="button" data-later>Later</button>${more ? `<span class="ac-more">+${more} more waiting</span>` : ''}</div>`;
    document.body.appendChild(card);
    const input = card.querySelector('input')!;
    const send = card.querySelector<HTMLButtonElement>('form button')!;
    input.addEventListener('keydown', (e) => e.stopPropagation());
    card.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const next = await api.answerAgent(a.id, text);
        ctx.agents.set(next.id, next);
        track('question_answered', { repo: a.repo, via: 'call' });
        toast(`<b>${esc(a.name)}</b> got your answer and is back at work`);
        resolve(a.id);
      } catch (err) {
        send.disabled = false;
        send.textContent = 'Answer';
        toast(`Couldn't answer: ${esc((err as Error).message)}`, 7000);
      }
    });
    const later = () => { dismissed.add(key(a)); resolve(a.id); };
    card.querySelector('.ac-x')!.addEventListener('click', later);
    card.querySelector('[data-later]')!.addEventListener('click', later);
    card.querySelector('[data-open]')!.addEventListener('click', () => { const id = a.id; resolve(id); openReview(id); });
    if (ring) {
      ringtone();
      const tab = document.getElementById('phone-tab');
      tab?.classList.remove('ringing');
      void tab?.offsetWidth;
      tab?.classList.add('ringing');
      navigator.vibrate?.([180, 120, 180]);
    }
  }

  const key = (a: AgentInfo) => `${a.id}:${a.question ?? ''}`;

  function resolve(id: string) {
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    if (showing === id) { card?.remove(); card = null; showing = null; }
    const next = queue.map((x) => ctx.agents.get(x)).find((x) => x && x.status === 'needs_input');
    if (next) show(next, false);
    opts.onChange?.();
  }

  function consider(a: AgentInfo, ring: boolean) {
    if (a.status !== 'needs_input') {
      if (queue.includes(a.id)) resolve(a.id);
      return;
    }
    if (dismissed.has(key(a))) return;
    if (!queue.includes(a.id)) queue.push(a.id);
    // The current card is for this agent: refresh it only if the question changed.
    if (showing === a.id) return;
    if (!showing) show(a, ring);
    else if (card) { const m = card.querySelector('.ac-more'); if (m) m.textContent = `+${queue.length - 1} more waiting`; else show(ctx.agents.get(showing) ?? a, false); }
    opts.onChange?.();
  }

  // Our own memory of each agent's last status (ctx.agents may already be updated by another listener).
  const last = new Map<string, string>();
  onLive((msg) => {
    if (msg.type !== 'agent:update') return;
    const prev = last.get(msg.agent.id);
    last.set(msg.agent.id, msg.agent.status);
    ctx.agents.set(msg.agent.id, msg.agent);
    consider(msg.agent, prev !== 'needs_input');
  });
  // Questions that came in while the game was closed: show them (no ring) once the world is up.
  setTimeout(() => api.agents().then((list) => {
    for (const a of list) { if (!ctx.agents.has(a.id)) ctx.agents.set(a.id, a); if (!last.has(a.id)) last.set(a.id, a.status); }
    for (const a of list.filter((x) => x.status === 'needs_input').reverse()) consider(a, false);
  }).catch(() => {}), 2500);

  return { waiting, count: () => waiting().length };
}
