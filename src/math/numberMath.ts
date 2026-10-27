// Pure number logic. No rendering or animation code may live here.

export type OpKind = 'add' | 'sub' | 'mul' | 'div';

export interface MathOp {
  kind: OpKind;
  operand: number;
}

/** Largest value the prototype supports (one billion). */
export const MAX_VALUE = 1_000_000_000;

export type OpFailure = 'negative' | 'not-whole' | 'too-big' | 'bad-operand';

export type OpResult = { ok: true; value: number } | { ok: false; reason: OpFailure };

export function isValidValue(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_VALUE;
}

export function applyOp(value: number, op: MathOp): OpResult {
  if (!isValidValue(value)) throw new RangeError(`Invalid number state: ${value}`);
  const k = op.operand;
  if (!Number.isSafeInteger(k) || k < 0) return { ok: false, reason: 'bad-operand' };
  let result: number;
  switch (op.kind) {
    case 'add':
      result = value + k;
      break;
    case 'sub':
      if (k > value) return { ok: false, reason: 'negative' };
      result = value - k;
      break;
    case 'mul':
      result = value * k;
      break;
    case 'div':
      if (k === 0) return { ok: false, reason: 'bad-operand' };
      if (value % k !== 0) return { ok: false, reason: 'not-whole' };
      result = value / k;
      break;
  }
  if (result > MAX_VALUE) return { ok: false, reason: 'too-big' };
  return { ok: true, value: result };
}

export const OP_SYMBOL: Record<OpKind, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

export function opLabel(op: MathOp): string {
  return `${OP_SYMBOL[op.kind]}${formatNumber(op.operand)}`;
}

export function equation(a: number, op: MathOp, result: number): string {
  return `${formatNumber(a)} ${OP_SYMBOL[op.kind]} ${formatNumber(op.operand)} = ${formatNumber(result)}`;
}

/** Groups digits with commas: 1000000 -> "1,000,000". */
export function formatNumber(n: number): string {
  const s = Math.trunc(Math.abs(n)).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];

function underThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ''));
  }
  return parts.join(' ');
}

/** English words for a nonnegative integer: 1000000 -> "one million". */
export function numberToWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Unsupported: ${n}`);
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${numberToWords(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

/** 1 for 0-9, 2 for 10-99, ... */
export function digitCount(n: number): number {
  return Math.max(1, Math.trunc(n).toString().length);
}

/** True for 10, 100, 1000 ... */
export function isPowerOfTen(n: number): boolean {
  if (n < 10) return false;
  while (n % 10 === 0) n /= 10;
  return n === 1;
}

/**
 * Size of the celebration a new value deserves.
 * 0 = normal, 1 = reached a new digit count, 2 = round power of ten >= 100, 3 = a million or more.
 */
export function celebrationLevel(before: number, after: number): 0 | 1 | 2 | 3 {
  if (after <= before) return 0;
  if (after >= 1_000_000 && before < after) return 3;
  if (after >= 100 && isPowerOfTen(after)) return 2;
  if (digitCount(after) > digitCount(before) && after >= 100) return 2;
  if (digitCount(after) > digitCount(before)) return 1;
  return 0;
}

export function refusalMessage(value: number, op: MathOp, reason: OpFailure): string {
  const v = formatNumber(value);
  switch (reason) {
    case 'negative':
      return `${v} is too small to take away ${formatNumber(op.operand)}`;
    case 'not-whole':
      return `${v} can't split into ${formatNumber(op.operand)} equal whole numbers`;
    case 'too-big':
      return `Wow! That would be bigger than one billion!`;
    case 'bad-operand':
      return `That gate is resting`;
  }
}
