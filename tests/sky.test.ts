import { describe, expect, it } from 'vitest';
import { applyOp, MAX_VALUE } from '../src/math/numberMath';
import { seededRandom } from '../src/math/random';
import { generateChoices } from '../src/sky/choices';
import { CORRIDOR, CYCLE, generateCycle, TEMPLATE } from '../src/sky/skyCourse';
import { SkyLogic, STORM_COOLDOWN, type FlightInput, type SkyEvent } from '../src/sky/skyLogic';

const still: FlightInput = { dx: 0, dy: 0, axisX: 0, axisY: 0 };

function checkChoices(value: number, seed: number) {
  const ops = generateChoices(value, seededRandom(seed));
  expect(ops.length).toBeGreaterThanOrEqual(3);
  expect(ops.length).toBeLessThanOrEqual(4);
  const results = new Set<number>();
  for (const op of ops) {
    const r = applyOp(value, op);
    expect(r.ok, `${value} ${op.kind} ${op.operand}`).toBe(true);
    if (!r.ok) continue;
    expect(Number.isSafeInteger(r.value)).toBe(true);
    expect(r.value).toBeGreaterThanOrEqual(1);
    expect(r.value).not.toBe(value);
    if (op.kind === 'div') expect(value % op.operand).toBe(0);
    results.add(r.value);
  }
  expect(results.size).toBe(ops.length);
  return ops;
}

describe('portal choices', () => {
  it('offers all four operations for 8', () => {
    const ops = checkChoices(8, 1);
    expect(new Set(ops.map((o) => o.kind))).toEqual(new Set(['add', 'sub', 'mul', 'div']));
  });

  it('always offers 3–4 valid, distinct, whole-number choices', () => {
    const rand = seededRandom(99);
    const values = [1, 2, 3, 7, 13, 64, 97, 100, 128, 999, 1000, 10_000, 65_537, 1_000_000, 999_999_937, MAX_VALUE - 1, MAX_VALUE];
    for (let i = 0; i < 400; i++) values.push(1 + Math.floor(rand() * 5000));
    for (let i = 0; i < 200; i++) values.push(1 + Math.floor(rand() * MAX_VALUE));
    values.forEach((v, i) => checkChoices(v, i * 31 + 7));
  });

  it('shows three portals when division is impossible', () => {
    for (const v of [7, 13, 97]) {
      const ops = checkChoices(v, 5);
      expect(ops.some((o) => o.kind === 'div')).toBe(false);
      expect(ops.length).toBe(3);
    }
  });

  it('is deterministic for the same seed and value', () => {
    expect(generateChoices(40, seededRandom(3))).toEqual(generateChoices(40, seededRandom(3)));
  });
});

describe('sky route', () => {
  it('lasts about 60–90 seconds per cycle and keeps storms away from portals', () => {
    expect(CYCLE / 18).toBeGreaterThan(60);
    expect(CYCLE / 18).toBeLessThan(90);
    for (let c = 0; c < 5; c++) {
      const f = generateCycle(c);
      const rows = f.filter((x) => x.kind === 'row');
      const storms = f.filter((x) => x.kind === 'storm');
      expect(rows.length).toBe(TEMPLATE.rows.length);
      for (const s of storms) {
        for (const r of rows) expect(Math.abs(s.d - r.d)).toBeGreaterThan(40);
        // there is always a wide open path past every storm
        const blocked = s.r * 0.68 + 0.7;
        const free = CORRIDOR.xHalf * 2 - 2 * blocked;
        expect(free).toBeGreaterThan(12);
        expect(Math.abs(s.x) + blocked).toBeLessThan(CORRIDOR.xHalf + blocked);
      }
    }
  });
});

