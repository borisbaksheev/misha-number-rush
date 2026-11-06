import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyDyadic, dyadic, equals, formatDyadic, halve, isWhole, MAX_EXP, toNumber, type Dyadic } from '../src/math/dyadic';
import { MAX_VALUE } from '../src/math/numberMath';
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
import { SkyLogic, speedFor, STORM_COOLDOWN, type FlightInput, type SkyEvent } from '../src/sky/skyLogic';

const still: FlightInput = { dx: 0, dy: 0, axisX: 0, axisY: 0 };

function checkChoices(value: Dyadic, seed: number) {
  const ops = generateChoices(value, seededRandom(seed));
  expect(ops.length).toBeGreaterThanOrEqual(3);
  expect(ops.length).toBeLessThanOrEqual(4);
  const results = new Set<string>();
  for (const op of ops) {
    const r = applyDyadic(value, op);
    expect(r.ok, `${formatDyadic(value)} ${op.kind} ${op.operand}`).toBe(true);
    if (!r.ok) continue;
    expect(r.value.num > 0n).toBe(true);
    expect(toNumber(r.value)).toBeLessThanOrEqual(MAX_VALUE);
    expect(equals(r.value, value)).toBe(false);
    if (op.kind === 'div' && isWhole(value)) expect(isWhole(r.value)).toBe(true);
    results.add(formatDyadic(r.value));
  }
  expect(results.size).toBe(ops.length);
  return ops;
}

