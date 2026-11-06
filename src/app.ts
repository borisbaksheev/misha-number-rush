// Shared application shell: one WebGL renderer, sound, HUD and input for every game mode.
//
// Startup pipeline (keeps the first visible frame sharp and smooth, especially on iPad Safari):
//   1. cover the screen with a sky-coloured loader,
//   2. build the mode and let it warm up: pre-build glyphs, pre-fill object pools, put one of
//      every material on screen, compile all shaders (compileAsync), render a few frames so
//      geometry, textures and render targets are uploaded,
//   3. on the first visit, measure real frame times and pick the quality level *now*,
//   4. fade the cover out over the ready scene, then start play.
// During play the resolution is never changed (that would flash the canvas); a sustained
// slowdown only turns bloom off and the lower resolution is applied at the next start.
import {
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sound } from './audio/sound';
import { InputController } from './game/input';
import { setCharacterQuality } from './render/numberCharacter';
import { Hud } from './ui/hud';
import { frames, Loader, nextFrame } from './ui/loader';

export type Quality = 'high' | 'medium' | 'low';
export type ModeId = 'race' | 'sky';
/** 'ready' = warmed up and showing the start pose, waiting for the cover to fade. */
export type ModeState = 'title' | 'ready' | 'playing' | 'paused';

export const QUALITY: Record<Quality, { dpr: number; bloom: boolean; shadow: number }> = {
  high: { dpr: 2, bloom: true, shadow: 2048 },
  medium: { dpr: 1.5, bloom: false, shadow: 2048 },
  low: { dpr: 1, bloom: false, shadow: 1024 },
};
const LOWER: Record<Quality, Quality> = { high: 'medium', medium: 'low', low: 'low' };

/** Services every mode shares. */
export interface ModeHost {
  renderer: WebGLRenderer;
  sound: Sound;
  hud: Hud;
  input: InputController;
  envMap: Texture;
  quality: Quality;
}

export interface GameMode {
  readonly id: ModeId;
  mode: ModeState;
  /**
   * Warm up before the mode is revealed. `first` = first time this page load: compile every
   * shader and upload resources. Always ends in a steady start pose ('ready' or 'title').
   */
  prepare(progress: (p: number) => void, first: boolean, toTitle: boolean): Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  /** Back to an idle backdrop for the main menu. */
  toTitle(): void;
  /** Simulate and render one frame (dt in real seconds, already clamped). */
  frame(dt: number): void;
  resize(width: number, height: number): void;
  applyQuality(q: Quality): void;
  describe(): string;
}

/** Touch tablets/phones start at medium quality; desktops at high. */
function defaultQuality(): Quality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || navigator.maxTouchPoints > 1 ? 'medium' : 'high';
}

interface StartupStats {
  mode: ModeId;
  first: boolean;
  warmupMs: number;
  quality: Quality;
  programs: number;
  frameTimes: number[];
  programsAfter: number;
}

export class App implements ModeHost {
  readonly renderer: WebGLRenderer;
  readonly sound = new Sound();
  readonly hud = new Hud();
  readonly loader = new Loader();
  readonly input: InputController;
  readonly envMap: Texture;
  quality: Quality = defaultQuality();
  private autoQuality = true;
  private pendingQuality: Quality | null = null;
  private modes = new Map<ModeId, GameMode>();
  private prepared = new Set<ModeId>();
  private factories = new Map<ModeId, (host: ModeHost) => GameMode>();
  active!: GameMode;
  private last = performance.now();
  private fpsAcc = { frames: 0, time: 0, slowWindows: 0 };
  private sinceStart = 0;
  private fpsEl = document.getElementById('fps')!;
  private debug = /[?&](debug|perf)\b/.test(location.search);
  private frameLog: number[] = [];
  private startup: StartupStats | null = null;
  /** Last startup measurement (shown with ?perf and readable from the console). */
  lastStartup = '';
  fps = 60;

