// Pooled particle effects: glowing sparkles, soft dust, 3D confetti, speed streaks and shockwave rings.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';

export interface BurstOptions {
  count: number;
  colors: (Color | string)[];
  speed?: number;
  spread?: number;
  /** Extra upward velocity. */
  up?: number;
  gravity?: number;
  size?: number;
  life?: number;
  drag?: number;
  /** Star-shaped sparkle instead of a round glow. */
  star?: boolean;
  /** Directional bias added to every particle velocity. */
  dir?: Vector3;
  /** Random start offset radius. */
  radius?: number;
}

const POINT_VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute float shape;
  attribute vec3 tint;
  uniform float scale;
  varying float vAlpha;
  varying float vShape;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(size * scale / max(-mv.z, 0.1), 300.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = alpha;
    vShape = shape;
    vColor = tint;
  }`;
const POINT_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vShape;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 1.0, r);
    float a = core * core;
    if (vShape > 0.5) {
      float star = max(0.0, 1.0 - abs(p.x * p.y) * 14.0) * (1.0 - smoothstep(0.2, 1.0, r));
      a = max(a * 0.7, star);
    }
    gl_FragColor = vec4(vColor * (1.0 + a * 0.3), a * vAlpha);
  }`;

class PointPool {
  readonly points: Points;
  private n: number;
  private next = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private geo: BufferGeometry;
  readonly material: ShaderMaterial;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.geo = new BufferGeometry();
    const attr = (name: string, arr: Float32Array, k: number) => {
      const a = new BufferAttribute(arr, k);
      a.setUsage(DynamicDrawUsage);
      this.geo.setAttribute(name, a);
    };
    attr('position', this.pos, 3);
    attr('tint', this.col, 3);
    attr('size', this.size, 1);
    attr('alpha', this.alpha, 1);
    attr('shape', this.shape, 1);
    this.material = new ShaderMaterial({
      uniforms: { scale: { value: 500 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: Vector3, v: Vector3, color: Color, size: number, life: number, gravity: number, drag: number, star: boolean) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.shape[i] = star ? 1 : 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = Math.min(1, t * 2.5);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * Math.sqrt(t));
    }
    for (const name of ['position', 'tint', 'size', 'alpha', 'shape']) this.geo.getAttribute(name).needsUpdate = true;
  }
}

interface Confetto {
  life: number;
  pos: Vector3;
  vel: Vector3;
  axis: Vector3;
  angle: number;
  spin: number;
}

export class Particles {
  readonly group = new Group();
  private glow = new PointPool(900, true);
  private dust = new PointPool(400, false);
  private confetti: InstancedMesh;
  private confettoData: Confetto[] = [];
  private confettiNext = 0;
  private streaks: InstancedMesh;
  private streakData: { pos: Vector3; life: number; dir: Vector3 }[] = [];
  private rings: { mesh: Mesh; life: number; max: number; size: number }[] = [];
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpC = new Color();
  private m4 = new Matrix4();
  private q = new Quaternion();

