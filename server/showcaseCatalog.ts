// The public city: famous open-source projects that fill the world until you connect your own GitHub
// (or when you switch them on in Settings). Only what never changes lives here: where the project is,
// one line about it, its brand color and a rough size. Stars, commits, pull requests, language and
// recent work are read live from GitHub's public API and cached (see showcase.ts).
import type { Tier } from '../shared/types.ts';

export interface ShowcaseEntry {
  /** The name on the building ("VS Code"). Also its key in the API, like a repo name. */
  label: string;
  owner: string;
  repo: string;
  description: string;
  brandColor: string;
  tier: Tier;
  /**
   * Where the logo comes from. Most projects live in an organization whose GitHub picture is the logo;
   * for the rest (a person's account, a parent company) this is the project's own site, whose icon is used.
   */
  site?: string;
}

const e = (label: string, full: string, tier: Tier, brandColor: string, description: string, site?: string): ShowcaseEntry => {
  const [owner, repo] = full.split('/');
  return { label, owner, repo, description, brandColor, tier, site };
};

export const SHOWCASE: ShowcaseEntry[] = [
  e('Linux', 'torvalds/linux', 'landmark', '#f5c211', 'The Linux kernel.', 'https://www.kernel.org'),
  e('React', 'facebook/react', 'landmark', '#61dafb', 'The library for web and native user interfaces.', 'https://react.dev'),
  e('VS Code', 'microsoft/vscode', 'landmark', '#007acc', 'The Visual Studio Code editor.', 'https://code.visualstudio.com'),
  e('Python', 'python/cpython', 'landmark', '#3776ab', 'The Python programming language.'),
  e('Kubernetes', 'kubernetes/kubernetes', 'landmark', '#326ce5', 'Runs and scales containers across many machines.'),

  e('Rust', 'rust-lang/rust', 'tower', '#ce412b', 'A language for reliable and fast software.'),
  e('Node.js', 'nodejs/node', 'tower', '#5fa04e', 'JavaScript outside the browser.'),
  e('Go', 'golang/go', 'tower', '#00add8', 'The Go programming language.'),
  e('TypeScript', 'microsoft/TypeScript', 'tower', '#3178c6', 'JavaScript with types.', 'https://www.typescriptlang.org'),
  e('TensorFlow', 'tensorflow/tensorflow', 'tower', '#ff6f00', 'A machine learning framework for everyone.'),
  e('PyTorch', 'pytorch/pytorch', 'tower', '#ee4c2c', 'Tensors and neural networks in Python.'),
  e('three.js', 'mrdoob/three.js', 'tower', '#049ef4', 'The JavaScript 3D library this world is drawn with.', 'https://threejs.org'),
  e('Next.js', 'vercel/next.js', 'tower', '#111111', 'The React framework.', 'https://nextjs.org'),
  e('Flutter', 'flutter/flutter', 'tower', '#02569b', 'One codebase for mobile, web and desktop apps.'),

  e('Vue', 'vuejs/core', 'midrise', '#42b883', 'The progressive JavaScript framework.'),
  e('Svelte', 'sveltejs/svelte', 'midrise', '#ff3e00', 'Web development for the rest of us.'),
  e('Angular', 'angular/angular', 'midrise', '#dd0031', 'The web development framework from Google.'),
  e('Django', 'django/django', 'midrise', '#0c4b33', 'The web framework for perfectionists with deadlines.'),
  e('Rails', 'rails/rails', 'midrise', '#cc0000', 'Ruby on Rails.'),
  e('Swift', 'swiftlang/swift', 'midrise', '#f05138', 'The Swift programming language.'),
  e('Git', 'git/git', 'midrise', '#f05032', 'The version control system behind every building here.'),
  e('PostgreSQL', 'postgres/postgres', 'midrise', '#336791', 'The open-source relational database.'),
  e('Redis', 'redis/redis', 'midrise', '#d82c20', 'An in-memory data store.'),
  e('Godot', 'godotengine/godot', 'midrise', '#478cbf', 'A 2D and 3D game engine.'),
  e('Blender', 'blender/blender', 'midrise', '#ea7600', 'The free 3D creation suite.'),
  e('Home Assistant', 'home-assistant/core', 'midrise', '#18bcf2', 'Home automation that runs locally.'),

  e('Vite', 'vitejs/vite', 'small', '#ffc517', 'Fast frontend build tooling.'),
  e('Tailwind CSS', 'tailwindlabs/tailwindcss', 'small', '#38bdf8', 'A utility-first CSS framework.'),
  e('Deno', 'denoland/deno', 'small', '#70ffaf', 'A modern runtime for JavaScript and TypeScript.'),
  e('Zig', 'ziglang/zig', 'small', '#f7a41d', 'A general-purpose programming language and toolchain.'),
  e('Neovim', 'neovim/neovim', 'small', '#57a143', 'Vim, refactored for extensibility.'),
  e('curl', 'curl/curl', 'small', '#073551', 'The command line tool for transferring data with URLs.'),
  e('Ollama', 'ollama/ollama', 'small', '#444444', 'Run language models on your own computer.'),
  e('Bitcoin', 'bitcoin/bitcoin', 'small', '#f7931a', 'Bitcoin Core.'),
];

/** What every write on a showcase building answers with (agents, PRs, schedules, leads, HQ dispatch). */
export const SHOWCASE_REFUSAL = "This is a public project you're visiting. Connect GitHub to see your own.";

const norm = (s: string) => s.trim().toLowerCase();

/** A showcase project by the name on its building, or by owner/repo. */
export function showcaseEntry(name: string): ShowcaseEntry | null {
  const n = norm(name);
  return SHOWCASE.find((x) => norm(x.label) === n || `${x.owner}/${x.repo}`.toLowerCase() === n) ?? null;
}