  constructor(private container: HTMLElement) {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'high' || q === 'medium' || q === 'low') {
      this.quality = q;
      this.autoQuality = false;
    }
    setCharacterQuality(this.quality === 'low');
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.input = new InputController(container);
    this.input.onFirstInput = () => this.sound.unlock();
    this.envMap = new PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    if (this.debug) this.fpsEl.classList.remove('hidden');
    this.applyPixelRatio();
  }

  register(id: ModeId, factory: (host: ModeHost) => GameMode): void {
    this.factories.set(id, factory);
  }

  hasMode(id: ModeId): boolean {
    return this.modes.has(id);
  }

  /** Get (creating on first use) a mode without activating it. */
  mode(id: ModeId): GameMode {
    let m = this.modes.get(id);
    if (!m) {
      m = this.factories.get(id)!(this);
      this.modes.set(id, m);
      m.applyQuality(this.quality);
    }
    return m;
  }

  /** Make a mode the one that is simulated and drawn (no warm-up; see enter()). */
  activate(id: ModeId): GameMode {
    const m = this.mode(id);
    if (this.active && this.active !== m) this.active.toTitle();
    this.active = m;
    this.input.reset();
    this.resize();
    this.last = performance.now();
    return m;
  }

  /**
   * Switch to a mode behind the loading cover, warm it up, and reveal it already sharp.
   * `play` = start playing after the reveal; otherwise it stays as the menu backdrop.
   */
  async enter(id: ModeId, play: boolean, onCovered?: () => void): Promise<GameMode> {
    const first = !this.prepared.has(id);
    const m = this.modes.get(id);
    // The warmed-up mode that is already on screen (the menu backdrop) needs no cover:
    // its camera glides smoothly between the menu orbit and the chase view.
    if (!first && m && this.active === m) {
      onCovered?.();
      if (play) {
        m.start();
        this.beginStartupLog(id, false, 0);
      } else m.toTitle();
      return m;
    }
    await this.loader.show(first ? (id === 'sky' ? 'Getting the sky ready…' : 'Getting ready…') : '');
    onCovered?.();
    await nextFrame();
    const t0 = performance.now();
    if (this.pendingQuality) {
      this.setQuality(this.pendingQuality, true);
      this.pendingQuality = null;
    }
    const mode = this.activate(id);
    await mode.prepare((p) => this.loader.progress(p * 0.85), first, !play);
    if (first && this.autoQuality) await this.calibrate();
    this.prepared.add(id);
    const warmupMs = performance.now() - t0;
    await frames(2);
    await this.loader.hide();
    if (play) mode.start();
    this.beginStartupLog(id, first, warmupMs);
    return mode;
  }

  /**
   * Measure real frame times while the cover is still up (the scene is fully drawn behind it)
   * and lower the quality before play if this device can't keep up.
   */
  private async calibrate(): Promise<void> {
    for (let step = 0; step < 2 && this.quality !== 'low'; step++) {
      await frames(4); // let the frame rate settle
      const times: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 16; i++) {
        await nextFrame();
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)];
      this.loader.progress(0.9 + step * 0.05);
      if (median <= 24) return; // ~40+ fps: keep this quality
      this.setQuality(LOWER[this.quality], true);
    }
  }

  run(): void {
    this.renderer.setAnimationLoop(this.loop);
  }

  setQuality(q: Quality, auto = false): void {
    this.quality = q;
    this.autoQuality = auto || this.autoQuality;
    setCharacterQuality(q === 'low');
    this.applyPixelRatio();
    for (const m of this.modes.values()) m.applyQuality(q);
    this.resize();
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr));
  }

  resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.active?.resize(w, h);
  };

  private loop = (): void => {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    if (this.startup && this.frameLog.length < 600) this.frameLog.push(raw * 1000);
    this.trackFps(dt);
    this.active?.frame(dt);
  };

  // ---------------------------------------------------------------- measurements
  private beginStartupLog(id: ModeId, first: boolean, warmupMs: number): void {
    this.frameLog = [];
    this.sinceStart = 0;
    this.fpsAcc.slowWindows = 0;
    this.startup = {
      mode: id,
      first,
      warmupMs,
      quality: this.quality,
      programs: this.renderer.info.programs?.length ?? 0,
      frameTimes: this.frameLog,
      programsAfter: 0,
    };
  }

  private finishStartupLog(): void {
    const s = this.startup;
    if (!s) return;
    const t = s.frameTimes;
    const sorted = [...t].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const firstSec = t.slice(0, 60);
    s.programsAfter = this.renderer.info.programs?.length ?? 0;
    this.lastStartup =
      `${s.mode}${s.first ? ' first' : ' repeat'} start · warm-up ${Math.round(s.warmupMs)} ms · ${s.quality}\n` +
      `first 10 s: ${t.length} frames, max ${Math.round(sorted[sorted.length - 1] ?? 0)} ms, p95 ${Math.round(p95)} ms, ` +
      `>33 ms: ${t.filter((x) => x > 33.4).length}, >50 ms: ${t.filter((x) => x > 50).length}\n` +
      `first second max ${Math.round(Math.max(0, ...firstSec))} ms · new shaders during play: ${s.programsAfter - s.programs}`;
    console.info(`[startup] ${this.lastStartup.replace(/\n/g, ' | ')}`);
    this.startup = null;
  }

  private trackFps(dt: number): void {
    const a = this.fpsAcc;
    a.frames++;
    a.time += dt;
    const playing = this.active?.mode === 'playing';
    if (playing) this.sinceStart += dt;
    if (this.startup && this.sinceStart >= 10) this.finishStartupLog();
    if (a.time < 2) return;
    this.fps = a.frames / a.time;
    a.frames = 0;
    a.time = 0;
    // Sustained slowness well after the start: drop bloom now (no canvas resize, no flash) and
    // use the lower resolution from the next start onwards.
    if (this.autoQuality && playing && this.sinceStart > 6) {
      a.slowWindows = this.fps < 40 ? a.slowWindows + 1 : 0;
      if (a.slowWindows >= 2 && this.quality !== 'low' && !this.pendingQuality) {
        const lower = LOWER[this.quality];
        this.pendingQuality = lower;
        if (QUALITY[this.quality].bloom) for (const m of this.modes.values()) m.applyQuality('medium');
        a.slowWindows = 0;
      }
    }
    if (this.debug) {
      const info = this.renderer.info.render;
      this.fpsEl.textContent =
        `${this.fps.toFixed(0)} fps  ${this.quality}${this.pendingQuality ? ` → ${this.pendingQuality} next start` : ''}\n` +
        `${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris  ${this.renderer.info.programs?.length ?? 0} shaders\n` +
        `${this.active?.describe() ?? ''}\n${this.lastStartup}`;
    }
  }
}
