// The city's sound, synthesised: gunshots by weapon with distance and stereo, explosions,
// impacts, footsteps, reloads, vehicle engines that follow revs, sirens, and a city hum.
// Follows the engine's mute (M) and the volume setting.

import { sound } from "kimi/game";

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.engines = new Map();
  }
  start() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 5;
    this.master = c.createGain();
    this.master.connect(this.comp).connect(c.destination);
    const n = c.sampleRate * 2;
    this.noise = c.createBuffer(1, n, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // brown noise for rumbles
    this.brown = c.createBuffer(1, n, c.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    // city hum
    const hum = c.createBufferSource(); hum.buffer = this.brown; hum.loop = true;
    const hf = c.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 380;
    this.humGain = c.createGain(); this.humGain.gain.value = 0.05;
    hum.connect(hf).connect(this.humGain).connect(this.master); hum.start();
  }
  get ready() { return !!this.ctx && this.ctx.state === "running"; }

  setListener(x, y, z, yaw) { Object.assign(this.listener, { x, y, z, yaw }); }
  update() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(sound.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** gain and pan for a sound at p (null: at the listener) */
  place(p, range = 120) {
    const c = this.ctx;
    const g = c.createGain(), pan = c.createStereoPanner();
    if (!p) { g.gain.value = 1; pan.pan.value = 0; }
    else {
      const dx = p[0] - this.listener.x, dz = p[2] - this.listener.z;
      const d = Math.hypot(dx, dz, (p[1] ?? 0) - this.listener.y);
      g.gain.value = 1 / (1 + (d / (range * 0.18)) ** 1.6);
      // right of the listener = positive pan (camera yaw: forward is (sin, -cos)?) use the angle
      const ang = Math.atan2(dz, dx) - this.listener.yaw;
      pan.pan.value = Math.max(-1, Math.min(1, Math.sin(ang) * Math.min(1, d / 4)));
    }
    g.connect(pan).connect(this.master);
    return g;
  }
  burst(out, dur, f0, f1, vol, type = "lowpass", when = 0, buf = this.noise, q = 0.7) {
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  tone(out, f0, f1, dur, vol, type = "sine", when = 0) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  shot(kind, p) {
    if (!this.ready) return;
    const out = this.place(p, kind === "sniper" ? 400 : 200);
    const P = {
      pistol: [0.16, 0.5, 2600], rifle: [0.2, 0.55, 2200], shotgun: [0.38, 0.9, 1500], sniper: [0.55, 1.0, 1800], rocket: [0.6, 0.6, 900],
    }[kind] ?? [0.2, 0.5, 2000];
    const [dur, vol, f] = P;
    this.burst(out, dur * 0.35, f * 2.2, f * 0.6, vol, "bandpass", 0, this.noise, 0.9);   // crack
    this.burst(out, dur, f * 0.4, 60, vol * 0.9, "lowpass");                                // body
    this.tone(out, kind === "sniper" ? 90 : 130, 40, dur * 0.8, vol * 0.7);                // thump
    if (kind !== "rocket" && p) {                                                            // tail off the buildings
      this.burst(out, dur * 2.5, 900, 200, vol * 0.12, "lowpass", 0.08);
    }
  }
  explosion(p, size = 1) {
    if (!this.ready) return;
    const out = this.place(p, 400);
    this.burst(out, 1.6 * size, 1800, 40, 1.0, "lowpass", 0, this.brown);
    this.burst(out, 0.5, 4000, 300, 0.6, "lowpass");
    this.tone(out, 70, 25, 1.4, 0.9);
  }
  impact(p, kind = "wall") {
    if (!this.ready) return;
    const out = this.place(p, 60);
    if (kind === "flesh") this.burst(out, 0.08, 900, 200, 0.4, "lowpass");
    else if (kind === "metal") { this.tone(out, 1800 + Math.random() * 900, 900, 0.18, 0.15, "triangle"); this.burst(out, 0.05, 6000, 2000, 0.2, "highpass"); }
    else this.burst(out, 0.07, 3000, 600, 0.3, "bandpass");
    if (Math.random() < 0.15 && kind !== "flesh") this.tone(out, 2400, 900, 0.25, 0.05, "sine", 0.02); // ricochet
  }
  step(p, run) {
    if (!this.ready) return;
    const out = this.place(p, 25);
    this.burst(out, 0.06, run ? 1400 : 900, 200, run ? 0.16 : 0.1, "lowpass");
  }
  click() { if (this.ready) this.tone(this.place(null), 2200, 1800, 0.03, 0.08, "square"); }
  reload(kind) {
    if (!this.ready) return;
    const out = this.place(null);
    this.tone(out, 900, 700, 0.05, 0.12, "square", 0.05);
    this.burst(out, 0.08, 2500, 900, 0.25, "bandpass", 0.25);
    this.tone(out, 1300, 1100, 0.04, 0.12, "square", kind === "shotgun" ? 0.4 : 0.6);
  }
  pickup() { if (this.ready) { const o = this.place(null); this.tone(o, 880, 880, 0.08, 0.12, "triangle"); this.tone(o, 1320, 1320, 0.12, 0.12, "triangle", 0.07); } }
  hit() { if (this.ready) this.tone(this.place(null), 1400, 1200, 0.04, 0.12, "triangle"); }
  thrown(p) { if (this.ready) this.burst(this.place(p, 30), 0.15, 600, 2000, 0.15, "bandpass"); }

  /** A running engine for a vehicle id; call every frame with revs 0..1 and its position. */
  engine(id, kind, p, revs, on = true) {
    if (!this.ready) return;
    let e = this.engines.get(id);
    if (!on) { if (e) { e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); setTimeout(() => { try { e.o.stop(); e.o2.stop(); e.n.stop(); } catch {} }, 400); this.engines.delete(id); } return; }
    const c = this.ctx;
    if (!e) {
      const o = c.createOscillator(); o.type = "sawtooth";
      const o2 = c.createOscillator(); o2.type = "square";
      const n = c.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0;
      const mix = c.createGain(); mix.gain.value = 0.35;
      const pan = c.createStereoPanner();
      o.connect(f); o2.connect(mix).connect(f); n.connect(f);
      f.connect(g).connect(pan).connect(this.master);
      o.start(); o2.start(); n.start();
      e = { o, o2, n, f, g, pan };
      this.engines.set(id, e);
    }
    const bike = kind === "bike";
    const base = bike ? 55 : 32, top = bike ? 210 : 120;
    const f0 = base + (top - base) * revs;
    const t = c.currentTime;
    e.o.frequency.setTargetAtTime(f0, t, 0.05);
    e.o2.frequency.setTargetAtTime(f0 * (bike ? 2.01 : 0.5), t, 0.05);
    e.f.frequency.setTargetAtTime(300 + revs * (bike ? 2600 : 1400), t, 0.05);
    const dx = p[0] - this.listener.x, dz = p[2] - this.listener.z, d = Math.hypot(dx, dz);
    e.g.gain.setTargetAtTime((0.05 + revs * 0.1) / (1 + (d / 18) ** 1.5), t, 0.05);
    e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(Math.atan2(dz, dx) - this.listener.yaw) * Math.min(1, d / 4))), t, 0.1);
  }
  stopEngines() { for (const id of [...this.engines.keys()]) this.engine(id, "", [0, 0, 0], 0, false); }

  /** Police siren (wail), on while heat brings police near. */
  siren(on, p) {
    if (!this.ready) return;
    const c = this.ctx;
    if (on && !this.sir) {
      const o = c.createOscillator(); o.type = "triangle";
      const lfo = c.createOscillator(); lfo.frequency.value = 0.35;
      const lg = c.createGain(); lg.gain.value = 350;
      lfo.connect(lg).connect(o.frequency);
      o.frequency.value = 950;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start(); lfo.start();
      this.sir = { o, lfo, g };
    }
    if (this.sir) {
      const d = p ? Math.hypot(p[0] - this.listener.x, p[2] - this.listener.z) : 999;
      this.sir.g.gain.setTargetAtTime(on ? 0.07 / (1 + (d / 40) ** 1.5) : 0, c.currentTime, 0.3);
      if (!on && this.sir.g.gain.value < 0.001) { try { this.sir.o.stop(); this.sir.lfo.stop(); } catch {} this.sir = null; }
    }
  }
  set heat(v) { if (this.humGain) this.humGain.gain.value = 0.05 + v * 0.01; }
}
