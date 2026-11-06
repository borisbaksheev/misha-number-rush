// Visuals for track items: glowing maths portals, jelly bumpers and trampoline pads.
import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  CircleGeometry,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type MathOp, opLabel } from '../math/numberMath';
import { layoutText, SIGN_STYLE } from './glyphs';
import { OP_COLORS } from './palette';

export const SWIRL_FRAG = /* glsl */ `
  uniform float time;
  uniform vec3 color;
  uniform float strength;
  uniform float cut;
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    if (vPos.y < cut) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float swirl = sin(a * 5.0 + r * 9.0 - time * 3.0) * 0.5 + 0.5;
    float rim = smoothstep(0.55, 1.0, r);
    float alpha = (0.07 + rim * 0.55 + swirl * 0.16 * (0.4 + r)) * strength;
    vec3 col = mix(color, vec3(1.0), swirl * 0.35 + rim * 0.25);
    gl_FragColor = vec4(col, alpha);
  }`;
export const SWIRL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

const white = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.25, clearcoat: 1 });

/**
 * A rounded, glossy sign panel with white 3D lettering, centred on its origin.
 * Shared by racing gates and sky portals.
 */
export function buildSign(text: string, panelMat: Material, textH = 1.5, shadows = true): { group: Group; width: number } {
  const group = new Group();
  const label = new Group();
  const { items, width } = layoutText(text, SIGN_STYLE, 0.08);
  for (const it of items) {
    const m = new Mesh(it.glyph.geometry, white);
    m.position.x = it.x;
    m.castShadow = shadows;
    label.add(m);
  }
  label.scale.setScalar(textH);
  label.position.set(0, -textH * 0.5, 0.25);
  const panelW = width * textH + textH * 0.8;
  const panelGeo = new ExtrudeGeometry(roundedRect(panelW, textH * 1.66, textH * 0.4), {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 3,
  });
  panelGeo.translate(0, 0, -0.25);
  const panel = new Mesh(panelGeo, panelMat);
  panel.castShadow = shadows;
  panel.userData.ownGeo = true;
  group.add(panel, label);
  return { group, width: panelW };
}

/** Free the panel geometry built by buildSign (glyph geometry is cached and shared). */
export function disposeSign(holder: Object3D): void {
  holder.traverse((o) => {
    if (o.userData.ownGeo) (o as Mesh).geometry.dispose();
  });
  holder.clear();
}
const sleepyColor = new Color('#b9b3c9');

export type PortalKind = 'gate' | 'join' | 'finale';

/** A glowing arch portal with an operation sign. */
export class Portal {
  readonly group = new Group();
  readonly radius: number;
  private ringMat: MeshPhysicalMaterial;
  private swirl: ShaderMaterial;
  private sign = new Group();
  private panelMat: MeshPhysicalMaterial;
  private baseColor: Color;
  private pulse = 0;
  private sleeping = false;
  private sleepZ: Mesh[] = [];
  private labelText = '';
  private outer?: Mesh;
  readonly center: number;

