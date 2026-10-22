// The work, drawn on the buildings: a roof beacon for CI (green passing, red pulsing failing, amber
// running), a warm band of lit windows for every agent at work inside, faded signs on projects nobody
// has touched in a month, fireworks for a new release and streaks of light down the street for new
// commits. Everything is instanced or pooled so a city of HQs stays a handful of draw calls.
import * as THREE from 'three';
import type { AgentInfo, RepoPulse } from '../../../shared/types.ts';
import type { Site } from '../place.ts';
import { esc } from '../interact.ts';
import { toast } from '../ui/panel.ts';
import { pulse, pulseSummary } from '../pulse.ts';

const CI_COLOR = {
  passing: new THREE.Color(0.25, 2.2, 0.7),
  failing: new THREE.Color(2.6, 0.18, 0.12),
  pending: new THREE.Color(2.4, 1.4, 0.15),
  none: new THREE.Color(0, 0, 0),
};

const live = (a: AgentInfo) => a.status === 'preparing' || a.status === 'running' || a.status === 'needs_input';

function inRing(p: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  return inside;
}

/** A soft round dot for the halo and spark points. */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Lit office windows: warm panes between dark mullions, one tile per 3 m of wall. */
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1712';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 4; i++) {
    const grad = g.createLinearGradient(0, 8, 0, 56);
    grad.addColorStop(0, '#fff6e0');
    grad.addColorStop(1, '#f6d49a');
    g.fillStyle = grad;
    g.fillRect(i * 32 + 4, 10, 24, 44);
    // A lamp's hot spot and someone's monitor in some panes.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(i * 32 + 10, 10, 12, 3);
    if (i % 2) { g.fillStyle = 'rgba(120,180,255,0.6)'; g.fillRect(i * 32 + 8, 40, 9, 6); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface SiteFx {
  site: Site;
  i: number;
  /** Wall segments with outward normals, for the lit bands. */
  walls: { mx: number; mz: number; nx: number; nz: number; len: number }[];
  base: number;
  bands: THREE.Mesh[];
  /** The building parts that make up this HQ (found when its floors first light up). */
  parts?: { ring: number[]; base: number; top: number }[];
  stale: boolean | null;
  near: boolean;
  firstSight: boolean;
}

interface Spark { p: THREE.Vector3; v: THREE.Vector3; c: THREE.Color; life: number; max: number }
interface Streak { p: THREE.Vector3; dir: THREE.Vector3; turn: THREE.Vector3; leg: number; t: number; color: THREE.Color }

export interface CityPulseOptions {
  sites: Site[];
  scene: THREE.Scene;
  camera: THREE.Camera;
  agents: () => Map<string, AgentInfo>;
  /** Projects are only in the world at home (the HQs stay behind when you fly far away). */
  visible: () => boolean;
  /** 0 by day .. 1 at night: lit windows glow harder in the dark. */
  night?: () => number;
  /** Building parts near (x, z), so lit floors wrap the whole tower and not just one part of it. */
  partsNear?: (x: number, z: number, r: number) => { ring: number[]; base: number; top: number; cx: number; cz: number }[];
}

export function installCityPulse(o: CityPulseOptions) {
  pulse.start();
  const group = new THREE.Group();
  group.name = 'city-pulse';
  o.scene.add(group);
  const dot = dotTexture();
  const winTex = windowTexture();
  const bandMat = new THREE.MeshBasicMaterial({ map: winTex, color: new THREE.Color(1.6, 1.35, 1.05), toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });

  const fx: SiteFx[] = o.sites.map((site, i) => {
    const ring = site.footprint ?? [];
    const walls: SiteFx['walls'] = [];
    for (let k = 0, n = ring.length / 2; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      let nx = -(bz - az) / len, nz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (inRing(ring, mx + nx * 0.8, mz + nz * 0.8)) { nx = -nx; nz = -nz; }
      walls.push({ mx, mz, nx, nz, len });
    }
    return { site, i, walls, base: site.door.y, bands: [], stale: null, near: false, firstSight: false };
  });
  const N = Math.max(1, fx.length);

  // ---- roof beacons: a mast and a lamp per HQ (instanced), and a glowing halo (points) ----
  const mastGeo = new THREE.CylinderGeometry(0.06, 0.09, 3, 6);
  mastGeo.translate(0, 1.5, 0);
  const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.5, metalness: 0.8 }), N);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
  const haloPos = new Float32Array(N * 3), haloCol = new Float32Array(N * 3), haloSize = new Float32Array(N);
  const m4 = new THREE.Matrix4();
  for (const f of fx) {
    const t = f.site.top;
    m4.makeTranslation(t.x, t.y, t.z);
    masts.setMatrixAt(f.i, m4);
    m4.makeTranslation(t.x, t.y + 3.2, t.z);
    lamps.setMatrixAt(f.i, m4);
    lamps.setColorAt(f.i, CI_COLOR.none);
    haloPos.set([t.x, t.y + 3.2, t.z], f.i * 3);
    haloSize[f.i] = f.site.repo.tier === 'landmark' ? 16 : f.site.repo.tier === 'tower' ? 12 : 8;
  }
  masts.frustumCulled = lamps.frustumCulled = false;
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
  haloGeo.setAttribute('size', new THREE.BufferAttribute(haloSize, 1));
  const pointsMat = (sizeAttr: boolean) => new THREE.ShaderMaterial({
    uniforms: { map: { value: dot }, scale: { value: 600 } },
    vertexShader: `
      attribute vec3 color; ${sizeAttr ? 'attribute float size;' : 'uniform float size;'}
      uniform float scale; varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * scale / -mv.z, 0.0, 256.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor, 1.0) * texture2D(map, gl_PointCoord).a; }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halos = new THREE.Points(haloGeo, pointsMat(true));
  halos.frustumCulled = false;
  group.add(masts, lamps, halos);

  // ---- fireworks: one pooled point cloud ----
  const SPARKS = 900;
  const sparkPos = new Float32Array(SPARKS * 3), sparkCol = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = pointsMat(false);
  sparkMat.uniforms.size = { value: 1.3 };
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  group.add(sparks);
  const sparkList: Spark[] = [];
  const shells: { p: THREE.Vector3; v: THREE.Vector3; fuse: number; colors: THREE.Color[]; big: boolean }[] = [];
  function firework(f: SiteFx, big = true) {
    const t = f.site.top;
    const brand = new THREE.Color(f.site.repo.brandColor || '#4fd1ff');
    const colors = [brand.clone().multiplyScalar(1.5), new THREE.Color(1.8, 1.25, 0.4), new THREE.Color(1.3, 0.35, 0.9)];
    const n = big ? 3 : 1;
    for (let k = 0; k < n; k++) {
      shells.push({
        p: new THREE.Vector3(t.x, t.y + 3, t.z),
        v: new THREE.Vector3((Math.random() - 0.5) * 6, 34 + Math.random() * 10, (Math.random() - 0.5) * 6),
        fuse: 1.1 + k * 0.55 + Math.random() * 0.3, colors, big,
      });
    }
  }
  function burst(at: THREE.Vector3, colors: THREE.Color[], big: boolean) {
    const n = big ? 220 : 120;
    for (let k = 0; k < n && sparkList.length < SPARKS; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar((big ? 20 : 13) * (0.75 + Math.random() * 0.25));
      sparkList.push({ p: at.clone(), v, c: colors[k % colors.length], life: 0, max: 1.6 + Math.random() * 0.9 });
    }
  }

  // ---- commit streaks: light running out of the door and down the street ----
  const STREAKS = 16;
  const streakGeo = new THREE.BoxGeometry(0.22, 0.22, 3.2);
  const streakMesh = new THREE.InstancedMesh(streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), STREAKS);
  streakMesh.count = 0;
  streakMesh.frustumCulled = false;
  group.add(streakMesh);
  const streaks: Streak[] = [];
  function commitStreaks(f: SiteFx, n: number) {
    const s = f.site;
    const color = new THREE.Color(s.repo.brandColor || '#4fd1ff').multiplyScalar(2.4);
    for (let k = 0; k < Math.min(n, 4) && streaks.length < STREAKS; k++) {
      const side = (streaks.length + k) % 2 ? 1 : -1;
      streaks.push({
        p: s.door.clone().setY(s.door.y + 0.35).addScaledVector(s.doorOut, 1.2),
        dir: s.doorOut.clone(),
        turn: new THREE.Vector3(-s.doorOut.z * side, 0, s.doorOut.x * side),
        leg: 0, t: -k * 0.45, color,
      });
    }
  }

  // ---- lit floors: one warm band of windows per agent at work ----
  // A tower is often several OSM building parts; the band wraps the outside of all of them at its height.
  type Part = { ring: number[]; base: number; top: number };
  const partsOf = (f: SiteFx): Part[] => {
    const s = f.site, own: Part = { ring: s.footprint ?? [], base: f.base, top: s.top.y };
    const near = o.partsNear?.(s.center.x, s.center.z, 90) ?? [];
    if (!near.length) return [own];
    const box = (r: number[]) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.max(b, r[i]); c = Math.min(c, r[i + 1]); d = Math.max(d, r[i + 1]); } return [a - 1.5, b + 1.5, c - 1.5, d + 1.5]; };
    const touch = (p: number[], q: number[]) => p[0] <= q[1] && q[0] <= p[1] && p[2] <= q[3] && q[2] <= p[3];
    const cluster: Part[] = [own], boxes = [box(own.ring)];
    // Parts of the same tower: close to its middle and nearly as tall (shorter neighbors sharing a wall stay dark).
    const h = s.top.y - f.base;
    const rest = near
      .filter((n) => n.ring.length >= 6 && Math.hypot(n.cx - s.center.x, n.cz - s.center.z) < Math.min(45, Math.max(22, h * 0.2)) && n.top - f.base >= h * 0.6)
      .map((n) => ({ part: { ring: n.ring, base: n.base, top: n.top }, b: box(n.ring) }));
    for (let grew = true; grew;) {
      grew = false;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (!boxes.some((b) => touch(b, rest[i].b))) continue;
        cluster.push(rest[i].part); boxes.push(rest[i].b); rest.splice(i, 1); grew = true;
      }
    }
    return cluster;
  };
  const wallsAt = (parts: Part[], y: number) => {
    const live = parts.filter((p) => p.base < y && p.top > y + 1);
    const out: SiteFx['walls'] = [];
    for (const p of live) {
      const ring = p.ring;
      for (let k = 0, n = ring.length / 2; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 2.5) continue;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (inRing(ring, mx + nx * 0.5, mz + nz * 0.5)) { nx = -nx; nz = -nz; }
        // Inside wall between two parts: nobody sees it.
        if (live.some((q) => q !== p && inRing(q.ring, mx + nx * 0.8, mz + nz * 0.8))) continue;
        out.push({ mx, mz, nx, nz, len });
      }
    }
    return out;
  };
  function band(f: SiteFx, k: number) {
    const s = f.site;
    // Only remember the parts once the detailed map around the HQ is actually loaded.
    const parts = f.parts ?? partsOf(f);
    if (parts.length > 1) f.parts = parts;
    const h = s.top.y - f.base;
    const frac = h < 14 ? 0.5 : 0.28 + 0.16 * k;
    const y = f.base + Math.max(3.5, Math.min(h - 3, h * frac));
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const bh = h < 14 ? 1.8 : 2.6;
    for (const w of wallsAt(parts, y)) {
      const tx = -w.nz, tz = w.nx; // along the wall
      const cx = w.mx + w.nx * 0.3, cz = w.mz + w.nz * 0.3;
      const v0 = pos.length / 3;
      const hx = tx * w.len * 0.48, hz = tz * w.len * 0.48;
      pos.push(cx - hx, y - bh / 2, cz - hz, cx + hx, y - bh / 2, cz + hz, cx + hx, y + bh / 2, cz + hz, cx - hx, y + bh / 2, cz - hz);
      const u = Math.max(1, Math.round(w.len / 3));
      uv.push(0, 0, u, 0, u, 1, 0, 1);
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, bandMat);
    m.matrixAutoUpdate = false;
    return m;
  }
  function setBands(f: SiteFx, n: number) {
    n = Math.min(n, 4);
    if (!f.walls.length && !o.partsNear) return;
    while (f.bands.length < n) { const m = band(f, f.bands.length); f.bands.push(m); group.add(m); }
    while (f.bands.length > n) { const m = f.bands.pop()!; m.geometry.dispose(); group.remove(m); }
  }

  // ---- stale projects: the signs fade, as if dust had settled on them ----
  function setStale(f: SiteFx, stale: boolean) {
    if (f.stale === stale) return;
    f.stale = stale;
    const g = o.scene.getObjectByName(`repo:${f.site.repo.name}`);
    g?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const ud = mesh.userData as { liveMat?: THREE.Material | THREE.Material[]; dustMat?: THREE.Material | THREE.Material[] };
      if (stale) {
        if (!ud.dustMat) {
          ud.liveMat = mesh.material;
          const dusty = (m: THREE.Material) => {
            const c = m.clone() as THREE.MeshBasicMaterial;
            if (c.color) { const l = c.color.getHSL({ h: 0, s: 0, l: 0 }); c.color.setHSL(l.h, l.s * 0.25, l.l * 0.55); }
            const e = (c as unknown as THREE.MeshStandardMaterial).emissiveIntensity;
            if (e != null) (c as unknown as THREE.MeshStandardMaterial).emissiveIntensity = e * 0.2;
            return c;
          };
          ud.dustMat = Array.isArray(mesh.material) ? mesh.material.map(dusty) : dusty(mesh.material);
        }
        mesh.material = ud.dustMat;
      } else if (ud.liveMat) mesh.material = ud.liveMat;
    });
  }

  // ---- reacting to the pulse ----
  const byRepo = new Map(fx.map((f) => [f.site.repo.name, f]));
  const ciOf = new Map<string, RepoPulse['ci']>();
  const liveCount = (repo: string) => { let n = 0; for (const a of o.agents().values()) if (a.repo === repo && live(a)) n++; return n; };
  function apply(f: SiteFx) {
    const p = pulse.get(f.site.repo.name);
    const ci = p?.ci ?? 'none';
    ciOf.set(f.site.repo.name, ci);
    setBands(f, Math.max(p?.activeAgents ?? 0, liveCount(f.site.repo.name)));
    setStale(f, !!p?.stale);
  }
  pulse.onChange((next, prev) => {
    const f = byRepo.get(next.repo);
    if (!f) return;
    apply(f);
    if (!prev) return;
    if (next.lastRelease && next.lastRelease.tag !== prev.lastRelease?.tag) firework(f, true);
    const seen = new Set(prev.recentCommits.map((c) => c.sha));
    const fresh = next.recentCommits.filter((c) => !seen.has(c.sha)).length;
    if (fresh && prev.recentCommits.length) commitStreaks(f, fresh);
  });
  fx.forEach(apply);
  let agentsSig = '';

  // ---- walk-by feed ----
  const camFwd = new THREE.Vector3(), toSite = new THREE.Vector3();
  function walkBy(player: THREE.Vector3, agl: number) {
    o.camera.getWorldDirection(camFwd);
    let looked: SiteFx | null = null, bestCos = Math.cos(THREE.MathUtils.degToRad(5));
    for (const f of fx) {
      const s = f.site;
      const d = Math.hypot(s.door.x - player.x, s.door.z - player.z);
      if (d > 160) { f.near = false; continue; }
      if (d < 60 && agl < 25 && !f.near) { f.near = announce(f); continue; }
      if (!f.near && d < 350) {
        toSite.set(s.center.x, f.base + (s.top.y - f.base) * 0.6, s.center.z).sub(o.camera.position).normalize();
        const c = toSite.dot(camFwd);
        if (c > bestCos) { bestCos = c; looked = f; }
      }
    }
    if (looked) looked.near = announce(looked);
  }
  /** Toast what's going on at this HQ; false while there's no pulse yet (try again on the next check). */
  function announce(f: SiteFx) {
    const p = pulse.get(f.site.repo.name);
    if (!p) return false;
    const parts = pulseSummary(p, liveCount(f.site.repo.name));
    if (!parts.length) return true;
    const ci = ciOf.get(f.site.repo.name);
    const dot = ci === 'failing' ? '<span style="color:#ff6b6b">●</span> ' : ci === 'passing' ? '<span style="color:#3ddc97">●</span> ' : '';
    toast(`${dot}<b>${esc(f.site.repo.name)}</b> · ${parts.map(esc).join(' · ')}`, 6000);
    return true;
  }

  // ---- per frame ----
  let clock = 0, feedT = 0;
  const tmp = new THREE.Vector3();
  const col = new THREE.Color();
  return {
    group,
    update(dt: number, player: THREE.Vector3, agl: number) {
      const on = o.visible();
      group.visible = on;
      if (!on) return;
      clock += dt;
      const nt = o.night?.() ?? 0;
      bandMat.color.setRGB(1.05 + 0.85 * nt, 0.92 + 0.66 * nt, 0.74 + 0.4 * nt);
      // Points are sized in meters: pixels per meter at 1 m for this camera and screen.
      const cam = o.camera as THREE.PerspectiveCamera;
      const px = (window.innerHeight * Math.min(window.devicePixelRatio || 1, 2)) / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 60) / 2)));
      halos.material.uniforms.scale.value = px;
      sparkMat.uniforms.scale.value = px;
      // Beacons: failing pulses fast, running breathes, passing holds steady.
      for (const f of fx) {
        const ci = ciOf.get(f.site.repo.name) ?? 'none';
        const k = ci === 'failing' ? 0.35 + 0.65 * Math.max(0, Math.sin(clock * 5 + f.i)) : ci === 'pending' ? 0.6 + 0.4 * Math.sin(clock * 2 + f.i) : 1;
        col.copy(CI_COLOR[ci]).multiplyScalar(k);
        lamps.setColorAt(f.i, ci === 'none' ? col.setRGB(0.08, 0.08, 0.09) : col);
        col.multiplyScalar(ci === 'none' ? 0 : 0.55);
        haloCol[f.i * 3] = col.r; haloCol[f.i * 3 + 1] = col.g; haloCol[f.i * 3 + 2] = col.b;
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      haloGeo.attributes.color.needsUpdate = true;

      // Agents come and go between pulses: keep the lit floors honest.
      feedT -= dt;
      if (feedT < 0) {
        feedT = 0.5;
        let s = '';
        for (const a of o.agents().values()) if (live(a)) s += a.id;
        if (s !== agentsSig) { agentsSig = s; fx.forEach(apply); }
        walkBy(player, agl);
        // A release in the last day goes up once when you first come close.
        for (const f of fx) {
          if (f.firstSight) continue;
          const p = pulse.get(f.site.repo.name);
          if (!p?.lastRelease) continue;
          if (Date.now() - Date.parse(p.lastRelease.publishedAt) > 86_400_000) { f.firstSight = true; continue; }
          if (Math.hypot(f.site.center.x - player.x, f.site.center.z - player.z) < 1200) { f.firstSight = true; firework(f, false); }
        }
      }

      // Fireworks
      for (let k = shells.length - 1; k >= 0; k--) {
        const sh = shells[k];
        sh.v.y -= 9.8 * dt;
        sh.p.addScaledVector(sh.v, dt);
        sh.fuse -= dt;
        if (sparkList.length < SPARKS) sparkList.push({ p: sh.p.clone(), v: new THREE.Vector3(0, -2, 0), c: CI_COLOR.pending, life: 0, max: 0.5 });
        if (sh.fuse <= 0) { burst(sh.p, sh.colors, sh.big); shells.splice(k, 1); }
      }
      let n = 0;
      for (let k = sparkList.length - 1; k >= 0; k--) {
        const s = sparkList[k];
        s.life += dt;
        if (s.life > s.max) { sparkList[k] = sparkList[sparkList.length - 1]; sparkList.pop(); continue; }
        s.v.multiplyScalar(1 - dt * 1.4);
        s.v.y -= 6 * dt;
        s.p.addScaledVector(s.v, dt);
      }
      for (const s of sparkList) {
        const fade = 1 - s.life / s.max;
        sparkPos[n * 3] = s.p.x; sparkPos[n * 3 + 1] = s.p.y; sparkPos[n * 3 + 2] = s.p.z;
        sparkCol[n * 3] = s.c.r * fade; sparkCol[n * 3 + 1] = s.c.g * fade; sparkCol[n * 3 + 2] = s.c.b * fade;
        n++;
      }
      sparkGeo.setDrawRange(0, n);
      sparks.visible = n > 0;
      if (n) { sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true; }

      // Commit streaks: out to the curb, then along the street.
      let m = 0;
      for (let k = streaks.length - 1; k >= 0; k--) {
        const s = streaks[k];
        s.t += dt;
        if (s.t < 0) continue;
        const v = 26 * dt;
        if (s.leg < 6) { s.p.addScaledVector(s.dir, v); s.leg += v; if (s.leg >= 6) s.dir.copy(s.turn); }
        else { s.p.addScaledVector(s.dir, v); s.leg += v; }
        if (s.leg > 150) { streaks.splice(k, 1); }
      }
      for (const s of streaks) {
        if (s.t < 0) continue;
        tmp.copy(s.p).add(s.dir);
        m4.lookAt(s.p, tmp, THREE.Object3D.DEFAULT_UP).setPosition(s.p);
        streakMesh.setMatrixAt(m, m4);
        streakMesh.setColorAt(m, col.copy(s.color).multiplyScalar(Math.min(1, (150 - s.leg) / 30)));
        m++;
      }
      streakMesh.count = m;
      if (m) { streakMesh.instanceMatrix.needsUpdate = true; streakMesh.instanceColor!.needsUpdate = true; }
    },
    /** Testing hooks (window.__ow.pulse). */
    debug: {
      inject: (repo: string, patch: Partial<RepoPulse>) => pulse.inject(repo, patch),
      release: (repo: string) => { const f = byRepo.get(repo); if (f) firework(f, true); },
      commits: (repo: string, n = 3) => { const f = byRepo.get(repo); if (f) commitStreaks(f, n); },
      get(repo: string) { return pulse.get(repo); },
      sites: () => fx.map((f) => f.site.repo.name),
      fx: (repo: string) => { const f = byRepo.get(repo); return f && { walls: f.walls.length, bands: f.bands.length, parts: f.parts?.length, base: f.base, top: f.site.top.y }; },
    },
  };
}
