// Shared application shell: one WebGL renderer, sound, HUD and input for every game mode.
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

export type Quality = 'high' | 'medium' | 'low';
export type ModeId = 'race' | 'sky';
export type ModeState = 'title' | 'playing' | 'paused';

export const QUALITY: Record<Quality, { dpr: number; bloom: boolean; shadow: number }> = {
  high: { dpr: 2, bloom: true, shadow: 2048 },
  medium: { dpr: 1.5, bloom: false, shadow: 2048 },
  low: { dpr: 1, bloom: false, shadow: 1024 },
};

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

export class App implements ModeHost {
  readonly renderer: WebGLRenderer;
  readonly sound = new Sound();
  readonly hud = new Hud();
  readonly input: InputController;
  readonly envMap: Texture;
  quality: Quality = 'high';
  private autoQuality = true;
  private modes = new Map<ModeId, GameMode>();
  private factories = new Map<ModeId, (host: ModeHost) => GameMode>();
  active!: GameMode;
  private last = performance.now();
  private fpsAcc = { frames: 0, time: 0, playTime: 0 };
  private fpsEl = document.getElementById('fps')!;
  private debug = new URLSearchParams(location.search).has('debug');
  fps = 60;

  constructor(private container: HTMLElement) {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'high' || q === 'medium' || q === 'low') {
      this.quality = q;
      this.autoQuality = false;
    }
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

  /** Make a mode the one that is simulated and drawn. */
  activate(id: ModeId): GameMode {
    const m = this.mode(id);
    if (this.active && this.active !== m) this.active.toTitle();
    this.active = m;
    this.input.reset();
    this.applyPixelRatio();
    this.resize();
    this.last = performance.now();
    return m;
  }

  run(): void {
    this.renderer.setAnimationLoop(this.loop);
  }

  setQuality(q: Quality, auto = false): void {
    this.quality = q;
    this.autoQuality = auto;
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.trackFps(dt);
    this.active?.frame(dt);
  };

  private trackFps(dt: number): void {
    const a = this.fpsAcc;
    a.frames++;
    a.time += dt;
    if (this.active?.mode === 'playing') a.playTime += dt;
    if (a.time < 2) return;
    this.fps = a.frames / a.time;
    a.frames = 0;
    a.time = 0;
    if (this.autoQuality && a.playTime > 4 && this.fps < 45 && this.quality !== 'low') {
      this.setQuality(this.quality === 'high' ? 'medium' : 'low', true);
      a.playTime = 0;
    }
    if (this.debug) {
      const info = this.renderer.info.render;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} fps  ${this.quality}\n${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris\n${this.active?.describe() ?? ''}`;
    }
  }
}
