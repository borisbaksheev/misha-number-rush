// Sky Numbers: a flying maths adventure. The player stays at z = 0 and the sky scrolls past,
// which keeps coordinates small however far the number flies.
import {
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
  type BufferGeometry,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QUALITY, type GameMode, type ModeHost, type ModeState, type Quality } from '../app';
import type { Sound } from '../audio/sound';
import type { InputController } from '../game/input';
import { formatNumber } from '../math/numberMath';
import { seededRandom } from '../math/random';
import { NumberCharacter } from '../render/numberCharacter';
import { Particles } from '../render/particles';
import type { Hud } from '../ui/hud';
import { colorsOf, SkyFx, type SkyFxHost } from './skyFx';
import { CORRIDOR } from './skyCourse';
import { MAX_SKY_SPEED, SkyLogic, type RowState, type SkyEvent } from './skyLogic';
import {
  BubbleVisual,
  cloudGeometry,
  cloudMaterial,
  islandGeometry,
  islandMaterial,
  SkyPortal,
  skyDome,
  SKY_SUN,
  StormVisual,
  Trail,
} from './skyVisuals';

const VIEW_AHEAD = 340;
const VIEW_BEHIND = 40;
const CHUNK = 60;
const TUNNEL_PALETTES = [
  ['#ffc2e2', '#d9c2ff', '#bfe8ff', '#c8ffe0', '#fff1b8'],
  ['#ffd6b8', '#ffc2e2', '#e0c8ff', '#bde9ff', '#ffffff'],
  ['#c8ffe0', '#bfe8ff', '#ffe0f0', '#fff1b8', '#d9c2ff'],
];

interface CloudPlacement {
  d: number;
  x: number;
  y: number;
  s: number;
  sy: number;
  rot: number;
  color: Color;
}

/** Pools InstancedMesh slots; placements are rewritten every frame. */
class CloudLayer {
  readonly mesh: InstancedMesh;
  private n = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private up = new Vector3(0, 1, 0);

  constructor(geo: BufferGeometry, material: ReturnType<typeof cloudMaterial>, readonly capacity: number) {
    this.mesh = new InstancedMesh(geo, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color('#ffffff'));
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, s: number, sy: number, rot: number, color: Color): void {
    if (this.n >= this.capacity) return;
    this.q.setFromAxisAngle(this.up, rot);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(s, s * sy, s));
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class SkyGame implements GameMode, SkyFxHost {
  readonly id = 'sky' as const;
  mode: ModeState = 'title';
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.3, 3000);
  readonly logic = new SkyLogic();
  readonly player = new NumberCharacter(8);
  readonly particles = new Particles();
  readonly fx: SkyFx;
  readonly renderer: WebGLRenderer;
  readonly sound: Sound;
  readonly hud: Hud;
  readonly input: InputController;
  /** Debug/test driver: steers to lane `lane` of every portal row (null = straight on). */
  autopilot: { lane: number | null } | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private hemi: HemisphereLight;
  private sky = skyDome();
  private world = new Group();
  private near: CloudLayer;
  private sea: CloudLayer;
  private banks: CloudLayer;
  private seaSpots: CloudPlacement[] = [];
  private bankSpots: CloudPlacement[] = [];
  private chunkCache = new Map<number, CloudPlacement[]>();
  private islands: Mesh[] = [];
  private portalPool: SkyPortal[] = [];
  private portals = new Map<number, SkyPortal[]>();
  private stormPool: StormVisual[] = [];
  private storms = new Map<number, StormVisual>();
  private bubblePool: BubbleVisual[] = [];
  private bubbles = new Map<number, BubbleVisual>();
  private trail = new Trail();
  private time = 0;
  private timeScale = 1;
  private slowTimer = 0;
  private slowFactor = 1;
  private camPos = new Vector3(0, 12, 10);
  private camLook = new Vector3(0, 9, -10);
  private shakeAmt = 0;
  private showcaseT = 0;
  private showcaseDur = 1;
  private showcaseSide = 1;
  private flashAmt = 0;
  private baseFov = 60;
  private width = 1;
  private height = 1;
  private hintTimer = 0;
  private white = new Color('#ffffff');
  private tmp = new Vector3();

