// A living, animated 3D number character built from rounded extruded digits.
import {
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  QuadraticBezierCurve3,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import { formatNumber } from '../math/numberMath';
import { CHARACTER_STYLE, layoutText } from './glyphs';
import { DIGIT_COLORS, INK } from './palette';

/** Height of a single digit in world units at character scale 1. */
export const CHARACTER_HEIGHT = 1.8;
const MAX_FORMATION_WIDTH = 3.1; // in digit heights (grows a little for very long numbers)
const FOOT_LIFT = 0.17;

export type Expression = 'smile' | 'grin' | 'oh' | 'sleepy';
export type Tier = 0 | 1 | 2 | 3;

export function tierFor(value: number): Tier {
  if (value >= 1_000_000) return 3;
  if (value >= 100_000) return 2;
  if (value >= 1_000) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Shared geometry and materials
// ---------------------------------------------------------------------------
const geo = {
  eye: new SphereGeometry(1, 24, 18),
  pupil: new SphereGeometry(1, 16, 12),
  shine: new SphereGeometry(1, 8, 6),
  shoe: new SphereGeometry(1, 20, 14),
  arm: new CapsuleGeometry(0.055, 0.26, 4, 10),
  hand: new SphereGeometry(0.085, 14, 10),
  cheek: new CircleGeometry(1, 20),
  brow: new CapsuleGeometry(0.022, 0.11, 3, 8),
  grin: new CircleGeometry(1, 24, Math.PI, Math.PI),
  oh: new CircleGeometry(1, 20),
  smile: new TubeGeometry(
    new QuadraticBezierCurve3(new Vector3(-0.085, 0.02, 0), new Vector3(0, -0.055, 0), new Vector3(0.085, 0.02, 0)),
    16,
    0.018,
    8,
    false,
  ),
  sleepyEye: new TorusGeometry(1, 0.18, 8, 16, Math.PI),
  crownBand: new CylinderGeometry(0.34, 0.3, 0.16, 24, 1, true),
  crownSpike: new ConeGeometry(0.075, 0.2, 10),
  gem: new IcosahedronGeometry(0.05, 0),
};

const mat = {
  eye: new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
  pupil: new MeshPhysicalMaterial({ color: '#1d1030', roughness: 0.2, clearcoat: 1 }),
  shine: new MeshBasicMaterial({ color: '#ffffff' }),
  ink: new MeshBasicMaterial({ color: INK }),
  mouth: new MeshBasicMaterial({ color: '#4a1a3a' }),
  cheek: new MeshBasicMaterial({ color: '#ff7aa8', transparent: true, opacity: 0.55, depthWrite: false }),
  shoe: new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.35, clearcoat: 0.8 }),
  gold: new MeshPhysicalMaterial({
    color: '#ffc93c',
    metalness: 1,
    roughness: 0.22,
    clearcoat: 0.6,
    emissive: '#4a2a00',
    emissiveIntensity: 0.25,
  }),
  gem: new MeshPhysicalMaterial({ color: '#ff3d8b', roughness: 0.05, metalness: 0.1, clearcoat: 1, emissive: '#600020' }),
};

const digitMaterials = new Map<string, Material>();
let lowQuality = false;

export function setCharacterQuality(low: boolean): void {
  lowQuality = low;
}

function digitMaterial(ch: string, tier: Tier): Material {
  const key = `${ch}|${tier}|${lowQuality}`;
  let m = digitMaterials.get(key);
  if (m) return m;
  const color = new Color(DIGIT_COLORS[ch] ?? '#ffffff');
  if (tier === 3) {
    m = mat.gold;
  } else if (lowQuality) {
    m = new MeshStandardMaterial({ color, roughness: 0.3, metalness: tier === 2 ? 0.3 : 0.02 });
  } else {
    m = new MeshPhysicalMaterial({
      color,
      roughness: 0.32,
      metalness: tier === 2 ? 0.25 : 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      iridescence: tier === 2 ? 0.6 : 0,
      iridescenceIOR: 1.6,
      emissive: color.clone().multiplyScalar(0.05),
    });
  }
  digitMaterials.set(key, m);
  return m;
}

function limbMaterial(ch: string, tier: Tier): Material {
  if (tier === 3) return mat.gold;
  return digitMaterial(ch, 0);
}

