import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Course } from '../src/game/course';
import { RaceLogic } from '../src/game/raceLogic';
import { applyOp, MAX_VALUE } from '../src/math/numberMath';
import { seededRandom } from '../src/math/random';
import { NumberCharacter } from '../src/render/numberCharacter';
import { Particles } from '../src/render/particles';
import { generateChoices } from '../src/sky/choices';
import {
  BASE_STORMS_PER_CYCLE,
  CORRIDOR,
  CYCLE,
  generateCycle,
  STORM_RATE,
  STORM_ROW_GAP,
  stormsInCycle,
  TEMPLATE,
  type StormFeature,
} from '../src/sky/skyCourse';
import { SkyFx, STORM_IMPACT_PARTICLES, type SkyFxHost } from '../src/sky/skyFx';
import { safeStart, SkyLogic, speedFor, START_VALUE, STORM_COOLDOWN, type FlightInput, type SkyEvent } from '../src/sky/skyLogic';

const still: FlightInput = { dx: 0, dy: 0, axisX: 0, axisY: 0 };
const whole = (n: number) => Number.isSafeInteger(n) && n >= 1;

function checkChoices(value: number, seed: number) {
  const ops = generateChoices(value, seededRandom(seed));
  expect(ops.length).toBeGreaterThanOrEqual(3);
  expect(ops.length).toBeLessThanOrEqual(4);
  const results = new Set<number>();
  for (const op of ops) {
    expect(Number.isSafeInteger(op.operand)).toBe(true);
    const r = applyOp(value, op);
    expect(r.ok, `${value} ${op.kind} ${op.operand}`).toBe(true);
    if (!r.ok) continue;
    expect(whole(r.value)).toBe(true);
    expect(r.value).not.toBe(value);
    if (op.kind === 'div') expect(value % op.operand).toBe(0);
    results.add(r.value);
  }
  expect(results.size).toBe(ops.length);
  return ops;
}

