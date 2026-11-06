// Generates the operations shown on a row of sky portals for the player's *current* value.
// Every choice is validated exactly; nothing is hard-coded. Values can be fractions after a
// storm (7 → 3.5), so all checks use exact dyadic arithmetic.
import { applyDyadic, dyadic, key, toNumber, type Dyadic } from '../math/dyadic';
import type { MathOp, OpKind } from '../math/numberMath';
import { shuffle } from '../math/random';

/** Step size that keeps choices meaningful for the number's size: 1, 10, 100 … */
export function unitFor(value: number): number {
  if (value < 100) return 1;
  return 10 ** (Math.floor(Math.log10(value)) - 1);
}

const op = (kind: OpKind, operand: number): MathOp => ({ kind, operand });

/**
 * Three or four distinct, valid operations for `value`, ideally one of each kind.
 * Results are always positive, exact (finite decimals) and within one billion; dividing a whole
 * number always gives a whole number.
 */
export function generateChoices(input: Dyadic | number, rand: () => number, max = 4): MathOp[] {
  const value = typeof input === 'number' ? dyadic(input) : input;
  const v = toNumber(value);
  const whole = value.exp === 0;
  const out: MathOp[] = [];
  const results = new Set<string>([key(value)]);
  const tryOp = (o: MathOp): boolean => {
    if (out.length >= max) return false;
    const r = applyDyadic(value, o);
    if (!r.ok || results.has(key(r.value))) return false;
    results.add(key(r.value));
    out.push(o);
    return true;
  };
  const u = unitFor(v);
  const small = v < 20;
  const digit = () => 1 + Math.floor(rand() * 9);
  // After a storm made a fraction, ×2 is offered first: it can make the number whole again.
  const mul = !whole ? [2, 10, 4, 5] : rand() < 0.5 ? [10, 2, 3, 5] : rand() < 0.7 ? [2, 10, 3, 5] : [3, 2, 5, 10];
  const addK = small ? [1 + Math.floor(rand() * 5), 2, 1, 3] : [u * digit(), u, u * 2, 1];
  const maxSub = Math.max(1, Math.min(5, Math.ceil(v) - 1));
  const subK = small ? [1 + Math.floor(rand() * maxSub), 1, 2] : [u * digit(), u, u * 2, 1];
  const div = rand() < 0.65 ? [2, 10, 5, 3, 4] : [10, 2, 5, 4, 3];

  // one of each kind first
  mul.some((k) => tryOp(op('mul', k)));
  addK.some((k) => tryOp(op('add', k)));
  subK.some((k) => tryOp(op('sub', k)));
  div.some((k) => tryOp(op('div', k)));

  // if a kind was impossible (e.g. 7 ÷ ?, or nothing to take away from 0.5), still offer three
  const fallbacks: MathOp[] = [
    ...mul.map((k) => op('mul', k)),
    ...addK.map((k) => op('add', k)),
    ...div.map((k) => op('div', k)),
    ...subK.map((k) => op('sub', k)),
    op('add', 1),
    op('add', 2),
    op('add', 3),
    op('sub', 1),
  ];
  for (const f of fallbacks) {
    if (out.length >= 3) break;
    tryOp(f);
  }
  return shuffle(out, rand);
}