interface Foot {
  mesh: Mesh;
  baseX: number;
  phase: number;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
export interface MotionState {
  speed: number;
  /** Lateral velocity, positive = moving right. */
  steer: number;
  airborne: boolean;
  /** Distance travelled; drives the walk cycle. */
  stride: number;
  /** Flying pose (Sky Numbers): arms spread like wings, feet trailing, happy face. */
  flying?: boolean;
}

export class NumberCharacter {
  readonly root = new Group();
  /** Pivot at the feet; receives squash/stretch, lean and spins. */
  readonly body = new Group();
  private readonly formation = new Group();
  private readonly digits = new Group();
  private readonly face = new Group();
  private readonly limbs = new Group();
  private readonly accessories = new Group();
  private eyes: Group[] = [];
  private pupils: Mesh[] = [];
  private brows: Mesh[] = [];
  private mouths: Record<'smile' | 'grin' | 'oh', Mesh>;
  private feet: Foot[] = [];
  private arms: Group[] = [];
  value = -1;
  tier: Tier = 0;
  /** Formation width in world units (after scaling). */
  width = 1;
  height = CHARACTER_HEIGHT;

  // animation state
  private t = Math.random() * 10;
  private squash = 0;
  private squashVel = 0;
  private popScale = 1;
  private popVel = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blink = 0;
  private expression: Expression = 'smile';
  private expressionTimer = 0;
  private wave = 0;
  spin = 0;
  flip = 0;
  private lean = 0;

  constructor(value: number, scale = 1) {
    this.root.scale.setScalar(scale);
    this.root.add(this.body);
    this.body.add(this.formation);
    this.formation.add(this.digits, this.face, this.accessories);
    this.body.add(this.limbs);

    for (const side of [-1, 1]) {
      const eye = new Group();
      const white = new Mesh(geo.eye, mat.eye);
      white.scale.set(0.12, 0.14, 0.075);
      const pupil = new Mesh(geo.pupil, mat.pupil);
      pupil.scale.set(0.066, 0.078, 0.04);
      pupil.position.z = 0.052;
      const shine = new Mesh(geo.shine, mat.shine);
      shine.scale.setScalar(0.022);
      shine.position.set(0.022, 0.03, 0.035);
      pupil.add(shine);
      eye.add(white, pupil);
      eye.userData.side = side;
      this.eyes.push(eye);
      this.pupils.push(pupil);
      this.face.add(eye);
      const brow = new Mesh(geo.brow, mat.ink);
      brow.rotation.z = Math.PI / 2;
      this.brows.push(brow);
      this.face.add(brow);
      const cheek = new Mesh(geo.cheek, mat.cheek);
      cheek.scale.setScalar(0.05);
      cheek.position.set(side * 0.24, 0.74, 0.01);
      cheek.userData.cheek = true;
      this.face.add(cheek);
    }
    this.mouths = {
      smile: new Mesh(geo.smile, mat.mouth),
      grin: new Mesh(geo.grin, mat.mouth),
      oh: new Mesh(geo.oh, mat.mouth),
    };
    this.mouths.grin.scale.set(0.1, 0.085, 1);
    this.mouths.oh.scale.set(0.05, 0.062, 1);
    for (const m of Object.values(this.mouths)) this.face.add(m);

    this.root.traverse((o) => {
      o.castShadow = true;
    });
    this.setValue(value);
  }

  setValue(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.tier = tierFor(value);
    const text = formatNumber(value);
    const { items, width } = layoutText(text, CHARACTER_STYLE, 0.06);
    this.digits.clear();
    let front = 0;
    for (const it of items) {
      const m = new Mesh(it.glyph.geometry, digitMaterial(it.ch, this.tier));
      m.position.x = it.x;
      if (it.ch === ',') m.position.y = 0.02;
      m.castShadow = true;
      m.receiveShadow = false;
      this.digits.add(m);
      front = Math.max(front, it.glyph.front);
    }
    const maxWidth = Math.min(4.4, MAX_FORMATION_WIDTH + Math.max(0, items.length - 5) * 0.22);
    const k = Math.min(1, maxWidth / Math.max(width, 0.01));
    this.formation.scale.setScalar(k * CHARACTER_HEIGHT);
    this.formation.position.y = FOOT_LIFT;
    this.width = width * k * CHARACTER_HEIGHT;
    this.height = k * CHARACTER_HEIGHT + FOOT_LIFT;

    // Face: centred, scaled up a little for tiny wide formations so it stays expressive.
    const faceScale = Math.min(1.25, Math.max(1, 0.8 / k));
    this.face.scale.setScalar(faceScale);
    this.face.position.set(0, (1 - faceScale) * 0.55, front + 0.02);
    this.layoutFace();

    this.buildLimbs(items[0]?.ch ?? '0', this.width, k * CHARACTER_HEIGHT);
    this.buildAccessories();
  }

