import { join } from 'node:path';
import type { BoardDecision, BoardMember, BoardMessage, Repo } from '../shared/types.ts';
import { PATHS, readJson, writeJson, logEvent } from './config.ts';
import { streamClaude } from './llm.ts';
import { repoWorkers } from './github.ts';

export const MEMBERS: BoardMember[] = [
  { id: 'chair', name: 'Eleanor Vance', role: 'Chair', color: '#c9a227' },
  { id: 'cto', name: 'Raj Mehta', role: 'CTO', color: '#3b82f6' },
  { id: 'product', name: 'Sofia Alvarez', role: 'Head of Product', color: '#10b981' },
  { id: 'design', name: 'Kenji Watanabe', role: 'Design Lead', color: '#ec4899' },
  { id: 'growth', name: 'Marcus Bell', role: 'Growth & Revenue', color: '#f97316' },
];

const FOCUS: Record<string, string> = {
  chair: 'You run the meeting, keep it crisp, weigh the arguments and make the call.',
  cto: 'You care about architecture, technical risk, maintenance cost and engineering effort.',
  product: 'You care about real users, the smallest scope that tests the idea (MVP), and validated learning.',
  design: 'You care about the user experience, clarity, accessibility and craft.',
  growth: 'You care about distribution, how users discover it, revenue, and actionable metrics.',
};

function storePath(repo: string) {
  return join(PATHS.boardroom, `${repo.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
}

export function listDecisions(repo: string): BoardDecision[] {
  return readJson<BoardDecision[]>(storePath(repo), []);
}

export type BoardEvent =
  | { type: 'turn'; memberId: string }
  | { type: 'delta'; memberId: string; delta: string }
  | { type: 'message'; message: BoardMessage }
  | { type: 'resolution'; text: string }
  | { type: 'done'; decision: BoardDecision };

export async function convene(repo: Repo, question: string, send: (e: BoardEvent) => void, signal?: AbortSignal): Promise<BoardDecision> {
  const { readme, workers } = await repoWorkers(repo).catch(() => ({ readme: '', workers: [] }));
  const prior = listDecisions(repo.name).slice(-3);
  const context = [
    `Company/project: ${repo.name}${repo.description ? ` — ${repo.description}` : ''}`,
    `Stats: ${repo.commits} commits, ${repo.prs} PRs, language ${repo.language ?? 'unknown'}${repo.homepageUrl ? `, live at ${repo.homepageUrl}` : ''}.`,
    readme ? `README excerpt:\n${readme.slice(0, 1800)}` : '',
    workers.length ? `Recent work:\n${workers.slice(0, 10).map((w) => `- ${w.title}`).join('\n')}` : '',
    prior.length ? `Earlier board decisions:\n${prior.map((d) => `- Q: ${d.question}\n  Decision: ${d.resolution.slice(0, 200)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const transcript: BoardMessage[] = [];
  const nameOf = (id: string) => MEMBERS.find((m) => m.id === id)!;
  const render = () =>
    transcript.map((m) => `${nameOf(m.memberId).name} (${nameOf(m.memberId).role}): ${m.text}`).join('\n\n');

  async function speak(memberId: string, instruction: string, wantStance: boolean): Promise<BoardMessage> {
    const m = nameOf(memberId);
    send({ type: 'turn', memberId });
    const system = `You are ${m.name}, ${m.role} on the board of "${repo.name}". ${FOCUS[memberId]} You are in a boardroom meeting inside an open-world city game, deciding a question for the founder. Speak in first person, naturally, like a sharp executive in a real meeting. No markdown headings, no bullet-point walls, no stage directions.`;
    const prompt = `${context}\n\nThe founder's question for the board: "${question}"\n\n${transcript.length ? `Meeting so far:\n\n${render()}\n\n` : ''}${instruction}${wantStance ? '\n\nEnd with a final separate line exactly like "STANCE: for", "STANCE: against" or "STANCE: neutral" (for = in favor of the proposal as asked).' : ''}`;
    let shown = '';
    let raw = '';
    const fallback = wantStance
      ? `From the ${m.role.toLowerCase()} side, I'd want to see the smallest version of this tested with real users before we commit more.\nSTANCE: neutral`
      : `Let's test the smallest version of "${question}" this week, measure one clear metric, and revisit next meeting.`;
    const text = await streamClaude({
      system,
      prompt,
      fallback,
      signal,
      onDelta: (d) => {
        raw += d;
        // hold back anything that might be the start of the STANCE line
        const cut = raw.search(/\n?\s*STANCE:/i);
        const visible = cut >= 0 ? raw.slice(0, cut) : raw.replace(/\n?\s*S?T?A?N?C?E?$/i, '');
        if (visible.length > shown.length) {
          send({ type: 'delta', memberId, delta: visible.slice(shown.length) });
          shown = visible;
        }
      },
    });
    const match = text.match(/STANCE:\s*(for|against|neutral)/i);
    const clean = text.replace(/\n?\s*STANCE:.*$/is, '').trim();
    if (clean.length > shown.length && clean.startsWith(shown)) send({ type: 'delta', memberId, delta: clean.slice(shown.length) });
    const msg: BoardMessage = { memberId, text: clean, stance: (match?.[1]?.toLowerCase() as BoardMessage['stance']) || 'neutral' };
    transcript.push(msg);
    send({ type: 'message', message: msg });
    return msg;
  }

  await speak('chair', 'Open the meeting: frame the question and what a good decision needs to weigh, in 2-3 sentences. Then hand the floor to the CTO.', false);
  const positions: BoardMessage[] = [];
  for (const id of ['cto', 'product', 'design', 'growth']) {
    positions.push(await speak(id, 'Give your position on the question in at most 70 words. Be specific to this project. Disagree with colleagues if you genuinely do.', true));
  }
  // rebuttal: the two members most at odds, or the first two if everyone agrees
  const against = positions.filter((p) => p.stance === 'against');
  const forr = positions.filter((p) => p.stance === 'for');
  const rebutters = against.length && forr.length ? [forr[0].memberId, against[0].memberId] : [positions[0].memberId, positions[1].memberId];
  for (const id of rebutters) {
    await speak(id, 'Respond directly to the point you most disagree with (or most want to sharpen) from a colleague, in at most 50 words.', true);
  }
  const resolution = await speak(
    'chair',
    'Close the meeting. State the board\'s decision in one or two sentences, then exactly three numbered next steps (short lines), the first being the smallest experiment and the metric that decides whether we continue.',
    false,
  );
  send({ type: 'resolution', text: resolution.text });

  const decision: BoardDecision = {
    id: Math.random().toString(36).slice(2, 10),
    repo: repo.name,
    question,
    messages: transcript,
    resolution: resolution.text,
    createdAt: new Date().toISOString(),
  };
  const all = listDecisions(repo.name);
  all.push(decision);
  writeJson(storePath(repo.name), all);
  logEvent('boardroom_decision', { repo: repo.name });
  send({ type: 'done', decision });
  return decision;
}