  constructor(host: ModeHost) {
    this.renderer = host.renderer;
    this.sound = host.sound;
    this.hud = host.hud;
    this.input = host.input;
    this.fx = new SkyFx(this);

    const s = this.scene;
    s.environment = host.envMap;
    s.environmentIntensity = 0.5;
    s.background = new Color('#9fd3ff');
    s.fog = new Fog('#bfe0ff', 110, 520);
    this.hemi = new HemisphereLight('#eaf6ff', '#bcc8ff', 1.15);
    const sun = new DirectionalLight('#fff4e0', 2.1);
    sun.position.copy(SKY_SUN).multiplyScalar(100);
    s.add(this.hemi, sun, this.sky, this.world, this.particles.group, this.player.root, this.trail.mesh);

    const white = cloudMaterial('#ffffff', '#9fb4e0', '#ffffff', 0.45);
    this.near = new CloudLayer(cloudGeometry(11, 7, 1), white, 520);
    this.sea = new CloudLayer(cloudGeometry(23, 8, 1), cloudMaterial('#fbfdff', '#93a9db', '#ffffff', 0.35), 90);
    const bankMat = cloudMaterial('#f4f8ff', '#cfdcf5', '#ffffff', 0.4);
    bankMat.fog = false;
    this.banks = new CloudLayer(cloudGeometry(31, 9, 1), bankMat, 24);
    s.add(this.near.mesh, this.sea.mesh, this.banks.mesh);

    // a sea of clouds below and distant cloud mountains on the horizon
    const r = seededRandom(5);
    for (let i = 0; i < 55; i++) {
      this.seaSpots.push({ d: r() * 720, x: (r() * 2 - 1) * 280, y: -48 - r() * 16, s: 16 + r() * 18, sy: 0.4, rot: r() * 6, color: this.white });
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      this.bankSpots.push({ d: a, x: 0, y: -40 + r() * 70, s: 90 + r() * 90, sy: 0.6, rot: r() * 6, color: this.white });
    }
    const islandGeos = [islandGeometry(1), islandGeometry(2), islandGeometry(3)];
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(islandGeos[i % 3], islandMaterial);
      this.islands.push(m);
      this.world.add(m);
    }
    this.player.root.traverse((o) => (o.castShadow = false));
    this.hud.setValue(this.logic.value, false);
  }

  // ------------------------------------------------------------------ GameMode
  start(): void {
    this.restart();
    this.sound.unlock();
    this.hud.clearMessages();
    this.hud.show(true);
    this.hud.setHint('Slide your finger to fly');
    this.hud.showHint(true);
    this.hintTimer = 0;
    this.sound.click();
  }

  pause(): void {
    if (this.mode === 'playing') {
      this.mode = 'paused';
      this.input.reset();
    }
  }

  resume(): void {
    if (this.mode === 'paused') this.mode = 'playing';
  }

  restart(): void {
    this.logic.reset();
    this.fx.reset();
    this.player.setValue(this.logic.value);
    this.player.spin = this.player.flip = 0;
    this.trail.clear();
    for (const [, list] of this.portals) list.forEach((p) => this.releasePortal(p));
    this.portals.clear();
    for (const [, v] of this.storms) this.releaseStorm(v);
    this.storms.clear();
    for (const [, v] of this.bubbles) this.releaseBubble(v);
    this.bubbles.clear();
    this.hud.setValue(this.logic.value, false);
    this.hud.setTeam('');
    this.hud.setPill('0 m');
    this.input.reset();
    this.camPos.set(0, this.logic.y + 3, 10);
    this.camLook.set(0, this.logic.y, -10);
    this.mode = 'playing';
  }

  toTitle(): void {
    this.restart();
    this.autopilot = null;
    this.mode = 'title';
  }

  applyQuality(quality: Quality): void {
    const q = QUALITY[quality];
    if (q.bloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.25, 0.5, 0.93);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else if (!q.bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    const hFov = 70;
    const vFov = (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.baseFov = Math.min(80, Math.max(55, vFov));
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.bloom?.resolution.set(w / 2, h / 2);
    }
    this.particles.setScale(h * this.renderer.getPixelRatio(), this.baseFov);
  }

  describe(): string {
    const l = this.logic;
    const row = l.nextRow();
    const ops = row?.ops?.map((o) => `${o.kind}${o.operand}`).join(',') ?? '-';
    return `sky ${this.mode} d=${l.d.toFixed(0)} x=${l.x.toFixed(1)} y=${l.y.toFixed(1)} v=${l.speed.toFixed(1)} value=${formatNumber(l.value)} next=[${ops}] portals=${l.portalsFlown}`;
  }

  // ------------------------------------------------------------------ SkyFxHost
  slowmo(factor: number, seconds: number): void {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, seconds);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  showcase(seconds: number): void {
    this.showcaseT = this.showcaseDur = seconds;
    this.showcaseSide = Math.random() < 0.5 ? -1 : 1;
  }

  skyFlash(strength: number): void {
    this.flashAmt = Math.max(this.flashAmt, strength);
  }

  // ------------------------------------------------------------------ frame
  frame(realDt: number): void {
    const dt = this.mode === 'paused' ? 0 : realDt;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }
    this.timeScale += ((this.slowTimer > 0 ? this.slowFactor : 1) - this.timeScale) * (1 - Math.exp(-12 * dt));
    const gdt = dt * this.timeScale;
    this.time += gdt;

    if (this.mode === 'playing') {
      const f = this.input.pollFlight();
      const input = { dx: f.fx * 30, dy: f.fy * 22, axisX: f.axisX, axisY: f.axisY };
      if (this.autopilot) this.drive(input);
      this.logic.update(gdt, input);
      for (const e of this.logic.drainEvents()) this.onEvent(e);
      if (this.input.pressing || this.autopilot) this.hintTimer += dt;
      if (this.hintTimer > 2.5) this.hud.showHint(false);
      this.hud.setPill(`${Math.floor(this.logic.d)} m`);
    }

    this.fx.update(gdt);
    this.syncPlayer(gdt);
    this.syncFeatures(gdt);
    this.syncClouds();
    this.syncCamera(dt);
    this.ambient(gdt, dt);
    this.sound.tick(Math.min(1, this.logic.speed / MAX_SKY_SPEED) * 0.8, this.mode === 'playing');
    this.particles.update(gdt, this.camera);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private drive(input: { dx: number; dy: number }): void {
    const l = this.logic;
    const row = l.nextRow();
    const lane = this.autopilot?.lane;
    if (!row || lane === null || lane === undefined) return;
    const target = row.lanes[Math.min(lane, row.lanes.length - 1)];
    input.dx = (target.x - l.targetX) * 0.15;
    input.dy = (target.y - l.targetY) * 0.15;
  }

  private onEvent(e: SkyEvent): void {
    const l = this.logic;
    switch (e.type) {
      case 'portal': {
        const list = this.portals.get(e.row.f.id);
        list?.forEach((p, i) => (i === e.lane ? p.flash() : p.dim()));
        list?.forEach((p) => p.dim());
        const lane = e.row.lanes[e.lane];
        this.particles.burst(this.tmp.set(lane.x, lane.y, -1), {
          count: 40,
          colors: ['#ffffff', '#ffe066', '#ff7ad9', '#3ff0ff'],
          speed: 9,
          size: 0.5,
          radius: 2,
          dir: new Vector3(0, 0, l.speed),
        });
        this.sound.whoosh();
        this.fx.portal(e.op, e.before, e.after);
        this.trail.setColors(colorsOf(e.after));
        break;
      }
      case 'bubble': {
        const v = this.bubbles.get(e.bubble.f.id);
        v?.pop();
        const p = this.tmp.set(e.bubble.f.x, e.bubble.f.y, 0);
        this.particles.burst(p, { count: 18, colors: ['#ffffff', '#bff4ff', '#ffe066'], speed: 5, size: 0.4, life: 0.6 });
        if (e.op) this.fx.bubble(e.op.operand, e.after, e.bubble.f.x - l.x, e.bubble.f.y - l.y);
        else this.sound.collect();
        break;
      }
      case 'storm':
        this.storms.get(e.storm.f.id)?.hit();
        this.fx.storm(e.before, e.after, e.halved);
        break;
      case 'cycle':
        this.hud.toast('What a long flight! More sky ahead!', 2.4);
        break;
      case 'rowChoices':
        break;
    }
  }

  private syncPlayer(dt: number): void {
    const l = this.logic;
    const p = this.player;
    p.root.position.set(l.x, l.y - p.height * 0.45, 0);
    const pitch = Math.max(-0.35, Math.min(0.35, l.vy * 0.04));
    p.flip += (pitch - p.flip) * (1 - Math.exp(-6 * dt));
    p.update(dt, { speed: l.speed, steer: l.vx * 0.9, airborne: true, stride: 0, flying: true });
    this.trail.update(dt, l.speed, l.x, l.y + 0.1, p.width + 0.7);
    if (this.mode === 'title') p.celebrate(0.2);
  }

  // ------------------------------------------------------------------ features
  private takePortal(): SkyPortal {
    const p = this.portalPool.pop() ?? new SkyPortal();
    p.reset();
    this.world.add(p.group);
    return p;
  }

  private releasePortal(p: SkyPortal): void {
    this.world.remove(p.group);
    this.portalPool.push(p);
  }

  private releaseStorm(v: StormVisual): void {
    this.world.remove(v.group);
    this.stormPool.push(v);
  }

  private releaseBubble(v: BubbleVisual): void {
    this.world.remove(v.group);
    this.bubblePool.push(v);
  }

  private syncFeatures(dt: number): void {
    const l = this.logic;
    const d = l.d;
    const z = (fd: number) => -(fd - d);
    const next = l.nextRow();

    // portal rows
    const seen = new Set<number>();
    for (const row of l.rows) {
      const ahead = row.f.d - d;
      if (ahead > VIEW_AHEAD || ahead < -VIEW_BEHIND) continue;
      seen.add(row.f.id);
      let list = this.portals.get(row.f.id);
      if (!list || list.length !== row.lanes.length) {
        list?.forEach((p) => this.releasePortal(p));
        list = row.lanes.map(() => this.takePortal());
        this.portals.set(row.f.id, list);
        if (row.passed) list.forEach((p, i) => i !== row.chosen && p.dim());
      }
      this.layoutRow(row, list, row === next, z(row.f.d));
      list.forEach((p) => p.update(this.time, dt));
    }
    for (const [id, list] of this.portals) {
      if (!seen.has(id)) {
        list.forEach((p) => this.releasePortal(p));
        this.portals.delete(id);
      }
    }

    // storm clouds
    const seenStorms = new Set<number>();
    for (const s of l.storms) {
      const ahead = s.f.d - d;
      if (ahead > VIEW_AHEAD || ahead < -VIEW_BEHIND) continue;
      seenStorms.add(s.f.id);
      let v = this.storms.get(s.f.id);
      if (!v) {
        v = this.stormPool.pop() ?? new StormVisual();
        v.reset();
        this.storms.set(s.f.id, v);
        this.world.add(v.group);
      }
      v.group.position.set(s.f.x, s.f.y + Math.sin(this.time * 0.8 + s.f.id) * 0.3, z(s.f.d));
      // once it has drifted past the player, puff away before it can fill the camera view
      const pass = Math.min(1, Math.max(0, (ahead + 6) / 6));
      v.group.scale.setScalar(s.f.r * v.size * pass);
      v.group.visible = pass > 0.02;
      v.update(this.time, dt);
    }
    for (const [id, v] of this.storms) {
      if (!seenStorms.has(id)) {
        this.releaseStorm(v);
        this.storms.delete(id);
      }
    }

    // number bubbles (appear once their number is decided)
    const seenBubbles = new Set<number>();
    for (const b of l.bubbles) {
      const ahead = b.f.d - d;
      if (ahead > 140 || ahead < -VIEW_BEHIND || b.k === null) continue;
      seenBubbles.add(b.f.id);
      let v = this.bubbles.get(b.f.id);
      if (!v) {
        v = this.bubblePool.pop() ?? new BubbleVisual();
        v.reset();
        this.bubbles.set(b.f.id, v);
        this.world.add(v.group);
      }
      v.setValue(b.k);
      v.group.position.set(b.f.x, b.f.y + Math.sin(this.time * 2 + b.f.id) * 0.25, z(b.f.d));
      if (!v.popped) v.group.scale.setScalar(1.45 * Math.min(1, (140 - ahead) / 20));
      v.update(this.time, dt, b.f.id);
    }
    for (const [id, v] of this.bubbles) {
      if (!seenBubbles.has(id)) {
        this.releaseBubble(v);
        this.bubbles.delete(id);
      }
    }

    // distant floating islands drift by far to the sides
    const spacing = 230;
    const first = Math.floor((d - 200) / spacing);
    this.islands.forEach((m, i) => {
      const k = first + i;
      const r = seededRandom(k * 977 + 3);
      const side = k % 2 ? 1 : -1;
      m.position.set(side * (70 + r() * 70), -12 + r() * 30, z(k * spacing + r() * 60));
      m.scale.setScalar(9 + r() * 7);
      m.rotation.y = r() * 6 + this.time * 0.02;
    });
  }

  private layoutRow(row: RowState, list: SkyPortal[], isNext: boolean, z: number): void {
    const r = row.lanes.length >= 4 ? 2.45 : 3.05;
    row.lanes.forEach((lane, i) => {
      const p = list[i];
      // once flown through, keep the rings out of the camera's way
      p.hidden = row.passed && z > 1;
      if (p.hidden) return;
      p.setRadius(r);
      p.setOp(isNext && row.ops ? row.ops[i] : row.passed && row.ops ? row.ops[i] : null);
      p.group.position.set(lane.x, lane.y + Math.sin(this.time * 1.2 + i) * 0.15, z);
    });
  }

  // ------------------------------------------------------------------ clouds
  private chunk(c: number): CloudPlacement[] {
    let list = this.chunkCache.get(c);
    if (list) return list;
    const r = seededRandom(c * 7919 + 11);
    list = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      const side = (i + c) % 2 ? 1 : -1;
      const far = r() < 0.6;
      list.push({
        d: c * CHUNK + r() * CHUNK,
        x: side * (far ? 22 + r() * 60 : 15 + r() * 6),
        y: far ? -8 + r() * 36 : -1 + r() * 20,
        s: far ? 5 + r() * 7 : 2.5 + r() * 2.5,
        sy: 0.7 + r() * 0.2,
        rot: r() * 6,
        color: this.white,
      });
    }
    // an occasional small cloud low below the flight path for a sense of speed
    if (r() < 0.5) list.push({ d: c * CHUNK + r() * CHUNK, x: (r() * 2 - 1) * 9, y: -4 - r() * 3, s: 2.5 + r() * 2, sy: 0.6, rot: r() * 6, color: this.white });
    this.chunkCache.set(c, list);
    if (this.chunkCache.size > 40) {
      const oldest = this.chunkCache.keys().next().value as number;
      this.chunkCache.delete(oldest);
    }
    return list;
  }

  private syncClouds(): void {
    const d = this.logic.d;
    const near = this.near;
    near.begin();
    const c0 = Math.floor((d - VIEW_BEHIND) / CHUNK);
    const c1 = Math.floor((d + VIEW_AHEAD) / CHUNK);
    for (let c = c0; c <= c1; c++) {
      for (const p of this.chunk(c)) near.add(p.x, p.y, -(p.d - d), p.s, p.sy, p.rot, p.color);
    }
    // colourful cloud tunnels and white cloud canyons
    const tint = new Color();
    for (const sc of this.logic.scenery) {
      if (sc.from - d > VIEW_AHEAD || sc.to - d < -VIEW_BEHIND) continue;
      if (sc.kind === 'tunnel') {
        const pal = TUNNEL_PALETTES[sc.palette % TUNNEL_PALETTES.length];
        for (let k = 0, fd = sc.from; fd <= sc.to; fd += 14, k++) {
          const ahead = fd - d;
          if (ahead > VIEW_AHEAD || ahead < -VIEW_BEHIND) continue;
          tint.set(pal[k % pal.length]);
          for (let j = 0; j < 12; j++) {
            const a = (j / 12) * Math.PI * 2 + k * 0.4;
            near.add(Math.cos(a) * 16, CORRIDOR.yStart + Math.sin(a) * 15, -ahead, 3.4, 0.8, a, tint);
          }
        }
      } else {
        for (let k = 0, fd = sc.from; fd <= sc.to; fd += 11, k++) {
          const ahead = fd - d;
          if (ahead > VIEW_AHEAD || ahead < -VIEW_BEHIND) continue;
          for (const side of [-1, 1]) {
            for (let h = 0; h < 4; h++) {
              const wob = Math.sin(k * 1.7 + h * 2.1 + side) * 1.5;
              near.add(side * (17.5 + h * 1.2 + wob), -3 + h * 7.5, -ahead, 5.5 + (h % 2), 0.85, k + h, this.white);
            }
          }
        }
      }
    }
    near.end();

    const sea = this.sea;
    sea.begin();
    for (const p of this.seaSpots) {
      const rel = (((p.d - d) % 720) + 720) % 720;
      sea.add(p.x, p.y, -(rel - 140), p.s, p.sy, p.rot, p.color);
    }
    sea.end();

    const banks = this.banks;
    banks.begin();
    for (const p of this.bankSpots) {
      banks.add(Math.cos(p.d) * 1000 + this.logic.x * 0.2, p.y, Math.sin(p.d) * 1000 - 100, p.s, p.sy, p.rot, p.color);
    }
    banks.end();
  }

  // ------------------------------------------------------------------ camera & ambience
  private syncCamera(dt: number): void {
    const l = this.logic;
    const speedK = Math.min(1, l.speed / MAX_SKY_SPEED);
    const desired = this.tmp.set(l.x * 0.85, l.y + 2.3, 7.4 + speedK * 0.6);
    const look = new Vector3(l.x * 0.9, l.y + 1.6, -16);
    let cin = 0;
    if (this.showcaseT > 0) {
      this.showcaseT = Math.max(0, this.showcaseT - dt);
      cin = Math.sin((1 - this.showcaseT / this.showcaseDur) * Math.PI);
      desired.lerp(new Vector3(l.x + this.showcaseSide * 6, l.y + 1.6, -4.5), cin);
      look.lerp(new Vector3(l.x, l.y + 0.3, 0), cin);
    }
    if (this.mode === 'title') {
      const a = this.time * 0.3;
      desired.set(l.x + Math.sin(a) * 7, l.y + 2, Math.cos(a) * 7);
      look.set(l.x, l.y, 0);
    }
    this.camPos.lerp(desired, 1 - Math.exp(-(5 + cin * 3) * dt));
    this.camLook.lerp(look, 1 - Math.exp(-8 * dt));
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = this.shakeAmt * this.shakeAmt * 0.3;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh,
    );
    this.camera.up.set(-l.vx * 0.012, 1, 0).normalize();
    this.camera.lookAt(this.camLook);
    const fov = this.baseFov + speedK * 6 - cin * 8;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
    this.sky.position.copy(this.camera.position);
  }

  private ambient(gdt: number, dt: number): void {
    const l = this.logic;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 0.8);
    this.hemi.intensity = 1.15 + this.flashAmt * 1.2;
    // wind sparkles rushing past give a feeling of speed
    if (this.mode === 'playing' && Math.random() < gdt * 18) {
      const p = this.tmp.set(l.x + (Math.random() - 0.5) * 24, l.y + (Math.random() - 0.5) * 14, -40 - Math.random() * 20);
      this.particles.burst(p, { count: 1, colors: ['#ffffff'], speed: 0, size: 0.25, life: 2.2, gravity: 0, drag: 0, star: false, dir: new Vector3(0, 0, l.speed * 1.4) });
    }
    if (this.player.tier >= 2 && Math.random() < gdt * 20) {
      const p = this.tmp.set(l.x + (Math.random() - 0.5) * this.player.width, l.y + (Math.random() - 0.5) * this.player.height, 0.3);
      this.particles.burst(p, { count: 1, colors: this.player.tier >= 3 ? ['#ffd75e', '#fff3b0'] : ['#ffffff', '#b9f3ff'], speed: 0.5, size: 0.35, life: 0.8, gravity: 0, dir: new Vector3(0, 0, l.speed * 0.6) });
    }
  }

  /** Testing hook: jump to a distance with a given value. */
  teleport(d: number, value?: number): void {
    const l = this.logic;
    l.reset(value ?? l.value);
    l.d = d;
    l.update(0.0001, { dx: 0, dy: 0, axisX: 0, axisY: 0 });
    this.player.setValue(l.value);
    this.hud.setValue(l.value, false);
  }
}

