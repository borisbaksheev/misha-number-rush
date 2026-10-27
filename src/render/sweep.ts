// Sweeps 2D cross-section profiles along the track to build roads, curbs and tunnels.
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { newFrame, type TrackPath } from '../game/trackPath';

export interface SweepOptions {
  /** Cross-section points (x across the road, y up) for a given arc length. */
  profile: (s: number) => [number, number][];
  /** Lateral offset added to every profile point. */
  offset?: (s: number) => number;
  /** Extra height added to every profile point. */
  lift?: (s: number) => number;
  step?: number;
  closed?: boolean;
  uv?: (s: number, j: number, count: number) => [number, number];
  color?: (s: number, j: number, ringIndex: number) => Color;
  caps?: boolean;
}

/** Sample arc lengths from s0 to s1 (inclusive) with roughly `step` spacing. */
export function samples(s0: number, s1: number, step: number): number[] {
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(s0 + ((s1 - s0) * i) / n);
  return out;
}

export function sweep(path: TrackPath, s0: number, s1: number, o: SweepOptions): BufferGeometry {
  const ss = samples(s0, s1, o.step ?? 1);
  const f = newFrame();
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let ringSize = 0;
  const p = new Vector3();
  ss.forEach((s, i) => {
    path.frameAt(s, f);
    const prof = o.profile(s);
    ringSize = prof.length;
    const off = o.offset ? o.offset(s) : 0;
    const lift = o.lift ? o.lift(s) : 0;
    prof.forEach(([x, y], j) => {
      p.copy(f.pos)
        .addScaledVector(f.right, x + off)
        .addScaledVector(f.up, y + lift);
      positions.push(p.x, p.y, p.z);
      if (o.uv) uvs.push(...o.uv(s, j, prof.length));
      if (o.color) {
        const c = o.color(s, j, i);
        colors.push(c.r, c.g, c.b);
      }
    });
  });
  const segs = o.closed ? ringSize : ringSize - 1;
  for (let i = 0; i < ss.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % ringSize;
      const a = i * ringSize + j;
      const b = i * ringSize + j2;
      const c = (i + 1) * ringSize + j;
      const d = (i + 1) * ringSize + j2;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (o.caps) {
    // fan-triangulated end caps (profiles are convex)
    const addCap = (ring: number, flip: boolean) => {
      const base = ring * ringSize;
      for (let j = 1; j < ringSize - 1; j++) {
        if (flip) indices.push(base, base + j + 1, base + j);
        else indices.push(base, base + j, base + j + 1);
      }
    };
    addCap(0, true);
    addCap(ss.length - 1, false);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (uvs.length) g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  if (colors.length) g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * Circle profile centred at (cx, cy). Closed profiles must run clockwise in (x, y)
 * so that the swept surface normals point outwards.
 */
export function circleProfile(cx: number, cy: number, r: number, n = 10): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -(i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
