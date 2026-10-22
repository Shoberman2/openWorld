// East Asian street dressing for detailed chunks: the giant LED screens facing the Shibuya scramble
// (Q-Front, the station building, the 109 corner…), and the vertical shop signs (tate-kanban,
// gan-pan) that stick out from the facades of commercial streets in Tokyo, Seoul, Hong Kong, Taipei
// and Shanghai. All shop names and ads are generic words and invented brands, no real trademarks.
import * as THREE from 'three';
import type { EdgeData, FootprintData } from '../build/types.ts';
import type { GeoFrame } from '../frame.ts';
import { nightMats } from './kit.ts';
import { screenTime } from './timessq.ts';

type Script = 'jp' | 'kr' | 'zh';

/** Which script the shop signs are in here (null: no vertical signs). */
function scriptAt(lat: number, lon: number): Script | null {
  if (lat > 30 && lat < 46 && lon > 129 && lon < 146) return 'jp';
  if (lat > 33 && lat < 39 && lon > 124.5 && lon < 130) return 'kr';
  if (lat > 21.9 && lat < 25.5 && lon > 113.8 && lon < 122.2) return 'zh'; // Hong Kong, Taipei
  if (lat > 30.5 && lat < 32 && lon > 120.8 && lon < 122.2) return 'zh'; // Shanghai
  return null;
}

/** Plazas ringed by giant screens: (center, radius in meters). */
const SCREEN_SPOTS = [{ lat: 35.65955, lon: 139.70045, r: 115 }]; // the Shibuya scramble

// ------------------------------------------------------------------ vertical signs

const WORDS: Record<Script, string[]> = {
  jp: ['居酒屋', 'ラーメン', 'カラオケ', '焼肉', '寿司', '珈琲', '歯科', '不動産', '書店', '薬局', 'ゲーム', '中華', 'そば', '美容室', '定食', '古着'],
  kr: ['노래방', '치킨', '약국', '카페', '식당', '병원', '안경', '미용실', '분식', '고기집', '서점', '노래연습장', '편의점', '학원', '호프', '치과'],
  zh: ['酒家', '茶餐廳', '藥房', '金行', '按摩', '眼鏡', '麵家', '當舖', '找換', '海味', '涼茶', '粥麵', '牙科', '珠寶', '時裝', '雀館'],
};
const SIGN_BG: [string, string][] = [
  ['#d8282b', '#fff4e0'], ['#f6f1e2', '#c3161c'], ['#1d3f8f', '#ffffff'], ['#ffd22e', '#1a1a1a'], ['#127a4a', '#ffffff'],
  ['#ffffff', '#1c3b8c'], ['#e86a1c', '#ffffff'], ['#2a2a2a', '#ffd84a'], ['#7b2a8c', '#ffffff'], ['#f2f2f2', '#0f7a3a'],
];
const SC = 8, SR = 2, STW = 64, STH = 256; // atlas: 8 × 2 tiles of 64 × 256 per script

const signMats = new Map<Script, THREE.MeshStandardMaterial>();
function signMat(script: Script) {
  let m = signMats.get(script);
  if (m) return m;
  const c = document.createElement('canvas'); c.width = STW * SC; c.height = STH * SR;
  const g = c.getContext('2d')!;
  const words = WORDS[script];
  for (let i = 0; i < SC * SR; i++) {
    const x = (i % SC) * STW, y = Math.floor(i / SC) * STH, [bg, fg] = SIGN_BG[i % SIGN_BG.length];
    g.fillStyle = bg; g.fillRect(x, y, STW, STH);
    g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, STW - 8, STH - 8); g.globalAlpha = 1;
    const w = [...words[i % words.length]];
    const fs = Math.min(46, (STH - 24) / w.length);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${fs}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Apple SD Gothic Neo", "PingFang TC", "Noto Sans CJK JP", "Microsoft YaHei", sans-serif`;
    w.forEach((ch, k) => g.fillText(ch, x + STW / 2, y + 12 + fs * (k + 0.5) + (STH - 24 - fs * w.length) / 2));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12, roughness: 0.5, side: THREE.DoubleSide });
  m.userData.glow = 1.1; m.userData.day = 0.12;
  nightMats.push(m);
  signMats.set(script, m);
  return m;
}

