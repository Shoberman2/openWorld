import type { Repo, Worker } from '../../../shared/types.ts';
import type { GameCtx } from '../ctx.ts';
import { talk, track } from '../api.ts';
import { esc } from '../interact.ts';
import { chatUI, openPanel } from './panel.ts';
import { assignStrip } from './assign.ts';
import { openAgentLivePanel } from './agentPanel.ts';

export interface SpeechHooks {
  /** Called as the NPC's reply streams in, with the text so far. */
  onSpeak?(text: string): void;
  /** Called when the NPC stops talking (reply finished, errored, or panel closed). */
  onEnd?(): void;
}

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

/** Talk to a desk worker (a past PR/commit) or, with target 'reception', the lobby receptionist. */
export function openWorkerPanel(ctx: GameCtx, repo: Repo, target: Worker | 'reception', hooks: SpeechHooks = {}) {
  const isRec = target === 'reception';
  const w = isRec ? null : target;
  const who = isRec ? 'Reception' : w!.isAgent ? (w!.agentName ?? w!.author) : w!.author;
  const subtitle = isRec
    ? `${esc(repo.fullName)} · ${repo.commits} commits · ${repo.prs} PRs`
    : [
        `<span class="tag ${w!.state === 'committed' ? '' : w!.state}">${w!.kind === 'pr' ? `PR #${w!.number}` : `commit ${esc(w!.sha?.slice(0, 7) ?? '')}`} · ${w!.state}</span>`,
        w!.isAgent ? `<span class="tag agent">🤖 ${esc(w!.agentName ?? 'AI agent')}</span>` : '',
        `<span class="tag">+${w!.additions} −${w!.deletions}</span>`,
        `<span class="tag">${w!.changedFiles} files</span>`,
        `<span class="tag">${ago(w!.date)}</span>`,
      ].join('');
  const panel = openPanel({
    title: isRec ? `${repo.name} — Front desk` : w!.title,
    subtitle,
    avatar: isRec ? '🛎' : w!.isAgent ? '🤖' : who.slice(0, 1).toUpperCase(),
    color: isRec ? repo.brandColor : w!.isAgent ? '#3ddc97' : '#ffcc33',
  });

  if (w) {
    const meta = document.createElement('div');
    meta.className = 'worker-meta';
    meta.innerHTML = `
      <div class="who-line">${esc(w.author)}${w.isAgent && w.agentName && w.agentName !== w.author ? ` <small>with ${esc(w.agentName)}</small>` : ''}
        · <a href="${esc(w.url)}" target="_blank" rel="noopener">View on GitHub ↗</a></div>
      ${w.files.length ? `<details><summary>Changed files (${w.files.length})</summary><ul class="files">${w.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}`;
    panel.body.appendChild(meta);
  }

  // One step from a conversation to real work: type what should get done, Enter, and an agent takes a desk.
  panel.body.prepend(assignStrip(ctx, repo, isRec ? 'reception' : 'desk', {
    placeholder: isRec ? `What should get done in ${repo.name}?` : `Follow up on “${w!.title.slice(0, 60)}”: what should get done?`,
    onWatch: (a) => openAgentLivePanel(ctx, a),
  }));

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const abort = new AbortController();
  let speaking = false;
  const chat = chatUI(panel, isRec ? 'the receptionist' : who, (text) => {
    chat.addUser(text);
    history.push({ role: 'user', content: text });
    ask();
  });

  function ask() {
    const msg = chat.startNpc(isRec ? 'Receptionist' : who);
    speaking = true;
    let text = '';
    talk({ repo: repo.name, workerId: isRec ? 'reception' : w!.id, messages: history }, (d) => {
      if (d.delta) { text += d.delta; msg.append(d.delta); hooks.onSpeak?.(text); }
      if (d.error) msg.append(`\n[${d.error}]`);
    }, abort.signal)
      .catch((e) => { if (!abort.signal.aborted) msg.append(`\n[Couldn't reach them: ${e.message}]`); })
      .finally(() => {
        msg.finish();
        if (text) history.push({ role: 'assistant', content: text });
        speaking = false;
        hooks.onEnd?.();
      });
  }

  panel.onClose(() => {
    abort.abort();
    if (speaking) hooks.onEnd?.();
  });
  track('desk_talk', { repo: repo.name, worker: isRec ? 'reception' : w!.id, isAgent: !!w?.isAgent });
  ask();
  return panel;
}
