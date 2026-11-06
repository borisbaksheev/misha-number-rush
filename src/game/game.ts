// Orchestrates rendering, simulation, effects, audio and UI.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Object3D,
  PointLight,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GameMode, ModeHost, ModeState, Quality } from '../app';
import type { Sound } from '../audio/sound';
import { QUALITY } from '../app';
import { formatNumber } from '../math/numberMath';
import { buildEnvironment, SUN_DIR, type EnvironmentVisual } from '../render/environment';
import { BumperVisual, PadVisual, Portal } from '../render/items';
import { NumberCharacter } from '../render/numberCharacter';
import { SKY } from '../render/palette';
import { Particles } from '../render/particles';
import { buildTrack, type TrackVisual } from '../render/trackMesh';
import type { Hud } from '../ui/hud';
import { CameraRig } from './cameraRig';
import { Course, inSpan, type MathItem } from './course';
import type { InputController } from './input';
import { MAX_SPEED, RaceLogic, type RaceEvent } from './raceLogic';
import { newFrame } from './trackPath';
import { Transformations, type FxHost } from './transforms';

/** The original number racing mode. */
export class Game implements FxHost, GameMode {
  readonly id = 'race' as const;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly course = new Course();
  readonly logic = new RaceLogic(this.course);
  readonly rig: CameraRig;
  readonly particles = new Particles();
  readonly sound: Sound;
  readonly hud: Hud;
  readonly input: InputController;
  readonly player = new NumberCharacter(2);
  readonly fx: Transformations;
  mode: ModeState = 'title';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private track: TrackVisual;
  private env: EnvironmentVisual;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private tunnelLight: PointLight;
  private portals = new Map<string, Portal>();
  private bumpers: BumperVisual[] = [];
  private pads: PadVisual[] = [];
  private buddies = new Map<string, NumberCharacter>();
  private tf = newFrame();
  private tmp = new Vector3();
  private m4 = new Matrix4();
  private back = new Vector3();
  private time = 0;
  private timeScale = 1;
  private slowTimer = 0;
  private slowFactor = 1;
  private spinVel = 0;
  private flipVel = 0;
  private flash = 0;
  private flashColor = new Color('#ffffff');
  private hintTimer = 0;
  private stride = 0;
  private width = 1;
  private height = 1;
  /** Debug/test driver: holds the throttle and optionally steers to a lateral position. */
  autopilot: { lane: number | null } | null = null;

  constructor(host: ModeHost) {
    this.renderer = host.renderer;
    this.sound = host.sound;
    this.hud = host.hud;
    this.input = host.input;
    this.rig = new CameraRig(1);
    this.fx = new Transformations(this);

    // lighting
    this.scene.environment = host.envMap;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = SKY.mid.clone();
    this.hemi = new HemisphereLight('#d8eeff', '#ffc9e3', 1.05);
    this.sun = new DirectionalLight('#fff1dc', 2.3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.tunnelLight = new PointLight('#ff9fe6', 0, 22, 1.5);
    this.scene.add(this.tunnelLight);
    this.scene.fog = null;

    // world
    this.env = buildEnvironment(this.course);
    this.track = buildTrack(this.course);
    this.scene.add(this.env.group, this.track.group, this.particles.group, this.player.root);
    this.buildItems();

    this.hud.setValue(2, false);
  }

  // ------------------------------------------------------------------ setup
  private buildItems(): void {
    for (const item of this.course.data.items) {
      if (item.kind === 'buddy') {
        const op = this.course.itemOp(item, 1);
        const ch = new NumberCharacter(op?.operand ?? 2);
        ch.celebrate(999);
        this.buddies.set(item.id, ch);
        this.scene.add(ch.root);
        continue;
      }
      const lane = this.course.itemCenter(item);
      const op = this.course.itemOp(item, 1);
      const radius = item.kind === 'finale' ? 6.3 : item.lane ? 3.35 : 5.6;
      const colorKey = item.kind === 'join' ? 'join' : item.kind === 'finale' ? 'finale' : op!.kind;
      const portal = new Portal(item.kind === 'gate' ? 'gate' : item.kind, radius, colorKey);
      if (item.kind === 'join') portal.setLabel('JOIN +');
      else if (op) portal.setOp(op);
      this.place(portal.group, item.s, lane.center, 0);
      this.portals.set(item.id, portal);
      this.scene.add(portal.group);
    }
    this.course.data.bumpers.forEach((b, i) => {
      const v = new BumperVisual(b.r, i);
      this.bumpers.push(v);
      this.scene.add(v.group);
    });
    for (const p of this.course.data.pads) {
      const v = new PadVisual(p.r);
      this.place(v.group, p.s, p.x, 0);
      this.pads.push(v);
      this.scene.add(v.group);
    }
  }

  applyQuality(quality: Quality): void {
    const q = QUALITY[quality];
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null as never;
    }
    if (q.bloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.22, 0.45, 0.95);
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
    this.rig.setAspect(w / h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.bloom?.resolution.set(w / 2, h / 2);
    }
    this.particles.setScale(h * this.renderer.getPixelRatio(), this.rig.baseFov);
  }