/** Fly for `seconds`, steering with `steer(logic)` (returns target x, y or null to let go). */
function fly(seconds: number, steer: (l: SkyLogic) => [number, number] | null, start = 8) {
  const l = new SkyLogic();
  l.reset(start);
  const events: SkyEvent[] = [];
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    const t = steer(l);
    const input = { ...still };
    if (t) {
      input.dx = (t[0] - l.targetX) * 0.2;
      input.dy = (t[1] - l.targetY) * 0.2;
    }
    const before = l.d;
    l.update(dt, input);
    expect(l.d).toBeGreaterThan(before);
    events.push(...l.drainEvents());
    expect(l.valid()).toBe(true);
  }
  return { l, events };
}

describe('flying through portals', () => {
  it('every portal result matches the maths for the value at that moment', () => {
    for (const lane of [0, 1, 2, 3]) {
      const { events } = fly(150, (l) => {
        const row = l.nextRow();
        if (!row) return null;
        const target = row.lanes[Math.min(lane, row.lanes.length - 1)];
        return [target.x, target.y];
      });
      const portals = events.filter((e) => e.type === 'portal');
      expect(portals.length).toBeGreaterThan(8);
      let chained: number | null = null;
      for (const e of events) {
        if (e.type !== 'portal' && e.type !== 'bubble' && e.type !== 'storm') continue;
        if (chained !== null) expect(e.before).toBe(chained);
        chained = e.after;
        if (e.type === 'portal') {
          const r = applyOp(e.before, e.op);
          expect(r.ok && r.value).toBe(e.after);
          expect(e.row.ops?.[e.lane]).toEqual(e.op);
        }
      }
    }
  });

  it('a child who never touches the screen still flies on and passes portals', () => {
    const { events, l } = fly(90, () => null);
    expect(events.filter((e) => e.type === 'portal').length).toBeGreaterThan(4);
    expect(l.d).toBeGreaterThan(1400);
  });

  it('wild random steering never breaks the maths or gets stuck', () => {
    const rand = seededRandom(4);
    fly(200, () => [(rand() * 2 - 1) * 14, rand() * 18]);
  });
});

describe('storm clouds', () => {
  function intoStorm(start: number) {
    const l = new SkyLogic();
    l.reset(start);
    const storm = l.storms[0];
    l.d = storm.f.d - 0.5;
    l.x = l.targetX = storm.f.x;
    l.y = l.targetY = storm.f.y;
    l.drainEvents();
    l.update(1 / 60, still);
    return { l, storm, events: l.drainEvents() };
  }

  it('halves an even number: 16 → 8', () => {
    const { l, events } = intoStorm(16);
    const e = events.find((x) => x.type === 'storm');
    expect(e).toMatchObject({ type: 'storm', before: 16, after: 8, halved: true });
    expect(l.value).toBe(8);
  });

  it('only slows an odd number down, never making fractions', () => {
    const { l, events } = intoStorm(7);
    expect(events.find((x) => x.type === 'storm')).toMatchObject({ before: 7, after: 7, halved: false });
    expect(l.value).toBe(7);
    expect(l.slowTimer).toBeGreaterThan(0);
  });

  it('never goes below 1', () => {
    const { l } = intoStorm(1);
    expect(l.value).toBe(1);
  });

  it('does not penalise again during the cooldown', () => {
    const { l, storm } = intoStorm(64);
    expect(l.value).toBe(32);
    for (let i = 0; i < 10; i++) {
      l.d = storm.f.d - 0.2;
      l.x = storm.f.x;
      l.y = storm.f.y;
      l.update(1 / 60, still);
    }
    expect(l.value).toBe(32);
    expect(storm.hits).toBe(1);
    expect(l.stormCooldown).toBeLessThanOrEqual(STORM_COOLDOWN);
  });
});

describe('big numbers in the sky', () => {
  it('handles values around one million and the maximum', () => {
    for (const v of [1_000, 10_000, 1_000_000, MAX_VALUE]) {
      const { l } = fly(40, (s) => {
        const row = s.nextRow();
        return row ? [row.lanes[0].x, row.lanes[0].y] : null;
      }, v);
      expect(l.value).toBeLessThanOrEqual(MAX_VALUE);
    }
  });
});
