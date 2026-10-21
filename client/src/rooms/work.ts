// Work as things you can walk up to inside an HQ: a parcel for every open pull request, a crate for
// every agent run waiting on your review, and sticky notes for open issues on the work floor board.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PulseIssue, PulsePr } from '../../../shared/types.ts';
import { esc } from '../interact.ts';
import { canvas, texFrom, wrapText } from '../interiorArt.ts';
import { openPanel } from '../ui/panel.ts';

const FONT = 'Inter, system-ui, sans-serif';

/** Cardboard for people's PRs; Claude's clay with teal tape for anything an agent made. */
export type CrateKind = 'pr' | 'agent-pr' | 'review';

const CRATE_GEO = new RoundedBoxGeometry(0.56, 0.4, 0.44, 2, 0.02);
const TAPE_GEO = new THREE.BoxGeometry(0.1, 0.405, 0.445);
const TAG_GEO = new THREE.PlaneGeometry(0.42, 0.21);
const crateMats: Record<'card' | 'clay' | 'tapeBrown' | 'tapeTeal', THREE.MeshStandardMaterial> = {
  card: new THREE.MeshStandardMaterial({ color: 0xb58d5e, roughness: 0.92 }),
  clay: new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.75 }),
  tapeBrown: new THREE.MeshStandardMaterial({ color: 0x8a6538, roughness: 0.5 }),
  tapeTeal: new THREE.MeshStandardMaterial({ color: 0x2ee6c9, roughness: 0.4, emissive: 0x0d5a4f, emissiveIntensity: 0.6 }),
};

/** A shipping label: "#123" (or the agent's name) over the title. */
function tagTexture(head: string, title: string, kind: CrateKind) {
  const { c, g } = canvas(320, 160);
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, 320, 160);
  g.fillStyle = kind === 'pr' ? '#1f2328' : '#c15f3c';
  g.fillRect(0, 0, 320, 8);
  g.fillStyle = kind === 'review' ? '#0f766e' : '#1f2328';
  g.font = `800 40px ${FONT}`;
  g.fillText(head, 16, 52);
  if (kind !== 'pr') {
    g.fillStyle = '#0f766e';
    g.font = `700 18px ${FONT}`;
    g.fillText(kind === 'review' ? 'READY FOR REVIEW' : 'AI AGENT', 320 - 16 - g.measureText(kind === 'review' ? 'READY FOR REVIEW' : 'AI AGENT').width, 46);
  }
  g.fillStyle = '#3a3f45';
  g.font = `500 22px ${FONT}`;
  wrapText(g, title, 16, 88, 288, 28, 2);
  // a barcode
  g.fillStyle = '#1f2328';
  for (let x = 16, i = 0; x < 150; i++) { const w = 1 + ((i * 7) % 3); g.fillRect(x, 140, w, 12); x += w + 2; }
  return texFrom(c);
}

/** One parcel. The tag faces +z (out of its shelf), the group sits on y = 0. */
export function makeCrate(kind: CrateKind, head: string, title: string) {
  const g = new THREE.Group();
  const clay = kind !== 'pr';
  const body = new THREE.Mesh(CRATE_GEO, clay ? crateMats.clay : crateMats.card);
  body.position.y = 0.2;
  body.castShadow = body.receiveShadow = true;
  const tape = new THREE.Mesh(TAPE_GEO, clay ? crateMats.tapeTeal : crateMats.tapeBrown);
  tape.position.y = 0.2;
  const tex = tagTexture(head, title, kind);
  const tag = new THREE.Mesh(TAG_GEO, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  tag.position.set(0.0, 0.2, 0.223);
  g.add(body, tape, tag);
  g.userData.dispose = () => { tex.dispose(); (tag.material as THREE.Material).dispose(); };
  return g;
}

/** The parcel an agent carries down to the lobby. */
export function makeCarryBox() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(CRATE_GEO, crateMats.clay);
  const tape = new THREE.Mesh(TAPE_GEO, crateMats.tapeTeal);
  g.add(body, tape);
  g.scale.setScalar(0.82);
  return g;
}

const LABEL_COLORS: [RegExp, string][] = [
  [/bug|fix|crash|error|broken/i, '#ff9e8f'],
  [/feat|enhance|idea|feature/i, '#8fd3ff'],
  [/doc/i, '#c6f08a'],
  [/question|discuss|help/i, '#e2b8f2'],
  [/good first|easy|starter/i, '#9ff0c8'],
  [/urgent|critical|p0|security/i, '#ffb35c'],
];

