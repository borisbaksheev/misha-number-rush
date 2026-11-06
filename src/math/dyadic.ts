// Exact numbers of the form whole ÷ 2ⁿ ("dyadic" fractions) for Sky Numbers.
// Storm clouds halve the number, so 7 becomes 3.5 and 1 becomes 0.5. Every such value has a
// finite decimal expansion (3.5, 0.25, 0.0009765625 …), and keeping numerator and power of two as
// BigInt means repeated halving is always exact: no floating-point artefacts like 0.30000000004.
import { formatNumber, MAX_VALUE, numberToWords, type MathOp, type OpFailure } from './numberMath';

export interface Dyadic {
  /** value = num / 2^exp; normalised so num is odd whenever exp > 0. */
  readonly num: bigint;
  readonly exp: number;
}

/** Finest step allowed: 1 / 2²⁰ ≈ 0.00000095. Halving stops there. */
export const MAX_EXP = 20;
const MAX_BIG = BigInt(MAX_VALUE);

export function dyadic(num: bigint | number, exp = 0): Dyadic {
  let n = typeof num === 'bigint' ? num : BigInt(num);
  let e = exp;
  while (e > 0 && n % 2n === 0n) {
    n /= 2n;
    e--;
  }
  return { num: n, exp: e };
}

export const isWhole = (d: Dyadic) => d.exp === 0;

export function equals(a: Dyadic, b: Dyadic): boolean {
  return a.num === b.num && a.exp === b.exp;
}

/** Approximate value for things like speed, sizes and colours (never for maths). */
export function toNumber(d: Dyadic): number {
  return Number(d.num) / 2 ** d.exp;
}

/** Key for sets/maps. */
export const key = (d: Dyadic) => `${d.num}/${d.exp}`;

function tooBig(d: Dyadic): boolean {
  return d.num > MAX_BIG << BigInt(d.exp);
}

export type DyadicResult = { ok: true; value: Dyadic } | { ok: false; reason: OpFailure | 'too-small' };

/**
 * Apply a portal/bubble operation exactly. Results must stay positive and within one billion.
 * Division must give a whole number when the value is whole (the original rule for portals);
 * fractional values may only be divided exactly (finite decimal) within the precision limit.
 */
export function applyDyadic(value: Dyadic, op: MathOp): DyadicResult {
  const k = op.operand;
  if (!Number.isSafeInteger(k) || k <= 0) return { ok: false, reason: 'bad-operand' };
  const K = BigInt(k);
  let out: Dyadic;
  switch (op.kind) {
    case 'add':
      out = dyadic(value.num + (K << BigInt(value.exp)), value.exp);
      break;
    case 'sub': {
      const n = value.num - (K << BigInt(value.exp));
      if (n <= 0n) return { ok: false, reason: 'negative' };
      out = dyadic(n, value.exp);
      break;
    }
    case 'mul':
      out = dyadic(value.num * K, value.exp);
      break;
    case 'div': {
      let odd = K;
      let twos = 0;
      while (odd % 2n === 0n) {
        odd /= 2n;
        twos++;
      }
      if (value.num % odd !== 0n) return { ok: false, reason: 'not-whole' };
      out = dyadic(value.num / odd, value.exp + twos);
      if (isWhole(value) && !isWhole(out)) return { ok: false, reason: 'not-whole' };
      if (out.exp > MAX_EXP) return { ok: false, reason: 'too-small' };
      break;
    }
  }
  if (tooBig(out)) return { ok: false, reason: 'too-big' };
  return { ok: true, value: out };
}

/** Exactly half (the storm cloud rule). Null once the number is as small as the game allows. */
export function halve(value: Dyadic): Dyadic | null {
  const out = dyadic(value.num, value.exp + 1);
  return out.exp > MAX_EXP ? null : out;
}

/** Exact decimal text with thousands separators: 1234.5 → "1,234.5", 1/1024 → "0.0009765625". */
export function formatDyadic(d: Dyadic): string {
  if (d.exp === 0) return formatNumber(Number(d.num));
  // num / 2^e = num·5^e / 10^e: an exact finite decimal with e digits after the point
  const scaled = (d.num * 5n ** BigInt(d.exp)).toString().padStart(d.exp + 1, '0');
  const whole = scaled.slice(0, scaled.length - d.exp);
  const frac = scaled.slice(scaled.length - d.exp).replace(/0+$/, '');
  return `${formatNumber(Number(whole))}.${frac}`;
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "three point five", "zero point two five". */
export function dyadicToWords(d: Dyadic): string {
  const text = formatDyadic(d).replace(/,/g, '');
  const [whole, frac] = text.split('.');
  const w = numberToWords(Number(whole));
  return frac ? `${w} point ${[...frac].map((c) => DIGIT_WORDS[Number(c)]).join(' ')}` : w;
}

/** Number of digits before the decimal point (for celebrations). */
export function wholeDigits(d: Dyadic): number {
  return (d.num >> BigInt(d.exp)).toString().length;
}
