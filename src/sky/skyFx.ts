// Animated maths transformations for Sky Numbers. The value has already changed in SkyLogic;
// these sequences only show it, reusing the living number characters. Whole numbers only.
import { Object3D, Vector3 } from 'three';
import type { Sound } from '../audio/sound';
import { celebrationLevel, equation, formatNumber, isPowerOfTen, numberToWords, type MathOp } from '../math/numberMath';
import { NumberCharacter } from '../render/numberCharacter';
import { DIGIT_COLORS, OP_COLORS } from '../render/palette';
import type { Particles } from '../render/particles';
import type { Hud } from '../ui/hud';
import type { SkyLogic } from './skyLogic';

export interface SkyFxHost {
  scene: Object3D;
  player: NumberCharacter;
  logic: SkyLogic;
  particles: Particles;
  sound: Sound;
  hud: Hud;
  slowmo(factor: number, seconds: number): void;
  shake(amount: number): void;
  showcase(seconds: number): void;
  skyFlash(strength: number): void;
  /** A lightning bolt from the storm cloud to the number. */
  lightning(from: Vector3, to: Vector3): void;
}

/** Particle budget of one storm impact (kept small for iPad Safari). */
export const STORM_IMPACT_PARTICLES = { sparks: 28, stars: 10, smoke: 12, confetti: 18 };
const IMPACT_COLORS = ['#ff5fa2', '#ffd84a', '#3ff0ff', '#8fd14f', '#b98bff', '#ffffff'];