  constructor(kind: PortalKind, radius: number, colorKey: keyof typeof OP_COLORS) {
    this.radius = radius;
    this.baseColor = new Color(OP_COLORS[colorKey]);
    const h = radius * 0.62;
    this.center = h;
    const start = -Math.asin(h / radius);
    const arc = Math.PI - 2 * start;
    this.ringMat = new MeshPhysicalMaterial({
      color: this.baseColor,
      roughness: 0.2,
      metalness: kind === 'finale' ? 0.8 : 0.1,
      clearcoat: 1,
      emissive: this.baseColor,
      emissiveIntensity: 0.55,
    });
    const tube = kind === 'finale' ? 0.62 : 0.42;
    const ringGeo = new TorusGeometry(radius, tube, 18, 72, arc);
    ringGeo.rotateZ(start);
    const ring = new Mesh(ringGeo, this.ringMat);
    ring.position.y = h;
    ring.castShadow = true;
    this.group.add(ring);

    // glossy white beads around the arch (one merged mesh)
    const beadParts: BufferGeometry[] = [];
    const beads = Math.round((arc * radius) / 1.6);
    for (let i = 1; i < beads; i++) {
      const a = start + (i / beads) * arc;
      const b = new SphereGeometry(tube * 0.55, 10, 7);
      b.translate(Math.cos(a) * radius, h + Math.sin(a) * radius, tube * 0.75);
      beadParts.push(b);
    }
    this.group.add(new Mesh(mergeGeometries(beadParts), white));

    // feet where the arch meets the road
    const footGeo = new SphereGeometry(tube * 1.8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const side of [-1, 1]) {
      const foot = new Mesh(footGeo, white);
      foot.position.set(side * Math.cos(start) * radius, 0, 0);
      foot.scale.set(1, 0.8, 1);
      this.group.add(foot);
    }

    // swirling membrane
    this.swirl = new ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: this.baseColor.clone() }, strength: { value: 1 }, cut: { value: -h + 0.05 } },
      vertexShader: SWIRL_VERT,
      fragmentShader: SWIRL_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    const membrane = new Mesh(new CircleGeometry(radius - tube * 0.6, 64), this.swirl);
    membrane.position.y = h;
    membrane.renderOrder = 3;
    this.group.add(membrane);

    if (kind === 'finale') {
      const outerGeo = new TorusGeometry(radius + 1.4, 0.16, 8, 80);
      this.outer = new Mesh(outerGeo, new MeshBasicMaterial({ color: '#fff3b0', toneMapped: false }));
      this.outer.position.y = h;
      this.group.add(this.outer);
    }

    // sign panel above the arch
    this.panelMat = new MeshPhysicalMaterial({ color: this.baseColor, roughness: 0.3, clearcoat: 1, emissive: this.baseColor, emissiveIntensity: 0.2 });
    this.sign.position.y = h + radius + (kind === 'finale' ? 2.2 : 1.7);
    this.group.add(this.sign);

    const zGeo = layoutText('Z', SIGN_STYLE).items[0].glyph.geometry;
    for (let i = 0; i < 3; i++) {
      const z = new Mesh(zGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true }));
      z.visible = false;
      this.sleepZ.push(z);
      this.group.add(z);
    }
  }

  setLabel(text: string): void {
    if (text === this.labelText) return;
    this.labelText = text;
    disposeSign(this.sign);
    this.sign.add(buildSign(text, this.panelMat).group);
  }

  setOp(op: MathOp): void {
    this.setLabel(opLabel(op));
  }

  setSleeping(sleeping: boolean): void {
    if (sleeping === this.sleeping) return;
    this.sleeping = sleeping;
    const c = sleeping ? sleepyColor : this.baseColor;
    this.ringMat.color.copy(c);
    this.ringMat.emissive.copy(c);
    this.ringMat.emissiveIntensity = sleeping ? 0.05 : 0.55;
    this.panelMat.color.copy(c);
    this.panelMat.emissive.copy(c);
    (this.swirl.uniforms.color.value as Color).copy(c);
    for (const z of this.sleepZ) z.visible = sleeping;
  }

  flash(): void {
    this.pulse = 1;
  }

  update(time: number, dt: number): void {
    this.swirl.uniforms.time.value = time;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.swirl.uniforms.strength.value = (this.sleeping ? 0.35 : 1) + this.pulse * 2.5;
    const s = 1 + Math.sin(this.pulse * Math.PI) * 0.12;
    this.group.scale.setScalar(s);
    this.ringMat.emissiveIntensity = (this.sleeping ? 0.05 : 0.5 + Math.sin(time * 3) * 0.12) + this.pulse * 1.5;
    this.sign.position.x = 0;
    this.sign.rotation.z = Math.sin(time * 1.3) * 0.04;
    if (this.outer) this.outer.rotation.z = time * 0.6;
    this.sleepZ.forEach((z, i) => {
      if (!z.visible) return;
      const t = (time * 0.5 + i / 3) % 1;
      z.position.set(this.radius * 0.5 + t * 1.5, this.center + this.radius + 3 + t * 2.5, 0.5);
      z.scale.setScalar(0.5 + t * 0.6);
      (z.material as MeshBasicMaterial).opacity = Math.sin(t * Math.PI);
    });
  }
}

