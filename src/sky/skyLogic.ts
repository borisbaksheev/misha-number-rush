// Headless flight simulation for Sky Numbers: steering, portals, number bubbles and storm clouds.
// Rendering only reads this state; all value changes go through the shared maths engine.
import { applyOp, isValidValue, type MathOp } from '../math/numberMath';
import { seededRandom } from '../math/random';
import { generateChoices, unitFor } from './choices';
import {
  CORRIDOR,
  CYCLE,
  generateCycle,
  type BubbleFeature,
  type Lane,
  type RowFeature,
  type SceneryFeature,
  type StormFeature,
} from './skyCourse';

export interface FlightInput {
  /** Requested sideways / vertical movement this frame in world units (finger drag). */
  dx: number;
  dy: number;
  /** Keyboard steering, -1..1. */
  axisX: number;
  axisY: number;
}

export interface RowState {
  f: RowFeature;
  ops: MathOp[] | null;
  lanes: Lane[];
  /** Value the current choices were generated for. */
  forValue: number;
  locked: boolean;
  passed: boolean;
  chosen: number;
}

export interface BubbleState {
  f: BubbleFeature;
  /** Number added when collected (null = sparkle only). */
  k: number | null;
  taken: boolean;
}

export interface StormState {
  f: StormFeature;
  hits: number;
}

export type SkyEvent =
  | { type: 'portal'; row: RowState; lane: number; op: MathOp; before: number; after: number }
  | { type: 'bubble'; bubble: BubbleState; op: MathOp | null; before: number; after: number }
  | { type: 'storm'; storm: StormState; before: number; after: number; halved: boolean }
  | { type: 'rowChoices'; row: RowState }
  | { type: 'cycle'; cycle: number };

export const START_VALUE = 8;
export const BASE_SPEED = 17;
export const MAX_SKY_SPEED = 22;
export const STORM_COOLDOWN = 2.5;
export const PLAYER_RADIUS = 0.7;
const LOOKAHEAD = 520;
const LOCK_DISTANCE = 30;
const ASSIST_DISTANCE = 42;

export class SkyLogic {
  value = START_VALUE;
  d = 0;
  x = 0;
  y = CORRIDOR.yStart;
  targetX = 0;
  targetY = CORRIDOR.yStart;
  vx = 0;
  vy = 0;
  speed = BASE_SPEED;
  time = 0;
  slowTimer = 0;
  stormCooldown = 0;
  portalsFlown = 0;
  /** Gentle steering help near portal rows. */
  assist = true;
  rows: RowState[] = [];
  storms: StormState[] = [];
  bubbles: BubbleState[] = [];
  scenery: SceneryFeature[] = [];
  readonly events: SkyEvent[] = [];
  private bounceX = 0;
  private bounceY = 0;
  private cycles = 0;

  constructor(private seed = 2026) {
    this.reset();
  }

  reset(start = START_VALUE): void {
    this.value = start;
    this.d = 0;
    this.x = 0;
    this.y = CORRIDOR.yStart;
    this.targetX = 0;
    this.targetY = CORRIDOR.yStart;
    this.vx = this.vy = 0;
    this.bounceX = this.bounceY = 0;
    this.speed = BASE_SPEED;
    this.time = 0;
    this.slowTimer = 0;
    this.stormCooldown = 0;
    this.portalsFlown = 0;
    this.rows = [];
    this.storms = [];
    this.bubbles = [];
    this.scenery = [];
    this.events.length = 0;
    this.cycles = 0;
    this.generate();
    this.refreshChoices();
  }

  get cycle(): number {
    return Math.floor(this.d / CYCLE);
  }

  /** The first row the player has not flown through yet. */
  nextRow(): RowState | null {
    return this.rows.find((r) => !r.passed && r.f.d > this.d) ?? null;
  }

  private generate(): void {
    while (this.cycles * CYCLE < this.d + LOOKAHEAD) {
      for (const f of generateCycle(this.cycles, this.seed)) {
        if (f.kind === 'row') {
          this.rows.push({ f, ops: null, lanes: f.layout4, forValue: -1, locked: false, passed: false, chosen: -1 });
        } else if (f.kind === 'storm') this.storms.push({ f, hits: 0 });
        else if (f.kind === 'bubble') this.bubbles.push({ f, k: null, taken: false });
        else this.scenery.push(f);
      }
      this.cycles++;
    }
    const behind = this.d - 80;
    this.rows = this.rows.filter((r) => r.f.d > behind);
    this.storms = this.storms.filter((s) => s.f.d > behind);
    this.bubbles = this.bubbles.filter((b) => b.f.d > behind);
    this.scenery = this.scenery.filter((s) => s.to > behind);
  }

  /** (Re)generate the choices of the next row for the current value, until it is close. */
  private refreshChoices(): void {
    const row = this.nextRow();
    if (!row) return;
    if (row.f.d - this.d < LOCK_DISTANCE && row.ops) row.locked = true;
    if (row.locked || row.forValue === this.value) return;
    const ops = generateChoices(this.value, seededRandom(row.f.seed ^ (this.value % 2147483647)));
    row.ops = ops;
    row.forValue = this.value;
    row.lanes = ops.length >= 4 ? row.f.layout4 : row.f.layout3;
    this.events.push({ type: 'rowChoices', row });
  }