const h01 = (n: number) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };

/** Vertical signs on the street walls of shop buildings. Chunk-local coordinates. */
function verticalSigns(script: Script, footprints: FootprintData[], edges: EdgeData[]) {
  // Street segments (driveable, not motorways), bucketed for the nearest-street test.
  const G = 30, grid = new Map<string, number[]>();
  for (const e of edges) {
    if (!e.drive || e.cls === 'motorway' || e.cls === 'trunk' || e.bridge) continue;
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const seg = [e.pts[i], e.pts[i + 1], e.pts[i + 2], e.pts[i + 3]];
      const k = `${Math.floor((seg[0] + seg[2]) / 2 / G)},${Math.floor((seg[1] + seg[3]) / 2 / G)}`;
      let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(...seg);
    }
  }
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  let n = 0;
  for (const f of footprints) {
    if (f.h < 8 || f.h > 70 || f.area > 2500 || f.glass) continue;
    const r = h01(f.key);
    if (r > (f.poi ? 0.9 : 0.55)) continue;
    const ring = f.ring, m = ring.length / 2;
    let best = -1, bestLen = 0, bestD = 1e9;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // The street in front: a segment within 14 m along the outward normal.
      let d = 1e9;
      const px = mx + nx * 6, pz = mz + nz * 6;
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = grid.get(`${Math.floor(px / G) + ox},${Math.floor(pz / G) + oz}`);
        if (!s) continue;
        for (let q = 0; q < s.length; q += 4) {
          const ex = s[q + 2] - s[q], ez = s[q + 3] - s[q + 1], l2 = ex * ex + ez * ez;
          if (l2 < 1) continue;
          const t = Math.max(0, Math.min(1, ((mx - s[q]) * ex + (mz - s[q + 1]) * ez) / l2));
          const qx = s[q] + ex * t - mx, qz = s[q + 1] + ez * t - mz, dd = Math.hypot(qx, qz);
          if (dd < 16 && (qx * nx + qz * nz) / (dd || 1) > 0.6) d = Math.min(d, dd);
        }
      }
      if (d < bestD - 2 || (d < bestD + 2 && len > bestLen)) { best = i; bestLen = len; bestD = d; }
    }
    if (best < 0 || bestD > 15) continue;
    const j = (best + 1) % m, ax = ring[best * 2], az = ring[best * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    const tx = (bx - ax) / bestLen, tz = (bz - az) / bestLen, nx = -tz, nz = tx;
    const count = bestLen > 14 && r < 0.3 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const s = k === 0 ? 1.2 + h01(f.key + 3) * 1.5 : bestLen - 1.2 - h01(f.key + 5) * 1.5;
      const wx = ax + tx * s, wz = az + tz * s;
      const y0 = f.base + 3.6 + h01(f.key * 7 + k) * 1.2;
      const y1 = Math.min(f.top - 0.8, y0 + 4.5 + h01(f.key * 3 + k) * Math.min(10, f.h * 0.4));
      if (y1 - y0 < 3) continue;
      const out = 0.85 + h01(f.key + k) * 0.35, half = 0.14;
      const tile = Math.floor(h01(f.key * 13 + k * 5) * SC * SR);
      const u0 = (tile % SC) / SC, u1 = u0 + 1 / SC, v1 = 1 - Math.floor(tile / SC) / SR, v0 = v1 - 1 / SR;
      for (const side of [-1, 1]) {
        const ox = wx + tx * half * side + nx * 0.12, oz = wz + tz * half * side + nz * 0.12;
        const ex = ox + nx * out, ez = oz + nz * out;
        const p = [[ox, y0, oz], [ex, y0, ez], [ex, y1, ez], [ox, y1, oz]];
        const uvq = side > 0 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] : [[u1, v0], [u0, v0], [u0, v1], [u1, v1]];
        for (const q of [0, 1, 2, 0, 2, 3]) { pos.push(p[q][0], p[q][1], p[q][2]); nrm.push(tx * side, 0, tz * side); uv.push(uvq[q][0], uvq[q][1]); }
      }
      n++;
    }
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, signMat(script));
  mesh.name = 'apac-vertical-signs';
  return mesh;
}