const bumperColors = ['#ff5fa2', '#3ea6ff', '#8fd14f', '#ffc83d', '#a35cff'];

/** Wobbly jelly bumper with a sleepy-happy face. */
export class BumperVisual {
  readonly group = new Group();
  private body: Mesh;
  private wobble = 0;
  private wobbleVel = 0;

  constructor(radius: number, index: number) {
    const color = bumperColors[index % bumperColors.length];
    const mat = new MeshPhysicalMaterial({
      color,
      roughness: 0.15,
      clearcoat: 1,
      transmission: 0,
      emissive: new Color(color).multiplyScalar(0.15),
      sheen: 1,
      sheenColor: new Color('#ffffff'),
    });
    this.body = new Mesh(new CapsuleGeometry(radius * 0.92, 0.5, 8, 24), mat);
    this.body.position.y = radius * 0.92 + 0.25;
    this.body.castShadow = true;
    this.group.add(this.body);
    const eyeMat = new MeshBasicMaterial({ color: '#2c1840' });
    for (const side of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.11, 10, 8), eyeMat);
      eye.scale.set(1, 1.4, 0.6);
      eye.position.set(side * radius * 0.3, radius * 0.25, radius * 0.88);
      this.body.add(eye);
      const spot = new Mesh(new SphereGeometry(radius * 0.18, 12, 8), white as Material);
      spot.scale.set(1, 1, 0.3);
      spot.position.set(side * radius * 0.6, radius * 0.6, -radius * 0.5);
      spot.lookAt(spot.position.clone().multiplyScalar(2));
      this.body.add(spot);
    }
    const base = new Mesh(new CylinderGeometry(radius * 1.05, radius * 1.15, 0.25, 24), white);
    base.position.y = 0.12;
    base.receiveShadow = true;
    this.group.add(base);
  }

  hit(strength: number): void {
    this.wobbleVel -= 6 * strength;
  }

  update(time: number, dt: number): void {
    this.wobbleVel += (-this.wobble * 120 - this.wobbleVel * 6) * dt;
    this.wobble += this.wobbleVel * dt;
    const breathe = Math.sin(time * 2.2) * 0.03;
    this.body.scale.set(1 - this.wobble * 0.5 - breathe, 1 + this.wobble + breathe, 1 - this.wobble * 0.5 - breathe);
  }
}

/** Springy trampoline pad. */
export class PadVisual {
  readonly group = new Group();
  private top: Mesh;
  private squash = 0;

  constructor(radius: number) {
    const rim = new Mesh(new TorusGeometry(radius, 0.22, 12, 40), new MeshPhysicalMaterial({ color: '#ff8a3d', roughness: 0.3, clearcoat: 1 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.3;
    this.top = new Mesh(
      new CylinderGeometry(radius - 0.1, radius - 0.1, 0.12, 32),
      new MeshPhysicalMaterial({ color: '#ffe066', roughness: 0.3, clearcoat: 1, emissive: '#ffb703', emissiveIntensity: 0.35 }),
    );
    this.top.position.y = 0.3;
    const legs = new Mesh(new CylinderGeometry(radius * 0.9, radius, 0.3, 24), white);
    legs.position.y = 0.15;
    this.group.add(rim, this.top, legs);
    rim.castShadow = true;
    this.top.receiveShadow = true;
  }

  bounce(): void {
    this.squash = 1;
  }

  update(time: number, dt: number): void {
    this.squash = Math.max(0, this.squash - dt * 3);
    this.top.position.y = 0.3 - Math.sin(this.squash * Math.PI) * 0.2 + Math.sin(time * 4) * 0.02;
  }
}
