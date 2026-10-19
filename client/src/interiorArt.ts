import * as THREE from 'three';
import type { AgentInfo, BoardDecision, Repo, Worker } from '../../shared/types.ts';

// Canvas-drawn textures for the office interior: screens, signs, logo wall, floors, skyline.

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

export function texFrom(c: HTMLCanvasElement, repeat?: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(test).width > maxW && line) {
      n++;
      if (n >= maxLines) { g.fillText(fit(g, `${line}…`, maxW), x, y); return y + lineH; }
      g.fillText(line, x, y);
      y += lineH;
      line = words[i];
    } else line = test;
  }
  if (line) { g.fillText(fit(g, line, maxW), x, y); y += lineH; }
  return y;
}

function fit(g: CanvasRenderingContext2D, s: string, maxW: number) {
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

const FONT = 'Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// ---------- Floors ----------

export function marbleTexture() {
  const { c, g } = canvas(1024, 1024);
  const r = rng(7);
  g.fillStyle = '#e7e4de';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 226 + Math.floor(r() * 18);
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(i * 256, j * 256, 256, 256);
  }
  g.globalAlpha = 0.22;
  for (let k = 0; k < 26; k++) {
    g.strokeStyle = r() > 0.5 ? '#9b9890' : '#b9b3a6';
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    let x = r() * 1024, y = r() * 1024;
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) { x += (r() - 0.3) * 90; y += (r() - 0.5) * 90; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(120,115,105,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i * 256); g.lineTo(1024, i * 256); g.stroke();
  }
  return texFrom(c, [1, 1]);
}

export function carpetTexture() {
  const { c, g } = canvas(512, 512);
  const r = rng(11);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const base = (i + j) % 2 ? [52, 58, 68] : [60, 66, 76];
    g.fillStyle = `rgb(${base.join(',')})`;
    g.fillRect(i * 256, j * 256, 256, 256);
    // Tile grain direction alternates, like real carpet tiles.
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    for (let k = 0; k < 90; k++) {
      g.beginPath();
      const o = r() * 256;
      if ((i + j) % 2) { g.moveTo(i * 256 + o, j * 256); g.lineTo(i * 256 + o, j * 256 + 256); }
      else { g.moveTo(i * 256, j * 256 + o); g.lineTo(i * 256 + 256, j * 256 + o); }
      g.stroke();
    }
  }
  const img = g.getImageData(0, 0, 512, 512);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 18;
    img.data[p] += n; img.data[p + 1] += n; img.data[p + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return texFrom(c, [1, 1]);
}

export function woodTexture(tint = '#8a6646') {
  const { c, g } = canvas(512, 512);
  const r = rng(23);
  g.fillStyle = tint;
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 2) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,230,200' : '40,20,10'},${0.03 + r() * 0.06})`;
    g.fillRect(0, y + Math.sin(y * 0.05) * 2, 512, 1 + r() * 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x <= 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  return texFrom(c, [1, 1]);
}

// ---------- Skyline backdrop seen through the windows ----------

export function skylineTexture(night: boolean, seed: number) {
  const W = 2048, H = 512;
  const { c, g } = canvas(W, H);
  const r = rng(seed);
  const sky = g.createLinearGradient(0, 0, 0, H);
  if (night) { sky.addColorStop(0, '#05070f'); sky.addColorStop(0.65, '#121a33'); sky.addColorStop(1, '#2a2440'); }
  else { sky.addColorStop(0, '#6fa6dc'); sky.addColorStop(0.7, '#b9d4ec'); sky.addColorStop(1, '#e6eef2'); }
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  for (let layer = 0; layer < 3; layer++) {
    let x = -20;
    while (x < W) {
      const bw = 30 + r() * 90;
      const bh = (0.18 + r() * (0.5 - layer * 0.1)) * H * (layer === 2 ? 0.8 : 1);
      const top = H - bh;
      const shade = night ? 10 + layer * 8 : 120 - layer * 25 + r() * 20;
      g.fillStyle = night ? `rgb(${shade},${shade + 2},${shade + 10})` : `rgb(${shade},${shade + 8},${shade + 20})`;
      g.fillRect(x, top, bw, bh);
      if (r() > 0.85) g.fillRect(x + bw / 2 - 2, top - 30, 4, 30);
      const win = night ? 'rgba(255,214,140,' : 'rgba(210,230,250,';
      for (let wy = top + 6; wy < H - 4; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
        if (r() < (night ? 0.35 : 0.5)) { g.fillStyle = `${win}${night ? 0.5 + r() * 0.5 : 0.25 + r() * 0.3})`; g.fillRect(wx, wy, 3.5, 5); }
      }
      x += bw + r() * 8;
    }
  }
  return texFrom(c);
}

// ---------- Screens ----------