  // ------------------------------------------------------------------ FxHost
  place(obj: Object3D, s: number, x: number, y: number): void {
    const f = this.course.path.frameAt(s, this.tf);
    this.back.copy(f.tangent).negate();
    this.m4.makeBasis(f.right, f.up, this.back);
    obj.quaternion.setFromRotationMatrix(this.m4);
    obj.position.copy(f.pos).addScaledVector(f.right, x).addScaledVector(f.up, y);
  }

  worldPoint(s: number, x: number, y: number, out: Vector3): Vector3 {
    return this.course.path.pointAt(s, x, y, out);
  }

  slowmo(factor: number, seconds: number): void {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, seconds);
  }

  environmentFlash(color: string, strength: number): void {
    this.flash = strength;
    this.flashColor.set(color);
  }

  portalFlash(item: MathItem): void {
    this.portals.get(item.id)?.flash();
    const lane = this.course.itemCenter(item);
    const p = this.worldPoint(item.s, lane.center, 3, new Vector3());
    const colors = ['#ffffff', '#ffe066', '#ff7ad9', '#3ff0ff'];
    this.particles.burst(p, { count: 30, colors, speed: 9, size: 0.42, radius: 2.5 });
  }

  // ------------------------------------------------------------------ flow
  start(): void {
    this.sound.unlock();
    this.mode = 'playing';
    this.hud.clearMessages();
    this.hud.show(true);
    this.hud.setLap(this.logic.lap);
    this.hud.setValue(this.logic.team.leader, false);
    this.hud.setHint('Hold to run · Slide to steer');
    this.hud.showHint(true);
    this.hintTimer = 0;
    this.sound.click();
  }

  pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.reset();
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
  }

  restart(): void {
    this.logic.reset();
    this.fx.reset();
    this.player.setValue(2);
    this.player.spin = 0;
    this.player.flip = 0;
    this.hud.setValue(2, false);
    this.hud.setLap(1);
    this.hud.setTeam('');
    this.input.reset();
    this.rig.snap();
    this.mode = 'playing';
  }

  toTitle(): void {
    this.restart();
    this.autopilot = null;
    this.mode = 'title';
  }

  // ------------------------------------------------------------------ loop
  frame(realDt: number): void {
    const dt = this.mode === 'paused' ? 0 : realDt;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }
    const target = this.slowTimer > 0 ? this.slowFactor : 1;
    this.timeScale += (target - this.timeScale) * (1 - Math.exp(-12 * dt));
    const gdt = dt * this.timeScale;
    this.time += gdt;

    if (this.mode === 'playing') {
      const input = this.input.poll();
      if (this.autopilot) {
        input.throttle = true;
        const lane = this.autopilot.lane;
        if (lane !== null) this.logic.targetX += (lane - this.logic.targetX) * Math.min(1, gdt * 4);
      }
      // fixed sub-steps keep the arcade physics stable
      const steps = Math.max(1, Math.ceil(gdt / (1 / 90)));
      for (let i = 0; i < steps; i++) {
        this.logic.update(gdt / steps, {
          throttle: input.throttle,
          steerDelta: input.steerDelta / steps,
          steerAxis: input.steerAxis,
        });
      }
      for (const e of this.logic.drainEvents()) this.onEvent(e);
      if (this.input.pressing || this.autopilot) this.hintTimer += dt;
      if (this.hintTimer > 2.5) this.hud.showHint(false);
    }

    this.fx.update(gdt);
    this.syncPlayer(gdt);
    this.syncItems(gdt);
    this.syncWorld(gdt, dt);
    this.sound.tick(Math.min(1, this.logic.speed / MAX_SPEED), this.mode === 'playing');

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.rig.camera);
  }

  private onEvent(e: RaceEvent): void {
    const p = this.player;
    const l = this.logic;
    switch (e.type) {
      case 'math':
        this.fx.handle(e.item, e.result);
        break;
      case 'buddyRun':
        this.sound.buddyHello();
        break;
      case 'jump':
        p.impulse(3.5);
        this.sound.jump();
        this.particles.puff(this.worldPoint(l.s, l.x, l.y, this.tmp), 10, '#ffffff', 3, 1);
        if (e.source === 'pad') {
          this.flipVel = (Math.PI * 2) / 0.95;
          this.pads.forEach((v) => v.bounce());
        } else this.spinVel = (Math.PI * 2) / 0.85;
        break;
      case 'land':
        p.impulse(-3 - e.impact * 6);
        this.sound.land(e.impact);
        this.rig.shake(e.impact * 0.6);
        this.particles.puff(this.worldPoint(l.s, l.x, l.y + 0.1, this.tmp), 16, '#ffffff', 5, 1.1, 0.6);
        this.particles.shockwave(this.worldPoint(l.s, l.x, l.y + 0.08, this.tmp), this.frameUp(l.s), 3 + e.impact * 3, '#ffffff', 0.45);
        break;
      case 'bump': {
        this.bumpers[e.index]?.hit(e.strength);
        p.impulse(-2.5);
        p.setExpression('oh', 0.5);
        this.sound.bump(e.strength);
        this.rig.shake(0.25 + e.strength * 0.3);
        const b = this.course.data.bumpers[e.index];
        const pt = this.worldPoint(b.s, l.bumperX(e.index), 1.4, this.tmp);
        this.particles.burst(pt, { count: 26, colors: ['#ffffff', '#ff9fd0', '#ffe066'], speed: 7, size: 0.5 });
        break;
      }
      case 'rail':
        this.sound.rail();
        this.particles.burst(this.worldPoint(l.s, l.x + e.side * 0.8, l.y + 0.5, this.tmp), {
          count: 8,
          colors: ['#ffffff', '#ffe066'],
          speed: 4,
          size: 0.3,
          life: 0.4,
        });
        break;
      case 'fall':
        this.sound.fall();
        p.setExpression('oh', 1.5);
        break;
      case 'respawn':
        this.sound.respawn();
        this.particles.puff(this.worldPoint(l.s, l.x, 0.6, this.tmp), 30, '#ffffff', 4, 1.6);
        p.pop(0.6);
        this.fx.onRespawn();
        break;
      case 'boost':
        this.sound.boost();
        this.rig.shake(0.2);
        break;
      case 'lap':
        this.sound.lap();
        this.hud.setLap(e.lap);
        this.hud.toast(e.lap === 2 ? 'Lap 2! Big number gates are open: ×10!' : `Lap ${e.lap}! Keep growing!`, 3.2);
        this.particles.confettiBurst(this.worldPoint(l.s + 4, l.x, 3, this.tmp), 80, ['#ff5fa2', '#ffe066', '#3ea6ff', '#8fd14f'], 10, 8);
        break;
    }
  }

  private frameUp(s: number): Vector3 {
    return this.course.path.frameAt(s, this.tf).up.clone();
  }

  private syncPlayer(dt: number): void {
    const l = this.logic;
    const p = this.player;
    const airborne = !l.grounded || l.fallTime > 0;
    // spins and flips while airborne, settle to upright on landing
    if (airborne) {
      p.spin += this.spinVel * dt;
      p.flip += this.flipVel * dt;
    } else {
      this.spinVel = 0;
      this.flipVel = 0;
      const settle = (a: number) => {
        const target = Math.round(a / (Math.PI * 2)) * Math.PI * 2;
        const v = a + (target - a) * (1 - Math.exp(-14 * dt));
        return Math.abs(v - target) < 0.01 ? 0 : v;
      };
      if (!this.fx.busy) p.spin = settle(p.spin);
      p.flip = settle(p.flip);
    }
    this.place(p.root, l.s, l.x, l.y);
    this.stride += l.speed * dt;
    p.update(dt, { speed: l.speed, steer: l.steerVelocity, airborne, stride: this.stride });
    if (this.mode === 'title') {
      p.celebrate(0.2);
    }
  }

  private syncItems(dt: number): void {
    const l = this.logic;
    const c = this.course;
    for (const item of c.data.items) {
      if (item.kind === 'buddy') {
        const ch = this.buddies.get(item.id)!;
        const b = l.buddies.find((x) => x.item.id === item.id);
        ch.root.visible = !!b && b.state !== 'merged';
        if (b && b.state !== 'merged') {
          const hop = b.state === 'waiting' ? Math.abs(Math.sin(this.time * 4)) * 0.7 : 0;
          this.place(ch.root, b.s, b.x, hop);
          ch.update(dt, { speed: b.state === 'running' ? 12 : 0, steer: 0, airborne: hop > 0.05, stride: this.time * 9 });
        }
        continue;
      }
      const portal = this.portals.get(item.id)!;
      const active = c.itemActive(item, l.lap);
      portal.group.visible = active;
      const op = c.itemOp(item, l.lap);
      if (op) {
        portal.setOp(op);
        portal.setSleeping(!l.team.canApply(op));
      } else if (item.kind === 'join') {
        portal.setSleeping(l.team.companions.length === 0);
      }
      portal.update(this.time, dt);
    }
    c.data.bumpers.forEach((b, i) => {
      this.place(this.bumpers[i].group, b.s, l.bumperX(i), 0);
      this.bumpers[i].update(this.time, dt);
    });
    this.pads.forEach((p) => p.update(this.time, dt));
  }

  private syncWorld(gdt: number, dt: number): void {
    const l = this.logic;
    const f = this.course.path.frameAt(l.s, this.tf);
    const target = this.tmp.copy(f.pos).addScaledVector(f.right, l.x).addScaledVector(f.up, Math.max(l.y, -6));
    this.rig.orbit += ((this.mode === 'title' ? 1 : 0) - this.rig.orbit) * (1 - Math.exp(-2.5 * dt));
    this.rig.update(dt, target, f, l.speed, !l.grounded, this.time);

    // shadow camera follows the player
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(SUN_DIR, 70);

    // tunnel glow
    const inTunnel = inSpan(l.s, this.course.data.tunnel);
    this.tunnelLight.intensity += ((inTunnel ? 40 : 0) - this.tunnelLight.intensity) * (1 - Math.exp(-6 * dt));
    this.tunnelLight.position.copy(target).addScaledVector(f.up, 4).addScaledVector(f.tangent, 3);
    this.tunnelLight.color.setHSL((this.time * 0.15) % 1, 0.8, 0.7);

    // environment flash for big-number celebrations
    this.flash = Math.max(0, this.flash - dt * 0.8);
    this.hemi.intensity = 1.05 + this.flash * 1.4;
    this.hemi.color.set('#d8eeff').lerp(this.flashColor, this.flash * 0.6);

    const speedK = Math.min(1.3, l.speed / MAX_SPEED);
    this.particles.speedLines(this.rig.camera.position, f.tangent, f.right, f.up, Math.max(0, speedK - 0.65) * 2.2, gdt);
    // footstep dust and golden aura for huge numbers
    if (l.grounded && l.speed > 6 && Math.random() < l.speed * gdt * 0.5) {
      this.particles.puff(this.worldPoint(l.s - 0.4, l.x + (Math.random() - 0.5) * this.player.width, 0.1, new Vector3()), 1, '#ffffff', 1, 0.6, 0.6);
    }
    if (this.player.tier >= 2 && Math.random() < gdt * 25) {
      const p = this.worldPoint(l.s, l.x + (Math.random() - 0.5) * this.player.width * 1.2, l.y + Math.random() * this.player.height * 1.3, new Vector3());
      this.particles.burst(p, { count: 1, colors: this.player.tier >= 3 ? ['#ffd75e', '#fff3b0'] : ['#ffffff', '#b9f3ff', '#ffc2f0'], speed: 0.6, up: 1, size: 0.35, life: 0.8, gravity: -0.5 });
    }
    this.particles.update(gdt, this.rig.camera);
    this.track.update(this.time);
    this.env.update(this.time, gdt, this.rig.camera.position);
  }

  /** Testing hook: a short description of the current state. */
  describe(): string {
    const l = this.logic;
    return `race ${this.mode} lap=${l.lap} s=${l.s.toFixed(1)} x=${l.x.toFixed(2)} v=${l.speed.toFixed(1)} value=${formatNumber(l.team.leader)} team=${l.team.total()}`;
  }

  /** Puts the player on the track at arc length s (title screen and tests). */
  placePlayer(s: number): void {
    this.logic.s = s;
    this.place(this.player.root, s, 0, 0);
  }
}