describe('portal choices (whole numbers only)', () => {
  it('offers all four operations for 8', () => {
    const ops = checkChoices(8, 1);
    expect(new Set(ops.map((o) => o.kind))).toEqual(new Set(['add', 'sub', 'mul', 'div']));
  });

  it('always offers 3–4 valid, distinct whole-number results', () => {
    const rand = seededRandom(99);
    const values = [1, 2, 3, 7, 13, 64, 97, 100, 128, 999, 1000, 10_000, 65_537, 1_000_000, 999_999_937, MAX_VALUE - 1, MAX_VALUE];
    for (let i = 0; i < 400; i++) values.push(1 + Math.floor(rand() * 5000));
    for (let i = 0; i < 200; i++) values.push(1 + Math.floor(rand() * MAX_VALUE));
    values.forEach((v, i) => checkChoices(v, i * 31 + 7));
  });

  it('only divides when the number is exactly divisible (7, 13, 97 get three portals)', () => {
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
  it('has 40 % more storm clouds than the original four per cycle', () => {
    expect(BASE_STORMS_PER_CYCLE * STORM_RATE).toBeCloseTo(5.6);
    let total = 0;
    for (let c = 0; c < 5; c++) total += generateCycle(c).filter((f) => f.kind === 'storm').length;
    expect(total).toBe(28); // was 20 per five cycles
    let many = 0;
    for (let c = 0; c < 50; c++) many += stormsInCycle(c);
    expect(many / 50).toBeCloseTo(5.6, 5);
    for (let c = 0; c < 50; c++) expect([5, 6]).toContain(stormsInCycle(c));
  });

  it('keeps storms away from portals, spaced out, with varied positions and a way past', () => {
    const xs = new Set<number>();
    for (let c = 0; c < 12; c++) {
      const f = generateCycle(c);
      const rows = f.filter((x) => x.kind === 'row');
      const storms = f.filter((x): x is StormFeature => x.kind === 'storm').sort((a, b) => a.d - b.d);
      expect(rows.length).toBe(TEMPLATE.rows.length);
      for (const s of storms) {
        xs.add(Math.round(s.x));
        for (const r of rows) expect(Math.abs(s.d - r.d)).toBeGreaterThanOrEqual(STORM_ROW_GAP);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(7);
      }
      for (let i = 1; i < storms.length; i++) {
        const a = storms[i - 1];
        const b = storms[i];
        expect(b.d - a.d).toBeGreaterThanOrEqual(50);
        // even at top speed (2 s or less between them) one sideways position avoids both
        const blocked = (s: StormFeature, x: number) => Math.abs(x - s.x) < s.r * 0.68 + 0.7;
        let open = false;
        for (let x = -CORRIDOR.xHalf; x <= CORRIDOR.xHalf; x += 0.5) if (!blocked(a, x) && !blocked(b, x)) open = true;
        expect(open).toBe(true);
      }
    }
    expect(xs.size).toBeGreaterThan(5); // natural variation
    expect(CYCLE / 18).toBeGreaterThan(60);
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

/** Every change follows from the previous value and is a whole number. */
function checkChain(events: SkyEvent[]) {
  let chained: number | null = null;
  for (const e of events) {
    if (e.type !== 'portal' && e.type !== 'bubble' && e.type !== 'storm') continue;
    expect(whole(e.before) && whole(e.after)).toBe(true);
    if (chained !== null) expect(e.before).toBe(chained);
    chained = e.after;
    if (e.type === 'portal') {
      const r = applyOp(e.before, e.op);
      expect(r.ok && r.value).toBe(e.after);
      expect(e.row.ops?.[e.lane]).toEqual(e.op);
    }
    if (e.type === 'storm') {
      if (e.before % 2 === 0) expect(e.after).toBe(e.before / 2);
      else expect(e.after).toBe(e.before);
      expect(e.halved).toBe(e.before % 2 === 0);
    }
  }
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
      expect(events.filter((e) => e.type === 'portal').length).toBeGreaterThan(8);
      checkChain(events);
    }
  });

  it('a child who never touches the screen still flies on and passes portals', () => {
    const { events, l } = fly(90, () => null);
    expect(events.filter((e) => e.type === 'portal').length).toBeGreaterThan(4);
    expect(l.d).toBeGreaterThan(1300);
    checkChain(events);
  });

  it('flying into every storm only ever produces whole numbers', () => {
    for (const start of [8, 7, 1, 1024, 999]) {
      const { events, l } = fly(200, (s) => {
        const st = s.storms.find((x) => x.f.d > s.d - 2 && x.hits === 0);
        return st && st.f.d - s.d < 60 ? [st.f.x, st.f.y] : null;
      }, start);
      expect(events.filter((e) => e.type === 'storm').length).toBeGreaterThan(8);
      checkChain(events);
      expect(whole(l.value)).toBe(true);
    }
  });

  it('wild random steering never breaks the maths or gets stuck', () => {
    const rand = seededRandom(4);
    const { events } = fly(200, () => [(rand() * 2 - 1) * 14, rand() * 18]);
    checkChain(events);
  });
});

describe('storm clouds: halve even numbers, leave odd numbers alone', () => {
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

  it.each([
    [100, 50],
    [16, 8],
    [8, 4],
    [2, 1],
  ])('even: %i → %i', (start, expected) => {
    const { l, events } = intoStorm(start);
    expect(events.find((x) => x.type === 'storm')).toMatchObject({ before: start, after: expected, halved: true });
    expect(l.value).toBe(expected);
  });

  it.each([7, 5, 3, 1])('odd: %i stays %i (the collision still happens)', (start) => {
    const { l, events } = intoStorm(start);
    expect(events.find((x) => x.type === 'storm')).toMatchObject({ before: start, after: start, halved: false });
    expect(l.value).toBe(start);
    expect(l.slowTimer).toBe(0); // no slowdown either: flight continues normally
  });

  it('repeated collisions never produce fractions: 96 → 48 → 24 → 12 → 6 → 3 → 3 …', () => {
    const l = new SkyLogic();
    l.reset(96);
    const seen: number[] = [];
    for (let k = 0; k < 7; k++) {
      const storm = l.storms.find((x) => x.hits === 0 && x.f.d > l.d)!;
      l.stormCooldown = 0;
      l.d = storm.f.d - 0.5;
      l.x = l.targetX = storm.f.x;
      l.y = l.targetY = storm.f.y;
      l.update(1 / 60, still);
      seen.push(l.value);
    }
    expect(seen.slice(0, 7)).toEqual([48, 24, 12, 6, 3, 3, 3]);
    expect(seen.every(whole)).toBe(true);
  });

  it('one collision = one halving (cooldown)', () => {
    const { l, storm } = intoStorm(64);
    expect(l.value).toBe(32);
    for (let i = 0; i < 30; i++) {
      l.d = storm.f.d - 0.2;
      l.x = storm.f.x;
      l.y = storm.f.y;
      l.update(1 / 60, still);
    }
    expect(l.value).toBe(32);
    expect(storm.hits).toBe(1);
    expect(l.stormCooldown).toBeGreaterThan(0);
    expect(l.stormCooldown).toBeLessThanOrEqual(STORM_COOLDOWN);
  });

  it('old fractional values are never used: the flight starts again at 8', () => {
    expect(safeStart(3.5)).toBe(START_VALUE);
    expect(safeStart(0.25)).toBe(START_VALUE);
    expect(safeStart(0)).toBe(START_VALUE);
    expect(safeStart(Number.NaN)).toBe(START_VALUE);
    expect(safeStart(16)).toBe(16);
    const l = new SkyLogic();
    l.reset(1.75);
    expect(l.value).toBe(8);
  });
});

describe('number-based speed', () => {
  it('grows with the size of the number and stays in bounds', () => {
    expect(speedFor(1)).toBeLessThan(speedFor(8));
    expect(speedFor(8)).toBeLessThan(speedFor(100));
    expect(speedFor(100)).toBeLessThan(speedFor(1_000_000));
    expect(speedFor(1)).toBeGreaterThanOrEqual(13);
    expect(speedFor(MAX_VALUE)).toBeLessThanOrEqual(27);
  });

  it('slows to the speed of the halved number after a storm divides it (16 → 8)', () => {
    const l = new SkyLogic();
    l.reset(16);
    for (let i = 0; i < 60 * 3; i++) l.update(1 / 60, still);
    const fast = l.speed;
    expect(fast).toBeCloseTo(speedFor(16), 1);
    const storm = l.storms.find((s) => s.f.d > l.d)!;
    l.d = storm.f.d - 0.5;
    l.x = l.targetX = storm.f.x;
    l.y = l.targetY = storm.f.y;
    l.update(1 / 60, still);
    expect(l.value).toBe(8);
    for (let i = 0; i < 60 * 4; i++) l.update(1 / 60, still);
    expect(l.speed).toBeCloseTo(speedFor(8), 1);
    expect(l.speed).toBeLessThan(fast);
  });

  it('keeps the same speed when an odd number bumps a storm', () => {
    const l = new SkyLogic();
    l.reset(7);
    for (let i = 0; i < 60 * 3; i++) l.update(1 / 60, still);
    const storm = l.storms.find((s) => s.f.d > l.d)!;
    l.d = storm.f.d - 0.5;
    l.x = l.targetX = storm.f.x;
    l.y = l.targetY = storm.f.y;
    l.update(1 / 60, still);
    for (let i = 0; i < 60 * 2; i++) l.update(1 / 60, still);
    expect(l.value).toBe(7);
    expect(l.speed).toBeCloseTo(speedFor(7), 1);
  });

  it('gives at least 1.8 s between storms even at top speed', () => {
    const fastest = speedFor(MAX_VALUE);
    for (let c = 0; c < 10; c++) {
      const storms = generateCycle(c).filter((f) => f.kind === 'storm');
      for (let i = 1; i < storms.length; i++) expect((storms[i].d - storms[i - 1].d) / fastest).toBeGreaterThan(1.8);
    }
  });
});

describe('storm effects stay light (iPad performance)', () => {
  it('uses a small particle budget per impact', () => {
    const b = STORM_IMPACT_PARTICLES;
    expect(b.sparks + b.stars + b.smoke + b.confetti).toBeLessThanOrEqual(80);
  });

  it('many collisions in a row never pile up animations', () => {
    const noop = new Proxy({}, { get: () => () => undefined });
    const logic = new SkyLogic();
    const host: SkyFxHost = {
      scene: new Object3D(),
      player: new NumberCharacter(8),
      logic,
      particles: new Particles(),
      sound: noop as never,
      hud: noop as never,
      slowmo: () => undefined,
      shake: () => undefined,
      showcase: () => undefined,
      skyFlash: () => undefined,
      lightning: () => undefined,
    };
    const fx = new SkyFx(host);
    let v = 1_000_000;
    let peak = 0;
    for (let i = 0; i < 25; i++) {
      const halved = v % 2 === 0;
      const next = halved ? v / 2 : v;
      fx.storm(v, next, halved, new Vector3(0, 10, 0));
      v = next;
      for (let k = 0; k < 60 * STORM_COOLDOWN; k++) {
        fx.update(1 / 60);
        peak = Math.max(peak, fx.activeActors);
      }
    }
    for (let k = 0; k < 60 * 3; k++) fx.update(1 / 60);
    expect(peak).toBeLessThanOrEqual(2);
    expect(fx.activeActors).toBe(0);
    expect(host.scene.children.length).toBe(0);
  });
});

describe('both modes stay playable', () => {
  it('Racing drives a full lap with no steering at all (never pinned by a bumper) and Sky Numbers flies 90 s', () => {
    const race = new RaceLogic(new Course());
    let laps = 0;
    for (let i = 0; i < 60 * 120 && laps === 0; i++) {
      race.update(1 / 60, { throttle: true, steerDelta: 0, steerAxis: 0 });
      if (race.drainEvents().some((e) => e.type === 'lap')) laps++;
    }
    expect(laps).toBe(1);
    expect(Number.isSafeInteger(race.team.leader)).toBe(true);
    const { l } = fly(90, () => null);
    expect(whole(l.value)).toBe(true);
    expect(l.portalsFlown).toBeGreaterThan(4);
  });
});