function screenFrame(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#161b22';
  g.fillRect(0, 0, w, 44);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(20 + i * 20, 22, 6, 0, Math.PI * 2); g.fill(); });
}

const STATE_COLOR: Record<string, string> = { merged: '#a78bfa', open: '#3ddc97', closed: '#ff5d6c', committed: '#4fd1ff' };

export function drawWorkerMonitor(c: HTMLCanvasElement, w: Worker) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  screenFrame(g, W, H);
  g.fillStyle = '#8b949e';
  g.font = `600 18px ${MONO}`;
  g.fillText(w.kind === 'pr' ? `PR #${w.number}` : `commit ${w.sha?.slice(0, 7)}`, 90, 29);
  g.fillStyle = STATE_COLOR[w.state] ?? '#ccc';
  g.font = `700 16px ${FONT}`;
  g.fillText(w.state.toUpperCase(), W - 120, 29);
  g.fillStyle = '#e6edf3';
  g.font = `700 30px ${FONT}`;
  const y = wrapText(g, w.title, 20, 86, W - 40, 36, 2);
  g.font = `600 20px ${MONO}`;
  g.fillStyle = '#3fb950'; g.fillText(`+${w.additions}`, 20, y + 6);
  g.fillStyle = '#f85149'; g.fillText(`−${w.deletions}`, 120, y + 6);
  g.fillStyle = '#8b949e'; g.fillText(`${w.changedFiles} files · ${w.author}`, 220, y + 6);
  const r = rng(hashStr(w.id));
  let ly = y + 40;
  let fi = 0;
  g.font = `15px ${MONO}`;
  while (ly < H - 12) {
    if (r() < 0.18 || ly === y + 40) {
      g.fillStyle = '#58a6ff';
      g.fillText(`@@ ${w.files[fi++ % Math.max(1, w.files.length)] ?? 'src/index.ts'}`, 20, ly);
    } else {
      const kind = r();
      g.fillStyle = kind < 0.35 ? 'rgba(63,185,80,0.25)' : kind < 0.55 ? 'rgba(248,81,73,0.22)' : 'transparent';
      g.fillRect(14, ly - 14, W - 28, 19);
      g.fillStyle = kind < 0.35 ? '#7ee787' : kind < 0.55 ? '#ffa198' : '#6e7681';
      const ind = Math.floor(r() * 4) * 18;
      g.fillRect(28 + ind, ly - 9, 40 + r() * (W - 200 - ind), 7);
    }
    ly += 22;
  }
}

export function drawAgentMonitor(c: HTMLCanvasElement, a: AgentInfo, diff: string, recent: string[]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  screenFrame(g, W, H);
  const col = a.status === 'running' ? '#3ddc97' : a.status === 'error' ? '#ff5d6c' : a.status === 'preparing' ? '#ffcc33' : '#8b949e';
  g.fillStyle = col;
  g.font = `700 16px ${FONT}`;
  g.fillText(`● ${a.status.toUpperCase()}`, W - 150, 29);
  g.fillStyle = '#8b949e';
  g.font = `600 17px ${MONO}`;
  g.fillText(a.branch || 'claude-code', 90, 29);
  g.fillStyle = '#e6edf3';
  g.font = `700 26px ${FONT}`;
  let y = wrapText(g, a.task, 20, 80, W - 40, 32, 2);
  g.fillStyle = '#4fd1ff';
  g.font = `600 18px ${MONO}`;
  y = wrapText(g, `› ${a.lastAction || 'Thinking…'}`, 20, y + 4, W - 40, 24, 1);
  const lines = diff ? diff.split('\n').filter((l) => !l.startsWith('index ') && !l.startsWith('diff --git')).slice(-18) : recent.slice(-10);
  g.font = `14px ${MONO}`;
  y += 6;
  for (const l of lines) {
    if (y > H - 10) break;
    const add = l.startsWith('+') && !l.startsWith('+++');
    const del = l.startsWith('-') && !l.startsWith('---');
    if (add || del) { g.fillStyle = add ? 'rgba(63,185,80,0.22)' : 'rgba(248,81,73,0.2)'; g.fillRect(14, y - 13, W - 28, 18); }
    g.fillStyle = add ? '#7ee787' : del ? '#ffa198' : l.startsWith('@@') ? '#58a6ff' : '#9da7b3';
    g.fillText(l.slice(0, 70), 20, y);
    y += 19;
  }
}

