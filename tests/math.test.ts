import { describe, expect, it } from 'vitest';
import {
  MAX_VALUE,
  applyOp,
  celebrationLevel,
  equation,
  formatNumber,
  isPowerOfTen,
  numberToWords,
  opLabel,
} from '../src/math/numberMath';
import { NumberTeam } from '../src/math/team';

describe('applyOp', () => {
  it('adds, subtracts, multiplies and divides correctly', () => {
    expect(applyOp(2, { kind: 'add', operand: 2 })).toEqual({ ok: true, value: 4 });
    expect(applyOp(10, { kind: 'sub', operand: 3 })).toEqual({ ok: true, value: 7 });
    expect(applyOp(4, { kind: 'mul', operand: 2 })).toEqual({ ok: true, value: 8 });
    expect(applyOp(8, { kind: 'div', operand: 2 })).toEqual({ ok: true, value: 4 });
    expect(applyOp(0, { kind: 'mul', operand: 10 })).toEqual({ ok: true, value: 0 });
    expect(applyOp(3, { kind: 'sub', operand: 3 })).toEqual({ ok: true, value: 0 });
  });

  it('never produces negative numbers', () => {
    expect(applyOp(2, { kind: 'sub', operand: 3 })).toEqual({ ok: false, reason: 'negative' });
  });

  it('only allows whole-number division', () => {
    expect(applyOp(7, { kind: 'div', operand: 2 })).toEqual({ ok: false, reason: 'not-whole' });
    expect(applyOp(7, { kind: 'div', operand: 0 })).toEqual({ ok: false, reason: 'bad-operand' });
  });

  it('caps values at one billion', () => {
    expect(applyOp(MAX_VALUE, { kind: 'add', operand: 1 })).toEqual({ ok: false, reason: 'too-big' });
    expect(applyOp(100_000_000, { kind: 'mul', operand: 10 })).toEqual({ ok: true, value: MAX_VALUE });
  });

  it('rejects invalid states and operands', () => {
    expect(() => applyOp(-1, { kind: 'add', operand: 1 })).toThrow();
    expect(() => applyOp(1.5, { kind: 'add', operand: 1 })).toThrow();
    expect(applyOp(1, { kind: 'add', operand: 1.5 })).toEqual({ ok: false, reason: 'bad-operand' });
  });

  it('supports the doubling and powers-of-ten progressions', () => {
    let v = 2;
    const doubles = [v];
    for (let i = 0; i < 6; i++) {
      const r = applyOp(v, { kind: 'mul', operand: 2 });
      if (!r.ok) throw new Error('unexpected');
      v = r.value;
      doubles.push(v);
    }
    expect(doubles).toEqual([2, 4, 8, 16, 32, 64, 128]);
    v = 10;
    const tens = [v];
    for (let i = 0; i < 5; i++) {
      const r = applyOp(v, { kind: 'mul', operand: 10 });
      if (!r.ok) throw new Error('unexpected');
      v = r.value;
      tens.push(v);
    }
    expect(tens).toEqual([10, 100, 1_000, 10_000, 100_000, 1_000_000]);
  });
});

describe('formatting', () => {
  it('groups digits', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1_000_000)).toBe('1,000,000');
    expect(formatNumber(123_456_789)).toBe('123,456,789');
  });

  it('writes labels and equations', () => {
    expect(opLabel({ kind: 'mul', operand: 10 })).toBe('×10');
    expect(opLabel({ kind: 'sub', operand: 3 })).toBe('−3');
    expect(equation(4, { kind: 'mul', operand: 2 }, 8)).toBe('4 × 2 = 8');
    expect(equation(100_000, { kind: 'mul', operand: 10 }, 1_000_000)).toBe('100,000 × 10 = 1,000,000');
  });

  it('spells numbers in English', () => {
    expect(numberToWords(0)).toBe('zero');
    expect(numberToWords(7)).toBe('seven');
    expect(numberToWords(15)).toBe('fifteen');
    expect(numberToWords(42)).toBe('forty-two');
    expect(numberToWords(100)).toBe('one hundred');
    expect(numberToWords(128)).toBe('one hundred twenty-eight');
    expect(numberToWords(1_000)).toBe('one thousand');
    expect(numberToWords(10_020)).toBe('ten thousand twenty');
    expect(numberToWords(1_000_000)).toBe('one million');
    expect(numberToWords(1_000_000_000)).toBe('one billion');
    expect(numberToWords(2_500_301)).toBe('two million five hundred thousand three hundred one');
  });

  it('detects celebrations', () => {
    expect(isPowerOfTen(100)).toBe(true);
    expect(isPowerOfTen(120)).toBe(false);
    expect(celebrationLevel(4, 8)).toBe(0);
    expect(celebrationLevel(8, 10)).toBe(1);
    expect(celebrationLevel(10, 100)).toBe(2);
    expect(celebrationLevel(100_000, 1_000_000)).toBe(3);
    expect(celebrationLevel(8, 4)).toBe(0);
  });
});

describe('NumberTeam', () => {
  it('splits by division and joins back by addition', () => {
    const t = new NumberTeam(8);
    const split = t.apply({ kind: 'div', operand: 2 });
    expect(split.type).toBe('split');
    expect(t.leader).toBe(4);
    expect(t.companions.map((c) => c.value)).toEqual([4]);
    expect(t.total()).toBe(8);
    const join = t.join();
    expect(join).toMatchObject({ type: 'join', before: 4, after: 8 });
    expect(t.leader).toBe(8);
    expect(t.companions).toEqual([]);
  });

  it('splits into several equal parts and keeps the total', () => {
    const t = new NumberTeam(12);
    t.apply({ kind: 'div', operand: 3 });
    expect(t.leader).toBe(4);
    expect(t.companions.map((c) => c.value)).toEqual([4, 4]);
    expect(t.total()).toBe(12);
  });

  it('refuses impossible splits without changing state', () => {
    const t = new NumberTeam(7);
    expect(t.apply({ kind: 'div', operand: 2 })).toMatchObject({ type: 'refused', reason: 'not-whole' });
    expect(t.leader).toBe(7);
    const one = new NumberTeam(1);
    expect(one.apply({ kind: 'div', operand: 1 })).toMatchObject({ type: 'refused', reason: 'too-small' });
    const big = new NumberTeam(64);
    big.apply({ kind: 'div', operand: 2 });
    big.apply({ kind: 'div', operand: 2 });
    big.apply({ kind: 'div', operand: 2 });
    expect(big.companions.length).toBe(3);
    expect(big.apply({ kind: 'div', operand: 2 })).toMatchObject({ type: 'refused', reason: 'too-many' });
    expect(big.total()).toBe(64);
  });

  it('subtraction separates a part and refuses going below zero', () => {
    const t = new NumberTeam(10);
    expect(t.apply({ kind: 'sub', operand: 3 })).toMatchObject({ type: 'apply', before: 10, after: 7 });
    const small = new NumberTeam(2);
    expect(small.apply({ kind: 'sub', operand: 3 })).toMatchObject({ type: 'refused', reason: 'negative' });
    expect(small.leader).toBe(2);
  });

  it('reports whether a gate can be used', () => {
    const t = new NumberTeam(5);
    expect(t.canApply({ kind: 'div', operand: 2 })).toBe(false);
    expect(t.canApply({ kind: 'mul', operand: 10 })).toBe(true);
    expect(t.canApply({ kind: 'sub', operand: 6 })).toBe(false);
  });
});
