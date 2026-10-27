// The player's mathematical state: one leader number plus companions created by division.
// Pure logic, independent of rendering.
import { applyOp, isValidValue, type MathOp, type OpFailure } from './numberMath';

export interface Companion {
  id: number;
  value: number;
}

export const MAX_COMPANIONS = 3;

export type TeamEvent =
  | { type: 'apply'; op: MathOp; before: number; after: number }
  | { type: 'split'; op: MathOp; before: number; leader: number; created: Companion[] }
  | { type: 'join'; before: number; joined: Companion[]; after: number }
  | { type: 'refused'; op: MathOp; value: number; reason: OpFailure | 'too-small' | 'too-many' };

export class NumberTeam {
  leader: number;
  companions: Companion[] = [];
  private nextId = 1;

  constructor(start = 2) {
    if (!isValidValue(start)) throw new RangeError(`Invalid start ${start}`);
    this.leader = start;
  }

  reset(start = 2): void {
    this.leader = start;
    this.companions = [];
  }

  /** Sum of the leader and all companions. Division and joining keep this constant. */
  total(): number {
    return this.companions.reduce((sum, c) => sum + c.value, this.leader);
  }

  /** Whether an operation would succeed right now (used to show sleeping gates). */
  canApply(op: MathOp): boolean {
    if (op.kind === 'div') return this.checkSplit(op) === null;
    return applyOp(this.leader, op).ok;
  }

  /** Addition, subtraction and multiplication change the leader only. Division splits. */
  apply(op: MathOp): TeamEvent {
    if (op.kind === 'div') return this.split(op);
    const r = applyOp(this.leader, op);
    if (!r.ok) return { type: 'refused', op, value: this.leader, reason: r.reason };
    const before = this.leader;
    this.leader = r.value;
    return { type: 'apply', op, before, after: r.value };
  }

  private checkSplit(op: MathOp): OpFailure | 'too-small' | 'too-many' | null {
    const r = applyOp(this.leader, op);
    if (!r.ok) return r.reason;
    if (op.operand < 2 || r.value < 1) return 'too-small';
    if (this.companions.length + op.operand - 1 > MAX_COMPANIONS) return 'too-many';
    return null;
  }

  /** leader ÷ k: the leader becomes leader/k and k-1 companions of the same value appear. */
  split(op: MathOp): TeamEvent {
    const problem = this.checkSplit(op);
    if (problem) return { type: 'refused', op, value: this.leader, reason: problem };
    const before = this.leader;
    const part = before / op.operand;
    const created: Companion[] = [];
    for (let i = 1; i < op.operand; i++) created.push({ id: this.nextId++, value: part });
    this.leader = part;
    this.companions.push(...created);
    return { type: 'split', op, before, leader: part, created };
  }

  /** All companions merge back into the leader by addition. */
  join(): TeamEvent | null {
    if (this.companions.length === 0) return null;
    const before = this.leader;
    const joined = this.companions;
    const after = this.total();
    if (!isValidValue(after)) throw new RangeError('Join overflow');
    this.leader = after;
    this.companions = [];
    return { type: 'join', before, joined, after };
  }
}
