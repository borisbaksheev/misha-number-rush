// Course definition: centre line, road features and mathematical items.
// Everything here is plain data + pure queries so gameplay logic can be unit tested.
import type { MathOp } from '../math/numberMath';
import { TrackPath } from './trackPath';

export const ROAD_WIDTH = 10;
export const LANE_SEPARATED_CENTER = 6.75;
export const LANE_SEPARATED_WIDTH = 7.5;
const FORK_BLEND = 24;

export const CONTROL_POINTS: [number, number, number][] = [
  [0, 0, 60], [0, 0, -20], [0, 0, -120], [-8, 1, -200], [-45, 5, -250], [-105, 10, -262],
  [-158, 14, -228], [-180, 16, -165], [-165, 17, -100], [-120, 16, -60], [-60, 15, -48],
  [0, 14, -45], [55, 12, -48], [100, 9, -30], [125, 6, 15], [125, 4, 75], [105, 2, 125],
  [60, 0, 160], [5, 0, 175], [-45, 0, 170], [-70, 0, 140], [-60, 0, 105], [-25, 0, 85],
];

export type LapRule = 'first' | 'later' | 'all';
export type Lane = 'left' | 'right';

/** An operation that may differ between the first lap and later "big number" laps. */
export interface LapOp {
  first: MathOp;
  later: MathOp;
}

export interface Fork {
  id: string;
  start: number;
  end: number;
}

export type ItemKind = 'buddy' | 'gate' | 'join' | 'finale';

export interface MathItem {
  id: string;
  kind: ItemKind;
  s: number;
  /** For lane gates: which fork lane the gate sits in. Null = spans the whole road. */
  lane: Lane | null;
  fork?: string;
  op?: LapOp;
  lap: LapRule;
}

export interface Bumper {
  s: number;
  x: number;
  r: number;
  /** Lateral sway amplitude and speed (0 = static). */
  sway: number;
  swaySpeed: number;
}

export interface Pad {
  s: number;
  x: number;
  r: number;
}

export interface Span {
  from: number;
  to: number;
}

const op = (kind: MathOp['kind'], operand: number): MathOp => ({ kind, operand });
const same = (o: MathOp): LapOp => ({ first: o, later: o });

export interface CourseData {
  forks: Fork[];
  items: MathItem[];
  bumpers: Bumper[];
  pads: Pad[];
  boost: Span[];
  ramp: Span & { height: number };
  gaps: Span[];
  openEdges: Span[];
  tunnel: Span;
  startS: number;
}

export const COURSE: CourseData = {
  startS: 0,
  forks: [
    { id: 'A', start: 66, end: 182 },
    { id: 'B', start: 1146, end: 1258 },
  ],
  items: [
    { id: 'buddy-2', kind: 'buddy', s: 44, lane: null, lap: 'first', op: same(op('add', 2)) },
    {
      id: 'A-left', kind: 'gate', s: 124, lane: 'left', fork: 'A', lap: 'all',
      op: { first: op('mul', 2), later: op('mul', 2) },
    },
    {
      id: 'A-right', kind: 'gate', s: 124, lane: 'right', fork: 'A', lap: 'all',
      op: { first: op('add', 4), later: op('mul', 10) },
    },
    { id: 'split', kind: 'gate', s: 1028, lane: null, lap: 'all', op: same(op('div', 2)) },
    { id: 'join', kind: 'join', s: 1134, lane: null, lap: 'all' },
    {
      id: 'B-left', kind: 'gate', s: 1202, lane: 'left', fork: 'B', lap: 'all',
      op: { first: op('add', 2), later: op('mul', 10) },
    },
    {
      id: 'B-right', kind: 'gate', s: 1202, lane: 'right', fork: 'B', lap: 'all',
      op: { first: op('sub', 3), later: op('mul', 2) },
    },
    { id: 'finale', kind: 'finale', s: 1296, lane: null, lap: 'all', op: same(op('mul', 10)) },
  ],
  bumpers: [
    { s: 928, x: -2.5, r: 1.3, sway: 0, swaySpeed: 0 },
    { s: 942, x: 2.8, r: 1.3, sway: 0, swaySpeed: 0 },
    { s: 958, x: 0, r: 1.5, sway: 3, swaySpeed: 1.2 },
    { s: 974, x: -3, r: 1.2, sway: 0, swaySpeed: 0 },
    { s: 976, x: 3, r: 1.2, sway: 0, swaySpeed: 0 },
    { s: 1000, x: 1.5, r: 1.4, sway: 2.5, swaySpeed: 1.6 },
  ],
  pads: [{ s: 988, x: -1.5, r: 1.6 }],
  boost: [{ from: 832, to: 840 }],
  ramp: { from: 846, to: 860, height: 2.6 },
  gaps: [{ from: 860, to: 876 }],
  openEdges: [{ from: 1056, to: 1118 }],
  tunnel: { from: 470, to: 566 },
};

