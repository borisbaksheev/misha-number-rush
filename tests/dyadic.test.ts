import { describe, expect, it } from 'vitest';
import { applyDyadic, dyadic, dyadicToWords, formatDyadic, halve, MAX_EXP, toNumber } from '../src/math/dyadic';

describe('exact dyadic numbers', () => {
  it('normalises and prints exactly', () => {
    expect(dyadic(14, 2)).toEqual({ num: 7n, exp: 1 });
    expect(formatDyadic(dyadic(7, 1))).toBe('3.5');
    expect(formatDyadic(dyadic(1, 2))).toBe('0.25');
    expect(formatDyadic(dyadic(1, 10))).toBe('0.0009765625');
    expect(formatDyadic(dyadic(2_000_001, 1))).toBe('1,000,000.5');
    expect(formatDyadic(dyadic(8))).toBe('8');
    expect(toNumber(dyadic(7, 1))).toBe(3.5);
  });

  it('reads fractions aloud as decimals', () => {
    expect(dyadicToWords(dyadic(7, 1))).toBe('three point five');
    expect(dyadicToWords(dyadic(1, 2))).toBe('zero point two five');
    expect(dyadicToWords(dyadic(100))).toBe('one hundred');
  });

  it('does exact arithmetic with whole-number operands', () => {
    const v = dyadic(7, 1); // 3.5
    const get = (r: ReturnType<typeof applyDyadic>) => (r.ok ? formatDyadic(r.value) : r.reason);
    expect(get(applyDyadic(v, { kind: 'add', operand: 2 }))).toBe('5.5');
    expect(get(applyDyadic(v, { kind: 'sub', operand: 3 }))).toBe('0.5');
    expect(get(applyDyadic(v, { kind: 'sub', operand: 4 }))).toBe('negative');
    expect(get(applyDyadic(v, { kind: 'mul', operand: 10 }))).toBe('35');
    expect(get(applyDyadic(v, { kind: 'div', operand: 7 }))).toBe('0.5');
    expect(get(applyDyadic(v, { kind: 'div', operand: 3 }))).toBe('not-whole'); // 1.1666… is not exact
    expect(get(applyDyadic(dyadic(8), { kind: 'div', operand: 2 }))).toBe('4');
    expect(get(applyDyadic(dyadic(7), { kind: 'div', operand: 2 }))).toBe('not-whole'); // portals keep whole numbers whole
    expect(get(applyDyadic(dyadic(1_000_000_000), { kind: 'add', operand: 1 }))).toBe('too-big');
  });

  it('halves exactly down to the precision limit', () => {
    let v = dyadic(1);
    for (let i = 0; i < MAX_EXP; i++) v = halve(v)!;
    expect(formatDyadic(v)).toBe('0.00000095367431640625');
    expect(halve(v)).toBeNull();
  });
});
