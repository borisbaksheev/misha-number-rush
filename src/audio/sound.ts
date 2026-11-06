// Procedural Web Audio sound effects and a gentle background tune. No audio files needed.

const STORE_KEY = 'nr-audio';

function loadPrefs(): { sfx: boolean; music: boolean } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { sfx: true, music: true, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { sfx: true, music: true };
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// C major friendly progression: C  G  Am  F
const CHORDS = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];
const PENTA = [0, 2, 4, 7, 9];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private wind?: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  sfxOn: boolean;
  musicOn: boolean;
  private nextStep = 0;
  private step = 0;
  private motif: number[] = [];

  constructor() {
    const p = loadPrefs();
    this.sfxOn = p.sfx;
    this.musicOn = p.music;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Must be called from a user gesture (iOS/Safari audio unlock). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.8 : 0;
      this.musicBus.gain.value = this.musicOn ? 0.22 : 0;
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // silent blip to fully unlock iOS output
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, 22050);
      b.connect(ctx.destination);
      b.start(0);
      this.startWind();
      this.nextStep = ctx.currentTime + 0.1;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
    this.save();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ primitives
  private tone(
    freq: number,
    when: number,
    dur: number,
    o: { type?: OscillatorType; gain?: number; attack?: number; slide?: number; bus?: AudioNode; filter?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, when);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), when + dur);
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(o.bus ?? this.sfxBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  /** FM bell: bright, toy-like chime. */
  private bell(freq: number, when: number, dur = 0.8, gain = 0.22, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.5;
    modGain.gain.setValueAtTime(freq * 2.2, when);
    modGain.gain.exponentialRampToValueAtTime(1, when + dur);
    mod.connect(modGain).connect(car.frequency);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    car.connect(g).connect(bus ?? this.sfxBus);
    car.start(when);
    mod.start(when);
    car.stop(when + dur + 0.05);
    mod.stop(when + dur + 0.05);
  }

  private noiseBurst(when: number, dur: number, gain: number, freq: number, to?: number, type: BiquadFilterType = 'bandpass', bus?: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    if (to) f.frequency.exponentialRampToValueAtTime(to, when + dur);
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();
    this.wind = { src, gain, filter };
  }

  private get now(): number | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx.currentTime;
  }

  // ------------------------------------------------------------------ effects
  /** Called every frame: wind follows speed, music is scheduled ahead. */
  tick(speedK: number, playing: boolean): void {
    const t = this.now;
    if (t === null) return;
    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(playing ? speedK * speedK * 0.05 : 0, t, 0.2);
      this.wind.filter.frequency.setTargetAtTime(350 + speedK * 900, t, 0.2);
    }
    this.scheduleMusic(t);
  }

  click(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(880, t, 0.08, { type: 'triangle', gain: 0.15 });
    this.tone(1320, t + 0.05, 0.1, { type: 'triangle', gain: 0.12 });
  }

  /** Two numbers become one: rising sparkly arpeggio. */
  merge(big = false): void {
    const t = this.now;
    if (t === null) return;
    const base = big ? 60 : 67;
    [0, 4, 7, 12, 16].forEach((n, i) => this.bell(NOTE(base + n), t + i * 0.055, 0.7, 0.16));
    this.tone(NOTE(base - 12), t, 0.35, { type: 'triangle', gain: 0.12 });
    this.noiseBurst(t + 0.2, 0.4, 0.05, 6000, 9000, 'highpass');
  }

  /** One number splits: bubbly double pop. */
  split(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(700, t, 0.12, { type: 'sine', gain: 0.25, slide: 1200 });
    this.tone(500, t + 0.12, 0.14, { type: 'sine', gain: 0.25, slide: 900 });
    this.bell(NOTE(76), t + 0.22, 0.5, 0.12);
    this.bell(NOTE(79), t + 0.3, 0.5, 0.12);
  }

  /** Taking away: a part boings off. */
  separate(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(600, t, 0.25, { type: 'sine', gain: 0.22, slide: 300 });
    this.tone(300, t + 0.18, 0.3, { type: 'triangle', gain: 0.15, slide: 600 });
  }

  portal(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.5, 0.18, 400, 4000);
    [0, 7, 12].forEach((n, i) => this.bell(NOTE(72 + n), t + 0.08 + i * 0.07, 0.6, 0.12));
  }

  multiply(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.45, 0.16, 300, 5000);
    [0, 4, 7, 11, 14].forEach((n, i) => this.bell(NOTE(64 + n), t + i * 0.06, 0.6, 0.13));
  }

  /** Spectacular fanfare for big numbers. level 1..3 */
  fanfare(level: number): void {
    const t = this.now;
    if (t === null) return;
    const seq = [0, 4, 7, 12, 7, 12, 16, 19];
    const n = level >= 3 ? 8 : level === 2 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      this.tone(NOTE(60 + seq[i]), t + i * 0.09, 0.5, { type: 'sawtooth', gain: 0.07, filter: 2400 });
      this.bell(NOTE(72 + seq[i]), t + i * 0.09, 0.8, 0.1);
    }
    const end = t + n * 0.09;
    [0, 4, 7, 12].forEach((k) => this.tone(NOTE(60 + k), end, 1.4, { type: 'triangle', gain: 0.09, attack: 0.02 }));
    this.tone(90, t, 0.4, { type: 'sine', gain: 0.4, slide: 40 });
    this.noiseBurst(end, 1.2, 0.08, 7000, 12000, 'highpass');
  }

  jump(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(260, t, 0.32, { type: 'sine', gain: 0.25, slide: 820 });
    this.tone(390, t + 0.02, 0.28, { type: 'triangle', gain: 0.08, slide: 1100 });
  }

  land(intensity: number): void {
    const t = this.now;
    if (t === null) return;
    this.tone(140, t, 0.22, { type: 'sine', gain: 0.25 + intensity * 0.3, slide: 55 });
    this.noiseBurst(t, 0.18, 0.08 + intensity * 0.12, 900, 200, 'lowpass');
  }

  bump(strength: number): void {
    const t = this.now;
    if (t === null) return;
    const f = 180 + Math.random() * 40;
    this.tone(f, t, 0.35, { type: 'sine', gain: 0.25 + strength * 0.2, slide: f * 2.2 });
    this.tone(f * 1.5, t + 0.05, 0.3, { type: 'triangle', gain: 0.08, slide: f * 0.8 });
  }

  rail(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(520, t, 0.08, { type: 'triangle', gain: 0.1, slide: 380 });
  }

  boost(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.6, 0.2, 300, 3000);
    this.tone(300, t, 0.5, { type: 'sawtooth', gain: 0.06, slide: 900, filter: 2000 });
  }

  refuse(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(NOTE(67), t, 0.16, { type: 'triangle', gain: 0.15 });
    this.tone(NOTE(64), t + 0.16, 0.22, { type: 'triangle', gain: 0.15 });
  }

  fall(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(900, t, 0.9, { type: 'sine', gain: 0.16, slide: 200 });
  }

  respawn(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.3, 0.1, 2000, 600);
    [0, 4, 7].forEach((n, i) => this.bell(NOTE(79 + n), t + 0.1 + i * 0.06, 0.4, 0.1));
  }

  /** Picking up a number bubble: a light bubbly bling. */
  collect(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(900, t, 0.08, { type: 'sine', gain: 0.18, slide: 1500 });
    this.bell(NOTE(84), t + 0.05, 0.5, 0.12);
    this.bell(NOTE(91), t + 0.12, 0.5, 0.1);
  }

  /** Bumping a storm cloud: a soft puff and a far-away, quiet rumble (never startling). */
  storm(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.35, 0.12, 1200, 300, 'lowpass');
    this.noiseBurst(t + 0.05, 1.4, 0.07, 160, 60, 'lowpass');
    this.tone(70, t + 0.05, 1.0, { type: 'sine', gain: 0.12, slide: 45 });
    this.tone(520, t, 0.25, { type: 'triangle', gain: 0.08, slide: 260 });
  }

  /**
   * Storm-cloud zap: a short bright crackle, a friendly "boing" and a soft far-away rumble.
   * Deliberately quiet and short so it is fun rather than frightening.
   */
  thunder(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.18, 0.1, 3500, 900, 'bandpass');
    this.noiseBurst(t + 0.05, 1.1, 0.08, 220, 70, 'lowpass');
    this.tone(85, t + 0.04, 0.8, { type: 'sine', gain: 0.13, slide: 50 });
    this.tone(660, t + 0.02, 0.3, { type: 'triangle', gain: 0.09, slide: 330 });
    this.bell(NOTE(79), t + 0.12, 0.45, 0.07);
  }

  /** Swoosh when flying through a portal. */
  whoosh(): void {
    const t = this.now;
    if (t === null) return;
    this.noiseBurst(t, 0.45, 0.16, 500, 3500);
  }

  buddyHello(): void {
    const t = this.now;
    if (t === null) return;
    this.tone(NOTE(76), t, 0.12, { type: 'triangle', gain: 0.12 });
    this.tone(NOTE(81), t + 0.12, 0.18, { type: 'triangle', gain: 0.12 });
  }

  lap(): void {
    const t = this.now;
    if (t === null) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.bell(NOTE(67 + n), t + i * 0.07, 0.6, 0.12));
  }

  // ------------------------------------------------------------------ music
  private scheduleMusic(now: number): void {
    if (!this.musicOn) {
      this.nextStep = Math.max(this.nextStep, now);
      return;
    }
    const stepDur = 60 / 108 / 2; // eighth notes
    if (this.nextStep < now - 0.5) this.nextStep = now + 0.05;
    while (this.nextStep < now + 0.2) {
      this.playStep(this.step, this.nextStep, stepDur);
      this.step++;
      this.nextStep += stepDur;
    }
  }

  private playStep(step: number, t: number, dur: number): void {
    const bar = Math.floor(step / 8) % 4;
    const pos = step % 8;
    const chord = CHORDS[bar];
    const bus = this.musicBus;
    if (step % 64 === 0 || this.motif.length === 0) {
      // new 2-bar motif every 8 bars, repeated so it feels like a tune
      this.motif = [];
      for (let i = 0; i < 16; i++) this.motif.push(Math.random() < 0.62 ? PENTA[Math.floor(Math.random() * 5)] + (Math.random() < 0.3 ? 12 : 0) : -1);
    }
    if (pos === 0 || pos === 4) {
      this.tone(NOTE(chord[0] - 12), t, dur * 3.5, { type: 'triangle', gain: 0.28, bus, filter: 600 });
      this.tone(110, t, 0.18, { type: 'sine', gain: 0.25, slide: 45, bus });
    }
    if (pos === 0) {
      for (const n of chord) this.tone(NOTE(n + 12), t, dur * 7.5, { type: 'triangle', gain: 0.05, attack: 0.25, bus });
    }
    if (pos % 2 === 1) this.noiseBurst(t, 0.05, 0.03, 8000, undefined, 'highpass', bus);
    const m = this.motif[step % 16];
    // C major pentatonic melody stays consonant over every chord
    if (m >= 0) this.bell(NOTE(72 + m), t, 0.45, 0.07, bus);
  }
}
