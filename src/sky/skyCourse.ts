// Seeded, endlessly repeating sky route: portal rows, storm clouds, number bubbles and scenery.
// Plain data so it can be unit tested.
import { seededRandom } from '../math/random';

/** The space the player can fly in (x across, y up). */
export const CORRIDOR = { xHalf: 11, yMin: 2, yMax: 16, yStart: 9 };
/** Length of one varied stretch of sky (about 70 s) before the pattern repeats with new randomness. */
export const CYCLE = 1320;

export interface Lane {
  x: number;
  y: number;
}

export interface RowFeature {
  kind: 'row';
  id: number;
  d: number;
  layout4: Lane[];
  layout3: Lane[];
  seed: number;
}

export interface StormFeature {
  kind: 'storm';
  id: number;
  d: number;
  x: number;
  y: number;
  r: number;
}

export interface BubbleFeature {
  kind: 'bubble';
  id: number;
  d: number;
  x: number;
  y: number;
  seed: number;
}

export interface SceneryFeature {
  kind: 'tunnel' | 'canyon';
  id: number;
  from: number;
  to: number;
  palette: number;
}

export type SkyFeature = RowFeature | StormFeature | BubbleFeature | SceneryFeature;

const X4 = [-8.25, -2.75, 2.75, 8.25];
const X3 = [-7, 0, 7];
const HEIGHTS4 = [
  [9, 9, 9, 9],
  [7.5, 10.5, 7.5, 10.5],
  [8, 10.5, 10.5, 8],
  [10.5, 8, 8, 10.5],
];
const HEIGHTS3 = [
  [9, 9, 9],
  [8, 10.5, 8],
  [10.5, 8, 10.5],
];

/** Storm clouds per cycle before the +40 % increase (the original layout had four). */
export const BASE_STORMS_PER_CYCLE = 4;
/** Storm frequency relative to the original layout. */
export const STORM_RATE = 1.4;
/** Storms keep at least this far from portal rows and from each other. */
export const STORM_ROW_GAP = 45;
export const STORM_MIN_SPACING = 50;
/** Stretches between portal rows where storms may appear (distance within a cycle). */
export const STORM_WINDOWS: [number, number][] = [
  [195, 435],
  [525, 745],
  [835, 1015],
  [1105, 1205],
];

/**
 * How many storms cycle `c` gets: 5.6 per cycle on average (4 × 1.4), spread as 5, 6, 5, 6, 6 …
 * so every five cycles have exactly 28 storms instead of 20.
 */
export function stormsInCycle(c: number): number {
  const rate = BASE_STORMS_PER_CYCLE * STORM_RATE;
  return Math.floor((c + 1) * rate + 1e-9) - Math.floor(c * rate + 1e-9);
}

/** Where things sit inside one cycle (distance from the cycle start). */
export const TEMPLATE = {
  rows: [150, 480, 790, 1060, 1250],
  tunnel: [205, 345] as const,
  canyon: [845, 985] as const,
  bubbleArcs: [60, 545, 1110],
  tunnelBubbles: [235, 275, 315],
};

export function generateCycle(cycle: number, seed = 2026): SkyFeature[] {
  const rand = seededRandom(seed * 7919 + cycle * 104729 + 17);
  const base = cycle * CYCLE;
  const out: SkyFeature[] = [];
  let n = 0;
  const id = () => cycle * 1000 + n++;

  TEMPLATE.rows.forEach((d, i) => {
    const flat = cycle === 0 && i === 0;
    const h4 = flat ? HEIGHTS4[0] : HEIGHTS4[Math.floor(rand() * HEIGHTS4.length)];
    const h3 = flat ? HEIGHTS3[0] : HEIGHTS3[Math.floor(rand() * HEIGHTS3.length)];
    out.push({
      kind: 'row',
      id: id(),
      d: base + d,
      layout4: X4.map((x, k) => ({ x, y: h4[k] })),
      layout3: X3.map((x, k) => ({ x, y: h3[k] })),
      seed: Math.floor(rand() * 1e9),
    });
  });

  // Storms: stratified over the free stretches with random jitter (natural spacing), never
  // closer than STORM_MIN_SPACING, alternating sides so there is always a way past.
  const total = STORM_WINDOWS.reduce((t, [a, b]) => t + (b - a), 0);
  const stormCount = stormsInCycle(cycle);
  const spots: number[] = [];
  for (let i = 0; i < stormCount; i++) {
    // jitter within the middle 40 % of each slot: spacing ≥ 0.6 × slot (≥ 74 units at 6 storms)
    let t = ((i + 0.3 + rand() * 0.4) / stormCount) * total;
    for (const [a, b] of STORM_WINDOWS) {
      if (t <= b - a) {
        spots.push(a + t);
        break;
      }
      t -= b - a;
    }
  }
  let side = rand() < 0.5 ? -1 : 1;
  for (const d of spots) {
    side = -side;
    out.push({
      kind: 'storm',
      id: id(),
      d: base + d,
      x: side * (3 + rand() * 4),
      y: 6 + rand() * 6,
      r: 3.6 + rand() * 0.8,
    });
  }

  out.push({ kind: 'tunnel', id: id(), from: base + TEMPLATE.tunnel[0], to: base + TEMPLATE.tunnel[1], palette: cycle % 3 });
  out.push({ kind: 'canyon', id: id(), from: base + TEMPLATE.canyon[0], to: base + TEMPLATE.canyon[1], palette: cycle % 3 });

  for (const start of TEMPLATE.bubbleArcs) {
    const x0 = (rand() * 2 - 1) * 7;
    const x1 = (rand() * 2 - 1) * 7;
    for (let k = 0; k < 4; k++) {
      const t = k / 3;
      out.push({
        kind: 'bubble',
        id: id(),
        d: base + start + k * 9,
        x: x0 + (x1 - x0) * t,
        y: 8 + Math.sin(t * Math.PI) * 3,
        seed: Math.floor(rand() * 1e9),
      });
    }
  }
  for (const d of TEMPLATE.tunnelBubbles) {
    out.push({ kind: 'bubble', id: id(), d: base + d, x: (rand() * 2 - 1) * 3, y: 9 + (rand() * 2 - 1) * 2, seed: Math.floor(rand() * 1e9) });
  }
  return out;
}
