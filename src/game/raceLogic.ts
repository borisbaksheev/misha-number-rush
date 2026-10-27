// Headless gameplay simulation: movement, arcade physics and mathematical items.
// Rendering reads this state; it never changes numbers itself.
import { NumberTeam, type TeamEvent } from '../math/team';
import { Course, crossed, type MathItem } from './course';

export interface ControlInput {
  throttle: boolean;
  /** Lateral world-space change requested this frame by dragging. */
  steerDelta: number;
  /** Keyboard steering, -1 (left) .. 1 (right). */
  steerAxis: number;
}

export type RaceEvent =
  | { type: 'math'; item: MathItem; result: TeamEvent }
  | { type: 'buddyRun'; item: MathItem }
  | { type: 'jump'; source: 'ramp' | 'pad'; strength: number }
  | { type: 'land'; impact: number }
  | { type: 'bump'; index: number; strength: number }
  | { type: 'rail'; side: -1 | 1; strength: number }
  | { type: 'fall' }
  | { type: 'respawn' }
  | { type: 'boost' }
  | { type: 'lap'; lap: number };

export interface BuddyState {
  item: MathItem;
  s: number;
  x: number;
  state: 'waiting' | 'running' | 'merged';
}

export const PLAYER_RADIUS = 0.85;
export const MAX_SPEED = 24;
export const BOOST_SPEED = 30;
const ACCEL = 15;
const DECEL = 9;
const GRAVITY = 28;
const PAD_JUMP = 15;
const BUMPER_HEIGHT = 2.2;
const BUDDY_TRIGGER = 30;
const BUDDY_SPEED = 7;

export class RaceLogic {
  readonly course: Course;
  readonly team = new NumberTeam(2);
  lap = 1;
  time = 0;
  s = 0;
  x = 0;
  targetX = 0;
  vx = 0;
  speed = 0;
  y = 0;
  vy = 0;
  grounded = true;
  /** Seconds spent falling after leaving the track; > 0 while falling. */
  fallTime = 0;
  lastGroundS = 0;
  /** Lateral velocity caused by steering (used for leaning). */
  steerVelocity = 0;
  distance = 0;
  buddies: BuddyState[] = [];
  readonly events: RaceEvent[] = [];
  private groundVy = 0;
  private inBoost = false;
  private bumperCooldown = new Map<number, number>();

  constructor(course = new Course()) {
    this.course = course;
    this.reset();
  }

  reset(): void {
    this.team.reset(2);
    this.lap = 1;
    this.time = 0;
    this.s = this.course.data.startS + 1;
    this.x = 0;
    this.targetX = 0;
    this.vx = 0;
    this.speed = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.fallTime = 0;
    this.lastGroundS = this.s;
    this.distance = 0;
    this.events.length = 0;
    this.bumperCooldown.clear();
    this.resetBuddies();
  }

  private resetBuddies(): void {
    this.buddies = this.course.data.items
      .filter((it) => it.kind === 'buddy' && this.course.itemActive(it, this.lap))
      .map((item) => ({ item, s: item.s, x: 0, state: 'waiting' as const }));
  }

  /** Current sway position of a bumper. */
  bumperX(index: number): number {
    const b = this.course.data.bumpers[index];
    return b.x + b.sway * Math.sin(this.time * b.swaySpeed + index);
  }

  update(dt: number, input: ControlInput): void {
    const c = this.course;
    const L = c.length;
    this.time += dt;

    // --- speed -------------------------------------------------------------
    if (this.fallTime > 0) {
      this.speed *= Math.exp(-1.5 * dt);
    } else if (input.throttle) {
      const room = Math.max(0, 1 - this.speed / MAX_SPEED);
      this.speed += ACCEL * dt * (0.35 + 0.65 * room);
      if (this.speed > MAX_SPEED) this.speed = Math.max(MAX_SPEED, this.speed - 6 * dt);
    } else {
      this.speed = Math.max(0, this.speed - DECEL * dt - this.speed * 0.25 * dt);
    }

    // --- steering ----------------------------------------------------------
    const airFactor = this.grounded ? 1 : 0.6;
    this.targetX += input.steerDelta * airFactor + input.steerAxis * 13 * dt * airFactor;
    const prevX = this.x;
    const lane = c.laneFor(this.s, this.x);
    const rails = c.hasRails(this.s);
    const half = lane.width / 2;
    const lo = lane.center - half + PLAYER_RADIUS;
    const hi = lane.center + half - PLAYER_RADIUS;
    if (this.fallTime === 0) {
      const slack = rails ? 0 : 2.2;
      this.targetX = Math.min(hi + slack, Math.max(lo - slack, this.targetX));
    }
    this.x += (this.targetX - this.x) * (1 - Math.exp(-11 * dt)) + this.vx * dt;
    this.vx *= Math.exp(-3.5 * dt);
    if (rails && this.fallTime === 0) {
      if (this.x < lo || this.x > hi) {
        const side: -1 | 1 = this.x < lo ? -1 : 1;
        const impact = Math.abs(this.vx) + Math.abs(this.x - (side < 0 ? lo : hi)) * 10;
        this.x = side < 0 ? lo : hi;
        this.targetX = Math.min(hi, Math.max(lo, this.targetX));
        if (this.vx * side > 0) this.vx = -this.vx * 0.45;
        if (impact > 3) this.events.push({ type: 'rail', side, strength: Math.min(1, impact / 15) });
      }
    }
    this.steerVelocity = dt > 0 ? (this.x - prevX) / dt : 0;

    // --- forward motion ------------------------------------------------------
    const prevS = this.s;
    this.s += this.speed * dt;
    this.distance += this.speed * dt;
    if (this.s >= L) {
      this.s -= L;
      this.lap += 1;
      this.resetBuddies();
      this.events.push({ type: 'lap', lap: this.lap });
    }

    this.updateVertical(dt);
    this.updateBumpersAndPads(dt);
    this.updateItems(prevS, dt);
  }

