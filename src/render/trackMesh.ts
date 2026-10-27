// Visual track: road ribbons, candy curbs, floating tiles, ramp, boost pad, tunnel and pillars.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Course, inSpan, ROAD_WIDTH } from '../game/course';
import { newFrame } from '../game/trackPath';
import { ROAD } from './palette';
import { circleProfile, sweep } from './sweep';

const TEX_REPEAT = 12; // world units per texture tile along the road

function roadTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = ROAD.surface;
  g.fillRect(0, 0, 256, 512);
  // soft diagonal tiles
  g.globalAlpha = 0.18;
  g.fillStyle = ROAD.surfaceDark;
  for (let y = -256; y < 512; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + 128);
    g.lineTo(256, y + 160);
    g.lineTo(0, y + 32);
    g.fill();
  }
  g.globalAlpha = 1;
  // edge lines
  g.fillStyle = '#ffffff';
  g.fillRect(10, 0, 8, 512);
  g.fillRect(238, 0, 8, 512);
  g.fillStyle = '#ffd84a';
  g.fillRect(22, 0, 4, 512);
  g.fillRect(230, 0, 4, 512);
  // centre dashes (rounded)
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let y = 40; y < 512; y += 256) {
    g.beginPath();
    g.roundRect(122, y, 12, 150, 6);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function arrowTexture(colorA: string, colorB: string): Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = colorA;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = colorB;
  g.beginPath();
  g.moveTo(14, 40);
  g.lineTo(64, 4);
  g.lineTo(114, 40);
  g.lineTo(114, 70);
  g.lineTo(64, 34);
  g.lineTo(14, 70);
  g.closePath();
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export interface TrackVisual {
  group: Group;
  boostTexture: Texture;
  tunnelLights: InstancedMesh;
  update(time: number): void;
}

export function buildTrack(course: Course): TrackVisual {
  const path = course.path;
  const L = course.length;
  const group = new Group();
  const data = course.data;

  const roadMat = new MeshStandardMaterial({ map: roadTexture(), roughness: 0.55, metalness: 0.0 });
  const bodyMat = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 });
  const curbMat = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });

  // ---- split the loop into intervals: main road, fork lanes, gaps, floating tiles
  const cuts = new Set<number>([0, L]);
  for (const f of data.forks) cuts.add(f.start).add(f.end);
  for (const g of data.gaps) cuts.add(g.from).add(g.to);
  for (const o of data.openEdges) cuts.add(o.from).add(o.to);
  const sorted = [...cuts].sort((a, b) => a - b);

  const roadGeos: BufferGeometry[] = [];
  const bodyGeos: BufferGeometry[] = [];
  const curbGeos: BufferGeometry[] = [];
  const white = new Color(ROAD.side);
  const lav = new Color(ROAD.under);
  const curbA = new Color(ROAD.curbA);
  const curbB = new Color(ROAD.curbB);

  const bodyProfile = (w: number): [number, number][] => [
    [w / 2, 0],
    [w / 2 + 0.05, -0.45],
    [w / 2 - 0.5, -1.15],
    [-w / 2 + 0.5, -1.15],
    [-w / 2 - 0.05, -0.45],
    [-w / 2, 0],
  ];

  const addRibbon = (a: number, b: number, laneIndex: number, rails: boolean) => {
    const lane = (s: number) => course.lanes(Math.min(b - 1e-3, Math.max(a + 1e-3, s)))[laneIndex];
    roadGeos.push(
      sweep(path, a, b, {
        step: 1,
        offset: (s) => lane(s).center,
        profile: (s) => [
          [-lane(s).width / 2, 0],
          [lane(s).width / 2, 0],
        ],
        uv: (s, j) => [j, s / TEX_REPEAT],
      }),
    );
    bodyGeos.push(
      sweep(path, a, b, {
        step: 2,
        offset: (s) => lane(s).center,
        profile: (s) => bodyProfile(lane(s).width),
        color: (_s, j) => (j === 2 || j === 3 ? lav : white),
        caps: true,
      }),
    );
    if (!rails) return;
    // candy-striped cushion curbs with crisp stripes: one sweep per stripe
    const stripe = 3;
    for (const side of [-1, 1]) {
      for (let s0 = a; s0 < b - 0.01; s0 += stripe) {
        const s1 = Math.min(b, s0 + stripe);
        const idx = Math.floor(s0 / stripe);
        const col = idx % 2 === 0 ? curbA : curbB;
        curbGeos.push(
          sweep(path, s0, s1, {
            step: 1.5,
            offset: (s) => lane(s).center + side * (lane(s).width / 2 + 0.05),
            profile: () => circleProfile(0, 0.3, 0.36, 10),
            closed: true,
            color: () => col,
          }),
        );
      }
    }
  };

  const tileGeos: BufferGeometry[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const mid = (a + b) / 2;
    if (course.inGap(mid)) continue;
    const open = data.openEdges.some((o) => inSpan(mid, o));
    if (open) {
      // floating platform tiles
      for (let s0 = a; s0 < b - 0.5; s0 += 6.5) {
        const s1 = Math.min(b, s0 + 6);
        tileGeos.push(
          sweep(path, s0, s1, {
            step: 1.5,
            profile: () => [
              [-ROAD_WIDTH / 2, 0],
              [ROAD_WIDTH / 2, 0],
            ],
            uv: (s, j) => [j, s / TEX_REPEAT],
          }),
        );
        bodyGeos.push(
          sweep(path, s0, s1, {
            step: 1.5,
            profile: () => bodyProfile(ROAD_WIDTH),
            color: (_s, j) => (j === 2 || j === 3 ? new Color('#ffb4d9') : white),
            caps: true,
          }),
        );
      }
      continue;
    }
    const fork = course.forkAt(mid);
    if (fork) {
      addRibbon(a, b, 0, true);
      addRibbon(a, b, 1, true);
    } else {
      addRibbon(a, b, 0, true);
    }
  }

  // ---- garden islands between separated fork lanes
  const gardenGeos: BufferGeometry[] = [];
  const gardenBody: BufferGeometry[] = [];
  const gap = (s: number) => {
    const lanes = course.lanes(s);
    return lanes.length > 1 ? lanes[1].center - lanes[1].width / 2 - 0.5 : 0;
  };
  for (const f of data.forks) {
    let a = f.start;
    while (a < f.end && gap(a) < 0.25) a += 0.5;
    let b = f.end;
    while (b > a && gap(b) < 0.25) b -= 0.5;
    if (b - a < 4) continue;
    gardenGeos.push(
      sweep(path, a, b, {
        step: 1,
        lift: () => -0.12,
        profile: (s) => [
          [-gap(s), 0],
          [gap(s), 0],
        ],
        color: () => new Color('#7fdc6a'),
      }),
    );
    gardenBody.push(
      sweep(path, a, b, {
        step: 2,
        lift: () => -0.12,
        profile: (s) => bodyProfile(Math.max(0.2, gap(s) * 2)),
        color: (_s, j) => (j === 2 || j === 3 ? new Color('#e9a3c2') : new Color('#f3b49b')),
        caps: true,
      }),
    );
    // round bushes and flowers along the island
    const flowerColors = ['#ff7eb6', '#ffd166', '#ffffff', '#b69cff', '#ff9f68'];
    for (let s = a + 3; s < b - 2; s += 3.2) {
      const g = gap(s);
      if (g < 0.9) continue;
      const fr2 = newFrame();
      path.frameAt(s, fr2);
      const n = g > 2 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const x = n === 1 ? 0 : (k - 1) * g * 0.55;
        const big = k === 1 || n === 1;
        const r = big ? Math.min(1.1, g * 0.5) : 0.45;
        const bush = new SphereGeometry(r, 14, 10);
        bush.scale(1, 0.8, 1);
        const p = fr2.pos.clone().addScaledVector(fr2.right, x).addScaledVector(fr2.up, r * 0.6);
        bush.translate(p.x, p.y, p.z);
        const col = big && (Math.round(s) % 3 === 0) ? flowerColors[Math.round(s) % flowerColors.length] : '#5fca6b';
        const cnt = bush.getAttribute('position').count;
        const c = new Color(col);
        const arr = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) arr.set([c.r, c.g, c.b], i * 3);
        bush.setAttribute('color', new BufferAttribute(arr, 3));
        bush.deleteAttribute('uv');
        gardenGeos.push(bush.toNonIndexed());
      }
    }
  }
  if (gardenGeos.length) {
    const nonIndexed = gardenGeos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of nonIndexed) if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const garden = new Mesh(mergeGeometries(nonIndexed), new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    garden.receiveShadow = true;
    garden.castShadow = true;
    group.add(garden, new Mesh(mergeGeometries(gardenBody), bodyMat));
  }

  const road = new Mesh(mergeGeometries([...roadGeos, ...tileGeos]), roadMat);
  road.receiveShadow = true;
  const body = new Mesh(mergeGeometries(bodyGeos), bodyMat);
  body.receiveShadow = true;
  const curbs = new Mesh(mergeGeometries(curbGeos), curbMat);
  curbs.castShadow = true;
  curbs.receiveShadow = true;
  group.add(road, body, curbs);

  // ---- ramp
  const ramp = data.ramp;
  const rampMat = new MeshPhysicalMaterial({
    map: arrowTexture('#ff9a3c', '#fff4c2'),
    roughness: 0.4,
    clearcoat: 0.8,
  });
  const rampTop = sweep(path, ramp.from, ramp.to, {
    step: 0.5,
    lift: (s) => course.rampHeight(s) + 0.02,
    profile: () => [
      [-ROAD_WIDTH / 2, 0],
      [ROAD_WIDTH / 2, 0],
    ],
    uv: (s, j) => [j * 3, -(s - ramp.from) / 4],
  });
  const rampSide = sweep(path, ramp.from, ramp.to, {
    step: 0.5,
    profile: (s) => {
      const h = course.rampHeight(s);
      const w = ROAD_WIDTH / 2;
      return [
        [w, h],
        [w, 0],
        [-w, 0],
        [-w, h],
      ];
    },
    color: () => new Color('#ffd84a'),
    caps: true,
  });
  const rampMesh = new Mesh(rampTop, rampMat);
  rampMesh.receiveShadow = true;
  const rampSideMesh = new Mesh(rampSide, bodyMat);
  rampSideMesh.castShadow = true;
  group.add(rampMesh, rampSideMesh);

  // ---- boost pad (scrolling glowing arrows)
  const boostTexture = arrowTexture('#1fd1ff', '#ffffff');
  boostTexture.repeat.set(3, 2);
  const boostMat = new MeshBasicMaterial({ map: boostTexture, transparent: true, opacity: 0.9 });
  for (const b of data.boost) {
    const g = sweep(path, b.from, b.to, {
      step: 1,
      lift: () => 0.03,
      profile: () => [
        [-ROAD_WIDTH / 2 + 0.8, 0],
        [ROAD_WIDTH / 2 - 0.8, 0],
      ],
      uv: (s, j) => [j, -(s - b.from) / (b.to - b.from)],
    });
    group.add(new Mesh(g, boostMat));
  }

  // ---- start / finish checker strip
  const checker = document.createElement('canvas');
  checker.width = 256;
  checker.height = 32;
  const cg = checker.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      cg.fillStyle = (x + y) % 2 ? '#ffffff' : '#2c1840';
      cg.fillRect(x * 16, y * 16, 16, 16);
    }
  const checkerTex = new CanvasTexture(checker);
  checkerTex.colorSpace = SRGBColorSpace;
  group.add(
    new Mesh(
      sweep(path, data.startS + 0.2, data.startS + 2.2, {
        step: 1,
        lift: () => 0.03,
        profile: () => [
          [-ROAD_WIDTH / 2, 0],
          [ROAD_WIDTH / 2, 0],
        ],
        uv: (s, j) => [j, (s - data.startS) / 2],
      }),
      new MeshBasicMaterial({ map: checkerTex }),
    ),
  );

  // ---- tunnel shell with glowing rings
  const t = data.tunnel;
  const R = 8.2;
  const arc = (r: number): [number, number][] => {
    const pts: [number, number][] = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = -0.12 + (i / n) * (Math.PI + 0.24);
      pts.push([Math.cos(a) * r, Math.sin(a) * r - 0.6]);
    }
    return pts;
  };
  // counter-clockwise arcs face inwards; reverse for the outside of the shell
  const shellOuter = sweep(path, t.from, t.to, { step: 2, profile: () => arc(R + 0.6).reverse() });
  const shellInner = sweep(path, t.from, t.to, { step: 2, profile: () => arc(R) });
  const outerMat = new MeshPhysicalMaterial({ color: '#7be3c8', roughness: 0.35, clearcoat: 0.8 });
  const innerMat = new MeshStandardMaterial({ color: '#3b2a7a', roughness: 0.6, side: DoubleSide });
  const outer = new Mesh(shellOuter, outerMat);
  outer.castShadow = true;
  const inner = new Mesh(shellInner, innerMat);
  inner.receiveShadow = true;
  group.add(outer, inner);

  const ringGeo = new TorusGeometry(R - 0.15, 0.16, 8, 40, Math.PI + 0.24);
  ringGeo.rotateZ(-0.12);
  ringGeo.translate(0, -0.6, 0);
  const ringCount = Math.floor((t.to - t.from) / 6);
  const ringMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const tunnelLights = new InstancedMesh(ringGeo, ringMat, ringCount);
  const rimGeo = new TorusGeometry(R + 0.3, 0.55, 12, 48, Math.PI + 0.24);
  rimGeo.rotateZ(-0.12);
  rimGeo.translate(0, -0.6, 0);
  const rimMat = new MeshPhysicalMaterial({ color: '#ff5fa2', roughness: 0.3, clearcoat: 1 });
  const fr = newFrame();
  const m4 = new Matrix4();
  const back = new Vector3();
  const placeOnTrack = (obj: { position: Vector3; quaternion: Quaternion }, s: number) => {
    path.frameAt(s, fr);
    back.copy(fr.tangent).negate();
    m4.makeBasis(fr.right, fr.up, back);
    obj.quaternion.setFromRotationMatrix(m4);
    obj.position.copy(fr.pos);
  };
  const tmp = { position: new Vector3(), quaternion: new Quaternion() };
  const one = new Vector3(1, 1, 1);
  const ringColors = [new Color('#3ff0ff'), new Color('#ff7ad9'), new Color('#ffe76a')];
  for (let i = 0; i < ringCount; i++) {
    placeOnTrack(tmp, t.from + 3 + i * 6);
    m4.compose(tmp.position, tmp.quaternion, one);
    tunnelLights.setMatrixAt(i, m4);
    tunnelLights.setColorAt(i, ringColors[i % 3].clone().multiplyScalar(1.6));
  }
  group.add(tunnelLights);
  for (const s of [t.from, t.to]) {
    const rim = new Mesh(rimGeo, rimMat);
    placeOnTrack(rim, s);
    rim.castShadow = true;
    group.add(rim);
  }

  // ---- pillars under the elevated road
  const pillarGeo = new CylinderGeometry(0.9, 1.25, 1, 16, 1, false);
  pillarGeo.translate(0, -0.5, 0);
  const capGeo = new SphereGeometry(1.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const pillarParts: { s: number; x: number; top: Vector3 }[] = [];
  const probe = new Vector3();
  for (let s = 10; s < L; s += 26) {
    path.frameAt(s, fr);
    if (fr.pos.y < 3 || course.inGap(s) || data.openEdges.some((o) => inSpan(s, o))) continue;
    for (const lane of course.lanes(s)) {
      const top = fr.pos.clone().addScaledVector(fr.right, lane.center).addScaledVector(fr.up, -1.1);
      // keep pillars away from roads passing underneath
      let blocked = false;
      for (let q = 0; q < L; q += 3) {
        if (Math.abs(q - s) < 20 || Math.abs(q - s) > L - 20) continue;
        path.pointAt(q, 0, 0, probe);
        if (probe.y < top.y - 2 && Math.hypot(probe.x - top.x, probe.z - top.z) < 9) {
          blocked = true;
          break;
        }
      }
      if (!blocked) pillarParts.push({ s, x: lane.center, top });
    }
  }
  const pillarMat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 0.7 });
  const bandMat = new MeshPhysicalMaterial({ color: '#ffb0d6', roughness: 0.3, clearcoat: 0.7 });
  const pillars = new InstancedMesh(pillarGeo, pillarMat, pillarParts.length);
  const caps = new InstancedMesh(capGeo, bandMat, pillarParts.length);
  const bottom = -70;
  pillarParts.forEach((p, i) => {
    const h = p.top.y - bottom;
    m4.makeScale(1, h, 1).setPosition(p.top);
    pillars.setMatrixAt(i, m4);
    m4.makeScale(1, -0.6, 1).setPosition(p.top.x, p.top.y + 0.05, p.top.z);
    caps.setMatrixAt(i, m4);
  });
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  group.add(pillars, caps);

  return {
    group,
    boostTexture,
    tunnelLights,
    update(time: number) {
      boostTexture.offset.y = (time * 2.5) % 1;
    },
  };
}
