// Visual building blocks for Sky Numbers.
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { formatNumber, type MathOp, opLabel } from '../math/numberMath';
import { seededRandom } from '../math/random';
import { layoutText, SIGN_STYLE } from '../render/glyphs';
import { buildSign, disposeSign, SWIRL_FRAG, SWIRL_VERT } from '../render/items';
import { OP_COLORS } from '../render/palette';

export const SKY_SUN = new Vector3(0.35, 0.62, -0.7).normalize();

// ---------------------------------------------------------------- clouds
const CLOUD_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vTint;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    vec4 world = modelMatrix * p;
    vWorld = world.xyz;
    vN = normalize(mat3(modelMatrix) * n);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const CLOUD_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform vec3 rimColor;
  uniform vec3 sunDir;
  uniform float rimStrength;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vTint;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vWorld);
    float wrap = dot(n, sunDir) * 0.5 + 0.5;
    float up = n.y * 0.5 + 0.5;
    vec3 col = mix(bottomColor, topColor, clamp(wrap * 0.6 + up * 0.5, 0.0, 1.0));
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.2);
    float silver = pow(max(dot(-v, sunDir), 0.0), 4.0);
    col += rimColor * rim * (rimStrength + silver * 0.8);
    col *= vTint;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** Soft, "volumetric-looking" cloud shading: wrapped sunlight, height gradient and a bright rim. */
export function cloudMaterial(top: string, bottom: string, rim: string, rimStrength = 0.55): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        topColor: { value: new Color(top) },
        bottomColor: { value: new Color(bottom) },
        rimColor: { value: new Color(rim) },
        sunDir: { value: SKY_SUN.clone() },
        rimStrength: { value: rimStrength },
      },
    ]),
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    fog: true,
  });
}

function keepPositionNormal(g: BufferGeometry): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  return ng;
}

/** A lumpy cumulus cluster made from noisy spheres (about 1 unit radius). */
export function cloudGeometry(seed: number, lumps = 7, detail = 2): BufferGeometry {
  const rand = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < lumps; i++) {
    const r = 0.45 + rand() * 0.4;
    const ico = new IcosahedronGeometry(r, detail);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    // weld the faces so normals are smooth: soft, rounded puffs instead of facets
    const g = mergeVertices(ico, 1e-4);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const n = 1 + 0.08 * Math.sin(x * 7 + seed) * Math.cos(y * 6 + i) + 0.05 * Math.sin(z * 9);
      pos.setXYZ(k, x * n, Math.max(y * n, -r * 0.55), z * n);
    }
    const a = (i / lumps) * Math.PI * 2 + rand();
    const spread = i === 0 ? 0 : 0.55 + rand() * 0.35;
    g.translate(Math.cos(a) * spread, (i === 0 ? 0.15 : rand() * 0.35) - 0.05, Math.sin(a) * spread * 0.6);
    g.computeVertexNormals();
    parts.push(keepPositionNormal(g));
  }
  const merged = mergeGeometries(parts);
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------- sky dome
export function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color('#1f7ef0') },
      mid: { value: new Color('#62b6ff') },
      horizon: { value: new Color('#d9efff') },
      sunDir: { value: SKY_SUN.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
        col = mix(col, top, smoothstep(0.22, 0.9, h));
        col = mix(col, vec3(0.86, 0.93, 1.0), smoothstep(0.0, -0.3, h));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.82) * (pow(sun, 300.0) * 2.0 + pow(sun, 24.0) * 0.35 + pow(sun, 4.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(new SphereGeometry(1400, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

// ---------------------------------------------------------------- distant islands
export function islandGeometry(seed: number): BufferGeometry {
  const rand = seededRandom(seed);
  const paint = (g: BufferGeometry, c: string) => {
    const col = new Color(c);
    const ng = keepPositionNormal(g);
    const n = ng.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    ng.setAttribute('color', new BufferAttribute(arr, 3));
    return ng;
  };
  const parts: BufferGeometry[] = [];
  const rock = new ConeGeometry(1, 1.6, 9, 3);
  rock.rotateX(Math.PI);
  rock.translate(0, -0.8, 0);
  parts.push(paint(rock, rand() > 0.5 ? '#f2b39a' : '#e7a6c8'));
  const grass = new CylinderGeometry(1.04, 0.98, 0.18, 20);
  parts.push(paint(grass, '#86dd6c'));
  for (let i = 0; i < 3; i++) {
    const a = rand() * 6.28;
    const d = rand() * 0.55;
    const trunk = new CylinderGeometry(0.04, 0.06, 0.45, 6);
    trunk.translate(Math.cos(a) * d, 0.3, Math.sin(a) * d);
    parts.push(paint(trunk, '#b07a5a'));
    const crown = new IcosahedronGeometry(0.22 + rand() * 0.12, 1);
    crown.translate(Math.cos(a) * d, 0.62, Math.sin(a) * d);
    parts.push(paint(crown, ['#ff8fc4', '#7ef0c4', '#ffd166', '#b69cff'][i % 4]));
  }
  return mergeGeometries(parts);
}

export const islandMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

// ---------------------------------------------------------------- portals
const halo = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
})();

const haloTexture = new CanvasTexture(halo);
haloTexture.colorSpace = SRGBColorSpace;

const ringGeo = new TorusGeometry(1, 0.13, 16, 64);
const beadGeo = (() => {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new SphereGeometry(0.075, 8, 6);
    b.translate(Math.cos(a), Math.sin(a), 0.1);
    parts.push(b);
  }
  return mergeGeometries(parts);
})();
const beadMat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: 0.2 });
const unknownColor = '#9fb4d8';

