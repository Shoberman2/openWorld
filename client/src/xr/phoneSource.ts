import type { AgentInfo, MasterMessage, OfficeMessage } from '../../../shared/types.ts';
import { api, masters, office, onLive } from '../api.ts';

/** One conversation on the wrist phone: HQ, or a project's master agent. */
export interface XrThread {
  id: string; // 'hq' or the repo name
  title: string;
  sub: string;
  unread: number;
  typing: boolean;
  messages: { me: boolean; who: string; text: string }[];
  /** Canned replies (there's no keyboard in VR). */
  replies: string[];
}

/** What the wrist phone shows and does. Kept small so another phone backend can stand in. */
export interface XrPhoneSource {
  threads(): XrThread[];
  /** Load a thread's history and mark it read. */
  open(id: string): void;
  send(id: string, text: string): void;
  agents(): AgentInfo[];
  stopAgent(id: string): void;
  /** Bumps whenever anything changes (cheap redraw check). */
  version(): number;
}

const HQ_REPLIES = ["What's everyone working on?", 'Any agents need my attention?', 'Give me a status report', 'Thanks, carry on'];
const MASTER_REPLIES = ["What's the latest here?", 'Any open problems?', 'Start on the most useful next thing. No PR.', 'How are your agents doing?', 'Open a PR for the finished work'];

/** The phone backed by the server's HQ (office) and project-master endpoints. */
export function apiPhoneSource(repos: () => string[], agents: () => Map<string, AgentInfo>): XrPhoneSource {
  let v = 0;
  const bump = () => { v++; };
  let hq: OfficeMessage[] = [];
  let hqTyping = false;
  const mm = new Map<string, MasterMessage[]>();
  const mUnread = new Map<string, number>();
  const mTyping = new Set<string>();
  const lastTs = new Map<string, string>();

  const upsertHq = (m: OfficeMessage) => {
    const i = hq.findIndex((x) => x.id === m.id);
    if (i >= 0) hq[i] = { ...hq[i], ...m }; else hq.push(m);
    bump();
  };
  const upsertMaster = (m: MasterMessage) => {
    const list = mm.get(m.repo) ?? [];
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list[i] = { ...list[i], ...m }; else list.push(m);
    mm.set(m.repo, list);
    lastTs.set(m.repo, m.ts);
    bump();
  };

  office.thread().then((t) => { hq = t.messages; bump(); }).catch(() => {});
  masters.list().then((r) => {
    for (const t of r.threads) { mUnread.set(t.repo, t.unread); if (t.last) { lastTs.set(t.repo, t.last.ts); if (!mm.has(t.repo)) mm.set(t.repo, [t.last]); } }
    bump();
  }).catch(() => {});
  onLive((msg) => {
    if (msg.type === 'office:message' && msg.message.channel === 'text') upsertHq(msg.message);
    else if (msg.type === 'office:typing' && msg.channel === 'text') { hqTyping = msg.on; bump(); }
    else if (msg.type === 'master:message') {
      upsertMaster(msg.message);
      if (msg.message.from !== 'me' && openId !== msg.repo) mUnread.set(msg.repo, (mUnread.get(msg.repo) ?? 0) + 1);
    } else if (msg.type === 'master:typing') { if (msg.on) mTyping.add(msg.repo); else mTyping.delete(msg.repo); bump(); }
    else if (msg.type === 'agent:update') bump();
  });

  let openId = '';
  const hqUnread = () => hq.filter((m) => m.channel === 'text' && m.from === 'hq' && !m.read).length;

  return {
    version: () => v,
    threads() {
      const out: XrThread[] = [{
        id: 'hq', title: 'HQ', sub: 'Runs every building', unread: hqUnread(), typing: hqTyping, replies: HQ_REPLIES,
        messages: hq.filter((m) => m.channel === 'text').map((m) => ({ me: m.from === 'me', who: m.from === 'me' ? 'You' : 'HQ', text: m.text })),
      }];
      const names = [...new Set([...repos(), ...mm.keys()])];
      names.sort((a, b) => (lastTs.get(b) ?? '').localeCompare(lastTs.get(a) ?? ''));
      for (const r of names) out.push({
        id: r, title: r, sub: 'Project lead', unread: mUnread.get(r) ?? 0, typing: mTyping.has(r), replies: MASTER_REPLIES,
        messages: (mm.get(r) ?? []).map((m) => ({ me: m.from === 'me', who: m.from === 'me' ? 'You' : m.from === 'hq' ? 'HQ' : 'Lead', text: m.text })),
      });
      return out;
    },
    open(id) {
      openId = id;
      if (id === 'hq') {
        if (hqUnread()) { for (const m of hq) if (m.channel === 'text') m.read = true; office.markRead('text').catch(() => {}); bump(); }
        return;
      }
      masters.thread(id).then((t) => { mm.set(id, t.messages); bump(); }).catch(() => {});
      if (mUnread.get(id)) { mUnread.set(id, 0); masters.markRead(id).catch(() => {}); bump(); }
    },
    send(id, text) {
      if (id === 'hq') {
        office.send({ channel: 'text', text }, (d) => { if (d.message) upsertHq(d.message); }).catch(() => {});
      } else {
        masters.send(id, text, (d) => { if (d.message) upsertMaster(d.message); }).catch(() => {});
      }
    },
    agents: () => [...agents().values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    stopAgent(id) { api.stopAgent(id).then(bump, () => {}); },
  };
}
