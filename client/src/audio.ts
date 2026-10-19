/** Procedural city ambience: traffic rumble, distant horns, aircraft overhead. No audio files needed. */
export class Ambience {
  private ctx: AudioContext | null = null;
  private rumble!: GainNode;
  private jet!: GainNode;
  private jetFilter!: BiquadFilterNode;
  private hornTimer = 4;
  indoor = false;

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = (gain: GainNode, filter: BiquadFilterNode) => {
      const s = ctx.createBufferSource();
      s.buffer = noise; s.loop = true;
      s.connect(filter).connect(gain).connect(ctx.destination);
      s.start();
    };
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    src(this.rumble, lp);
    this.jet = ctx.createGain(); this.jet.gain.value = 0;
    this.jetFilter = ctx.createBiquadFilter(); this.jetFilter.type = 'lowpass'; this.jetFilter.frequency.value = 300;
    src(this.jet, this.jetFilter);
  }

  update(dt: number, nearestAircraft: number, night: number) {
    const ctx = this.ctx;
    if (!ctx) return;
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
    const ctx = this.ctx!;
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
    g.connect(lp).connect(pan).connect(ctx.destination);
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