  /** Lane the player is closest to (sideways matters most). */
  nearestLane(lanes: Lane[], x = this.x, y = this.y): number {
    let best = 0;
    let bestD = Infinity;
    lanes.forEach((l, i) => {
      const dd = (l.x - x) ** 2 + 0.35 * (l.y - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  private change(op: MathOp): { before: number; after: number } | null {
    const r = applyOp(this.value, op);
    if (!r.ok || r.value < 1) return null;
    const before = this.value;
    this.value = r.value;
    return { before, after: r.value };
  }

  update(dt: number, input: FlightInput): void {
    this.time += dt;
    this.stormCooldown = Math.max(0, this.stormCooldown - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);

    // automatic forward flight that very slowly speeds up
    const cruise = Math.min(MAX_SKY_SPEED, BASE_SPEED + this.d / 2500);
    const want = cruise * (this.slowTimer > 0 ? 0.55 : 1);
    this.speed += (want - this.speed) * (1 - Math.exp(-(this.slowTimer > 0 ? 6 : 1.5) * dt));

    // steering: the finger moves a target, the number glides to it and stays there on release
    this.targetX += input.dx + input.axisX * 13 * dt;
    this.targetY += input.dy + input.axisY * 10 * dt;
    const row = this.nextRow();
    if (this.assist && row?.ops) {
      const dist = row.f.d - this.d;
      if (dist > 0 && dist < ASSIST_DISTANCE) {
        const lane = row.lanes[this.nearestLane(row.lanes, this.targetX, this.targetY)];
        const k = 1 - dist / ASSIST_DISTANCE;
        this.targetX += (lane.x - this.targetX) * (1 - Math.exp(-k * 1.6 * dt));
        this.targetY += (lane.y - this.targetY) * (1 - Math.exp(-k * 3.5 * dt));
      }
    }
    this.targetX = Math.max(-CORRIDOR.xHalf, Math.min(CORRIDOR.xHalf, this.targetX));
    this.targetY = Math.max(CORRIDOR.yMin, Math.min(CORRIDOR.yMax, this.targetY));
    const px = this.x;
    const py = this.y;
    const follow = 1 - Math.exp(-4.5 * dt);
    this.x += (this.targetX - this.x) * follow + this.bounceX * dt;
    this.y += (this.targetY - this.y) * follow + this.bounceY * dt;
    this.x = Math.max(-CORRIDOR.xHalf - 1, Math.min(CORRIDOR.xHalf + 1, this.x));
    this.y = Math.max(CORRIDOR.yMin - 0.5, Math.min(CORRIDOR.yMax + 1, this.y));
    this.bounceX *= Math.exp(-4 * dt);
    this.bounceY *= Math.exp(-4 * dt);
    this.vx = dt > 0 ? (this.x - px) / dt : 0;
    this.vy = dt > 0 ? (this.y - py) / dt : 0;

    const prevD = this.d;
    this.d += this.speed * dt;
    if (Math.floor(this.d / CYCLE) > Math.floor(prevD / CYCLE)) this.events.push({ type: 'cycle', cycle: this.cycle });

    this.generate();
    this.checkRows(prevD);
    this.checkBubbles();
    this.checkStorms();
    this.refreshChoices();
  }

  private checkRows(prevD: number): void {
    for (const row of this.rows) {
      if (row.passed || row.f.d > this.d || row.f.d <= prevD) continue;
      row.passed = true;
      if (!row.ops) continue;
      const lane = this.nearestLane(row.lanes);
      row.chosen = lane;
      const op = row.ops[lane];
      const ch = this.change(op);
      this.portalsFlown++;
      if (ch) this.events.push({ type: 'portal', row, lane, op, ...ch });
    }
  }

  private checkBubbles(): void {
    for (const b of this.bubbles) {
      if (b.taken) continue;
      const dz = b.f.d - this.d;
      if (dz < 140 && b.k === null && dz > 0) {
        // decide its number when it comes into view so it suits the current value
        const rand = seededRandom(b.f.seed);
        const k = unitFor(this.value) * (1 + Math.floor(rand() * 3));
        b.k = applyOp(this.value, { kind: 'add', operand: k }).ok ? k : 0;
      }
      if (Math.abs(dz) > 1.8) continue;
      if (Math.hypot(b.f.x - this.x, b.f.y - this.y) > 2.4) continue;
      b.taken = true;
      const op: MathOp | null = b.k ? { kind: 'add', operand: b.k } : null;
      const ch = op ? this.change(op) : null;
      this.events.push({ type: 'bubble', bubble: b, op: ch ? op : null, before: ch?.before ?? this.value, after: this.value });
    }
  }

  private checkStorms(): void {
    for (const s of this.storms) {
      const dz = s.f.d - this.d;
      if (Math.abs(dz) > s.f.r * 0.75) continue;
      const dx = this.x - s.f.x;
      const dy = this.y - s.f.y;
      const dist = Math.hypot(dx, dy);
      if (dist > s.f.r * 0.68 + PLAYER_RADIUS) continue;
      if (this.stormCooldown > 0) continue;
      // cartoon bounce away from the cloud, a short slowdown, and halve even numbers
      const nx = dist > 0.01 ? dx / dist : 1;
      const ny = dist > 0.01 ? dy / dist : 0;
      this.bounceX = nx * 9;
      this.bounceY = ny * 6;
      this.targetX += nx * 3.5;
      this.targetY += ny * 2;
      this.slowTimer = 1.3;
      this.stormCooldown = STORM_COOLDOWN;
      s.hits++;
      const before = this.value;
      const halve = before > 1 && before % 2 === 0;
      if (halve) this.change({ kind: 'div', operand: 2 });
      this.events.push({ type: 'storm', storm: s, before, after: this.value, halved: halve });
    }
  }

  drainEvents(): SkyEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Sanity check used by tests. */
  valid(): boolean {
    return isValidValue(this.value) && this.value >= 1;
  }
}
