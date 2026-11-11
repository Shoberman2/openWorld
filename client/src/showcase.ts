// The public city, client side: famous open-source projects fill the world until you connect your own
// GitHub (or when you switch them on in Settings). You can walk in, read and talk; anything that would
// change the project (agents, pull requests, the boardroom) explains that you are only visiting.
import type { Repo } from '../../shared/types.ts';
import { api, track } from './api.ts';
import { esc } from './interact.ts';
import { openPanel } from './ui/panel.ts';
import { openSettings } from './ui/settings.ts';

export const VISITING = "This is a public project you're visiting. Connect GitHub to see your own.";

/** The showcase projects for this session: none when it's off, the server is old or GitHub is slow. */
export const loadShowcase = () => api.showcase().catch(() => ({ on: false, connected: false, repos: [] as Repo[] }));

/** What a showcase building is called on its door, the map and the directory. */
export const visitWord = (r: Repo) => `Public project · ${r.fullName}`;

/** Open Settings on the GitHub section, and count it for the showcase experiment. */
export function connectGitHub(from: string) {
  track('showcase_connect_clicked', { from });
  openSettings('agents');
}

/** A row that takes the place of "hand off a task" in a showcase building. */
export function visitingStrip(from: string) {
  const el = document.createElement('div');
  el.className = 'assign-strip visiting-strip';
  el.innerHTML = `<span class="as-label">Visiting</span><span class="vs-text">${esc(VISITING)}</span>
    <button class="btn primary" type="button">Connect GitHub</button>`;
  el.querySelector('button')!.addEventListener('click', () => connectGitHub(from));
  return el;
}

/** Shown where your own buildings would start work: the hiring kiosk, the boardroom. */
export function openVisitingPanel(repo: Repo, what: string, from: string) {
  const panel = openPanel({ title: what, subtitle: esc(visitWord(repo)), avatar: repo.name.slice(0, 1).toUpperCase(), color: repo.brandColor });
  panel.body.innerHTML = `<div class="visiting-note">
      <p><b>${esc(VISITING)}</b></p>
      <p>${esc(repo.name)} belongs to the people who build it, so nothing here can change it. Talk to reception and the people at the desks about their recent work.</p>
      <p>In your own buildings this is where ${esc(what === 'The boardroom' ? 'the board debates your decisions' : 'you hire a coding agent and watch it work')}.</p>
      <button class="btn primary" type="button">Connect GitHub</button>
    </div>`;
  panel.body.querySelector('button')!.addEventListener('click', () => connectGitHub(from));
  return panel;
}