/** The work-floor board: one sticky note per open issue, colored by its first meaningful label. */
export function drawIssueBoard(c: HTMLCanvasElement, repo: string, issues: PulseIssue[]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  // A white glass board on a light frame.
  g.fillStyle = '#f4f5f2';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d5d8d3';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = '#1f2328';
  g.font = `800 54px ${FONT}`;
  g.fillText('Open issues', 40, 76);
  const tw = g.measureText('Open issues').width;
  g.fillStyle = '#6b7280';
  g.font = `600 30px ${FONT}`;
  g.fillText(`${repo} · ${issues.length || 'none'}`, 40 + tw + 24, 74);
  if (!issues.length) {
    g.fillStyle = '#9ca3af';
    g.font = `500 36px ${FONT}`;
    g.fillText('Inbox zero. Nothing open on GitHub.', 40, H / 2);
    return;
  }
  const cols = 5, rows = 3, pad = 26, top = 110;
  const nw = (W - pad * (cols + 1)) / cols, nh = (H - top - pad * (rows + 1)) / rows;
  issues.slice(0, cols * rows).forEach((it, i) => {
    const x = pad + (i % cols) * (nw + pad), y = top + pad + Math.floor(i / cols) * (nh + pad);
    const color = LABEL_COLORS.find(([re]) => it.labels.some((l) => re.test(l)))?.[1] ?? '#fff08a';
    g.save();
    g.translate(x + nw / 2, y + nh / 2);
    g.rotate(((i * 37) % 7 - 3) * 0.006);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(-nw / 2 + 5, -nh / 2 + 7, nw, nh);
    g.fillStyle = color;
    g.fillRect(-nw / 2, -nh / 2, nw, nh);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(-nw / 2, -nh / 2, nw, 18);
    g.fillStyle = '#1f2328';
    g.font = `800 26px ${FONT}`;
    g.fillText(`#${it.number}`, -nw / 2 + 14, -nh / 2 + 50);
    g.font = `500 22px ${FONT}`;
    wrapText(g, it.title, -nw / 2 + 14, -nh / 2 + 84, nw - 28, 27, Math.floor((nh - 100) / 27));
    if (it.labels.length) {
      g.fillStyle = 'rgba(31,35,40,0.6)';
      g.font = `600 17px ${FONT}`;
      g.fillText(it.labels.slice(0, 2).join(' · ').slice(0, 26), -nw / 2 + 14, nh / 2 - 14);
    }
    g.restore();
  });
  if (issues.length > cols * rows) {
    g.fillStyle = '#6b7280';
    g.font = `600 26px ${FONT}`;
    g.fillText(`+${issues.length - cols * rows} more on GitHub`, W - 330, 74);
  }
}

/** A small hanging sign over the parcel shelf / review table. */
export function drawShelfSign(c: HTMLCanvasElement, title: string, sub: string, accent: string) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#16191e';
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.fillRect(0, H - 8, W, 8);
  g.fillStyle = '#f5f6f7';
  g.font = `800 46px ${FONT}`;
  g.fillText(title, 28, 62);
  g.fillStyle = '#9aa3ad';
  g.font = `600 26px ${FONT}`;
  g.fillText(sub, 28, 104);
}

function ago(iso: string) {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
}

/** The parcel shelf, up close: every open pull request, the one you picked first. */
export function openPrShelf(repo: string, prs: PulsePr[], first?: number) {
  const list = [...prs].sort((a, b) => (a.number === first ? -1 : b.number === first ? 1 : 0));
  const panel = openPanel({ title: 'Pull requests', subtitle: `${esc(repo)} · ${prs.length} open`, avatar: '⇄', color: '#4fd1ff' });
  panel.body.innerHTML = list.length
    ? list.map((p) => `
      <a class="pr-row" href="${esc(p.url)}" target="_blank" rel="noopener" style="display:block;padding:10px 12px;margin:6px 0;border-radius:10px;background:rgba(255,255,255,0.05);color:inherit;text-decoration:none${p.number === first ? ';outline:1px solid #4fd1ff' : ''}">
        <b>#${p.number}</b> ${esc(p.title)}${p.isDraft ? ' <span class="muted">draft</span>' : ''}
        <div class="muted" style="font-size:12px;margin-top:3px">${esc(p.author)}${p.isAgent ? ' · <span class="tag agent">AI agent</span>' : ''} · opened ${ago(p.createdAt)}</div>
      </a>`).join('')
    : '<p class="muted">No open pull requests. The shelf is empty.</p>';
  panel.footer.innerHTML = `<div style="flex:1"></div><button class="btn primary">Done</button>`;
  panel.footer.querySelector('button')!.addEventListener('click', () => panel.close());
  return panel;
}
