import { describe, expect, it } from 'vitest';
import { Course, crossed, inSpan, ROAD_WIDTH } from '../src/game/course';
import { RaceLogic } from '../src/game/raceLogic';

const course = new Course();
const L = course.length;

describe('course layout', () => {
  it('is a 60–90 second loop at racing speed', () => {
    expect(L).toBeGreaterThan(1200);
    expect(L).toBeLessThan(1700);
  });

  it('places every item on the loop, lane gates inside separated forks', () => {
    for (const item of course.data.items) {
      expect(item.s).toBeGreaterThan(0);
      expect(item.s).toBeLessThan(L);
      if (item.lane) {
        const fork = course.forkAt(item.s);
        expect(fork?.id).toBe(item.fork);
        expect(course.forkSeparation(item.s)).toBeGreaterThan(0.99);
      }
    }
  });

  it('fork lanes start and end flush with the main road', () => {
    for (const f of course.data.forks) {
      for (const s of [f.start + 0.01, f.end - 0.01]) {
        const [left, right] = course.lanes(s);
        expect(left.center - left.width / 2).toBeCloseTo(-ROAD_WIDTH / 2, 1);
        expect(right.center + right.width / 2).toBeCloseTo(ROAD_WIDTH / 2, 1);
        expect(left.center + left.width / 2).toBeCloseTo(0, 1);
      }
    }
  });

  it('respawn points are always solid flat road', () => {
    for (let s = 0; s < L; s += 7) {
      const r = course.safeRespawn(s);
      expect(course.groundAt(r, 0)).toBe(0);
      expect(course.inGap(r)).toBe(false);
      expect(inSpan(r, course.data.ramp)).toBe(false);
    }
  });

  it('the boost pad carries the player over the gap even if they let go', () => {
    const race = new RaceLogic(course);
    race.s = course.data.boost[0].from - 0.5;
    race.speed = 4;
    let fell = false;
    for (let i = 0; i < 60 * 4; i++) {
      race.update(1 / 60, { throttle: false, steerDelta: 0, steerAxis: 0 });
      if (race.drainEvents().some((e) => e.type === 'fall')) fell = true;
    }
    expect(fell).toBe(false);
    expect(race.s).toBeGreaterThan(course.data.gaps[0].to);
  });

  it('detects crossings, including the lap wrap, but not backwards nudges', () => {
    expect(crossed(10, 12, 11, L)).toBe(true);
    expect(crossed(L - 1, 0.5, 0.2, L)).toBe(true);
    expect(crossed(L - 1, 0.5, L - 0.5, L)).toBe(true);
    expect(crossed(12, 11.5, 50, L)).toBe(false);
  });
});
