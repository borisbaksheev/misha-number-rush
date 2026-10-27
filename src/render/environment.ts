// Sky, cloud sea, floating islands, giant floating maths symbols, balloons and rainbows.
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Course } from '../game/course';
import { glyph, SIGN_STYLE } from './glyphs';
import { DIGIT_COLORS, SKY } from './palette';

/** Deterministic random so the world looks the same every time. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paint(g: BufferGeometry, color: Color | string): BufferGeometry {
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

function clean(g: BufferGeometry): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  return ng;
}

export const SUN_DIR = new Vector3(-0.45, 0.75, 0.5).normalize();

export interface EnvironmentVisual {
  group: Group;
  update(time: number, dt: number, focus: Vector3): void;
}

export function buildEnvironment(course: Course): EnvironmentVisual {
  const group = new Group();
  const rand = rng(7);
  const animated: { obj: Object3D; base: Vector3; amp: number; speed: number; phase: number; spin: number }[] = [];

  // ---- sky dome
  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY.top },
      mid: { value: SKY.mid },
      horizon: { value: SKY.horizon },
      sunDir: { value: SUN_DIR },
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
        vec3 col = mix(horizon, mid, smoothstep(-0.05, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.85, h));
        col = mix(col, vec3(1.0, 0.86, 0.93), smoothstep(0.0, -0.35, h));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(sun, 64.0) * 0.9 + pow(sun, 6.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new Mesh(new SphereGeometry(1500, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- clouds: one puffy geometry, many instances
  const puffParts: BufferGeometry[] = [];
  const cr = rng(3);
  for (let i = 0; i < 7; i++) {
    const r = 1 + cr() * 0.9;
    const g = new IcosahedronGeometry(r, 1);
    g.translate((i - 3) * 1.1 + cr() * 0.4, cr() * 0.6 + (i % 2) * 0.4, cr() * 1.2 - 0.6);
    puffParts.push(clean(g));
  }
  const puff = mergeGeometries(puffParts);
  puff.scale(1, 0.7, 1);
  const cloudMat = new MeshStandardMaterial({
    color: '#efe6ff',
    roughness: 1,
    emissive: new Color('#ffcfe6'),
    emissiveIntensity: 0.1,
  });
  const center = new Vector3(-25, 0, -40);
  const seaCount = 120;
  const sea = new InstancedMesh(puff, cloudMat, seaCount);
  const m = new Matrix4();
  for (let i = 0; i < seaCount; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 420;
    const sc = 6 + rand() * 9;
    m.makeScale(sc, sc * (0.6 + rand() * 0.4), sc).setPosition(
      center.x + Math.cos(a) * d,
      -64 - rand() * 18,
      center.z + Math.sin(a) * d,
    );
    sea.setMatrixAt(i, m);
  }
  group.add(sea);

  const skyClouds = new InstancedMesh(puff, cloudMat, 26);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = 230 + rand() * 260;
    const sc = 5 + rand() * 6;
    m.makeScale(sc, sc * 0.7, sc).setPosition(center.x + Math.cos(a) * d, 30 + rand() * 90, center.z + Math.sin(a) * d);
    skyClouds.setMatrixAt(i, m);
  }
  const skyCloudGroup = new Group();
  skyCloudGroup.add(skyClouds);
  skyCloudGroup.position.copy(center);
  skyClouds.position.copy(center).negate();
  group.add(skyCloudGroup);

  // ---- track proximity test for scenery placement
  const trackPts: Vector3[] = [];
  for (let s = 0; s < course.length; s += 6) trackPts.push(course.path.pointAt(s, 0, 0, new Vector3()));
  const nearTrack = (x: number, z: number, minD: number) =>
    trackPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD);

  // ---- floating islands
  const islandMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const treeColors = ['#ff7eb6', '#7ef0c4', '#ffd166', '#b69cff', '#ff9f68'];
  const placed: { x: number; z: number; r: number }[] = [];
  let tries = 0;
  while (placed.length < 18 && tries++ < 600) {
    const a = rand() * Math.PI * 2;
    const d = 40 + rand() * 260;
    const x = center.x + Math.cos(a) * d;
    const z = center.z + Math.sin(a) * d;
    const r = 6 + rand() * 9;
    if (nearTrack(x, z, r + 16)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 10)) continue;
    placed.push({ x, z, r });
    const parts: BufferGeometry[] = [];
    const rock = new ConeGeometry(r, r * 1.5, 8, 3);
    rock.rotateX(Math.PI);
    rock.translate(0, -r * 0.75 - 0.4, 0);
    const pos = rock.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -0.5) pos.setXYZ(i, pos.getX(i) * (0.85 + rand() * 0.3), y * (0.9 + rand() * 0.2), pos.getZ(i) * (0.85 + rand() * 0.3));
    }
    parts.push(paint(clean(rock), rand() > 0.5 ? '#f3b49b' : '#e9a3c2'));
    const grass = new CylinderGeometry(r * 1.04, r * 0.98, 0.9, 20);
    parts.push(paint(clean(grass), '#7fdc6a'));
    const treeN = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < treeN; i++) {
      const ta = rand() * Math.PI * 2;
      const td = rand() * r * 0.6;
      const th = 2 + rand() * 3;
      const trunk = new CylinderGeometry(0.25, 0.35, th, 8);
      trunk.translate(Math.cos(ta) * td, th / 2 + 0.4, Math.sin(ta) * td);
      parts.push(paint(clean(trunk), '#b07a5a'));
      const cr2 = 1.2 + rand() * 1.4;
      const canopy = new IcosahedronGeometry(cr2, 2);
      canopy.translate(Math.cos(ta) * td, th + cr2 * 0.7 + 0.4, Math.sin(ta) * td);
      parts.push(paint(clean(canopy), treeColors[Math.floor(rand() * treeColors.length)]));
    }
    for (let i = 0; i < 3; i++) {
      const ba = rand() * Math.PI * 2;
      const bd = r * (0.5 + rand() * 0.4);
      const bush = new IcosahedronGeometry(0.7 + rand() * 0.6, 1);
      bush.translate(Math.cos(ba) * bd, 0.7, Math.sin(ba) * bd);
      parts.push(paint(clean(bush), '#5fca6b'));
    }
    const mesh = new Mesh(mergeGeometries(parts), islandMat);
    const y = -12 + rand() * 34;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rand() * 6;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    animated.push({ obj: mesh, base: mesh.position.clone(), amp: 0.8 + rand(), speed: 0.3 + rand() * 0.3, phase: rand() * 6, spin: 0 });
  }

  // ---- giant floating maths symbols and digits
  const bigGlyphs = ['+', '×', '÷', '=', '1', '2', '3', '5', '7', '8', '0', '9', '−', '4'];
  bigGlyphs.forEach((ch, i) => {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 60; k++) {
      const a = (i / bigGlyphs.length) * Math.PI * 2 + rand() * 0.4;
      const d = 120 + rand() * 170;
      x = center.x + Math.cos(a) * d;
      z = center.z + Math.sin(a) * d;
      if (!nearTrack(x, z, 45)) break;
    }
    const color = DIGIT_COLORS[ch] ?? ['#ff7eb6', '#7ef0c4', '#ffd166', '#b69cff'][i % 4];
    const mat = new MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, emissive: new Color(color).multiplyScalar(0.12) });
    const mesh = new Mesh(glyph(ch, SIGN_STYLE).geometry, mat);
    const sc = 12 + rand() * 10;
    mesh.scale.set(sc, sc, sc * 2.2);
    mesh.position.set(x, 10 + rand() * 45, z);
    group.add(mesh);
    animated.push({ obj: mesh, base: mesh.position.clone(), amp: 2 + rand() * 2, speed: 0.2 + rand() * 0.2, phase: rand() * 6, spin: (rand() - 0.5) * 0.3 });
  });

  // ---- balloons drifting upwards
  const balloonGeo = new SphereGeometry(1, 16, 12);
  balloonGeo.scale(1, 1.2, 1);
  const knot = new ConeGeometry(0.18, 0.3, 8);
  knot.rotateX(Math.PI);
  knot.translate(0, -1.25, 0);
  const balloonGeoFull = mergeGeometries([clean(balloonGeo), clean(knot)]);
  const balloonMat = new MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1 });
  const balloonCount = 36;
  const balloons = new InstancedMesh(balloonGeoFull, balloonMat, balloonCount);
  const balloonData: { x: number; z: number; y: number; speed: number; phase: number }[] = [];
  const palette = Object.values(DIGIT_COLORS);
  for (let i = 0; i < balloonCount; i++) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 40; k++) {
      x = center.x + (rand() - 0.5) * 420;
      z = center.z + (rand() - 0.5) * 420;
      if (!nearTrack(x, z, 14)) break;
    }
    balloonData.push({ x, z, y: -40 + rand() * 120, speed: 1.5 + rand() * 2, phase: rand() * 6 });
    balloons.setColorAt(i, new Color(palette[i % (palette.length - 1)]));
  }
  group.add(balloons);

  // ---- rainbows
  const rainbowColors = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'];
  const addRainbow = (pos: Vector3, rotY: number, radius: number) => {
    const g = new Group();
    rainbowColors.forEach((c, i) => {
      const band = new Mesh(
        new TorusGeometry(radius - i * 1.1, 0.6, 8, 64, Math.PI),
        new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.5 }),
      );
      g.add(band);
    });
    g.position.copy(pos);
    g.rotation.y = rotY;
    group.add(g);
  };
  {
    const f = { pos: new Vector3(), tangent: new Vector3(), right: new Vector3(), up: new Vector3() };
    course.path.frameAt(390, f);
    addRainbow(f.pos.clone().addScaledVector(f.up, -3), Math.atan2(-f.right.z, f.right.x), 15);
    addRainbow(new Vector3(140, -30, -220), 0.6, 70);
  }

  const tmpM = new Matrix4();
  return {
    group,
    update(time: number, dt: number, focus: Vector3) {
      for (const a of animated) {
        a.obj.position.y = a.base.y + Math.sin(time * a.speed + a.phase) * a.amp;
        if (a.spin) a.obj.rotation.y += a.spin * dt;
      }
      skyCloudGroup.rotation.y = time * 0.004;
      sky.position.copy(focus);
      balloonData.forEach((b, i) => {
        b.y += b.speed * dt;
        if (b.y > 90) b.y = -50;
        const sway = Math.sin(time * 0.7 + b.phase) * 1.5;
        tmpM.makeScale(1.4, 1.4, 1.4).setPosition(b.x + sway, b.y, b.z);
        balloons.setMatrixAt(i, tmpM);
      });
      balloons.instanceMatrix.needsUpdate = true;
    },
  };
}
