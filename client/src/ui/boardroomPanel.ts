import type { BoardDecision, BoardMessage, Repo, RepoDetail } from '../../../shared/types.ts';
import type { GameCtx } from '../ctx.ts';
import { boardroom, track } from '../api.ts';
import { esc } from '../interact.ts';
import { openPanel } from './panel.ts';

export const BOARD = [
  { id: 'chair', name: 'Avery', role: 'Chair', color: '#ffcc33' },
  { id: 'cto', name: 'Ravi', role: 'CTO', color: '#4fd1ff' },
  { id: 'product', name: 'Maya', role: 'Head of Product', color: '#a78bfa' },
  { id: 'design', name: 'Jun', role: 'Design Lead', color: '#ff7eb6' },
  { id: 'growth', name: 'Sofia', role: 'Growth & Revenue', color: '#3ddc97' },
] as const;

export const member = (id: string) => BOARD.find((m) => m.id === id) ?? { id, name: id, role: '', color: '#9aa6b8' };

export interface BoardHooks {
  onTurn?(memberId: string): void;
  onDelta?(memberId: string, textSoFar: string): void;
  onMessage?(msg: BoardMessage): void;
  onEnd?(): void;
}

function suggestions(repo: Repo) {
  return [
    `What is the single most important thing to build next for ${repo.name}?`,
    'Should we charge for this? If so, how?',
    'Pivot or persevere — is this project working?',
    'What should we cut so we can ship this week?',
    `Should ${repo.name} be open-sourced?`,
  ];
}

function msgHtml(m: { memberId: string; text: string; stance?: string }, typing = false) {
  const mem = member(m.memberId);
  const stance = m.stance && m.memberId !== 'chair' ? `<span class="stance stance-${m.stance}">${m.stance}</span>` : '';
  return `<div class="msg npc board-msg${typing ? ' typing' : ''}" data-member="${esc(m.memberId)}" style="border-left:3px solid ${mem.color}">
    <span class="who" style="color:${mem.color}">${esc(mem.name)} · ${esc(mem.role)} ${stance}</span><span class="t">${esc(m.text)}</span></div>`;
}