export function inSpan(s: number, span: Span): boolean {
  return s >= span.from && s < span.to;
}

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export interface LaneShape {
  center: number;
  width: number;
}

/**
 * Shape of the drivable surfaces at s. Outside forks there is one lane (the whole road);
 * inside a fork there are two lanes that separate and later merge again.
 */
export class Course {
  readonly path: TrackPath;
  readonly data: CourseData;

  constructor(data: CourseData = COURSE) {
    this.data = data;
    this.path = new TrackPath(CONTROL_POINTS);
  }

  get length(): number {
    return this.path.length;
  }

  forkAt(s: number): Fork | null {
    for (const f of this.data.forks) if (s >= f.start && s < f.end) return f;
    return null;
  }

  /** 0 = lanes touching (one road), 1 = fully separated. */
  forkSeparation(s: number): number {
    const f = this.forkAt(s);
    if (!f) return 0;
    return Math.min(smooth01((s - f.start) / FORK_BLEND), smooth01((f.end - s) / FORK_BLEND));
  }

  lanes(s: number): LaneShape[] {
    const f = this.forkAt(s);
    if (!f) return [{ center: 0, width: ROAD_WIDTH }];
    const k = this.forkSeparation(s);
    const half = ROAD_WIDTH / 4;
    const c = half + k * (LANE_SEPARATED_CENTER - half);
    const w = ROAD_WIDTH / 2 + k * (LANE_SEPARATED_WIDTH - ROAD_WIDTH / 2);
    return [
      { center: -c, width: w },
      { center: c, width: w },
    ];
  }

  /** The lane containing lateral position x (by side inside forks). */
  laneFor(s: number, x: number): LaneShape {
    const lanes = this.lanes(s);
    if (lanes.length === 1) return lanes[0];
    return x < 0 ? lanes[0] : lanes[1];
  }

  hasRails(s: number): boolean {
    return !this.data.openEdges.some((o) => inSpan(s, o)) && !this.inGap(s);
  }

  inGap(s: number): boolean {
    return this.data.gaps.some((g) => inSpan(s, g));
  }

  rampHeight(s: number): number {
    const r = this.data.ramp;
    if (!inSpan(s, r)) return 0;
    const t = (s - r.from) / (r.to - r.from);
    return r.height * t * t;
  }

  /** Ground height above the road plane at (s, x), or null when there is nothing to stand on. */
  groundAt(s: number, x: number, footRadius = 0.35): number | null {
    s = this.path.wrap(s);
    if (this.inGap(s)) return null;
    const lane = this.laneFor(s, x);
    if (Math.abs(x - lane.center) > lane.width / 2 + footRadius) return null;
    return this.rampHeight(s);
  }

  /** Arc length of the next place where the centre of the road is solid, flat ground. */
  safeRespawn(s: number): number {
    let t = this.path.wrap(s);
    for (let i = 0; i < 400; i++) {
      if (!this.inGap(t) && !inSpan(t, this.data.ramp) && this.groundAt(t, 0) !== null) return t;
      t = this.path.wrap(t + 2);
    }
    return 0;
  }

  itemActive(item: MathItem, lap: number): boolean {
    if (item.lap === 'all') return true;
    return item.lap === 'first' ? lap === 1 : lap > 1;
  }

  itemOp(item: MathItem, lap: number): MathOp | null {
    if (!item.op) return null;
    return lap <= 1 ? item.op.first : item.op.later;
  }

  /** Lateral centre of an item (lane gates sit in the middle of their lane). */
  itemCenter(item: MathItem): LaneShape {
    if (!item.lane) return { center: 0, width: ROAD_WIDTH };
    const lanes = this.lanes(item.s);
    return item.lane === 'left' ? lanes[0] : lanes[lanes.length - 1];
  }
}

/** Did travelling from a to b (already wrapped, moving forward) pass point p? */
export function crossed(a: number, b: number, p: number, length: number): boolean {
  if (b >= a) return a < p && p <= b;
  // a small backwards nudge (e.g. bouncing off a bumper) is not a lap wrap
  if (a - b < length / 2) return false;
  // wrapped around the start line
  return (a < p && p <= length) || (0 <= p && p <= b);
}