/** A floating, glowing maths portal with a sign above it. */
export class SkyPortal {
  readonly group = new Group();
  private ring: Mesh;
  private ringMat: MeshPhysicalMaterial;
  private swirl: ShaderMaterial;
  private haloMesh: Mesh;
  private sign = new Group();
  private panelMat: MeshPhysicalMaterial;
  private label = '';
  private flashT = 0;
  private fade = 1;
  private fadeTarget = 1;
  private popT = 0;
  radius = 3;
  /** Forced invisible (e.g. already flown through and close to the camera). */
  hidden = false;

  constructor() {
    this.ringMat = new MeshPhysicalMaterial({ color: unknownColor, roughness: 0.2, clearcoat: 1, emissive: unknownColor, emissiveIntensity: 0.6 });
    this.ring = new Mesh(ringGeo, this.ringMat);
    this.swirl = new ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new Color(unknownColor) }, strength: { value: 1 }, cut: { value: -10 } },
      vertexShader: SWIRL_VERT,
      fragmentShader: SWIRL_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    const membrane = new Mesh(new CircleGeometry(0.95, 48), this.swirl);
    membrane.renderOrder = 3;
    this.haloMesh = new Mesh(
      new PlaneGeometry(3.4, 3.4),
      new MeshBasicMaterial({ map: haloTexture, color: unknownColor, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    this.haloMesh.position.z = -0.05;
    this.haloMesh.renderOrder = 2;
    this.panelMat = new MeshPhysicalMaterial({ color: unknownColor, roughness: 0.3, clearcoat: 1, emissive: unknownColor, emissiveIntensity: 0.25 });
    const beads = new Mesh(beadGeo, beadMat);
    const body = new Group();
    body.add(this.haloMesh, this.ring, beads, membrane);
    body.userData.body = true;
    this.group.add(body, this.sign);
    this.setRadius(3);
    this.setOp(null);
  }

  setRadius(r: number): void {
    this.radius = r;
    const body = this.group.children[0];
    body.scale.setScalar(r);
    this.sign.position.y = r + 1.5;
  }

  /** Show an operation, or "?" while the choices are not decided yet. */
  setOp(op: MathOp | null): void {
    const text = op ? opLabel(op) : '?';
    if (text === this.label) return;
    const changed = this.label !== '';
    this.label = text;
    const c = new Color(op ? OP_COLORS[op.kind] : unknownColor);
    this.ringMat.color.copy(c);
    this.ringMat.emissive.copy(c);
    this.panelMat.color.copy(c);
    this.panelMat.emissive.copy(c);
    (this.swirl.uniforms.color.value as Color).copy(c);
    (this.haloMesh.material as MeshBasicMaterial).color.copy(c);
    disposeSign(this.sign);
    const textH = text.length > 6 ? 1.1 : 1.35;
    this.sign.add(buildSign(text, this.panelMat, textH, false).group);
    if (changed) this.popT = 1;
  }

  flash(): void {
    this.flashT = 1;
  }

  /** Fade out the portals that were not chosen. */
  dim(): void {
    this.fadeTarget = 0;
  }

  reset(): void {
    this.fade = this.fadeTarget = 1;
    this.flashT = 0;
    this.hidden = false;
    this.group.scale.setScalar(1);
    this.group.visible = true;
  }

  update(time: number, dt: number): void {
    this.swirl.uniforms.time.value = time;
    this.flashT = Math.max(0, this.flashT - dt * 1.8);
    this.popT = Math.max(0, this.popT - dt * 3);
    this.fade += (this.fadeTarget - this.fade) * (1 - Math.exp(-6 * dt));
    this.swirl.uniforms.strength.value = (0.9 + this.flashT * 3) * this.fade;
    this.ringMat.emissiveIntensity = 0.55 + Math.sin(time * 3) * 0.15 + this.flashT * 2;
    const s = (0.25 + 0.75 * this.fade) * (1 + Math.sin(this.flashT * Math.PI) * 0.2);
    this.group.scale.setScalar(s);
    this.group.visible = !this.hidden && this.fade > 0.03;
    this.group.children[0].rotation.z = Math.sin(time * 0.8) * 0.05;
    this.sign.scale.setScalar(1 + Math.sin(this.popT * Math.PI) * 0.35);
    this.sign.rotation.z = Math.sin(time * 1.4) * 0.05;
    (this.haloMesh.material as MeshBasicMaterial).opacity = (0.75 + Math.sin(time * 2.5) * 0.15) * this.fade;
  }
}

// ---------------------------------------------------------------- storm cloud
const stormMat = cloudMaterial('#8a8fb5', '#41435f', '#c6c9f0', 0.45);
const stormGeo = cloudGeometry(77, 9, 2);
const boltShape = (() => {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0.35, 0);
  s.lineTo(0.15, -0.55);
  s.lineTo(0.45, -0.55);
  s.lineTo(-0.1, -1.4);
  s.lineTo(0.05, -0.75);
  s.lineTo(-0.22, -0.75);
  s.closePath();
  return new ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false });
})();
const boltMat = new MeshBasicMaterial({ color: '#ffe45c', toneMapped: false, transparent: true });
const eyeWhite = new MeshBasicMaterial({ color: '#ffffff' });
const eyeDark = new MeshBasicMaterial({ color: '#25223a' });

