import type { Repo } from '../../../shared/types.ts';
import type { RepoSite } from '../city/layout.ts';
import { openPanel } from './panel.ts';
import { esc } from '../interact.ts';

const TIER_LABEL = { landmark: 'Skyscraper', tower: 'Tower', midrise: 'Mid-rise', small: 'Storefront' } as const;

/** Tab: every project HQ in the city — set a waypoint or fast-travel to its door. */
export function openDirectory(sites: RepoSite[], agentsByRepo: Map<string, number>, cityName: string, actions: { waypoint(s: RepoSite): void; travel(s: RepoSite): void }) {
  const panel = openPanel({ title: 'City Directory', subtitle: `${sites.length} project headquarters in ${esc(cityName)}`, avatar: '⌘' });
  panel.footer.innerHTML = `<input type="text" placeholder="Search projects…" />`;
  const input = panel.footer.querySelector('input')!;
  const render = () => {
    const q = input.value.toLowerCase();
    panel.body.innerHTML = '';
    for (const s of sites) {
      const r: Repo = s.repo;
      if (q && !`${r.name} ${r.description} ${r.language}`.toLowerCase().includes(q)) continue;
      const n = agentsByRepo.get(r.name) ?? 0;
      const row = document.createElement('div');
      row.className = 'list-item';
      row.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center">
          <span style="width:12px;height:12px;border-radius:3px;background:${esc(r.brandColor)}"></span>
          <b style="flex:1">${esc(r.name)}</b>
          ${n ? `<span class="tag agent">${n} agent${n > 1 ? 's' : ''} working</span>` : ''}
          <span class="tag">${TIER_LABEL[r.tier]}</span>
        </div>
        <small>${esc(r.description || r.language || '')} · ${r.commits} commits · ${r.prs} PRs</small>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn" data-a="wp">Set waypoint</button>
          <button class="btn primary" data-a="go">Fast travel</button>
        </div>`;
      row.querySelector('[data-a=wp]')!.addEventListener('click', () => { actions.waypoint(s); panel.close(); });
      row.querySelector('[data-a=go]')!.addEventListener('click', () => { actions.travel(s); panel.close(); });
      panel.body.appendChild(row);
    }
  };
  input.addEventListener('input', render);
  render();
  setTimeout(() => input.focus(), 50);
  return panel;
}
