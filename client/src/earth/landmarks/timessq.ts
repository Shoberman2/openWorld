// Times Square: animated LED screens on the real buildings facing the bowtie (One Times Square
// wrapped top to bottom), and the red TKTS steps on Duffy Square. The ads are invented brands and
// the player's own projects; no real trademarks.
import * as THREE from 'three';
import type { FootprintData } from '../build/types.ts';
import type { GeoFrame } from '../frame.ts';

/** The square's spine: from One Times Square (42nd St) up to Duffy Square (47th St). */
const SPINE = [{ lat: 40.75628, lon: -73.98645 }, { lat: 40.75915, lon: -73.98512 }];
const ONE_TS = { lat: 40.756421, lon: -73.986479 };
export const TKTS = { lat: 40.75902, lon: -73.98513, bearing: 20 };

const ADS = 12, COLS = 3, ROWS = 4, TW = 512, TH = 256;

let atlas: THREE.CanvasTexture | null = null;
let repoNames: string[] = [];
function drawAtlas() {
  const c = document.createElement('canvas'); c.width = TW * COLS; c.height = TH * ROWS;
  const g = c.getContext('2d')!;
  const ads: { bg: [string, string]; title: string; sub: string; fg: string; shape?: 'circle' | 'bars' | 'stripes' | 'stars' }[] = [
    { bg: ['#ff3d6e', '#7a1cff'], title: 'NOVA COLA', sub: 'Taste the city', fg: '#fff', shape: 'circle' },
    { bg: ['#0b0f2b', '#1e4dff'], title: 'LUMEN 9', sub: 'The phone that sees in the dark', fg: '#9fe7ff', shape: 'bars' },
    { bg: ['#ffd23f', '#ff7a00'], title: 'MEGA BURGER', sub: 'Open all night', fg: '#2a1100', shape: 'stars' },
    { bg: ['#10251a', '#19a35b'], title: 'JUNIPER BANK', sub: 'Money, but calmer', fg: '#eafff2' },
    { bg: ['#1a0000', '#c4001c'], title: 'THE GRAND MACHINE', sub: 'Now on Broadway', fg: '#ffd88a', shape: 'stripes' },
    { bg: ['#ffffff', '#cfe6ff'], title: 'SKYLINE AIR', sub: 'Fly further for less', fg: '#0b2a6b', shape: 'circle' },
    { bg: ['#14002b', '#ff00a8'], title: 'PULSE RADIO', sub: '24/7 · 101.9', fg: '#fff', shape: 'bars' },
    { bg: ['#00222b', '#00c2c7'], title: 'ORBIT SNEAKERS', sub: 'Run the five boroughs', fg: '#fff', shape: 'stripes' },
    { bg: ['#15233f', '#2c5aa0'], title: 'OPENWORLD HQ', sub: 'Your repos live here', fg: '#f6c21c', shape: 'bars' },
  ];
  const repos = repoNames.slice(0, 3);
  const repoAds = repos.map((n, i) => ({ bg: (['#0a1a3a', '#2c74d6'] as [string, string]), title: n.toUpperCase(), sub: ['Now hiring agents', 'Built here in Times Square', 'Ship something today'][i % 3], fg: '#fff', shape: 'bars' as const }));
  const all = [...repoAds, ...ads].slice(0, ADS);
  all.forEach((a, i) => {
    const x = (i % COLS) * TW, y = Math.floor(i / COLS) * TH;
    const grd = g.createLinearGradient(x, y, x + TW, y + TH); grd.addColorStop(0, a.bg[0]); grd.addColorStop(1, a.bg[1]);
    g.fillStyle = grd; g.fillRect(x, y, TW, TH);
    g.save(); g.beginPath(); g.rect(x, y, TW, TH); g.clip();
    g.globalAlpha = 0.25; g.fillStyle = '#fff';
    if (a.shape === 'circle') { g.beginPath(); g.arc(x + TW * 0.8, y + TH * 0.5, TH * 0.55, 0, Math.PI * 2); g.fill(); }
    if (a.shape === 'bars') for (let k = 0; k < 8; k++) g.fillRect(x + TW * 0.62 + k * 22, y + TH * (0.75 - k * 0.07), 14, TH * (0.25 + k * 0.07));
    if (a.shape === 'stripes') for (let k = -4; k < 12; k++) { g.beginPath(); g.moveTo(x + k * 60, y + TH); g.lineTo(x + k * 60 + 30, y + TH); g.lineTo(x + k * 60 + 130, y); g.lineTo(x + k * 60 + 100, y); g.fill(); }
    if (a.shape === 'stars') for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(x + ((k * 97) % TW), y + ((k * 53) % TH), 6 + (k % 4) * 3, 0, Math.PI * 2); g.fill(); }
    g.restore();
    g.globalAlpha = 1; g.fillStyle = a.fg; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let fs = 76; g.font = `900 ${fs}px "Helvetica Neue", Arial Black, Arial, sans-serif`;
    while (g.measureText(a.title).width > TW - 60 && fs > 30) { fs -= 4; g.font = `900 ${fs}px "Helvetica Neue", Arial Black, Arial, sans-serif`; }
    g.fillText(a.title, x + 30, y + TH * 0.55);
    g.font = '500 30px "Helvetica Neue", Arial, sans-serif';
    g.fillText(a.sub, x + 32, y + TH * 0.55 + 46);
  });
  if (!atlas) { atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8; }
  else { atlas.image = c; atlas.needsUpdate = true; }
  return atlas;
}