  private updateVertical(dt: number): void {
    const c = this.course;
    if (this.fallTime > 0) {
      this.fallTime += dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.fallTime > 1.15) this.respawn();
      return;
    }
    const g = c.groundAt(this.s, this.x);
    if (this.grounded) {
      if (g === null || g < this.y - 0.05) {
        this.grounded = false;
        this.vy = Math.max(0, this.groundVy);
        if (this.vy > 2) this.events.push({ type: 'jump', source: 'ramp', strength: Math.min(1, this.vy / 12) });
      } else {
        this.groundVy = dt > 0 ? (g - this.y) / dt : 0;
        this.y = g;
        this.lastGroundS = this.s;
      }
    }
    if (!this.grounded) {
      const prevY = this.y;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (g !== null && this.vy <= 0 && this.y <= g && prevY >= g - 0.6) {
        const impact = -this.vy;
        this.y = g;
        this.vy = 0;
        this.groundVy = 0;
        this.grounded = true;
        this.lastGroundS = this.s;
        this.events.push({ type: 'land', impact: Math.min(1, impact / 18) });
      } else if (this.y < -2.5 && (g === null || this.y < g - 0.6)) {
        this.fallTime = dt;
        this.events.push({ type: 'fall' });
      }
    }
    const inBoost = this.grounded && c.data.boost.some((b) => this.s >= b.from && this.s < b.to);
    if (inBoost) {
      if (!this.inBoost) this.events.push({ type: 'boost' });
      this.speed = Math.max(this.speed, BOOST_SPEED);
    }
    this.inBoost = inBoost;
  }

  private respawn(): void {
    const c = this.course;
    this.s = c.safeRespawn(this.lastGroundS + 3);
    this.x = 0;
    this.targetX = 0;
    this.vx = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.fallTime = 0;
    this.speed = Math.max(this.speed, 8);
    this.lastGroundS = this.s;
    this.events.push({ type: 'respawn' });
  }

  private updateBumpersAndPads(dt: number): void {
    const c = this.course;
    const L = c.length;
    for (const [k, v] of this.bumperCooldown) {
      if (v - dt <= 0) this.bumperCooldown.delete(k);
      else this.bumperCooldown.set(k, v - dt);
    }
    if (this.fallTime > 0) return;
    c.data.bumpers.forEach((b, i) => {
      let ds = b.s - this.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (Math.abs(ds) > 4 || this.y > BUMPER_HEIGHT) return;
      const dx = this.bumperX(i) - this.x;
      const d = Math.hypot(ds, dx);
      const minD = b.r + PLAYER_RADIUS;
      if (d >= minD || d === 0) return;
      const ns = ds / d;
      const nx = dx / d;
      const pen = minD - d;
      this.x -= nx * pen;
      this.targetX = this.x;
      if (ns > 0) this.s -= ns * pen;
      // deflect sideways, preferring the side with more room
      const away = Math.abs(nx) > 0.2 ? -Math.sign(nx) : this.x >= 0 ? -1 : 1;
      this.vx = away * (8 + this.speed * 0.25);
      const strength = Math.min(1, (this.speed * Math.max(0.3, ns)) / MAX_SPEED + 0.25);
      if (ns > 0.2) this.speed *= 0.62;
      if (!this.bumperCooldown.has(i)) {
        this.events.push({ type: 'bump', index: i, strength });
        this.bumperCooldown.set(i, 0.35);
      }
    });
    if (!this.grounded) return;
    for (const p of c.data.pads) {
      const ds = p.s - this.s;
      const dx = p.x - this.x;
      if (ds * ds + dx * dx < p.r * p.r) {
        this.grounded = false;
        this.vy = PAD_JUMP;
        this.events.push({ type: 'jump', source: 'pad', strength: 1 });
      }
    }
  }

  private updateItems(prevS: number, dt: number): void {
    const c = this.course;
    const L = c.length;
    if (this.fallTime > 0) return;

    for (const b of this.buddies) {
      if (b.state === 'merged') continue;
      const ahead = b.s - this.s;
      if (b.state === 'waiting' && ahead < BUDDY_TRIGGER && ahead > -2) {
        b.state = 'running';
        this.events.push({ type: 'buddyRun', item: b.item });
      }
      if (b.state === 'running') {
        b.s -= BUDDY_SPEED * dt;
        b.x += (this.x - b.x) * (1 - Math.exp(-3 * dt));
        if (b.s - this.s < 1.6) {
          b.state = 'merged';
          const op = c.itemOp(b.item, this.lap);
          if (op) this.events.push({ type: 'math', item: b.item, result: this.team.apply(op) });
        }
      }
    }

    for (const item of c.data.items) {
      if (item.kind === 'buddy' || !c.itemActive(item, this.lap)) continue;
      if (!crossed(prevS, this.s, item.s, L)) continue;
      if (item.lane) {
        const side = this.x < 0 ? 'left' : 'right';
        if (side !== item.lane) continue;
      }
      if (item.kind === 'join') {
        const result = this.team.join();
        if (result) this.events.push({ type: 'math', item, result });
        continue;
      }
      const op = c.itemOp(item, this.lap);
      if (op) this.events.push({ type: 'math', item, result: this.team.apply(op) });
    }
  }

  drainEvents(): RaceEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