// ------------------------------------------------------------------ giant screens

const ADS = 9, AC = 3, AR = 3, ATW = 512, ATH = 288;
let adMat: THREE.MeshBasicMaterial | null = null;
function screenMat() {
  if (adMat) return adMat;
  const c = document.createElement('canvas'); c.width = ATW * AC; c.height = ATH * AR;
  const g = c.getContext('2d')!;
  const ads: { bg: [string, string]; title: string; sub: string; fg: string }[] = [
    { bg: ['#ff5fa2', '#ffd1e6'], title: 'サクラ ソーダ', sub: 'SAKURA SODA · 春限定', fg: '#ffffff' },
    { bg: ['#06122e', '#2f6bff'], title: 'KITE PHONE 12', sub: '夜景モード、新登場', fg: '#bfe9ff' },
    { bg: ['#111111', '#ff2d55'], title: 'TOKYO BEAT', sub: '音楽祭 · 渋谷 8.24', fg: '#ffffff' },
    { bg: ['#ffe14a', '#ff8a00'], title: 'ネオン ラーメン', sub: '24時間営業', fg: '#2b1300' },
    { bg: ['#0e2a1b', '#2fbf71'], title: 'みどり銀行', sub: 'MIDORI BANK', fg: '#eafff2' },
    { bg: ['#1b0033', '#b100ff'], title: 'HARUKA', sub: 'NEW SINGLE「夜明け」', fg: '#ffe9ff' },
    { bg: ['#ffffff', '#cfe8ff'], title: 'SKYLINE AIR', sub: '羽田 ⇄ 世界', fg: '#0b2a6b' },
    { bg: ['#00222b', '#00c2c7'], title: 'ORBIT SNEAKERS', sub: 'RUN SHIBUYA', fg: '#ffffff' },
    { bg: ['#15233f', '#2c5aa0'], title: 'OPENWORLD 東京', sub: 'Your repos live here', fg: '#f6c21c' },
  ];
  ads.forEach((a, i) => {
    const x = (i % AC) * ATW, y = Math.floor(i / AC) * ATH;
    const grd = g.createLinearGradient(x, y, x + ATW, y + ATH); grd.addColorStop(0, a.bg[0]); grd.addColorStop(1, a.bg[1]);
    g.fillStyle = grd; g.fillRect(x, y, ATW, ATH);
    g.save(); g.beginPath(); g.rect(x, y, ATW, ATH); g.clip();
    g.globalAlpha = 0.22; g.fillStyle = '#fff';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + ((k * 173) % ATW), y + ((k * 97) % ATH), 30 + (k % 3) * 40, 0, Math.PI * 2); g.fill(); }
    g.restore(); g.globalAlpha = 1;
    g.fillStyle = a.fg; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const fam = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Helvetica Neue", Arial, sans-serif';
    let fs = 78; g.font = `900 ${fs}px ${fam}`;
    while (g.measureText(a.title).width > ATW - 56 && fs > 30) { fs -= 4; g.font = `900 ${fs}px ${fam}`; }
    g.fillText(a.title, x + 28, y + ATH * 0.56);
    g.font = `600 30px ${fam}`;
    g.fillText(a.sub, x + 30, y + ATH * 0.56 + 48);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: t });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = screenTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAd; varying vec2 vAd; varying vec2 vLed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAd = aAd; vLed = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vAd; varying vec2 vLed;')
      .replace('#include <map_fragment>', `
        float tt = uTime / vAd.y + vAd.x;
        float k = floor(tt), f = fract(tt);
        float idx = mod(k + (vLed.y > 1.0 - smoothstep(0.9, 1.0, f) ? 1.0 : 0.0), ${ADS}.0);
        vec2 tile = vec2(mod(idx, ${AC}.0), floor(idx / ${AC}.0));
        vec2 auv = vec2((tile.x + vLed.x) / ${AC}.0, 1.0 - (tile.y + 1.0 - vLed.y) / ${AR}.0);
        vec4 texel = texture2D(map, auv);
        vec2 px = fract(vLed * vec2(192.0, 108.0));
        float led = 0.8 + 0.2 * step(0.16, px.x) * step(0.16, px.y);
        diffuseColor *= vec4(texel.rgb * led * 1.3, 1.0);
      `);
  };
  m.customProgramCacheKey = () => 'apac-screens';
  adMat = m;
  return m;
}