let loadedRepos = false;
function loadRepos() {
  if (loadedRepos) return;
  loadedRepos = true;
  fetch('/api/repos').then((r) => (r.ok ? r.json() : [])).then((rs: { name: string; tier?: string }[]) => {
    repoNames = rs.filter((r) => r.tier === 'landmark' || r.tier === 'tower').map((r) => r.name);
    if (repoNames.length) drawAtlas();
  }).catch(() => {});
}

export const screenTime = { value: 0 };
let screenMat: THREE.MeshBasicMaterial | null = null;
function material() {
  if (screenMat) return screenMat;
  loadRepos();
  const m = new THREE.MeshBasicMaterial({ map: drawAtlas(), color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = screenTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aAd; varying vec3 vAd; varying vec2 vLed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAd = aAd; vLed = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vAd; varying vec2 vLed;`)
      .replace('#include <map_fragment>', `
        // Each screen cycles through the ads at its own pace, with a quick wipe between them.
        float tt = uTime / vAd.y + vAd.x;
        float k = floor(tt), f = fract(tt);
        float idx = mod(k + (vLed.x > smoothstep(0.92, 1.0, f) ? 0.0 : 1.0), ${ADS}.0);
        vec2 tile = vec2(mod(idx, ${COLS}.0), floor(idx / ${COLS}.0));
        vec2 st = vec2(vLed.x * vAd.z, vLed.y);
        st.x = fract(st.x);
        vec2 auv = vec2((tile.x + st.x) / ${COLS}.0, 1.0 - (tile.y + 1.0 - st.y) / ${ROWS}.0);
        vec4 texel = texture2D(map, auv);
        // LED pixel grid.
        vec2 px = fract(vLed * vec2(160.0 * vAd.z, 80.0));
        float led = 0.78 + 0.22 * step(0.18, px.x) * step(0.18, px.y);
        diffuseColor *= vec4(texel.rgb * led * 1.35, 1.0);
      `);
  };
  m.customProgramCacheKey = () => 'ts-screens';
  screenMat = m;
  return m;
}

function nearestOnSeg(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
  const t = Math.max(-0.15, Math.min(1.15, ((px - a.x) * ex + (pz - a.z) * ez) / l2));
  return { x: a.x + ex * t, z: a.z + ez * t };
}

/** LED screens for one detailed chunk's footprints (world offset x0, z0), or null if it's not here. */
export function buildScreens(frame: GeoFrame, footprints: FootprintData[], x0: number, z0: number): THREE.Mesh | null {
  const A = frame.toLocal(SPINE[0].lat, SPINE[0].lon), B = frame.toLocal(SPINE[1].lat, SPINE[1].lon);
  const one = frame.toLocal(ONE_TS.lat, ONE_TS.lon);
  const pos: number[] = [], uv: number[] = [], ad: number[] = [];
  let n = 0;
  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, y0: number, y1: number) => {
    const o = 0.35;
    const p = [[ax + nx * o, y0, az + nz * o], [bx + nx * o, y0, bz + nz * o], [bx + nx * o, y1, bz + nz * o], [ax + nx * o, y1, az + nz * o]];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(p[k][0] - x0, p[k][1], p[k][2] - z0); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    const len = Math.hypot(bx - ax, bz - az), hgt = y1 - y0;
    // Wide screens tile the ad across (repeat count ≈ aspect / 2).
    const rep = Math.max(1, Math.round(len / hgt / 2));
    const phase = (n * 0.37) % 1 * ADS, period = 5 + (n % 4) * 1.7;
    for (let k = 0; k < 6; k++) ad.push(phase + n * 1.3, period, rep);
    n++;
  };
  for (const f of footprints) {
    const cx = f.cx + x0, cz = f.cz + z0;
    const c = nearestOnSeg(cx, cz, A, B);
    if (Math.hypot(cx - c.x, cz - c.z) > 140) continue;
    const ring = f.ring;
    const isOne = Math.hypot(cx - one.x, cz - one.z) < 18;
    const m = ring.length / 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = ring[i * 2] + x0, az = ring[i * 2 + 1] + z0, bx = ring[j * 2] + x0, bz = ring[j * 2 + 1] + z0;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < (isOne ? 4 : 9)) continue;
      // Footprints are clockwise in x/z: outward normal is (-dz, dx).
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const s = nearestOnSeg(mx, mz, A, B);
      const tx = s.x - mx, tz = s.z - mz, td = Math.hypot(tx, tz);
      if (!isOne && (td > 70 || (nx * tx + nz * tz) / (td || 1) < 0.45)) continue;
      const base = f.base;
      if (isOne) {
        quad(ax, az, bx, bz, nx, nz, base + 7, base + Math.min(f.h - 6, 112));
        continue;
      }
      const top = Math.min(f.h - 3, 48);
      if (top < 14) continue;
      // Big walls get a couple of screens side by side; tall ones a second row higher up.
      const parts = len > 34 ? 2 : 1;
      for (let p = 0; p < parts; p++) {
        const t0 = p / parts + 0.04, t1 = (p + 1) / parts - 0.04;
        const sx = ax + (bx - ax) * t0, sz = az + (bz - az) * t0, ex = ax + (bx - ax) * t1, ez = az + (bz - az) * t1;
        const h0 = base + 6 + ((n * 7) % 3);
        quad(sx, sz, ex, ez, nx, nz, h0, Math.min(base + top, h0 + Math.max(8, Math.hypot(ex - sx, ez - sz) * 0.75)));
        if (f.h > 70 && (n % 3) === 0) quad(sx, sz, ex, ez, nx, nz, base + top + 4, base + Math.min(f.h - 4, top + 26));
      }
    }
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAd', new THREE.Float32BufferAttribute(ad, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material());
  mesh.name = 'times-square-screens';
  return mesh;
}

/** The red glass TKTS steps and the booth under them (model frame: rises toward -z). */
export function tktsSteps(): THREE.Group {
  const grp = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb3121b, emissive: 0xff2a2a, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1 });
  red.userData.glow = 2.2; red.userData.day = 0.55;
  const steps: THREE.BufferGeometry[] = [];
  const N = 27, W = 15, L = 20, Hh = 5.2;
  for (let i = 0; i < N; i++) {
    const z = L / 2 - (i + 0.5) * (L / N), y = (i + 1) * (Hh / N);
    steps.push(new THREE.BoxGeometry(W, 0.12, L / N).translate(0, y, z), new THREE.BoxGeometry(W, Hh / N, 0.05).translate(0, y - Hh / N / 2, z + L / N / 2));
  }
  const geo = mergeGeos(steps);
  const m = new THREE.Mesh(geo, red); m.castShadow = true; m.receiveShadow = true;
  grp.add(m);
  const booth = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 3.4, L * 0.55).translate(0, 1.7, -L * 0.12), new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55 }));
  grp.add(booth);
  grp.userData.glowMats = [red];
  return grp;
}

function mergeGeos(gs: THREE.BufferGeometry[]) {
  const flat = gs.map((g) => g.toNonIndexed());
  const n = flat.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) { pos.set(g.getAttribute('position').array as Float32Array, o * 3); nrm.set(g.getAttribute('normal').array as Float32Array, o * 3); o += g.getAttribute('position').count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