export function drawIdleMonitor(c: HTMLCanvasElement, seed: number, label = 'Available desk') {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const grad = g.createLinearGradient(0, 0, W, H);
  const r = rng(seed);
  grad.addColorStop(0, `hsl(${Math.floor(r() * 360)},45%,22%)`);
  grad.addColorStop(1, `hsl(${Math.floor(r() * 360)},55%,12%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `600 26px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(label, W / 2, H / 2 + 8);
  g.textAlign = 'left';
}

export function drawFeed(c: HTMLCanvasElement, title: string, lines: { who: string; text: string; color: string }[]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#070b12';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#3ddc97';
  g.font = `800 34px ${FONT}`;
  g.fillText(title, 30, 52);
  g.fillStyle = '#5b6575';
  g.font = `600 18px ${MONO}`;
  g.fillText('LIVE', W - 90, 50);
  g.fillStyle = '#ff5d6c';
  g.beginPath(); g.arc(W - 105, 44, 7, 0, Math.PI * 2); g.fill();
  let y = 100;
  g.font = `20px ${MONO}`;
  if (!lines.length) {
    g.fillStyle = '#6e7681';
    g.fillText('No agents running yet. Use the kiosk to hire one.', 30, y);
    return;
  }
  for (const l of lines.slice(-14)) {
    g.fillStyle = l.color;
    g.fillText(`[${l.who}]`, 30, y);
    const off = g.measureText(`[${l.who}] `).width;
    g.fillStyle = '#c9d1d9';
    g.fillText(fitStr(g, l.text, W - 60 - off), 30 + off, y);
    y += 30;
  }
}

function fitStr(g: CanvasRenderingContext2D, s: string, maxW: number) { return fit(g, s.replace(/\s+/g, ' '), maxW); }

export function drawDecisions(c: HTMLCanvasElement, decisions: BoardDecision[]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#0a0d14';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffcc33';
  g.font = `800 36px ${FONT}`;
  g.fillText('Board decisions', 30, 56);
  let y = 110;
  if (!decisions.length) {
    g.fillStyle = '#8b949e';
    g.font = `500 24px ${FONT}`;
    g.fillText('No decisions yet — stand at the head of the table and press E.', 30, y);
    return;
  }
  for (const d of [...decisions].reverse().slice(0, 5)) {
    if (y > H - 40) break;
    g.fillStyle = '#e6edf3';
    g.font = `700 24px ${FONT}`;
    y = wrapText(g, `“${d.question}”`, 30, y, W - 60, 30, 1);
    g.fillStyle = '#9aa6b8';
    g.font = `500 19px ${FONT}`;
    y = wrapText(g, d.resolution, 30, y, W - 60, 25, 2) + 18;
  }
}

/** Logo wall: brand gradient, logo (if any), repo name, description. */
export function drawLogoWall(c: HTMLCanvasElement, repo: Repo, logo: HTMLImageElement | null) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const base = new THREE.Color(repo.brandColor || '#334155');
  const dark = base.clone().multiplyScalar(0.35);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `#${dark.getHexString()}`);
  grad.addColorStop(1, '#0b0e14');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Subtle slats
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 14, H);
  const cx = W / 2;
  const size = H * 0.42;
  if (logo && logo.naturalWidth > 0) {
    const ar = logo.naturalWidth / logo.naturalHeight;
    const lw = ar >= 1 ? size * Math.min(ar, 2.5) : size * ar;
    const lh = ar >= 1 ? lw / ar : size;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 30;
    g.drawImage(logo, cx - lw / 2, H * 0.12 + (size - lh) / 2, lw, lh);
    g.restore();
  } else {
    g.fillStyle = `#${base.getHexString()}`;
    roundRect(g, cx - size / 2, H * 0.12, size, size, size * 0.22);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `800 ${Math.floor(size * 0.5)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(monogram(repo.name), cx, H * 0.12 + size / 2);
    g.textBaseline = 'alphabetic';
  }
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.font = `800 ${Math.floor(H * 0.13)}px ${FONT}`;
  g.fillText(repo.name, cx, H * 0.75);
  if (repo.description) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = `500 ${Math.floor(H * 0.045)}px ${FONT}`;
    g.fillText(fit(g, repo.description, W * 0.85), cx, H * 0.86);
  }
  g.textAlign = 'left';
}

export function monogram(name: string) {
  const parts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawSign(c: HTMLCanvasElement, title: string, rows: [string, string][]) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#12161f';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffcc33';
  g.fillRect(0, 0, W, 10);
  g.fillStyle = '#ffffff';
  g.font = `800 44px ${FONT}`;
  g.fillText(title, 36, 80);
  let y = 150;
  for (const [a, b] of rows) {
    g.fillStyle = '#e6edf3';
    g.font = `700 32px ${FONT}`;
    g.fillText(a, 36, y);
    g.fillStyle = '#8b949e';
    g.font = `500 26px ${FONT}`;
    g.fillText(b, 36, y + 36);
    y += 96;
  }
}

/** A floating text panel used for room name plates above glass doors. */
export function drawPlate(c: HTMLCanvasElement, text: string, color: string) {
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e121a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.fillRect(0, c.height - 8, c.width, 8);
  g.fillStyle = '#fff';
  g.font = `800 ${Math.floor(c.height * 0.45)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2);
}