describe('portal choices', () => {
  it('offers all four operations for 8', () => {
    const ops = checkChoices(dyadic(8), 1);
    expect(new Set(ops.map((o) => o.kind))).toEqual(new Set(['add', 'sub', 'mul', 'div']));
  });

  it('always offers 3–4 valid, distinct choices for whole numbers', () => {
    const rand = seededRandom(99);
    const values = [1, 2, 3, 7, 13, 64, 97, 100, 128, 999, 1000, 10_000, 65_537, 1_000_000, 999_999_937, MAX_VALUE - 1, MAX_VALUE];
    for (let i = 0; i < 400; i++) values.push(1 + Math.floor(rand() * 5000));
    for (let i = 0; i < 200; i++) values.push(1 + Math.floor(rand() * MAX_VALUE));
    values.forEach((v, i) => checkChoices(dyadic(v), i * 31 + 7));
  });

  it('dividing a whole number in a portal always gives a whole number (7, 13, 97 get three portals)', () => {
    for (const v of [7, 13, 97]) {
      const ops = checkChoices(dyadic(v), 5);
      expect(ops.some((o) => o.kind === 'div')).toBe(false);
      expect(ops.length).toBe(3);
    }
  });

  it('stays valid after storms made fractions (3.5, 1.5, 0.5, 0.0625, 1,234.5 …)', () => {
    const rand = seededRandom(7);
    const values: Dyadic[] = [dyadic(7, 1), dyadic(3, 1), dyadic(1, 1), dyadic(1, 4), dyadic(2469, 1), dyadic(1, MAX_EXP)];
    for (let i = 0; i < 300; i++) values.push(dyadic(1 + Math.floor(rand() * 4000), 1 + Math.floor(rand() * 8)));
    values.forEach((v, i) => {
      const ops = checkChoices(v, i + 1);
      // ×2 is offered first after halving so a fraction can become whole again
      if (!isWhole(v)) expect(ops.some((o) => o.kind === 'mul')).toBe(true);
    });
  });

  it('is deterministic for the same seed and value', () => {
    expect(generateChoices(dyadic(40), seededRandom(3))).toEqual(generateChoices(dyadic(40), seededRandom(3)));
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
function fly(seconds: number, steer: (l: SkyLogic) => [number, number] | null, start: number | Dyadic = 8) {
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

/** Every change follows from the previous value exactly. */
function checkChain(events: SkyEvent[]) {
  let chained: Dyadic | null = null;
  for (const e of events) {
    if (e.type !== 'portal' && e.type !== 'bubble' && e.type !== 'storm') continue;
    if (chained) expect(equals(e.before, chained)).toBe(true);
    chained = e.after;
    if (e.type === 'portal') {
      const r = applyDyadic(e.before, e.op);
      expect(r.ok && equals(r.value, e.after)).toBe(true);
      expect(e.row.ops?.[e.lane]).toEqual(e.op);
    }
    if (e.type === 'storm' && e.halved) expect(equals(e.after, halve(e.before)!)).toBe(true);
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

  it('flying into every storm keeps the maths exact (fractions included)', () => {
    const { events } = fly(200, (l) => {
      const s = l.storms.find((x) => x.f.d > l.d - 2 && x.hits === 0);
      return s && s.f.d - l.d < 60 ? [s.f.x, s.f.y] : null;
    });
    const storms = events.filter((e) => e.type === 'storm');
    expect(storms.length).toBeGreaterThan(8);
    checkChain(events);
  });

  it('wild random steering never breaks the maths or gets stuck', () => {
    const rand = seededRandom(4);
    const { events } = fly(200, () => [(rand() * 2 - 1) * 14, rand() * 18]);
    checkChain(events);
  });
});

describe('storm clouds always halve', () => {
  function intoStorm(start: number | Dyadic) {
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
    [100, '50'],
    [16, '8'],
    [8, '4'],
    [7, '3.5'],
    [3, '1.5'],
    [1, '0.5'],
  ])('%s → %s', (start, expected) => {
    const { l, events } = intoStorm(start);
    const e = events.find((x) => x.type === 'storm');
    expect(e && e.type === 'storm' && e.halved).toBe(true);
    expect(formatDyadic(l.value)).toBe(expected);
  });

  it('repeated halving stays exact with no floating-point artefacts', () => {
    let v = dyadic(3);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      v = halve(v)!;
      seen.push(formatDyadic(v));
    }
    expect(seen.slice(0, 5)).toEqual(['1.5', '0.75', '0.375', '0.1875', '0.09375']);
    expect(seen[11]).toBe('0.000732421875');
    expect(formatDyadic(halve(dyadic(2469))!)).toBe('1,234.5');
    // and doubling brings it straight back
    const r = applyDyadic(dyadic(7, 1), { kind: 'mul', operand: 2 });
    expect(r.ok && formatDyadic(r.value)).toBe('7');
  });

  it('one collision = one halving (cooldown)', () => {
    const { l, storm } = intoStorm(64);
    expect(formatDyadic(l.value)).toBe('32');
    for (let i = 0; i < 30; i++) {
      l.d = storm.f.d - 0.2;
      l.x = storm.f.x;
      l.y = storm.f.y;
      l.update(1 / 60, still);
    }
    expect(formatDyadic(l.value)).toBe('32');
    expect(storm.hits).toBe(1);
    expect(l.stormCooldown).toBeGreaterThan(0);
    expect(l.stormCooldown).toBeLessThanOrEqual(STORM_COOLDOWN);
  });

  it('flight continues straight away (no long slowdown), and halving slows the number a little', () => {
    const { l } = intoStorm(16);
    expect(l.slowTimer).toBe(0);
    const before = l.speed;
    for (let i = 0; i < 60 * 4; i++) l.update(1 / 60, still);
    expect(l.speed).toBeCloseTo(speedFor(8), 1);
    expect(l.speed).toBeLessThan(before);
  });

  it('portals after a fraction offer valid choices and give the exact results', () => {
    const { events, l } = fly(60, (s) => {
      const row = s.nextRow();
      return row ? [row.lanes[0].x, row.lanes[0].y] : null;
    }, dyadic(7, 1));
    expect(formatDyadic(dyadic(7, 1))).toBe('3.5');
    expect(events.some((e) => e.type === 'portal')).toBe(true);
    checkChain(events);
    expect(l.valid()).toBe(true);
  });
});

describe('number-based speed', () => {
  it('grows with the size of the number and stays in bounds', () => {
    expect(speedFor(0.5)).toBeLessThan(speedFor(8));
    expect(speedFor(8)).toBeLessThan(speedFor(100));
    expect(speedFor(100)).toBeLessThan(speedFor(1_000_000));
    expect(speedFor(1e-6)).toBeGreaterThanOrEqual(13);
    expect(speedFor(MAX_VALUE)).toBeLessThanOrEqual(27);
    expect(speedFor(dyadic(7, 1))).toBeCloseTo(speedFor(3.5));
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
    let v = dyadic(1_000_000);
    let peak = 0;
    for (let i = 0; i < 25; i++) {
      const next = halve(v)!;
      fx.storm(v, next, true, new Vector3(0, 10, 0));
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
