// "What I'm working on": when this computer has a clone of the repo whose building you're in, its
// current branch and the file you changed last, read from git. Looks in a few usual folders, or the
// ones in OPENWORLD_CODE_DIRS (separated like PATH). Read-only, cached, and never run on a clone whose
// origin isn't that repo.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Repo } from '../../shared/types.ts';
import { run } from '../config.ts';

const DEFAULT_DIRS = ['code', 'Code', 'src', 'dev', 'Developer', 'Projects', 'projects', 'repos', 'git', 'workspace', 'work', 'Documents/GitHub', 'Documents/code', ''];
const dirs = () => {
  const env = (process.env.OPENWORLD_CODE_DIRS ?? '').split(delimiter).map((s) => s.trim()).filter(Boolean);
  return env.length ? env.map((d) => d.replace(/^~(?=$|\/)/, homedir())) : DEFAULT_DIRS.map((d) => join(homedir(), d));
};

const git = (cwd: string, args: string[]) => run('git', ['-C', cwd, ...args], { timeoutMs: 4000 }).then((s) => s.trim());

const cloneCache = new Map<string, { at: number; path: string | null }>();
async function findClone(repo: Repo): Promise<string | null> {
  const hit = cloneCache.get(repo.fullName);
  if (hit && Date.now() - hit.at < (hit.path ? 300_000 : 60_000)) return hit.path;
  let found: string | null = null;
  const want = repo.fullName.toLowerCase();
  for (const d of dirs()) {
    const c = join(d, repo.name);
    if (!existsSync(join(c, '.git'))) continue;
    const origin = await git(c, ['remote', 'get-url', 'origin']).catch(() => '');
    const m = origin.toLowerCase().replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/);
    if (m?.[1] === want) { found = c; break; }
  }
  cloneCache.set(repo.fullName, { at: Date.now(), path: found });
  return found;
}

const workCache = new Map<string, { at: number; out: { branch: string | null; file: string | null } }>();

/** The branch checked out in the local clone and the file changed most recently (uncommitted first, else the last commit). */
export async function localWork(repo: Repo): Promise<{ branch: string | null; file: string | null }> {
  const hit = workCache.get(repo.fullName);
  if (hit && Date.now() - hit.at < 15_000) return hit.out;
  const out = { branch: null as string | null, file: null as string | null };
  try {
    const clone = await findClone(repo);
    if (clone) {
      out.branch = (await git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')) || null;
      const status = await git(clone, ['status', '--porcelain=v1', '--untracked-files=normal']).catch(() => '');
      let newest = 0;
      for (const line of status.split('\n').slice(0, 300)) {
        if (line.length < 4 || line[0] === 'D' || line[1] === 'D') continue;
        const path = line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '');
        if (path.endsWith('/')) continue;
        try {
          const t = statSync(join(clone, path)).mtimeMs;
          if (t > newest) { newest = t; out.file = path; }
        } catch { /* gone */ }
      }
      if (!out.file) out.file = (await git(clone, ['log', '-1', '--name-only', '--pretty=format:']).catch(() => '')).split('\n').find(Boolean) ?? null;
    }
  } catch { /* no git, no clone: nothing to share */ }
  workCache.set(repo.fullName, { at: Date.now(), out });
  return out;
}
