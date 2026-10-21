import * as THREE from 'three';
import type { Engine } from '../engine.ts';
import type { Input } from '../input.ts';
import type { Player } from '../player.ts';
import type { EarthApi } from '../earth/index.ts';
import type { VehicleId } from '../vehicles/index.ts';
import { toast } from '../ui/panel.ts';
import { CanvasPanel } from './canvasPanel.ts';
import { PanelMirror } from './mirror.ts';
import type { XrPhoneSource } from './phoneSource.ts';
import { WristPhone } from './wristPhone.ts';
import { xrSettings } from './settings.ts';

export { xrSettings } from './settings.ts';
export { apiPhoneSource } from './phoneSource.ts';

/** What VR needs from the game (main.ts provides these). */
export interface XrHooks {
  engine: Engine;
  input: Input;
  player: Player;
  robot: { root: THREE.Object3D };
  earth: EarthApi | null;
  sun(): THREE.DirectionalLight | null;
  vehicles: { key: string; id: VehicleId; label: string; icon: string }[];
  phone: XrPhoneSource;
  status(): { place: string; time: string };
  skipTime(): void;
  panelOpen(): boolean;
  closePanel(): void;
}

export interface Xr {
  /** Controllers → game input, and the player's heading from your head. Call before player.update. */
  beforePlayer(dt: number): void;
  /** Move the play space with the player; panels, vignette, HUD. Call after player.update. */
  afterPlayer(dt: number): void;
  /** The world re-centered (long flights): move the play space by the same map. */
  shift(map: (v: THREE.Vector3) => void): void;
  readonly presenting: boolean;
}

// Quest (xr-standard gamepad) button indices.
const TRIGGER = 0, GRIP = 1, STICK = 3, A_X = 4, B_Y = 5;
const SNAP = Math.PI / 6, SMOOTH_TURN = 2.1; // rad/s
const dz = (v: number, d = 0.18) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

/**
 * VR on a Meta Quest (WebXR): an "Enter VR" button, stick locomotion at the game's walk/run speeds,
 * snap or smooth turning, a comfort vignette, first-person or behind-the-robot view, a wrist phone,
 * and floating copies of the game's panels. The keyboard game code runs unchanged: controllers feed
 * `input.virtual` (held keys + stick) and `input.press` (taps).
 *
 * The play space follows the player through an offset reference space, so the camera (and everything
 * that reads camera.position: sky, fog, streaming, waves) stays in world coordinates.
 */