  constructor() {
    this.group.add(this.glow.points, this.dust.points);
    const confettiGeo = new PlaneGeometry(0.24, 0.13);
    this.confetti = new InstancedMesh(
      confettiGeo,
      new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }),
      320,
    );
    this.confetti.instanceMatrix.setUsage(DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 320; i++) {
      this.confetti.setMatrixAt(i, zero);
      this.confetti.setColorAt(i, new Color('#ffffff'));
      this.confettoData.push({ life: 0, pos: new Vector3(), vel: new Vector3(), axis: new Vector3(1, 0, 0), angle: 0, spin: 0 });
    }
    this.group.add(this.confetti);

    const streakGeo = new BoxGeometry(0.05, 0.05, 1);
    this.streaks = new InstancedMesh(
      streakGeo,
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
      48,
    );
    this.streaks.frustumCulled = false;
    for (let i = 0; i < 48; i++) {
      this.streaks.setMatrixAt(i, zero);
      this.streakData.push({ pos: new Vector3(), life: 0, dir: new Vector3() });
    }
    this.group.add(this.streaks);

    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(
        new RingGeometry(0.85, 1, 48),
        new MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
      );
      mesh.visible = false;
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
      this.group.add(mesh);
    }
  }

  setScale(viewportHeight: number, fovDeg: number): void {
    const s = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.material.uniforms.scale.value = s;
    this.dust.material.uniforms.scale.value = s;
  }

  burst(at: Vector3, o: BurstOptions): void {
    const speed = o.speed ?? 6;
    const spread = o.spread ?? 1;
    for (let i = 0; i < o.count; i++) {
      const dir = this.randomDir(this.tmpV).multiplyScalar(speed * (0.4 + Math.random() * 0.6) * spread);
      if (o.dir) dir.add(o.dir);
      dir.y += o.up ?? 0;
      const p = this.tmpV2.copy(at);
      if (o.radius) p.add(this.randomDir(new Vector3()).multiplyScalar(o.radius * Math.random()));
      this.tmpC.set(o.colors[i % o.colors.length]);
      this.glow.emit(p, dir, this.tmpC, (o.size ?? 0.5) * (0.6 + Math.random() * 0.8), (o.life ?? 0.9) * (0.6 + Math.random() * 0.6), o.gravity ?? 4, o.drag ?? 1.5, o.star ?? true);
    }
  }

  puff(at: Vector3, count: number, color: Color | string = '#ffffff', speed = 3, size = 0.9, up = 1.5): void {
    for (let i = 0; i < count; i++) {
      const d = this.randomDir(this.tmpV).multiplyScalar(speed * (0.5 + Math.random() * 0.5));
      d.y = Math.abs(d.y) * 0.4 + up;
      this.tmpC.set(color);
      this.dust.emit(at, d, this.tmpC, size * (0.7 + Math.random() * 0.6), 0.5 + Math.random() * 0.4, -0.5, 2.5, false);
    }
  }

  confettiBurst(at: Vector3, count: number, colors: (Color | string)[], speed = 9, up = 6): void {
    for (let i = 0; i < count; i++) {
      const idx = this.confettiNext;
      this.confettiNext = (this.confettiNext + 1) % this.confettoData.length;
      const c = this.confettoData[idx];
      c.life = 2.2 + Math.random() * 1.2;
      c.pos.copy(at);
      this.randomDir(c.vel).multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      c.vel.y = Math.abs(c.vel.y) + up * (0.5 + Math.random() * 0.5);
      this.randomDir(c.axis);
      c.angle = Math.random() * 6;
      c.spin = 6 + Math.random() * 10;
      this.confetti.setColorAt(idx, this.tmpC.set(colors[i % colors.length]));
    }
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  shockwave(at: Vector3, normal: Vector3, size: number, color: Color | string, life = 0.7): void {
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings[0];
    r.life = life;
    r.max = life;
    r.size = size;
    r.mesh.position.copy(at);
    r.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.visible = true;
  }

  /** Wind streaks around the player when running fast. */
  speedLines(origin: Vector3, forward: Vector3, right: Vector3, up: Vector3, intensity: number, dt: number): void {
    if (intensity > 0.05 && Math.random() < intensity * dt * 40) {
      const s = this.streakData.find((x) => x.life <= 0);
      if (s) {
        s.life = 0.6;
        const side = Math.random() < 0.5 ? -1 : 1;
        s.pos
          .copy(origin)
          .addScaledVector(forward, 10 + Math.random() * 14)
          .addScaledVector(right, side * (3 + Math.random() * 6))
          .addScaledVector(up, -2.5 + Math.random() * 3.5);
        s.dir.copy(forward);
      }
    }
    const one = this.tmpV.set(1, 1, 1);
    this.streakData.forEach((s, i) => {
      if (s.life <= 0) {
        this.streaks.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        return;
      }
      s.life -= dt;
      this.q.setFromUnitVectors(this.tmpV2.set(0, 0, 1), s.dir);
      one.set(1, 1, 0.8 + intensity * 1.6);
      this.m4.compose(s.pos, this.q, one);
      this.streaks.setMatrixAt(i, this.m4);
    });
    this.streaks.instanceMatrix.needsUpdate = true;
    (this.streaks.material as MeshBasicMaterial).opacity = Math.min(0.35, intensity * 0.35);
  }

  update(dt: number, _camera: PerspectiveCamera): void {
    this.glow.update(dt);
    this.dust.update(dt);
    const scale = this.tmpV2;
    this.confettoData.forEach((c, i) => {
      if (c.life <= 0) return;
      c.life -= dt;
      c.vel.y -= 9 * dt;
      c.vel.multiplyScalar(Math.exp(-1.8 * dt));
      c.pos.addScaledVector(c.vel, dt);
      c.angle += c.spin * dt;
      this.q.setFromAxisAngle(c.axis, c.angle);
      const k = c.life > 0 ? Math.min(1, c.life * 2) : 0;
      scale.set(k, k, k);
      this.m4.compose(c.pos, this.q, scale);
      this.confetti.setMatrixAt(i, this.m4);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const s = 0.3 + t * r.size;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - t) * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  private randomDir(out: Vector3): Vector3 {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return out.set(r * Math.cos(a), u, r * Math.sin(a));
  }
}
