// Arc-length parameterised closed track centre line with banked frames.
import { CatmullRomCurve3, Vector3 } from 'three';

export interface Frame {
  pos: Vector3;
  tangent: Vector3; // forward
  right: Vector3;
  up: Vector3;
}

const WORLD_UP = new Vector3(0, 1, 0);

export class TrackPath {
  readonly length: number;
  readonly step: number;
  private readonly pos: Float32Array;
  private readonly tan: Float32Array;
  private readonly rgt: Float32Array;
  private readonly upv: Float32Array;
  readonly count: number;

  constructor(points: [number, number, number][], maxBankDeg = 10, stepSize = 0.5) {
    const curve = new CatmullRomCurve3(
      points.map((p) => new Vector3(p[0], p[1], p[2])),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = 4000;
    this.length = curve.getLength();
    this.count = Math.ceil(this.length / stepSize);
    this.step = this.length / this.count;
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.rgt = new Float32Array(n * 3);
    this.upv = new Float32Array(n * 3);

    const p = new Vector3();
    const t = new Vector3();
    const tangents: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      curve.getPointAt(i / n, p);
      curve.getTangentAt(i / n, t);
      p.toArray(this.pos, i * 3);
      tangents.push(t.clone());
    }

    // Signed horizontal curvature -> bank angle, smoothed along the track.
    const bank = new Float32Array(n);
    const look = Math.max(1, Math.round(6 / this.step));
    for (let i = 0; i < n; i++) {
      const a = tangents[(i - look + n) % n];
      const b = tangents[(i + look) % n];
      const cross = a.x * b.z - a.z * b.x; // >0 turning right (in -Z forward convention)
      const curvature = cross / (2 * look * this.step);
      bank[i] = Math.max(-1, Math.min(1, curvature * 18)) * ((maxBankDeg * Math.PI) / 180);
    }
    const smoothed = new Float32Array(n);
    const win = Math.round(10 / this.step);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) sum += bank[(i + k + n) % n];
      smoothed[i] = sum / (2 * win + 1);
    }

    const r = new Vector3();
    const u = new Vector3();
    for (let i = 0; i < n; i++) {
      const tg = tangents[i];
      r.crossVectors(tg, WORLD_UP).normalize();
      u.crossVectors(r, tg).normalize();
      // roll right/up around the tangent: inner edge drops on turns
      const c = Math.cos(smoothed[i]);
      const s = Math.sin(smoothed[i]);
      const rx = r.x * c - u.x * s;
      const ry = r.y * c - u.y * s;
      const rz = r.z * c - u.z * s;
      const ux = u.x * c + r.x * s;
      const uy = u.y * c + r.y * s;
      const uz = u.z * c + r.z * s;
      tg.toArray(this.tan, i * 3);
      this.rgt.set([rx, ry, rz], i * 3);
      this.upv.set([ux, uy, uz], i * 3);
    }
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Interpolated frame at arc length s (wrapped). Writes into `out`. */
  frameAt(s: number, out: Frame): Frame {
    const f = this.wrap(s) / this.step;
    const i0 = Math.floor(f) % this.count;
    const i1 = (i0 + 1) % this.count;
    const a = f - Math.floor(f);
    lerpInto(out.pos, this.pos, i0, i1, a);
    lerpInto(out.tangent, this.tan, i0, i1, a).normalize();
    lerpInto(out.right, this.rgt, i0, i1, a).normalize();
    lerpInto(out.up, this.upv, i0, i1, a).normalize();
    return out;
  }

  /** World position of a point at arc length s, lateral offset x, height y above the road plane. */
  pointAt(s: number, x: number, y: number, out: Vector3, scratch = newFrame()): Vector3 {
    this.frameAt(s, scratch);
    return out
      .copy(scratch.pos)
      .addScaledVector(scratch.right, x)
      .addScaledVector(scratch.up, y);
  }
}

export function newFrame(): Frame {
  return { pos: new Vector3(), tangent: new Vector3(), right: new Vector3(), up: new Vector3() };
}

function lerpInto(out: Vector3, arr: Float32Array, i0: number, i1: number, a: number): Vector3 {
  const b = 1 - a;
  out.set(
    arr[i0 * 3] * b + arr[i1 * 3] * a,
    arr[i0 * 3 + 1] * b + arr[i1 * 3 + 1] * a,
    arr[i0 * 3 + 2] * b + arr[i1 * 3 + 2] * a,
  );
  return out;
}