export function installXR(h: XrHooks): Xr {
  const { engine, input, player } = h;
  const renderer = engine.renderer;
  const group = new THREE.Group();
  group.name = 'xr';
  let session: XRSession | null = null;
  let base: XRReferenceSpace | null = null;

  // ---------------------------------------------------------------- rig state
  let rigYaw = 0;
  const rigPos = new THREE.Vector3();
  const prevRig = new THREE.Matrix4();
  let rigInit = false;
  const head = new THREE.Vector3(); // head position in the base (room) space
  const headQ = new THREE.Quaternion();
  const prevHead = new THREE.Vector3();
  let haveHead = false;
  let lastFacing = 0;
  let snapLatch = false;
  let turnRate = 0;
  let runLock = false;
  let vehicleIdx = 0;

  // ---------------------------------------------------------------- controllers
  type Hand = { ray: THREE.Group; grip: THREE.Group; src: XRInputSource | null; prev: boolean[] };
  const hands: Hand[] = [0, 1].map((i) => {
    const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
    const hand: Hand = { ray, grip, src: null, prev: [] };
    ray.addEventListener('connected', (e) => { hand.src = (e as unknown as { data: XRInputSource }).data; });
    ray.addEventListener('disconnected', () => { hand.src = null; hand.prev = []; });
    group.add(ray, grip);
    return hand;
  });
  const side = (s: XRHandedness) => hands.find((x) => x.src?.handedness === s) ?? null;

  // A simple controller body for each hand.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.2 });
  for (const hd of hands) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 10), bodyMat);
    body.rotation.x = Math.PI / 2 - 0.6; body.position.set(0, -0.01, 0.03);
    hd.grip.add(body);
  }

  // Pointer ray on the right hand.
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x9fc2ff, transparent: true, opacity: 0.7, fog: false, depthTest: false }));
  rayLine.renderOrder = 1001;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthTest: false }));
  dot.renderOrder = 1002;
  group.add(dot);

  // ---------------------------------------------------------------- wrist phone, panel mirror, HUD
  const wrist = new WristPhone({
    source: h.phone,
    status: h.status,
    vehicles: h.vehicles,
    vehicle: () => player.vehicle,
    ride: (id) => { const v = h.vehicles.find((x) => x.id === id); if (v) input.press(v.key); },
    skipTime: h.skipTime,
    exitVr: () => { void session?.end(); },
  });
  const mirror = new PanelMirror();
  mirror.mesh.visible = false;
  group.add(mirror.mesh);
  let mirrorWas = false;

  const hud = new CanvasPanel(1024, 220, 0.95);
  hud.mesh.visible = false;
  group.add(hud.mesh);
  let hudSig = '';
  let hudYaw = 0, hudFollow = false;

  // Comfort vignette: a small sphere around the head, dark outside a clear circle that shrinks with motion.
  const vig = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt; varying vec3 vP;
        void main() {
          float c = -normalize(vP).z; // cos of the angle from straight ahead
          float r = mix(1.4, 0.5, uAmt); // clear radius (rad)
          float a = 1.0 - smoothstep(cos(r + 0.35), cos(r), c);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a * min(1.0, uAmt * 2.5));
        }`,
      side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false,
    }),
  );
  vig.renderOrder = 999;
  vig.frustumCulled = false;
  vig.visible = false;
  group.add(vig);
  let vigAmt = 0;

  // ---------------------------------------------------------------- Enter VR button
  const css = document.createElement('style');
  css.textContent = `
    #vr-btn { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 70px); transform: translateX(-50%); z-index: 40; display: flex; align-items: center; gap: 8px;
      padding: 10px 18px; border: 0; border-radius: 999px; background: rgba(16,18,24,0.82); color: #fff; font: 600 14px/1 system-ui, sans-serif;
      box-shadow: 0 4px 18px rgba(0,0,0,0.3); cursor: pointer; backdrop-filter: blur(8px); }
    #vr-btn:hover { background: #2f6bff; }
    #vr-btn.hint { background: rgba(16,18,24,0.7); font-weight: 500; }
    #vr-btn svg { width: 22px; height: 22px; }
    body.photo-mode #vr-btn { display: none; }`;
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'vr-btn';
  btn.className = 'hidden';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v6a2.5 2.5 0 0 1-2.5 2.5h-3.2l-1.6-2.2a2 2 0 0 0-3.4 0L8.7 17H5.5A2.5 2.5 0 0 1 3 14.5z"/><circle cx="8" cy="11.5" r="1.6"/><circle cx="16" cy="11.5" r="1.6"/></svg><span>Enter VR</span>`;
  document.body.appendChild(btn);
  const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
  let supported = false;
  const refreshButton = () => {
    const on = xrSettings.get().enabled && !session;
    if (on && supported) { btn.classList.remove('hidden', 'hint'); btn.querySelector('span')!.textContent = 'Enter VR'; }
    else if (on && quest && !window.isSecureContext) {
      // Quest over plain http on the LAN: WebXR is switched off. Say how to fix it.
      btn.classList.remove('hidden'); btn.classList.add('hint');
      btn.querySelector('span')!.textContent = 'VR needs the https:// address (npm run vr)';
    } else btn.classList.add('hidden');
  };
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => { supported = ok; refreshButton(); }).catch(() => {});
  xrSettings.onChange(refreshButton);
  btn.addEventListener('click', () => { if (supported) void enter(); });

  async function enter() {
    if (session || !navigator.xr) return;
    try {
      const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'layers'] });
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local-floor');
      renderer.xr.setFoveation(1);
      await renderer.xr.setSession(s);
      session = s;
      s.addEventListener('end', leave);
      base = renderer.xr.getReferenceSpace();
      start();
    } catch (e) {
      toast(`Couldn't start VR: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- session start / end
  let shadowWas = 0;
  let clipWas: [number, number] = [0.25, 30000];
  function start() {
    player.xrView = true;
    // A nearer near plane so the phone on your wrist isn't clipped (and a nearer far one to keep depth precision).
    const cam = engine.camera;
    clipWas = [cam.near, cam.far];
    cam.near = 0.08; cam.far = 12000; cam.updateProjectionMatrix();
    hudYaw = player.facing;
    rigInit = false;
    haveHead = false;
    rigYaw = player.facing + Math.PI; // look the way the robot faces
    lastFacing = player.facing;
    h.earth?.setLite(true);
    // A smaller shadow map: every frame is drawn twice on a mobile GPU.
    const sun = h.sun();
    if (sun) { shadowWas = sun.shadow.mapSize.x; sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    refreshButton();
    toast('VR: left stick to move, A to jump (hold for rockets), X for your phone.', 6000);
  }

  function leave() {
    session = null;
    base = null;
    renderer.xr.enabled = false;
    player.xrView = false;
    h.robot.root.visible = true;
    [engine.camera.near, engine.camera.far] = clipWas;
    engine.camera.updateProjectionMatrix();
    input.virtual.keys.clear(); input.virtual.x = input.virtual.y = 0;
    h.earth?.setLite(false);
    const sun = h.sun();
    if (sun && shadowWas) { sun.shadow.mapSize.set(shadowWas, shadowWas); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    group.removeFromParent();
    engine.resize();
    player.snapCamera();
    refreshButton();
  }

  // ---------------------------------------------------------------- per frame
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), yAxis = new THREE.Vector3(0, 1, 0);
  const raycaster = new THREE.Raycaster();
  const fwd = new THREE.Vector3();

  /** World yaw (the player's convention: forward = (sin, cos)) of a quaternion in the room space. */
  const worldYaw = (q: THREE.Quaternion) => {
    fwd.set(0, 0, -1).applyQuaternion(tmpQ.setFromAxisAngle(yAxis, rigYaw).multiply(q));
    return Math.atan2(fwd.x, fwd.z);
  };

  const pressedEdge = (hd: Hand | null, i: number) => {
    const b = hd?.src?.gamepad?.buttons[i];
    const now = !!b?.pressed, was = !!hd?.prev[i];
    return now && !was;
  };
  const held = (hd: Hand | null, i: number) => !!hd?.src?.gamepad?.buttons[i]?.pressed;
  const axis = (hd: Hand | null, i: number) => hd?.src?.gamepad?.axes[i] ?? 0;

  /** What the right-hand ray points at (wrist phone or mirror), as a panel + uv. */
  function aim(): { p: CanvasPanel; uv: THREE.Vector2; d: number } | null {
    const r = side('right') ?? hands[1];
    if (!r.src) return null;
    r.ray.updateMatrixWorld();
    raycaster.ray.origin.setFromMatrixPosition(r.ray.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).transformDirection(r.ray.matrixWorld);
    const targets: CanvasPanel[] = [];
    if (wrist.visible) targets.push(wrist.panel);
    if (mirror.mesh.visible) targets.push(mirror.panel);
    let best: { p: CanvasPanel; uv: THREE.Vector2; d: number } | null = null;
    for (const p of targets) {
      p.mesh.updateMatrixWorld();
      const hit = raycaster.intersectObject(p.mesh, false)[0];
      if (hit?.uv && (!best || hit.distance < best.d)) best = { p, uv: hit.uv.clone(), d: hit.distance };
    }
    return best;
  }

  function beforePlayer(dt: number) {
    if (!session || !base) return;
    if (group.parent !== engine.scene) engine.scene.add(group);
    const frame = renderer.xr.getFrame();
    const pose = frame?.getViewerPose(base);
    if (pose) {
      const t = pose.transform;
      head.set(t.position.x, t.position.y, t.position.z);
      headQ.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
    }
    const s = xrSettings.get();
    const L = side('left') ?? hands[0], R = side('right') ?? hands[1];
    const riding = player.vehicle !== 'foot';

    // Turning (right stick x).
    const rx = dz(axis(R, 2));
    turnRate = 0;
    if (s.turn === 'snap') {
      if (Math.abs(rx) > 0.7 && !snapLatch) { rigYaw -= Math.sign(rx) * SNAP; snapLatch = true; }
      else if (Math.abs(rx) < 0.3) snapLatch = false;
    } else { rigYaw -= rx * SMOOTH_TURN * dt; turnRate = Math.abs(rx); }
    // Riding: the play space turns with the vehicle.
    if (riding) { let d = player.facing - lastFacing; d = Math.atan2(Math.sin(d), Math.cos(d)); rigYaw += d; }
    lastFacing = player.facing;

    // Walking around the room moves the robot too (first person, on foot).
    if (pose && haveHead && s.view === 'first' && !riding) {
      tmpV.set(head.x - prevHead.x, 0, head.z - prevHead.z).applyAxisAngle(yAxis, rigYaw);
      if (tmpV.lengthSq() < 0.25) { player.position.x += tmpV.x; player.position.z += tmpV.z; }
    }
    if (pose) { prevHead.copy(head); haveHead = true; }

    // Head direction steers.
    player.yaw = worldYaw(headQ);
    player.pitch = 0.18;

    // Sticks and buttons → the keyboard the game already understands.
    const v = input.virtual;
    v.x = dz(axis(L, 2));
    v.y = -dz(axis(L, 3));
    v.keys.clear();
    if (pressedEdge(L, STICK)) runLock = !runLock;
    if (Math.hypot(v.x, v.y) < 0.05 && !player.flying) runLock = false;
    if (held(L, GRIP) || held(L, TRIGGER) || runLock) v.keys.add('ShiftLeft');
    if (held(R, A_X)) v.keys.add('Space');
    if (dz(axis(R, 3)) > 0.6) v.keys.add('KeyC');

    // Taps.
    const target = aim();
    const hoverId = target ? target.p.hitAt(target.uv)?.id ?? null : null;
    for (const p of [wrist.panel, mirror.panel]) p.hover = target?.p === p ? hoverId : null;
    if (pressedEdge(R, TRIGGER)) {
      if (target) target.p.hitAt(target.uv)?.onClick();
      else if (!h.panelOpen()) input.press('KeyE');
    }
    if (pressedEdge(R, B_Y)) { if (h.panelOpen()) h.closePanel(); else input.press('KeyE'); }
    if (pressedEdge(L, A_X)) wrist.visible = !wrist.visible;
    if (pressedEdge(L, B_Y)) {
      // Step through them (one that can't start here, like a boat on dry land, is skipped next press).
      vehicleIdx = (vehicleIdx + 1) % h.vehicles.length;
      if (h.vehicles[vehicleIdx].id === player.vehicle) vehicleIdx = (vehicleIdx + 1) % h.vehicles.length;
      input.press(h.vehicles[vehicleIdx].key);
    }
    if (pressedEdge(R, STICK)) xrSettings.set({ view: s.view === 'first' ? 'third' : 'first' });

    // Pointer visuals.
    const showRay = !!R.src && (wrist.visible || mirror.mesh.visible);
    if (rayLine.parent !== R.ray) R.ray.add(rayLine);
    rayLine.visible = showRay;
    rayLine.scale.z = target ? target.d : 1.5;
    dot.visible = showRay && !!target;
    if (target) dot.position.copy(raycaster.ray.at(target.d, tmpV));
    if (wrist.group.parent !== L.grip) L.grip.add(wrist.group);

    for (const hd of hands) hd.prev = hd.src?.gamepad?.buttons.map((b) => b.pressed) ?? [];
  }

  function afterPlayer(dt: number) {
    if (!session || !base) return;
    const s = xrSettings.get();
    const riding = player.vehicle !== 'foot';
    const p = player.position;
    const hx = tmpV.set(head.x, 0, head.z).applyAxisAngle(yAxis, rigYaw);
    const want = new THREE.Vector3();
    if (s.view === 'first') {
      want.set(p.x - hx.x, p.y, p.z - hx.z);
      rigPos.copy(want);
      h.robot.root.visible = false;
    } else {
      // Behind and above the robot, looking the way the play space faces.
      const dist = riding ? (player.vehicle === 'plane' ? 11 : 5.5) : player.flying ? 5 : 3.6;
      const fx = -Math.sin(rigYaw), fz = -Math.cos(rigYaw);
      want.set(p.x - fx * dist - hx.x, p.y + 1.0, p.z - fz * dist - hx.z);
      if (!rigInit || rigPos.distanceTo(want) > 40) rigPos.copy(want);
      else rigPos.lerp(want, 1 - Math.exp(-dt * 6));
      h.robot.root.visible = true;
    }
    rigInit = true;

    // Where the eyes are this frame: the pose was resolved with last frame's space.
    const eye = tmpM.copy(prevRig);
    const eyePos = head.clone().applyMatrix4(eye);
    const eyeQ = new THREE.Quaternion().setFromRotationMatrix(eye).multiply(headQ);

    // New play-space offset (used from the next frame): inverse of rig = T(rigPos) · Ry(rigYaw).
    const rig = new THREE.Matrix4().makeRotationY(rigYaw).setPosition(rigPos);
    prevRig.copy(rig);
    const inv = rig.clone().invert();
    const ip = new THREE.Vector3(), iq = new THREE.Quaternion(), is = new THREE.Vector3();
    inv.decompose(ip, iq, is);
    renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: ip.x, y: ip.y, z: ip.z }, { x: iq.x, y: iq.y, z: iq.z, w: iq.w })));

    // Comfort vignette from speed and turning.
    const speed = player.vehicle !== 'foot' ? player.vehicleSpeed : Math.hypot(player.vel.x, player.vel.z, player.flying ? player.vel.y : 0);
    const goal = s.vignette ? THREE.MathUtils.clamp(speed / 10 + turnRate * 0.6, 0, 0.8) : 0;
    vigAmt = THREE.MathUtils.damp(vigAmt, goal, 4, dt);
    vig.visible = vigAmt > 0.02;
    vig.position.copy(eyePos); vig.quaternion.copy(eyeQ);
    (vig.material as THREE.ShaderMaterial).uniforms.uAmt.value = vigAmt;

    // Panels the game opened (desk talks, Agent Lab...): float a copy in front of you.
    const open = !!PanelMirror.source();
    if (open && !mirrorWas) {
      const y = worldYaw(headQ);
      mirror.mesh.position.set(eyePos.x + Math.sin(y) * 1.4, eyePos.y - 0.1, eyePos.z + Math.cos(y) * 1.4);
      mirror.mesh.rotation.set(0, y + Math.PI, 0);
      mirror.reset();
    }
    mirrorWas = open;
    mirror.mesh.visible = open;
    if (open) mirror.update(dt, h.closePanel);

    wrist.update(dt);

    // Heads-up line: the "Press E" prompt and the newest toast, lazily following your gaze.
    const prompt = document.getElementById('prompt');
    const promptText = prompt && !prompt.classList.contains('hidden')
      ? [...prompt.childNodes].filter((n) => (n as HTMLElement).tagName !== 'KBD').map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' · ')
      : '';
    const last = document.getElementById('toasts')?.lastElementChild as HTMLElement | null;
    const toastText = (last?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const sig = `${promptText}|${toastText}`;
    hud.mesh.visible = !!(promptText || toastText) && !open;
    if (sig !== hudSig) {
      hudSig = sig;
      hud.draw((c) => {
        let y = 10;
        if (promptText) { c.rect(212, y, 600, 84, 42, 'rgba(14,16,22,0.85)'); c.text(`B  ${promptText}`, 512, y + 42, 34, '#fff', 700, 'center', 560); y += 100; }
        if (toastText) {
          const lines = c.wrap(toastText, 940, 26).slice(0, 3);
          c.rect(24, y, 976, lines.length * 34 + 24, 22, 'rgba(14,16,22,0.78)');
          lines.forEach((l, i) => c.text(l, 512, y + 29 + i * 34, 26, '#e6e8ee', 400, 'center'));
        }
      });
    }
    const gy = worldYaw(headQ);
    let dy = gy - hudYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (Math.abs(dy) > 0.45) hudFollow = true;
    else if (Math.abs(dy) < 0.05) hudFollow = false;
    if (hudFollow) hudYaw += dy * Math.min(1, dt * 4);
    hud.mesh.position.set(eyePos.x + Math.sin(hudYaw) * 1.6, eyePos.y - 0.45, eyePos.z + Math.cos(hudYaw) * 1.6);
    hud.mesh.rotation.set(0, hudYaw + Math.PI, 0);
  }

  /** The world re-centered under us (long flights): move the play space with it, this frame. */
  function shift(map: (v: THREE.Vector3) => void) {
    if (!session || !base) return;
    map(rigPos);
    const rig = new THREE.Matrix4().makeRotationY(rigYaw).setPosition(rigPos);
    prevRig.copy(rig);
    const ip = new THREE.Vector3(), iq = new THREE.Quaternion(), is = new THREE.Vector3();
    rig.invert().decompose(ip, iq, is);
    renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: ip.x, y: ip.y, z: ip.z }, { x: iq.x, y: iq.y, z: iq.z, w: iq.w })));
  }

  return { beforePlayer, afterPlayer, shift, get presenting() { return !!session; } };
}