/** A grumpy-but-cute thundercloud with gentle lightning and a few raindrops. */
export class StormVisual {
  readonly group = new Group();
  private body: Mesh;
  private bolts: Mesh[] = [];
  private nextBolt = 1 + Math.random() * 2;
  private boltT = 0;
  private rain: Points;
  private rainPos: Float32Array;
  private wobble = 0;
  private wobbleVel = 0;
  private lids: Mesh[] = [];
  /** 1 = full size; shrinks after a bump ("it used up its zap"). */
  size = 1;
  private sizeTarget = 1;

  /** Built at radius 1; scale the group to the storm's radius. */
  constructor() {
    const r = 1;
    this.body = new Mesh(stormGeo, stormMat);
    this.body.scale.set(r * 1.25, r * 0.85, r);
    this.group.add(this.body);
    // face: sleepy eyes with heavy lids and a small wavy mouth
    for (const side of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.3, 12, 10), eyeWhite);
      eye.scale.set(1, 0.8, 0.5);
      eye.position.set(side * 0.42 * r, 0.3 * r, 0.82 * r);
      const pupil = new Mesh(new SphereGeometry(0.11, 10, 8), eyeDark);
      pupil.position.set(0, -0.04, 0.1);
      eye.add(pupil);
      const lid = new Mesh(new SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), stormMat);
      lid.scale.set(1.05, 0.7, 0.6);
      lid.rotation.z = side * 0.25;
      eye.add(lid);
      this.lids.push(lid);
      this.group.add(eye);
    }
    const mouth = new Mesh(new TorusGeometry(0.16, 0.035, 6, 16, Math.PI), eyeDark);
    mouth.position.set(0, -0.02 * r, 0.92 * r);
    this.group.add(mouth);
    for (let i = 0; i < 2; i++) {
      const b = new Mesh(boltShape, boltMat);
      b.scale.setScalar(r * 0.55);
      b.position.set((i ? 0.45 : -0.5) * r, -0.6 * r, 0.3 * r);
      b.visible = false;
      this.bolts.push(b);
      this.group.add(b);
    }
    const n = 26;
    this.rainPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.resetDrop(i, r, true);
    const g = new BufferGeometry();
    const a = new BufferAttribute(this.rainPos, 3);
    a.setUsage(DynamicDrawUsage);
    g.setAttribute('position', a);
    this.rain = new Points(g, new PointsMaterial({ color: '#cfe3ff', size: 0.16, transparent: true, opacity: 0.8, depthWrite: false }));
    this.rain.userData.r = r;
    this.group.add(this.rain);
  }

  private resetDrop(i: number, r: number, initial: boolean): void {
    this.rainPos[i * 3] = (Math.random() - 0.5) * r * 1.6;
    this.rainPos[i * 3 + 1] = -0.5 * r - (initial ? Math.random() * r * 1.8 : 0);
    this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * r;
  }

  reset(): void {
    this.size = this.sizeTarget = 1;
  }

  hit(): void {
    this.sizeTarget = 0.35;
    this.wobbleVel -= 7;
    this.boltT = 0.25;
    for (const b of this.bolts) b.visible = true;
  }

  update(time: number, dt: number): void {
    const r = this.rain.userData.r as number;
    this.size += (this.sizeTarget - this.size) * (1 - Math.exp(-9 * dt));
    this.wobbleVel += (-this.wobble * 90 - this.wobbleVel * 5) * dt;
    this.wobble += this.wobbleVel * dt;
    const breathe = Math.sin(time * 1.6) * 0.03;
    this.body.scale.set(r * 1.25 * (1 - this.wobble * 0.4 + breathe), r * 0.85 * (1 + this.wobble), r * (1 - this.wobble * 0.4));
    this.group.position.y += 0;
    // gentle, occasional lightning: a brief soft flicker, never a screen flash
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.boltT = 0.18;
      this.nextBolt = 1.8 + Math.random() * 2.5;
      const pick = this.bolts[Math.floor(Math.random() * this.bolts.length)];
      pick.visible = true;
    }
    this.boltT = Math.max(0, this.boltT - dt);
    boltMat.opacity = 0.65 + Math.sin(time * 60) * 0.25;
    if (this.boltT <= 0) for (const b of this.bolts) b.visible = false;
    for (const lid of this.lids) lid.position.y = 0.02 + Math.sin(time * 0.9) * 0.02;
    for (let i = 0; i < this.rainPos.length / 3; i++) {
      this.rainPos[i * 3 + 1] -= dt * 9;
      if (this.rainPos[i * 3 + 1] < -2.6 * r) this.resetDrop(i, r, false);
    }
    this.rain.geometry.getAttribute('position').needsUpdate = true;
  }
}

