// Animated mathematical transformations: merging, duplicating, splitting, separating and joining.
// The maths has already happened in NumberTeam; these sequences only *show* it.
import { Object3D, Vector3 } from 'three';
import type { Sound } from '../audio/sound';
import {
  celebrationLevel,
  equation,
  formatNumber,
  isPowerOfTen,
  numberToWords,
  refusalMessage,
} from '../math/numberMath';
import type { Companion, TeamEvent } from '../math/team';
import { NumberCharacter } from '../render/numberCharacter';
import { DIGIT_COLORS, OP_COLORS } from '../render/palette';
import type { Particles } from '../render/particles';
import type { Hud } from '../ui/hud';
import type { CameraRig } from './cameraRig';
import { PLAYER_RADIUS, type RaceLogic } from './raceLogic';
import type { MathItem } from './course';

export interface FxHost {
  logic: RaceLogic;
  player: NumberCharacter;
  particles: Particles;
  sound: Sound;
  hud: Hud;
  rig: CameraRig;
  scene: Object3D;
  /** Position + orient an object on the track. */
  place(obj: Object3D, s: number, x: number, y: number): void;
  worldPoint(s: number, x: number, y: number, out: Vector3): Vector3;
  slowmo(factor: number, seconds: number): void;
  environmentFlash(color: string, strength: number): void;
  portalFlash(item: MathItem): void;
}

interface Actor {
  char: NumberCharacter;
  age: number;
  /** Returns false when finished. */
  step(dt: number, age: number, a: Actor): boolean;
}

interface CompanionVisual {
  data: Companion;
  char: NumberCharacter;
  ds: number;
  dx: number;
  y: number;
  vy: number;
  stride: number;
  /** 0..1 hop-in animation progress. */
  arrive: number;
  joining: boolean;
}

const v1 = new Vector3();
const v2 = new Vector3();

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function colorsOf(n: number): string[] {
  const set = new Set<string>();
  for (const ch of formatNumber(n)) if (DIGIT_COLORS[ch] && ch !== ',') set.add(DIGIT_COLORS[ch]);
  set.add('#ffffff');
  set.add('#ffe066');
  return [...set];
}

