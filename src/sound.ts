// Sound effects and music synthesised in code with Web Audio: no files.

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode, musicFilter: BiquadFilterNode;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let volume = 0.7;
const lastPlayed: Record<string, number> = {};

function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C() as AudioContext;
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 18000;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.45;
  sfxBus.connect(master);
  musicBus.connect(musicFilter).connect(master);
  master.connect(comp).connect(ctx.destination);
  const n = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, n, n);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function throttle(name: string, ms: number) {
  const now = performance.now();
  if (now - (lastPlayed[name] ?? 0) < ms) return false;
  lastPlayed[name] = now;
  return true;
}
const vary = (f: number, amt = 0.06) => f * (1 + (Math.random() * 2 - 1) * amt);

function tone(f0: number, f1: number, dur: number, type: Wave = "square", vol = 0.2, when = 0, bus?: AudioNode) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus ?? sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, f0: number, f1: number, vol = 0.3, type: BiquadFilterType = "lowpass", when = 0, bus?: AudioNode) {
  const c = ac();
  if (!c || !noiseBuf) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus ?? sfxBus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

// ---------------- music ----------------
const NOTES = { A: 57, C: 60, D: 62, E: 64, F: 65, G: 67 };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const PROGRESSIONS: Record<string, number[][]> = {
  // chords as midi roots + minor/major triads
  drive: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
  calm: [[50, 53, 57], [55, 58, 62], [52, 55, 59], [57, 61, 64]], // Dm Gm Em A
  tense: [[52, 55, 59], [52, 55, 58], [48, 52, 55], [47, 50, 54]], // Em Edim C Bdim
};

export interface Music {
  intensity(v: number): Music;
  style(name: "drive" | "calm" | "tense"): Music;
  bpm(v: number): Music;
  stop(): void;
  readonly playing: boolean;
}

let current: (Music & { _id: number }) | null = null;

function startMusic(opts: { style?: "drive" | "calm" | "tense"; bpm?: number; intensity?: number } = {}): Music {
  current?.stop();
  let style = opts.style ?? "drive";
  let bpm = opts.bpm ?? 118;
  let inten = opts.intensity ?? 0.4;
  let step = 0;
  let nextTime = 0;
  let playing = true;
  const id = Math.random();
  const timer = setInterval(() => {
    const c = ac();
    if (!c || !playing || c.state !== "running") return;
    if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05;
    const sixteenth = 60 / bpm / 4;
    while (nextTime < c.currentTime + 0.15) {
      schedule(step, nextTime - c.currentTime, sixteenth);
      step++;
      nextTime += sixteenth;
    }
  }, 25);

  function schedule(s: number, when: number, len16: number) {
    const prog = PROGRESSIONS[style];
    const bar = Math.floor(s / 16) % prog.length;
    const chord = prog[bar];
    const i = s % 16;
    // pad: chord at bar start
    if (i === 0) for (const n of chord) tone(mtof(n), mtof(n), len16 * 16, "triangle", 0.035, when, musicBus);
    // bass: 8ths, octave jumps when intense
    if (i % 2 === 0) {
      const oct = inten > 0.55 && i % 4 === 2 ? 12 : 0;
      tone(mtof(chord[0] - 24 + oct), mtof(chord[0] - 24 + oct), len16 * 1.6, "sawtooth", 0.06 + inten * 0.03, when, musicBus);
    }
    // kick
    if (inten > 0.25 && i % 4 === 0) {
      tone(150, 40, 0.18, "sine", 0.35, when, musicBus);
    }
    // snare
    if (inten > 0.5 && (i === 4 || i === 12)) noise(0.14, 4000, 1200, 0.18, "bandpass", when, musicBus);
    // hats
    if (inten > 0.15 && i % 2 === 1) noise(0.03, 9000, 7000, 0.05 + inten * 0.04, "highpass", when, musicBus);
    // arp
    if (inten > 0.6) {
      const n = chord[[0, 1, 2, 1][i % 4]] + (i >= 8 ? 12 : 0) + 12;
      tone(mtof(n), mtof(n), len16 * 0.9, "square", 0.025 + (inten - 0.6) * 0.05, when, musicBus);
    }
    // lead motif at very high intensity
    if (inten > 0.85 && (i === 0 || i === 6 || i === 10)) {
      const n = chord[2] + 24;
      tone(mtof(n), mtof(n), len16 * 3, "sawtooth", 0.03, when, musicBus);
    }
  }

  const m: Music & { _id: number } = {
    _id: id,
    intensity(v) { inten = Math.max(0, Math.min(1, v)); return m; },
    style(n) { style = n; return m; },
    bpm(v) { bpm = v; return m; },
    stop() { playing = false; clearInterval(timer); if (current?._id === id) current = null; },
    get playing() { return playing; },
  };
  current = m;
  return m;
}

/** Effects: sound.shoot(), sound.hit(), sound.coin(), … Music: sound.music({style}). */
export const sound = {
  unlock() {
    const c = ac();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  },
  get muted() { return muted; },
  mute(v = !muted) {
    muted = v;
    if (master) master.gain.value = muted ? 0 : volume;
    return muted;
  },
  volume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
  },
  /** 0 = clear, 1 = heavy low-pass on the music (bullet time, pause, under water). */
  muffle(amount: number) {
    if (!ctx || !musicFilter) return;
    const f = 18000 * Math.pow(1 - Math.max(0, Math.min(0.97, amount)), 2.2) + 250;
    musicFilter.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
  },
  music: startMusic,
  stopMusic() { current?.stop(); },

  shoot() { if (throttle("shoot", 45)) tone(vary(920), 380, 0.09, "square", 0.08); },
  laser() { if (throttle("laser", 60)) tone(vary(1500), 160, 0.22, "sawtooth", 0.09); },
  hit() { if (throttle("hit", 30)) { noise(0.08, 3000, 600, 0.22); tone(vary(220), 110, 0.08, "square", 0.08); } },
  explode(size = 1) {
    if (!throttle("explode", 40)) return;
    const d = 0.35 + size * 0.45;
    noise(d, 2400, 80, 0.35 + size * 0.1);
    tone(vary(120), 30, d * 0.8, "sine", 0.4);
  },
  coin() { if (throttle("coin", 35)) { tone(vary(988, 0.02), 988, 0.07, "square", 0.07); tone(1319, 1319, 0.16, "square", 0.07, 0.07); } },
  jump() { if (throttle("jump", 60)) tone(vary(300), 680, 0.14, "square", 0.09); },
  bounce() { if (throttle("bounce", 40)) tone(vary(520), 420, 0.06, "triangle", 0.15); },
  power() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, "square", 0.07, i * 0.06));
  },
  hurt() { if (throttle("hurt", 120)) { tone(260, 70, 0.35, "sawtooth", 0.16); noise(0.25, 1800, 200, 0.22); } },
  dash() { if (throttle("dash", 80)) noise(0.22, 600, 5000, 0.2, "bandpass"); },
  click() { tone(1200, 1200, 0.03, "square", 0.05); },
  warn() { if (throttle("warn", 200)) { tone(440, 440, 0.12, "square", 0.08); tone(440, 440, 0.12, "square", 0.08, 0.2); } },
  boss() { tone(70, 45, 1.6, "sawtooth", 0.22); noise(1.4, 400, 60, 0.25); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.98, 0.3, "triangle", 0.14, i * 0.18)); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.2, "triangle", 0.12, i * 0.1)); },
  /** A raw tone for anything else: sound.tone(440, 220, 0.2, "square"). */
  tone(f0: number, f1 = f0, dur = 0.15, type: Wave = "square", vol = 0.1) { tone(f0, f1, dur, type, vol); },
  noise(dur = 0.2, from = 3000, to = 300, vol = 0.2) { noise(dur, from, to, vol); },
  get state() { return ctx?.state ?? "none"; },
};
void NOTES;
