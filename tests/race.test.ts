import { describe, expect, it } from 'vitest';
import { Course } from '../src/game/course';
import { RaceLogic, type RaceEvent } from '../src/game/raceLogic';
import { equation } from '../src/math/numberMath';

const course = new Course();
type Side = 'left' | 'right';

/** Drive whole laps with the throttle held, choosing a side at each fork. */
function drive(choices: Record<string, Side>[], opts: { steerOffEdge?: boolean } = {}) {
  const race = new RaceLogic(course);
  const events: RaceEvent[] = [];
  const dt = 1 / 60;
  let guard = 0;
  while (race.lap <= choices.length && guard++ < 60 * 400) {
    const fork = course.forkAt(race.s + 30) ?? course.forkAt(race.s);
    const lapChoices = choices[race.lap - 1] ?? {};
    let target = 0;
    if (fork) target = lapChoices[fork.id] === 'left' ? -6 : 6;
    if (opts.steerOffEdge && race.s > 1070 && race.s < 1090) target = 20;
    race.targetX += (target - race.targetX) * 0.2;
    race.update(dt, { throttle: true, steerDelta: 0, steerAxis: 0 });
    events.push(...race.drainEvents());
  }
  const math = events.flatMap((e) => (e.type === 'math' ? [e.result] : []));
  return { race, events, math };
}

function equations(math: ReturnType<typeof drive>['math']): string[] {
  return math.map((r) => {
    if (r.type === 'apply') return equation(r.before, r.op, r.after);
    if (r.type === 'split') return `${r.before} ÷ ${r.op.operand} = ${r.leader}`;
    if (r.type === 'join') return `join ${r.after}`;
    return `refused ${r.reason}`;
  });
}

describe('first lap routes', () => {
  it('×2 then +2 reaches one hundred', () => {
    const { math, race } = drive([{ A: 'left', B: 'left' }]);
    expect(equations(math)).toEqual([
      '2 + 2 = 4',
      '4 × 2 = 8',
      '8 ÷ 2 = 4',
      'join 8',
      '8 + 2 = 10',
      '10 × 10 = 100',
    ]);
    expect(race.team.leader).toBe(100);
    expect(race.team.companions).toEqual([]);
  });

  it('+4 then −3 gives a different, still correct result', () => {
    const { math, race } = drive([{ A: 'right', B: 'right' }]);
    expect(equations(math)).toEqual([
      '2 + 2 = 4',
      '4 + 4 = 8',
      '8 ÷ 2 = 4',
      'join 8',
      '8 − 3 = 5',
      '5 × 10 = 50',
    ]);
    expect(race.team.leader).toBe(50);
  });

  it('every route combination stays a valid whole number', () => {
    for (const A of ['left', 'right'] as Side[]) {
      for (const B of ['left', 'right'] as Side[]) {
        const { race, events } = drive([{ A, B }, { A, B }, { A, B }]);
        const v = race.team.leader;
        expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
        expect(events.some((e) => e.type === 'fall')).toBe(false);
      }
    }
  });
});

describe('big number laps', () => {
  it('×10 gates on later laps reach one million', () => {
    const { race } = drive([
      { A: 'left', B: 'left' },
      { A: 'right', B: 'left' },
      { A: 'right', B: 'left' },
    ]);
    // lap 1: 100, lap 2: 100×10×10×10 = 100,000, lap 3 starts with ×10 = 1,000,000 ...
    expect(race.lap).toBe(4);
    expect(race.team.leader).toBe(100_000_000);
  });
});

describe('physics never changes numbers', () => {
  it('bumps, jumps and landings keep the value', () => {
    const { events } = drive([{ A: 'left', B: 'left' }]);
    expect(events.some((e) => e.type === 'jump')).toBe(true);
    expect(events.some((e) => e.type === 'land')).toBe(true);
    // Weave across the road to hit bumpers and rails; every value change must come from a math event.
    const race = new RaceLogic(course);
    let value = race.team.total();
    let bumps = 0;
    for (let i = 0; i < 60 * 90; i++) {
      race.update(1 / 60, { throttle: true, steerDelta: Math.sin(i / 20) * 0.4, steerAxis: 0 });
      const evs = race.drainEvents();
      bumps += evs.filter((e) => e.type === 'bump' || e.type === 'rail').length;
      for (const e of evs) {
        if (e.type !== 'math') continue;
        const r = e.result;
        if (r.type === 'apply') {
          expect(r.before).toBe(value);
          value = r.after;
        } else if (r.type === 'join') {
          expect(r.after).toBe(value);
        } else if (r.type === 'split') {
          expect(r.before).toBe(value);
        }
      }
      expect(race.team.total()).toBe(value);
    }
    expect(bumps).toBeGreaterThan(0);
  });

  it('falling off an open edge respawns the player on the road', () => {
    const { events, race } = drive([{ A: 'left', B: 'left' }], { steerOffEdge: true });
    expect(events.some((e) => e.type === 'fall')).toBe(true);
    expect(events.some((e) => e.type === 'respawn')).toBe(true);
    expect(race.team.leader).toBe(100);
  });

  it('releasing the throttle slows down smoothly to a stop', () => {
    const race = new RaceLogic(course);
    for (let i = 0; i < 120; i++) race.update(1 / 60, { throttle: true, steerDelta: 0, steerAxis: 0 });
    const fast = race.speed;
    expect(fast).toBeGreaterThan(10);
    race.update(1 / 60, { throttle: false, steerDelta: 0, steerAxis: 0 });
    expect(race.speed).toBeLessThan(fast);
    expect(race.speed).toBeGreaterThan(fast * 0.9);
    for (let i = 0; i < 400; i++) race.update(1 / 60, { throttle: false, steerDelta: 0, steerAxis: 0 });
    expect(race.speed).toBe(0);
  });
});