function giantScreens(frame: GeoFrame, footprints: FootprintData[], x0: number, z0: number) {
  const pos: number[] = [], uv: number[] = [], ad: number[] = [];
  let n = 0;
  for (const spot of SCREEN_SPOTS) {
    const c = frame.toLocal(spot.lat, spot.lon);
    const cx0 = c.x - x0, cz0 = c.z - z0;
    for (const f of footprints) {
      if (Math.hypot(f.cx - cx0, f.cz - cz0) > spot.r + 40 || f.h < 12) continue;
      const ring = f.ring, m = ring.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 9) continue;
        const nx = -(bz - az) / len, nz = (bx - ax) / len, mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const tx = cx0 - mx, tz = cz0 - mz, td = Math.hypot(tx, tz);
        if (td > spot.r || (nx * tx + nz * tz) / td < 0.55) continue;
        // One big 16:9 screen per wall facing the crossing, centered, high on the facade.
        const w = Math.min(len - 2, 30), hgt = w * 0.5625;
        const y1 = f.top - 2.5, y0 = Math.max(f.base + 7, y1 - hgt);
        if (y1 - y0 < 4) continue;
        const ww = Math.min(w, (y1 - y0) / 0.5625);
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const sx = mx - ux * ww / 2 + nx * 0.4, sz = mz - uz * ww / 2 + nz * 0.4, ex = mx + ux * ww / 2 + nx * 0.4, ez = mz + uz * ww / 2 + nz * 0.4;
        const p = [[sx, y0, sz], [ex, y0, ez], [ex, y1, ez], [sx, y1, sz]];
        const uvq = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const q of [0, 1, 2, 0, 2, 3]) { pos.push(p[q][0], p[q][1], p[q][2]); uv.push(uvq[q][0], uvq[q][1]); ad.push(n * 1.7 + (f.key % 7), 6 + (n % 3) * 1.5); }
        n++;
      }
    }
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAd', new THREE.Float32BufferAttribute(ad, 2));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, screenMat());
  mesh.name = 'apac-screens';
  return mesh;
}

/** Street dressing for one detailed chunk (world offset x0, z0), or null when there's nothing here. */
export function buildApacStreet(frame: GeoFrame, footprints: FootprintData[], edges: EdgeData[], x0: number, z0: number, size: number): THREE.Group | null {
  const geo = frame.toGeo(x0 + size / 2, z0 + size / 2);
  const script = scriptAt(geo.lat, geo.lon);
  if (!script) return null;
  const grp = new THREE.Group();
  grp.name = 'apac-street';
  const v = verticalSigns(script, footprints, edges);
  if (v) grp.add(v);
  const s = giantScreens(frame, footprints, x0, z0);
  if (s) grp.add(s);
  return grp.children.length ? grp : null;
}