  /** Eyes peek over the top edge so the digit silhouette stays readable. */
  private layoutFace(): void {
    const eyeY = 0.93;
    for (const eye of this.eyes) eye.position.set(eye.userData.side * 0.13, eyeY, 0.02);
    this.brows.forEach((b, i) => b.position.set((i === 0 ? -1 : 1) * 0.13, eyeY + 0.2, 0.03));
    this.mouths.smile.position.set(0, 0.76, 0.03);
    this.mouths.grin.position.set(0, 0.79, 0.03);
    this.mouths.oh.position.set(0, 0.75, 0.03);
  }

  private buildLimbs(firstChar: string, w: number, h: number): void {
    this.limbs.clear();
    this.feet = [];
    this.arms = [];
    const pairs = Math.max(1, Math.min(4, Math.round(w / 1.3)));
    const spacing = w / pairs;
    for (let p = 0; p < pairs; p++) {
      const cx = -w / 2 + spacing * (p + 0.5);
      for (const side of [-1, 1]) {
        const shoe = new Mesh(geo.shoe, this.tier === 3 ? mat.gold : mat.shoe);
        shoe.scale.set(0.16, 0.1, 0.22);
        shoe.castShadow = true;
        this.limbs.add(shoe);
        this.feet.push({ mesh: shoe, baseX: cx + side * 0.2, phase: (side > 0 ? Math.PI : 0) + p * 1.3 });
      }
    }
    const limbMat = limbMaterial(firstChar, this.tier);
    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * (w / 2 + 0.02), FOOT_LIFT + h * 0.45, 0);
      const arm = new Mesh(geo.arm, limbMat);
      arm.position.y = -0.17;
      const hand = new Mesh(geo.hand, mat.shoe);
      hand.position.y = -0.36;
      arm.castShadow = hand.castShadow = true;
      shoulder.add(arm, hand);
      shoulder.userData.side = side;
      this.arms.push(shoulder);
      this.limbs.add(shoulder);
    }
  }

  private buildAccessories(): void {
    this.accessories.clear();
    if (this.tier < 1) return;
    const crown = new Group();
    const band = new Mesh(geo.crownBand, mat.gold);
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(geo.crownSpike, mat.gold);
      spike.position.set(Math.sin(a) * 0.31, 0.16, Math.cos(a) * 0.31);
      const gem = new Mesh(geo.gem, mat.gem);
      gem.position.set(Math.sin(a) * 0.33, 0.0, Math.cos(a) * 0.33);
      crown.add(spike, gem);
    }
    crown.scale.setScalar(0.85);
    crown.position.set(0, 1.3, -0.05);
    crown.rotation.z = -0.12;
    crown.traverse((o) => (o.castShadow = true));
    this.accessories.add(crown);
  }

  setExpression(e: Expression, seconds = 0): void {
    this.expression = e;
    this.expressionTimer = seconds;
  }

  /** Bouncy pop used when the number changes. */
  pop(strength = 1): void {
    this.popScale = 1 - 0.35 * strength;
    this.popVel = 9 * strength;
    this.setExpression('grin', 1.4);
  }

  /** Positive = stretch tall, negative = squash flat. */
  impulse(amount: number): void {
    this.squashVel += amount;
  }

  celebrate(seconds = 1.6): void {
    this.wave = seconds;
    this.setExpression('grin', seconds);
  }

  update(dt: number, m: MotionState): void {
    this.t += dt;
    const t = this.t;

    // squash & stretch spring
    this.squashVel += (-this.squash * 160 - this.squashVel * 11) * dt;
    this.squash += this.squashVel * dt;
    this.popVel += ((1 - this.popScale) * 190 - this.popVel * 9) * dt;
    this.popScale += this.popVel * dt;

    const run = Math.min(1, m.speed / 18);
    const bob = m.airborne ? 0 : Math.abs(Math.sin(m.stride * 0.9)) * 0.09 * run + Math.sin(t * 2.4) * 0.025 * (1 - run);
    const sq = Math.max(-0.45, Math.min(0.5, this.squash));
    const breathe = Math.sin(t * 2.4) * 0.018 * (1 - run);
    this.body.scale.set(
      this.popScale * (1 - sq * 0.5 - breathe * 0.5),
      this.popScale * (1 + sq + breathe),
      this.popScale * (1 - sq * 0.5),
    );
    this.body.position.y = bob;

    const targetLean = Math.max(-0.4, Math.min(0.4, -m.steer * 0.045));
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-8 * dt));
    this.body.rotation.set(this.flip, this.spin, this.lean);
    // lean forward when running fast (face looks toward camera so tilt back toward it)
    this.formation.rotation.x = -run * 0.12;

    // feet
    for (const f of this.feet) {
      if (m.flying) {
        const kick = Math.sin(t * 5 + f.phase) * 0.05;
        f.mesh.position.set(f.baseX * 0.8, 0.12 + kick, 0.16);
        f.mesh.rotation.x = 0.9;
        continue;
      }
      const ph = m.stride * 0.9 + f.phase;
      const lift = m.airborne ? 0.08 : Math.max(0, Math.sin(ph)) * 0.16 * run;
      f.mesh.position.set(f.baseX, 0.09 + lift, m.airborne ? -0.05 : -Math.cos(ph) * 0.18 * run);
      f.mesh.rotation.x = m.airborne ? 0.4 : -Math.sin(ph) * 0.4 * run;
    }
    // arms
    for (const a of this.arms) {
      const side = a.userData.side as number;
      let swing = Math.sin(m.stride * 0.9 + (side > 0 ? 0 : Math.PI)) * 0.7 * run;
      let raise = 0.25 + Math.sin(t * 2 + side) * 0.05;
      if (m.airborne) raise = 2.2;
      if (m.flying) {
        // wings: arms stretched out sideways with a gentle flap
        raise = 1.45 + Math.sin(t * 5.5 + side) * 0.22;
        swing = -0.35;
      }
      if (this.wave > 0) {
        raise = 2.6;
        swing = Math.sin(t * 16 + side) * 0.35;
      }
      a.rotation.set(swing, 0, side * raise);
    }
    this.wave = Math.max(0, this.wave - dt);

    // blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.14;
      this.blinkTimer = 1.8 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt);
    const lid = this.blink > 0 ? 0.12 : 1;

    // expression
    if (this.expressionTimer > 0) {
      this.expressionTimer -= dt;
      if (this.expressionTimer <= 0) this.expression = 'smile';
    }
    const e = m.airborne && !m.flying && this.expression === 'smile' ? 'oh' : this.expression;
    this.mouths.smile.visible = e === 'smile';
    this.mouths.grin.visible = e === 'grin';
    this.mouths.oh.visible = e === 'oh';
    const happy = e === 'grin';
    const sleepy = e === 'sleepy';
    for (const eye of this.eyes) {
      eye.scale.set(1, happy ? lid * 0.75 : sleepy ? 0.25 : lid, 1);
    }
    const lookX = Math.max(-1, Math.min(1, m.steer * 0.1));
    for (const p of this.pupils) {
      p.position.x += (lookX * 0.045 - p.position.x) * (1 - Math.exp(-10 * dt));
      p.position.y += ((m.airborne ? 0.04 : 0) - p.position.y) * (1 - Math.exp(-10 * dt));
    }
    this.brows.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      const surprise = e === 'oh' ? 0.06 : happy ? 0.03 : 0;
      b.position.y = 1.13 + surprise;
      b.rotation.z = Math.PI / 2 + side * (happy ? -0.25 : run > 0.8 ? 0.22 : 0);
    });

    // accessories wobble
    if (this.accessories.children.length) {
      this.accessories.children[0].rotation.y = Math.sin(t * 1.5) * 0.15;
    }
  }

  /** Disposes nothing shared; meshes are cheap wrappers around cached geometry. */
  detach(): void {
    this.root.parent?.remove(this.root);
  }

  static attachTo(parent: Object3D, ch: NumberCharacter): NumberCharacter {
    parent.add(ch.root);
    return ch;
  }
}