export class Transformations {
  private actors: Actor[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private time = 0;
  companions: CompanionVisual[] = [];
  /** Value the player character is allowed to show (lags the maths during animations). */
  private pendingValue: number | null = null;

  constructor(private h: FxHost) {}

  reset(): void {
    for (const a of this.actors) a.char.detach();
    for (const c of this.companions) c.char.detach();
    this.actors = [];
    this.companions = [];
    this.timers = [];
    this.pendingValue = null;
  }

  get busy(): boolean {
    return this.pendingValue !== null;
  }

  private after(delay: number, fn: () => void): void {
    this.timers.push({ at: this.time + delay, fn });
  }

  private spawn(value: number, step: Actor['step'], scale = 1): NumberCharacter {
    const char = new NumberCharacter(value, scale);
    this.h.scene.add(char.root);
    this.actors.push({ char, age: 0, step });
    return char;
  }

  /** Track-space position of the player's body centre. */
  private playerPoint(out: Vector3, dy = 0.9): Vector3 {
    const l = this.h.logic;
    return this.h.worldPoint(l.s, l.x, l.y + dy, out);
  }

  private settle(value: number, opts: { burst?: number; big?: boolean } = {}): void {
    const { player, particles, sound } = this.h;
    player.setValue(value);
    player.pop(1);
    this.pendingValue = null;
    this.h.hud.setValue(value);
    const at = this.playerPoint(v1, 1);
    particles.burst(at, { count: opts.burst ?? 40, colors: colorsOf(value), speed: 7, up: 2, size: 0.55, life: 0.9 });
    particles.confettiBurst(at, Math.round((opts.burst ?? 40) * 0.6), colorsOf(value), 7, 5);
    sound.merge(opts.big);
  }

  // ------------------------------------------------------------------ events
  handle(item: MathItem, ev: TeamEvent): void {
    const h = this.h;
    if (ev.type === 'refused') {
      h.sound.refuse();
      h.hud.toast(refusalMessage(ev.value, ev.op, ev.reason === 'too-small' || ev.reason === 'too-many' ? 'bad-operand' : ev.reason));
      h.player.setExpression('oh', 1);
      h.player.impulse(-2);
      return;
    }
    if (item.kind !== 'buddy') h.portalFlash(item);
    if (ev.type === 'apply') {
      const text = equation(ev.before, ev.op, ev.after);
      h.hud.showEquation(text);
      if (ev.op.kind === 'add') this.add(item, ev.op.operand, ev.after);
      else if (ev.op.kind === 'sub') this.subtract(ev.op.operand, ev.after);
      else if (ev.op.kind === 'mul') this.multiply(ev.before, ev.op.operand, ev.after);
      this.after(0.8, () => this.celebrate(ev.before, ev.after));
    } else if (ev.type === 'split') {
      h.hud.showEquation(`${formatNumber(ev.before)} ÷ ${ev.op.operand} = ${formatNumber(ev.leader)}`);
      this.split(ev.leader, ev.created);
    } else if (ev.type === 'join') {
      const parts = [ev.before, ...ev.joined.map((c) => c.value)].map(formatNumber).join(' + ');
      h.hud.showEquation(`${parts} = ${formatNumber(ev.after)}`);
      this.join(ev.after);
    }
  }

  /** Addition: a number flies in (buddy or from the gate) and merges with a spin. */
  private add(item: MathItem, k: number, after: number): void {
    const h = this.h;
    this.pendingValue = after;
    h.slowmo(0.45, 0.5);
    h.sound.buddyHello();
    const fromBuddy = item.kind === 'buddy';
    const startDs = fromBuddy ? 1.4 : 3;
    const startDy = fromBuddy ? 0 : 3.2;
    const dur = fromBuddy ? 0.55 : 0.6;
    this.spawn(k, (_dt, age, a) => {
      const l = h.logic;
      const t = Math.min(1, age / dur);
      const e = ease(t);
      const ang = e * Math.PI * 2.2;
      const r = (1 - e) * 1.8;
      const ds = startDs * (1 - e) + Math.cos(ang) * r * 0.4;
      const dx = Math.sin(ang) * r;
      const dy = startDy * (1 - e) + Math.sin(t * Math.PI) * 1.4;
      h.place(a.char.root, l.s + ds, l.x + dx, l.y + dy);
      a.char.spin = ang * 1.5;
      a.char.update(_dt, { speed: 10, steer: 0, airborne: true, stride: age * 12 });
      h.player.spin = Math.sin(t * Math.PI) * Math.PI * 2 * 0.5;
      if (t >= 1) {
        h.player.spin = 0;
        this.settle(after);
        return false;
      }
      return true;
    }).setExpression('grin', 2);
  }

  /** Subtraction: the number trembles and a part bounces away. */
  private subtract(k: number, after: number): void {
    const h = this.h;
    this.pendingValue = after;
    h.slowmo(0.5, 0.45);
    h.player.impulse(2.5);
    h.player.setExpression('oh', 0.6);
    this.after(0.28, () => {
      h.player.setValue(after);
      h.player.pop(0.7);
      this.pendingValue = null;
      h.hud.setValue(after);
      h.sound.separate();
      const side = h.logic.x > 0 ? -1 : 1;
      const startX = side * (h.player.width / 2 + 0.6);
      const sAt = h.logic.s;
      const xAt = h.logic.x;
      h.particles.burst(this.playerPoint(v1, 1), { count: 24, colors: [OP_COLORS.sub, '#ffffff'], speed: 6 });
      this.spawn(k, (dt, age, a) => {
        // hop off sideways in a few bounces, then poof
        const hop = Math.abs(Math.sin(age * 5.5)) * 2.2 * Math.max(0, 1 - age / 1.6);
        h.place(a.char.root, sAt + age * 4, xAt + startX + side * age * 5, hop);
        a.char.spin = side * age * 4;
        a.char.update(dt, { speed: 12, steer: side * 5, airborne: hop > 0.1, stride: age * 14 });
        if (age > 1.5) {
          h.particles.puff(a.char.root.position, 14, '#ffffff', 3, 1.2);
          return false;
        }
        return true;
      }).celebrate(1.5);
    });
  }

  /** Multiplication: duplicates appear and combine; powers of ten attach zeros. */
  private multiply(before: number, k: number, after: number): void {
    const h = this.h;
    this.pendingValue = after;
    h.sound.multiply();
    if (isPowerOfTen(k) && before > 0) {
      this.attachZeros(after, Math.round(Math.log10(k)));
      return;
    }
    h.slowmo(0.45, 0.6);
    const copies = Math.min(4, k - 1);
    const w = h.player.width;
    const scale = before >= 1000 ? 0.8 : 1;
    let done = 0;
    for (let i = 0; i < copies; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const slot = Math.floor(i / 2) + 1;
      const ox = side * slot * (w * scale + 0.5);
      this.spawn(
        before,
        (dt, age, a) => {
          const l = h.logic;
          const appear = Math.min(1, age / 0.22);
          const t = Math.max(0, (age - 0.42) / 0.3);
          const e = ease(t);
          h.place(a.char.root, l.s + 0.3, l.x + ox * (1 - e), l.y + Math.sin(appear * Math.PI) * 0.8 + Math.sin(e * Math.PI) * 1.1);
          a.char.root.scale.setScalar(scale * (0.2 + 0.8 * ease(appear)) * (1 - e * 0.4));
          a.char.update(dt, { speed: 8, steer: -side * 6 * e, airborne: true, stride: age * 10 });
          if (t >= 1) {
            done++;
            if (done === copies) this.settle(after, { burst: 60 });
            else h.particles.burst(this.playerPoint(v1, 1), { count: 14, colors: colorsOf(before), speed: 5 });
            return false;
          }
          return true;
        },
        scale,
      ).setExpression('grin', 2);
    }
    // the player also bounces while being copied
    h.player.impulse(3);
    h.particles.burst(this.playerPoint(v1, 1), { count: 30, colors: [OP_COLORS.mul, '#ffffff'], speed: 8 });
  }

  /** ×10, ×100 …: shining zeros fly in and click onto the end of the number. */
  private attachZeros(after: number, zeros: number): void {
    const h = this.h;
    h.slowmo(0.4, 0.75);
    let arrived = 0;
    for (let i = 0; i < zeros; i++) {
      const delay = i * 0.18;
      this.spawn(0, (dt, age, a) => {
        const l = h.logic;
        const t = Math.max(0, (age - delay) / 0.55);
        const e = ease(t);
        const endX = h.player.width / 2 + 0.35 + i * 0.7;
        const dx = 4.5 * (1 - e) + endX * e;
        const dy = 4 * (1 - e) + 0.15 * e + Math.sin(e * Math.PI) * 1.2;
        h.place(a.char.root, l.s + 3 * (1 - e), l.x + dx, l.y + dy);
        a.char.root.scale.setScalar(0.35 + 0.35 * e);
        a.char.spin = (1 - e) * Math.PI * 4;
        a.char.update(dt, { speed: 0, steer: 0, airborne: true, stride: 0 });
        if (age > delay && Math.random() < 0.5) {
          h.particles.burst(a.char.root.position, { count: 2, colors: ['#ffffff', '#ffe066', OP_COLORS.mul], speed: 1.5, size: 0.4, life: 0.5, gravity: 0 });
        }
        if (t >= 1) {
          arrived++;
          h.particles.burst(a.char.root.position, { count: 18, colors: ['#ffffff', '#ffe066'], speed: 5, size: 0.5 });
          h.sound.click();
          if (arrived === zeros) this.settle(after, { burst: 70, big: after >= 1000 });
          return false;
        }
        return true;
      }).setExpression('grin', 2);
    }
    h.player.setExpression('oh', 0.8);
  }

  /** Division: the number stretches and splits into equal living parts. */
  private split(leader: number, created: Companion[]): void {
    const h = this.h;
    this.pendingValue = leader;
    h.slowmo(0.45, 0.6);
    h.player.impulse(4);
    h.player.setExpression('oh', 0.5);
    h.sound.portal();
    this.after(0.32, () => {
      h.player.setValue(leader);
      h.player.pop(0.9);
      this.pendingValue = null;
      h.hud.setValue(leader);
      h.sound.split();
      const at = this.playerPoint(v1, 1);
      h.particles.burst(at, { count: 50, colors: [OP_COLORS.div, '#ffffff', ...colorsOf(leader)], speed: 8, up: 2 });
      h.particles.shockwave(this.playerPoint(v2, 0.1), this.upAt(), 5, OP_COLORS.div, 0.6);
      for (const c of created) this.addCompanion(c);
    });
  }

  private upAt(): Vector3 {
    const l = this.h.logic;
    const a = this.h.worldPoint(l.s, l.x, 0, new Vector3());
    return this.h.worldPoint(l.s, l.x, 1, new Vector3()).sub(a).normalize();
  }

  private addCompanion(data: Companion): void {
    const char = new NumberCharacter(data.value);
    this.h.scene.add(char.root);
    char.celebrate(1.2);
    this.companions.push({ data, char, ds: 0, dx: 0, y: this.h.logic.y, vy: 7, stride: 0, arrive: 0, joining: false });
  }

  /** Companions run into the leader one after another and merge back. */
  private join(after: number): void {
    const h = this.h;
    this.pendingValue = after;
    h.slowmo(0.5, 0.6);
    const list = this.companions;
    this.companions = [];
    list.forEach((c, i) => {
      c.joining = true;
      const startDs = c.ds;
      const startDx = c.dx;
      const delay = i * 0.2;
      this.actors.push({
        char: c.char,
        age: 0,
        step: (dt, age, a) => {
          const l = h.logic;
          const t = Math.max(0, (age - delay) / 0.4);
          const e = ease(t);
          h.place(a.char.root, l.s + startDs * (1 - e), l.x + startDx * (1 - e), l.y + Math.sin(e * Math.PI) * 1.4);
          a.char.spin = e * Math.PI * 2;
          a.char.update(dt, { speed: 14, steer: -Math.sign(startDx) * 8, airborne: t > 0, stride: age * 14 });
          if (t >= 1) {
            h.particles.burst(this.playerPoint(v1, 1), { count: 20, colors: colorsOf(c.data.value), speed: 5 });
            if (i === list.length - 1) this.settle(after, { burst: 60 });
            return false;
          }
          return true;
        },
      });
    });
    if (!list.length) this.settle(after);
  }

  /** Big numbers get banners, fireworks, a camera swoop and an environment reaction. */
  private celebrate(before: number, after: number): void {
    const h = this.h;
    const level = celebrationLevel(before, after);
    if (level === 0) return;
    const at = this.playerPoint(v1, 1.2);
    if (level === 1) {
      h.particles.confettiBurst(at, 40, colorsOf(after), 8, 7);
      return;
    }
    h.hud.showBanner(`${numberToWords(after)}!`);
    h.sound.fanfare(level);
    h.rig.showcase(level >= 3 ? 2.4 : 1.8);
    h.slowmo(0.35, level >= 3 ? 1.4 : 0.9);
    h.player.celebrate(2.5);
    h.environmentFlash(level >= 3 ? '#ffd75e' : '#ffffff', level >= 3 ? 1 : 0.6);
    h.particles.shockwave(this.playerPoint(v2, 0.15), this.upAt(), 14, level >= 3 ? '#ffd75e' : '#ffffff', 1.1);
    const colors = level >= 3 ? ['#ffd75e', '#fff3b0', '#ffffff', '#ff9f1c'] : colorsOf(after);
    const bursts = level >= 3 ? 7 : 4;
    for (let i = 0; i < bursts; i++) {
      this.after(0.15 + i * 0.22, () => {
        const l = h.logic;
        const p = h.worldPoint(l.s + 6 + Math.random() * 10, l.x + (Math.random() - 0.5) * 14, 6 + Math.random() * 6, new Vector3());
        h.particles.burst(p, { count: 70, colors, speed: 10, up: 0, size: 0.8, life: 1.3, gravity: 3, drag: 1.2 });
        h.sound.click();
      });
    }
    h.particles.confettiBurst(at, level >= 3 ? 160 : 90, colors, 11, 9);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number): void {
    this.time += dt;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();

    this.actors = this.actors.filter((a) => {
      a.age += dt;
      const alive = a.step(dt, a.age, a);
      if (!alive) a.char.detach();
      return alive;
    });
    this.updateCompanions(dt);
  }

  /** Companions trot beside the leader, keeping on the road. */
  private updateCompanions(dt: number): void {
    const h = this.h;
    const l = h.logic;
    const c = l.course;
    const n = this.companions.length;
    this.companions.forEach((comp, i) => {
      const lane = c.laneFor(l.s, l.x);
      const lo = lane.center - lane.width / 2 + PLAYER_RADIUS;
      const hi = lane.center + lane.width / 2 - PLAYER_RADIUS;
      const gap = h.player.width / 2 + comp.char.width / 2 + 0.7;
      let side = i % 2 === 0 ? 1 : -1;
      if (l.x + side * gap > hi) side = -1;
      if (l.x + side * gap < lo) side = 1;
      const slot = Math.floor(i / 2);
      let targetDx = side * (gap + slot * (comp.char.width + 0.5));
      targetDx = Math.min(hi, Math.max(lo, l.x + targetDx)) - l.x;
      const targetDs = -1.5 - slot * 1.2 + Math.sin(l.time * 2 + i) * 0.3;
      const k = 1 - Math.exp(-5 * dt);
      comp.dx += (targetDx - comp.dx) * k;
      comp.ds += (targetDs - comp.ds) * k;
      comp.arrive = Math.min(1, comp.arrive + dt * 2.5);
      // follow the leader's height with a little delay, plus the hop-out arc
      comp.vy -= 28 * dt;
      comp.y += comp.vy * dt;
      const floor = l.y - 0.2;
      if (comp.y < floor) {
        comp.y += (l.y - comp.y) * (1 - Math.exp(-12 * dt));
        comp.vy = Math.max(comp.vy, 0);
      }
      if (l.fallTime > 0) comp.y = l.y;
      comp.stride += l.speed * dt;
      h.place(comp.char.root, l.s + comp.ds, l.x + comp.dx, comp.y);
      comp.char.root.scale.setScalar(0.3 + 0.7 * ease(comp.arrive));
      comp.char.update(dt, { speed: l.speed, steer: l.steerVelocity, airborne: comp.y > l.y + 0.3, stride: comp.stride });
    });
    h.hud.setTeam(
      n ? `Team: ${[l.team.leader, ...this.companions.map((x) => x.data.value)].map(formatNumber).join(' + ')} = ${formatNumber(l.team.total())}` : '',
    );
  }

  onRespawn(): void {
    for (const c of this.companions) {
      c.y = this.h.logic.y + 2;
      c.vy = 4;
      this.h.particles.puff(c.char.root.position, 10);
    }
  }

}