export function openBoardroomPanel(ctx: GameCtx, repo: Repo, detail: RepoDetail | null, hooks: BoardHooks = {}) {
  void ctx;
  const decisions: BoardDecision[] = [...(detail?.decisions ?? [])];
  const panel = openPanel({ title: 'Boardroom', subtitle: `${esc(repo.name)} · ${BOARD.length} members · ${decisions.length} past decisions`, avatar: '⚖', color: '#ffcc33', wide: true });
  const abort = new AbortController();
  let running = false;

  function home() {
    panel.body.innerHTML = `
      <div class="board-members">${BOARD.map((m) => `<span class="member" style="--c:${m.color}"><b>${m.name}</b> ${m.role}</span>`).join('')}</div>
      <div class="section-title">Put a decision to the board</div>
      <textarea class="q" placeholder="e.g. Should we launch on Product Hunt next week or keep polishing?"></textarea>
      <div class="chips">${suggestions(repo).map((s) => `<button class="chip">${esc(s)}</button>`).join('')}</div>
      ${decisions.length ? `<div class="section-title">Past decisions</div>${[...decisions].reverse().map((d) => `
        <button class="list-item" data-id="${esc(d.id)}">${esc(d.question)}<small>${esc(new Date(d.createdAt).toLocaleDateString())} · ${esc(d.resolution.slice(0, 140))}${d.resolution.length > 140 ? '…' : ''}</small></button>`).join('')}` : ''}`;
    const ta = panel.body.querySelector<HTMLTextAreaElement>('.q')!;
    panel.body.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', () => { ta.value = b.textContent ?? ''; ta.focus(); }));
    panel.body.querySelectorAll<HTMLButtonElement>('.list-item').forEach((b) => b.addEventListener('click', () => {
      const d = decisions.find((x) => x.id === b.dataset.id);
      if (d) showDecision(d);
    }));
    panel.footer.innerHTML = `<div style="flex:1"></div><button class="btn primary">Convene the board</button>`;
    panel.footer.querySelector('button')!.addEventListener('click', () => {
      const q = ta.value.trim();
      if (q) convene(q); else ta.focus();
    });
    setTimeout(() => ta.focus(), 50);
  }

  function showDecision(d: BoardDecision) {
    panel.body.innerHTML = `<div class="question">“${esc(d.question)}”</div>${d.messages.map((m) => msgHtml(m)).join('')}
      <div class="resolution"><div class="section-title">Resolution</div>${esc(d.resolution)}</div>`;
    panel.footer.innerHTML = `<button class="btn">← Back</button>`;
    panel.footer.querySelector('button')!.addEventListener('click', home);
  }

  function convene(question: string) {
    running = true;
    track('boardroom_convened', { repo: repo.name });
    panel.body.innerHTML = `<div class="question">“${esc(question)}”</div><div class="debate"></div>`;
    panel.footer.innerHTML = `<span class="muted" style="align-self:center">The board is in session…</span>`;
    const debate = panel.body.querySelector<HTMLDivElement>('.debate')!;
    let cur: { id: string; el: HTMLElement; text: string } | null = null;
    const scroll = () => { panel.body.scrollTop = panel.body.scrollHeight; };

    boardroom({ repo: repo.name, question }, (d) => {
      if (d.type === 'turn') {
        debate.insertAdjacentHTML('beforeend', msgHtml({ memberId: d.memberId, text: '' }, true));
        cur = { id: d.memberId, el: debate.lastElementChild as HTMLElement, text: '' };
        hooks.onTurn?.(d.memberId);
        scroll();
      } else if (d.type === 'delta') {
        if (!cur || cur.id !== d.memberId) {
          debate.insertAdjacentHTML('beforeend', msgHtml({ memberId: d.memberId, text: '' }, true));
          cur = { id: d.memberId, el: debate.lastElementChild as HTMLElement, text: '' };
        }
        cur.text += d.delta;
        // Hide the trailing STANCE: line while it streams.
        cur.el.querySelector('.t')!.textContent = cur.text.replace(/\n?\s*STANCE:.*$/is, '');
        hooks.onDelta?.(d.memberId, cur.text.replace(/\n?\s*STANCE:.*$/is, ''));
        scroll();
      } else if (d.type === 'message') {
        const m = d.message as BoardMessage;
        const html = msgHtml(m);
        if (cur && cur.id === m.memberId) cur.el.outerHTML = html; else debate.insertAdjacentHTML('beforeend', html);
        cur = null;
        hooks.onMessage?.(m);
        scroll();
      } else if (d.type === 'resolution') {
        debate.insertAdjacentHTML('beforeend', `<div class="resolution"><div class="section-title">Resolution — ${esc(member('chair').name)}, Chair</div>${esc(d.text)}</div>`);
        if (cur) { cur.el.remove(); cur = null; }
        scroll();
      } else if (d.type === 'done') {
        if (d.decision) decisions.push(d.decision as BoardDecision);
      } else if (d.type === 'error' || d.error) {
        debate.insertAdjacentHTML('beforeend', `<div class="ev err">The meeting was interrupted: ${esc(d.error ?? d.message ?? 'unknown error')}</div>`);
      }
    }, abort.signal)
      .catch((e) => { if (!abort.signal.aborted) debate.insertAdjacentHTML('beforeend', `<div class="ev err">The meeting was interrupted: ${esc(e.message)}</div>`); })
      .finally(() => {
        running = false;
        debate.querySelectorAll('.typing').forEach((el) => el.classList.remove('typing'));
        hooks.onEnd?.();
        if (abort.signal.aborted) return;
        panel.footer.innerHTML = `<button class="btn">← New question</button>`;
        panel.footer.querySelector('button')!.addEventListener('click', home);
      });
  }

  panel.onClose(() => { abort.abort(); if (running) hooks.onEnd?.(); });
  home();
  return panel;
}
