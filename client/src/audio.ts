import { onPrefs, soundLevel } from './prefs.ts';

// All game sound is synthesized with WebAudio: no audio files. One context and one master bus, so the
// settings' volume and mute apply to everything, live.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 1;
let muted = false;
let noiseBuf: AudioBuffer | null = null;
let brownBuf: AudioBuffer | null = null;

/** The shared context and master bus (created on first use, resumed on the first click or key). */
function audio(): { ctx: AudioContext; out: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = level();
    master.connect(ctx.destination);
    const resume = () => { if (ctx?.state === 'suspended') void ctx.resume(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, resume, { passive: true });
  }
  return { ctx, out: master! };
}

/** Settings (volume, mute) times any local override below. */
const level = () => (muted ? 0 : volume * soundLevel());
const applyLevel = () => { if (master && ctx) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05); };
onPrefs(applyLevel);

/** Extra volume scale 0..1 on top of the settings (e.g. photo mode); settings normally drive this. */
export function setMasterVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  applyLevel();
}

export function setMuted(m: boolean) {
  muted = m;
  applyLevel();
}

/** Two seconds of white noise (hiss, wind, flame) and four of brown noise (rumble), shared. */
function noise(brown = false): AudioBuffer {
  const { ctx } = audio();
  if (brown && brownBuf) return brownBuf;
  if (!brown && noiseBuf) return noiseBuf;
  const buf = ctx.createBuffer(1, ctx.sampleRate * (brown ? 4 : 2), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return brown ? (brownBuf = buf) : (noiseBuf = buf);
}

function loop(buf: AudioBuffer, ...chain: AudioNode[]) {
  const { ctx } = audio();
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true;
  s.loopStart = 0; s.playbackRate.value = 1;
  let n: AudioNode = s;
  for (const c of chain) n = n.connect(c);
  s.start(0, Math.random() * buf.duration);
  return s;
}

/** Procedural city ambience: traffic rumble, distant horns, aircraft overhead. */
export class Ambience {
  private rumble!: GainNode;
  private jet!: GainNode;
  private jetFilter!: BiquadFilterNode;
  private hornTimer = 4;
  private started = false;
  indoor = false;

  start() {
    if (this.started) return;
    this.started = true;
    const { ctx, out } = audio();
    if (ctx.state === 'suspended') void ctx.resume();
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    loop(noise(true), lp, this.rumble, out);
    this.jet = ctx.createGain(); this.jet.gain.value = 0;
    this.jetFilter = ctx.createBiquadFilter(); this.jetFilter.type = 'lowpass'; this.jetFilter.frequency.value = 300;
    loop(noise(true), this.jetFilter, this.jet, out);
  }

  update(dt: number, nearestAircraft: number, night: number) {
    if (!this.started || !ctx) return;
    const t = ctx.currentTime;
    const base = this.indoor ? 0.04 : 0.32 - night * 0.12;
    this.rumble.gain.setTargetAtTime(base, t, 0.4);
    const jet = this.indoor ? 0 : Math.max(0, 1 - nearestAircraft / 900) ** 2 * 0.5;
    this.jet.gain.setTargetAtTime(jet, t, 0.6);
    this.jetFilter.frequency.setTargetAtTime(200 + jet * 900, t, 0.6);
    if (!this.indoor) {
      this.hornTimer -= dt;
      if (this.hornTimer < 0) { this.hornTimer = 5 + Math.random() * 16; this.horn(); }
    }
  }

  private horn() {
    const { ctx, out } = audio();
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0;
    const vol = 0.02 + Math.random() * 0.04;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    const f = 340 + Math.random() * 120;
    for (const mul of [1, 1.26]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * mul;
      o.connect(g); o.start(t); o.stop(t + 0.9);
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    g.connect(lp).connect(pan).connect(out);
    const len = Math.random() < 0.5 ? 0.25 : 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.05);
    if (Math.random() < 0.4) {
      g.gain.setValueAtTime(vol, t + len + 0.15);
      g.gain.linearRampToValueAtTime(0, t + len + 0.35);
    }
  }
}

/**
 * The player's body sounds: wind rushing past (follows airspeed), the rocket shoes (ignition roar,
 * a thrust loop pitched by throttle, a sputter on cut-off), and landings (a thud scaled by impact).
 * Loops are built on the first update after audio is allowed.
 */
export class BodySounds {
  private on = false;
  private wind!: GainNode;
  private windLp!: BiquadFilterNode;
  private windBp!: BiquadFilterNode;
  private whistle!: GainNode;
  private thrust!: GainNode;
  private thrustLp!: BiquadFilterNode;
  private thrustSrc!: AudioBufferSourceNode;
  private rumble!: GainNode;
  private gust = 0;

  private build() {
    const { ctx, out } = audio();
    // Wind: low roar (lowpassed noise) plus a higher whistle band that opens up with speed.
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    this.windLp = ctx.createBiquadFilter(); this.windLp.type = 'lowpass'; this.windLp.frequency.value = 300; this.windLp.Q.value = 0.7;
    loop(noise(), this.windLp, this.wind, out);
    this.whistle = ctx.createGain(); this.whistle.gain.value = 0;
    this.windBp = ctx.createBiquadFilter(); this.windBp.type = 'bandpass'; this.windBp.frequency.value = 900; this.windBp.Q.value = 2.5;
    loop(noise(), this.windBp, this.whistle, out);
    // Rocket shoes: hissing flame (noise through a lowpass that opens with throttle) over a rumble.
    this.thrust = ctx.createGain(); this.thrust.gain.value = 0;
    this.thrustLp = ctx.createBiquadFilter(); this.thrustLp.type = 'lowpass'; this.thrustLp.frequency.value = 800;
    this.thrustSrc = loop(noise(), this.thrustLp, this.thrust, out);
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 160;
    loop(noise(true), rlp, this.rumble, out);
    this.on = true;
  }

  private ready() {
    if (!ctx || ctx.state !== 'running') return false;
    if (!this.on) this.build();
    return true;
  }

  /**
   * Each frame: airspeed (m/s, relative to still air), rocket throttle 0..1.6, and whether you're
   * indoors (no wind) or riding something that makes its own noise (quieter wind).
   */
  update(dt: number, airspeed: number, rockets: number, indoor = false) {
    if (!this.ready()) return;
    const t = ctx!.currentTime;
    this.gust += dt;
    const g = 0.85 + 0.15 * Math.sin(this.gust * 1.3) * Math.sin(this.gust * 0.47 + 1);
    // Wind is silent at a jog, a rush at skydiving speed (~55 m/s), a roar beyond.
    const w = indoor ? 0 : Math.min(1, Math.max(0, (airspeed - 5) / 55));
    this.wind.gain.setTargetAtTime(0.75 * w ** 1.4 * g, t, 0.12);
    this.windLp.frequency.setTargetAtTime(260 + airspeed * 32, t, 0.15);
    this.whistle.gain.setTargetAtTime(0.12 * Math.max(0, w - 0.3) * g, t, 0.2);
    this.windBp.frequency.setTargetAtTime(700 + airspeed * 14, t, 0.3);
    const r = Math.min(1.6, Math.max(0, rockets));
    const on = r > 0.05 ? 1 : 0;
    this.thrust.gain.setTargetAtTime(on * (0.05 + 0.2 * Math.min(1, r)) * (1 + 0.4 * Math.max(0, r - 1)), t, 0.05);
    this.thrustLp.frequency.setTargetAtTime(500 + 1900 * Math.min(1, r) + 1500 * Math.max(0, r - 1), t, 0.06);
    this.thrustSrc.playbackRate.setTargetAtTime(0.75 + 0.35 * Math.min(1.6, r), t, 0.08);
    this.rumble.gain.setTargetAtTime(on * 0.5 * Math.min(1.3, r), t, 0.07);
  }

  /** Ignition: a whump and a tearing roar that settles into the thrust loop. */
  ignite(strength = 1) {
    if (!this.ready()) return;
    const { ctx, out } = audio();
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.85 * strength, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    s.connect(lp).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + 1);
    this.boom(t, 75, 0.9 * strength, 0.45);
  }

  /** Cut-off: the flame coughs out in a few pops. */
  sputter() {
    if (!this.ready()) return;
    const { ctx, out } = audio();
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const s = ctx.createBufferSource(); s.buffer = noise();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 - i * 300;
      const g = ctx.createGain();
      const v = 0.22 / (i + 1);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      s.connect(lp).connect(g).connect(out);
      s.start(t, Math.random()); s.stop(t + 0.12);
      t += 0.07 + Math.random() * 0.06;
    }
  }

  /** A landing: thump in the chest plus grit, by impact speed (m/s). */
  thud(impact: number) {
    if (!this.ready() || impact < 2.5) return;
    const { ctx, out } = audio();
    const t = ctx.currentTime;
    const k = Math.min(1, impact / 40);
    this.boom(t, 95 - 40 * k, 0.25 + 0.75 * k, 0.15 + 0.3 * k);
    const s = ctx.createBufferSource(); s.buffer = noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + 1800 * k;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 * k + 0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.35 * k);
    s.connect(lp).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + 0.6);
  }

  private boom(t: number, freq: number, vol: number, len: number) {
    const { ctx, out } = audio();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + len + 0.05);
  }
}