interface Actor {
  char: NumberCharacter;
  age: number;
  step(dt: number, age: number, a: Actor): boolean;
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const v1 = new Vector3();
const v2 = new Vector3();
const FORWARD = new Vector3(0, 0, 1);


/** Digit colours of a number. */
export function colorsOf(n: number): string[] {
  const text = formatNumber(n);
  const set = new Set<string>();
  for (const ch of text) if (DIGIT_COLORS[ch] && ch !== ',' && ch !== '.') set.add(DIGIT_COLORS[ch]);
  set.add('#ffffff');
  set.add('#ffe066');
  return [...set];
}

export class SkyFx {
  private actors: Actor[] = [];
  private tasks: { age: number; step: (age: number) => boolean }[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private time = 0;
  busy = false;

  constructor(private h: SkyFxHost) {}

  /** Number of animated helper characters currently on screen. */
  get activeActors(): number {
    return this.actors.length;
  }

  reset(): void {
    for (const a of this.actors) a.char.detach();
    this.actors = [];
    this.tasks = [];
    this.timers = [];
    this.busy = false;
    this.h.player.spin = 0;
  }

  private after(delay: number, fn: () => void): void {
    this.timers.push({ at: this.time + delay, fn });
  }

  /** Player-relative position (the player always sits at z = 0). */
  private at(dx: number, dy: number, dz: number, out = v1): Vector3 {
    return out.set(this.h.logic.x + dx, this.h.logic.y + dy, dz);
  }

  private spawn(value: number, step: Actor['step'], scale = 1): NumberCharacter {
    const char = new NumberCharacter(value, scale);
    this.h.scene.add(char.root);
    this.actors.push({ char, age: 0, step });
    return char;
  }

  /** Show the new value on the player and the HUD. */
  private reveal(value: number): void {
    this.h.player.setValue(value);
    this.h.hud.setValue(value);
  }

  private settle(value: number, big = false, burst = 40): void {
    const h = this.h;
    this.reveal(value);
    h.player.pop(1);
    this.busy = false;
    const p = this.at(0, h.player.height * 0.5, 0);
    h.particles.burst(p, { count: burst, colors: colorsOf(value), speed: 7, up: 1, size: 0.55, life: 0.9, gravity: 1 });
    h.particles.shockwave(p, FORWARD, 4 + burst / 20, '#ffffff', 0.55);
    h.sound.merge(big);
  }

  // ------------------------------------------------------------------ public events
  portal(op: MathOp, before: number, after: number): void {
    this.h.hud.showEquation(equation(before, op, after));
    if (op.kind === 'add') this.mergeIn(op.operand, after, -4.5, 2.4, 0.6);
    else if (op.kind === 'sub') this.separate(op.operand, after);
    else if (op.kind === 'mul') this.multiply(before, op.operand, after);
    else this.split(op.operand, after);
    this.after(0.85, () => this.celebrate(before, after));
  }

  bubble(k: number, after: number, dx: number, dy: number): void {
    this.h.sound.collect();
    this.mergeIn(k, after, -1.5, 0, 0.3, dx, dy, 0.45);
  }

  /**
   * Storm cloud impact: a lightning bolt, a soft thunder, a colourful cartoon explosion and a
   * quick wobble. An even number then splits in half (16 ÷ 2 = 8); an odd number stays as it is.
   * No slow motion: flight goes on at once.
   */
  storm(before: number, after: number, halved: boolean, cloud: Vector3): void {
    const h = this.h;
    const p = this.at(0, h.player.height * 0.5, 0);
    h.lightning(v2.set(cloud.x, cloud.y - 1.2, cloud.z), p);
    h.sound.thunder();
    h.shake(0.25);
    const b = STORM_IMPACT_PARTICLES;
    h.particles.burst(p, { count: b.sparks, colors: IMPACT_COLORS, speed: 9, up: 1, size: 0.45, life: 0.6, gravity: 2, star: false });
    h.particles.burst(p, { count: b.stars, colors: ['#ffffff', '#ffe066'], speed: 6, size: 0.75, life: 0.7 });
    h.particles.puff(p, b.smoke, '#9a9cb8', 4, 1.6, 0.6);
    h.particles.confettiBurst(p, b.confetti, IMPACT_COLORS, 7, 4);
    h.particles.shockwave(p, FORWARD, 4.5, '#ffd84a', 0.5);
    h.player.setExpression('oh', 1);
    h.player.impulse(-3);
    this.wobblePlayer();
    if (halved) {
      h.hud.showEquation(equation(before, { kind: 'div', operand: 2 }, after));
      this.split(2, after, 0.2, false);
    } else {
      h.hud.toast(`${formatNumber(before)} is odd, so it stays ${formatNumber(before)}!`, 2);
    }
  }

  /** A quick, gentle wobble after a bump (no dizzy spinning). */
  private wobblePlayer(): void {
    const p = this.h.player;
    this.tasks.push({
      age: 0,
      step: (age) => {
        const t = Math.min(1, age / 0.6);
        p.spin = Math.sin(t * Math.PI * 3) * 0.45 * (1 - t);
        return t < 1;
      },
    });
  }

  // ------------------------------------------------------------------ sequences
  /** Addition: a smaller number spirals in and merges. */
  private mergeIn(k: number, after: number, startDz: number, startDy: number, dur: number, startDx = 0, fromDy = 0, scale = 0.75): void {
    const h = this.h;
    this.busy = true;
    if (dur > 0.4) h.slowmo(0.5, 0.45);
    const ch = this.spawn(
      k,
      (dt, age, a) => {
        const t = Math.min(1, age / dur);
        const e = ease(t);
        const ang = e * Math.PI * 2;
        const r = (1 - e) * 1.6;
        a.char.root.position.copy(
          this.at(startDx * (1 - e) + Math.sin(ang) * r, (startDy + fromDy) * (1 - e) + Math.sin(t * Math.PI) * 0.8, startDz * (1 - e)),
        );
        a.char.spin = ang * 1.5;
        a.char.update(dt, { speed: 6, steer: 0, airborne: true, stride: age * 10, flying: true });
        if (t >= 1) {
          this.settle(after, after >= 1000);
          return false;
        }
        return true;
      },
      scale,
    );
    ch.setExpression('grin', 2);
    ch.root.position.copy(this.at(startDx, startDy + fromDy, startDz));
  }

  /** Subtraction: a smaller number separates and floats away waving. */
  private separate(k: number, after: number): void {
    const h = this.h;
    this.busy = true;
    h.slowmo(0.5, 0.45);
    h.player.impulse(2.5);
    h.player.setExpression('oh', 0.6);
    this.after(0.25, () => {
      this.reveal(after);
      h.player.pop(0.7);
      this.busy = false;
      h.sound.separate();
      const side = h.logic.x > 0 ? -1 : 1;
      const x0 = side * (h.player.width / 2 + 0.7);
      h.particles.burst(this.at(0, 1, 0), { count: 24, colors: [OP_COLORS.sub, '#ffffff'], speed: 6 });
      const sx = h.logic.x;
      const sy = h.logic.y;
      this.spawn(
        k,
        (dt, age, a) => {
          a.char.root.position.set(sx + x0 + side * age * 2.5, sy - age * 1.4 + Math.sin(age * 4) * 0.3, age * 6);
          a.char.spin = side * Math.sin(age * 3) * 0.6;
          a.char.update(dt, { speed: 0, steer: side * 3, airborne: true, stride: 0, flying: true });
          if (age > 1.6) {
            h.particles.puff(a.char.root.position, 14, '#ffffff', 3, 1.2);
            return false;
          }
          return true;
        },
        0.8,
      ).celebrate(1.6);
    });
  }

  /** Multiplication: the number duplicates, glows and combines (zeros fly in for ×10, ×100 …). */
  private multiply(before: number, k: number, after: number): void {
    const h = this.h;
    this.busy = true;
    h.sound.multiply();
    h.particles.shockwave(this.at(0, 1, 0), FORWARD, 6, OP_COLORS.mul, 0.7);
    const big = after >= 1000;
    // ×10, ×100 … literally add zeros to the end of the number
    if (isPowerOfTen(k) && before > 0) {
      h.slowmo(0.45, 0.75);
      const zeros = Math.round(Math.log10(k));
      let arrived = 0;
      for (let i = 0; i < zeros; i++) {
        const delay = i * 0.18;
        this.spawn(
          0,
          (dt, age, a) => {
            const t = Math.max(0, (age - delay) / 0.55);
            const e = ease(t);
            const endX = h.player.width / 2 + 0.35 + i * 0.7;
            a.char.root.position.copy(this.at(4 * (1 - e) + endX * e, 3.5 * (1 - e) + 0.15 * e + Math.sin(e * Math.PI), -5 * (1 - e)));
            a.char.root.scale.setScalar(0.35 + 0.35 * e);
            a.char.spin = (1 - e) * Math.PI * 4;
            a.char.update(dt, { speed: 0, steer: 0, airborne: true, stride: 0, flying: true });
            if (t >= 1) {
              arrived++;
              h.particles.burst(a.char.root.position, { count: 16, colors: ['#ffffff', '#ffe066'], speed: 5, size: 0.5 });
              h.sound.click();
              if (arrived === zeros) this.settle(after, big, 70);
              return false;
            }
            return true;
          },
          0.35,
        ).setExpression('grin', 2);
      }
      return;
    }
    h.slowmo(0.45, 0.6);
    const copies = Math.min(4, k - 1);
    const w = h.player.width;
    let done = 0;
    for (let i = 0; i < copies; i++) {
      const ang = (i / copies) * Math.PI * 2 + Math.PI / 2;
      const rad = w * 0.6 + 1.6;
      this.spawn(
        before,
        (dt, age, a) => {
          const appear = ease(age / 0.22);
          const t = Math.max(0, (age - 0.45) / 0.3);
          const e = ease(t);
          const spin = age * 3;
          a.char.root.position.copy(this.at(Math.cos(ang + spin) * rad * (1 - e), 0.4 + Math.sin(ang + spin) * rad * 0.6 * (1 - e), 0.5));
          a.char.root.scale.setScalar(0.8 * (0.2 + 0.8 * appear) * (1 - e * 0.4));
          a.char.update(dt, { speed: 0, steer: 0, airborne: true, stride: 0, flying: true });
          if (t >= 1) {
            done++;
            if (done === copies) this.settle(after, big, 60);
            return false;
          }
          return true;
        },
        0.8,
      ).setExpression('grin', 2);
    }
    h.player.impulse(3);
  }

  /** Division: the number stretches, splits into equal parts, and the extra parts fly off. */
  private split(k: number, after: number, delay = 0, slow = true): void {
    const h = this.h;
    this.busy = true;
    if (slow) h.slowmo(0.45, 0.6);
    this.after(delay, () => {
      h.player.impulse(4);
      if (slow) h.sound.portal();
    });
    this.after(delay + 0.3, () => {
      this.reveal(after);
      h.player.pop(0.9);
      this.busy = false;
      h.sound.split();
      h.particles.burst(this.at(0, 1, 0), { count: 40, colors: [OP_COLORS.div, '#ffffff', ...colorsOf(after)], speed: 7 });
      h.particles.shockwave(this.at(0, 1, 0), FORWARD, 5, OP_COLORS.div, 0.6);
      const parts = Math.min(4, k - 1);
      const sx = h.logic.x;
      const sy = h.logic.y;
      for (let i = 0; i < parts; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const lift = (Math.floor(i / 2) - 0.5) * 1.5;
        this.spawn(
          after,
          (dt, age, a) => {
            const out = ease(age / 0.5);
            a.char.root.position.set(sx + side * (h.player.width + 0.8) * out + side * age * 1.5, sy + lift * out + Math.sin(age * 3) * 0.3, age * age * 5);
            a.char.update(dt, { speed: 0, steer: side * 4, airborne: true, stride: 0, flying: true });
            if (age > 1.5) {
              h.particles.puff(a.char.root.position, 12, '#ffffff', 3, 1.2);
              return false;
            }
            return true;
          },
          0.85,
        ).celebrate(1.5);
      }
    });
  }

  /** Big numbers get a banner, fireworks, a camera swing and a brighter sky. */
  private celebrate(before: number, after: number): void {
    const h = this.h;
    const level = celebrationLevel(before, after);
    if (level === 0) return;
    const p = this.at(0, 1.2, 0);
    if (level === 1) {
      h.particles.confettiBurst(p, 40, colorsOf(after), 8, 6);
      return;
    }
    h.hud.showBanner(`${numberToWords(after)}!`);
    h.sound.fanfare(level);
    h.showcase(level >= 3 ? 2.2 : 1.6);
    h.slowmo(0.4, level >= 3 ? 1.2 : 0.8);
    h.player.celebrate(2.5);
    h.skyFlash(level >= 3 ? 1 : 0.6);
    const colors = level >= 3 ? ['#ffd75e', '#fff3b0', '#ffffff', '#ff9f1c'] : colorsOf(after);
    for (let i = 0; i < (level >= 3 ? 6 : 4); i++) {
      this.after(0.15 + i * 0.22, () => {
        const q = this.at((Math.random() - 0.5) * 14, 3 + Math.random() * 5, -10 - Math.random() * 10, v2);
        h.particles.burst(q, { count: 60, colors, speed: 9, size: 0.8, life: 1.3, gravity: 2, drag: 1.2 });
        h.sound.click();
      });
    }
    h.particles.confettiBurst(p, level >= 3 ? 140 : 80, colors, 10, 7);
  }

  update(dt: number): void {
    this.time += dt;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();
    this.tasks = this.tasks.filter((t) => {
      t.age += dt;
      return t.step(t.age);
    });
    this.actors = this.actors.filter((a) => {
      a.age += dt;
      const alive = a.step(dt, a.age, a);
      if (!alive) a.char.detach();
      return alive;
    });
  }
}