// ---------------------------------------------------------------- number bubbles
const bubbleMat = new MeshPhysicalMaterial({
  color: '#bfeaff',
  roughness: 0.05,
  metalness: 0,
  clearcoat: 1,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  iridescence: 1,
  iridescenceIOR: 1.3,
});
const bubbleText = new MeshPhysicalMaterial({ color: '#ff3d8b', roughness: 0.3, clearcoat: 1, emissive: '#ff3d8b', emissiveIntensity: 0.35 });
const bubbleGlow = new MeshBasicMaterial({
  map: haloTexture,
  color: '#7fe3ff',
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
const bubbleGlowGeo = new PlaneGeometry(3.2, 3.2);
const bubbleGeo = new SphereGeometry(1, 28, 20);
const starGeo = (() => {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? 0.25 : 0.6;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  g.translate(0, 0, -0.09);
  return g;
})();
const starMat = new MeshPhysicalMaterial({ color: '#ffd84a', roughness: 0.25, clearcoat: 1, emissive: '#ffb703', emissiveIntensity: 0.4 });

/** A shiny floating bubble with a number inside (or a star when it only sparkles). */
export class BubbleVisual {
  readonly group = new Group();
  private inner = new Group();
  private sphere: Mesh;
  private k: number | null | undefined = undefined;
  private popT = 0;
  popped = false;

  private glow: Mesh;

  constructor() {
    this.sphere = new Mesh(bubbleGeo, bubbleMat);
    this.sphere.renderOrder = 4;
    this.glow = new Mesh(bubbleGlowGeo, bubbleGlow);
    this.glow.renderOrder = 2;
    this.group.add(this.glow, this.inner, this.sphere);
  }

  setValue(k: number | null): void {
    if (k === this.k) return;
    this.k = k;
    this.inner.clear();
    if (!k) {
      this.inner.add(new Mesh(starGeo, starMat));
      this.sphere.scale.setScalar(1.05);
      return;
    }
    const { items, width } = layoutText(`+${formatNumber(k)}`, SIGN_STYLE, 0.06);
    for (const it of items) {
      const m = new Mesh(it.glyph.geometry, bubbleText);
      m.position.x = it.x;
      this.inner.add(m);
    }
    const r = Math.max(1.05, 0.55 + width * 0.32);
    const h = Math.min(0.85, (r * 1.6) / Math.max(width, 0.01));
    this.glow.scale.setScalar(r);
    for (const c of this.inner.children) {
      c.position.x *= h;
      c.position.y = -h * 0.5;
      c.scale.setScalar(h);
    }
    this.sphere.scale.setScalar(r);
  }

  pop(): void {
    this.popped = true;
    this.popT = 1;
  }

  reset(): void {
    this.popped = false;
    this.popT = 0;
    this.group.scale.setScalar(1);
    this.group.visible = true;
    this.k = undefined;
  }

  update(time: number, dt: number, phase: number): void {
    this.inner.rotation.y = Math.sin(time * 1.5 + phase) * 0.4;
    this.inner.position.y = Math.sin(time * 2 + phase) * 0.12;
    if (this.popped) {
      this.popT = Math.max(0, this.popT - dt * 4);
      this.group.scale.setScalar(1.45 * (1 + (1 - this.popT) * 0.8));
      this.group.visible = this.popT > 0;
    }
  }
}

// ---------------------------------------------------------------- trail
/** Two glowing wing-tip ribbons left behind the flying number. Points move backwards with the world. */
export class Trail {
  readonly mesh: Mesh;
  private n = 32;
  private pts: { x: number; y: number; z: number; w: number }[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private colors: Color[] = [new Color('#ffffff')];

  constructor() {
    const verts = this.n * 2 * 2; // two ribbons, two vertices per sample
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    const g = new BufferGeometry();
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    const ca = new BufferAttribute(this.col, 4);
    ca.setUsage(DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('color', ca);
    const idx: number[] = [];
    for (let r = 0; r < 2; r++) {
      const base = r * this.n * 2;
      for (let i = 0; i < this.n - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setIndex(idx);
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
  }

  setColors(colors: string[]): void {
    this.colors = colors.map((c) => new Color(c));
  }

  clear(): void {
    this.pts = [];
  }

  /** `span` is the distance between the two wing tips. */
  update(dt: number, speed: number, x: number, y: number, span: number): void {
    for (const p of this.pts) p.z += speed * dt;
    this.pts.unshift({ x, y, z: 0.2, w: span / 2 });
    if (this.pts.length > this.n) this.pts.length = this.n;
    const count = this.pts.length;
    for (let r = 0; r < 2; r++) {
      const side = r === 0 ? -1 : 1;
      for (let i = 0; i < this.n; i++) {
        const p = this.pts[Math.min(i, count - 1)] ?? { x, y, z: 0.2, w: span / 2 };
        const t = i / (this.n - 1);
        const w = 0.16 * (1 - t) + 0.02;
        const c = this.colors[(i + r) % this.colors.length];
        const a = i < count ? (1 - t) * (1 - t) * 0.9 : 0;
        const cx = p.x + side * p.w;
        const k = (r * this.n + i) * 2;
        this.pos.set([cx, p.y - w, p.z, cx, p.y + w, p.z], k * 3);
        this.col.set([c.r, c.g, c.b, a, c.r, c.g, c.b, a], k * 4);
      }
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    this.mesh.geometry.getAttribute('color').needsUpdate = true;
  }
}

// ---------------------------------------------------------------- lightning
const boltCore = new MeshBasicMaterial({
  color: '#fffbe0',
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  side: DoubleSide,
});
const boltGlow = new MeshBasicMaterial({
  color: '#ffd84a',
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  side: DoubleSide,
});

/**
 * A cartoon lightning bolt from a storm cloud to the number: it shoots down in under 0.1 s,
 * glows with two soft pulses (no strobing) and fades. Geometry buffers are reused.
 */
export class LightningBolt {
  readonly group = new Group();
  private segs = 9;
  private core: Mesh;
  private glow: Mesh;
  private t = 1;
  private pts: Vector3[] = [];

  constructor() {
    const make = (mat: MeshBasicMaterial) => {
      const g = new BufferGeometry();
      const pos = new BufferAttribute(new Float32Array((this.segs + 1) * 2 * 3), 3);
      pos.setUsage(DynamicDrawUsage);
      g.setAttribute('position', pos);
      const idx: number[] = [];
      for (let i = 0; i < this.segs; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      const m = new Mesh(g, mat);
      m.frustumCulled = false;
      m.renderOrder = 6;
      return m;
    };
    this.core = make(boltCore);
    this.glow = make(boltGlow);
    this.group.add(this.glow, this.core);
    this.group.visible = false;
    for (let i = 0; i <= this.segs; i++) this.pts.push(new Vector3());
  }

  strike(from: Vector3, to: Vector3): void {
    for (let i = 0; i <= this.segs; i++) {
      const k = i / this.segs;
      const jitter = i === 0 || i === this.segs ? 0 : (Math.random() - 0.5) * 1.6;
      this.pts[i].lerpVectors(from, to, k);
      this.pts[i].x += jitter;
      this.pts[i].z += 0.2;
    }
    this.write(this.core, 0.12);
    this.write(this.glow, 0.45);
    this.t = 0;
    this.group.visible = true;
  }

  private write(mesh: Mesh, width: number): void {
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i <= this.segs; i++) {
      const p = this.pts[i];
      const w = width * (1 - (i / this.segs) * 0.4);
      pos.setXYZ(i * 2, p.x - w, p.y, p.z);
      pos.setXYZ(i * 2 + 1, p.x + w, p.y, p.z);
    }
    pos.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const reveal = Math.min(1, this.t / 0.08);
    const n = Math.max(1, Math.round(reveal * this.segs));
    this.core.geometry.setDrawRange(0, n * 6);
    this.glow.geometry.setDrawRange(0, n * 6);
    // two gentle pulses, then fade out
    const life = 0.5;
    const fade = Math.max(0, 1 - this.t / life);
    const pulse = 0.75 + 0.25 * Math.cos(this.t * Math.PI * 2 * 4);
    boltCore.opacity = fade * pulse;
    boltGlow.opacity = fade * pulse * 0.45;
    if (this.t >= life) this.group.visible = false;
  }
}
